// =============================================================
// 外部ゲスト（非会員）との1to1（公開予約URL経由）— ミーティング画面「1to1ミーティング」タブ用
// メンバー同士の1to1（oneOnOneSessions）とは別の記録（bookings）なので、専用セクションで表示する。
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Trash2, Pencil, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { AddContactFromBookingModal } from "@/components/add-contact-from-booking-modal";
import { EditBookingScheduleModal } from "./_edit-booking-schedule-modal";

type ExternalBooking = {
  id: string;
  guestName: string;
  guestCompany: string | null;
  startAtUtc: string;
  endAtUtc: string;
  status: string;
  conferenceUrl: string | null;
  guestMemberId: string | null;
  oneOnOneSessionId: string | null;
  isExternalGuest: boolean;
  externalContactId: string | null;
  guestFollowupDismissedAt: string | null;
  guestFollowupOutcome: "not_held" | "no_add" | null;
  createdAt: string;
};

function fmtDate(utcStr: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short",
  }).format(new Date(utcStr));
}

// 「確定日時」表示用：日付＋曜日＋開始〜終了時刻（例: 9月4日(金) 17:30〜18:30）
function fmtDateTimeRange(startUtc: string, endUtc: string): string {
  const start = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(startUtc));
  const end = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit",
  }).format(new Date(endUtc));
  return `${start}〜${end}`;
}

// 「申込日」表示用（メンバー向けの表示と揃える。例: 2026/9/2）
function fmtCreatedDate(utcStr: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric",
  }).format(new Date(utcStr));
}

