// =============================================================
// 外部ゲスト向け 定例会の日程回答画面（認証不要・公開ページ）
//   /schedule/series/:token                 … ゲスト専用ページ（投票中は候補パターンへの回答、確定後は開催日の一覧）
//   /schedule/series-invite/:inviteToken    … 共有URL（名前・メールアドレスを入れて回答すると、専用ページができる）
// =============================================================
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Check, Clock, Link as LinkIcon, Loader2 } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { API_BASE_URL } from "@/lib/api";
import { fmtDateTime } from "@/lib/date";

type Availability = "yes" | "maybe" | "no";
type Respondent = { name: string; availability: Availability };
type Candidate = {
  id: string; note: string | null; isConfirmed: boolean; label: string;
  upcomingDates: { startsAt: number; endsAt: number }[]; respondents: Respondent[];
};
type View = {
  inviteeName: string; inviteeEmail: string | null;
  series: { id: string; title: string; description: string | null; status: string; host: { id: string; name: string; emoji: string } | null };
  candidates: Candidate[];
  myAnswers: Record<string, Availability>;
  occurrences: { startsAt: number; endsAt: number | null; conferenceUrl: string | null }[];
};

const AVAIL_OPTIONS: Array<{ value: Availability; label: string; text: string; color: string; bg: string }> = [
  { value: "yes", label: "○", text: "参加できる", color: "var(--color-success)", bg: "rgba(90,140,92,0.15)" },
  { value: "maybe", label: "△", text: "未定・調整中", color: "#D4A03B", bg: "rgba(212,160,59,0.15)" },
  { value: "no", label: "×", text: "参加できない", color: "var(--color-ink-400)", bg: "var(--color-paper-200)" },
];
const inputStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;

export function ScheduleSeriesScreen() {
  const { token } = useParams<{ token: string }>();
  return <SeriesGuestPage mode="personal" token={token ?? ""} />;
}
export function ScheduleSeriesInviteScreen() {
  const { inviteToken } = useParams<{ inviteToken: string }>();
  return <SeriesGuestPage mode="shared" token={inviteToken ?? ""} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen" style={{ background: "var(--color-paper-100)" }}>{children}</div>;
}

