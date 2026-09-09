// =============================================================
// メンバーの完全削除（管理画面の「削除」ボタン用）
// 「休会」（旧・停止）とは異なり、メンバー行そのものと、そのメンバー自身の
// データを全テーブルからカスケード削除し、メールアドレスを再登録可能な状態に戻す。
//
// 他のメンバーも関わる共有データ（そのメンバーが作成したチーム・イベントキャンペーン等）は
// 作成者が消えても存続させたいため削除しない。そのメンバーが主催者になっているミーティング・
// 定例会は、他の参加者の記録を守るため削除ではなくキャンセル扱いにする。
// =============================================================
import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { cancelAutoConference, type AutoConferenceEnv } from "./conferenceService.ts";

export async function hardDeleteMember(db: Db, env: AutoConferenceEnv, memberId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const m = schema;

  // ---- 予約(bookings)とその子テーブル ----
  const bookingRows = await db.select({ id: m.bookings.id })
    .from(m.bookings)
    .where(or(eq(m.bookings.hostMemberId, memberId), eq(m.bookings.guestMemberId, memberId)))
    .all();
  const bookingIds = bookingRows.map((r) => r.id);
  if (bookingIds.length > 0) {
    await db.delete(m.bookingEvents).where(inArray(m.bookingEvents.bookingId, bookingIds));
    await db.delete(m.reminderJobs).where(inArray(m.reminderJobs.bookingId, bookingIds));
    await db.delete(m.bookings).where(inArray(m.bookings.id, bookingIds));
  }

  // ---- 1to1（申込・承諾フロー）----
  await db.delete(m.oneOnOneSessions)
    .where(or(eq(m.oneOnOneSessions.requesterId, memberId), eq(m.oneOnOneSessions.responderId, memberId)));

  // ---- なかま関係（Connection）----
  await db.delete(m.connections)
    .where(or(eq(m.connections.fromMemberId, memberId), eq(m.connections.toMemberId, memberId)));

  // ---- 協働マップのリンク ----
  await db.delete(m.collaborationLinks)
    .where(or(eq(m.collaborationLinks.memberLowId, memberId), eq(m.collaborationLinks.memberHighId, memberId)));

  // ---- 協働の投稿（本人が作成した投稿は、寄せられた反応・コメントごと削除）----
  const ownPostRows = await db.select({ id: m.collaborationPosts.id })
    .from(m.collaborationPosts).where(eq(m.collaborationPosts.authorId, memberId)).all();
  const ownPostIds = ownPostRows.map((r) => r.id);
  if (ownPostIds.length > 0) {
    const postCommentRows = await db.select({ id: m.collaborationComments.id })
      .from(m.collaborationComments).where(inArray(m.collaborationComments.postId, ownPostIds)).all();
    const postCommentIds = postCommentRows.map((r) => r.id);
    if (postCommentIds.length > 0) {
      await db.delete(m.collaborationCommentReactions).where(inArray(m.collaborationCommentReactions.commentId, postCommentIds));
    }
    await db.delete(m.collaborationComments).where(inArray(m.collaborationComments.postId, ownPostIds));
    await db.delete(m.collaborationPostReactions).where(inArray(m.collaborationPostReactions.postId, ownPostIds));
    await db.delete(m.collaborationPostMembers).where(inArray(m.collaborationPostMembers.postId, ownPostIds));
    await db.delete(m.collaborationPosts).where(inArray(m.collaborationPosts.id, ownPostIds));
  }
  // 本人が他人の投稿に残した反応・コメント（コメントへの反応も含む）
  const ownCommentRows = await db.select({ id: m.collaborationComments.id })
    .from(m.collaborationComments).where(eq(m.collaborationComments.authorId, memberId)).all();
  const ownCommentIds = ownCommentRows.map((r) => r.id);
  if (ownCommentIds.length > 0) {
    await db.delete(m.collaborationCommentReactions).where(inArray(m.collaborationCommentReactions.commentId, ownCommentIds));
  }
  await db.delete(m.collaborationComments).where(eq(m.collaborationComments.authorId, memberId));
  await db.delete(m.collaborationCommentReactions).where(eq(m.collaborationCommentReactions.memberId, memberId));
  await db.delete(m.collaborationPostReactions).where(eq(m.collaborationPostReactions.memberId, memberId));
  await db.delete(m.collaborationPostMembers).where(eq(m.collaborationPostMembers.memberId, memberId));
  await db.delete(m.collabActivityReads).where(eq(m.collabActivityReads.memberId, memberId));
  await db.delete(m.collabReactionNotifications)
    .where(or(eq(m.collabReactionNotifications.reactorId, memberId), eq(m.collabReactionNotifications.memberId, memberId)));

  // ---- シェアストーリー ----
  const ownStoryRows = await db.select({ id: m.shareStories.id })
    .from(m.shareStories).where(eq(m.shareStories.authorId, memberId)).all();
  const ownStoryIds = ownStoryRows.map((r) => r.id);
  if (ownStoryIds.length > 0) {
    await db.delete(m.shareStoryAttachments).where(inArray(m.shareStoryAttachments.storyId, ownStoryIds));
    await db.delete(m.shareStoryMembers).where(inArray(m.shareStoryMembers.storyId, ownStoryIds));
    await db.delete(m.shareStories).where(inArray(m.shareStories.id, ownStoryIds));
  }
  await db.delete(m.shareStoryMembers).where(eq(m.shareStoryMembers.memberId, memberId));

  // ---- 外部人脈（連絡先情報は元々保持しない設計）----
  const ownContactRows = await db.select({ id: m.externalContacts.id })
    .from(m.externalContacts).where(eq(m.externalContacts.ownerMemberId, memberId)).all();
  const ownContactIds = ownContactRows.map((r) => r.id);
  if (ownContactIds.length > 0) {
    await db.delete(m.externalContactFavorites).where(inArray(m.externalContactFavorites.contactId, ownContactIds));
    await db.delete(m.externalContactRelationships).where(inArray(m.externalContactRelationships.contactId, ownContactIds));
    await db.delete(m.collabIntroRequests).where(inArray(m.collabIntroRequests.contactId, ownContactIds));
    await db.delete(m.externalContacts).where(inArray(m.externalContacts.id, ownContactIds));
  }
  await db.delete(m.externalContactFavorites).where(eq(m.externalContactFavorites.memberId, memberId));
  await db.delete(m.collabIntroRequests)
    .where(or(eq(m.collabIntroRequests.ownerMemberId, memberId), eq(m.collabIntroRequests.requesterId, memberId)));

  // ---- ご縁さがし（金の卵・ガチョウ・検索履歴）----
  await db.delete(m.goldenEggs).where(eq(m.goldenEggs.memberId, memberId));
  await db.delete(m.goldenGeese).where(eq(m.goldenGeese.memberId, memberId));
  await db.delete(m.enishiSearchHistory).where(eq(m.enishiSearchHistory.memberId, memberId));
  await db.delete(m.enishiTransactedContacts).where(eq(m.enishiTransactedContacts.memberId, memberId));
  await db.delete(m.enishiHiddenContacts).where(eq(m.enishiHiddenContacts.memberId, memberId));
  await db.delete(m.enishiIntroducedContacts).where(eq(m.enishiIntroducedContacts.memberId, memberId));

  // ---- 認証・ロール ----
  await db.delete(m.authSessions).where(eq(m.authSessions.userId, memberId));
  await db.delete(m.memberRoles).where(eq(m.memberRoles.memberId, memberId));

  // ---- クエスト・ポイント ----
  await db.delete(m.questAttempts).where(eq(m.questAttempts.memberId, memberId));
  await db.delete(m.questWeeklySelections).where(eq(m.questWeeklySelections.memberId, memberId));
  await db.delete(m.pointTransactions).where(eq(m.pointTransactions.memberId, memberId));
  await db.delete(m.seasonRankings).where(eq(m.seasonRankings.memberId, memberId));
  await db.delete(m.memberBadges).where(eq(m.memberBadges.memberId, memberId));

  // ---- ギルド・チーム（本人の所属だけ外す。ギルド／チーム自体は残す）----
  await db.delete(m.teamMembers).where(eq(m.teamMembers.memberId, memberId));
  await db.delete(m.collabTeamMembers).where(eq(m.collabTeamMembers.memberId, memberId));

  // ---- イベント参加（本人分の参加ログ・参加記録。加えて、本人だけを対象にした
  //      歓迎クエスト等（related_member_id が本人）のキャンペーン自体も削除）----
  const ownCampaignRows = await db.select({ id: m.eventCampaigns.id })
    .from(m.eventCampaigns).where(eq(m.eventCampaigns.relatedMemberId, memberId)).all();
  const ownCampaignIds = ownCampaignRows.map((r) => r.id);
  if (ownCampaignIds.length > 0) {
    await db.delete(m.eventActionLogs).where(inArray(m.eventActionLogs.eventCampaignId, ownCampaignIds));
    await db.delete(m.eventParticipations).where(inArray(m.eventParticipations.eventCampaignId, ownCampaignIds));
    await db.delete(m.eventCampaigns).where(inArray(m.eventCampaigns.id, ownCampaignIds));
  }
  await db.delete(m.eventActionLogs).where(eq(m.eventActionLogs.memberId, memberId));
  await db.delete(m.eventParticipations).where(eq(m.eventParticipations.memberId, memberId));
  await db.delete(m.visitorInvites).where(eq(m.visitorInvites.memberId, memberId));

  // ---- ミーティング（本人主催分は、他の参加者の記録を守るためキャンセル扱いに留める）----
  const hostedMeetings = await db.select({
    id: m.meetings.id, conferenceType: m.meetings.conferenceType,
    conferenceMetaJson: m.meetings.conferenceMetaJson, calendarEventId: m.meetings.calendarEventId,
  }).from(m.meetings)
    .where(and(eq(m.meetings.hostMemberId, memberId), ne(m.meetings.status, "cancelled")))
    .all();
  if (hostedMeetings.length > 0) {
    await db.update(m.meetings).set({ status: "cancelled", updatedAt: now })
      .where(inArray(m.meetings.id, hostedMeetings.map((r) => r.id)));
    for (const mt of hostedMeetings) {
      if (mt.conferenceType === "zoom" || mt.conferenceType === "google_meet") {
        await cancelAutoConference(db, env, memberId, mt.conferenceType, mt.conferenceMetaJson, mt.calendarEventId);
      }
    }
  }
  await db.delete(m.meetingInvitees).where(eq(m.meetingInvitees.memberId, memberId));
  await db.delete(m.meetingResponses).where(eq(m.meetingResponses.memberId, memberId));
  await db.delete(m.meetingNotifications).where(eq(m.meetingNotifications.memberId, memberId));
  await db.delete(m.meetingDeclines).where(eq(m.meetingDeclines.memberId, memberId));
  await db.delete(m.meetingAttendances).where(eq(m.meetingAttendances.memberId, memberId));

  // ---- 定例会（同様に、本人主催分はキャンセル扱いに留める）----
  await db.update(m.meetingSeries).set({ status: "cancelled", updatedAt: now })
    .where(and(eq(m.meetingSeries.hostMemberId, memberId), ne(m.meetingSeries.status, "cancelled")));
  await db.delete(m.meetingSeriesInvitees).where(eq(m.meetingSeriesInvitees.memberId, memberId));
  await db.delete(m.meetingSeriesResponses).where(eq(m.meetingSeriesResponses.memberId, memberId));

  // ---- スケジューラー（日程調整）関連は本人専用データのため全削除 ----
  await db.delete(m.googleCredentials).where(eq(m.googleCredentials.memberId, memberId));
  await db.delete(m.zoomCredentials).where(eq(m.zoomCredentials.memberId, memberId));
  await db.delete(m.memberSchedulingSettings).where(eq(m.memberSchedulingSettings.memberId, memberId));
  await db.delete(m.schedulerShareLinks).where(eq(m.schedulerShareLinks.memberId, memberId));
  await db.delete(m.availabilityRules).where(eq(m.availabilityRules.memberId, memberId));
  await db.delete(m.availabilityOverrides).where(eq(m.availabilityOverrides.memberId, memberId));

  // ---- カード注文・Push購読 ----
  await db.delete(m.cardOrders).where(eq(m.cardOrders.memberId, memberId));
  await db.delete(m.pushSubscriptions).where(eq(m.pushSubscriptions.memberId, memberId));

  // ---- 最後にメンバー本体を削除（メールアドレスが再登録可能になる）----
  await db.delete(m.members).where(eq(m.members.id, memberId));
}
