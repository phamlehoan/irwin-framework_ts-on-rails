/**
 * Features/permissions khớp `configs/routes` (USM, RAP). Chạy: pnpm db:seed
 */
import models from "@models";
import {
  assignAllPermissionsToRole,
  ensureRole,
  registerFeature,
  setFeatureParents,
} from "./registerFeature";

/** Feature codes dùng trong routes + enum. */
const ROUTE_FEATURE_CODES = ["AM", "USM", "RAP", "JM"] as const;

/** Permission codes theo từng feature (khớp ts-rails resource + route tùy chỉnh). */
const ROUTE_PERMISSIONS_BY_FEATURE: Record<string, readonly string[]> = {
  USM: ["READ", "CREATE", "UPDATE", "DELETE"],
  RAP: ["READ", "CREATE", "UPDATE", "DELETE"],
  JM: ["READ", "CREATE", "UPDATE", "DELETE"],
};

export const FEATURES = [
  {
    code: "AM",
    name: "Administration",
    description: "Menu group (no permissions)",
    type: "MENU_GROUP",
    parentCode: null as string | null,
    sortOrder: 0,
    permissionCodes: [] as const,
  },
  {
    code: "USM",
    name: "Users",
    description: "User account management",
    type: "FEATURE",
    parentCode: "AM",
    sortOrder: 1,
    permissionCodes: ROUTE_PERMISSIONS_BY_FEATURE.USM,
  },
  {
    code: "RAP",
    name: "Roles & permissions",
    description: "Role and permission management",
    type: "FEATURE",
    parentCode: "AM",
    sortOrder: 2,
    permissionCodes: ROUTE_PERMISSIONS_BY_FEATURE.RAP,
  },
  {
    code: "JM",
    name: "Background jobs",
    description: "View and manage background job queue",
    type: "FEATURE",
    parentCode: "AM",
    sortOrder: 3,
    permissionCodes: ROUTE_PERMISSIONS_BY_FEATURE.JM,
  },
];

async function prunePermissionsNotOnRoutes(): Promise<void> {
  const allowedPairs = new Set<string>();
  for (const [featureCode, codes] of Object.entries(ROUTE_PERMISSIONS_BY_FEATURE)) {
    for (const code of codes) {
      allowedPairs.add(`${featureCode}::${code}`);
    }
  }

  const active = await models.permission.findMany({
    where: { deleted: false },
    include: { feature: true },
  });

  const toDrop = active.filter((p) => {
    const f = p.feature;
    if (!f || f.deleted) return true;
    if (!ROUTE_FEATURE_CODES.includes(f.code as (typeof ROUTE_FEATURE_CODES)[number])) {
      return true;
    }
    const key = `${f.code}::${p.code}`;
    return !allowedPairs.has(key);
  });

  if (toDrop.length === 0) return;

  await models.permission.updateMany({
    where: { id: { in: toDrop.map((p) => p.id) } },
    data: { deleted: true },
  });
  console.log(`[seedFeatures] Soft-deleted ${toDrop.length} permission(s) not used on routes`);
}

async function pruneFeaturesNotOnRoutes(): Promise<void> {
  const r = await models.feature.updateMany({
    where: { code: { notIn: [...ROUTE_FEATURE_CODES] }, deleted: false },
    data: { deleted: true },
  });
  if (r.count > 0) {
    console.log(`[seedFeatures] Soft-deleted ${r.count} feature(s) not on routes`);
  }
}

/** Chỉ giữ role ADMIN (framework single-role). */
async function pruneRolesExceptAdmin(): Promise<void> {
  const r = await models.role.updateMany({
    where: { code: { not: "ADMIN" }, deleted: false },
    data: { deleted: true },
  });
  if (r.count > 0) {
    console.log(`[seedFeatures] Soft-deleted ${r.count} role(s) other than ADMIN`);
  }
}

/**
 * Seed cộng dồn và idempotent (IRW-FIX-051): chỉ thêm/cập nhật, KHÔNG xóa mềm role/feature/permission
 * mà người dùng đã tạo. Hành vi dọn cũ chỉ chạy khi `SEED_PRUNE=true` (không khuyến nghị).
 */
export async function seedFeatures() {
  for (const def of FEATURES) {
    await registerFeature(def);
  }
  await setFeatureParents(FEATURES);

  const prune = process.env.SEED_PRUNE === "true";
  if (prune) {
    await pruneFeaturesNotOnRoutes();
    await prunePermissionsNotOnRoutes();
  }

  await ensureRole("ADMIN", "Administrator", "Full administrative access");
  if (prune) await pruneRolesExceptAdmin();

  await assignAllPermissionsToRole("ADMIN");

  console.log("[seedFeatures] Done");
}
