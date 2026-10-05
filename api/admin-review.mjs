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
    if (!input || !/^[0-9a-f-]{36}$/i.test(input.applicationId || '') || !['team', 'account-sale'].includes(input.form) || !['approved', 'rejected'].includes(input.decision)) {
      return jsonResponse(400, { error: 'Invalid application review' })
    }

    const isAccountSale = input.form === 'account-sale'
    const table = isAccountSale ? 'account_sale_submissions' : 'team_applications'
    const changes = isAccountSale
      ? input.decision === 'approved'
        ? { review_status: 'approved', seller_payment_status: 'pending', reviewed_at: new Date().toISOString() }
        : { review_status: 'rejected', seller_payment_status: 'rejected', reviewed_at: new Date().toISOString() }
      : input.decision === 'approved'
        ? { review_status: 'approved', payment_status: 'not_due', approved_at: new Date().toISOString() }
        : { review_status: 'rejected', payment_status: 'rejected' }
    const { data, error } = await access.supabase
      .from(table)
      .update(changes)
      .eq('id', input.applicationId)
      .eq('review_status', 'pending')
      .select('id, review_status, payment_status')
      .maybeSingle()

    if (error) {
      console.error('Could not review team application:', error.message)
      return jsonResponse(500, { error: 'Could not save application review' })
    }
    if (!data) return jsonResponse(409, { error: 'Application is missing or has already been reviewed' })
    return jsonResponse(200, { application: data })
  },
}