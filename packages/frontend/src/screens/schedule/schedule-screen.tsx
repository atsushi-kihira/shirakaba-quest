// =============================================================
// 外部ゲスト向け日程回答画面（認証不要・公開ページ）
// /schedule/:token
// =============================================================
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Check, AlertCircle, Link } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { API_BASE_URL } from "@/lib/api";
import { fmtDateTime } from "@/lib/date";

type Availability = "yes" | "maybe" | "no";
type Candidate = { id: string; startsAt: number; endsAt: number | null; note: string | null };
type ApiResponse = {
  data: {
    inviteeId: string;
    inviteeName: string;
    inviteeEmail: string | null;
    meeting: {
      id: string; title: string; description: string | null; status: string;
      confirmedCandidateId: string | null;
      host: { id: string; name: string; emoji: string } | null;
    };
    candidates: Candidate[];
    myAnswers: Record<string, Availability>;
  };
};

const AVAIL_OPTIONS: Array<{ value: Availability; label: string; color: string; bg: string }> = [
  { value: "yes",   label: "○", color: "var(--color-success)", bg: "rgba(90,140,92,0.15)" },
  { value: "maybe", label: "△", color: "#D4A03B",              bg: "rgba(212,160,59,0.15)" },
  { value: "no",    label: "×", color: "var(--color-ink-400)", bg: "var(--color-paper-200)" },
];

function formatDate(ts: number, endsAt: number | null, tz: string): string {
  const start = fmtDateTime(ts, tz);
  if (endsAt) return `${start}〜${fmtDateTime(endsAt, tz).split(" ")[1] ?? ""}`;
  return start;
}

