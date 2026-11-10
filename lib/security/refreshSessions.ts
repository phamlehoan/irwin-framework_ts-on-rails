import models, { PasswordType } from "@models";
import { generateRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { hashToken, newJti } from "./tokenHash";

/**
 * Phiên refresh token (IRW-FIX-056).
 * - Lưu **băm** SHA-256 trong bảng `passwords` (type REFRESH_TOKEN) — không đổi schema.
 * - Nhiều thiết bị: mỗi lần đăng nhập thêm một dòng, giới hạn `REFRESH_MAX_SESSIONS` (mặc định 10);
 *   `REFRESH_SINGLE_DEVICE=true` quay lại hành vi cũ (một token/user).
 * - Xoay vòng + phát hiện dùng lại: token đã xoay mà bị đưa lại (chữ ký đúng, không còn dòng khớp)
 *   thì hủy toàn bộ phiên của user.
 * - Token cũ lưu thô (trước 1.2) vẫn được chấp nhận một lần rồi chuyển sang dạng băm.
 */
export const REFRESH_TTL = "7d";

function maxSessions(): number {
  const n = parseInt(process.env.REFRESH_MAX_SESSIONS || "10", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = generateRefreshToken({ id: userId, jti: newJti() }, REFRESH_TTL);
  if (process.env.REFRESH_SINGLE_DEVICE === "true") {
    await models.password.deleteMany({
      where: { userId, type: PasswordType.REFRESH_TOKEN },
    });
  }
  await models.password.create({
    data: {
      userId,
      password: hashToken(token),
      type: PasswordType.REFRESH_TOKEN,
    },
  });
  await pruneOldSessions(userId);
  return token;
}

async function pruneOldSessions(userId: string): Promise<void> {
  const rows = await models.password.findMany({
    where: { userId, type: PasswordType.REFRESH_TOKEN },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const extra = rows.slice(maxSessions());
  if (extra.length) {
    await models.password.deleteMany({
      where: { id: { in: extra.map((r) => r.id) } },
    });
  }
}

export class RefreshReuseError extends Error {
  constructor() {
    super("Refresh token is not valid or has been revoked.");
  }
}

/**
 * Tiêu thụ `token` (xóa dòng khớp) và trả `userId`. Ném lỗi nếu chữ ký sai/ hết hạn,
 * hoặc nếu token hợp lệ về chữ ký nhưng không còn trong DB (dùng lại): khi đó hủy mọi phiên.
 */
export async function consumeRefreshToken(token: string): Promise<string> {
  const decoded = verifyRefreshToken(token);
  const userId = decoded.id;
  if (!userId) throw new Error("Refresh token is not valid.");

  const hashed = hashToken(token);
  const row = await models.password.findFirst({
    where: {
      userId,
      type: PasswordType.REFRESH_TOKEN,
      deleted: false,
      OR: [{ password: hashed }, { password: token }],
    },
    select: { id: true },
  });
  if (!row) {
    await models.password.deleteMany({
      where: { userId, type: PasswordType.REFRESH_TOKEN },
    });
    throw new RefreshReuseError();
  }
  // deleteMany đếm dòng: nếu hai request đua nhau, chỉ một bên thắng.
  const res = await models.password.deleteMany({ where: { id: row.id } });
  if (res.count !== 1) throw new RefreshReuseError();
  return userId;
}
