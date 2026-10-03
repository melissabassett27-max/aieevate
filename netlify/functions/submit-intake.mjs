import { createClient } from '@supabase/supabase-js'

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

export default async (request) => {
  if (request.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' }, { Allow: 'POST' })
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > maxBodyLength) {
    return respond(413, { error: 'Request is too large' })
  }

  const rawBody = await request.text()
  if (!rawBody || rawBody.length > maxBodyLength) {
    return respond(413, { error: 'Request is too large' })
  }

  let input
  try {
    input = JSON.parse(rawBody)
  } catch {
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
  const { error } = await supabase.from(table).insert({ data })

  if (error) {
    console.error(`Supabase intake insert failed (${table}):`, error.message)
    return respond(500, { error: 'Could not save submission' })
  }

  return respond(201, { success: true })
}