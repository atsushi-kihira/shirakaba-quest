// =============================================================
// チーム育成の画面：次の一歩の提案・正式なチームへの移行・チームの歩み・元気度
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Lock, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import { fmtDateISO } from "@/lib/date";
import { useSettings } from "@/hooks/use-settings";
import type { NextStep, WsCtx, WsDetail } from "./_ws-types";
import { errText } from "./_ws-types";

// ---- 元気度 ----
export function HealthPill({ health }: { health: WsDetail["health"] }) {
  const { timezone: tz } = useSettings();
  if (!health) return null;
  const m = { active: { t: "元気", c: "var(--color-success)", bg: "rgba(90,140,92,0.14)" }, rest: { t: "ひと休み", c: "#8a6414", bg: "rgba(212,160,59,0.18)" }, follow: { t: "要フォロー", c: "var(--color-brand)", bg: "rgba(181,56,75,0.1)" } }[health.status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: "var(--color-ink-500)" }}>
      <span className="font-bold px-2 py-0.5 rounded-full" style={{ background: m.bg, color: m.c }}>● {m.t}</span>
      最終の活動 {fmtDateISO(health.lastActivityAt, tz)}
    </span>
  );
}

// ---- 次の一歩の提案（ルールにもとづく。AIの利用料はかからない） ----
export function NextStepsCard({ ctx, onAddAction }: { ctx: WsCtx; onAddAction: (task: string) => Promise<void> }) {
  const { d } = ctx;
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const leader = d.access.isLeader;
  const act = useMutation({
    mutationFn: async (s: NextStep) => {
      const pr = d.prospects.find((p) => p.key === s.refKey);
      if (s.kind === "invite_candidate" && pr) return api.post<{ data: WsDetail }>(`${ctx.base}/prospects/${pr.prospectId}/invite`, {});
      if (s.kind === "publish_talent" && pr) return api.patch<{ data: WsDetail }>(`${ctx.base}/prospects/${pr.prospectId}`, { published: true });
      return null;
    },
    onSuccess: (res) => { if (res) ctx.apply(res); },
    onError: (e) => ctx.fail(e, "操作できませんでした。もう一度お試しください。"),
  });
  if (!d.access.isActive || d.nextSteps.length === 0) return null;
  const addAsAction = async (s: NextStep) => {
    setBusy(s.id);
    try { await onAddAction(s.kind === "first_step" && s.text ? s.text : s.title); setDone((p) => new Set(p).add(s.id)); } finally { setBusy(null); }
  };
  return (
    <section className="card-paper rounded-2xl p-4">
      <h2 className="text-sm font-bold mb-0.5" style={{ color: "var(--color-ink-800)" }}>💡 次の一歩の提案</h2>
      <p className="text-[11px] mb-2.5" style={{ color: "var(--color-ink-500)" }}>チームの状況から、次にやるとよいことを提案します。気になるものを、そのまま実行するか、アクションに追加できます。</p>
      <ul className="space-y-2">
        {d.nextSteps.map((s) => (
          <li key={s.id} className="rounded-xl px-3 py-2" style={{ background: "var(--color-paper-100)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--color-ink-800)" }}>{s.title}</p>
            <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>{s.detail}</p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {s.kind === "invite_candidate" && leader && <button onClick={() => act.mutate(s)} disabled={act.isPending} className="text-[11px] px-2.5 py-1 rounded-lg text-white" style={{ background: "var(--color-success)" }}>声をかける</button>}
              {s.kind === "publish_talent" && leader && <button onClick={() => act.mutate(s)} disabled={act.isPending} className="text-[11px] px-2.5 py-1 rounded-lg text-white" style={{ background: "var(--color-success)" }}>募集として公開</button>}
              {s.kind === "find_talent" && <Link to={`/enishi?mode=contact-search&filter=usp&q=${encodeURIComponent(s.text ?? "")}`} className="text-[11px] px-2.5 py-1 rounded-lg" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>人脈検索を開く</Link>}
              {s.kind === "meeting" && d.type === "team" && <Link to={`/meetings/new?collabTeamId=${d.id}&title=${encodeURIComponent(`${d.title} 会議`)}`} className="text-[11px] px-2.5 py-1 rounded-lg" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>会議を作る</Link>}
              {done.has(s.id)
                ? <span className="text-[11px] px-2 py-1" style={{ color: "var(--color-success)" }}>✓ アクションに追加しました</span>
                : <button onClick={() => addAsAction(s)} disabled={busy === s.id} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                    {busy === s.id ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}アクションに追加
                  </button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- チームの歩み ----
export function MilestonesCard({ d }: { d: WsDetail }) {
  const { timezone: tz } = useSettings();
  if (!d.access.isActive || d.milestones.length === 0) return null;
  return (
    <section className="card-paper rounded-2xl p-4">
      <h2 className="text-sm font-bold mb-1.5" style={{ color: "var(--color-ink-800)" }}>🗓 チームの歩み</h2>
      <ul className="space-y-1">
        {d.milestones.map((m) => (
          <li key={m.id} className="text-xs flex gap-2" style={{ color: "var(--color-ink-700)" }}>
            <span style={{ color: "var(--color-ink-400)" }}>{fmtDateISO(m.at, tz)}</span><span>🎉 {m.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- チーム案から、緩いチーム／パワーチームへ（中核のメンバーを選ぶ） ----
export function PromoteDraftModal({ ctx, onClose, onDone }: { ctx: WsCtx; onClose: () => void; onDone: (teamId: string) => void }) {
  const { d } = ctx;
  const [type, setType] = useState<"loose" | "power">("loose");
  const [name, setName] = useState(d.title);
  const members = d.prospects.filter((p) => p.kind === "member");
  const contactCount = d.prospects.filter((p) => p.kind === "contact").length;
  const [core, setCore] = useState<Set<string>>(new Set(members.filter((m) => m.locked).map((m) => m.memberId as string)));
  const [error, setError] = useState<string | null>(null);
  const promote = useMutation({
    mutationFn: () => api.post<{ data: { teamId: string } }>(`/collab/team-drafts/${d.id}/promote`, { type, name: name.trim(), coreMemberIds: [...core] }),
    onSuccess: (res) => onDone(res.data.teamId),
    onError: (e) => setError(errText(e, "チームにできませんでした。もう一度お試しください。")),
  });
  const toggle = (id: string) => setCore((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rest = members.length - core.size;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => { if (!promote.isPending) onClose(); }}>
      <div className="card-paper p-5 w-full max-w-md rounded-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>🚀 正式なチームにする</h2>
          <DialogCloseButton onClick={onClose} disabled={promote.isPending} />
        </div>
        <div className="flex gap-2 mb-2">
          {(["loose", "power"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className="flex-1 py-2 rounded-2xl text-sm font-medium"
              style={{ background: type === t ? "var(--color-brand)" : "var(--color-paper-200)", color: type === t ? "white" : "var(--color-ink-600)" }}>{t === "loose" ? "🌿 緩いチーム" : "⚡ パワーチーム"}</button>
          ))}
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>{type === "loose" ? "承諾なしで、すぐにチームになれます。" : "宣言すると、選んだ中核のメンバーに承諾の確認が届き、全員が承諾すると成立します。"}</p>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>チーム名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />
        <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>最初から参加する中核のメンバー（自分のほかに1名以上）</p>
        <div className="space-y-1 rounded-xl p-2 mb-1.5" style={{ background: "var(--color-paper-200)" }}>
          <div className="flex items-center gap-2 px-2 py-1.5 text-sm" style={{ color: "var(--color-ink-700)" }}>
            <input type="checkbox" checked disabled /> {d.members[0]?.emoji} {d.members[0]?.name}（自分）
          </div>
          {members.length === 0 && <p className="text-xs px-2 py-2" style={{ color: "var(--color-ink-500)" }}>中核にできるメンバーが、まだメンバー案にいません。先に追加してください。</p>}
          {members.map((m) => (
            <label key={m.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm" style={{ color: "var(--color-ink-700)" }}>
              <input type="checkbox" checked={core.has(m.memberId as string)} onChange={() => toggle(m.memberId as string)} />
              {m.emoji} {m.name}{m.locked && <span className="text-[10px] ml-1 inline-flex items-center gap-0.5" style={{ color: "#8a6414" }}><Lock size={9} />確定</span>}
            </label>
          ))}
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          選ばなかった{rest > 0 ? `${rest}名` : "人"}{contactCount > 0 && `と外部人脈${contactCount}名`}は、チームの「候補」として残ります（本人には知らせません）。募集人材・役割・アクションも、そのまま引き継ぎます。
        </p>
        <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.14)", color: "var(--color-ink-700)" }}>
          <b>公開される情報：</b>事業のタイトル・概要・お客様像は、チャプター全員に見えるようになります。考えたいこと・役割・候補は見えません。
        </p>
        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={promote.isPending} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium disabled:opacity-50" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => { setError(null); if (!name.trim()) { setError("チーム名を入力してください"); return; } promote.mutate(); }} disabled={promote.isPending || core.size === 0}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-accent)" }}>
            {promote.isPending && <Loader2 size={14} className="animate-spin" />}{type === "loose" ? "結成する" : "宣言する"}
          </button>
        </div>
      </div>
    </div>
  );
}
