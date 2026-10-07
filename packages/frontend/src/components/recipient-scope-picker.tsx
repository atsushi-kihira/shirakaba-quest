// =============================================================
// 宛先の選択（全員／ギルド／チーム／指定）— ミーティング作成時の対象者の選び方と同じ4種類に、
// 「条件」（入会からの期間・登録の有無・機能の利用・連携の設定で絞り込み）を加えた5種類
// =============================================================
import { useState } from "react";
import { useSettings } from "@/hooks/use-settings";

export type RecipientScope = "all" | "team" | "collab_team" | "selected" | "criteria";

/** 「条件」で絞り込むときの入力値。チェックを入れた条件をすべて満たすメンバーが宛先になる */
type JoinedPreset = "none" | "7" | "14" | "30" | "60" | "90" | "180" | "custom";

export type CriteriaValue = {
  joinedOn: boolean;
  /** 入会からの期間の開始（"none" = 指定しない／"custom" = 任意の日数） */
  joinedFrom: JoinedPreset;
  joinedFromCustom: string;
  /** 入会からの期間の終了 */
  joinedTo: JoinedPreset;
  joinedToCustom: string;
  noEnishiOn: boolean;
  noEnishi: "egg" | "goose" | "both";
  noContactsOn: boolean;
  unusedFeatureOn: boolean;
  unusedFeature: string;
  noIntegrationOn: boolean;
  noIntegration: "google" | "zoom" | "both";
};

export const EMPTY_CRITERIA: CriteriaValue = {
  // 開始・終了の両方を指定するのが基本（例: 1か月〜2か月）。片方だけにしたいときは「指定しない」を選ぶ
  joinedOn: false, joinedFrom: "30", joinedFromCustom: "", joinedTo: "60", joinedToCustom: "",
  noEnishiOn: false, noEnishi: "both",
  noContactsOn: false,
  unusedFeatureOn: false, unusedFeature: "",
  noIntegrationOn: false, noIntegration: "both",
};

export type RecipientValue = {
  scope: RecipientScope;
  teamId: string | null;
  collabTeamId: string | null;
  memberIds: string[];
  criteria: CriteriaValue;
};

export type RecipientOptions = {
  teams: { id: string; name: string; emblemEmoji: string; memberCount: number }[];
  collabTeams: { id: string; name: string; type: string; memberCount: number }[];
  members: { id: string; name: string; emoji: string }[];
  features?: { key: string; name: string; emoji: string }[];
};

type DaysResult = { ok: true; days: number | null } | { ok: false };

/** 開始／終了の入力を日数に直す（"none" は未指定=null、入力が不正なら ok:false） */
function parseDays(preset: JoinedPreset, custom: string): DaysResult {
  if (preset === "none") return { ok: true, days: null };
  const n = preset === "custom" ? (custom.trim() === "" ? NaN : Math.floor(Number(custom))) : Number(preset);
  return Number.isFinite(n) && n >= 0 && n <= 3650 ? { ok: true, days: n } : { ok: false };
}

/** 入会期間の入力が正しいか（少なくとも一方を指定、開始は終了以下） */
function joinedRange(c: CriteriaValue): { fromDays: number | null; toDays: number | null } | null {
  const from = parseDays(c.joinedFrom, c.joinedFromCustom);
  const to = parseDays(c.joinedTo, c.joinedToCustom);
  if (!from.ok || !to.ok) return null;
  if (from.days === null && to.days === null) return null;
  if (from.days !== null && to.days !== null && from.days > to.days) return null;
  return { fromDays: from.days, toDays: to.days };
}

/** 条件のうち、入力が揃っている（宛先を確認できる）かどうか */
function criteriaReady(c: CriteriaValue): boolean {
  const any = c.joinedOn || c.noEnishiOn || c.noContactsOn || c.unusedFeatureOn || c.noIntegrationOn;
  if (!any) return false;
  if (c.joinedOn && joinedRange(c) === null) return false;
  if (c.unusedFeatureOn && !c.unusedFeature) return false;
  return true;
}

export function isRecipientReady(v: RecipientValue): boolean {
  return (
    v.scope === "all" ||
    (v.scope === "team" && !!v.teamId) ||
    (v.scope === "collab_team" && !!v.collabTeamId) ||
    (v.scope === "selected" && v.memberIds.length > 0) ||
    (v.scope === "criteria" && criteriaReady(v.criteria))
  );
}

/** APIに送る宛先の形（条件はチェックを入れたものだけを送る） */
export function toRecipientPayload(v: RecipientValue) {
  const c = v.criteria;
  const range = joinedRange(c);
  return {
    scope: v.scope, teamId: v.teamId, collabTeamId: v.collabTeamId, memberIds: v.memberIds,
    criteria: v.scope !== "criteria" ? undefined : {
      joined: c.joinedOn && range ? range : null,
      noEnishi: c.noEnishiOn ? c.noEnishi : null,
      noContacts: c.noContactsOn,
      unusedFeature: c.unusedFeatureOn && c.unusedFeature ? c.unusedFeature : null,
      noIntegration: c.noIntegrationOn ? c.noIntegration : null,
    },
  };
}


