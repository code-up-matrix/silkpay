# SilkPay — PayPal AI Hackathon brief

Build a compact, fully functional Next.js 15 App Router application with TypeScript, Tailwind, Radix/shadcn-style primitives and Lucide icons. Deploy the `main` branch to the existing SilkPay Vercel project.

## Product

- Header: “SilkPay: US ⇄ Asia Trade Settlement Agent”. Corridor: San Francisco, USA ⇄ Shenzhen, CN.
- Preseed PO #SK-8821: 5,000 Units Custom Biodegradable Packaging.
- Buyer: Apex Goods LLC (USA). Supplier: Dongguan Precision Print Ltd (China).
- Active milestone 2: Pre-shipment Quality Inspection, USD 4,500.00.
- Acceptance: tolerance within 0.5 mm; an SGS quality stamp visible in the evidence; master-carton barcode labels visible.
- One compact workspace with three tabs: trade, evidence/inspection, and settlement/receipt.
- Support real PayPal Sandbox approval/capture, private supplier proof, inspection findings with confidence, and a provider-confirmed transaction receipt.

## Design

PayPal deep blue #003087, marine #0070BA, gold #FFC439. Slate-50 canvas, white cards, slate-200 borders. Inter/Geist typography, accessible contrast, calm B2B presentation, responsive layout. No neon, purple gradients, or vague technology claims.

## Implementation and safety

- Explain implementation choices in plain English before implementing them.
- PayPal OAuth and REST calls run only on the server, always at https://api-m.sandbox.paypal.com.
- Implement named create-order and capture-order API routes using Orders v2 CAPTURE intent, plus an agent verification API.
- CAPTURE checkout approval is not a funds hold, escrow deposit, or a separate payout. Label the demo accurately; capture charges the test buyer and pays the configured test seller directly after inspection. Preserve the existing AUTHORIZE path for delayed-capture integrations.
- Keep PayPal client secret, server client ID and database credentials out of browser bundles and Git. Include NEXT_PUBLIC_PAYPAL_CLIENT_ID only as an optional public identifier in the example environment; the redirect implementation does not use it.
- Derive amounts, currency, merchant and milestone identity from the server's stored order. Do not trust client-provided amounts or inspection verdicts.
- The deterministic demo engine may verify bundled, explicitly labeled sample evidence. It must not fabricate an AI result, release a real Sandbox payment from a sample verdict, or claim the authenticity of an SGS certification.
- Real uploaded evidence uses the configured AI provider. On provider failure, return an honest fallback report with payout held unless a safe, explicitly supported deterministic check establishes the required result.
- Retain scoped buyer/supplier sessions, origin checks, idempotency, leases, evidence versions and append-only audit privileges.
- Use the dedicated SilkPay Neon project. The user explicitly approved creating its restricted runtime login and storing the connection in Vercel.

## Delivery

Keep `.env.example`, setup instructions, architecture and demo guidance current. Run meaningful security/payment tests, typecheck and production build. Start the managed local preview with a compatible Next.js dev wrapper. Commit the finished work as `feat: SilkPay MVP complete with PayPal sandbox and AI agent`, push to `origin/main`, deploy the exact commit and verify the public app.
