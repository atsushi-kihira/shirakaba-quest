// =============================================================
// 管理画面「統計レポート」— 取り込み済みレポートの一覧（削除）と、名前とメンバーのひも付け
// =============================================================
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { mtlrYmLabel } from "@shared/mtlr";
import { MTLR_QUERY_KEY, fmtImportedAt, fmtJpDate, type MtlrAll } from "./_stats-shared";

export function MtlrReportList({ data }: { data: MtlrAll }) {
  const qc = useQueryClient();
  const [confirmYm, setConfirmYm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (ym: string) => api.delete(`/admin/mtlr/reports/${ym}`),
    onSuccess: () => { setConfirmYm(null); void qc.invalidateQueries({ queryKey: MTLR_QUERY_KEY }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "削除できませんでした。もう一度お試しください。"),
  });
  const reports = [...data.reports].reverse();

  return (
    <div className="card-paper p-5">
      <h2 className="font-semibold text-base mb-3" style={{ color: "var(--color-ink-800)" }}>🗂️ 取り込み済みのレポート</h2>
      {reports.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>まだ取り込まれていません。</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--color-paper-300)" }}>
          {reports.map((r) => (
            <li key={r.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ borderColor: "var(--color-paper-300)" }}>
              <span className="font-semibold text-sm w-24" style={{ color: "var(--color-ink-900)" }}>{mtlrYmLabel(r.ym)}</span>
              <span className="text-xs flex-1 min-w-[200px]" style={{ color: "var(--color-ink-600)" }}>
                {fmtJpDate(r.periodFrom)} 〜 {fmtJpDate(r.periodTo)}&emsp;{r.rows.length}人&emsp;（{fmtImportedAt(r.importedAt)}に取り込み）
              </span>
              {confirmYm === r.ym ? (
                <span className="flex items-center gap-2 text-sm">
                  <span style={{ color: "var(--color-brand-dk)" }}>削除すると元に戻せません。</span>
                  <button type="button" onClick={() => remove.mutate(r.ym)} disabled={remove.isPending}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium text-white inline-flex items-center gap-1" style={{ background: "var(--color-brand)" }}>
                    {remove.isPending && <Loader2 size={12} className="animate-spin" />}削除する
                  </button>
                  <button type="button" onClick={() => setConfirmYm(null)} className="text-xs px-2 py-1.5" style={{ color: "var(--color-ink-600)" }}>やめる</button>
                </span>
              ) : (
                <button type="button" onClick={() => { setError(null); setConfirmYm(r.ym); }} className="text-xs px-3 py-1.5 rounded-xl"
                  style={{ border: "1px solid var(--color-paper-300)", color: "var(--color-ink-600)" }}>削除</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm mt-2" style={{ color: "var(--color-brand-dk)" }} role="alert">{error}</p>}
    </div>
  );
}

const NONE = "__none__";

export function MtlrLinkPanel({ data }: { data: MtlrAll }) {
  const qc = useQueryClient();
  const [onlyUnlinked, setOnlyUnlinked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 全レポートに出てきた人を、新しいレポートの情報で1行にまとめる
  const people = useMemo(() => {
    const map = new Map<string, { personKey: string; displayName: string; memberId: string | null; lastYm: string }>();
    for (const rep of data.reports) {
      for (const r of rep.rows) map.set(r.personKey, { personKey: r.personKey, displayName: r.displayName, memberId: r.memberId, lastYm: rep.ym });
    }
    return [...map.values()];
  }, [data.reports]);
  const members = useMemo(() => [...data.members].sort((a, b) => a.name.localeCompare(b.name, "ja")), [data.members]);
  const linkMap = useMemo(() => new Map(data.links.map((l) => [l.personKey, l.memberId])), [data.links]);
  /** 選択肢の値: "" = 自動 / NONE = メンバーではない / メンバーID = 手でひも付け */
  const selectValue = (p: { personKey: string; memberId: string | null }): string =>
    linkMap.has(p.personKey) ? (linkMap.get(p.personKey) ?? NONE) : "";
  const isUnlinked = (p: { personKey: string; memberId: string | null }) => !p.memberId && !(linkMap.has(p.personKey) && linkMap.get(p.personKey) === null);

  const save = useMutation({
    mutationFn: async ({ personKey, value }: { personKey: string; value: string }) => {
      if (value === "") return api.delete(`/admin/mtlr/links/${encodeURIComponent(personKey)}`);
      return api.put("/admin/mtlr/links", { personKey, memberId: value === NONE ? null : value });
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: MTLR_QUERY_KEY }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "保存できませんでした。もう一度お試しください。"),
  });

  const unlinkedCount = people.filter(isUnlinked).length;
  const shown = onlyUnlinked ? people.filter(isUnlinked) : people;

  return (
    <div className="card-paper p-5">
      <h2 className="font-semibold text-base mb-1" style={{ color: "var(--color-ink-800)" }}>🔗 名前のひも付け</h2>
      <p className="text-sm mb-3" style={{ color: "var(--color-ink-600)" }}>
        レポートの名前と、アプリのメンバーを結びつけます。名前が同じなら自動で結びつきます。一度ひも付けると、次の月からも引き継がれます。
        メンバーではない人（退会した人など）は、「メンバーではない」を選んでください。
      </p>
      <label className="flex items-center gap-2 text-sm mb-3" style={{ color: "var(--color-ink-700)" }}>
        <input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} />
        まだ結びついていない人だけを表示（{unlinkedCount}人）
      </label>
      {shown.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-success-dk)" }}>✅ 結びついていない人はいません。</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--color-paper-300)" }}>
          {shown.map((p) => (
            <li key={p.personKey} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ borderColor: "var(--color-paper-300)" }}>
              <span className="text-sm font-medium w-44 truncate" style={{ color: "var(--color-ink-900)" }}>{p.displayName}</span>
              <select
                value={selectValue(p)}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ personKey: p.personKey, value: e.target.value })}
                className="rounded-xl px-3 py-1.5 text-sm flex-1 min-w-[200px] max-w-xs" style={{ border: "1px solid var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-900)" }}
              >
                <option value="">{p.memberId && !linkMap.has(p.personKey) ? "（自動：名前が一致しています）" : "（自動：名前が同じメンバー）"}</option>
                <option value={NONE}>メンバーではない</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.status === "on_leave" ? "（休会中）" : ""}</option>)}
              </select>
              {save.isPending && save.variables?.personKey === p.personKey && <Loader2 size={14} className="animate-spin" style={{ color: "var(--color-ink-400)" }} />}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm mt-2" style={{ color: "var(--color-brand-dk)" }} role="alert">{error}</p>}
    </div>
  );
}
