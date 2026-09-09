// =============================================================
// 活動と記録（協働の投稿・シェアストーリー）
// =============================================================
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Pencil, Plus, Search, Send, Star, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useCollabAlerts } from "@/hooks/use-collab-alerts";

type PostMember = { id: string; name: string; emoji: string; bgColor: string };
type Comment = {
  id: string;
  postId: string;
  authorId: string;
  author: PostMember;
  body: string;
  createdAt: number;
  likeCount: number;
  likedByMe: boolean;
  mine: boolean;
  canDelete: boolean;
};
type Post = {
  id: string;
  authorId: string;
  contextType: "link" | "team";
  linkId: string | null;
  teamId: string | null;
  visibility: "team" | "chapter" | "private";
  isPrivate: boolean;
  stageAtPost: string | null;
  source: "user" | "meeting" | "growth" | "system";
  body: string | null;
  createdAt: number;
  members: PostMember[];
  reactionCounts: Record<string, number>;
  myReactions: string[];
  comments: Comment[];
  mine: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type GraphTeamLite = { id: string; name: string; type: "loose" | "power" };
type GraphNodeLite = { id: string; name: string; emoji: string; bgColor: string; isMe: boolean };
type GraphResponse = { data: { nodes: GraphNodeLite[]; teams: GraphTeamLite[] } };

const PERIOD_LABELS: Record<string, string> = { "30": "直近30日", "90": "直近90日", "180": "直近180日", "365": "直近1年", all: "すべて" };
const VISIBILITY_LABEL: Record<Post["visibility"], string> = { team: "🏠 チーム内", chapter: "📢 チャプター公開", private: "🔒 非公開" };

/** unix秒 → 画面表示用「年/月/日 時:分」 */
function formatDateTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

/** unix秒 → 「たった今／n分前／n時間前／n日前／約nヶ月前／約n年前」の相対表示 */
function formatRelativeTime(unixSec: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMin < 1) return "たった今";
  if (diffHour < 1) return `${diffMin}分前`;
  if (diffDay < 1) return `${diffHour}時間前`;
  if (diffDay < 30) return `${diffDay}日前`;
  if (diffMonth < 12) return `約${diffMonth}ヶ月前`;
  return `約${Math.floor(diffMonth / 12)}年前`;
}

/** タグの種類ごとに一意な値を持つ。クリックすると同じ(type,value)を持つ投稿だけに絞り込める */
type PostTag = { type: "author" | "partner" | "team" | "date" | "custom"; value: string; label: string };

const HASHTAG_RE = /#([^\s#　]+)/g;

/** 本文中の「#タグ」を抽出する（重複は除去、出現順を維持） */
function extractHashtags(body: string | null): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of body.matchAll(HASHTAG_RE)) {
    const tag = m[1];
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

/** unix秒 → 日付タグの絞り込みキー（同じ日を判定するためのYYYY-MM-DD） */
function formatDateKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** unix秒 → 日付タグの表示用ラベル（例: 8/9） */
function formatDateTagLabel(unixSec: number): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(unixSec * 1000));
}

/** 投稿1件に付くタグ一覧：投稿者／相手 or チーム／投稿日 ＋ 本文中の #タグ */
function getPostTags(post: Post, teams: GraphTeamLite[]): PostTag[] {
  const tags: PostTag[] = [];
  const author = post.members.find((m) => m.id === post.authorId);
  if (author) tags.push({ type: "author", value: author.id, label: `👤 ${author.name}` });

  if (post.contextType === "link") {
    const partner = post.members.find((m) => m.id !== post.authorId);
    if (partner) tags.push({ type: "partner", value: partner.id, label: `🤝 ${partner.name}` });
  } else if (post.teamId) {
    const team = teams.find((t) => t.id === post.teamId);
    if (team) tags.push({ type: "team", value: team.id, label: `${team.type === "power" ? "⚡" : "🌿"} ${team.name}` });
  }

  tags.push({ type: "date", value: formatDateKey(post.createdAt), label: `📅 ${formatDateTagLabel(post.createdAt)}` });

  for (const h of extractHashtags(post.body)) {
    tags.push({ type: "custom", value: h, label: `#${h}` });
  }

  return tags;
}

