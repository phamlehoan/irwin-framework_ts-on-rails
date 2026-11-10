import env, { assertStrongSecret } from "@configs/env";
import { RequestHandler } from "express";
import session from "express-session";
import { RailsApplication } from "ts-rails";

let sessionStore: session.Store | undefined;

/** Đăng ký store phiên bền vững (gọi trước `initializeSession`). */
export function setSessionStore(store: session.Store | undefined): void {
  sessionStore = store;
}

export function sessionSameSite(raw = process.env.SESSION_SAMESITE): "lax" | "strict" | "none" {
  const v = (raw || "lax").trim().toLowerCase();
  return v === "strict" || v === "none" ? v : "lax";
}

/**
 * Khởi tạo Session Middleware
 */
export function initializeSession(): RequestHandler {
  assertStrongSecret("SESSION_SECRET", env.sessionSecret);
  if (!sessionStore && env.nodeEnv === "production") {
    console.warn(
      "[session] MemoryStore is not suitable for production (leaks memory, single instance). " +
        "Call setSessionStore() with a persistent store (e.g. connect-redis).",
    );
  }
  const sessionMiddleware = session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    // IRW-FIX-055: store có thể thay (Redis...) qua setSessionStore; mặc định MemoryStore chỉ nên dùng ở dev.
    ...(sessionStore ? { store: sessionStore } : {}),
    cookie: {
      secure: env.nodeEnv === "production",
      httpOnly: true,
      // IRW-FIX-053: SameSite=Lax chặn gửi cookie trong POST cross-site. SESSION_SAMESITE=none|strict|lax.
      sameSite: sessionSameSite(),
      maxAge: 1000 * 60 * 60 * 3, // 3 hours
    },
  });

  // Lưu lại để Socket.IO có thể dùng chung
  RailsApplication.sessionMiddleware = sessionMiddleware;
  return sessionMiddleware;
}
