import "server-only";
import { randomUUID } from "node:crypto";
import { query } from "./db";
import { limit, HttpError, json } from "./http";
import { aiConfigured, reviewEvidence } from "./review";
import { ownedOrder, audit } from "./repository";
import { settle } from "./payments";
import type { Milestone, Workspace } from "./types";
export async function inspectMilestone(m: Milestone, who: Workspace) {
  await limit("review:" + who.id, 6, 3600);
  await limit("review:global", 30, 3600);
  if (!(await aiConfigured()))
    throw new HttpError(503, "The AI reviewer is not connected yet.");
  const reviewLock = randomUUID();
  const [locked] = await query<Milestone>(
    "UPDATE milestones SET status='reviewing',review=NULL,review_version=NULL,review_lock=$2,lock_until=now()+interval '2 minutes' WHERE id=$1 AND ((status IN ('funded','checkout_approved','changes_requested','verified') AND (lock_until IS NULL OR lock_until<now())) OR (status='reviewing' AND lock_until<now())) AND evidence_count>0 RETURNING *",
    [m.id, reviewLock],
  );
  if (!locked)
    throw new HttpError(
      409,
      "Approve checkout and upload supplier evidence before requesting review.",
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
        "UPDATE milestones SET status=CASE WHEN payment_intent='CAPTURE' THEN 'checkout_approved' ELSE 'funded' END,lock_until=NULL,review_lock=NULL WHERE id=$1 AND status='reviewing' AND evidence_version=$2 AND review_lock=$3",
        [m.id, locked.evidence_version, reviewLock],
      );
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      502,
      "The AI review could not be completed. No payment was released.",
    );
  }
}
