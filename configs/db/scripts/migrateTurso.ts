import { loadDotenv } from "../../loadDotenv";
import { assertMigrationsConfig, migrationsDirectoryResolved } from "../databaseProvider";
import { resolveAndValidateMigrationConfig } from "./resolveDatabaseUrl";

loadDotenv();
import { createClient, type Client } from "@libsql/client";
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { splitSqlStatements } from "./splitSql";

type MigrationFile = {
  name: string;
  sqlPath: string;
  sql: string;
  checksum: string;
};

const MIGRATION_TABLE = "_turso_schema_migrations";
const MIGRATIONS_DIR = migrationsDirectoryResolved();

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function getMigrations(): MigrationFile[] {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return dirs.map((name) => {
    const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
    const sql = readFileSync(sqlPath, "utf8").trim();
    if (!sql) {
      throw new Error(`Migration is empty: ${sqlPath}`);
    }
    return {
      name,
      sqlPath,
      sql,
      checksum: sha256(sql),
    };
  });
}

function resolveTursoUrl(): string {
  const { provider, url, backend } = resolveAndValidateMigrationConfig();
  if (provider !== "sqlite") {
    throw new Error(
      "migrate:turso requires datasource provider = \"sqlite\" in schema.prisma. For Supabase use postgresql + `pnpm db:deploy:auto`.",
    );
  }
  if (backend !== "turso") {
    throw new Error(
      "migrate:turso requires libsql:// (TURSO_DATABASE_URL). For local file SQLite use `pnpm db:deploy`.",
    );
  }
  return url;
}

function resolveAuthToken(url: string): string | undefined {
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url.startsWith("libsql://")) return undefined;
  if (!token) {
    throw new Error(
      "Missing TURSO_AUTH_TOKEN for libsql:// URL. Set TURSO_AUTH_TOKEN.",
    );
  }
  return token;
}

async function ensureMigrationTable(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS "${MIGRATION_TABLE}" (
      "name" TEXT PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "applied_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
  `);
}

async function loadApplied(
  client: Client,
): Promise<Map<string, { checksum: string }>> {
  const rs = await client.execute(
    `SELECT name, checksum FROM "${MIGRATION_TABLE}" ORDER BY name ASC`,
  );
  const out = new Map<string, { checksum: string }>();
  for (const r of rs.rows) {
    const name = String(r.name ?? "");
    if (!name) continue;
    out.set(name, { checksum: String(r.checksum ?? "") });
  }
  return out;
}

async function markApplied(client: Client, m: MigrationFile): Promise<void> {
  await client.execute({
    sql: `INSERT INTO "${MIGRATION_TABLE}"(name, checksum) VALUES (?, ?)`,
    args: [m.name, m.checksum],
  });
}

function parseArgs(): { dryRun: boolean; baseline: boolean } {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has("--dry-run"),
    baseline: args.has("--baseline"),
  };
}

async function run(): Promise<void> {
  assertMigrationsConfig();
  const { dryRun, baseline } = parseArgs();
  if (dryRun && baseline) {
    throw new Error("Choose one mode only: --dry-run OR --baseline.");
  }

  const url = resolveTursoUrl();
  const authToken = resolveAuthToken(url);
  const client = createClient({
    url,
    authToken,
  });

  await ensureMigrationTable(client);
  const migrations = getMigrations();
  const applied = await loadApplied(client);

  const pending = migrations.filter((m) => !applied.has(m.name));
  for (const m of migrations) {
    const seen = applied.get(m.name);
    if (seen && seen.checksum !== m.checksum) {
      throw new Error(
        `Checksum mismatch for applied migration "${m.name}". Expected ${seen.checksum}, current ${m.checksum}.`,
      );
    }
  }

  console.log(
    `[migrate:turso] total=${migrations.length}, applied=${applied.size}, pending=${pending.length}`,
  );
  if (pending.length === 0) {
    console.log("[migrate:turso] up to date.");
    return;
  }

  for (const m of pending) {
    console.log(`[migrate:turso] pending: ${m.name}`);
  }

  if (dryRun) return;

  if (baseline) {
    for (const m of pending) {
      await markApplied(client, m);
      console.log(`[migrate:turso] baseline marked: ${m.name}`);
    }
    return;
  }

  for (const m of pending) {
    const statements = splitSqlStatements(m.sql);
    console.log(
      `[migrate:turso] applying: ${m.name} (${statements.length} statements)`,
    );
    // IRW-FIX-063: toàn bộ câu lệnh + dòng đánh dấu đã áp dụng chạy trong MỘT transaction (batch "write"):
    // lỗi giữa chừng thì rollback, không để lại schema nửa vời mà chạy lại sẽ lỗi "table already exists".
    await client.batch(
      [
        ...statements,
        {
          sql: `INSERT INTO "${MIGRATION_TABLE}"(name, checksum) VALUES (?, ?)`,
          args: [m.name, m.checksum],
        },
      ],
      "write",
    );
    console.log(`[migrate:turso] applied: ${m.name}`);
  }
}

void run().catch((err) => {
  console.error("[migrate:turso] failed:", err);
  process.exit(1);
});

