// =============================================================
// チーム育成の画面：AIによる再検討（誰でも実行できる）と、提案の反映（リーダーが、情報ごとに選ぶ）
//   ・結果は「提案」として履歴に残る。反映するまで、プロフィールや役割は変わらない
//   ・反映の単位：事業内容／役割分担（人ごと）／最初の一歩／追加メンバー候補／追加したい人材／候補の見送り
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import { PERSPECTIVE_LABEL, type Perspective, type Proposal, type WsCtx, type WsDetail } from "./_ws-types";

const fmtTime = (sec: number) => new Date(sec * 1000).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

const OPTIONS: { key: Perspective; emoji: string; label: string; hint: string }[] = [
  { key: "broaden", emoji: "🌈", label: "協働ビジネスの幅を広げる", hint: "対象のお客様や提供の形など、別の可能性も取り入れて内容を広げます。ほかの切り口のアイデアも出します。" },
  { key: "suggest_members", emoji: "👥", label: "追加するメンバーを提案してもらう", hint: "メンバーや自分の外部人脈の中から、加えるとよさそうな人を提案します。" },
  { key: "new_member_roles", emoji: "➕", label: "役割が未入力の人の役割を考えてもらう", hint: "あとから加えた人など、役割がまだない人の役割を、ほかのメンバーとのつながりも踏まえて考えます。" },
  { key: "reassign_roles", emoji: "🔄", label: "役割の割り振りを見直す", hint: "確定した人は必ず含め、全員の強みがより活きるように役割を組み直します。" },
];

