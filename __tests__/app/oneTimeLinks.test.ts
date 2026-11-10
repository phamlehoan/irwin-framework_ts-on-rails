jest.mock("@models", () => require("../helpers/memoryModels").modelsModule);

import { models, resetModels } from "../helpers/memoryModels";
import {
  AuthInviteService,
  generateInviteToken,
  inviteTtl,
} from "../../app/services/auth/authInvite.service";
import {
  AuthPasswordResetService,
  issuePasswordResetToken,
  resetTtl,
} from "../../app/services/auth/authPasswordReset.service";
import { verifyToken } from "@lib/utils/jwt";

const GOOD_PW = "Tr0ub4dor&3x";

async function seedUser(status: string) {
  const u = await models.user.create({
    data: { email: "a@x.com", firstName: "A", lastName: "B", status, deleted: false },
  });
  return u.id as string;
}

describe("T-056 link mời và đặt lại dùng một lần, hạn ngắn", () => {
  beforeEach(() => {
    resetModels();
    delete process.env.INVITE_TTL;
    delete process.env.RESET_TTL;
    delete process.env.INVITE_REUSE_STATUS;
  });

  it("hạn mặc định ngắn: mời 72h, đặt lại 1h (không còn 7 ngày)", async () => {
    const id = await seedUser("PENDING");
    expect(inviteTtl()).toBe("72h");
    expect(resetTtl()).toBe("1h");
    const invite = verifyToken(generateInviteToken(id));
    expect((invite.exp ?? 0) - (invite.iat ?? 0)).toBe(72 * 3600);
    const reset = verifyToken(await issuePasswordResetToken(id));
    expect((reset.exp ?? 0) - (reset.iat ?? 0)).toBe(3600);
  });

  it("link mời dùng lần hai -> 410", async () => {
    // Sau lần dùng đầu tiên tài khoản chuyển ACTIVE; dùng lại cùng link phải trả 410.
    const id = await seedUser("ACTIVE");
    const token = generateInviteToken(id);
    const svc = new AuthInviteService();
    await expect(svc.acceptInvite(token, GOOD_PW, GOOD_PW)).rejects.toMatchObject({
      statusCode: 410,
    });
  });

  it("INVITE_REUSE_STATUS=422 giữ mã cũ", async () => {
    process.env.INVITE_REUSE_STATUS = "422";
    const id = await seedUser("ACTIVE");
    const svc = new AuthInviteService();
    await expect(
      svc.acceptInvite(generateInviteToken(id), GOOD_PW, GOOD_PW),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("link đặt lại chỉ dùng được một lần (dấu vân tay mật khẩu đổi)", async () => {
    const id = await seedUser("ACTIVE");
    await models.password.create({ data: { userId: id, password: "hash-old", type: "PASSWORD" } });
    const token = await issuePasswordResetToken(id);
    const svc = new AuthPasswordResetService();

    await expect(svc.getResetPreview(token)).resolves.toMatchObject({ email: "a@x.com" });
    // Mô phỏng đổi mật khẩu thành công (như acceptReset làm).
    await models.password.create({ data: { userId: id, password: "hash-new", type: "PASSWORD" } });
    await expect(svc.getResetPreview(token)).rejects.toMatchObject({ statusCode: 410 });
    await expect(svc.acceptReset(token, GOOD_PW, GOOD_PW)).rejects.toMatchObject({
      statusCode: 410,
    });
  });

  it("mật khẩu mới phải qua chính sách chung", async () => {
    const id = await seedUser("ACTIVE");
    const token = await issuePasswordResetToken(id);
    const svc = new AuthPasswordResetService();
    await expect(svc.acceptReset(token, "short", "short")).rejects.toMatchObject({
      statusCode: 422,
    });
  });
});
