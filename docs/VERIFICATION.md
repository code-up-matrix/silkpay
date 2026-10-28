# SilkPay verification — 28 October 2026

Story: a buyer defines a purchase order, authorizes a PayPal Sandbox milestone, an invited supplier uploads evidence, and a passing AI review permits settlement.

| Boundary                        | Result                                                       | Evidence                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and production build | Passed                                                       | `npm run check`: strict typecheck and Next.js production compilation                                                                                                                  |
| Backend behavior                | Passed in isolated tests                                     | 48 tests; PostgreSQL-compatible PGlite; explicitly stubbed PayPal and AI responses                                                                                                    |
| Public deployment               | Passed                                                       | Vercel production deployment; `/` and `/api/health` return HTTP 200                                                                                                                   |
| Workspace read                  | Passed for sample mode                                       | `/api/workspace` returns `mode: sample`, five labeled sample orders                                                                                                                   |
| Browser interactions            | Passed for sample mode                                       | Search for Minghua returns one order; Completed filter returns the linen order; order details show specs and evidence; sample AI action opens setup instead of claiming a real review |
| Browser accessibility           | Fixed                                                        | Dialogs without a separate description explicitly omit `aria-describedby`; focus management uses Radix                                                                                |
| Production storage writes       | Blocked, fails closed                                        | HTTP 503 with an explicit storage setup message; restricted Neon login creation needs approval                                                                                        |
| PayPal authorization/capture    | Implementation tested with provider stubs; live test pending | Sandbox app credentials, merchant ID, webhook ID and buyer approval are still required                                                                                                |
| AI provider                     | Configured authentication only                               | Runtime OIDC detected; a successful live model review has not been verified                                                                                                           |
| Mobile layout                   | Implemented, device test pending                             | Responsive CSS includes navigation drawer, two-column stats, stacked milestone detail and horizontal table scrolling                                                                  |

## Financial invariants exercised

- Supplier cannot access another order or issue buyer payment instructions.
- Buyer workspaces cannot access each other's orders or evidence.
- Invitations expire and can be consumed once. Session tokens are stored as hashes.
- Capture requires the exact stored merchant, milestone, amount and USD currency.
- Every specification needs a high-confidence, validly cited finding. Unknown, missing, conflicting or low-confidence evidence fails the deterministic policy.
- Updated evidence clears an earlier passing review. A replaced review lease cannot commit stale results.
- A buyer's changed automatic-settlement choice is retained when resuming payment approval. Automatic capture defaults off in the UI.
- Concurrent settlement attempts produce one final capture. Uncertain provider responses remain pending; retries reuse the same idempotency key.
- Interrupted capture recovery waits for the payment lease to expire. Active leases exclude review, refresh and capture races.
- An authorization older than its honor period must be refreshed; capture then uses the new authorization reference.
- Webhook signatures and certificate hosts are checked. The complete original event is sent to PayPal, and duplicate verified events are recorded once.

## Remaining activation work

Approve the restricted `app_service` role in SilkPay's dedicated Neon project, apply the reviewed schema and table grants, store its pooled connection as a sensitive Vercel variable, and supply the PayPal Sandbox app configuration. Then execute the real buyer/supplier/PayPal/AI flow described in the README. No real payment or successful live settlement is claimed by these tests.

The public dashboard screenshot is in `docs/dashboard.jpg`; every amount and review shown there is sample data.
