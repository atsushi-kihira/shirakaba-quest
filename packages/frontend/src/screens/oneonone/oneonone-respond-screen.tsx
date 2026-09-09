// =============================================================
// 1to1（日程指定申込）のメール経由 承諾/辞退ページ
// /oneonone/respond/:token — 認証不要・公開ページ
// =============================================================
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Check, X, AlertCircle, Link2 } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { API_BASE_URL } from "@/lib/api";
import { fmtDateTime } from "@/lib/date";

type RespondData = {
  status: "pending" | "accepted" | "completed" | "rejected" | "cancelled";
  requesterName: string;
  requesterEmoji: string;
  responderName: string;
  scheduledFor: number | null;
  conferenceType: string | null;
  conferenceUrl: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "未回答",
  accepted: "承諾済み",
  completed: "完了",
  rejected: "辞退済み",
  cancelled: "キャンセル済み",
};

export function OneOnOneRespondScreen() {
  const { token } = useParams<{ token: string }>();
  const { appTitle, timezone } = useSettings();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<RespondData | null>(null);
  const [submitting, setSubmitting] = useState<"accept" | "reject" | null>(null);
  const [resultStatus, setResultStatus] = useState<"accepted" | "rejected" | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE_URL}/oneonone/public/${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setError(json.error.message); return; }
        setData(json.data);
      })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [token]);

  async function respond(action: "accept" | "reject") {
    setSubmitting(action);
    try {
      const r = await fetch(`${API_BASE_URL}/oneonone/public/${token}/${action}`, { method: "POST" });
      const json = await r.json();
      if (!r.ok) { setError(json.error?.message ?? "送信に失敗しました"); return; }
      setResultStatus(json.data.status === "accepted" ? "accepted" : "rejected");
    } catch {
      setError("送信に失敗しました");
    } finally {
      setSubmitting(null);
    }
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
        <p className="text-sm mt-2" style={{ color: "var(--color-ink-400)" }}>URLが無効か、既に処理されています</p>
      </div>
    );
  }

  const d = data!;
  const conferenceLabel = d.conferenceType === "zoom" ? "Zoom" : d.conferenceType === "google_meet" ? "Google Meet" : null;

  if (resultStatus) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--color-paper-100)" }}>
        <div className="text-5xl mb-4">{resultStatus === "accepted" ? "🎉" : "🙏"}</div>
        <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          {resultStatus === "accepted" ? "承諾しました！" : "辞退しました"}
        </h2>
        <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
          {resultStatus === "accepted"
            ? `${d.requesterName}さんに通知されます。当日はよろしくお願いします。`
            : `${d.requesterName}さんに通知されます。`}
        </p>
      </div>
    );
  }

  const alreadyResolved = d.status !== "pending";

  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100)" }}>
      <div className="px-4 py-6 pb-24 max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="text-3xl mb-1">🤝</div>
          <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>{appTitle} · 1to1の申込</p>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {d.requesterEmoji} {d.requesterName}さんから1to1の申込
          </h1>
        </div>

        <div className="card-paper rounded-3xl p-5 space-y-3">
          {d.scheduledFor && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>▼ 日時</p>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                {fmtDateTime(d.scheduledFor, timezone)}
              </p>
            </div>
          )}
          {d.conferenceUrl && conferenceLabel && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>▼ 会議URL</p>
              <a
                href={d.conferenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium underline underline-offset-2 flex items-center gap-1.5 break-all"
                style={{ color: "var(--color-brand)" }}
              >
                <Link2 size={14} className="shrink-0" />
                {conferenceLabel}: {d.conferenceUrl}
              </a>
            </div>
          )}

          {alreadyResolved ? (
            <p className="text-sm text-center py-3" style={{ color: "var(--color-ink-500)" }}>
              この申込はすでに「{STATUS_LABEL[d.status] ?? d.status}」として処理されています。
            </p>
          ) : (
            <>
              <p className="text-sm pt-2" style={{ color: "var(--color-ink-700)" }}>
                この内容でよろしければ「承諾する」を、都合が合わなければ「断る」を選んでください。
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => respond("reject")}
                  disabled={submitting !== null}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                >
                  {submitting === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  断る
                </button>
                <button
                  onClick={() => respond("accept")}
                  disabled={submitting !== null}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                  style={{ background: "var(--color-success)" }}
                >
                  {submitting === "accept" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  承諾する
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
