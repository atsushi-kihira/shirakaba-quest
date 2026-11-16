// =============================================================
// 管理者のタイプ（admins.role）と、タイプごとに使える機能
//   super_admin / admin … 管理ダッシュボードのすべての機能
//   stats（統計レポート）… 統計レポートの「参照」と「レポートの取り込み」だけ
// =============================================================

export type AdminRole = "super_admin" | "admin" | "stats";

export const ADMIN_ROLES: AdminRole[] = ["super_admin", "admin", "stats"];

/** 画面から送られてきたタイプを確認する。知らない値は、ふつうの管理者にする */
export function normalizeAdminRole(value: unknown): AdminRole {
  return ADMIN_ROLES.find((r) => r === value) ?? "admin";
}

/**
 * 「統計レポート」タイプの管理者が呼べるAPI（これ以外は、すべて使えない）。
 * レポートの削除や、名前とメンバーのひも付けの変更は、取り込みには含めていない。
 */
const STATS_ADMIN_ALLOWED: { method: string; path: string }[] = [
  { method: "GET", path: "/api/admin/mtlr/all" },
  { method: "POST", path: "/api/admin/mtlr/preview" },
  { method: "POST", path: "/api/admin/mtlr/import" },
];

export function isAllowedForStatsAdmin(method: string, path: string): boolean {
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return STATS_ADMIN_ALLOWED.some((a) => a.method === method && a.path === p);
}
