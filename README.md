# AI Elevate

AI Elevate is an Astro site with Supabase authentication and member data. The Paystack checkout, application administration, and payment verification endpoints are Vercel Functions.

## Local development

Requirements: Node.js 22 and Corepack.

1. Install dependencies with `corepack pnpm install` (the project pins pnpm 10.12.1).
2. Copy `.env.example` to `.env`; set Supabase values, an admin email, and a Paystack test secret.
3. Run the SQL migrations in `supabase/migrations` in timestamp order, including `20261004120000_paystack_memberships.sql`.
4. Run `corepack pnpm dev` for the site or `corepack pnpm build` to verify a production build.

`corepack pnpm dev` runs the Astro UI. To test Vercel API functions, use `corepack pnpm dlx vercel dev` from the project root and provide the server environment variables.

## Supabase configuration

Set these in `.env` for local development and in Vercel's environment variables for payment deployment:

- `PUBLIC_SUPABASE_URL`: Project URL.
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Publishable key; safe for browser use. The client retains a legacy anon-key fallback.
- `SUPABASE_URL`: Project URL used by the server-side intake function.
- `SUPABASE_SERVICE_ROLE_KEY`: Service-role key used only by server endpoints. Never expose it with a `PUBLIC_` prefix.
- `PUBLIC_SITE_URL`: Local site URL (`http://localhost:4321`).
- `ADMIN_EMAILS`: Comma-separated Supabase Auth email addresses allowed to review membership applications at `/admin`.
- `PAYSTACK_SECRET_KEY`: Test secret (`sk_test_…`) for local/Preview; use the live secret only in Vercel Production when ready.
- `PAYSTACK_CURRENCY`: Paystack-supported currency for this account. The configured USD price is 5000 cents ($50); verify that USD checkout is enabled for your Paystack account before deployment.
- `PAYSTACK_MEMBERSHIP_AMOUNT_SUBUNIT`: Amount in the currency's smallest unit; `5000` means USD 50.00.

The current production checkout amount is USD 50. Confirm USD transactions are enabled for your Paystack account. For an isolated Vercel Preview test, use a Paystack test secret and set `PAYSTACK_MEMBERSHIP_AMOUNT_SUBUNIT=100` to test a $1 transaction. The customer will see the amount Paystack actually charges in its checkout. Never expose the override as a customer-editable control. Live keys are rejected unless currency is USD and amount is 5000 cents. Never send API secrets in chat.

The migrations create member dashboard tables, auth profiles, private intake tables, and paid-membership state. Team applications are reviewed manually at `/admin`; an allowlisted admin creates a hosted checkout link and sends it to the approved applicant. The Vercel endpoints verify both the Paystack callback and signed webhook before marking membership active. Account sellers are offered $30, but seller payouts remain manual. Account verification, task evaluation, assignments, and team payouts are not automated.

In Supabase Authentication URL Configuration, set the production Site URL and add `http://localhost:4321/auth/callback`, the Vercel production URL, and any preview callback URLs to the redirect allow list.

## Vercel deployment

Import the repository into Vercel and keep the detected Astro settings. The project is statically generated to `dist`; Vercel automatically deploys the files in `api/` as serverless functions. Set Node.js 22. In Preview, set a test Paystack secret and optionally set the amount subunit to `100` for a $1 test. In Production, set the live secret, `PAYSTACK_CURRENCY=USD`, and `PAYSTACK_MEMBERSHIP_AMOUNT_SUBUNIT=5000`; server code rejects test keys and any live amount other than USD 50. Add `ADMIN_EMAILS` as a comma-separated allowlist of Supabase Auth emails. The admin must first create/confirm that Supabase Auth account, then sign in at `/admin`. For production canonical URLs and sitemap generation, Vercel's production domain is detected automatically.

Public forms use `/api/submit-intake`. Configure Paystack's webhook URL as `https://YOUR-PRODUCTION-DOMAIN/api/paystack-webhook` and enable the `charge.success` event. Membership checkout is only enabled through Vercel; the legacy Netlify deployment does not include the payment/admin routes.

## Netlify deployment

Connect the repository to Netlify only if you need the static site and intake forms without Paystack membership checkout. `netlify.toml` sets the build command to `pnpm build`, publishes `dist`, and points Functions at `netlify/functions`.

Add the Supabase environment variables above in Netlify's site settings. Use the same project URL for `PUBLIC_SUPABASE_URL` and `SUPABASE_URL`; keep the service-role key server-only. The `/admin` Paystack workflow is Vercel-only.

The intake function writes applications using the service role key. No Supabase secret belongs in the browser bundle.
