// =============================================================
// 「外部の方を1to1に招待」パネル（ビジター向け画面に最初から表示する）
// 日程の決め方（公開予約URL／候補日提示）を選び、メンバー向けの1to1申込と同様に
// 「この内容で申し込む」ボタンを押して申し込む。メールで案内する／しないに関わらず、
// 必ず招待レコードが作成され、送信中の招待（未確定）として一覧に残る。
// - 公開予約URLを選んだ場合、この招待専用の固定URL（申込み後に表示、コピーしても切り替わらない）を発行する。
// - 候補日提示を選んだ場合、メールで案内するなら相手の名前・メールが必須、
//   案内しないなら不要（その場合は相手自身がリンクを開いた際に入力する）。
// =============================================================
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, Copy, Check, ExternalLink, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateTime } from "@/lib/date";
import { SchedulingMethodSelector, type SchedulingMethod } from "./_scheduling-method-selector";
import { OneOnOneEventSelector } from "@/components/oneonone-event-selector";
import { DurationSelect } from "@/components/duration-select";
import { CandidateDateEntry, isValidCandidateSet, candidateRowsToPayload, emptyCandidateRow, type CandidateRow } from "./_candidate-date-entry";

type GuestInviteResult = {
  id: string;
  status: string;
  arrangementMethod: SchedulingMethod;
  inviteUrl: string;
  expiresAt: number;
  guestName: string;
  emailSent: boolean;
};

export type GuestInviteListItem = {
  id: string;
  guestName: string;
  guestEmail: string;
  arrangementMethod: SchedulingMethod;
  status: "pending" | "selected" | "cancelled" | "expired";
  customTitle: string | null;
  createdAt: number;
  expiresAt: number;
  inviteUrl: string | null;
};

