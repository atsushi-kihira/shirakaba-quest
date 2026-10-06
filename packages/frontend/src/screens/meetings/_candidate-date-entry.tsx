// =============================================================
// 「候補日提示」方式の候補日時入力（2〜5件）
// カレンダー連携済みなら自分の予定を見ながら選べるトグルを提供し（定例会の確定日入力と同じパターン）、
// 未連携の場合は手入力のみを表示する。メンバー向け・外部ゲスト招待向けの両方から共通で使う。
// =============================================================
import { useState } from "react";
import { Plus, Trash2, CalendarDays, Pencil, GripVertical } from "lucide-react";
import { MeetingCandidatePicker } from "./_meeting-candidate-picker";
import { useDragReorder } from "@/hooks/use-drag-reorder";
import { DropInsertionLine } from "@/components/drop-insertion-line";
import { DEFAULT_START_TIME, defaultEndTime, shiftEndWithStart } from "@/lib/meeting-time";

export type CandidateRow = { id: string; date: string; time: string; endTime: string };

export const MIN_ONEONONE_CANDIDATES = 2;
export const MAX_ONEONONE_CANDIDATES = 5;

export function emptyCandidateRow(): CandidateRow {
  return { id: crypto.randomUUID(), date: "", time: DEFAULT_START_TIME, endTime: defaultEndTime(30) };
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 送信前バリデーション: 入力済みの行が2〜5件、各行の終了>開始、重複なし */
export function isValidCandidateSet(rows: CandidateRow[]): boolean {
  const filled = rows.filter((r) => r.date && r.time && r.endTime);
  if (filled.length < MIN_ONEONONE_CANDIDATES || filled.length > MAX_ONEONONE_CANDIDATES) return false;
  if (filled.some((r) => r.time >= r.endTime)) return false;
  const keys = new Set(filled.map((r) => `${r.date}T${r.time}-${r.endTime}`));
  return keys.size === filled.length;
}

export function candidateRowsToPayload(rows: CandidateRow[]): { startAtUtc: string; endAtUtc: string }[] {
  return rows
    .filter((r) => r.date && r.time && r.endTime)
    .map((r) => ({
      startAtUtc: new Date(`${r.date}T${r.time}:00+09:00`).toISOString(),
      endAtUtc: new Date(`${r.date}T${r.endTime}:00+09:00`).toISOString(),
    }));
}

export function CandidateDateEntry({
  candidates,
  onChange,
  googleConnected,
}: {
  candidates: CandidateRow[];
  onChange: (rows: CandidateRow[]) => void;
  googleConnected: boolean;
}) {
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);

  function addRow() {
    if (candidates.length >= MAX_ONEONONE_CANDIDATES) return;
    onChange([...candidates, emptyCandidateRow()]);
  }
  function removeRow(i: number) {
    if (candidates.length <= MIN_ONEONONE_CANDIDATES) return;
    onChange(candidates.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, field: keyof CandidateRow, value: string) {
    onChange(candidates.map((r, idx) => {
      if (idx !== i) return r;
      // 開始時刻を変えたら、所要時間を保ったまま終了時刻も追従させる
      if (field === "time") return { ...r, time: value, endTime: shiftEndWithStart(r.time, r.endTime, value) };
      return { ...r, [field]: value };
    }));
  }
  // カレンダー上のドラッグ/クリックで選んだ範囲を候補として追加する（空行があればそこに詰める）
  function addCalendarRow(date: string, startTime: string, endTime: string) {
    if (candidates.filter((r) => r.date).length >= MAX_ONEONONE_CANDIDATES) return;
    const newRow: CandidateRow = { id: crypto.randomUUID(), date, time: startTime, endTime };
    const emptyIdx = candidates.findIndex((r) => !r.date);
    if (emptyIdx >= 0) {
      onChange(candidates.map((r, i) => (i === emptyIdx ? newRow : r)));
    } else {
      onChange([...candidates, newRow]);
    }
  }

  const drag = useDragReorder(candidates, onChange);

  return (
    <div className="rounded-2xl p-3.5" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <span className="text-xs font-semibold" style={{ color: "var(--color-ink-700)" }}>
          候補日時を入力する（{MIN_ONEONONE_CANDIDATES}〜{MAX_ONEONONE_CANDIDATES}件）
        </span>
        {googleConnected && (
          <button
            type="button"
            onClick={() => setShowCalendarPicker((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0"
            style={{ background: showCalendarPicker ? "var(--color-brand)" : "var(--color-paper-200)", color: showCalendarPicker ? "white" : "var(--color-ink-600)" }}
          >
            {showCalendarPicker ? <Pencil size={11} /> : <CalendarDays size={11} />}
            {showCalendarPicker ? "手入力に切り替え" : "カレンダーから選ぶ"}
          </button>
        )}
      </div>

      {showCalendarPicker && googleConnected && (
        <div className="mb-3">
          <MeetingCandidatePicker
            candidates={candidates}
            onAdd={addCalendarRow}
            onRemove={removeRow}
            maxReached={candidates.filter((r) => r.date).length >= MAX_ONEONONE_CANDIDATES}
          />
        </div>
      )}

      <div className="space-y-2" data-drag-list>
        {(() => {
          const draggingIndex = candidates.findIndex((r) => r.id === drag.dragId);
          return candidates.map((row, i) => (
            <div key={row.id}>
              <DropInsertionLine show={drag.dragId !== null && drag.gapIndex === i && i !== draggingIndex && i !== draggingIndex + 1} />
              <div
                ref={(el) => drag.registerRow(row.id, el)}
                data-drag-row
                className="flex items-center gap-1.5"
                style={{
                  position: "relative",
                  opacity: drag.dragId === row.id ? 0.9 : 1,
                  zIndex: drag.dragId === row.id ? 10 : undefined,
                  transform: drag.dragId === row.id ? `translateY(${drag.dragOffsetY}px) scale(1.02)` : undefined,
                }}
              >
                <span
                  onPointerDown={(e) => drag.handlePointerDown(row.id, e)}
                  onPointerMove={drag.handlePointerMove}
                  onPointerUp={drag.handlePointerUp}
                  onPointerCancel={drag.handlePointerUp}
                  className="p-2 -ml-1.5 touch-none cursor-grab active:cursor-grabbing shrink-0"
                  style={{ color: "var(--color-ink-300)" }}
                  aria-label="並び替え"
                >
                  <GripVertical size={14} />
                </span>
                <input
                  type="date"
                  value={row.date}
                  min={todayDateStr()}
                  onChange={(e) => updateRow(i, "date", e.target.value)}
                  className="flex-1 min-w-0 px-2.5 py-2 rounded-xl text-xs outline-none border"
                  style={{ background: "#fff", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                />
                <input
                  type="time"
                  value={row.time}
                  onChange={(e) => updateRow(i, "time", e.target.value)}
                  className="w-[88px] px-2 py-2 rounded-xl text-xs outline-none border text-center"
                  style={{ background: "#fff", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                />
                <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>〜</span>
                <input
                  type="time"
                  value={row.endTime}
                  onChange={(e) => updateRow(i, "endTime", e.target.value)}
                  className="w-[88px] px-2 py-2 rounded-xl text-xs outline-none border text-center"
                  style={{ background: "#fff", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={candidates.length <= MIN_ONEONONE_CANDIDATES}
                  className="p-1.5 rounded-lg disabled:opacity-30 shrink-0"
                  style={{ color: "var(--color-ink-400)" }}
                  aria-label="この候補を削除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ));
        })()}
        <DropInsertionLine show={drag.dragId !== null && drag.gapIndex === candidates.length && candidates.findIndex((r) => r.id === drag.dragId) !== candidates.length - 1} />
      </div>

      <button
        type="button"
        onClick={addRow}
        disabled={candidates.length >= MAX_ONEONONE_CANDIDATES}
        className="mt-2.5 flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full disabled:opacity-40"
        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
      >
        <Plus size={12} />
        候補を追加（{candidates.length}/{MAX_ONEONONE_CANDIDATES}）
      </button>
    </div>
  );
}