// ---------------------------------------------------------------
// キーワード検索（タグ・本文・投稿者名・相手/チーム名を対象に、軽量な類似語マッチも行う）
// ---------------------------------------------------------------

/** カタカナ→ひらがな変換（表記ゆれ吸収） */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 全角/半角・大文字小文字・カタカナ/ひらがな・記号の表記ゆれを吸収する正規化 */
function normalizeForSearch(s: string): string {
  return toHiragana(s.normalize("NFKC").toLowerCase()).replace(/[\s　・･/／,、.。]/g, "");
}

/** 文字列を2文字ずつの重なり窓（バイグラム）の集合にする（短い文字列はそのまま1要素） */
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length === 0) return set;
  if (s.length < 2) { set.add(s); return set; }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** 検索語のバイグラムが対象テキストのバイグラムにどれだけ含まれるか（0〜1） */
function bigramContainment(queryGrams: Set<string>, textGrams: Set<string>): number {
  if (queryGrams.size === 0) return 0;
  let hit = 0;
  for (const g of queryGrams) if (textGrams.has(g)) hit++;
  return hit / queryGrams.size;
}

/** 投稿1件をまるごと検索対象にできるよう、事前計算済みの正規化テキスト＋バイグラムにまとめる */
type SearchIndex = { normalized: string; grams: Set<string> };

function buildSearchIndex(post: Post, tags: PostTag[]): SearchIndex {
  const author = post.members.find((m) => m.id === post.authorId);
  const parts = [
    author?.name ?? "",
    ...post.members.filter((m) => m.id !== post.authorId).map((m) => m.name),
    post.body ?? "",
    ...tags.map((t) => t.label),
  ];
  const normalized = normalizeForSearch(parts.join(" "));
  return { normalized, grams: bigrams(normalized) };
}

/** 検索語（スペース区切りでAND）が対象に含まれるか。完全一致優先、無ければ類似語（バイグラム重なり）も許容する */
function matchesSearch(index: SearchIndex, query: string): boolean {
  const terms = normalizeForSearch(query).length === 0 ? [] : query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((term) => {
    const normTerm = normalizeForSearch(term);
    if (!normTerm) return true;
    if (index.normalized.includes(normTerm)) return true; // 完全一致（部分文字列）を優先した高速パス
    const termGrams = bigrams(normTerm);
    if (termGrams.size === 0) return false;
    // 短い語（1〜2文字）は誤マッチしやすいため類似語判定を行わず、完全一致のみ対象にする
    if (normTerm.length < 3) return false;
    return bigramContainment(termGrams, index.grams) >= 0.6;
  });
}

/** 現在時刻を <input type="datetime-local"> 用の "YYYY-MM-DDTHH:mm" 文字列にする */
function nowForDateTimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> の値 → unix秒 */
function dateTimeLocalToUnix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function useCollabGraphLite() {
  return useQuery({
    queryKey: ["collab", "graph"],
    queryFn: () => api.get<GraphResponse>("/collab/graph"),
  });
}

