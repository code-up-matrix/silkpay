import "server-only";
import { query } from "./db";
import { HttpError } from "./http";
import { audit } from "./repository";
import {
  capturePayment,
  captureOrder,
  retrieveOrder,
  providerId,
} from "./paypal";
import { matchesAmount } from "./policy";
import type { Milestone } from "./types";
export async function settle(m: Milestone, actor: string, automatic = false) {
  if (
    !m.review?.passed ||
    m.review_version !== m.evidence_version ||
    m.status !== "verified"
  )
    throw new HttpError(
      409,
      "A passing review of the current evidence is required.",
    );
  if (automatic && !m.auto_settle)
    throw new HttpError(403, "The buyer has not enabled automatic settlement.");
  if (m.payment_intent === "CAPTURE") {
    if (
      !m.approved_at ||
      !m.checkout_expires_at ||
      Date.parse(m.checkout_expires_at) <= Date.now()
    )
      throw new HttpError(
        409,
        "This checkout expired. Refresh checkout approval before settlement.",
      );
  } else {
    if (
      !m.authorization_expires_at ||
      Date.parse(m.authorization_expires_at) <= Date.now()
    )
      throw new HttpError(409, "The authorization has expired.");
    if (
      !m.authorized_at ||
      Date.parse(m.authorized_at) + 3 * 86400000 < Date.now()
    )
      throw new HttpError(
        409,
        "The buyer must refresh the authorization before settlement; its three-day honor period has elapsed.",
      );
  }
  const [locked] = await query<Milestone>(
    "UPDATE milestones SET status='settling',lock_until=now()+interval '2 minutes',payment_error=NULL WHERE id=$1 AND status='verified' AND review_version=evidence_version AND review->>'passed'='true' AND ($2=false OR auto_settle=true) AND (lock_until IS NULL OR lock_until<now()) RETURNING *",
    [m.id, automatic],
  );
  if (!locked)
    throw new HttpError(
      409,
      "This milestone changed or settlement is already in progress.",
    );
  try {
    const capture =
      locked.payment_intent === "CAPTURE"
        ? await captureOrder(locked.paypal_order_id!, locked)
        : (await retrieveOrder(locked), await capturePayment(locked));
    const status =
      capture.status === "COMPLETED" ? "settled" : "settlement_pending";
    await query(
      "UPDATE milestones SET status=$2,capture_id=$3,lock_until=NULL,payment_error=$4 WHERE id=$1 AND status='settling'",
      [
        m.id,
        status,
        capture.id,
        status === "settled"
          ? null
          : "PayPal is processing the capture. Refresh payment status.",
      ],
    );
    await audit(
      m.order_id,
      status === "settled" ? "Milestone settled" : "Settlement processing",
      m.title + " · PayPal Sandbox capture " + capture.id,
      actor,
    );
    return { status, captureId: capture.id };
  } catch (e) {
    await query(
      "UPDATE milestones SET status='settlement_pending',lock_until=NULL,payment_error='The provider result needs reconciliation. Do not start another payment.' WHERE id=$1 AND status='settling'",
      [m.id],
    );
    throw e;
  }
}
export async function reconcile(m: Milestone) {
  const order = await retrieveOrder(m);
  const unit = order.purchase_units[0];
  const capture = unit.payments?.captures?.find((c) =>
    matchesAmount(c.amount, m.amount_cents),
  );
  if (capture) {
    const completed = capture.status === "COMPLETED";
    if (
      completed &&
      !["settling", "settlement_pending", "settled"].includes(m.status)
    )
      throw new HttpError(
        409,
        "Unexpected capture found. Settlement requires manual investigation.",
      );
    const status = completed
      ? "settled"
      : ["DECLINED", "REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"].includes(
            capture.status,
          )
        ? "disputed"
        : "settlement_pending";
    await query(
      "UPDATE milestones SET status=$2,capture_id=$3,lock_until=NULL,payment_error=$4 WHERE id=$1",
      [
        m.id,
        status,
        capture.id,
        completed ? null : "PayPal capture status: " + capture.status,
      ],
    );
    if (status !== m.status)
      await audit(
        m.order_id,
        "Payment status reconciled",
        m.title + " · " + capture.status,
        "PayPal",
      );
    return { status, captureId: capture.id };
  }
  if (m.payment_intent === "CAPTURE") {
    if (order.status === "APPROVED" && m.status === "approval_pending") {
      const changed = await query(
        "UPDATE milestones SET status='checkout_approved',approved_at=now(),lock_until=NULL,payment_error=NULL WHERE id=$1 AND status='approval_pending' AND checkout_expires_at>now() RETURNING id",
        [m.id],
      );
      if (changed.length) {
        await audit(
          m.order_id,
          "Checkout approved",
          "PayPal Sandbox approval confirmed. No funds have been captured or held.",
          "PayPal",
        );
        return { status: "checkout_approved" };
      }
    }
    if (
      order.status === "APPROVED" &&
      (m.status === "settlement_pending" ||
        (m.status === "settling" &&
          m.lock_until &&
          Date.parse(m.lock_until) < Date.now()))
    ) {
      const [retry] = await query<Milestone>(
        "UPDATE milestones SET status='verified',lock_until=NULL WHERE id=$1 AND (status='settlement_pending' OR (status='settling' AND lock_until<now())) AND capture_id IS NULL AND review_version=evidence_version AND checkout_expires_at>now() RETURNING *",
        [m.id],
      );
      if (retry) return settle(retry, "Reconciliation", false);
    }
    return {
      status: m.status,
      notice: "No capture has been confirmed by PayPal.",
    };
  }
  const auth = unit.payments?.authorizations?.find((a) =>
    m.authorization_id
      ? a.id === m.authorization_id
      : matchesAmount(a.amount, m.amount_cents),
  );
  if (
    auth?.status === "CREATED" &&
    m.status === "approval_pending" &&
    !m.authorization_id &&
    auth.expiration_time &&
    Number.isFinite(Date.parse(auth.expiration_time))
  ) {
    const created =
      auth.create_time && Number.isFinite(Date.parse(auth.create_time))
        ? auth.create_time
        : null;
    const changed = await query(
      "UPDATE milestones SET status='funded',authorization_id=$2,authorized_at=$4,authorization_expires_at=$3,payment_error=NULL,lock_until=NULL WHERE id=$1 AND status='approval_pending' AND authorization_id IS NULL RETURNING id",
      [m.id, providerId(auth.id), auth.expiration_time, created],
    );
    if (changed.length)
      await audit(
        m.order_id,
        "Authorization reconciled",
        m.title + " · confirmed directly with PayPal Sandbox.",
        "PayPal",
      );
    return { status: "funded" };
  }
  if (auth && ["VOIDED", "EXPIRED", "DENIED"].includes(auth.status)) {
    await query(
      "UPDATE milestones SET status='expired',payment_error=$2,lock_until=NULL WHERE id=$1 AND status<>'settled'",
      [m.id, "PayPal authorization: " + auth.status],
    );
    return { status: "expired" };
  }
  if (
    auth?.status === "CREATED" &&
    (m.status === "settlement_pending" ||
      (m.status === "settling" &&
        m.lock_until &&
        Date.parse(m.lock_until) < Date.now()))
  ) {
    // A final capture cannot be repeated: reuse the same provider idempotency key.
    const [retry] = await query<Milestone>(
      "UPDATE milestones SET status='verified',lock_until=NULL WHERE id=$1 AND (status='settlement_pending' OR (status='settling' AND lock_until<now())) AND capture_id IS NULL AND review_version=evidence_version RETURNING *",
      [m.id],
    );
    if (retry) return settle(retry, "Reconciliation", false);
  }
  return {
    status: m.status,
    notice: "PayPal has not confirmed a new payment state.",
  };
}
