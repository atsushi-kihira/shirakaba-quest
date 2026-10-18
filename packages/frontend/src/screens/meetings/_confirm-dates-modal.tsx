// =============================================================
// 候補日を「まとめて確定」するダイアログ（通常ミーティング・主催者用）
//  ・確定する日を複数選べる（最初にタップした日があらかじめ選ばれている）
//  ・会議URLは、なし／全日程で同じURL／日ごとに別のURL から選ぶ。まとめて設定できる
//  ・関係者への通知メールは、確定した全日程と会議URLを1通にまとめて送られる
// =============================================================
import { useState } from "react";
import { Check, ExternalLink, Loader2, Video } from "lucide-react";
import { useTimezone } from "@/hooks/use-timezone";
import { formatRangeText } from "@/lib/schedule-text";

export type ConfirmCandidate = { id: string; startsAt: number; endsAt: number | null };
type UrlMode = "none" | "same" | "per_day";
type UrlType = "manual" | "zoom" | "google_meet";
export type ConfirmBulkPayload = {
  candidateIds: string[];
  conference: { mode: UrlMode; type?: UrlType; url?: string; urls?: Record<string, string> };
};

const pill = (active: boolean) => ({
  background: active ? "rgba(90,140,92,0.15)" : "var(--color-paper-200)",
  color: active ? "var(--color-success)" : "var(--color-ink-700)",
  border: active ? "1.5px solid rgba(90,140,92,0.4)" : "1.5px solid transparent",
});

