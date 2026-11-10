import { PasswordType, UserStatus } from "@models";
import { generateAccessToken, issueRefreshToken, normalizeEmail } from "@lib";
import models from "@models";
import { Prisma } from "@db";
import { UnauthorizedError } from "ts-rails";
import { Security } from "ts-rails";
import { ApplicationService } from "../application.service";
/**
 * Đăng nhập email + mật khẩu — trả cùng shape với Google verify để app client dùng chung.
 */
export class AuthLoginService extends ApplicationService {
  async execute(
    email: string,
    password: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: Record<string, unknown>;
  }> {
    const normalized = normalizeEmail(email);
    const user = await this.models.user.findFirst({
      where: {
        email: normalized,
        deleted: false,
      },
      include: {
        roles: { include: { role: true } },
        passwords: {
          where: { deleted: false, type: PasswordType.PASSWORD },
          orderBy: { createdAt: Prisma.SortOrder.desc },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }
    if (user.status === UserStatus.PENDING) {
      throw new UnauthorizedError("ACCOUNT_PENDING_ACTIVATION");
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedError("Invalid email or password");
    }
    if (
      user.passwords.length === 0 ||
      !(await Security.verifyPassword(password, user.passwords[0]!.password))
    ) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const userWithRoles = await this.models.user.findUnique({
      where: { id: user.id },
      include: { roles: { include: { role: true } } },
    });
    if (!userWithRoles) throw new UnauthorizedError("Invalid email or password");

    const userRoles = userWithRoles.roles.map(
      (r: { role: { code: string } }) => r.role.code,
    );

    const accessToken = generateAccessToken(
      { id: userWithRoles.id, roles: userRoles },
      "1h",
    );
    // IRW-FIX-056: refresh token lưu dạng băm, nhiều thiết bị.
    const refreshToken = await issueRefreshToken(userWithRoles.id);

    const u = userWithRoles;
    return {
      accessToken,
      refreshToken,
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        middleName: u.middleName,
        gender: u.gender,
        phoneNumber: u.phoneNumber,
        address: u.address,
        avatarUrl: u.avatarUrl,
        status: u.status,
        fullName: `${u.firstName} ${u.lastName}`,
        roles: userRoles,
      } as Record<string, unknown>,
    };
  }
}
