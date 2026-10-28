"use client";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  FileCheck2,
  FileText,
  FolderOpen,
  Globe2,
  History,
  LayoutDashboard,
  Link2,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShieldHalf,
  Sparkles,
  TriangleAlert,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Brand, ProductArt } from "@/components/brand";
import { api, download } from "@/lib/client";
import { sampleOrders } from "@/lib/sample";
import { cn, dateLabel, money } from "@/lib/utils";
import type {
  Milestone,
  MilestoneStatus,
  PurchaseOrder,
  WorkspacePayload,
} from "@/lib/types";

const labels: Record<MilestoneStatus, string> = {
  unfunded: "Not authorized",
  approval_pending: "Awaiting approval",
  funded: "Authorized",
  reviewing: "AI reviewing",
  changes_requested: "Needs attention",
  verified: "Verified",
  settling: "Settling",
  settlement_pending: "Payment pending",
  settled: "Settled",
  disputed: "On hold",
  expired: "Expired",
};
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "orders", label: "Purchase orders", icon: Package },
  { id: "vault", label: "Milestone vault", icon: Wallet },
  { id: "evidence", label: "Evidence center", icon: FolderOpen },
  { id: "activity", label: "Activity log", icon: History },
] as const;
type View = (typeof nav)[number]["id"];
type Modal =
  | "start"
  | "create"
  | "fund"
  | "upload"
  | "invite"
  | "help"
  | "settings"
  | "dispute"
  | null;
