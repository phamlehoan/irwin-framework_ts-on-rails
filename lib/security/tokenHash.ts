import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Refresh token chỉ lưu dạng băm SHA-256 (IRW-FIX-056). Token là JWT ngẫu nhiên có entropy cao nên
 * không cần hàm băm chậm; băm để lộ DB không đồng nghĩa lộ phiên.
 */
export const HASHED_PREFIX = "sha256:";

export function hashToken(token: string): string {
  return HASHED_PREFIX + createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** `jti` ngẫu nhiên để hai token cấp trong cùng một giây vẫn khác nhau. */
export function newJti(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Dấu vân tay trạng thái mật khẩu: nhúng vào link đặt lại để link chỉ dùng được một lần
 * (sau khi đổi mật khẩu dấu vân tay đổi và link cũ vô hiệu).
 */
export function passwordFingerprint(currentPasswordHash: string | null | undefined): string {
  return createHash("sha256")
    .update(currentPasswordHash ?? "none")
    .digest("hex")
    .slice(0, 24);
}