export function ScheduleScreen() {
  const { token } = useParams<{ token: string }>();
  const { appTitle, timezone } = useSettings();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [apiData, setApiData] = useState<ApiResponse["data"] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, Availability>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [scheduleUrl, setScheduleUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE_URL}/schedule/${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setError(json.error.message); return; }
        setApiData(json.data);
        setName(json.data.inviteeName || "");
        setEmail(json.data.inviteeEmail || "");
        setAnswers(json.data.myAnswers || {});
      })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [token]);

  function setAnswer(candidateId: string, value: Availability) {
    setAnswers((prev) => ({ ...prev, [candidateId]: value }));
  }

  async function handleSubmit() {
    if (!name.trim()) { setSubmitError("お名前を入力してください"); return; }
    if (!email.trim()) { setSubmitError("メールアドレスを入力してください"); return; }
    const unanswered = (apiData?.candidates ?? []).filter((c) => !answers[c.id]);
    if (unanswered.length > 0) { setSubmitError("すべての候補日に回答してください"); return; }
    setSubmitError("");
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE_URL}/schedule/${token}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), answers }),
      });
      const json = await r.json();
      if (!r.ok) { setSubmitError(json.error?.message ?? "送信に失敗しました"); return; }
      setScheduleUrl(json.scheduleUrl ?? window.location.href);
      setSubmitted(true);
    } catch {
      setSubmitError("送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopy() {
    const url = scheduleUrl || window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-paper-100)" }}>
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--color-paper-100)" }}>
        <AlertCircle size={40} className="mb-3" style={{ color: "var(--color-brand)" }} />
        <p className="font-medium" style={{ color: "var(--color-ink-700)" }}>{error}</p>
        <p className="text-sm mt-2" style={{ color: "var(--color-ink-400)" }}>URLが無効か、既に期限切れです</p>
      </div>
    );
  }

  const meeting = apiData!.meeting;
  const candidates = apiData!.candidates;

  if (submitted) {
    const url = scheduleUrl || window.location.href;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--color-paper-100)" }}>
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          回答を送信しました！
        </h2>
        <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
          主催者が日程を確定したらメールでお知らせします
        </p>

        {/* ブックマークURLセクション */}
        <div className="mt-6 card-paper rounded-3xl p-5 max-w-sm w-full text-left space-y-3">
          <p className="font-medium text-sm" style={{ color: "var(--color-ink-800)" }}>{meeting.title}</p>
          {meeting.host && (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
              {meeting.host.emoji} {meeting.host.name}さん主催
            </p>
          )}
          <div className="border-t pt-3" style={{ borderColor: "var(--color-paper-300)" }}>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-600)" }}>
              📌 このページのURL（後から回答変更・確定確認に使えます）
            </p>
            <div className="flex items-center gap-2 p-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
              <p className="flex-1 text-xs break-all" style={{ color: "var(--color-ink-500)" }}>{url}</p>
              <button
                onClick={handleCopy}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition"
                style={{
                  background: copied ? "var(--color-success)" : "var(--color-brand)",
                  color: "white",
                }}
              >
                <Link size={12} />
                {copied ? "コピー済" : "コピー"}
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--color-ink-400)" }}>
              ※ 登録したメールアドレスにもURLをお送りしました
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100)" }}>
      <div className="px-4 py-6 pb-24 max-w-lg mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-6">
          <div className="text-3xl mb-1">📅</div>
          <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>{appTitle} · 日程調整</p>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {meeting.title}
          </h1>
          {meeting.host && (
            <p className="text-sm mt-1" style={{ color: "var(--color-ink-500)" }}>
              {meeting.host.emoji} {meeting.host.name}さんから招待されています
            </p>
          )}
          {meeting.description && (
            <p className="text-sm mt-2 px-2" style={{ color: "var(--color-ink-600)" }}>{meeting.description}</p>
          )}
        </div>

        {meeting.status !== "open" && (
          <div className="mb-4 p-3 rounded-2xl text-center text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
            このミーティングの回答受付は終了しています
          </div>
        )}

        <div className="space-y-5">
          {/* お名前 */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
              お名前 <span style={{ color: "var(--color-brand)" }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
              disabled={meeting.status !== "open"}
              className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
              style={{
                background: "var(--color-paper-50)",
                borderColor: "var(--color-paper-300)",
                color: "var(--color-ink-900)",
              }}
            />
          </div>

          {/* メールアドレス */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
              メールアドレス <span style={{ color: "var(--color-brand)" }}>*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="yamada@example.com"
              disabled={meeting.status !== "open"}
              className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
              style={{
                background: "var(--color-paper-50)",
                borderColor: "var(--color-paper-300)",
                color: "var(--color-ink-900)",
              }}
            />
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              日程確定時にお知らせします。ページURLも送付します。
            </p>
          </div>

          {/* 候補日回答 */}
          <div>
            <p className="text-sm font-medium mb-3" style={{ color: "var(--color-ink-700)" }}>
              各候補日への参加可否をお選びください
            </p>
            <div className="flex gap-2 text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
              {AVAIL_OPTIONS.map((o) => (
                <span key={o.value} style={{ color: o.color }}>
                  {o.label} = {o.value === "yes" ? "参加できる" : o.value === "maybe" ? "未定・調整中" : "参加できない"}
                </span>
              ))}
            </div>
            <div className="space-y-2">
              {candidates.map((cand) => {
                const av = answers[cand.id];
                return (
                  <div key={cand.id} className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                        {formatDate(cand.startsAt, cand.endsAt, timezone)}
                      </p>
                      {cand.note && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{cand.note}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {AVAIL_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => meeting.status === "open" && setAnswer(cand.id, o.value)}
                          disabled={meeting.status !== "open"}
                          className="w-10 h-10 rounded-xl text-base font-bold transition"
                          style={{
                            background: av === o.value ? o.bg : "var(--color-paper-200)",
                            color: av === o.value ? o.color : "var(--color-ink-300)",
                            border: av === o.value ? `1.5px solid ${o.color}` : "1.5px solid transparent",
                          }}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {submitError && (
            <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
              {submitError}
            </p>
          )}

          {meeting.status === "open" && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-4 rounded-2xl text-base font-medium text-white flex items-center justify-center gap-2 transition disabled:opacity-50"
              style={{ background: "var(--color-brand)" }}
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              回答を送信する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
