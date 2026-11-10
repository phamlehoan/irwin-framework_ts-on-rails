import { FlashType } from "@configs/enum";
import { User } from "@db";
import {
  canonPermissionString,
  isApiRequest as isApiRequestPath,
  unauthenticatedStatus,
} from "@lib";
import { NextFunction, Request, Response } from "express";
import { ApplicationMiddleware } from "./application.middleware";

export class ValidateUserPermissionMiddleware extends ApplicationMiddleware {
  private permissionCode: string;

  constructor(permissionCode: string) {
    super();

    this.permissionCode = canonPermissionString(permissionCode);
  }

  public async execute(req: Request, res: Response, next: NextFunction) {
    const user = req.user as User & { permissions?: string[] };
    const isApiRequest = isApiRequestPath(req);
    if (!user) {
      const t = (res.locals?.t as (k: string) => string) || ((k: string) => k);
      if (isApiRequest) {
        return res
          .status(unauthenticatedStatus())
          .json({ success: false, error: t("flash.login_first") });
      } else {
        req.flash(FlashType.Errors, { msg: t("flash.no_permission") });
        return res.redirect("/");
      }
    }

    const allowed = user.permissions?.some(
      (p) => canonPermissionString(p) === this.permissionCode,
    );
    if (!allowed) {
      const t = (res.locals?.t as (k: string) => string) || ((k: string) => k);
      if (isApiRequest) {
        return res.status(403).json({
          success: false,
          error: t("flash.no_permission"),
        });
      } else {
        req.flash(FlashType.Errors, { msg: t("flash.no_permission") });
        return res.redirect(req.header("Referer") || "/");
      }
    }

    next();
  }
}

/**
 * Kiểm tra user có ít nhất một trong các permission.
 * Dùng cho admin khi chấp nhận nhiều feature (vd USM hoặc RAP).
 */
export class ValidateAnyPermissionMiddleware extends ApplicationMiddleware {
  private permissionCodes: string[];

  constructor(permissionCodes: string[]) {
    super();
    this.permissionCodes = permissionCodes.map((c) => canonPermissionString(c));
  }

  public async execute(req: Request, res: Response, next: NextFunction) {
    const user = req.user as User & { permissions?: string[] };
    const isApiRequest = isApiRequestPath(req);
    if (!user) {
      const t = (res.locals?.t as (k: string) => string) || ((k: string) => k);
      if (isApiRequest) {
        return res
          .status(unauthenticatedStatus())
          .json({ success: false, error: t("flash.login_first") });
      } else {
        req.flash(FlashType.Errors, { msg: t("flash.no_permission") });
        return res.redirect("/");
      }
    }

    const userCanon = (user.permissions ?? []).map((p) => canonPermissionString(p));
    const hasAny = this.permissionCodes.some((code) => userCanon.includes(code));

    if (!hasAny) {
      const t = (res.locals?.t as (k: string) => string) || ((k: string) => k);
      if (isApiRequest) {
        return res.status(403).json({
          success: false,
          error: t("flash.no_permission"),
        });
      } else {
        req.flash(FlashType.Errors, { msg: t("flash.no_permission") });
        return res.redirect(req.header("Referer") || "/");
      }
    }

    next();
  }
}
