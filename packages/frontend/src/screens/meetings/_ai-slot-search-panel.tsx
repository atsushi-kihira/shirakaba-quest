// =============================================================
// ミーティング作成画面：AIで日程候補を探すパネル
// 招待予定メンバーのうちGoogleカレンダー連携済みの人の空き時間を確認し、
// 曜日・時間帯・所要時間・自由記述の条件から候補日時を抽出する。
// 結果は呼び出し元（MeetingCandidatePicker）のカレンダー上に表示される。
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { SuggestedSlot } from "./_meeting-candidate-picker";

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const DEFAULT_DAYS = [1, 2, 3, 4, 5]; // 平日
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180];
const MAX_RANGE_DAYS = 56; // 8週間

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function diffDays(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400_000) + 1;
}

type SearchResponse = {
  data: {
    checkedMemberIds: string[];
    connectedMemberIds: string[];
    unconnectedMemberIds: string[];
    excludedForCapMemberIds: string[];
    checkFailedMemberIds: string[];
    slots: SuggestedSlot[];
    totalCandidatesFound: number;
    aiUsed: boolean;
    aiCallFailed?: boolean;
  };
};

const MAX_PRIORITY_MEMBERS = 10;

export function AiSlotSearchPanel({
  scope,
  teamId,
  collabTeamId,
  inviteeIds,
  allMembers,
  onResults,
}: {
  scope: "all" | "team" | "collab_team" | "selected";
  teamId?: string;
  collabTeamId?: string;
  inviteeIds: string[];
  allMembers?: Array<{ id: string; name: string; emoji: string; bgColor: string }>;
  onResults: (slots: SuggestedSlot[]) => void;
}) {
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(DEFAULT_DAYS);
  const [timeStart, setTimeStart] = useState("09:00");
  const [timeEnd, setTimeEnd] = useState("21:00");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [searchFrom, setSearchFrom] = useState(todayDateStr());
  const [searchTo, setSearchTo] = useState(addDaysToDateStr(todayDateStr(), 13));
  const [maxMembersToCheck, setMaxMembersToCheck] = useState(10);
  const [maxCandidates, setMaxCandidates] = useState(5);
  const [priorityMemberIds, setPriorityMemberIds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SearchResponse["data"] | null>(null);

  const searchMutation = useMutation({
    mutationFn: () =>
      api.post<SearchResponse>("/meetings/suggest-slots", {
        scope,
        teamId: scope === "team" ? teamId : undefined,
        collabTeamId: scope === "collab_team" ? collabTeamId : undefined,
        inviteeIds: scope === "selected" ? inviteeIds : undefined,
        priorityMemberIds: scope === "all" && priorityMemberIds.length > 0 ? priorityMemberIds : undefined,
        daysOfWeek,
        timeStartLocal: timeStart,
        timeEndLocal: timeEnd,
        durationMinutes,
        searchFromLocal: searchFrom,
        searchToLocal: searchTo,
        maxMembersToCheck,
        maxCandidates,
        freeText: freeText.trim() || undefined,
      }),
    onSuccess: (res) => {
      setSummary(res.data);
      onResults(res.data.slots);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "候補の検索に失敗しました"),
  });

  function toggleDay(d: number) {
    setDaysOfWeek((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function togglePriorityMember(id: string) {
    setPriorityMemberIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_PRIORITY_MEMBERS) return prev;
      return [...prev, id];
    });
  }

  function handleSearch() {
    setError("");
    if (daysOfWeek.length === 0) { setError("曜日を1つ以上選択してください"); return; }
    if (timeStart >= timeEnd) { setError("終了時刻は開始時刻より後にしてください"); return; }
    if (searchTo < searchFrom) { setError("検索期間の終了日は開始日以降にしてください"); return; }
    if (diffDays(searchFrom, searchTo) > MAX_RANGE_DAYS) { setError(`検索期間は最大${MAX_RANGE_DAYS}日（8週間）までです`); return; }
    if (scope === "team" && !teamId) { setError("ギルドを選択してください"); return; }
    if (scope === "collab_team" && !collabTeamId) { setError("対象チームを選択してください"); return; }
    if (scope === "selected" && inviteeIds.length === 0) { setError("メンバーを1人以上選択してください"); return; }
    searchMutation.mutate();
  }

  return (
    <div className="mb-3 space-y-3 pb-3" style={{ borderBottom: "1px solid var(--color-paper-300)" }}>
      <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
        <Sparkles size={15} style={{ color: "var(--color-success)" }} />
        AIで候補日を探す
      </p>
      <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
        招待予定メンバーのうち、Googleカレンダーと連携している人の空き時間を確認し、条件に合う候補日時を探します。
      </p>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>曜日</label>
        <div className="flex gap-1 flex-wrap">
          {DOW_LABELS.map((label, d) => (
            <button key={d} type="button" onClick={() => toggleDay(d)}
              className="w-9 h-9 rounded-full text-xs font-medium transition"
              style={{ background: daysOfWeek.includes(d) ? "var(--color-brand)" : "var(--color-paper-200)", color: daysOfWeek.includes(d) ? "white" : "var(--color-ink-600)" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>時間帯</label>
        <div className="flex items-center gap-2">
          <input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
          <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>〜</span>
          <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ミーティング時間</label>
        <div className="grid grid-cols-4 gap-1.5">
          {DURATION_OPTIONS.map((d) => (
            <button key={d} type="button" onClick={() => setDurationMinutes(d)}
              className="py-1.5 rounded-xl text-xs font-medium transition"
              style={{ background: durationMinutes === d ? "var(--color-brand)" : "var(--color-paper-200)", color: durationMinutes === d ? "white" : "var(--color-ink-600)" }}>
              {d < 60 ? `${d}分` : d % 60 === 0 ? `${d / 60}時間` : `${Math.floor(d / 60)}.5時間`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>検索期間</label>
        <div className="flex items-center gap-2">
          <input type="date" value={searchFrom} min={todayDateStr()} onChange={(e) => setSearchFrom(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
          <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>〜</span>
          <input type="date" value={searchTo} min={searchFrom} onChange={(e) => setSearchTo(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
        </div>
        <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>最大{MAX_RANGE_DAYS}日（8週間）まで指定できます</p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
          候補の件数（最大{maxCandidates}件）
        </label>
        <input type="range" min={1} max={15} value={maxCandidates} onChange={(e) => setMaxCandidates(Number(e.target.value))} className="w-full" />
      </div>

      {scope === "all" && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            確認する人数の上限（{maxMembersToCheck}人）
          </label>
          <input type="range" min={1} max={20} value={maxMembersToCheck} onChange={(e) => setMaxMembersToCheck(Number(e.target.value))} className="w-full" />
          <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
            「全員」対象のため、確認するメンバー数に上限を設けています（最大20人）
          </p>
        </div>
      )}

      {scope === "all" && (allMembers?.length ?? 0) > 0 && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            予定の確認を優先したい人（任意・最大{MAX_PRIORITY_MEMBERS}人、{priorityMemberIds.length}人選択中）
          </label>
          <p className="text-[11px] mb-1.5" style={{ color: "var(--color-ink-400)" }}>
            この人の参加は欠かせない、という方を選んでおくと、上の人数上限で確認対象からもれにくくなります。
          </p>
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {allMembers!.map((m) => {
              const checked = priorityMemberIds.includes(m.id);
              const disabled = !checked && priorityMemberIds.length >= MAX_PRIORITY_MEMBERS;
              return (
                <label key={m.id}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-2xl transition ${disabled ? "opacity-40" : "cursor-pointer"}`}
                  style={{ background: checked ? "rgba(90,140,92,0.1)" : "var(--color-paper-200)", border: checked ? "1.5px solid rgba(90,140,92,0.35)" : "1.5px solid transparent" }}>
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => togglePriorityMember(m.id)} className="sr-only" />
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${m.bgColor}`}>{m.emoji}</span>
                  <span className="text-xs font-medium" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                  {checked && <span className="ml-auto text-xs" style={{ color: "var(--color-success)" }}>✓</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>自由記述（任意）</label>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={2}
          placeholder="例：できれば午前中がいい、火曜は避けたい、月末は忙しいので月初がいい"
          className="w-full px-3 py-2 rounded-xl text-sm outline-none border resize-none"
          style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
        />
        <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
          指定すると、確定的に見つかった候補の中からAIが希望に合うものを選びます（未指定の場合はAIを使わず早い順に提示します）
        </p>
      </div>

      {error && (
        <p className="text-xs text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>
      )}

      <button
        type="button"
        onClick={handleSearch}
        disabled={searchMutation.isPending}
        className="w-full py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: "var(--color-success)" }}
      >
        {searchMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        候補を探す
      </button>
      <p className="text-[11px] text-center" style={{ color: "var(--color-ink-400)" }}>
        ⚠️ AIによる絞り込みのため、自由記述の条件を完全には満たせないことがあります。選ばれた候補が条件に合っているか、念のためご確認ください。
      </p>

      {summary && (
        <div className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.08)", color: "var(--color-ink-600)" }}>
          対象{summary.checkedMemberIds.length}人中、カレンダー連携済み{summary.connectedMemberIds.length}人を確認しました
          （未連携{summary.unconnectedMemberIds.length}人は空き状況を判定できていません）。
          {summary.excludedForCapMemberIds.length > 0 && `上限により${summary.excludedForCapMemberIds.length}人は確認対象外です。`}
          {summary.checkFailedMemberIds.length > 0 &&
            ` ⚠️ ${summary.checkFailedMemberIds.length}人はGoogle側の一時的な不調でカレンダーを取得できず、その方の予定は結果に反映されていません。時間をおいて再検索することをおすすめします。`}
          {summary.aiCallFailed ? (
            <span style={{ color: "var(--color-brand)" }}>
              {" "}⚠️ 自由記述の希望をAIで判定する処理が一時的にうまくいかず、以下は自由記述を反映せず早い順に並べた候補です。少し時間をおいてから、もう一度検索することをおすすめします。
            </span>
          ) : summary.slots.length === 0
            ? " 条件に合う候補は見つかりませんでした。"
            : ` ${summary.totalCandidatesFound}件の候補から${summary.slots.length}件を${summary.aiUsed ? "AIが" : ""}選び、候補日として追加しました。不要な候補は、下のカレンダー上のハイライトをクリックすると候補から外せます。`}
        </div>
      )}
    </div>
  );
}
