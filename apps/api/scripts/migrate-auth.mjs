import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/auth.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET is required");
}

const postgres = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const migrations = await getMigrations(authOptions(postgres));
  await migrations.runMigrations();
  process.stdout.write("Better Auth PostgreSQL schema is current\n");
} finally {
  await postgres.end();
}
