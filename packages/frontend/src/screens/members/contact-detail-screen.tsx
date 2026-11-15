// =============================================================
// 外部人脈の詳細画面（自分が登録した人脈だけ）
//   基本情報（編集もできる）と、もらった資料のメモ（略歴シート・GAINSシートなど。自分だけが見られる）を表示する
// =============================================================
import { Link, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { ProfileSheetCard } from "@/components/profile-sheet/profile-sheet-card";
import { EditContactModal, type Contact } from "./_external-contacts-tab";

type Visibility = "private" | "existence" | "full";
const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: "🔒 非公開（自分だけ）",
  existence: "🌫️ 存在のみ公開（詳細は非公開）",
  full: "📖 詳細まで公開（連絡先は非公開）",
};

export function ContactDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
  });
  const contact = data?.data.find((c) => c.id === id);
  const [editing, setEditing] = useState(false);

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <button onClick={() => navigate("/members?tab=contacts")} className="flex items-center gap-1 text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
        <ChevronLeft size={16} /> 外部人脈の一覧へ
      </button>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>
      ) : isError || !contact ? (
        <div className="card-paper rounded-3xl p-6 text-center">
          <p className="text-sm mb-3" style={{ color: "var(--color-ink-600)" }}>
            {isError ? "読み込めませんでした。少し待ってから、もう一度開いてください。" : "この人脈は見つかりませんでした。削除されたか、あなたの人脈ではありません。"}
          </p>
          <Link to="/members?tab=contacts" className="text-sm underline" style={{ color: "var(--color-brand)" }}>外部人脈の一覧へ戻る</Link>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="card-paper rounded-3xl p-5">
            <p className="text-[11px] mb-1" style={{ color: "var(--color-ink-400)" }}>🌐 外部人脈</p>
            <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>{contact.name}</h1>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>
              {[contact.specialty, contact.company, contact.prefecture ? `📍${contact.prefecture}` : null, ...contact.relationships].filter(Boolean).join(" ・ ") || "（詳細未入力）"}
            </p>
            <span className="inline-block mt-2 text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
              {VISIBILITY_LABEL[contact.visibility]}
            </span>
            {contact.businessSummaryDetail || contact.businessSummary ? (
              <p className="text-sm mt-3 whitespace-pre-wrap" style={{ color: "var(--color-ink-700)" }}>{contact.businessSummaryDetail || contact.businessSummary}</p>
            ) : null}
            {contact.note && <p className="text-xs mt-2 whitespace-pre-wrap" style={{ color: "var(--color-ink-500)" }}>備考: {contact.note}</p>}
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-xl text-xs font-medium"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
              <Pencil size={12} /> 名前・会社などの基本情報を編集する
            </button>
          </section>

          <ProfileSheetCard type="contact" subjectId={contact.id} subjectName={contact.name} />
          {editing && <EditContactModal contact={contact} onClose={() => setEditing(false)} />}
        </div>
      )}
    </div>
  );
}
