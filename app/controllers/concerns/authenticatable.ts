import { isApiRequest } from "@lib/utils/http";
import { FlashType } from "@configs/enum";
import type { ApplicationController } from "../application.controller";

/**
 * Authenticatable concern - tương tự Rails before_action :authenticate_user!
 */
export const Authenticatable = {
  /**
   * Xóa session và thông tin user hiện tại (thay thế clearSession thủ công)
   */
  logoutUser(this: ApplicationController) {
    if (this.req.user) {
      this.req.session!.userId = undefined;
      this.req.user = undefined;
    }
  },

  /**
   * Logic kiểm tra login dùng chung, có thể gọi từ BeforeAction
   */
  authenticateUser(this: ApplicationController): boolean {
    if (!this.currentUser) {
      if (isApiRequest(this.req)) {
        this.res
          .status(401)
          .json({ success: false, error: this.t("flash.login_first") });
        return false;
      }
      this.flash(FlashType.Errors, { msg: this.t("flash.login_first") });
      this.redirect("/auth");
      return false;
    }
    return true;
  },
};
