// =============================================================
// 予定のリマインド通知の設定（1to1・ミーティング・定例会）
//   ・ReminderDefaultsRow … マイページの「初期設定」（プッシュ通知の次の行）（何日前に、どの方法で）
//   ・EventReminderSetting … 各予定のページで、その予定だけの設定（なければ初期設定が使われる）
// リマインドは、受け取る本人が決める。主催者や相手が、他の人の設定を変えることはできない。
// 初期設定は「1日前の8時・ホーム画面とメールの両方」。何日前の何時かは最大2つまで（例：3日前の9時と、1日前の9時。分は指定しない）。
// =============================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export type ReminderChannel = "home" | "email" | "both";
export type ReminderItem = { days: number; hour: number };
export type ReminderValue = { items: ReminderItem[]; channel: ReminderChannel };
export type ReminderTargetKind = "oneonone" | "meeting" | "series" | "booking";

const MAX_DAYS = 14;
const CHANNELS: { value: ReminderChannel; label: string }[] = [
  { value: "home", label: "ホーム画面" },
  { value: "email", label: "メール" },
  { value: "both", label: "両方" },
];

const DEFAULT_HOUR = 8;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function describeReminder(v: ReminderValue): string {
  if (v.items.length === 0) return "リマインドを受け取らない";
  const when = [...v.items].sort((a, b) => b.days - a.days).map((i) => `${i.days}日前の${i.hour}時`).join("・");
  return `${when} ／ ${CHANNELS.find((c) => c.value === v.channel)?.label ?? ""}で通知`;
}

const selectStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;

/** 何日前の何時か（最大2つ）と、届け方を選ぶ部分 */
function ReminderFields({ value, onChange }: { value: ReminderValue; onChange: (v: ReminderValue) => void }) {
  const enabled = value.items.length > 0;
  const sorted = [...value.items].sort((a, b) => b.days - a.days);
  const first = sorted[0] ?? { days: 1, hour: DEFAULT_HOUR };
  const second = sorted[1] ?? null;
  const set = (a: ReminderItem, b: ReminderItem | null) => onChange({ ...value, items: b ? [a, b] : [a] });
  const dayOptions = (exclude: number | null) => Array.from({ length: MAX_DAYS }, (_, i) => i + 1).filter((d) => d !== exclude);
  const hourSelect = (hour: number, onHour: (h: number) => void, label: string) => (
    <select value={hour} onChange={(e) => onHour(Number(e.target.value))}
      className="px-3 py-2 rounded-xl border text-sm" style={selectStyle} aria-label={label}>
      {HOURS.map((h) => <option key={h} value={h}>{h}時</option>)}
    </select>
  );

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-800)" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onChange({ ...value, items: e.target.checked ? [{ days: 1, hour: DEFAULT_HOUR }] : [] })} className="w-4 h-4" />
        リマインドを受け取る
      </label>
      {enabled && (
        <>
          <div className="space-y-2 text-sm" style={{ color: "var(--color-ink-700)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <select value={first.days}
                onChange={(e) => { const d = Number(e.target.value); set({ ...first, days: d }, second && second.days === d ? null : second); }}
                className="px-3 py-2 rounded-xl border text-sm" style={selectStyle} aria-label="1つ目のリマインド（何日前）">
                {dayOptions(second?.days ?? null).map((d) => <option key={d} value={d}>{d}日前</option>)}
              </select>
              {hourSelect(first.hour, (h) => set({ ...first, hour: h }, second), "1つ目のリマインド（何時）")}
              <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>に通知</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={second?.days ?? 0}
                onChange={(e) => { const d = Number(e.target.value); set(first, d === 0 ? null : { days: d, hour: second?.hour ?? first.hour }); }}
                className="px-3 py-2 rounded-xl border text-sm" style={selectStyle} aria-label="2つ目のリマインド（何日前）">
                <option value={0}>（追加しない）</option>
                {dayOptions(first.days).map((d) => <option key={d} value={d}>{d}日前</option>)}
              </select>
              {second && hourSelect(second.hour, (h) => set(first, { ...second, hour: h }), "2つ目のリマインド（何時）")}
              {second && <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>に通知</span>}
            </div>
          </div>
          <div>
            <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-500)" }}>通知の方法</p>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <button key={c.value} type="button" onClick={() => onChange({ ...value, channel: c.value })}
                  className="px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{
                    background: value.channel === c.value ? "var(--color-brand)" : "var(--color-paper-200)",
                    color: value.channel === c.value ? "white" : "var(--color-ink-600)",
                  }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "保存できませんでした。時間をおいてもう一度お試しください");

// ---- マイページ：初期設定 ----
type SettingsResponse = { data: ReminderValue & { isDefault: boolean } };

export function ReminderDefaultsRow() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["reminders", "settings"], queryFn: () => api.get<SettingsResponse>("/reminders/settings") });
  const [draft, setDraft] = useState<ReminderValue | null>(null);
  const current: ReminderValue | null = draft ?? (data ? { items: data.data.items, channel: data.data.channel } : null);
  const save = useMutation({
    mutationFn: (v: ReminderValue) => api.put<SettingsResponse>("/reminders/settings", v),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ["reminders"] }); },
  });

  return (
    <div className="mt-2 flex items-start gap-3 px-3 py-2.5 rounded-2xl" style={{ background: "var(--color-paper-100)" }}>
      <span className="text-lg">⏰</span>
      <div className="flex-1 min-w-0">
      <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>リマインド通知</div>
      <p className="text-xs mt-0.5 mb-3 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
        日時が決まっている1to1・ミーティング・定例会について、事前にお知らせします（あなたが参加するものだけです）。
        ここで決めた内容が、すべての予定の初期設定になります。予定ごとに変えたいときは、各予定のページで設定できます。
      </p>
      {!current ? (
        <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>
      ) : (
        <div className="space-y-3">
          <ReminderFields value={current} onChange={setDraft} />
          {draft && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => save.mutate(draft)} disabled={save.isPending}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-60" style={{ background: "var(--color-brand)" }}>
                {save.isPending ? "保存中…" : "保存する"}
              </button>
              <button type="button" onClick={() => setDraft(null)} className="px-3 py-2 rounded-xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                やめる
              </button>
            </div>
          )}
          {save.isError && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{errText(save.error)}</p>}
          {!draft && save.isSuccess && <p className="text-xs" style={{ color: "var(--color-success)" }}>✅ 保存しました</p>}
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
            ホーム画面では「もうすぐの予定」に表示されます。メールは、登録のメールアドレスに届きます。
          </p>
        </div>
      )}
      </div>
    </div>
  );
}

