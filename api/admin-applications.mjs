import { getSupabaseAdmin, jsonResponse, requireAdmin } from '../src/lib/server/payments.mjs'

export default {
  async fetch(request) {
    if (request.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })
    const access = await requireAdmin(request)
    if (access instanceof Response) return access

    let supabase
    try {
      supabase = access.supabase || getSupabaseAdmin()
    } catch {
      return jsonResponse(503, { error: 'Server Supabase configuration is missing' })
    }

    const [teamResult, saleResult] = await Promise.all([
      supabase
      .from('team_applications')
      .select('id, data, created_at, review_status, payment_status, payment_reference, payment_checkout_url, payment_amount, payment_currency, paid_at')
      .order('created_at', { ascending: false })
      .limit(100),
      supabase
        .from('account_sale_submissions')
        .select('id, data, created_at, review_status, seller_payment_status, reviewed_at, seller_paid_at')
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (teamResult.error || saleResult.error) {
      console.error('Could not load applications:', teamResult.error?.message || saleResult.error?.message)
      return jsonResponse(500, { error: 'Could not load applications' })
    }
    return jsonResponse(200, {
      teamApplications: teamResult.data || [],
      accountSaleSubmissions: saleResult.data || [],
    })
  },
}