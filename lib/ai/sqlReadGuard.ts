/** Prisma models excluded from AI SQL prompts and execution. Extend per project. */
export const AI_SENSITIVE_MODELS = new Set(["Password", "UserPushToken"]);

/** Table names (@@map) matching {@link AI_SENSITIVE_MODELS}. */
export const AI_SENSITIVE_TABLES = new Set(["passwords", "user_push_tokens"]);

/**
 * Catalog / system objects an AI-generated query must never touch (schema discovery,
 * file access, extension loading). Matched as whole identifiers, case-insensitive.
 */
const AI_BLOCKED_SYSTEM_IDENTIFIERS = new Set([
  "information_schema",
  "load_extension",
  "readfile",
  "writefile",
  "dblink",
  "lo_import",
  "lo_export",
]);
/** Any identifier with these prefixes is a system object (`sqlite_master`, `pg_catalog`, `pg_read_file`...). */
const AI_BLOCKED_SYSTEM_PREFIXES = ["sqlite_", "pg_"];

export function isAiSensitiveModel(modelName: string): boolean {
  return AI_SENSITIVE_MODELS.has(modelName.trim());
}

/**
 * Splits SQL into identifier tokens, ignoring comments and string literals.
 * Handles `--`, `/* *\/`, '...' ('' escape), "..." / `...` / [...] quoted identifiers
 * (returned unquoted) and PostgreSQL `$tag$...$tag$` strings.
 * Returns `null` when the text is malformed (unterminated string/comment/quote) so the
 * caller can fail closed.
 */
export function extractSqlIdentifiers(sql: string): string[] | null {
  const ids: string[] = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];

    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 2;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= n) return null;
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      let name = "";
      for (;;) {
        if (j >= n) return null;
        if (sql[j] === close) {
          if (close !== "]" && sql[j + 1] === close) {
            name += close;
            j += 2;
            continue;
          }
          break;
        }
        name += sql[j];
        j++;
      }
      ids.push(name);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        if (end === -1) return null;
        i = end + m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j]!)) j++;
      ids.push(sql.slice(i, j));
      i = j;
      continue;
    }
    i++;
  }
  return ids;
}

/**
 * `true` when the SQL must be refused: it mentions a blocked table (as a bare, quoted or
 * schema-qualified identifier, in FROM/JOIN lists, subqueries or anywhere else), touches a
 * system catalog, or cannot be tokenised safely.
 */
export function sqlReferencesBlockedTable(sql: string, blocked = AI_SENSITIVE_TABLES): boolean {
  const normalized = sql.trim();
  if (!normalized) return false;
  const ids = extractSqlIdentifiers(normalized);
  if (ids === null) return true;
  const blockedLower = new Set([...blocked].map((t) => t.toLowerCase()));
  for (const raw of ids) {
    const id = raw.trim().toLowerCase();
    if (blockedLower.has(id)) return true;
    if (AI_BLOCKED_SYSTEM_IDENTIFIERS.has(id)) return true;
    if (AI_BLOCKED_SYSTEM_PREFIXES.some((p) => id.startsWith(p))) return true;
  }
  return false;
}

/** Remove sensitive `model` blocks from schema text shown to the LLM. */
export function stripSensitiveModelsFromSchema(
  schemaText: string,
  blocked = AI_SENSITIVE_MODELS,
): string {
  if (blocked.size === 0) return schemaText;
  return schemaText.replace(/model\s+(\w+)\s*\{[\s\S]*?\n\}/g, (block, modelName: string) => {
    if (!blocked.has(modelName)) return block;
    return `// [excluded from AI queries] model ${modelName} { ... }\n`;
  });
}
