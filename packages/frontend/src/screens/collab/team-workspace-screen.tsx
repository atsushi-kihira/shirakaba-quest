// =============================================================
// 協働マップ — チーム育成の画面（チーム案・緩いチーム・パワーチーム共通）
//   ・チームプロフィール（事業・概要・お客様像・最初の一歩）。AIが仮に作った内容は、リーダーが確認する
//   ・メンバー（参加中）・候補・募集人材と、それぞれの役割（参加中のメンバーなら誰でも編集できる。他の人の役割は、リーダーの承認が必要）
//   ・AIによる再検討（誰でも実行できる）と、提案の反映（リーダーが、情報ごとに選ぶ）
//   ・次の一歩の提案、アクション、チームの歩み
// チーム案は、作った本人だけに見える（誰の承諾も得ていない段階）。
// 仕様：docs/追加機能仕様_チーム育成.md
// =============================================================
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import { TeamActionItemsChecklist } from "./collab-screen";
import { GoalCard, ProfileCard } from "./_ws-profile";
import { AddProspectsModal, AddTalentModal, MembersCard, ProspectsCard, TalentsCard } from "./_ws-roster";
import { ApplyModal, ProposalsCard, RunModal } from "./_ws-proposals";
import { HealthPill, MilestonesCard, NextStepsCard, PromoteDraftModal } from "./_ws-extras";
import { STAGE_LABEL, errText, wsKey, type Proposal, type WsCtx, type WsDetail, type WsProspect, type WsType } from "./_ws-types";

