// =============================================================
// ミーティング新規作成画面
// =============================================================
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, ChevronLeft, CalendarDays, Pencil, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { MeetingCandidatePicker, type SuggestedSlot } from "./_meeting-candidate-picker";
import { ConferenceModeSelector, type ConferenceMode } from "./_conference-mode-selector";
import { AiSlotSearchPanel } from "./_ai-slot-search-panel";

type Team = { id: string; name: string; emblemEmoji: string };
type CollabTeam = { id: string; name: string; type: "loose" | "power"; memberCount: number };
type Member = { id: string; name: string; emoji: string; bgColor: string };
type MeetingTypeDef = { id: string; slug: string; name: string; emoji: string; pointValue: number };
type TeamsResponse = { data: Team[] };
type CollabTeamsResponse = { data: CollabTeam[] };
type MembersResponse = { data: Member[] };
type MeetingTypesResponse = { data: MeetingTypeDef[] };

type Candidate = {
  date: string;  // YYYY-MM-DD
  time: string;  // HH:MM (optional)
  endTime: string;
};

function toUnixTimestamp(date: string, time: string): number {
  const dt = time ? new Date(`${date}T${time}:00`) : new Date(`${date}T00:00:00`);
  return Math.floor(dt.getTime() / 1000);
}

function emptyCandidate(): Candidate {
  return { date: "", time: "09:00", endTime: "10:00" };
}

function isoToJstDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MAX_CANDIDATES = 10;

