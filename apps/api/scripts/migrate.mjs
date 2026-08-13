import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(
  here,
  "../../../deploy/posterract/postgres/init",
);
const postgres = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  await postgres.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of files) {
    const sql = await readFile(join(migrationsDirectory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await postgres.query(
      "select checksum from schema_migrations where name = $1",
      [name],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration ${name} has changed`);
      }
      continue;
    }

    const client = await postgres.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (name, checksum) values ($1, $2)",
        [name, checksum],
      );
      await client.query("commit");
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await postgres.end();
}
