// =============================================================
// 定例会（繰り返しミーティング）新規作成画面
// 曜日・時刻の候補パターンを複数提示し、参加者の投票で1つに確定する。
// =============================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, ChevronLeft, CalendarDays, Pencil, GripVertical } from "lucide-react";
import { api } from "@/lib/api";
import { useDragReorder } from "@/hooks/use-drag-reorder";
import { DropInsertionLine } from "@/components/drop-insertion-line";
import { MeetingCandidatePicker } from "./_meeting-candidate-picker";
import { ConferenceModeSelector, type ConferenceMode } from "./_conference-mode-selector";
import { DEFAULT_START_TIME, addMinutesToTime } from "@/lib/meeting-time";
import { DurationSelect } from "@/components/duration-select";
import { MeetingEventSelector, selectionToPayload } from "@/components/meeting-event-selector";

type CollabTeam = { id: string; name: string; type: "loose" | "power"; memberCount: number };
type Team = { id: string; name: string; emblemEmoji: string };
type Member = { id: string; name: string; emoji: string; bgColor: string };

type RecurrenceType = "weekly" | "biweekly" | "monthly";
type PatternCandidate = {
  recurrenceType: RecurrenceType;
  dayOfWeek: number;
  weekOfMonth: number; // monthlyのみ使用
  startTimeLocal: string;
  endTimeLocal: string;
  note: string;
};

type FixedDateRow = { id: string; date: string; time: string; endTime: string };

const DOW_OPTIONS = ["日", "月", "火", "水", "木", "金", "土"];
const WEEK_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "第1" }, { value: 2, label: "第2" }, { value: 3, label: "第3" },
  { value: 4, label: "第4" }, { value: 5, label: "第5" }, { value: -1, label: "最終" },
];
const MAX_CANDIDATES = 5;
const MAX_FIXED_DATES = 50;

function emptyCandidate(durationMinutes = 60): PatternCandidate {
  return { recurrenceType: "weekly", dayOfWeek: 2, weekOfMonth: 1, startTimeLocal: DEFAULT_START_TIME, endTimeLocal: addMinutesToTime(DEFAULT_START_TIME, durationMinutes), note: "" };
}

function emptyFixedDateRow(durationMinutes = 60): FixedDateRow {
  return { id: crypto.randomUUID(), date: "", time: DEFAULT_START_TIME, endTime: addMinutesToTime(DEFAULT_START_TIME, durationMinutes) };
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toUnixTimestamp(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000);
}

