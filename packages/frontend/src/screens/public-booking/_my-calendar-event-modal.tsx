// =============================================================
// 公開予約ページで、ログイン中のメンバーが「自分の予定」を
// その場で作成・編集・削除するためのモーダル
// （相手のカレンダーと見比べながら、自分の予定を動かして空き時間を作れるようにする）
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Loader2, CalendarClock, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { MyEvent } from "@/components/unified-calendar-grid";

export type MyCalendarOption = { id: string; summary: string };

function toLocalDateInput(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function toLocalTimeInput(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function roundToNextHour(d: Date): Date {
  const rounded = new Date(d);
  rounded.setMinutes(0, 0, 0);
  rounded.setHours(rounded.getHours() + 1);
  return rounded;
}

// 終日予定のUTC文字列（"YYYY-MM-DDT00:00:00.000Z"）から日付部分だけを取り出す。
// 終日予定はタイムゾーンを持たない日付そのものなので、JST変換を経由せず直接切り出す。
function toUtcDateStr(iso: string): string {
  return iso.slice(0, 10);
}

function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

type Props = {
  calendars: MyCalendarOption[];
  initial?: MyEvent | null;
  defaultStart?: Date;
  onClose: () => void;
  onSaved: () => void;
};

export function MyEventModal({ calendars, initial, defaultStart, onClose, onSaved }: Props) {
  const isEdit = !!initial;
  const isAllDay = initial?.allDay ?? false;
  const [calendarId, setCalendarId] = useState(initial?.calendarId ?? calendars[0]?.id ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  const initialStart = initial ? new Date(initial.startUtc) : roundToNextHour(defaultStart ?? new Date());
  const initialEnd = initial ? new Date(initial.endUtc) : new Date(initialStart.getTime() + 60 * 60_000);

  // 終日予定はGoogle側で終了日が「翌日」扱い（排他的）のため、画面上は最終日（1日前）を表示・編集し、
  // 保存時に翌日へ戻して送信する。時間指定の予定は従来通りJST変換した日付・時刻を使う。
  const [startDate, setStartDate] = useState(isAllDay && initial ? toUtcDateStr(initial.startUtc) : toLocalDateInput(initialStart));
  const [startTime, setStartTime] = useState(toLocalTimeInput(initialStart));
  const [endDate, setEndDate] = useState(isAllDay && initial ? shiftDateStr(toUtcDateStr(initial.endUtc), -1) : toLocalDateInput(initialEnd));
  const [endTime, setEndTime] = useState(toLocalTimeInput(initialEnd));
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body = isAllDay
        ? {
            calendarId, summary: summary.trim(), allDay: true,
            startDate, endDate: shiftDateStr(endDate, 1),
            location: location.trim(), description: description.trim(),
          }
        : {
            calendarId, summary: summary.trim(),
            startUtc: new Date(`${startDate}T${startTime}:00+09:00`).toISOString(),
            endUtc: new Date(`${endDate}T${endTime}:00+09:00`).toISOString(),
            location: location.trim(), description: description.trim(),
          };
      return isEdit
        ? api.patch(`/scheduler/me/calendar-events/${initial!.id}`, body)
        : api.post("/scheduler/me/calendar-events", body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "保存に失敗しました"),
  });

  const remove = useMutation({
    mutationFn: () =>
      api.delete(`/scheduler/me/calendar-events/${initial!.id}?calendarId=${encodeURIComponent(initial!.calendarId)}`),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "削除に失敗しました"),
  });

  function handleSave() {
    setError("");
    if (!summary.trim()) { setError("タイトルを入力してください"); return; }
    if (!calendarId) { setError("カレンダーを選択してください"); return; }
    if (isAllDay) {
      if (endDate < startDate) { setError("終了日は開始日以降にしてください"); return; }
    } else {
      const startMs = new Date(`${startDate}T${startTime}:00+09:00`).getTime();
      const endMs = new Date(`${endDate}T${endTime}:00+09:00`).getTime();
      if (endMs <= startMs) { setError("終了日時は開始日時より後にしてください"); return; }
    }
    save.mutate();
  }

  const busy = save.isPending || remove.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold flex items-center gap-1.5" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            <CalendarClock size={18} />
            {isEdit ? "自分の予定を編集" : "自分の予定を追加"}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: "var(--color-ink-400)" }}>
            <X size={18} />
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          あなた自身のGoogleカレンダーの予定です。ここでの変更はそのままGoogleカレンダーに反映されます。
          {isAllDay && "（終日の予定のため、時刻は指定できません）"}
        </p>

        <div className="space-y-3">
          {calendars.length > 1 && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>カレンダー</label>
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              >
                {calendars.map((cal) => <option key={cal.id} value={cal.id}>{cal.summary}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>タイトル</label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="例: 社内定例"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>開始{isAllDay && "日"}</label>
            <div className={isAllDay ? "" : "grid grid-cols-2 gap-2"}>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              {!isAllDay && (
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                  style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>終了{isAllDay && "日"}</label>
            <div className={isAllDay ? "" : "grid grid-cols-2 gap-2"}>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              {!isAllDay && (
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                  style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>場所（任意）</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例: 会議室A"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メモ（任意）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="補足事項があれば入力"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border resize-none"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
          </div>

          {error && (
            <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
              {error}
            </p>
          )}

          <div className="flex gap-2">
            {isEdit && (
              <button
                onClick={() => { setError(""); if (confirm("この予定を削除しますか？")) remove.mutate(); }}
                disabled={busy}
                className="p-3 rounded-2xl disabled:opacity-50"
                style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}
                aria-label="削除"
              >
                {remove.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={busy}
              className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "var(--color-brand)" }}
            >
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
              保存する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
