import models from "@models";
import {
  getCachedPermissions,
  setCachedPermissions,
} from "../security/permissionCache";

/**
 * ts-rails `resource` API gắn middleware với mã kiểu `FEATURE::Read` (Pascal một phần),
 * trong khi DB + merge permissions dùng `READ`/`CREATE`… toàn HOA.
 * Chuẩn hóa trước khi so khớp.
 */
export function canonPermissionString(code: string): string {
  if (!code || typeof code !== "string") return code;
  const i = code.indexOf("::");
  if (i === -1) return code;
  const feat = code.slice(0, i);
  const perm = code.slice(i + 2);
  return `${feat}::${perm.toUpperCase()}`;
}

/**
 * Chuỗi quyền dạng `FEATURE_CODE::PERMISSION_CODE` (merge từ Role + UserToPermission).
 */
export async function getMergedPermissionStrings(
  userId: string,
): Promise<string[]> {
  // IRW-FIX-064: cache TTL ngắn, vô hiệu khi đổi vai trò/quyền (xem permissionCache).
  const cached = getCachedPermissions(userId);
  if (cached) return cached;
  const fresh = await loadMergedPermissionStrings(userId);
  setCachedPermissions(userId, fresh);
  return fresh;
}

async function loadMergedPermissionStrings(userId: string): Promise<string[]> {
  const permissionFeaturesFromRoles = await models.feature.findMany({
    where: {
      deleted: false,
      permissions: {
        some: {
          deleted: false,
          roles: {
            some: {
              role: {
                deleted: false,
                users: {
                  some: {
                    userId,
                  },
                },
              },
            },
          },
        },
      },
    },
    select: {
      code: true,
      permissions: {
        where: { deleted: false },
        select: { code: true },
      },
    },
  });

  const direct = await models.userToPermission.findMany({
    where: { userId },
    include: {
      permission: {
        include: { feature: true },
      },
    },
  });

  const set = new Set<string>();
  for (const feat of permissionFeaturesFromRoles) {
    for (const p of feat.permissions) {
      set.add(`${feat.code}::${p.code}`);
    }
  }
  for (const row of direct) {
    const f = row.permission.feature;
    if (f && !f.deleted) {
      set.add(`${f.code}::${row.permission.code}`);
    }
  }
  return Array.from(set);
}
