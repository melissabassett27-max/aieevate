# AI Elevate

AI Elevate is an Astro site with Supabase authentication and member data, plus serverless intake functions for Vercel and Netlify.

## Local development

Requirements: Node.js 22 and Corepack.

1. Install dependencies with `corepack pnpm install` (the project pins pnpm 10.12.1).
2. Copy `.env.example` to `.env` and fill in the Supabase values below.
3. Run the SQL migrations in `supabase/migrations` in timestamp order.
4. Run `corepack pnpm dev` for the site or `corepack pnpm build` to verify a production build.

`corepack pnpm dev` runs the Astro site for local UI work. To test the Vercel API function locally, use `corepack pnpm dlx vercel dev` from the project root and provide the server environment variables. Netlify local testing is available with `corepack pnpm dlx netlify-cli dev`.

## Supabase configuration

Set these in `.env` for local development and in Netlify's site environment variables for deployment:

- `PUBLIC_SUPABASE_URL`: Project URL.
- `PUBLIC_SUPABASE_ANON_KEY`: Publishable/anon key; safe for browser use.
- `SUPABASE_URL`: Project URL used by the server-side intake function.
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key used only by the Netlify Function. Never expose it with a `PUBLIC_` prefix.
- `PUBLIC_SITE_URL`: Local site URL (`http://localhost:4321`); Netlify supplies its deployed URL during builds.

The migrations create member dashboard tables, auth profiles, and private intake tables. Member sign-up creates an auth user/profile; team applications are stored separately and do not charge a payment. The advertised one-time team membership price is $50, but payment collection and payment-link automation are not implemented yet. Account sellers are offered $30. Operational dashboard data is read-only for members until trusted assignment, bot, and payout workflows are added.

In Supabase Authentication URL Configuration, set the production Site URL and add `http://localhost:4321/auth/callback`, the Vercel production URL, and any preview callback URLs to the redirect allow list.

## Vercel deployment

Import the repository into Vercel and keep the detected Astro settings. The project is statically generated to `dist`; Vercel automatically deploys `api/submit-intake.mjs` as the `/api/submit-intake` function. Set Node.js 22 and add the Supabase environment variables from the section above. For production canonical URLs and sitemap generation, Vercel's production domain is detected automatically.

The public forms use `/api/submit-intake`. That path works on Vercel directly and is rewritten to the Netlify Function in `netlify.toml` if you deploy there instead.

## Netlify deployment

Connect the repository to Netlify. `netlify.toml` sets the build command to `pnpm build`, publishes `dist`, and points Functions at `netlify/functions`. Use Node.js 22 and enable pnpm via Corepack if Netlify does not enable it automatically.

Add the Supabase environment variables above in Netlify's site settings. Use the same project URL for `PUBLIC_SUPABASE_URL` and `SUPABASE_URL`; keep the service role key server-only. Deploy after the migrations and Auth redirect URLs are configured.

The intake function writes applications using the service role key. No Supabase secret belongs in the browser bundle.
