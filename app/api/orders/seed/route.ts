import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { handle, identity, json, origin, limit } from "@/lib/http";
import { blueprint } from "@/lib/blueprint";
export const runtime = "nodejs";
export const POST = (request: Request) =>
  handle(async () => {
    origin(request);
    const who = await identity(request, "buyer");
    await limit("seed:" + who.id, 5, 3600);
    const id = randomUUID();
    const [saved] = await query<{ id: string }>(
      "WITH p AS (INSERT INTO purchase_orders(id,workspace_id,number,product,buyer,supplier,country,quantity,total_cents) VALUES($1,$2,$3,$4,$5,$6,'China',5000,450000) ON CONFLICT(workspace_id,number) DO NOTHING RETURNING id), m AS (INSERT INTO milestones(order_id,title,amount_cents,position,due_date,specs,payment_intent) SELECT id,$7,450000,1,current_date+7,$8::jsonb,'CAPTURE' FROM p), a AS (INSERT INTO audit_events(order_id,event,detail,actor) SELECT id,'Purchase order created','Hackathon example contract. Supplier evidence and PayPal approval are still required.','Buyer' FROM p) SELECT id FROM p UNION ALL SELECT id FROM purchase_orders WHERE workspace_id=$2 AND number=$3 LIMIT 1",
      [
        id,
        who.id,
        blueprint.number,
        blueprint.product,
        who.company,
        blueprint.supplier,
        blueprint.title,
        JSON.stringify(
          blueprint.requirements.map((requirement, i) => ({
            id: "spec-" + (i + 1),
            requirement,
          })),
        ),
      ],
    );
    return json({ id: saved?.id || id }, 201);
  });
