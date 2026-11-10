import { User } from "@db";
import { getMergedPermissionStrings } from "@lib/utils/userPermissions";
import models from "@models";

export class ApplicationMiddleware {
  /**
   * Định nghĩa Type cho User kèm Permissions
   */
  public userWithPermissions:
    | (User & { features?: string[]; permissions?: string[] })
    | null = null;

  /**
   * Lấy user kèm permissions — merge giống `getMergedPermissionStrings` (Role + UserToPermission).
   */
  public async getUserById(
    id: string,
    isGetPermission = false,
  ): Promise<(User & { features?: string[]; permissions?: string[] }) | null> {
    // IRW-FIX-052: user bị xóa mềm hoặc không ACTIVE không được dựng thành `req.user`,
    // nên token còn hạn của họ vô dụng. Cờ quay lại hành vi cũ: AUTH_ALLOW_INACTIVE_USERS=true.
    const allowInactive = process.env.AUTH_ALLOW_INACTIVE_USERS === "true";
    const user = await models.user.findFirst({
      where: allowInactive ? { id } : { id, deleted: false, status: "ACTIVE" },
    });

    if (user && isGetPermission) {
      const permissionStrings = await getMergedPermissionStrings(user.id);
      const features = new Set<string>();
      for (const s of permissionStrings) {
        const [fc] = s.split("::", 2);
        if (fc) features.add(fc);
      }
      return {
        ...user,
        features: Array.from(features),
        permissions: permissionStrings,
      };
    }

    return user;
  }
}
