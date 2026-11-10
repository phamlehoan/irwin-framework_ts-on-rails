import type { Prisma } from "@db";
import models from "@models";

/**
 * Chạy `fn` trong một transaction tương tác (IRW-FIX-059): lỗi giữa chừng thì rollback toàn bộ,
 * không còn tình trạng đã xóa hết quyền cũ nhưng chưa kịp tạo quyền mới.
 */
export function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return models.$transaction((tx: Prisma.TransactionClient) => fn(tx));
}

/** Thay toàn bộ liên kết user->role theo `roleIds` trong `tx`. */
export async function replaceUserRoles(
  tx: Prisma.TransactionClient,
  userId: string,
  roleIds: string[],
): Promise<void> {
  await tx.userToRole.deleteMany({ where: { userId } });
  if (roleIds.length) {
    await tx.userToRole.createMany({
      data: [...new Set(roleIds)].map((roleId) => ({ userId, roleId })),
    });
  }
}

export async function replaceUserPermissions(
  tx: Prisma.TransactionClient,
  userId: string,
  permissionIds: string[],
): Promise<void> {
  await tx.userToPermission.deleteMany({ where: { userId } });
  if (permissionIds.length) {
    await tx.userToPermission.createMany({
      data: [...new Set(permissionIds)].map((permissionId) => ({
        userId,
        permissionId,
      })),
    });
  }
}

export async function replaceRolePermissions(
  tx: Prisma.TransactionClient,
  roleId: string,
  permissionIds: string[],
): Promise<void> {
  await tx.roleToPermission.deleteMany({ where: { roleId } });
  if (permissionIds.length) {
    await tx.roleToPermission.createMany({
      data: [...new Set(permissionIds)].map((permissionId) => ({
        roleId,
        permissionId,
      })),
    });
  }
}
