// =============================================================
// メンバー詳細画面: 「そのメンバーが登録した外部人脈」の検索パネル
// 検索方法（AND/OR検索式・専門分野/関係性ファセット・並び替え）は
// 協働の「人脈をさがす」と同じロジックを共用する（@/lib/contacts, @/lib/contact-search）。
// =============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { api } from "@/lib/api";
import { matchesSearchQuery } from "@/lib/contact-search";
import {
  type Contact,
  type ContactSortOrder,
  VISIBILITY_STYLE,
  CONTACT_SORT_LABEL,
  sortContacts,
} from "@/lib/contacts";

type ContactsResponse = { data: { contacts: Contact[] } };

const RESULT_PAGE_SIZE = 30;
// 遅延生成トリガーで一度に送るID数の上限（バックエンドのLAZY_SUMMARY_BATCH_LIMITと合わせる）
const LAZY_SUMMARY_BATCH_LIMIT = 30;

function useFavoriteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, favorite }: { contactId: string; favorite: boolean }) =>
      favorite ? api.post(`/collab/contacts/${contactId}/favorite`, {}) : api.delete(`/collab/contacts/${contactId}/favorite`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "contacts", "by-member"] }),
  });
}

function ContactResultCard({ contact }: { contact: Contact }) {
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [showBusinessDetail, setShowBusinessDetail] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const favoriteMutation = useFavoriteContact();

  const introRequest = useMutation({
    mutationFn: () => api.post(`/collab/contacts/${contact.id}/intro-request`, { message: message.trim() || undefined }),
    onSuccess: () => setSent(true),
  });

  const style = VISIBILITY_STYLE[contact.visibility];
  return (
    <div className="p-3 rounded-xl" style={{ background: style.bg, borderLeft: `4px solid ${style.border}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {contact.name ? (
            <>
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>{contact.name}</p>
              {(contact.specialty || contact.company || contact.relationships.length > 0) && (
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                  {[contact.specialty, contact.company, ...contact.relationships].filter(Boolean).join(" ・ ")}
                </p>
              )}
              {contact.note && <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>{contact.note}</p>}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>
                {contact.specialty ? `${contact.specialty}の人脈あり` : "人脈あり（非公開）"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>名前・会社名は非公開です</p>
            </>
          )}
          {contact.businessSummary && (
            <p className="text-xs mt-1 truncate font-medium" style={{ color: "var(--color-ink-700)" }}>
              🏢 {contact.businessSummary}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => favoriteMutation.mutate({ contactId: contact.id, favorite: !contact.isFavorite })}
            disabled={favoriteMutation.isPending}
            title={contact.isFavorite ? "お気に入りから外す" : "お気に入りに追加"}
            className="text-lg leading-none disabled:opacity-50">
            {contact.isFavorite ? "⭐️" : "☆"}
          </button>
          {!contact.mine && (
            <button onClick={() => setExpanded((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ background: "var(--color-ink-700)", color: "white" }}>
              {expanded ? "閉じる" : "詳細"}
            </button>
          )}
        </div>
      </div>

      {contact.businessSummaryDetail && (
        showBusinessDetail ? (
          <p className="text-xs mt-1.5 pt-1.5 whitespace-pre-wrap" style={{ color: "var(--color-ink-700)", borderTop: "1px dashed var(--color-paper-300)" }}>
            {contact.businessSummaryDetail}
          </p>
        ) : (
          <button onClick={() => setShowBusinessDetail(true)}
            className="text-xs mt-1 font-medium underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
            どんな会社か、もっと詳しく見る
          </button>
        )
      )}

      {expanded && !contact.mine && (
        <div className="mt-2 pt-2" style={{ borderTop: "1px dashed var(--color-paper-300)" }}>
          {!sent ? (
            <>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="依頼メッセージ（任意）"
                className="w-full px-2 py-1.5 rounded-lg border text-xs resize-none mb-1.5" rows={2}
                style={{ borderColor: "var(--color-paper-300)" }} />
              <button onClick={() => introRequest.mutate()} disabled={introRequest.isPending}
                className="w-full py-1.5 rounded-full text-xs font-medium text-white disabled:opacity-50"
                style={{ background: "var(--color-accent)" }}>
                🙋 紹介依頼する
              </button>
            </>
          ) : (
            <p className="text-xs font-medium" style={{ color: "var(--color-success)" }}>紹介依頼を送りました</p>
          )}
        </div>
      )}
    </div>
  );
}

export function MemberContactsPanel({ memberId }: { memberId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["collab", "contacts", "by-member", memberId],
    queryFn: () => api.get<ContactsResponse>(`/collab/contacts/by-member/${memberId}`),
  });
  const contacts = useMemo(() => data?.data.contacts ?? [], [data]);
  const detailCount = useMemo(() => contacts.filter((ct) => ct.visibility === "full").length, [contacts]);

  // 遅延生成：このメンバーの人脈を表示した際、会社概要が未生成のものだけ生成をトリガーする
  // （協働の「人脈をさがす」画面と同じ仕組み。1回のトリガーでは数件しか完了しないため、
  // 画面を開くたびに未生成分が少しずつ埋まっていく）
  const requestedSummaryIdsRef = useRef<Set<string>>(new Set());
  const requestSummariesMutation = useMutation({
    mutationFn: (ids: string[]) => api.post<{ data: { processed: number } }>("/collab/contacts/request-summaries", { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "contacts", "by-member", memberId] }),
  });
  useEffect(() => {
    const targets = contacts
      .filter((ct) => !ct.businessSummary && !requestedSummaryIdsRef.current.has(ct.id))
      .slice(0, LAZY_SUMMARY_BATCH_LIMIT);
    if (targets.length === 0) return;
    const timer = setTimeout(() => {
      const ids = targets.map((ct) => ct.id);
      ids.forEach((id) => requestedSummaryIdsRef.current.add(id));
      requestSummariesMutation.mutate(ids);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts]);

  const [query, setQuery] = useState("");
  const [selectedSpecialties, setSelectedSpecialties] = useState<Set<string>>(new Set());
  const [selectedRelationships, setSelectedRelationships] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<ContactSortOrder>("newest");
  const [visibleResultCount, setVisibleResultCount] = useState(RESULT_PAGE_SIZE);
  const [visibleTagCount, setVisibleTagCount] = useState(10);
  const [visibleRelationshipTagCount, setVisibleRelationshipTagCount] = useState(10);

  const specialtyTags = useMemo(() => {
    const set = new Set<string>();
    for (const ct of contacts) if (ct.specialty) set.add(ct.specialty);
    return [...set].sort();
  }, [contacts]);
  const relationshipTags = useMemo(() => {
    const set = new Set<string>();
    for (const ct of contacts) for (const r of ct.relationships) set.add(r);
    return [...set].sort();
  }, [contacts]);

  // 専門分野・関係性の選択、またはキーワード検索があって初めて一覧を表示する
  // （最初から全件を描画すると人数の多いメンバーで表示が重くなるため）
  const hasFacetOrQuery = selectedSpecialties.size > 0 || selectedRelationships.size > 0 || query.trim().length > 0;

  const results = useMemo(() => {
    if (!hasFacetOrQuery) return [];
    const matched = contacts.filter((ct) => {
      if (selectedSpecialties.size > 0 && (!ct.specialty || !selectedSpecialties.has(ct.specialty))) return false;
      if (selectedRelationships.size > 0 && !ct.relationships.some((r) => selectedRelationships.has(r))) return false;
      if (query.trim() && !matchesSearchQuery([ct.specialty, ct.company, ct.name, ...ct.relationships], query)) return false;
      return true;
    });
    return sortContacts(matched, sortOrder);
  }, [contacts, query, sortOrder, selectedSpecialties, selectedRelationships, hasFacetOrQuery]);

  const toggleSpecialty = (tag: string) => {
    setSelectedSpecialties((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
    setVisibleResultCount(RESULT_PAGE_SIZE);
  };
  const toggleRelationship = (tag: string) => {
    setSelectedRelationships((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
    setVisibleResultCount(RESULT_PAGE_SIZE);
  };

  return (
    <div className="card-paper rounded-3xl p-5 mb-4">
      <h2 className="text-base font-semibold mb-2" style={{ fontFamily: "var(--font-klee)" }}>
        <Globe size={16} className="inline -mt-1 mr-1" />外部人脈
      </h2>

      {!data ? null : contacts.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>外部人脈は登録されていません</p>
      ) : (
        <>
          <p className="text-sm mb-3" style={{ color: "var(--color-ink-700)" }}>
            {contacts.length}件の外部人脈を登録
            {detailCount > 0 && (
              <span style={{ color: "var(--color-ink-500)" }}>（うち詳細まで公開：{detailCount}件）</span>
            )}
          </p>

          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisibleResultCount(RESULT_PAGE_SIZE); }}
            placeholder="専門分野・会社名・関係性で検索（例: 税理士 OR 社労士）"
            className="w-full px-3 py-2 rounded-xl border text-sm mb-2"
            style={{ borderColor: "var(--color-paper-300)" }}
          />

          {specialtyTags.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>専門分野</p>
              <div className="flex flex-wrap gap-1.5">
                {specialtyTags.slice(0, visibleTagCount).map((tag) => (
                  <button key={tag} onClick={() => toggleSpecialty(tag)}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{
                      background: selectedSpecialties.has(tag) ? "var(--color-accent)" : "var(--color-paper-200)",
                      color: selectedSpecialties.has(tag) ? "white" : "var(--color-ink-600)",
                    }}>
                    {tag}
                  </button>
                ))}
                {specialtyTags.length > visibleTagCount && (
                  <button onClick={() => setVisibleTagCount((v) => v + 20)}
                    className="text-xs px-2.5 py-1 rounded-full font-medium underline underline-offset-2"
                    style={{ color: "var(--color-ink-500)" }}>
                    もっと見る
                  </button>
                )}
              </div>
            </div>
          )}

          {relationshipTags.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>関係性</p>
              <div className="flex flex-wrap gap-1.5">
                {relationshipTags.slice(0, visibleRelationshipTagCount).map((tag) => (
                  <button key={tag} onClick={() => toggleRelationship(tag)}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{
                      background: selectedRelationships.has(tag) ? "var(--color-accent)" : "var(--color-paper-200)",
                      color: selectedRelationships.has(tag) ? "white" : "var(--color-ink-600)",
                    }}>
                    {tag}
                  </button>
                ))}
                {relationshipTags.length > visibleRelationshipTagCount && (
                  <button onClick={() => setVisibleRelationshipTagCount((v) => v + 20)}
                    className="text-xs px-2.5 py-1 rounded-full font-medium underline underline-offset-2"
                    style={{ color: "var(--color-ink-500)" }}>
                    もっと見る
                  </button>
                )}
              </div>
            </div>
          )}

          {!hasFacetOrQuery ? (
            <p className="text-xs text-center py-4" style={{ color: "var(--color-ink-400)" }}>
              専門分野・関係性を選ぶか、キーワードで検索すると一覧が表示されます
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{results.length}件見つかりました</p>
                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as ContactSortOrder)}
                  className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: "var(--color-paper-300)" }}>
                  {(Object.keys(CONTACT_SORT_LABEL) as ContactSortOrder[]).map((o) => (
                    <option key={o} value={o}>{CONTACT_SORT_LABEL[o]}</option>
                  ))}
                </select>
              </div>

              {results.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: "var(--color-ink-400)" }}>見つかりませんでした</p>
              ) : (
                <div className="space-y-2">
                  {results.slice(0, visibleResultCount).map((ct) => <ContactResultCard key={ct.id} contact={ct} />)}
                  {results.length > visibleResultCount && (
                    <button onClick={() => setVisibleResultCount((v) => v + RESULT_PAGE_SIZE)}
                      className="w-full text-xs py-2 rounded-full font-medium"
                      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      もっと見る（残り{results.length - visibleResultCount}件）
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
