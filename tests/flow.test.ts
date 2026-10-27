import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type {
  Milestone,
  PurchaseOrder,
  Review,
  WorkspacePayload,
} from "@/lib/types";
const state = vi.hoisted(() => ({
  db: null as unknown as import("@electric-sql/pglite").PGlite,
  review: "pass",
  reviewHook: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/db", () => ({
  query: async (sql: string, params: unknown[] = []) => {
    const result = await state.db.query(sql, params);
    return result.rows;
  },
}));
vi.mock("@/lib/review", () => ({
  aiConfigured: async () => true,
  reviewEvidence: async (
    order: PurchaseOrder,
    m: Milestone,
  ): Promise<Review> => {
    if (state.review === "error") throw new Error("AI unavailable");
    if (state.reviewHook) await state.reviewHook();
    const files = await state.db.query<{ id: string }>(
      "SELECT id FROM evidence WHERE milestone_id=$1",
      [m.id],
    );
    return {
      summary:
        state.review === "pass"
          ? "Submitted report satisfies the measured requirements."
          : "Quantity is not established.",
      findings: m.specs.map((s) => ({
        specId: s.id,
        outcome: state.review === "pass" ? "met" : "uncertain",
        confidence: state.review === "pass" ? 0.98 : 0.6,
        explanation:
          "Test provider response citing the uploaded inspection report.",
        evidenceIds: files.rows.map((f) => f.id),
      })),
      concerns: [],
      passed: state.review === "pass",
      model: "TEST STUB — not a live AI result",
      generatedAt: new Date().toISOString(),
      evidenceVersion: m.evidence_version,
    };
  },
}));
import { GET, POST, DELETE } from "@/app/api/[...path]/route";
import { validateOrder, PAYPAL_BASE, requestId } from "@/lib/paypal";
import type { ProviderOrder } from "@/lib/paypal";
const base = "https://silkpay.test";
let provider: ProviderOrder,
  providerCalls: {
    url: string;
    method: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }[],
  captureMode: string,
  webhookMode: string;
