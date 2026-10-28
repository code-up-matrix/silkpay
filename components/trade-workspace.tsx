"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import Link from "next/link";
import { Tabs } from "radix-ui";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileCheck2,
  FileText,
  Globe2,
  ImageIcon,
  Info,
  LoaderCircle,
  LockKeyhole,
  Package,
  Play,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Wallet,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { api, download } from "@/lib/client";
import {
  blueprintOrder,
  demoFixtures,
  type DemoFixtureId,
} from "@/lib/blueprint";
import type { InspectionResult } from "@/lib/demo-verification";
import type { Milestone, PurchaseOrder, WorkspacePayload } from "@/lib/types";
import "./trade-workspace.css";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const statusText: Record<string, string> = {
  unfunded: "Awaiting checkout",
  approval_pending: "Approval pending",
  checkout_approved: "Checkout approved",
  funded: "Payment authorized",
  reviewing: "Inspection in progress",
  changes_requested: "More evidence needed",
  verified: "Ready for settlement",
  settling: "Capture in progress",
  settlement_pending: "Payment processing",
  settled: "Milestone complete",
  disputed: "Payment held",
  expired: "Checkout expired",
};
const initialConfig = { payments: false, ai: false, database: false };
type DialogName = "deposit" | "release" | "setup" | "invite" | "help" | null;
type DemoFile = { name: string; size: number; type: string };
function restoredReport(m: Milestone): InspectionResult | null {
  if (!m.review) return null;
  return {
    mode: "sandbox",
    engine: "ai",
    verified: m.review.passed,
    score: Math.min(...m.review.findings.map((f) => f.confidence)),
    readyForPayout: m.review.passed,
    summary: m.review.summary,
    findings: m.review.findings.map((f) => ({
      id: f.specId,
      label: m.specs.find((s) => s.id === f.specId)?.requirement || f.specId,
      outcome: f.outcome,
      confidence: f.confidence,
      explanation: f.explanation,
      evidence: f.evidenceIds,
    })),
    audit: [
      {
        step: "Saved inspection",
        detail: `Evidence version ${m.review.evidenceVersion} · ${m.review.model}`,
      },
      ...m.review.concerns.map((detail) => ({ step: "Concern", detail })),
    ],
  };
}
export function TradeWorkspace() {
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [tab, setTab] = useState("trade");
  const [forceDemo, setForceDemo] = useState(false);
  const [fixtures, setFixtures] = useState<DemoFixtureId[]>([]);
  const [customFiles, setCustomFiles] = useState<DemoFile[]>([]);
  const [demoApproved, setDemoApproved] = useState(false);
  const [demoSettled, setDemoSettled] = useState(false);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<DialogName>(null);
  const [invite, setInvite] = useState("");
  const [dragging, setDragging] = useState(false);
  const [consent, setConsent] = useState(false);
  const [receiptTime, setReceiptTime] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const config = data?.configuration || initialConfig;
  const demo = forceDemo || data?.mode !== "sandbox";
  const order: PurchaseOrder = demo
    ? blueprintOrder
    : data?.orders.find((o) => o.number === "SK-8821") ||
      data?.orders[0] ||
      blueprintOrder;
  const m =
    order.milestones.find((m) => m.position === 1) || order.milestones[0];
  const hasLiveOrder = !demo && order.id !== blueprintOrder.id;
  const supplier = !demo && data?.workspace?.role === "supplier";
  const report = inspection || (!demo ? restoredReport(m) : null);
  const approved = demo
    ? demoApproved
    : !!(m.approved_at || m.authorization_id);
  const settled = demo ? demoSettled : m.status === "settled";
  const status = demo
    ? demoSettled
      ? "settled"
      : report?.verified
        ? "verified"
        : demoApproved
          ? "checkout_approved"
          : "unfunded"
    : m.status;
  const evidence = demo
    ? []
    : order.evidence.filter((e) => e.milestone_id === m.id);
  const evidenceCount = demo
    ? fixtures.length + customFiles.length
    : evidence.length;
  const checkoutExpired =
    !demo &&
    !!m.checkout_expires_at &&
    Date.parse(m.checkout_expires_at) <= Date.now();
  const ready =
    approved &&
    report?.verified &&
    !settled &&
    !checkoutExpired &&
    (demo || m.status === "verified");
  const checking = busy === "inspection";
  const canUpload = demo
    ? !demoSettled
    : supplier &&
      [
        "unfunded",
        "approval_pending",
        "checkout_approved",
        "funded",
        "changes_requested",
        "verified",
      ].includes(m.status);
  const reload = useCallback(async () => {
    const next = await api<WorkspacePayload>("workspace");
    setData(next);
    return next;
  }, []);
  useEffect(() => {
    reload().catch((e) => setMessage(e.message));
    if (new URLSearchParams(location.search).get("payment") === "cancelled")
      setMessage(
        "Checkout was cancelled. Your milestone is saved and no capture was attempted.",
      );
  }, [reload]);
  async function task(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "The request could not be completed. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }
  async function openSandbox() {
    await task("workspace", async () => {
      if (data?.mode !== "sandbox")
        await api("workspace", { company: "Apex Goods LLC" });
      const current = await reload();
      if (!current.orders.length && current.workspace?.role === "buyer") {
        await api("orders/seed", {});
        await reload();
      }
      setForceDemo(false);
      setInspection(null);
      setDialog(null);
      setTab("trade");
    });
  }
  async function startCheckout() {
    await task("checkout", async () => {
      const result = await api<{ url: string }>("paypal/create-order", {
        milestoneId: m.id,
        accepted: true,
      });
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "www.sandbox.paypal.com"
      )
        throw new Error("The checkout URL could not be validated.");
      location.assign(url.href);
    });
  }
  function selectFixture(id: DemoFixtureId) {
    if (busy || settled) return;
    if (!fixtures.includes(id) && evidenceCount >= 6) {
      setMessage("A milestone supports up to six evidence files.");
      return;
    }
    setFixtures((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
    );
    setInspection(null);
  }
  async function uploadFiles(files: File[]) {
    if (!files.length || !canUpload) return;
    if (files.length + evidenceCount > 6) {
      setMessage("Choose up to six files in total.");
      return;
    }
    if (
      files.some(
        (f) =>
          ![
            "application/pdf",
            "image/png",
            "image/jpeg",
            "text/plain",
            "text/csv",
          ].includes(f.type) ||
          f.size === 0 ||
          f.size > (f.type.startsWith("text/") ? 32768 : 2_000_000),
      )
    ) {
      setMessage(
        "Use PDFs, PNGs or JPEGs up to 2 MB, or text/CSV reports up to 32 KB.",
      );
      return;
    }
    if (demo) {
      setCustomFiles((v) => [
        ...v,
        ...files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      ]);
      setInspection(null);
      setMessage(
        "Custom files stay in this browser during the demo. Use the Sandbox workspace for private upload and AI review.",
      );
      return;
    }
    if (!consent) {
      setMessage(
        "Confirm permission to share this evidence for AI review before uploading.",
      );
      return;
    }
    await task("upload", async () => {
      try {
        for (const file of files) {
          const form = new FormData();
          form.set("file", file);
          form.set("consent", "true");
          form.set("note", "Supplier evidence for " + order.number);
          await api(`milestones/${m.id}/evidence`, form);
        }
        setInspection(null);
        setMessage("Evidence saved securely. A fresh inspection is required.");
      } finally {
        await reload();
      }
    });
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(e.dataTransfer.files));
  }
  async function runInspection() {
    await task("inspection", async () => {
      const result = await api<InspectionResult>(
        "agent/verify",
        demo
          ? { mode: "demo", fixtures, unknownFiles: customFiles.length }
          : { mode: "sandbox", milestoneId: m.id },
      );
      setInspection(result);
      if (!demo) await reload();
    });
  }
  async function release() {
    await task("capture", async () => {
      if (demo) {
        setDemoSettled(true);
        setReceiptTime(new Date().toISOString());
      } else {
        await api("paypal/capture-order", {
          milestoneId: m.id,
          orderId: m.paypal_order_id,
        });
        await reload();
      }
      setDialog(null);
      setTab("settlement");
    });
  }
  async function createInvite() {
    setDialog("invite");
    await task("invite", async () => {
      const result = await api<{ url: string }>("invitations", {
        orderId: order.id,
      });
      setInvite(result.url);
    });
  }
  function resetDemo() {
    setFixtures([]);
    setCustomFiles([]);
    setDemoApproved(false);
    setDemoSettled(false);
    setInspection(null);
    setMessage("");
    setReceiptTime("");
    setTab("trade");
  }
  function receipt() {
    download(
      `${order.number}-${demo ? "DEMO" : "sandbox"}-receipt.json`,
      JSON.stringify(
        {
          application: "SilkPay",
          environment: demo
            ? "SIMULATED DEMO — no PayPal transaction"
            : "PayPal Sandbox",
          purchaseOrder: order.number,
          milestone: m.title,
          amount: money(m.amount_cents),
          status: settled ? "completed" : status,
          paypalTransactionId: demo ? null : m.capture_id,
          generatedAt: receiptTime || new Date().toISOString(),
          inspection: report,
        },
        null,
        2,
      ),
      "application/json",
    );
  }
  const pill = (
    <span
      className={`sp-pill ${settled || status === "verified" ? "sp-pill-green" : "sp-pill-blue"}`}
    >
      <span />
      {statusText[status]}
    </span>
  );
  return (
    <div className="sp-app">
      <a href="#trade-main" className="sp-skip">
        Skip to workspace
      </a>
      <header className="sp-header">
        <div className="sp-header-inner">
          <Link href="/" aria-label="SilkPay home">
            <Brand />
          </Link>
          <span className="sp-header-divider" />
          <span className="sp-header-title">
            US ⇄ Asia Trade Settlement Agent
          </span>
          <div className="sp-header-actions">
            <button
              className="sp-help"
              onClick={() => setDialog("help")}
              aria-label="How SilkPay works"
            >
              <CircleHelp size={19} />
            </button>
            <span
              className={`sp-environment ${config.payments ? "is-active" : ""}`}
            >
              <span />
              {config.payments
                ? "PayPal Sandbox Active"
                : "PayPal Sandbox · setup pending"}
            </span>
            <div
              className="sp-avatar"
              title={supplier ? order.supplier : order.buyer}
            >
              {supplier ? "DP" : "AG"}
            </div>
          </div>
        </div>
      </header>
      <main id="trade-main" className="sp-main">
        <div className="sp-topline">
          <span>
            <Globe2 size={15} /> CROSS-BORDER TRADE WORKSPACE
          </span>
          <button onClick={() => setDialog("setup")}>
            <ShieldCheck size={15} /> Connection status{" "}
            <ChevronRight size={14} />
          </button>
        </div>
        <section className="sp-heading">
          <div>
            <h1>Good trade starts with trust.</h1>
            <p>One purchase order. Clear evidence. Confident settlement.</p>
          </div>
          <div className="sp-corridor">
            <div className="sp-country">US</div>
            <span>San Francisco, USA</span>
            <ArrowRightLeft size={17} />
            <div className="sp-country">CN</div>
            <span>Shenzhen, CN</span>
          </div>
        </section>
        <div className={`sp-modebar ${!demo ? "sp-modebar-live" : ""}`}>
          <div>
            <span className="sp-mode-tag">
              {demo
                ? "INTERACTIVE DEMO"
                : supplier
                  ? "SUPPLIER WORKSPACE"
                  : "PRIVATE SANDBOX"}
            </span>
            <span>
              {demo
                ? "Explore the complete milestone journey with clearly labeled sample evidence."
                : "Orders and evidence are saved privately. Sandbox payments use test funds only."}
            </span>
          </div>
          <div>
            {demo ? (
              <button
                disabled={!!busy || !config.database}
                onClick={openSandbox}
              >
                {data?.mode === "sandbox"
                  ? "Return to workspace"
                  : "Open Sandbox workspace"}
                <ArrowRight size={15} />
              </button>
            ) : (
              <button
                onClick={() => {
                  setForceDemo(true);
                  setInspection(null);
                  setTab("trade");
                }}
              >
                Try sample demo <Play size={14} />
              </button>
            )}
          </div>
        </div>
        {message && (
          <div className="sp-message" role="status">
            <Info size={17} />
            <span>{message}</span>
            <button aria-label="Dismiss message" onClick={() => setMessage("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <section className="sp-order-card" aria-labelledby="order-title">
          <div className="sp-order-top">
            <div className="sp-product-icon">
              <Package size={27} strokeWidth={1.5} />
            </div>
            <div className="sp-order-title">
              <div className="sp-order-reference">
                <span>PO #{order.number}</span>
                <span className="sp-dot">·</span>
                <span>{order.quantity.toLocaleString("en-US")} UNITS</span>
              </div>
              <h2 id="order-title">{order.product}</h2>
              <p>
                <span>
                  Buyer{" "}
                  <strong>
                    {order.buyer} <small>(USA)</small>
                  </strong>
                </span>
                <ArrowRight size={14} />
                <span>
                  Supplier{" "}
                  <strong>
                    {order.supplier} <small>({order.country})</small>
                  </strong>
                </span>
              </p>
            </div>
            <div className="sp-order-badge">
              {pill}
              <small>
                {demo ? "Sample trade · no real funds" : "USD · PayPal Sandbox"}
              </small>
            </div>
          </div>
          <div className="sp-order-bottom">
            <div>
              <span className="sp-kicker">ACTIVE MILESTONE 02</span>
              <strong>{m.title}</strong>
            </div>
            <div className="sp-value">
              <span className="sp-kicker">
                {settled ? "SETTLED VALUE" : "MILESTONE VALUE"}
              </span>
              <strong>
                {money(m.amount_cents)} <small>USD</small>
              </strong>
            </div>
            <div className="sp-contract-note">
              <ShieldCheck size={19} />
              <span>
                Payment follows a passing inspection
                <br />
                <strong>Buyer confirmation required</strong>
              </span>
            </div>
          </div>
        </section>
        {checkoutExpired && !settled && (
          <div className="sp-message" role="status">
            <Info size={17} />
            <span>
              The three-hour checkout window has ended. Refresh approval in
              Trade & funding, then run a fresh inspection.
            </span>
            <button
              onClick={() => {
                setTab("trade");
                setDialog("deposit");
              }}
            >
              Refresh checkout
            </button>
          </div>
        )}
        <Tabs.Root value={tab} onValueChange={setTab} className="sp-tabs">
          <Tabs.List aria-label="Milestone workflow" className="sp-tab-list">
            {[
              {
                id: "trade",
                number: "01",
                title: "Trade & funding",
                Icon: Wallet,
              },
              {
                id: "evidence",
                number: "02",
                title: "Evidence & inspection",
                Icon: ScanLine,
              },
              {
                id: "settlement",
                number: "03",
                title: "Settlement & receipt",
                Icon: ReceiptText,
              },
            ].map((t) => (
              <Tabs.Trigger key={t.id} value={t.id} className="sp-tab">
                <span className="sp-tab-number">{t.number}</span>
                <t.Icon size={17} />
                <span>{t.title}</span>
                {((t.id === "trade" && approved) ||
                  (t.id === "evidence" && report?.verified) ||
                  (t.id === "settlement" && settled)) && (
                  <Check size={14} className="sp-tab-check" />
                )}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="trade" className="sp-panel">
            <div className="sp-grid">
              <section className="sp-card">
                <div className="sp-card-heading">
                  <div>
                    <span className="sp-kicker">THE AGREEMENT</span>
                    <h3>Know what you’re paying for.</h3>
                  </div>
                  <ClipboardCheck className="sp-heading-icon" size={22} />
                </div>
                <p className="sp-description">
                  The inspection agent checks supplier evidence against every
                  agreed requirement.
                </p>
                <div className="sp-criteria">
                  {m.specs.map((s, i) => (
                    <div key={s.id}>
                      <span className="sp-criteria-index">0{i + 1}</span>
                      <div>
                        <strong>
                          {[
                            "Dimensional tolerance",
                            "Quality inspection",
                            "Shipment traceability",
                          ][i] || "Contract requirement"}
                        </strong>
                        <p>{s.requirement}</p>
                      </div>
                      <ShieldCheck size={17} />
                    </div>
                  ))}
                </div>
                <div className="sp-inline-note">
                  <LockKeyhole size={15} />
                  <p>A new evidence upload invalidates the previous review.</p>
                </div>
              </section>
              <section className="sp-card sp-funding">
                <div className="sp-card-heading">
                  <div>
                    <span className="sp-kicker">MILESTONE VAULT</span>
                    <h3>
                      {checkoutExpired
                        ? "Refresh checkout approval."
                        : approved
                          ? "Checkout is approved."
                          : "Ready when you are."}
                    </h3>
                  </div>
                  <div className="sp-paypal-mark" aria-label="PayPal">
                    P
                  </div>
                </div>
                <div className="sp-funding-amount">
                  {money(m.amount_cents)}
                  <span>USD · Pre-shipment inspection</span>
                </div>
                <div className="sp-payment-steps">
                  <p>
                    <span>
                      <Check size={12} />
                    </span>
                    Fixed amount from the purchase order
                  </p>
                  <p>
                    <span>
                      <Check size={12} />
                    </span>
                    Private supplier evidence and inspection
                  </p>
                  <p>
                    <span>
                      <Check size={12} />
                    </span>
                    Buyer confirms final settlement
                  </p>
                </div>
                {approved && !checkoutExpired ? (
                  <Button
                    className="sp-full"
                    onClick={() => setTab("evidence")}
                  >
                    Continue to supplier evidence <ArrowRight size={16} />
                  </Button>
                ) : (
                  <Button
                    variant="paypal"
                    className="sp-full"
                    disabled={!!busy || supplier || (!demo && !hasLiveOrder)}
                    onClick={() => setDialog("deposit")}
                  >
                    <LockKeyhole size={16} />
                    Deposit to Escrow
                    <ArrowRight size={16} />
                  </Button>
                )}
                <p className="sp-payment-note">
                  {demo
                    ? "Try a simulated checkout, or connect your Sandbox workspace."
                    : "PayPal Sandbox checkout · test funds only"}
                </p>
                <div className="sp-definition">
                  <Info size={15} />
                  <p>
                    “Escrow” is the demo workflow name. Checkout approval does
                    not hold funds. Final capture pays the configured test
                    seller directly.
                  </p>
                </div>
              </section>
            </div>
            <div className="sp-next-strip">
              <div>
                <div className="sp-strip-icon">
                  <FileCheck2 size={21} />
                </div>
                <div>
                  <strong>Give both sides a clear next step.</strong>
                  <p>
                    {demo
                      ? "The supplier adds inspection proof. The agent checks it. You decide when to settle."
                      : supplier
                        ? "Add the inspection report, shipping manifest and clear carton label images."
                        : "Invite your supplier to securely submit evidence for this purchase order."}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={
                  demo || supplier ? () => setTab("evidence") : createInvite
                }
              >
                {demo || supplier
                  ? "View evidence workspace"
                  : "Invite supplier"}
                <ArrowRight size={15} />
              </Button>
            </div>
          </Tabs.Content>
          <Tabs.Content value="evidence" className="sp-panel">
            <div className="sp-grid sp-inspection-grid">
              <section className="sp-card">
                <div className="sp-card-heading">
                  <div>
                    <span className="sp-kicker">SUPPLIER PROOF SUBMISSION</span>
                    <h3>Evidence, all in one place.</h3>
                  </div>
                  <span className="sp-count">{evidenceCount}/6 files</span>
                </div>
                <p className="sp-description">
                  Inspection reports, shipping manifests and clear factory or
                  carton photos.
                </p>
                {!demo && !supplier && (
                  <div className="sp-inline-note">
                    <LockKeyhole size={16} />
                    <p>
                      Your invited supplier submits proof.{" "}
                      <button
                        className="sp-text-button"
                        disabled={!!busy}
                        onClick={createInvite}
                      >
                        Create a private invitation
                      </button>
                    </p>
                  </div>
                )}
                <div
                  className={`sp-dropzone ${dragging ? "is-dragging" : ""} ${!canUpload ? "is-disabled" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (canUpload) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                >
                  <UploadCloud size={28} strokeWidth={1.5} />
                  <strong>Drag and drop supplier proof</strong>
                  <p>PDF, JPG or PNG · up to 2 MB each</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canUpload || !!busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    Browse files
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.txt,.csv"
                    aria-label="Supplier evidence files"
                    className="sp-file-input"
                    onChange={(e) => {
                      void uploadFiles(Array.from(e.target.files || []));
                      e.target.value = "";
                    }}
                  />
                </div>
                {!demo && supplier && (
                  <label className="sp-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    I have permission to share this evidence with the AI review
                    service.
                  </label>
                )}
                {demo && (
                  <>
                    <div className="sp-sample-heading">
                      <span>OR SELECT SAMPLE PROOF</span>
                      <button
                        disabled={!!busy || settled || customFiles.length > 3}
                        onClick={() => {
                          setFixtures(demoFixtures.map((f) => f.id));
                          setInspection(null);
                        }}
                      >
                        Add all samples <ArrowRight size={12} />
                      </button>
                    </div>
                    <div className="sp-samples">
                      {demoFixtures.map((f) => (
                        <div
                          key={f.id}
                          className={`sp-sample ${fixtures.includes(f.id) ? "is-selected" : ""}`}
                        >
                          <button
                            aria-pressed={fixtures.includes(f.id)}
                            disabled={!!busy || settled}
                            onClick={() => selectFixture(f.id)}
                          >
                            <span className="sp-file-symbol">
                              {f.id === "labels" ? (
                                <ImageIcon size={21} />
                              ) : (
                                <FileText size={21} />
                              )}
                            </span>
                            <span>
                              <strong>{f.label}</strong>
                              <small>{f.detail}</small>
                            </span>
                            <span className="sp-checkbox">
                              {fixtures.includes(f.id) && <Check size={13} />}
                            </span>
                          </button>
                          <a
                            href={f.href}
                            download
                            aria-label={`Download ${f.name}`}
                          >
                            <ArrowDownToLine size={15} />
                          </a>
                        </div>
                      ))}
                    </div>
                    <p className="sp-sample-note">
                      Fictional demo documents. The mock stamp is not an SGS
                      certificate.
                    </p>
                  </>
                )}
                {demo &&
                  customFiles.map((f, i) => (
                    <div className="sp-evidence-row" key={i}>
                      <FileText size={17} />
                      <span>
                        <strong>{f.name}</strong>
                        <small>Custom file · local preview only</small>
                      </span>
                      <button
                        disabled={settled || !!busy}
                        aria-label={`Remove ${f.name}`}
                        onClick={() => {
                          setCustomFiles((v) => v.filter((_, j) => j !== i));
                          setInspection(null);
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                {evidence.map((f) => (
                  <a
                    className="sp-evidence-row"
                    key={f.id}
                    href={`/api/evidence/${f.id}`}
                    download
                  >
                    <FileText size={19} />
                    <span>
                      <strong>{f.filename}</strong>
                      <small>
                        {Math.ceil(f.size / 1024)} KB · private supplier upload
                      </small>
                    </span>
                    <ArrowDownToLine size={16} />
                  </a>
                ))}
              </section>
              <section className="sp-card sp-agent-card">
                <div className="sp-card-heading">
                  <div>
                    <span className="sp-kicker">SILKPAY INSPECTION AGENT</span>
                    <h3>Check the proof. See the reasoning.</h3>
                  </div>
                  <span className="sp-agent-icon">
                    <ScanLine size={23} />
                  </span>
                </div>
                <p className="sp-description">
                  {demo
                    ? "A deterministic sample review compares five checks. The 96% demo score is illustrative, not a measured AI probability."
                    : "AI compares uploaded evidence with the contract. All required checks must pass with at least 95% confidence."}
                </p>
                {checking ? (
                  <div className="sp-agent-wait" role="status">
                    <LoaderCircle className="spin" size={32} />
                    <strong>Reviewing milestone evidence…</strong>
                    <p>
                      Checking the contract requirements and evidence
                      references.
                    </p>
                  </div>
                ) : report ? (
                  <>
                    <div
                      className={`sp-result ${report.verified ? "is-passed" : "is-held"}`}
                    >
                      <div className="sp-score">
                        {Math.round(report.score * 100)}
                        <span>%</span>
                      </div>
                      <div>
                        <strong>
                          {report.verified
                            ? demo
                              ? "Sample spec match"
                              : "Evidence requirements met"
                            : "Payout remains held"}
                        </strong>
                        <p>
                          {report.engine === "deterministic-demo"
                            ? "Deterministic demo · sample evidence"
                            : report.engine === "held-fallback"
                              ? "Safe fallback · no AI verdict"
                              : "AI evidence comparison"}
                        </p>
                      </div>
                      {report.verified ? (
                        <BadgeCheck size={27} />
                      ) : (
                        <Info size={25} />
                      )}
                    </div>
                    <div className="sp-findings">
                      {report.findings.map((f) => (
                        <details key={f.id}>
                          <summary>
                            <span
                              className={`sp-finding-icon ${f.outcome === "met" ? "is-met" : ""}`}
                            >
                              {f.outcome === "met" ? (
                                <Check size={13} />
                              ) : (
                                <Info size={13} />
                              )}
                            </span>
                            <span>{f.label}</span>
                            <span className="sp-finding-score">
                              {f.outcome === "met"
                                ? `${Math.round(f.confidence * 100)}%`
                                : "Review"}
                            </span>
                            <ChevronRight size={14} />
                          </summary>
                          <p>{f.explanation}</p>
                          {f.evidence.length > 0 && (
                            <small>Evidence: {f.evidence.join(", ")}</small>
                          )}
                        </details>
                      ))}
                    </div>
                    <details className="sp-audit">
                      <summary>
                        <FileCheck2 size={15} /> Inspection audit log{" "}
                        <ChevronRight size={14} />
                      </summary>
                      {report.audit.map((a, i) => (
                        <div key={i}>
                          <strong>{a.step}</strong>
                          <p>{a.detail}</p>
                        </div>
                      ))}
                    </details>
                  </>
                ) : (
                  <div className="sp-agent-empty">
                    <div className="sp-scan-graphic">
                      <ScanLine size={46} strokeWidth={1} />
                      <span>
                        <ShieldCheck size={21} />
                      </span>
                    </div>
                    <strong>Your evidence has a clear checklist.</strong>
                    <p>
                      Dimensions. Quality stamp. Carton labels.
                      <br />
                      Plus manifest and shipment consistency.
                    </p>
                    <div className="sp-mini-checks">
                      <span>
                        <Check size={12} /> Cite the proof
                      </span>
                      <span>
                        <Check size={12} /> Explain the result
                      </span>
                    </div>
                  </div>
                )}
                <Button
                  className="sp-full"
                  disabled={
                    !!busy ||
                    !approved ||
                    !evidenceCount ||
                    settled ||
                    (!demo &&
                      ![
                        "checkout_approved",
                        "funded",
                        "changes_requested",
                        "verified",
                      ].includes(m.status))
                  }
                  onClick={runInspection}
                >
                  {checking ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ScanLine size={17} />
                  )}
                  {report
                    ? "Run verification again"
                    : "Run AI Verification Agent"}
                </Button>
                {!approved && (
                  <p className="sp-payment-note">
                    Complete checkout approval in step 01 first.
                  </p>
                )}
                {report?.verified && (
                  <button
                    className="sp-continue"
                    onClick={() => setTab("settlement")}
                  >
                    Review settlement <ArrowRight size={15} />
                  </button>
                )}
              </section>
            </div>
          </Tabs.Content>
          <Tabs.Content value="settlement" className="sp-panel">
            <div className="sp-grid">
              <section className="sp-card">
                <div className="sp-card-heading">
                  <div>
                    <span className="sp-kicker">SETTLEMENT CHECKLIST</span>
                    <h3>
                      {settled
                        ? "A milestone, completed."
                        : "One final check before release."}
                    </h3>
                  </div>
                  <ShieldCheck size={23} className="sp-heading-icon" />
                </div>
                <div className="sp-release-checks">
                  {[
                    {
                      done: approved,
                      title: "Buyer checkout approval",
                      sub: demo
                        ? "Simulated in the sample walkthrough"
                        : "Confirmed directly with PayPal Sandbox",
                    },
                    {
                      done: evidenceCount > 0,
                      title: "Supplier evidence received",
                      sub: `${evidenceCount} document${evidenceCount === 1 ? "" : "s"} for this milestone`,
                    },
                    {
                      done: !!report?.verified,
                      title: "Inspection requirements met",
                      sub: report?.verified
                        ? `${Math.round(report.score * 100)}% ${demo ? "illustrative sample score" : "minimum evidence confidence"}`
                        : "Every contract criterion must pass",
                    },
                  ].map((c) => (
                    <div key={c.title}>
                      <span className={c.done ? "is-done" : ""}>
                        {c.done ? (
                          <Check size={18} />
                        ) : (
                          <LockKeyhole size={15} />
                        )}
                      </span>
                      <div>
                        <strong>{c.title}</strong>
                        <p>{c.sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="sp-definition">
                  <ShieldCheck size={16} />
                  <p>
                    Inspection checks evidence against specifications. It does
                    not authenticate certificates, prove delivery or guarantee
                    product quality.
                  </p>
                </div>
                {!settled && (
                  <Button variant="outline" onClick={() => setTab("evidence")}>
                    <FileCheck2 size={15} />
                    Review evidence and findings
                  </Button>
                )}
              </section>
              <section
                className={`sp-card sp-receipt ${settled ? "is-complete" : ""}`}
              >
                <div className="sp-receipt-heading">
                  <div className="sp-receipt-symbol">
                    {settled ? (
                      <CheckCircle2 size={30} />
                    ) : (
                      <ReceiptText size={27} />
                    )}
                  </div>
                  <span className="sp-kicker">
                    {settled
                      ? demo
                        ? "DEMO RECEIPT"
                        : "PAYPAL SANDBOX RECEIPT"
                      : "MILESTONE SETTLEMENT"}
                  </span>
                  <h3>
                    {settled
                      ? demo
                        ? "Sample payout complete"
                        : "Payment captured"
                      : "Release with confidence."}
                  </h3>
                </div>
                <div className="sp-receipt-amount">
                  {money(m.amount_cents)}
                  <span>USD</span>
                </div>
                <dl>
                  <div>
                    <dt>Purchase order</dt>
                    <dd>#{order.number}</dd>
                  </div>
                  <div>
                    <dt>Supplier</dt>
                    <dd>{order.supplier}</dd>
                  </div>
                  <div>
                    <dt>Milestone</dt>
                    <dd>02 · Pre-shipment inspection</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {settled
                        ? "Completed"
                        : ready
                          ? "Ready for buyer confirmation"
                          : statusText[status]}
                    </dd>
                  </div>
                  {settled && (
                    <div>
                      <dt>
                        {demo ? "PayPal transaction" : "PayPal transaction ID"}
                      </dt>
                      <dd className="sp-transaction-id">
                        {demo ? "None — simulated demo" : m.capture_id}
                      </dd>
                    </div>
                  )}
                </dl>
                {settled ? (
                  <Button
                    variant="outline"
                    className="sp-full"
                    onClick={receipt}
                  >
                    <ArrowDownToLine size={16} />
                    Download receipt
                  </Button>
                ) : (
                  <Button
                    variant="paypal"
                    className="sp-full"
                    disabled={
                      !ready ||
                      !!busy ||
                      supplier ||
                      (!demo && (!config.payments || m.status !== "verified"))
                    }
                    onClick={() => setDialog("release")}
                  >
                    <LockKeyhole size={16} />
                    Release Milestone Payout
                    <ArrowRight size={16} />
                  </Button>
                )}
                <p className="sp-payment-note">
                  {demo
                    ? "Demo only. No PayPal transaction or funds transfer."
                    : "Capture pays the configured Sandbox seller directly."}
                </p>
                {!demo && m.paypal_order_id && (
                  <button
                    className="sp-continue"
                    disabled={!!busy}
                    onClick={() =>
                      task("reconcile", async () => {
                        await api(`milestones/${m.id}/reconcile`, {});
                        await reload();
                      })
                    }
                  >
                    <RefreshCw size={14} />
                    Refresh PayPal status
                  </button>
                )}
              </section>
            </div>
          </Tabs.Content>
        </Tabs.Root>
        <footer className="sp-footer">
          <span>
            <LockKeyhole size={13} />
            {demo
              ? "Sample data · Sandbox only · No real money"
              : "Private workspace · Sandbox only · No real money"}
          </span>
          <div>
            {demo ? (
              <button disabled={!!busy} onClick={resetDemo}>
                <RotateCcw size={13} />
                Reset demo
              </button>
            ) : (
              <Link href="/workspace">
                Manage purchase orders <ExternalLink size={12} />
              </Link>
            )}
            <button onClick={() => setDialog("help")}>
              How it works <ArrowRight size={13} />
            </button>
          </div>
        </footer>
      </main>
      <Dialog
        open={dialog === "deposit"}
        onOpenChange={(v) => !v && setDialog(null)}
        title={
          demo
            ? "Start the sample milestone"
            : "Approve PayPal Sandbox checkout"
        }
        description="The milestone amount is fixed at the value saved in the purchase order."
      >
        <div className="sp-dialog-body">
          <div className="sp-dialog-amount">
            {money(m.amount_cents)} <span>USD</span>
          </div>
          <p>
            {demo
              ? "Walk through checkout approval, sample proof, inspection and a clearly labeled demo receipt."
              : "You’ll continue to PayPal Sandbox to approve this checkout. Approval is not a deposit or funds hold. After inspection passes, you confirm capture to the configured test seller."}
          </p>
          {!demo && (
            <p>
              Complete this short demonstration within the checkout window. Use
              the authorization workflow for longer manufacturing timelines.
            </p>
          )}
          <div className="sp-dialog-actions">
            {demo ? (
              <>
                <Button
                  variant="paypal"
                  onClick={() => {
                    setDemoApproved(true);
                    setDialog(null);
                    setTab("evidence");
                  }}
                >
                  Simulate checkout approval <ArrowRight size={16} />
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy || !config.database}
                  onClick={openSandbox}
                >
                  Use PayPal Sandbox workspace
                </Button>
              </>
            ) : (
              <Button
                variant="paypal"
                disabled={!!busy || !config.payments}
                onClick={startCheckout}
              >
                {busy === "checkout" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <LockKeyhole size={16} />
                )}
                Continue to PayPal Sandbox <ExternalLink size={15} />
              </Button>
            )}
          </div>
          {!demo && !config.payments && (
            <p className="sp-dialog-warning">
              PayPal Sandbox credentials are not configured yet. Add the client
              ID, secret and seller merchant ID in Vercel, then redeploy.
            </p>
          )}
        </div>
      </Dialog>
      <Dialog
        open={dialog === "release"}
        onOpenChange={(v) => !v && !busy && setDialog(null)}
        title={demo ? "Complete the demo payout?" : "Confirm milestone capture"}
        description={
          demo
            ? "This creates a simulated receipt only."
            : "This captures the approved Sandbox payment to the configured test seller."
        }
      >
        <div className="sp-dialog-body">
          <div className="sp-dialog-amount">
            {money(m.amount_cents)} <span>USD</span>
          </div>
          <p>
            {demo
              ? "No PayPal API call or funds transfer will occur. Your sample receipt is visibly marked as a demonstration."
              : "You have reviewed the supplier evidence and inspection findings. Confirm capture for this purchase-order milestone."}
          </p>
          <Button
            variant="paypal"
            className="sp-full"
            disabled={!!busy}
            onClick={release}
          >
            {busy === "capture" ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            {demo ? "Complete demo payout" : "Confirm Sandbox capture"}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "setup"}
        onOpenChange={(v) => !v && setDialog(null)}
        title="Sandbox connection status"
        description="Connection checks reflect configured services; a payment still requires a successful provider response."
      >
        <div className="sp-dialog-body">
          <div className="sp-setup-list">
            {[
              {
                title: "Private database",
                ok: config.database,
                text: "Stores orders, private evidence, sessions and audit history.",
              },
              {
                title: "PayPal Sandbox",
                ok: config.payments,
                text: "Requires server-side client ID, client secret and test seller merchant ID.",
              },
              {
                title: "AI review service",
                ok: config.ai,
                text: "Uses Vercel AI Gateway. The sample walkthrough works without a key.",
              },
            ].map((s) => (
              <div key={s.title}>
                {s.ok ? <CheckCircle2 size={20} /> : <Info size={20} />}
                <span>
                  <strong>{s.title}</strong>
                  <p>{s.text}</p>
                </span>
                <small>{s.ok ? "Configured" : "Not connected"}</small>
              </div>
            ))}
          </div>
          <p>
            PayPal secrets stay on the server. SilkPay uses only
            api-m.sandbox.paypal.com.
          </p>
          <a
            className="sp-doc-link"
            href="https://github.com/code-up-matrix/silkpay#setup"
            target="_blank"
            rel="noreferrer"
          >
            Read setup instructions <ExternalLink size={14} />
          </a>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "invite"}
        onOpenChange={(v) => !v && setDialog(null)}
        title="Invite your supplier"
        description="Share this single-use link with the supplier. It grants access only to this purchase order for seven days."
      >
        <div className="sp-dialog-body">
          {busy === "invite" ? (
            <p>Creating a private invitation…</p>
          ) : invite ? (
            <>
              <label className="sp-link-label">
                Private invitation
                <input
                  readOnly
                  value={invite}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <Button
                onClick={() =>
                  task("copy", async () => {
                    await navigator.clipboard.writeText(invite);
                    setMessage("Supplier invitation copied.");
                  })
                }
              >
                <Copy size={15} />
                Copy invitation
              </Button>
              <p>
                For a two-role demo, open the link in a separate browser
                profile. Opening it in this browser replaces your buyer session
                with supplier access.
              </p>
            </>
          ) : (
            <p>
              The invitation could not be created. Close this dialog and retry.
            </p>
          )}
        </div>
      </Dialog>
      <Dialog
        open={dialog === "help"}
        onOpenChange={(v) => !v && setDialog(null)}
        title="From purchase order to payment"
        description="SilkPay helps US buyers and Asian suppliers agree on what evidence is needed before settlement."
      >
        <div className="sp-dialog-body">
          <ol className="sp-help-steps">
            <li>
              <strong>Agree and approve.</strong>
              <p>
                Review fixed milestone requirements and approve checkout in
                PayPal Sandbox.
              </p>
            </li>
            <li>
              <strong>Submit and inspect.</strong>
              <p>
                The supplier uploads proof. Inspection compares it with every
                contract criterion and explains the result.
              </p>
            </li>
            <li>
              <strong>Confirm and settle.</strong>
              <p>
                A passing review unlocks buyer confirmation. The receipt appears
                after PayPal confirms capture.
              </p>
            </li>
          </ol>
          <p>
            The sample walkthrough uses deterministic checks and fictional
            evidence. Real Sandbox mode uses private supplier uploads and the AI
            service. SilkPay is a hackathon demonstration, not a regulated
            escrow service.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
