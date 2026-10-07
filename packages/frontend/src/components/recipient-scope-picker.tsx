// =============================================================
// 宛先の選択（全員／ギルド／チーム／指定）— ミーティング作成時の対象者の選び方と同じ4種類
// =============================================================
import { useState } from "react";

export type RecipientScope = "all" | "team" | "collab_team" | "selected";

export type RecipientValue = {
  scope: RecipientScope;
  teamId: string | null;
  collabTeamId: string | null;
  memberIds: string[];
};

export type RecipientOptions = {
  teams: { id: string; name: string; emblemEmoji: string; memberCount: number }[];
  collabTeams: { id: string; name: string; type: string; memberCount: number }[];
  members: { id: string; name: string; emoji: string }[];
};

const SCOPE_LABEL: Record<RecipientScope, string> = { all: "全員", team: "ギルド", collab_team: "チーム", selected: "指定" };

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
      <div className="grid grid-cols-4 gap-2 mb-3">
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
