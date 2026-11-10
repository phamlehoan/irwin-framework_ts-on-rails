import { isMailDeliveryConfigured } from "@lib/utils/mailConfig";
import { normalizeEmail, registrationEnabled } from "@lib/utils/email";
import { validatePassword } from "@lib/utils/passwordPolicy";
import { PasswordType, UserStatus } from "@models";
import {
  buildActivateAccountUrl,
  generateInviteToken,
} from "./authInvite.service";
import { ApplicationService } from "../application.service";
import { logger, Security, UnprocessableEntityError } from "ts-rails";

export type RegisterUserInput = {
  firstName: string;
  lastName: string;
  middleName?: string | null;
  email: string;
  password?: string;
  passwordConfirmation?: string;
};

export type RegisterUserResult = {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    status: string;
  };
  status: string;
  activationRequired: boolean;
  emailSent: boolean;
};

async function sendAccountInviteEmail(
  email: string,
  firstName: string,
  lastName: string,
  activateLink: string,
): Promise<boolean> {
  try {
    const { UserMailer } = await import("@mailers/user.mailer");
    await UserMailer.accountInvite(email, firstName, lastName, activateLink);
    return true;
  } catch (err) {
    logger.error(
      { err: String(err), email },
      "[AuthRegisterService] Failed to send activation email",
    );
    return false;
  }
}

export class AuthRegisterService extends ApplicationService {
  async execute(input: RegisterUserInput): Promise<RegisterUserResult> {
    // IRW-FIX-057: cờ tắt đăng ký công khai; email chuẩn hóa một nơi; chính sách mật khẩu một nơi.
    if (!registrationEnabled()) {
      throw new UnprocessableEntityError("REGISTRATION_DISABLED");
    }
    const email = normalizeEmail(input.email);
    const activationRequired = isMailDeliveryConfigured();
    if (input.password?.trim()) {
      const problem = validatePassword(input.password);
      if (problem) throw new UnprocessableEntityError(problem);
    }

    const existing = await this.models.user.findFirst({
      where: { email, deleted: false },
    });
    if (existing) {
      // REGISTER_NEUTRAL_RESPONSE=true: không lộ email đã tồn tại (phản hồi giống đăng ký thành công chờ kích hoạt).
      if (process.env.REGISTER_NEUTRAL_RESPONSE === "true") {
        return {
          user: {
            id: "",
            email,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            middleName: input.middleName?.trim() || null,
            status: UserStatus.PENDING,
          },
          status: UserStatus.PENDING,
          activationRequired: true,
          emailSent: false,
        };
      }
      throw new UnprocessableEntityError("REGISTRATION_EMAIL_EXISTS");
    }

    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const middleName = input.middleName?.trim() || null;

    if (activationRequired) {
      const pendingData: Record<string, unknown> = {
        firstName,
        lastName,
        middleName,
        email,
        status: UserStatus.PENDING,
      };

      if (input.password?.trim()) {
        if (input.password !== input.passwordConfirmation) {
          throw new UnprocessableEntityError("PASSWORD_MISMATCH");
        }
        const hashed = await Security.hashPassword(input.password);
        Object.assign(pendingData, {
          passwords: {
            create: {
              password: hashed,
              type: PasswordType.PASSWORD,
            },
          },
        });
      }

      const user = await this.models.user.create({
        data: pendingData as Parameters<
          typeof this.models.user.create
        >[0]["data"],
      });

      const inviteToken = generateInviteToken(user.id);
      const activateLink = buildActivateAccountUrl(inviteToken);
      const emailSent = await sendAccountInviteEmail(
        user.email,
        user.firstName,
        user.lastName,
        activateLink,
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          middleName: user.middleName,
          status: user.status,
        },
        status: user.status,
        activationRequired: true,
        emailSent,
      };
    }

    if (!input.password?.trim()) {
      throw new UnprocessableEntityError("PASSWORD_REQUIRED");
    }
    if (input.password !== input.passwordConfirmation) {
      throw new UnprocessableEntityError("PASSWORD_MISMATCH");
    }

    const hashed = await Security.hashPassword(input.password);
    const user = await this.models.user.create({
      data: {
        firstName,
        lastName,
        middleName,
        email,
        status: UserStatus.ACTIVE,
        passwords: {
          create: {
            password: hashed,
            type: PasswordType.PASSWORD,
          },
        },
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        middleName: user.middleName,
        status: user.status,
      },
      status: user.status,
      activationRequired: false,
      emailSent: false,
    };
  }
}
