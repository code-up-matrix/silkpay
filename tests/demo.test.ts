import { describe, it, expect } from "vitest";
import { verifyDemo } from "@/lib/demo-verification";
describe("fixture-only deterministic inspection", () => {
  it("passes the complete known fixture set with an explicit demo label", () => {
    const r = verifyDemo(["inspection", "manifest", "labels"]);
    expect(r).toMatchObject({
      mode: "demo",
      engine: "deterministic-demo",
      verified: true,
      score: 0.96,
      readyForPayout: true,
    });
    expect(r.findings).toHaveLength(5);
    expect(r.findings.find((f) => f.id === "stamp")?.explanation).toContain(
      "not an authenticated SGS certificate",
    );
  });
  it("holds missing records, missing images and arbitrary files", () => {
    for (const ids of [[], ["inspection"], ["inspection", "manifest"]] as const)
      expect(verifyDemo([...ids]).readyForPayout).toBe(false);
    expect(verifyDemo(["inspection", "manifest", "labels"], 1)).toMatchObject({
      readyForPayout: false,
      score: 0,
    });
  });
  it("does not let duplicate fixture IDs fill a missing evidence requirement", () => {
    expect(
      verifyDemo(["inspection", "inspection", "inspection"]).verified,
    ).toBe(false);
  });
});