async function request(
  path: string,
  method = "GET",
  cookie = "",
  data?: unknown,
  extra: Record<string, string> = {},
) {
  const multipart = data instanceof FormData;
  const req = new Request(base + "/api/" + path, {
    method,
    headers: {
      origin: base,
      ...(cookie ? { cookie } : {}),
      ...(data !== undefined && !multipart
        ? { "content-type": "application/json" }
        : {}),
      ...extra,
    },
    ...(data !== undefined
      ? { body: multipart ? data : JSON.stringify(data) }
      : {}),
  });
  return (method === "POST" ? POST : method === "DELETE" ? DELETE : GET)(req, {
    params: Promise.resolve({ path: path.split("/") }),
  });
}
async function buyer(company = "Test buyer") {
  const r = await request("workspace", "POST", "", { company });
  expect(r.status).toBe(201);
  return r.headers.get("set-cookie")!.split(";")[0];
}
async function workspace(cookie: string) {
  const r = await request("workspace", "GET", cookie);
  expect(r.status).toBe(200);
  return r.json() as Promise<WorkspacePayload>;
}
async function order(cookie: string) {
  const r = await request("orders", "POST", cookie, {
    product: "Cotton test shirt",
    supplier: "Sandbox test manufacturer",
    country: "China",
    quantity: 100,
    milestones: [
      {
        title: "Final inspection",
        amount_cents: 10000,
        due_date: "2026-11-10",
        requirements: ["The inspection report confirms all 100 ordered units."],
      },
    ],
  });
  expect(r.status).toBe(201);
  return (await workspace(cookie)).orders[0];
}
async function supplier(cookie: string, o: PurchaseOrder) {
  const invite = await request("invitations", "POST", cookie, {
    orderId: o.id,
  });
  const link = (await invite.json()).url;
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  const r = await request("invitations/join", "POST", "", { token });
  expect(r.status).toBe(200);
  return { cookie: r.headers.get("set-cookie")!.split(";")[0], token };
}
async function upload(
  cookie: string,
  m: Milestone,
  text = "Inspection: 100 units counted, zero critical defects.",
) {
  const form = new FormData();
  form.set("file", new File([text], "inspection.txt", { type: "text/plain" }));
  form.set("note", "Signed test inspection report.");
  form.set("consent", "true");
  return request(`milestones/${m.id}/evidence`, "POST", cookie, form);
}
async function fund(cookie: string, m: Milestone, autoSettle = false) {
  const r = await request(`milestones/${m.id}/fund`, "POST", cookie, {
    autoSettle,
    accepted: true,
  });
  expect(r.status).toBe(200);
  provider.status = "APPROVED";
  const a = await request(`milestones/${m.id}/authorize`, "POST", cookie, {
    orderId: provider.id,
  });
  expect(a.status).toBe(200);
  return a;
}
async function setup(autoSettle = false) {
  const b = await buyer(),
    o = await order(b),
    s = await supplier(b, o),
    m = o.milestones[0];
  await fund(b, m, autoSettle);
  expect((await upload(s.cookie, m)).status).toBe(201);
  return { b, o, s, m };
}
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(
    await readFile(new URL("../db/001_silkpay.sql", import.meta.url), "utf8"),
  );
});
afterAll(async () => {
  await state.db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  await state.db.exec(
    "TRUNCATE workspaces,purchase_orders,sessions,invitations,milestones,evidence,audit_events,rate_limits,webhook_receipts CASCADE",
  );
  vi.stubEnv("DATABASE_URL", "postgres://test-placeholder-not-a-real-server");
  vi.stubEnv("APP_ORIGIN", base);
  vi.stubEnv("PAYPAL_CLIENT_ID", "test-client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-secret");
  vi.stubEnv("PAYPAL_MERCHANT_ID", "TESTMERCHANT1");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "TESTWEBHOOK1");
  state.review = "pass";
  state.reviewHook = null;
  captureMode = "COMPLETED";
  webhookMode = "SUCCESS";
  providerCalls = [];
  provider = {
    id: "TESTORDER0001",
    intent: "AUTHORIZE",
    status: "CREATED",
    purchase_units: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input),
        method = init?.method || "GET",
        body =
          typeof init?.body === "string" && init.body.startsWith("{")
            ? JSON.parse(init.body)
            : {};
      providerCalls.push({
        url,
        method,
        body,
        headers: (init?.headers as Record<string, string>) || {},
      });
      expect(url.startsWith(PAYPAL_BASE + "/")).toBe(true);
      if (url.endsWith("/v1/oauth2/token"))
        return Response.json({
          access_token: "test-access-token",
          expires_in: 1,
        });
      if (url.endsWith("/v1/notifications/verify-webhook-signature"))
        return Response.json({ verification_status: webhookMode });
      if (url.endsWith("/v2/checkout/orders") && method === "POST") {
        provider.purchase_units = body.purchase_units;
        return Response.json({
          ...provider,
          links: [
            {
              rel: "payer-action",
              href:
                "https://www.sandbox.paypal.com/checkoutnow?token=" +
                provider.id,
            },
          ],
        });
      }
      if (url.endsWith("/authorize")) {
        provider.status = "COMPLETED";
        provider.purchase_units[0].payments = {
          authorizations: [
            {
              id: "TESTAUTH0001",
              status: "CREATED",
              amount: { currency_code: "USD", value: "100.00" },
              expiration_time: new Date(
                Date.now() + 29 * 86400000,
              ).toISOString(),
            },
          ],
        };
        return Response.json(provider);
      }
      if (url.endsWith("/capture")) {
        if (captureMode === "NETWORK_ERROR")
          throw new Error("Simulated connection lost");
        const capture = {
          id: "TESTCAPTURE01",
          status: captureMode,
          amount: { currency_code: "USD", value: "100.00" },
        };
        provider.purchase_units[0].payments!.captures = [capture];
        return Response.json(capture);
      }
      if (url.endsWith("/TESTORDER0001") && method === "GET")
        return Response.json(provider);
      throw new Error("Unexpected provider request: " + url);
    }),
  );
});
describe("private workspace and supplier boundaries", () => {
  it("shows explicit public samples and no real workspace data", async () => {
    const b = await buyer();
    await order(b);
    const r = await request("workspace");
    const data = await r.json();
    expect(data.mode).toBe("sample");
    expect(
      data.orders.every((o: PurchaseOrder) => o.id.startsWith("sample")),
    ).toBe(true);
  });
  it("uses HttpOnly sessions and stores only hashed bearer tokens", async () => {
    const r = await request("workspace", "POST", "", {
      company: "Example buyer",
    });
    expect(r.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Lax; Path=/",
    );
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const rows = await state.db.query<{ token_hash: string }>(
      "SELECT token_hash FROM sessions",
    );
    expect(rows.rows[0].token_hash).not.toContain(cookie.split("=")[1]);
    expect(rows.rows[0].token_hash).toHaveLength(64);
  });
  it("rejects unauthenticated writes and foreign origins", async () => {
    expect((await request("orders", "POST", "", {})).status).toBe(401);
    expect(
      (
        await request(
          "workspace",
          "POST",
          "",
          { company: "Bad origin" },
          { origin: "https://evil.test" },
        )
      ).status,
    ).toBe(403);
  });
  it("isolates buyers and scopes a supplier to the invited order", async () => {
    const b = await buyer(),
      o = await order(b),
      other = await buyer("Other buyer"),
      otherOrder = await order(other),
      s = await supplier(b, o);
    expect((await workspace(s.cookie)).orders.map((o) => o.id)).toEqual([o.id]);
    expect(
      (
        await request(`milestones/${o.milestones[0].id}/fund`, "POST", other, {
          accepted: true,
          autoSettle: false,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `milestones/${otherOrder.milestones[0].id}/review`,
          "POST",
          s.cookie,
          {},
        )
      ).status,
    ).toBe(404);
    expect((await request("orders", "POST", s.cookie, {})).status).toBe(403);
    expect(
      (
        await request(
          `milestones/${o.milestones[0].id}/fund`,
          "POST",
          s.cookie,
          { accepted: true, autoSettle: false },
        )
      ).status,
    ).toBe(403);
  });
  it("enforces single-use and expired invitations", async () => {
    const b = await buyer(),
      o = await order(b),
      s = await supplier(b, o);
    expect(
      (await request("invitations/join", "POST", "", { token: s.token }))
        .status,
    ).toBe(410);
    const r = await request("invitations", "POST", b, { orderId: o.id });
    const token = new URLSearchParams(
      new URL((await r.json()).url).hash.slice(1),
    ).get("token");
    await state.db.exec(
      "UPDATE invitations SET expires_at=now()-interval '1 minute'",
    );
    expect(
      (await request("invitations/join", "POST", "", { token })).status,
    ).toBe(410);
  });
  it("allows only invited suppliers to upload and scopes private downloads", async () => {
    const b = await buyer(),
      o = await order(b),
      m = o.milestones[0],
      s = await supplier(b, o);
    expect((await upload(b, m)).status).toBe(403);
    const r = await upload(s.cookie, m);
    expect(r.status).toBe(201);
    const id = (await r.json()).id,
      download = await request("evidence/" + id, "GET", b);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(await download.text()).toContain("100 units");
    const other = await buyer("Other buyer");
    expect((await request("evidence/" + id, "GET", other)).status).toBe(404);
  });
  it("rejects fake binary files and unconsented uploads", async () => {
    const b = await buyer(),
      o = await order(b),
      s = await supplier(b, o),
      m = o.milestones[0];
    const f = new FormData();
    f.set(
      "file",
      new File(["not a real PNG"], "proof.png", { type: "image/png" }),
    );
    f.set("consent", "true");
    expect(
      (await request(`milestones/${m.id}/evidence`, "POST", s.cookie, f))
        .status,
    ).toBe(400);
    f.set("consent", "false");
    expect(
      (await request(`milestones/${m.id}/evidence`, "POST", s.cookie, f))
        .status,
    ).toBe(400);
  });
  it("revokes a session on leaving", async () => {
    const b = await buyer();
    expect((await request("session", "DELETE", b)).status).toBe(200);
    expect((await request("workspace", "GET", b)).status).toBe(401);
  });
});
describe("authorization → evidence → verification → settlement", () => {
  it("completes manual settlement with exactly one confirmed final capture", async () => {
    const { b, s, m } = await setup();
    expect(
      (await request(`milestones/${m.id}/review`, "POST", s.cookie, {})).status,
    ).toBe(200);
    expect((await workspace(b)).orders[0].milestones[0].status).toBe(
      "verified",
    );
    expect(providerCalls.some((c) => c.url.endsWith("/capture"))).toBe(false);
    expect(
      (await request(`milestones/${m.id}/settle`, "POST", b, {})).status,
    ).toBe(200);
    const saved = (await workspace(b)).orders[0];
    expect(saved.milestones[0].status).toBe("settled");
    expect(saved.milestones[0].capture_id).toBe("TESTCAPTURE01");
    expect(saved.activity.some((a) => a.event === "Milestone settled")).toBe(
      true,
    );
    const captures = providerCalls.filter((c) => c.url.endsWith("/capture"));
    expect(captures).toHaveLength(1);
    expect(captures[0].body).toMatchObject({
      final_capture: true,
      amount: { currency_code: "USD", value: "100.00" },
    });
    expect(
      (await request(`milestones/${m.id}/settle`, "POST", b, {})).status,
    ).toBe(409);
    expect(
      providerCalls.filter((c) => c.url.endsWith("/capture")),
    ).toHaveLength(1);
  });
  it("automatically settles only after the buyer opts in", async () => {
    const { b, s, m } = await setup(true);
    const r = await request(`milestones/${m.id}/review`, "POST", s.cookie, {});
    expect(r.status).toBe(200);
    expect((await workspace(b)).orders[0].milestones[0].status).toBe("settled");
  });
  it("rejects settlement before review and holds uncertain or failed AI reviews", async () => {
    const { b, s, m } = await setup(true);
    expect(
      (await request(`milestones/${m.id}/settle`, "POST", b, {})).status,
    ).toBe(409);
    state.review = "uncertain";
    expect(
      (await request(`milestones/${m.id}/review`, "POST", s.cookie, {})).status,
    ).toBe(200);
    expect((await workspace(b)).orders[0].milestones[0].status).toBe(
      "changes_requested",
    );
    state.review = "error";
    expect(
      (await request(`milestones/${m.id}/review`, "POST", s.cookie, {})).status,
    ).toBe(502);
    expect(providerCalls.some((c) => c.url.endsWith("/capture"))).toBe(false);
  });
  it("invalidates a passing review when new evidence arrives", async () => {
    const { b, s, m } = await setup();
    await request(`milestones/${m.id}/review`, "POST", s.cookie, {});
    expect(
      (
        await upload(
          s.cookie,
          m,
          "Updated inspection: quantity not established.",
        )
      ).status,
    ).toBe(201);
    const latest = (await workspace(b)).orders[0].milestones[0];
    expect(latest.status).toBe("funded");
    expect(latest.review).toBeNull();
    expect(latest.evidence_version).toBe(2);
    expect(
      (await request(`milestones/${m.id}/settle`, "POST", b, {})).status,
    ).toBe(409);
  });
  it("discards a stale review whose lease was replaced", async () => {
    const { b, s, m } = await setup(true);
    state.reviewHook = async () => {
      await state.db.query(
        "UPDATE milestones SET review_lock=gen_random_uuid() WHERE id=$1",
        [m.id],
      );
    };
    expect(
      (await request(`milestones/${m.id}/review`, "POST", s.cookie, {})).status,
    ).toBe(409);
    expect((await workspace(b)).orders[0].milestones[0].review).toBeNull();
    expect(providerCalls.some((c) => c.url.endsWith("/capture"))).toBe(false);
  });
  it("does not permit proof changes while review is running", async () => {
    const { b, s, m } = await setup();
    await state.db.query(
      "UPDATE milestones SET status='reviewing',lock_until=now()+interval '2 minutes' WHERE id=$1",
      [m.id],
    );
    expect((await upload(s.cookie, m)).status).toBe(409);
  });
  it("requires PayPal approval and the exact stored order ID", async () => {
    const b = await buyer(),
      o = await order(b),
      m = o.milestones[0];
    await request(`milestones/${m.id}/fund`, "POST", b, {
      accepted: true,
      autoSettle: false,
    });
    expect(
      (
        await request(`milestones/${m.id}/authorize`, "POST", b, {
          orderId: "OTHERORDER01",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`milestones/${m.id}/authorize`, "POST", b, {
          orderId: provider.id,
        })
      ).status,
    ).toBe(409);
  });
  it("validates amount, currency, merchant and milestone at the provider boundary", async () => {
    const { b, m } = await setup();
    const latest = (await workspace(b)).orders[0].milestones[0];
    for (const change of [
      { amount: { currency_code: "USD", value: "99.00" } },
      { amount: { currency_code: "EUR", value: "100.00" } },
      { payee: { merchant_id: "DIFFERENT" } },
      { custom_id: "wrong" },
      { reference_id: "wrong" },
    ]) {
      const altered = structuredClone(provider);
      Object.assign(altered.purchase_units[0], change);
      expect(() => validateOrder(altered, latest)).toThrow();
    }
  });
  it("holds expired and old authorizations without attempting capture", async () => {
    const { b, s, m } = await setup();
    await request(`milestones/${m.id}/review`, "POST", s.cookie, {});
    await state.db.query(
      "UPDATE milestones SET authorized_at=now()-interval '4 days' WHERE id=$1",
      [m.id],
    );
    expect(
      (await request(`milestones/${m.id}/settle`, "POST", b, {})).status,
    ).toBe(409);
    await state.db.query(
      "UPDATE milestones SET authorization_expires_at=now()-interval '1 second',authorized_at=now() WHERE id=$1",
      [m.id],
    );
    expect(
      (await request(`milestones/${m.id}/settle`, "POST", b, {})).status,
    ).toBe(409);
    expect(providerCalls.some((c) => c.url.endsWith("/capture"))).toBe(false);
  });
  it("keeps pending captures pending until PayPal confirms completion", async () => {
    const { b, s, m } = await setup(true);
    captureMode = "PENDING";
    await request(`milestones/${m.id}/review`, "POST", s.cookie, {});
    expect((await workspace(b)).orders[0].milestones[0].status).toBe(
      "settlement_pending",
    );
    provider.purchase_units[0].payments!.captures![0].status = "COMPLETED";
    expect(
      (await request(`milestones/${m.id}/reconcile`, "POST", b, {})).status,
    ).toBe(200);
    expect((await workspace(b)).orders[0].milestones[0].status).toBe("settled");
  });
  it("reconciles a failed capture using the same idempotency key", async () => {
    const { b, s, m } = await setup(true);
    captureMode = "NETWORK_ERROR";
    await request(`milestones/${m.id}/review`, "POST", s.cookie, {});
    expect((await workspace(b)).orders[0].milestones[0].status).toBe(
      "settlement_pending",
    );
    captureMode = "COMPLETED";
    expect(
      (await request(`milestones/${m.id}/reconcile`, "POST", b, {})).status,
    ).toBe(200);
    const calls = providerCalls.filter((c) => c.url.endsWith("/capture"));
    expect(calls).toHaveLength(2);
    expect(calls[0].headers["PayPal-Request-Id"]).toBe(
      calls[1].headers["PayPal-Request-Id"],
    );
    expect((await workspace(b)).orders[0].milestones[0].status).toBe("settled");
  });
  it("locks concurrent settlement requests to one capture", async () => {
    const { b, s, m } = await setup();
    await request(`milestones/${m.id}/review`, "POST", s.cookie, {});
    const results = await Promise.all([
      request(`milestones/${m.id}/settle`, "POST", b, {}),
      request(`milestones/${m.id}/settle`, "POST", b, {}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      providerCalls.filter((c) => c.url.endsWith("/capture")),
    ).toHaveLength(1);
  });
  it("pauses payments on buyer dispute and requires a fresh review after resume", async () => {
    const { b, s, m } = await setup();
    await request(`milestones/${m.id}/review`, "POST", s.cookie, {});
    expect(
      (
        await request(`milestones/${m.id}/dispute`, "POST", b, {
          reason: "Delivery quantity needs independent verification.",
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`milestones/${m.id}/settle`, "POST", b, {})).status,
    ).toBe(409);
    await request(`milestones/${m.id}/resolve`, "POST", b, {});
    expect((await workspace(b)).orders[0].milestones[0].review).toBeNull();
    expect(
      (await request(`milestones/${m.id}/settle`, "POST", b, {})).status,
    ).toBe(409);
  });
  it("recovers a confirmed authorization after a lost callback", async () => {
    const { b, m } = await setup();
    await state.db.query(
      "UPDATE milestones SET status='approval_pending',authorization_id=NULL WHERE id=$1",
      [m.id],
    );
    expect(
      (await request(`milestones/${m.id}/reconcile`, "POST", b, {})).status,
    ).toBe(200);
    expect((await workspace(b)).orders[0].milestones[0].authorization_id).toBe(
      "TESTAUTH0001",
    );
  });
});
describe("PayPal webhook validation", () => {
  const headers = {
    "paypal-cert-url":
      "https://api.sandbox.paypal.com/v1/notifications/certs/TEST",
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-transmission-id": "TESTTRANSMISSION",
    "paypal-transmission-sig": "TESTSIGNATURE",
    "paypal-transmission-time": "2026-10-28T00:00:00Z",
  };
  const event = {
    id: "WH-TEST1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: "2026-10-28T00:00:00Z",
    event_version: "1.0",
    resource: {
      supplementary_data: { related_ids: { order_id: "TESTORDER0001" } },
    },
  };
  it("passes the entire original event to verification and reconciles once", async () => {
    const { b, s, m } = await setup(true);
    captureMode = "PENDING";
    await request(`milestones/${m.id}/review`, "POST", s.cookie, {});
    provider.purchase_units[0].payments!.captures![0].status = "COMPLETED";
    const r = await request("webhooks/paypal", "POST", "", event, headers);
    expect(r.status).toBe(200);
    const verify = providerCalls.find((c) =>
      c.url.endsWith("verify-webhook-signature"),
    );
    expect(verify?.body.webhook_event).toEqual(event);
    expect((await workspace(b)).orders[0].milestones[0].status).toBe("settled");
    const duplicate = await request(
      "webhooks/paypal",
      "POST",
      "",
      event,
      headers,
    );
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
  });
  it("rejects forged signatures and unexpected certificate hosts", async () => {
    webhookMode = "FAILURE";
    expect(
      (await request("webhooks/paypal", "POST", "", event, headers)).status,
    ).toBe(403);
    expect(
      (
        await request("webhooks/paypal", "POST", "", event, {
          ...headers,
          "paypal-cert-url": "https://evil.test/cert",
        })
      ).status,
    ).toBe(403);
    expect(
      (await state.db.query("SELECT * FROM webhook_receipts")).rows,
    ).toHaveLength(0);
  });
  it("uses stable operation-specific idempotency keys", () => {
    expect(requestId("capture", "same")).toBe(requestId("capture", "same"));
    expect(requestId("capture", "same")).not.toBe(
      requestId("authorize", "same"),
    );
  });
});
