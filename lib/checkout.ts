import "server-only";
import { z } from "zod";
import { query } from "./db";
import { body, handle, HttpError, identity, json, limit, origin } from "./http";
import { audit, ownedMilestone, ownedOrder } from "./repository";
import { createOrder, paymentsConfigured, retrieveOrder } from "./paypal";
import { reconcile, settle } from "./payments";
import type { Milestone } from "./types";

const input = z
  .object({ milestoneId: z.uuid(), accepted: z.literal(true) })
  .strict();
export function checkout(
  request: Request,
  action: "create" | "approve" | "capture",
) {
  return handle(async () => {
    origin(request);
    const who = await identity(request, "buyer");
    await limit("checkout:" + who.id, 20);
    const value =
      action === "create"
        ? await body(request, input)
        : await body(
            request,
            z
              .object({
                milestoneId: z.uuid(),
                orderId: z.string().regex(/^[A-Z0-9]{8,40}$/),
              })
              .strict(),
          );
    let m = await ownedMilestone(value.milestoneId, who);
    if (!paymentsConfigured())
      throw new HttpError(
        503,
        "Add the PayPal Sandbox client ID, secret and test seller merchant ID to enable checkout.",
      );
    if (action !== "create") {
      if (
        !("orderId" in value) ||
        value.orderId !== m.paypal_order_id ||
        m.payment_intent !== "CAPTURE"
      )
        throw new HttpError(
          409,
          "This checkout does not belong to this milestone.",
        );
      if (action === "approve") {
        const result = await reconcile(m);
        const latest = await ownedMilestone(m.id, who);
        if (!latest.approved_at)
          throw new HttpError(
            409,
            "PayPal has not confirmed an active checkout approval. Refresh checkout if it has expired.",
          );
        return json(result);
      }
      if (m.status === "settled" && m.capture_id)
        return json({
          status: "settled",
          captureId: m.capture_id,
          alreadyCaptured: true,
        });
      return json(await settle(m, "Buyer"));
    }
    if (m.paypal_order_id && m.payment_intent !== "CAPTURE")
      throw new HttpError(
        409,
        "This milestone already uses a payment authorization.",
      );
    const expired =
      m.checkout_expires_at && Date.parse(m.checkout_expires_at) <= Date.now();
    if (
      m.paypal_order_id &&
      expired &&
      [
        "approval_pending",
        "checkout_approved",
        "changes_requested",
        "verified",
      ].includes(m.status)
    ) {
      const remote = await retrieveOrder(m);
      if (
        remote.purchase_units.some((u) => u.payments?.captures?.length) ||
        remote.status === "COMPLETED"
      )
        throw new HttpError(
          409,
          "A provider payment needs reconciliation before checkout can be restarted.",
        );
      const [reset] = await query<Milestone>(
        "UPDATE milestones SET status='unfunded',paypal_order_id=NULL,approval_url=NULL,approved_at=NULL,checkout_expires_at=NULL,attempt_key=gen_random_uuid(),review=NULL,review_version=NULL WHERE id=$1 AND paypal_order_id=$2 AND status IN ('approval_pending','checkout_approved','changes_requested','verified') AND capture_id IS NULL AND (lock_until IS NULL OR lock_until<now()) RETURNING *",
        [m.id, m.paypal_order_id],
      );
      if (!reset)
        throw new HttpError(
          409,
          "A payment action is in progress. Refresh the workspace.",
        );
      m = reset;
    }
    if (m.status === "approval_pending" && m.approval_url && !expired)
      return json({ id: m.paypal_order_id, url: m.approval_url });
    const [locked] = await query<Milestone>(
      "UPDATE milestones SET status='approval_pending',payment_intent='CAPTURE',auto_settle=false,lock_until=now()+interval '2 minutes' WHERE id=$1 AND status IN ('unfunded','approval_pending') AND paypal_order_id IS NULL AND (lock_until IS NULL OR lock_until<now()) RETURNING *",
      [m.id],
    );
    if (!locked)
      throw new HttpError(
        409,
        "This milestone already has an active payment. Refresh its status.",
      );
    try {
      const payment = await createOrder(locked.amount_cents, "USD", {
        milestone: locked,
        order: await ownedOrder(m.order_id, who),
      });
      await query(
        "UPDATE milestones SET paypal_order_id=$2,approval_url=$3,checkout_expires_at=now()+interval '3 hours',lock_until=NULL,payment_error=NULL WHERE id=$1",
        [m.id, payment.id, payment.url],
      );
      await audit(
        m.order_id,
        "Sandbox checkout created",
        "Buyer approval requested. Funds are captured only after a passing evidence review and buyer confirmation.",
        "Buyer",
      );
      return json(payment);
    } catch (error) {
      await query(
        "UPDATE milestones SET lock_until=NULL,payment_error='Checkout creation was not confirmed. Retry uses the same request identifier.' WHERE id=$1",
        [m.id],
      );
      throw error;
    }
  });
}
