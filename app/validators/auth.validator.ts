import { passwordMinLength } from "@lib/utils/passwordPolicy";
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/** Đăng ký tài khoản công khai (`GET/POST /users/new`). */
export class RegisterUserValidator {
  @IsNotEmpty({ message: "First name is required" })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @IsNotEmpty({ message: "Last name is required" })
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @IsNotEmpty({ message: "Email is required" })
  @IsEmail({}, { message: "Invalid email" })
  email!: string;

  /** Bắt buộc khi không có mail — validate thêm trong AuthRegisterService. */
  @IsOptional()
  @IsString()
  @MinLength(passwordMinLength(), {
    message: "Password must be at least 8 characters",
  })
  password?: string;

  @IsOptional()
  @IsString()
  passwordConfirmation?: string;
}

export class RegisterApiValidator extends RegisterUserValidator {
  @IsNotEmpty({ message: "Password is required" })
  @IsString()
  @MinLength(passwordMinLength(), {
    message: "Password must be at least 8 characters",
  })
  override password!: string;

  @IsNotEmpty({ message: "Password confirmation is required" })
  @IsString()
  override passwordConfirmation!: string;
}

export class LoginValidator {
  @IsNotEmpty({ message: "Email is required" })
  @IsEmail()
  email!: string;

  @IsNotEmpty({ message: "Password is required" })
  @IsString()
  @MinLength(1)
  password!: string;
}

export class CreatePasswordValidator {
  @IsNotEmpty({ message: "Email is required" })
  @IsEmail()
  email!: string;
}

export class UpdatePasswordValidator {
  @IsNotEmpty({ message: "Password is required" })
  @IsString()
  @MinLength(passwordMinLength(), {
    message: "Password must be at least 8 characters",
  })
  password!: string;

  @IsNotEmpty({ message: "Password confirmation is required" })
  @IsString()
  passwordConfirmation!: string;

  @IsOptional()
  @IsString()
  oldPassword?: string;

  @IsOptional()
  @IsString()
  token?: string;
}

export class GoogleVerifyValidator {
  static schema = { idToken: "string" } as const;
  static required = ["idToken"] as const;

  @IsNotEmpty({ message: "Missing ID token" })
  @IsString()
  @MinLength(1)
  idToken!: string;
}

export class RefreshTokenValidator {
  static schema = { refreshToken: "string" } as const;
  static required = ["refreshToken"] as const;

  @IsNotEmpty({ message: "Missing refresh token" })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class InviteAcceptValidator {
  static schema = {
    token: "string",
    password: "string",
    passwordConfirmation: "string",
  } as const;
  static required = ["token", "password", "passwordConfirmation"] as const;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  token!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(passwordMinLength(), {
    message: "Password must be at least 8 characters",
  })
  password!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: "Password confirmation must be at least 8 characters" })
  passwordConfirmation!: string;
}

export class UpdateMyProfileValidator {
  static schema = {
    firstName: "string",
    lastName: "string",
    middleName: "string",
    gender: "string",
    phoneNumber: "string",
    address: "string",
  } as const;

  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  middleName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  gender?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phoneNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
}

export class ChangeMyPasswordValidator {
  static schema = {
    oldPassword: "string",
    newPassword: "string",
    newPasswordConfirmation: "string",
  } as const;
  static required = [
    "oldPassword",
    "newPassword",
    "newPasswordConfirmation",
  ] as const;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  oldPassword!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(passwordMinLength(), {
    message: "New password must be at least 8 characters",
  })
  newPassword!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: "Confirmation must be at least 8 characters" })
  newPasswordConfirmation!: string;
}
