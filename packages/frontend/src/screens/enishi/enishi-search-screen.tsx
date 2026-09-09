// =============================================================
// ご縁さがし画面
// 「私のご縁」「貢献のご縁」の2視点を切り替えてAI検索する
// =============================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, Search, Gift, ChevronRight, ChevronLeft, History, Star, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";

export type Hop = "direct" | "2hop" | "3hop";
export const HOP_LABEL: Record<Hop, string> = { direct: "1次（直接）", "2hop": "2次", "3hop": "3次" };

type GoldenEgg = { id: string; description: string };
type GoldenGoose = { id: string; description: string };
type Contact = { id: string; name: string | null; company: string | null; note: string | null; specialty: string | null; relationships: string[]; businessSummary: string | null; visibility: "private" | "existence" | "full" };

export type ResultCard = {
  hop: Hop; type: "egg" | "goose"; matchedTargetLabel: string;
  counterpart: { memberId: string; name: string; emoji: string; bgColor: string };
  path: string[]; contactPathIndex: number; dealDescription: string; why: string; privacyNote: string | null;
  linkedMemberId: string; actionLabel: string;
  cardId: string; goodMatch: boolean;
  isOwnContact?: boolean;
  candidateId: string; transacted: boolean;
  myContactId?: string; introduced: boolean;
};
export type SearchResult = {
  groups: { hop: Hop; label: string; results: ResultCard[] }[];
  truncated: boolean;
  usedContactsBreakdown?: { specialty: string; count: number }[];
  aiCallFailed?: boolean;
};
type SearchResponse = { data: SearchResult; historyId: string };

// 「良いご縁だった」フラグの切替後、対象カードだけを差し替えた新しいSearchResultを作る
export function updateCardGoodMatch(result: SearchResult, cardId: string, goodMatch: boolean): SearchResult {
  return {
    ...result,
    groups: result.groups.map((g) => ({
      ...g,
      results: g.results.map((r) => (r.cardId === cardId ? { ...r, goodMatch } : r)),
    })),
  };
}

// 「このご縁で繋がりました」の登録後、対象の人脈（同じcandidateIdの全カード）を結果から取り除く
export function removeTransactedCandidate(result: SearchResult, candidateId: string): SearchResult {
  return {
    ...result,
    groups: result.groups.map((g) => ({
      ...g,
      results: g.results.filter((r) => r.candidateId !== candidateId),
    })),
  };
}

// 「今後の表示は不要です」の登録後、対象の人脈（同じcandidateIdの全カード）を結果から取り除く
export function removeHiddenCandidate(result: SearchResult, candidateId: string): SearchResult {
  return {
    ...result,
    groups: result.groups.map((g) => ({
      ...g,
      results: g.results.filter((r) => r.candidateId !== candidateId),
    })),
  };
}

// 「紹介しました」の登録後、対象の組み合わせ（myContactId × candidateId）を結果から取り除く
export function removeIntroducedCandidate(result: SearchResult, myContactId: string, candidateId: string): SearchResult {
  return {
    ...result,
    groups: result.groups.map((g) => ({
      ...g,
      results: g.results.filter((r) => !(r.myContactId === myContactId && r.candidateId === candidateId)),
    })),
  };
}

export function EnishiSearchScreen() {
  const [mode, setMode] = useState<"for-me" | "giver">("for-me");
  const { termEnishi } = useSettings();

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🤝 {termEnishi}さがし
          <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-accent)" }}>AI分析</span>
        </h1>
        <Link to="/enishi/history"
          className="text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <History size={13} /> 検索履歴
        </Link>
      </div>
      <p className="text-sm mt-1 mb-5" style={{ color: "var(--color-ink-500)" }}>
        2つの視点で、なかまを通じて{termEnishi}をさがせます。視点ごとに「さがす条件」を設定してください。
      </p>

      <div className="flex gap-2 p-1.5 rounded-2xl mb-5" style={{ background: "var(--color-paper-200)" }}>
        <button onClick={() => setMode("for-me")}
          className="flex-1 py-3 rounded-xl text-sm font-medium transition flex flex-col items-center gap-0.5"
          style={{ background: mode === "for-me" ? "var(--color-brand)" : "transparent", color: mode === "for-me" ? "white" : "var(--color-ink-600)" }}>
          <span className="flex items-center gap-1.5"><Search size={15} /> 私のための{termEnishi}</span>
          <span className="text-[10px] font-normal opacity-90">自分の卵/ガチョウ × なかまの人脈</span>
        </button>
        <button onClick={() => setMode("giver")}
          className="flex-1 py-3 rounded-xl text-sm font-medium transition flex flex-col items-center gap-0.5"
          style={{ background: mode === "giver" ? "var(--color-brand)" : "transparent", color: mode === "giver" ? "white" : "var(--color-ink-600)" }}>
          <span className="flex items-center gap-1.5"><Gift size={15} /> 貢献のための{termEnishi}</span>
          <span className="text-[10px] font-normal opacity-90">なかまの卵/ガチョウ × 自分の人脈</span>
        </button>
      </div>

      {mode === "for-me" ? <ForMePanel /> : <GiverPanel />}
    </div>
  );
}

