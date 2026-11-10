/**
 * Tách file migration SQL thành từng câu lệnh (bỏ chú thích `--`, tôn trọng chuỗi '...' và "...").
 * Tách riêng khỏi runner để test được mà không cần kết nối DB (IRW-FIX-063).
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const next = i + 1 < sql.length ? sql[i + 1]! : "";

    if (!inSingle && !inDouble && ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === `"` && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === ";" && !inSingle && !inDouble) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
