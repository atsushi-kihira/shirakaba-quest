// =============================================================
// 「候補日提示」方式の1to1で、相手（responder）が申込者の提示した候補から1つを選ぶパネル。
// 選択＝承諾を意味する（公開予約URL経由の確定と同様の扱い）。
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateTimeFull, fmtTime } from "@/lib/date";
import { AvailabilityNotice, SlotAvailabilityNote, useAvailabilityForSlots } from "@/components/candidate-availability";

export type CandidateSlot = { id: string; startAt: number; endAt: number };
export type ConferenceType = "google_meet" | "zoom";

export function CandidateSelectionPanel({
  sessionId,
  candidates,
  availableConferenceTypes = [],
  onConfirmed,
}: {
  sessionId: string;
  candidates: CandidateSlot[];
  availableConferenceTypes?: ConferenceType[];
  onConfirmed: () => void;
}) {
  const tz = useTimezone();
  // 提示された候補が、自分のカレンダーで空いているか確認できるようにする
  const availability = useAvailabilityForSlots(candidates);
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.id ?? "");
  const [error, setError] = useState("");
  // 2種類連携されている場合、何も選ばずに送信すると先頭固定の候補が黙って選ばれてしまうため、
  // 明示的にZoomを優先した既定値を使う（表示上も選択済みにする）
  const defaultConferenceType = availableConferenceTypes.includes("zoom") ? "zoom" : availableConferenceTypes[0];
  const [conferenceType, setConferenceType] = useState<ConferenceType | undefined>(undefined);

  const confirmMutation = useMutation({
    mutationFn: () => api.patch(`/oneonone/${sessionId}/select-candidate`, {
      candidateSlotId: selectedId,
      conferenceType: availableConferenceTypes.length >= 2 ? (conferenceType ?? defaultConferenceType) : undefined,
    }),
    onSuccess: onConfirmed,
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  if (candidates.length === 0) return null;

  return (
    <div className="mt-2.5 p-3 rounded-2xl" style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.2)" }}>
      <p className="text-xs font-medium mb-2" style={{ color: "var(--color-success)" }}>
        🗓 提示された候補から、ご都合の良い日時をお選びください
      </p>
      <AvailabilityNotice loggedIn={availability.loggedIn} isLoading={availability.isLoading} connected={availability.connected} />
      <div className="space-y-1.5 mb-2.5">
        {candidates.map((c) => {
          const selected = c.id === selectedId;
          return (
            <label
              key={c.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition"
              style={{
                border: selected ? "1.5px solid var(--color-brand)" : "1.5px solid var(--color-paper-300)",
                background: "#fff",
              }}
            >
              <input type="radio" checked={selected} onChange={() => setSelectedId(c.id)} className="sr-only" />
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0"
                style={{ border: selected ? "4px solid var(--color-brand)" : "2px solid var(--color-paper-300)" }}
              />
              <span className="flex flex-col min-w-0">
                <span className="text-sm" style={{ color: "var(--color-ink-800)", fontWeight: selected ? 700 : 400 }}>
                  {fmtDateTimeFull(c.startAt, tz)}〜{fmtTime(c.endAt, tz)}
                </span>
                <SlotAvailabilityNote availability={availability.byId.get(c.id)} />
              </span>
            </label>
          );
        })}
      </div>

      {/* 会議ツール選択（2種類連携時のみ、選ぶ側が選択する） */}
      {availableConferenceTypes.length >= 2 && (
        <div className="mb-2.5">
          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>会議ツール</p>
          <div className="space-y-1.5">
            {availableConferenceTypes.map((t) => (
              <label key={t} className="flex items-center gap-2.5 cursor-pointer">
                <input type="radio" name={`conferenceType-${sessionId}`} checked={(conferenceType ?? defaultConferenceType) === t} onChange={() => setConferenceType(t)} />
                <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
                  {t === "google_meet" ? "📹 Google Meet" : "📹 Zoom"}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      {availableConferenceTypes.length === 1 && (
        <p className="text-xs mb-2.5" style={{ color: "var(--color-ink-500)" }}>
          📹 {availableConferenceTypes[0] === "google_meet" ? "Google Meet" : "Zoom"} のURLが自動発行されます
        </p>
      )}
      {availableConferenceTypes.length === 0 && (
        <p className="text-xs mb-2.5" style={{ color: "var(--color-ink-500)" }}>
          📞 会議URLは主催者から別途ご連絡します
        </p>
      )}

      {error && (
        <p className="text-xs mb-2 px-2.5 py-1.5 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
          {error}
        </p>
      )}

      <button
        onClick={() => { setError(""); confirmMutation.mutate(); }}
        disabled={confirmMutation.isPending || !selectedId}
        className="w-full py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: "var(--color-brand)" }}
      >
        {confirmMutation.isPending && <Loader2 size={14} className="animate-spin" />}
        この日時で確定する
      </button>
    </div>
  );
}
