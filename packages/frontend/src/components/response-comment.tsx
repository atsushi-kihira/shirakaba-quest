// =============================================================
// 日程の回答に添える「一言コメント」の入力欄と、表示用の吹き出し
// ミーティング・定例会・1to1（候補日から選ぶとき）で共通して使う。
// =============================================================

/** 一言コメントの最大文字数（バックエンドの COMMENT_MAX_LENGTH と同じ） */
export const COMMENT_MAX_LENGTH = 100;

type FieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** 例文。省略すると、回答用の例文を表示する */
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
};

/** 一言コメントの入力欄（1行・任意・最大100文字） */
export function ResponseCommentField({
  value, onChange, placeholder = "例：参加できる日が少なくてすみません", label = "💬 ひとことコメント（任意）", disabled, className = "",
}: FieldProps) {
  return (
    <div className={className}>
      <label className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium" style={{ color: "var(--color-ink-700)" }}>{label}</span>
        <span className="text-[11px] tabular-nums" style={{ color: value.length >= COMMENT_MAX_LENGTH ? "var(--color-brand)" : "var(--color-ink-400)" }}>
          {value.length}/{COMMENT_MAX_LENGTH}
        </span>
      </label>
      <input
        type="text"
        value={value}
        maxLength={COMMENT_MAX_LENGTH}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl text-sm outline-none border disabled:opacity-60"
        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
      />
    </div>
  );
}

/** 回答者のコメントを、吹き出しで表示する */
export function CommentBubble({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p className={`text-xs rounded-xl px-2.5 py-1.5 whitespace-pre-wrap break-words ${className}`}
      style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)", border: "1px solid var(--color-paper-300)" }}>
      💬 {text}
    </p>
  );
}

type CommentRespondent = { name: string; comment?: string | null };

/**
 * 候補日ごとの回答者一覧（外部ゲスト向けの画面用）から、コメントのある人だけを、1人1回ずつ並べて表示する。
 * 候補日が複数あっても、同じ人のコメントは重ねて出さない。
 */
export function RespondentComments({ respondents, className = "" }: { respondents: CommentRespondent[]; className?: string }) {
  const seen = new Set<string>();
  const items: { name: string; comment: string }[] = [];
  for (const r of respondents) {
    if (!r.comment) continue;
    const key = `${r.name}\u0000${r.comment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name: r.name, comment: r.comment });
  }
  if (items.length === 0) return null;
  return (
    <div className={className}>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--color-ink-700)" }}>💬 回答した方のコメント</p>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i}>
            <p className="text-[11px] mb-0.5" style={{ color: "var(--color-ink-500)" }}>{it.name}さん</p>
            <CommentBubble text={it.comment} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 1to1で、相手が候補日から日時を選んだときに添えたコメントの表示。
 * fromName があれば「◯◯さんからのコメント」、なければ（自分が添えた分）「あなたが添えたコメント」。
 */
export function SelectedCommentNote({ comment, fromName, className = "mt-2" }: { comment: string; fromName?: string | null; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] mb-0.5" style={{ color: "var(--color-ink-500)" }}>
        {fromName ? `${fromName}さんからのコメント` : "あなたが添えたコメント"}
      </p>
      <CommentBubble text={comment} />
    </div>
  );
}
