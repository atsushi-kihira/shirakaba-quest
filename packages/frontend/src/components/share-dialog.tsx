// =============================================================
// 共有の設定ダイアログ（読み取り専用で、他の人に見せる）
//   自分だけ ／ 指定した人だけ（個別・ギルド・チーム） ／ 白樺クエストのメンバー全員 ／ URLを知っている人全員
// API：/api/shares/setting/:kind/:subjectId（backend: routes/shares.ts）
// =============================================================
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Link2, Loader2, Lock, Share2, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";

export type ShareKind = "team_profile" | "contacts" | "team_draft" | "enishi_result";
type Scope = "private" | "selected" | "members" | "link";

type Setting = {
  scope: Scope; memberIds: string[]; guildIds: string[]; collabTeamIds: string[];
  linkToken: string | null; title: string; url: string | null; viewPath: string;
};
type Options = {
  members: { id: string; name: string; emoji: string }[];
  guilds: { id: string; name: string; emblemEmoji: string }[];
  collabTeams: { id: string; name: string; type: string }[];
};

const settingKey = (kind: ShareKind, id: string) => ["shares", "setting", kind, id] as const;

/** 共有の範囲の説明。ひらがな中心でやさしく書く */
const SCOPE_INFO: { value: Scope; icon: typeof Lock; label: string; help: string }[] = [
  { value: "private", icon: Lock, label: "自分だけ", help: "いまのまま。他の人には見えません" },
  { value: "selected", icon: Users, label: "指定した人だけ", help: "選んだ人・ギルド・チームの人だけが見られます" },
  { value: "members", icon: Users, label: "白樺クエストのメンバー全員", help: "ログインしているメンバーなら、だれでも見られます" },
  { value: "link", icon: Globe, label: "URLを知っている人全員", help: "ログインしていない人も、URLを知っていれば見られます" },
];

const errMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function ShareDialog({ kind, subjectId, onClose }: { kind: ShareKind; subjectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const settingQ = useQuery({
    queryKey: settingKey(kind, subjectId),
    queryFn: () => api.get<{ data: Setting }>(`/shares/setting/${kind}/${subjectId}`).then((r) => r.data),
  });
  const optionsQ = useQuery({
    queryKey: ["shares", "options"],
    queryFn: () => api.get<{ data: Options }>("/shares/options").then((r) => r.data),
  });

  const [scope, setScope] = useState<Scope>("private");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [guildIds, setGuildIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<Setting | null>(null);

  // 保存されている設定を、入力欄に反映する（最初の1回だけ）
  const current = settingQ.data;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!current || loaded) return;
    setScope(current.scope); setMemberIds(current.memberIds); setGuildIds(current.guildIds); setTeamIds(current.collabTeamIds);
    setLoaded(true);
  }, [current, loaded]);

  const save = useMutation({
    mutationFn: (regenerateLink: boolean) => api.put<{ data: Setting }>(`/shares/setting/${kind}/${subjectId}`, {
      scope, memberIds, guildIds, collabTeamIds: teamIds, regenerateLink,
    }).then((r) => r.data),
    onSuccess: (s) => {
      setSaved(s); setError("");
      qc.setQueryData(settingKey(kind, subjectId), s);
      qc.invalidateQueries({ queryKey: ["shares", "with-me"] });
    },
    onError: (e) => setError(errMessage(e, "共有の設定を保存できませんでした。もう一度お試しください")),
  });

  const members = useMemo(() => {
    const q = filter.trim();
    const all = optionsQ.data?.members ?? [];
    return q ? all.filter((m) => m.name.includes(q)) : all;
  }, [optionsQ.data, filter]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const shown = saved ?? current;
  const url = shown?.scope === "link" ? shown.url : null;
  const dirty = !!current && (
    scope !== current.scope
    || JSON.stringify([...memberIds].sort()) !== JSON.stringify([...current.memberIds].sort())
    || JSON.stringify([...guildIds].sort()) !== JSON.stringify([...current.guildIds].sort())
    || JSON.stringify([...teamIds].sort()) !== JSON.stringify([...current.collabTeamIds].sort())
  );

  async function copyUrl() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError("コピーできませんでした。URLを選んで、手でコピーしてください"); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-md rounded-3xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            <Share2 size={18} className="inline -mt-1 mr-1.5" />共有する
          </h2>
          <DialogCloseButton onClick={onClose} />
        </div>
        {current && <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-700)" }}>{current.title}</p>}
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-400)" }}>共有された人は、見るだけです。内容を変えることはできません。</p>

        {settingQ.isLoading && <div className="py-8 flex justify-center"><Loader2 className="animate-spin" size={22} style={{ color: "var(--color-ink-400)" }} /></div>}
        {settingQ.isError && (
          <p className="text-sm py-4" style={{ color: "var(--color-danger, #b00020)" }}>{errMessage(settingQ.error, "共有の設定を読み込めませんでした。時間をおいて、もう一度お試しください")}</p>
        )}

        {current && (
          <>
            <div className="space-y-2 mb-4" role="radiogroup" aria-label="共有の範囲">
              {SCOPE_INFO.map(({ value, icon: Icon, label, help }) => {
                const on = scope === value;
                return (
                  <button key={value} type="button" role="radio" aria-checked={on} onClick={() => { setScope(value); setError(""); }}
                    className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-2xl border transition"
                    style={{ borderColor: on ? "var(--color-brand)" : "var(--color-paper-300)", background: on ? "var(--color-paper-100)" : "transparent" }}>
                    <Icon size={18} className="mt-0.5 shrink-0" style={{ color: on ? "var(--color-brand)" : "var(--color-ink-400)" }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium" style={{ color: "var(--color-ink-900)" }}>{label}</span>
                      <span className="block text-xs" style={{ color: "var(--color-ink-500)" }}>{help}</span>
                    </span>
                    {on && <Check size={16} className="mt-0.5 shrink-0" style={{ color: "var(--color-brand)" }} />}
                  </button>
                );
              })}
            </div>

            {scope === "selected" && (
              <div className="mb-4 space-y-3">
                {optionsQ.isLoading && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>選べる人を読み込んでいます…</p>}
                {(optionsQ.data?.guilds.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ギルド（{guildIds.length}件選択中）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {optionsQ.data!.guilds.map((g) => {
                        const on = guildIds.includes(g.id);
                        return (
                          <button key={g.id} type="button" aria-pressed={on} onClick={() => toggle(guildIds, setGuildIds, g.id)}
                            className="px-3 py-1.5 rounded-full text-xs border transition"
                            style={{ borderColor: on ? "var(--color-brand)" : "var(--color-paper-300)", background: on ? "var(--color-brand)" : "transparent", color: on ? "white" : "var(--color-ink-600)" }}>
                            {g.emblemEmoji} {g.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(optionsQ.data?.collabTeams.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>チーム（{teamIds.length}件選択中）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {optionsQ.data!.collabTeams.map((t) => {
                        const on = teamIds.includes(t.id);
                        return (
                          <button key={t.id} type="button" aria-pressed={on} onClick={() => toggle(teamIds, setTeamIds, t.id)}
                            className="px-3 py-1.5 rounded-full text-xs border transition"
                            style={{ borderColor: on ? "var(--color-brand)" : "var(--color-paper-300)", background: on ? "var(--color-brand)" : "transparent", color: on ? "white" : "var(--color-ink-600)" }}>
                            {t.type === "power" ? "⚡" : "🌿"} {t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>個別に選ぶ（{memberIds.length}名選択中）</p>
                  <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="名前でさがす"
                    className="w-full px-3 py-2 rounded-xl border text-sm mb-2" style={{ borderColor: "var(--color-paper-300)" }} />
                  <div className="max-h-44 overflow-y-auto space-y-0.5 rounded-xl p-2" style={{ background: "var(--color-paper-200)" }}>
                    {members.length === 0 && <p className="text-xs px-2 py-1" style={{ color: "var(--color-ink-400)" }}>該当する人がいません</p>}
                    {members.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:opacity-80">
                        <input type="checkbox" checked={memberIds.includes(m.id)} onChange={() => toggle(memberIds, setMemberIds, m.id)} />
                        <span className="text-sm">{m.emoji} {m.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {scope === "link" && (
              <div className="mb-4 rounded-2xl p-3 text-xs space-y-2" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <p>⚠️ URLを知っている人は、だれでも見られます。送る相手に気をつけてください。共有をやめれば、URLは使えなくなります。</p>
                {url ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Link2 size={14} className="shrink-0" />
                      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="共有のURL"
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border text-xs bg-white" style={{ borderColor: "var(--color-paper-300)" }} />
                      <button type="button" onClick={copyUrl} className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium text-white" style={{ background: "var(--color-brand)" }}>
                        {copied ? "コピーしました" : <><Copy size={12} className="inline -mt-0.5 mr-1" />コピー</>}
                      </button>
                    </div>
                    <button type="button" disabled={save.isPending}
                      onClick={() => { if (window.confirm("URLを作り直しますか？\nこれまでのURLは、使えなくなります。")) save.mutate(true); }}
                      className="underline disabled:opacity-50" style={{ color: "var(--color-ink-500)" }}>URLを作り直す</button>
                  </>
                ) : (
                  <p>「保存」を押すと、共有のURLができます。</p>
                )}
              </div>
            )}

            {error && <p className="text-sm mb-3" role="alert" style={{ color: "var(--color-danger, #b00020)" }}>{error}</p>}
            {saved && !dirty && !error && <p className="text-sm mb-3" style={{ color: "var(--color-success)" }}>✅ 保存しました</p>}

            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>閉じる</button>
              <button type="button" disabled={save.isPending || !dirty} onClick={() => save.mutate(false)}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
                {save.isPending && <Loader2 size={14} className="animate-spin" />}保存
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 共有ボタン。押すと、共有の設定ダイアログを開く */
export function ShareButton({ kind, subjectId, label = "共有する" }: { kind: ShareKind; subjectId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition hover:opacity-80"
        style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)", background: "var(--color-paper-100)" }}>
        <Share2 size={13} />{label}
      </button>
      {open && <ShareDialog kind={kind} subjectId={subjectId} onClose={() => setOpen(false)} />}
    </>
  );
}
