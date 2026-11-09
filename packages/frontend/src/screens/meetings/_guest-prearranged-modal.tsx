// =============================================================
// 「すでに日程調整済み」の外部ゲスト（ビジター）との1to1を、日時を指定して登録するモーダル
// （メンバー向けの「日程を指定して申し込む」と同じ位置づけ）。相手の回答は待たず、その場で確定済みとして登録する。
//   ・メールで案内する: 確定のお知らせ（日時・会議URL・キャンセル用リンク）を、相手にメールする（名前・メールアドレスが必須）
//   ・案内しない: メールアドレスは不要。登録のあとに表示される日時・会議URL入りの文面を、DM等で送る
// 登録した1to1は、「ビジターとの1to1」の予定一覧に出る（日時・会議URLの編集や削除もそこでできる）。
// =============================================================
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, CalendarClock, Check, Copy } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { DEFAULT_START_TIME, addMinutesToTime } from "@/lib/meeting-time";
import { DurationSelect } from "@/components/duration-select";
import { useDefaultMeetingDuration } from "@/hooks/use-default-meeting-duration";
import { OneOnOneEventSelector } from "@/components/oneonone-event-selector";
import { useAuthStore } from "@/stores/auth-store";

type ConnectedStatus = { data: { connected: boolean } };
type ConferenceType = "zoom" | "google_meet" | "manual" | "none";
type Result = {
  bookingId: string;
  startAtUtc: string;
  endAtUtc: string;
  conferenceType: string;
  conferenceUrl: string | null;
  emailSent: boolean;
  guestName: string;
};

const inputStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayYMD(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function fmtRange(startUtc: string, endUtc: string): string {
  const start = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(startUtc));
  const end = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(endUtc));
  return `${start}〜${end}`;
}

