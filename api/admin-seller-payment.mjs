import { jsonResponse, requireAdmin } from '../src/lib/server/payments.mjs'

const maxBodyLength = 4_096

export default {
  async fetch(request) {
    if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const access = await requireAdmin(request)
    if (access instanceof Response) return access

    const rawBody = await request.text()
    if (rawBody.length > maxBodyLength) return jsonResponse(413, { error: 'Request is too large' })
    let input
    try {
      input = JSON.parse(rawBody)
    } catch {
      return jsonResponse(400, { error: 'Invalid request body' })
    }
    if (!input || !/^[0-9a-f-]{36}$/i.test(input.applicationId || '') || input.confirm !== true) {
      return jsonResponse(400, { error: 'Confirm the manual seller payment to continue' })
    }

    const { data, error } = await access.supabase
      .from('account_sale_submissions')
      .update({ seller_payment_status: 'paid', seller_paid_at: new Date().toISOString() })
      .eq('id', input.applicationId)
      .eq('review_status', 'approved')
      .eq('seller_payment_status', 'pending')
      .select('id, seller_payment_status, seller_paid_at')
      .maybeSingle()

    if (error) {
      console.error('Could not record manual seller payment:', error.message)
      return jsonResponse(500, { error: 'Could not record seller payment' })
    }
    if (!data) return jsonResponse(409, { error: 'Submission is not approved or seller payment is already recorded' })
    return jsonResponse(200, { submission: data })
  },
}