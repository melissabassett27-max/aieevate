import {
  getSupabaseAdmin,
  isSuccessfulMembershipPayment,
  jsonResponse,
  markMembershipPaid,
  verifyPaystackTransaction,
} from '../src/lib/server/payments.mjs'

export default {
  async fetch(request) {
    if (request.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })
    const reference = new URL(request.url).searchParams.get('reference') || ''
    if (!/^AIEMEM_[0-9a-f]{32}$/i.test(reference)) return jsonResponse(400, { error: 'Invalid payment reference' })

    let supabase
    try {
      supabase = getSupabaseAdmin()
    } catch {
      return jsonResponse(503, { error: 'Payment verification is not configured' })
    }

    const { data: application, error } = await supabase
      .from('team_applications')
      .select('id, data, review_status, payment_status, payment_reference, payment_amount, payment_currency, paid_at')
      .eq('payment_reference', reference)
      .maybeSingle()
    if (error) return jsonResponse(500, { error: 'Could not load payment record' })
    if (!application) return jsonResponse(404, { error: 'Payment record not found' })
    if (application.payment_status === 'paid') {
      try {
        await markMembershipPaid(supabase, application)
        return jsonResponse(200, { status: 'paid' })
      } catch (error) {
        console.error('Could not activate an already-paid membership:', error.message)
        return jsonResponse(503, { error: 'Membership activation is temporarily unavailable' })
      }
    }
    if (application.review_status !== 'approved') return jsonResponse(409, { error: 'Application is not approved' })

    try {
      const transaction = await verifyPaystackTransaction(reference)
      if (transaction.status !== 'success') {
        if (['failed', 'abandoned', 'reversed'].includes(transaction.status)) {
          const { error: resetError } = await supabase
            .from('team_applications')
            .update({
              payment_status: 'not_due',
              payment_reference: null,
              payment_checkout_url: null,
              payment_amount: null,
              payment_currency: null,
            })
            .eq('id', application.id)
            .eq('payment_reference', reference)
            .eq('payment_status', 'pending')
          if (resetError) return jsonResponse(503, { error: 'Could not update payment status' })
          return jsonResponse(200, { status: 'failed' })
        }
        return jsonResponse(202, { status: 'pending' })
      }
      if (!isSuccessfulMembershipPayment(transaction, application)) {
        console.error('Paystack verification did not match the approved membership')
        return jsonResponse(409, { error: 'Payment does not match this membership' })
      }
      await markMembershipPaid(supabase, application)
      return jsonResponse(200, { status: 'paid' })
    } catch (error) {
      console.error('Membership payment verification failed:', error.message)
      return jsonResponse(503, { error: 'Payment verification is temporarily unavailable' })
    }
  },
}