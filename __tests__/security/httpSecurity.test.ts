import {
  buildCorsOptions,
  csrfGuardMiddleware,
  parseOrigins,
  parseTrustProxy,
  securityHeadersMiddleware,
} from "../../configs/plugins/httpSecurity";
import { sessionSameSite } from "../../configs/initializers/session";

type Hdrs = Record<string, string>;
function run(
  mw: (req: never, res: never, next: () => void) => void,
  req: Record<string, unknown>,
) {
  const res = {
    code: 0,
    body: undefined as unknown,
    headers: {} as Hdrs,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    removeHeader() {},
    status(c: number) {
      this.code = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  let nexted = false;
  mw(req as never, res as never, () => {
    nexted = true;
  });
  return { res, nexted };
}
const reqOf = (over: Record<string, unknown>) => ({
  method: "POST",
  originalUrl: "/auth/login",
  headers: {} as Hdrs,
  get(h: string) {
    return (this.headers as Hdrs)[h.toLowerCase()];
  },
  ...over,
});

describe("T-053 CORS", () => {
  it("production thiếu CORS_ORIGIN: không bật origin:true + credentials", () => {
    expect(buildCorsOptions({ APP_ENV: "production" } as never)).toEqual({
      origin: false,
    });
  });
  it("dev giữ hành vi cũ", () => {
    expect(buildCorsOptions({ APP_ENV: "development" } as never)).toEqual({
      origin: true,
      credentials: true,
    });
  });
  it("CORS_ALLOW_ALL=true quay lại hành vi cũ ở production", () => {
    expect(
      buildCorsOptions({ APP_ENV: "production", CORS_ALLOW_ALL: "true" } as never)
        .origin,
    ).toBe(true);
  });
  it("origin lạ không được phản hồi, origin trong danh sách thì có", () => {
    const o = buildCorsOptions({
      APP_ENV: "production",
      CORS_ORIGIN: "https://a.example, https://b.example/",
    } as never);
    const check = (origin?: string) => {
      let out: unknown;
      (
        o.origin as (
          o: string | undefined,
          cb: (e: null, a: boolean) => void,
        ) => void
      )(origin, (_e, a) => {
        out = a;
      });
      return out;
    };
    expect(check("https://evil.example")).toBe(false);
    expect(check("https://b.example")).toBe(true);
    expect(check(undefined)).toBe(true);
    expect(parseOrigins("x, y/")).toEqual(["x", "y"]);
  });
});

describe("T-053 header bảo mật và cookie", () => {
  it("đặt header bảo mật cơ bản; HSTS chỉ ở production", () => {
    const dev = run(
      securityHeadersMiddleware({ APP_ENV: "development" } as never),
      reqOf({}),
    );
    expect(dev.res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(dev.res.headers["Strict-Transport-Security"]).toBeUndefined();
    const prod = run(
      securityHeadersMiddleware({ APP_ENV: "production" } as never),
      reqOf({}),
    );
    expect(prod.res.headers["Strict-Transport-Security"]).toContain("max-age");
  });
  it("sameSite mặc định lax, chỉnh được", () => {
    expect(sessionSameSite(undefined)).toBe("lax");
    expect(sessionSameSite("STRICT")).toBe("strict");
    expect(sessionSameSite("bogus")).toBe("lax");
  });
  it("TRUST_PROXY phân tích đúng", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("")).toBeUndefined();
    expect(parseTrustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
  });
});

describe("T-053 CSRF cho form session", () => {
  const mw = csrfGuardMiddleware({} as never);
  it("POST có cookie, Origin lạ -> 403", () => {
    const r = run(
      mw,
      reqOf({
        headers: {
          cookie: "sid=1",
          origin: "https://evil.example",
          host: "app.example",
        },
      }),
    );
    expect(r.res.code).toBe(403);
    expect(r.nexted).toBe(false);
  });
  it("POST có cookie, không Origin/Referer -> 403", () => {
    const r = run(
      mw,
      reqOf({ headers: { cookie: "sid=1", host: "app.example" } }),
    );
    expect(r.res.code).toBe(403);
  });
  it("cùng origin -> cho qua", () => {
    const r = run(
      mw,
      reqOf({
        headers: {
          cookie: "sid=1",
          origin: "https://app.example",
          host: "app.example",
        },
      }),
    );
    expect(r.nexted).toBe(true);
  });
  it("header X-Irwin-CSRF -> cho qua", () => {
    const r = run(
      mw,
      reqOf({
        headers: { cookie: "sid=1", "x-irwin-csrf": "1", host: "app.example" },
      }),
    );
    expect(r.nexted).toBe(true);
  });
  it("GET và API Bearer không bị chặn; CSRF_PROTECTION=off tắt hẳn", () => {
    expect(
      run(mw, reqOf({ method: "GET", headers: { cookie: "a=b" } })).nexted,
    ).toBe(true);
    expect(
      run(mw, reqOf({ originalUrl: "/api/v1/x", headers: { cookie: "a=b" } }))
        .nexted,
    ).toBe(true);
    const off = csrfGuardMiddleware({ CSRF_PROTECTION: "off" } as never);
    expect(
      run(
        off,
        reqOf({ headers: { cookie: "a=b", origin: "https://evil.example" } }),
      ).nexted,
    ).toBe(true);
  });
});
