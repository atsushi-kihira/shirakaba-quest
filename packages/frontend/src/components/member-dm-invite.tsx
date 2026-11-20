// =============================================================
// メンバー向けの、DM連絡用の案内（ミーティング）
//   メンバーには、これまでメールとアプリ内のお知らせしか届かなかった。メールが見られていない・見落とされている
//   メンバーに、LINEやMessengerなどのDMで、直接お声がけできるように、
//   「ミーティングのページのURL」と、メンバーごとの「DMで送るメッセージ」を用意する。
//   URLを開くと、ログインしたあと（すでにログイン中ならそのまま）、日程の回答画面が開く。
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MessageSquareText } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { CopyButton } from "@/components/guest-invite-result";

export type MemberDmTarget = { id: string; name: string; /** 回答済みか。分からないとき（作成直後など）は省略 */ responded?: boolean };

/** メンバーに送る、ミーティングのページのURL */
function meetingMemberUrl(meetingId: string): string {
  return `${window.location.origin}/meetings/${meetingId}`;
}

/** DMで送るメッセージの文面（メンバー宛て） */
function buildMemberDmText({ memberName, senderName, title, url, confirmed, noAttendanceCheck }: {
  memberName: string; senderName: string; title: string; url: string; confirmed: boolean; noAttendanceCheck?: boolean;
}): string {
  const ask = noAttendanceCheck
    ? `「${title}」のご案内です。以下のURLから、詳細をご確認ください。`
    : confirmed
      ? `「${title}」の日程が決まりました。以下のURLから、日程をご確認のうえ、ご出欠をお知らせください。`
      : `「${title}」の日程調整をお願いしたく、ご連絡しました。以下のURLから、ご都合のよい日をお選びください。`;
  return `${memberName.trim()}さん\nお疲れ様です。${senderName}です。\n${ask}\n\n${url}\n\n（ログインの画面が出たときは、いつものメールアドレスでログインしてください）\n\nよろしくお願いします。`;
}

function MemberCard({ target, senderName, title, url, confirmed, noAttendanceCheck }: {
  target: MemberDmTarget; senderName: string; title: string; url: string; confirmed: boolean; noAttendanceCheck: boolean;
}) {
  const [open, setOpen] = useState(false);
  // 文面は、開くたびに最新の内容で作り直す。直した内容は、閉じると元に戻る
  const built = buildMemberDmText({ memberName: target.name, senderName, title, url, confirmed, noAttendanceCheck });
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? built;
  return (
    <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
        {target.name}さん
        {target.responded !== undefined && (
          <span className="ml-2 text-[11px] font-normal px-2 py-0.5 rounded-full"
            style={target.responded
              ? { background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }
              : { background: "rgba(212,160,59,0.18)", color: "var(--color-ink-700)" }}>
            {target.responded ? "回答済み" : "未回答"}
          </span>
        )}
      </p>
      <div className="flex gap-2">
        <CopyButton text={url} label="URLをコピー" primary />
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
          <textarea value={text} onChange={(e) => setEdited(e.target.value)} rows={9}
            className="w-full px-3 py-2 rounded-xl text-xs leading-relaxed border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-800)" }} />
          <div className="flex"><CopyButton text={text} label="メッセージをコピー" /></div>
        </div>
      )}
    </div>
  );
}

type Props = {
  meetingId: string;
  title: string;
  confirmed: boolean;
  noAttendanceCheck?: boolean;
  members: MemberDmTarget[];
  /** 最初から開いておくか */
  defaultOpen?: boolean;
};

export function MemberDmInvite({ meetingId, title, confirmed, noAttendanceCheck = false, members, defaultOpen = false }: Props) {
  const senderName = useAuthStore((s) => s.user?.name) ?? "";
  const [open, setOpen] = useState(defaultOpen);
  const [onlyPending, setOnlyPending] = useState(true);
  if (members.length === 0) return null;
  const url = meetingMemberUrl(meetingId);
  const hasStatus = members.some((m) => m.responded !== undefined);
  const pendingCount = members.filter((m) => m.responded === false).length;
  // 未回答の人がいるときは、その人たちだけを、最初に表示する
  const filtering = hasStatus && onlyPending && pendingCount > 0;
  const shown = filtering ? members.filter((m) => m.responded === false) : members;
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80"
        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
        <span>📨 メンバーへのDM連絡用URL・メッセージ</span>
        <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>
          {hasStatus && pendingCount > 0 ? `未回答 ${pendingCount}人 ` : ""}{open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="space-y-2.5">
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            メールが見られていないメンバーに、DMでお声がけするときに使えます。URLを開くと、ログイン後（ログイン中ならそのまま）、このミーティングの画面が開きます。
          </p>
          <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
            <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>メンバー共通のURL</p>
            <p className="text-xs break-all px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>{url}</p>
            <div className="flex"><CopyButton text={url} label="URLをコピー" /></div>
          </div>
          {hasStatus && pendingCount > 0 && (
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--color-ink-600)" }}>
              <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
              未回答のメンバーだけを表示する
            </label>
          )}
          {shown.map((m) => (
            <MemberCard key={m.id} target={m} senderName={senderName} title={title} url={url}
              confirmed={confirmed} noAttendanceCheck={noAttendanceCheck} />
          ))}
        </div>
      )}
    </div>
  );
}

type CreatedResponse = { data: { meeting: { hostMemberId: string }; respondents: { type: "member" | "external"; id: string; name: string }[] } };

/** 作成した直後の画面用。作成したミーティングの招待メンバーを取得して、DM用の案内を出す */
export function CreatedMemberDmInvite({ meetingId, title, confirmed }: { meetingId: string; title: string; confirmed: boolean }) {
  const { data } = useQuery({
    queryKey: ["meetings", meetingId],
    queryFn: () => api.get<CreatedResponse>(`/meetings/${meetingId}`),
  });
  if (!data) return null;
  const members = data.data.respondents
    .filter((r) => r.type === "member" && r.id !== data.data.meeting.hostMemberId)
    .map((r) => ({ id: r.id, name: r.name }));
  return <MemberDmInvite meetingId={meetingId} title={title} confirmed={confirmed} members={members} />;
}
