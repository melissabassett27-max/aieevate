import { createClient } from '@supabase/supabase-js'
import {
  createMembershipPaymentReference,
  getAllPaysConfig,
  getSupabaseAdmin,
  initializeMembershipCheckout,
} from '../../src/lib/server/payments.mjs'

const allowedForms = new Set(['account-sale', 'team-application'])
const maxBodyLength = 16_384
const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

const respond = (status, body, additionalHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers, ...additionalHeaders },
})

async function parseSubmission(request) {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const payload = {}
    let formName = ''
    for (const [key, item] of formData.entries()) {
      if (key === 'form') {
        formName = String(item)
        continue
      }
      if (typeof item === 'string') {
        payload[key] = item
      } else if (item instanceof File) {
        payload[key] = {
          name: item.name,
          type: item.type,
          size: item.size,
        }
      }
    }
    return { form: formName, data: payload }
  }

  const rawBody = await request.text()
  if (!rawBody || rawBody.length > maxBodyLength) {
    throw new Error('Request body is too large')
  }

  try {
    return JSON.parse(rawBody)
  } catch {
    throw new Error('Invalid request body')
  }
}

export default async (request) => {
  if (request.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' }, { Allow: 'POST' })
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > maxBodyLength) {
    return respond(413, { error: 'Request is too large' })
  }

  let input
  try {
    input = await parseSubmission(request)
  } catch (error) {
    console.error('Could not parse intake payload:', error.message)
    return respond(400, { error: 'Invalid request body' })
  }

  if (!input || !allowedForms.has(input.form) || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
    return respond(400, { error: 'Invalid submission' })
  }

  if (typeof input.data.website === 'string' && input.data.website.trim()) {
    return respond(200, { success: true })
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing server-side Supabase configuration for intake function')
    return respond(503, { error: 'Submissions are temporarily unavailable' })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const table = input.form === 'account-sale' ? 'account_sale_submissions' : 'team_applications'
  const { website: _website, ...data } = input.data

  if (input.form === 'team-application') {
    let config
    try {
      config = getAllPaysConfig()
    } catch (error) {
      console.error('AllPays is not configured for team applications:', error.message)
      return respond(503, { error: 'Membership checkout is not configured' })
    }

    const reference = createMembershipPaymentReference()
    const startedAt = new Date().toISOString()
    let checkout
    try {
      checkout = await initializeMembershipCheckout({ requestUrl: request.url, reference })
    } catch (error) {
      console.error('Could not create AllPays checkout for team application:', error.message)
      return respond(503, { error: 'Membership checkout could not be created' })
    }

    const { error } = await supabase.from(table).insert({
      data,
      review_status: 'approved',
      payment_status: 'pending',
      payment_provider: 'allpays',
      payment_reference: reference,
      payment_checkout_url: checkout.authorizationUrl,
      payment_provider_id: checkout.paymentId,
      payment_provider_secret: checkout.paymentSecret,
      payment_checkout_started_at: startedAt,
      payment_amount: config.amount,
      payment_currency: config.currency,
    })

    if (error) {
      console.error(`Supabase intake insert failed (${table}):`, error.message)
      return respond(500, { error: 'Could not save submission' })
    }

    return respond(201, {
      success: true,
      checkoutUrl: checkout.authorizationUrl,
      amount: checkout.amount,
      currency: checkout.currency,
      reference: checkout.reference,
      paymentStatus: 'pending',
    })
  }

  const { error } = await supabase.from(table).insert({ data })

  if (error) {
    console.error(`Supabase intake insert failed (${table}):`, error.message)
    return respond(500, { error: 'Could not save submission' })
  }

  return respond(201, { success: true })
}