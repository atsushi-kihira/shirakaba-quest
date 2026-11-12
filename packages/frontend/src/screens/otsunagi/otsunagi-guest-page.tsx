// =============================================================
// お繋ぎ（ご紹介）— 外部の方の受付ページ（ログイン不要）
// URLは、お繋ぎを作った時点で決まり、変わらない。日程の準備の進み具合で、同じURLの中身が変わる。
//   準備中   … メールアドレスを入れてもらい、準備ができたらメールで知らせる（入れなくても、このページを開き直せば、状況がわかる）
//   準備完了 … 日程を選ぶページ（予約ページ／候補日）へ進む
//   確定     … 決まった日時を表示
// =============================================================
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mail } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { fmtDate, fmtRange } from "./_types";

type GuestView = {
  state: "waiting" | "ready" | "confirmed" | "declined" | "cancelled" | "expired";
  guestName: string;
  introducerName: string;
  introducerEmoji: string;
  memberName: string;
  memberEmoji: string;
  memberCategory: string;
  memberBusiness: string;
  message: string;
  emailRegistered: boolean;
  expiresAt: number;
  schedulePath: string | null;
  confirmed: { startAtUtc: string; endAtUtc: string; conferenceType: string; conferenceUrl: string | null; confirmationPath: string } | null;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  const json = await res.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "うまくいきませんでした。少し待ってから、もう一度お試しください。");
  return json.data as T;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OtsunagiGuestPage() {
  const { token } = useParams<{ token: string }>();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading, isError } = useQuery<GuestView>({
    queryKey: ["otsunagi", "guest", token],
    queryFn: () => call<GuestView>(`/otsunagi/public/${token}`),
    enabled: !!token,
    retry: false,
    // 日程を準備している間は、開いたままでも、準備ができたら切り替わるようにする
    refetchInterval: (q) => (q.state.data?.state === "waiting" ? 30_000 : false),
  });

  // 紹介者の進み具合に「相手が開いた」と出すため、ページを開いたことを1度だけ知らせる
  useEffect(() => {
    if (!token) return;
    call(`/otsunagi/public/${token}/open`, { method: "POST", body: "{}" }).catch(() => { /* 記録できなくても、ページの表示には影響しない */ });
  }, [token]);

  const register = useMutation({
    mutationFn: () => call(`/otsunagi/public/${token}/register`, { method: "POST", body: JSON.stringify({ email: email.trim() }) }),
    onSuccess: () => { setError(""); qc.invalidateQueries({ queryKey: ["otsunagi", "guest", token] }); },
    onError: (e) => setError(e instanceof Error ? e.message : "うまくいきませんでした"),
  });

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ background: "var(--color-paper-50)" }}>
      <div className="max-w-lg mx-auto px-4 py-10">{children}
        <p className="text-center text-xs mt-8" style={{ color: "#94A3B8" }}>© 2026 Bizolve Consulting, Inc. All rights reserved.</p>
      </div>
    </div>
  );

  if (isLoading) return shell(<div className="flex justify-center py-16"><Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>);
  if (isError || !data) {
    return shell(
      <div className="text-center py-10">
        <p className="text-4xl mb-4">🔍</p>
        <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>このご案内が見つかりません。お手数ですが、URLをご確認いただくか、ご紹介した方にお問い合わせください。</p>
      </div>
    );
  }

  const d = data;
  const live = d.state === "waiting" || d.state === "ready";

  return shell(
    <>
      <div className="text-center mb-6">
        <p className="text-4xl mb-3">{d.introducerEmoji}</p>
        <h1 className="text-xl font-bold mb-1" style={{ color: "var(--color-ink-900)" }}>{d.introducerName}さんからの、ご紹介です</h1>
        <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>{d.guestName}さん、{d.memberName}さんとの1to1（オンラインの個別面談）を、ご紹介します。</p>
      </div>

      <section className="rounded-2xl p-4 mb-4" style={{ background: "white", border: "1px solid var(--color-paper-300)" }}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">{d.memberEmoji}</span>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--color-ink-900)" }}>{d.memberName}さん</p>
            {d.memberCategory && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{d.memberCategory}</p>}
          </div>
        </div>
        {d.memberBusiness && <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--color-ink-700)" }}>{d.memberBusiness}</p>}
        {d.message && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px dashed var(--color-paper-300)" }}>
            <p className="text-[11px] mb-1" style={{ color: "var(--color-ink-400)" }}>{d.introducerName}さんからのひとこと</p>
            <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--color-ink-800)" }}>{d.message}</p>
          </div>
        )}
      </section>

      {d.state === "waiting" && (
        <section className="rounded-2xl p-4 mb-4" style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.35)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>⏳ {d.memberName}さんが、日程を準備しています</p>
          <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>
            準備ができたら、このページ（同じURL）から、ご都合のよい日時をお選びいただけます。しばらくしてから、もう一度開いてください。
          </p>
        </section>
      )}

      {d.state === "ready" && d.schedulePath && (
        <Link to={d.schedulePath} className="block w-full py-3.5 rounded-2xl text-center text-base font-bold text-white mb-4" style={{ background: "var(--color-brand)" }}>
          📅 日時を選ぶ
        </Link>
      )}

      {d.state === "confirmed" && d.confirmed && (
        <section className="rounded-2xl p-4 mb-4" style={{ background: "rgba(90,140,92,0.12)", border: "1.5px solid var(--color-success)" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "#3D6B3F" }}>✅ 日時が決まりました</p>
          <p className="text-base font-bold mb-2" style={{ color: "var(--color-ink-900)" }}>{fmtRange(d.confirmed.startAtUtc, d.confirmed.endAtUtc)}</p>
          {d.confirmed.conferenceUrl && (
            <p className="text-xs break-all mb-2" style={{ color: "var(--color-ink-700)" }}>
              📹 会議URL：<a href={d.confirmed.conferenceUrl} className="underline" style={{ color: "var(--color-brand)" }} target="_blank" rel="noreferrer">{d.confirmed.conferenceUrl}</a>
            </p>
          )}
          <Link to={d.confirmed.confirmationPath} className="text-xs font-medium underline" style={{ color: "var(--color-brand)" }}>予約の内容を確認する・変更する</Link>
        </section>
      )}

      {d.state === "confirmed" && !d.confirmed && (
        <p className="text-sm text-center mb-4" style={{ color: "var(--color-ink-600)" }}>日時は、すでに決まっています。確認のメールをご覧ください。</p>
      )}
      {d.state === "declined" && (
        <p className="text-sm text-center mb-4" style={{ color: "var(--color-ink-600)" }}>今回は、日程を調整できませんでした。お手数をおかけしました。くわしくは、ご紹介した{d.introducerName}さんにお尋ねください。</p>
      )}
      {d.state === "cancelled" && (
        <p className="text-sm text-center mb-4" style={{ color: "var(--color-ink-600)" }}>このご案内は、無効になりました。ご紹介した{d.introducerName}さんにお尋ねください。</p>
      )}
      {d.state === "expired" && (
        <p className="text-sm text-center mb-4" style={{ color: "var(--color-ink-600)" }}>このご案内の有効期限（{fmtDate(d.expiresAt)}）が切れました。お手数ですが、ご紹介した{d.introducerName}さんに、改めてお尋ねください。</p>
      )}

      {live && (
        d.emailRegistered ? (
          <p className="text-xs text-center flex items-center justify-center gap-1.5" style={{ color: "var(--color-ink-500)" }}>
            <Check size={13} style={{ color: "var(--color-success)" }} />
            メールアドレスは、登録済みです。{d.state === "waiting" ? "日程の準備ができたら、メールでお知らせします。" : ""}
          </p>
        ) : (
          <section className="rounded-2xl p-4" style={{ background: "white", border: "1px solid var(--color-paper-300)" }}>
            <p className="text-sm font-semibold mb-1 flex items-center gap-1.5" style={{ color: "var(--color-ink-800)" }}><Mail size={14} /> メールでお知らせを受け取る</p>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
              メールアドレスを入れておくと、{d.state === "waiting" ? "日程の準備ができたときや、" : ""}日時の確認が必要なときに、お知らせが届きます。入れなくても、このページを開き直せば、状況をご確認いただけます。
            </p>
            <div className="flex gap-2">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="taro@example.com" className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }} />
              <button onClick={() => { if (!EMAIL_RE.test(email.trim())) { setError("メールアドレスの形式が正しくありません"); return; } register.mutate(); }}
                disabled={register.isPending} className="px-4 rounded-xl text-sm font-bold text-white flex items-center gap-1.5 disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                {register.isPending && <Loader2 size={14} className="animate-spin" />}登録
              </button>
            </div>
            {error && <p className="text-xs mt-2" style={{ color: "var(--color-brand)" }}>{error}</p>}
            <p className="text-[11px] mt-2" style={{ color: "var(--color-ink-400)" }}>🔒 会員登録は不要です。このアドレスは、このご案内のためだけに使います。</p>
          </section>
        )
      )}
    </>
  );
}
