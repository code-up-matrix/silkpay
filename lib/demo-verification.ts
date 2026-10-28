import { demoFixtures, type DemoFixtureId } from "./blueprint";
export type InspectionResult = {
  mode: "demo" | "sandbox";
  engine: "deterministic-demo" | "ai" | "held-fallback";
  verified: boolean;
  score: number;
  readyForPayout: boolean;
  summary: string;
  findings: {
    id: string;
    label: string;
    outcome: "met" | "uncertain" | "not_met";
    confidence: number;
    explanation: string;
    evidence: string[];
  }[];
  audit: { step: string; detail: string }[];
};
/** Fixture-only teaching simulation. Its result is never written to payment records. */
export function verifyDemo(
  ids: DemoFixtureId[],
  unknownFiles = 0,
): InspectionResult {
  const selected = new Set(ids);
  const checks = [
    {
      id: "dimensions",
      label: "Dimensional tolerance",
      requires: ["inspection"],
      explanation:
        "The sample report lists a maximum deviation of 0.3 mm against the 0.5 mm limit.",
    },
    {
      id: "stamp",
      label: "SGS stamp visibility",
      requires: ["inspection"],
      explanation:
        "The fixture contains a mock SGS label. This confirms label visibility only; it is not an authenticated SGS certificate.",
    },
    {
      id: "barcode",
      label: "Master carton barcodes",
      requires: ["manifest", "labels"],
      explanation:
        "Sample carton code SK8821-C001 appears in the label image and shipping manifest.",
    },
    {
      id: "quantity",
      label: "Shipping manifest",
      requires: ["inspection", "manifest"],
      explanation:
        "Both sample records list 5,000 units in 100 cartons for PO SK-8821.",
    },
    {
      id: "weight",
      label: "Shipment weight consistency",
      requires: ["inspection", "manifest"],
      explanation:
        "The sample inspection and shipping records both list 600 kg gross weight. This is a consistency check, not a contract weight limit.",
    },
  ];
  const findings = checks.map((check) => {
    const met =
      !unknownFiles &&
      check.requires.every((id) => selected.has(id as DemoFixtureId));
    return {
      id: check.id,
      label: check.label,
      outcome: met ? ("met" as const) : ("uncertain" as const),
      confidence: met ? 0.96 : 0,
      explanation: unknownFiles
        ? "A custom file was added. The demo engine cannot inspect or authenticate its contents; use the private Sandbox workspace for AI review."
        : met
          ? check.explanation
          : "Add the matching sample documents to evaluate this check.",
      evidence: check.requires
        .filter((id) => selected.has(id as DemoFixtureId))
        .map((id) => demoFixtures.find((f) => f.id === id)!.name),
    };
  });
  const verified = findings.every((f) => f.outcome === "met");
  return {
    mode: "demo",
    engine: "deterministic-demo",
    verified,
    score:
      Math.round(
        (findings.filter((f) => f.outcome === "met").length / checks.length) *
          96,
      ) / 100,
    readyForPayout: verified,
    summary: verified
      ? "Sample evidence matches all five demonstration checks. The demo payout is unlocked."
      : "More evidence is needed. Payout stays locked.",
    findings,
    audit: [
      {
        step: "01 · Evidence inventory",
        detail: `${selected.size} known sample files selected; ${unknownFiles} custom files.`,
      },
      {
        step: "02 · Contract comparison",
        detail:
          "Compared sample dimensions, stamp visibility and carton labels with the purchase-order criteria.",
      },
      {
        step: "03 · Cross-document checks",
        detail:
          "Compared purchase-order references, quantity and shipment weight.",
      },
      {
        step: "04 · Settlement policy",
        detail: verified
          ? "Demo payout available. This result cannot authorize a PayPal capture."
          : "Missing or unsupported evidence. No payout unlocked.",
      },
    ],
  };
}
