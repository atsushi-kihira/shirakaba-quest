// =============================================================
// チーム育成の画面：メンバー（参加中）・候補・募集人材と、それぞれの役割
//   ・役割は、参加中のメンバーなら誰でも編集できる。自分の役割はそのまま反映、他の人の役割は、リーダー以外が書き換えると、リーダーの承認待ちの提案になる
//   ・「確定」は、AIのまとめ直しで外さない印（参加中の人は自動で確定）
//   ・外部人脈の候補は、登録した人以外には、名前・社名を出さない（専門分野・事業の概要・関係性だけ）
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Lock, Pencil, Plus, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import { MemberAvatar } from "@/components/member-avatar";
import { MemberPickerPanel } from "./_team-draft-picker";
import { SOURCE_LABEL, type WsCtx, type WsDetail, type WsMember, type WsProspect } from "./_ws-types";

const Pill = ({ children, tone = "mute" }: { children: React.ReactNode; tone?: "mute" | "gold" | "green" | "rose" }) => (
  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap" style={{
    background: tone === "gold" ? "rgba(212,160,59,0.16)" : tone === "green" ? "rgba(90,140,92,0.14)" : tone === "rose" ? "rgba(181,56,75,0.1)" : "var(--color-paper-200)",
    color: tone === "gold" ? "#8a6414" : tone === "green" ? "var(--color-success)" : tone === "rose" ? "var(--color-brand)" : "var(--color-ink-500)",
  }}>{children}</span>
);

/** チーム案で、AIが提案した人か、自分で追加した人かを示す印 */
const SourcePill = ({ source }: { source: "ai" | "manual" }) => (
  <Pill tone={source === "ai" ? "rose" : "green"}>{source === "ai" ? <Sparkles size={9} /> : <Pencil size={9} />}{SOURCE_LABEL[source]}</Pill>
);

const SECTION = "card-paper rounded-2xl p-4";
const H2 = { color: "var(--color-ink-800)" } as const;