export function ExternalGuestOneOnOneSection() {
  const qc = useQueryClient();
  const { termExternalGuest } = useSettings();
  const [addContactTarget, setAddContactTarget] = useState<ExternalBooking | null>(null);
  const [editingBooking, setEditingBooking] = useState<ExternalBooking | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // 「1to1 完了を記録する」ボタンで、実施時刻を待たずに手動で完了確認（人脈追加確認）へ進めた予約
  const [manuallyCompleted, setManuallyCompleted] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["scheduler", "bookings"],
    queryFn: () => api.get<{ data: ExternalBooking[] }>("/scheduler/bookings"),
  });

  const dismissMutation = useMutation({
    mutationFn: ({ bookingId, outcome }: { bookingId: string; outcome: "not_held" | "no_add" }) =>
      api.patch(`/scheduler/bookings/${bookingId}/dismiss-followup`, { outcome }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduler", "bookings"] });
    },
  });

  // メンバー同士の1to1と同様、確定済みの予定は先にキャンセル（ゲストへの通知・カレンダー整理）してから
  // 記録を削除する
  const removeMutation = useMutation({
    mutationFn: async (b: ExternalBooking) => {
      if (b.status === "confirmed") {
        await api.post(`/scheduler/bookings/${b.id}/cancel`);
      }
      await api.delete(`/scheduler/bookings/${b.id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduler", "bookings"] });
    },
  });

  const nowMs = Date.now();
  // 真の外部ゲストの予約のみ（在籍中メンバーとの予約や、内部の1to1に紐づく予約は除外）
  const external = (data?.data ?? []).filter((b) => b.isExternalGuest && !b.oneOnOneSessionId);

  const needsAction = external.filter((b) =>
    b.status === "confirmed" && !b.externalContactId && !b.guestFollowupDismissedAt
    && (new Date(b.endAtUtc).getTime() <= nowMs || manuallyCompleted.has(b.id))
  );
  const upcoming = external.filter((b) =>
    b.status === "confirmed" && new Date(b.endAtUtc).getTime() > nowMs && !manuallyCompleted.has(b.id)
  );
  const history = external
    .filter((b) => !needsAction.includes(b) && !upcoming.includes(b))
    .sort((a, b) => new Date(b.startAtUtc).getTime() - new Date(a.startAtUtc).getTime());

  if (isLoading || external.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>🌐 {termExternalGuest}との1to1</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
        公開予約URLで日程調整した、会員ではない{termExternalGuest}との1to1です。
      </p>

      {needsAction.length > 0 && (
        <div className="space-y-2 mb-3">
          {needsAction.map((b) => (
            <div key={b.id} className="px-3 py-2.5 rounded-2xl" style={{ background: "rgba(181,56,75,0.08)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                {b.guestName}さん（{fmtDate(b.startAtUtc)}）
              </p>
              <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>
                {new Date(b.endAtUtc).getTime() <= nowMs
                  ? "実施予定時刻を過ぎています。1to1は完了しましたか？"
                  : "1to1は完了しましたか？"}
              </p>
              <div className="space-y-1.5">
                <button onClick={() => setAddContactTarget(b)}
                  className="w-full py-2 rounded-2xl text-xs font-medium text-white"
                  style={{ background: "var(--color-brand)" }}>
                  完了・人脈に追加する
                </button>
                <div className="flex gap-2">
                  <button onClick={() => dismissMutation.mutate({ bookingId: b.id, outcome: "not_held" })}
                    disabled={dismissMutation.isPending}
                    className="flex-1 py-2 rounded-2xl text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                    実施せず
                  </button>
                  <button onClick={() => dismissMutation.mutate({ bookingId: b.id, outcome: "no_add" })}
                    disabled={dismissMutation.isPending}
                    className="flex-1 py-2 rounded-2xl text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                    完了・今回は追加しない
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-2 mb-3">
          {upcoming.map((b) => (
            <div key={b.id} className="px-3 py-2.5 rounded-2xl" style={{ background: "rgba(212,160,59,0.1)" }}>
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center text-lg shrink-0 bg-stone-200">
                  🙂
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                    {b.guestName}さん
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                    🤝 進行中（完了待ち） ・ {fmtCreatedDate(b.createdAt)}申込
                  </p>
                  <p className="text-xs mt-0.5 font-medium" style={{ color: "var(--color-success)" }}>
                    📅 確定日時: {fmtDateTimeRange(b.startAtUtc, b.endAtUtc)}
                  </p>
                  {b.conferenceUrl && (
                    <a href={b.conferenceUrl} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs mt-0.5 font-medium underline underline-offset-2 block truncate"
                      style={{ color: "var(--color-brand)" }}>
                      🔗 会議URL: {b.conferenceUrl}
                    </a>
                  )}
                  <button
                    onClick={() => setEditingBooking(b)}
                    className="text-xs mt-1 flex items-center gap-1"
                    style={{ color: "var(--color-ink-400)" }}
                  >
                    <Pencil size={11} />
                    日時・会議URLを編集
                  </button>
                  <Link to={`/scheduler/bookings/${b.id}`}
                    className="text-xs mt-1 flex items-center gap-0.5" style={{ color: "var(--color-ink-400)" }}>
                    予約詳細を見る<ChevronRight size={12} />
                  </Link>
                </div>
                <button
                  onClick={() => { if (confirm("この1to1予定を削除しますか？")) removeMutation.mutate(b); }}
                  disabled={removeMutation.isPending}
                  className="p-2 rounded-xl active:opacity-70 transition disabled:opacity-40"
                  style={{ color: "var(--color-ink-400)" }}
                  aria-label="削除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <button
                onClick={() => setManuallyCompleted((prev) => new Set(prev).add(b.id))}
                className="w-full mt-2 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2"
                style={{ background: "var(--color-brand)" }}
              >
                <Check size={14} />
                1to1 完了を記録する
              </button>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <button onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>
            <ChevronDown size={13} style={{ transform: showHistory ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
            過去の記録（{history.length}件）
          </button>
          {showHistory && (
            <div className="space-y-2">
              {history.map((b) => (
                <Link key={b.id} to={`/scheduler/bookings/${b.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl transition active:opacity-80"
                  style={{ background: "var(--color-paper-200)" }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{b.guestName}さん</p>
                    <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                      {fmtDate(b.startAtUtc)}
                      {b.status === "cancelled" ? "・キャンセル済み" : b.externalContactId ? "・人脈登録済み" : b.guestFollowupOutcome === "not_held" ? "・実施せず" : b.guestFollowupDismissedAt ? "・追加しない を選択" : ""}
                    </p>
                  </div>
                  <ChevronRight size={14} style={{ color: "var(--color-ink-400)" }} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {addContactTarget && (
        <AddContactFromBookingModal
          bookingId={addContactTarget.id}
          guestName={addContactTarget.guestName}
          guestCompany={addContactTarget.guestCompany}
          onClose={() => setAddContactTarget(null)}
        />
      )}

      {editingBooking && (
        <EditBookingScheduleModal
          bookingId={editingBooking.id}
          currentStartAtUtc={editingBooking.startAtUtc}
          currentEndAtUtc={editingBooking.endAtUtc}
          currentConferenceUrl={editingBooking.conferenceUrl}
          onClose={() => setEditingBooking(null)}
        />
      )}
    </div>
  );
}
