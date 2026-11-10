# Changelog

Ứng dụng mẫu `irwin-framework` (đi kèm `ts-rails`). Số phiên bản của mẫu giữ nguyên; mục dưới đây là bản vá 1.2.x tương thích ngược cho `ts-rails@^1.1.3` (và 1.2.0).

## 1.2.x (2026-11-05)

Quy ước: hành vi nguy hiểm đã đổi sang an toàn; mỗi thay đổi có cờ môi trường để quay lại (xem `.env.example`, mục "Hardening 1.2.x"). Schema Prisma chỉ thêm (một chỉ mục), không xóa cột.

### Đã sửa (IRW-FIX, test T-nnn trong `__tests__/`)
- 048 (T-048) Chỉ `typ=access` được dùng làm access token; token mời/đặt lại/refresh bị từ chối. (đợt 1)
- 049 (T-049) Không còn secret mặc định; thiếu/yếu thì không khởi động ngoài dev/test. (đợt 1)
- 050 (T-050) Trợ lý AI giữ, opt-in; SQL guard dạng tokenizer, fail-closed. (đợt 1, bản tạm)
- 051 (T-051) Seed cộng dồn, idempotent, không prune (cờ `SEED_PRUNE=true` quay lại). Không còn mật khẩu admin cố định: `ADMIN_BOOTSTRAP_PASSWORD` hoặc mật khẩu ngẫu nhiên in một lần; chạy lại seed không đặt lại mật khẩu, không bật lại admin bị khóa. Đăng ký Google không còn nối vai trò cứng (`GOOGLE_SIGNUP_ROLE`).
- 052 (T-052) `req.user` chỉ dựng cho user ACTIVE chưa xóa (`AUTH_ALLOW_INACTIVE_USERS=true` quay lại). Khóa/xóa user và đổi mật khẩu thu hồi refresh token; đổi vai trò/quyền xóa cache quyền.
- 053 (T-053) Header bảo mật (thay helmet, không thêm dependency), CSRF theo Origin/Referer/`X-Irwin-CSRF` cho form cookie (`CSRF_PROTECTION=off` tắt), cookie `SameSite=Lax`, CORS theo danh sách (production thiếu `CORS_ORIGIN` = không CORS; `CORS_ALLOW_ALL=true` quay lại).
- 054 (T-054) Google web login: `state` ngẫu nhiên gắn session, bắt buộc `verified_email`, email chuẩn hóa, tài khoản đã xóa mềm bị từ chối.
- 055 (T-055) `session.regenerate` khi đăng nhập (web và Google); `setSessionStore()` để cắm store bền vững, cảnh báo khi dùng MemoryStore ở production.
- 056 (T-056) Refresh token lưu băm SHA-256 trong `passwords` (token thô cũ vẫn dùng được một lần rồi chuyển sang băm), nhiều thiết bị (`REFRESH_MAX_SESSIONS`), xoay vòng + phát hiện dùng lại hủy mọi phiên. Link mời mặc định 72h, link đặt lại 1h; link đặt lại gắn dấu vân tay mật khẩu nên chỉ dùng một lần (410); mời dùng lần hai trả 410 (`INVITE_REUSE_STATUS=422` giữ mã cũ). Migration cộng thêm: chỉ mục `passwords(user_id, type)`.
- 057 (T-057) `normalizeEmail` một nơi (đăng nhập, đăng ký, mời, Google, admin); `validatePassword` một nơi (tối thiểu 8, chặn mật khẩu phổ biến); cờ `REGISTRATION_ENABLED=false`; phản hồi trung tính khi yêu cầu đặt lại mật khẩu (web) và `REGISTER_NEUTRAL_RESPONSE`.
- 058 (T-058) Rate limit: store có giao diện (bộ nhớ có dọn định kỳ, hoặc Redis qua `RATE_LIMIT_REDIS_URL`), nhóm riêng cho login/đăng ký/refresh/đặt lại theo IP + tài khoản, `TRUST_PROXY`.
- 059 (T-059) Cập nhật user/role/quyền (web và API) chạy trong transaction (`withTransaction`, `replaceUserRoles`...).
- 060 (T-060) Chưa xác thực trả 401, thiếu quyền trả 403 (`AUTH_LEGACY_403=true` quay lại).
- 007 phía mẫu (T-007) Nhận diện API theo tiền tố path (`API_PREFIX`) thay cho `includes("/api")` ở 5 chỗ.
- 061 (T-061) Làm sạch dấu vết dự án cũ: tên thư mục/bucket lưu trữ trung tính (`CLOUDINARY_UPLOAD_FOLDER`, `SUPABASE_BUCKET`; đường dẫn cũ giữ được qua biến này), khóa sắp xếp danh sách user của role (`name`/`email`), comment. Có test quét từ khóa cấm.
- 062 (T-062) `serverless.yml` dùng tên engine Prisma thật; `lambda.ts` nhận EventBridge ở mọi lần gọi; `ExampleJob1` được export (sẽ chạy theo cron mặc định, tắt ở Admin -> Background Jobs); README dùng `pnpm exec rails generate`; jest chạy được.
- 063 (T-063) Runner Turso áp dụng từng migration và dòng đánh dấu trong một batch ghi (transaction); tách `splitSql.ts` có test.
- 064 (T-064) Cache quyền theo user, TTL 30 s, vô hiệu khi đổi vai trò/quyền (`PERMISSION_CACHE_TTL_MS=0` tắt).
- 065 (T-065) Gỡ `lodash`, `decimal.js`, `punycode`, `@types/lodash` (không được import); ghim phiên bản chính xác theo bản đã cài; cập nhật `pnpm-lock.yaml`. Ngưỡng dependency runtime của mẫu: 51.
- Lỗ hổng thêm phát hiện: trang `/admin/me` cho phép user tự đổi vai trò của chính mình (leo thang đặc quyền) nay bị tắt (`PROFILE_SELF_ROLE_EDIT=true` quay lại).

