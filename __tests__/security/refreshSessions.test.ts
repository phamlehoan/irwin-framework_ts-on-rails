jest.mock("@models", () => require("../helpers/memoryModels").modelsModule);

import { models, resetModels } from "../helpers/memoryModels";
import {
  consumeRefreshToken,
  issueRefreshToken,
  RefreshReuseError,
} from "@lib/security/refreshSessions";
import { hashToken, passwordFingerprint } from "@lib/security/tokenHash";
import { generateAccessToken, generateRefreshToken } from "@lib/utils/jwt";

describe("T-056 refresh token lưu băm, nhiều thiết bị, phát hiện dùng lại", () => {
  beforeEach(() => {
    resetModels();
    delete process.env.REFRESH_SINGLE_DEVICE;
    delete process.env.REFRESH_MAX_SESSIONS;
  });

  it("không lưu token thô trong DB", async () => {
    const token = await issueRefreshToken("u1");
    const stored = models.password.rows.map((r) => r.password);
    expect(stored).not.toContain(token);
    expect(stored).toContain(hashToken(token));
  });

  it("hai lần đăng nhập giữ hai phiên (nhiều thiết bị)", async () => {
    await issueRefreshToken("u1");
    await issueRefreshToken("u1");
    expect(models.password.rows).toHaveLength(2);
  });

  it("REFRESH_SINGLE_DEVICE=true quay lại một token/user", async () => {
    process.env.REFRESH_SINGLE_DEVICE = "true";
    await issueRefreshToken("u1");
    await issueRefreshToken("u1");
    expect(models.password.rows).toHaveLength(1);
  });

  it("giới hạn số phiên theo REFRESH_MAX_SESSIONS", async () => {
    process.env.REFRESH_MAX_SESSIONS = "2";
    for (let i = 0; i < 4; i++) await issueRefreshToken("u1");
    expect(models.password.rows).toHaveLength(2);
  });

  it("xoay vòng: dùng được một lần, lần hai (reuse) hủy cả chuỗi phiên", async () => {
    const t1 = await issueRefreshToken("u1");
    await issueRefreshToken("u1"); // thiết bị khác
    await expect(consumeRefreshToken(t1)).resolves.toBe("u1");
    await expect(consumeRefreshToken(t1)).rejects.toBeInstanceOf(RefreshReuseError);
    expect(models.password.rows).toHaveLength(0);
  });

  it("chấp nhận token thô cũ (trước 1.2) đúng một lần", async () => {
    const legacy = generateRefreshToken({ id: "u2" }, "7d");
    await models.password.create({ data: { userId: "u2", password: legacy, type: "REFRESH_TOKEN" } });
    await expect(consumeRefreshToken(legacy)).resolves.toBe("u2");
    await expect(consumeRefreshToken(legacy)).rejects.toBeInstanceOf(RefreshReuseError);
  });

  it("access token không dùng được làm refresh", async () => {
    const access = generateAccessToken({ id: "u1" }, "1h");
    await expect(consumeRefreshToken(access)).rejects.toThrow();
  });

  it("dấu vân tay mật khẩu đổi khi mật khẩu đổi (link đặt lại một lần)", () => {
    expect(passwordFingerprint("a")).toBe(passwordFingerprint("a"));
    expect(passwordFingerprint("a")).not.toBe(passwordFingerprint("b"));
    expect(passwordFingerprint(null)).toBe(passwordFingerprint(undefined));
  });
});
