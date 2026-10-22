// =============================================================
// 協働マップ — 検討中のチーム案の詳細
//   ・構成メンバー（自分＋メンバー＋自分の外部人脈、合計10名まで）の追加・削除
//   ・協働事業と、それぞれの役割のまとめ（AIで作成・まとめ直し。まとめ直すときは、追加の観点を与えられる）
//   ・十分に検討できたら、緩いチーム／パワーチームとして正式に結成
// チーム案は、作った本人だけに見える（他のユーザーには見えない）
// =============================================================
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import { MemberPickerPanel } from "./_team-draft-picker";

type DraftMember = { kind: "member" | "contact"; id: string; name: string; emoji: string; bgColor: string; headline: string; isMe: boolean };
type RegeneratePerspective = "broaden" | "suggest_members" | "new_member_roles" | "reassign_roles";
type SuggestedMember = { key: string; name: string; kind: "member" | "contact"; reason: string };
type DraftIdeas = {
  teamTitle?: string; businessTitle: string; targetCustomers?: string; summary: string; roles: { key: string; role: string }[]; firstSteps: string[];
  /** まとめたときのメンバー構成（"m:…"/"c:…"） */
  participantKeys: string[];
  alternativeIdeas?: { title: string; summary: string }[];
  suggestedMembers?: SuggestedMember[];
  appliedPerspectives?: RegeneratePerspective[]; appliedNote?: string;
  generatedAt: number; isMock?: boolean;
};

const PERSPECTIVE_LABEL: Record<RegeneratePerspective, string> = {
  broaden: "協働ビジネスの幅を広げる",
  suggest_members: "追加するメンバーの提案",
  new_member_roles: "追加したメンバーの役割",
  reassign_roles: "役割の割り振り直し",
};
type DraftDetail = {
  id: string; title: string; goal: string; members: DraftMember[]; ideas: DraftIdeas | null; ideasStale: boolean; maxMembers: number; updatedAt: number;
};