const SCOPE_LABEL: Record<RecipientScope, string> = { all: "全員", team: "ギルド", collab_team: "チーム", selected: "指定", criteria: "条件" };

export function RecipientScopePicker({ value, onChange, options }: {
  value: RecipientValue;
  onChange: (v: RecipientValue) => void;
  options: RecipientOptions | undefined;
}) {
  const [search, setSearch] = useState("");
  const members = (options?.members ?? []).filter((m) => !search.trim() || m.name.includes(search.trim()));

  function toggleMember(id: string) {
    onChange({ ...value, memberIds: value.memberIds.includes(id) ? value.memberIds.filter((x) => x !== id) : [...value.memberIds, id] });
  }

  return (
    <div>
      <div className="grid grid-cols-5 gap-2 mb-3">
        {(Object.keys(SCOPE_LABEL) as RecipientScope[]).map((s) => (
          <button key={s} type="button" onClick={() => onChange({ ...value, scope: s })}
            className="py-2 rounded-xl text-sm font-medium"
            style={{
              background: value.scope === s ? "var(--color-brand)" : "var(--color-paper-200)",
              color: value.scope === s ? "white" : "var(--color-ink-600)",
            }}>
            {SCOPE_LABEL[s]}
          </button>
        ))}
      </div>

      {value.scope === "team" && (
        <select value={value.teamId ?? ""} onChange={(e) => onChange({ ...value, teamId: e.target.value || null })}
          className="w-full rounded-xl px-3 py-2 text-sm border" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="">ギルドを選択…</option>
          {(options?.teams ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.emblemEmoji} {t.name}（{t.memberCount}名）</option>
          ))}
        </select>
      )}

      {value.scope === "collab_team" && (
        <select value={value.collabTeamId ?? ""} onChange={(e) => onChange({ ...value, collabTeamId: e.target.value || null })}
          className="w-full rounded-xl px-3 py-2 text-sm border" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="">チームを選択…</option>
          {(options?.collabTeams ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.type === "power" ? "⚡" : "🌱"} {t.name}（{t.memberCount}名）</option>
          ))}
        </select>
      )}

      {value.scope === "criteria" && (
        <CriteriaEditor value={value.criteria} onChange={(criteria) => onChange({ ...value, criteria })} features={options?.features ?? []} />
      )}

      {value.scope === "selected" && (
        <div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前で絞り込み…"
            className="w-full rounded-xl px-3 py-2 text-sm border mb-2" style={{ borderColor: "var(--color-paper-300)" }} />
          <div className="max-h-52 overflow-y-auto space-y-1 rounded-xl p-2" style={{ background: "var(--color-paper-100)" }}>
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm">
                <input type="checkbox" checked={value.memberIds.includes(m.id)} onChange={() => toggleMember(m.id)} />
                <span>{m.emoji} {m.name}</span>
              </label>
            ))}
            {members.length === 0 && <p className="text-xs text-center py-3" style={{ color: "var(--color-ink-400)" }}>該当するメンバーがいません</p>}
          </div>
          <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-500)" }}>{value.memberIds.length}名選択中</p>
        </div>
      )}
    </div>
  );
}

const SELECT_CLS = "rounded-xl px-2 py-1.5 text-sm border";
const SELECT_STYLE = { borderColor: "var(--color-paper-300)", background: "white" };

