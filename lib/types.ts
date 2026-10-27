export type Role = "buyer" | "supplier";
export type MilestoneStatus =
  | "unfunded"
  | "approval_pending"
  | "funded"
  | "reviewing"
  | "changes_requested"
  | "verified"
  | "settling"
  | "settlement_pending"
  | "settled"
  | "disputed"
  | "expired";
export type Spec = { id: string; requirement: string };
export type Finding = {
  specId: string;
  outcome: "met" | "not_met" | "uncertain";
  confidence: number;
  explanation: string;
  evidenceIds: string[];
};
export type Review = {
  summary: string;
  findings: Finding[];
  concerns: string[];
  passed: boolean;
  model: string;
  generatedAt: string;
  evidenceVersion: number;
  responseId?: string;
};
export type Milestone = {
  id: string;
  order_id: string;
  title: string;
  amount_cents: number;
  due_date: string;
  position: number;
  status: MilestoneStatus;
  specs: Spec[];
  auto_settle: boolean;
  evidence_version: number;
  review_version: number | null;
  review: Review | null;
  paypal_order_id: string | null;
  authorization_id: string | null;
  capture_id: string | null;
  authorization_expires_at: string | null;
  authorized_at: string | null;
  payment_error: string | null;
  attempt_key: string;
  approval_url?: string | null;
  lock_until?: string | null;
};
export type Evidence = {
  id: string;
  order_id: string;
  milestone_id: string;
  filename: string;
  media_type: string;
  size: number;
  sha256: string;
  note: string;
  created_at: string;
};
export type AuditEvent = {
  id: string;
  order_id: string;
  event: string;
  detail: string;
  actor: string;
  created_at: string;
};
export type PurchaseOrder = {
  id: string;
  workspace_id: string;
  number: string;
  product: string;
  buyer: string;
  supplier: string;
  country: string;
  quantity: number;
  total_cents: number;
  created_at: string;
  milestones: Milestone[];
  evidence: Evidence[];
  activity: AuditEvent[];
};
export type Workspace = {
  id: string;
  company: string;
  role: Role;
  order_id: string | null;
};
export type WorkspacePayload = {
  mode: "sample" | "sandbox";
  workspace: Workspace | null;
  orders: PurchaseOrder[];
  configuration: { payments: boolean; ai: boolean; database: boolean };
};
