import env from "@configs/env";
import {
  generateAccessToken,
  issueRefreshToken,
  normalizeEmail,
  registrationEnabled,
} from "@lib";
import models, { UserStatus } from "@models";
import { OAuth2Client } from "google-auth-library";
import { UnauthorizedError } from "ts-rails";
import { ApplicationService } from "../application.service";

export interface GoogleVerifyResult {
  accessToken: string;
  refreshToken: string;
  user: Awaited<ReturnType<typeof models.user.findUnique>> & {
    fullName: string;
    roles: string[];
  };
}

export class AuthGoogleVerifyService extends ApplicationService {
  private googleClient = new OAuth2Client(env.googleClientId);

  async execute(idToken: string): Promise<GoogleVerifyResult> {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: env.googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new UnauthorizedError("Invalid ID token");
    }

    // Check thêm trường email_verified nếu cần thiết để đảm bảo bảo mật
    if (!payload.email_verified) {
      throw new UnauthorizedError("Email not verified by Google");
    }

    const { given_name, family_name, picture, sub } = payload;
    const email = normalizeEmail(payload.email);
    if (!email) throw new UnauthorizedError("Invalid ID token");

    let user = await this.models.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } }, // Include roles để trả về thông tin đầy đủ
    });

    // IRW-FIX-054: tài khoản đã xóa mềm không được đăng nhập lại (và email unique chặn tạo mới).
    if (user && user.deleted) {
      throw new UnauthorizedError("Invalid ID token");
    }
    if (user && user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedError(
        "This account is not active yet. Please complete activation from your invitation email.",
      );
    }

    if (!user) {
      if (!registrationEnabled()) {
        throw new UnauthorizedError("Sign-up is disabled.");
      }
      // Vai trò mặc định cho người đăng ký bằng Google do cấu hình quyết định (không còn hằng cứng
      // trỏ tới một vai trò mà seed đã xóa). Bỏ trống = không gán vai trò.
      const defaultRole = (process.env.GOOGLE_SIGNUP_ROLE || "").trim();
      const roleConnect = defaultRole
        ? await this.models.role.findFirst({
            where: { code: defaultRole, deleted: false },
            select: { code: true },
          })
        : null;
      user = await this.models.user.create({
        data: {
          email,
          firstName: given_name || "",
          lastName: family_name || "",
          avatarUrl: picture || "",
          status: "ACTIVE",
          googleId: sub,
          ...(roleConnect
            ? { roles: { create: [{ role: { connect: { code: roleConnect.code } } }] } }
            : {}),
        },
        include: { roles: { include: { role: true } } },
      });
    } else {
      // Cập nhật thông tin mới nhất từ Google (Social Sync)
      user = await this.models.user.update({
        where: { id: user.id },
        data: {
          firstName: given_name || user.firstName,
          lastName: family_name || user.lastName,
          avatarUrl: picture || user.avatarUrl,
          googleId: user.googleId || sub, // Tránh overwrite nếu đã có
        },
        include: { roles: { include: { role: true } } },
      });
    }

    // 1. Tạo JWT Access Token & Refresh Token
    // Thường mình sẽ đưa thêm role/permissions vào AccessToken để Backend không phải query DB nhiều lần
    const userRoles = user.roles.map(
      (r: { role: { code: string } }) => r.role.code,
    );

    const accessToken = generateAccessToken(
      {
        id: user.id,
        roles: userRoles,
      },
      "1h",
    ); // Thời gian ngắn

    // 2. Refresh token lưu dạng băm, nhiều thiết bị (IRW-FIX-056).
    const refreshToken = await issueRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        ...user,
        fullName: `${user.firstName} ${user.lastName}`,
        roles: userRoles,
      },
    };
  }
}
