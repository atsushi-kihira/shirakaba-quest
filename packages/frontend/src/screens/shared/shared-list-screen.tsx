// =============================================================
// 共有されたもの一覧（自分に共有されているもの）
// =============================================================
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { KIND_LABEL, type SharedWithMe } from "./_shared-types";

function fmtDate(sec: number): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(new Date(sec * 1000));
}

export function SharedListScreen() {
  const q = useQuery({ queryKey: ["shares", "with-me"], queryFn: () => api.get<{ data: SharedWithMe[] }>("/shares/with-me").then((r) => r.data) });
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>📬 共有されたもの</h1>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>ほかのメンバーが、あなたに見せてくれているものです。見るだけで、内容は変えられません。</p>

      {q.isLoading && <div className="py-12 flex justify-center"><Loader2 className="animate-spin" size={24} style={{ color: "var(--color-ink-400)" }} /></div>}
      {q.isError && <p className="text-sm" style={{ color: "var(--color-danger, #b00020)" }}>{q.error instanceof ApiError ? q.error.message : "一覧を読み込めませんでした。時間をおいて、もう一度お試しください"}</p>}
      {q.data && q.data.length === 0 && (
        <div className="card-paper p-6 rounded-3xl text-center text-sm" style={{ color: "var(--color-ink-500)" }}>いま共有されているものは、ありません</div>
      )}
      <ul className="space-y-2">
        {q.data?.map((s) => (
          <li key={`${s.kind}/${s.subjectId}`}>
            <Link to={`/shared/${s.kind}/${s.subjectId}`} className="card-paper block p-4 rounded-2xl hover:opacity-90 transition">
              <p className="text-xs mb-0.5" style={{ color: "var(--color-ink-500)" }}>{KIND_LABEL[s.kind].emoji} {KIND_LABEL[s.kind].label}</p>
              <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>{s.title}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{s.sharedBy.emoji} {s.sharedBy.name}さん・{fmtDate(s.sharedAt)}{s.scope === "members" ? "・メンバー全員向け" : ""}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
