import {
  extractSqlIdentifiers,
  sqlReferencesBlockedTable,
  stripSensitiveModelsFromSchema,
} from "@lib/ai/sqlReadGuard";

describe("sqlReferencesBlockedTable", () => {
  const blockedCases: Array<[string, string]> = [
    ["plain FROM", "SELECT * FROM passwords"],
    ["JOIN", "SELECT u.id FROM users u JOIN passwords p ON p.user_id = u.id"],
    ["comma join", "SELECT * FROM users, passwords"],
    ["schema qualified (public.)", "SELECT * FROM public.passwords"],
    ["schema qualified (main.)", "SELECT * FROM main.passwords"],
    ["double-quoted", 'SELECT * FROM "passwords"'],
    ["fully quoted + schema", 'SELECT * FROM "main"."passwords"'],
    ["backtick", "SELECT * FROM `passwords`"],
    ["bracket", "SELECT * FROM [passwords]"],
    ["upper case", "SELECT * FROM PASSWORDS"],
    ["comment between tokens", "SELECT * FROM/**/passwords"],
    ["subquery", "SELECT * FROM (SELECT * FROM passwords) t"],
    ["CTE", "WITH x AS (SELECT * FROM user_push_tokens) SELECT * FROM x"],
    ["line break", "SELECT *\nFROM\n  passwords"],
    ["sqlite_master", "SELECT sql FROM sqlite_master"],
    ["information_schema", "SELECT * FROM information_schema.tables"],
    ["pg catalog", "SELECT * FROM pg_catalog.pg_shadow"],
    ["pg file function", "SELECT pg_read_file('/etc/passwd')"],
    ["unterminated string (fail closed)", "SELECT 'abc FROM users"],
    ["unterminated comment (fail closed)", "SELECT * FROM users /* x"],
  ];

  it.each(blockedCases)("blocks: %s", (_label, sql) => {
    expect(sqlReferencesBlockedTable(sql)).toBe(true);
  });

  const allowedCases: Array<[string, string]> = [
    ["plain read", "SELECT id, email FROM users WHERE deleted = 0"],
    ["join of allowed tables", "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id"],
    ["table name only inside string literal", "SELECT * FROM users WHERE note = 'see passwords table'"],
    ["table name only inside comment", "SELECT * FROM users -- passwords\nWHERE id = 1"],
    ["table name only inside block comment", "SELECT * FROM users /* passwords */"],
    ["similar but different table", "SELECT * FROM passwords_audit_log_view_not_blocked"],
    ["empty", ""],
  ];

  it.each(allowedCases)("allows: %s", (_label, sql) => {
    expect(sqlReferencesBlockedTable(sql)).toBe(false);
  });

  it("honours a custom blocked set", () => {
    expect(sqlReferencesBlockedTable("SELECT * FROM secrets", new Set(["secrets"]))).toBe(true);
    expect(sqlReferencesBlockedTable("SELECT * FROM passwords", new Set(["secrets"]))).toBe(false);
  });
});

describe("extractSqlIdentifiers", () => {
  it("skips strings/comments and unquotes identifiers", () => {
    expect(extractSqlIdentifiers(`SELECT "A""B", 'x y' /* c */ FROM t -- z`)).toEqual([
      "SELECT",
      'A"B',
      "FROM",
      "t",
    ]);
  });

  it("skips PostgreSQL dollar-quoted strings", () => {
    expect(extractSqlIdentifiers("SELECT $$ passwords $$ FROM t")).toEqual(["SELECT", "FROM", "t"]);
  });

  it("returns null when malformed", () => {
    expect(extractSqlIdentifiers("SELECT 'oops")).toBeNull();
    expect(extractSqlIdentifiers('SELECT "oops')).toBeNull();
    expect(extractSqlIdentifiers("SELECT /* oops")).toBeNull();
  });
});

describe("stripSensitiveModelsFromSchema", () => {
  it("replaces only the blocked model blocks", () => {
    const schema = [
      "model User {",
      "  id String @id",
      "}",
      "model Password {",
      "  id String @id",
      "  password String",
      "}",
    ].join("\n");
    const out = stripSensitiveModelsFromSchema(schema);
    expect(out).toContain("model User {");
    expect(out).not.toContain("password String");
    expect(out).toContain("[excluded from AI queries] model Password");
  });
});
