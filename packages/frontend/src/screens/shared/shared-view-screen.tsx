// =============================================================
// 共有されたものを見る画面（読み取り専用）
//   /shared/:token             — URLを知っている人（ログイン不要）
//   /shared/:kind/:subjectId   — 指定された人・メンバー全員向けの共有（ログイン必要）
// =============================================================
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, Loader2 } from "lucide-react";
import { API_BASE_URL, api, ApiError } from "@/lib/api";
import { ContactsBodyView, DraftBodyView, ResultBodyView, TeamProfileBodyView } from "./_shared-bodies";
import { KIND_LABEL, type ContactsBody, type DraftBody, type ResultBody, type SharedView, type TeamProfileBody } from "./_shared-types";
import type { ShareKind } from "@/components/share-dialog";

const KINDS = new Set<string>(["team_profile", "contacts", "team_draft", "enishi_result"]);

async function fetchByToken(token: string): Promise<SharedView> {
  const res = await fetch(`${API_BASE_URL}/shared/${encodeURIComponent(token)}`);
  const json = await res.json().catch(() => ({})) as { data?: SharedView; error?: { message?: string } };
  if (!res.ok || !json.data) throw new Error(json.error?.message ?? "共有を読み込めませんでした");
  return json.data;
}

function fmtDate(sec: number): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(new Date(sec * 1000));
}

export function SharedViewScreen() {
  const { token, kind, subjectId } = useParams<{ token?: string; kind?: string; subjectId?: string }>();
  const byToken = !!token;
  const validKind = !byToken && !!kind && KINDS.has(kind);

  const q = useQuery({
    queryKey: ["shared", "view", token ?? `${kind}/${subjectId}`],
    queryFn: () => (byToken ? fetchByToken(token!) : api.get<{ data: SharedView }>(`/shares/view/${kind}/${subjectId}`).then((r) => r.data)),
    enabled: byToken || validKind,
    retry: false,
  });

  const notFound = !byToken && !validKind;
  const message = q.error instanceof ApiError || q.error instanceof Error ? q.error.message : "共有を読み込めませんでした";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {!byToken && (
        <Link to="/shared" className="inline-flex items-center gap-1 text-xs mb-3" style={{ color: "var(--color-ink-500)" }}><ArrowLeft size={14} />共有されたもの一覧へ</Link>
      )}

      {(q.isLoading && !notFound) && <div className="py-16 flex justify-center"><Loader2 className="animate-spin" size={26} style={{ color: "var(--color-ink-400)" }} /></div>}

      {(q.isError || notFound) && (
        <div className="card-paper p-6 rounded-3xl text-center">
          <p className="text-3xl mb-2">🔒</p>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-900)" }}>この共有は、見られませんでした</p>
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{notFound ? "URLが正しくありません" : message}</p>
        </div>
      )}

      {q.data && (
        <>
          <header className="mb-4">
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>
              {KIND_LABEL[q.data.kind as ShareKind]?.emoji} {KIND_LABEL[q.data.kind as ShareKind]?.label}
            </p>
            <h1 className="text-xl font-semibold break-words" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>{q.data.title}</h1>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>
              {q.data.sharedBy.emoji} {q.data.sharedBy.name}さんが共有（{fmtDate(q.data.sharedAt)}）
            </p>
            <p className="inline-flex items-center gap-1 text-xs mt-2 px-3 py-1 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
              <Eye size={12} />見るだけのページです
            </p>
          </header>
          {q.data.kind === "team_profile" && <TeamProfileBodyView body={q.data.body as TeamProfileBody} />}
          {q.data.kind === "contacts" && <ContactsBodyView body={q.data.body as ContactsBody} />}
          {q.data.kind === "team_draft" && <DraftBodyView body={q.data.body as DraftBody} />}
          {q.data.kind === "enishi_result" && <ResultBodyView body={q.data.body as ResultBody} level={q.data.viewerLevel} />}
        </>
      )}
    </div>
  );
}
