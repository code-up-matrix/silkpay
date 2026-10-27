import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { query } from "./db";
import type { Workspace, Role } from "./types";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function origin(request: Request) {
  const expected =
    process.env.NODE_ENV === "production"
      ? process.env.APP_ORIGIN
      : new URL(request.url).origin;
  const actual = request.headers.get("origin");
  if (!actual || !expected || actual !== expected)
    throw new HttpError(403, "This request must come from SilkPay.");
}
export async function boundedBody(request: Request, maximum = 32768) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.length;
    if (total > maximum) {
      await reader.cancel();
      throw new HttpError(413, "The upload is too large.");
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}
export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Send JSON.");
  let value;
  try {
    value = JSON.parse((await boundedBody(request)).toString());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "The request is not valid JSON.");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(
      400,
      parsed.error.issues[0]?.message || "Check the form fields.",
    );
  return parsed.data;
}
export function sessionToken(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("silkpay_session="))
    ?.slice(16);
}
export async function identity(
  request: Request,
  requiredRole?: Role,
): Promise<Workspace> {
  const value = sessionToken(request);
  if (!value)
    throw new HttpError(401, "Open your sandbox workspace to continue.");
  const [who] = await query<Workspace>(
    "SELECT w.id,w.company,s.role,s.order_id FROM sessions s JOIN workspaces w ON w.id=s.workspace_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hash(value)],
  );
  if (!who) throw new HttpError(401, "Your workspace session has expired.");
  if (requiredRole && who.role !== requiredRole)
    throw new HttpError(
      403,
      "Only the " + requiredRole + " can perform this action.",
    );
  return who;
}
export function setSession(response: Response, value: string) {
  response.headers.set(
    "Set-Cookie",
    "silkpay_session=" +
      value +
      "; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800" +
      (process.env.NODE_ENV === "production" ? "; Secure" : ""),
  );
  return response;
}
export async function limit(key: string, maximum: number, seconds = 60) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const [r] = await query<{ hits: number }>(
    "INSERT INTO rate_limits(key,bucket,hits) VALUES($1,$2,1) ON CONFLICT(key,bucket) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits",
    [key, bucket],
  );
  if (r.hits > maximum)
    throw new HttpError(429, "Please wait before trying again.");
}
export const ipKey = (r: Request) =>
  hash(
    r.headers.get("x-vercel-forwarded-for") ||
      r.headers.get("x-forwarded-for") ||
      "local",
  );
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(
      "SilkPay request failed",
      e instanceof Error ? e.name : "UnknownError",
    );
    return json(
      {
        error:
          "The request could not be completed. Your payment status has not been assumed successful. Please refresh and try again.",
      },
      500,
    );
  }
}
