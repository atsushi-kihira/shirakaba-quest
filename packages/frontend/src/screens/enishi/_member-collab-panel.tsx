// =============================================================
// 人脈検索（メンバー）の結果に添える表示
//   ・MemberScoreBadge：条件への合致度（0〜100）を数値とバーで表す
//   ・MemberCollabPanel：合致度の上位メンバーの力を合わせた協業イメージ（全体のチーム活動／2〜3名の組み合わせ）
// =============================================================
import { Link } from "react-router-dom";

export type CollabMember = { memberId: string; name: string; emoji: string; bgColor: string; category: string };
export type CollabIdeas = {
  members: CollabMember[];
  team: { title: string; summary: string; roles: { memberId: string; role: string }[] } | null;
  combos: { memberIds: string[]; title: string; summary: string }[];
  isMock?: boolean;
  aiCallFailed?: boolean;
};

function scoreTone(score: number): { color: string; label: string } {
  if (score >= 80) return { color: "var(--color-success)", label: "とても合っています" };
  if (score >= 60) return { color: "var(--color-accent)", label: "よく合っています" };
  if (score >= 40) return { color: "var(--color-ink-500)", label: "一部が合っています" };
  return { color: "var(--color-ink-400)", label: "関連はあります" };
}

/** 条件への合致度を、数値（0〜100）と横棒で表す */
export function MemberScoreBadge({ score }: { score: number }) {
  const tone = scoreTone(score);
  return (
    <div className="flex items-center gap-2" title={`合致度 ${score}/100（${tone.label}）`}>
      <span className="text-[10px] font-bold" style={{ color: "var(--color-ink-500)" }}>合致度</span>
      <div className="w-24 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-paper-200)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, score)}%`, background: tone.color }} />
      </div>
      <span className="text-sm font-bold tabular-nums" style={{ color: tone.color }}>{score}<span className="text-[10px] font-medium ml-0.5">点</span></span>
    </div>
  );
}

function MemberChip({ m }: { m: CollabMember | undefined }) {
  if (!m) return null;
  return (
    <Link to={`/members/${m.memberId}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-800)" }}>
      <span>{m.emoji}</span>{m.name}
    </Link>
  );
}

export function MemberCollabPanel({ collab }: { collab: CollabIdeas }) {
  const byId = new Map(collab.members.map((m) => [m.memberId, m]));
  const hasIdeas = !!collab.team || collab.combos.length > 0;
  return (
    <div className="card-paper rounded-2xl p-4 mb-4" style={{ border: "1.5px solid rgba(90,140,92,0.35)" }}>
      <h2 className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-800)" }}>🤝 上位メンバーで考える協業イメージ</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
        条件への合致度が高い上位{collab.members.length}名の、職種・事業内容・USPをもとにAIが考えた提案です。実現を約束するものではなく、話し合いのたたき台としてお使いください。
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {collab.members.map((m) => <MemberChip key={m.memberId} m={m} />)}
      </div>

      {collab.isMock && (
        <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}>
          ※ 開発環境のため、AIの提案の代わりに見本を表示しています。
        </p>
      )}
      {collab.aiCallFailed && !hasIdeas && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)", color: "var(--color-brand)" }}>
          ⚠️ 協業イメージを作れませんでした。少し時間をおいて、もう一度検索してみてください。
        </p>
      )}

      {collab.team && (
        <section className="mb-4">
          <h3 className="text-xs font-bold mb-1.5" style={{ color: "var(--color-success)" }}>🌐 全体でのチーム活動（協業事業）のイメージ</h3>
          <div className="rounded-xl p-3" style={{ background: "rgba(90,140,92,0.08)" }}>
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-900)" }}>{collab.team.title}</p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{collab.team.summary}</p>
            {collab.team.roles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {collab.team.roles.map((r) => {
                  const m = byId.get(r.memberId);
                  return (
                    <li key={r.memberId} className="text-xs flex items-start gap-1.5" style={{ color: "var(--color-ink-700)" }}>
                      <span className="shrink-0"><MemberChip m={m} /></span>
                      <span className="pt-0.5">{r.role}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      {collab.combos.length > 0 && (
        <section>
          <h3 className="text-xs font-bold mb-1.5" style={{ color: "var(--color-accent)" }}>👥 2〜3名の組み合わせで考えられる協業イメージ</h3>
          <div className="space-y-2">
            {collab.combos.map((c, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: "var(--color-paper-100)" }}>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {c.memberIds.map((id) => <MemberChip key={id} m={byId.get(id)} />)}
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>{c.memberIds.length}名</span>
                </div>
                <p className="text-sm font-semibold mb-0.5" style={{ color: "var(--color-ink-900)" }}>{c.title}</p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{c.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
