/**
 * Chuẩn hóa email ở một nơi (IRW-FIX-057): cắt khoảng trắng + hạ chữ thường.
 * Mọi đường đăng nhập / đăng ký / mời / đặt lại phải đi qua hàm này để `A@x.com` và `a@x.com` là một tài khoản.
 */
export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * Cho phép tự đăng ký công khai (IRW-FIX-057). Mặc định bật để tương thích 1.1.x;
 * đặt `REGISTRATION_ENABLED=false` để chỉ admin mời. Sẽ đổi mặc định thành tắt ở 2.0.
 */
export function registrationEnabled(): boolean {
  return process.env.REGISTRATION_ENABLED !== "false";
}