// ---- 各予定のページ：その予定だけの設定 ----
type TargetResponse = { data: ReminderValue & { source: "own" | "series" | "default"; seriesId: string | null; defaults: ReminderValue } };

type EventProps = { kind: ReminderTargetKind; id: string; className?: string; ownLabel?: string };

export function EventReminderSetting({ kind, id, className, ownLabel }: EventProps) {
  const qc = useQueryClient();
  const key = ["reminders", "target", kind, id];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.get<TargetResponse>(`/reminders/target?kind=${kind}&id=${encodeURIComponent(id)}`),
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReminderValue>({ items: [{ days: 1, hour: DEFAULT_HOUR }], channel: "both" });
  const done = () => { setEditing(false); qc.invalidateQueries({ queryKey: key }); };
  const save = useMutation({ mutationFn: (v: ReminderValue) => api.put("/reminders/target", { kind, id, ...v }), onSuccess: done });
  const reset = useMutation({ mutationFn: () => api.delete(`/reminders/target?kind=${kind}&id=${encodeURIComponent(id)}`), onSuccess: done });

  if (!data) return null;
  const v = data.data;
  const sourceNote = v.source === "own" ? (ownLabel ?? "この予定だけの設定") : v.source === "series" ? "定例会全体の設定" : "初期設定（マイページで変更できます）";

  return (
    <div className={`card-paper rounded-2xl p-4 ${className ?? ""}`}>
      <div className="flex items-start gap-2">
        <Bell size={16} className="mt-0.5 shrink-0" style={{ color: "var(--color-accent)" }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>リマインド（あなたへの通知）</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-600)" }}>{describeReminder(v)}</p>
          <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>{sourceNote}</p>
        </div>
        {!editing && (
          <button type="button" onClick={() => { setDraft({ items: v.items, channel: v.channel }); setEditing(true); }}
            className="text-xs underline shrink-0" style={{ color: "var(--color-brand)" }}>変更</button>
        )}
      </div>
      {editing && (
        <div className="mt-3 pt-3 space-y-3" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
          <ReminderFields value={draft} onChange={setDraft} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => save.mutate(draft)} disabled={save.isPending}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-60" style={{ background: "var(--color-brand)" }}>
              {save.isPending ? "保存中…" : "この設定にする"}
            </button>
            {v.source === "own" && (
              <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending}
                className="px-3 py-2 rounded-xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                初期設定に戻す
              </button>
            )}
            <button type="button" onClick={() => setEditing(false)} className="px-3 py-2 rounded-xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
              やめる
            </button>
          </div>
          {(save.isError || reset.isError) && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{errText(save.error ?? reset.error)}</p>}
        </div>
      )}
    </div>
  );
}