function HopRadio({ value, onChange }: { value: Hop; onChange: (v: Hop) => void }) {
  const options: { hop: Hop; title: string; desc: string }[] = [
    { hop: "direct", title: "1次（直接）", desc: "メンバーの人脈の中に、狙いたい相手がそのままいるケース" },
    { hop: "2hop", title: "2次まで", desc: "メンバーの人脈経由で、いずれ狙いたい相手に辿り着けそうなケース" },
    { hop: "3hop", title: "3次まで", desc: "さらにもう一段階、可能性を広げてさがすケース" },
  ];
  return (
    <div className="space-y-2 mb-4">
      {options.map((o) => (
        <div key={o.hop} onClick={() => onChange(o.hop)}
          className="rounded-2xl p-3 cursor-pointer flex gap-3"
          style={{ border: `1.5px solid ${value === o.hop ? "var(--color-brand)" : "var(--color-paper-300)"}`, background: value === o.hop ? "var(--color-paper-100)" : "white" }}>
          <div className="w-4 h-4 rounded-full mt-0.5 shrink-0" style={{ border: `2px solid ${value === o.hop ? "var(--color-brand)" : "var(--color-paper-300)"}`, background: value === o.hop ? "var(--color-brand)" : "transparent" }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>{o.title}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{o.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// 検索件数ではなく、1ページに何件ずつ表示するかの設定（検索自体は常に上限まで実行される）
const PAGE_SIZE_OPTIONS = [3, 5, 10, 20, 30];
export function PageSizeSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-xl px-3 py-2 text-sm mb-4" style={{ border: "1px solid var(--color-paper-300)" }}>
      {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}件</option>)}
    </select>
  );
}

function UsedContactsBreakdownNotice({ result }: { result: SearchResult }) {
  if (!result.usedContactsBreakdown) {
    return result.truncated ? (
      <p className="text-xs mb-3 px-1" style={{ color: "var(--color-ink-500)" }}>※ 候補が多いため、一部を抜粋して分析しています。</p>
    ) : null;
  }
  const total = result.usedContactsBreakdown.reduce((sum, b) => sum + b.count, 0);
  return (
    <div className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}>
      ※ 自分の人脈が多いため、専門分野ごとに公平になるよう{total}件を抜粋して検索しました。
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {result.usedContactsBreakdown.map((b) => (
          <span key={b.specialty} className="px-2 py-0.5 rounded-full" style={{ background: "white", border: "1px solid var(--color-paper-300)" }}>
            {b.specialty} {b.count}件
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- 外部人脈の名刺情報プレビュー（クリック/マウスオーバーで開く要素の下に表示する） ----

type ContactCardInfo = {
  id: string; name: string | null; company: string | null; note: string | null;
  specialty: string | null; relationships: string[]; businessSummary: string | null; isOwn: boolean;
};

export function ContactCardPreview({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["enishi", "contact-card", contactId],
    queryFn: () => api.get<{ data: ContactCardInfo }>(`/enishi/contacts/${contactId}/card`),
    staleTime: 5 * 60_000,
  });
  const card = data?.data;

  return (
    <div className="mb-2.5 p-3 rounded-xl text-xs" style={{ background: "white", border: "1px dashed var(--color-paper-300)" }}>
      <p className="font-semibold mb-1.5" style={{ color: "var(--color-ink-700)" }}>📇 外部人脈の名刺情報</p>
      {isLoading ? (
        <p style={{ color: "var(--color-ink-400)" }}>読み込み中…</p>
      ) : card ? (
        <div className="space-y-0.5" style={{ color: "var(--color-ink-700)" }}>
          {card.name && <p className="font-medium">{card.name}</p>}
          {card.company && <p>{card.company}</p>}
          {card.specialty && <p>専門分野: {card.specialty}</p>}
          {card.relationships.length > 0 && <p>関係性: {card.relationships.join("・")}</p>}
          {card.note && <p>備考: {card.note}</p>}
          {card.businessSummary && <p className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--color-paper-200)" }}>{card.businessSummary}</p>}
          {!card.name && !card.company && !card.specialty && !card.businessSummary && (
            <p style={{ color: "var(--color-ink-400)" }}>詳細は非公開に設定されています</p>
          )}
        </div>
      ) : (
        <p style={{ color: "var(--color-ink-400)" }}>情報を取得できませんでした</p>
      )}
    </div>
  );
}

export function ResultGroups({ result, historyId, mode, pageSize, onToggleGoodMatch, onRemoveTransacted, onRemoveHidden, onRemoveIntroduced }: {
  result: SearchResult; historyId: string; mode: "for-me" | "giver"; pageSize: number;
  onToggleGoodMatch: (cardId: string, goodMatch: boolean) => void;
  onRemoveTransacted: (candidateId: string) => void;
  onRemoveHidden: (candidateId: string) => void;
  onRemoveIntroduced: (myContactId: string, candidateId: string) => void;
}) {
  const { termEnishi } = useSettings();
  // ページ番号は「どの検索・履歴を見ているか（historyId）」に紐づけて保持し、別の結果に
  // 切り替わったら1ページ目に戻す。フラグの切替（goodMatch等）ではresultの中身は変わっても
  // historyIdは変わらないので、ページ位置は保持される。
  const [pageState, setPageState] = useState<{ historyId: string; page: number }>({ historyId, page: 0 });
  if (pageState.historyId !== historyId) setPageState({ historyId, page: 0 });
  const page = pageState.historyId === historyId ? pageState.page : 0;

  const hasAny = result.groups.some((g) => g.results.length > 0);
  if (!hasAny) {
    return (
      <div className="mt-4">
        <UsedContactsBreakdownNotice result={result} />
        <div className="card-paper rounded-2xl p-6 text-center">
          {result.aiCallFailed ? (
            <p className="text-sm" style={{ color: "var(--color-brand)" }}>
              ⚠️ AIによる検索が一時的にうまくいきませんでした。少し時間をおいてから、もう一度お試しください。
            </p>
          ) : (
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>今回の条件に合う{termEnishi}は見つかりませんでした。条件を変えて試してみてください。</p>
          )}
        </div>
      </div>
    );
  }

  // hopグループの境界をまたいで全体をフラット化し、表示件数ごとにページ分割する
  const flat = result.groups.flatMap((g) => g.results.map((r) => ({ card: r, hop: g.hop, label: g.label })));
  const totalPages = Math.max(1, Math.ceil(flat.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = flat.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);

  // ページ内で連続する同じhopをまとめて見出しを出す
  const pageGroups: { hop: Hop; label: string; results: ResultCard[] }[] = [];
  for (const item of pageItems) {
    const last = pageGroups[pageGroups.length - 1];
    if (last && last.hop === item.hop) last.results.push(item.card);
    else pageGroups.push({ hop: item.hop, label: item.label, results: [item.card] });
  }

  function goToPage(p: number) {
    setPageState({ historyId, page: Math.max(0, Math.min(totalPages - 1, p)) });
  }

  const pageStart = clampedPage * pageSize + 1;
  const pageEnd = Math.min(flat.length, (clampedPage + 1) * pageSize);

  return (
    <div className="mt-5">
      <UsedContactsBreakdownNotice result={result} />
      {mode === "for-me" && (
        <p className="text-xs mb-3 px-1" style={{ color: "var(--color-ink-500)" }}>
          ※ 「この{termEnishi}で繋がりました」「今後の表示は不要です」を押した人脈はこの検索結果には表示されません。
        </p>
      )}
      {mode === "giver" && (
        <p className="text-xs mb-3 px-1" style={{ color: "var(--color-ink-500)" }}>
          ※ 「紹介しました」を押した組み合わせはこの検索結果には表示されません。
        </p>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)" }}>
          <span className="text-xs font-medium" style={{ color: "var(--color-ink-700)" }}>
            全{flat.length}件中 {pageStart}〜{pageEnd}件目を表示中（{clampedPage + 1}/{totalPages}ページ）
          </span>
        </div>
      )}
      {pageGroups.map((g, gi) => (
        <div key={`${g.hop}-${gi}`} className="mb-5">
          <div className="flex items-center gap-2 mb-2.5 pb-1.5" style={{ borderBottom: "2px solid var(--color-paper-200)" }}>
            <span className="text-xs font-bold text-white rounded-lg w-6 h-6 flex items-center justify-center" style={{ background: "var(--color-brand)" }}>
              {g.hop === "direct" ? "●" : g.hop === "2hop" ? "②" : "③"}
            </span>
            <span className="text-sm font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>{g.label}</span>
          </div>
          <div className="space-y-3">
            {g.results.map((r) => (
              <ResultRow key={r.cardId} r={r} historyId={historyId} mode={mode}
                onToggleGoodMatch={onToggleGoodMatch} onRemoveTransacted={onRemoveTransacted} onRemoveHidden={onRemoveHidden} onRemoveIntroduced={onRemoveIntroduced} />
            ))}
          </div>
        </div>
      ))}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-2 p-2 rounded-xl" style={{ background: "var(--color-paper-100)" }}>
          <button onClick={() => goToPage(clampedPage - 1)} disabled={clampedPage === 0}
            className="flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-full disabled:opacity-30"
            style={{ background: "white", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-700)" }}>
            <ChevronLeft size={14} /> 前へ
          </button>
          <span className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>{clampedPage + 1} / {totalPages}ページ</span>
          <button onClick={() => goToPage(clampedPage + 1)} disabled={clampedPage >= totalPages - 1}
            className="flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-full disabled:opacity-30"
            style={{ background: "white", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-700)" }}>
            次へ <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ResultRow({ r, historyId, mode, onToggleGoodMatch, onRemoveTransacted, onRemoveHidden, onRemoveIntroduced }: {
  r: ResultCard; historyId: string; mode: "for-me" | "giver";
  onToggleGoodMatch: (cardId: string, goodMatch: boolean) => void;
  onRemoveTransacted: (candidateId: string) => void;
  onRemoveHidden: (candidateId: string) => void;
  onRemoveIntroduced: (myContactId: string, candidateId: string) => void;
}) {
  const { termEnishi } = useSettings();
  const [showContactCard, setShowContactCard] = useState(false);
  const contactIdForCard = mode === "giver" ? r.myContactId : r.candidateId;

  const toggleGoodMatch = useMutation({
    mutationFn: (next: boolean) => api.patch(`/enishi/history/${historyId}/cards/${r.cardId}`, { goodMatch: next }),
    onSuccess: (_res, next) => onToggleGoodMatch(r.cardId, next),
  });
  const markTransacted = useMutation({
    mutationFn: () => api.post("/enishi/transacted-contacts", { contactId: r.candidateId }),
    onSuccess: () => onRemoveTransacted(r.candidateId),
    onError: (e) => alert(e instanceof ApiError ? e.message : `「この${termEnishi}で繋がりました」の登録に失敗しました`),
  });
  const markHidden = useMutation({
    mutationFn: () => api.post("/enishi/hidden-contacts", { contactId: r.candidateId }),
    onSuccess: () => onRemoveHidden(r.candidateId),
    onError: (e) => alert(e instanceof ApiError ? e.message : "「今後の表示は不要です」の登録に失敗しました"),
  });
  const markIntroduced = useMutation({
    mutationFn: () => api.post("/enishi/introduced-contacts", { myContactId: r.myContactId, candidateId: r.candidateId }),
    onSuccess: () => { if (r.myContactId) onRemoveIntroduced(r.myContactId, r.candidateId); },
    onError: (e) => alert(e instanceof ApiError ? e.message : "「紹介しました」の登録に失敗しました"),
  });

  return (
    <div className="card-paper rounded-2xl p-4" style={r.goodMatch ? { boxShadow: "0 0 0 1.5px var(--color-accent)" } : undefined}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: "var(--color-paper-200)" }}>
          {r.counterpart.emoji}
        </span>
        <b className="text-sm" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>{r.counterpart.name}さん</b>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>{HOP_LABEL[r.hop]}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1"
          style={{ background: r.type === "egg" ? "var(--color-paper-200)" : "#e7f0dc", color: r.type === "egg" ? "var(--color-accent)" : "var(--color-success)" }}>
          {r.type === "egg" ? "🥚 卵型" : "🪙 ガチョウ型"}
        </span>
        {r.isOwnContact && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            👤 あなたの人脈
          </span>
        )}
        {mode === "for-me" && (
          <button onClick={() => toggleGoodMatch.mutate(!r.goodMatch)} disabled={toggleGoodMatch.isPending}
            className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 disabled:opacity-50"
            style={{
              background: r.goodMatch ? "var(--color-accent)" : "var(--color-paper-200)",
              color: r.goodMatch ? "white" : "var(--color-ink-500)",
            }}>
            <Star size={11} fill={r.goodMatch ? "white" : "none"} />
            {r.goodMatch ? "良い候補でした" : "良い候補だった？"}
          </button>
        )}
      </div>

      <div className="rounded-xl px-3 py-2 text-xs mb-1.5 flex flex-wrap items-center gap-1.5" style={{ background: "var(--color-paper-100)" }}>
        {r.path.map((node, i) => {
          const isContactNode = i === r.contactPathIndex && !!contactIdForCard;
          return (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span style={{ color: "var(--color-accent)" }}>→</span>}
              {isContactNode ? (
                <button type="button"
                  onClick={() => setShowContactCard((v) => !v)}
                  onMouseEnter={() => setShowContactCard(true)}
                  className="px-2 py-0.5 rounded-md underline decoration-dotted underline-offset-2"
                  style={{
                    background: i === r.path.length - 1 ? "var(--color-paper-200)" : "white",
                    border: "1px solid var(--color-paper-300)",
                    color: i === r.path.length - 1 ? "var(--color-accent)" : "var(--color-ink-700)",
                  }}>{node}</button>
              ) : (
                <span className="px-2 py-0.5 rounded-md" style={{
                  background: i === r.path.length - 1 ? "var(--color-paper-200)" : "white",
                  border: "1px solid var(--color-paper-300)",
                  color: i === r.path.length - 1 ? "var(--color-accent)" : "var(--color-ink-700)",
                }}>{node}</span>
              )}
            </span>
          );
        })}
      </div>
      {showContactCard && contactIdForCard && <ContactCardPreview contactId={contactIdForCard} />}

      <p className="text-xs" style={{ color: "var(--color-ink-800)" }}>{r.dealDescription}</p>
      <p className="text-[11px] mt-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}>
        {r.type === "egg" ? "🥚" : "🪙"} <b style={{ color: "var(--color-brand)" }}>なぜこの人？</b> {r.why}
      </p>
      {r.privacyNote && (
        <p className="text-[11px] mt-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}>
          🔒 {r.privacyNote}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <Link to={r.isOwnContact ? "/members?tab=contacts" : `/members/${r.linkedMemberId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-xl text-white hover:opacity-90 transition"
          style={{ background: "var(--color-brand)" }}>
          {r.actionLabel} <ChevronRight size={13} />
        </Link>
        {mode === "for-me" && (
          r.candidateId ? (
            <>
              <button
                onClick={() => markTransacted.mutate()}
                disabled={markTransacted.isPending}
                className="text-xs font-medium px-3 py-2 rounded-xl disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                この{termEnishi}で繋がりました
              </button>
              <button
                onClick={() => markHidden.mutate()}
                disabled={markHidden.isPending}
                className="text-xs font-medium px-3 py-2 rounded-xl disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                今後の表示は不要です
              </button>
            </>
          ) : (
            <span
              className="text-xs font-medium px-3 py-2 rounded-xl"
              title="この検索結果は機能追加前に保存されたものです。もう一度検索すると、新しい結果でチェックできるようになります。"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-400)" }}>
              この{termEnishi}で繋がりました（この結果では未対応）
            </span>
          )
        )}
        {mode === "giver" && (
          r.myContactId ? (
            <button
              onClick={() => markIntroduced.mutate()}
              disabled={markIntroduced.isPending}
              className="text-xs font-medium px-3 py-2 rounded-xl disabled:opacity-50"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
              紹介しました
            </button>
          ) : (
            <span
              className="text-xs font-medium px-3 py-2 rounded-xl"
              title="この検索結果は機能追加前に保存されたものです。もう一度検索すると、新しい結果でチェックできるようになります。"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-400)" }}>
              紹介しました（この結果では未対応）
            </span>
          )
        )}
      </div>
    </div>
  );
}

// ---- 「既に繋がった方」「既に紹介した方」（各タブ直下・ご縁さがしの有効性の確認用） ----
// 誤って登録してしまうケースもあるため、1件ずつの削除・複数選択してのまとめて削除に対応する。

type TransactedContactItem = {
  contactId: string; name: string; company: string | null; specialty: string | null; markedAt: number;
  ownerName: string | null; ownerEmoji: string | null; ownerBgColor: string | null;
};

function AlreadyConnectedSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["enishi", "transacted-contacts"],
    queryFn: () => api.get<{ data: TransactedContactItem[] }>("/enishi/transacted-contacts"),
  });
  const items = data?.data ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const invalidate = () => qc.invalidateQueries({ queryKey: ["enishi", "transacted-contacts"] });
  const deleteOne = useMutation({
    mutationFn: (contactId: string) => api.delete(`/enishi/transacted-contacts/${contactId}`),
    onSuccess: (_res, contactId) => {
      invalidate();
      setSelected((prev) => { const next = new Set(prev); next.delete(contactId); return next; });
    },
  });
  const deleteBulk = useMutation({
    mutationFn: (contactIds: string[]) => api.delete("/enishi/transacted-contacts/bulk", { contactIds }),
    onSuccess: () => { invalidate(); setSelected(new Set()); },
  });

  if (items.length === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.contactId));

  return (
    <div className="card-paper rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h2 className="text-sm font-bold" style={{ color: "var(--color-ink-800)" }}>
          🔗 既に繋がった方（{items.length}名）
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] cursor-pointer" style={{ color: "var(--color-ink-500)" }}>
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.contactId)))} />
            すべて選択
          </label>
          {selected.size > 0 && (
            <button
              onClick={() => { if (confirm(`選択した${selected.size}件を「既に繋がった方」から削除しますか？`)) deleteBulk.mutate([...selected]); }}
              disabled={deleteBulk.isPending}
              className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full text-white disabled:opacity-50"
              style={{ background: "var(--color-brand)" }}>
              <Trash2 size={11} /> {selected.size}件をまとめて削除
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div key={item.contactId} className="flex items-center gap-1 rounded-full pl-1 pr-1"
            style={{ background: "var(--color-paper-200)" }}>
            <input type="checkbox" className="ml-1.5" checked={selected.has(item.contactId)} onChange={() => toggle(item.contactId)} />
            {item.ownerEmoji && (
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 ${item.ownerBgColor ?? "bg-stone-100"}`}>
                {item.ownerEmoji}
              </span>
            )}
            <button
              onClick={() => setExpandedId((v) => (v === item.contactId ? null : item.contactId))}
              onMouseEnter={() => setExpandedId(item.contactId)}
              className="text-xs font-medium px-2 py-1.5 underline decoration-dotted underline-offset-2"
              style={{ color: "var(--color-ink-600)" }}>
              {item.name}
              {item.ownerName && <span style={{ color: "var(--color-ink-400)" }}>（{item.ownerName}の人脈）</span>}
            </button>
            <button
              onClick={() => { if (confirm(`「${item.name}」を「既に繋がった方」から削除しますか？`)) deleteOne.mutate(item.contactId); }}
              disabled={deleteOne.isPending}
              className="p-1 rounded-full disabled:opacity-50" style={{ color: "var(--color-ink-400)" }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      {expandedId && <div className="mt-2.5"><ContactCardPreview contactId={expandedId} /></div>}
    </div>
  );
}

type IntroducedContactItem = { myContactId: string; myContactName: string; candidateId: string; kind: "egg" | "goose"; targetMemberName: string; targetMemberEmoji: string; markedAt: number };

function AlreadyIntroducedSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["enishi", "introduced-contacts"],
    queryFn: () => api.get<{ data: IntroducedContactItem[] }>("/enishi/introduced-contacts"),
  });
  const items = data?.data ?? [];
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const invalidate = () => qc.invalidateQueries({ queryKey: ["enishi", "introduced-contacts"] });
  const deleteOne = useMutation({
    mutationFn: (item: { myContactId: string; candidateId: string }) =>
      api.delete(`/enishi/introduced-contacts/${item.myContactId}/${item.candidateId}`),
    onSuccess: (_res, item) => {
      invalidate();
      const key = `${item.myContactId}|${item.candidateId}`;
      setSelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
    },
  });
  const deleteBulk = useMutation({
    mutationFn: (keys: string[]) => api.delete("/enishi/introduced-contacts/bulk", {
      items: keys.map((k) => { const [myContactId, candidateId] = k.split("|"); return { myContactId, candidateId }; }),
    }),
    onSuccess: () => { invalidate(); setSelected(new Set()); },
  });

  if (items.length === 0) return null;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  const allKeys = items.map((item) => `${item.myContactId}|${item.candidateId}`);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  return (
    <div className="card-paper rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h2 className="text-sm font-bold" style={{ color: "var(--color-ink-800)" }}>
          🎁 既に紹介した方（{items.length}件）
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] cursor-pointer" style={{ color: "var(--color-ink-500)" }}>
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(allKeys))} />
            すべて選択
          </label>
          {selected.size > 0 && (
            <button
              onClick={() => { if (confirm(`選択した${selected.size}件を「既に紹介した方」から削除しますか？`)) deleteBulk.mutate([...selected]); }}
              disabled={deleteBulk.isPending}
              className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full text-white disabled:opacity-50"
              style={{ background: "var(--color-brand)" }}>
              <Trash2 size={11} /> {selected.size}件をまとめて削除
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const key = `${item.myContactId}|${item.candidateId}`;
          return (
            <div key={key}>
              <div className="flex items-center gap-1.5 rounded-xl pl-2 pr-1 py-1" style={{ background: "var(--color-paper-200)" }}>
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                <button
                  onClick={() => setExpandedKey((v) => (v === key ? null : key))}
                  onMouseEnter={() => setExpandedKey(key)}
                  className="flex-1 text-left text-xs font-medium px-2 py-1 underline decoration-dotted underline-offset-2 flex items-center gap-1.5"
                  style={{ color: "var(--color-ink-600)" }}>
                  {item.myContactName} <ChevronRight size={11} /> {item.targetMemberEmoji} {item.targetMemberName}さんの{item.kind === "egg" ? "金の卵" : "金のガチョウ"}
                </button>
                <button
                  onClick={() => { if (confirm("この「紹介しました」の登録を削除しますか？")) deleteOne.mutate({ myContactId: item.myContactId, candidateId: item.candidateId }); }}
                  disabled={deleteOne.isPending}
                  className="p-1 rounded-full disabled:opacity-50" style={{ color: "var(--color-ink-400)" }}>
                  <Trash2 size={12} />
                </button>
              </div>
              {expandedKey === key && <div className="mt-1.5"><ContactCardPreview contactId={item.myContactId} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 私のご縁 ----

function ForMePanel() {
  const { data: eggsData } = useQuery({ queryKey: ["enishi", "eggs"], queryFn: () => api.get<{ data: GoldenEgg[] }>("/enishi/eggs") });
  const { data: geeseData } = useQuery({ queryKey: ["enishi", "geese"], queryFn: () => api.get<{ data: GoldenGoose[] }>("/enishi/geese") });
  const eggs = eggsData?.data ?? [];
  const geese = geeseData?.data ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxHop, setMaxHop] = useState<Hop>("2hop");
  const [includeOwnContacts, setIncludeOwnContacts] = useState(true);
  const [pageSize, setPageSize] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);

  const search = useMutation({
    mutationFn: () => api.post<SearchResponse>("/enishi/search/for-me", { targetIds: [...selected], maxHop, includeOwnContacts }),
    onSuccess: setSearchResponse,
    onError: (e) => setError(e instanceof ApiError ? e.message : "検索に失敗しました"),
  });

  function toggleGoodMatch(cardId: string, goodMatch: boolean) {
    setSearchResponse((prev) => prev && { ...prev, data: updateCardGoodMatch(prev.data, cardId, goodMatch) });
  }

  function removeTransacted(candidateId: string) {
    setSearchResponse((prev) => prev && { ...prev, data: removeTransactedCandidate(prev.data, candidateId) });
  }

  function removeHidden(candidateId: string) {
    setSearchResponse((prev) => prev && { ...prev, data: removeHiddenCandidate(prev.data, candidateId) });
  }

  return (
    <div>
      <AlreadyConnectedSection />

      {eggs.length === 0 && geese.length === 0 ? (
        <div className="card-paper rounded-2xl p-6 text-center">
          <p className="text-sm mb-3" style={{ color: "var(--color-ink-500)" }}>まだ金の卵・金のガチョウが登録されていません。まずは登録してみましょう。</p>
          <Link to="/enishi/register" className="inline-block text-sm font-medium px-4 py-2 rounded-xl text-white" style={{ background: "var(--color-brand)" }}>
            🥚 登録する
          </Link>
        </div>
      ) : (
        <ForMeSearchForm
          eggs={eggs} geese={geese} selected={selected} setSelected={setSelected}
          maxHop={maxHop} setMaxHop={setMaxHop}
          includeOwnContacts={includeOwnContacts} setIncludeOwnContacts={setIncludeOwnContacts}
          pageSize={pageSize} setPageSize={setPageSize}
          error={error} setError={setError} search={search}
        />
      )}

      {searchResponse && (
        <ResultGroups result={searchResponse.data} historyId={searchResponse.historyId} mode="for-me" pageSize={pageSize}
          onToggleGoodMatch={toggleGoodMatch} onRemoveTransacted={removeTransacted} onRemoveHidden={removeHidden} onRemoveIntroduced={() => {}} />
      )}
    </div>
  );
}

function ForMeSearchForm({ eggs, geese, selected, setSelected, maxHop, setMaxHop, includeOwnContacts, setIncludeOwnContacts, pageSize, setPageSize, error, setError, search }: {
  eggs: GoldenEgg[]; geese: GoldenGoose[];
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  maxHop: Hop; setMaxHop: (h: Hop) => void;
  includeOwnContacts: boolean; setIncludeOwnContacts: (v: boolean) => void;
  pageSize: number; setPageSize: (n: number) => void;
  error: string | null; setError: (e: string | null) => void;
  search: { mutate: () => void; isPending: boolean };
}) {
  const { termEnishi } = useSettings();
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <div className="card-paper rounded-2xl p-4 mb-4">
      <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>① どの{termEnishi}をさがす？（対象の金の卵・金のガチョウ）</h2>
      <div className="flex flex-wrap gap-2 mb-4">
        {eggs.map((e) => (
          <button key={e.id} onClick={() => toggle(e.id)}
            className="text-xs font-medium px-3 py-1.5 rounded-full text-left"
            style={{
              background: selected.has(e.id) ? "var(--color-paper-200)" : "white",
              border: `1px solid ${selected.has(e.id) ? "var(--color-accent)" : "var(--color-paper-300)"}`,
              color: selected.has(e.id) ? "var(--color-accent)" : "var(--color-ink-600)",
            }}>
            🥚 {e.description.slice(0, 20)}{e.description.length > 20 ? "…" : ""}
          </button>
        ))}
        {geese.map((g) => (
          <button key={g.id} onClick={() => toggle(g.id)}
            className="text-xs font-medium px-3 py-1.5 rounded-full text-left"
            style={{
              background: selected.has(g.id) ? "#e7f0dc" : "white",
              border: `1px solid ${selected.has(g.id) ? "var(--color-success)" : "var(--color-paper-300)"}`,
              color: selected.has(g.id) ? "var(--color-success)" : "var(--color-ink-600)",
            }}>
            🪙 {g.description.slice(0, 20)}{g.description.length > 20 ? "…" : ""}
          </button>
        ))}
      </div>

      <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>② 金の卵への到達方法（次数）</h2>
      <HopRadio value={maxHop} onChange={setMaxHop} />

      <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>③ 検索対象</h2>
      <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
        <input type="checkbox" checked={includeOwnContacts} onChange={(e) => setIncludeOwnContacts(e.target.checked)} />
        自分自身の人脈も検索対象に含める
      </label>

      <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>④ 表示件数</h2>
      <PageSizeSelect value={pageSize} onChange={setPageSize} />

      {error && <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>{error}</p>}

      <button onClick={() => selected.size > 0 ? search.mutate() : setError("さがす対象を1つ以上選んでください")}
        disabled={search.isPending}
        className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: "var(--color-brand)" }}>
        {search.isPending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} この条件で{termEnishi}をさがす
      </button>
    </div>
  );
}

// ---- 貢献のご縁 ----

const MAX_TARGET_MEMBERS = 5;
// バックエンド（enishi-search.ts の MAX_MY_CONTACTS）と合わせる。超えると専門分野ごとに公平に抜粋される
const MAX_MY_CONTACTS = 150;

type Contributor = { id: string; name: string; emoji: string; bgColor: string; eggCount: number; gooseCount: number };

function useMyContactsList(): Contact[] {
  const { data } = useQuery({ queryKey: ["collab", "contacts"], queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts") });
  // 非公開（自分だけ）の人脈は貢献のご縁の検索対象外（バックエンドの検索でも除外している）なので、
  // ここでも除いておく。除かないと、絞り込み件数のプレビューが実際に検索される件数より
  // 大きく（非公開分だけ多く）表示されてしまう。
  return (data?.data ?? []).filter((c) => c.visibility !== "private");
}
function useMySpecialtyOptions(contacts: Contact[]): string[] {
  const values = contacts.map((c) => c.specialty).filter((s): s is string => !!s);
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "ja"));
}
function useMyRelationshipOptions(contacts: Contact[]): string[] {
  const values = contacts.flatMap((c) => c.relationships);
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "ja"));
}

