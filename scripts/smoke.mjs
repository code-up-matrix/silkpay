// Writes fictional test data only. No PayPal or AI provider calls are made.
// Run explicitly: SILKPAY_BASE_URL=https://your-host node scripts/smoke.mjs
import assert from "node:assert/strict";
const base = process.env.SILKPAY_BASE_URL;
if (!base)
  throw new Error("Set SILKPAY_BASE_URL to the deployment you intend to test.");
const url = new URL(base);
if (!["http:", "https:"].includes(url.protocol))
  throw new Error("Use an HTTP(S) app origin.");
async function call(
  path,
  {
    data,
    cookie = "",
    method = data === undefined ? "GET" : "POST",
    status = 200,
  } = {},
) {
  const multipart = data instanceof FormData;
  const r = await fetch(url.origin + "/api/" + path, {
    method,
    headers: {
      Origin: process.env.SILKPAY_ORIGIN || url.origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: multipart ? data : JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(45000),
  });
  assert.equal(
    r.status,
    status,
    `${path}: expected ${status}, received ${r.status}`,
  );
  return r;
}
const health = await (await call("health")).json();
assert.equal(health.database, true);
const created = await call("workspace", {
  data: { company: "SilkPay verification fixture" },
  status: 201,
});
const buyer = created.headers.get("set-cookie").split(";")[0];
await call("orders/seed", { data: {}, cookie: buyer, status: 201 });
const workspace = await (await call("workspace", { cookie: buyer })).json();
const order = workspace.orders[0],
  milestone = order.milestones[0];
assert.equal(order.number, "SK-8821");
assert.equal(milestone.amount_cents, 450000);
const invitation = await (
  await call("invitations", { data: { orderId: order.id }, cookie: buyer })
).json();
const invitationToken = new URLSearchParams(
  new URL(invitation.url).hash.slice(1),
).get("token");
const joined = await call("invitations/join", {
  data: { token: invitationToken },
});
const supplier = joined.headers.get("set-cookie").split(";")[0];
const form = new FormData();
form.set(
  "file",
  new File(
    ["FICTIONAL API TEST. No actual fulfillment evidence."],
    "api-smoke-SAMPLE.txt",
    { type: "text/plain" },
  ),
);
form.set("consent", "true");
const uploaded = await (
  await call(`milestones/${milestone.id}/evidence`, {
    data: form,
    cookie: supplier,
    status: 201,
  })
).json();
const proof = await call(`evidence/${uploaded.id}`, { cookie: buyer });
assert.match(await proof.text(), /FICTIONAL API TEST/);
await call(`evidence/${uploaded.id}`, { status: 401 });
await call("invitations/join", {
  data: { token: invitationToken },
  status: 410,
});
const demo = await (
  await call("agent/verify", {
    data: { mode: "demo", fixtures: ["inspection", "manifest", "labels"] },
  })
).json();
assert.equal(demo.verified, true);
assert.equal(demo.engine, "deterministic-demo");
const fresh = await (await call("workspace", { cookie: buyer })).json();
assert.equal(fresh.orders[0].milestones[0].review, null);
assert.equal(fresh.orders[0].milestones[0].capture_id, null);
await call("session", { method: "DELETE", cookie: supplier });
await call("session", { method: "DELETE", cookie: buyer });
console.log(
  JSON.stringify({
    origin: url.origin,
    passed: [
      "private workspace",
      "blueprint persistence",
      "single-use supplier invitation",
      "private evidence upload/download",
      "unauthenticated download rejection",
      "demo/payment isolation",
      "session revocation",
    ],
    payPalConfigured: health.payments,
    providerPaymentAttempted: false,
  }),
);
