// =============================================================
// 「1to1を申し込む」モーダル（通常申込：相手が公開予約URLで日時を選ぶ方式）
// タイトル・所要時間・メッセージ・メール通知の可否を指定できる。
// 日時・会議ツールはここでは選ばない（相手が予約ページで選ぶため）。
// =============================================================
import { useState } from "react";
import type { MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Handshake, ExternalLink } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAutoSchedulerShareLink } from "@/components/scheduler-share-link-panel";

const DURATION_OPTIONS = [30, 45, 60, 90];

export function NormalRequestModal({
  responderId,
  responderName,
  onClose,
  onSuccess,
}: {
  responderId: string;
  responderName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const { data: previewShareData, generate: previewGenerate } = useAutoSchedulerShareLink();
  const [title, setTitle] = useState(`${responderName}さんとの1to1`);
  const [duration, setDuration] = useState(30);
  const [note, setNote] = useState("");
  const [notifyByEmail, setNotifyByEmail] = useState(true);
  const [error, setError] = useState("");

  const submitMutation = useMutation({
    mutationFn: () => api.post("/oneonone", {
      responderId,
      title: title.trim() || undefined,
      durationMinutes: duration,
      note: note.trim() || undefined,
      notifyByEmail,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      onSuccess();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  // 相手からどう見えるかを事前に確認できるよう、自分の予約ページを新しいタブで開く
  const previewUrl = previewShareData?.publicUrl ?? null;
  function handleCalendarPreviewClick(e: MouseEvent) {
    if (previewUrl) return; // <a href> にまかせる
    e.preventDefault();
    previewGenerate.mutate(undefined, {
      onSuccess: (res) => {
        if (res.data.publicUrl) window.open(res.data.publicUrl, "_blank", "noopener,noreferrer");
      },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            <Handshake size={20} />
            1to1を申し込む
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-xl" style={{ color: "var(--color-ink-400)" }}>
            <X size={18} />
          </button>
        </div>

        <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
          {responderName}さんに申込が届き、あなたの予約ページから空いている日時を選んでもらいます。
        </p>
        <a
          href={previewUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleCalendarPreviewClick}
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4"
          style={{ color: "var(--color-brand)" }}
        >
          <ExternalLink size={13} />
          📅 カレンダーページを表示（相手からの見え方を確認）
        </a>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ミーティングのタイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${responderName}さんとの1to1`}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
            <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
              カレンダーやZoomの予定名、通知メールの案内文として使われます
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>所要時間</label>
            <div className="flex gap-2">
              {DURATION_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className="flex-1 py-2 rounded-xl text-sm font-medium transition"
                  style={{
                    background: duration === d ? "var(--color-brand)" : "var(--color-paper-200)",
                    color: duration === d ? "white" : "var(--color-ink-600)",
                  }}
                >
                  {d}分
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
              このリンクだけの所要時間です。あなたの予約ページ全体の設定は変わりません
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メッセージ（任意）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="例：先日お話しした件でよろしくお願いします"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border resize-none"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-600)" }}>
            <input type="checkbox" checked={notifyByEmail} onChange={(e) => setNotifyByEmail(e.target.checked)} className="w-4 h-4 rounded" />
            📧 {responderName}さんにメールで通知する
          </label>

          {error && (
            <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
              {error}
            </p>
          )}

          <button
            onClick={() => { setError(""); submitMutation.mutate(); }}
            disabled={submitMutation.isPending}
            className="w-full py-3.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            {submitMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Handshake size={16} />}
            この内容で申し込む
          </button>
        </div>
      </div>
    </div>
  );
}
