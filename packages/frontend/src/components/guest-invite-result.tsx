// =============================================================
// ミーティング・定例会を作成した直後の、外部ゲストへの案内の画面
//   メールで案内しないゲスト（名前だけで招待した方）の専用URLと、DMで送るメッセージを、ゲストごとに表示する。
//   メールで招待した方は、名前だけをまとめて上に出す。
//   メールで案内しないゲストがいないときは、この画面は出さず、そのまま詳細画面へ進む（呼び出し側で判断する）。
// =============================================================
import { useState } from "react";
import { Check, Copy, MessageSquareText } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";

export type CreatedGuest = { id: string; name: string; email: string | null; url: string; invited: boolean };

/** メールで案内していない（専用URLをお渡しする）ゲスト */
export const dmGuestsOf = (guests: CreatedGuest[] | undefined): CreatedGuest[] => (guests ?? []).filter((g) => !g.invited && !!g.url);

type Props = {
  kind: "meeting" | "series";
  title: string;
  /** 日程を確定して作成したか（文面が「日程をお選びください」から「ご出欠をお知らせください」に変わる） */
  confirmed: boolean;
  guests: CreatedGuest[];
  onOpenDetail: () => void;
};

/** DMで送るメッセージの文面 */
export function buildGuestDmText({ guestName, senderName, title, url, kind, confirmed }: {
  guestName: string; senderName: string; title: string; url: string; kind: "meeting" | "series"; confirmed: boolean;
}): string {
  const what = kind === "series" ? `定例会「${title}」` : `「${title}」`;
  const ask = confirmed
    ? `${what}のご案内をお送りします。以下のURLから、日程をご確認のうえ、ご出欠をお知らせください。`
    : `${what}の日程調整をお願いしたく、ご連絡しました。以下のURLから、ご都合のよい日をお選びください。`;
  return `${guestName.trim() ? `${guestName.trim()}さん\n` : ""}お疲れ様です。${senderName}です。\n${ask}\n\n${url}\n\nよろしくお願いします。`;
}

function CopyButton({ text, label, primary = false }: { text: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
  }
  return (
    <button type="button" onClick={copy}
      className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
      style={{ background: copied || primary ? "var(--color-success)" : "var(--color-paper-200)", color: copied || primary ? "white" : "var(--color-ink-600)" }}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "コピーしました" : label}
    </button>
  );
}

function GuestCard({ guest, senderName, title, kind, confirmed }: { guest: CreatedGuest; senderName: string; title: string; kind: "meeting" | "series"; confirmed: boolean }) {
  const [open, setOpen] = useState(false);
  // 文面は、開くたびに最新の内容で作り直す。直した内容は、閉じると元に戻る
  const built = buildGuestDmText({ guestName: guest.name, senderName, title, url: guest.url, kind, confirmed });
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? built;
  return (
    <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
        👤 {guest.name || "（名前未入力）"}さん
        <span className="ml-2 text-[11px] font-normal px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>メール案内なし</span>
      </p>
      <p className="text-xs break-all px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>{guest.url}</p>
      <div className="flex gap-2">
        <CopyButton text={guest.url} label="URLをコピー" primary />
        <button type="button" onClick={() => { setEdited(null); setOpen((v) => !v); }}
          className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <MessageSquareText size={13} />{open ? "メッセージを閉じる" : "DMで送るメッセージを表示"}
        </button>
      </div>
      {open && (
        <div className="space-y-1.5">
          <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
            メールではなく、DM等でお送りするときの文面です（必要に応じて直してから、コピーしてお使いください）
          </p>
          <textarea value={text} onChange={(e) => setEdited(e.target.value)} rows={8}
            className="w-full px-3 py-2 rounded-xl text-xs leading-relaxed border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-800)" }} />
          <div className="flex"><CopyButton text={text} label="メッセージをコピー" /></div>
        </div>
      )}
    </div>
  );
}

export function GuestInviteResult({ kind, title, confirmed, guests, onOpenDetail }: Props) {
  const senderName = useAuthStore((s) => s.user?.name) ?? "";
  const dm = dmGuestsOf(guests);
  const mailed = guests.filter((g) => g.invited);
  const label = kind === "series" ? "定例会" : "ミーティング";
  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto space-y-4">
      <div className="card-paper rounded-2xl p-4 space-y-3">
        <p className="text-sm font-medium px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}>
          ✅ {label}を作成しました。メールで案内しないゲストには、下の専用URLをお送りください。
        </p>
        {mailed.length > 0 && (
          <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-700)" }}>
            ✉️ 招待メールを送ったゲスト：{mailed.map((g) => `${g.name}さん`).join("、")}
          </p>
        )}
        <div className="space-y-2.5">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>📨 ゲストへの案内（DMなどでお送りください）</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              ゲストごとに専用のURLです。他の方には転送しないよう、お伝えください。相手がURLを開いたときに、メールアドレスを入力してもらいます。
            </p>
          </div>
          {dm.map((g) => <GuestCard key={g.id} guest={g} senderName={senderName} title={title} kind={kind} confirmed={confirmed} />)}
        </div>
        <button type="button" onClick={onOpenDetail}
          className="w-full py-3 rounded-2xl text-sm font-medium text-white" style={{ background: "var(--color-brand)" }}>
          {label}の詳細を見る →
        </button>
        <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>あとから詳細画面でも、同じ専用URLをコピーできます。</p>
      </div>
    </div>
  );
}
