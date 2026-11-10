import { UserStatus } from "@models";
import {
  consumeRefreshToken,
  generateAccessToken,
  issueRefreshToken,
} from "@lib";
import { UnauthorizedError } from "ts-rails";
import { ApplicationService } from "../application.service";

const INVALID = "Refresh token is not valid or has been revoked.";

export class AuthRefreshTokenService extends ApplicationService {
  async execute(refreshToken: string) {
    // IRW-FIX-056: token lưu dạng băm, xoay vòng một lần; dùng lại token đã xoay hủy toàn bộ phiên của user.
    // consumeRefreshToken cũng từ chối access / invite / reset token (IRW-FIX-048).
    let userId: string;
    try {
      userId = await consumeRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError(INVALID);
    }

    const user = await this.models.user.findFirst({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.deleted || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedError(INVALID);
    }
    const userRoles = user.roles.map(
      (r: { role: { code: string } }) => r.role.code,
    );

    const newAccessToken = generateAccessToken(
      { id: user.id, roles: userRoles },
      "1h",
    );
    const newRefreshToken = await issueRefreshToken(user.id);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: `${user.firstName} ${user.lastName}`,
        roles: userRoles,
      },
    };
  }
}
