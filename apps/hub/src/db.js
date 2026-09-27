import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

export const postgres = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.HUB_PG_POOL_MAX ?? 10),
});

/** Run a function inside a transaction, rolling back on any throw. */
export async function withTransaction(run) {
  const client = await postgres.connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Emails are the identity key — always trimmed and lower-cased. */
export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}
