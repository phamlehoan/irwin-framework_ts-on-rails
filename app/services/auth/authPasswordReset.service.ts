import env from "@configs/env";
import { generateToken, newJti, passwordFingerprint, verifyToken } from "@lib";
import models, { PasswordType, UserStatus } from "@models";
import { validatePassword } from "@lib/utils/passwordPolicy";
import {
  AppError,
  Security,
  UnauthorizedError,
  UnprocessableEntityError,
} from "ts-rails";
import { ApplicationService } from "../application.service";

export const PASSWORD_RESET_PURPOSE = "password_reset";

export function buildResetPasswordUrl(token: string): string {
  const base = env.clientAppUrl.replace(/\/$/, "");
  const enc = encodeURIComponent(token);
  if (env.clientAppHashRouter) {
    return `${base}/#/reset-password?token=${enc}`;
  }
  return `${base}/reset-password?token=${enc}`;
}

/** Hạn link đặt lại (IRW-FIX-056): mặc định 1h thay vì 7 ngày; đổi bằng `RESET_TTL`. */
export function resetTtl(): string {
  return process.env.RESET_TTL?.trim() || "1h";
}

/**
 * Link đặt lại gắn dấu vân tay mật khẩu hiện tại (`pv`): sau khi đổi mật khẩu dấu vân tay đổi
 * nên link chỉ dùng được một lần. Bản đồng bộ (không `pv`) giữ cho tương thích.
 */
export function generatePasswordResetToken(
  userId: string,
  currentPasswordHash?: string | null,
): string {
  return generateToken(
    {
      id: userId,
      purpose: PASSWORD_RESET_PURPOSE,
      jti: newJti(),
      ...(currentPasswordHash !== undefined
        ? { pv: passwordFingerprint(currentPasswordHash) }
        : {}),
    },
    resetTtl(),
  );
}

/** Tra mật khẩu hiện tại của user rồi phát link một lần. */
export async function issuePasswordResetToken(userId: string): Promise<string> {
  const current = await models.password.findFirst({
    where: { userId, deleted: false, type: PasswordType.PASSWORD },
    orderBy: { createdAt: "desc" },
    select: { password: true },
  });
  return generatePasswordResetToken(userId, current?.password ?? null);
}

export class AuthPasswordResetService extends ApplicationService {
  private verifyResetJwt(token: string): { id: string; pv?: string } {
    let decoded: ReturnType<typeof verifyToken>;
    try {
      decoded = verifyToken(token);
    } catch {
      throw new UnauthorizedError("Invalid or expired password reset link.");
    }
    if (
      (decoded as { purpose?: string }).purpose !== PASSWORD_RESET_PURPOSE ||
      !decoded.id
    ) {
      throw new UnauthorizedError("Invalid or expired password reset link.");
    }
    return { id: decoded.id, pv: (decoded as { pv?: string }).pv };
  }

  /** Link có `pv` chỉ hợp lệ khi mật khẩu hiện tại chưa đổi kể từ lúc phát (một lần). */
  private async assertFresh(userId: string, pv: string | undefined) {
    if (pv === undefined) return; // link phát trước 1.2: tương thích, hạn do exp quyết định
    const current = await this.models.password.findFirst({
      where: { userId, deleted: false, type: PasswordType.PASSWORD },
      orderBy: { createdAt: "desc" },
      select: { password: true },
    });
    if (passwordFingerprint(current?.password ?? null) !== pv) {
      throw new AppError("This password reset link was already used.", 410);
    }
  }

  async getResetPreview(token: string) {
    const { id: userId, pv } = this.verifyResetJwt(token);
    const user = await this.models.user.findFirst({
      where: { id: userId, deleted: false },
    });
    if (!user) {
      throw new UnauthorizedError("This password reset link is no longer valid.");
    }
    await this.assertFresh(userId, pv);
    return {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  async acceptReset(
    token: string,
    password: string,
    passwordConfirmation: string,
  ): Promise<{ ok: true }> {
    if (password !== passwordConfirmation) {
      throw new UnprocessableEntityError("Passwords do not match.");
    }
    const { id: userId, pv } = this.verifyResetJwt(token);
    const user = await this.models.user.findFirst({
      where: { id: userId, deleted: false },
    });
    if (!user) {
      throw new UnauthorizedError("This password reset link is no longer valid.");
    }
    await this.assertFresh(userId, pv);
    const pwProblem = validatePassword(password);
    if (pwProblem) throw new UnprocessableEntityError(pwProblem);

    const hashed = await Security.hashPassword(password);
    const nextStatus =
      user.status === UserStatus.PENDING ? UserStatus.ACTIVE : user.status;

    await this.models.$transaction([
      this.models.password.updateMany({
        where: {
          userId,
          type: PasswordType.PASSWORD,
          deleted: false,
        },
        data: { deleted: true },
      }),
      this.models.password.deleteMany({
        where: { userId, type: PasswordType.REFRESH_TOKEN },
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
        data: { status: nextStatus },
      }),
    ]);

    return { ok: true };
  }
}
