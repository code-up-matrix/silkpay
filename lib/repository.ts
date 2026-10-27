import "server-only";
import { query } from "./db";
import { HttpError } from "./http";
import type {
  Workspace,
  PurchaseOrder,
  Milestone,
  Evidence,
  AuditEvent,
} from "./types";
export async function ownedOrder(id: string, who: Workspace) {
  const [order] = await query<PurchaseOrder>(
    "SELECT * FROM purchase_orders WHERE id=$1 AND workspace_id=$2 AND ($3::uuid IS NULL OR id=$3)",
    [id, who.id, who.order_id],
  );
  if (!order)
    throw new HttpError(
      404,
      "This purchase order is not available in your workspace.",
    );
  return order;
}
export async function ownedMilestone(id: string, who: Workspace) {
  const [milestone] = await query<Milestone>(
    "SELECT m.* FROM milestones m JOIN purchase_orders p ON p.id=m.order_id WHERE m.id=$1 AND p.workspace_id=$2 AND ($3::uuid IS NULL OR p.id=$3)",
    [id, who.id, who.order_id],
  );
  if (!milestone)
    throw new HttpError(
      404,
      "This milestone is not available in your workspace.",
    );
  return milestone;
}
export async function ordersFor(who: Workspace): Promise<PurchaseOrder[]> {
  const orders = await query<PurchaseOrder>(
    "SELECT * FROM purchase_orders WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at DESC LIMIT 50",
    [who.id, who.order_id],
  );
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const [milestones, evidence, activity] = await Promise.all([
    query<Milestone>(
      "SELECT * FROM milestones WHERE order_id=ANY($1::uuid[]) ORDER BY position",
      [ids],
    ),
    query<Evidence>(
      "SELECT id,order_id,milestone_id,filename,media_type,size,sha256,note,created_at FROM evidence WHERE order_id=ANY($1::uuid[]) ORDER BY created_at DESC",
      [ids],
    ),
    query<AuditEvent>(
      "SELECT * FROM audit_events WHERE order_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 250",
      [ids],
    ),
  ]);
  return orders.map((order) => ({
    ...order,
    milestones: milestones.filter((m) => m.order_id === order.id),
    evidence: evidence.filter((e) => e.order_id === order.id),
    activity: activity.filter((a) => a.order_id === order.id),
  }));
}
export async function audit(
  orderId: string,
  event: string,
  detail: string,
  actor: string,
) {
  await query(
    "INSERT INTO audit_events(order_id,event,detail,actor) VALUES($1,$2,$3,$4)",
    [orderId, event, detail.slice(0, 2000), actor],
  );
}
