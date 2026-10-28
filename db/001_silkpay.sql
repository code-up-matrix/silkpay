CREATE TABLE IF NOT EXISTS workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 number text NOT NULL, product text NOT NULL, buyer text NOT NULL, supplier text NOT NULL,
 country text NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
 total_cents integer NOT NULL CHECK(total_cents>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,number)
);
CREATE INDEX IF NOT EXISTS order_workspace ON purchase_orders(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 role text NOT NULL CHECK(role IN ('buyer','supplier')), order_id uuid REFERENCES purchase_orders(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 CHECK ((role='buyer' AND order_id IS NULL) OR (role='supplier' AND order_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS invitations (
 token_hash text PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 order_id uuid NOT NULL REFERENCES purchase_orders(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', used_at timestamptz
);
CREATE TABLE IF NOT EXISTS milestones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES purchase_orders(id),
 title text NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents>0),
 position integer NOT NULL, due_date date NOT NULL, specs jsonb NOT NULL,
 status text NOT NULL DEFAULT 'unfunded' CHECK(status IN ('unfunded','approval_pending','checkout_approved','funded','reviewing','changes_requested','verified','settling','settlement_pending','settled','disputed','expired')),
 payment_intent text NOT NULL DEFAULT 'AUTHORIZE' CHECK(payment_intent IN ('AUTHORIZE','CAPTURE')),
 checkout_expires_at timestamptz, approved_at timestamptz,
 auto_settle boolean NOT NULL DEFAULT false, evidence_version integer NOT NULL DEFAULT 0,
 evidence_count integer NOT NULL DEFAULT 0 CHECK(evidence_count BETWEEN 0 AND 6),
 review_version integer, review_lock uuid, review jsonb, paypal_order_id text UNIQUE, approval_url text,
 authorization_id text UNIQUE, capture_id text UNIQUE, authorized_at timestamptz,
 authorization_expires_at timestamptz, payment_error text, lock_until timestamptz,
 attempt_key uuid NOT NULL DEFAULT gen_random_uuid(), UNIQUE(order_id,position)
);
CREATE TABLE IF NOT EXISTS evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES purchase_orders(id),
 milestone_id uuid NOT NULL REFERENCES milestones(id), filename text NOT NULL,
 media_type text NOT NULL, size integer NOT NULL CHECK(size>0 AND size<=2000000),
 sha256 text NOT NULL, content bytea NOT NULL, note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_milestone ON evidence(milestone_id,created_at);
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES purchase_orders(id),
 event text NOT NULL, detail text NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_order ON audit_events(order_id,created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
 key text NOT NULL, bucket bigint NOT NULL, hits integer NOT NULL DEFAULT 1,
 PRIMARY KEY(key,bucket)
);
CREATE TABLE IF NOT EXISTS webhook_receipts (
 id text PRIMARY KEY, event_type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
