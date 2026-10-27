import { z } from "zod";
import type { Finding, Spec } from "./types";
export const orderInput = z.object({
  product: z.string().trim().min(3).max(120),
  supplier: z.string().trim().min(2).max(100),
  country: z.enum([
    "China",
    "Vietnam",
    "India",
    "Bangladesh",
    "Indonesia",
    "Thailand",
    "Taiwan",
    "South Korea",
    "Japan",
    "Malaysia",
    "Philippines",
    "Pakistan",
    "Singapore",
  ]),
  quantity: z.number().int().min(1).max(1000000),
  milestones: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(80),
        amount_cents: z.number().int().min(100).max(5000000),
        due_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(
            (v) =>
              Number.isFinite(Date.parse(v)) &&
              new Date(v).toISOString().slice(0, 10) === v,
            "Enter a valid date.",
          ),
        requirements: z.array(z.string().trim().min(8).max(600)).min(1).max(8),
      }),
    )
    .min(1)
    .max(5),
});
export const reviewSchema = z.object({
  summary: z.string().min(1).max(1200),
  findings: z
    .array(
      z.object({
        specId: z.string(),
        outcome: z.enum(["met", "not_met", "uncertain"]),
        confidence: z.number().min(0).max(1),
        explanation: z.string().min(10).max(800),
        evidenceIds: z.array(z.string()).max(6),
      }),
    )
    .max(8),
  concerns: z.array(z.string().max(500)).max(8),
});
export function reviewPasses(
  specs: Spec[],
  evidenceIds: string[],
  findings: Finding[],
  concerns: string[],
) {
  if (
    !specs.length ||
    !evidenceIds.length ||
    findings.length !== specs.length ||
    concerns.length
  )
    return false;
  if (new Set(findings.map((f) => f.specId)).size !== specs.length)
    return false;
  return specs.every((spec) => {
    const f = findings.find((f) => f.specId === spec.id);
    return (
      f &&
      f.outcome === "met" &&
      f.confidence >= 0.95 &&
      f.evidenceIds.length > 0 &&
      f.evidenceIds.every((id) => evidenceIds.includes(id))
    );
  });
}
export function decimalAmount(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 1)
    throw new Error("Invalid amount.");
  return Math.floor(cents / 100) + "." + String(cents % 100).padStart(2, "0");
}
export function matchesAmount(amount: unknown, cents: number) {
  const a = amount as { currency_code?: string; value?: string } | undefined;
  return a?.currency_code === "USD" && a.value === decimalAmount(cents);
}
export function safeApprovalUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "www.sandbox.paypal.com" ||
    u.username ||
    u.password
  )
    throw new Error("PayPal returned an unexpected approval destination.");
  return u.toString();
}
export function validFile(bytes: Uint8Array, type: string) {
  if (!bytes.length || bytes.length > 2_000_000) return false;
  const b = Buffer.from(bytes);
  if (type === "image/png")
    return b
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg")
    return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (type === "application/pdf")
    return b.subarray(0, 5).toString() === "%PDF-";
  if (type === "text/plain" || type === "text/csv") {
    if (b.length > 32000 || b.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
