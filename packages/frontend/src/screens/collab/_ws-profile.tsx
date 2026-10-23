// =============================================================
// チーム育成の画面：チームプロフィール（事業・概要・お客様像・最初の一歩）と「考えたいこと」
//   ・リーダー（チーム案では作成者）が編集する。AIが仮に作った内容は、確認するまでバナーで知らせる
//   ・参加中でない人には、確認済みの事業内容だけを見せる
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { WsCtx, WsDetail } from "./_ws-types";

type Draft = { businessTitle: string; summary: string; targetCustomers: string; firstSteps: string };

const fromProfile = (p: NonNullable<WsDetail["profile"]>): Draft => ({
  businessTitle: p.businessTitle, summary: p.summary, targetCustomers: p.targetCustomers, firstSteps: p.firstSteps.join("\n"),
});

export function ProfileCard({ ctx, onAiDraft, aiBusy }: { ctx: WsCtx; onAiDraft: () => void; aiBusy: boolean }) {
  const { d } = ctx;
  const p = d.profile;
  const canEdit = d.access.canEditProfile;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({ businessTitle: "", summary: "", targetCustomers: "", firstSteps: "" });

  const save = useMutation({
    mutationFn: () => api.put<{ data: WsDetail }>(`${ctx.base}/profile`, {
      businessTitle: draft.businessTitle, summary: draft.summary, targetCustomers: draft.targetCustomers,
      firstSteps: draft.firstSteps.split("\n").map((s) => s.trim()).filter(Boolean),
    }),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); setEditing(false); },
    onError: (e) => ctx.fail(e, "保存できませんでした。もう一度お試しください。"),
  });
  const confirm = useMutation({
    mutationFn: () => api.post<{ data: WsDetail }>(`${ctx.base}/profile/confirm`, {}),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); },
    onError: (e) => ctx.fail(e, "確認できませんでした。もう一度お試しください。"),
  });

  if (!p) {
    return (
      <section className="card-paper rounded-2xl p-4">
        <h2 className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>🤝 協働事業</h2>
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>このチームのプロフィールは、まだ準備中です。</p>
      </section>
    );
  }

  const empty = !p.businessTitle.trim() && !p.summary.trim() && !p.targetCustomers.trim();
  const needsInput = d.access.isActive && !d.complete && !p.isProvisional;

  return (
    <section className="card-paper rounded-2xl p-4" style={{ border: "1.5px solid rgba(90,140,92,0.35)" }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-bold" style={{ color: "var(--color-ink-800)" }}>🤝 協働事業（チームプロフィール）</h2>
        {canEdit && !editing && (
          <button onClick={() => { setDraft(fromProfile(p)); setEditing(true); ctx.clearError(); }} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}><Pencil size={11} /> 編集</button>
        )}
      </div>

      {d.access.isActive && p.isProvisional && (
        <div className="rounded-xl px-3 py-2.5 mb-3" style={{ background: "rgba(212,160,59,0.14)", border: "1px dashed var(--color-accent)" }}>
          <p className="text-xs font-bold mb-0.5" style={{ color: "var(--color-ink-800)" }}>🤖 AIが仮に作った内容です</p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-600)" }}>
            チームのメンバー情報から、事業の内容とメンバーの役割を仮に作りました。
            {canEdit ? "内容を確認して、直すか、そのままでよければ「この内容でよい」を押してください。" : "リーダーが確認するまでの仮の内容です。"}
          </p>
          {canEdit && (
            <div className="flex gap-2 mt-2">
              <button onClick={() => confirm.mutate()} disabled={confirm.isPending} className="px-3 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                {confirm.isPending ? "確認中…" : "この内容でよい"}
              </button>
              <button onClick={() => { setDraft(fromProfile(p)); setEditing(true); }} className="px-3 py-1.5 rounded-xl text-xs font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>直す</button>
            </div>
          )}
        </div>
      )}

      {needsInput && canEdit && !editing && (
        <div className="rounded-xl px-3 py-2.5 mb-3" style={{ background: "rgba(181,56,75,0.07)" }}>
          <p className="text-xs font-bold mb-0.5" style={{ color: "var(--color-brand)" }}>📝 チームプロフィールを入力しましょう</p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-600)" }}>事業のタイトル・概要・お客様像の3つを埋めると、入力済みになります。AIの下書きから作ることもできます。</p>
          <button onClick={onAiDraft} disabled={aiBusy} className="flex items-center gap-1 mt-2 px-3 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}AIで下書きを作る
          </button>
        </div>
      )}

      {editing ? (
        <div className="space-y-2.5">
          {([["businessTitle", "協働事業のタイトル", 1, 100], ["summary", "概要（誰の、どんな課題に、どんなサービス・活動を提供するか）", 3, 1000], ["targetCustomers", "対象のお客様（どんな方に提供するか）", 2, 1000]] as const).map(([k, label, rows, max]) => (
            <label key={k} className="block">
              <span className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>{label} <span style={{ color: "var(--color-brand)" }}>*</span></span>
              <textarea value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} rows={rows} maxLength={max}
                className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
            </label>
          ))}
          <label className="block">
            <span className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>最初の一歩（1行に1つ。5つまで）</span>
            <textarea value={draft.firstSteps} onChange={(e) => setDraft({ ...draft, firstSteps: e.target.value })} rows={3}
              className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
          </label>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} disabled={save.isPending} data-dialog-cancel className="flex-1 py-2 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="flex-1 py-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
              {save.isPending && <Loader2 size={14} className="animate-spin" />}保存する
            </button>
          </div>
        </div>
      ) : empty ? (
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>まだ入力されていません。</p>
      ) : (
        <div className="space-y-2.5">
          <div className="rounded-xl p-3" style={{ background: "rgba(90,140,92,0.08)" }}>
            <p className="text-[10px] font-bold mb-0.5" style={{ color: "var(--color-success)" }}>協働事業のイメージ</p>
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-900)" }}>{p.businessTitle || "（タイトル未入力）"}</p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{p.summary || "（概要は未入力です）"}</p>
            <p className="text-xs leading-relaxed mt-2" style={{ color: "var(--color-ink-700)" }}>
              <b style={{ color: "var(--color-success)" }}>🎯 お客様・対象：</b>{p.targetCustomers || "（未入力です）"}
            </p>
          </div>
          {p.firstSteps.length > 0 && (
            <div>
              <p className="text-[10px] font-bold mb-1" style={{ color: "var(--color-ink-500)" }}>最初の一歩</p>
              <ol className="list-decimal pl-5 space-y-0.5 text-xs" style={{ color: "var(--color-ink-700)" }}>
                {p.firstSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] mt-3" style={{ color: "var(--color-ink-400)" }}>実現を約束するものではなく、話し合いのたたき台です。{d.stage !== "draft" && "事業のタイトル・概要・お客様像は、チャプター全員に見えます。"}</p>
    </section>
  );
}

export function GoalCard({ ctx }: { ctx: WsCtx }) {
  const { d } = ctx;
  const goal = d.profile?.goal ?? "";
  const [text, setText] = useState(goal);
  const [synced, setSynced] = useState(goal);
  if (goal !== synced) { setSynced(goal); setText(goal); }
  const save = useMutation({
    mutationFn: () => api.put<{ data: WsDetail }>(`${ctx.base}/profile`, { goal: text }),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); },
    onError: (e) => ctx.fail(e, "保存できませんでした。もう一度お試しください。"),
  });
  if (!d.access.isActive) return null;
  return (
    <section className="card-paper rounded-2xl p-4">
      <h2 className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>💭 どんな協業を考えたいか（任意）</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} readOnly={!d.access.canEditProfile}
        placeholder="例：ご家族を亡くされた方の、手続きから実家の整理・売却までを一緒に支えたい"
        className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
      {d.access.canEditProfile && text.trim() !== goal.trim() && (
        <button onClick={() => save.mutate()} disabled={save.isPending} className="mt-2 px-4 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>保存する</button>
      )}
    </section>
  );
}
