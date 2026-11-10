/**
 * Tạo admin đầu tiên (nếu chưa có) với role ADMIN. IRW-FIX-051:
 * - Không còn mật khẩu cố định trong mã. Mật khẩu lấy từ `ADMIN_BOOTSTRAP_PASSWORD`;
 *   thiếu thì sinh ngẫu nhiên và in ra MỘT lần.
 * - Chỉ đặt mật khẩu khi tài khoản chưa có mật khẩu; chạy lại seed KHÔNG đặt lại mật khẩu của admin.
 * - Email lấy từ `ADMIN_BOOTSTRAP_EMAIL` (mặc định admin@example.com).
 */
import models, { PasswordType, UserStatus } from "@models";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { normalizeEmail } from "@lib/utils/email";
import { validatePassword } from "@lib/utils/passwordPolicy";

export function bootstrapAdminEmail(): string {
  return normalizeEmail(process.env.ADMIN_BOOTSTRAP_EMAIL || "admin@example.com");
}

export function resolveBootstrapPassword(): { password: string; generated: boolean } {
  const fromEnv = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (fromEnv) {
    const problem = validatePassword(fromEnv);
    if (problem) throw new Error(`ADMIN_BOOTSTRAP_PASSWORD rejected: ${problem}`);
    return { password: fromEnv, generated: false };
  }
  return { password: randomBytes(18).toString("base64url"), generated: true };
}

export async function seedAdminUser() {
  const ADMIN_EMAIL = bootstrapAdminEmail();
  const role = await models.role.findFirst({
    where: { code: "ADMIN", deleted: false },
  });
  if (!role) {
    console.warn("[seedAdminUser] Role ADMIN chưa tồn tại, bỏ qua.");
    return;
  }

  let user = await models.user.findFirst({
    where: { email: ADMIN_EMAIL, deleted: false },
  });

  if (!user) {
    user = await models.user.create({
      data: {
        firstName: "Admin",
        lastName: "User",
        email: ADMIN_EMAIL,
        status: UserStatus.ACTIVE,
      },
    });
    console.log(`[seedAdminUser] Created user: ${ADMIN_EMAIL}`);
  }
  // Không tự bật lại tài khoản admin đã bị khóa: khóa là quyết định có chủ đích.

  const hasRole = await models.userToRole.findUnique({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
  });
  if (!hasRole) {
    await models.userToRole.create({
      data: { userId: user.id, roleId: role.id },
    });
    console.log(`[seedAdminUser] Assigned ADMIN role to ${ADMIN_EMAIL}`);
  }

  const existingPw = await models.password.findFirst({
    where: {
      userId: user.id,
      deleted: false,
      type: PasswordType.PASSWORD,
    },
  });
  if (!existingPw) {
    const { password, generated } = resolveBootstrapPassword();
    await models.password.create({
      data: {
        userId: user.id,
        password: await bcrypt.hash(password, 10),
        type: PasswordType.PASSWORD,
      },
    });
    console.log(`[seedAdminUser] Set initial password for ${ADMIN_EMAIL}`);
    if (generated) {
      console.log(
        `[seedAdminUser] Generated one-time password (shown once, change it after login): ${password}`,
      );
    }
  }

  console.log("[seedAdminUser] Done");
}
