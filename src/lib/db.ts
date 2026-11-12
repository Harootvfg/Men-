import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";

/** Minimal driver interface. Implemented by embedded PGlite (local) and node-postgres (production). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

type G = typeof globalThis & { __vasDb?: Promise<Db> };
const g = globalThis as G;

async function open(): Promise<Db> {
  let db: Db;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    db = {
      query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const memory = process.env.DATA_DIR === ":memory:";
    const lite = memory ? new PGlite() : new PGlite(path.join(dataDir(), "pg"));
    // PGlite is single-connection; serialise access explicitly.
    let chain: Promise<unknown> = Promise.resolve();
    db = {
      query: (sql, params) => {
        const run = chain.then(async () => (await lite.query(sql, params as unknown[])).rows);
        chain = run.catch(() => undefined);
        return run as Promise<never[]>;
      },
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

async function migrate(db: Db) {
  await db.query("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const dir = path.resolve(process.cwd(), "migrations");
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM _migrations")).map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const statements = fs.readFileSync(path.join(dir, file), "utf8").split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
    for (const s of statements) await db.query(s);
    await db.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
  }
}

export function getDb(): Promise<Db> {
  if (!g.__vasDb) g.__vasDb = open();
  return g.__vasDb;
}
export async function closeDb() {
  if (g.__vasDb) { const db = await g.__vasDb; g.__vasDb = undefined; await db.close(); }
}