function Status({ value, label }: { value: MilestoneStatus; label?: string }) {
  return (
    <span className={cn("badge", "status-" + value)}>
      <span />
      {label || labels[value]}
    </span>
  );
}
function orderState(o: PurchaseOrder): MilestoneStatus {
  return o.milestones.every((m) => m.status === "settled")
    ? "settled"
    : o.milestones.some((m) =>
          ["disputed", "changes_requested", "expired"].includes(m.status),
        )
      ? "changes_requested"
      : o.milestones.some((m) => m.status === "reviewing")
        ? "reviewing"
        : o.milestones.every((m) => m.status === "unfunded")
          ? "unfunded"
          : "funded";
}
function Progress({ order }: { order: PurchaseOrder }) {
  const count = order.milestones.filter((m) => m.status === "settled").length;
  return (
    <div className="mini-progress">
      <div>
        {order.milestones.map((m) => (
          <span
            key={m.id}
            className={
              m.status === "settled"
                ? "complete"
                : m.status !== "unfunded"
                  ? "current"
                  : ""
            }
          />
        ))}
      </div>
      <span>
        {count} of {order.milestones.length} completed
      </span>
    </div>
  );
}
function Busy({ busy, children }: { busy: boolean; children: ReactNode }) {
  return busy ? (
    <>
      <LoaderCircle size={16} className="spin" />
      Working…
    </>
  ) : (
    children
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Package size={34} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function SilkPayApp() {
  const [data, setData] = useState<WorkspacePayload>({
    mode: "sample",
    workspace: null,
    orders: sampleOrders,
    configuration: { payments: false, ai: false, database: false },
  });
  const [view, setView] = useState<View>("overview"),
    [orderId, setOrderId] = useState<string | null>(null),
    [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(
      null,
    );
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [mobileNav, setMobileNav] = useState(false),
    [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(""),
    [accepted, setAccepted] = useState(false),
    [autoSettle, setAutoSettle] = useState(false);
  const sample = data.mode === "sample",
    buyer = data.workspace?.role !== "supplier";
  const order = data.orders.find((o) => o.id === orderId),
    milestone =
      order?.milestones.find((m) => m.id === milestoneId) ||
      order?.milestones.find((m) => m.status !== "settled") ||
      order?.milestones[0];
  const allMilestones = data.orders.flatMap((o) =>
      o.milestones.map((m) => ({ ...m, order: o })),
    ),
    allEvidence = data.orders.flatMap((o) =>
      o.evidence.map((e) => ({ ...e, order: o })),
    ),
    allActivity = data.orders
      .flatMap((o) => o.activity.map((a) => ({ ...a, order: o })))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const refresh = useCallback(async () => {
    const next = await api<WorkspacePayload>("workspace");
    setData(next);
  }, []);
  useEffect(() => {
    let alive = true;
    api<WorkspacePayload>("workspace")
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((e) => {
        if (alive) setNotice({ text: e.message, error: true });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const params = new URLSearchParams(window.location.search);
    if (params.get("order")) setOrderId(params.get("order"));
    if (params.get("payment") === "cancelled")
      setNotice({
        text: "PayPal approval was cancelled. No authorization has been assumed.",
      });
    return () => {
      alive = false;
    };
  }, []);
  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({
        text: e instanceof Error ? e.message : "Please try again.",
        error: true,
      });
    } finally {
      setBusy("");
    }
  }
  function openOrder(o: PurchaseOrder, m?: Milestone) {
    window.scrollTo({ top: 0, behavior: "auto" });
    setOrderId(o.id);
    setMilestoneId(m?.id || null);
    setMobileNav(false);
  }
  function go(next: View) {
    window.scrollTo({ top: 0, behavior: "auto" });
    setView(next);
    setOrderId(null);
    setMobileNav(false);
    setQuery("");
    setFilter("all");
  }
  function action(next: Modal) {
    setAccepted(false);
    setAutoSettle(false);
    setInvite("");
    setModal(sample && next !== "help" && next !== "settings" ? "start" : next);
  }
  async function milestoneAction(name: string) {
    if (sample) {
      action("start");
      return;
    }
    if (!milestone) return;
    await run(name, async () => {
      const result = await api<{ settlement?: { message?: string } }>(
        `milestones/${milestone.id}/${name}`,
        {},
      );
      await refresh();
      setNotice({
        text:
          result.settlement?.message ||
          (name === "review"
            ? "Evidence review complete. See the findings below."
            : "Milestone updated."),
      });
    });
  }
  function exportOrders() {
    const escape = (v: string | number) => {
      const value = String(v);
      return (
        '"' +
        (/^[=+@\-]/.test(value) ? "'" : "") +
        value.replaceAll('"', '""') +
        '"'
      );
    };
    download(
      `silkpay-${sample ? "sample-" : ""}orders.csv`,
      [
        "Mode,Purchase order,Product,Supplier,Country,Total USD,Status",
        ...data.orders.map((o) =>
          [
            sample ? "SAMPLE" : "SANDBOX",
            o.number,
            o.product,
            o.supplier,
            o.country,
            (o.total_cents / 100).toFixed(2),
            labels[orderState(o)],
          ]
            .map(escape)
            .join(","),
        ),
      ].join("\n"),
      "text/csv",
    );
  }
  const visible = data.orders.filter(
    (o) =>
      (o.number + " " + o.product + " " + o.supplier)
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "completed"
          ? orderState(o) === "settled"
          : orderState(o) !== "settled")),
  );
  const totals = {
    value: data.orders.reduce((s, o) => s + o.total_cents, 0),
    held: allMilestones
      .filter((m) =>
        [
          "funded",
          "reviewing",
          "verified",
          "changes_requested",
          "settling",
          "settlement_pending",
        ].includes(m.status),
      )
      .reduce((s, m) => s + m.amount_cents, 0),
    settled: allMilestones
      .filter((m) => m.status === "settled")
      .reduce((s, m) => s + m.amount_cents, 0),
    review: allMilestones.filter(
      (m) =>
        ["funded", "changes_requested"].includes(m.status) &&
        m.order.evidence.some((e) => e.milestone_id === m.id),
    ).length,
  };
  const reviewNext = allMilestones.find(
    (m) =>
      ["funded", "changes_requested"].includes(m.status) &&
      m.order.evidence.some((e) => e.milestone_id === m.id),
  );
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={cn("sidebar", mobileNav && "sidebar-open")}>
        <button
          className="brand-button"
          onClick={() => go("overview")}
          aria-label="SilkPay overview"
        >
          <Brand />
        </button>
        <button className="workspace-switch" onClick={() => action("settings")}>
          <span className="company-avatar">
            {(data.workspace?.company || "Harbor & Co.").slice(0, 1)}
          </span>
          <span>
            <strong>{data.workspace?.company || "Harbor & Co."}</strong>
            <small>{buyer ? "Buyer" : "Supplier"} workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={cn(
                "nav-item",
                view === item.id && !order && "nav-active",
                item.id === "orders" && order && "nav-active",
              )}
              onClick={() => go(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "orders" && (
                <span className="nav-count">{data.orders.length}</span>
              )}
              {item.id === "evidence" && totals.review > 0 && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="trust-card">
            <span className="trust-symbol">
              <ShieldCheck size={22} />
            </span>
            <strong>
              A little certainty.
              <br />A world of possibility.
            </strong>
            <p>Move your next order forward with confidence.</p>
            <button onClick={() => action("help")}>
              How SilkPay works <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="nav-item" onClick={() => action("help")}>
            <CircleHelp size={19} />
            Help & resources
          </button>
          <button className="nav-item" onClick={() => action("settings")}>
            <Settings2 size={19} />
            Workspace settings
          </button>
          <div className="sidebar-paypal">
            <LockKeyhole size={12} /> Sandbox payments with{" "}
            <span className="paypal-word">
              Pay<span>Pal</span>
            </span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {order
                ? "Purchase orders"
                : nav.find((n) => n.id === view)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <span />
              {sample ? "Sample workspace" : "Sandbox mode"}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button notification-button"
              aria-label="View recent activity"
              onClick={() => go("activity")}
            >
              <Bell size={19} />
              {allActivity.length > 0 && <i />}
            </button>
            <button
              className="user-avatar"
              aria-label="Workspace details"
              onClick={() => action("settings")}
            >
              {buyer ? "HC" : "SU"}
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {notice && (
            <div
              className={cn("notice", notice.error && "notice-error")}
              role={notice.error ? "alert" : "status"}
            >
              {notice.error ? (
                <TriangleAlert size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              <span>{notice.text}</span>
              <button
                className="icon-button"
                aria-label="Dismiss message"
                onClick={() => setNotice(null)}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {sample ? (
            <div className="sample-bar">
              <span>
                <span className="sample-label">DEMO</span>Explore a sample
                workspace. Orders, payments and reviews below are examples.
              </span>
              <button onClick={() => action("start")}>
                Start your workspace <ArrowRight size={14} />
              </button>
            </div>
          ) : !data.configuration.payments ? (
            <div className="sample-bar setup-bar">
              <span>
                <LockKeyhole size={15} /> Sandbox checkout is awaiting
                server-side PayPal credentials.
              </span>
              <button onClick={() => action("settings")}>
                View setup <ArrowRight size={14} />
              </button>
            </div>
          ) : null}
          {order && milestone ? (
            <>
              <button className="back-link" onClick={() => setOrderId(null)}>
                <ArrowLeft size={15} />
                All purchase orders
              </button>
              <div className="page-heading order-heading">
                <div>
                  <div className="eyebrow">
                    {order.number} <span>•</span> {order.country}
                  </div>
                  <h1>{order.product}</h1>
                  <p>
                    {order.quantity.toLocaleString()} units{" "}
                    <span className="dot-sep">·</span> {order.supplier}
                  </p>
                </div>
                <div className="heading-actions">
                  {buyer && (
                    <Button variant="outline" onClick={() => action("invite")}>
                      <Link2 size={16} />
                      Invite supplier
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      download(
                        `${order.number}-${sample ? "sample" : "sandbox"}.json`,
                        JSON.stringify(
                          { environment: sample ? "sample" : "sandbox", order },
                          null,
                          2,
                        ),
                        "application/json",
                      )
                    }
                  >
                    <Download size={16} />
                    Export order
                  </Button>
                </div>
              </div>
              <div className="order-summary">
                <div>
                  <small>Order value</small>
                  <strong>
                    {money(order.total_cents)}
                    <em> USD</em>
                  </strong>
                </div>
                <div>
                  <small>Buyer</small>
                  <strong>{order.buyer}</strong>
                </div>
                <div>
                  <small>Supplier</small>
                  <strong>{order.supplier}</strong>
                </div>
                <div>
                  <small>Progress</small>
                  <Progress order={order} />
                </div>
              </div>
              <div className="order-layout">
                <section className="milestones-panel">
                  <div className="section-label">
                    ORDER MILESTONES <span>{order.milestones.length}</span>
                  </div>
                  {order.milestones.map((m, i) => (
                    <button
                      key={m.id}
                      className={cn(
                        "milestone-choice",
                        milestone.id === m.id && "milestone-selected",
                      )}
                      onClick={() => setMilestoneId(m.id)}
                    >
                      <span
                        className={cn(
                          "step-number",
                          m.status === "settled" && "step-done",
                        )}
                      >
                        {m.status === "settled" ? (
                          <Check size={16} />
                        ) : (
                          String(i + 1).padStart(2, "0")
                        )}
                      </span>
                      <span className="milestone-choice-content">
                        <strong>{m.title}</strong>
                        <span>
                          {money(m.amount_cents)}{" "}
                          <em>· {dateLabel(m.due_date)}</em>
                        </span>
                        <Status value={m.status} />
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  <div className="mini-explainer">
                    <ShieldHalf size={21} />
                    <p>
                      Every milestone has its own payment authorization and
                      evidence review.
                    </p>
                  </div>
                </section>
                <section className="panel milestone-detail">
                  <div className="detail-heading">
                    <div>
                      <span className="eyebrow">
                        MILESTONE {milestone.position + 1}
                      </span>
                      <h2>{milestone.title}</h2>
                      <p>Due {dateLabel(milestone.due_date)}</p>
                    </div>
                    <div className="detail-amount">
                      {money(milestone.amount_cents)}
                      <Status value={milestone.status} />
                    </div>
                  </div>
                  <div className="detail-section">
                    <h3>
                      <ClipboardCheck size={18} />
                      Purchase order specifications
                    </h3>
                    <ul className="spec-list">
                      {milestone.specs.map((spec, i) => (
                        <li key={spec.id}>
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          {spec.requirement}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="detail-section">
                    <div className="section-header">
                      <h3>
                        <FolderOpen size={18} />
                        Fulfillment evidence{" "}
                        <span className="count-pill">
                          {
                            order.evidence.filter(
                              (e) => e.milestone_id === milestone.id,
                            ).length
                          }
                        </span>
                      </h3>
                      {!buyer &&
                        [
                          "unfunded",
                          "approval_pending",
                          "funded",
                          "verified",
                          "changes_requested",
                        ].includes(milestone.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => action("upload")}
                          >
                            <Upload size={14} />
                            Upload proof
                          </Button>
                        )}
                    </div>
                    {order.evidence
                      .filter((e) => e.milestone_id === milestone.id)
                      .map((e) => (
                        <div className="file-row" key={e.id}>
                          <span className="file-icon">
                            <FileText size={20} />
                          </span>
                          <div>
                            <strong>{e.filename}</strong>
                            <small>
                              {sample
                                ? "Example file"
                                : `${Math.ceil(e.size / 1024)} KB`}{" "}
                              <span>·</span> {dateLabel(e.created_at)}
                              {e.note && ` · ${e.note}`}
                            </small>
                          </div>
                          {sample ? (
                            <span className="muted tiny">Example</span>
                          ) : (
                            <a
                              className="icon-button"
                              href={`/api/evidence/${e.id}`}
                              aria-label={`Download ${e.filename}`}
                            >
                              <Download size={17} />
                            </a>
                          )}
                        </div>
                      ))}
                    {!order.evidence.some(
                      (e) => e.milestone_id === milestone.id,
                    ) && (
                      <div className="evidence-empty">
                        <Upload size={25} />
                        <strong>Proof makes progress.</strong>
                        <p>
                          {buyer
                            ? "Invite your supplier to upload inspection reports, delivery records and photos."
                            : "Upload an inspection report, delivery record or clear photo for review."}
                        </p>
                        {buyer ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => action("invite")}
                          >
                            Invite supplier <ArrowRight size={14} />
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => action("upload")}
                          >
                            Upload evidence
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="detail-section ai-section">
                    <div className="section-header">
                      <h3>
                        <Sparkles size={18} />
                        SilkPay AI review
                      </h3>
                      <span className="ai-label">SPEC-BY-SPEC</span>
                    </div>
                    {milestone.review ? (
                      <>
                        <div
                          className={cn(
                            "review-summary",
                            milestone.review.passed && "review-passed",
                          )}
                        >
                          <span>
                            {milestone.review.passed ? (
                              <ShieldCheck size={21} />
                            ) : (
                              <TriangleAlert size={21} />
                            )}
                          </span>
                          <div>
                            <strong>
                              {milestone.review.passed
                                ? "Evidence meets the requirements"
                                : "More evidence is needed"}
                            </strong>
                            <p>{milestone.review.summary}</p>
                          </div>
                        </div>
                        {milestone.review.findings.map((f) => (
                          <div className="finding" key={f.specId}>
                            <span
                              className={
                                f.outcome === "met"
                                  ? "finding-pass"
                                  : "finding-hold"
                              }
                            >
                              {f.outcome === "met" ? (
                                <CheckCircle2 size={17} />
                              ) : (
                                <Clock3 size={17} />
                              )}
                            </span>
                            <div>
                              <strong>
                                {milestone.specs.find((s) => s.id === f.specId)
                                  ?.requirement || f.specId}
                              </strong>
                              <p>{f.explanation}</p>
                              <small>
                                {Math.round(f.confidence * 100)}% model
                                confidence ·{" "}
                                {f.evidenceIds
                                  .map(
                                    (id) =>
                                      order.evidence.find((e) => e.id === id)
                                        ?.filename || id,
                                  )
                                  .join(", ")}
                              </small>
                            </div>
                          </div>
                        ))}
                        {milestone.review.concerns.length > 0 && (
                          <div className="warning-box">
                            {milestone.review.concerns.join(" ")}
                          </div>
                        )}
                        <p className="ai-footnote">
                          {sample
                            ? "Example review"
                            : `${milestone.review.model} · ${dateLabel(milestone.review.generatedAt)} · evidence v${milestone.review.evidenceVersion}`}
                          <br />
                          AI compares submitted evidence; it cannot prove
                          real-world delivery or document authenticity.
                        </p>
                      </>
                    ) : (
                      <div className="ai-placeholder">
                        <span className="sparkle-tile">
                          <Sparkles size={23} />
                        </span>
                        <div>
                          <strong>A second set of eyes on every detail.</strong>
                          <p>
                            AI checks your supplier’s proof against each
                            requirement. Unclear or missing evidence keeps
                            settlement on hold.
                          </p>
                        </div>
                      </div>
                    )}
                    {[
                      "funded",
                      "changes_requested",
                      "verified",
                      "reviewing",
                    ].includes(milestone.status) && (
                      <Button
                        variant="outline"
                        className="review-button"
                        disabled={!!busy}
                        onClick={() => milestoneAction("review")}
                      >
                        <Busy busy={busy === "review"}>
                          <Sparkles size={16} />
                          {milestone.review
                            ? "Run a fresh review"
                            : "Review evidence with AI"}
                        </Busy>
                      </Button>
                    )}
                  </div>
                  {milestone.payment_error && (
                    <div className="warning-box">{milestone.payment_error}</div>
                  )}
                  <div className="payment-footer">
                    <div>
                      <LockKeyhole size={17} />
                      <span>
                        <strong>
                          {milestone.status === "settled"
                            ? "Settlement confirmed"
                            : milestone.authorization_id
                              ? "PayPal Sandbox authorization"
                              : "PayPal Sandbox payment"}
                        </strong>
                        <small>
                          {milestone.authorization_id
                            ? `Authorization ${milestone.authorization_id}${milestone.authorization_expires_at ? " · expires " + dateLabel(milestone.authorization_expires_at) : ""}`
                            : "A temporary hold, released only after verified fulfillment."}
                        </small>
                      </span>
                    </div>
                    {buyer &&
                      ["unfunded", "approval_pending"].includes(
                        milestone.status,
                      ) && (
                        <Button
                          variant="paypal"
                          disabled={!!busy}
                          onClick={() => action("fund")}
                        >
                          {milestone.status === "approval_pending"
                            ? "Continue approval"
                            : "Authorize milestone"}
                          <ArrowRight size={16} />
                        </Button>
                      )}
                    {buyer && milestone.status === "verified" && (
                      <Button
                        disabled={!!busy}
                        onClick={() => milestoneAction("settle")}
                      >
                        <Busy busy={busy === "settle"}>
                          Settle {money(milestone.amount_cents)}
                          <ArrowRight size={16} />
                        </Busy>
                      </Button>
                    )}
                    {milestone.status === "settled" && (
                      <span className="settled-mark">
                        <CheckCheck size={18} />
                        Settled
                      </span>
                    )}
                  </div>
                  <div className="detail-utilities">
                    {milestone.paypal_order_id && (
                      <button
                        disabled={!!busy}
                        onClick={() => milestoneAction("reconcile")}
                      >
                        <RefreshCw size={13} />
                        Refresh payment status
                      </button>
                    )}
                    {buyer &&
                      milestone.authorization_id &&
                      ["funded", "verified", "changes_requested"].includes(
                        milestone.status,
                      ) && (
                        <button
                          disabled={!!busy}
                          onClick={() => milestoneAction("reauthorize")}
                        >
                          Refresh authorization
                        </button>
                      )}
                    {buyer &&
                      [
                        "unfunded",
                        "funded",
                        "verified",
                        "changes_requested",
                      ].includes(milestone.status) && (
                        <button onClick={() => action("dispute")}>
                          Pause milestone
                        </button>
                      )}
                    {buyer &&
                      milestone.status === "disputed" &&
                      !milestone.capture_id && (
                        <button
                          disabled={!!busy}
                          onClick={() => milestoneAction("resolve")}
                        >
                          Resume for a new review
                        </button>
                      )}
                  </div>
                </section>
              </div>
              <div className="panel order-audit">
                <div className="section-header">
                  <h2>Order activity</h2>
                  <span className="muted tiny">
                    {sample ? "Example history" : "Recorded as it happens"}
                  </span>
                </div>
                <Activity
                  items={order.activity.map((a) => ({ ...a, order }))}
                />
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {buyer ? "YOUR TRADE, CONNECTED" : "YOUR SUPPLIER PORTAL"}
                  </div>
                  <h1>
                    {view === "overview"
                      ? "Good things are moving."
                      : view === "orders"
                        ? "Purchase orders"
                        : view === "vault"
                          ? "Your milestone vault"
                          : view === "evidence"
                            ? "Evidence, all in one place."
                            : "Every step, accounted for."}
                  </h1>
                  <p>
                    {view === "overview"
                      ? "From first sample to final shipment. Keep every milestone in view."
                      : view === "orders"
                        ? "Clear agreements. Shared progress. Confident partnerships."
                        : view === "vault"
                          ? "Track payment holds and confirmed settlements across your orders."
                          : view === "evidence"
                            ? "The documents and details that move your orders forward."
                            : "A shared record of your orders, evidence and payments."}
                  </p>
                </div>
                <div className="heading-actions">
                  {view === "overview" ? (
                    <span className="date-chip">
                      <Globe2 size={15} />
                      Cross-border, connected
                    </span>
                  ) : (
                    <Button variant="outline" onClick={exportOrders}>
                      <Download size={15} />
                      Export orders
                    </Button>
                  )}
                  {buyer && (
                    <Button onClick={() => action("create")}>
                      <Plus size={17} />
                      New purchase order
                    </Button>
                  )}
                </div>
              </div>
              {(view === "overview" || view === "vault") && (
                <div className="stats-grid">
                  <Stat
                    label="Total order value"
                    value={money(totals.value)}
                    icon={<Package size={19} />}
                    note={`${data.orders.length} purchase orders`}
                    tone="blue"
                  />
                  <Stat
                    label="Funds authorized"
                    value={money(totals.held)}
                    icon={<ShieldCheck size={20} />}
                    note="Held in PayPal Sandbox"
                    tone="sky"
                  />
                  <Stat
                    label="Successfully settled"
                    value={money(totals.settled)}
                    icon={<ArrowDownLeft size={20} />}
                    note={`${allMilestones.filter((m) => m.status === "settled").length} milestones completed`}
                    tone="green"
                  />
                  <Stat
                    label="Ready for review"
                    value={String(totals.review).padStart(2, "0")}
                    icon={<FileCheck2 size={20} />}
                    note="Your next steps, at a glance"
                    tone="amber"
                  />
                </div>
              )}
              {view === "overview" && (
                <div className="overview-feature">
                  <div className="feature-copy">
                    <span className="feature-kicker">
                      <span className="pulse-dot" />
                      TRADE WITH CONFIDENCE
                    </span>
                    <h2>
                      Good partnerships.
                      <br />
                      Even better peace of mind.
                    </h2>
                    <p>
                      Agree on the details. Verify the progress.
                      <br />
                      Let every payment follow the proof.
                    </p>
                    <button onClick={() => action("help")}>
                      See how SilkPay works <ArrowRight size={16} />
                    </button>
                  </div>
                  <div
                    className="journey"
                    aria-label="Agree, authorize, verify, settle"
                  >
                    <div className="journey-line" />
                    <div className="journey-step">
                      <span>
                        <FileText size={23} />
                      </span>
                      <strong>Agree</strong>
                      <small>Set clear specs</small>
                    </div>
                    <div className="journey-step">
                      <span>
                        <LockKeyhole size={23} />
                      </span>
                      <strong>Authorize</strong>
                      <small>Secure a hold</small>
                    </div>
                    <div className="journey-step journey-ai">
                      <span>
                        <Sparkles size={23} />
                        <i />
                      </span>
                      <strong>Verify</strong>
                      <small>AI checks proof</small>
                    </div>
                    <div className="journey-step">
                      <span>
                        <CheckCheck size={23} />
                      </span>
                      <strong>Settle</strong>
                      <small>Move forward</small>
                    </div>
                  </div>
                </div>
              )}
              {(view === "overview" || view === "orders") && (
                <div className="panel orders-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {view === "overview"
                          ? "Recent purchase orders"
                          : "All purchase orders"}
                        <span className="count-pill">{data.orders.length}</span>
                      </h2>
                      <p>A shared view of what’s happening, and what’s next.</p>
                    </div>
                    {view === "overview" && (
                      <button
                        className="text-button"
                        onClick={() => go("orders")}
                      >
                        View all orders <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                  <div className="table-toolbar">
                    <div className="tabs" aria-label="Filter orders">
                      {[
                        ["all", "All orders"],
                        ["active", "In progress"],
                        ["completed", "Completed"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={filter === value ? "selected" : ""}
                          onClick={() => setFilter(value)}
                        >
                          {label}
                          {value === "all" && <span>{data.orders.length}</span>}
                        </button>
                      ))}
                    </div>
                    <label className="search-box">
                      <Search size={16} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search orders…"
                        aria-label="Search orders"
                      />
                      <span>⌕</span>
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table className="orders-table">
                      <thead>
                        <tr>
                          <th>Purchase order</th>
                          <th>Supplier</th>
                          <th>
                            Order value <ChevronDown size={12} />
                          </th>
                          <th>Milestone progress</th>
                          <th>Status</th>
                          <th>
                            <span className="sr-only">Open order</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible
                          .slice(0, view === "overview" ? 5 : 50)
                          .map((o) => (
                            <tr key={o.id} onClick={() => openOrder(o)}>
                              <td>
                                <div className="product-cell">
                                  <ProductArt product={o.product} />
                                  <div>
                                    <button
                                      className="order-name"
                                      onClick={() => openOrder(o)}
                                    >
                                      {o.product}
                                    </button>
                                    <span>
                                      {o.number} <i>·</i>{" "}
                                      {o.quantity.toLocaleString()} units
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <strong>{o.supplier}</strong>
                                <span>
                                  <Globe2 size={11} />
                                  {o.country}
                                </span>
                              </td>
                              <td className="amount-cell">
                                {money(o.total_cents)}
                                <span>USD</span>
                              </td>
                              <td>
                                <Progress order={o} />
                              </td>
                              <td>
                                <Status
                                  value={orderState(o)}
                                  label={
                                    orderState(o) === "funded"
                                      ? "In progress"
                                      : orderState(o) === "settled"
                                        ? "Completed"
                                        : undefined
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  className="row-arrow"
                                  aria-label={`Open ${o.number}`}
                                  onClick={() => openOrder(o)}
                                >
                                  <ArrowUpRight size={18} />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {!visible.length && (
                    <Empty
                      title={
                        query
                          ? "No matching orders"
                          : "Your next partnership starts here."
                      }
                    >
                      {query
                        ? "Try a different product, supplier or order number."
                        : "Create a purchase order to agree on requirements and payment milestones."}
                    </Empty>
                  )}
                  <div className="table-footer">
                    <span>
                      Showing{" "}
                      {Math.min(visible.length, view === "overview" ? 5 : 50)}{" "}
                      of {visible.length} orders
                    </span>
                    <span>
                      <LockKeyhole size={12} />
                      {sample
                        ? "Sample data · no real payments"
                        : "Private to your workspace"}
                    </span>
                  </div>
                </div>
              )}
              {view === "overview" && (
                <div className="lower-grid">
                  <div className="panel next-step">
                    <div className="section-header">
                      <h2>Your next move</h2>
                      <span className="new-tag">ACTION CENTER</span>
                    </div>
                    {reviewNext ? (
                      <>
                        <div className="next-step-body">
                          <span className="review-tile">
                            <Sparkles size={23} />
                          </span>
                          <div>
                            <h3>A milestone is ready for a closer look.</h3>
                            <p>
                              {reviewNext.order.supplier} has submitted evidence
                              for
                              <br className="desktop-only" />{" "}
                              <strong>{reviewNext.title.toLowerCase()}</strong>{" "}
                              on {reviewNext.order.number}.
                            </p>
                          </div>
                        </div>
                        <div className="next-step-footer">
                          <span>
                            <span className="country-dot" />
                            {reviewNext.order.country} <ArrowRight size={13} />{" "}
                            United States
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              openOrder(reviewNext.order, reviewNext)
                            }
                          >
                            Review milestone <ArrowRight size={14} />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <Empty title="You’re all caught up.">
                        Your next milestone action will appear here.
                      </Empty>
                    )}
                  </div>
                  <div className="panel activity-preview">
                    <div className="section-header">
                      <h2>Latest activity</h2>
                      <button
                        className="text-button"
                        onClick={() => go("activity")}
                      >
                        View all <ArrowRight size={14} />
                      </button>
                    </div>
                    <Activity items={allActivity.slice(0, 2)} />
                    {!allActivity.length && (
                      <p className="muted">
                        Your order history will appear here.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {view === "vault" && (
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Every payment has a purpose.</h2>
                      <p>
                        Authorizations are temporary holds. A settled status
                        requires PayPal confirmation.
                      </p>
                    </div>
                    <ShieldCheck size={28} className="blue-icon" />
                  </div>
                  <div className="vault-list">
                    {allMilestones.map((m) => (
                      <button
                        className="vault-row"
                        key={m.id}
                        onClick={() => openOrder(m.order, m)}
                      >
                        <span
                          className={cn(
                            "vault-icon",
                            m.status === "settled" && "vault-settled",
                          )}
                        >
                          {m.status === "settled" ? (
                            <CheckCheck size={20} />
                          ) : (
                            <Wallet size={20} />
                          )}
                        </span>
                        <span>
                          <strong>{m.title}</strong>
                          <small>
                            {m.order.number} · {m.order.supplier}
                          </small>
                        </span>
                        <span className="vault-amount">
                          {money(m.amount_cents)}
                          <small>USD</small>
                        </span>
                        <Status value={m.status} />
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                  {!allMilestones.length && (
                    <Empty title="No milestones yet.">
                      Create an order to add your first milestone.
                    </Empty>
                  )}
                  <div className="info-footer">
                    <ShieldHalf size={18} />
                    PayPal Sandbox only. This is an authorization-and-capture
                    workflow, not a licensed escrow account.
                  </div>
                </div>
              )}
              {view === "evidence" && (
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Fulfillment documents{" "}
                        <span className="count-pill">{allEvidence.length}</span>
                      </h2>
                      <p>Private evidence, connected to the right milestone.</p>
                    </div>
                    <FolderOpen size={26} className="blue-icon" />
                  </div>
                  {allEvidence.map((e) => (
                    <div className="evidence-library-row" key={e.id}>
                      <span className="file-icon">
                        <FileText size={22} />
                      </span>
                      <div>
                        <strong>{e.filename}</strong>
                        <small>
                          {e.order.number} · {e.order.product} ·{" "}
                          {dateLabel(e.created_at)}
                        </small>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          openOrder(
                            e.order,
                            e.order.milestones.find(
                              (m) => m.id === e.milestone_id,
                            ),
                          )
                        }
                      >
                        View milestone <ArrowRight size={14} />
                      </Button>
                    </div>
                  ))}
                  {!allEvidence.length && (
                    <Empty title="Ready when your supplier is.">
                      Invite a supplier from an order to start collecting
                      fulfillment proof.
                    </Empty>
                  )}
                </div>
              )}
              {view === "activity" && (
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Workspace activity</h2>
                      <p>
                        {sample
                          ? "An example of the history your workspace records."
                          : "An append-only history of each meaningful action."}
                      </p>
                    </div>
                    <History size={25} className="blue-icon" />
                  </div>
                  <Activity items={allActivity} />
                  {!allActivity.length && (
                    <Empty title="A fresh start.">
                      Your first order will start your workspace history.
                    </Empty>
                  )}
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Brand small /> <span>Clear milestones. Confident trade.</span>
            </span>
            <span>
              <LockKeyhole size={12} />
              {loading
                ? "Connecting workspace…"
                : sample
                  ? "Sample workspace"
                  : "PayPal Sandbox only"}
              <span className="dot-sep">·</span>
              <button onClick={() => action("help")}>Built on trust</button>
            </span>
          </footer>
        </main>
      </div>
      <Dialog
        open={!!modal}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
        title={
          modal === "start"
            ? "Your next order starts here."
            : modal === "create"
              ? "Create a purchase order"
              : modal === "fund"
                ? "Authorize this milestone"
                : modal === "upload"
                  ? "Submit fulfillment evidence"
                  : modal === "invite"
                    ? "Bring your supplier on board"
                    : modal === "settings"
                      ? "Your workspace"
                      : modal === "dispute"
                        ? "Pause this milestone"
                        : "A clearer way to trade."
        }
        description={
          modal === "create"
            ? "Agree on clear requirements before any funds are authorized."
            : undefined
        }
        wide={modal === "create"}
      >
        {notice?.error && (
          <div className="warning-box" role="alert">
            {notice.text}
          </div>
        )}
        {modal === "start" && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const company = String(
                new FormData(e.currentTarget).get("company"),
              );
              run("start", async () => {
                await api("workspace", { company });
                await refresh();
                setOrderId(null);
                setView("orders");
                setModal("create");
                setNotice({ text: "Your private sandbox workspace is ready." });
              });
            }}
          >
            <div className="dialog-intro-icon">
              <Globe2 size={28} />
            </div>
            <p>
              Create a private buyer workspace, define an order and invite your
              supplier. All payments use PayPal Sandbox.
            </p>
            <>
              {!data.configuration.database && (
                <div className="warning-box">
                  Workspace storage is awaiting its secure connection. You can
                  explore all sample order details while setup is completed.
                </div>
              )}
            </>
            <label className="field">
              Company name
              <input
                name="company"
                placeholder="e.g. Harbor & Co."
                minLength={2}
                maxLength={80}
                required
                autoFocus
              />
            </label>
            <div className="info-box">
              <LockKeyhole size={19} />
              <p>
                This sandbox workspace is tied to this browser for seven days.
                Keep the session to return to your orders. Use fictional
                business data for testing.
              </p>
            </div>
            <Button
              type="submit"
              disabled={!!busy || !data.configuration.database}
            >
              <Busy busy={busy === "start"}>
                Create workspace <ArrowRight size={16} />
              </Busy>
            </Button>
          </form>
        )}
        {modal === "create" && (
          <OrderForm
            busy={!!busy}
            onSubmit={(input) =>
              run("create", async () => {
                const result = await api<{ id: string }>("orders", input);
                await refresh();
                setOrderId(result.id);
                setMilestoneId(null);
                setModal(null);
                setNotice({
                  text: "Purchase order created. Invite your supplier and authorize the first milestone.",
                });
              })
            }
          />
        )}
        {modal === "fund" && milestone && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              run("fund", async () => {
                const result = await api<{ url: string }>(
                  `milestones/${milestone.id}/fund`,
                  { autoSettle, accepted },
                );
                const destination = new URL(result.url);
                if (
                  destination.protocol !== "https:" ||
                  destination.hostname !== "www.sandbox.paypal.com"
                )
                  throw new Error("Unexpected payment approval URL.");
                window.location.assign(result.url);
              });
            }}
          >
            <div className="fund-amount">
              <span>{milestone.title}</span>
              <strong>
                {money(milestone.amount_cents)} <small>USD</small>
              </strong>
              <span className="paypal-word">
                Pay<span>Pal</span>
                <em> Sandbox</em>
              </span>
            </div>
            <p>
              PayPal will place a temporary payment hold for the connected
              Sandbox seller. Funds are captured only after this milestone’s
              evidence passes review.
            </p>
            <div className="info-box">
              <Clock3 size={20} />
              <p>
                Authorizations last up to 29 days. Capture should occur within
                the three-day honor period; older authorizations may need
                refreshing. This is not a cash deposit or regulated escrow.
              </p>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={autoSettle}
                onChange={(e) => setAutoSettle(e.target.checked)}
              />
              <span>
                <strong>Settle automatically after verification</strong>
                <small>
                  Allow SilkPay to capture this exact amount when every
                  specification passes with at least 95% model confidence and no
                  concerns.
                </small>
              </span>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                required
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                I understand this Sandbox authorization and the selected
                settlement instruction.
              </span>
            </label>
            {!data.configuration.payments && (
              <div className="warning-box">
                PayPal Sandbox credentials must be configured on the server
                before checkout can open.
              </div>
            )}
            <Button
              type="submit"
              variant="paypal"
              disabled={!accepted || !!busy || !data.configuration.payments}
            >
              <Busy busy={busy === "fund"}>
                Continue to PayPal Sandbox <ArrowUpRight size={17} />
              </Busy>
            </Button>
          </form>
        )}
        {modal === "upload" && milestone && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              form.set("consent", "true");
              run("upload", async () => {
                await api(`milestones/${milestone.id}/evidence`, form);
                await refresh();
                setModal(null);
                setNotice({
                  text: "Evidence uploaded. Run a fresh review to compare it with the specifications.",
                });
              });
            }}
          >
            <p>
              Use clear inspection reports, delivery records and photos that
              address the specifications for <strong>{milestone.title}</strong>.
            </p>
            <label className="file-picker">
              <Upload size={30} />
              <strong>Choose your evidence file</strong>
              <span>PDF, PNG or JPEG up to 2 MB · text/CSV up to 32 KB</span>
              <input
                type="file"
                name="file"
                accept="application/pdf,image/png,image/jpeg,text/plain,text/csv"
                required
              />
            </label>
            <label className="field">
              Context for the reviewer
              <textarea
                name="note"
                maxLength={1000}
                placeholder="Which requirements does this document demonstrate?"
                rows={3}
              />
            </label>
            <label className="check-field">
              <input type="checkbox" required />
              <span>
                I have permission to share this file with the buyer and the AI
                review provider.
              </span>
            </label>
            <p className="muted tiny">
              Up to six files per milestone. Submission does not itself release
              a payment.
            </p>
            <Button type="submit" disabled={!!busy}>
              <Busy busy={busy === "upload"}>
                <Upload size={16} />
                Upload evidence
              </Busy>
            </Button>
          </form>
        )}
        {modal === "invite" && order && (
          <div className="form-stack">
            <div className="dialog-intro-icon">
              <Link2 size={27} />
            </div>
            <p>
              Invite <strong>{order.supplier}</strong> to submit evidence for{" "}
              <strong>{order.number}</strong>. The supplier can access only this
              order and cannot authorize payments.
            </p>
            {invite ? (
              <>
                <label className="field">
                  Private invitation link
                  <input
                    value={invite}
                    readOnly
                    aria-label="Supplier invitation link"
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <Button
                  onClick={() =>
                    run("copy", async () => {
                      await navigator.clipboard.writeText(invite);
                      setNotice({
                        text: "Invitation copied. Share it directly with your supplier.",
                      });
                    })
                  }
                >
                  <Copy size={16} />
                  Copy invitation
                </Button>
                <div className="info-box">
                  <LockKeyhole size={18} />
                  <p>
                    This link grants supplier access. Share it privately. It
                    works once and expires after seven days. Open it in a
                    separate browser profile to test both roles.
                  </p>
                </div>
              </>
            ) : (
              <Button
                disabled={!!busy}
                onClick={() =>
                  run("invite", async () => {
                    const result = await api<{ url: string }>("invitations", {
                      orderId: order.id,
                    });
                    setInvite(result.url);
                    await refresh();
                  })
                }
              >
                <Busy busy={busy === "invite"}>
                  Create supplier invitation <ArrowRight size={16} />
                </Busy>
              </Button>
            )}
          </div>
        )}
        {modal === "dispute" && milestone && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(
                new FormData(e.currentTarget).get("reason"),
              );
              run("dispute", async () => {
                await api(`milestones/${milestone.id}/dispute`, { reason });
                await refresh();
                setModal(null);
                setNotice({
                  text: "Milestone paused. Settlement is blocked until you resume and obtain a fresh review.",
                });
              });
            }}
          >
            <p>
              Pause verification and settlement while you resolve a concern with
              your supplier. This does not void an existing PayPal hold or file
              a PayPal dispute.
            </p>
            <label className="field">
              Reason for pausing
              <textarea
                name="reason"
                minLength={10}
                maxLength={1500}
                rows={4}
                required
                placeholder="Describe the specification or delivery concern."
              />
            </label>
            <Button variant="danger" disabled={!!busy} type="submit">
              <Busy busy={busy === "dispute"}>Pause milestone</Busy>
            </Button>
          </form>
        )}
        {modal === "settings" && (
          <div className="form-stack">
            <div className="settings-row">
              <span>Workspace</span>
              <strong>{data.workspace?.company || "Sample workspace"}</strong>
            </div>
            <div className="settings-row">
              <span>Your role</span>
              <strong>{buyer ? "Buyer" : "Supplier"}</strong>
            </div>
            <div className="settings-row">
              <span>Database</span>
              <span
                className={data.configuration.database ? "connected" : "muted"}
              >
                {data.configuration.database ? "Connected" : "Setup required"}
              </span>
            </div>
            <div className="settings-row">
              <span>PayPal Sandbox</span>
              <span
                className={data.configuration.payments ? "connected" : "muted"}
              >
                {data.configuration.payments
                  ? "Connected"
                  : "Credentials required"}
              </span>
            </div>
            <div className="settings-row">
              <span>AI evidence reviewer</span>
              <span className={data.configuration.ai ? "connected" : "muted"}>
                {data.configuration.ai ? "Configured" : "Connection required"}
              </span>
            </div>
            <div className="info-box">
              <ShieldCheck size={21} />
              <p>
                Credentials are managed on the server, never in this browser.
                This deployment uses one configured Sandbox seller for all
                orders. AI availability also depends on provider access and
                credits.
              </p>
            </div>
            {sample ? (
              <Button onClick={() => setModal("start")}>
                Start a private workspace <ArrowRight size={16} />
              </Button>
            ) : (
              <>
                <p className="muted tiny">
                  This browser session lasts seven days. Leaving removes access
                  from this browser; there is no account recovery in this
                  sandbox prototype.
                </p>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    run("logout", async () => {
                      await api("session", undefined, "DELETE");
                      await refresh();
                      setOrderId(null);
                      setModal(null);
                    })
                  }
                >
                  <LogOut size={16} />
                  Leave workspace
                </Button>
              </>
            )}
          </div>
        )}
        {modal === "help" && (
          <div className="form-stack">
            <p>
              SilkPay gives buyers and suppliers a common view of what was
              agreed, what was delivered, and when payment can move.
            </p>
            <ol className="help-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Make the agreement clear</strong>
                  <p>
                    Record measurable requirements and a fixed USD amount for
                    each milestone.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Authorize with PayPal Sandbox</strong>
                  <p>
                    The buyer approves a temporary payment hold for the
                    configured test seller.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Let the evidence speak</strong>
                  <p>
                    The invited supplier uploads proof. AI checks each
                    specification and flags anything missing or uncertain.
                  </p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>Settle on verified progress</strong>
                  <p>
                    A passing review can trigger capture if the buyer opted in.
                    Otherwise, the buyer confirms settlement.
                  </p>
                </div>
              </li>
            </ol>
            <div className="info-box">
              <ShieldHalf size={20} />
              <p>
                Sandbox only: no real funds. SilkPay is an
                authorization-and-capture demo, not a licensed escrow service.
                AI cannot independently authenticate goods or inspection
                documents.
              </p>
            </div>
            <Button onClick={() => (sample ? action("start") : setModal(null))}>
              {sample ? "Start your workspace" : "Back to workspace"}
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  note,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  note: string;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        <span className={`stat-icon icon-${tone}`}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <p>
        {tone === "green" ? (
          <CheckCircle2 size={12} />
        ) : tone === "amber" ? (
          <span className="amber-dot" />
        ) : null}
        {note}
      </p>
    </div>
  );
}
function Activity({
  items,
}: {
  items: (PurchaseOrder["activity"][number] & { order: PurchaseOrder })[];
}) {
  return (
    <div className="activity-list">
      {items.map((a) => (
        <div className="activity-item" key={a.id}>
          <span
            className={cn(
              "activity-icon",
              a.actor === "SilkPay AI" && "activity-ai",
            )}
          >
            {a.actor === "SilkPay AI" ? (
              <Sparkles size={15} />
            ) : a.actor === "Supplier" ? (
              <FileText size={15} />
            ) : (
              <Check size={15} />
            )}
          </span>
          <div>
            <strong>{a.event}</strong>
            <p>
              {a.order.number} <span>·</span> {a.detail}
            </p>
            <small>
              {dateLabel(a.created_at)} <span>·</span> {a.actor}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}
function OrderForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: unknown) => void;
}) {
  const future = (days: number) =>
    new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const [steps, setSteps] = useState([
    {
      title: "Sample approval",
      amount: "300",
      due_date: future(2),
      requirements: "Product dimensions match the approved specification.",
    },
    {
      title: "Production inspection",
      amount: "400",
      due_date: future(4),
      requirements: "Inspection report confirms zero critical defects.",
    },
    {
      title: "Ready to ship",
      amount: "300",
      due_date: future(6),
      requirements: "Packing list confirms the full ordered quantity.",
    },
  ]);
  function update(i: number, key: string, value: string) {
    setSteps(steps.map((s, j) => (i === j ? { ...s, [key]: value } : s)));
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSubmit({
      product: f.get("product"),
      supplier: f.get("supplier"),
      country: f.get("country"),
      quantity: Number(f.get("quantity")),
      milestones: steps.map((s) => ({
        title: s.title,
        amount_cents: Math.round(Number(s.amount) * 100),
        due_date: s.due_date,
        requirements: s.requirements
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      })),
    });
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">
          Product name
          <input
            name="product"
            placeholder="Organic cotton crewneck"
            minLength={3}
            maxLength={100}
            required
            autoFocus
          />
        </label>
        <label className="field">
          Supplier name
          <input
            name="supplier"
            placeholder="Minghua Textiles"
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label className="field">
          Supplier country
          <select name="country" defaultValue="China">
            {[
              "China",
              "Vietnam",
              "India",
              "Bangladesh",
              "Indonesia",
              "Thailand",
              "Malaysia",
              "Japan",
              "South Korea",
              "Philippines",
              "Pakistan",
              "Taiwan",
              "Singapore",
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Order quantity
          <input
            name="quantity"
            type="number"
            min={1}
            max={1000000}
            step={1}
            defaultValue={100}
            required
          />
        </label>
      </div>
      <div className="form-section-heading">
        <h3>Payment milestones</h3>
        <span>USD · up to 5 milestones</span>
      </div>
      {steps.map((s, i) => (
        <div className="milestone-form" key={i}>
          <div className="milestone-form-heading">
            <span>0{i + 1}</span>
            <strong>Milestone {i + 1}</strong>
            {steps.length > 1 && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove milestone ${i + 1}`}
                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div className="milestone-fields">
            <label className="field">
              Name
              <input
                value={s.title}
                onChange={(e) => update(i, "title", e.target.value)}
                minLength={3}
                maxLength={80}
                required
              />
            </label>
            <label className="field">
              Amount (USD)
              <input
                value={s.amount}
                onChange={(e) => update(i, "amount", e.target.value)}
                type="number"
                min={1}
                max={50000}
                step="0.01"
                required
              />
            </label>
            <label className="field">
              Due date
              <input
                type="date"
                value={s.due_date}
                onChange={(e) => update(i, "due_date", e.target.value)}
                required
              />
            </label>
          </div>
          <label className="field">
            Acceptance requirements{" "}
            <small>One measurable requirement per line, up to 8.</small>
            <textarea
              rows={2}
              value={s.requirements}
              onChange={(e) => update(i, "requirements", e.target.value)}
              minLength={8}
              maxLength={4800}
              required
            />
          </label>
        </div>
      ))}
      {steps.length < 5 && (
        <Button
          variant="outline"
          type="button"
          onClick={() =>
            setSteps([
              ...steps,
              {
                title: "",
                amount: "100",
                due_date: future(7),
                requirements: "",
              },
            ])
          }
        >
          <Plus size={15} />
          Add milestone
        </Button>
      )}
      <div className="form-total">
        <span>Total order value</span>
        <strong>
          {money(
            steps.reduce(
              (sum, s) => sum + Math.round((Number(s.amount) || 0) * 100),
              0,
            ),
          )}{" "}
          <small>USD</small>
        </strong>
      </div>
      <div className="info-box">
        <LockKeyhole size={18} />
        <p>
          Specifications and amounts are fixed after creation. Each milestone is
          authorized separately. No funds move when you create an order.
        </p>
      </div>
      <Button type="submit" disabled={busy}>
        <Busy busy={busy}>
          Create purchase order <ArrowRight size={16} />
        </Busy>
      </Button>
    </form>
  );
}
