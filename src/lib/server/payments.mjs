import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export function jsonResponse(status, body) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Server Supabase configuration is missing')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function requireAdmin(request) {
  const allowedEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  if (allowedEmails.length === 0) return jsonResponse(503, { error: 'Admin access is not configured' })

  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return jsonResponse(401, { error: 'Sign in with an admin account' })

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    return jsonResponse(503, { error: 'Server Supabase configuration is missing' })
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user?.email || !allowedEmails.includes(data.user.email.toLowerCase())) {
    return jsonResponse(403, { error: 'Admin access denied' })
  }

  return { supabase, user: data.user }
}

const allPaysCurrencies = new Set([
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'NOK', 'SEK', 'DKK',
  'RUB', 'UAH', 'KZT', 'UZS', 'TRY', 'SGD', 'HKD', 'THB',
])

export function getAllPaysConfig() {
  const polygonAddress = process.env.ALLPAYS_POLYGON_ADDRESS || ''
  const currency = (process.env.ALLPAYS_CURRENCY || 'USD').toUpperCase()
  const amount = Number(process.env.ALLPAYS_MEMBERSHIP_AMOUNT || '50')
  const feePayer = process.env.ALLPAYS_FEE_PAYER || 'merchant'

  if (!/^0x[a-fA-F0-9]{40}$/.test(polygonAddress)) {
    throw new Error('A valid Polygon settlement address is not configured')
  }
  if (!allPaysCurrencies.has(currency)) throw new Error('AllPays does not list this settlement currency')
  if (!Number.isFinite(amount) || amount <= 10) throw new Error('AllPays requires a fixed amount greater than 10')
  if (!['customer', 'merchant'].includes(feePayer)) throw new Error('Invalid AllPays fee payer setting')
  if (process.env.VERCEL_ENV === 'production' && (currency !== 'USD' || amount !== 50)) {
    throw new Error('Production membership checkout is fixed at USD 50.00')
  }

  return { polygonAddress, currency, amount, feePayer }
}

export function createMembershipPaymentReference() {
  return `AIEMEM_${randomUUID().replaceAll('-', '')}`
}

export async function initializeMembershipCheckout({ applicationId, requestUrl, reference = createMembershipPaymentReference() }) {
  const config = getAllPaysConfig()
  const callbackUrl = new URL('/api/allpays-callback', requestUrl)
  callbackUrl.searchParams.set('reference', reference)
  const response = await fetch('https://api.allpays.co/v1/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      polygon_address: config.polygonAddress,
      currency: config.currency,
      amount: config.amount,
      amount_editable: false,
      fee_payer: config.feePayer,
      callback_url: callbackUrl.toString(),
    }),
  })

  const result = await response.json().catch(() => null)
  const data = result?.data
  if (!response.ok || result?.success !== true || !data?.payment_id || !data?.payment_secret || !data?.hosted_payment_url) {
    console.error('AllPays payment-link creation failed:', result?.error || response.status)
    throw new Error('AllPays could not create the payment link')
  }
  const hostedUrl = new URL(data.hosted_payment_url)
  if (hostedUrl.protocol !== 'https:' || !['allpays.co', 'www.allpays.co'].includes(hostedUrl.hostname)) {
    throw new Error('AllPays returned an unexpected checkout URL')
  }

  return {
    reference,
    paymentId: data.payment_id,
    paymentSecret: data.payment_secret,
    authorizationUrl: hostedUrl.toString(),
    amount: config.amount,
    currency: config.currency,
    feePayer: config.feePayer,
  }
}

export async function getAllPaysPaymentDetails(paymentId, paymentSecret) {
  if (!paymentId || !paymentSecret) throw new Error('AllPays payment verification details are missing')
  const response = await fetch(`https://api.allpays.co/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { 'X-Payment-Secret': paymentSecret, Accept: 'application/json' },
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.success !== true || !result.data?.payment || !Array.isArray(result.data.attempts)) {
    throw new Error('AllPays could not verify the payment link')
  }
  if (result.data.payment.payment_id !== paymentId) throw new Error('AllPays payment link does not match')
  return result.data
}

export async function getAllPaysPaymentAttempt({ paymentId, paymentSecret, attemptHash }) {
  if (!attemptHash) throw new Error('AllPays payment attempt is missing')
  const details = await getAllPaysPaymentDetails(paymentId, paymentSecret)
  const attempt = details.attempts.find((item) => item.pay_request_hash === attemptHash)
  if (!attempt) throw new Error('AllPays payment attempt was not found')
  return attempt
}

export function isSuccessfulMembershipPayment(attempt, application) {
  return attempt.status === 'completed'
    && Number(attempt.amount) === Number(application.payment_amount)
    && attempt.currency === application.payment_currency
    && typeof attempt.email === 'string'
    && attempt.email.toLowerCase() === application.data?.email?.toLowerCase()
    && attempt.amount_match?.checkout === 'exact'
    && attempt.amount_match?.merchant === 'exact'
}

export async function markMembershipPaid(supabase, application) {
  if (application.payment_status !== 'paid') {
    const { data, error } = await supabase
      .from('team_applications')
      .update({ payment_status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', application.id)
      .eq('review_status', 'approved')
      .eq('payment_reference', application.payment_reference)
      .select('id')
      .maybeSingle()
    if (error) throw new Error('Could not record the membership payment')
    if (!data) throw new Error('Application is not approved for payment')
  }

  const email = application.data?.email
  if (!email) throw new Error('The application has no customer email')

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', email)
  if (profilesError) throw new Error('Could not activate the member profile')
  if (profiles?.length) {
    const { error } = await supabase
      .from('profiles')
      .update({ membership_status: 'active' })
      .in('id', profiles.map((profile) => profile.id))
    if (error) throw new Error('Could not activate the member profile')
  }
}

export function findSuccessfulAllPaysAttempt(attempts, application) {
  return attempts.find((attempt) => isSuccessfulMembershipPayment(attempt, application)) || null
}