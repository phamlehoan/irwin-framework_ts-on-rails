import { loadDotenv } from "../loadDotenv";

loadDotenv();

/** Giá trị từ `process.env.NODE_ENV` (Vite chỉ chấp nhận `development` trong file `.env`). */
const nodeEnv = process.env.NODE_ENV || "development";
/**
 * Môi trường chạy app (SQLite local vs Turso…).
 * Ưu tiên `APP_ENV`; không set thì dùng `NODE_ENV`.
 */
const appEnv = (process.env.APP_ENV || "").trim() || nodeEnv;

/** Bỏ BOM / ngoặc `.env` kiểu `DATABASE_URL='file:...'`. */
function stripEnvValue(s: string | undefined): string {
  return (s ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^['"]|['"]$/g, "");
}

/**
 * Đang chạy trong bundle deploy (Netlify Functions thường `cwd === /var/task`),
 * hoặc runtime Netlify có SITE_ID + URL. Không dùng SQLite file — chỉ Turso.
 */
export function isServerlessDeployedBundle(): boolean {
  if (process.cwd() === "/var/task") return true;
  return Boolean(process.env.SITE_ID?.trim() && process.env.URL?.trim());
}

const tursoDatabaseUrl = stripEnvValue(process.env.TURSO_DATABASE_URL);
const explicitDatabaseUrl = stripEnvValue(process.env.DATABASE_URL);
/** Server đầy đủ / CI: `DATABASE_URL`. Deploy bundle: không gán đường file DB. */
const databaseUrl = isServerlessDeployedBundle()
  ? ""
  : tursoDatabaseUrl && /^file:/i.test(explicitDatabaseUrl)
    ? ""
    : explicitDatabaseUrl ||
      (tursoDatabaseUrl ? "" : "file:./database/app.db");

/** Placeholder secrets shipped as defaults. They are public, so they must never sign anything outside local dev/test. */
const INSECURE_SECRETS = new Set([
  "",
  "your-session-secret",
  "your-jwt-secret",
  "fallback_secret",
  "changeme",
  "secret",
]);
const DEV_LIKE_ENVS = new Set(["development", "dev", "local", "test"]);
const MIN_SECRET_LENGTH = 16;

/**
 * Fails fast when a signing secret is unset, a known placeholder, or too short in any
 * environment other than development/test (where the placeholder default stays usable).
 */
export function assertStrongSecret(name: string, value: string): void {
  if (DEV_LIKE_ENVS.has(appEnv.toLowerCase())) return;
  if (INSECURE_SECRETS.has(value.trim()) || value.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} is missing, a placeholder, or shorter than ${MIN_SECRET_LENGTH} characters. ` +
        `Set a strong random value (e.g. \`openssl rand -hex 32\`) when running with APP_ENV/NODE_ENV="${appEnv}".`,
    );
  }
}

export default {
  search: process.env.SEARCH,
  nodeEnv,
  appEnv,
  appUrl: process.env.APP_URL || "http://localhost:3000",
  /** Base URL client app (email kích hoạt / đặt mật khẩu). */
  clientAppUrl: process.env.CLIENT_APP_URL || "http://localhost:9000",
  /** Mặc định true: link dạng `origin/#/activate-account?token=` (Quasar hash). Đặt `false` nếu dùng history mode. */
  clientAppHashRouter: process.env.CLIENT_APP_HASH_ROUTER !== "false",
  port: process.env.PORT || "3000",
  databaseUrl,
  /** Turso (serverless): `libsql://...` + `TURSO_AUTH_TOKEN`. */
  tursoDatabaseUrl,
  /** Bắt buộc khi dùng Turso (`turso db tokens create ...`). */
  tursoAuthToken: stripEnvValue(process.env.TURSO_AUTH_TOKEN),
  dbMaxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || "1"),
  sessionSecret: process.env.SESSION_SECRET || "your-session-secret",
  jwtSecret: process.env.JWT_SECRET || "your-jwt-secret",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/auth/google/callback",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_KEY || "",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || "",
  emailFrom: process.env.EMAIL_FROM || "",
  mailService: process.env.MAIL_SERVICE || "gmail", // gmail, smtp, sendgrid...
  mailHost: process.env.MAIL_HOST || "smtp.gmail.com",
  mailPort: parseInt(process.env.MAIL_PORT || "587"),
  mailUser: process.env.MAIL_USER || "",
  mailPass: process.env.MAIL_PASS || "",
  /**
   * `true` → BullMQ + Redis worker. `false` (default) → database queue in-process worker.
   * Set `JOBS_USE_REDIS=true` when Redis is available and you want Sidekiq-style scaling.
   */
  jobsUseRedis: process.env.JOBS_USE_REDIS === "true",
  redisHost: process.env.REDIS_HOST || "127.0.0.1",
  redisPort: parseInt(process.env.REDIS_PORT || "6379"),
  storageService: process.env.STORAGE_SERVICE || "local",

  /** Google AI Studio / Generative Language API — chỉ dùng trên server. */
  googleAiApiKey: process.env.GOOGLE_AI_API_KEY || "",
  /**
   * Danh sách model thử theo thứ tự (khi hết quota / lỗi tạm thời thì tự hạ xuống model sau).
   * Tên phải khớp AI Studio (ví dụ gemma-3-12b-it). Override bằng GOOGLE_AI_MODEL_FALLBACK=gemma-3-4b-it,gemini-2.0-flash
   */
  googleAiModelFallback: (process.env.GOOGLE_AI_MODEL_FALLBACK || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Firebase Cloud Messaging (server key dạng service account). */
  fcmProjectId: process.env.FCM_PROJECT_ID || "",
  fcmClientEmail: process.env.FCM_CLIENT_EMAIL || "",
  fcmPrivateKey: (process.env.FCM_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
};
