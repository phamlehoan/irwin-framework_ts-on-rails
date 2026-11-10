import type { Request } from "express";

/**
 * Tiền tố các route API (IRW-FIX-007). Trước đây dùng `originalUrl.includes("/api")`, khiến
 * `/admin/apis` hay `/login?next=/api/x` bị coi là API. Giờ chỉ khớp đoạn đầu của path.
 * Đổi bằng `API_PREFIX` (mặc định `/api`).
 */
export function apiPrefix(): string {
  const raw = (process.env.API_PREFIX || "/api").trim();
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "") || "/api";
}

export function isApiRequest(req: Pick<Request, "originalUrl">): boolean {
  const url = req.originalUrl || "";
  // Bỏ query/hash trước khi so tiền tố.
  const pathOnly = url.split(/[?#]/, 1)[0] ?? "";
  const prefix = apiPrefix();
  return pathOnly === prefix || pathOnly.startsWith(`${prefix}/`);
}

/**
 * Mã trả về cho request chưa xác thực (IRW-FIX-060): 401 theo chuẩn; 403 chỉ dành cho "đã đăng nhập nhưng thiếu quyền".
 * Máy khách cũ phụ thuộc 403 có thể quay lại bằng `AUTH_LEGACY_403=true`.
 */
export function unauthenticatedStatus(): 401 | 403 {
  return process.env.AUTH_LEGACY_403 === "true" ? 403 : 401;
}
