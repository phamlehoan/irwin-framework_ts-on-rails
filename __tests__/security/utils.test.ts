import { isApiRequest, unauthenticatedStatus, apiPrefix } from "@lib/utils/http";
import { normalizeEmail, registrationEnabled } from "@lib/utils/email";
import { validatePassword, passwordMinLength } from "@lib/utils/passwordPolicy";
import {
  getCachedPermissions,
  invalidateAllPermissions,
  invalidateUserPermissions,
  setCachedPermissions,
} from "@lib/security/permissionCache";
import {
  consumeOAuthState,
  establishSession,
  newOAuthState,
} from "@lib/security/sessionLogin";
import { replaceUserRoles, replaceRolePermissions } from "@lib/utils/transaction";
import type { Request } from "express";

describe("T-007 nhận diện API theo tiền tố", () => {
  it.each([
    ["/api/v1/me", true],
    ["/api", true],
    ["/api?x=1", true],
    ["/admin/apis", false],
    ["/settings/api-keys", false],
    ["/login?next=/api/x", false],
  ])("%s -> %s", (url, expected) => {
    expect(isApiRequest({ originalUrl: url })).toBe(expected);
  });
  it("API_PREFIX đổi được", () => {
    process.env.API_PREFIX = "v9";
    expect(apiPrefix()).toBe("/v9");
    expect(isApiRequest({ originalUrl: "/v9/x" })).toBe(true);
    delete process.env.API_PREFIX;
  });
});

describe("T-060 401 vs 403", () => {
  it("chưa xác thực -> 401; AUTH_LEGACY_403=true -> 403", () => {
    delete process.env.AUTH_LEGACY_403;
    expect(unauthenticatedStatus()).toBe(401);
    process.env.AUTH_LEGACY_403 = "true";
    expect(unauthenticatedStatus()).toBe(403);
    delete process.env.AUTH_LEGACY_403;
  });
});

describe("T-057 email và mật khẩu", () => {
  it("A@x.com và a@x.com là một", () => {
    expect(normalizeEmail("  A@X.com ")).toBe("a@x.com");
    expect(normalizeEmail(undefined)).toBe("");
  });
  it("chính sách mật khẩu một nơi: tối thiểu 8, chặn mật khẩu phổ biến", () => {
    expect(passwordMinLength()).toBe(8);
    expect(validatePassword("short")).not.toBeNull();
    expect(validatePassword("password1")).not.toBeNull();
    expect(validatePassword("Tr0ub4dor&3x")).toBeNull();
  });
  it("cờ tắt đăng ký công khai", () => {
    delete process.env.REGISTRATION_ENABLED;
    expect(registrationEnabled()).toBe(true);
    process.env.REGISTRATION_ENABLED = "false";
    expect(registrationEnabled()).toBe(false);
    delete process.env.REGISTRATION_ENABLED;
  });
});

describe("T-064 cache quyền (đơn vị)", () => {
  beforeEach(() => invalidateAllPermissions());
  it("lưu, đọc, vô hiệu theo user và toàn bộ", () => {
    setCachedPermissions("u", ["A::READ"]);
    expect(getCachedPermissions("u")).toEqual(["A::READ"]);
    invalidateUserPermissions("u");
    expect(getCachedPermissions("u")).toBeUndefined();
    setCachedPermissions("u", ["x"]);
    invalidateAllPermissions();
    expect(getCachedPermissions("u")).toBeUndefined();
  });
  it("PERMISSION_CACHE_TTL_MS=0 tắt cache", () => {
    process.env.PERMISSION_CACHE_TTL_MS = "0";
    setCachedPermissions("u", ["x"]);
    expect(getCachedPermissions("u")).toBeUndefined();
    delete process.env.PERMISSION_CACHE_TTL_MS;
  });
});

describe("T-054/055 state OAuth và session", () => {
  const mkReq = () => {
    const session: Record<string, unknown> = {
      id: "old",
      regenerate(cb: (e?: Error) => void) {
        // Giống express-session: session mới, dữ liệu cũ mất, ID đổi.
        for (const k of Object.keys(session))
          if (typeof session[k] !== "function") delete session[k];
        session.id = "new";
        cb();
      },
      save(cb: (e?: Error) => void) {
        cb();
      },
    };
    return { session } as never as Request;
  };
  it("callback thiếu hoặc khác state bị từ chối, đúng state chỉ dùng một lần", () => {
    const req = mkReq();
    newOAuthState(req);
    expect(consumeOAuthState(req, undefined)).toBe(false);
    const req2 = mkReq();
    newOAuthState(req2);
    expect(consumeOAuthState(req2, "khac")).toBe(false);
    const req3 = mkReq();
    const s3 = newOAuthState(req3);
    expect(consumeOAuthState(req3, s3)).toBe(true);
    expect(consumeOAuthState(req3, s3)).toBe(false);
  });
  it("sau login ID session đổi và userId được gắn vào session mới", async () => {
    const req = mkReq();
    const before = (req.session as unknown as { id: string }).id;
    await establishSession(req, "u1");
    expect((req.session as unknown as { id: string }).id).not.toBe(before);
    expect(req.session.userId).toBe("u1");
  });
});

describe("T-059 thay vai trò/quyền (dùng trong transaction)", () => {
  it("lỗi giữa chừng được lan ra để $transaction rollback", async () => {
    const calls: string[] = [];
    const tx = {
      userToRole: {
        deleteMany: async () => {
          calls.push("delete");
        },
        createMany: async () => {
          calls.push("create");
          throw new Error("boom");
        },
      },
      roleToPermission: {
        deleteMany: async () => {
          calls.push("rdelete");
        },
        createMany: async () => {
          calls.push("rcreate");
        },
      },
    };
    await expect(
      replaceUserRoles(tx as never, "u", ["r1", "r1", "r2"]),
    ).rejects.toThrow("boom");
    expect(calls).toEqual(["delete", "create"]);
    await replaceRolePermissions(tx as never, "r", []);
    expect(calls.slice(2)).toEqual(["rdelete"]);
  });
});
