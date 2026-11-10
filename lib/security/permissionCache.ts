/**
 * Cache quyền theo user trong bộ nhớ (IRW-FIX-064) để 100 request liên tiếp chỉ tốn <= 1 lần truy vấn quyền.
 * TTL ngắn (mặc định 30 s) + vô hiệu tường minh khi đổi vai trò/quyền/khóa user.
 * Tắt bằng `PERMISSION_CACHE_TTL_MS=0` (hành vi cũ). Nhiều instance: dùng TTL ngắn, vô hiệu chỉ có hiệu lực
 * cục bộ — giới hạn đã biết, giải quyết bằng cache Redis ở gói 2.0 (IRW-FEAT-014).
 */
type Entry = { value: string[]; expiresAt: number };

const entries = new Map<string, Entry>();
const MAX_ENTRIES = 5000;

function ttlMs(): number {
  const n = parseInt(process.env.PERMISSION_CACHE_TTL_MS ?? "30000", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function getCachedPermissions(userId: string): string[] | undefined {
  const e = entries.get(userId);
  if (!e) return undefined;
  if (e.expiresAt <= Date.now()) {
    entries.delete(userId);
    return undefined;
  }
  return e.value;
}

export function setCachedPermissions(userId: string, value: string[]): void {
  const ttl = ttlMs();
  if (ttl === 0) return;
  if (entries.size >= MAX_ENTRIES) {
    // Bỏ phần tử cũ nhất (Map giữ thứ tự chèn) để bộ nhớ không phình vô hạn.
    const first = entries.keys().next().value;
    if (first !== undefined) entries.delete(first);
  }
  entries.set(userId, { value, expiresAt: Date.now() + ttl });
}

export function invalidateUserPermissions(userId: string): void {
  entries.delete(userId);
}

/** Vai trò/quyền của role đổi thì ảnh hưởng nhiều user: xóa toàn bộ cho đơn giản và an toàn. */
export function invalidateAllPermissions(): void {
  entries.clear();
}
