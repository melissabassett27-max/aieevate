import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAllPaysConfig,
  getAllPaysPaymentAttempt,
  initializeMembershipCheckout,
  isSuccessfulMembershipPayment,
} from '../src/lib/server/payments.mjs'

const polygonAddress = '0x1234567890123456789012345678901234567890'

async function withEnvironment(values, callback) {
  const previous = new Map()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await callback()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('AllPays defaults to USD 50 and accepts an explicit testing amount', async () => {
  await withEnvironment({
    ALLPAYS_POLYGON_ADDRESS: polygonAddress,
    ALLPAYS_CURRENCY: undefined,
    ALLPAYS_MEMBERSHIP_AMOUNT: undefined,
    ALLPAYS_FEE_PAYER: 'merchant',
    VERCEL_ENV: 'preview',
  }, () => {
    assert.deepEqual(getAllPaysConfig(), {
      polygonAddress,
      currency: 'USD',
      amount: 50,
      feePayer: 'merchant',
    })

    process.env.ALLPAYS_MEMBERSHIP_AMOUNT = '1'
    assert.equal(getAllPaysConfig().amount, 1)
    process.env.ALLPAYS_MEMBERSHIP_AMOUNT = '1.5'
    assert.throws(() => getAllPaysConfig(), /positive whole number/)
    process.env.ALLPAYS_MEMBERSHIP_AMOUNT = '50'
    process.env.ALLPAYS_CURRENCY = 'EUR'
    assert.throws(() => getAllPaysConfig(), /currency must be USD/)
  })
})

test('AllPays link request uses editable USD pricing and no static API key', async () => {
  const originalFetch = globalThis.fetch
  let requestBody
  let requestHeaders
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    requestHeaders = options.headers
    return Response.json({
      success: true,
      data: {
        payment_id: 'payment-id',
        payment_secret: 'private-per-link-secret',
        hosted_payment_url: 'https://allpays.co/pay?payment_id=payment-id',
      },
    })
  }

  try {
    await withEnvironment({
      ALLPAYS_POLYGON_ADDRESS: polygonAddress,
      ALLPAYS_CURRENCY: 'USD',
      ALLPAYS_MEMBERSHIP_AMOUNT: '50',
      ALLPAYS_FEE_PAYER: 'merchant',
      VERCEL_ENV: 'preview',
    }, async () => {
      const checkout = await initializeMembershipCheckout({
        requestUrl: 'https://members.example.test/admin',
        reference: 'AIEMEM_0123456789abcdef0123456789abcdef',
      })

      assert.equal(requestBody.amount, 50)
      assert.equal(requestBody.currency, 'USD')
      assert.equal(requestBody.amount_editable, true)
      assert.equal(requestBody.fee_payer, 'merchant')
      assert.equal(new URL(requestBody.callback_url).pathname, '/api/allpays-callback')
      assert.equal(requestHeaders.Authorization, undefined)
      assert.equal(checkout.paymentSecret, 'private-per-link-secret')
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AllPays membership validation requires completed exact invoice, currency, email, and amount matches', () => {
  const application = {
    payment_amount: 50,
    payment_currency: 'USD',
    data: { email: 'member@example.test' },
  }
  const attempt = {
    status: 'completed',
    amount: '50.00',
    currency: 'USD',
    email: 'MEMBER@example.test',
    amount_match: { checkout: 'exact', merchant: 'exact' },
  }

  assert.equal(isSuccessfulMembershipPayment(attempt, application), true)
  assert.equal(isSuccessfulMembershipPayment({ ...attempt, amount: '49.99' }, application), false)
  assert.equal(isSuccessfulMembershipPayment({ ...attempt, currency: 'EUR' }, application), false)
  assert.equal(isSuccessfulMembershipPayment({ ...attempt, email: 'other@example.test' }, application), false)
  assert.equal(isSuccessfulMembershipPayment({
    ...attempt,
    amount_match: { checkout: 'exact', merchant: 'under' },
  }, application), false)
})

test('AllPays attempt lookup uses the per-link secret and selects the requested attempt hash', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl
  let requestHeaders
  globalThis.fetch = async (url, options) => {
    requestUrl = url
    requestHeaders = options.headers
    return Response.json({
      success: true,
      data: {
        payment: { payment_id: 'payment-id' },
        attempts: [
          { pay_request_hash: 'other-attempt', status: 'completed' },
          { pay_request_hash: 'selected-attempt', status: 'timed_out' },
        ],
      },
    })
  }

  try {
    const attempt = await getAllPaysPaymentAttempt({
      paymentId: 'payment-id',
      paymentSecret: 'private-per-link-secret',
      attemptHash: 'selected-attempt',
    })
    assert.equal(requestUrl, 'https://api.allpays.co/v1/payments/payment-id')
    assert.equal(requestHeaders['X-Payment-Secret'], 'private-per-link-secret')
    assert.equal(attempt.status, 'timed_out')
  } finally {
    globalThis.fetch = originalFetch
  }
})
