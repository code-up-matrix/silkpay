import "server-only";
import { neon } from "@neondatabase/serverless";
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!process.env.DATABASE_URL)
    throw new Error("Database connection is not configured.");
  const sql = neon(process.env.DATABASE_URL);
  return (await sql.query(text, params, {
    fetchOptions: { signal: AbortSignal.timeout(20000) },
  })) as T[];
}