function CriteriaRow({ checked, onToggle, label, children }: {
  checked: boolean; onToggle: (on: boolean) => void; label: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: checked ? "var(--color-paper-100)" : "transparent", border: "1px solid var(--color-paper-300)" }}>
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        {label}
      </label>
      {checked && children && <div className="mt-2 pl-6 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

function CriteriaEditor({ value, onChange, features }: {
  value: CriteriaValue; onChange: (v: CriteriaValue) => void; features: { key: string; name: string; emoji: string }[];
}) {
  const { termBusinessCommunity } = useSettings();
  const set = (patch: Partial<CriteriaValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
        チェックを入れた条件を<strong>すべて満たす</strong>メンバーに配信します（承認済みのメンバーが対象）。
      </p>

      <CriteriaRow checked={value.joinedOn} onToggle={(on) => set({ joinedOn: on })} label={`${termBusinessCommunity}入会からの期間で選ぶ`}>
        <JoinedBound label="開始" preset={value.joinedFrom} custom={value.joinedFromCustom}
          onPreset={(v) => set({ joinedFrom: v })} onCustom={(v) => set({ joinedFromCustom: v })} />
        <span className="text-sm">から</span>
        <JoinedBound label="終了" preset={value.joinedTo} custom={value.joinedToCustom}
          onPreset={(v) => set({ joinedTo: v })} onCustom={(v) => set({ joinedToCustom: v })} />
        <span className="text-sm">まで</span>
        <span className="text-xs w-full" style={{ color: "var(--color-ink-500)" }}>
          {joinedSummary(value)}
        </span>
        <span className="text-xs w-full" style={{ color: "var(--color-ink-400)" }}>
          ※ メンバーが登録した{termBusinessCommunity}の入会日から数えます（入会日が未入力の人は対象外です）。
          開始だけ・終了だけにしたいときは、もう一方を「指定しない」にしてください。
        </span>
      </CriteriaRow>

      <CriteriaRow checked={value.noEnishiOn} onToggle={(on) => set({ noEnishiOn: on })} label="金の卵・金のガチョウの登録がない人">
        <select value={value.noEnishi} onChange={(e) => set({ noEnishi: e.target.value as CriteriaValue["noEnishi"] })}
          className={SELECT_CLS} style={SELECT_STYLE}>
          <option value="both">どちらも登録がない</option>
          <option value="egg">金の卵の登録がない</option>
          <option value="goose">金のガチョウの登録がない</option>
        </select>
      </CriteriaRow>

      <CriteriaRow checked={value.noContactsOn} onToggle={(on) => set({ noContactsOn: on })} label="外部人脈の登録がない人" />

      <CriteriaRow checked={value.unusedFeatureOn} onToggle={(on) => set({ unusedFeatureOn: on })} label="特定の機能の利用がない人">
        <select value={value.unusedFeature} onChange={(e) => set({ unusedFeature: e.target.value })}
          className={SELECT_CLS} style={SELECT_STYLE}>
          <option value="">機能を選択…</option>
          {features.map((f) => <option key={f.key} value={f.key}>{f.emoji} {f.name}</option>)}
        </select>
        <span className="text-xs">をまだ一度も使っていない</span>
      </CriteriaRow>

      <CriteriaRow checked={value.noIntegrationOn} onToggle={(on) => set({ noIntegrationOn: on })} label="Google・Zoom連携が設定されていない人">
        <select value={value.noIntegration} onChange={(e) => set({ noIntegration: e.target.value as CriteriaValue["noIntegration"] })}
          className={SELECT_CLS} style={SELECT_STYLE}>
          <option value="both">どちらも未設定</option>
          <option value="google">Googleが未設定</option>
          <option value="zoom">Zoomが未設定</option>
        </select>
      </CriteriaRow>
    </div>
  );
}

const JOINED_OPTIONS: { value: JoinedPreset; label: string }[] = [
  { value: "none", label: "指定しない" },
  { value: "7", label: "1週間" },
  { value: "14", label: "2週間" },
  { value: "30", label: "1か月" },
  { value: "60", label: "2か月" },
  { value: "90", label: "3か月" },
  { value: "180", label: "6か月" },
  { value: "custom", label: "任意の日数" },
];

function JoinedBound({ label, preset, custom, onPreset, onCustom }: {
  label: string; preset: JoinedPreset; custom: string; onPreset: (v: JoinedPreset) => void; onCustom: (v: string) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <select aria-label={`入会からの期間の${label}`} value={preset} onChange={(e) => onPreset(e.target.value as JoinedPreset)}
        className={SELECT_CLS} style={SELECT_STYLE}>
        {JOINED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{label}：{o.label}</option>)}
      </select>
      {preset === "custom" && (
        <span className="flex items-center gap-1 text-sm">
          <input type="number" min={0} max={3650} value={custom} onChange={(e) => onCustom(e.target.value)}
            className={`${SELECT_CLS} w-20`} style={SELECT_STYLE} placeholder="45" />日
        </span>
      )}
    </span>
  );
}

/** 選んだ期間を、文章で確認できるようにする */
function joinedSummary(c: CriteriaValue): string {
  const from = parseDays(c.joinedFrom, c.joinedFromCustom);
  const to = parseDays(c.joinedTo, c.joinedToCustom);
  if (!from.ok || !to.ok) return "日数を入力してください";
  const f = from.days, t = to.days;
  if (f === null && t === null) return "開始か終了のどちらかは指定してください";
  if (f !== null && t !== null && f > t) return "開始は、終了より短い期間にしてください";
  const label = (d: number) => JOINED_OPTIONS.find((o) => o.value === String(d))?.label ?? `${d}日`;
  if (f !== null && t !== null) return `→ 入会から ${label(f)} 以上 ${label(t)} 以内の人`;
  if (f !== null) return `→ 入会から ${label(f)} 以上たった人`;
  return `→ 入会から ${label(t!)} 以内の人`;
}
