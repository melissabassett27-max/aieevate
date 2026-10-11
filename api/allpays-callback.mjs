import {
  getAllPaysPaymentAttempt,
  getSupabaseAdmin,
  isSuccessfulMembershipPayment,
  jsonResponse,
  markMembershipPaid,
} from '../src/lib/server/payments.mjs'

function callbackResponse(request, reference, status, identifiers = {}) {
  if (request.headers.get('accept')?.includes('text/html')) {
    const returnUrl = new URL('/payment/return', request.url)
    returnUrl.searchParams.set('reference', reference)
    returnUrl.searchParams.set('status', status)
    if (identifiers.paymentId) returnUrl.searchParams.set('payment_id', identifiers.paymentId)
    if (identifiers.attemptHash) returnUrl.searchParams.set('pay_request_hash', identifiers.attemptHash)
    return new Response(null, {
      status: 303,
      headers: { Location: returnUrl.toString(), 'Cache-Control': 'no-store' },
    })
  }
  return jsonResponse(status === 'pending' ? 202 : 200, { received: true, status })
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })
    const url = new URL(request.url)
    const reference = url.searchParams.get('reference') || ''
    const paymentId = url.searchParams.get('payment_id') || ''
    const attemptHash = url.searchParams.get('pay_request_hash') || ''
    if (!/^AIEMEM_[0-9a-f]{32}$/i.test(reference) || !paymentId || !attemptHash) {
      return jsonResponse(400, { error: 'Payment callback is missing required identifiers' })
    }

    let supabase
    try {
      supabase = getSupabaseAdmin()
    } catch {
      return jsonResponse(503, { error: 'Payment verification is not configured' })
    }

    const { data: application, error } = await supabase
      .from('team_applications')
      .select('id, data, review_status, payment_status, payment_reference, payment_amount, payment_currency, payment_provider_id, payment_provider_secret')
      .eq('payment_reference', reference)
      .maybeSingle()
    if (error) return jsonResponse(500, { error: 'Could not load application payment' })
    if (!application) return jsonResponse(404, { error: 'Payment application not found' })
    if (application.payment_status === 'paid') {
      try {
        await markMembershipPaid(supabase, application)
        return callbackResponse(request, reference, 'paid', { paymentId, attemptHash })
      } catch (error) {
        console.error('Could not reactivate an already-paid membership:', error.message)
        return jsonResponse(503, { error: 'Membership activation is temporarily unavailable' })
      }
    }
    if (application.review_status !== 'approved' || application.payment_status !== 'pending') {
      return jsonResponse(409, { error: 'Application is not awaiting membership payment' })
    }
    if (application.payment_provider_id !== paymentId || !application.payment_provider_secret) {
      return jsonResponse(403, { error: 'Payment link does not match this application' })
    }

    try {
      const attempt = await getAllPaysPaymentAttempt({
        paymentId,
        paymentSecret: application.payment_provider_secret,
        attemptHash,
      })
      if (attempt.status !== 'completed') {
        const status = attempt.status === 'timed_out' ? 'failed' : 'pending'
        return callbackResponse(request, reference, status, { paymentId, attemptHash })
      }
      if (!isSuccessfulMembershipPayment(attempt, application)) {
        console.error('AllPays completed attempt failed amount/email validation:', attemptHash)
        return jsonResponse(409, { error: 'Payment attempt does not match the membership invoice' })
      }

      const { data: recorded, error: recordError } = await supabase
        .from('team_applications')
        .update({ payment_attempt_hash: attemptHash })
        .eq('id', application.id)
        .eq('payment_reference', reference)
        .eq('payment_provider_id', paymentId)
        .eq('payment_status', 'pending')
        .select('id')
        .maybeSingle()
      if (recordError || !recorded) return jsonResponse(503, { error: 'Could not record payment attempt' })

      await markMembershipPaid(supabase, { ...application, payment_attempt_hash: attemptHash })
      return callbackResponse(request, reference, 'paid', { paymentId, attemptHash })
    } catch (error) {
      console.error('Could not verify AllPays payment callback:', error.message)
      return jsonResponse(503, { error: 'Payment verification is temporarily unavailable' })
    }
  },
}
