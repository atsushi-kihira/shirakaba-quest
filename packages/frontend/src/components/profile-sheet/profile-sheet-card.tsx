// =============================================================
// 相手の詳細画面に出す「もらった資料（自分だけが見える）」のカード
//   登録がなければ取り込みの案内、あれば表で表示（編集・資料から読み取り直し・削除ができる）
// =============================================================
import { useState } from "react";
import { Loader2, Pencil, FileUp, RefreshCw, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import type { ProfileSheet, ProfileSheetSubjectType } from "@shared/types";
import { ProfileSheetImportModal } from "./profile-sheet-import-modal";
import { ProfileSheetTable } from "./profile-sheet-table";
import { ReferralLinksPanel } from "./referral-links-panel";
import { TagLinks } from "./tag-links";
import { useCompanyLookup, useDeleteSheet, useProfileSheet } from "./profile-sheet-shared";

type Props = { type: ProfileSheetSubjectType; subjectId: string; subjectName: string };

/** 「事業内容」の行の中身：自動取得の状況と、取得し直すボタン */
function CompanyDescription({ sheet, type, subjectId, onError }: { sheet: ProfileSheet; type: ProfileSheetSubjectType; subjectId: string; onError: (m: string) => void }) {
  const lookup = useCompanyLookup();
  if (!sheet.company) return <span style={{ color: "var(--color-ink-300)" }}>会社・屋号を入れると、自動で調べて、ここに入ります</span>;
  const pending = sheet.companyLookupStatus === "pending" || lookup.isPending;
  return (
    <div className="space-y-1.5">
      {pending ? (
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-500)" }}>
          <Loader2 size={13} className="animate-spin" /> ホームページと事業内容を調べています…
        </span>
      ) : sheet.companyDescription ? (
        <p className="whitespace-pre-wrap">{sheet.companyDescription}</p>
      ) : (
        <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>
          {sheet.companyLookupStatus === "not_found" ? "ホームページ・事業内容は、見つかりませんでした"
            : sheet.companyLookupStatus === "error" ? "うまく調べられませんでした"
              : "まだ調べていません"}
        </span>
      )}
      {!pending && (
        <button onClick={() => lookup.mutate({ type, id: subjectId }, { onError: (e) => onError(e instanceof ApiError ? e.message : "会社情報を調べられませんでした。もう一度お試しください") })}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <RefreshCw size={11} /> 会社情報を{sheet.companyDescription || sheet.companyUrl ? "取得し直す" : "調べる"}
        </button>
      )}
    </div>
  );
}

export function ProfileSheetCard({ type, subjectId, subjectName }: Props) {
  const { termSheetMemo } = useSettings();
  const { data: sheet, isLoading, isError } = useProfileSheet(type, subjectId);
  const del = useDeleteSheet();
  const [modal, setModal] = useState<null | "import" | "edit">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="card-paper rounded-3xl p-5" aria-label={termSheetMemo}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-1">
        <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📎 {termSheetMemo}
        </h2>
        <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full" style={{ background: "rgba(90,140,92,0.14)", color: "var(--color-ink-700)" }}>
          🔒 あなただけが見られます
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>
      ) : isError ? (
        <p className="text-sm py-4" style={{ color: "var(--color-ink-500)" }}>読み込めませんでした。少し待ってから、もう一度開いてください。</p>
      ) : !sheet ? (
        <div>
          <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
            {subjectName}さんからもらった略歴シート・GAINSシート・1to1シートがあれば、取り込んで残せます。リファーラルさがしや、協働の相手さがしにも使われます。
          </p>
          <button onClick={() => setModal("import")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium text-white" style={{ background: "var(--color-brand)" }}>
            <FileUp size={16} /> 資料を取り込む
          </button>
          <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-ink-700)" }}>
              {type === "member" ? "紹介できそうな人（あなたの外部人脈から）" : "メンバーの誰に紹介できそうか"}
            </p>
            <ReferralLinksPanel type={type} subjectId={subjectId} subjectName={subjectName} />
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <ProfileSheetTable sheet={sheet}
            tagsNode={<TagLinks type={type} subjectId={subjectId} tags={sheet.tags} />}
            companyDescriptionNode={<CompanyDescription sheet={sheet} type={type} subjectId={subjectId} onError={setError} />}
            extraRows={[{
              after: "wantedReferrals",
              label: type === "member" ? "紹介できそうな人（あなたの外部人脈から）" : "メンバーの誰に紹介できそうか",
              node: <ReferralLinksPanel type={type} subjectId={subjectId} subjectName={subjectName} />,
            }]} />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button onClick={() => setModal("edit")} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-medium"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
              <Pencil size={13} /> 編集する
            </button>
            <button onClick={() => setModal("import")} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-medium"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
              <FileUp size={13} /> 資料から読み取り直す
            </button>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-700)" }}>
                削除しますか？
                <button disabled={del.isPending}
                  onClick={() => del.mutate({ type, id: subjectId }, {
                    onSuccess: () => setConfirmDelete(false),
                    onError: (e) => { setConfirmDelete(false); setError(e instanceof ApiError ? e.message : "削除に失敗しました"); },
                  })}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                  {del.isPending ? "削除中…" : "削除する"}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-xl text-xs" style={{ background: "var(--color-paper-200)" }}>やめる</button>
              </span>
            ) : (
              <button onClick={() => { setError(null); setConfirmDelete(true); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs"
                style={{ color: "var(--color-ink-500)" }}>
                <Trash2 size={13} /> 削除
              </button>
            )}
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--color-ink-400)" }}>最終更新: {new Date(sheet.updatedAt * 1000).toLocaleDateString("ja-JP")}</p>
          {error && <p className="text-xs mt-2" style={{ color: "var(--color-brand)" }}>{error}</p>}
        </div>
      )}

      {modal && (
        <ProfileSheetImportModal
          subject={{ type, id: subjectId, name: subjectName }}
          existing={sheet ?? null}
          startAtEdit={modal === "edit"}
          onClose={() => setModal(null)}
          onDone={() => setModal(null)}
        />
      )}
    </section>
  );
}
