# SilkPay

**Clear milestones. Verified evidence. Confident trade.**

A Next.js application for US buyers and Asian manufacturers to agree on purchase-order specifications, authorize milestone payments in PayPal Sandbox, share inspection evidence, and settle after a conservative AI review.

**Deployment:** https://silkpay-codeup.vercel.app  
**Repository:** https://github.com/code-up-matrix/silkpay

## What the payment flow actually does

PayPal Orders v2 creates an `AUTHORIZE` order. The buyer approves it on `www.sandbox.paypal.com`; the server verifies the exact merchant, milestone ID, currency and amount, then confirms the authorization. A passing evidence review permits a **final capture** through Payments v2. Automatic capture requires the buyer's explicit opt-in before authorization. Otherwise, the buyer confirms settlement.

An authorization is a temporary payment hold, not a cash deposit into a SilkPay wallet. PayPal documents a maximum 29-day authorization period and a three-day honor period. The app requires a refresh after that honor period. True delayed disbursement requires PayPal's approved partner platform setup; this app does not claim to provide that service or regulated escrow.

- [PayPal authorization and capture](https://developer.paypal.com/docs/checkout/standard/customize/authorization/)
- [PayPal delayed disbursement](https://developer.paypal.com/docs/multiparty/checkout/delayed-disbursement/)

Every PayPal API request is hard-coded to `https://api-m.sandbox.paypal.com`. There is no production-payment switch.

## Included

- Responsive buyer dashboard with order search, filters, totals, milestone vault, evidence library and activity history.
- Purchase orders with 1–5 independently authorized milestones and 1–8 fixed acceptance requirements per milestone. All amounts use integer USD cents.
- Private browser workspaces; opaque HttpOnly, SameSite cookies; only token hashes are stored. Buyer and supplier roles are enforced on the server.
- Single-use supplier invitations, scoped to one order, expiring after seven days.
- Private evidence upload/download with MIME/signature checks, size limits, hashes, version tracking and explicit AI-sharing consent.
- AI comparison through AI SDK / Vercel AI Gateway, including PDFs, photos and text reports. Every requirement needs a supported finding, valid evidence citation and at least 95% model confidence; any concern, missing requirement or uncertainty blocks settlement.
- Database leases prevent concurrent reviews/captures. Evidence changes invalidate the prior review. Stable PayPal idempotency keys protect retries.
- PayPal approval return, capture reconciliation, signed webhooks, pending-payment handling, authorization refresh, and buyer-initiated payment holds.
- Server-enforced workspace scope, origin checks, rate limits, bounded request bodies and append-only audit permissions for the planned runtime role.
- A public **explicitly labeled sample workspace**. It never makes simulated payments look real or substitutes sample AI results for a failed provider call.

## Current deployment state

The code and public sample interface are deployable without credentials. Storage writes fail closed until `DATABASE_URL` exists. PayPal checkout fails closed until all three Sandbox payment variables are present.

The dedicated Neon project and Vercel project exist. Creating the restricted persistent database login was blocked by automatic approval review, so the database connection and production migration remain pending. PayPal Sandbox app credentials and a seller merchant ID have not been supplied. Live PayPal and live AI settlement have **not** been validated; tests use explicit provider stubs and an isolated PostgreSQL engine.

## Stack

Next.js App Router, TypeScript, Tailwind CSS, shadcn-style Radix UI primitives, Lucide, Neon PostgreSQL, AI SDK, PayPal REST APIs and Vercel. Node 24; versions and transitive dependencies are pinned in `package-lock.json`.

The same Next.js server handles the UI and API so credentials and authorization decisions stay off the browser. Neon stores private evidence with the order so there are no public object URLs. This is intentionally limited to small sandbox documents; a larger deployment should use private object storage with scanning and a retention policy.

## Local setup

```bash
npm ci
cp .env.example .env.local
```

Fill the server-only variables in `.env.local`. Never commit it, put credentials into `NEXT_PUBLIC_*`, or paste secrets into source files.

| Variable                | Purpose                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Pooled Neon connection using the restricted application role                                        |
| `DATABASE_URL_UNPOOLED` | Direct owner connection for the local migration command only; do not deploy this owner credential   |
| `APP_ORIGIN`            | Exact allowed origin; local `http://localhost:3000`, production `https://silkpay-codeup.vercel.app` |
| `PAYPAL_CLIENT_ID`      | Sandbox REST application client ID                                                                  |
| `PAYPAL_CLIENT_SECRET`  | Sandbox REST application secret                                                                     |
| `PAYPAL_MERCHANT_ID`    | Merchant ID of the Sandbox business seller authorized for that app                                  |
| `PAYPAL_WEBHOOK_ID`     | ID of the webhook registered on that Sandbox app                                                    |
| `AI_GATEWAY_API_KEY`    | Optional for local AI calls; Vercel runtime OIDC is preferred in deployment                         |
| `AI_MODEL`              | Gateway model ID; default `openai/gpt-6.1-sol`, with image/file and structured-output support       |

The client ID also stays server-side: this app redirects to PayPal approval instead of embedding a browser SDK.

Once linking and environment setup are complete:

```bash
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The migration uses the direct connection and only creates SilkPay's new tables and indexes. It does not reset data. Apply migrations on an isolated Neon branch before production.

### Restricted database role

Create `app_service` only after explicit authorization, using a fresh password stored securely. It must have `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` and no `neon_superuser` membership. Do not reuse the owner login for runtime traffic.

After applying the schema, an administrator can grant the exact table privileges in `db/002_runtime_grants.sql`. These grant audit `SELECT, INSERT` only, so the application cannot update or delete audit history. Configure the pooled URL in Vercel as a sensitive production environment variable. Keep the direct owner URL local to migration administration.

### PayPal and AI setup

1. Create/use a REST app in the PayPal Developer Dashboard's **Sandbox** environment. Use its corresponding Sandbox business seller and a separate Sandbox personal buyer.
2. Set the payment variables as sensitive server environment variables in Vercel. The one configured Sandbox seller receives captures for every order in this deployment; arbitrary merchant onboarding is not implemented.
3. Register `https://silkpay-codeup.vercel.app/api/webhooks/paypal` on the same app for relevant authorization and capture events, and set `PAYPAL_WEBHOOK_ID`. Signature verification sends the complete event to PayPal and rejects non-Sandbox certificate hosts.
4. Ensure Vercel AI Gateway is available to this project, with provider access/credits and a spending limit appropriate to your test. OIDC availability is configuration evidence, not proof a model call will succeed.
5. Redeploy after changing variables. `/api/health` returns configuration booleans only; it does not reveal credentials or claim upstream connectivity.

## Test the complete sandbox story

1. Start a private workspace, create an order and copy its supplier invitation. Use fictional test data.
2. Open the invitation in a separate browser/profile. It grants supplier access once; joining in the buyer browser replaces that session.
3. As buyer, choose **Authorize milestone**, select automatic or manual settlement, and approve with the Sandbox personal buyer at PayPal. Check that the return page shows a confirmed authorization.
4. As supplier, upload a report that directly addresses every requirement. Supported: PDF/PNG/JPEG up to 2 MB; UTF-8 text/CSV up to 32 KB; maximum six files per milestone.
5. Run AI review. Verify the actual findings and citations. Missing or contradictory evidence must stay on hold; no payment is captured on AI errors.
6. For a passing review, confirm capture (or inspect automatic capture if opted in). A `PENDING` response stays pending. Refresh payment status until PayPal independently confirms `COMPLETED`.
7. Verify the capture in the Sandbox seller's account, refresh the app, and inspect the matching amount, capture ID and audit trail. Repeat with an insufficient-evidence report and confirm no capture occurs.

## Validation

```bash
npm run check
```

Tests run against a real isolated PostgreSQL-compatible PGlite engine with **stubbed external PayPal and AI responses**. They exercise private roles, one-time invitations, uploads, order/merchant/amount checks, manual and automatic settlement, stale review invalidation, concurrent capture locking, provider timeouts, pending captures, forged webhooks and idempotent recovery. They do not spend money or contact payment providers.

## Deliberate sandbox limits

- Sessions last seven days and have no email login, recovery, identity verification or organization administration. Add a production identity provider before handling actual customer records.
- One configured test seller; USD only. No FX execution, multi-seller onboarding, real escrow, refunds UI, or regulatory compliance claims.
- AI judges submitted evidence; it cannot establish document authenticity or physical delivery. Model confidence is not a calibrated guarantee. Independent inspection remains necessary for real trade.
- Review quotas: six/hour/workspace and thirty/hour/project. Upload quotas and six-file limits bound processing. No scheduled authorization refresh or background capture retry; buyer refresh and verified webhooks drive reconciliation.
- This release is a sandbox prototype with production hosting, **not a production financial service**. No Devpost entry or judging eligibility is claimed by this repository.

## Layout

`app/api/[...path]/route.ts` contains the server API; `lib/paypal.ts` is the sandbox-only payment adapter; `lib/payments.ts` owns settlement/reconciliation; `lib/review.ts` calls the AI provider; `lib/policy.ts` makes the deterministic acceptance decision. `db/` contains migrations and runtime grants. `components/` contains the responsive workspace and UI primitives.