const keyOf = (m: Pick<DraftMember, "kind" | "id">) => `${m.kind === "member" ? "m" : "c"}:${m.id}`;
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function TeamDraftDetailScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const createdAiFailed = (location.state as { aiFailed?: boolean } | null)?.aiFailed === true;
  const qc = useQueryClient();
  const queryKey = ["collab", "team-drafts", id];
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showTitleEdit, setShowTitleEdit] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [goalText, setGoalText] = useState("");

  const { data, isLoading, error: loadError } = useQuery({
    queryKey,
    queryFn: () => api.get<{ data: DraftDetail }>(`/collab/team-drafts/${id}`),
  });
  const draft = data?.data;
  useEffect(() => { if (draft) setGoalText(draft.goal); }, [draft?.id, draft?.goal]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDetail = (res: { data: DraftDetail }) => {
    qc.setQueryData(queryKey, res);
    qc.invalidateQueries({ queryKey: ["collab", "team-drafts"], exact: true });
  };

  const update = useMutation({
    mutationFn: (body: { title?: string; goal?: string; memberIds?: string[]; contactIds?: string[] }) =>
      api.patch<{ data: DraftDetail }>(`/collab/team-drafts/${id}`, body),
    onSuccess: (res) => { setError(null); setDetail(res); },
    onError: (e) => setError(errText(e, "保存できませんでした。もう一度お試しください。")),
  });
  const generate = useMutation({
    mutationFn: (body: { perspectives?: RegeneratePerspective[]; note?: string }) =>
      api.post<{ data: DraftDetail }>(`/collab/team-drafts/${id}/generate`, body),
    onSuccess: (res) => { setError(null); setDetail(res); },
    onError: (e) => setError(errText(e, "協働事業をまとめられませんでした。少し時間をおいて、もう一度お試しください。")),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/collab/team-drafts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collab", "team-drafts"] }); navigate("/collab/drafts"); },
    onError: (e) => setError(errText(e, "削除できませんでした。")),
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>;
  if (loadError || !draft) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center">
        <p className="text-sm mb-3" style={{ color: "var(--color-ink-600)" }}>チーム案が見つかりませんでした。</p>
        <Link to="/collab/drafts" className="text-sm underline" style={{ color: "var(--color-brand)" }}>チーム案の一覧へ</Link>
      </div>
    );
  }

  const others = draft.members.filter((m) => !m.isMe);
  const memberIds = others.filter((m) => m.kind === "member").map((m) => m.id);
  const contactIds = others.filter((m) => m.kind === "contact").map((m) => m.id);
  const byKey = new Map(draft.members.map((m) => [keyOf(m), m]));
  const goalChanged = goalText.trim() !== draft.goal;
  const canGenerate = draft.members.length >= 2;
  // まとめたあとに追加されたメンバー（「追加したメンバーの役割」の観点で使う）
  const summarizedKeys = new Set(draft.ideas?.participantKeys ?? []);
  const newMembers = draft.ideas ? draft.members.filter((m) => !m.isMe && !summarizedKeys.has(keyOf(m))) : [];
  // 追加をおすすめするメンバー（すでにチームにいる人は出さない）
  const suggestions = (draft.ideas?.suggestedMembers ?? []).filter((m) => !byKey.has(m.key));
  function addSuggested(m: SuggestedMember) {
    const targetId = m.key.slice(2);
    update.mutate(m.kind === "member" ? { memberIds: [...memberIds, targetId] } : { contactIds: [...contactIds, targetId] });
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/collab/drafts" className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--color-paper-200)" }} aria-label="チーム案の一覧に戻る">
          <ChevronLeft size={20} style={{ color: "var(--color-ink-600)" }} />
        </Link>
        <h1 className="text-lg font-bold flex-1 min-w-0 truncate" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>🧪 {draft.title}</h1>
        <button onClick={() => setShowTitleEdit(true)} className="p-2 rounded-lg shrink-0" aria-label="タイトルを変更" style={{ color: "var(--color-ink-500)" }}><Pencil size={16} /></button>
        <button onClick={() => { if (confirm(`チーム案「${draft.title}」を削除します。よろしいですか？`)) remove.mutate(); }}
          disabled={remove.isPending} className="p-2 rounded-lg shrink-0 disabled:opacity-50" aria-label="チーム案を削除" style={{ color: "var(--color-ink-400)" }}><Trash2 size={16} /></button>
      </div>
      <p className="text-xs -mt-2" style={{ color: "var(--color-ink-500)" }}>🔒 このチーム案は、あなただけに見えます。</p>

      {createdAiFailed && !draft.ideas && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.14)", color: "var(--color-ink-700)" }}>
          ⚠️ チーム案は作成しましたが、AIがタイトルと協業の内容をまとめられませんでした。下の「まとめる」を押して、もう一度お試しください。
        </p>
      )}
      {error && <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}

      {/* 考えたいこと */}
      <section className="card-paper rounded-2xl p-4">
        <h2 className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>💭 どんな協業を考えたいか（任意）</h2>
        <textarea value={goalText} onChange={(e) => setGoalText(e.target.value)} rows={3} maxLength={1000}
          placeholder="例：ご家族を亡くされた方の、手続きから実家の整理・売却までを一緒に支えたい"
          className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
        {goalChanged && (
          <button onClick={() => update.mutate({ goal: goalText })} disabled={update.isPending}
            className="mt-2 px-4 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>保存する</button>
        )}
      </section>

      {/* 構成メンバー */}
      <section className="card-paper rounded-2xl p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-bold" style={{ color: "var(--color-ink-800)" }}>
            👥 メンバー（{draft.members.length}/{draft.maxMembers}名・自分を含む）
          </h2>
          <button onClick={() => setShowPicker(true)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white" style={{ background: "var(--color-success)" }}>
            <Plus size={12} /> 追加する
          </button>
        </div>
        <div className="space-y-1.5">
          {draft.members.map((m) => (
            <div key={keyOf(m)} className="flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)" }}>
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0 ${m.bgColor}`}>{m.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                  {m.name}{m.isMe && "（自分）"}
                  {m.kind === "contact" && <span className="text-[10px] font-bold ml-1.5 px-1.5 py-0.5 rounded-md" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>外部人脈</span>}
                </p>
                {m.headline && <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>{m.headline}</p>}
              </div>
              {!m.isMe && (
                <button
                  onClick={() => update.mutate(m.kind === "member"
                    ? { memberIds: memberIds.filter((x) => x !== m.id) }
                    : { contactIds: contactIds.filter((x) => x !== m.id) })}
                  disabled={update.isPending} aria-label={`${m.name}さんを外す`} className="p-1.5 rounded-lg shrink-0 disabled:opacity-50">
                  <X size={15} style={{ color: "var(--color-ink-400)" }} />
                </button>
              )}
            </div>
          ))}
        </div>
        {others.length === 0 && <p className="text-xs mt-2" style={{ color: "var(--color-ink-500)" }}>「追加する」から、一緒に組めそうなメンバーや外部人脈の方を選んでください。</p>}
      </section>

      {/* 協働事業と役割のまとめ */}
      <section className="card-paper rounded-2xl p-4" style={{ border: "1.5px solid rgba(90,140,92,0.35)" }}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-bold" style={{ color: "var(--color-ink-800)" }}>🤝 協働事業と、それぞれの役割</h2>
          <button onClick={() => (draft.ideas ? setShowRegenerate(true) : generate.mutate({}))} disabled={!canGenerate || generate.isPending}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            {generate.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {draft.ideas ? "まとめ直す" : "まとめる"}
          </button>
        </div>
        {!canGenerate && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>自分のほかに1名以上を選ぶと、協働事業をまとめられます。</p>}
        {generate.isPending && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>AIがメンバーの情報を読んで、協働事業を考えています…（少し時間がかかります）</p>}
        {draft.ideas && draft.ideasStale && (
          <p className="text-xs mb-2 px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.14)", color: "var(--color-ink-700)" }}>
            ⚠️ メンバーや「考えたいこと」が、まとめたときから変わっています。「まとめ直す」を押すと、いまの内容で作り直します（追加の観点も指定できます）。
          </p>
        )}
        {draft.ideas && (
          <div className={draft.ideasStale ? "opacity-70" : ""}>
            {draft.ideas.isMock && <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>※ 開発環境のため、AIの提案の代わりに見本を表示しています。</p>}
            <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(90,140,92,0.08)" }}>
              <p className="text-[10px] font-bold mb-0.5" style={{ color: "var(--color-success)" }}>協働事業のイメージ</p>
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-900)" }}>{draft.ideas.businessTitle}</p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{draft.ideas.summary}</p>
              {draft.ideas.targetCustomers && (
                <p className="text-xs leading-relaxed mt-2" style={{ color: "var(--color-ink-700)" }}>
                  <b style={{ color: "var(--color-success)" }}>🎯 お客様・対象：</b>{draft.ideas.targetCustomers}
                </p>
              )}
            </div>
            {(draft.ideas.appliedPerspectives?.length || draft.ideas.appliedNote) && (
              <p className="text-[11px] mb-3 -mt-1" style={{ color: "var(--color-ink-500)" }}>
                🔎 このまとめの追加の観点：
                {[...(draft.ideas.appliedPerspectives ?? []).map((p) => PERSPECTIVE_LABEL[p]), ...(draft.ideas.appliedNote ? [`「${draft.ideas.appliedNote}」`] : [])].join("、")}
              </p>
            )}
            <p className="text-[10px] font-bold mb-1" style={{ color: "var(--color-accent)" }}>それぞれの役割</p>
            <ul className="space-y-1.5 mb-3">
              {draft.ideas.roles.map((r) => {
                const m = byKey.get(r.key);
                if (!m) return null;
                return (
                  <li key={r.key} className="flex items-start gap-2 text-xs" style={{ color: "var(--color-ink-700)" }}>
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-800)" }}>
                      <span>{m.emoji}</span>{m.name}
                    </span>
                    <span className="pt-0.5">{r.role}</span>
                  </li>
                );
              })}
            </ul>
            {draft.ideas.firstSteps.length > 0 && (
              <>
                <p className="text-[10px] font-bold mb-1" style={{ color: "var(--color-ink-500)" }}>最初の一歩</p>
                <ol className="list-decimal pl-5 space-y-0.5 text-xs" style={{ color: "var(--color-ink-700)" }}>
                  {draft.ideas.firstSteps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </>
            )}
            {draft.ideas.alternativeIdeas && draft.ideas.alternativeIdeas.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] font-bold mb-1" style={{ color: "var(--color-success)" }}>💡 ほかの切り口の協働事業アイデア</p>
                <ul className="space-y-1.5">
                  {draft.ideas.alternativeIdeas.map((a, i) => (
                    <li key={i} className="text-xs rounded-xl px-3 py-2" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>
                      <p className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{a.title}</p>
                      <p className="leading-relaxed">{a.summary}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] font-bold mb-1" style={{ color: "var(--color-accent)" }}>👥 追加をおすすめするメンバー</p>
                <ul className="space-y-1.5">
                  {suggestions.map((m) => (
                    <li key={m.key} className="flex items-start gap-2 text-xs rounded-xl px-3 py-2" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold" style={{ color: "var(--color-ink-800)" }}>
                          {m.name}
                          {m.kind === "contact" && <span className="text-[10px] font-bold ml-1.5 px-1.5 py-0.5 rounded-md" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>外部人脈</span>}
                        </p>
                        {m.reason && <p className="leading-relaxed">{m.reason}</p>}
                      </div>
                      <button onClick={() => addSuggested(m)} disabled={update.isPending || draft.members.length >= draft.maxMembers}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-success)" }}>
                        <Plus size={11} /> 追加する
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] mt-1.5" style={{ color: "var(--color-ink-500)" }}>追加したあとは「まとめ直す」で、追加したメンバーの役割を考えてもらえます。</p>
              </div>
            )}
            <p className="text-[10px] mt-3" style={{ color: "var(--color-ink-400)" }}>実現を約束するものではなく、話し合いのたたき台です。メンバーを変えたあとは「まとめ直す」で作り直せます。</p>
          </div>
        )}
      </section>

      {/* 正式なチームへの昇格 */}
      <section className="card-paper rounded-2xl p-4">
        <h2 className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>🚀 正式なチームにする</h2>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          十分に検討できたら、いま選んでいるメンバーで、緩いチームまたはパワーチームとして結成できます。
          外部人脈の方は、正式なチームには入れません（メンバーだけで結成します）。結成すると、このチーム案は削除されます。
        </p>
        <button onClick={() => setShowPromote(true)} disabled={memberIds.length < 1}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-accent)" }}>
          緩いチーム／パワーチームにする
        </button>
        {memberIds.length < 1 && <p className="text-xs mt-2" style={{ color: "var(--color-ink-500)" }}>自分のほかに、メンバーを1名以上選ぶと結成できます。</p>}
      </section>

      {showRegenerate && <RegenerateModal
        newMemberNames={newMembers.map((m) => m.name)} full={draft.members.length >= draft.maxMembers} maxMembers={draft.maxMembers}
        pending={generate.isPending} error={error}
        onClose={() => { setError(null); setShowRegenerate(false); }}
        onRun={(perspectives, note) => { setError(null); generate.mutate({ perspectives, note }, { onSuccess: () => setShowRegenerate(false) }); }} />}
      {showTitleEdit && <TitleEditModal current={draft.title} saving={update.isPending}
        onClose={() => setShowTitleEdit(false)} onSave={(t) => update.mutate({ title: t }, { onSuccess: () => setShowTitleEdit(false) })} />}
      {showPicker && <PickerModal maxOthers={draft.maxMembers - 1} memberIds={memberIds} contactIds={contactIds} saving={update.isPending}
        onClose={() => setShowPicker(false)} onSave={(m, c) => update.mutate({ memberIds: m, contactIds: c }, { onSuccess: () => setShowPicker(false) })} />}
      {showPromote && <PromoteModal draftId={draft.id} defaultName={draft.title} memberCount={memberIds.length} contactCount={contactIds.length}
        onClose={() => setShowPromote(false)}
        onDone={() => { qc.invalidateQueries({ queryKey: ["collab"] }); navigate("/collab"); }} />}
    </div>
  );
}

const PERSPECTIVE_OPTIONS: { key: RegeneratePerspective; emoji: string; label: string; hint: string }[] = [
  { key: "broaden", emoji: "🌈", label: "協働ビジネスの幅を広げる", hint: "対象のお客様や提供の形など、別の可能性も取り入れて内容を広げます。ほかの切り口のアイデアも出します。" },
  { key: "suggest_members", emoji: "👥", label: "追加するメンバーを提案してもらう", hint: "メンバーや外部人脈の中から、加えるとよさそうな人を提案します。気に入れば、そのまま追加できます。" },
  { key: "new_member_roles", emoji: "➕", label: "自分で追加したメンバーの役割を考えてもらう", hint: "まとめたあとに追加した人の役割を、ほかのメンバーとのつながりも踏まえて考えます。" },
  { key: "reassign_roles", emoji: "🔄", label: "元のメンバーの役割を割り振り直す", hint: "前回の役割にとらわれず、全員の強みがより活きるように役割を組み直します。" },
];

/** 「まとめ直す」を押したときに、AIへの追加の観点を選ぶダイアログ */
function RegenerateModal({ newMemberNames, full, maxMembers, pending, error, onClose, onRun }: {
  newMemberNames: string[]; full: boolean; maxMembers: number; pending: boolean; error: string | null;
  onClose: () => void; onRun: (perspectives: RegeneratePerspective[], note: string) => void;
}) {
  const [selected, setSelected] = useState<Set<RegeneratePerspective>>(() => new Set(newMemberNames.length > 0 ? ["new_member_roles"] : []));
  const [note, setNote] = useState("");
  const disabledReason = (k: RegeneratePerspective): string | null => {
    if (k === "suggest_members" && full) return `メンバーが上限（${maxMembers}名）のため、提案できません`;
    if (k === "new_member_roles" && newMemberNames.length === 0) return "前回のまとめのあとに追加したメンバーはいません";
    return null;
  };
  function toggle(k: RegeneratePerspective) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => { if (!pending) onClose(); }}>
      <div className="card-paper p-5 w-full max-w-md rounded-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>✨ まとめ直す</h2>
          <DialogCloseButton onClick={onClose} disabled={pending} />
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          AIに伝える「追加の観点」を選べます（いくつでも選べます）。何も選ばなければ、いまの内容でそのまま作り直します。
        </p>
        <div className="space-y-2 mb-3">
          {PERSPECTIVE_OPTIONS.map((o) => {
            const off = disabledReason(o.key);
            const on = selected.has(o.key) && !off;
            return (
              <label key={o.key} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-2xl border cursor-pointer ${off ? "opacity-50 cursor-not-allowed" : ""}`}
                style={{ borderColor: on ? "var(--color-brand)" : "var(--color-paper-300)", background: on ? "rgba(181,56,75,0.06)" : "var(--color-paper-50)" }}>
                <input type="checkbox" checked={on} disabled={!!off || pending} onChange={() => toggle(o.key)} className="mt-1 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{o.emoji} {o.label}</span>
                  <span className="block text-xs leading-relaxed" style={{ color: "var(--color-ink-500)" }}>{off ?? o.hint}</span>
                  {o.key === "new_member_roles" && !off && (
                    <span className="block text-xs mt-0.5" style={{ color: "var(--color-ink-600)" }}>追加したメンバー：{newMemberNames.join("、")}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>💬 さらに伝えたい観点（任意）</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} disabled={pending}
          placeholder="例：個人のお客様向けではなく、企業向けのサービスとして考えたい／最初は小さく始められる形にしたい"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />
        {error && <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}
        {pending && <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>AIが、選んだ観点も取り入れて考えています…（少し時間がかかります）</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={pending} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium disabled:opacity-50" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => onRun(PERSPECTIVE_OPTIONS.map((o) => o.key).filter((k) => selected.has(k) && !disabledReason(k)), note.trim())} disabled={pending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}まとめ直す
          </button>
        </div>
      </div>
    </div>
  );
}

function TitleEditModal({ current, saving, onClose, onSave }: { current: string; saving: boolean; onClose: () => void; onSave: (t: string) => void }) {
  const [title, setTitle] = useState(current);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>タイトルを変更</h2>
          <DialogCloseButton onClick={onClose} />
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className="w-full px-3 py-2 rounded-xl border text-sm mb-4" style={{ borderColor: "var(--color-paper-300)" }} />
        <div className="flex gap-2">
          <button onClick={onClose} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => title.trim() && onSave(title.trim())} disabled={saving || !title.trim()}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>保存する</button>
        </div>
      </div>
    </div>
  );
}

