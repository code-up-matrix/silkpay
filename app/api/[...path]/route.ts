import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import {
  body,
  boundedBody,
  handle,
  hash,
  HttpError,
  identity,
  ipKey,
  json,
  limit,
  origin,
  sessionToken,
  setSession,
  token,
} from "@/lib/http";
import { orderInput, validFile, matchesAmount } from "@/lib/policy";
import { audit, ordersFor, ownedMilestone, ownedOrder } from "@/lib/repository";
import { aiConfigured, reviewEvidence } from "@/lib/review";
import {
  authorizePayment,
  createPayment,
  paymentsConfigured,
  paypal,
  providerId,
  requestId,
  type ProviderPayment,
} from "@/lib/paypal";
import { reconcile, settle } from "@/lib/payments";
import { sampleOrders } from "@/lib/sample";
import type { Milestone, Workspace } from "@/lib/types";
export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ path: string[] }> };
const uuid = (value: string) => {
  if (!z.uuid().safeParse(value).success)
    throw new HttpError(404, "Record not found.");
  return value;
};
const cookieExpired =
  "silkpay_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure";

async function route(request: Request, context: Context): Promise<Response> {
  const path = (await context.params).path,
    method = request.method;
  if (path.join("/") === "health" && method === "GET")
    return json({
      application: "SilkPay",
      environment: "sandbox",
      database: !!process.env.DATABASE_URL,
      payments: paymentsConfigured(),
      ai: await aiConfigured(),
      webhooks: !!process.env.PAYPAL_WEBHOOK_ID,
    });
  if (path.join("/") === "webhooks/paypal" && method === "POST")
    return webhook(request);
  if (method !== "GET") origin(request);
  if (
    !process.env.DATABASE_URL &&
    !(path.join("/") === "workspace" && method === "GET")
  )
    throw new HttpError(
      503,
      "Workspace storage is awaiting its secure database connection. The sample workspace remains available.",
    );
  if (path[0] === "workspace" && method === "POST") {
    await limit("workspace:" + ipKey(request), 5, 3600);
    const input = await body(
        request,
        z.object({ company: z.string().trim().min(2).max(80) }),
      ),
      value = token();
    const [workspace] = await query<{ id: string }>(
      "WITH w AS (INSERT INTO workspaces(company) VALUES($1) RETURNING id), s AS (INSERT INTO sessions(token_hash,workspace_id,role) SELECT $2,id,'buyer' FROM w) SELECT id FROM w",
      [input.company, hash(value)],
    );
    return setSession(json({ ok: true, id: workspace.id }, 201), value);
  }
  if (path[0] === "invitations" && path[1] === "join" && method === "POST") {
    await limit("join:" + ipKey(request), 10, 3600);
    const input = await body(
        request,
        z.object({ token: z.string().min(40).max(100) }),
      ),
      value = token();
    const rows = await query(
      "WITH invitation AS (UPDATE invitations SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING workspace_id,order_id), s AS (INSERT INTO sessions(token_hash,workspace_id,role,order_id) SELECT $2,workspace_id,'supplier',order_id FROM invitation RETURNING workspace_id) SELECT * FROM s",
      [hash(input.token), hash(value)],
    );
    if (!rows.length)
      throw new HttpError(
        410,
        "This invitation is expired or has already been used. Ask the buyer for a new invitation.",
      );
    return setSession(json({ ok: true }), value);
  }
  if (path[0] === "workspace" && method === "GET") {
    const config = {
      payments: paymentsConfigured(),
      ai: await aiConfigured(),
      database: !!process.env.DATABASE_URL,
    };
    if (!sessionToken(request))
      return json({
        mode: "sample",
        workspace: null,
        orders: sampleOrders,
        configuration: config,
      });
    const who = await identity(request);
    return json({
      mode: "sandbox",
      workspace: who,
      orders: await ordersFor(who),
      configuration: config,
    });
  }
  const who = await identity(request);
  if (path[0] === "session" && method === "DELETE") {
    await query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(sessionToken(request)!),
    ]);
    const response = json({ ok: true });
    response.headers.set("Set-Cookie", cookieExpired);
    return response;
  }
  await limit("api:" + who.id + ":" + who.role, 80);
  if (path[0] === "invitations" && method === "POST") {
    if (who.role !== "buyer")
      throw new HttpError(403, "Only the buyer can invite a supplier.");
    const input = await body(request, z.object({ orderId: z.uuid() }));
    await ownedOrder(input.orderId, who);
    await limit("invite:" + who.id, 10, 3600);
    const value = token();
    await query(
      "INSERT INTO invitations(token_hash,workspace_id,order_id) VALUES($1,$2,$3)",
      [hash(value), who.id, input.orderId],
    );
    await audit(
      input.orderId,
      "Supplier invitation created",
      "A private, single-use supplier invitation is available for seven days.",
      "Buyer",
    );
    return json({
      url: process.env.APP_ORIGIN + "/invite#token=" + value,
      expiresInDays: 7,
    });
  }
  if (path[0] === "orders" && path.length === 1 && method === "POST") {
    if (who.role !== "buyer")
      throw new HttpError(403, "Only the buyer can create purchase orders.");
    await limit("order-create:" + who.id, 10, 86400);
    const input = await body(request, orderInput),
      id = randomUUID();
    const number =
      "SP-" +
      new Date().toISOString().slice(2, 10).replaceAll("-", "") +
      "-" +
      id.slice(0, 4).toUpperCase();
    const milestones = input.milestones.map((m, i) => ({
      ...m,
      id: randomUUID(),
      position: i,
      specs: m.requirements.map((requirement, j) => ({
        id: "spec-" + (j + 1),
        requirement,
      })),
    }));
    const total = milestones.reduce((sum, m) => sum + m.amount_cents, 0);
    await query(
      "WITH p AS (INSERT INTO purchase_orders(id,workspace_id,number,product,buyer,supplier,country,quantity,total_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id), m AS (INSERT INTO milestones(id,order_id,title,amount_cents,position,due_date,specs) SELECT x.id::uuid,p.id,x.title,x.amount_cents,x.position,x.due_date::date,x.specs FROM p CROSS JOIN jsonb_to_recordset($10::jsonb) AS x(id text,title text,amount_cents integer,position integer,due_date text,specs jsonb) RETURNING id), a AS (INSERT INTO audit_events(order_id,event,detail,actor) SELECT id,'Purchase order created','Specifications and milestone amounts recorded.','Buyer' FROM p) SELECT count(*) FROM m",
      [
        id,
        who.id,
        number,
        input.product,
        who.company,
        input.supplier,
        input.country,
        input.quantity,
        total,
        JSON.stringify(milestones),
      ],
    );
    return json({ id, number }, 201);
  }
  if (path[0] === "evidence" && path[1] && method === "GET") {
    const [file] = await query<{
      filename: string;
      media_type: string;
      encoded: string;
    }>(
      "SELECT e.filename,e.media_type,encode(e.content,'base64') AS encoded FROM evidence e JOIN purchase_orders p ON p.id=e.order_id WHERE e.id=$1 AND p.workspace_id=$2 AND ($3::uuid IS NULL OR p.id=$3)",
      [uuid(path[1]), who.id, who.order_id],
    );
    if (!file) throw new HttpError(404, "Evidence is not available.");
    return new Response(Buffer.from(file.encoded, "base64"), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          'attachment; filename="' +
          file.filename.replace(/[^a-zA-Z0-9._-]/g, "_") +
          '"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (path[0] === "milestones" && path[1]) {
    const m = await ownedMilestone(uuid(path[1]), who),
      action = path[2];
    if (method !== "POST")
      throw new HttpError(405, "Use POST for milestone actions.");
    if (action === "evidence") return upload(request, m, who);
    if (action === "review") return review(m, who);
    if (action === "reconcile") {
      if (!m.paypal_order_id)
        throw new HttpError(
          409,
          "No PayPal order is linked to this milestone.",
        );
      return json(await reconcile(m));
    }
    if (who.role !== "buyer")
      throw new HttpError(
        403,
        "Only the buyer can change payment instructions.",
      );
    if (action === "fund") {
      if (!paymentsConfigured())
        throw new HttpError(
          503,
          "Connect the PayPal Sandbox client ID, client secret and supplier merchant ID on the server first.",
        );
      const input = await body(
        request,
        z.object({ autoSettle: z.boolean(), accepted: z.literal(true) }),
      );
      if (m.status === "approval_pending" && m.approval_url)
        return json({ url: m.approval_url });
      const [locked] = await query<Milestone>(
        "UPDATE milestones SET status='approval_pending',auto_settle=$2,lock_until=now()+interval '2 minutes' WHERE id=$1 AND status IN ('unfunded','approval_pending') AND paypal_order_id IS NULL AND (lock_until IS NULL OR lock_until<now()) RETURNING *",
        [m.id, input.autoSettle],
      );
      if (!locked)
        throw new HttpError(
          409,
          "This milestone is already authorized or a payment request is in progress.",
        );
      try {
        const payment = await createPayment(
          locked,
          await ownedOrder(m.order_id, who),
        );
        await query(
          "UPDATE milestones SET paypal_order_id=$2,approval_url=$3,lock_until=NULL WHERE id=$1",
          [m.id, payment.id, payment.url],
        );
        await audit(
          m.order_id,
          "Payment approval started",
          m.title +
            " · " +
            (input.autoSettle
              ? "Automatic settlement allowed after a passing evidence review."
              : "Buyer will confirm settlement after review."),
          "Buyer",
        );
        return json({ url: payment.url });
      } catch (e) {
        await query(
          "UPDATE milestones SET lock_until=NULL,payment_error='Payment creation was not confirmed. Retry uses the same request identifier.' WHERE id=$1",
          [m.id],
        );
        throw e;
      }
    }
    if (action === "authorize") {
      const input = await body(
        request,
        z.object({ orderId: z.string().min(8).max(40) }),
      );
      if (input.orderId !== m.paypal_order_id)
        throw new HttpError(409, "This approval belongs to another order.");
      if (m.authorization_id) return json({ status: m.status });
      if (m.status !== "approval_pending")
        throw new HttpError(
          409,
          "This milestone is not awaiting payment approval.",
        );
      const authorization = await authorizePayment(m);
      const changed = await query(
        "UPDATE milestones SET status='funded',authorization_id=$2,authorized_at=now(),authorization_expires_at=$3,lock_until=NULL,payment_error=NULL WHERE id=$1 AND status='approval_pending' AND authorization_id IS NULL RETURNING id",
        [m.id, authorization.id, authorization.expiration_time],
      );
      if (changed.length)
        await audit(
          m.order_id,
          "Milestone authorized",
          m.title + " · PayPal Sandbox placed a temporary payment hold.",
          "PayPal",
        );
      return json({ status: "funded" });
    }
    if (action === "reauthorize") {
      if (
        !["funded", "changes_requested", "verified"].includes(m.status) ||
        !m.authorization_id ||
        !m.authorization_expires_at ||
        Date.parse(m.authorization_expires_at) <= Date.now()
      )
        throw new HttpError(409, "This authorization cannot be refreshed.");
      if (
        m.authorized_at &&
        Date.parse(m.authorized_at) + 3 * 86400000 > Date.now()
      )
        throw new HttpError(
          409,
          "The authorization is still within its three-day honor period.",
        );
      const a = await paypal<ProviderPayment>(
        "/v2/payments/authorizations/" +
          providerId(m.authorization_id) +
          "/reauthorize",
        "POST",
        {
          amount: {
            currency_code: "USD",
            value: (m.amount_cents / 100).toFixed(2),
          },
        },
        requestId("reauthorize", m.authorization_id),
      );
      if (
        a.status !== "CREATED" ||
        !matchesAmount(a.amount, m.amount_cents) ||
        !a.expiration_time
      )
        throw new HttpError(
          409,
          "PayPal has not confirmed the refreshed authorization.",
        );
      await query(
        "UPDATE milestones SET authorization_id=$2,authorized_at=now(),authorization_expires_at=$3 WHERE id=$1 AND authorization_id=$4",
        [m.id, providerId(a.id), a.expiration_time, m.authorization_id],
      );
      await audit(
        m.order_id,
        "Authorization refreshed",
        m.title + " · capture honor period refreshed.",
        "Buyer",
      );
      return json({ ok: true });
    }
    if (action === "settle") return json(await settle(m, "Buyer"));
    if (action === "dispute") {
      const input = await body(
        request,
        z.object({ reason: z.string().trim().min(10).max(1500) }),
      );
      const changed = await query(
        "UPDATE milestones SET status='disputed',payment_error=$2 WHERE id=$1 AND status IN ('unfunded','funded','changes_requested','verified') AND capture_id IS NULL RETURNING id",
        [m.id, input.reason],
      );
      if (!changed.length)
        throw new HttpError(
          409,
          "Settlement or review is already in progress. Refresh payment status before opening a dispute.",
        );
      await audit(m.order_id, "Milestone disputed", input.reason, "Buyer");
      return json({ ok: true });
    }
    if (action === "resolve") {
      const changed = await query(
        "UPDATE milestones SET status=CASE WHEN authorization_id IS NULL THEN 'unfunded' ELSE 'funded' END,review=NULL,review_version=NULL,payment_error=NULL WHERE id=$1 AND status='disputed' AND capture_id IS NULL RETURNING id",
        [m.id],
      );
      if (!changed.length)
        throw new HttpError(
          409,
          "This dispute cannot be resumed automatically.",
        );
      await audit(
        m.order_id,
        "Dispute reopened for evidence",
        "A fresh evidence review is required before settlement.",
        "Buyer",
      );
      return json({ ok: true });
    }
  }
  throw new HttpError(404, "Endpoint not found.");
}
async function upload(request: Request, m: Milestone, who: Workspace) {
  if (who.role !== "supplier")
    throw new HttpError(
      403,
      "The invited supplier must submit the fulfillment evidence.",
    );
  await limit("upload:" + m.order_id, 8, 3600);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    throw new HttpError(415, "Choose a document or photo to upload.");
  const bytes = await boundedBody(request, 2_100_000);
  const form = await new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("content-type")! },
    body: bytes,
  }).formData();
  const file = form.get("file"),
    note = String(form.get("note") || "").slice(0, 1000);
  if (form.get("consent") !== "true")
    throw new HttpError(
      400,
      "Confirm that you may share this evidence for AI review.",
    );
  if (!(file instanceof File)) throw new HttpError(400, "Select a file.");
  const data = Buffer.from(await file.arrayBuffer());
  if (!validFile(data, file.type))
    throw new HttpError(
      400,
      "Use a valid PNG, JPEG or PDF up to 2 MB, or a UTF-8 text/CSV report up to 32 KB.",
    );
  const filename =
    file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "evidence";
  const rows = await query(
    "WITH m AS (UPDATE milestones SET evidence_version=evidence_version+1,evidence_count=evidence_count+1,review=NULL,review_version=NULL,status=CASE WHEN status IN ('changes_requested','verified') THEN 'funded' ELSE status END WHERE id=$1 AND status IN ('unfunded','approval_pending','funded','changes_requested','verified') AND evidence_count<6 AND (lock_until IS NULL OR lock_until<now()) RETURNING id,order_id), e AS (INSERT INTO evidence(milestone_id,order_id,filename,media_type,size,sha256,content,note) SELECT id,order_id,$2,$3,$4,$5,decode($6,'hex'),$7 FROM m RETURNING id) SELECT * FROM e",
    [
      m.id,
      filename,
      file.type,
      data.length,
      hash(data),
      data.toString("hex"),
      note,
    ],
  );
  if (!rows.length)
    throw new HttpError(
      409,
      "This milestone is locked or already has six evidence files.",
    );
  await audit(
    m.order_id,
    "Evidence uploaded",
    filename + " · " + m.title,
    "Supplier",
  );
  return json({ id: rows[0].id }, 201);
}
async function review(m: Milestone, who: Workspace) {
  await limit("review:" + who.id, 6, 3600);
  await limit("review:global", 30, 3600);
  if (!(await aiConfigured()))
    throw new HttpError(503, "The AI reviewer is not connected yet.");
  const reviewLock = randomUUID();
  const [locked] = await query<Milestone>(
    "UPDATE milestones SET status='reviewing',review_lock=$2,lock_until=now()+interval '2 minutes' WHERE id=$1 AND (status IN ('funded','changes_requested','verified') OR (status='reviewing' AND lock_until<now())) AND evidence_count>0 RETURNING *",
    [m.id, reviewLock],
  );
  if (!locked)
    throw new HttpError(
      409,
      "Authorize this milestone and upload evidence before requesting review.",
    );
  let committed = false;
  try {
    const report = await reviewEvidence(
      await ownedOrder(m.order_id, who),
      locked,
    );
    const [updated] = await query<Milestone>(
      "UPDATE milestones SET status=$2,review=$3::jsonb,review_version=$4,lock_until=NULL,review_lock=NULL WHERE id=$1 AND status='reviewing' AND evidence_version=$4 AND review_lock=$5 RETURNING *",
      [
        m.id,
        report.passed ? "verified" : "changes_requested",
        JSON.stringify(report),
        locked.evidence_version,
        reviewLock,
      ],
    );
    if (!updated)
      throw new HttpError(409, "The evidence changed. Run a fresh review.");
    committed = true;
    await audit(
      m.order_id,
      report.passed ? "Evidence verified" : "More evidence requested",
      report.summary,
      "SilkPay AI",
    );
    if (report.passed && updated.auto_settle) {
      try {
        return json({
          report,
          settlement: await settle(updated, "SilkPay AI", true),
        });
      } catch (e) {
        return json({
          report,
          settlement: {
            status: "needs_attention",
            message:
              e instanceof HttpError
                ? e.message
                : "Settlement needs reconciliation. Refresh payment status.",
          },
        });
      }
    }
    return json({ report });
  } catch (e) {
    if (!committed)
      await query(
        "UPDATE milestones SET status='funded',lock_until=NULL,review_lock=NULL WHERE id=$1 AND status='reviewing' AND evidence_version=$2 AND review_lock=$3",
        [m.id, locked.evidence_version, reviewLock],
      );
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      502,
      "The AI review could not be completed. No payment was released.",
    );
  }
}
async function webhook(request: Request) {
  if (!process.env.PAYPAL_WEBHOOK_ID)
    throw new HttpError(503, "Webhook verification is not configured.");
  const event = await body(
    request,
    z
      .object({
        id: z.string().max(200),
        event_type: z.string().max(100),
        resource: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  );
  const certificate = request.headers.get("paypal-cert-url") || "";
  let certificateUrl: URL;
  try {
    certificateUrl = new URL(certificate);
  } catch {
    throw new HttpError(400, "Invalid certificate URL.");
  }
  if (
    certificateUrl.protocol !== "https:" ||
    !["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"].includes(
      certificateUrl.hostname,
    )
  )
    throw new HttpError(403, "Unexpected webhook certificate host.");
  const result = await paypal<{ verification_status: string }>(
    "/v1/notifications/verify-webhook-signature",
    "POST",
    {
      auth_algo: request.headers.get("paypal-auth-algo"),
      cert_url: certificate,
      transmission_id: request.headers.get("paypal-transmission-id"),
      transmission_sig: request.headers.get("paypal-transmission-sig"),
      transmission_time: request.headers.get("paypal-transmission-time"),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    },
  );
  if (result.verification_status !== "SUCCESS")
    throw new HttpError(403, "Webhook signature verification failed.");
  if (
    (await query("SELECT id FROM webhook_receipts WHERE id=$1", [event.id]))
      .length
  )
    return json({ ok: true, duplicate: true });
  const related = (
    event.resource.supplementary_data as
      | {
          related_ids?: {
            order_id?: string;
            authorization_id?: string;
            capture_id?: string;
          };
        }
      | undefined
  )?.related_ids;
  const resourceId =
    typeof event.resource.id === "string" ? event.resource.id : null;
  const captureId =
    related?.capture_id ||
    (event.event_type.startsWith("PAYMENT.CAPTURE.") ? resourceId : null);
  const authorizationId =
    related?.authorization_id ||
    (event.event_type.startsWith("PAYMENT.AUTHORIZATION.") ? resourceId : null);
  if (related?.order_id || captureId || authorizationId) {
    const [m] = await query<Milestone>(
      "SELECT * FROM milestones WHERE paypal_order_id=$1 OR capture_id=$2 OR authorization_id=$3 LIMIT 1",
      [related?.order_id || null, captureId, authorizationId],
    );
    if (m) await reconcile(m);
  }
  await query(
    "INSERT INTO webhook_receipts(id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [event.id, event.event_type],
  );
  return json({ ok: true });
}
export const GET = (r: Request, c: Context) => handle(() => route(r, c));
export const POST = (r: Request, c: Context) => handle(() => route(r, c));
export const DELETE = (r: Request, c: Context) => handle(() => route(r, c));
