// =============================================================
// 外部ゲストとの1to1予約から、そのゲストを外部人脈として登録するモーダル
// 招待時は公開予約URLを送るだけの簡単な導線を保ったまま、
// ミーティング終了後にホーム画面から人脈登録を促す（案A）
// =============================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Sparkles, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type Visibility = "private" | "existence" | "full";
const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: "🔒 非公開（自分だけのメモ）",
  existence: "👤 存在のみ公開（名前は伏せる）",
  full: "🌐 完全公開（名前も表示）",
};

type Props = {
  bookingId: string;
  guestName: string;
  guestCompany?: string | null;
  onClose: () => void;
};

type SummaryPreview = { status: "done" | "not_found" | "error"; summary: string | null; detail: string | null; specialty: string | null };

export function AddContactFromBookingModal({ bookingId, guestName, guestCompany, onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(guestName);
  const [specialty, setSpecialty] = useState("");
  const [company, setCompany] = useState(guestCompany ?? "");
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("existence");
  const [error, setError] = useState("");
  const [aiSummary, setAiSummary] = useState<{ summary: string; detail: string } | null>(null);
  const [aiError, setAiError] = useState("");

  const generateSummary = useMutation({
    mutationFn: () => api.post<{ data: SummaryPreview }>("/collab/contacts/generate-summary-preview", {
      company: company.trim(),
      name: name.trim(),
    }),
    onSuccess: (res) => {
      const result = res.data;
      if (result.status === "done") {
        setSpecialty(result.specialty ?? specialty);
        setAiSummary({ summary: result.summary ?? "", detail: result.detail ?? result.summary ?? "" });
      } else {
        setAiError("会社概要が見つかりませんでした。会社名を確認するか、手入力してください。");
      }
    },
    onError: (e) => setAiError(e instanceof ApiError ? e.message : "AI生成に失敗しました"),
  });

  function handleGenerate() {
    setAiError("");
    if (!company.trim()) { setAiError("先に会社名/屋号を入力してください"); return; }
    generateSummary.mutate();
  }

  const create = useMutation({
    mutationFn: () => api.post("/collab/contacts", {
      name: name.trim(),
      specialty: specialty.trim() || undefined,
      company: company.trim() || undefined,
      note: note.trim() || undefined,
      visibility,
      sourceBookingId: bookingId,
      ...(aiSummary ? { businessSummary: aiSummary.summary, businessSummaryDetail: aiSummary.detail } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "contacts"] });
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
      // "scheduler","bookings" 配下すべて（一覧・人脈登録待ち・直近予約・詳細）をまとめて無効化する
      qc.invalidateQueries({ queryKey: ["scheduler", "bookings"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "登録に失敗しました"),
  });

  function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("名前を入力してください"); return; }
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            🌐 外部人脈に追加
          </h2>
          <button onClick={onClose} className="shrink-0"><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          会社名を入れておくと、会社概要は後から自動で生成されます。連絡先（メール・電話番号など）は保存されません。
        </p>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>名前 *</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>専門分野</label>
        <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="例: 税務相談"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>会社名/屋号</label>
        <input value={company}
          onChange={(e) => { setCompany(e.target.value); setAiSummary(null); setAiError(""); }}
          placeholder="例: 高橋会計事務所"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-2" style={{ borderColor: "var(--color-paper-300)" }} />

        <button type="button" onClick={handleGenerate} disabled={generateSummary.isPending}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium mb-1 disabled:opacity-50"
          style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-700)" }}>
          {generateSummary.isPending
            ? <Loader2 size={13} className="animate-spin" />
            : <Sparkles size={13} />}
          {generateSummary.isPending ? "AIが調べています…" : "✨ 会社名からAIで専門分野・会社概要を生成"}
        </button>
        {aiError && <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>{aiError}</p>}
        {aiSummary && (
          <div className="rounded-xl px-3 py-2 mb-3 text-xs" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}>
            <p className="font-medium mb-0.5" style={{ color: "var(--color-ink-700)" }}>🏢 AIが生成した会社概要</p>
            <p>{aiSummary.detail}</p>
          </div>
        )}

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>備考</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 紹介で1to1を実施"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>公開範囲</label>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
          {(["existence", "private", "full"] as Visibility[]).map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
        </select>

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button onClick={handleSubmit} disabled={create.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            登録する
          </button>
        </div>
      </div>
    </div>
  );
}
