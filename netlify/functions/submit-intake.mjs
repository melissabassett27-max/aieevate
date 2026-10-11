import { createClient } from '@supabase/supabase-js'
import {
  createMembershipPaymentReference,
  getAllPaysConfig,
  initializeMembershipCheckout,
} from '../../src/lib/server/payments.mjs'

const allowedForms = new Set(['account-sale', 'team-application'])
const maxBodyLength = 64 * 1024
const cvBucket = 'team-cvs'
const maxCvSize = 5 * 1024 * 1024
const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

const respond = (status, body, additionalHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers, ...additionalHeaders },
})

async function parseSubmission(request) {
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

async function removeCv(supabase, path) {
  const { error } = await supabase.storage.from(cvBucket).remove([path])
  if (error) console.error('Could not remove abandoned CV upload:', error.message)
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
    const cv = data.cv
    if (
      !cv
      || typeof cv !== 'object'
      || typeof cv.path !== 'string'
      || !/^team-applications\/[0-9a-f-]{36}\.(pdf|doc|docx|txt)$/i.test(cv.path)
      || typeof cv.name !== 'string'
      || typeof cv.type !== 'string'
      || !Number.isSafeInteger(cv.size)
      || cv.size < 1
      || cv.size > maxCvSize
    ) {
      return respond(400, { error: 'Upload a PDF, DOC, DOCX, or TXT CV no larger than 5 MB' })
    }

    const { data: uploadedFiles, error: uploadedFilesError } = await supabase.storage
      .from(cvBucket)
      .list('team-applications', { search: cv.path.split('/').at(-1), limit: 1 })
    if (uploadedFilesError) {
      console.error('Could not verify uploaded CV:', uploadedFilesError.message)
      return respond(503, { error: 'Could not verify CV upload' })
    }
    if (!uploadedFiles?.some((file) => `team-applications/${file.name}` === cv.path)) {
      return respond(400, { error: 'CV upload was not found; please upload it again' })
    }

    let config
    try {
      config = getAllPaysConfig()
    } catch (error) {
      console.error('AllPays is not configured for team applications:', error.message)
      await removeCv(supabase, cv.path)
      return respond(503, { error: 'Membership checkout is not configured' })
    }

    const reference = createMembershipPaymentReference()
    const startedAt = new Date().toISOString()
    let checkout
    try {
      checkout = await initializeMembershipCheckout({ requestUrl: request.url, reference })
    } catch (error) {
      console.error('Could not create AllPays checkout for team application:', error.message)
      await removeCv(supabase, cv.path)
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
      await removeCv(supabase, cv.path)
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