export function TeamWorkspaceScreen({ type }: { type: WsType }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const base = `/collab/workspace/${type}/${id}`;
  const queryKey = wsKey(type, id);
  const aiFailed = (location.state as { aiFailed?: boolean } | null)?.aiFailed === true;

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRun, setShowRun] = useState(false);
  const [applyId, setApplyId] = useState<string | null>(null);
  const [showAddProspects, setShowAddProspects] = useState(false);
  const [showAddTalent, setShowAddTalent] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [showTitleEdit, setShowTitleEdit] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WsProspect | null>(null);

  const { data, isLoading, error: loadError } = useQuery({ queryKey, queryFn: () => api.get<{ data: WsDetail }>(base) });
  const d = data?.data;

  const refreshRelated = () => {
    qc.invalidateQueries({ queryKey: ["collab", "team-drafts"], exact: true });
    qc.invalidateQueries({ queryKey: ["collab", "workspace-todos"] });
    qc.invalidateQueries({ queryKey: ["collab", "graph"] });
  };
  const apply = (res: { data: WsDetail }) => { qc.setQueryData(queryKey, { data: res.data }); refreshRelated(); };
  const ctx: WsCtx | null = d ? { d, base, apply, fail: (e, fallback) => setError(errText(e, fallback)), clearError: () => setError(null) } : null;

  const aiDraft = useMutation({
    mutationFn: () => api.post<{ data: WsDetail }>(`${base}/proposals`, { perspectives: [], note: "" }),
    onSuccess: (res) => { setError(null); apply(res); const p = res.data.proposals[0]; if (p) setApplyId(p.id); },
    onError: (e) => setError(errText(e, "AIで下書きを作れませんでした。少し時間をおいて、もう一度お試しください。")),
  });
  const removeProspect = useMutation({
    mutationFn: (p: WsProspect) => api.delete<{ data: WsDetail }>(`${base}/prospects/${p.prospectId}`),
    onSuccess: (res) => { setError(null); apply(res); setRemoveTarget(null); },
    onError: (e) => { setError(errText(e, "外せませんでした。もう一度お試しください。")); setRemoveTarget(null); },
  });
  const deleteDraft = useMutation({
    mutationFn: () => api.delete(`/collab/team-drafts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collab", "team-drafts"] }); navigate("/collab/drafts"); },
    onError: (e) => setError(errText(e, "削除できませんでした。")),
  });
  const respond = useMutation({
    mutationFn: (accept: boolean) => api.post(`/collab/teams/${id}/respond`, { accept }),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); refreshRelated(); },
    onError: (e) => setError(errText(e, "返事を送れませんでした。もう一度お試しください。")),
  });
  const promoteTeam = useMutation({
    mutationFn: () => api.post(`/collab/teams/${id}/promote`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); refreshRelated(); },
    onError: (e) => setError(errText(e, "昇格できませんでした。")),
  });
  const interest = useMutation({
    mutationFn: (pid: string) => api.post(`${base}/prospects/${pid}/interest`, {}),
    onSuccess: () => { setNotice("参加希望を伝えました。リーダーが承認すると、チームに加わります。"); qc.invalidateQueries({ queryKey }); refreshRelated(); },
    onError: (e) => setError(errText(e, "参加希望を送れませんでした。")),
  });
  const addAction = async (task: string) => {
    await api.post("/collab/team-action-items", { teamId: id, task, visibility: "team" });
    qc.invalidateQueries({ queryKey: ["collab", "team-action-items", id] });
  };

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>;
  const backTo = type === "draft" ? "/collab/drafts" : "/collab";
  if (loadError || !d || !ctx) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center">
        <p className="text-sm mb-3" style={{ color: "var(--color-ink-600)" }}>{type === "draft" ? "チーム案" : "チーム"}が見つかりませんでした。</p>
        <Link to={backTo} className="text-sm underline" style={{ color: "var(--color-brand)" }}>{type === "draft" ? "チーム案の一覧へ" : "協働マップへ"}</Link>
      </div>
    );
  }

  const stage = STAGE_LABEL[d.stage];
  const applying: Proposal | undefined = d.proposals.find((p) => p.id === applyId);
  const publicTalents = d.prospects.filter((p) => p.kind === "talent" && p.published && !p.filled);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link to={backTo} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--color-paper-200)" }} aria-label="戻る">
          <ChevronLeft size={20} style={{ color: "var(--color-ink-600)" }} />
        </Link>
        <h1 className="text-lg font-bold flex-1 min-w-0 truncate" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>{stage.emoji} {d.title}</h1>
        {d.access.isLeader && <button onClick={() => setShowTitleEdit(true)} className="p-2 rounded-lg shrink-0" aria-label="名前を変更" style={{ color: "var(--color-ink-500)" }}><Pencil size={16} /></button>}
        {type === "draft" && (
          <button onClick={() => { if (confirm(`チーム案「${d.title}」を削除します。よろしいですか？`)) deleteDraft.mutate(); }} disabled={deleteDraft.isPending}
            className="p-2 rounded-lg shrink-0 disabled:opacity-50" aria-label="チーム案を削除" style={{ color: "var(--color-ink-400)" }}><Trash2 size={16} /></button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 -mt-2">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: stage.color }}>{stage.label}</span>
        {d.archived && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>⏸休止中</span>}
        <HealthPill health={d.health} />
        {type === "draft" && <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>🔒 このチーム案は、あなただけに見えます（誰の承諾も得ていません）</span>}
      </div>

      {aiFailed && d.profile && !d.profile.businessTitle && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.14)", color: "var(--color-ink-700)" }}>
          ⚠️ チーム案は作成しましたが、AIが事業の内容をまとめられませんでした。「AIで再検討する」を押して、もう一度お試しください。
        </p>
      )}
      {error && <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}
      {notice && <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-ink-700)" }}>{notice}</p>}

      {d.access.isPending && d.members.some((m) => m.isMe && !m.joinRequest) && (
        <section className="card-paper rounded-2xl p-4" style={{ border: "1.5px solid var(--color-accent)" }}>
          <p className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>📩 このチームから、招待が届いています</p>
          <p className="text-xs mb-2.5" style={{ color: "var(--color-ink-600)" }}>下の事業の内容を見て、参加するかどうかを選んでください。</p>
          <div className="flex gap-2">
            <button onClick={() => respond.mutate(true)} disabled={respond.isPending} className="px-4 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--color-success)" }}>承諾する</button>
            <button onClick={() => respond.mutate(false)} disabled={respond.isPending} className="px-4 py-1.5 rounded-xl text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>辞退する</button>
          </div>
          {d.members.find((m) => m.isMe)?.role && <p className="text-xs mt-2" style={{ color: "var(--color-ink-700)" }}><b>あなたの役割：</b>{d.members.find((m) => m.isMe)?.role}</p>}
        </section>
      )}

      <ProfileCard ctx={ctx} onAiDraft={() => aiDraft.mutate()} aiBusy={aiDraft.isPending} />

      {!d.access.isActive && publicTalents.length > 0 && (
        <section className="card-paper rounded-2xl p-4">
          <h2 className="text-sm font-bold mb-1.5" style={{ color: "var(--color-ink-800)" }}>🔍 募集中の人材</h2>
          <div className="space-y-2">
            {publicTalents.map((p) => {
              const asked = d.access.isPending && d.members.some((m) => m.isMe && m.joinRequest);
              return (
                <div key={p.prospectId} className="rounded-xl px-3 py-2.5" style={{ background: "#FFFBEF", border: "1px dashed #c9b88f" }}>
                  <p className="text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>{p.title}</p>
                  {p.profile && <p className="text-xs mt-1" style={{ color: "var(--color-ink-700)" }}><b style={{ color: "var(--color-accent)" }}>人物像：</b>{p.profile}</p>}
                  {p.reason && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-700)" }}><b style={{ color: "var(--color-success)" }}>補えること：</b>{p.reason}</p>}
                  <button onClick={() => interest.mutate(p.prospectId)} disabled={interest.isPending || asked} className="mt-2 px-3 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--color-success)" }}>
                    {asked ? "参加希望を出しています" : "🙋 興味あり（参加を希望する）"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <GoalCard ctx={ctx} />
      <MembersCard ctx={ctx} onInvite={type === "team" ? () => navigate("/collab") : undefined} />
      <ProspectsCard ctx={ctx} onAdd={() => setShowAddProspects(true)} onRemove={setRemoveTarget} />
      <TalentsCard ctx={ctx} onAdd={() => setShowAddTalent(true)} onRemove={setRemoveTarget} />
      <ProposalsCard ctx={ctx} onRun={() => setShowRun(true)} onOpen={(p) => setApplyId(p.id)} running={aiDraft.isPending} />
      <NextStepsCard ctx={ctx} onAddAction={addAction} />

      {d.access.isActive && (
        <section className="card-paper rounded-2xl p-4">
          <TeamActionItemsChecklist teamId={d.id} canEdit members={d.members.map((m) => ({ id: m.id, name: m.name, emoji: m.emoji, bgColor: m.bgColor, status: m.status, invitedBy: null }))} />
        </section>
      )}

      {d.access.isLeader && type === "draft" && (
        <section className="card-paper rounded-2xl p-4">
          <h2 className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>🚀 正式なチームにする</h2>
          <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
            十分に検討できたら、中核になるメンバーだけで、緩いチームまたはパワーチームを始められます。選ばなかった人は「候補」として、チームに残ります。
          </p>
          <button onClick={() => setShowPromote(true)} disabled={!d.prospects.some((p) => p.kind === "member")} className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-accent)" }}>
            緩いチーム／パワーチームにする
          </button>
          {!d.prospects.some((p) => p.kind === "member") && <p className="text-xs mt-2" style={{ color: "var(--color-ink-500)" }}>メンバー案に、メンバーを1名以上追加すると始められます。</p>}
        </section>
      )}
      {d.access.isLeader && type === "team" && d.stage === "loose" && (
        <section className="card-paper rounded-2xl p-4">
          <h2 className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>⚡ パワーチームにする</h2>
          <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>リーダーの判断で、緩いチームをパワーチームに昇格できます（メンバーの承諾は必要ありません）。</p>
          <button onClick={() => { if (confirm(`「${d.title}」をパワーチームに昇格しますか？`)) promoteTeam.mutate(); }} disabled={promoteTeam.isPending}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-accent)" }}>⚡ パワーチームに昇格</button>
        </section>
      )}

      <MilestonesCard d={d} />

      {showRun && <RunModal ctx={ctx} onClose={() => setShowRun(false)} onDone={(res) => {
        setShowRun(false);
        const p = res.data.proposals[0];
        if (d.access.canApply && p) setApplyId(p.id);
        else setNotice("再検討の結果は、提案として残りました。リーダーが確認して、反映するものを選びます。");
      }} />}
      {applying && <ApplyModal ctx={ctx} proposal={applying} onClose={() => setApplyId(null)} />}
      {showAddProspects && <AddProspectsModal ctx={ctx} onClose={() => setShowAddProspects(false)} />}
      {showAddTalent && <AddTalentModal ctx={ctx} onClose={() => setShowAddTalent(false)} />}
      {showPromote && <PromoteDraftModal ctx={ctx} onClose={() => setShowPromote(false)} onDone={(teamId) => { refreshRelated(); navigate(`/collab/teams/${teamId}`); }} />}
      {showTitleEdit && <TitleEditModal current={d.title} onClose={() => setShowTitleEdit(false)} onSave={async (t) => {
        try {
          if (type === "draft") apply(await api.patch<{ data: WsDetail }>(`/collab/workspace/draft/${id}`, { title: t }));
          else { await api.patch(`/collab/teams/${id}`, { name: t }); qc.invalidateQueries({ queryKey }); refreshRelated(); }
          setShowTitleEdit(false);
        } catch (e) { setError(errText(e, "保存できませんでした。")); setShowTitleEdit(false); }
      }} />}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setRemoveTarget(null)}>
          <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>外しますか？</h2>
              <DialogCloseButton onClick={() => setRemoveTarget(null)} />
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-700)" }}>
              {removeTarget.kind === "talent" ? removeTarget.title : removeTarget.kind === "contact" && !removeTarget.isOwnerView ? "外部人脈の候補" : removeTarget.name}を、{removeTarget.kind === "talent" ? "募集人材" : "候補"}から外します。役割の入力も消えます。
            </p>
            <div className="flex gap-2">
              <button onClick={() => setRemoveTarget(null)} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
              <button onClick={() => removeProspect.mutate(removeTarget)} disabled={removeProspect.isPending} className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>外す</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TitleEditModal({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (t: string) => Promise<void> }) {
  const [title, setTitle] = useState(current);
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>名前を変更</h2>
          <DialogCloseButton onClick={onClose} />
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className="w-full px-3 py-2 rounded-xl border text-sm mb-4" style={{ borderColor: "var(--color-paper-300)" }} />
        <div className="flex gap-2">
          <button onClick={onClose} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={async () => { if (!title.trim()) return; setSaving(true); await onSave(title.trim()); }} disabled={saving || !title.trim()} className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>保存する</button>
        </div>
      </div>
    </div>
  );
}