### Giới hạn đã biết (hoãn sang 2.0 hoặc gia cố tạm)
| FIX | Còn lại | Lý do / FEAT cần | Giảm thiểu hiện tại |
|---|---|---|---|
| 050 | SQL do LLM sinh vẫn chạy bằng `$queryRawUnsafe` trên toàn DB (bản tạm) | AI Gateway có kiểu: IRW-FEAT-008 | Guard tokenizer fail-closed; không cài pack `ai` nếu không cần |
| 052 | Thu hồi tức thời chỉ qua kiểm DB mỗi request; chưa có danh sách thu hồi/`ver` phiên | IRW-FEAT-013, IRW-FEAT-008 | `getUserById` lọc ACTIVE/deleted nên khóa có hiệu lực ở request kế tiếp |
| 053 | Chưa có token CSRF đồng bộ (double-submit); CSP mặc định tắt vì view pug dùng script nội tuyến | IRW-FEAT-015 | Kiểm Origin/Referer + `SameSite=Lax`; bật CSP bằng `CSP_POLICY` |
| 055 | Không kèm sẵn store phiên bền vững (không thêm dependency) | `@irwin/view-pug` + Redis | `setSessionStore()` + cảnh báo production |
| 056 | Access token HS256 chung secret (chưa RS256); refresh token nằm trong bảng `passwords` thay vì bảng phiên riêng có thiết bị/IP | IRW-FEAT-013 | Băm, xoay vòng, reuse detection, giới hạn phiên, không đổi schema phá vỡ |
| 057 | Chưa có chuẩn hóa email ở tầng DB/extension (chỉ ở tầng ứng dụng); email cũ có chữ hoa trong DB cần dọn tay | IAM | `normalizeEmail` ở mọi điểm vào |
| 058 | Bộ đếm theo từng cửa sổ cố định, store bộ nhớ là mặc định (mỗi instance riêng) | IRW-FEAT-015 | Đặt `RATE_LIMIT_REDIS_URL` khi chạy nhiều instance |
| 059 | Controller admin vẫn chứa truy vấn Prisma (chưa tách service dùng chung web/API) | IAM, IRW-FEAT-008 | Phần ghi nằm trong transaction |
| 063 | Mẫu vẫn biên dịch với provider SQLite (Prisma chọn provider lúc generate); chưa có baseline Postgres và `irwin migrate` theo module; `prisma generate` không chạy lại trong lần vá này | IRW-FEAT-034 | Runner Turso có transaction; đường Postgres dùng `prisma migrate deploy` khi đổi provider thủ công |
| 064 | Cache quyền trong bộ nhớ, vô hiệu chỉ cục bộ trên từng instance (TTL 30 s là cận trên) | IRW-FEAT-014 | TTL ngắn; cache Redis dùng chung ở 2.0 |
| 065 | Dependency của adapter tùy chọn (`@libsql`, `better-sqlite3`, `@supabase/supabase-js`, `cloudinary`, `jimp`, `firebase-admin`...) vẫn nằm trong runtime vì code import tĩnh; `netlify-cli`, `serverless` còn ở devDependencies | Mẫu API-only tối giản ở 2.0 | Ghim phiên bản; ngưỡng test |
| 062 | `scripts/netlifyWriteRuntimeSecrets.mjs` vẫn ghi secret vào JSON của bundle function (giới hạn 4KB env của Netlify); các file được `.gitignore` | Bỏ Netlify/Vercel/serverless khỏi mẫu API-only ở 2.0 | Không commit file; dùng secret manager khi triển khai thật |
| 054 | Chưa dùng `nonce` OIDC (luồng code + userinfo, không id_token) | Module IAM | `state` + `verified_email` |

### Nâng cấp lên 2.0 (dự kiến)
- Mặc định `CSRF_PROTECTION`, `REGISTRATION_ENABLED=false`, `AUTH_LEGACY_403` bỏ hẳn; RS256; bảng phiên riêng; Postgres duy nhất.

### Ghi chú nâng cấp từ bản trước
- Chạy `pnpm install` (lockfile đã đồng bộ tay với package.json, nên chạy lại để xác nhận) rồi `pnpm db:deploy:auto` để áp dụng chỉ mục mới.
- Đặt `CORS_ORIGIN`, `TRUST_PROXY` (sau load balancer) và `SESSION_SECRET`/`JWT_SECRET` mạnh trước khi chạy production.
- Client cũ đang gửi refresh token cũ vẫn đăng nhập tiếp được một lần; sau đó nhận cặp token mới.
- Người dùng đang đăng nhập nhưng bị khóa sẽ bị từ chối ở request kế tiếp (đúng thiết kế).
