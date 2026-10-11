# AI Elevate

AI Elevate is an Astro site with Supabase authentication and member data. Membership checkout is created as a fixed-amount AllPays payment link by the Vercel serverless functions; payment confirmation is verified server-side against AllPays using the private secret returned for that specific link.

## Local development

Requirements: Node.js 22 and Corepack.

1. Install dependencies with `corepack pnpm install` (the project pins pnpm 10.12.1).
2. Copy `.env.example` to `.env` and set the Supabase values and an admin email.
3. Run all SQL migrations in `supabase/migrations` in timestamp order. The Paystack-named migration is historical schema setup; the later AllPays migration adds the current provider fields.
4. Run `corepack pnpm dev` for the site, `corepack pnpm test` for the AllPays integration tests, or `corepack pnpm build` to verify a production build.

`corepack pnpm dev` runs the Astro UI. To test Vercel API functions locally, use `corepack pnpm dlx vercel dev` from the project root and provide the server environment variables.

## Supabase configuration

Set these in `.env` for local development and in Vercel's environment variables:

- `PUBLIC_SUPABASE_URL`: Project URL.
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Publishable key; safe for browser use. The client retains a legacy anon-key fallback.
- `SUPABASE_URL`: Project URL used by server functions.
- `SUPABASE_SERVICE_ROLE_KEY`: Service-role key used only by server endpoints. Never expose it with a `PUBLIC_` prefix.
- `PUBLIC_SITE_URL`: Local site URL (`http://localhost:4321`).
- `ADMIN_EMAILS`: Comma-separated Supabase Auth email addresses allowed to review membership applications at `/admin`.
- `ALLPAYS_POLYGON_ADDRESS`: Polygon address that receives settlement.
- `ALLPAYS_CURRENCY`: Set to `USD`.
- `ALLPAYS_MEMBERSHIP_AMOUNT`: Starting amount for the customer-editable link; defaults to `50` USD. Must be a positive whole number.
- `ALLPAYS_FEE_PAYER`: `customer` or `merchant`.

AllPays does not require a static API key for payment-link creation. It returns a private secret for each link; the app stores that secret server-side and sends it only to AllPays' payment-link verification endpoint. Never put payment secrets in browser code, source control, screenshots, or chat. If a link secret is exposed, revoke that link in AllPays and create a replacement.

AllPays links are created with `amount_editable=true` and a starting amount of USD 50 by default. Set `ALLPAYS_MEMBERSHIP_AMOUNT` to a different positive whole-number USD amount when intentionally testing at another price. Membership activates only when the completed attempt amount exactly matches the configured starting amount, the email matches the application, and AllPays reports exact checkout/merchant amount matches. A customer-edited amount that differs from the configured invoice will not activate membership. The payment return page asks the server to verify the attempt; query-string values alone are never treated as proof of payment. The admin sends the generated hosted link to the approved applicant. Account sellers are offered $30, but seller payouts remain manual. Account verification, task evaluation, assignments, and team payouts are not automated.

AllPays documents no sandbox and a minimum amount above 10. Although the app can be configured for a USD 1 test amount, AllPays may reject it under that minimum; if accepted, it is a real charge. Keep the Polygon address unset in Preview unless you intentionally accept a real payment. Run `corepack pnpm test` to test link creation and payment validation locally; provider requests in the test suite are mocked. Restore `ALLPAYS_MEMBERSHIP_AMOUNT=50` after testing.

In Supabase Authentication URL Configuration, set the production Site URL and add `http://localhost:4321/auth/callback`, the Vercel production URL, and any preview callback URLs to the redirect allow list.

## Vercel deployment

Import the repository into Vercel and keep the detected Astro settings. The project is statically generated to `dist`; Vercel deploys the files in `api/` as serverless functions. Set Node.js 22, the Supabase values above, `ADMIN_EMAILS`, and the AllPays settings. Configure Production with a valid Polygon settlement address, `ALLPAYS_CURRENCY=USD`, `ALLPAYS_MEMBERSHIP_AMOUNT=50`, and the selected fee payer. The admin must first create/confirm the allowlisted Supabase Auth account, then sign in at `/admin`.

AllPays returns customers to `/api/allpays-callback`, which verifies the attempt with the per-link secret and redirects the browser to `/payment/return`. No Paystack webhook or static API key is used. The legacy Netlify deployment provides the static site and intake forms but does not include the payment/admin API routes.

## Netlify deployment

Connect the repository to Netlify only if you need the static site and intake forms without membership checkout. `netlify.toml` sets the build command to `pnpm build`, publishes `dist`, and points Functions at `netlify/functions`.

Add the Supabase environment variables above in Netlify's site settings. Use the same project URL for `PUBLIC_SUPABASE_URL` and `SUPABASE_URL`; keep the service-role key server-only. The `/admin` membership workflow is Vercel-only.

The intake function writes applications using the service role key. No Supabase secret belongs in the browser bundle.
