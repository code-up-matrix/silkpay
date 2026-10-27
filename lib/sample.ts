import type {
  PurchaseOrder,
  Milestone,
  MilestoneStatus,
  Review,
} from "./types";
const time = "2026-10-28T08:30:00Z";
const examples = [
  {
    number: "SP-1048",
    product: "Organic cotton crewneck",
    supplier: "Minghua Textiles",
    country: "China",
    quantity: 1200,
    total: 1860000,
    states: ["settled", "funded", "unfunded"],
    date: "2026-11-02",
  },
  {
    number: "SP-1047",
    product: "Ceramic pour-over set",
    supplier: "Kien An Ceramics",
    country: "Vietnam",
    quantity: 800,
    total: 1240000,
    states: ["settled", "funded", "unfunded"],
    date: "2026-11-05",
  },
  {
    number: "SP-1046",
    product: "Everyday canvas tote",
    supplier: "Lotus Craftworks",
    country: "India",
    quantity: 2400,
    total: 840000,
    states: ["settled", "settled", "funded"],
    date: "2026-10-30",
  },
  {
    number: "SP-1045",
    product: "Brushed steel bottle",
    supplier: "Shenzhen Forma",
    country: "China",
    quantity: 1500,
    total: 1575000,
    states: ["settled", "changes_requested", "unfunded"],
    date: "2026-11-08",
  },
  {
    number: "SP-1044",
    product: "Linen table collection",
    supplier: "An Phu Weaving",
    country: "Vietnam",
    quantity: 600,
    total: 720000,
    states: ["settled", "settled", "settled"],
    date: "2026-10-24",
  },
] as const;
export const sampleOrders: PurchaseOrder[] = examples.map((e, index) => {
  const id = "sample-" + index;
  const amounts = [
    Math.round(e.total * 0.3),
    Math.round(e.total * 0.4),
    Math.round(e.total * 0.3),
  ];
  const milestones: Milestone[] = [
    "Sample approval",
    "Production inspection",
    "Ready to ship",
  ].map((title, i) => {
    const specs = (
      i === 1 && index === 0
        ? [
            "Fabric composition is 100% certified organic cotton.",
            "Garment weight is 220 GSM, with a tolerance of ±5%.",
            "All 1,200 units pass the agreed color and stitching inspection.",
          ]
        : i === 1
          ? [
              `Inspection report identifies all ${e.quantity.toLocaleString()} ordered units.`,
              "The submitted measurements match the approved specification.",
              "Inspection records show no critical defects.",
            ]
          : i === 0
            ? [
                "A dated pre-production sample approval references this purchase order.",
              ]
            : [
                "Packing list confirms the agreed quantity and purchase-order number.",
                "A signed carrier handover document identifies the shipment.",
              ]
    ).map((requirement, k) => ({ id: "spec-" + k, requirement }));
    const review: Review = {
      summary:
        "Example review: the supplied documents support the milestone requirements.",
      findings: specs.map((s) => ({
        specId: s.id,
        outcome: "met",
        confidence: 0.98,
        explanation:
          "The matching information is visible in the example inspection report.",
        evidenceIds: ["sample-proof-" + index],
      })),
      concerns: [],
      passed: true,
      model: "Sample report",
      generatedAt: time,
      evidenceVersion: 1,
    };
    return {
      id: id + "-m" + i,
      order_id: id,
      title,
      amount_cents: amounts[i],
      due_date: e.date,
      position: i,
      status: e.states[i] as MilestoneStatus,
      specs,
      auto_settle: true,
      evidence_version: 1,
      review_version: e.states[i] === "settled" ? 1 : null,
      review: e.states[i] === "settled" ? review : null,
      paypal_order_id: "EXAMPLE-ORDER",
      authorization_id: e.states[i] !== "unfunded" ? "EXAMPLE-AUTH" : null,
      capture_id: e.states[i] === "settled" ? "EXAMPLE-CAPTURE" : null,
      authorization_expires_at: "2026-11-24T08:00:00Z",
      authorized_at: time,
      payment_error: null,
      attempt_key: "example",
    };
  });
  return {
    id,
    workspace_id: "sample",
    number: e.number,
    product: e.product,
    buyer: "Harbor & Co.",
    supplier: e.supplier,
    country: e.country,
    quantity: e.quantity,
    total_cents: e.total,
    created_at: "2026-10-" + String(20 - index) + "T09:00:00Z",
    milestones,
    evidence:
      index === 0
        ? [
            {
              id: "sample-proof-0",
              order_id: id,
              milestone_id: id + "-m1",
              filename: "Final_inspection_report.pdf",
              media_type: "application/pdf",
              size: 386000,
              sha256: "example",
              note: "Production inspection and measurement results.",
              created_at: time,
            },
            {
              id: "sample-photo-0",
              order_id: id,
              milestone_id: id + "-m1",
              filename: "Production_batch.jpg",
              media_type: "image/jpeg",
              size: 942000,
              sha256: "example",
              note: "Finished batch, ready for inspection.",
              created_at: time,
            },
          ]
        : [],
    activity: [
      {
        id: id + "-event",
        order_id: id,
        event:
          index === 0
            ? "Inspection evidence uploaded"
            : index === 4
              ? "Final milestone settled"
              : "Milestone authorized",
        detail:
          index === 0
            ? "Minghua Textiles added 2 documents for review."
            : index === 4
              ? "All three milestones are complete."
              : "The buyer approved the next milestone.",
        actor: index === 0 ? e.supplier : "Harbor & Co.",
        created_at: time,
      },
    ],
  };
});
