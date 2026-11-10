import models from "@models";
import {
  invalidateAllPermissions,
  invalidateUserPermissions,
  replaceRolePermissions,
  withTransaction,
} from "@lib/utils";
import {
  RoleCreateValidator,
  RoleUpdateValidator,
} from "@validators/admin.validator";
import { NotFoundError } from "ts-rails";
import { ApiV1Controller } from "../apiV1.controller";

export class ApiV1AdminRoleController extends ApiV1Controller {
  async index() {
    const roles = await models.role.findMany({
      where: { deleted: false },
      include: {
        permissions: {
          include: {
            permission: { include: { feature: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    this.renderJson(roles);
  }

  async show() {
    const role = await models.role.findFirst({
      where: { id: this.req.params.id, deleted: false },
      include: {
        permissions: {
          include: {
            permission: { include: { feature: true } },
          },
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!role) throw new NotFoundError("Role not found");
    this.renderJson(role);
  }

  async create() {
    const data = await this.params(RoleCreateValidator).permit(
      "code",
      "name",
      "description",
    );
    const code = data.code.trim();
    const existing = await models.role.findFirst({
      where: { code, deleted: false },
    });
    if (existing) {
      return this.res.status(409).json({
        success: false,
        error: "Role code already exists",
      });
    }
    const role = await models.role.create({
      data: {
        code,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        isReadOnly: false,
      },
    });
    this.renderJson(role, 201);
  }

  async update() {
    const id = this.req.params.id;
    const data = await this.params(RoleUpdateValidator).permit(
      "code",
      "name",
      "description",
      "permissionIds",
    );
    const role = await models.role.findFirst({
      where: { id, deleted: false },
    });
    if (!role) throw new NotFoundError("Role not found");

    const hasCoreFieldUpdate =
      data.code !== undefined ||
      data.name !== undefined ||
      data.description !== undefined;
    if (role.isReadOnly && hasCoreFieldUpdate) {
      return this.res.status(403).json({
        success: false,
        error: "Cannot edit read-only role",
      });
    }

    const permissionIdsArr = Array.isArray(data.permissionIds)
      ? data.permissionIds
      : data.permissionIds
        ? [data.permissionIds]
        : undefined;

    await models.role.update({
      where: { id },
      data: {
        ...(data.code !== undefined && { code: data.code.trim() }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && {
          description: data.description?.trim() || null,
        }),
      },
    });

    if (permissionIdsArr !== undefined) {
      await withTransaction((tx) =>
        replaceRolePermissions(tx, id, permissionIdsArr),
      );
    }
    invalidateAllPermissions();

    const updated = await models.role.findFirst({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: { include: { feature: true } },
          },
        },
      },
    });
    this.renderJson(updated);
  }

  async destroy() {
    const id = this.req.params.id;
    const role = await models.role.findFirst({
      where: { id, deleted: false },
    });
    if (!role) throw new NotFoundError("Role not found");
    if (role.isReadOnly) {
      return this.res.status(403).json({
        success: false,
        error: "Cannot delete read-only role",
      });
    }
    try {
      await models.$transaction([
        models.userToRole.deleteMany({ where: { roleId: id } }),
        models.roleToPermission.deleteMany({ where: { roleId: id } }),
        models.role.update({
          where: { id },
          data: { deleted: true },
        }),
      ]);
      invalidateAllPermissions();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to delete role (constraints)";
      return this.res.status(409).json({ success: false, error: msg });
    }
    this.renderJson({ deleted: true });
  }

  /** POST body: { userIds: string[] } */
  async assignUsers() {
    const roleId = this.req.params.id;
    const body = this.req.body as { userIds?: unknown };
    const userIds = [
      ...new Set(
        Array.isArray(body?.userIds)
          ? body.userIds.map(String)
          : body?.userIds
            ? [String(body.userIds)]
            : [],
      ),
    ];

    const role = await models.role.findFirst({
      where: { id: roleId, deleted: false },
    });
    if (!role) throw new NotFoundError("Role not found");

    /** Thay thế toàn bộ danh sách gán (khớp multiselect + lưu). */
    await withTransaction(async (tx) => {
      await tx.userToRole.deleteMany({ where: { roleId } });
      if (userIds.length) {
        await tx.userToRole.createMany({
          data: userIds.map((userId) => ({ userId, roleId })),
        });
      }
    });
    invalidateAllPermissions();
    const usersInRole = await models.userToRole.findMany({
      where: { roleId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        },
      },
    });
    this.renderJson({ ok: true, count: userIds.length, usersInRole });
  }

  async unassignUser() {
    const roleId = this.req.params.id;
    const userId = this.req.params.userId;
    await models.userToRole.deleteMany({
      where: { userId, roleId },
    });
    invalidateUserPermissions(userId);
    this.renderJson({ ok: true });
  }
}
