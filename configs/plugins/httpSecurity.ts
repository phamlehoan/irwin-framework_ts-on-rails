import { isApiRequest } from "@lib/utils/http";
import type { CorsOptions } from "cors";
import { NextFunction, Request, Response } from "express";

/**
 * Bảo mật HTTP mặc định an toàn (IRW-FIX-053). Mỗi hành vi có cờ môi trường để quay lại nếu cần.
 */

const isProduction = (env = process.env) =>
  !["development", "dev", "local", "test"].includes(
    (env.APP_ENV || env.NODE_ENV || "development").trim().toLowerCase(),
  );

/** Danh sách origin cho phép, phân tách bằng dấu phẩy: `CORS_ORIGIN=https://a.example,https://b.example`. */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * CORS: không còn `origin:true` + credentials khi thiếu `CORS_ORIGIN` ngoài môi trường dev
 * (khi đó trình duyệt khác origin không nhận header CORS). `CORS_ALLOW_ALL=true` quay lại hành vi cũ.
 */
export function buildCorsOptions(env = process.env): CorsOptions {
  const allowed = parseOrigins(env.CORS_ORIGIN);
  if (allowed.length > 0) {
    return {
      origin: (origin, cb) =>
        // Request không có Origin (curl, server-to-server) không cần CORS.
        cb(null, !origin || allowed.includes(origin.replace(/\/$/, ""))),
      credentials: true,
    };
  }
  if (env.CORS_ALLOW_ALL === "true" || !isProduction(env)) {
    return { origin: true, credentials: true };
  }
  return { origin: false };
}

/** Header bảo mật cơ bản (thay helmet để không thêm dependency). */
export function securityHeadersMiddleware(env = process.env) {
  const prod = isProduction(env);
  const csp = env.CSP_POLICY?.trim();
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.removeHeader("X-Powered-By");
    if (prod) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=15552000; includeSubDomains",
      );
    }
    // CSP mặc định tắt vì view pug dùng script nội tuyến; bật bằng CSP_POLICY.
    if (csp) res.setHeader("Content-Security-Policy", csp);
    next();
  };
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const CSRF_HEADER = "x-irwin-csrf";

/**
 * Chống CSRF cho request dựa trên cookie session (form HTML): với phương thức ghi, `Origin` (hoặc
 * `Referer`) phải cùng host với request, nằm trong `CORS_ORIGIN`, hoặc client JS gửi header
 * `X-Irwin-CSRF` (trình duyệt không cho form cross-site đặt header tùy chỉnh). API dùng Bearer không áp dụng.
 * Tắt: `CSRF_PROTECTION=off`.
 */
export function csrfGuardMiddleware(env = process.env) {
  const extra = parseOrigins(env.CORS_ORIGIN);
  return (req: Request, res: Response, next: NextFunction) => {
    if (env.CSRF_PROTECTION === "off") return next();
    if (!UNSAFE.has(req.method)) return next();
    // Request Bearer/API không dùng cookie nên không dính CSRF.
    if (isApiRequest(req)) return next();
    if (req.headers[CSRF_HEADER]) return next();
    // Không có cookie thì không có phiên để lợi dụng.
    if (!req.headers.cookie) return next();

    const source = (req.get("origin") || req.get("referer") || "").trim();
    let sourceOrigin = "";
    try {
      sourceOrigin = source ? new URL(source).origin : "";
    } catch {
      sourceOrigin = "";
    }
    const host = req.get("host") || "";
    const sameOrigin =
      sourceOrigin !== "" &&
      (new URL(sourceOrigin).host === host || extra.includes(sourceOrigin));
    if (sameOrigin) return next();

    res.status(403).json({
      success: false,
      error: "Cross-site request blocked (CSRF).",
    });
  };
}

/** `TRUST_PROXY`: số hop ("1"), "true", hoặc danh sách CIDR; bỏ trống = không tin proxy. */
export function parseTrustProxy(raw: string | undefined): boolean | number | string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}
