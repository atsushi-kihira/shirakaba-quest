// SC-04 自分の調整カレンダー設定画面
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2, ArrowLeft, Check, Plus, X } from "lucide-react";
import { request, ApiError } from "@/lib/api";
import { GoogleNotConnectedWarning } from "@/components/google-not-connected-warning";
import { SchedulerShareLinkPanel, useSchedulerShareLink } from "@/components/scheduler-share-link-panel";

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const DEFAULT_HOURS = { start: "09:00", end: "18:00" };
const DEFAULT_HOURS_2ND = { start: "19:00", end: "21:00" };
const MAX_RANGES_PER_DAY = 3;

type Settings = {
  memberId: string;
  displayTitle: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  dailyMaxBookings: number | null;
  slotIntervalMinutes: number;
  locationNote: string | null;
  isPublic: number;
  treatFreeEventsAsBusy: number;
  blockAllDayEvents: number;
};

type Rule = {
  id?: string;
  dayOfWeek: number;
  startTimeLocal: string;
  endTimeLocal: string;
};

// 画面上でのみ使う一意キー（保存前の新規行にはサーバー発行のidが無いため）
type EditableRule = Rule & { _localId: string };

function newLocalId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function SchedulerSettingsScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 呼び出し元から「戻る」先を指定された場合（例：1to1の外部ゲスト招待画面から）は、
  // 通常の「スケジューラーに戻る」ではなくそちらへ戻す
  const returnTo = searchParams.get("returnTo");
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: settingsData } = useQuery<{ data: Settings | null }>({
    queryKey: ["scheduler", "settings"],
    queryFn: () => request("/scheduler/me/settings"),
  });

  const { data: rulesData } = useQuery<{ data: Rule[] }>({
    queryKey: ["scheduler", "availability-rules"],
    queryFn: () => request("/scheduler/me/availability-rules"),
  });

  const { data: shareLinkData } = useSchedulerShareLink();

  const { data: googleStatusData } = useQuery<{ data: { connected: boolean } }>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => request("/scheduler/oauth/google/status"),
  });

  const settings = settingsData?.data;

  // フォーム状態
  const [displayTitle, setDisplayTitle] = useState("1on1 ミーティング");
  const [description, setDescription] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState(10);
  const [minNoticeMinutes, setMinNoticeMinutes] = useState(1440);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(60);
  const [dailyMaxBookings, setDailyMaxBookings] = useState<string>("");
  const [slotIntervalMinutes, setSlotIntervalMinutes] = useState(30);
  const [locationNote, setLocationNote] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [treatFreeEventsAsBusy, setTreatFreeEventsAsBusy] = useState(true);
  const [blockAllDayEvents, setBlockAllDayEvents] = useState(false);

  // 受付時間ルール（1曜日につき最大2つの時間帯を設定できる）
  const [rules, setRules] = useState<EditableRule[]>([]);

  // settings ロード時にフォーム初期化
  useEffect(() => {
    if (settings) {
      setDisplayTitle(settings.displayTitle ?? "1on1 ミーティング");
      setDescription(settings.description ?? "");
      setDurationMinutes(settings.durationMinutes ?? 30);
      setBufferAfterMinutes(settings.bufferAfterMinutes ?? 10);
      setMinNoticeMinutes(settings.minNoticeMinutes ?? 1440);
      setMaxAdvanceDays(settings.maxAdvanceDays ?? 60);
      setDailyMaxBookings(settings.dailyMaxBookings != null ? String(settings.dailyMaxBookings) : "");
      setSlotIntervalMinutes(settings.slotIntervalMinutes ?? 30);
      setLocationNote(settings.locationNote ?? "");
      setIsPublic(settings.isPublic === 1);
      setTreatFreeEventsAsBusy(settings.treatFreeEventsAsBusy !== 0);
      setBlockAllDayEvents(settings.blockAllDayEvents === 1);
    }
  }, [settings]);

  useEffect(() => {
    if (rulesData?.data) setRules(rulesData.data.map((r) => ({ ...r, _localId: r.id ?? newLocalId() })));
  }, [rulesData]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      await request("/scheduler/me/settings", {
        method: "PUT",
        body: {
          displayTitle,
          description: description || null,
          durationMinutes,
          bufferAfterMinutes,
          minNoticeMinutes,
          maxAdvanceDays,
          dailyMaxBookings: dailyMaxBookings ? parseInt(dailyMaxBookings) : null,
          slotIntervalMinutes,
          locationNote: locationNote || null,
          isPublic,
          treatFreeEventsAsBusy,
          blockAllDayEvents,
        },
      });
      await request("/scheduler/me/availability-rules", {
        method: "PUT",
        body: {
          rules: rules.map((r) => ({
            dayOfWeek: r.dayOfWeek,
            startTimeLocal: r.startTimeLocal,
            endTimeLocal: r.endTimeLocal,
          })),
        },
      });
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      queryClient.invalidateQueries({ queryKey: ["scheduler"] });
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "保存に失敗しました"),
  });

  const toggleDow = (dow: number) => {
    setRules((prev) => {
      const exists = prev.some((r) => r.dayOfWeek === dow);
      if (exists) return prev.filter((r) => r.dayOfWeek !== dow);
      return [...prev, { _localId: newLocalId(), dayOfWeek: dow, startTimeLocal: DEFAULT_HOURS.start, endTimeLocal: DEFAULT_HOURS.end }]
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    });
  };

  const updateRule = (localId: string, field: "startTimeLocal" | "endTimeLocal", value: string) => {
    setRules((prev) =>
      prev.map((r) => (r._localId === localId ? { ...r, [field]: value } : r))
    );
  };

  // 曜日ごとに2つ目の時間帯を追加する（例: 8:00-10:00 と 18:00-21:00 のように分けて設定したい場合）
  const addTimeRange = (dow: number) => {
    setRules((prev) => {
      if (prev.filter((r) => r.dayOfWeek === dow).length >= MAX_RANGES_PER_DAY) return prev;
      return [...prev, { _localId: newLocalId(), dayOfWeek: dow, startTimeLocal: DEFAULT_HOURS_2ND.start, endTimeLocal: DEFAULT_HOURS_2ND.end }];
    });
  };

  const removeTimeRange = (localId: string) => {
    setRules((prev) => prev.filter((r) => r._localId !== localId));
  };

  const publicUrl = shareLinkData?.publicUrl ?? null;

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button
        onClick={() => navigate(returnTo || "/scheduler")}
        className="flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={16} />
        {returnTo ? "戻る" : "スケジューラーに戻る"}
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--color-ink-900)" }}>
          ⚙️ 基本設定・受付時間
        </h1>
        <button
          onClick={() => saveSettings.mutate()}
          disabled={saveSettings.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
          style={{ background: saved ? "var(--color-success)" : "var(--color-brand)" }}
        >
          {saveSettings.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : saved ? (
            <Check size={14} />
          ) : (
            <Save size={14} />
          )}
          {saved ? "保存済み" : "保存する"}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl mb-4 text-sm"
          style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
          {error}
        </div>
      )}

      {/* Google連携が未設定・連携切れの場合は、共有前に連携を促す */}
      {publicUrl && googleStatusData && !googleStatusData.data.connected && <GoogleNotConnectedWarning />}

      {/* 公開 URL */}
      {settings && (
        <div className="rounded-2xl p-4 mb-5" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
          <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-500)" }}>公開URL（期限付き・このURLを相手にシェアします）</p>
          <SchedulerShareLinkPanel />
        </div>
      )}

      <div className="space-y-5">
        {/* 基本設定 */}
        <section className="rounded-2xl p-5" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
          <h2 className="font-bold mb-4" style={{ color: "var(--color-ink-800)" }}>基本設定</h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--color-ink-600)" }}>
                タイトル（予約ページに表示）
              </label>
              <input
                type="text"
                value={displayTitle}
                onChange={(e) => setDisplayTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm border"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
                placeholder="1on1 ミーティング"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--color-ink-600)" }}>
                説明（任意）
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm border resize-none"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
                rows={2}
                placeholder="BNI 白樺チャプターメンバーとの 1on1 です"
              />
            </div>
          </div>
        </section>

        {/* 所要時間・バッファ */}
        <section className="rounded-2xl p-5" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
          <h2 className="font-bold mb-4" style={{ color: "var(--color-ink-800)" }}>所要時間・バッファ</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--color-ink-600)" }}>
                所要時間
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-xl text-sm border"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              >
                {[15, 20, 30, 45, 60, 90].map((v) => (
                  <option key={v} value={v}>{v}分</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--color-ink-600)" }}>
                後バッファ
              </label>
              <select
                value={bufferAfterMinutes}
                onChange={(e) => setBufferAfterMinutes(parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-xl text-sm border"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              >
                {[0, 5, 10, 15, 30].map((v) => (
                  <option key={v} value={v}>{v}分</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--color-ink-600)" }}>
                最低リードタイム
              </label>
              <select
                value={minNoticeMinutes}
                onChange={(e) => setMinNoticeMinutes(parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-xl text-sm border"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              >
                <option value={60}>1時間前</option>
                <option value={240}>4時間前</option>
                <option value={720}>12時間前</option>
                <option value={1440}>前日まで</option>
                <option value={2880}>2日前まで</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--color-ink-600)" }}>
                受付期間
              </label>
              <select
                value={maxAdvanceDays}
                onChange={(e) => setMaxAdvanceDays(parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-xl text-sm border"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              >
                <option value={14}>2週間先まで</option>
                <option value={30}>1ヶ月先まで</option>
                <option value={60}>2ヶ月先まで</option>
                <option value={90}>3ヶ月先まで</option>
              </select>
            </div>
          </div>
        </section>

        {/* 受付時間（曜日別） */}
        <section className="rounded-2xl p-5" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
          <h2 className="font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>受付時間</h2>
          <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
            受け付ける曜日をONにして、時間帯を設定してください
          </p>
          <div className="space-y-3">
            {DOW_LABELS.map((label, dow) => {
              const dayRules = rules.filter((r) => r.dayOfWeek === dow);
              const isOn = dayRules.length > 0;
              return (
                <div key={dow} className="flex items-start gap-3">
                  <button
                    onClick={() => toggleDow(dow)}
                    className="flex items-center gap-2 min-w-0 pt-0.5"
                  >
                    <div
                      className="w-10 h-6 rounded-full relative transition-colors flex-shrink-0"
                      style={{ background: isOn ? "var(--color-brand)" : "var(--color-paper-300)" }}
                    >
                      <div
                        className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                        style={{ left: isOn ? "calc(100% - 22px)" : "2px", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
                      />
                    </div>
                    <span className="text-sm w-6 text-left font-medium" style={{ color: isOn ? "var(--color-ink-800)" : "var(--color-ink-400)" }}>
                      {label}
                    </span>
                  </button>
                  {isOn ? (
                    <div className="flex-1 space-y-1.5">
                      {dayRules.map((rule) => (
                        <div key={rule._localId} className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={rule.startTimeLocal}
                            onChange={(e) => updateRule(rule._localId, "startTimeLocal", e.target.value)}
                            className="px-2 py-1 rounded-lg text-sm border flex-1"
                            style={{ borderColor: "var(--color-paper-300)", background: "white" }}
                          />
                          <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>〜</span>
                          <input
                            type="time"
                            value={rule.endTimeLocal}
                            onChange={(e) => updateRule(rule._localId, "endTimeLocal", e.target.value)}
                            className="px-2 py-1 rounded-lg text-sm border flex-1"
                            style={{ borderColor: "var(--color-paper-300)", background: "white" }}
                          />
                          <button
                            onClick={() => removeTimeRange(rule._localId)}
                            className="p-1 rounded-lg flex-shrink-0"
                            style={{ color: "var(--color-ink-400)" }}
                            title="この時間帯を削除"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      {dayRules.length < MAX_RANGES_PER_DAY && (
                        <button
                          onClick={() => addTimeRange(dow)}
                          className="flex items-center gap-1 text-xs font-medium"
                          style={{ color: "var(--color-brand)" }}
                        >
                          <Plus size={12} />
                          時間帯を追加（例: 朝と夜で分けて受付）
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs pt-1.5" style={{ color: "var(--color-ink-400)" }}>受付なし</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 公開設定 */}
        <section className="rounded-2xl p-5" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
          <h2 className="font-bold mb-4" style={{ color: "var(--color-ink-800)" }}>公開設定</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className="w-11 h-6 rounded-full relative transition-colors"
              onClick={() => setIsPublic((v) => !v)}
              style={{ background: isPublic ? "var(--color-brand)" : "var(--color-paper-300)" }}
            >
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                style={{ left: isPublic ? "calc(100% - 22px)" : "2px", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
              />
            </div>
            <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
              予約ページを公開する
            </span>
          </label>
          {!isPublic && (
            <p className="text-xs mt-2" style={{ color: "var(--color-ink-400)" }}>
              OFFにすると公開URLへのアクセスができなくなります
            </p>
          )}
        </section>

        {/* 空き状況の判定ルール */}
        <section className="rounded-2xl p-5" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
          <h2 className="font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>空き状況の判定ルール</h2>
          <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
            Googleカレンダーの予定を、公開URLの空き状況にどう反映するか設定できます
          </p>

          <label className="flex items-start gap-3 cursor-pointer mb-4">
            <div
              className="w-11 h-6 rounded-full relative transition-colors flex-shrink-0 mt-0.5"
              onClick={() => setTreatFreeEventsAsBusy((v) => !v)}
              style={{ background: treatFreeEventsAsBusy ? "var(--color-brand)" : "var(--color-paper-300)" }}
            >
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                style={{ left: treatFreeEventsAsBusy ? "calc(100% - 22px)" : "2px", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
              />
            </div>
            <div>
              <span className="text-sm block" style={{ color: "var(--color-ink-700)" }}>
                「予定なし」の予定も予定ありとみなす
              </span>
              <span className="text-xs block mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                GoogleカレンダーでOFF（予定なし）に設定した予定でも、実際に予定が入っていれば空き時間として案内しません
              </span>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <div
              className="w-11 h-6 rounded-full relative transition-colors flex-shrink-0 mt-0.5"
              onClick={() => setBlockAllDayEvents((v) => !v)}
              style={{ background: blockAllDayEvents ? "var(--color-brand)" : "var(--color-paper-300)" }}
            >
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                style={{ left: blockAllDayEvents ? "calc(100% - 22px)" : "2px", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
              />
            </div>
            <div>
              <span className="text-sm block" style={{ color: "var(--color-ink-700)" }}>
                終日の予定を1日まるごとブロックする
              </span>
              <span className="text-xs block mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                OFFの場合、終日の予定（日付だけ指定したタスク等）があっても、その日の時間帯は予約可能なままにします
              </span>
            </div>
          </label>
        </section>
      </div>
    </div>
  );
}