/** サブタブのラベル右肩に付ける新着件数バッジ */
function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-white font-bold"
      style={{ background: "var(--color-brand)", fontSize: "9px" }}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function ActivityAndRecords() {
  const [subTab, setSubTab] = useState<"timeline" | "stories">("timeline");
  const qc = useQueryClient();
  const alerts = useCollabAlerts();

  const markRead = useMutation({
    mutationFn: () => api.post("/collab/activity/mark-read"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "activity", "unread-count"] }),
  });

  // 協働画面（活動タイムライン／シェアストーリー）を開いたタイミングで既読にする
  useEffect(() => {
    if (alerts.total > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="px-4 lg:px-0 flex gap-2 mb-4">
        <button onClick={() => setSubTab("timeline")}
          className="flex-1 py-1.5 rounded-2xl text-xs font-medium transition flex items-center justify-center"
          style={{ background: subTab === "timeline" ? "var(--color-accent)" : "var(--color-paper-200)", color: subTab === "timeline" ? "white" : "var(--color-ink-600)" }}>
          🌊 活動タイムライン<TabBadge count={alerts.timeline} />
        </button>
        <button onClick={() => setSubTab("stories")}
          className="flex-1 py-1.5 rounded-2xl text-xs font-medium transition flex items-center justify-center"
          style={{ background: subTab === "stories" ? "var(--color-accent)" : "var(--color-paper-200)", color: subTab === "stories" ? "white" : "var(--color-ink-600)" }}>
          📚 シェアストーリーの棚<TabBadge count={alerts.stories} />
        </button>
      </div>
      {subTab === "timeline" ? <ActivityTimeline /> : <ShareStoryShelf />}
    </div>
  );
}

// ----------------------------------------------------------------
// 活動タイムライン
// ----------------------------------------------------------------
function ActivityTimeline() {
  const qc = useQueryClient();
  const { data: graphData } = useCollabGraphLite();
  const [period, setPeriod] = useState("30");
  const [team, setTeam] = useState("all");
  const [showNewPost, setShowNewPost] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [activeTag, setActiveTag] = useState<PostTag | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const teams = graphData?.data.teams ?? [];
  const others = (graphData?.data.nodes ?? []).filter((n) => !n.isMe);

  const { data, isLoading } = useQuery({
    queryKey: ["collab", "feed", period, team],
    queryFn: () => api.get<{ data: Post[] }>(`/collab/feed?period=${period}&team=${team}`),
  });

  const reactMutation = useMutation({
    mutationFn: ({ postId, type, message }: { postId: string; type: string; message?: string }) =>
      api.post(`/collab/posts/${postId}/reactions`, { type, message }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "feed"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (postId: string) => api.delete(`/collab/posts/${postId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "feed"] }),
  });
  const promoteMutation = useMutation({
    mutationFn: (postId: string) => api.post(`/collab/posts/${postId}/promote-to-story`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "feed"] });
      qc.invalidateQueries({ queryKey: ["share-stories"] });
      alert("シェアストーリーの棚に下書きを追加しました。「シェアストーリーの棚」タブから仕上げてください。");
    },
  });

  const posts = data?.data ?? [];

  // 投稿ごとのタグ・検索用インデックスは投稿一覧が変わった時だけ計算し直す
  const enrichedPosts = useMemo(
    () => posts.map((p) => {
      const tags = getPostTags(p, teams);
      return { post: p, tags, searchIndex: buildSearchIndex(p, tags) };
    }),
    [posts, teams]
  );

  const filteredPosts = enrichedPosts
    .filter(({ tags }) => !activeTag || tags.some((t) => t.type === activeTag.type && t.value === activeTag.value))
    .filter(({ searchIndex }) => matchesSearch(searchIndex, searchQuery));

  function handleTagClick(tag: PostTag) {
    setActiveTag((prev) => (prev && prev.type === tag.type && prev.value === tag.value ? null : tag));
  }

  return (
    <div className="px-4 lg:px-0">
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
        {Object.keys(PERIOD_LABELS).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
            style={{ background: period === p ? "var(--color-brand)" : "var(--color-paper-200)", color: period === p ? "white" : "var(--color-ink-600)" }}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setTeam("all")}
          className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
          style={{ background: team === "all" ? "var(--color-ink-700)" : "var(--color-paper-200)", color: team === "all" ? "white" : "var(--color-ink-600)" }}>
          すべて
        </button>
        {teams.map((t) => (
          <button key={t.id} onClick={() => setTeam(t.id)}
            className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
            style={{ background: team === t.id ? "var(--color-ink-700)" : "var(--color-paper-200)", color: team === t.id ? "white" : "var(--color-ink-600)" }}>
            {t.type === "power" ? "⚡" : "🌿"} {t.name}
          </button>
        ))}
      </div>

      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
        <input
          type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 キーワードで検索（タグ・本文・投稿者・相手やチーム名）"
          className="w-full rounded-2xl pl-9 pr-9 py-2.5 text-sm outline-none"
          style={{ background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery("")}
            aria-label="検索条件をクリア"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full"
            style={{ color: "var(--color-ink-400)" }}>
            <X size={14} />
          </button>
        )}
      </div>

      <button onClick={() => setShowNewPost(true)}
        className="w-full mb-4 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-medium text-white"
        style={{ background: "var(--color-brand)" }}>
        <Plus size={14} /> 活動を投稿する
      </button>

      {activeTag && (
        <div className="flex items-center gap-2 mb-3 text-xs px-3 py-2 rounded-2xl"
          style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
          <span>🔎 絞り込み中: {activeTag.label}</span>
          <button onClick={() => setActiveTag(null)} className="ml-auto shrink-0"><X size={14} /></button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : posts.length === 0 ? (
        <p className="text-center text-sm py-8" style={{ color: "var(--color-ink-400)" }}>この期間の投稿はありません</p>
      ) : filteredPosts.length === 0 ? (
        <p className="text-center text-sm py-8" style={{ color: "var(--color-ink-400)" }}>
          {searchQuery ? "検索条件に一致する投稿はありません" : "このタグの投稿はありません"}
        </p>
      ) : (
        <div className="space-y-3">
          {filteredPosts.map(({ post: p, tags }) => (
            <PostCard key={p.id}
              post={p}
              tags={tags}
              activeTag={activeTag}
              onTagClick={handleTagClick}
              onReact={(type, message) => reactMutation.mutate({ postId: p.id, type, message })}
              onDelete={() => { if (confirm("この投稿を削除しますか？")) deleteMutation.mutate(p.id); }}
              onPromote={() => promoteMutation.mutate(p.id)}
              onEdit={() => setEditingPost(p)}
            />
          ))}
        </div>
      )}

      {showNewPost && (
        <NewPostModal others={others} teams={teams} onClose={() => setShowNewPost(false)} />
      )}
      {editingPost && (
        <EditPostModal post={editingPost} onClose={() => setEditingPost(null)} />
      )}
    </div>
  );
}

const REACTION_MESSAGE_LABEL: Record<string, string> = { shokai: "紹介できそう", join: "私も参加したい" };

function PostCard({ post, tags, activeTag, onTagClick, onReact, onDelete, onPromote, onEdit }: {
  post: Post;
  tags: PostTag[];
  activeTag: PostTag | null;
  onTagClick: (tag: PostTag) => void;
  onReact: (type: string, message?: string) => void;
  onDelete: () => void;
  onPromote: () => void;
  onEdit: () => void;
}) {
  const author = post.members.find((m) => m.id === post.authorId);
  const isSystem = post.source === "system";
  const [pendingReactionType, setPendingReactionType] = useState<"shokai" | "join" | null>(null);

  function handleReactionClick(type: "shokai" | "join") {
    if (post.myReactions.includes(type)) return; // 既にリアクション済みなら何もしない
    setPendingReactionType(type);
  }

  return (
    <div className="card-paper p-4">
      <div className="flex items-center gap-2 mb-2">
        {author && (
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${author.bgColor}`}>{author.emoji}</span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: "var(--color-ink-700)" }}>
            {post.members.filter((m) => m.id !== post.authorId).length > 0
              ? `${author?.name ?? "だれか"} × ${post.members.filter((m) => m.id !== post.authorId).map((m) => m.name).join("・")}`
              : author?.name ?? "だれか"}
            {post.mine && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--color-ink-700)", color: "white" }}>
                自分
              </span>
            )}
          </p>
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }} title={formatDateTime(post.createdAt)}>
            {formatRelativeTime(post.createdAt)}
          </p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
          {VISIBILITY_LABEL[post.visibility]}
        </span>
        {post.canEdit && !isSystem && (
          <button onClick={onEdit} className="p-1 rounded-lg shrink-0" style={{ color: "var(--color-ink-400)" }}>
            <Pencil size={14} />
          </button>
        )}
        {post.canDelete && !isSystem && (
          <button onClick={onDelete} className="p-1 rounded-lg shrink-0" style={{ color: "var(--color-ink-400)" }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <p className="text-sm mb-2" style={{ color: "var(--color-ink-800)" }}>
        {post.body ?? "（内容は非公開です）"}
      </p>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((t) => {
            const isActive = activeTag?.type === t.type && activeTag?.value === t.value;
            return (
              <button key={`${t.type}-${t.value}`} onClick={() => onTagClick(t)}
                className="text-[11px] px-2 py-0.5 rounded-full font-medium transition"
                style={{ background: isActive ? "var(--color-brand)" : "var(--color-paper-200)", color: isActive ? "white" : "var(--color-ink-500)" }}>
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {!isSystem && (
        <div className="flex items-center gap-2 flex-wrap">
          <ReactionButton label="応援" emoji="👏" active={post.myReactions.includes("ouen")} count={post.reactionCounts.ouen ?? 0} onClick={() => onReact("ouen")} />
          <ReactionButton label="紹介できそう" emoji="🤝" active={post.myReactions.includes("shokai")} count={post.reactionCounts.shokai ?? 0} onClick={() => handleReactionClick("shokai")} />
          {post.contextType === "team" && (
            <ReactionButton label="私も参加したい" emoji="🙋" active={post.myReactions.includes("join")} count={post.reactionCounts.join ?? 0} onClick={() => handleReactionClick("join")} />
          )}
          {post.mine && (
            <button onClick={onPromote}
              className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: "rgba(212,160,59,0.15)", color: "var(--color-accent)" }}>
              <Star size={12} /> シェアストーリーに昇格
            </button>
          )}
        </div>
      )}

      {!isSystem && <CommentSection postId={post.id} comments={post.comments} />}

      {pendingReactionType && (
        <ReactionMessageModal
          reactionLabel={REACTION_MESSAGE_LABEL[pendingReactionType]}
          onClose={() => setPendingReactionType(null)}
          onSend={(message) => { onReact(pendingReactionType, message); setPendingReactionType(null); }}
        />
      )}
    </div>
  );
}

function ReactionMessageModal({ reactionLabel, onClose, onSend }: { reactionLabel: string; onClose: () => void; onSend: (message: string) => void }) {
  const [message, setMessage] = useState("");

  function handleSubmit() {
    if (!message.trim()) return;
    onSend(message.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            「{reactionLabel}」を送る
          </h2>
          <button onClick={onClose}><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          投稿者へのメッセージを添えて送ります。投稿者とその関係者にメールとホーム画面の通知でお知らせします。
        </p>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="例: この方をご紹介できそうです！詳しくお話を聞かせてください。"
          className="w-full px-3 py-2 rounded-xl border text-sm resize-none mb-3" rows={4}
          style={{ borderColor: "var(--color-paper-300)" }} autoFocus />
        <button onClick={handleSubmit} disabled={!message.trim()}
          className="w-full py-3 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
          送信する
        </button>
      </div>
    </div>
  );
}

function CommentBubble({ comment, onLike, onDelete }: { comment: Comment; onLike: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${comment.author.bgColor}`}>
        {comment.author.emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="inline-block max-w-full rounded-2xl rounded-tl-sm px-3 py-2" style={{ background: "var(--color-paper-200)" }}>
          <p className="text-[11px] font-medium mb-0.5" style={{ color: "var(--color-ink-600)" }}>{comment.author.name}</p>
          <p className="text-xs whitespace-pre-wrap break-words" style={{ color: "var(--color-ink-800)" }}>{comment.body}</p>
        </div>
        <div className="flex items-center gap-2 mt-1 pl-1">
          <button onClick={onLike} className="flex items-center gap-0.5 text-[11px] font-medium transition"
            style={{ color: comment.likedByMe ? "var(--color-brand)" : "var(--color-ink-400)" }}>
            <Heart size={11} fill={comment.likedByMe ? "var(--color-brand)" : "none"} />
            {comment.likeCount > 0 ? comment.likeCount : ""}
          </button>
          <span className="text-[10px]" style={{ color: "var(--color-ink-400)" }}>{formatRelativeTime(comment.createdAt)}</span>
          {comment.canDelete && (
            <button onClick={onDelete} className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>削除</button>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentSection({ postId, comments }: { postId: string; comments: Comment[] }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const invalidateFeed = () => qc.invalidateQueries({ queryKey: ["collab", "feed"] });

  const addComment = useMutation({
    mutationFn: () => api.post(`/collab/posts/${postId}/comments`, { body: body.trim() }),
    onSuccess: () => { setBody(""); invalidateFeed(); },
  });
  const likeComment = useMutation({
    mutationFn: (commentId: string) => api.post(`/collab/comments/${commentId}/reactions`),
    onSuccess: invalidateFeed,
  });
  const deleteComment = useMutation({
    mutationFn: (commentId: string) => api.delete(`/collab/comments/${commentId}`),
    onSuccess: invalidateFeed,
  });

  function handleSubmit() {
    if (!body.trim() || addComment.isPending) return;
    addComment.mutate();
  }

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px dashed var(--color-paper-300)" }}>
      {comments.length > 0 && (
        <div className="space-y-2 mb-2">
          {comments.map((cm) => (
            <CommentBubble key={cm.id} comment={cm}
              onLike={() => likeComment.mutate(cm.id)}
              onDelete={() => { if (confirm("このコメントを削除しますか？")) deleteComment.mutate(cm.id); }} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSubmit(); }}
          placeholder="💬 コメントする..."
          className="flex-1 rounded-full px-3 py-1.5 text-xs outline-none"
          style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-800)" }} />
        <button onClick={handleSubmit} disabled={!body.trim() || addComment.isPending}
          className="p-2 rounded-full text-white disabled:opacity-40 shrink-0" style={{ background: "var(--color-brand)" }}>
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

function ReactionButton({ label, emoji, active, count, onClick }: { label: string; emoji: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium transition"
      style={{ background: active ? "rgba(181,56,75,0.12)" : "var(--color-paper-200)", color: active ? "var(--color-brand)" : "var(--color-ink-500)" }}>
      {emoji} {label}{count > 0 ? ` ${count}` : ""}
    </button>
  );
}

function NewPostModal({ others, teams, onClose }: { others: GraphNodeLite[]; teams: GraphTeamLite[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"link" | "team">("link");
  const [partnerId, setPartnerId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"chapter" | "private" | "team">("chapter");
  const [occurredAtLocal, setOccurredAtLocal] = useState(() => nowForDateTimeLocal());
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () => api.post("/collab/posts", {
      contextType: mode,
      partnerId: mode === "link" ? partnerId : undefined,
      teamId: mode === "team" ? teamId : undefined,
      body: body.trim() || undefined,
      visibility,
      occurredAt: dateTimeLocalToUnix(occurredAtLocal),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "feed"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "投稿に失敗しました"),
  });

  function handleSubmit() {
    setError("");
    if (mode === "link" && !partnerId) { setError("相手を選んでください"); return; }
    if (mode === "team" && !teamId) { setError("チームを選んでください"); return; }
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>活動を投稿する</h2>
          <button onClick={onClose}><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={() => setMode("link")}
            className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
            style={{ background: mode === "link" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "link" ? "white" : "var(--color-ink-600)" }}>
            なかまと
          </button>
          <button onClick={() => setMode("team")}
            className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
            style={{ background: mode === "team" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "team" ? "white" : "var(--color-ink-600)" }}>
            チームで
          </button>
        </div>

        {mode === "link" ? (
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
            <option value="">相手を選択...</option>
            {others.map((n) => <option key={n.id} value={n.id}>{n.emoji} {n.name}</option>)}
          </select>
        ) : (
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
            <option value="">チームを選択...</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.type === "power" ? "⚡" : "🌿"} {t.name}</option>)}
          </select>
        )}

        <textarea value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="どんな活動をしましたか？（任意）"
          className="w-full px-3 py-2 rounded-xl border text-sm resize-none mb-1" rows={3}
          style={{ borderColor: "var(--color-paper-300)" }} />
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
          💡 本文に「#タグ名」と書くと、あとでそのタグから投稿を探せるようになります
        </p>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>活動した日時</label>
        <input type="datetime-local" value={occurredAtLocal} onChange={(e) => setOccurredAtLocal(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>発信範囲</label>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-4" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="chapter">📢 チャプター公開</option>
          {mode === "team" && <option value="team">🏠 チーム内のみ</option>}
          <option value="private">🔒 非公開（内容は自分だけ）</option>
        </select>

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <button onClick={handleSubmit} disabled={create.isPending}
          className="w-full py-3 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
          投稿する
        </button>
      </div>
    </div>
  );
}

function EditPostModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState(post.body ?? "");
  const [visibility, setVisibility] = useState<"chapter" | "private" | "team">(
    post.visibility === "team" ? "team" : post.visibility === "private" ? "private" : "chapter"
  );
  const [error, setError] = useState("");

  const update = useMutation({
    mutationFn: () => api.patch(`/collab/posts/${post.id}`, { body: body.trim() || undefined, visibility }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "feed"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "更新に失敗しました"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>投稿を編集</h2>
          <button onClick={onClose}><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>

        <textarea value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="どんな活動をしましたか？（任意）"
          className="w-full px-3 py-2 rounded-xl border text-sm resize-none mb-1" rows={3}
          style={{ borderColor: "var(--color-paper-300)" }} />
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
          💡 本文に「#タグ名」と書くと、あとでそのタグから投稿を探せるようになります
        </p>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>発信範囲</label>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-4" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="chapter">📢 チャプター公開</option>
          {post.contextType === "team" && <option value="team">🏠 チーム内のみ</option>}
          <option value="private">🔒 非公開（内容は自分だけ）</option>
        </select>

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <button onClick={() => { setError(""); update.mutate(); }} disabled={update.isPending}
          className="w-full py-3 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
          更新する
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// シェアストーリーの棚
// ----------------------------------------------------------------
type Story = {
  id: string;
  teamId: string | null;
  teamName: string | null;
  title: string;
  summary: string | null;
  presentedOn: number | null;
  visibility: "team" | "chapter" | "private";
  createdAt: number;
  mine: boolean;
  canDelete: boolean;
  attachments: { id: string; kind: string; label: string; url: string | null }[];
  members: PostMember[];
};

const ATTACHMENT_ICON: Record<string, string> = { slide: "📊", video: "🎬", minutes: "📝", photo: "📷", link: "🔗" };

/** YouTubeの各種URL形式（watch?v=, youtu.be/, shorts/）を埋め込み用URLに変換する。対象外ならnull */
function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/")[2];
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

/**
 * 添付の種類（kind）によって表示のされ方を変える。
 * 写真・動画は可能な限りインプレースで表示し、それ以外はリンクのまま。
 */
function AttachmentView({ attachment: a }: { attachment: Story["attachments"][number] }) {
  const icon = ATTACHMENT_ICON[a.kind] ?? "📎";
  const label = (
    <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>{icon} {a.label}</span>
  );

  if (!a.url) return <div>{label}</div>;

  if (a.kind === "photo" || (!ATTACHMENT_ICON[a.kind] && IMAGE_EXT_RE.test(a.url))) {
    return (
      <div>
        <a href={a.url} target="_blank" rel="noopener noreferrer">
          <img src={a.url} alt={a.label} loading="lazy"
            className="rounded-xl max-h-64 w-auto object-contain mb-1" style={{ background: "var(--color-paper-200)" }} />
        </a>
        {label}
      </div>
    );
  }

  if (a.kind === "video") {
    const youTubeEmbed = getYouTubeEmbedUrl(a.url);
    if (youTubeEmbed) {
      return (
        <div>
          <div className="rounded-xl overflow-hidden mb-1" style={{ aspectRatio: "16/9" }}>
            <iframe src={youTubeEmbed} title={a.label} className="w-full h-full" allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
          </div>
          {label}
        </div>
      );
    }
    if (VIDEO_EXT_RE.test(a.url)) {
      return (
        <div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={a.url} controls className="rounded-xl w-full max-h-64 mb-1" style={{ background: "black" }} />
          {label}
        </div>
      );
    }
  }

  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer"
      className="text-xs underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
      {icon} {a.label}
    </a>
  );
}

function ShareStoryShelf() {
  const qc = useQueryClient();
  const { data: graphData } = useCollabGraphLite();
  const [team, setTeam] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const teams = graphData?.data.teams ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["share-stories", team],
    queryFn: () => api.get<{ data: Story[] }>(`/share-stories?team=${team}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/share-stories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share-stories"] }),
  });

  const stories = data?.data ?? [];

  return (
    <div className="px-4 lg:px-0">
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setTeam("all")}
          className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
          style={{ background: team === "all" ? "var(--color-ink-700)" : "var(--color-paper-200)", color: team === "all" ? "white" : "var(--color-ink-600)" }}>
          すべて
        </button>
        {teams.map((t) => (
          <button key={t.id} onClick={() => setTeam(t.id)}
            className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
            style={{ background: team === t.id ? "var(--color-ink-700)" : "var(--color-paper-200)", color: team === t.id ? "white" : "var(--color-ink-600)" }}>
            {t.type === "power" ? "⚡" : "🌿"} {t.name}
          </button>
        ))}
      </div>

      <button onClick={() => setShowNew(true)}
        className="w-full mb-4 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-medium text-white"
        style={{ background: "var(--color-brand)" }}>
        <Plus size={14} /> シェアストーリーを登録する
      </button>

      {isLoading ? (
        <div className="text-center py-8" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : stories.length === 0 ? (
        <p className="text-center text-sm py-8" style={{ color: "var(--color-ink-400)" }}>まだシェアストーリーがありません</p>
      ) : (
        <div className="space-y-3">
          {stories.map((s) => (
            <div key={s.id} className="card-paper p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{s.title}</h3>
                {s.canDelete && (
                  <button onClick={() => { if (confirm("削除しますか？")) deleteMutation.mutate(s.id); }} style={{ color: "var(--color-ink-400)" }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {s.teamName && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                    {s.teamName}
                  </span>
                )}
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                  {VISIBILITY_LABEL[s.visibility]}
                </span>
              </div>
              {s.summary && <p className="text-sm mb-2 whitespace-pre-wrap" style={{ color: "var(--color-ink-700)" }}>{s.summary}</p>}
              {s.attachments.length > 0 && (
                <div className="flex flex-col gap-2">
                  {s.attachments.map((a) => <AttachmentView key={a.id} attachment={a} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showNew && <NewStoryModal teams={teams} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewStoryModal({ teams, onClose }: { teams: GraphTeamLite[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [teamId, setTeamId] = useState("");
  const [visibility, setVisibility] = useState<"chapter" | "private" | "team">("chapter");
  const [attachments, setAttachments] = useState<{ kind: string; label: string; url: string }[]>([]);
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () => api.post("/share-stories", {
      title: title.trim(),
      summary: summary.trim() || undefined,
      teamId: teamId || undefined,
      visibility,
      attachments: attachments.filter((a) => a.label.trim()),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["share-stories"] });
      qc.invalidateQueries({ queryKey: ["collab", "feed"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "登録に失敗しました"),
  });

  function addAttachment() {
    setAttachments((prev) => [...prev, { kind: "link", label: "", url: "" }]);
  }
  function updateAttachment(idx: number, patch: Partial<{ kind: string; label: string; url: string }>) {
    setAttachments((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    setError("");
    if (!title.trim()) { setError("タイトルを入力してください"); return; }
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>シェアストーリーを登録</h2>
          <button onClick={onClose}><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>タイトル *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 新規開拓プロジェクト報告"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>概要</label>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm resize-none mb-3" rows={8}
          style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>紐づけるチーム（任意）</label>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="">なし</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.type === "power" ? "⚡" : "🌿"} {t.name}</option>)}
        </select>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>発信範囲</label>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="chapter">📢 チャプター公開</option>
          {teamId && <option value="team">🏠 チーム内のみ</option>}
          <option value="private">🔒 非公開</option>
        </select>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>添付（資料/動画/議事録などのリンク）</label>
        <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
          「写真」「動画」はその場に画像・動画として表示されます（動画はYouTubeリンクまたは動画ファイルの直リンクに対応）。それ以外はリンク表示になります。
        </p>
        <div className="space-y-3 mb-2">
          {attachments.map((a, idx) => (
            <div key={idx} className="p-3 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
              <div className="flex gap-1.5 items-center mb-2">
                <select value={a.kind} onChange={(e) => updateAttachment(idx, { kind: e.target.value })}
                  className="flex-1 px-2 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--color-paper-300)" }}>
                  <option value="slide">📊資料</option>
                  <option value="video">🎬動画</option>
                  <option value="minutes">📝議事録</option>
                  <option value="photo">📷写真</option>
                  <option value="link">🔗リンク</option>
                </select>
                <button onClick={() => removeAttachment(idx)} style={{ color: "var(--color-ink-400)" }}><X size={16} /></button>
              </div>
              <input value={a.label} onChange={(e) => updateAttachment(idx, { label: e.target.value })}
                placeholder="ラベル" className="w-full px-3 py-2 rounded-xl border text-sm mb-2" style={{ borderColor: "var(--color-paper-300)" }} />
              <input value={a.url} onChange={(e) => updateAttachment(idx, { url: e.target.value })}
                placeholder="URL" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
            </div>
          ))}
        </div>
        <button onClick={addAttachment} className="text-xs mb-4 font-medium" style={{ color: "var(--color-brand)" }}>＋ 添付を追加</button>

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <button onClick={handleSubmit} disabled={create.isPending}
          className="w-full py-3 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
          登録する
        </button>
      </div>
    </div>
  );
}
