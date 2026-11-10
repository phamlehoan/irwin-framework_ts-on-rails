import env, { assertStrongSecret } from "@configs/env";
import jwt, { SignOptions } from "jsonwebtoken";

export interface JwtPayload extends jwt.JwtPayload {
  id?: string;
  /** Token type: separates access / refresh tokens so one cannot be replayed as the other. */
  typ?: string;
  /** One-shot link tokens (invite, password reset). Never valid as an access token. */
  purpose?: string;
}

/** `typ` claim values for session tokens. */
export const TOKEN_TYPE_ACCESS = "access";
export const TOKEN_TYPE_REFRESH = "refresh";

const JWT_ALGORITHM = "HS256" as const;

export class JwtService {
  private secret: string;
  constructor(secret: string) {
    this.secret = secret;
  }
  generateToken(payload: object, expiresIn: string = "3h") {
    const options: SignOptions = {
      algorithm: JWT_ALGORITHM,
      expiresIn: expiresIn as SignOptions["expiresIn"],
    };
    return jwt.sign(payload, this.secret, options);
  }
  verifyToken(token: string): JwtPayload {
    // Pin the algorithm: never trust the `alg` header of the incoming token.
    const decoded = jwt.verify(token, this.secret, {
      algorithms: [JWT_ALGORITHM],
    });
    if (typeof decoded === "string") throw new Error("Invalid token payload");
    return decoded as JwtPayload;
  }
}

let jwtServiceInstance: JwtService | undefined;

export const getJwtService = (): JwtService => {
  if (!jwtServiceInstance) {
    // Resolved lazily so that importing this module (build, scripts) never fails;
    // the first real sign/verify in a non-development environment does.
    assertStrongSecret("JWT_SECRET", env.jwtSecret);
    jwtServiceInstance = new JwtService(env.jwtSecret);
  }
  return jwtServiceInstance;
};

export const verifyToken = (token: string) =>
  getJwtService().verifyToken(token);
export const generateToken = (payload: object, expiresIn: string = "3h") =>
  getJwtService().generateToken(payload, expiresIn);

/**
 * Verifies a token and requires the given `typ`. Tokens that carry a `purpose`
 * (invite / password reset links) are always rejected.
 */
export const verifyTokenOfType = (
  token: string,
  typ: typeof TOKEN_TYPE_ACCESS | typeof TOKEN_TYPE_REFRESH,
): JwtPayload => {
  const decoded = verifyToken(token);
  if (decoded.typ !== typ || decoded.purpose !== undefined) {
    throw new Error(`Invalid token type (expected ${typ})`);
  }
  return decoded;
};

/**
 * Refresh tokens issued before `typ` existed carry neither `typ` nor `purpose`; they are still
 * accepted here so existing sessions can rotate once. This is safe because the refresh service
 * additionally requires an exact match with the token stored in the database, which only ever
 * holds refresh tokens. Access tokens, invite and reset tokens are rejected.
 */
export const verifyRefreshToken = (token: string): JwtPayload => {
  const decoded = verifyToken(token);
  if (
    decoded.purpose !== undefined ||
    (decoded.typ !== undefined && decoded.typ !== TOKEN_TYPE_REFRESH)
  ) {
    throw new Error("Invalid token type (expected refresh)");
  }
  return decoded;
};

export const generateAccessToken = (
  payload: Record<string, unknown>,
  expiresIn: string = "1h",
) => generateToken({ ...payload, typ: TOKEN_TYPE_ACCESS }, expiresIn);

export const generateRefreshToken = (
  payload: Record<string, unknown>,
  expiresIn: string = "7d",
) => generateToken({ ...payload, typ: TOKEN_TYPE_REFRESH }, expiresIn);
