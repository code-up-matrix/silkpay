// Runs route handlers against the configured Neon database; no provider payments.
// node --conditions=react-server --env-file=.env.local --import tsx scripts/database-smoke.ts
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../app/api/[...path]/route";
import { POST as seed } from "../app/api/orders/seed/route";
import { POST as verify } from "../app/api/agent/verify/route";
const origin = process.env.APP_ORIGIN!;
async function call(
  path: string,
  cookie = "",
  data?: unknown,
  expected = 200,
  method = data === undefined ? "GET" : "POST",
) {
  const form = data instanceof FormData;
  const request = new Request(origin + "/api/" + path, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(data !== undefined && !form
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(data === undefined ? {} : { body: form ? data : JSON.stringify(data) }),
  });
  const response =
    path === "orders/seed"
      ? await seed(request)
      : path === "agent/verify"
        ? await verify(request)
        : await (method === "POST" ? POST : method === "DELETE" ? DELETE : GET)(
            request,
            { params: Promise.resolve({ path: path.split("/") }) },
          );
  assert.equal(
    response.status,
    expected,
    path + " returned " + response.status,
  );
  return response;
}
const created = await call(
  "workspace",
  "",
  { company: "SilkPay runtime verification" },
  201,
);
const buyer = created.headers.get("set-cookie")!.split(";")[0];
await call("orders/seed", buyer, {}, 201);
const saved = await (await call("workspace", buyer)).json();
const order = saved.orders[0];
assert.equal(order.number, "SK-8821");
assert.equal(order.milestones[0].amount_cents, 450000);
const invitation = await (
  await call("invitations", buyer, { orderId: order.id })
).json();
const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get(
  "token",
);
const joined = await call("invitations/join", "", { token });
const supplier = joined.headers.get("set-cookie")!.split(";")[0];
const form = new FormData();
form.set(
  "file",
  new File(
    ["FICTIONAL API TEST. No actual shipment."],
    "verification-SAMPLE.txt",
    { type: "text/plain" },
  ),
);
form.set("consent", "true");
const evidence = await (
  await call(
    `milestones/${order.milestones[0].id}/evidence`,
    supplier,
    form,
    201,
  )
).json();
assert.match(
  await (await call(`evidence/${evidence.id}`, buyer)).text(),
  /FICTIONAL API TEST/,
);
await call(`evidence/${evidence.id}`, "", undefined, 401);
await call("invitations/join", "", { token }, 410);
const demo = await (
  await call("agent/verify", "", {
    mode: "demo",
    fixtures: ["inspection", "manifest", "labels"],
  })
).json();
assert.equal(demo.verified, true);
const unchanged = await (await call("workspace", buyer)).json();
assert.equal(unchanged.orders[0].milestones[0].capture_id, null);
assert.equal(unchanged.orders[0].milestones[0].review, null);
await call("session", supplier, undefined, 200, "DELETE");
await call("session", buyer, undefined, 200, "DELETE");
console.log(
  JSON.stringify({
    passed: [
      "Neon runtime CRUD",
      "private workspace",
      "exact blueprint persistence",
      "single-use supplier invitation",
      "private proof upload and download",
      "unauthenticated download blocked",
      "demo cannot update live payment",
      "session revocation",
    ],
    providerPaymentAttempted: false,
  }),
);
