import {
  TOKEN_TYPE_ACCESS,
  isApiRequest as isApiRequestPath,
  verifyTokenOfType,
} from "@lib";
import { NextFunction, Request, Response } from "express";
import { ApplicationMiddleware } from "./application.middleware";

/** USM/RAP khớp mã feature seed (AM là MENU_GROUP không có permission). */
const ADMIN_FEATURE_CODES = ["USM", "RAP"];

export class CurrentUserMiddleware extends ApplicationMiddleware {
  public async execute(req: Request, res: Response, next: NextFunction) {
    try {
      let userId: string | undefined;

      const isApiRequest = isApiRequestPath(req);
      if (isApiRequest) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          req.user = null;
          return next();
        }

        const token = authHeader.split(" ")[1];
        try {
          // Chỉ nhận access token: refresh / invite / password-reset token bị từ chối.
          const decoded = verifyTokenOfType(token, TOKEN_TYPE_ACCESS);
          userId = decoded?.id;
        } catch (jwtError) {
          // Token invalid hoặc expired
          userId = undefined;
        }
      } else {
        userId = req.session?.userId;
      }

      req.user = userId ? await super.getUserById(userId, true) : null;

      // Cho request web: set hasAdminAccess (quyền quản trị USM hoặc RAP)
      if (!isApiRequest) {
        const perms = req.user?.permissions ?? [];
        const locals = res.locals as Record<string, unknown>;
        locals.hasAdminAccess = perms.some((p: string) =>
          ADMIN_FEATURE_CODES.some((code) => p.startsWith(`${code}::`)),
        );
      }

      next();
    } catch (error) {
      req.user = null;
      next();
    }
  }
}