export function MeetingNewScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { termExternalGuest } = useSettings();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"all" | "team" | "collab_team" | "selected">("all");
  const [teamId, setTeamId] = useState("");
  const [collabTeamId, setCollabTeamId] = useState("");
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([emptyCandidate()]);
  const [dateInputMode, setDateInputMode] = useState<"manual" | "calendar" | "ai">("manual");
  const [suggestedSlots, setSuggestedSlots] = useState<SuggestedSlot[]>([]);
  // 手入力・カレンダー由来の候補が既にある状態でAI検索結果を受け取った場合、
  // 「残して追加」か「全部入れ替え」かをユーザーに確認するまで一時的に保持しておく
  const [pendingAiApply, setPendingAiApply] = useState<{ slots: SuggestedSlot[]; prevAiKeys: Set<string> } | null>(null);
  const [eventTypeDefId, setEventTypeDefId] = useState<string>("");
  const [registrationDeadline, setRegistrationDeadline] = useState("");
  const [meetingMode, setMeetingMode] = useState<"vote" | "confirmed">("vote");
  const [conferenceMode, setConferenceMode] = useState<ConferenceMode>("none");
  const [conferenceUrl, setConferenceUrl] = useState("");
  const [error, setError] = useState("");

  const { data: zoomStatus } = useQuery({
    queryKey: ["scheduler", "zoom-status"],
    queryFn: () => api.get<{ data: { connected: boolean } }>("/scheduler/oauth/zoom/status"),
    enabled: meetingMode === "confirmed",
  });
  const { data: googleStatus } = useQuery({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => api.get<{ data: { connected: boolean } }>("/scheduler/oauth/google/status"),
    enabled: meetingMode === "confirmed",
  });
  const zoomConnected = zoomStatus?.data.connected ?? false;
  const googleConnected = googleStatus?.data.connected ?? false;

  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.get<TeamsResponse>("/teams"),
    enabled: scope === "team",
  });

  const { data: collabTeamsData } = useQuery({
    queryKey: ["collab", "my-teams"],
    queryFn: () => api.get<CollabTeamsResponse>("/collab/my-teams"),
    enabled: scope === "collab_team",
  });

  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
    // 「全員」選択時にも、送信前の確認ダイアログで対象人数を表示するために取得する
    enabled: scope === "selected" || scope === "all",
  });

  const { data: meetingTypesData } = useQuery({
    queryKey: ["events", "meeting-types"],
    queryFn: () => api.get<MeetingTypesResponse>("/events/meeting-types"),
  });

  // イベント種別のデフォルトは先頭（sortOrder順で最初）の種別、通常は「ミーティング」
  useEffect(() => {
    if (eventTypeDefId === "" && meetingTypesData?.data && meetingTypesData.data.length > 0) {
      setEventTypeDefId(meetingTypesData.data[0].id);
    }
  }, [meetingTypesData, eventTypeDefId]);

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<{ data: { id: string } }>("/meetings", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      navigate(`/meetings/${res.data.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function addCandidate() {
    if (candidates.length >= MAX_CANDIDATES) return;
    setCandidates([...candidates, emptyCandidate()]);
  }

  function removeCandidate(i: number) {
    setCandidates(candidates.filter((_, idx) => idx !== i));
  }

  function updateCandidate(i: number, field: keyof Candidate, value: string) {
    setCandidates(candidates.map((c, idx) => idx === i ? { ...c, [field]: value } : c));
  }

  // カレンダー上のドラッグ/クリックで選んだ範囲を候補日として追加する
  function addCalendarCandidate(date: string, startTime: string, endTime: string) {
    if (candidates.filter((c) => c.date).length >= MAX_CANDIDATES) return;
    const newCandidate: Candidate = { date, time: startTime, endTime };
    const emptyIdx = candidates.findIndex((c) => !c.date);
    if (emptyIdx >= 0) {
      setCandidates(candidates.map((c, i) => i === emptyIdx ? newCandidate : c));
    } else if (candidates.length < MAX_CANDIDATES) {
      setCandidates([...candidates, newCandidate]);
    }
  }

  // AI検索の結果をカレンダー上のハイライトに使うだけでなく、候補日入力リストにも
  // あらかじめ選択済みとして反映しておく（不要なものは一覧から後で削除できる）。
  // 対象者を変えるなどして再検索した場合は、前回のAI検索で自動追加した分を今回の結果で
  // 置き換える（"prevAiKeys"は直前のsuggestedSlotsから求める。専用の状態を別に持たなくても
  // 既存のsuggestedSlots状態だけで判別できる）。手入力・カレンダークリックで追加した候補が
  // 混ざっている場合は、それらを黙って消してしまわないよう、先にどうするか確認する。
  function slotKey(date: string, time: string): string {
    return `${date}|${time}`;
  }

  function applyAiSlots(slots: SuggestedSlot[], prevAiKeys: Set<string>, mode: "merge" | "replace") {
    setCandidates((prev) => {
      let next: Candidate[] = mode === "replace"
        ? []
        : prev.filter((c) => !(c.date && prevAiKeys.has(slotKey(c.date, c.time))));
      for (const slot of slots) {
        if (next.filter((c) => c.date).length >= MAX_CANDIDATES) break;
        const { date, time } = isoToJstDateTime(slot.startUtc);
        const { time: endTime } = isoToJstDateTime(slot.endUtc);
        if (next.some((c) => c.date === date && c.time === time)) continue;
        const newCandidate: Candidate = { date, time, endTime };
        const emptyIdx = next.findIndex((c) => !c.date);
        next = emptyIdx >= 0
          ? next.map((c, i) => (i === emptyIdx ? newCandidate : c))
          : [...next, newCandidate];
      }
      return next.length > 0 ? next : [emptyCandidate()];
    });
  }

  function handleAiResults(slots: SuggestedSlot[]) {
    const prevAiKeys = new Set(suggestedSlots.map((s) => {
      const { date, time } = isoToJstDateTime(s.startUtc);
      return slotKey(date, time);
    }));
    setSuggestedSlots(slots);

    const hasManualCandidates = candidates.some((c) => c.date && !prevAiKeys.has(slotKey(c.date, c.time)));
    if (hasManualCandidates) {
      setPendingAiApply({ slots, prevAiKeys });
      return;
    }
    applyAiSlots(slots, prevAiKeys, "merge");
  }

  function toggleInvitee(id: string) {
    setInviteeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSubmit() {
    setError("");
    if (!title.trim()) { setError("タイトルを入力してください"); return; }
    const validCandidates = candidates.filter((c) => c.date);
    if (validCandidates.length === 0) { setError(meetingMode === "confirmed" ? "確定日を1つ以上設定してください" : "候補日を1つ以上設定してください"); return; }
    if (scope === "team" && !teamId) { setError("ギルドを選択してください"); return; }
    if (scope === "collab_team" && !collabTeamId) { setError("対象チームを選択してください"); return; }
    if (meetingMode === "confirmed" && conferenceMode === "manual" && !conferenceUrl.trim()) {
      setError("会議URLを入力してください"); return;
    }
    if (scope === "all") {
      const count = members.length;
      const confirmText = meetingMode === "confirmed"
        ? `対象者${count}人に確定した日程で招待を行いますが進めてよろしいですか？`
        : `対象者${count}人にミーティングへの招待を行いますが進めてよろしいですか？`;
      if (!window.confirm(confirmText)) return;
    }

    createMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      scope,
      teamId: scope === "team" ? teamId : undefined,
      collabTeamId: scope === "collab_team" ? collabTeamId : undefined,
      inviteeIds: scope === "selected" ? inviteeIds : undefined,
      eventTypeDefId: eventTypeDefId || undefined,
      registrationDeadline: registrationDeadline
        ? Math.floor(new Date(registrationDeadline).getTime() / 1000)
        : undefined,
      candidates: validCandidates.map((c) => ({
        startsAt: toUnixTimestamp(c.date, c.time),
        endsAt: c.endTime ? toUnixTimestamp(c.date, c.endTime) : undefined,
      })),
      confirmNow: meetingMode === "confirmed" || undefined,
      conferenceType: meetingMode === "confirmed" ? conferenceMode : undefined,
      conferenceUrl: meetingMode === "confirmed" && conferenceMode === "manual" ? conferenceUrl.trim() : undefined,
    });
  }

  const teams = teamsData?.data ?? [];
  const collabTeams = collabTeamsData?.data ?? [];
  const members = (membersData?.data ?? []) as Member[];

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70"
          style={{ background: "var(--color-paper-200)" }}>
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          ミーティングを立てる
        </h1>
      </div>

      <div className="space-y-5">
        {/* 作成モード（投票 / 確定日） */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            作成方法
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMeetingMode("vote")}
              className="py-2.5 rounded-2xl text-sm font-medium transition"
              style={{ background: meetingMode === "vote" ? "var(--color-brand)" : "var(--color-paper-200)", color: meetingMode === "vote" ? "white" : "var(--color-ink-600)" }}
            >
              📋 候補日を提案する
            </button>
            <button
              type="button"
              onClick={() => setMeetingMode("confirmed")}
              className="py-2.5 rounded-2xl text-sm font-medium transition"
              style={{ background: meetingMode === "confirmed" ? "var(--color-brand)" : "var(--color-paper-200)", color: meetingMode === "confirmed" ? "white" : "var(--color-ink-600)" }}
            >
              ✅ 日程は決定済み
            </button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-400)" }}>
            {meetingMode === "vote"
              ? "候補日を出して参加者に投票してもらい、あとで日程を確定します"
              : "すでに決まっている日程で、このまま確定して案内・招待します"}
          </p>
        </div>

        {/* イベント種別設定（先頭） */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            🎯 イベント種別
          </label>
          <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
            ミーティング参加者にポイントを付与するイベントと連携できます
          </p>
          {!meetingTypesData ? (
            <div className="flex justify-center py-3">
              <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-brand)" }} />
            </div>
          ) : (
            <div className="space-y-1.5">
              {(meetingTypesData.data ?? []).map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
                  style={{
                    background: eventTypeDefId === t.id ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
                    border: eventTypeDefId === t.id ? "1.5px solid rgba(212,160,59,0.4)" : "1.5px solid transparent",
                  }}
                >
                  <input type="radio" name="eventTypeDefId" value={t.id} checked={eventTypeDefId === t.id} onChange={() => setEventTypeDefId(t.id)} className="sr-only" />
                  <span className="text-base">{t.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{t.name}</p>
                    {t.pointValue > 0 && (
                      <p className="text-xs" style={{ color: "var(--color-accent)" }}>出席者に +{t.pointValue}pt</p>
                    )}
                  </div>
                  {eventTypeDefId === t.id && <span className="text-xs font-bold" style={{ color: "var(--color-accent)" }}>✓</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* タイトル */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            タイトル <span style={{ color: "var(--color-brand)" }}>*</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：6月の定例ランチ会"
            className="w-full px-4 py-3 rounded-2xl text-sm outline-none border transition"
            style={{
              background: "var(--color-paper-50)",
              borderColor: "var(--color-paper-300)",
              color: "var(--color-ink-900)",
            }}
          />
        </div>

        {/* 説明 */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            説明（任意）
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="場所や目的など補足情報を入力"
            rows={3}
            className="w-full px-4 py-3 rounded-2xl text-sm outline-none border transition resize-none"
            style={{
              background: "var(--color-paper-50)",
              borderColor: "var(--color-paper-300)",
              color: "var(--color-ink-900)",
            }}
          />
        </div>

        {/* 対象者 */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            対象者
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["all", "team", "collab_team", "selected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className="py-2 rounded-2xl text-sm font-medium transition"
                style={{
                  background: scope === s ? "var(--color-brand)" : "var(--color-paper-200)",
                  color: scope === s ? "white" : "var(--color-ink-600)",
                }}
              >
                {s === "all" ? "全員" : s === "team" ? "ギルド" : s === "collab_team" ? "チーム" : "指定"}
              </button>
            ))}
          </div>
          <p className="text-xs mt-1.5 px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-600)" }}>
            💡 ここではメンバーの中から対象者を選びます。チャプター外の{termExternalGuest}を招待したい場合は、ここでは指定できません。ミーティング作成後の詳細画面で発行できる「招待URL」を、{termExternalGuest}の方に直接お伝えください。
          </p>

          {scope === "team" && (
            <div className="mt-3">
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
                style={{
                  background: "var(--color-paper-50)",
                  borderColor: "var(--color-paper-300)",
                  color: "var(--color-ink-900)",
                }}
              >
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
                <label
                  key={m.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
                  style={{
                    background: inviteeIds.includes(m.id) ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)",
                    border: inviteeIds.includes(m.id) ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={inviteeIds.includes(m.id)}
                    onChange={() => toggleInvitee(m.id)}
                    className="sr-only"
                  />
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg ${m.bgColor}`}>
                    {m.emoji}
                  </span>
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                  {inviteeIds.includes(m.id) && <span className="ml-auto text-xs" style={{ color: "var(--color-brand)" }}>✓</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 候補日／確定日 */}
        <div>
          <div className="flex items-center justify-between mb-1.5 flex-wrap gap-y-1">
            <label className="block text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>
              {meetingMode === "confirmed" ? "確定日" : "候補日"} <span style={{ color: "var(--color-brand)" }}>*</span>
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDateInputMode("manual")}
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: dateInputMode === "manual" ? "var(--color-brand)" : "var(--color-paper-200)", color: dateInputMode === "manual" ? "white" : "var(--color-ink-600)" }}
              >
                <Pencil size={12} />
                手入力
              </button>
              <button
                type="button"
                onClick={() => setDateInputMode("calendar")}
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: dateInputMode === "calendar" ? "var(--color-brand)" : "var(--color-paper-200)", color: dateInputMode === "calendar" ? "white" : "var(--color-ink-600)" }}
              >
                <CalendarDays size={12} />
                カレンダーから選ぶ
              </button>
              <button
                type="button"
                onClick={() => setDateInputMode("ai")}
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: dateInputMode === "ai" ? "var(--color-success)" : "var(--color-paper-200)", color: dateInputMode === "ai" ? "white" : "var(--color-ink-600)" }}
              >
                <Sparkles size={12} />
                AIで探す
              </button>
            </div>
          </div>

          {dateInputMode !== "manual" && (
            <div className="card-paper rounded-2xl px-3 py-3 mb-2">
              {dateInputMode === "ai" ? (
                <AiSlotSearchPanel
                  scope={scope}
                  teamId={teamId || undefined}
                  collabTeamId={collabTeamId || undefined}
                  inviteeIds={inviteeIds}
                  allMembers={scope === "all" ? members : undefined}
                  onResults={handleAiResults}
                />
              ) : (
                <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
                  自分の予定を見ながら、時間帯をクリック（選択中の長さで追加）またはドラッグ（30分単位で開始・終了を自由に指定）して候補日を追加できます
                </p>
              )}
              <MeetingCandidatePicker
                candidates={candidates}
                onAdd={addCalendarCandidate}
                onRemove={removeCandidate}
                maxReached={candidates.filter((c) => c.date).length >= MAX_CANDIDATES}
                suggestedSlots={suggestedSlots}
              />
            </div>
          )}

          <div className="space-y-2">
            {candidates.map((cand, i) => (
              <div key={i} className="card-paper rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>
                    {meetingMode === "confirmed" ? "確定日" : "候補"} {i + 1}
                  </span>
                  {candidates.length > 1 && (
                    <button onClick={() => removeCandidate(i)} className="ml-auto p-1 rounded-xl hover:opacity-70"
                      style={{ color: "var(--color-ink-400)" }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    value={cand.date}
                    min={todayDateStr()}
                    onChange={(e) => updateCandidate(i, "date", e.target.value)}
                    className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                    style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                  />
                  <input
                    type="time"
                    value={cand.time}
                    onChange={(e) => updateCandidate(i, "time", e.target.value)}
                    placeholder="開始時刻"
                    className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                    style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                  />
                  <input
                    type="time"
                    value={cand.endTime}
                    onChange={(e) => updateCandidate(i, "endTime", e.target.value)}
                    placeholder="終了時刻"
                    className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                    style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                  />
                </div>
              </div>
            ))}

            <button
              onClick={addCandidate}
              disabled={candidates.length >= MAX_CANDIDATES}
              className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2 transition hover:opacity-80 disabled:opacity-50"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
            >
              <Plus size={15} />
              {meetingMode === "confirmed" ? "確定日を追加" : "候補日を追加"}（{candidates.length}/{MAX_CANDIDATES}）
            </button>
          </div>
        </div>

        {/* 会議URLの設定方法（確定日モードのみ） */}
        {meetingMode === "confirmed" && (
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
              会議URLの設定方法
            </label>
            <ConferenceModeSelector
              mode={conferenceMode}
              onModeChange={setConferenceMode}
              conferenceUrl={conferenceUrl}
              onConferenceUrlChange={setConferenceUrl}
              zoomConnected={zoomConnected}
              googleConnected={googleConnected}
            />
          </div>
        )}

        {/* 募集期間（任意・投票モードのみ） */}
        {meetingMode === "vote" && (
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
              募集締め切り日（任意）
            </label>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
              設定しない場合、日程確定時にホーム画面からの募集表示が終了します
            </p>
            <input
              type="date"
              value={registrationDeadline}
              onChange={(e) => setRegistrationDeadline(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl text-sm outline-none border transition"
              style={{
                background: "var(--color-paper-50)",
                borderColor: "var(--color-paper-300)",
                color: "var(--color-ink-900)",
              }}
            />
            {registrationDeadline && (
              <button type="button" onClick={() => setRegistrationDeadline("")}
                className="mt-1 text-xs" style={{ color: "var(--color-ink-400)" }}>
                クリア
              </button>
            )}
          </div>
        )}

        {/* エラー */}
        {error && (
          <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
            {error}
          </p>
        )}

        {/* 作成ボタン */}
        <button
          onClick={handleSubmit}
          disabled={createMutation.isPending || !eventTypeDefId}
          className="w-full py-4 rounded-2xl text-base font-medium text-white flex items-center justify-center gap-2 transition disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}
        >
          {createMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : meetingMode === "confirmed" ? (
            "✅ 確定して案内する"
          ) : (
            "📅 ミーティングを作成する"
          )}
        </button>
      </div>

      {pendingAiApply && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setPendingAiApply(null)}>
          <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold flex items-center gap-1.5" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                <Sparkles size={18} />
                候補日をどう反映しますか？
              </h2>
              <button onClick={() => setPendingAiApply(null)} className="p-1 rounded-lg" style={{ color: "var(--color-ink-400)" }}>
                <X size={18} />
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
              手入力・カレンダーで追加した候補日が既にあります。今回AIが見つけた候補を、既存の候補に追加しますか？　それともすべて入れ替えますか？
            </p>
            <div className="space-y-2">
              <button
                onClick={() => { applyAiSlots(pendingAiApply.slots, pendingAiApply.prevAiKeys, "merge"); setPendingAiApply(null); }}
                className="w-full py-2.5 rounded-2xl text-sm font-medium text-white"
                style={{ background: "var(--color-brand)" }}
              >
                残して追加する
              </button>
              <button
                onClick={() => { applyAiSlots(pendingAiApply.slots, pendingAiApply.prevAiKeys, "replace"); setPendingAiApply(null); }}
                className="w-full py-2.5 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
              >
                すべて入れ替える
              </button>
              <button
                onClick={() => setPendingAiApply(null)}
                className="w-full py-2 rounded-2xl text-xs font-medium"
                style={{ color: "var(--color-ink-400)" }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
