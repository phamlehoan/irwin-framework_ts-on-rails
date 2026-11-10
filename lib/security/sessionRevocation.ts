import models, { PasswordType } from "@models";
import { invalidateUserPermissions } from "./permissionCache";

/**
 * Thu hồi mọi refresh token của user và xóa cache quyền (IRW-FIX-052).
 * Gọi khi khóa, xóa mềm, đổi mật khẩu hoặc đổi vai trò của user.
 * Access token còn sống bị chặn ở middleware vì `getUserById` lọc `deleted`/`status`.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  invalidateUserPermissions(userId);
  await models.password.deleteMany({
    where: { userId, type: PasswordType.REFRESH_TOKEN },
  });
}
