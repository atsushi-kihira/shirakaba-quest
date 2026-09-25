// =============================================================
// 1to1（日程指定申込）のメール経由 確認/辞退ページ
// /oneonone/respond/:token — 認証不要・公開ページ
// 承認という操作は廃止済み。日時指定申込は最初から確定しており、
// このページは内容の確認と、都合が悪い場合の辞退だけを行う。
// =============================================================
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Check, X, AlertCircle, Link2, User, Building2, Briefcase, Mail } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { API_BASE_URL } from "@/lib/api";
import { fmtDateTime, fmtDateTimeFull, fmtTime } from "@/lib/date";

type CandidateSlot = { id: string; startAt: number; endAt: number };

type RespondData = {
  status: "pending" | "accepted" | "completed" | "rejected" | "cancelled";
  requesterName: string;
  requesterEmoji: string;
  responderName: string;
  responderCompany: string | null;
  responderRole: string | null;
  responderCategory: string | null;
  responderEmail: string | null;
  arrangementMethod: "public_url" | "candidates";
  scheduledFor: number | null;
  conferenceType: string | null;
  conferenceUrl: string | null;
  candidateSlots: CandidateSlot[];
  availableConferenceTypes: ("google_meet" | "zoom")[];
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
  const [submitting, setSubmitting] = useState<"reject" | "select" | null>(null);
  const [resultStatus, setResultStatus] = useState<"accepted" | "rejected" | null>(null);
  const [resultScheduledFor, setResultScheduledFor] = useState<number | null>(null);
  const [resultConference, setResultConference] = useState<{ type: string | null; url: string | null } | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [conferenceType, setConferenceType] = useState<"google_meet" | "zoom" | undefined>(undefined);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE_URL}/oneonone/public/${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setError(json.error.message); return; }
        setData(json.data);
        setSelectedCandidateId(json.data.candidateSlots?.[0]?.id ?? "");
      })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [token]);

  async function decline() {
    setSubmitting("reject");
    try {
      const r = await fetch(`${API_BASE_URL}/oneonone/public/${token}/reject`, { method: "POST" });
      const json = await r.json();
      if (!r.ok) { setError(json.error?.message ?? "送信に失敗しました"); return; }
      setResultStatus("rejected");
    } catch {
      setError("送信に失敗しました");
    } finally {
      setSubmitting(null);
    }
  }

  async function selectCandidate() {
    if (!selectedCandidateId) return;
    setSubmitting("select");
    try {
      const r = await fetch(`${API_BASE_URL}/oneonone/public/${token}/select-candidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateSlotId: selectedCandidateId,
          conferenceType: (data?.availableConferenceTypes.length ?? 0) >= 2 ? (conferenceType ?? defaultConferenceType) : undefined,
        }),
      });
      const json = await r.json();
      if (!r.ok) { setError(json.error?.message ?? "送信に失敗しました"); return; }
      setResultScheduledFor(json.data.scheduledFor ?? null);
      setResultConference({ type: json.data.conferenceType ?? null, url: json.data.conferenceUrl ?? null });
      setResultStatus("accepted");
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
  const availTypes = d.availableConferenceTypes ?? [];
  const defaultConferenceType = availTypes.includes("zoom") ? "zoom" : availTypes[0];

  if (resultStatus) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--color-paper-100)" }}>
        <div className="text-5xl mb-4">{resultStatus === "accepted" ? "🎉" : "🙏"}</div>
        <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          {resultStatus === "accepted" ? "承諾しました！" : "辞退しました"}
        </h2>
        {resultScheduledFor && (
          <p className="text-sm font-medium mb-2" style={{ color: "var(--color-ink-800)" }}>
            {fmtDateTime(resultScheduledFor, timezone)}
          </p>
        )}
        {resultConference?.url && (
          <a
            href={resultConference.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium underline underline-offset-2 flex items-center justify-center gap-1.5 break-all mb-2"
            style={{ color: "var(--color-brand)" }}
          >
            <Link2 size={14} className="shrink-0" />
            {resultConference.type === "zoom" ? "Zoom" : "Google Meet"}: {resultConference.url}
          </a>
        )}
        <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
          {resultStatus === "accepted"
            ? `${d.requesterName}さんに通知されます。当日はよろしくお願いします。`
            : `${d.requesterName}さんに通知されます。`}
        </p>
      </div>
    );
  }

  // 承認という操作は廃止済み。日時指定申込は最初から accepted で作成されるため、
  // 「まだ処理されていない」の判定はステータスが確定系（rejected/cancelled/completed）で
  // ないかどうかで行う。候補日提示方式で、まだ誰も候補を選んでいない場合のみ pending になる。
  const isTerminal = d.status === "rejected" || d.status === "cancelled" || d.status === "completed";
  const needsCandidatePicker = d.status === "pending" && d.arrangementMethod === "candidates" && d.candidateSlots.length > 0;

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

        <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--color-paper-200)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>
            この申込の宛先（あなたの登録情報です）
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-800)" }}>
              <User size={14} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
              <span className="font-medium">{d.responderName}</span>
            </div>
            {d.responderCompany && (
              <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-700)" }}>
                <Building2 size={14} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
                <span>{d.responderCompany}</span>
              </div>
            )}
            {(d.responderRole || d.responderCategory) && (
              <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-700)" }}>
                <Briefcase size={14} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
                <span>{[d.responderRole, d.responderCategory].filter(Boolean).join(" ・ ")}</span>
              </div>
            )}
            {d.responderEmail && (
              <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-700)" }}>
                <Mail size={14} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
                <span className="break-all">{d.responderEmail}</span>
              </div>
            )}
          </div>
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

          {isTerminal ? (
            <p className="text-sm text-center py-3" style={{ color: "var(--color-ink-500)" }}>
              この申込はすでに「{STATUS_LABEL[d.status] ?? d.status}」として処理されています。
            </p>
          ) : needsCandidatePicker ? (
            <>
              <p className="text-sm pt-2" style={{ color: "var(--color-ink-700)" }}>
                提示された候補から、ご都合の良い日時をお選びください。
              </p>
              <div className="space-y-1.5">
                {d.candidateSlots.map((slot) => {
                  const selected = slot.id === selectedCandidateId;
                  return (
                    <label
                      key={slot.id}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition"
                      style={{
                        border: selected ? "1.5px solid var(--color-brand)" : "1.5px solid var(--color-paper-300)",
                        background: "#fff",
                      }}
                    >
                      <input type="radio" checked={selected} onChange={() => setSelectedCandidateId(slot.id)} className="sr-only" />
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ border: selected ? "4px solid var(--color-brand)" : "2px solid var(--color-paper-300)" }}
                      />
                      <span className="text-sm" style={{ color: "var(--color-ink-800)", fontWeight: selected ? 700 : 400 }}>
                        {fmtDateTimeFull(slot.startAt, timezone)}〜{fmtTime(slot.endAt, timezone)}
                      </span>
                    </label>
                  );
                })}
              </div>

              {/* 会議ツール選択（2種類連携時のみ、選ぶ側が選択する） */}
              {availTypes.length >= 2 && (
                <div>
                  <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>会議ツール</p>
                  <div className="space-y-1.5">
                    {availTypes.map((t) => (
                      <label key={t} className="flex items-center gap-2.5 cursor-pointer">
                        <input type="radio" name="conferenceType" checked={(conferenceType ?? defaultConferenceType) === t} onChange={() => setConferenceType(t)} />
                        <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
                          {t === "google_meet" ? "📹 Google Meet" : "📹 Zoom"}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {availTypes.length === 1 && (
                <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                  📹 {availTypes[0] === "google_meet" ? "Google Meet" : "Zoom"} のURLが自動発行されます
                </p>
              )}
              {availTypes.length === 0 && (
                <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                  📞 会議URLは{d.requesterName}さんから別途ご連絡します
                </p>
              )}

              <button
                onClick={selectCandidate}
                disabled={submitting !== null || !selectedCandidateId}
                className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "var(--color-success)" }}
              >
                {submitting === "select" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                この日時で確定する
              </button>
            </>
          ) : (
            <>
              <p className="text-sm pt-2 flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
                <Check size={14} className="shrink-0" />
                この日時で予定が確定しています。当日はよろしくお願いします。
              </p>
              <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                都合が悪くなった場合のみ、下のボタンから辞退してください。
              </p>
              <button
                onClick={decline}
                disabled={submitting !== null}
                className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                {submitting === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                辞退する
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