// ---- 役割の1行（表示と、その場での編集） ----
function RoleLine({ ctx, itemKey, role, isOwn }: { ctx: WsCtx; itemKey: string; role: string | null; isOwn: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = ctx.d.access.isActive;
  // リーダー（チーム案では作成者）と、自分の役割は、そのまま反映される。それ以外は、リーダーの承認待ちの提案になる
  const direct = ctx.d.access.isLeader || isOwn;

  const save = useMutation({
    mutationFn: () => api.put<{ data: WsDetail; pending: boolean }>(`${ctx.base}/roles`, { key: itemKey, role: text }),
    onSuccess: (res) => {
      ctx.clearError(); ctx.apply(res); setEditing(false);
      setNotice(res.pending ? "リーダーの承認待ちの提案として送りました。承認されると反映されます" : null);
    },
    onError: (e) => ctx.fail(e, "役割を保存できませんでした。もう一度お試しください。"),
  });

  if (editing) {
    return (
      <div className="pl-10 mt-1">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={200} autoFocus
          className="w-full px-2.5 py-1.5 rounded-xl border text-xs" style={{ borderColor: "var(--color-brand)", background: "#fff" }} />
        {!direct && <p className="text-[10px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>他の人の役割は、リーダーが承認すると反映されます</p>}
        <div className="flex gap-1.5 justify-end mt-1">
          <button onClick={() => setEditing(false)} disabled={save.isPending} className="text-xs px-2.5 py-1 rounded-lg" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>取消</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || (!direct && !text.trim())} className="text-xs px-2.5 py-1 rounded-lg text-white disabled:opacity-50 flex items-center gap-1" style={{ background: "var(--color-brand)" }}>
            {save.isPending && <Loader2 size={11} className="animate-spin" />}{direct ? "保存" : "提案する"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="pl-10 mt-0.5">
      <button disabled={!canEdit} onClick={() => { setText(role ?? ""); setEditing(true); setNotice(null); ctx.clearError(); }}
        className="flex items-start gap-1.5 text-left text-xs w-full disabled:cursor-default" style={{ color: role ? "var(--color-ink-700)" : "var(--color-ink-400)" }}>
        {canEdit && <Pencil size={11} className="mt-0.5 shrink-0" style={{ color: "var(--color-ink-400)" }} />}
        <span className="min-w-0 break-words">{role ?? (canEdit ? "役割が未入力です（タップして入力）" : "")}</span>
      </button>
      {notice && <p className="text-[10px] mt-0.5" style={{ color: "var(--color-accent)" }}>{notice}</p>}
    </div>
  );
}

// ---- 役割の変更の提案（承認待ち） ----
function RoleRequests({ ctx, itemKey }: { ctx: WsCtx; itemKey: string }) {
  const reqs = ctx.d.roleRequests.filter((r) => r.targetKey === itemKey);
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) => api.post<{ data: WsDetail }>(`${ctx.base}/role-requests/${id}/${decision}`, {}),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); },
    onError: (e) => ctx.fail(e, "操作できませんでした。もう一度お試しください。"),
  });
  if (reqs.length === 0) return null;
  return (
    <div className="pl-10 mt-1 space-y-1">
      {reqs.map((r) => (
        <div key={r.id} className="rounded-xl px-2.5 py-1.5 text-xs" style={{ background: "rgba(212,160,59,0.13)" }}>
          <p style={{ color: "var(--color-ink-700)" }}>
            <b>{r.mine ? "あなたの提案（承認待ち）" : `${r.requestedBy.name}さんの提案`}：</b>{r.proposedRole}
          </p>
          {ctx.d.access.isLeader && (
            <div className="flex gap-1.5 mt-1">
              <button onClick={() => decide.mutate({ id: r.id, decision: "approve" })} disabled={decide.isPending} className="text-[11px] px-2.5 py-0.5 rounded-lg text-white" style={{ background: "var(--color-success)" }}>承認</button>
              <button onClick={() => decide.mutate({ id: r.id, decision: "reject" })} disabled={decide.isPending} className="text-[11px] px-2.5 py-0.5 rounded-lg" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>却下</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- 参加中のメンバー ----
export function MembersCard({ ctx, onInvite }: { ctx: WsCtx; onInvite?: () => void }) {
  const { d } = ctx;
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-bold" style={H2}>👥 {d.stage === "draft" ? "自分" : `参加中のメンバー（${d.members.filter((m) => m.status === "active").length}名）`}</h2>
        {onInvite && d.access.isLeader && <button onClick={onInvite} className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>管理（招待・昇格など）</button>}
      </div>
      <div className="space-y-2.5">
        {d.members.map((m: WsMember) => (
          <div key={m.key}>
            <div className="flex items-center gap-2.5">
              <MemberAvatar memberId={m.id} emoji={m.emoji} bgColor={m.bgColor} avatarImageKey={m.avatarImageKey} size="sm" rounded="rounded-full" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                  {m.name}{m.isMe && "（自分）"}
                  {m.isLeader && <span className="ml-1.5"><Pill tone="gold">{d.stage === "draft" ? "作成者" : "リーダー"}</Pill></span>}
                  {m.status === "pending" && <span className="ml-1.5"><Pill tone="rose">{m.joinRequest ? "参加希望" : "招待中"}</Pill></span>}
                </p>
                {m.headline && <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>{m.headline}</p>}
              </div>
              {m.status === "active" && <Pill><Lock size={9} />確定</Pill>}
            </div>
            {(d.access.isActive || m.isMe) && <RoleLine ctx={ctx} itemKey={m.key} role={m.role} isOwn={m.isMe} />}
            {d.access.isActive && <RoleRequests ctx={ctx} itemKey={m.key} />}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- 候補（メンバー・外部人脈） ----
function ProspectRow({ ctx, p, onRemove }: { ctx: WsCtx; p: WsProspect; onRemove: (p: WsProspect) => void }) {
  const leader = ctx.d.access.isLeader;
  const patch = useMutation({
    mutationFn: (body: { locked: boolean }) => api.patch<{ data: WsDetail }>(`${ctx.base}/prospects/${p.prospectId}`, body),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); },
    onError: (e) => ctx.fail(e, "変更できませんでした。もう一度お試しください。"),
  });
  const invite = useMutation({
    mutationFn: () => api.post<{ data: WsDetail }>(`${ctx.base}/prospects/${p.prospectId}/invite`, {}),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); },
    onError: (e) => ctx.fail(e, "声をかけられませんでした。もう一度お試しください。"),
  });
  const isContact = p.kind === "contact";
  const name = isContact ? (p.isOwnerView ? p.name : "外部人脈の候補") : p.name;
  const sub = isContact ? [p.specialty, p.isOwnerView ? p.company : null].filter(Boolean).join("／") : p.headline;
  return (
    <div>
      <div className="flex items-center gap-2.5">
        {isContact
          ? <span className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0 bg-stone-100">👤</span>
          : <MemberAvatar memberId={p.memberId as string} emoji={p.emoji ?? "🙂"} bgColor={p.bgColor ?? "bg-amber-100"} avatarImageKey={p.avatarImageKey} size="sm" rounded="rounded-full" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
            {name}{isContact && <span className="ml-1.5"><Pill>外部人脈</Pill></span>}
            {ctx.d.type === "draft" && <span className="ml-1.5"><SourcePill source={p.source} /></span>}
          </p>
          {sub && <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>{sub}</p>}
        </div>
        {leader ? (
          <button onClick={() => patch.mutate({ locked: !p.locked })} disabled={patch.isPending} aria-pressed={p.locked}
            className="flex items-center gap-0.5 text-[10px] font-bold px-2 py-1 rounded-md shrink-0"
            style={{ background: p.locked ? "rgba(212,160,59,0.2)" : "var(--color-paper-200)", color: p.locked ? "#8a6414" : "var(--color-ink-500)" }}>
            <Star size={10} fill={p.locked ? "currentColor" : "none"} />{p.locked ? "確定" : "確定にする"}
          </button>
        ) : p.locked ? <Pill tone="gold"><Star size={9} fill="currentColor" />確定</Pill> : null}
      </div>
      {isContact && !p.isOwnerView && (p.summary || (p.relationships ?? []).length > 0) && (
        <p className="pl-10 text-xs mt-0.5 leading-relaxed" style={{ color: "var(--color-ink-600)" }}>
          {p.summary}{(p.relationships ?? []).length > 0 && <span style={{ color: "var(--color-ink-400)" }}>{p.summary ? " ／ " : ""}関係性：{(p.relationships ?? []).join("・")}</span>}
        </p>
      )}
      {isContact && !p.isOwnerView && <p className="pl-10 text-[10px] mt-0.5" style={{ color: "var(--color-ink-400)" }}>名前・社名は、登録した人だけに表示されます</p>}
      <RoleLine ctx={ctx} itemKey={p.key} role={p.role} isOwn={false} />
      <RoleRequests ctx={ctx} itemKey={p.key} />
      {leader && (
        <div className="flex flex-wrap gap-1.5 pl-10 mt-1.5">
          {p.kind === "member" && ctx.d.type === "team" && (
            <button onClick={() => invite.mutate()} disabled={invite.isPending} className="text-[11px] px-2.5 py-1 rounded-lg text-white flex items-center gap-1" style={{ background: "var(--color-success)" }}>
              {invite.isPending && <Loader2 size={10} className="animate-spin" />}声をかける
            </button>
          )}
          <button onClick={() => onRemove(p)} className="text-[11px] px-2.5 py-1 rounded-lg" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>候補から外す</button>
        </div>
      )}
    </div>
  );
}

const SubHead = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-bold mb-1.5 mt-1" style={{ color: "var(--color-ink-700)" }}>{children}</p>
);

export function ProspectsCard({ ctx, onAdd, onRemove }: { ctx: WsCtx; onAdd: () => void; onRemove: (p: WsProspect) => void }) {
  const { d } = ctx;
  const list = d.prospects.filter((p) => p.kind !== "talent");
  const talents = d.prospects.filter((p) => p.kind === "talent").length;
  const lim = d.limits;
  // チーム案は「自分で追加した人」の枠（AIが提案した人は別枠）。正式なチームは、候補と募集人材を合わせた枠
  const full = lim ? lim.manual.used >= lim.manual.max : d.prospects.length >= d.maxPeople;
  if (!d.access.isActive) return null;
  const rows = (items: WsProspect[]) => <div className="space-y-3">{items.map((p) => <ProspectRow key={p.prospectId} ctx={ctx} p={p} onRemove={onRemove} />)}</div>;
  const ai = list.filter((p) => p.source === "ai");
  const manual = list.filter((p) => p.source === "manual");
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-bold" style={H2}>🌱 {d.stage === "draft" ? "メンバー案" : "候補"}（{list.length}名）</h2>
        {d.access.isLeader && (
          <button onClick={onAdd} disabled={full} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-success)" }}>
            <Plus size={12} /> {lim ? "自分で追加する" : "追加する"}
          </button>
        )}
      </div>
      <p className="text-[11px] mb-2.5" style={{ color: "var(--color-ink-500)" }}>
        {lim
          ? `誰の承諾も得ていない段階です。AIが提案する人は最大${lim.ai.max}名（関係が薄ければ、それより少なくなります）、自分で追加できる人は、人材像もあわせて最大${lim.manual.max}名（いま${lim.manual.used}名）です。`
          : `まだ参加していない人です（本人には、声をかけるまで知らせません）。参加中のメンバーには見えます。候補と募集人材は合わせて最大${d.maxPeople}名（いま${d.prospects.length}名）。`}
        「確定」にした人は、AIのまとめ直しで外されません。
      </p>
      {list.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
          {d.access.isLeader ? "「追加する」から、候補にするメンバーや外部人脈を選べます。" : "まだ候補はいません。"}{talents > 0 && "（募集人材は下にあります）"}
        </p>
      ) : lim ? (
        <div className="space-y-4">
          <div>
            <SubHead>✨ AIが提案した人（{ai.length}名／最大{lim.ai.max}名）</SubHead>
            {ai.length > 0 ? rows(ai) : <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>まだいません。「AIで再検討する」で、追加するメンバーを提案してもらえます。</p>}
          </div>
          <div>
            <SubHead>✍️ 自分で追加した人（{manual.length}名）</SubHead>
            {manual.length > 0 ? rows(manual) : <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>まだいません。</p>}
          </div>
        </div>
      ) : rows(list)}
    </section>
  );
}

// ---- 募集人材 ----
function TalentRow({ ctx, p, onRemove }: { ctx: WsCtx; p: WsProspect; onRemove: (p: WsProspect) => void }) {
  const leader = ctx.d.access.isLeader;
  const patch = useMutation({
    mutationFn: (body: { locked?: boolean; published?: boolean }) => api.patch<{ data: WsDetail }>(`${ctx.base}/prospects/${p.prospectId}`, body),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); },
    onError: (e) => ctx.fail(e, "変更できませんでした。もう一度お試しください。"),
  });
  const query = encodeURIComponent(`${p.title ?? ""} ${p.profile ?? ""}`.trim());
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: "#FFFBEF", border: "1px dashed #c9b88f" }}>
      <div className="flex items-start gap-2">
        <p className="flex-1 min-w-0 text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>{p.title}{ctx.d.type === "draft" && <span className="ml-1.5 align-middle"><SourcePill source={p.source} /></span>}</p>
        {p.filled ? <Pill tone="green"><Check size={9} />充足</Pill> : p.published ? <Pill tone="green">公開中</Pill> : <Pill>非公開</Pill>}
        {leader && !p.filled && (
          <button onClick={() => patch.mutate({ locked: !p.locked })} disabled={patch.isPending} aria-pressed={p.locked} className="flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0"
            style={{ background: p.locked ? "rgba(212,160,59,0.2)" : "var(--color-paper-200)", color: p.locked ? "#8a6414" : "var(--color-ink-500)" }}>
            <Star size={10} fill={p.locked ? "currentColor" : "none"} />{p.locked ? "確定" : "確定にする"}
          </button>
        )}
      </div>
      {p.profile && <p className="text-xs leading-relaxed mt-1" style={{ color: "var(--color-ink-700)" }}><b style={{ color: "var(--color-accent)" }}>人物像：</b>{p.profile}</p>}
      {p.reason && <p className="text-xs leading-relaxed mt-0.5" style={{ color: "var(--color-ink-700)" }}><b style={{ color: "var(--color-success)" }}>補えること：</b>{p.reason}</p>}
      {p.filled && <p className="text-xs mt-1" style={{ color: "var(--color-success)" }}>✅ {p.filledByName ?? "メンバー"}さんが加わりました</p>}
      {!p.filled && <div className="-ml-10"><RoleLine ctx={ctx} itemKey={p.key} role={p.role} isOwn={false} /></div>}
      {!p.filled && <div className="-ml-10"><RoleRequests ctx={ctx} itemKey={p.key} /></div>}
      {leader && !p.filled && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Link to={`/enishi?mode=contact-search&filter=usp&q=${query}`} className="text-[11px] px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            <Search size={10} />この人物像で人脈検索
          </Link>
          {ctx.d.type === "team" && (
            <button onClick={() => patch.mutate({ published: !p.published })} disabled={patch.isPending} className="text-[11px] px-2.5 py-1 rounded-lg text-white" style={{ background: p.published ? "var(--color-ink-400)" : "var(--color-success)" }}>
              {p.published ? "公開をやめる" : "募集として公開"}
            </button>
          )}
          <button onClick={() => onRemove(p)} className="text-[11px] px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}><Trash2 size={10} />外す</button>
        </div>
      )}
    </div>
  );
}

