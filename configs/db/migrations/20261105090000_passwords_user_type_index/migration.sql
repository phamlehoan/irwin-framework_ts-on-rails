-- CreateIndex
-- IRW-FIX-056/064: refresh token và tra mật khẩu truy vấn theo (user_id, type). Chỉ thêm chỉ mục, không đổi dữ liệu.
CREATE INDEX "passwords_user_id_type_idx" ON "passwords"("user_id", "type");