function SeriesGuestPage({ mode, token }: { mode: "personal" | "shared"; token: string }) {
  const { appTitle, timezone } = useSettings();
  const base = mode === "personal" ? `${API_BASE_URL}/schedule/series/${token}` : `${API_BASE_URL}/schedule/series-invite/${token}`;

  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, Availability>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(base)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setProblem({ code: json.error.code, message: json.error.message }); return; }
        const v = json.data as View;
        setView(v);
        setName(v.inviteeName);
        setEmail(v.inviteeEmail ?? "");
        setAnswers(v.myAnswers);
      })
      .catch(() => setProblem({ code: "load_failed", message: "読み込みに失敗しました" }))
      .finally(() => setLoading(false));
  }, [base, token]);

  async function submit() {
    if (!view) return;
    if (!name.trim()) { setSubmitError("お名前を入力してください"); return; }
    if (!email.trim()) { setSubmitError("メールアドレスを入力してください"); return; }
    if (view.candidates.some((c) => !answers[c.id])) { setSubmitError("すべての候補に回答してください"); return; }
    setSubmitError(""); setSubmitting(true);
    try {
      const r = await fetch(`${base}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), answers }),
      });
      const json = await r.json();
      if (!r.ok) { setSubmitError(json.error?.message ?? "送信に失敗しました"); return; }
      setDone({ url: json.scheduleUrl ?? "" });
    } catch {
      setSubmitError("送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <Shell><div className="min-h-screen flex items-center justify-center"><Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div></Shell>;
  }
  if (problem || !view) {
    const preparing = problem?.code === "preparing";
    return (
      <Shell>
        <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
          {preparing ? <Clock size={40} className="mb-3" style={{ color: "var(--color-accent)" }} /> : <AlertCircle size={40} className="mb-3" style={{ color: "var(--color-brand)" }} />}
          <p className="font-medium" style={{ color: "var(--color-ink-700)" }}>{problem?.message ?? "読み込みに失敗しました"}</p>
          {!preparing && <p className="text-sm mt-2" style={{ color: "var(--color-ink-400)" }}>URLが無効か、すでに締め切られています</p>}
        </div>
      </Shell>
    );
  }

  const { series } = view;
  if (done) {
    return (
      <Shell>
        <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>回答を送信しました！</h2>
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>主催者が日程を確定したら、メールでお知らせします</p>
          {done.url && (
            <div className="mt-6 card-paper rounded-3xl p-5 max-w-sm w-full text-left space-y-3">
              <p className="font-medium text-sm" style={{ color: "var(--color-ink-800)" }}>{series.title}</p>
              <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>📌 あなた専用のページURL（回答の変更・確定後の日程の確認に使えます）</p>
              <div className="flex items-center gap-2 p-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
                <p className="flex-1 text-xs break-all" style={{ color: "var(--color-ink-500)" }}>{done.url}</p>
                <button onClick={() => navigator.clipboard.writeText(done.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium"
                  style={{ background: copied ? "var(--color-success)" : "var(--color-brand)", color: "white" }}>
                  <LinkIcon size={12} />{copied ? "コピー済" : "コピー"}
                </button>
              </div>
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>※ 登録したメールアドレスにもURLをお送りしました</p>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  const voting = series.status === "voting";
  return (
    <Shell>
      <div className="px-4 py-6 pb-24 max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="text-3xl mb-1">🔁</div>
          <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>{appTitle} · 定例会の日程調整</p>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>{series.title}</h1>
          {series.host && <p className="text-sm mt-1" style={{ color: "var(--color-ink-500)" }}>{series.host.emoji} {series.host.name}さんから招待されています</p>}
          {series.description && <p className="text-sm mt-2 px-2" style={{ color: "var(--color-ink-600)" }}>{series.description}</p>}
        </div>

        {!voting ? (
          <div className="space-y-3">
            <div className="p-3 rounded-2xl text-center text-sm" style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}>
              ✅ {series.status === "cancelled" ? "この定例会は中止されました" : "日程が確定しました"}
            </div>
            {view.occurrences.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>開催日（全{view.occurrences.length}回）</p>
                {view.occurrences.map((o, i) => (
                  <div key={i} className="card-paper rounded-2xl px-4 py-2.5">
                    <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                      {fmtDateTime(o.startsAt, timezone)}{o.endsAt ? `〜${fmtDateTime(o.endsAt, timezone).split(" ")[1] ?? ""}` : ""}
                    </p>
                    {o.conferenceUrl && <p className="text-xs mt-0.5 break-all" style={{ color: "var(--color-ink-500)" }}>📹 {o.conferenceUrl}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>お名前 <span style={{ color: "var(--color-brand)" }}>*</span></label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="山田 太郎" className="w-full px-4 py-3 rounded-2xl text-sm outline-none border" style={inputStyle} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>メールアドレス <span style={{ color: "var(--color-brand)" }}>*</span></label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="yamada@example.com" className="w-full px-4 py-3 rounded-2xl text-sm outline-none border" style={inputStyle} />
              <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>日程が確定したら、お知らせします。あなた専用のページURLも送ります。</p>
            </div>

            <div>
              <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-700)" }}>開催パターンの候補への参加可否をお選びください</p>
              <div className="flex gap-3 text-xs mb-3 flex-wrap">
                {AVAIL_OPTIONS.map((o) => <span key={o.value} style={{ color: o.color }}>{o.label} = {o.text}</span>)}
              </div>
              <div className="space-y-2">
                {view.candidates.map((cand) => (
                  <div key={cand.id} className="card-paper rounded-2xl px-4 py-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>{cand.label}</p>
                        {cand.note && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{cand.note}</p>}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {AVAIL_OPTIONS.map((o) => {
                          const av = answers[cand.id];
                          return (
                            <button key={o.value} onClick={() => setAnswers((p) => ({ ...p, [cand.id]: o.value }))}
                              className="w-10 h-10 rounded-xl text-base font-bold transition"
                              style={{
                                background: av === o.value ? o.bg : "var(--color-paper-200)", color: av === o.value ? o.color : "var(--color-ink-300)",
                                border: av === o.value ? `1.5px solid ${o.color}` : "1.5px solid transparent",
                              }}>
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {cand.upcomingDates.length > 0 && (
                      <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                        直近の開催日：{cand.upcomingDates.slice(0, 4).map((d) => fmtDateTime(d.startsAt, timezone).split(" ")[0]).join("、")} ほか
                      </p>
                    )}
                    {cand.respondents.length > 0 && (
                      <div className="space-y-0.5">
                        {AVAIL_OPTIONS.map((o) => {
                          const names = cand.respondents.filter((r) => r.availability === o.value).map((r) => r.name);
                          return names.length > 0 ? <p key={o.value} className="text-xs" style={{ color: o.color }}>{o.label} {names.join("、")}</p> : null;
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {submitError && <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{submitError}</p>}
            <button onClick={submit} disabled={submitting}
              className="w-full py-4 rounded-2xl text-base font-medium text-white flex items-center justify-center gap-2 transition disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}回答を送信する
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}