export function ConfirmDatesModal({ candidates, initialSelectedId, availableConferenceTypes, pending, error, onClose, onSubmit }: {
  candidates: ConfirmCandidate[]; initialSelectedId: string; availableConferenceTypes: ("google_meet" | "zoom")[];
  pending: boolean; error: string | null; onClose: () => void; onSubmit: (payload: ConfirmBulkPayload) => void;
}) {
  const tz = useTimezone();
  const [selected, setSelected] = useState<Set<string>>(new Set([initialSelectedId]));
  const [mode, setMode] = useState<UrlMode>("none");
  const [type, setType] = useState<UrlType>("manual");
  const [sameUrl, setSameUrl] = useState("");
  const [perDayUrls, setPerDayUrls] = useState<Record<string, string>>({});

  const chosen = candidates.filter((c) => selected.has(c.id)).sort((a, b) => a.startsAt - b.startsAt);
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const canMeet = availableConferenceTypes.includes("google_meet");
  const canZoom = availableConferenceTypes.includes("zoom");

  // 日ごとに別のURLにする場合、Zoomは選べない（Zoomは1つのURLを全日程で使う）
  const effectiveType: UrlType = mode === "per_day" && type === "zoom" ? "manual" : type;
  const isUrl = (u: string) => /^https?:\/\//.test(u.trim());
  const urlReady =
    mode === "none" ? true
    : mode === "same" ? (effectiveType !== "manual" || isUrl(sameUrl))
    : effectiveType === "google_meet" ? true
    : chosen.every((c) => isUrl(perDayUrls[c.id] ?? ""));
  const canSubmit = chosen.length > 0 && urlReady && !pending;

  function submit() {
    const conference: ConfirmBulkPayload["conference"] =
      mode === "none" ? { mode }
      : mode === "same" ? { mode, type: effectiveType, url: effectiveType === "manual" ? sameUrl.trim() : undefined }
      : { mode, type: effectiveType, urls: effectiveType === "manual" ? Object.fromEntries(chosen.map((c) => [c.id, (perDayUrls[c.id] ?? "").trim()])) : undefined };
    onSubmit({ candidateIds: chosen.map((c) => c.id), conference });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(26,20,16,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}>
      <div className="card-paper rounded-3xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <p className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>📅 日程を確定する</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            複数の日を選んでまとめて確定できます。関係者へのメールは、確定した全日程と会議URLを<strong>1通にまとめて</strong>お送りします。
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>確定する日程（{chosen.length}日程を選択中）</p>
            <button type="button" onClick={() => setSelected(selected.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.id)))}
              className="ml-auto text-xs underline" style={{ color: "var(--color-ink-500)" }}>
              {selected.size === candidates.length ? "すべて外す" : "すべて選ぶ"}
            </button>
          </div>
          <div className="space-y-1.5">
            {candidates.map((c) => (
              <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer text-sm"
                style={{ background: selected.has(c.id) ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)", color: "var(--color-ink-800)" }}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="w-4 h-4 shrink-0" style={{ accentColor: "var(--color-success)" }} />
                {formatRangeText(c.startsAt, c.endsAt, tz)}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>📹 会議URL</p>
          <div className="grid grid-cols-1 gap-1.5 mb-2">
            {([
              ["none", "URLは設定しない（あとで設定する）"],
              ["same", "全日程で同じURLを使う"],
              ["per_day", "日ごとに別のURLを使う"],
            ] as [UrlMode, string][]).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setMode(m)} className="px-4 py-2 rounded-2xl text-sm font-medium text-left flex items-center gap-2" style={pill(mode === m)}>
                {label}{mode === m && <Check size={14} className="ml-auto" />}
              </button>
            ))}
          </div>

          {mode !== "none" && (
            <div className="space-y-2 pl-1">
              <div className="flex flex-wrap gap-1.5">
                {canMeet && (
                  <button type="button" onClick={() => setType("google_meet")} className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1" style={pill(effectiveType === "google_meet")}>
                    <Video size={12} />Google Meetを発行
                  </button>
                )}
                {canZoom && mode === "same" && (
                  <button type="button" onClick={() => setType("zoom")} className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1" style={pill(effectiveType === "zoom")}>
                    <Video size={12} />Zoomを発行
                  </button>
                )}
                <button type="button" onClick={() => setType("manual")} className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1" style={pill(effectiveType === "manual")}>
                  <ExternalLink size={12} />URLを手入力
                </button>
              </div>
              {mode === "same" && effectiveType !== "manual" && (
                <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                  {effectiveType === "zoom" ? "Zoomの参加URLを1つ発行し、確定した全日程で同じURLを使います。" : "Google MeetのURLを1つ発行し、確定した全日程で同じURLを使います。"}
                </p>
              )}
              {mode === "same" && effectiveType === "manual" && (
                <input type="url" placeholder="https://..." value={sameUrl} onChange={(e) => setSameUrl(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm border" style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
              )}
              {mode === "per_day" && effectiveType === "google_meet" && (
                <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>確定した日ごとに、別々のGoogle Meet URLを発行します。</p>
              )}
              {mode === "per_day" && effectiveType === "manual" && (
                <div className="space-y-1.5">
                  {chosen.length === 0 && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>先に確定する日程を選んでください。</p>}
                  {chosen.map((c) => (
                    <div key={c.id}>
                      <p className="text-xs mb-0.5" style={{ color: "var(--color-ink-600)" }}>{formatRangeText(c.startsAt, c.endsAt, tz)}</p>
                      <input type="url" placeholder="https://..." value={perDayUrls[c.id] ?? ""} onChange={(e) => setPerDayUrls((p) => ({ ...p, [c.id]: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl text-sm border" style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
                    </div>
                  ))}
                </div>
              )}
              {mode === "per_day" && canZoom && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>※ Zoomは、全日程で同じURLを使う場合のみ発行できます。</p>}
            </div>
          )}
        </div>

        {error && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={pending} className="flex-1 py-2.5 rounded-2xl text-sm border disabled:opacity-50" style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button onClick={submit} disabled={!canSubmit} className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50" style={{ background: "var(--color-success)" }}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : `${chosen.length}日程を確定する`}
          </button>
        </div>
      </div>
    </div>
  );
}
