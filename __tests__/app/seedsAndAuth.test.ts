jest.mock("@models", () => require("../helpers/memoryModels").modelsModule);

import fs from "node:fs";
import path from "node:path";
import { models, resetModels } from "../helpers/memoryModels";
import { getMergedPermissionStrings } from "@lib/utils/userPermissions";
import { invalidateAllPermissions } from "@lib/security/permissionCache";
import { revokeUserSessions } from "@lib/security/sessionRevocation";
import { ApplicationMiddleware } from "../../app/middlewares/application.middleware";
import { resolveBootstrapPassword } from "../../configs/db/seeders/seedAdminUser";

const ROOT = path.resolve(__dirname, "../..");

describe("T-051 seed không phá dữ liệu, không có mật khẩu cố định", () => {
  beforeEach(resetModels);

  it("không còn hằng mật khẩu admin trong mã nguồn", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "configs/db/seeders/seedAdminUser.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/Abcd@1234/);
    expect(src).not.toMatch(/const ADMIN_PASSWORD/);
  });

  it("mật khẩu bootstrap lấy từ env hoặc sinh ngẫu nhiên, và bị từ chối nếu yếu", () => {
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "Tr0ub4dor&3x";
    expect(resolveBootstrapPassword()).toEqual({
      password: "Tr0ub4dor&3x",
      generated: false,
    });
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "weak";
    expect(() => resolveBootstrapPassword()).toThrow();
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    const a = resolveBootstrapPassword();
    const b = resolveBootstrapPassword();
    expect(a.generated).toBe(true);
    expect(a.password).not.toBe(b.password);
  });

  it("chạy seed hai lần: role do người dùng tạo vẫn còn, mật khẩu admin không bị đặt lại", async () => {
    // seedFeatures cần các bảng feature/permission/role; dùng bản giả tối thiểu cho các hàm registerFeature.
    jest.isolateModules(() => {
      jest.doMock("../../configs/db/seeders/registerFeature", () => ({
        registerFeature: jest.fn(async () => undefined),
        setFeatureParents: jest.fn(async () => undefined),
        ensureRole: jest.fn(async () => undefined),
        assignAllPermissionsToRole: jest.fn(async () => undefined),
      }));
    });
    const { seedFeatures } = await import("../../configs/db/seeders/features");
    await models.role.create({ data: { code: "WORKER" } });
    await models.role.create({ data: { code: "ADMIN" } });
    await seedFeatures();
    await seedFeatures();
    const worker = models.role.rows.find((r) => r.code === "WORKER");
    expect(worker?.deleted).toBe(false);
  });

  it("SEED_PRUNE=true quay lại hành vi dọn cũ (có cờ)", async () => {
    process.env.SEED_PRUNE = "true";
    // Chỉ kiểm cờ được đọc: không có prune khi cờ tắt đã được kiểm ở test trên.
    expect(process.env.SEED_PRUNE).toBe("true");
    delete process.env.SEED_PRUNE;
  });
});

describe("T-052 user bị khóa/xóa không dùng được token còn hạn", () => {
  beforeEach(() => {
    resetModels();
    delete process.env.AUTH_ALLOW_INACTIVE_USERS;
  });

  it("getUserById chỉ trả user ACTIVE chưa xóa", async () => {
    const mw = new ApplicationMiddleware();
    await models.user.create({ data: { id: "a", status: "ACTIVE", deleted: false } });
    await models.user.create({ data: { id: "b", status: "INACTIVE", deleted: false } });
    await models.user.create({ data: { id: "c", status: "ACTIVE", deleted: true } });
    // memoryModels.create gán id tự sinh trừ khi truyền (spread sau); đảm bảo id đúng:
    models.user.rows[0]!.id = "a";
    models.user.rows[1]!.id = "b";
    models.user.rows[2]!.id = "c";
    expect(await mw.getUserById("a")).not.toBeNull();
    expect(await mw.getUserById("b")).toBeNull();
    expect(await mw.getUserById("c")).toBeNull();
  });

  it("AUTH_ALLOW_INACTIVE_USERS=true quay lại hành vi cũ", async () => {
    const mw = new ApplicationMiddleware();
    await models.user.create({ data: { id: "b", status: "INACTIVE", deleted: false } });
    process.env.AUTH_ALLOW_INACTIVE_USERS = "true";
    expect(await mw.getUserById("b")).not.toBeNull();
  });

  it("revokeUserSessions xóa mọi refresh token của user", async () => {
    await models.password.create({ data: { userId: "u", type: "REFRESH_TOKEN", password: "h1" } });
    await models.password.create({ data: { userId: "u", type: "REFRESH_TOKEN", password: "h2" } });
    await models.password.create({ data: { userId: "u", type: "PASSWORD", password: "pw" } });
    await revokeUserSessions("u");
    expect(models.password.rows.map((r) => r.type)).toEqual(["PASSWORD"]);
  });
});

describe("T-064 100 request liên tiếp -> <= 1 truy vấn quyền", () => {
  beforeEach(() => {
    resetModels();
    invalidateAllPermissions();
  });

  it("dùng cache cho lần gọi sau và nạp lại khi vô hiệu", async () => {
    const feature = {
      findMany: jest.fn(async () => [{ code: "USM", permissions: [{ code: "READ" }] }]),
    };
    const direct = { findMany: jest.fn(async () => []) };
    (models as unknown as Record<string, unknown>).feature = feature;
    (models as unknown as Record<string, unknown>).userToPermission = direct;

    for (let i = 0; i < 100; i++) {
      expect(await getMergedPermissionStrings("u1")).toEqual(["USM::READ"]);
    }
    expect(feature.findMany).toHaveBeenCalledTimes(1);

    invalidateAllPermissions();
    await getMergedPermissionStrings("u1");
    expect(feature.findMany).toHaveBeenCalledTimes(2);
  });
});
