import jsonwebtoken from "jsonwebtoken";

type JwtModule = typeof import("@lib/utils/jwt");

/** Loads a fresh copy of the jwt module (and env) under the given environment variables. */
function loadJwt(envVars: Record<string, string | undefined>): JwtModule {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(envVars)) {
    saved[k] = process.env[k];
    if (envVars[k] === undefined) delete process.env[k];
    else process.env[k] = envVars[k];
  }
  try {
    let mod!: JwtModule;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("@lib/utils/jwt");
    });
    return mod;
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const STRONG = "0123456789abcdef0123456789abcdef";

describe("secret hardening", () => {
  it("allows the placeholder secret in development/test", () => {
    const jwt = loadJwt({ APP_ENV: "test", JWT_SECRET: undefined });
    expect(() => jwt.generateToken({ id: "u1" })).not.toThrow();
  });

  it.each(["production", "staging"])("refuses a missing JWT_SECRET in %s", (appEnv) => {
    const jwt = loadJwt({ APP_ENV: appEnv, JWT_SECRET: undefined });
    expect(() => jwt.generateToken({ id: "u1" })).toThrow(/JWT_SECRET/);
  });

  it("refuses placeholder and short secrets in production", () => {
    expect(() =>
      loadJwt({ APP_ENV: "production", JWT_SECRET: "your-jwt-secret" }).generateToken({}),
    ).toThrow(/JWT_SECRET/);
    expect(() =>
      loadJwt({ APP_ENV: "production", JWT_SECRET: "short" }).generateToken({}),
    ).toThrow(/JWT_SECRET/);
  });

  it("accepts a strong secret in production", () => {
    const jwt = loadJwt({ APP_ENV: "production", JWT_SECRET: STRONG });
    expect(jwt.verifyToken(jwt.generateToken({ id: "u1" })).id).toBe("u1");
  });
});

describe("token types", () => {
  const jwt = loadJwt({ APP_ENV: "production", JWT_SECRET: STRONG });

  it("accepts an access token only as access", () => {
    const t = jwt.generateAccessToken({ id: "u1", roles: ["ADMIN"] });
    expect(jwt.verifyTokenOfType(t, jwt.TOKEN_TYPE_ACCESS).id).toBe("u1");
    expect(() => jwt.verifyTokenOfType(t, jwt.TOKEN_TYPE_REFRESH)).toThrow();
  });

  it("does not accept a refresh token as an access token", () => {
    const t = jwt.generateRefreshToken({ id: "u1" });
    expect(() => jwt.verifyTokenOfType(t, jwt.TOKEN_TYPE_ACCESS)).toThrow();
    expect(jwt.verifyTokenOfType(t, jwt.TOKEN_TYPE_REFRESH).id).toBe("u1");
  });

  it("does not accept purpose tokens (invite / password reset) as access or refresh", () => {
    const t = jwt.generateToken({ id: "u1", purpose: "password_reset" }, "15m");
    expect(() => jwt.verifyTokenOfType(t, jwt.TOKEN_TYPE_ACCESS)).toThrow();
    expect(() => jwt.verifyTokenOfType(t, jwt.TOKEN_TYPE_REFRESH)).toThrow();
    // even if someone forges typ=access next to a purpose claim
    const both = jwt.generateToken({ id: "u1", typ: "access", purpose: "invite_activate" });
    expect(() => jwt.verifyTokenOfType(both, jwt.TOKEN_TYPE_ACCESS)).toThrow();
  });

  it("does not accept legacy tokens without typ as access tokens", () => {
    const t = jwt.generateToken({ id: "u1", roles: [] });
    expect(() => jwt.verifyTokenOfType(t, jwt.TOKEN_TYPE_ACCESS)).toThrow();
  });

  it("verifyRefreshToken: accepts typ=refresh and legacy (no typ), rejects access / purpose tokens", () => {
    expect(jwt.verifyRefreshToken(jwt.generateRefreshToken({ id: "u1" })).id).toBe("u1");
    expect(jwt.verifyRefreshToken(jwt.generateToken({ id: "u1" }, "7d")).id).toBe("u1");
    expect(() => jwt.verifyRefreshToken(jwt.generateAccessToken({ id: "u1" }))).toThrow();
    expect(() =>
      jwt.verifyRefreshToken(jwt.generateToken({ id: "u1", purpose: "password_reset" })),
    ).toThrow();
  });

  it("rejects alg=none and tokens signed with another secret", () => {
    const none = jsonwebtoken.sign({ id: "u1", typ: "access" }, "", { algorithm: "none" });
    expect(() => jwt.verifyToken(none)).toThrow();
    const forged = jsonwebtoken.sign({ id: "u1", typ: "access" }, "another-secret-of-length-32-chars!!");
    expect(() => jwt.verifyToken(forged)).toThrow();
  });

  it("rejects an expired token", () => {
    const t = jwt.generateAccessToken({ id: "u1" }, "-1s");
    expect(() => jwt.verifyTokenOfType(t, jwt.TOKEN_TYPE_ACCESS)).toThrow(/expired/i);
  });
});
