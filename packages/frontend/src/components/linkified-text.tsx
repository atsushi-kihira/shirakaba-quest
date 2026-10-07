// 通知本文の表示用: 改行を保ち、http(s)のURLをリンクにする
const URL_RE = /(https?:\/\/[^\s<>]+)/g;

export function LinkifiedText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const parts = text.split(URL_RE);
  return (
    <p className={className} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", ...style }}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part)
          ? <a key={i} href={part} className="underline" style={{ color: "var(--color-brand)" }}>{part}</a>
          : <span key={i}>{part}</span>
      )}
    </p>
  );
}