/** メールを使わず、DM等でお伝えするときの文面（日時・会議URL・メッセージ入り） */
function buildDmText(guestName: string, senderName: string, r: Result, note: string): string {
  return [
    `${guestName}さん`,
    "",
    "お世話になっております。1to1の日程を、次のとおり登録しました。",
    "",
    `📅 日時：${fmtRange(r.startAtUtc, r.endAtUtc)}`,
    r.conferenceUrl ? `🔗 会議URL：${r.conferenceUrl}` : "",
    note.trim() ? `💬 ${note.trim()}` : "",
    "",
    "ご都合が悪くなった場合は、お手数ですが、お知らせください。",
    "当日、よろしくお願いいたします。",
    senderName ? `\n${senderName}` : "",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

export function GuestPrearrangedModal({
  initialName = "",
  initialEmail = "",
  initialNotify = true,
  onClose,
}: {
  initialName?: string;
  initialEmail?: string;
  initialNotify?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const senderName = useAuthStore((s) => s.user?.name) ?? "";
  const [guestName, setGuestName] = useState(initialName);
  const [guestEmail, setGuestEmail] = useState(initialEmail);
  const [notifyByEmail, setNotifyByEmail] = useState(initialNotify);
  const [eventCampaignId, setEventCampaignId] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayYMD());
  const [time, setTime] = useState(DEFAULT_START_TIME);
  // 所要時間の初期値は、日程調整設定の「デフォルトの会議時間」（読み込み後に、まだ本人が変えていなければ、一度だけ反映する）
  const { duration: defaultDuration, loaded: defaultDurationLoaded } = useDefaultMeetingDuration();
  const [duration, setDuration] = useState(defaultDuration);
  const durationTouched = useRef(false);
  useEffect(() => {
    if (defaultDurationLoaded && !durationTouched.current) setDuration(defaultDuration);
  }, [defaultDurationLoaded, defaultDuration]);
  const [conferenceType, setConferenceType] = useState<ConferenceType>("none");
  const [conferenceUrl, setConferenceUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [dmText, setDmText] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: zoomData } = useQuery<ConnectedStatus>({
    queryKey: ["scheduler", "zoom-status"],
    queryFn: () => api.get<ConnectedStatus>("/scheduler/oauth/zoom/status"),
  });
  const { data: googleData } = useQuery<ConnectedStatus>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => api.get<ConnectedStatus>("/scheduler/oauth/google/status"),
  });
  const zoomConnected = zoomData?.data.connected ?? false;
  const googleConnected = googleData?.data.connected ?? false;

  const submit = useMutation({
    mutationFn: () => {
      const name = guestName.trim();
      const email = guestEmail.trim();
      if (!name) throw new Error("相手の名前を入力してください");
      if (notifyByEmail && !email) throw new Error("メールで案内する場合は、相手のメールアドレスを入力してください");
      if (notifyByEmail && !EMAIL_RE.test(email)) throw new Error("メールアドレスの形式が正しくありません");
      const startAtUtc = new Date(`${date}T${time}:00+09:00`).toISOString();
      const endAtUtc = new Date(new Date(startAtUtc).getTime() + duration * 60_000).toISOString();
      if (new Date(startAtUtc).getTime() <= Date.now()) {
        throw new Error("過去の日時は指定できません。これから実施する1to1の日時を入力してください。");
      }
      return api.post<{ data: Result }>("/oneonone/guest-invites/prearranged", {
        guestName: name,
        guestEmail: notifyByEmail ? email : undefined,
        startAtUtc,
        endAtUtc,
        conferenceType: conferenceType === "none" ? "manual" : conferenceType,
        conferenceUrl: conferenceType === "manual" ? (conferenceUrl.trim() || undefined) : undefined,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
        notifyByEmail,
        eventCampaignId: eventCampaignId || undefined,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["scheduler", "bookings"] });
      qc.invalidateQueries({ queryKey: ["oneonone", "guest-invites"] });
      setResult(res.data);
      setDmText(buildDmText(res.data.guestName, senderName, res.data, note));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "エラーが発生しました"),
  });

  function copy() {
    navigator.clipboard.writeText(dmText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            <CalendarClock size={20} />
            {result ? "1to1を登録しました" : "日程を指定して登録する"}
          </h2>
          <button onClick={onClose} aria-label="閉じる" className="p-1.5 rounded-xl" style={{ color: "var(--color-ink-400)" }}>
            <X size={18} />
          </button>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="px-3 py-2.5 rounded-xl space-y-1" style={{ background: "rgba(90,140,92,0.1)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--color-success)" }}>✅ {result.guestName}さんとの1to1を、確定済みで登録しました</p>
              <p className="text-xs" style={{ color: "var(--color-ink-700)" }}>📅 {fmtRange(result.startAtUtc, result.endAtUtc)}</p>
              {result.conferenceUrl && <p className="text-xs break-all" style={{ color: "var(--color-ink-700)" }}>🔗 {result.conferenceUrl}</p>}
              {result.emailSent && <p className="text-xs" style={{ color: "var(--color-success)" }}>📧 {result.guestName}さんにメールで確定のお知らせを送りました</p>}
            </div>

            {!result.emailSent && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>💬 DMなどでお伝えするときの文面（直してから、使えます）</p>
                <textarea value={dmText} onChange={(e) => setDmText(e.target.value)} rows={9}
                  className="w-full px-3 py-2.5 rounded-xl text-xs outline-none border resize-y leading-relaxed" style={inputStyle} />
                <button type="button" onClick={copy}
                  className="w-full py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                  style={{ background: copied ? "var(--color-success)" : "var(--color-paper-200)", color: copied ? "white" : "var(--color-ink-600)" }}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "コピーしました" : "文面をコピー"}
                </button>
              </div>
            )}

            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              「ビジターとの1to1」の予定に載りました。日時や会議URLの変更、削除も、そこからできます。
            </p>
            <button onClick={onClose} className="w-full py-3 rounded-2xl text-sm font-medium text-white" style={{ background: "var(--color-brand)" }}>
              閉じる
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
              相手と、すでに別の手段で日程が決まっている場合に、その日時で1to1を登録します。相手の回答は待たずに、確定済みとして登録されます。
            </p>

            <div className="space-y-4">
              <OneOnOneEventSelector target="visitor" value={eventCampaignId} onChange={setEventCampaignId} />

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
                  相手の名前<span style={{ color: "var(--color-brand)" }}>　※必須</span>
                </label>
                <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="例：田中 一郎"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border" style={inputStyle} />
              </div>

              {/* 「メールで案内する」のチェックと、メールアドレスの入力欄は、ひとまとまりで表示する */}
              <div className="rounded-xl p-3 space-y-2.5 border" style={{ background: "var(--color-paper-100)", borderColor: "var(--color-paper-300)" }}>
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
                  <input type="checkbox" checked={notifyByEmail} onChange={(e) => setNotifyByEmail(e.target.checked)} className="w-4 h-4 rounded" />
                  📧 相手にメールで案内する
                </label>
                <div>
                  <label htmlFor="guest-prearranged-email" className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
                    メールアドレス{notifyByEmail && <span style={{ color: "var(--color-brand)" }}>　※必須</span>}
                  </label>
                  <input id="guest-prearranged-email" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)}
                    disabled={!notifyByEmail}
                    placeholder={notifyByEmail ? "例：tanaka@example.com" : "メールで通知しないので入力は不要です"}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border disabled:cursor-not-allowed disabled:opacity-60"
                    style={notifyByEmail ? inputStyle : { ...inputStyle, background: "var(--color-paper-200)" }} />
                  <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: "var(--color-ink-400)" }}>
                    {notifyByEmail
                      ? "確定した日時・会議URL・キャンセル用のリンクを、メールでお知らせします。"
                      : "メールは送りません。登録のあとに表示される、日時・会議URL入りの文面を、DMなどでお伝えください。"}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ミーティングのタイトル（任意）</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder={guestName.trim() ? `${guestName.trim()}さんとの1to1` : "例：田中さんとの1to1"}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border" style={inputStyle} />
                <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>カレンダーやZoomの予定名として使われます</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>日付</label>
                  <input type="date" value={date} min={todayYMD()} onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border" style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>開始時刻</label>
                  <div className="flex items-center gap-1.5">
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-sm outline-none border" style={inputStyle} />
                    {/* 終了時刻は所要時間から決まる（直接は編集できない） */}
                    <span className="text-sm shrink-0" style={{ color: "var(--color-ink-500)" }}>〜{time ? addMinutesToTime(time, duration) : "--:--"}</span>
                  </div>
                </div>
              </div>

              <DurationSelect value={duration} onChange={(v) => { durationTouched.current = true; setDuration(v); }} label="所要時間" />

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>会議ツール</label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: googleConnected ? "var(--color-ink-700)" : "var(--color-ink-300)" }}>
                    <input type="radio" checked={conferenceType === "google_meet"} disabled={!googleConnected} onChange={() => setConferenceType("google_meet")} />
                    📅 Google Meet{!googleConnected && "（未連携）"}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: zoomConnected ? "var(--color-ink-700)" : "var(--color-ink-300)" }}>
                    <input type="radio" checked={conferenceType === "zoom"} disabled={!zoomConnected} onChange={() => setConferenceType("zoom")} />
                    🎥 Zoom{!zoomConnected && "（未連携）"}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
                    <input type="radio" checked={conferenceType === "manual"} onChange={() => setConferenceType("manual")} />
                    ✏️ 会議URLを手入力する
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
                    <input type="radio" checked={conferenceType === "none"} onChange={() => setConferenceType("none")} />
                    💬 会議URLなし（対面、または別途連絡）
                  </label>
                </div>
                {conferenceType === "manual" && (
                  <input type="text" value={conferenceUrl} onChange={(e) => setConferenceUrl(e.target.value)} placeholder="https://zoom.us/j/..."
                    className="w-full mt-2 px-3 py-2.5 rounded-xl text-sm outline-none border" style={inputStyle} />
                )}
                {!zoomConnected && !googleConnected && (
                  <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-400)" }}>
                    会議URLを自動発行したい場合は、先に「マイページ→日程調整設定→外部サービス連携」でZoomかGoogleと連携してください。
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メッセージ（任意）</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="例：先日お話しした件でよろしくお願いします"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border resize-none" style={inputStyle} />
              </div>

              {error && (
                <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>
              )}

              <button onClick={() => { setError(""); submit.mutate(); }} disabled={submit.isPending}
                className="w-full py-3.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: "var(--color-brand)" }}>
                {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
                この内容で登録する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