export function TalentsCard({ ctx, onAdd, onRemove }: { ctx: WsCtx; onAdd: () => void; onRemove: (p: WsProspect) => void }) {
  const { d } = ctx;
  const talents = d.prospects.filter((p) => p.kind === "talent");
  const full = d.limits ? d.limits.manual.used >= d.limits.manual.max : d.prospects.length >= d.maxPeople;
  if (!d.access.isActive) return null;
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-bold" style={H2}>🔍 追加できるとよい人材・募集人材（{talents.length}名）</h2>
        {d.access.isLeader && (
          <button onClick={onAdd} disabled={full} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-success)" }}>
            <Plus size={12} /> {d.limits ? "自分で追加する" : "追加する"}
          </button>
        )}
      </div>
      <p className="text-[11px] mb-2.5" style={{ color: "var(--color-ink-500)" }}>
        チャプターにも外部にもまだいない、「こんな人がいるとよい」という人物像です（実在の人ではありません）。
        {d.stage !== "draft" && "「募集として公開」すると、チャプターのメンバーから「興味あり」の声が届きます。"}
      </p>
      {talents.length === 0
        ? <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>まだありません。AIで再検討すると、チームに足りない人材を提案します。</p>
        : <div className="space-y-2.5">{talents.map((p) => <TalentRow key={p.prospectId} ctx={ctx} p={p} onRemove={onRemove} />)}</div>}
    </section>
  );
}

