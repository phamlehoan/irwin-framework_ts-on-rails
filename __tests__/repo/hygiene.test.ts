import fs from "node:fs";
import path from "node:path";
import { splitSqlStatements } from "../../configs/db/scripts/splitSql";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (["node_modules", "dist", "generated", ".git", "__tests__"].includes(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|js|mjs|pug|json|md|toml|ya?ml|example)$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("T-061 quét từ khóa dấu vết dự án cũ", () => {
  // Ghép chuỗi để chính file test không tự trúng danh sách cấm.
  const banned = [
    ["task", "-activities"],
    ["task", "-attachments"],
    ["railsquery", "_engine"],
    ["ware", "house"],
    ["account", "Name"],
    ["account", "Type"],
    ['code: "', 'WORKER"'],
  ].map((p) => p.join(""));

  it("mã nguồn, cấu hình và tài liệu không chứa từ khóa cấm", () => {
    const files = [
      ...walk("app"),
      ...walk("lib"),
      ...walk("configs"),
      ...walk("scripts"),
      "README.md",
      "package.json",
      "serverless.yml",
      "tsconfig.json",
      "lambda.ts",
    ];
    const hits: string[] = [];
    for (const f of files) {
      const text = read(f);
      for (const b of banned) if (text.includes(b)) hits.push(`${f}: ${b}`);
    }
    expect(hits).toEqual([]);
  });

  it("đăng ký Google không còn nối vai trò cứng đã bị seed xóa", () => {
    expect(read("app/services/auth/googleVerify.service.ts")).not.toMatch(
      /connect:\s*\{\s*code:\s*"[A-Z]+"/,
    );
  });
});

describe("T-062 cấu hình tồn dư đã dọn", () => {
  it("serverless.yml dùng tên engine Prisma thật", () => {
    const y = read("serverless.yml");
    expect(y).toContain("query_engine");
  });
  it("README không còn lệnh yarn g:*", () => {
    expect(read("README.md")).not.toMatch(/yarn g:/);
  });
  it("ExampleJob1 được export từ app/jobs", () => {
    expect(read("app/jobs/index.ts")).toContain("example1.job");
  });
  it("lambda.ts nhận EventBridge ở mọi lần gọi, không chỉ cold start", () => {
    const src = read("lambda.ts");
    expect(src).toContain("isScheduledEvent");
    expect(src).not.toMatch(/if \(!cachedHandler\) \{\s*await application\.initialize/);
  });
  it("jest.config roots trỏ tới thư mục tồn tại", () => {
    expect(fs.existsSync(path.join(ROOT, "__tests__"))).toBe(true);
  });
});

describe("T-063 migration runner có transaction", () => {
  it("tách câu lệnh tôn trọng chuỗi và bỏ chú thích", () => {
    const sql = `-- c\nCREATE TABLE "a" ("x" TEXT DEFAULT ';');\nINSERT INTO a VALUES ('it''s;ok');\n`;
    expect(splitSqlStatements(sql)).toEqual([
      `CREATE TABLE "a" ("x" TEXT DEFAULT ';')`,
      `INSERT INTO a VALUES ('it''s;ok')`,
    ]);
  });
  it("runner áp dụng migration và đánh dấu trong một batch ghi (transaction)", () => {
    const src = read("configs/db/scripts/migrateTurso.ts");
    expect(src).toMatch(/client\.batch\(/);
    expect(src).toMatch(/"write"/);
  });
  it("migration mới chỉ cộng thêm (không DROP)", () => {
    const dir = "configs/db/migrations/20261105090000_passwords_user_type_index";
    const sql = read(`${dir}/migration.sql`);
    expect(sql).toMatch(/CREATE INDEX/);
    expect(sql).not.toMatch(/DROP|ALTER TABLE .* DROP/i);
  });
});

describe("T-065 mẫu gọn và ghim phiên bản", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  // Ngưỡng ghi trong CHANGELOG.md (mục "Dependency của mẫu"); 54 -> 51 sau khi gỡ thư viện không dùng.
  const MAX_RUNTIME_DEPENDENCIES = 51;

  it("số dependency runtime không vượt ngưỡng", () => {
    expect(Object.keys(pkg.dependencies).length).toBeLessThanOrEqual(MAX_RUNTIME_DEPENDENCIES);
  });
  it("đã gỡ các thư viện không được import", () => {
    for (const d of ["lodash", "decimal.js", "punycode"]) {
      expect(pkg.dependencies[d]).toBeUndefined();
    }
  });
  it("phiên bản được ghim chính xác (không ^ hoặc ~)", () => {
    const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter(([, v]) => /^[\^~]/.test(v))
      .map(([k]) => k);
    expect(loose).toEqual([]);
  });
});
