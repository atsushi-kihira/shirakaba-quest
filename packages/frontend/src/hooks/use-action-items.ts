// =============================================================
// 「対応が必要なこと」の集計フック
// ホーム・ミーティング・協働などのメニューに出る通知バッジの元になっている出来事を、1か所にまとめる。
// 通知画面の一覧・「通知」メニューのバッジ・ミーティング画面の「対応が必要なこと」で共通利用する。
// （各メニューのバッジと同じ判定関数・同じデータを使うので、件数と内容がずれない）
// =============================================================
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { useOneOnOneSessions, filterInFlightOneOnOneForBadge } from "@/hooks/use-oneonone-status";
import { useMeetingAlerts } from "@/hooks/use-meeting-alerts";
import { useCollabAlerts } from "@/hooks/use-collab-alerts";
import { useGuestFollowups, usePendingExternalOneOnOneCount } from "@/hooks/use-guest-followups";
import { meetingNotifDefaultMessage, meetingNotifIcon } from "@/lib/meeting-notification-text";
import { useReminderNotices } from "@/hooks/use-reminder-notices";

export type ActionItemGroup = "reminder" | "oneonone" | "meeting" | "collab";

export type ActionItem = {
  key: string;
  group: ActionItemGroup;
  icon: string;
  title: string;
  detail?: string;
  /** タップしたときの移動先 */
  to: string;
  /** タップしたときに、移動の前に行う処理（リマインドを既読にする、など） */
  onOpen?: () => void;
  /** 目立たせる（承諾待ちなど、相手が待っているもの） */
  urgent?: boolean;
  /** 「通知」メニューのバッジに数える件数（協働の新着のように、複数件をまとめた項目は1より大きい） */
  weight: number;
};

type ReactionNotification = { id: string; reactionType: string; message: string; reactor: { name: string } };
type IntroRequest = { id: string; status: "pending" | "handled"; message: string | null; contactName: string; requester: { name: string } | null };
type ConferenceReminder = { id: string; kind: "one_on_one" | "booking"; partnerName: string };
type SummaryIssue = { id: string; name: string };
type PendingReview = { partnerId: string; name: string; emoji: string };
type HostingSummary = { id: string; title: string; candidateCount: number; targetCount: number; respondedCount: number };

const REACTION_LABEL: Record<string, string> = { shokai: "紹介できそう", join: "私も参加したい" };

