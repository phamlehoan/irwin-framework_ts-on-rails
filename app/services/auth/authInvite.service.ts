import env from "@configs/env";
import { validatePassword } from "@lib/utils/passwordPolicy";
import { generateToken, newJti, verifyToken } from "@lib";
import { PasswordType, UserStatus } from "@models";
import {
  AppError,
  Security,
  UnauthorizedError,
  UnprocessableEntityError,
} from "ts-rails";
import { ApplicationService } from "../application.service";

export const INVITE_TOKEN_PURPOSE = "invite_activate";

export function buildActivateAccountUrl(token: string): string {
  const base = env.clientAppUrl.replace(/\/$/, "");
  const enc = encodeURIComponent(token);
  if (env.clientAppHashRouter) {
    return `${base}/#/activate-account?token=${enc}`;
  }
  return `${base}/activate-account?token=${enc}`;
}

/** Hạn link mời (IRW-FIX-056): mặc định 72h thay vì 7 ngày; đổi bằng `INVITE_TTL` (vd "7d"). */
export function inviteTtl(): string {
  return process.env.INVITE_TTL?.trim() || "72h";
}

export function generateInviteToken(userId: string): string {
  return generateToken(
    { id: userId, purpose: INVITE_TOKEN_PURPOSE, jti: newJti() },
    inviteTtl(),
  );
}

export class AuthInviteService extends ApplicationService {
  private verifyInviteJwt(token: string): string {
    let decoded: ReturnType<typeof verifyToken>;
    try {
      decoded = verifyToken(token);
    } catch {
      throw new UnauthorizedError("Invalid or expired invitation link.");
    }
    if (
      (decoded as { purpose?: string }).purpose !== INVITE_TOKEN_PURPOSE ||
      !decoded.id
    ) {
      throw new UnauthorizedError("Invalid or expired invitation link.");
    }
    return decoded.id;
  }

  async getInvitePreview(token: string) {
    const userId = this.verifyInviteJwt(token);
    const user = await this.models.user.findFirst({
      where: { id: userId, deleted: false, status: UserStatus.PENDING },
    });
    if (!user) {
      throw new UnauthorizedError(
        "This invitation is no longer valid or the account is already active.",
      );
    }
    return {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  async acceptInvite(
    token: string,
    password: string,
    passwordConfirmation: string,
  ): Promise<{ ok: true }> {
    if (password !== passwordConfirmation) {
      throw new UnprocessableEntityError("Passwords do not match.");
    }
    const pwProblem = validatePassword(password);
    if (pwProblem) throw new UnprocessableEntityError(pwProblem);
    const userId = this.verifyInviteJwt(token);
    const user = await this.models.user.findFirst({
      where: { id: userId, deleted: false },
    });
    if (!user) {
      throw new UnauthorizedError("This invitation is no longer valid.");
    }
    if (user.status !== UserStatus.PENDING) {
      if (user.status === UserStatus.ACTIVE) {
        // Link mời chỉ dùng một lần: dùng lại -> 410 Gone (IRW-FIX-056). INVITE_REUSE_STATUS=422 để giữ mã cũ.
        const reuseStatus = process.env.INVITE_REUSE_STATUS === "422" ? 422 : 410;
        throw new AppError("Account is already active. Please sign in.", reuseStatus);
      }
      throw new UnprocessableEntityError(
        "This account cannot be activated with this link.",
      );
    }

    const hashed = await Security.hashPassword(password);

    await this.models.$transaction([
      this.models.password.updateMany({
        where: {
          userId,
          type: PasswordType.PASSWORD,
          deleted: false,
        },
        data: { deleted: true },
      }),
      this.models.password.create({
        data: {
          userId,
          password: hashed,
          type: PasswordType.PASSWORD,
        },
      }),
      this.models.user.update({
        where: { id: userId },
        data: { status: UserStatus.ACTIVE },
      }),
    ]);

    return { ok: true };
  }
}
