// =============================================================
// 確定した日程と会議URLを、まとめてテキストで出力するダイアログ
// メールやDMなどに貼り付けて、全員に確定日とURLを伝えるために使う。内容はその場で書き換えてからコピーできる。
// =============================================================
import { useMemo, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { useTimezone } from "@/hooks/use-timezone";
import { buildScheduleText, type ScheduleTextItem } from "@/lib/schedule-text";

export function ScheduleTextModal({ title, hostName, items, pageUrl, fallbackUrl, onClose }: {
  title: string; hostName?: string | null; items: ScheduleTextItem[]; pageUrl?: string; fallbackUrl?: string | null; onClose: () => void;
}) {
  const tz = useTimezone();
  const initial = useMemo(() => buildScheduleText({ title, hostName, items, tz, pageUrl, fallbackUrl }), [title, hostName, items, tz, pageUrl, fallbackUrl]);
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // クリップボードAPIが使えない環境では、選択状態にして手動コピーしてもらう
      const el = document.getElementById("schedule-text-area") as HTMLTextAreaElement | null;
      el?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(26,20,16,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card-paper rounded-3xl w-full max-w-lg p-5 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <p className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>📋 日程と会議URLをテキストで出力</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              メールやDMに貼り付けて、確定した日程と会議URLを全員にお伝えできます。必要なら、下の文面を書き換えてからコピーしてください。
            </p>
          </div>
          <button onClick={onClose} aria-label="閉じる" className="p-1.5 rounded-lg hover:opacity-70" style={{ color: "var(--color-ink-500)" }}><X size={16} /></button>
        </div>
        <textarea id="schedule-text-area" value={text} onChange={(e) => setText(e.target.value)} rows={14}
          className="w-full rounded-2xl px-3 py-2.5 text-sm leading-relaxed" style={{ border: "1px solid var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-800)", fontFamily: "inherit" }} />
        <div className="flex gap-2">
          <button onClick={() => setText(initial)} className="px-4 py-2.5 rounded-2xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>元に戻す</button>
          <button onClick={copy} className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1.5" style={{ background: copied ? "var(--color-success)" : "var(--color-brand)" }}>
            {copied ? <><Check size={14} />コピーしました</> : <><Copy size={14} />テキストをコピーする</>}
          </button>
        </div>
      </div>
    </div>
  );
}