// ---- 再検討を実行するダイアログ ----
export function RunModal({ ctx, onClose, onDone }: { ctx: WsCtx; onClose: () => void; onDone: (res: { data: WsDetail }) => void }) {
  const { d } = ctx;
  const used = d.type === "draft" ? d.members.length + d.prospects.length : d.prospects.length;
  const full = used >= d.maxPeople;
  const noRole = [...d.members.filter((m) => m.status === "active"), ...d.prospects.filter((p) => !p.filled)].filter((x) => !x.role).length;
  const [sel, setSel] = useState<Set<Perspective>>(() => new Set(noRole > 0 ? (["new_member_roles"] as Perspective[]) : []));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const off = (k: Perspective): string | null => {
    if (k === "suggest_members" && full) return `人数が上限（${d.maxPeople}名）のため、提案できません`;
    if (k === "new_member_roles" && noRole === 0) return "役割が未入力の人はいません";
    return null;
  };
  const run = useMutation({
    mutationFn: () => api.post<{ data: WsDetail }>(`${ctx.base}/proposals`, { perspectives: OPTIONS.map((o) => o.key).filter((k) => sel.has(k) && !off(k)), note: note.trim() }),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); onDone(res); },
    onError: (e) => setError(e instanceof Error ? e.message : "AIで再検討できませんでした。少し時間をおいて、もう一度お試しください。"),
  });
  const toggle = (k: Perspective) => setSel((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => { if (!run.isPending) onClose(); }}>
      <div className="card-paper p-5 w-full max-w-md rounded-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>✨ AIで再検討する</h2>
          <DialogCloseButton onClick={onClose} disabled={run.isPending} />
        </div>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
          AIに伝える「追加の観点」を選べます（いくつでも）。結果は<b>提案</b>として残り、反映するかどうかは<b>{d.stage === "draft" ? "あなたが" : "リーダーが"}</b>選びます。何も選ばなければ、いまの内容をもとに考え直します。
        </p>
        <div className="space-y-2 mb-3">
          {OPTIONS.map((o) => {
            const reason = off(o.key);
            const on = sel.has(o.key) && !reason;
            return (
              <label key={o.key} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-2xl border ${reason ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                style={{ borderColor: on ? "var(--color-brand)" : "var(--color-paper-300)", background: on ? "rgba(181,56,75,0.06)" : "var(--color-paper-50)" }}>
                <input type="checkbox" checked={on} disabled={!!reason || run.isPending} onChange={() => toggle(o.key)} className="mt-1 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{o.emoji} {o.label}</span>
                  <span className="block text-xs leading-relaxed" style={{ color: "var(--color-ink-500)" }}>{reason ?? o.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>💬 さらに伝えたい観点（任意）</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} disabled={run.isPending}
          placeholder="例：個人のお客様向けではなく、企業向けのサービスとして考えたい／最初は小さく始められる形にしたい"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />
        {error && <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}
        {run.isPending && <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>AIが、選んだ観点も取り入れて考えています…（少し時間がかかります）</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={run.isPending} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium disabled:opacity-50" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => { setError(null); run.mutate(); }} disabled={run.isPending || d.aiRunsLeft <= 0} className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
            {run.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}再検討する
          </button>
        </div>
        <p className="text-[11px] text-center mt-2" style={{ color: "var(--color-ink-400)" }}>このチームの、今日の残り回数：あと{d.aiRunsLeft}回（1日5回まで）</p>
      </div>
    </div>
  );
}

// ---- 提案の履歴 ----
export function ProposalsCard({ ctx, onRun, onOpen, running }: { ctx: WsCtx; onRun: () => void; onOpen: (p: Proposal) => void; running: boolean }) {
  const { d } = ctx;
  if (!d.access.isActive) return null;
  return (
    <section className="card-paper rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-bold" style={{ color: "var(--color-ink-800)" }}>💡 AIによる再検討</h2>
        <button onClick={onRun} disabled={running} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
          {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}AIで再検討する
        </button>
      </div>
      <p className="text-[11px] mb-2.5" style={{ color: "var(--color-ink-500)" }}>
        事業の内容・追加メンバー・役割分担などを、AIに考え直してもらえます。{d.stage === "draft" ? "" : "実行は参加中のメンバーなら誰でもできます。"}
        結果は提案として残り、<b>{d.stage === "draft" ? "あなた" : "リーダー"}が確認して、反映するものを選びます</b>。
      </p>
      {d.proposals.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>まだ再検討していません。</p>
      ) : (
        <ul className="space-y-1.5">
          {d.proposals.map((p) => {
            const discarded = p.applied.discarded;
            const chip = discarded ? { t: "破棄", c: "var(--color-ink-400)" } : p.status === "closed" ? { t: "反映済み", c: "var(--color-success)" } : { t: `反映待ち（残り${p.remaining}件）`, c: "var(--color-accent)" };
            return (
              <li key={p.id} className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: "var(--color-paper-100)" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs" style={{ color: "var(--color-ink-700)" }}>
                    <b>{p.createdBy.name}さん</b>が {fmtTime(p.createdAt)} に実行
                    {(p.perspectives.length > 0 || p.note) && <span style={{ color: "var(--color-ink-500)" }}>（{[...p.perspectives.map((x) => PERSPECTIVE_LABEL[x]), ...(p.note ? [`「${p.note}」`] : [])].join("、")}）</span>}
                  </p>
                  <p className="text-[11px] font-bold mt-0.5" style={{ color: chip.c }}>{chip.t}{p.stale && p.status === "open" && <span className="font-normal ml-2" style={{ color: "var(--color-ink-400)" }}>※実行後に内容が変わっています</span>}</p>
                </div>
                {p.ideas && (
                  <button onClick={() => onOpen(p)} className="text-xs px-2.5 py-1 rounded-lg shrink-0 font-medium" style={{ background: p.status === "open" && d.access.canApply ? "var(--color-brand)" : "var(--color-paper-200)", color: p.status === "open" && d.access.canApply ? "#fff" : "var(--color-ink-600)" }}>
                    {p.status === "open" && d.access.canApply ? "確認して反映" : "内容を見る"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---- 提案を確認して、情報ごとに反映を選ぶダイアログ ----
type Sel = { business: boolean; altIndex: number | null; roles: Set<string>; firstSteps: Set<number>; addActionItems: boolean; addCandidates: Set<string>; addTalents: Set<number>; dismiss: Set<string> };

export function ApplyModal({ ctx, proposal, onClose }: { ctx: WsCtx; proposal: Proposal; onClose: () => void }) {
  const { d } = ctx;
  const ideas = proposal.ideas;
  const canApply = d.access.canApply && proposal.status === "open";
  const applied = proposal.applied;
  const nameOf = new Map<string, string>([...d.members.map((m) => [m.key, m.name] as const), ...d.prospects.map((p) => [p.key, p.kind === "talent" ? (p.title ?? "募集人材") : p.kind === "contact" && !p.isOwnerView ? "外部人脈の候補" : (p.name ?? "")] as const)]);
  const roleOf = new Map<string, string | null>([...d.members.map((m) => [m.key, m.role] as const), ...d.prospects.map((p) => [p.key, p.role] as const)]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(() => ({
    business: !applied.business,
    altIndex: null,
    roles: new Set((ideas?.roles ?? []).map((r) => r.key).filter((k) => nameOf.has(k) && !(applied.roles ?? []).includes(k) && roleOf.get(k) !== (ideas?.roles.find((r) => r.key === k)?.role))),
    firstSteps: new Set((ideas?.firstSteps ?? []).map((_, i) => i).filter((i) => !(applied.firstSteps ?? []).includes(i))),
    addActionItems: false,
    addCandidates: new Set(),
    addTalents: new Set((ideas?.desiredTalents ?? []).map((_, i) => i).filter((i) => !(applied.addTalents ?? []).includes(i))),
    dismiss: new Set(),
  }));

  const applyM = useMutation({
    mutationFn: () => api.post<{ data: WsDetail; warning: string | null }>(`${ctx.base}/proposals/${proposal.id}/apply`, {
      business: sel.business ? (sel.altIndex !== null ? { alternativeIndex: sel.altIndex } : true) : undefined,
      roles: [...sel.roles], firstSteps: [...sel.firstSteps], addActionItems: sel.addActionItems,
      addCandidates: [...sel.addCandidates], addTalents: [...sel.addTalents], dismiss: [...sel.dismiss],
    }),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); if (res.warning) ctx.fail(new Error(res.warning), res.warning); onClose(); },
    onError: (e) => setError(e instanceof Error ? e.message : "反映できませんでした。もう一度お試しください。"),
  });
  const discard = useMutation({
    mutationFn: () => api.post<{ data: WsDetail }>(`${ctx.base}/proposals/${proposal.id}/discard`, {}),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); onClose(); },
    onError: (e) => setError(e instanceof Error ? e.message : "操作できませんでした。"),
  });
  const busy = applyM.isPending || discard.isPending;
  const setToggle = <T,>(set: Set<T>, v: T): Set<T> => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const total = (sel.business ? 1 : 0) + sel.roles.size + sel.firstSteps.size + sel.addCandidates.size + sel.addTalents.size + sel.dismiss.size;

  const Box = ({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) => (
    <input type="checkbox" checked={on} onChange={onChange} disabled={!canApply || disabled || busy} className="mt-0.5 shrink-0" />
  );
  const Group = ({ title, done, children }: { title: string; done?: boolean; children: React.ReactNode }) => (
    <div className="rounded-2xl px-3 py-2.5" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
      <p className="text-xs font-bold mb-1.5 flex items-center gap-1.5" style={{ color: "var(--color-ink-800)" }}>{title}{done && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: "rgba(90,140,92,0.14)", color: "var(--color-success)" }}>反映済み</span>}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );

  if (!ideas) return null;
  const p = d.profile;
  const advice = (ideas.memberAdvice ?? []).filter((a) => d.prospects.some((x) => x.key === a.key && !x.locked));
  const suggested = (ideas.suggestedMembers ?? []).filter((s) => !nameOf.has(s.key));
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => { if (!busy) onClose(); }}>
      <div className="card-paper p-4 sm:p-5 w-full max-w-lg rounded-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>再検討の結果</h2>
          <DialogCloseButton onClick={onClose} disabled={busy} />
        </div>
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>
          {proposal.createdBy.name}さんが {fmtTime(proposal.createdAt)} に実行
          {(proposal.perspectives.length > 0 || proposal.note) && `（${[...proposal.perspectives.map((x) => PERSPECTIVE_LABEL[x]), ...(proposal.note ? [`「${proposal.note}」`] : [])].join("、")}）`}
        </p>
        {ideas.isMock && <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>※ 開発環境のため、AIの提案の代わりに見本を表示しています。</p>}
        <p className="text-xs mb-3" style={{ color: canApply ? "var(--color-ink-600)" : "var(--color-accent)" }}>
          {canApply ? "反映する情報にチェックを入れてください。チェックしたものだけが反映されます。" : proposal.status === "closed" ? "この提案は、すでに閉じています。" : "反映できるのは、リーダーだけです。内容を見るだけで、プロフィールは変わりません。"}
        </p>
        {proposal.stale && proposal.status === "open" && <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.14)", color: "var(--color-ink-700)" }}>⚠️ この提案は、実行したあとにプロフィールが変わっています。内容を見比べて選んでください。</p>}

        <div className="space-y-2.5">
          <Group title="🤝 協働事業の内容" done={applied.business}>
            <label className="flex items-start gap-2 text-xs">
              <Box on={sel.business && sel.altIndex === null} onChange={() => setSel({ ...sel, business: !(sel.business && sel.altIndex === null), altIndex: null })} disabled={applied.business} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 flex-1 min-w-0">
                <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                  <b className="block text-[10px]" style={{ color: "var(--color-ink-400)" }}>現在</b>
                  {p?.businessTitle ? <><b>{p.businessTitle}</b><br />{p.summary}</> : "（未入力）"}
                </div>
                <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-ink-800)" }}>
                  <b className="block text-[10px]" style={{ color: "var(--color-success)" }}>提案</b>
                  <b>{ideas.businessTitle}</b><br />{ideas.summary}
                  {ideas.targetCustomers && <><br /><span style={{ color: "var(--color-ink-600)" }}>🎯 {ideas.targetCustomers}</span></>}
                </div>
              </div>
            </label>
            {(ideas.alternativeIdeas ?? []).map((a, i) => (
              <label key={i} className="flex items-start gap-2 text-xs">
                <Box on={sel.business && sel.altIndex === i} onChange={() => setSel({ ...sel, business: !(sel.business && sel.altIndex === i), altIndex: sel.business && sel.altIndex === i ? null : i })} disabled={applied.business} />
                <span style={{ color: "var(--color-ink-700)" }}><b style={{ color: "var(--color-success)" }}>💡 ほかの切り口：</b><b>{a.title}</b> ／ {a.summary}</span>
              </label>
            ))}
          </Group>

          {ideas.roles.some((r) => nameOf.has(r.key)) && (
            <Group title="🎭 役割分担（人ごとに選べます）">
              {ideas.roles.filter((r) => nameOf.has(r.key)).map((r) => {
                const done = (applied.roles ?? []).includes(r.key);
                return (
                  <label key={r.key} className="flex items-start gap-2 text-xs">
                    <Box on={sel.roles.has(r.key)} onChange={() => setSel({ ...sel, roles: setToggle(sel.roles, r.key) })} disabled={done} />
                    <span style={{ color: "var(--color-ink-700)" }}>
                      <b>{nameOf.get(r.key)}</b>：{roleOf.get(r.key) ? <><span style={{ color: "var(--color-ink-400)" }}>{roleOf.get(r.key)}</span> → </> : null}<b style={{ color: "var(--color-success)" }}>{r.role}</b>
                      {done && <span className="ml-1" style={{ color: "var(--color-success)" }}>（反映済み）</span>}
                    </span>
                  </label>
                );
              })}
            </Group>
          )}

          {ideas.firstSteps.length > 0 && (
            <Group title="🚶 最初の一歩">
              {ideas.firstSteps.map((s, i) => (
                <label key={i} className="flex items-start gap-2 text-xs">
                  <Box on={sel.firstSteps.has(i)} onChange={() => setSel({ ...sel, firstSteps: setToggle(sel.firstSteps, i) })} disabled={(applied.firstSteps ?? []).includes(i)} />
                  <span style={{ color: "var(--color-ink-700)" }}>{s}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-[11px] pl-5" style={{ color: "var(--color-ink-500)" }}>
                <input type="checkbox" checked={sel.addActionItems} onChange={(e) => setSel({ ...sel, addActionItems: e.target.checked })} disabled={!canApply || busy} />選んだ一歩を、アクションにも追加する
              </label>
            </Group>
          )}

          {suggested.length > 0 && (
            <Group title="🌱 追加メンバー候補（選んだ人は「候補」に入ります）">
              {suggested.map((s) => (
                <label key={s.key} className="flex items-start gap-2 text-xs">
                  <Box on={sel.addCandidates.has(s.key)} onChange={() => setSel({ ...sel, addCandidates: setToggle(sel.addCandidates, s.key) })} disabled={(applied.addCandidates ?? []).includes(s.key)} />
                  <span style={{ color: "var(--color-ink-700)" }}><b>{s.name}</b>{s.kind === "contact" && "（外部人脈）"}：{s.reason}</span>
                </label>
              ))}
            </Group>
          )}

          {(ideas.desiredTalents ?? []).length > 0 && (
            <Group title="🔍 追加したい人材（選んだ人材像は「募集人材」に入ります）">
              {(ideas.desiredTalents ?? []).map((t, i) => (
                <label key={i} className="flex items-start gap-2 text-xs">
                  <Box on={sel.addTalents.has(i)} onChange={() => setSel({ ...sel, addTalents: setToggle(sel.addTalents, i) })} disabled={(applied.addTalents ?? []).includes(i)} />
                  <span style={{ color: "var(--color-ink-700)" }}><b>{t.title}</b> ／ {t.profile}{t.role && <><br /><span style={{ color: "var(--color-ink-500)" }}>役割：{t.role}</span></>}</span>
                </label>
              ))}
            </Group>
          )}

          {advice.length > 0 && (
            <Group title="🚪 見送りのおすすめ（選ぶと、候補から外れます）">
              {advice.map((a) => (
                <label key={a.key} className="flex items-start gap-2 text-xs">
                  <Box on={sel.dismiss.has(a.key)} onChange={() => setSel({ ...sel, dismiss: setToggle(sel.dismiss, a.key) })} disabled={(applied.dismiss ?? []).includes(a.key)} />
                  <span style={{ color: "var(--color-ink-700)" }}><b>{nameOf.get(a.key)}</b>：{a.reason}</span>
                </label>
              ))}
            </Group>
          )}
        </div>

        {error && <p className="text-xs mt-3 px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-2 mt-4">
          {canApply ? (
            <>
              <button onClick={() => discard.mutate()} disabled={busy} className="flex-1 py-2.5 rounded-2xl text-sm font-medium disabled:opacity-50" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>反映しない</button>
              <button onClick={() => applyM.mutate()} disabled={busy || total === 0} className="flex-[1.4] py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
                {applyM.isPending && <Loader2 size={14} className="animate-spin" />}選んだ{total}件を反映
              </button>
            </>
          ) : (
            <button onClick={onClose} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>閉じる</button>
          )}
        </div>
        {canApply && <p className="text-[11px] text-center mt-2" style={{ color: "var(--color-ink-400)" }}>「反映しない」を押すと、この提案を破棄します。一部だけ反映して、残りはあとから反映することもできます。</p>}
      </div>
    </div>
  );
}