function PickerModal({ maxOthers, memberIds, contactIds, saving, onClose, onSave }: {
  maxOthers: number; memberIds: string[]; contactIds: string[]; saving: boolean; onClose: () => void; onSave: (m: string[], c: string[]) => void;
}) {
  const [selM, setSelM] = useState<Set<string>>(new Set(memberIds));
  const [selC, setSelC] = useState<Set<string>>(new Set(contactIds));
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-md rounded-3xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>メンバーを選ぶ</h2>
          <DialogCloseButton onClick={onClose} />
        </div>
        <MemberPickerPanel maxOthers={maxOthers} selMembers={selM} selContacts={selC} onChange={(m, c) => { setSelM(m); setSelC(c); }} />
        <div className="flex gap-2 mt-3">
          <button onClick={onClose} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => onSave([...selM], [...selC])} disabled={saving}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
            {saving && <Loader2 size={14} className="animate-spin" />}この内容で保存する
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoteModal({ draftId, defaultName, memberCount, contactCount, onClose, onDone }: {
  draftId: string; defaultName: string; memberCount: number; contactCount: number; onClose: () => void; onDone: () => void;
}) {
  const [type, setType] = useState<"loose" | "power">("loose");
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const promote = useMutation({
    mutationFn: () => api.post(`/collab/team-drafts/${draftId}/promote`, { type, name: name.trim() }),
    onSuccess: onDone,
    onError: (e) => setError(errText(e, "結成できませんでした。もう一度お試しください。")),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>🚀 正式なチームにする</h2>
          <DialogCloseButton onClick={onClose} disabled={promote.isPending} />
        </div>
        <div className="flex gap-2 mb-2">
          <button onClick={() => setType("loose")} className="flex-1 py-2 rounded-2xl text-sm font-medium"
            style={{ background: type === "loose" ? "var(--color-brand)" : "var(--color-paper-200)", color: type === "loose" ? "white" : "var(--color-ink-600)" }}>🌿 緩いチーム</button>
          <button onClick={() => setType("power")} className="flex-1 py-2 rounded-2xl text-sm font-medium"
            style={{ background: type === "power" ? "var(--color-brand)" : "var(--color-paper-200)", color: type === "power" ? "white" : "var(--color-ink-600)" }}>⚡ パワーチーム</button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          {type === "loose" ? "承諾なしで、すぐにチームになれます。" : "宣言すると、選んだメンバーに承諾の確認が届き、全員が承諾すると成立します。"}
        </p>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>チーム名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />
        <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}>
          自分を含めて{memberCount + 1}名のメンバーで結成します。
          {contactCount > 0 && `外部人脈の${contactCount}名は、正式なチームには入れないため含まれません。`}
          結成すると、このチーム案は削除されます。
        </p>
        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={promote.isPending} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium disabled:opacity-50" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => { setError(null); if (!name.trim()) { setError("チーム名を入力してください"); return; } promote.mutate(); }} disabled={promote.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-accent)" }}>
            {promote.isPending && <Loader2 size={14} className="animate-spin" />}{type === "loose" ? "結成する" : "宣言する"}
          </button>
        </div>
      </div>
    </div>
  );
}