export function useActionItems(): { items: ActionItem[]; count: number } {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const isMember = !!user && user.userType === "member";

  const { data: oneOnOneData } = useOneOnOneSessions();
  const meetingAlerts = useMeetingAlerts();
  const collabAlerts = useCollabAlerts();
  const { data: guestFollowupsData } = useGuestFollowups();
  const pendingExternal = usePendingExternalOneOnOneCount();

  const { data: reactionData } = useQuery({
    queryKey: ["collab", "reaction-notifications"],
    queryFn: () => api.get<{ data: ReactionNotification[] }>("/collab/reaction-notifications"),
    enabled: !!user,
    staleTime: 30_000,
  });
  const { data: introData } = useQuery({
    queryKey: ["collab", "contacts", "intro-requests"],
    queryFn: () => api.get<{ data: IntroRequest[] }>("/collab/contacts/intro-requests"),
    enabled: isMember,
    staleTime: 30_000,
  });
  const { data: teamTodoData } = useQuery({
    queryKey: ["collab", "workspace-todos"],
    queryFn: () => api.get<{ data: { key: string; icon: string; title: string; detail?: string; to: string; urgent?: boolean }[] }>("/collab/workspace/todos"),
    enabled: isMember,
    staleTime: 30_000,
  });
  const { data: conferenceData } = useQuery({
    queryKey: ["oneonone", "conference-reminders"],
    queryFn: () => api.get<{ data: ConferenceReminder[] }>("/oneonone/conference-reminders"),
    enabled: isMember,
    staleTime: 30_000,
  });

  const { data: summaryIssueData } = useQuery({
    queryKey: ["collab", "contacts", "summary-issues"],
    queryFn: () => api.get<{ data: SummaryIssue[] }>("/collab/contacts/summary-issues"),
    enabled: isMember,
    staleTime: 30_000,
  });
  const { data: pendingReviewData } = useQuery({
    queryKey: ["collab", "pending-confirmations"],
    queryFn: () => api.get<{ data: PendingReview[] }>("/collab/pending-confirmations"),
    enabled: isMember,
    staleTime: 30_000,
  });
  const { data: hostingOpenData } = useQuery({
    queryKey: ["meetings", "hosting-open-summary"],
    queryFn: () => api.get<{ data: HostingSummary[] }>("/meetings/hosting-open-summary"),
    enabled: !!user,
    staleTime: 30_000,
  });
  const { data: hostingSeriesData } = useQuery({
    queryKey: ["meeting-series", "hosting-voting-summary"],
    queryFn: () => api.get<{ data: HostingSummary[] }>("/meeting-series/hosting-voting-summary"),
    enabled: !!user,
    staleTime: 30_000,
  });
  const { notices: reminders, markRead: markReminderRead } = useReminderNotices();

  const items: ActionItem[] = [];

  // ---- 予定のリマインド（ホーム画面にも出るもの。どちらで確認しても既読になる） ----
  for (const r of reminders) {
    items.push({
      key: `reminder-${r.id}`, group: "reminder", icon: "⏰", weight: 1,
      title: r.title.replace(/^⏰\s*/, ""),
      detail: r.body,
      to: r.linkPath ?? "/home",
      onOpen: () => markReminderRead(r.id),
    });
  }

  // ---- 1to1 ----
  for (const s of filterInFlightOneOnOneForBadge(oneOnOneData?.data ?? [])) {
    const name = `${s.partner?.emoji ?? ""} ${s.partner?.name ?? "メンバー"}さん`.trim();
    if (s.status === "pending") {
      const needsPick = s.arrangementMethod === "candidates" && !s.selectedCandidateSlotId && (s.candidates?.length ?? 0) > 0;
      items.push({
        key: `oneonone-${s.id}`, group: "oneonone", icon: "🤝", urgent: true, weight: 1,
        title: `${name}から1to1の申込が届いています`,
        detail: needsPick ? "候補日の中から、都合のよい日時を選んでください" : "承諾するか、お断りするかを選んでください",
        to: "/meetings?tab=oneonone",
      });
    } else {
      const myDone = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
      const partnerDone = s.myRole === "requester" ? s.responderCompletedAt : s.requesterCompletedAt;
      if (!myDone) {
        items.push({
          key: `oneonone-${s.id}`, group: "oneonone", icon: "✅", weight: 1,
          title: `${name}との1to1`,
          detail: partnerDone ? "相手が完了を記録しました。あなたも完了ボタンを押してポイントを受け取りましょう" : "実施したら、完了を記録してください",
          to: "/meetings?tab=oneonone",
        });
      }
    }
  }

  // 外部ゲストとの1to1（人脈に追加するかどうかの確認待ち／未決着）
  const followups = guestFollowupsData?.data ?? [];
  for (const g of followups) {
    items.push({
      key: `guest-${g.id}`, group: "oneonone", icon: "🌱", weight: 1,
      title: `${g.guestName}さん（外部ゲスト）との1to1が終わりました`,
      detail: "人脈に追加するかどうかを選んでください",
      to: "/home",
    });
  }
  const restExternal = Math.max(0, pendingExternal - followups.length);
  if (restExternal > 0) {
    items.push({
      key: "guest-pending", group: "oneonone", icon: "🌱", weight: restExternal,
      title: `外部ゲストとの1to1が${restExternal}件、進行中です`,
      detail: "日程や完了の状況を確認してください",
      to: "/meetings?tab=oneonone",
    });
  }

  // 会議URLが未設定の1to1・予約
  for (const r of conferenceData?.data ?? []) {
    items.push({
      key: `conference-${r.id}`, group: "oneonone", icon: "🔗", weight: 1,
      title: `${r.partnerName}さんとの${r.kind === "one_on_one" ? "1to1" : "予約"}の会議URLが未設定です`,
      detail: "タップして会議URLを入力・確認してください",
      to: r.kind === "one_on_one" ? "/home" : `/scheduler/bookings/${r.id}`,
    });
  }

  // 1to1のあとの振り返り（協業の可能性・リファーラル・コメント）が未記録の相手
  for (const p of pendingReviewData?.data ?? []) {
    items.push({
      key: `review-${p.partnerId}`, group: "oneonone", icon: "🔔", weight: 1,
      title: `${p.emoji} ${p.name}さんとの1to1の振り返りをお願いします`,
      detail: "協業の可能性・リファーラルの可能性を、ホーム画面で記録できます",
      to: "/home",
    });
  }

  // ---- ミーティング・定例会 ----
  for (const m of meetingAlerts.pendingAttendances) {
    items.push({
      key: `attendance-${m.id}`, group: "meeting", icon: "📝", weight: 1,
      title: `「${m.title}」の出席状況を記録してください`,
      to: `/meetings/${m.id}`,
    });
  }
  for (const m of meetingAlerts.pendingMeetings) {
    items.push({
      key: `meeting-${m.id}`, group: "meeting", icon: "🗓️", urgent: true, weight: 1,
      title: `「${m.title}」の日程回答をお願いします`,
      detail: m.host ? `${m.host.emoji} ${m.host.name}さん主催` : undefined,
      to: `/meetings/${m.id}`,
    });
  }
  for (const s of meetingAlerts.pendingSeries) {
    items.push({
      key: `series-${s.id}`, group: "meeting", icon: "🔁", urgent: true, weight: 1,
      title: `定例会「${s.title}」の候補パターンへの回答をお願いします`,
      detail: s.host ? `${s.host.emoji} ${s.host.name}さん主催` : undefined,
      to: `/meetings/series/${s.id}`,
    });
  }
  for (const m of hostingOpenData?.data ?? []) {
    items.push({
      key: `hosting-${m.id}`, group: "meeting", icon: "📅", weight: 1,
      title: `主催中の「${m.title}」の日程が、まだ確定していません`,
      detail: `回答 ${m.respondedCount}/${m.targetCount}件 ・ 候補日${m.candidateCount}件`,
      to: `/meetings/${m.id}`,
    });
  }
  for (const s of hostingSeriesData?.data ?? []) {
    items.push({
      key: `hosting-series-${s.id}`, group: "meeting", icon: "🔁", weight: 1,
      title: `主催中の定例会「${s.title}」の日程が、まだ確定していません`,
      detail: `回答 ${s.respondedCount}/${s.targetCount}件 ・ 候補パターン${s.candidateCount}件`,
      to: `/meetings/series/${s.id}`,
    });
  }
  for (const n of meetingAlerts.notifications) {
    items.push({
      key: `meeting-notif-${n.id}`, group: "meeting", icon: meetingNotifIcon(n.type), weight: 1,
      title: n.message ?? meetingNotifDefaultMessage(n.type),
      to: `/meetings/${n.meetingId}`,
      // 通知画面から開いたときも、ホーム画面と同じように既読にする
      onOpen: () => {
        api.post(`/meetings/${n.meetingId}/read-notifications`, {})
          .then(() => qc.invalidateQueries({ queryKey: ["meetings"] }))
          .catch(() => undefined);
      },
    });
  }

  // ---- 協働・人脈 ----
  if (collabAlerts.total > 0) {
    const parts = [
      collabAlerts.timeline > 0 ? `活動タイムライン ${collabAlerts.timeline}件` : null,
      collabAlerts.stories > 0 ? `シェアストーリー ${collabAlerts.stories}件` : null,
    ].filter(Boolean);
    items.push({
      key: "collab-new", group: "collab", icon: "🤝", weight: collabAlerts.total,
      title: "協働に新着があります",
      detail: parts.join("・") || undefined,
      to: "/collab",
    });
  }
  for (const n of reactionData?.data ?? []) {
    items.push({
      key: `reaction-${n.id}`, group: "collab", icon: "💬", weight: 1,
      title: `${n.reactor.name}さんから「${REACTION_LABEL[n.reactionType] ?? "リアクション"}」`,
      detail: n.message,
      to: "/home",
      onOpen: () => {
        api.post(`/collab/reaction-notifications/${n.id}/read`)
          .then(() => qc.invalidateQueries({ queryKey: ["collab", "reaction-notifications"] }))
          .catch(() => undefined);
      },
    });
  }
  const issues = summaryIssueData?.data ?? [];
  if (issues.length > 0) {
    items.push({
      key: "summary-issues", group: "collab", icon: "🏢", weight: 1,
      title: `${issues.length}件の人脈で会社概要を生成できませんでした`,
      detail: `${issues.slice(0, 3).map((x) => x.name).join("、")}${issues.length > 3 ? " など" : ""}。会社名などを修正してください`,
      to: "/members?tab=contacts&summaryIssues=1",
    });
  }
  for (const r of (introData?.data ?? []).filter((x) => x.status === "pending")) {
    items.push({
      key: `intro-${r.id}`, group: "collab", icon: "📇", weight: 1,
      title: `${r.requester?.name ?? "メンバー"}さんから、${r.contactName}さんの紹介依頼が届いています`,
      detail: r.message ?? undefined,
      to: "/members?tab=contacts",
    });
  }

  // チームのお知らせ（プロフィールの入力・確認、AI再検討の結果の確認、役割の承認、参加希望、アクションの期限）
  for (const t of teamTodoData?.data ?? []) {
    items.push({ key: t.key, group: "collab", icon: t.icon, title: t.title, detail: t.detail, to: t.to, urgent: t.urgent, weight: 1 });
  }

  // ゲストユーザー（承認されていないメンバー）には、1to1の自分に向けたもの以外は出さない（ミーティング・協働などは、メンバー向け）
  const visible = isApprovedMember(user) ? items : items.filter((it) => it.group === "oneonone");
  return { items: visible, count: visible.reduce((sum, it) => sum + it.weight, 0) };
}
