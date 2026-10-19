// =============================================================
// 「対応が必要なこと」の集計フック
// ホーム・ミーティング・協働などのメニューに出る通知バッジの元になっている出来事を、1か所にまとめる。
// 通知画面の一覧・「通知」メニューのバッジ・ミーティング画面の「対応が必要なこと」で共通利用する。
// （各メニューのバッジと同じ判定関数・同じデータを使うので、件数と内容がずれない）
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { useOneOnOneSessions, filterInFlightOneOnOneForBadge } from "@/hooks/use-oneonone-status";
import { useMeetingAlerts } from "@/hooks/use-meeting-alerts";
import { useCollabAlerts } from "@/hooks/use-collab-alerts";
import { useGuestFollowups, usePendingExternalOneOnOneCount } from "@/hooks/use-guest-followups";
import { meetingNotifDefaultMessage, meetingNotifIcon } from "@/lib/meeting-notification-text";

export type ActionItemGroup = "oneonone" | "meeting" | "collab";

export type ActionItem = {
  key: string;
  group: ActionItemGroup;
  icon: string;
  title: string;
  detail?: string;
  /** タップしたときの移動先 */
  to: string;
  /** 目立たせる（承諾待ちなど、相手が待っているもの） */
  urgent?: boolean;
  /** 「通知」メニューのバッジに数える件数（協働の新着のように、複数件をまとめた項目は1より大きい） */
  weight: number;
};

type ReactionNotification = { id: string; reactionType: string; message: string; reactor: { name: string } };
type IntroRequest = { id: string; status: "pending" | "handled"; message: string | null; contactName: string; requester: { name: string } | null };
type ConferenceReminder = { id: string; kind: "one_on_one" | "booking"; partnerName: string };

const REACTION_LABEL: Record<string, string> = { shokai: "紹介できそう", join: "私も参加したい" };

export function useActionItems(): { items: ActionItem[]; count: number } {
  const user = useAuthStore((s) => s.user);
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
  const { data: conferenceData } = useQuery({
    queryKey: ["oneonone", "conference-reminders"],
    queryFn: () => api.get<{ data: ConferenceReminder[] }>("/oneonone/conference-reminders"),
    enabled: isMember,
    staleTime: 30_000,
  });

  const items: ActionItem[] = [];

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
  for (const n of meetingAlerts.notifications) {
    items.push({
      key: `meeting-notif-${n.id}`, group: "meeting", icon: meetingNotifIcon(n.type), weight: 1,
      title: n.message ?? meetingNotifDefaultMessage(n.type),
      to: `/meetings/${n.meetingId}`,
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

  return { items, count: items.reduce((sum, it) => sum + it.weight, 0) };
}