// ---- 追加のダイアログ ----
const ROLE_PLACEHOLDER = "例：お客様への最初のご相談窓口を担当する";

/** 追加する人ごとの役割（任意）の入力と、「AIに役割を考えてもらう」の選択 */
function RoleInputs({ people, roles, onRole, aiRoles, onAi, disabled }: {
  people: { key: string; name: string }[]; roles: Record<string, string>; onRole: (key: string, v: string) => void;
  aiRoles: boolean; onAi: (v: boolean) => void; disabled: boolean;
}) {
  if (people.length === 0) return null;
  return (
    <div className="mt-3 rounded-2xl px-3 py-2.5" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
      <p className="text-xs font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>🎭 役割（任意）</p>
      <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
        その人に担ってほしい役割を、書けます。空欄のままでも大丈夫です。あとから書くことも、「AIで再検討する」でまとめて考えることもできます。
      </p>
      <div className="space-y-2">
        {people.map((p) => (
          <label key={p.key} className="block">
            <span className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--color-ink-600)" }}>{p.name}</span>
            <textarea value={roles[p.key] ?? ""} onChange={(e) => onRole(p.key, e.target.value)} rows={2} maxLength={200} disabled={disabled} placeholder={ROLE_PLACEHOLDER}
              className="w-full px-2.5 py-1.5 rounded-xl border text-xs" style={{ borderColor: "var(--color-paper-300)", background: "#fff" }} />
          </label>
        ))}
      </div>
      <label className="flex items-start gap-2 mt-2.5 text-xs cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
        <input type="checkbox" checked={aiRoles} onChange={(e) => onAi(e.target.checked)} disabled={disabled} className="mt-0.5 shrink-0" />
        <span><b>追加したあと、AIに役割を考えてもらう</b><br />
          <span style={{ color: "var(--color-ink-500)" }}>書いた役割は、意図を残して整えます。空欄の人は、その人の強み・USPなどから考えます。</span></span>
      </label>
    </div>
  );
}

