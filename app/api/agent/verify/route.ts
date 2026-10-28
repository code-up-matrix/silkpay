import { z } from "zod";
import { body, handle, HttpError, identity, json, origin } from "@/lib/http";
import { ownedMilestone } from "@/lib/repository";
import { inspectMilestone } from "@/lib/inspection";
import { verifyDemo, type InspectionResult } from "@/lib/demo-verification";
import type { Review } from "@/lib/types";
export const runtime = "nodejs";
export const maxDuration = 120;
const schema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("demo"),
      fixtures: z.array(z.enum(["inspection", "manifest", "labels"])).max(3),
      unknownFiles: z.number().int().min(0).max(6).default(0),
    })
    .strict(),
  z.object({ mode: z.literal("sandbox"), milestoneId: z.uuid() }).strict(),
]);
export const POST = (request: Request) =>
  handle(async () => {
    origin(request);
    const input = await body(request, schema);
    if (input.mode === "demo")
      return json(verifyDemo(input.fixtures, input.unknownFiles));
    const who = await identity(request);
    const m = await ownedMilestone(input.milestoneId, who);
    try {
      const response = await inspectMilestone(m, who);
      const data = (await response.json()) as {
        report: Review;
        settlement?: unknown;
      };
      const report = data.report;
      const result: InspectionResult = {
        mode: "sandbox",
        engine: "ai",
        verified: report.passed,
        score: report.findings.length
          ? Math.min(...report.findings.map((f) => f.confidence))
          : 0,
        readyForPayout: report.passed,
        summary: report.summary,
        findings: report.findings.map((f) => ({
          id: f.specId,
          label:
            m.specs.find((s) => s.id === f.specId)?.requirement || f.specId,
          outcome: f.outcome,
          confidence: f.confidence,
          explanation: f.explanation,
          evidence: f.evidenceIds,
        })),
        audit: [
          {
            step: "Evidence review",
            detail: `Model: ${report.model}. Evidence version ${report.evidenceVersion}.`,
          },
          {
            step: "Settlement policy",
            detail: report.passed
              ? "All required criteria met with cited evidence and at least 95% confidence. Buyer confirmation required."
              : "The inspection did not satisfy every requirement. Payout held.",
          },
          ...report.concerns.map((detail) => ({ step: "Concern", detail })),
        ],
      };
      return json({ ...result, report, settlement: data.settlement });
    } catch (error) {
      if (!(error instanceof HttpError) || ![502, 503].includes(error.status))
        throw error;
      return json({
        mode: "sandbox",
        engine: "held-fallback",
        verified: false,
        score: 0,
        readyForPayout: false,
        summary:
          "The AI inspection service is unavailable. Evidence is saved and payout remains held. Retry when the service is connected.",
        findings: m.specs.map((s) => ({
          id: s.id,
          label: s.requirement,
          outcome: "uncertain",
          confidence: 0,
          explanation: "No completed AI review is available.",
          evidence: [],
        })),
        audit: [
          {
            step: "Safe fallback",
            detail:
              "No approval was inferred from a filename, sample fixture or unavailable AI response.",
          },
        ],
      } satisfies InspectionResult);
    }
  });