export function GuestInvitePanel() {
  const tz = useTimezone();
  const { data: googleStatusData } = useQuery<{ data: { connected: boolean } }>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => api.get("/scheduler/oauth/google/status"),
  });
  const googleConnected = googleStatusData?.data.connected ?? false;
  const qc = useQueryClient();
  const { data: sentInvitesData } = useQuery<{ data: GuestInviteListItem[] }>({
    queryKey: ["oneonone", "guest-invites"],
    queryFn: () => api.get("/oneonone/guest-invites"),
  });
  const pendingInvites = (sentInvitesData?.data ?? []).filter((i) => i.status === "pending" && i.inviteUrl);

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [note, setNote] = useState("");
  const [notifyByEmail, setNotifyByEmail] = useState(true);
  const [schedulingMethod, setSchedulingMethod] = useState<SchedulingMethod>("candidates");
  const didSetDefaultMethod = useRef(false);
  useEffect(() => {
    if (didSetDefaultMethod.current || googleStatusData === undefined) return;
    didSetDefaultMethod.current = true;
    setSchedulingMethod(googleStatusData.data.connected ? "public_url" : "candidates");
  }, [googleStatusData]);
  const [candidateRows, setCandidateRows] = useState<CandidateRow[]>([emptyCandidateRow(), emptyCandidateRow()]);
  const [error, setError] = useState("");
  const [eventCampaignId, setEventCampaignId] = useState("");
  const [duration, setDuration] = useState(60);
  const [submitResult, setSubmitResult] = useState<GuestInviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  const submitMutation = useMutation({
    mutationFn: () => api.post<{ data: GuestInviteResult }>("/oneonone/guest-invites", {
      guestName: guestName.trim() || undefined,
      guestEmail: guestEmail.trim() || undefined,
      note: note.trim() || undefined,
      notifyByEmail,
      arrangementMethod: schedulingMethod,
      candidateSlots: schedulingMethod === "candidates" ? candidateRowsToPayload(candidateRows, duration) : undefined,
      durationMinutes: duration,
      eventCampaignId: eventCampaignId || undefined,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["oneonone", "guest-invites"] });
      setSubmitResult(res.data);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  // 公開予約URL方式は、招待専用の固定URLを発行するため、メール案内の有無に関わらず
  // 誰宛のURLかを予約ページに表示できるよう名前を必須にする
  const nameRequired = schedulingMethod === "public_url" || notifyByEmail;
  const emailRequired = notifyByEmail;
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const nameValid = !nameRequired || !!guestName.trim();
  const emailValid = !emailRequired || emailRe.test(guestEmail.trim());
  const candidatesFilledCount = candidateRows.filter((r) => r.date).length;
  const canSubmit = schedulingMethod === "public_url"
    ? nameValid && emailValid
    : isValidCandidateSet(candidateRows) && nameValid && emailValid;

  function handleSubmit() {
    setError("");
    if (schedulingMethod === "candidates" && !isValidCandidateSet(candidateRows)) {
      setError("候補日時を2〜5件、正しく入力してください（終了時刻は開始時刻より後にしてください）");
      return;
    }
    if (nameRequired && !guestName.trim()) {
      setError("招待する相手のお名前を入力してください");
      return;
    }
    if (emailRequired && !emailValid) {
      setError("メールで案内する場合は、相手のメールアドレスを正しく入力してください");
      return;
    }
    submitMutation.mutate();
  }

  function handleCopy() {
    if (!submitResult) return;
    navigator.clipboard.writeText(submitResult.inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function resetToForm() {
    setSubmitResult(null);
    setGuestName("");
    setGuestEmail("");
    setNote("");
    setCandidateRows([emptyCandidateRow(), emptyCandidateRow()]);
  }

  if (submitResult) {
    const isPublicUrl = submitResult.arrangementMethod === "public_url";
    return (
      <div className="space-y-4">
        <div className="card-paper rounded-2xl p-4 space-y-3">
          <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
            <UserPlus size={16} />
            {isPublicUrl ? "1to1の申込みが完了しました" : "招待リンクを発行しました"}
          </p>
          {submitResult.emailSent && (
            <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)" }}>
              ✅ {submitResult.guestName || "相手"}さんにメールでも案内を送信しました
            </p>
          )}
          <div className="space-y-2">
            <p className="text-xs break-all px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>
              {submitResult.inviteUrl}
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-ink-400)" }}>
              ⚠️ このURLは{submitResult.guestName ? `${submitResult.guestName}様` : "招待した相手"}専用です。他の方には転送しないでください。
              <br />
              有効期限：{fmtDateTime(submitResult.expiresAt, tz)}まで
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                style={{ background: copied ? "var(--color-success)" : "var(--color-paper-200)", color: copied ? "white" : "var(--color-ink-600)" }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "コピーしました" : "URLをコピー"}
              </button>
              <a
                href={submitResult.inviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                <ExternalLink size={13} />
                開く
              </a>
            </div>
          </div>
          <button onClick={resetToForm} className="text-xs font-medium" style={{ color: "var(--color-ink-400)" }}>
            別の招待を作成する →
          </button>
        </div>
        <PendingGuestInvitesList invites={pendingInvites} excludeId={submitResult.id} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PendingGuestInvitesList invites={pendingInvites} />

      <div className="card-paper rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: "var(--color-ink-800)" }}>
          <UserPlus size={16} />
          外部の方を1to1に招待
        </p>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            招待する相手の名前{nameRequired && <span style={{ color: "var(--color-brand)" }}>　※必須</span>}
          </label>
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="例：田中 一郎"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            メールアドレス{emailRequired && <span style={{ color: "var(--color-brand)" }}>　※必須</span>}
          </label>
          <input
            type="email"
            value={guestEmail}
            onChange={(e) => setGuestEmail(e.target.value)}
            placeholder="例：tanaka@example.com"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
          />
          {!emailRequired && (
            <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
              未入力でも申し込めます（相手がリンクを開いた際に入力してもらいます）
            </p>
          )}
        </div>

        <OneOnOneEventSelector target="visitor" value={eventCampaignId} onChange={setEventCampaignId} />

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>日程の決め方</label>
          <SchedulingMethodSelector method={schedulingMethod} onChange={setSchedulingMethod} googleConnected={googleConnected} copy="guest" />
        </div>

        {schedulingMethod === "public_url" ? (
          <p className="text-xs px-3 py-2.5 rounded-xl" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-500)" }}>
            🔗 公開予約URLは、この内容で申込みを行ったのちに表示されます。
          </p>
        ) : (
          <>
            <DurationSelect value={duration} onChange={setDuration} />
            <CandidateDateEntry candidates={candidateRows} onChange={setCandidateRows} googleConnected={googleConnected} duration={duration} />
          </>
        )}

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メッセージ（任意）</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="例：先日お話しした件でよろしくお願いします"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border resize-none"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-600)" }}>
          <input type="checkbox" checked={notifyByEmail} onChange={(e) => setNotifyByEmail(e.target.checked)} className="w-4 h-4 rounded" />
          📧 相手にメールで案内する
        </label>

        {error && (
          <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitMutation.isPending || !canSubmit}
          className="w-full py-3.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}
        >
          {submitMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          {schedulingMethod === "candidates"
            ? `この${candidatesFilledCount}件の候補で申し込む`
            : "この内容で申し込む"}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// 送信済みの招待（未確定分）を一覧表示する。招待作成直後の画面を離れてしまっても、
// あとから招待URLをコピーしてDM等で送り直せるようにするため。
// 不要になった招待は個別に、またはまとめて削除できる。
// ----------------------------------------------------------------
export function PendingGuestInvitesList({ invites, excludeId }: { invites: GuestInviteListItem[]; excludeId?: string }) {
  const qc = useQueryClient();
  const visible = invites.filter((i) => i.id !== excludeId);

  const deleteAllMutation = useMutation({
    mutationFn: (notify: boolean) => api.delete("/oneonone/guest-invites", { notify }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oneonone", "guest-invites"] }),
  });

  function handleDeleteAll() {
    if (!confirm("未確定の招待をすべて削除しますか？")) return;
    const hasEmail = visible.some((i) => i.guestEmail);
    const notify = hasEmail && confirm("メールアドレスが分かっている招待について、キャンセルの通知メールを送りますか？");
    deleteAllMutation.mutate(notify);
  }

  if (visible.length === 0) return null;

  return (
    <div className="card-paper rounded-2xl p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: "var(--color-ink-800)" }}>
          <Mail size={15} />
          送信中の招待（未確定）
        </p>
        {visible.length > 1 && (
          <button
            onClick={handleDeleteAll}
            disabled={deleteAllMutation.isPending}
            className="text-xs font-medium disabled:opacity-50"
            style={{ color: "var(--color-ink-400)" }}
          >
            {deleteAllMutation.isPending ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}
            すべて削除
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((invite) => (
          <PendingGuestInviteRow key={invite.id} invite={invite} />
        ))}
      </div>
    </div>
  );
}

function PendingGuestInviteRow({ invite }: { invite: GuestInviteListItem }) {
  const qc = useQueryClient();
  const tz = useTimezone();
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!invite.inviteUrl) return;
    navigator.clipboard.writeText(invite.inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  const deleteMutation = useMutation({
    mutationFn: (notify: boolean) => api.delete(`/oneonone/guest-invites/${invite.id}`, { notify }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oneonone", "guest-invites"] }),
  });
  function handleDelete() {
    if (!confirm("この招待を削除しますか？")) return;
    const notify = !!invite.guestEmail && confirm(`${invite.guestName || "ゲスト"}様（${invite.guestEmail}）に、この招待をキャンセルした旨をメールで通知しますか？`);
    deleteMutation.mutate(notify);
  }
  return (
    <div className="rounded-xl p-2.5 space-y-1.5" style={{ background: "var(--color-paper-100)" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--color-ink-700)" }}>
            {invite.guestName || "（名前未設定のゲスト）"}
            <span className="ml-1.5 font-normal" style={{ color: "var(--color-ink-400)" }}>
              {invite.arrangementMethod === "candidates" ? "候補日提示" : "公開予約URL"}
            </span>
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--color-ink-400)" }}>
            {fmtDateTime(invite.createdAt, tz)} 発行
          </p>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="text-[11px] font-medium shrink-0 disabled:opacity-50"
          style={{ color: "var(--color-brand)" }}
        >
          削除
        </button>
      </div>
      <p className="text-[11px] break-all" style={{ color: "var(--color-ink-500)" }}>{invite.inviteUrl}</p>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-ink-400)" }}>
        ⚠️ このURLは{invite.guestName ? `${invite.guestName}様` : "招待した相手"}専用です。他の方には転送しないでください。
        <br />
        有効期限：{fmtDateTime(invite.expiresAt, tz)}まで
      </p>
      <div className="flex gap-1.5">
        <button
          onClick={handleCopy}
          className="flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: copied ? "var(--color-success)" : "var(--color-paper-200)", color: copied ? "white" : "var(--color-ink-600)" }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "コピーしました" : "URLをコピー"}
        </button>
        {invite.inviteUrl && (
          <a
            href={invite.inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          >
            <ExternalLink size={12} />
            開く
          </a>
        )}
      </div>
    </div>
  );
}
