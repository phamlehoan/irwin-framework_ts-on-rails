import env from "@configs/env";
import { NextFunction, Request, Response } from "express";

/**
 * Rate limit (IRW-FIX-058).
 * - Store có giao diện thay thế được: bộ nhớ (mặc định, có dọn định kỳ) hoặc Redis dùng chung giữa
 *   các instance (`RATE_LIMIT_REDIS_URL`, ioredis lười nạp).
 * - Hai nhóm: chung theo IP (300 req / 5 phút) và nhóm "xác thực" chặt hơn theo IP + tài khoản
 *   (10 lần / 15 phút) cho login, đăng ký, refresh, đặt lại mật khẩu.
 * - Dev không throttle (như trước). IP thật phía sau proxy cần `TRUST_PROXY` (đặt ở Application).
 */
export interface RateLimitHit {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, RateLimitHit>();
  private readonly timer: NodeJS.Timeout;

  constructor(sweepEveryMs = 60_000) {
    // Dọn các khóa đã hết hạn: trước đây store phình vô hạn theo số IP.
    this.timer = setInterval(() => this.sweep(), sweepEveryMs);
    this.timer.unref?.();
  }

  sweep(now = Date.now()): void {
    for (const [k, v] of this.entries) if (v.resetAt <= now) this.entries.delete(k);
  }

  get size(): number {
    return this.entries.size;
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    const cur = this.entries.get(key);
    if (!cur || cur.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.entries.set(key, fresh);
      return fresh;
    }
    cur.count++;
    return cur;
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

/** Tập con client Redis (ioredis) mà store cần. */
export interface RedisLike {
  incr(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
}

/** Store Redis dùng chung giữa các instance; khóa tự hết hạn bằng PEXPIRE ở lần chạm đầu. */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = "rl:",
  ) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const k = this.prefix + key;
    const count = await this.client.incr(k);
    if (count === 1) await this.client.pexpire(k, windowMs);
    let ttl = await this.client.pttl(k);
    if (ttl < 0) {
      // Khóa mất TTL (vd crash giữa INCR và PEXPIRE): đặt lại để không bị chặn vĩnh viễn.
      await this.client.pexpire(k, windowMs);
      ttl = windowMs;
    }
    return { count, resetAt: Date.now() + ttl };
  }
}

let sharedStore: RateLimitStore | undefined;

export function setRateLimitStore(store: RateLimitStore | undefined): void {
  sharedStore = store;
}

function getStore(): RateLimitStore {
  if (!sharedStore) {
    const url = process.env.RATE_LIMIT_REDIS_URL?.trim();
    if (url) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const IORedis = require("ioredis") as new (u: string) => RedisLike;
      sharedStore = new RedisRateLimitStore(new IORedis(url));
    } else {
      sharedStore = new MemoryRateLimitStore();
    }
  }
  return sharedStore;
}

/** Đường dẫn nhạy cảm về xác thực (không phân biệt tiền tố /api/v1). */
const AUTH_PATH =
  /^(?:\/api\/v\d+)?\/auth\/(?:login|google|refresh|register|password-reset|invite)(?:\/|$)|^\/auth\/login$|^\/users$/;

export function isAuthSensitive(req: Pick<Request, "method" | "path">): boolean {
  return req.method === "POST" && AUTH_PATH.test(req.path);
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function accountKey(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  return email ? `:${email}` : "";
}

function deny(res: Response, resetAt: number, now: number) {
  res.setHeader("Retry-After", Math.max(1, Math.ceil((resetAt - now) / 1000)));
  return res.status(429).json({
    success: false,
    error: "Too many requests, please try again later.",
  });
}

export function rateLimitMiddleware(options?: {
  windowMs?: number;
  max?: number;
  store?: RateLimitStore;
}) {
  const isDev = env.appEnv === "development";
  const windowMs = options?.windowMs ?? 5 * 60 * 1000;
  const max = options?.max ?? 300;
  const authWindowMs = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || "", 10) || 15 * 60 * 1000;
  const authMax = parseInt(process.env.RATE_LIMIT_AUTH_MAX || "", 10) || 10;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (isDev) return next();
    try {
      const store = options?.store ?? getStore();
      const now = Date.now();
      const ip = clientIp(req);

      if (isAuthSensitive(req)) {
        const a = await store.hit(`auth:${ip}${accountKey(req)}`, authWindowMs);
        if (a.count > authMax) return deny(res, a.resetAt, now);
      }

      const g = await store.hit(`ip:${ip}`, windowMs);
      if (g.count > max) return deny(res, g.resetAt, now);
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - g.count)));
      next();
    } catch (err) {
      // Store hỏng (vd Redis down): không chặn toàn bộ lưu lượng; ghi lỗi để vận hành thấy.
      console.error("[rateLimit] store error, request allowed:", err);
      next();
    }
  };
}
