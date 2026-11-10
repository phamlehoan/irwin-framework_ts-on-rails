import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { safeEqual } from "./tokenHash";

/**
 * Đăng nhập session an toàn (IRW-FIX-055): sinh lại ID session để chống session fixation,
 * rồi gắn userId và lưu. Flash phải được đặt SAU hàm này vì regenerate tạo session mới.
 */
export function establishSession(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const session = req.session;
    if (!session) return reject(new Error("Session middleware is not available"));
    session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

const STATE_KEY = "oauthState";

/** Tạo `state` OAuth ngẫu nhiên và lưu vào session (IRW-FIX-054). */
export function newOAuthState(req: Request): string {
  const state = randomBytes(24).toString("hex");
  (req.session as unknown as Record<string, unknown>)[STATE_KEY] = state;
  return state;
}

/** Kiểm `state` ở callback; dùng một lần (xóa sau khi kiểm). Thiếu/khác -> false. */
export function consumeOAuthState(req: Request, received: unknown): boolean {
  const bag = req.session as unknown as Record<string, unknown> | undefined;
  const expected = bag?.[STATE_KEY];
  if (bag) delete bag[STATE_KEY];
  return (
    typeof expected === "string" &&
    typeof received === "string" &&
    received.length > 0 &&
    safeEqual(expected, received)
  );
}
