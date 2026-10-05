import {
  getPaystackConfig,
  getSupabaseAdmin,
  isSuccessfulMembershipPayment,
  isValidPaystackSignature,
  jsonResponse,
  markMembershipPaid,
  verifyPaystackTransaction,
} from '../src/lib/server/payments.mjs'

const maxBodyLength = 1_048_576

export default {
  async fetch(request) {
    if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > maxBodyLength) return jsonResponse(413, { error: 'Request is too large' })

    let secretKey
    try {
      ({ secretKey } = getPaystackConfig())
    } catch {
      return jsonResponse(503, { error: 'Payment webhook is not configured' })
    }

    const rawBody = await request.text()
    if (!rawBody || rawBody.length > maxBodyLength) return jsonResponse(413, { error: 'Request is too large' })
    const signature = request.headers.get('x-paystack-signature')
    if (!isValidPaystackSignature(rawBody, signature, secretKey)) return jsonResponse(401, { error: 'Invalid webhook signature' })

    let event
    try {
      event = JSON.parse(rawBody)
    } catch {
      return jsonResponse(400, { error: 'Invalid webhook body' })
    }
    if (event.event !== 'charge.success') return jsonResponse(200, { received: true })

    const reference = event.data?.reference
    if (typeof reference !== 'string' || !/^AIEMEM_[0-9a-f]{32}$/i.test(reference)) {
      return jsonResponse(200, { received: true })
    }

    let supabase
    try {
      supabase = getSupabaseAdmin()
    } catch {
      return jsonResponse(503, { error: 'Payment webhook is not configured' })
    }

    const { data: application, error } = await supabase
      .from('team_applications')
      .select('id, data, review_status, payment_status, payment_reference, payment_amount, payment_currency, paid_at')
      .eq('payment_reference', reference)
      .maybeSingle()
    if (error) return jsonResponse(500, { error: 'Could not load payment record' })
    if (!application) return jsonResponse(200, { received: true })
    if (application.payment_status === 'paid') {
      try {
        await markMembershipPaid(supabase, application)
        return jsonResponse(200, { received: true })
      } catch (error) {
        console.error('Could not activate an already-paid membership:', error.message)
        return jsonResponse(500, { error: 'Could not activate membership' })
      }
    }

    try {
      const transaction = await verifyPaystackTransaction(reference)
      if (!isSuccessfulMembershipPayment(transaction, application)) {
        console.error('Paystack webhook transaction failed membership verification:', reference)
        return jsonResponse(200, { received: true })
      }
      await markMembershipPaid(supabase, application)
      return jsonResponse(200, { received: true })
    } catch (error) {
      console.error('Could not process Paystack webhook:', error.message)
      return jsonResponse(500, { error: 'Could not process payment event' })
    }
  },
}