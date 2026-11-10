/**
 * Mô hình dữ liệu trong bộ nhớ đủ dùng cho test (không DB). Chỉ hỗ trợ các bộ lọc test cần:
 * so khớp bằng, `in`, `not`, `OR`. Dùng qua `jest.mock("@models", () => require("../helpers/memoryModels").modelsModule)`.
 */
type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((w) => matches(row, w));
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(row[k]);
      if ("not" in c) return row[k] !== c.not;
      return true;
    }
    return row[k] === cond;
  });
}

export function createTable(name: string) {
  const rows: Row[] = [];
  let seq = 0;
  const calls = { findFirst: 0, findMany: 0, create: 0, update: 0, deleteMany: 0 };
  const table = {
    rows,
    calls,
    async create({ data }: { data: Row }) {
      calls.create++;
      const row = { id: `${name}-${++seq}`, deleted: false, createdAt: new Date(Date.now() + seq), ...data };
      rows.push(row);
      return row;
    },
    async createMany({ data }: { data: Row[] }) {
      for (const d of data) await table.create({ data: d });
      return { count: data.length };
    },
    async findFirst({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) {
      calls.findFirst++;
      const found = rows.filter((r) => matches(r, where));
      if (orderBy && "createdAt" in orderBy) {
        found.sort((a, b) =>
          orderBy.createdAt === "desc"
            ? +(b.createdAt as Date) - +(a.createdAt as Date)
            : +(a.createdAt as Date) - +(b.createdAt as Date),
        );
      }
      return found[0] ?? null;
    },
    async findMany({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) {
      calls.findMany++;
      const found = rows.filter((r) => matches(r, where));
      if (orderBy && "createdAt" in orderBy) {
        found.sort((a, b) =>
          orderBy.createdAt === "desc"
            ? +(b.createdAt as Date) - +(a.createdAt as Date)
            : +(a.createdAt as Date) - +(b.createdAt as Date),
        );
      }
      return found;
    },
    async update({ where, data }: { where: Row; data: Row }) {
      calls.update++;
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row ?? null;
    },
    async updateMany({ where, data }: { where?: Row; data: Row }) {
      let count = 0;
      for (const r of rows) if (matches(r, where)) { Object.assign(r, data); count++; }
      return { count };
    },
    async deleteMany({ where }: { where?: Row } = {}) {
      calls.deleteMany++;
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i]!, where)) { rows.splice(i, 1); count++; }
      }
      return { count };
    },
  };
  return table;
}

export const PasswordType = { PASSWORD: "PASSWORD", REFRESH_TOKEN: "REFRESH_TOKEN", OTP: "OTP" };
export const UserStatus = { ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", PENDING: "PENDING" };

export const models = {
  password: createTable("password"),
  user: createTable("user"),
  role: createTable("role"),
  userToRole: createTable("userToRole"),
  userToPermission: createTable("userToPermission"),
  roleToPermission: createTable("roleToPermission"),
  feature: createTable("feature"),
  permission: createTable("permission"),
  $transaction: async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(models) : Promise.all(arg as unknown[]),
};

export function resetModels(): void {
  for (const t of Object.values(models)) {
    if (typeof t === "object" && "rows" in t) {
      t.rows.length = 0;
      for (const k of Object.keys(t.calls)) (t.calls as Record<string, number>)[k] = 0;
    }
  }
}

export const modelsModule = { __esModule: true, default: models, PasswordType, UserStatus };
