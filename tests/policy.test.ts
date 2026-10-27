import { describe, it, expect } from "vitest";
import {
  decimalAmount,
  matchesAmount,
  orderInput,
  reviewPasses,
  safeApprovalUrl,
  validFile,
} from "@/lib/policy";
import type { Finding, Spec } from "@/lib/types";
const specs: Spec[] = [
  { id: "s1", requirement: "Cotton composition is 100%." },
  { id: "s2", requirement: "All 1200 units are packed." },
];
const findings: Finding[] = specs.map((s) => ({
  specId: s.id,
  outcome: "met",
  confidence: 0.98,
  explanation: "The cited inspection record supports the specification.",
  evidenceIds: ["file-1"],
}));
describe("settlement policy", () => {
  it("passes complete, high-confidence, cited findings", () =>
    expect(reviewPasses(specs, ["file-1"], findings, [])).toBe(true));
  it.each(["uncertain", "not_met"] as const)("holds a %s finding", (outcome) =>
    expect(
      reviewPasses(
        specs,
        ["file-1"],
        [{ ...findings[0], outcome }, findings[1]],
        [],
      ),
    ).toBe(false),
  );
  it("holds confidence below the threshold", () =>
    expect(
      reviewPasses(
        specs,
        ["file-1"],
        [{ ...findings[0], confidence: 0.949 }, findings[1]],
        [],
      ),
    ).toBe(false));
  it("holds missing, duplicate, extra and invented specification IDs", () => {
    for (const f of [
      findings.slice(0, 1),
      [findings[0], findings[0]],
      [...findings, findings[0]],
      [findings[0], { ...findings[1], specId: "invented" }],
    ])
      expect(reviewPasses(specs, ["file-1"], f, [])).toBe(false);
  });
  it("holds invented citations, missing citations and concerns", () => {
    expect(reviewPasses(specs, ["other-file"], findings, [])).toBe(false);
    expect(
      reviewPasses(
        specs,
        ["file-1"],
        findings.map((f) => ({ ...f, evidenceIds: [] })),
        [],
      ),
    ).toBe(false);
    expect(
      reviewPasses(specs, ["file-1"], findings, ["Potential tampering"]),
    ).toBe(false);
  });
  it("never passes an empty requirement or evidence set", () => {
    expect(reviewPasses([], ["file-1"], [], [])).toBe(false);
    expect(reviewPasses(specs, [], findings, [])).toBe(false);
  });
});
describe("payment and upload boundaries", () => {
  it.each([
    [1, "0.01"],
    [101, "1.01"],
    [1860000, "18600.00"],
  ])("formats exact integer cents %s", (n, s) =>
    expect(decimalAmount(n as number)).toBe(s),
  );
  it.each([0, -1, NaN, 10.5, Infinity])("rejects invalid cents %s", (v) =>
    expect(() => decimalAmount(v)).toThrow(),
  );
  it("requires exact USD amount", () => {
    expect(matchesAmount({ currency_code: "USD", value: "1.00" }, 100)).toBe(
      true,
    );
    for (const a of [
      { currency_code: "EUR", value: "1.00" },
      { currency_code: "USD", value: "1.01" },
      { currency_code: "USD", value: "1" },
      undefined,
    ])
      expect(matchesAmount(a, 100)).toBe(false);
  });
  it("allows only the PayPal Sandbox approval origin", () => {
    expect(
      safeApprovalUrl("https://www.sandbox.paypal.com/checkoutnow?token=TEST"),
    ).toContain("sandbox.paypal.com");
    for (const url of [
      "https://www.paypal.com/checkout",
      "http://www.sandbox.paypal.com",
      "https://www.sandbox.paypal.com.evil.test",
      "https://user:pass@www.sandbox.paypal.com",
      "javascript:alert(1)",
    ])
      expect(() => safeApprovalUrl(url)).toThrow();
  });
  it("checks file signatures, UTF-8 and size", () => {
    expect(validFile(Buffer.from("%PDF-1.7\n"), "application/pdf")).toBe(true);
    expect(validFile(Buffer.from("inspection: 1200 units"), "text/plain")).toBe(
      true,
    );
    expect(validFile(Buffer.from("pretend image"), "image/png")).toBe(false);
    expect(
      validFile(Buffer.from("<script>alert(1)</script>"), "text/html"),
    ).toBe(false);
    expect(validFile(Buffer.alloc(32001, 65), "text/plain")).toBe(false);
    expect(validFile(Buffer.from([255, 254]), "text/plain")).toBe(false);
    expect(validFile(Buffer.from([0]), "text/plain")).toBe(false);
    expect(validFile(Buffer.alloc(2000001), "application/pdf")).toBe(false);
  });
  it("rejects invalid calendar dates and fractional cents", () => {
    const v = {
      product: "Cotton shirt",
      supplier: "Supplier",
      country: "China",
      quantity: 10,
      milestones: [
        {
          title: "Inspection",
          amount_cents: 100,
          due_date: "2027-02-30",
          requirements: ["Confirm the full quantity."],
        },
      ],
    };
    expect(orderInput.safeParse(v).success).toBe(false);
    expect(
      orderInput.safeParse({
        ...v,
        milestones: [
          { ...v.milestones[0], due_date: "2027-02-28", amount_cents: 1.5 },
        ],
      }).success,
    ).toBe(false);
  });
});
