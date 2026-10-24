// =============================================================
// 1to1の案内を、メールではなくDM等で送るときの「お誘いのメッセージ」
// メールで通知できない（相手のメールアドレスが分からない）ときや、メールをあまり見ない相手にDMで送るときに、
// 申込者がそのまま使えるように、相手の名前・自分の名前・日程を選ぶURLを入れた文面を作って表示する（編集してコピーもできる）。
// =============================================================
import { useState } from "react";
import { Check, Copy, MessageSquareText } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";

/**
 * DMで送るメッセージの文面。
 * @param partnerName 1to1を申し込んだ相手の名前（分からないときは「ご担当の方」）
 * @param senderName 1to1の主催者（申込者）の名前
 * @param url 公開予約URL、または候補日から選ぶ画面のURL
 */
function buildOneOnOneDmMessage(partnerName: string | null | undefined, senderName: string, url: string): string {
  const partner = partnerName?.trim() ? `${partnerName.trim()}さん` : "ご担当の方";
  const heading = partnerName?.trim() ? `${partner}\n` : "";
  return `${heading}お疲れ様です。${senderName}です。
大変お忙しいかと思いますが、ぜひ${partner}と1to1を実施させていただきたいと思います。お時間をいただけますでしょうか？
よろしければ、以下から${partner}のご予定を伺わせてください。

${url}

よろしくお願いします。`;
}

export function OneOnOneDmMessage({ partnerName, url, defaultOpen = false }: { partnerName: string | null | undefined; url: string; defaultOpen?: boolean }) {
  const senderName = useAuthStore((s) => s.user?.name) ?? "";
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState(() => (defaultOpen ? buildOneOnOneDmMessage(partnerName, senderName, url) : ""));
  const [copied, setCopied] = useState(false);

  function show() {
    // 開くたびに、最新の名前・URLで文面を作り直す（編集した内容は、開き直すと元に戻る）
    setText(buildOneOnOneDmMessage(partnerName, senderName, url));
    setOpen(true);
  }
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  if (!open) {
    return (
      <button type="button" onClick={show}
        className="w-full py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
        style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}>
        <MessageSquareText size={12} />DMで送るメッセージを表示
      </button>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
        メールではなく、DM等でお送りするときの文面です（必要に応じて直してから、コピーしてお使いください）
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        className="w-full px-3 py-2 rounded-xl text-xs leading-relaxed border"
        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-800)" }}
      />
      <div className="flex gap-2">
        <button type="button" onClick={copy}
          className="flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: copied ? "var(--color-success)" : "var(--color-brand)", color: "white" }}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "コピーしました" : "メッセージをコピー"}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          閉じる
        </button>
      </div>
    </div>
  );
}
