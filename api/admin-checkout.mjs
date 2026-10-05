import {
  createMembershipPaymentReference,
  getPaystackConfig,
  getSupabaseAdmin,
  initializeMembershipCheckout,
  jsonResponse,
  requireAdmin,
} from '../src/lib/server/payments.mjs'

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
    if (!input || !/^[0-9a-f-]{36}$/i.test(input.applicationId || '')) {
      return jsonResponse(400, { error: 'Invalid application' })
    }

    let supabase
    try {
      supabase = access.supabase || getSupabaseAdmin()
    } catch {
      return jsonResponse(503, { error: 'Server Supabase configuration is missing' })
    }

    const { data: application, error: lookupError } = await supabase
      .from('team_applications')
      .select('id, data, review_status, payment_status, payment_reference, payment_checkout_url, payment_amount, payment_currency')
      .eq('id', input.applicationId)
      .maybeSingle()
    if (lookupError) return jsonResponse(500, { error: 'Could not load application' })
    if (!application) return jsonResponse(404, { error: 'Application not found' })
    if (application.review_status !== 'approved') return jsonResponse(409, { error: 'Approve the application before creating checkout' })
    if (application.payment_status === 'paid') return jsonResponse(409, { error: 'Membership is already paid' })
    if (application.payment_status === 'pending' && application.payment_checkout_url) {
      return jsonResponse(200, {
        authorizationUrl: application.payment_checkout_url,
        amount: application.payment_amount,
        currency: application.payment_currency,
        reference: application.payment_reference,
      })
    }
    if (application.payment_status === 'pending' && application.payment_checkout_started_at) {
      const startedAt = Date.parse(application.payment_checkout_started_at)
      if (Number.isFinite(startedAt) && Date.now() - startedAt < 5 * 60 * 1000) {
        return jsonResponse(409, { error: 'Checkout creation is already in progress; refresh this application shortly' })
      }
    }

    const email = application.data?.email
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse(400, { error: 'Application does not have a valid email' })
    }

    let config
    try {
      config = getPaystackConfig()
    } catch (error) {
      console.error('Invalid Paystack configuration:', error.message)
      return jsonResponse(503, { error: 'Checkout is not configured; check Paystack credentials and supported currency' })
    }

    const reference = createMembershipPaymentReference()
    const checkoutStartedAt = new Date().toISOString()
    let reservationQuery = supabase
      .from('team_applications')
      .update({
        payment_status: 'pending',
        payment_reference: reference,
        payment_checkout_url: null,
        payment_checkout_started_at: checkoutStartedAt,
        payment_amount: config.amount,
        payment_currency: config.currency,
      })
      .eq('id', application.id)
      .eq('review_status', 'approved')

    if (application.payment_status === 'not_due') {
      reservationQuery = reservationQuery.eq('payment_status', 'not_due')
    } else {
      reservationQuery = reservationQuery
        .eq('payment_status', 'pending')
        .is('payment_checkout_url', null)
        .eq('payment_reference', application.payment_reference)
        .eq('payment_checkout_started_at', application.payment_checkout_started_at)
    }

    const { data: reserved, error: reserveError } = await reservationQuery
      .select('id')
      .maybeSingle()

    if (reserveError || !reserved) {
      if (reserveError) console.error('Could not reserve checkout:', reserveError.message)
      return jsonResponse(409, { error: 'Another checkout is already being created for this application; refresh the page' })
    }

    let checkout
    try {
      checkout = await initializeMembershipCheckout({
        email,
        applicationId: application.id,
        requestUrl: request.url,
        reference,
      })
    } catch (error) {
      console.error('Could not create Paystack checkout:', error.message)
      await supabase.from('team_applications')
        .update({
          payment_status: 'not_due',
          payment_reference: null,
          payment_checkout_url: null,
          payment_checkout_started_at: null,
          payment_amount: null,
          payment_currency: null,
        })
        .eq('id', application.id)
        .eq('payment_reference', reference)
      return jsonResponse(503, { error: 'Paystack could not create checkout; no payment link was sent' })
    }

    const { data: saved, error: saveError } = await supabase
      .from('team_applications')
      .update({ payment_checkout_url: checkout.authorizationUrl })
      .eq('id', application.id)
      .eq('payment_reference', reference)
      .eq('payment_status', 'pending')
      .select('id')
      .maybeSingle()

    if (saveError || !saved) {
      console.error('Could not save checkout URL:', saveError?.message)
      return jsonResponse(500, { error: 'Checkout URL could not be saved; do not send a link, contact support' })
    }

    return jsonResponse(201, {
      authorizationUrl: checkout.authorizationUrl,
      amount: checkout.amount,
      currency: checkout.currency,
      reference: checkout.reference,
    })
  },
}