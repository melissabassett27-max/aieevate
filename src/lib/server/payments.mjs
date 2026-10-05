import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
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

export function getPaystackConfig() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  const currency = (process.env.PAYSTACK_CURRENCY || 'USD').toUpperCase()
  const amount = Number(process.env.PAYSTACK_MEMBERSHIP_AMOUNT_SUBUNIT || '5000')
  if (!secretKey || !/^sk_(test|live)_/.test(secretKey)) {
    throw new Error('A valid Paystack secret key is not configured')
  }
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Paystack currency or membership amount is invalid')
  }
  const isTestKey = secretKey.startsWith('sk_test_')
  if (process.env.VERCEL_ENV === 'production' && isTestKey) {
    throw new Error('Vercel production must use the Paystack live key')
  }
  if (process.env.VERCEL_ENV === 'preview' && !isTestKey) {
    throw new Error('Vercel preview deployments must use the Paystack test key')
  }
  if (!isTestKey && (currency !== 'USD' || amount !== 5000)) {
    throw new Error('Live team membership checkout is fixed at USD 50.00')
  }
  return { secretKey, currency, amount }
}

export function createMembershipPaymentReference() {
  return `AIEMEM_${randomUUID().replaceAll('-', '')}`
}

export async function initializeMembershipCheckout({ email, applicationId, requestUrl, reference = createMembershipPaymentReference() }) {
  const config = getPaystackConfig()
  const callbackUrl = new URL('/payment/return', requestUrl).toString()
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: String(config.amount),
      currency: config.currency,
      reference,
      callback_url: callbackUrl,
      metadata: { application_id: applicationId, purpose: 'team_membership' },
    }),
  })

  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.status || !result.data?.authorization_url) {
    console.error('Paystack transaction initialization failed:', result?.message || response.status)
    throw new Error('Paystack could not create the checkout session')
  }

  return {
    reference,
    authorizationUrl: result.data.authorization_url,
    amount: config.amount,
    currency: config.currency,
  }
}

export async function verifyPaystackTransaction(reference) {
  const { secretKey } = getPaystackConfig()
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.status || !result.data) {
    throw new Error('Paystack could not verify the transaction')
  }
  return result.data
}

export function isValidPaystackSignature(rawBody, signature, secretKey) {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature) || !secretKey) return false
  const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  const receivedBuffer = Buffer.from(signature, 'hex')
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

export function isSuccessfulMembershipPayment(transaction, application) {
  return transaction.status === 'success'
    && transaction.reference === application.payment_reference
    && Number(transaction.amount) === Number(application.payment_amount)
    && transaction.currency === application.payment_currency
    && transaction.metadata?.purpose === 'team_membership'
    && transaction.metadata?.application_id === application.id
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