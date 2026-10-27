import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url || new URL(url).hostname.includes("-pooler"))
  throw new Error(
    "Set DATABASE_URL_UNPOOLED to the direct migration-owner connection.",
  );
const sql = neon(url);
const statements = (
  await readFile(new URL("../db/001_silkpay.sql", import.meta.url), "utf8")
)
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
await sql.transaction(statements.map((statement) => sql.query(statement)));
console.log("SilkPay schema applied.");
