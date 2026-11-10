/**
 * Chính sách mật khẩu duy nhất (IRW-FIX-057). Trước đây chỗ 6 ký tự, chỗ 8.
 * Mặc định 8; đổi bằng `PASSWORD_MIN_LENGTH`. Không áp quy tắc thành phần ký tự (NIST 800-63B) nhưng
 * chặn mật khẩu quá phổ biến.
 */
const COMMON = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "qwertyui",
  "11111111",
  "abcd1234",
  "iloveyou",
]);

export function passwordMinLength(): number {
  const n = parseInt(process.env.PASSWORD_MIN_LENGTH || "8", 10);
  return Number.isFinite(n) && n >= 8 ? n : 8;
}

/** Trả `null` nếu hợp lệ, ngược lại thông điệp lỗi. */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required";
  const min = passwordMinLength();
  if (password.length < min) return `Password must be at least ${min} characters`;
  if (password.length > 128) return "Password must be at most 128 characters";
  if (COMMON.has(password.toLowerCase())) return "Password is too common";
  return null;
}