export function MeetingSeriesNewScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"all" | "team" | "collab_team" | "selected">("collab_team");
  const [teamId, setTeamId] = useState("");
  const [collabTeamId, setCollabTeamId] = useState("");
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<PatternCandidate[]>([emptyCandidate()]);
  const [deadline, setDeadline] = useState("");
  const [endCondition, setEndCondition] = useState<"count" | "date">("count");
  const [occurrenceCount, setOccurrenceCount] = useState("12");
  const [endDate, setEndDate] = useState("");
  const [conferenceMode, setConferenceMode] = useState<ConferenceMode>("none");
  const [conferenceUrl, setConferenceUrl] = useState("");
  // 所要時間はすべての候補日時で共通。候補日時は開始日時だけを指定する（終了は開始＋所要時間）
  const [duration, setDuration] = useState(60);
  const [eventSelection, setEventSelection] = useState(""); // "type:<ID>"（ポイントなしの種別）または "event:<ID>"（イベント）
  const [seriesMode, setSeriesMode] = useState<"vote" | "confirmed">("vote");
  const [dateMode, setDateMode] = useState<"recurring" | "fixed">("recurring");
  const [fixedDates, setFixedDates] = useState<FixedDateRow[]>([emptyFixedDateRow()]);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [error, setError] = useState("");

  const { data: collabTeamsData } = useQuery({
    queryKey: ["collab", "my-teams"],
    queryFn: () => api.get<{ data: CollabTeam[] }>("/collab/my-teams"),
    enabled: scope === "collab_team",
  });
  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.get<{ data: Team[] }>("/teams"),
    enabled: scope === "team",
  });
  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<{ data: Member[] }>("/members"),
    enabled: scope === "selected",
  });
  const { data: confTypesData } = useQuery({
    queryKey: ["meeting-series", "conference-types"],
    queryFn: () => api.get<{ data: ("google_meet" | "zoom")[] }>("/meeting-series/conference-types"),
  });
  const availableConferenceTypes = confTypesData?.data ?? [];
  const zoomConnected = availableConferenceTypes.includes("zoom");
  const googleConnected = availableConferenceTypes.includes("google_meet");

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<{ data: { id: string } }>("/meeting-series", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["meeting-series"] });
      navigate(`/meetings/series/${res.data.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function addCandidate() {
    if (candidates.length >= MAX_CANDIDATES) return;
    setCandidates([...candidates, emptyCandidate(duration)]);
  }
  function removeCandidate(i: number) {
    setCandidates(candidates.filter((_, idx) => idx !== i));
  }
  function updateCandidate<K extends keyof PatternCandidate>(i: number, field: K, value: PatternCandidate[K]) {
    setCandidates(candidates.map((c, idx) => {
      if (idx !== i) return c;
      // 終了時刻は入力させない。開始時刻と共通の所要時間から決まる
      if (field === "startTimeLocal") {
        return { ...c, startTimeLocal: value as string, endTimeLocal: addMinutesToTime(value as string, duration) };
      }
      return { ...c, [field]: value };
    }));
  }
  function toggleInvitee(id: string) {
    setInviteeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function addFixedDate() {
    if (fixedDates.length >= MAX_FIXED_DATES) return;
    setFixedDates([...fixedDates, emptyFixedDateRow(duration)]);
  }
  function removeFixedDate(i: number) {
    setFixedDates(fixedDates.filter((_, idx) => idx !== i));
  }
  const fixedDateDrag = useDragReorder(fixedDates, setFixedDates);
  function updateFixedDate(i: number, field: keyof FixedDateRow, value: string) {
    setFixedDates(fixedDates.map((d, idx) => {
      if (idx !== i) return d;
      // 終了時刻は入力させない。開始時刻と共通の所要時間から決まる
      if (field === "time") return { ...d, time: value, endTime: addMinutesToTime(value, duration) };
      return { ...d, [field]: value };
    }));
  }
  // カレンダー上でクリックした開始時刻を、共通の所要時間の確定日として追加する
  function addCalendarFixedDate(date: string, startTime: string) {
    if (fixedDates.filter((d) => d.date).length >= MAX_FIXED_DATES) return;
    const newRow: FixedDateRow = { id: crypto.randomUUID(), date, time: startTime, endTime: addMinutesToTime(startTime, duration) };
    const emptyIdx = fixedDates.findIndex((d) => !d.date);
    if (emptyIdx >= 0) {
      setFixedDates(fixedDates.map((d, i) => (i === emptyIdx ? newRow : d)));
    } else if (fixedDates.length < MAX_FIXED_DATES) {
      setFixedDates([...fixedDates, newRow]);
    }
  }

  function handleSubmit() {
    setError("");
    if (!eventSelection) { setError("イベント種別を選んでください"); return; }
    if (!title.trim()) { setError("タイトルを入力してください"); return; }
    if (scope === "team" && !teamId) { setError("ギルドを選択してください"); return; }
    if (scope === "collab_team" && !collabTeamId) { setError("対象チームを選択してください"); return; }
    if (scope === "selected" && inviteeIds.length === 0) { setError("招待するメンバーを1人以上選んでください"); return; }
    if (conferenceMode === "manual" && !conferenceUrl.trim()) { setError("会議URLを入力してください"); return; }

    const body: Record<string, unknown> = {
      title: title.trim(),
      ...selectionToPayload(eventSelection),
      description: description.trim() || undefined,
      scope,
      teamId: scope === "team" ? teamId : undefined,
      collabTeamId: scope === "collab_team" ? collabTeamId : undefined,
      inviteeIds: scope === "selected" ? inviteeIds : undefined,
      deadline: seriesMode === "vote" && deadline ? Math.floor(new Date(deadline).getTime() / 1000) : undefined,
      mode: seriesMode,
      conferenceType: conferenceMode !== "none" ? conferenceMode : undefined,
      conferenceUrl: conferenceMode === "manual" ? conferenceUrl.trim() : undefined,
    };

    if (seriesMode === "confirmed" && dateMode === "fixed") {
      const validDates = fixedDates.filter((d) => d.date);
      if (validDates.length === 0) { setError("確定日を1つ以上設定してください"); return; }
      body.dateMode = "fixed";
      body.fixedDates = validDates.map((d) => ({
        startsAt: toUnixTimestamp(d.date, d.time),
        endsAt: toUnixTimestamp(d.date, d.time) + duration * 60,
      }));
    } else {
      const activeCandidates = seriesMode === "confirmed" ? candidates.slice(0, 1) : candidates;
      for (const c of activeCandidates) {
        if (c.startTimeLocal >= c.endTimeLocal) { setError("終了時刻は開始時刻より後にしてください"); return; }
      }
      if (endCondition === "count") {
        const n = Number(occurrenceCount);
        if (!n || n < 1 || n > 200) { setError("開催回数は1〜200回で指定してください"); return; }
      } else if (!endDate) {
        setError("終了日を指定してください"); return;
      }
      body.dateMode = "recurring";
      body.endCondition = endCondition;
      body.occurrenceCount = endCondition === "count" ? Number(occurrenceCount) : undefined;
      body.endDate = endCondition === "date" ? Math.floor(new Date(`${endDate}T23:59:59`).getTime() / 1000) : undefined;
      body.candidates = activeCandidates.map((c) => ({
        recurrenceType: c.recurrenceType,
        dayOfWeek: c.dayOfWeek,
        weekOfMonth: c.recurrenceType === "monthly" ? c.weekOfMonth : undefined,
        startTimeLocal: c.startTimeLocal,
        endTimeLocal: addMinutesToTime(c.startTimeLocal, duration),
        note: c.note.trim() || undefined,
      }));
    }

    createMutation.mutate(body);
  }

  const collabTeams = collabTeamsData?.data ?? [];
  const teams = teamsData?.data ?? [];
  const members = membersData?.data ?? [];

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70"
          style={{ background: "var(--color-paper-200)" }}>
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🔁 定例会を立てる
        </h1>
      </div>
      <p className="text-xs mb-5" style={{ color: "var(--color-ink-500)" }}>
        {seriesMode === "vote"
          ? "「毎週火曜19:00〜20:00」のような繰り返しパターンを複数候補で提示し、参加者の投票で1つに確定します。確定すると、終了条件までの開催回がまとめて作成され、毎回の出欠確認は個別に行います。"
          : "すでに決まっている日程で、このまま確定して案内・招待します。繰り返しパターン、または個別の固定日から選べます。"}
      </p>

      <div className="space-y-5">
        <DurationSelect value={duration} onChange={setDuration} />

        <MeetingEventSelector value={eventSelection} onChange={setEventSelection}
          hint="ポイントのつくイベントを選ぶと、定例会1回の参加ごとにポイントが付与されます" />

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            作成方法
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSeriesMode("vote")}
              className="py-2.5 rounded-2xl text-sm font-medium transition"
              style={{ background: seriesMode === "vote" ? "var(--color-brand)" : "var(--color-paper-200)", color: seriesMode === "vote" ? "white" : "var(--color-ink-600)" }}>
              🗳️ 投票してもらう
            </button>
            <button onClick={() => setSeriesMode("confirmed")}
              className="py-2.5 rounded-2xl text-sm font-medium transition"
              style={{ background: seriesMode === "confirmed" ? "var(--color-brand)" : "var(--color-paper-200)", color: seriesMode === "confirmed" ? "white" : "var(--color-ink-600)" }}>
              ✅ 日程はもう決まっている
            </button>
          </div>
        </div>

        {seriesMode === "confirmed" && (
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
              日程の決め方
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDateMode("recurring")}
                className="py-2.5 rounded-2xl text-sm font-medium transition"
                style={{ background: dateMode === "recurring" ? "var(--color-accent)" : "var(--color-paper-200)", color: dateMode === "recurring" ? "white" : "var(--color-ink-600)" }}>
                🔁 繰り返しパターン
              </button>
              <button onClick={() => setDateMode("fixed")}
                className="py-2.5 rounded-2xl text-sm font-medium transition"
                style={{ background: dateMode === "fixed" ? "var(--color-accent)" : "var(--color-paper-200)", color: dateMode === "fixed" ? "white" : "var(--color-ink-600)" }}>
                📅 個別の固定日
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            タイトル <span style={{ color: "var(--color-brand)" }}>*</span>
          </label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：チームA 定例ミーティング"
            className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>説明（任意）</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            placeholder="場所や目的など補足情報"
            className="w-full px-4 py-3 rounded-2xl text-sm outline-none border resize-none"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>対象者</label>
          <div className="grid grid-cols-2 gap-2">
            {(["all", "team", "collab_team", "selected"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)}
                className="py-2 rounded-2xl text-sm font-medium transition"
                style={{ background: scope === s ? "var(--color-brand)" : "var(--color-paper-200)", color: scope === s ? "white" : "var(--color-ink-600)" }}>
                {s === "all" ? "全員" : s === "team" ? "ギルド" : s === "collab_team" ? "チーム指定" : "メンバー指定"}
              </button>
            ))}
          </div>

          {scope === "team" && (
            <div className="mt-3">
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}>
                <option value="">ギルドを選択...</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.emblemEmoji} {t.name}</option>
                ))}
              </select>
            </div>
          )}

          {scope === "collab_team" && (
            <div className="mt-3 space-y-1.5">
              {collabTeams.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: "var(--color-ink-400)" }}>参加中のチーム（パワーチーム/緩いチーム）がありません</p>
              ) : (
                collabTeams.map((t) => (
                  <label key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
                    style={{ background: collabTeamId === t.id ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)", border: collabTeamId === t.id ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent" }}>
                    <input type="radio" name="collabTeamId" checked={collabTeamId === t.id} onChange={() => setCollabTeamId(t.id)} className="sr-only" />
                    <span className="text-base">{t.type === "power" ? "⚡" : "🌱"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{t.name}</p>
                      <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{t.memberCount}名</p>
                    </div>
                    {collabTeamId === t.id && <span className="text-xs font-bold" style={{ color: "var(--color-brand)" }}>✓</span>}
                  </label>
                ))
              )}
            </div>
          )}

          {scope === "selected" && (
            <div className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
                  style={{ background: inviteeIds.includes(m.id) ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)", border: inviteeIds.includes(m.id) ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent" }}>
                  <input type="checkbox" checked={inviteeIds.includes(m.id)} onChange={() => toggleInvitee(m.id)} className="sr-only" />
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg ${m.bgColor}`}>{m.emoji}</span>
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                  {inviteeIds.includes(m.id) && <span className="ml-auto text-xs" style={{ color: "var(--color-brand)" }}>✓</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {dateMode === "fixed" && seriesMode === "confirmed" ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>
                確定日 <span style={{ color: "var(--color-brand)" }}>*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowCalendarPicker((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: showCalendarPicker ? "var(--color-brand)" : "var(--color-paper-200)", color: showCalendarPicker ? "white" : "var(--color-ink-600)" }}
              >
                {showCalendarPicker ? <Pencil size={12} /> : <CalendarDays size={12} />}
                {showCalendarPicker ? "手入力に切り替え" : "カレンダーから選ぶ"}
              </button>
            </div>

            {showCalendarPicker && (
              <div className="card-paper rounded-2xl px-3 py-3 mb-2">
                <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
                  自分の予定を見ながら、開始したい時刻をクリックして確定日を追加できます（上で選んだ所要時間の枠が確保されます）
                </p>
                <MeetingCandidatePicker
                  duration={duration}
                  candidates={fixedDates.map((d) => ({ ...d, endTime: addMinutesToTime(d.time, duration) }))}
                  onAdd={addCalendarFixedDate}
                  onRemove={removeFixedDate}
                  maxReached={fixedDates.filter((d) => d.date).length >= MAX_FIXED_DATES}
                />
              </div>
            )}

            <div className="space-y-2" data-drag-list>
              {(() => {
                const draggingIndex = fixedDates.findIndex((d) => d.id === fixedDateDrag.dragId);
                return fixedDates.map((d, i) => (
                  <div key={d.id}>
                    <DropInsertionLine show={fixedDateDrag.dragId !== null && fixedDateDrag.gapIndex === i && i !== draggingIndex && i !== draggingIndex + 1} />
                    <div
                      ref={(el) => fixedDateDrag.registerRow(d.id, el)}
                      data-drag-row
                      className="card-paper rounded-2xl px-4 py-3"
                      style={{
                        position: "relative",
                        opacity: fixedDateDrag.dragId === d.id ? 0.9 : 1,
                        boxShadow: fixedDateDrag.dragId === d.id ? "0 10px 24px rgba(0,0,0,0.18)" : undefined,
                        zIndex: fixedDateDrag.dragId === d.id ? 10 : undefined,
                        transform: fixedDateDrag.dragId === d.id ? `translateY(${fixedDateDrag.dragOffsetY}px) scale(1.02)` : undefined,
                      }}
                    >
                  <div className="flex items-center gap-2 mb-2">
                    {fixedDates.length > 1 && (
                      <span
                        onPointerDown={(e) => fixedDateDrag.handlePointerDown(d.id, e)}
                        onPointerMove={fixedDateDrag.handlePointerMove}
                        onPointerUp={fixedDateDrag.handlePointerUp}
                        onPointerCancel={fixedDateDrag.handlePointerUp}
                        className="p-2 -ml-2 touch-none cursor-grab active:cursor-grabbing"
                        style={{ color: "var(--color-ink-300)" }}
                        aria-label="並び替え"
                      >
                        <GripVertical size={14} />
                      </span>
                    )}
                    <span className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>確定日 {i + 1}</span>
                    {fixedDates.length > 1 && (
                      <button onClick={() => removeFixedDate(i)} className="ml-auto p-1 rounded-xl hover:opacity-70" style={{ color: "var(--color-ink-400)" }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input type="date" value={d.date} min={todayDateStr()} onChange={(e) => updateFixedDate(i, "date", e.target.value)}
                      className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                      style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
                    <input type="time" value={d.time} onChange={(e) => updateFixedDate(i, "time", e.target.value)}
                      className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                      style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
                    <p className="col-span-3 sm:col-span-1 px-3 py-2 text-sm" style={{ color: "var(--color-ink-500)" }}>
                      〜 {d.time ? addMinutesToTime(d.time, duration) : "--:--"}
                    </p>
                  </div>
                    </div>
                  </div>
                ));
              })()}
              <DropInsertionLine show={fixedDateDrag.dragId !== null && fixedDateDrag.gapIndex === fixedDates.length && fixedDates.findIndex((d) => d.id === fixedDateDrag.dragId) !== fixedDates.length - 1} />

              <button onClick={addFixedDate} disabled={fixedDates.length >= MAX_FIXED_DATES}
                className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2 transition hover:opacity-80 disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <Plus size={15} />
                確定日を追加（{fixedDates.length}/{MAX_FIXED_DATES}）
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
                {seriesMode === "confirmed" ? "確定パターン" : "候補パターン"} <span style={{ color: "var(--color-brand)" }}>*</span>
              </label>
              <div className="space-y-2">
                {(seriesMode === "confirmed" ? candidates.slice(0, 1) : candidates).map((cand, i) => (
                  <div key={i} className="card-paper rounded-2xl px-4 py-3">
                    {seriesMode === "vote" && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>候補 {i + 1}</span>
                        {candidates.length > 1 && (
                          <button onClick={() => removeCandidate(i)} className="ml-auto p-1 rounded-xl hover:opacity-70" style={{ color: "var(--color-ink-400)" }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {(["weekly", "biweekly", "monthly"] as RecurrenceType[]).map((rt) => (
                        <button key={rt} onClick={() => updateCandidate(i, "recurrenceType", rt)}
                          className="py-1.5 rounded-xl text-xs font-medium transition"
                          style={{ background: cand.recurrenceType === rt ? "var(--color-accent)" : "var(--color-paper-200)", color: cand.recurrenceType === rt ? "white" : "var(--color-ink-600)" }}>
                          {rt === "weekly" ? "毎週" : rt === "biweekly" ? "隔週" : "毎月"}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2 mb-2">
                      {cand.recurrenceType === "monthly" && (
                        <select value={cand.weekOfMonth} onChange={(e) => updateCandidate(i, "weekOfMonth", Number(e.target.value))}
                          className="px-2.5 py-2 rounded-xl text-sm border" style={{ borderColor: "var(--color-paper-300)" }}>
                          {WEEK_OPTIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                        </select>
                      )}
                      <select value={cand.dayOfWeek} onChange={(e) => updateCandidate(i, "dayOfWeek", Number(e.target.value))}
                        className="px-2.5 py-2 rounded-xl text-sm border" style={{ borderColor: "var(--color-paper-300)" }}>
                        {DOW_OPTIONS.map((d, idx) => <option key={idx} value={idx}>{d}曜</option>)}
                      </select>
                      <input type="time" value={cand.startTimeLocal} onChange={(e) => updateCandidate(i, "startTimeLocal", e.target.value)}
                        className="px-2.5 py-2 rounded-xl text-sm border" style={{ borderColor: "var(--color-paper-300)" }} />
                      <span className="self-center text-xs" style={{ color: "var(--color-ink-500)" }}>
                        〜{cand.startTimeLocal ? addMinutesToTime(cand.startTimeLocal, duration) : "--:--"}
                      </span>
                    </div>

                    <input value={cand.note} onChange={(e) => updateCandidate(i, "note", e.target.value)} placeholder="メモ（任意・例：オンライン開催）"
                      className="w-full px-3 py-2 rounded-xl text-xs border" style={{ borderColor: "var(--color-paper-300)" }} />
                  </div>
                ))}

                {seriesMode === "vote" && (
                  <button onClick={addCandidate} disabled={candidates.length >= MAX_CANDIDATES}
                    className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2 transition hover:opacity-80 disabled:opacity-50"
                    style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                    <Plus size={15} />
                    候補パターンを追加（{candidates.length}/{MAX_CANDIDATES}）
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
                終了条件 <span style={{ color: "var(--color-brand)" }}>*</span>
              </label>
              <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
                {seriesMode === "vote" ? "確定した時点で、終了条件までの開催回がまとめて作成されます。" : "終了条件までの開催回がまとめて作成されます。"}
              </p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button onClick={() => setEndCondition("count")}
                  className="py-2 rounded-2xl text-sm font-medium transition"
                  style={{ background: endCondition === "count" ? "var(--color-accent)" : "var(--color-paper-200)", color: endCondition === "count" ? "white" : "var(--color-ink-600)" }}>
                  回数で指定
                </button>
                <button onClick={() => setEndCondition("date")}
                  className="py-2 rounded-2xl text-sm font-medium transition"
                  style={{ background: endCondition === "date" ? "var(--color-accent)" : "var(--color-paper-200)", color: endCondition === "date" ? "white" : "var(--color-ink-600)" }}>
                  終了日で指定
                </button>
              </div>
              {endCondition === "count" ? (
                <input type="number" min={1} max={200} value={occurrenceCount} onChange={(e) => setOccurrenceCount(e.target.value)}
                  placeholder="例: 12"
                  className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
                  style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              ) : (
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
                  style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              )}
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>会議URLの設定（任意）</label>
          <ConferenceModeSelector
            mode={conferenceMode}
            onModeChange={setConferenceMode}
            conferenceUrl={conferenceUrl}
            onConferenceUrlChange={setConferenceUrl}
            zoomConnected={zoomConnected}
            googleConnected={googleConnected}
          />
          {(conferenceMode === "zoom" || conferenceMode === "google_meet") && (
            <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-500)" }}>
              確定後、会議URLが1つだけ自動で発行され、全回で共通して使われます（日程を変更した回もURLは変わりません）。確定通知のメールにもURLが記載されます。
            </p>
          )}
          {conferenceMode === "manual" && (
            <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-500)" }}>
              毎回同じ会議URLが、各回のミーティングに設定されます。確定通知のメールにもURLが記載されます。
            </p>
          )}
        </div>

        {seriesMode === "vote" && (
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>投票締め切り（任意）</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
          </div>
        )}

        {error && (
          <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>
        )}

        <button onClick={handleSubmit} disabled={createMutation.isPending}
          className="w-full py-4 rounded-2xl text-base font-medium text-white flex items-center justify-center gap-2 transition disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          {createMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : seriesMode === "confirmed" ? "✅ 確定して案内する" : "🔁 定例会を作成する"}
        </button>
      </div>
    </div>
  );
}
