import { FlashType } from "@configs/enum";
import models from "@models";
import {
  invalidateUserPermissions,
  replaceUserRoles,
  withTransaction,
} from "@lib/utils";
import { UpdateProfileValidator } from "@validators/profile.validator";
import { AdminController } from "./admin.controller";

const toArray = (v: unknown): string[] =>
  Array.isArray(v) ? v : v ? [String(v)] : [];

export class AdminProfileController extends AdminController {
  async show() {
    const userId = this.req.user?.id;
    if (!userId) return this.redirect("/auth");

    const currentUser = await models.user.findFirst({
      where: { id: userId, deleted: false },
      include: { roles: { include: { role: true } } },
    });
    if (!currentUser) return this.redirect("/auth");

    const roles = await models.role.findMany({ where: { deleted: false } });

    this.render("admin/profile.view/show", {
      user: this.req.user,
      currentUser,
      roles,
    });
  }

  async update() {
    const userId = this.req.user?.id;
    if (!userId) return this.redirect("/auth");

    const profileData = await this.params(UpdateProfileValidator).permit(
      "firstName",
      "lastName",
      "phoneNumber",
      "address",
      "gender",
    );

    await models.user.update({
      where: { id: userId },
      data: {
        ...(profileData.firstName !== undefined && {
          firstName: profileData.firstName,
        }),
        ...(profileData.lastName !== undefined && {
          lastName: profileData.lastName,
        }),
        ...(profileData.phoneNumber !== undefined && {
          phoneNumber: profileData.phoneNumber,
        }),
        ...(profileData.address !== undefined && {
          address: profileData.address,
        }),
        ...(profileData.gender !== undefined && {
          gender: profileData.gender,
        }),
      },
    });

    // Bảo mật: người dùng không được tự gán vai trò cho mình qua trang hồ sơ (leo thang đặc quyền).
    // Hành vi cũ chỉ bật lại khi đặt PROFILE_SELF_ROLE_EDIT=true (không khuyến nghị).
    if (process.env.PROFILE_SELF_ROLE_EDIT === "true") {
      const roleIds = toArray(this.req.body?.roleIds);
      await withTransaction((tx) => replaceUserRoles(tx, userId, roleIds));
      invalidateUserPermissions(userId);
    }

    this.flash(FlashType.Success, { msg: this.t("flash.profile_updated") });
    this.redirect("/admin/me");
  }
}