export function AddProspectsModal({ ctx, onClose }: { ctx: WsCtx; onClose: () => void }) {
  const { d } = ctx;
  // チーム案は「自分で追加した人」の枠の空き（AIが提案した人は別枠）。正式なチームは、候補と募集人材を合わせた枠の空き
  const room = d.limits ? d.limits.manual.max - d.limits.manual.used : d.maxPeople - d.prospects.length;
  const taken = new Set([...d.members.map((m) => m.id), ...d.prospects.filter((p) => p.kind === "member").map((p) => p.memberId as string)]);
  const [selM, setSelM] = useState<Set<string>>(new Set());
  const [selC, setSelC] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [aiRoles, setAiRoles] = useState(false);
  // 役割の入力欄に出す名前（メンバー・外部人脈の一覧は、選ぶ画面と同じ取得のキャッシュを使う）
  const membersQ = useQuery({ queryKey: ["members"], queryFn: () => api.get<{ data: { id: string; name: string }[] }>("/members") });
  const contactsQ = useQuery({ queryKey: ["collab", "contacts"], queryFn: () => api.get<{ data: { id: string; name: string }[] }>("/collab/contacts") });
  const people = [
    ...[...selM].map((id) => ({ key: `m:${id}`, name: membersQ.data?.data.find((m) => m.id === id)?.name ?? "メンバー" })),
    ...[...selC].map((id) => ({ key: `c:${id}`, name: contactsQ.data?.data.find((c) => c.id === id)?.name ?? "外部人脈" })),
  ];
  const add = useMutation({
    mutationFn: () => api.post<{ data: WsDetail; warning: string | null }>(`${ctx.base}/prospects`, {
      memberIds: [...selM], contactIds: [...selC], aiRoles,
      roles: Object.fromEntries(people.map((p) => [p.key, (roles[p.key] ?? "").trim()]).filter(([, v]) => v)),
    }),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); if (res.warning) ctx.fail(new Error(res.warning), res.warning); onClose(); },
    onError: (e) => ctx.fail(e, "追加できませんでした。もう一度お試しください。"),
  });
  const alreadyContacts = new Set(d.prospects.filter((p) => p.kind === "contact").map((p) => p.key.slice(2)));
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => { if (!add.isPending) onClose(); }}>
      <div className="card-paper p-5 w-full max-w-md rounded-3xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>{d.stage === "draft" ? "メンバー案に自分で追加する" : "候補に追加する"}</h2>
          <DialogCloseButton onClick={onClose} disabled={add.isPending} />
        </div>
        <MemberPickerPanel maxOthers={Math.max(0, room)} selMembers={selM} selContacts={selC} onChange={(m, c) => {
          setSelM(new Set([...m].filter((id) => !taken.has(id)))); setSelC(new Set([...c].filter((id) => !alreadyContacts.has(id))));
        }} />
        <RoleInputs people={people} roles={roles} onRole={(k, v) => setRoles((r) => ({ ...r, [k]: v }))} aiRoles={aiRoles} onAi={setAiRoles} disabled={add.isPending} />
        {add.isPending && aiRoles && <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "var(--color-ink-600)" }}><Loader2 size={12} className="animate-spin" />AIが役割を考えています…（少し時間がかかります）</p>}
        <div className="flex gap-2 mt-3">
          <button onClick={onClose} disabled={add.isPending} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => add.mutate()} disabled={add.isPending || selM.size + selC.size === 0} className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
            {add.isPending && <Loader2 size={14} className="animate-spin" />}追加する
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddTalentModal({ ctx, onClose }: { ctx: WsCtx; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [profile, setProfile] = useState("");
  const [reason, setReason] = useState("");
  const [role, setRole] = useState("");
  const [aiRoles, setAiRoles] = useState(false);
  const add = useMutation({
    mutationFn: () => api.post<{ data: WsDetail; warning: string | null }>(`${ctx.base}/prospects`, { talent: { title, profile, reason, role: role.trim() }, aiRoles }),
    onSuccess: (res) => { ctx.clearError(); ctx.apply(res); if (res.warning) ctx.fail(new Error(res.warning), res.warning); onClose(); },
    onError: (e) => ctx.fail(e, "追加できませんでした。もう一度お試しください。"),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => { if (!add.isPending) onClose(); }}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>募集したい人材を追加</h2>
          <DialogCloseButton onClick={onClose} disabled={add.isPending} />
        </div>
        <div className="space-y-2.5">
          <label className="block"><span className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>業種・職種 <span style={{ color: "var(--color-brand)" }}>*</span></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="例：不動産の売却・査定に強い宅建士" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} /></label>
          <label className="block"><span className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>人物像（ビジネス面）</span>
            <textarea value={profile} onChange={(e) => setProfile(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} /></label>
          <label className="block"><span className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>補えること</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} /></label>
        </div>
        <RoleInputs people={[{ key: "talent", name: title.trim() || "この人材" }]} roles={{ talent: role }} onRole={(_, v) => setRole(v)} aiRoles={aiRoles} onAi={setAiRoles} disabled={add.isPending} />
        {add.isPending && aiRoles && <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "var(--color-ink-600)" }}><Loader2 size={12} className="animate-spin" />AIが役割を考えています…（少し時間がかかります）</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} disabled={add.isPending} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => add.mutate()} disabled={add.isPending || !title.trim()} className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
            {add.isPending && <Loader2 size={14} className="animate-spin" />}追加する
          </button>
        </div>
      </div>
    </div>
  );
}
