import { FlashType } from "@configs/enum";
import { isApiRequest as isApiRequestPath, unauthenticatedStatus } from "@lib";
import { NextFunction, Request, Response } from "express";
import { ApplicationMiddleware } from "./application.middleware";

export class ValidateUserLoginMiddleware extends ApplicationMiddleware {
  constructor() {
    super();
  }

  public async execute(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
      const isApiRequest = isApiRequestPath(req);
      const t = (res.locals?.t as (k: string) => string) || ((k: string) => k);
      if (isApiRequest) {
        return res
          .status(unauthenticatedStatus())
          .json({ success: false, error: t("flash.login_first") });
      } else {
        req.flash(FlashType.Errors, { msg: t("flash.login_first") });
        return res.redirect("/auth");
      }
    }

    next();
  }
}
