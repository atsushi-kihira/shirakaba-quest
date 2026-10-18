// =============================================================
// 定例会：今後の各回の会議URLをまとめて設定するダイアログ（主催者用・URLの手入力）
//  ・全回で同じURL ／ 日ごとに別のURL（URLを入力した回だけ変更）
//  ・変更を保存すると、関係者には1通のメールにまとめて知らせる（URLを変えるたびにメールは送らない）
// =============================================================
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTimezone } from "@/hooks/use-timezone";
import { formatRangeText } from "@/lib/schedule-text";

export type SeriesUrlOccurrence = { id: string; startsAt: number; endsAt: number | null; conferenceUrl: string | null; seriesOccurrenceIndex: number | null };
export type SeriesUrlPayload = { mode: "same"; url: string } | { mode: "per_day"; urls: Record<string, string> };

export function SeriesConferenceUrlsModal({ occurrences, pending, error, onClose, onSubmit }: {
  occurrences: SeriesUrlOccurrence[]; pending: boolean; error: string | null; onClose: () => void; onSubmit: (p: SeriesUrlPayload) => void;
}) {
  const tz = useTimezone();
  const [mode, setMode] = useState<"same" | "per_day">("same");
  const [sameUrl, setSameUrl] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>(() => Object.fromEntries(occurrences.map((o) => [o.id, o.conferenceUrl ?? ""])));
  const isUrl = (u: string) => /^https?:\/\//.test(u.trim());
  // 日ごとの場合は、いまのURLから変更した（または新しく入力した）回だけを送る
  const changed = occurrences.filter((o) => (urls[o.id] ?? "").trim() !== (o.conferenceUrl ?? "").trim() && (urls[o.id] ?? "").trim() !== "");
  const ready = mode === "same" ? isUrl(sameUrl) : changed.length > 0 && changed.every((o) => isUrl(urls[o.id]));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(26,20,16,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}>
      <div className="card-paper rounded-3xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <p className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>📹 会議URLをまとめて設定</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            今後の開催回（{occurrences.length}回）の会議URLを設定します。変更の通知メールは<strong>1通にまとめて</strong>お送りします。
          </p>
        </div>
        <div className="grid gap-1.5">
          {([["same", "今後の全回で同じURLを使う"], ["per_day", "日ごとに別のURLを設定する"]] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)} className="px-4 py-2 rounded-2xl text-sm font-medium text-left flex items-center gap-2"
              style={{ background: mode === m ? "rgba(90,140,92,0.15)" : "var(--color-paper-200)", color: mode === m ? "var(--color-success)" : "var(--color-ink-700)", border: mode === m ? "1.5px solid rgba(90,140,92,0.4)" : "1.5px solid transparent" }}>
              {label}{mode === m && <Check size={14} className="ml-auto" />}
            </button>
          ))}
        </div>
        {mode === "same" ? (
          <input type="url" placeholder="https://..." value={sameUrl} onChange={(e) => setSameUrl(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm border" style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
        ) : (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>URLを入れた（変えた）回だけが更新されます。</p>
            {occurrences.map((o) => (
              <div key={o.id}>
                <p className="text-xs mb-0.5" style={{ color: "var(--color-ink-600)" }}>第{o.seriesOccurrenceIndex}回・{formatRangeText(o.startsAt, o.endsAt, tz)}</p>
                <input type="url" placeholder="https://..." value={urls[o.id] ?? ""} onChange={(e) => setUrls((p) => ({ ...p, [o.id]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm border" style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={pending} className="flex-1 py-2.5 rounded-2xl text-sm border disabled:opacity-50" style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => onSubmit(mode === "same" ? { mode, url: sameUrl.trim() } : { mode, urls: Object.fromEntries(changed.map((o) => [o.id, urls[o.id].trim()])) })}
            disabled={!ready || pending} className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50" style={{ background: "var(--color-success)" }}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : mode === "same" ? "全回に設定する" : `${changed.length}回分を設定する`}
          </button>
        </div>
      </div>
    </div>
  );
}
