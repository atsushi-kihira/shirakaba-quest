// SC-04 自分の調整カレンダー設定画面
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Plus, Trash2, Loader2, ArrowLeft, Copy, Check } from "lucide-react";
import { request, ApiError } from "@/lib/api";

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const DEFAULT_HOURS = { start: "09:00", end: "18:00" };

type Settings = {
  memberId: string;
  slug: string;
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
};

type Rule = {
  id?: string;
  dayOfWeek: number;
  startTimeLocal: string;
  endTimeLocal: string;
};

type PublicUrlData = { slug: string | null; publicUrl: string | null };

export function SchedulerSettingsScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: settingsData } = useQuery<{ data: Settings | null }>({
    queryKey: ["scheduler", "settings"],
    queryFn: () => request("/scheduler/me/settings"),
  });

  const { data: rulesData } = useQuery<{ data: Rule[] }>({
    queryKey: ["scheduler", "availability-rules"],
    queryFn: () => request("/scheduler/me/availability-rules"),
  });

  const { data: publicUrlData } = useQuery<{ data: PublicUrlData }>({
    queryKey: ["scheduler", "public-url"],
    queryFn: () => request("/scheduler/me/public-url"),
  });

  const settings = settingsData?.data;

  // フォーム状態
  const [slug, setSlug] = useState("");
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

  // 受付時間ルール
  const [rules, setRules] = useState<Rule[]>([]);

  // settings ロード時にフォーム初期化
  useEffect(() => {
    if (settings) {
      setSlug(settings.slug ?? "");
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
    }
  }, [settings]);

  useEffect(() => {
    if (rulesData?.data) setRules(rulesData.data);
  }, [rulesData]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      await request("/scheduler/me/settings", {
        method: "PUT",
        body: {
          slug: slug || undefined,
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
      const exists = prev.find((r) => r.dayOfWeek === dow);
      if (exists) return prev.filter((r) => r.dayOfWeek !== dow);
      return [...prev, { dayOfWeek: dow, startTimeLocal: DEFAULT_HOURS.start, endTimeLocal: DEFAULT_HOURS.end }]
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    });
  };

  const updateRule = (dow: number, field: "startTimeLocal" | "endTimeLocal", value: string) => {
    setRules((prev) =>
      prev.map((r) => (r.dayOfWeek === dow ? { ...r, [field]: value } : r))
    );
  };

  const publicUrl = publicUrlData?.data.publicUrl;

  const copyUrl = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button
        onClick={() => navigate("/scheduler")}
        className="flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={16} />
        スケジューラーに戻る
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--color-ink-900)" }}>
          ⚙️ 受付時間の設定
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

      {/* 公開 URL */}
      {publicUrl && (
        <div className="rounded-2xl p-4 mb-5" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
          <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-500)" }}>公開URL（このURLを相手にシェアします）</p>
          <div className="flex items-center gap-2">
            <code className="text-sm flex-1 truncate" style={{ color: "var(--color-ink-700)" }}>{publicUrl}</code>
            <button onClick={copyUrl} className="p-1.5 rounded-lg" style={{ background: "var(--color-paper-200)" }}>
              {copiedUrl ? <Check size={14} style={{ color: "var(--color-success)" }} /> : <Copy size={14} />}
            </button>
          </div>
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
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--color-ink-600)" }}>
                URL スラッグ（公開URLの末尾）
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                className="w-full px-3 py-2 rounded-xl text-sm border"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
                placeholder="kihira"
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
          <div className="space-y-2">
            {DOW_LABELS.map((label, dow) => {
              const rule = rules.find((r) => r.dayOfWeek === dow);
              const isOn = !!rule;
              return (
                <div key={dow} className="flex items-center gap-3">
                  <button
                    onClick={() => toggleDow(dow)}
                    className="flex items-center gap-2 min-w-0"
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
                  {isOn && (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        type="time"
                        value={rule.startTimeLocal}
                        onChange={(e) => updateRule(dow, "startTimeLocal", e.target.value)}
                        className="px-2 py-1 rounded-lg text-sm border flex-1"
                        style={{ borderColor: "var(--color-paper-300)", background: "white" }}
                      />
                      <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>〜</span>
                      <input
                        type="time"
                        value={rule.endTimeLocal}
                        onChange={(e) => updateRule(dow, "endTimeLocal", e.target.value)}
                        className="px-2 py-1 rounded-lg text-sm border flex-1"
                        style={{ borderColor: "var(--color-paper-300)", background: "white" }}
                      />
                    </div>
                  )}
                  {!isOn && <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>受付なし</span>}
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
      </div>
    </div>
  );
}
