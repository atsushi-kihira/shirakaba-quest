// =============================================================
// 共有された内容の表示（読み取り専用）。kind ごとに部品を分ける
// =============================================================
import type { ReactNode } from "react";
import { STAGE_LABEL } from "@/screens/collab/_ws-types";
import type { ContactsBody, DraftBody, DraftCandidate, ResultBody, SharedResultCard, TeamProfileBody, ViewerLevel } from "./_shared-types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card-paper p-4 rounded-3xl">
      <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>{title}</h2>
      {children}
    </section>
  );
}

const Text = ({ children }: { children: string }) => (
  <p className="text-sm whitespace-pre-wrap break-words" style={{ color: "var(--color-ink-700)" }}>{children}</p>
);

export function TeamProfileBodyView({ body }: { body: TeamProfileBody }) {
  const stage = STAGE_LABEL[body.stage];
  const p = body.profile;
  const hasProfile = !!p && (p.businessTitle || p.summary || p.targetCustomers || p.goal || p.firstSteps.length > 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: "var(--color-paper-200)", color: stage.color }}>{stage.emoji} {stage.label}</span>
        {body.archived && <span className="px-3 py-1 rounded-full text-xs" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>活動を終えたチーム</span>}
      </div>

      <Section title="チームの事業">
        {!hasProfile && <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>まだプロフィールが入力されていません</p>}
        {p?.isProvisional && hasProfile && (
          <p className="text-xs mb-2 px-3 py-1.5 rounded-xl" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
            🤖 AIが仮に作った内容です。リーダーはまだ確認していません
          </p>
        )}
        <div className="space-y-3">
          {p?.businessTitle && <div><p className="text-xs mb-0.5" style={{ color: "var(--color-ink-400)" }}>事業名</p><Text>{p.businessTitle}</Text></div>}
          {p?.summary && <div><p className="text-xs mb-0.5" style={{ color: "var(--color-ink-400)" }}>概要</p><Text>{p.summary}</Text></div>}
          {p?.targetCustomers && <div><p className="text-xs mb-0.5" style={{ color: "var(--color-ink-400)" }}>お客様像</p><Text>{p.targetCustomers}</Text></div>}
          {p?.goal && <div><p className="text-xs mb-0.5" style={{ color: "var(--color-ink-400)" }}>ゴール</p><Text>{p.goal}</Text></div>}
          {p && p.firstSteps.length > 0 && (
            <div>
              <p className="text-xs mb-0.5" style={{ color: "var(--color-ink-400)" }}>最初の一歩</p>
              <ul className="list-disc pl-5 space-y-0.5">{p.firstSteps.map((s, i) => <li key={i} className="text-sm break-words" style={{ color: "var(--color-ink-700)" }}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      </Section>

      <Section title={`メンバーと役割（${body.members.length}名）`}>
        <ul className="space-y-2">
          {body.members.map((m) => (
            <li key={m.id} className="flex items-start gap-3">
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${m.bgColor}`}>{m.emoji}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>
                  {m.name}{m.isLeader && <span className="ml-1.5 text-xs" style={{ color: "var(--color-brand)" }}>リーダー</span>}
                </p>
                {m.headline && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{m.headline}</p>}
                <p className="text-sm break-words" style={{ color: m.role ? "var(--color-ink-700)" : "var(--color-ink-400)" }}>{m.role ?? "役割は、まだ決まっていません"}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {body.talents.length > 0 && (
        <Section title="募集している人">
          <ul className="space-y-3">
            {body.talents.map((t, i) => (
              <li key={i}>
                <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>{t.title}</p>
                {t.profile && <Text>{t.profile}</Text>}
                {t.role && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>役割：{t.role}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

const Label = ({ children }: { children: string }) => <p className="text-xs mb-0.5" style={{ color: "var(--color-ink-400)" }}>{children}</p>;

export function ContactsBodyView({ body }: { body: ContactsBody }) {
  return (
    <div className="space-y-3">
      <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
        人脈ごとの公開の設定のとおりに表示しています。名前・会社名は、「全公開」にした人脈だけです。備考は表示されません。
      </p>
      {body.contacts.length === 0 && <div className="card-paper p-6 rounded-3xl text-center text-sm" style={{ color: "var(--color-ink-500)" }}>表示できる人脈はありません</div>}
      <ul className="space-y-2">
        {body.contacts.map((c) => (
          <li key={c.id} className="card-paper p-3 rounded-2xl">
            <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>
              {c.name ?? "（名前は非公開）"}{c.company && <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-500)" }}>{c.company}</span>}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {c.specialty && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>{c.specialty}</span>}
              {c.prefecture && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>📍 {c.prefecture}</span>}
              {c.relationships.map((r) => <span key={r} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>{r}</span>)}
            </div>
            {c.summary && <p className="text-xs mt-1.5 break-words" style={{ color: "var(--color-ink-600)" }}>{c.summary}</p>}
          </li>
        ))}
      </ul>
      {body.truncated && <p className="text-xs text-center" style={{ color: "var(--color-ink-400)" }}>件数が多いため、一部だけを表示しています</p>}
    </div>
  );
}

export function DraftBodyView({ body }: { body: DraftBody }) {
  const p = body.profile;
  const has = !!p && (p.businessTitle || p.summary || p.targetCustomers || p.firstSteps.length > 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: "var(--color-paper-200)", color: STAGE_LABEL.draft.color }}>{STAGE_LABEL.draft.emoji} {STAGE_LABEL.draft.label}</span>
      </div>
      <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
        検討中の案です。メンバー案は、話し合うための候補で、まだ確定ではありません（ご本人の承諾も得ていません）。
      </p>
      <Section title="チームのねらい">
        {body.goal ? <Text>{body.goal}</Text> : <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>まだ入力されていません</p>}
      </Section>
      {has && (
        <Section title="事業のイメージ">
          {p?.isProvisional && <p className="text-xs mb-2 px-3 py-1.5 rounded-xl" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>🤖 AIが仮に作った内容です</p>}
          <div className="space-y-3">
            {p?.businessTitle && <div><Label>事業名</Label><Text>{p.businessTitle}</Text></div>}
            {p?.summary && <div><Label>概要</Label><Text>{p.summary}</Text></div>}
            {p?.targetCustomers && <div><Label>お客様像</Label><Text>{p.targetCustomers}</Text></div>}
            {p && p.firstSteps.length > 0 && (
              <div><Label>最初の一歩</Label>
                <ul className="list-disc pl-5 space-y-0.5">{p.firstSteps.map((s, i) => <li key={i} className="text-sm break-words" style={{ color: "var(--color-ink-700)" }}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        </Section>
      )}
      <Section title="提案した人">
        <div className="flex items-start gap-3">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${body.proposer.bgColor}`}>{body.proposer.emoji}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>{body.proposer.name}</p>
            {body.proposer.headline && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{body.proposer.headline}</p>}
            {body.proposer.role && <p className="text-sm break-words" style={{ color: "var(--color-ink-700)" }}>役割：{body.proposer.role}</p>}
          </div>
        </div>
      </Section>
      <Section title={`メンバー案（${body.candidates.length}件）`}>
        {body.candidates.length === 0 && <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>まだ候補は入っていません</p>}
        <ul className="space-y-3">
          {body.candidates.map((c, i) => <CandidateRow key={i} c={c} />)}
        </ul>
      </Section>
      <Section title="次の一歩の提案">
        {body.nextSteps.length === 0 && <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>いまの提案はありません</p>}
        <ul className="space-y-2">
          {body.nextSteps.map((s, i) => (
            <li key={i}>
              <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>{s.title}</p>
              {s.detail && <p className="text-xs break-words" style={{ color: "var(--color-ink-500)" }}>{s.detail}</p>}
            </li>
          ))}
        </ul>
      </Section>
      {body.actions.length > 0 && (
        <Section title="アクション">
          <ul className="space-y-2">
            {body.actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 text-sm" aria-label={a.completed ? "完了" : "未完了"}>{a.completed ? "✅" : "⬜"}</span>
                <div className="min-w-0">
                  <p className="text-sm break-words" style={{ color: a.completed ? "var(--color-ink-400)" : "var(--color-ink-800)", textDecoration: a.completed ? "line-through" : "none" }}>{a.task}</p>
                  {(a.assigneeName || a.dueDate) && (
                    <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                      {a.assigneeName && `担当：${a.assigneeName}`}{a.assigneeName && a.dueDate && "　"}{a.dueDate && `期日：${a.dueDate}`}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function CandidateRow({ c }: { c: DraftCandidate }) {
  if (c.kind === "member") {
    return (
      <li className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${c.bgColor}`}>{c.emoji}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>{c.name}<span className="ml-1.5 text-[11px] font-normal" style={{ color: "var(--color-ink-400)" }}>メンバー</span></p>
          {c.headline && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{c.headline}</p>}
          {c.role && <p className="text-sm break-words" style={{ color: "var(--color-ink-700)" }}>役割：{c.role}</p>}
        </div>
      </li>
    );
  }
  if (c.kind === "talent") {
    return (
      <li className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: "var(--color-paper-200)" }}>🔎</span>
        <div className="min-w-0">
          <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>{c.title}<span className="ml-1.5 text-[11px] font-normal" style={{ color: "var(--color-ink-400)" }}>来てほしい人のイメージ</span></p>
          {c.profile && <Text>{c.profile}</Text>}
          {c.role && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>役割：{c.role}</p>}
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-3">
      <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: "var(--color-paper-200)" }}>📇</span>
      <div className="min-w-0">
        <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>
          {c.name ?? "外部人脈の候補"}{c.company && <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-500)" }}>{c.company}</span>}
          <span className="ml-1.5 text-[11px] font-normal" style={{ color: "var(--color-ink-400)" }}>外部人脈</span>
        </p>
        <div className="flex flex-wrap gap-1.5 mt-0.5">
          {c.specialty && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>{c.specialty}</span>}
          {c.relationships.map((r) => <span key={r} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>{r}</span>)}
        </div>
        {c.summary && <p className="text-xs mt-1 break-words" style={{ color: "var(--color-ink-600)" }}>{c.summary}</p>}
        {c.role && <p className="text-sm break-words" style={{ color: "var(--color-ink-700)" }}>役割：{c.role}</p>}
      </div>
    </li>
  );
}

function ResultCardView({ c }: { c: SharedResultCard }) {
  return (
    <li className="card-paper p-4 rounded-2xl space-y-1.5">
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${c.counterpart.bgColor}`}>{c.counterpart.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-900)" }}>
            {c.counterpart.name}
            {c.isMemberCandidate && c.score !== null && <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-500)" }}>合致度 {c.score}</span>}
            {c.goodMatch && <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(212,160,59,0.18)", color: "var(--color-ink-700)" }}>⭐ 良いご縁だった</span>}
          </p>
          {c.contactLabel && <p className="text-xs break-words" style={{ color: "var(--color-ink-500)" }}>{c.contactLabel}</p>}
        </div>
      </div>
      <p className="text-xs break-words" style={{ color: "var(--color-ink-400)" }}>🎯 {c.matchedTargetLabel}</p>
      {c.dealDescription && <p className="text-sm break-words" style={{ color: "var(--color-ink-700)" }}>{c.dealDescription}</p>}
      {c.why && <p className="text-xs break-words" style={{ color: "var(--color-ink-500)" }}>{c.why}</p>}
      {c.privacyNote && <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>🔒 {c.privacyNote}</p>}
    </li>
  );
}

export function ResultBodyView({ body, level }: { body: ResultBody; level: ViewerLevel }) {
  return (
    <div className="space-y-4">
      {body.conditions.length > 0 && (
        <Section title="さがした条件">
          <ul className="list-disc pl-5 space-y-0.5">{body.conditions.map((c, i) => <li key={i} className="text-sm break-words" style={{ color: "var(--color-ink-700)" }}>{c}</li>)}</ul>
        </Section>
      )}
      {body.someHidden && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
          🔒 {level === "public"
            ? "プライバシーのため、ほかの方の人脈・卵・ガチョウに関する結果と、非公開の人脈は表示されていません。"
            : "非公開の人脈は表示されていません。"}
        </p>
      )}
      {body.aiCallFailed && <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.14)", color: "var(--color-ink-700)" }}>AIの検索に時間がかかり、一部の人脈は照合できていない可能性があります</p>}
      {body.total === 0 && <div className="card-paper p-6 rounded-3xl text-center text-sm" style={{ color: "var(--color-ink-500)" }}>表示できる結果はありません</div>}
      {body.groups.filter((g) => g.results.length > 0).map((g) => (
        <section key={g.hop}>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>{g.label}（{g.results.length}件）</h2>
          <ul className="space-y-2">{g.results.map((c, i) => <ResultCardView key={i} c={c} />)}</ul>
        </section>
      ))}
    </div>
  );
}
