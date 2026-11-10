import { UserMailer } from "@mailers/user.mailer";
import models from "@models";
import {
  invalidateUserPermissions,
  normalizeEmail,
  replaceUserPermissions,
  replaceUserRoles,
  revokeUserSessions,
  withTransaction,
} from "@lib/utils";
import {
  buildActivateAccountUrl,
  buildResetPasswordUrl,
  generateInviteToken,
  issuePasswordResetToken,
} from "@services";
import {
  CreateUserValidator,
  PaginationValidator,
  UpdateUserValidator,
} from "@validators/admin.validator";
import {
  NotFoundError,
  buildPaginatedResponse,
  logger,
  parsePagination,
} from "ts-rails";
import { ApiV1Controller } from "../apiV1.controller";

export class ApiV1AdminUserController extends ApiV1Controller {
  async index() {
    const permitted = await this.params(PaginationValidator).permit(
      "page",
      "perPage",
    );
    const { page, perPage, skip } = parsePagination(permitted as any);
    const [users, total] = await Promise.all([
      models.user.findMany({
        where: { deleted: false },
        include: {
          roles: { include: { role: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: perPage,
      }),
      models.user.count({ where: { deleted: false } }),
    ]);
    const result = buildPaginatedResponse(users, total, { page, perPage });
    this.renderJson(result);
  }

  async show() {
    const user = await models.user.findFirst({
      where: { id: this.req.params.id, deleted: false },
      include: {
        roles: { include: { role: true } },
        permissions: {
          include: {
            permission: { include: { feature: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundError("User not found");
    this.renderJson(user);
  }

  async create() {
    const data = await this.params(CreateUserValidator).permit(
      "firstName",
      "lastName",
      "email",
      "roleIds",
    );
    const { firstName, lastName, email, roleIds } = data;
    const roleIdsArr = Array.isArray(roleIds)
      ? roleIds
      : roleIds
        ? [roleIds]
        : [];

    const user = await models.user.create({
      data: {
        firstName: firstName || "",
        lastName: lastName || "",
        email: normalizeEmail(email),
        status: "PENDING",
        roles: {
          create: roleIdsArr.map((roleId: string) => ({
            role: { connect: { id: roleId } },
          })),
        },
      },
      include: { roles: { include: { role: true } } },
    });

    try {
      const inviteToken = generateInviteToken(user.id);
      const activateLink = buildActivateAccountUrl(inviteToken);
      await UserMailer.accountInvite(
        user.email,
        user.firstName,
        user.lastName,
        activateLink,
      );
    } catch (err) {
      logger?.error?.(
        "[ApiV1AdminUserController.create] Failed to send invite email",
        err,
      );
    }

    this.renderJson(user, 201);
  }

  /** Gửi email đặt lại mật khẩu (link công khai giống luồng kích hoạt). */
  async sendPasswordReset() {
    const id = this.req.params.id;
    const user = await models.user.findFirst({
      where: { id, deleted: false },
    });
    if (!user) throw new NotFoundError("User not found");

    try {
      const token = await issuePasswordResetToken(user.id);
      const resetLink = buildResetPasswordUrl(token);
      await UserMailer.passwordReset(user.email, resetLink);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.error?.(
        `[ApiV1AdminUserController.sendPasswordReset] Failed to send email: ${msg}`,
        err,
      );
      return this.res.status(502).json({
        success: false,
        error: "Failed to send password reset email.",
      });
    }

    this.renderJson({ ok: true });
  }

  async update() {
    const id = this.req.params.id;
    const data = await this.params(UpdateUserValidator).permit(
      "firstName",
      "lastName",
      "email",
      "status",
      "roleIds",
      "permissionIds",
    );
    const { firstName, lastName, email, status, roleIds, permissionIds } = data;

    const roleIdsArr = Array.isArray(roleIds)
      ? roleIds
      : roleIds
        ? [roleIds]
        : [];
    const permissionIdsArr = Array.isArray(permissionIds)
      ? permissionIds
      : permissionIds
        ? [permissionIds]
        : [];

    // IRW-FIX-059: một transaction cho cả hồ sơ, vai trò và quyền trực tiếp.
    await withTransaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(email && { email: normalizeEmail(email) }),
          ...(status && { status }),
        },
      });
      await replaceUserRoles(tx, id, roleIdsArr);
      await replaceUserPermissions(tx, id, permissionIdsArr);
    });

    // IRW-FIX-052: khóa user thì thu hồi phiên; còn lại chỉ bỏ cache quyền.
    if (status && status !== "ACTIVE") await revokeUserSessions(id);
    else invalidateUserPermissions(id);

    const user = await models.user.findFirst({
      where: { id },
      include: {
        roles: { include: { role: true } },
        permissions: {
          include: {
            permission: { include: { feature: true } },
          },
        },
      },
    });
    this.renderJson(user);
  }

  async destroy() {
    const id = this.req.params.id;
    await models.user.update({
      where: { id },
      data: { deleted: true },
    });
    await revokeUserSessions(id);
    this.renderJson({ deleted: true });
  }
}
