import {
  isAuthSensitive,
  MemoryRateLimitStore,
  RateLimitStore,
  RedisRateLimitStore,
} from "../../configs/plugins/rateLimit";

type Mw = (req: never, res: never, next: () => void) => Promise<unknown>;

function call(mw: Mw, over: Record<string, unknown>) {
  const res = {
    code: 0,
    headers: {} as Record<string, unknown>,
    setHeader(k: string, v: unknown) {
      this.headers[k] = v;
    },
    status(c: number) {
      this.code = c;
      return this;
    },
    json() {
      return this;
    },
  };
  let nexted = false;
  return mw(
    { method: "GET", path: "/", ip: "1.1.1.1", socket: {}, body: {}, ...over } as never,
    res as never,
    () => {
      nexted = true;
    },
  ).then(() => ({ res, nexted }));
}

/** APP_ENV được đọc khi tạo middleware: nạp module mới dưới production. */
function build(opts: { store: RateLimitStore; max?: number }): Mw {
  let mw!: Mw;
  const prev = process.env.APP_ENV;
  process.env.APP_ENV = "production";
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mw = require("../../configs/plugins/rateLimit").rateLimitMiddleware(opts);
  });
  process.env.APP_ENV = prev;
  return mw;
}

describe("T-058 rate limit", () => {
  it("store bộ nhớ dọn khóa hết hạn", async () => {
    const s = new MemoryRateLimitStore(3_600_000);
    await s.hit("a", 10);
    await s.hit("b", 10);
    expect(s.size).toBe(2);
    s.sweep(Date.now() + 1000);
    expect(s.size).toBe(0);
    s.stop();
  });

  it("login bị giới hạn riêng theo IP + tài khoản", async () => {
    const store = new MemoryRateLimitStore(3_600_000);
    const mw = build({ store });
    const login = {
      method: "POST",
      path: "/auth/login",
      body: { email: "A@x.com" },
    };
    let blocked = 0;
    for (let i = 0; i < 12; i++)
      if ((await call(mw, login)).res.code === 429) blocked++;
    expect(blocked).toBe(2);
    expect((await call(mw, { ...login, body: { email: "b@x.com" } })).nexted).toBe(true);
    expect((await call(mw, {})).nexted).toBe(true);
    store.stop();
  });

  it("hai instance dùng chung store thì dùng chung giới hạn", async () => {
    const shared = new MemoryRateLimitStore(3_600_000);
    const a = build({ store: shared, max: 2 });
    const b = build({ store: shared, max: 2 });
    await call(a, {});
    await call(b, {});
    expect((await call(a, {})).res.code).toBe(429);
    shared.stop();
  });

  it("Redis store: INCR + PEXPIRE ở lần đầu", async () => {
    const data = new Map<string, number>();
    const expire: Record<string, number> = {};
    const store = new RedisRateLimitStore({
      incr: async (k) => {
        data.set(k, (data.get(k) ?? 0) + 1);
        return data.get(k)!;
      },
      pttl: async (k) => (k in expire ? expire[k]! : -1),
      pexpire: async (k, ms) => {
        expire[k] = ms;
      },
    });
    expect((await store.hit("k", 1000)).count).toBe(1);
    expect((await store.hit("k", 1000)).count).toBe(2);
    expect(expire["rl:k"]).toBe(1000);
  });

  it("nhận diện đường dẫn xác thực nhạy cảm", () => {
    expect(isAuthSensitive({ method: "POST", path: "/api/v1/auth/login" })).toBe(true);
    expect(isAuthSensitive({ method: "POST", path: "/auth/login" })).toBe(true);
    expect(isAuthSensitive({ method: "GET", path: "/auth/login" })).toBe(false);
    expect(isAuthSensitive({ method: "POST", path: "/admin/users" })).toBe(false);
  });
});