function GiverPanel() {
  const myContacts = useMyContactsList();
  const specialtyOptions = useMySpecialtyOptions(myContacts);
  const relationshipOptions = useMyRelationshipOptions(myContacts);
  const { data: contributorsData } = useQuery({
    queryKey: ["enishi", "contributors"],
    queryFn: () => api.get<{ data: Contributor[] }>("/enishi/contributors"),
  });
  const contributors = contributorsData?.data ?? [];

  const [targetIds, setTargetIds] = useState<Set<string>>(new Set());
  const [specialties, setSpecialties] = useState<Set<string>>(new Set());
  const [relationships, setRelationships] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [maxHop, setMaxHop] = useState<Hop>("direct");
  const [pageSize, setPageSize] = useState(10);
  const [error, setError] = useState<string | null>(null);

  // 現在の絞り込み条件（専門分野・関係性・自由記述）に一致する人脈数をその場で計算する
  // （バックエンドの絞り込みロジックと同じ条件。150件を超えると自動的に抜粋されることを事前に知らせるため）
  const matchingContactCount = useMemo(() => {
    let filtered = myContacts;
    if (specialties.size > 0) filtered = filtered.filter((c) => c.specialty && [...specialties].some((s) => c.specialty!.includes(s)));
    if (relationships.size > 0) filtered = filtered.filter((c) => c.relationships.some((r) => relationships.has(r)));
    const needle = freeText.trim().toLowerCase();
    if (needle) filtered = filtered.filter((c) => [c.name, c.company, c.note, c.specialty, c.businessSummary].some((v) => v?.toLowerCase().includes(needle)));
    return filtered.length;
  }, [myContacts, specialties, relationships, freeText]);

  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);

  const search = useMutation({
    mutationFn: () => api.post<SearchResponse>("/enishi/search/giver", {
      targetMemberIds: [...targetIds],
      specialties: [...specialties], relationships: [...relationships], freeText, maxHop,
    }),
    onSuccess: setSearchResponse,
    onError: (e) => setError(e instanceof ApiError ? e.message : "検索に失敗しました"),
  });

  function toggleGoodMatch(cardId: string, goodMatch: boolean) {
    setSearchResponse((prev) => prev && { ...prev, data: updateCardGoodMatch(prev.data, cardId, goodMatch) });
  }

  function removeIntroduced(myContactId: string, candidateId: string) {
    setSearchResponse((prev) => prev && { ...prev, data: removeIntroducedCandidate(prev.data, myContactId, candidateId) });
  }

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setFn(next);
  };

  const toggleTarget = (id: string) => {
    setTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= MAX_TARGET_MEMBERS) return prev;
      next.add(id);
      return next;
    });
  };

  return (
    <div>
      <AlreadyIntroducedSection />

      {contributors.length === 0 ? (
        <div className="card-paper rounded-2xl p-6 text-center">
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>まだ金の卵・金のガチョウを登録しているなかまがいません。</p>
        </div>
      ) : (
        <div className="card-paper rounded-2xl p-4 mb-4">
          <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>
            ① 貢献先を選ぶ（最大{MAX_TARGET_MEMBERS}名・{targetIds.size}/{MAX_TARGET_MEMBERS}）
          </h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {contributors.map((m) => {
              const isSelected = targetIds.has(m.id);
              const disabled = !isSelected && targetIds.size >= MAX_TARGET_MEMBERS;
              return (
                <button key={m.id} onClick={() => toggleTarget(m.id)} disabled={disabled}
                  className="text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5 disabled:opacity-40"
                  style={{
                    background: isSelected ? "var(--color-paper-200)" : "white",
                    border: `1px solid ${isSelected ? "var(--color-accent)" : "var(--color-paper-300)"}`,
                    color: isSelected ? "var(--color-accent)" : "var(--color-ink-600)",
                  }}>
                  <span>{m.emoji}</span>
                  <span>{m.name}</span>
                  <span className="opacity-70">🥚{m.eggCount} 🪙{m.gooseCount}</span>
                </button>
              );
            })}
          </div>

          <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>② 使う自分の人脈を絞り込む</h2>
          {specialtyOptions.length > 0 && (
            <>
              <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-500)" }}>専門分野</p>
              <div className="flex flex-wrap gap-2 mb-3">
                <button onClick={() => setSpecialties(new Set())}
                  className="text-xs font-medium px-3 py-1.5 rounded-full"
                  style={{
                    background: specialties.size === 0 ? "var(--color-accent)" : "white",
                    border: `1px solid ${specialties.size === 0 ? "var(--color-accent)" : "var(--color-paper-300)"}`,
                    color: specialties.size === 0 ? "white" : "var(--color-ink-600)",
                  }}>すべて</button>
                {specialtyOptions.map((s) => (
                  <button key={s} onClick={() => toggle(specialties, setSpecialties, s)}
                    className="text-xs font-medium px-3 py-1.5 rounded-full"
                    style={{
                      background: specialties.has(s) ? "var(--color-paper-200)" : "white",
                      border: `1px solid ${specialties.has(s) ? "var(--color-accent)" : "var(--color-paper-300)"}`,
                      color: specialties.has(s) ? "var(--color-accent)" : "var(--color-ink-600)",
                    }}>{s}</button>
                ))}
              </div>
              {specialties.size === 0 && (
                <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
                  「すべて」が選択されている間は、専門分野を問わずすべての人脈が検索対象になります
                </p>
              )}
            </>
          )}
          {relationshipOptions.length > 0 && (
            <>
              <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-500)" }}>関係性</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {relationshipOptions.map((r) => (
                  <button key={r} onClick={() => toggle(relationships, setRelationships, r)}
                    className="text-xs font-medium px-3 py-1.5 rounded-full"
                    style={{
                      background: relationships.has(r) ? "var(--color-paper-200)" : "white",
                      border: `1px solid ${relationships.has(r) ? "var(--color-accent)" : "var(--color-paper-300)"}`,
                      color: relationships.has(r) ? "var(--color-accent)" : "var(--color-ink-600)",
                    }}>{r}</button>
                ))}
              </div>
            </>
          )}
          <input value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="その他の条件（自由記述・任意）"
            className="w-full rounded-xl px-3 py-2 text-sm mb-2" style={{ border: "1px solid var(--color-paper-300)" }} />

          <p className="text-xs mb-4" style={{ color: matchingContactCount > MAX_MY_CONTACTS ? "var(--color-brand)" : "var(--color-ink-500)" }}>
            この条件で対象になる人脈：{matchingContactCount}件
            {matchingContactCount > MAX_MY_CONTACTS && (
              <span>（{MAX_MY_CONTACTS}件を超えているため、専門分野ごとに公平になるよう自動的に一部が抜粋されて検索されます）</span>
            )}
          </p>

          <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>③ 貢献の届け方（到達方法）</h2>
          <HopRadio value={maxHop} onChange={setMaxHop} />

          <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>④ 表示件数</h2>
          <PageSizeSelect value={pageSize} onChange={setPageSize} />

          {error && <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>{error}</p>}

          <button
            onClick={() => targetIds.size > 0 ? search.mutate() : setError("貢献先のメンバーを1人以上選んでください")}
            disabled={search.isPending}
            className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {search.isPending ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />} この条件で貢献をさがす
          </button>
        </div>
      )}

      {searchResponse && (
        <ResultGroups result={searchResponse.data} historyId={searchResponse.historyId} mode="giver" pageSize={pageSize}
          onToggleGoodMatch={toggleGoodMatch} onRemoveTransacted={() => {}} onRemoveHidden={() => {}} onRemoveIntroduced={removeIntroduced} />
      )}
    </div>
  );
}
