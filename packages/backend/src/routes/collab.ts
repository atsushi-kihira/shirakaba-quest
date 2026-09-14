// =============================================================
// 協働マップ ルート（P1: 基盤）
// GET  /api/collab/graph            → 自分中心の協働グラフ
// POST /api/collab/links/possible   → 協業可能性ありチェック
// POST /api/collab/links/referral   → リファーラル提供できそうチェック
// POST /api/collab/teams            → 緩いチーム作成（当事者のみ・即active）
// POST /api/collab/teams/declare    → パワーチーム宣言（当事者・他メンバーはpending）
// POST /api/collab/teams/:id/respond → パワーチーム/緩いチームの招待に応答
// =============================================================
import { Hono } from "hono";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import { deriveStage, computeStalled } from "../services/collab-stage.ts";
import { MailService } from "../services/mailer.ts";
import { generateCompanySummary } from "../services/company-summary.ts";
import type { Env, Variables } from "../types.ts";

// 1人あたりの外部人脈の登録上限（1件登録・CSV取込の合計）
const EXTERNAL_CONTACTS_LIMIT = 300;
// 「人脈をさがす」等の遅延生成トリガーで対象にできる上限（検索結果ページ数に合わせる）
const LAZY_SUMMARY_BATCH_LIMIT = 30;
// 遅延生成トリガー1回あたり、実際にAI生成まで進める件数（waitUntilの実行時間制限内に収まるように少なく保つ）
const LAZY_SUMMARY_ROUND_SIZE = 3;
// processingのまま一定時間（秒）進捗がない行は、生成が失敗して止まったとみなし再度対象にする
const STALE_PROCESSING_SECONDS = 90;
// 自分の人脈一覧からの一括AI生成の上限
const BULK_SUMMARY_LIMIT = 20;
// バックグラウンド一斉処理（sweep）1回あたりに処理する件数
// （実測でCONCURRENCY=3のバッチが2つ分＝6件を超えると、waitUntilの実行時間制限内に
// 完了しないケースが確認されたため、安全に収まる件数に抑えている）
const BACKGROUND_SWEEP_ROUND_SIZE = 6;
// sweepの自己連鎖の最大回数（無限ループ防止の安全弁。1回の起点からこれを超えて連鎖しない）
const BACKGROUND_SWEEP_MAX_HOPS = 40;

export const collabRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
collabRoutes.use("*", authMiddleware);

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const REACTION_LABEL: Record<string, string> = { shokai: "紹介できそう", join: "私も参加したい" };

/**
 * 「紹介できそう」「私も参加したい」リアクション時、投稿者＋関係者（投稿の共同メンバー・
 * チーム投稿ならチームメンバー）にメッセージ通知を作成し、メールを送る。
 * リアクションした本人は宛先から除く。
 */
async function notifyCollabReaction(
  db: ReturnType<typeof createDb>,
  env: Env,
  opts: { post: typeof schema.collaborationPosts.$inferSelect; reactorId: string; type: string; message: string; now: number }
): Promise<void> {
  const { post, reactorId, type, message, now } = opts;

  const recipientIds = new Set<string>([post.authorId]);

  const postMembers = await db.select({ memberId: schema.collaborationPostMembers.memberId })
    .from(schema.collaborationPostMembers)
    .where(eq(schema.collaborationPostMembers.postId, post.id))
    .all();
  for (const pm of postMembers) recipientIds.add(pm.memberId);

  if (post.contextType === "team" && post.teamId) {
    const teamMembers = await db.select({ memberId: schema.collabTeamMembers.memberId })
      .from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, post.teamId), eq(schema.collabTeamMembers.status, "active")))
      .all();
    for (const tm of teamMembers) recipientIds.add(tm.memberId);
  }

  recipientIds.delete(reactorId);
  if (recipientIds.size === 0) return;

  for (const memberId of recipientIds) {
    await db.insert(schema.collabReactionNotifications).values({
      id: newId(), postId: post.id, reactionType: type, reactorId, memberId, message, readAt: null, createdAt: now,
    });
  }

  try {
    const [reactor, recipients] = await Promise.all([
      db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, reactorId)).get(),
      db.select({ id: schema.members.id, email: schema.members.email, name: schema.members.name })
        .from(schema.members).where(inArray(schema.members.id, [...recipientIds])).all(),
    ]);
    const mailer = new MailService(db, env);
    const reactionLabel = REACTION_LABEL[type] ?? type;
    for (const recipient of recipients) {
      if (!recipient.email) continue;
      await mailer.send("collab_reaction_message", recipient.email, {
        recipientName: recipient.name,
        reactorName: reactor?.name ?? "メンバー",
        reactionLabel,
        postBody: post.body ?? "（内容は非公開です）",
        reactionMessage: message,
      });
    }
  } catch (err) {
    console.error("[collab] リアクションメッセージ通知メール送信失敗", err);
  }
}

// /feed の可視性ルールを単一の投稿に対して適用する（コメント可否の判定に使う）
async function canViewCollabPost(
  db: ReturnType<typeof createDb>,
  meId: string,
  post: typeof schema.collaborationPosts.$inferSelect
): Promise<boolean> {
  if (post.authorId === meId) return true;

  const coSigned = await db
    .select({ memberId: schema.collaborationPostMembers.memberId })
    .from(schema.collaborationPostMembers)
    .where(and(eq(schema.collaborationPostMembers.postId, post.id), eq(schema.collaborationPostMembers.memberId, meId)))
    .get();
  if (coSigned) return true;

  if (post.visibility === "private") return false;
  if (post.visibility === "chapter") return true;

  if (post.visibility === "team") {
    if (post.contextType === "team" && post.teamId) {
      const membership = await db
        .select()
        .from(schema.collabTeamMembers)
        .where(and(
          eq(schema.collabTeamMembers.teamId, post.teamId),
          eq(schema.collabTeamMembers.memberId, meId),
          eq(schema.collabTeamMembers.status, "active")
        ))
        .get();
      return !!membership;
    }
    if (post.contextType === "link" && post.linkId) {
      const link = await db
        .select()
        .from(schema.collaborationLinks)
        .where(and(
          eq(schema.collaborationLinks.id, post.linkId),
          or(eq(schema.collaborationLinks.memberLowId, meId), eq(schema.collaborationLinks.memberHighId, meId))
        ))
        .get();
      return !!link;
    }
  }

  return false;
}

// ---- GET /api/collab/graph ----
// ---- GET /api/collab/my-teams ----
// 自分が参加中の協働チーム（パワーチーム/緩いチーム）一覧（軽量版。定例会作成の対象選択などに使う）
collabRoutes.get("/my-teams", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ data: [] });

  const memberships = await db.select({ teamId: schema.collabTeamMembers.teamId })
    .from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active")))
    .all();
  const teamIds = memberships.map((m) => m.teamId);
  if (teamIds.length === 0) return c.json({ data: [] });

  const teams = await db.select().from(schema.collabTeams)
    .where(and(inArray(schema.collabTeams.id, teamIds), eq(schema.collabTeams.archived, 0)))
    .all();

  const memberCounts = await db.select({ teamId: schema.collabTeamMembers.teamId })
    .from(schema.collabTeamMembers)
    .where(and(inArray(schema.collabTeamMembers.teamId, teamIds), eq(schema.collabTeamMembers.status, "active")))
    .all();
  const countMap = new Map<string, number>();
  for (const r of memberCounts) countMap.set(r.teamId, (countMap.get(r.teamId) ?? 0) + 1);

  const data = teams.map((t) => ({ id: t.id, name: t.name, type: t.type, memberCount: countMap.get(t.id) ?? 0 }));
  return c.json({ data });
});

// 組織全体で共有するグラフ（関係線・チームの塊は誰が見ても同じ）＋
// 自分だけに見える私的レイヤー（自分から見た可能性/リファーラルのチェック状態）を返す。
collabRoutes.get("/graph", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const now = Math.floor(Date.now() / 1000);

  const [allLinks, allActiveMembers, allTeamMemberRows, allTeamRows, linkPostRows, myFavoriteRows] = await Promise.all([
    db.select().from(schema.collaborationLinks).all(),
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members).where(eq(schema.members.status, "active")).all(),
    db.select().from(schema.collabTeamMembers).all(),
    db.select().from(schema.collabTeams).all(),
    db.select({ linkId: schema.collaborationPosts.linkId })
      .from(schema.collaborationPosts)
      .where(and(eq(schema.collaborationPosts.contextType, "link"), isNull(schema.collaborationPosts.deletedAt)))
      .all(),
    db.select({ contactId: schema.externalContactFavorites.contactId })
      .from(schema.externalContactFavorites)
      .where(eq(schema.externalContactFavorites.memberId, meId))
      .all(),
  ]);
  const myFavoriteContactIds = new Set(myFavoriteRows.map((r) => r.contactId));

  const memberMap = new Map(allActiveMembers.map((m) => [m.id, m]));
  const linkIdsWithPost = new Set(linkPostRows.map((r) => r.linkId).filter((id): id is string => !!id));

  // 「活動記録あり」＝ 1to1が1回以上ある協働リンクに登場する、またはチームに所属（active/pending）している
  const memberIdsWithLinkActivity = new Set<string>();
  for (const l of allLinks) {
    if (l.oneOnOneCount >= 1) {
      memberIdsWithLinkActivity.add(l.memberLowId);
      memberIdsWithLinkActivity.add(l.memberHighId);
    }
  }
  const memberIdsInTeam = new Set(
    allTeamMemberRows.filter((tm) => tm.status !== "declined").map((tm) => tm.memberId)
  );

  // 活動記録なし・チーム未所属の人は、本人以外からは見えない
  const visibleMemberIds = new Set(
    allActiveMembers
      .filter((m) => m.id === meId || memberIdsWithLinkActivity.has(m.id) || memberIdsInTeam.has(m.id))
      .map((m) => m.id)
  );

  const nodes = allActiveMembers
    .filter((m) => visibleMemberIds.has(m.id))
    .map((m) => ({
      ...m,
      isMe: m.id === meId,
      hasActivity: memberIdsWithLinkActivity.has(m.id) || memberIdsInTeam.has(m.id),
    }));

  // 団体紹介の候補用：地図には出さないが、チーム作成時には誰でも選べるようにする
  const noActivityMembers = allActiveMembers
    .filter((m) => m.id !== meId && !visibleMemberIds.has(m.id))
    .map((m) => ({ ...m, isMe: false, hasActivity: false }));

  // 緩いチーム（手動作成）のメンバー同士は、1to1の自動進行状況に関わらず
  // 「緩いチーム」の関係線（凡例の実線）を表示する。パワーチームは丸（塊）表現のみで線は引かない。
  const loosePairKeys = new Set<string>();
  for (const t of allTeamRows) {
    if (t.type !== "loose" || t.archived === 1) continue; // 休止中のチームは関係線を表示しない
    const activeMemberIds = allTeamMemberRows
      .filter((tm) => tm.teamId === t.id && tm.status === "active")
      .map((tm) => tm.memberId);
    for (let i = 0; i < activeMemberIds.length; i++) {
      for (let j = i + 1; j < activeMemberIds.length; j++) {
        const [lo, hi] = normalizePair(activeMemberIds[i], activeMemberIds[j]);
        loosePairKeys.add(`${lo}:${hi}`);
      }
    }
  }

  // 全員が見る関係線（可視ノード同士のみ）
  const edgeMap = new Map<string, { memberAId: string; memberBId: string; stage: "one" | "seed" | "loose"; stalled: ReturnType<typeof computeStalled>; oneOnOneCount: number; lastActivityAt: number | null }>();
  for (const l of allLinks) {
    if (!visibleMemberIds.has(l.memberLowId) || !visibleMemberIds.has(l.memberHighId)) continue;
    const key = `${l.memberLowId}:${l.memberHighId}`;
    const stage = loosePairKeys.has(key) ? "loose" : deriveStage(l, linkIdsWithPost.has(l.id));
    edgeMap.set(key, {
      memberAId: l.memberLowId,
      memberBId: l.memberHighId,
      stage,
      stalled: computeStalled(l.lastActivityAt, now),
      oneOnOneCount: l.oneOnOneCount,
      lastActivityAt: l.lastActivityAt,
    });
  }
  // 1to1の記録が一度もないメンバー同士でも、同じ緩いチームに所属していれば関係線を表示する
  for (const key of loosePairKeys) {
    if (edgeMap.has(key)) continue;
    const [lo, hi] = key.split(":");
    if (!visibleMemberIds.has(lo) || !visibleMemberIds.has(hi)) continue;
    edgeMap.set(key, { memberAId: lo, memberBId: hi, stage: "loose", stalled: "active", oneOnOneCount: 0, lastActivityAt: null });
  }
  const edges = [...edgeMap.values()];

  // 自分だけに見える私的レイヤー（自分が関わるリンクのみ）
  const myEdges = allLinks
    .filter((l) => l.memberLowId === meId || l.memberHighId === meId)
    .map((l) => {
      const partnerId = l.memberLowId === meId ? l.memberHighId : l.memberLowId;
      return {
        partnerId,
        myPossible: l.memberLowId === meId ? !!l.possibleLow : !!l.possibleHigh,
        partnerPossible: l.memberLowId === meId ? !!l.possibleHigh : !!l.possibleLow,
        myReferral: l.memberLowId === meId ? !!l.referralLow : !!l.referralHigh,
        partnerReferral: l.memberLowId === meId ? !!l.referralHigh : !!l.referralLow,
      };
    });

  // チーム（緩い/パワー）は全員分を共有表示。自分の参加状況だけ myStatus に載せる
  const myStatusByTeam = new Map(
    allTeamMemberRows.filter((tm) => tm.memberId === meId).map((tm) => [tm.teamId, tm.status])
  );
  const teams = allTeamRows.map((t) => {
    const members = allTeamMemberRows
      .filter((tm) => tm.teamId === t.id && tm.status !== "declined")
      .map((tm) => {
        const m = memberMap.get(tm.memberId);
        return {
          id: tm.memberId,
          status: tm.status,
          invitedBy: tm.invitedBy,
          name: m?.name ?? "不明なメンバー",
          emoji: m?.emoji ?? "❓",
          bgColor: m?.bgColor ?? "bg-stone-100",
        };
      });
    return {
      id: t.id, name: t.name, type: t.type, createdBy: t.createdBy, archived: t.archived === 1,
      myStatus: myStatusByTeam.get(t.id) ?? null, members,
    };
  }).filter((t) => t.members.length > 0);

  // 自分側が未確認の1to1（完了しているのに、可能性/リファーラルの確認をまだ求めていない）
  const pendingConfirmations = allLinks
    .filter((l) => l.memberLowId === meId || l.memberHighId === meId)
    .filter((l) => {
      const myPromptedCount = l.memberLowId === meId ? l.promptedCountLow : l.promptedCountHigh;
      return l.oneOnOneCount >= 1 && myPromptedCount < l.oneOnOneCount;
    })
    .map((l) => {
      const partnerId = l.memberLowId === meId ? l.memberHighId : l.memberLowId;
      const partner = memberMap.get(partnerId);
      return partner ? { partnerId, name: partner.name, emoji: partner.emoji, bgColor: partner.bgColor, lastActivityAt: l.lastActivityAt } : null;
    })
    .filter((p): p is { partnerId: string; name: string; emoji: string; bgColor: string; lastActivityAt: number | null } => !!p)
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

  // 人脈レイヤー：マップ上に見えているメンバー（自分含む）の外部人脈のみを対象にする。
  // 連絡先情報は保持していないため絞り込みは不要。公開範囲に応じて出す項目を絞る。
  const contactOwnerIds = [...visibleMemberIds];
  const contactRowsRaw = contactOwnerIds.length > 0
    ? await db.select().from(schema.externalContacts).where(inArray(schema.externalContacts.ownerMemberId, contactOwnerIds)).all()
    : [];
  const contactRows = await attachRelationships(db, contactRowsRaw);
  const contacts = contactRows
    .filter((ct) => ct.ownerMemberId === meId || ct.visibility !== "private")
    .map((ct) => {
      const mine = ct.ownerMemberId === meId;
      const showDetail = mine || ct.visibility === "full";
      return {
        id: ct.id,
        ownerId: ct.ownerMemberId,
        mine,
        visibility: ct.visibility,
        specialty: ct.specialty,
        relationships: ct.relationships,
        name: showDetail ? ct.name : null,
        company: showDetail ? ct.company : null,
        note: showDetail ? ct.note : null,
        // 会社の事業概要は、名前・会社名の公開設定に関わらず表示する
        // （会社名そのものではなく「どういう会社か」の説明のため、非公開設定でも支障がない）
        businessSummary: ct.businessSummaryStatus === "done" ? ct.businessSummary : null,
        businessSummaryDetail: ct.businessSummaryStatus === "done" ? ct.businessSummaryDetail : null,
        createdAt: ct.createdAt,
        isFavorite: myFavoriteContactIds.has(ct.id),
      };
    });

  return c.json({
    data: {
      center: meId,
      nodes,
      edges,
      myEdges,
      teams,
      noActivityMembers,
      pendingConfirmations,
      contacts,
    },
  });
});

// ---- GET /api/collab/pending-confirmations ----
// 1to1完了ボタンを押すことなく、実施日から1週間経過してシステムが自動的に完了とした1to1のうち、
// 自分側がまだ「1to1の振り返り」（協業の可能性・リファーラルの可能性）を記録していないもの一覧。
// 手動で完了ボタンを押した1to1は、その場でのチェック有無に関わらずここには出さない
// （ホーム画面の通知向け。/graph の重いペイロードを使わせないための軽量版）
collabRoutes.get("/pending-confirmations", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ data: [] });

  const sessions = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(
      and(
        or(eq(schema.oneOnOneSessions.requesterId, meId), eq(schema.oneOnOneSessions.responderId, meId)),
        eq(schema.oneOnOneSessions.status, "completed"),
        eq(schema.oneOnOneSessions.autoTransitionReason, "date_passed")
      )
    )
    .all();

  const pending = sessions.filter((s) => {
    const isRequester = s.requesterId === meId;
    const myReviewedAt = isRequester ? s.requesterReviewedAt : s.responderReviewedAt;
    return !myReviewedAt;
  });

  const partnerIds = [...new Set(pending.map((s) => (s.requesterId === meId ? s.responderId : s.requesterId)))];
  const partners = partnerIds.length > 0
    ? await db
        .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members)
        .where(inArray(schema.members.id, partnerIds))
        .all()
    : [];
  const partnerMap = new Map(partners.map((p) => [p.id, p]));

  // 同じ相手との未振り返りセッションが複数あっても、カードは相手ごとに1枚にまとめる
  // （「保存」時にまとめて全セッション分を振り返り済みにするため sessionIds を持たせる）
  const byPartner = new Map<string, { partnerId: string; name: string; emoji: string; bgColor: string; completedAt: number | null; sessionIds: string[] }>();
  for (const s of pending) {
    const partnerId = s.requesterId === meId ? s.responderId : s.requesterId;
    const partner = partnerMap.get(partnerId);
    if (!partner) continue;
    const existing = byPartner.get(partnerId);
    if (existing) {
      existing.sessionIds.push(s.id);
      existing.completedAt = Math.max(existing.completedAt ?? 0, s.completedAt ?? 0);
    } else {
      byPartner.set(partnerId, {
        partnerId, name: partner.name, emoji: partner.emoji, bgColor: partner.bgColor,
        completedAt: s.completedAt, sessionIds: [s.id],
      });
    }
  }

  const data = [...byPartner.values()].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return c.json({ data });
});

// ---- POST /api/collab/pending-confirmations/:partnerId/mark-reviewed ----
// ホーム画面で「保存」を押した際、その相手との未振り返り（自動完了）セッションを
// すべて振り返り済みとして記録する
collabRoutes.post("/pending-confirmations/:partnerId/mark-reviewed", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const partnerId = c.req.param("partnerId");
  const now = Math.floor(Date.now() / 1000);

  const sessions = await db
    .select({ id: schema.oneOnOneSessions.id, requesterId: schema.oneOnOneSessions.requesterId, responderId: schema.oneOnOneSessions.responderId })
    .from(schema.oneOnOneSessions)
    .where(
      and(
        or(
          and(eq(schema.oneOnOneSessions.requesterId, meId), eq(schema.oneOnOneSessions.responderId, partnerId)),
          and(eq(schema.oneOnOneSessions.requesterId, partnerId), eq(schema.oneOnOneSessions.responderId, meId))
        ),
        eq(schema.oneOnOneSessions.status, "completed"),
        eq(schema.oneOnOneSessions.autoTransitionReason, "date_passed")
      )
    )
    .all();

  for (const s of sessions) {
    const isRequester = s.requesterId === meId;
    await db.update(schema.oneOnOneSessions)
      .set(isRequester ? { requesterReviewedAt: now } : { responderReviewedAt: now })
      .where(eq(schema.oneOnOneSessions.id, s.id));
  }

  return c.json({ data: { updated: sessions.length } });
});

// ---- GET /api/collab/contacts/by-member/:memberId ----
// 指定メンバーが登録した外部人脈のみを対象に検索する（メンバー詳細画面向け）。
// /graph の contacts と異なり、閲覧者との協働マップ上の可視性（活動記録の有無）に関わらず取得できる。
collabRoutes.get("/contacts/by-member/:memberId", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const ownerId = c.req.param("memberId");
  const [contactRowsRaw, myFavoriteRows] = await Promise.all([
    db.select().from(schema.externalContacts).where(eq(schema.externalContacts.ownerMemberId, ownerId)).all(),
    db.select({ contactId: schema.externalContactFavorites.contactId })
      .from(schema.externalContactFavorites)
      .where(eq(schema.externalContactFavorites.memberId, meId))
      .all(),
  ]);
  const myFavoriteContactIds = new Set(myFavoriteRows.map((r) => r.contactId));
  const contactRows = await attachRelationships(db, contactRowsRaw);

  const contacts = contactRows
    .filter((ct) => ct.ownerMemberId === meId || ct.visibility !== "private")
    .map((ct) => {
      const mine = ct.ownerMemberId === meId;
      const showDetail = mine || ct.visibility === "full";
      return {
        id: ct.id,
        ownerId: ct.ownerMemberId,
        mine,
        visibility: ct.visibility,
        specialty: ct.specialty,
        relationships: ct.relationships,
        name: showDetail ? ct.name : null,
        company: showDetail ? ct.company : null,
        note: showDetail ? ct.note : null,
        businessSummary: ct.businessSummaryStatus === "done" ? ct.businessSummary : null,
        businessSummaryDetail: ct.businessSummaryStatus === "done" ? ct.businessSummaryDetail : null,
        createdAt: ct.createdAt,
        isFavorite: myFavoriteContactIds.has(ct.id),
      };
    });

  return c.json({ data: { contacts } });
});

// ---- POST /api/collab/links/:partnerId/acknowledge ----
// 「協業可能性・リファーラル」の確認リマインダーを既読にする（チェックの有無は問わない）
collabRoutes.post("/links/:partnerId/acknowledge", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const partnerId = c.req.param("partnerId");
  const [memberLowId, memberHighId] = normalizePair(meId, partnerId);
  const isLow = meId === memberLowId;
  const now = Math.floor(Date.now() / 1000);

  const existing = await db.select().from(schema.collaborationLinks)
    .where(and(eq(schema.collaborationLinks.memberLowId, memberLowId), eq(schema.collaborationLinks.memberHighId, memberHighId)))
    .get();
  if (!existing) return c.json({ error: { code: "not_found", message: "関係が見つかりません" } }, 404);

  await db.update(schema.collaborationLinks)
    .set(isLow ? { promptedCountLow: existing.oneOnOneCount, updatedAt: now } : { promptedCountHigh: existing.oneOnOneCount, updatedAt: now })
    .where(eq(schema.collaborationLinks.id, existing.id));

  return c.json({ ok: true });
});

// ---- POST /api/collab/links/possible ----
collabRoutes.post("/links/possible", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { otherMemberId, on } = await c.req.json<{ otherMemberId: string; on: boolean }>();
  if (!otherMemberId || otherMemberId === meId) {
    return c.json({ error: { code: "invalid_input", message: "相手の指定が不正です" } }, 400);
  }

  const link = await upsertLinkFlag(db, meId, otherMemberId, "possible", on);
  return c.json({ data: { stage: link.stage } });
});

// ---- POST /api/collab/links/referral ----
collabRoutes.post("/links/referral", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { otherMemberId, on } = await c.req.json<{ otherMemberId: string; on: boolean }>();
  if (!otherMemberId || otherMemberId === meId) {
    return c.json({ error: { code: "invalid_input", message: "相手の指定が不正です" } }, 400);
  }

  const link = await upsertLinkFlag(db, meId, otherMemberId, "referral", on);
  return c.json({ data: { stage: link.stage } });
});

// ---- POST /api/collab/teams ---- 緩いチーム作成（当事者のみ・全員即active）
collabRoutes.post("/teams", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { name, memberIds } = await c.req.json<{ name: string; memberIds: string[] }>();
  const uniqueIds = [...new Set([meId, ...(memberIds ?? [])])];

  if (!name?.trim()) return c.json({ error: { code: "invalid_input", message: "チーム名を入力してください" } }, 400);
  if (uniqueIds.length < 2) {
    return c.json({ error: { code: "invalid_input", message: "緩いチームは2名以上で作成してください" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const teamId = newId();
  await db.insert(schema.collabTeams).values({
    id: teamId, name: name.trim(), type: "loose", createdBy: meId, createdAt: now, archived: 0,
  });
  await db.insert(schema.collabTeamMembers).values(
    uniqueIds.map((memberId) => ({
      id: newId(), teamId, memberId, status: "active" as const,
      invitedBy: memberId === meId ? null : meId, respondedAt: now, createdAt: now,
    }))
  );

  return c.json({ data: { id: teamId } }, 201);
});

// ---- POST /api/collab/teams/declare ---- パワーチーム宣言（当事者・他メンバーはpending）
collabRoutes.post("/teams/declare", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { name, memberIds } = await c.req.json<{ name: string; memberIds: string[] }>();
  const otherIds = [...new Set((memberIds ?? []).filter((id) => id !== meId))];

  if (!name?.trim()) return c.json({ error: { code: "invalid_input", message: "チーム名を入力してください" } }, 400);
  if (otherIds.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "他のメンバーを1名以上指定してください" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const teamId = newId();
  await db.insert(schema.collabTeams).values({
    id: teamId, name: name.trim(), type: "power", createdBy: meId, createdAt: now, archived: 0,
  });
  await db.insert(schema.collabTeamMembers).values([
    { id: newId(), teamId, memberId: meId, status: "active" as const, invitedBy: null, respondedAt: now, createdAt: now },
    ...otherIds.map((memberId) => ({
      id: newId(), teamId, memberId, status: "pending" as const, invitedBy: meId, respondedAt: null, createdAt: now,
    })),
  ]);

  return c.json({ data: { id: teamId } }, 201);
});

// ---- POST /api/collab/teams/:id/respond ----
collabRoutes.post("/teams/:id/respond", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const { accept } = await c.req.json<{ accept: boolean }>();

  const membership = await db
    .select()
    .from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.memberId, meId)))
    .get();

  if (!membership) return c.json({ error: { code: "not_found", message: "招待が見つかりません" } }, 404);
  if (membership.status !== "pending") {
    return c.json({ error: { code: "already_responded", message: "すでに回答済みです" } }, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.collabTeamMembers)
    .set({ status: accept ? "active" : "declined", respondedAt: now })
    .where(eq(schema.collabTeamMembers.id, membership.id));

  return c.json({ data: { status: accept ? "active" : "declined" } });
});

// ---- DELETE /api/collab/teams/:id ---- チームを解散する（作成者のみ）
collabRoutes.delete("/teams/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) {
    return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ解散できます" } }, 403);
  }

  await db.delete(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.teamId, teamId));
  await db.delete(schema.collabTeams).where(eq(schema.collabTeams.id, teamId));

  return c.json({ ok: true });
});

// ---- POST /api/collab/teams/:id/leave ---- 自分がチームを脱退する
collabRoutes.post("/teams/:id/leave", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const membership = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.memberId, meId)))
    .get();
  if (!membership) return c.json({ error: { code: "not_found", message: "このチームのメンバーではありません" } }, 404);

  await db.delete(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.id, membership.id));

  // 残っているアクティブなメンバーがいなければ、チームごと削除する
  const remaining = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.status, "active")))
    .all();
  if (remaining.length === 0) {
    await db.delete(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.teamId, teamId));
    await db.delete(schema.collabTeams).where(eq(schema.collabTeams.id, teamId));
  } else {
    // 作成者が抜けて管理者不在にならないよう、最も古参のアクティブメンバーへ自動的にリーダーを引き継ぐ
    const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
    if (team && team.createdBy === meId) {
      const successor = remaining.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      await db.update(schema.collabTeams).set({ createdBy: successor.memberId }).where(eq(schema.collabTeams.id, teamId));
    }
  }

  return c.json({ ok: true });
});

// ---- POST /api/collab/teams/:id/members/:memberId/remove ---- 作成者が他のメンバーを除名する
collabRoutes.post("/teams/:id/members/:memberId/remove", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const targetId = c.req.param("memberId");

  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) {
    return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ他のメンバーを除名できます" } }, 403);
  }
  if (targetId === meId) {
    return c.json({ error: { code: "invalid_input", message: "自分自身は「脱退」から行ってください" } }, 400);
  }

  const membership = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.memberId, targetId)))
    .get();
  if (!membership) return c.json({ error: { code: "not_found", message: "このメンバーは見つかりません" } }, 404);

  await db.delete(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.id, membership.id));

  return c.json({ ok: true });
});

// ---- POST /api/collab/teams/:id/invite ---- 作成者が新しいメンバーを招待する
collabRoutes.post("/teams/:id/invite", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const { memberIds } = await c.req.json<{ memberIds?: string[] }>().catch(() => ({ memberIds: undefined }));
  const targetIds = [...new Set(memberIds ?? [])].filter((id) => id !== meId);
  if (targetIds.length === 0) return c.json({ error: { code: "invalid_input", message: "招待するメンバーを選択してください" } }, 400);

  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ招待できます" } }, 403);

  const now = Math.floor(Date.now() / 1000);
  const existingRows = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), inArray(schema.collabTeamMembers.memberId, targetIds)))
    .all();
  const existingByMember = new Map(existingRows.map((r) => [r.memberId, r]));

  const invitedIds: string[] = [];
  for (const memberId of targetIds) {
    const existing = existingByMember.get(memberId);
    if (existing) {
      if (existing.status === "active" || existing.status === "pending") continue; // 既に参加中・招待中はスキップ
      // 過去に辞退していた場合は、招待し直す
      await db.update(schema.collabTeamMembers)
        .set({ status: "pending", invitedBy: meId, respondedAt: null, createdAt: now })
        .where(eq(schema.collabTeamMembers.id, existing.id));
    } else {
      await db.insert(schema.collabTeamMembers).values({
        id: newId(), teamId, memberId, status: "pending", invitedBy: meId, respondedAt: null, createdAt: now,
      });
    }
    invitedIds.push(memberId);
  }

  if (invitedIds.length > 0) {
    try {
      const [inviter, invitees] = await Promise.all([
        db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, meId)).get(),
        db.select({ id: schema.members.id, email: schema.members.email, name: schema.members.name })
          .from(schema.members).where(inArray(schema.members.id, invitedIds)).all(),
      ]);
      const mailer = new MailService(db, c.env);
      for (const invitee of invitees) {
        if (!invitee.email) continue;
        await mailer.send("collab_team_invite", invitee.email, {
          inviteeName: invitee.name,
          inviterName: inviter?.name ?? "メンバー",
          teamName: team.name,
          teamTypeLabel: team.type === "power" ? "パワーチーム" : "緩いチーム",
        });
      }
    } catch (err) {
      console.error("[collab] チーム招待メール送信失敗", err);
    }
  }

  return c.json({ data: { invited: invitedIds.length } }, 201);
});

// ---- POST /api/collab/teams/:id/members/:memberId/approve ---- 作成者が「参加したい」自己申告を承認する
collabRoutes.post("/teams/:id/members/:memberId/approve", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const targetId = c.req.param("memberId");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ操作できます" } }, 403);

  const membership = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.memberId, targetId)))
    .get();
  if (!membership) return c.json({ error: { code: "not_found", message: "参加リクエストが見つかりません" } }, 404);
  if (membership.status !== "pending" || membership.invitedBy !== null) {
    return c.json({ error: { code: "invalid_input", message: "承認できる参加リクエストではありません" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.collabTeamMembers)
    .set({ status: "active", respondedAt: now })
    .where(eq(schema.collabTeamMembers.id, membership.id));

  return c.json({ ok: true });
});

// ---- POST /api/collab/teams/:id/members/:memberId/reject ---- 作成者が「参加したい」自己申告を却下する
collabRoutes.post("/teams/:id/members/:memberId/reject", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const targetId = c.req.param("memberId");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ操作できます" } }, 403);

  const membership = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.memberId, targetId)))
    .get();
  if (!membership) return c.json({ error: { code: "not_found", message: "参加リクエストが見つかりません" } }, 404);
  if (membership.status !== "pending" || membership.invitedBy !== null) {
    return c.json({ error: { code: "invalid_input", message: "却下できる参加リクエストではありません" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.collabTeamMembers)
    .set({ status: "declined", respondedAt: now })
    .where(eq(schema.collabTeamMembers.id, membership.id));

  return c.json({ ok: true });
});

// ---- POST /api/collab/teams/:id/promote ---- 緩いチームをパワーチームに昇格する（作成者のみ）
collabRoutes.post("/teams/:id/promote", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ昇格できます" } }, 403);
  if (team.type !== "loose") return c.json({ error: { code: "invalid_input", message: "緩いチームのみパワーチームに昇格できます" } }, 400);

  await db.update(schema.collabTeams).set({ type: "power" }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- POST /api/collab/teams/:id/pause ---- チーム活動を休止する（解散はしない・作成者のみ）
collabRoutes.post("/teams/:id/pause", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ休止できます" } }, 403);

  await db.update(schema.collabTeams).set({ archived: 1 }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- POST /api/collab/teams/:id/resume ---- 休止中のチーム活動を再開する（作成者のみ）
collabRoutes.post("/teams/:id/resume", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ再開できます" } }, 403);

  await db.update(schema.collabTeams).set({ archived: 0 }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- POST /api/collab/teams/:id/transfer-leader ---- チームリーダーを引き継ぐ（作成者のみ）
collabRoutes.post("/teams/:id/transfer-leader", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const { newLeaderId } = await c.req.json<{ newLeaderId?: string }>().catch(() => ({ newLeaderId: undefined }));
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) return c.json({ error: { code: "forbidden", message: "このチームの作成者のみリーダーを引き継げます" } }, 403);
  if (!newLeaderId || newLeaderId === meId) {
    return c.json({ error: { code: "invalid_input", message: "引き継ぎ先のメンバーを選択してください" } }, 400);
  }

  const target = await db.select().from(schema.collabTeamMembers)
    .where(and(
      eq(schema.collabTeamMembers.teamId, teamId),
      eq(schema.collabTeamMembers.memberId, newLeaderId),
      eq(schema.collabTeamMembers.status, "active")
    ))
    .get();
  if (!target) return c.json({ error: { code: "invalid_input", message: "アクティブなメンバーにのみ引き継げます" } }, 400);

  await db.update(schema.collabTeams).set({ createdBy: newLeaderId }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- PATCH /api/collab/teams/:id ---- チーム名を変更する（作成者のみ）
collabRoutes.patch("/teams/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const teamId = c.req.param("id");
  const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
  if (!name?.trim()) return c.json({ error: { code: "invalid_input", message: "チーム名を入力してください" } }, 400);

  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.createdBy !== meId) return c.json({ error: { code: "forbidden", message: "このチームの作成者のみ名前を変更できます" } }, 403);

  await db.update(schema.collabTeams).set({ name: name.trim() }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- GET /api/collab/feed ---- 活動タイムライン
collabRoutes.get("/feed", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const team = c.req.query("team") ?? "all";
  const period = c.req.query("period") ?? "30";
  const now = Math.floor(Date.now() / 1000);
  const periodDays: Record<string, number | null> = { "30": 30, "90": 90, "180": 180, "365": 365, all: null };
  const days = periodDays[period] ?? 30;
  const cutoff = days ? now - days * 86400 : null;

  const conditions = [isNull(schema.collaborationPosts.deletedAt)];
  if (cutoff !== null) conditions.push(gte(schema.collaborationPosts.createdAt, cutoff));
  if (team !== "all") {
    conditions.push(eq(schema.collaborationPosts.contextType, "team"));
    conditions.push(eq(schema.collaborationPosts.teamId, team));
  }

  const posts = await db
    .select()
    .from(schema.collaborationPosts)
    .where(and(...conditions))
    .orderBy(desc(schema.collaborationPosts.createdAt))
    .all();

  if (posts.length === 0) return c.json({ data: [] });

  const postIds = posts.map((p) => p.id);

  const [postMembers, reactions, myTeamRows, linkedLinks] = await Promise.all([
    db.select().from(schema.collaborationPostMembers).where(inArray(schema.collaborationPostMembers.postId, postIds)).all(),
    db.select().from(schema.collaborationPostReactions).where(inArray(schema.collaborationPostReactions.postId, postIds)).all(),
    db.select({ teamId: schema.collabTeamMembers.teamId })
      .from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active")))
      .all(),
    db.select().from(schema.collaborationLinks)
      .where(or(eq(schema.collaborationLinks.memberLowId, meId), eq(schema.collaborationLinks.memberHighId, meId)))
      .all(),
  ]);

  const myActiveTeamIds = new Set(myTeamRows.map((t) => t.teamId));
  const myLinkIds = new Set(linkedLinks.map((l) => l.id));
  const membersByPost = new Map<string, string[]>();
  for (const pm of postMembers) {
    const arr = membersByPost.get(pm.postId) ?? [];
    arr.push(pm.memberId);
    membersByPost.set(pm.postId, arr);
  }
  const reactionsByPost = new Map<string, typeof reactions>();
  for (const r of reactions) {
    const arr = reactionsByPost.get(r.postId) ?? [];
    arr.push(r);
    reactionsByPost.set(r.postId, arr);
  }

  const memberIds = [...new Set(postMembers.map((pm) => pm.memberId))];
  const memberRows = memberIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members).where(inArray(schema.members.id, memberIds)).all()
    : [];
  const memberMap = new Map(memberRows.map((m) => [m.id, m]));

  const visible = posts.filter((p) => {
    if (p.authorId === meId) return true;
    const isCoSigned = (membersByPost.get(p.id) ?? []).includes(meId);
    if (isCoSigned) return true;
    if (p.visibility === "private") return false;
    if (p.visibility === "chapter") return true;
    if (p.visibility === "team") {
      if (p.contextType === "team" && p.teamId) return myActiveTeamIds.has(p.teamId);
      if (p.contextType === "link" && p.linkId) return myLinkIds.has(p.linkId);
    }
    return false;
  });

  // コメント（見えている投稿分のみ）とそのいいねを取得して埋め込む
  const visiblePostIds = visible.map((p) => p.id);
  const comments = visiblePostIds.length > 0
    ? await db.select().from(schema.collaborationComments)
        .where(and(inArray(schema.collaborationComments.postId, visiblePostIds), isNull(schema.collaborationComments.deletedAt)))
        .orderBy(schema.collaborationComments.createdAt)
        .all()
    : [];
  const commentIds = comments.map((cm) => cm.id);
  const commentReactions = commentIds.length > 0
    ? await db.select().from(schema.collaborationCommentReactions).where(inArray(schema.collaborationCommentReactions.commentId, commentIds)).all()
    : [];
  const commentAuthorIds = [...new Set(comments.map((cm) => cm.authorId))];
  const commentAuthorRows = commentAuthorIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members).where(inArray(schema.members.id, commentAuthorIds)).all()
    : [];
  const commentAuthorMap = new Map(commentAuthorRows.map((m) => [m.id, m]));
  const commentsByPost = new Map<string, typeof comments>();
  for (const cm of comments) {
    const arr = commentsByPost.get(cm.postId) ?? [];
    arr.push(cm);
    commentsByPost.set(cm.postId, arr);
  }
  const likesByComment = new Map<string, typeof commentReactions>();
  for (const r of commentReactions) {
    const arr = likesByComment.get(r.commentId) ?? [];
    arr.push(r);
    likesByComment.set(r.commentId, arr);
  }

  const result = visible.map((p) => {
    const myReactions = (reactionsByPost.get(p.id) ?? []).filter((r) => r.memberId === meId).map((r) => r.type);
    const reactionCounts: Record<string, number> = {};
    for (const r of reactionsByPost.get(p.id) ?? []) reactionCounts[r.type] = (reactionCounts[r.type] ?? 0) + 1;
    const postComments = (commentsByPost.get(p.id) ?? []).map((cm) => {
      const likes = likesByComment.get(cm.id) ?? [];
      const author = commentAuthorMap.get(cm.authorId);
      return {
        id: cm.id,
        postId: cm.postId,
        authorId: cm.authorId,
        author: author ?? { id: cm.authorId, name: "不明なメンバー", emoji: "❓", bgColor: "bg-stone-100" },
        body: cm.body,
        createdAt: cm.createdAt,
        likeCount: likes.length,
        likedByMe: likes.some((l) => l.memberId === meId),
        mine: cm.authorId === meId,
        canDelete: cm.authorId === meId,
      };
    });
    return {
      id: p.id,
      authorId: p.authorId,
      contextType: p.contextType,
      linkId: p.linkId,
      teamId: p.teamId,
      visibility: p.visibility,
      isPrivate: !!p.isPrivate,
      stageAtPost: p.stageAtPost,
      source: p.source,
      body: p.isPrivate && p.authorId !== meId && !(membersByPost.get(p.id) ?? []).includes(meId) ? null : p.body,
      createdAt: p.createdAt,
      members: (membersByPost.get(p.id) ?? []).map((id) => memberMap.get(id)).filter(Boolean),
      reactionCounts,
      myReactions,
      comments: postComments,
      mine: p.authorId === meId,
      canEdit: p.authorId === meId && p.source === "user",
      canDelete: p.authorId === meId && p.source === "user",
    };
  });

  return c.json({ data: result });
});

// ---- POST /api/collab/posts/:id/comments ---- 投稿へコメントする
collabRoutes.post("/posts/:id/comments", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const postId = c.req.param("id");
  const { body } = await c.req.json<{ body?: string }>();
  if (!body?.trim()) return c.json({ error: { code: "invalid_input", message: "コメントを入力してください" } }, 400);

  const post = await db.select().from(schema.collaborationPosts).where(eq(schema.collaborationPosts.id, postId)).get();
  if (!post || post.deletedAt) return c.json({ error: { code: "not_found", message: "投稿が見つかりません" } }, 404);

  const canView = await canViewCollabPost(db, meId, post);
  if (!canView) return c.json({ error: { code: "forbidden", message: "この投稿にはコメントできません" } }, 403);

  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  await db.insert(schema.collaborationComments).values({ id, postId, authorId: meId, body: body.trim(), createdAt: now });

  const author = await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
    .from(schema.members).where(eq(schema.members.id, meId)).get();

  return c.json({
    data: {
      id, postId, authorId: meId, author, body: body.trim(), createdAt: now,
      likeCount: 0, likedByMe: false, mine: true, canDelete: true,
    },
  }, 201);
});

// ---- DELETE /api/collab/comments/:id ---- 自分のコメントを削除
collabRoutes.delete("/comments/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const commentId = c.req.param("id");
  const comment = await db.select().from(schema.collaborationComments).where(eq(schema.collaborationComments.id, commentId)).get();
  if (!comment || comment.deletedAt) return c.json({ error: { code: "not_found", message: "コメントが見つかりません" } }, 404);
  if (comment.authorId !== meId) return c.json({ error: { code: "forbidden", message: "自分のコメントのみ削除できます" } }, 403);

  await db.update(schema.collaborationComments)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.collaborationComments.id, commentId));

  return c.json({ ok: true });
});

// ---- POST /api/collab/comments/:id/reactions ---- コメントへの「いいね」をトグル
collabRoutes.post("/comments/:id/reactions", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const commentId = c.req.param("id");
  const comment = await db.select().from(schema.collaborationComments).where(eq(schema.collaborationComments.id, commentId)).get();
  if (!comment || comment.deletedAt) return c.json({ error: { code: "not_found", message: "コメントが見つかりません" } }, 404);

  const existing = await db.select().from(schema.collaborationCommentReactions)
    .where(and(
      eq(schema.collaborationCommentReactions.commentId, commentId),
      eq(schema.collaborationCommentReactions.memberId, meId),
      eq(schema.collaborationCommentReactions.type, "like")
    ))
    .get();

  if (existing) {
    await db.delete(schema.collaborationCommentReactions).where(eq(schema.collaborationCommentReactions.id, existing.id));
    return c.json({ data: { on: false } });
  }

  await db.insert(schema.collaborationCommentReactions).values({
    id: newId(), commentId, memberId: meId, type: "like", createdAt: Math.floor(Date.now() / 1000),
  });
  return c.json({ data: { on: true } });
});

// ---- POST /api/collab/activity/mark-read ---- 活動タイムライン・シェアストーリーを見たことを記録する
collabRoutes.post("/activity/mark-read", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const now = Math.floor(Date.now() / 1000);
  const existing = await db.select().from(schema.collabActivityReads).where(eq(schema.collabActivityReads.memberId, meId)).get();
  if (existing) {
    await db.update(schema.collabActivityReads).set({ lastReadAt: now }).where(eq(schema.collabActivityReads.memberId, meId));
  } else {
    await db.insert(schema.collabActivityReads).values({ memberId: meId, lastReadAt: now });
  }

  return c.json({ ok: true });
});

// ---- GET /api/collab/activity/unread-count ---- 協働ナビのバッジ件数（内訳付き）
collabRoutes.get("/activity/unread-count", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const readRow = await db.select().from(schema.collabActivityReads).where(eq(schema.collabActivityReads.memberId, meId)).get();
  const lastReadAt = readRow?.lastReadAt ?? 0;

  const [myTeamRows, linkedLinks, newPosts, newComments, newStories, myAuthoredPostRows, myCoSignedRows, myStoryMemberRows] = await Promise.all([
    db.select({ teamId: schema.collabTeamMembers.teamId })
      .from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active")))
      .all(),
    db.select().from(schema.collaborationLinks)
      .where(or(eq(schema.collaborationLinks.memberLowId, meId), eq(schema.collaborationLinks.memberHighId, meId)))
      .all(),
    db.select().from(schema.collaborationPosts)
      .where(and(isNull(schema.collaborationPosts.deletedAt), gt(schema.collaborationPosts.createdAt, lastReadAt)))
      .all(),
    db.select().from(schema.collaborationComments)
      .where(and(isNull(schema.collaborationComments.deletedAt), gt(schema.collaborationComments.createdAt, lastReadAt)))
      .all(),
    db.select().from(schema.shareStories)
      .where(and(isNull(schema.shareStories.deletedAt), gt(schema.shareStories.createdAt, lastReadAt)))
      .all(),
    db.select({ id: schema.collaborationPosts.id }).from(schema.collaborationPosts)
      .where(eq(schema.collaborationPosts.authorId, meId)).all(),
    db.select({ postId: schema.collaborationPostMembers.postId }).from(schema.collaborationPostMembers)
      .where(eq(schema.collaborationPostMembers.memberId, meId)).all(),
    db.select({ storyId: schema.shareStoryMembers.storyId }).from(schema.shareStoryMembers)
      .where(eq(schema.shareStoryMembers.memberId, meId)).all(),
  ]);

  const myActiveTeamIds = new Set(myTeamRows.map((t) => t.teamId));
  const myLinkIds = new Set(linkedLinks.map((l) => l.id));

  const newPostIds = newPosts.map((p) => p.id);
  const newPostMembers = newPostIds.length > 0
    ? await db.select().from(schema.collaborationPostMembers).where(inArray(schema.collaborationPostMembers.postId, newPostIds)).all()
    : [];
  const membersByNewPost = new Map<string, string[]>();
  for (const pm of newPostMembers) {
    const arr = membersByNewPost.get(pm.postId) ?? [];
    arr.push(pm.memberId);
    membersByNewPost.set(pm.postId, arr);
  }

  // 新着投稿（自分の投稿は対象外、可視性は/feedと同じルールで判定）
  const newPostsCount = newPosts.filter((p) => {
    if (p.authorId === meId) return false;
    if ((membersByNewPost.get(p.id) ?? []).includes(meId)) return true;
    if (p.visibility === "private") return false;
    if (p.visibility === "chapter") return true;
    if (p.visibility === "team") {
      if (p.contextType === "team" && p.teamId) return myActiveTeamIds.has(p.teamId);
      if (p.contextType === "link" && p.linkId) return myLinkIds.has(p.linkId);
    }
    return false;
  }).length;

  // 自分の投稿・自分が関わる投稿への、他人からの新規コメント
  const myPostIds = new Set<string>([...myAuthoredPostRows.map((r) => r.id), ...myCoSignedRows.map((r) => r.postId)]);
  const newCommentsCount = newComments.filter((cm) => cm.authorId !== meId && myPostIds.has(cm.postId)).length;

  // 新着シェアストーリー（自分の投稿は対象外）
  const newStoryIds = newStories.map((s) => s.id);
  const newStoryMembers = newStoryIds.length > 0
    ? await db.select().from(schema.shareStoryMembers).where(inArray(schema.shareStoryMembers.storyId, newStoryIds)).all()
    : [];
  const membersByNewStory = new Map<string, string[]>();
  for (const sm of newStoryMembers) {
    const arr = membersByNewStory.get(sm.storyId) ?? [];
    arr.push(sm.memberId);
    membersByNewStory.set(sm.storyId, arr);
  }
  void myStoryMemberRows; // 参加チームの判定は membersByNewStory 側で行うため未使用

  const newStoriesCount = newStories.filter((s) => {
    if (s.authorId === meId) return false;
    if ((membersByNewStory.get(s.id) ?? []).includes(meId)) return true;
    if (s.visibility === "private") return false;
    if (s.visibility === "chapter") return true;
    if (s.visibility === "team" && s.teamId) return myActiveTeamIds.has(s.teamId);
    return false;
  }).length;

  const timeline = newPostsCount + newCommentsCount;
  return c.json({ data: { timeline, stories: newStoriesCount, total: timeline + newStoriesCount } });
});

// ---- GET /api/collab/reaction-notifications ---- 未読のリアクションメッセージ通知（ホーム画面用）
collabRoutes.get("/reaction-notifications", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ data: [] });

  const rows = await db.select().from(schema.collabReactionNotifications)
    .where(and(eq(schema.collabReactionNotifications.memberId, meId), isNull(schema.collabReactionNotifications.readAt)))
    .orderBy(desc(schema.collabReactionNotifications.createdAt))
    .all();
  if (rows.length === 0) return c.json({ data: [] });

  const postIds = [...new Set(rows.map((r) => r.postId))];
  const reactorIds = [...new Set(rows.map((r) => r.reactorId))];
  const [posts, reactors] = await Promise.all([
    db.select().from(schema.collaborationPosts).where(inArray(schema.collaborationPosts.id, postIds)).all(),
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members).where(inArray(schema.members.id, reactorIds)).all(),
  ]);
  const postMap = new Map(posts.map((p) => [p.id, p]));
  const reactorMap = new Map(reactors.map((m) => [m.id, m]));

  const data = rows.map((r) => ({
    id: r.id,
    reactionType: r.reactionType,
    message: r.message,
    createdAt: r.createdAt,
    reactor: reactorMap.get(r.reactorId) ?? { id: r.reactorId, name: "不明なメンバー", emoji: "❓", bgColor: "bg-stone-100" },
    post: postMap.get(r.postId)
      ? { id: r.postId, body: postMap.get(r.postId)!.body, createdAt: postMap.get(r.postId)!.createdAt }
      : { id: r.postId, body: null, createdAt: r.createdAt },
  }));

  return c.json({ data });
});

// ---- POST /api/collab/reaction-notifications/:id/read ---- リアクションメッセージ通知を既読にする
collabRoutes.post("/reaction-notifications/:id/read", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const id = c.req.param("id");
  const notif = await db.select().from(schema.collabReactionNotifications).where(eq(schema.collabReactionNotifications.id, id)).get();
  if (!notif || notif.memberId !== meId) return c.json({ error: { code: "not_found", message: "通知が見つかりません" } }, 404);

  await db.update(schema.collabReactionNotifications)
    .set({ readAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.collabReactionNotifications.id, id));

  return c.json({ ok: true });
});

// ---- POST /api/collab/posts ----
collabRoutes.post("/posts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{
    contextType: "link" | "team";
    partnerId?: string;
    teamId?: string;
    memberIds?: string[];
    body?: string;
    visibility?: "team" | "chapter" | "private";
    isPrivate?: boolean;
    occurredAt?: number; // 活動が起きた日時（未指定なら現在時刻）
  }>();

  if (body.contextType !== "link" && body.contextType !== "team") {
    return c.json({ error: { code: "invalid_input", message: "投稿の種類が不正です" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const occurredAt = typeof body.occurredAt === "number" && body.occurredAt > 0 ? body.occurredAt : now;
  let linkId: string | null = null;
  let teamId: string | null = null;
  let stageAtPost: string | null = null;
  let coMembers: string[] = [meId];

  if (body.contextType === "link") {
    if (!body.partnerId) return c.json({ error: { code: "invalid_input", message: "相手を指定してください" } }, 400);
    const [memberLowId, memberHighId] = normalizePair(meId, body.partnerId);
    let link = await db.select().from(schema.collaborationLinks)
      .where(and(eq(schema.collaborationLinks.memberLowId, memberLowId), eq(schema.collaborationLinks.memberHighId, memberHighId)))
      .get();
    if (!link) {
      const id = newId();
      await db.insert(schema.collaborationLinks).values({
        id, memberLowId, memberHighId, oneOnOneCount: 0, lastActivityAt: null,
        possibleLow: 0, possibleHigh: 0, referralLow: 0, referralHigh: 0,
        stage: "one", stalled: "active", createdAt: now, updatedAt: now,
      });
      link = await db.select().from(schema.collaborationLinks).where(eq(schema.collaborationLinks.id, id)).get()!;
    }
    linkId = link!.id;
    stageAtPost = link!.stage;
    coMembers = [meId, body.partnerId];
  } else {
    if (!body.teamId) return c.json({ error: { code: "invalid_input", message: "チームを指定してください" } }, 400);
    const membership = await db.select().from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, body.teamId), eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active")))
      .get();
    if (!membership) return c.json({ error: { code: "forbidden", message: "このチームのメンバーではありません" } }, 403);
    const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, body.teamId)).get();
    teamId = body.teamId;
    stageAtPost = team?.type === "power" ? "power" : "loose";
    coMembers = body.memberIds && body.memberIds.length > 0 ? [...new Set([meId, ...body.memberIds])] : [meId];
  }

  const postId = newId();
  await db.insert(schema.collaborationPosts).values({
    id: postId,
    authorId: meId,
    contextType: body.contextType,
    linkId,
    teamId,
    visibility: body.visibility ?? "chapter",
    isPrivate: body.isPrivate ? 1 : 0,
    stageAtPost,
    source: "user",
    body: body.body?.trim() || null,
    createdAt: occurredAt,
    updatedAt: now,
  });
  await db.insert(schema.collaborationPostMembers).values(
    coMembers.map((memberId) => ({ postId, memberId }))
  );

  return c.json({ data: { id: postId } }, 201);
});

// ---- PATCH /api/collab/posts/:id ----
collabRoutes.patch("/posts/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const postId = c.req.param("id");
  const post = await db.select().from(schema.collaborationPosts).where(eq(schema.collaborationPosts.id, postId)).get();
  if (!post || post.deletedAt) return c.json({ error: { code: "not_found", message: "投稿が見つかりません" } }, 404);
  if (post.authorId !== meId) return c.json({ error: { code: "forbidden", message: "自分の投稿のみ編集できます" } }, 403);

  const body = await c.req.json<{ body?: string; visibility?: "team" | "chapter" | "private"; isPrivate?: boolean }>();
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.collaborationPosts).set({
    ...(body.body !== undefined && { body: body.body?.trim() || null }),
    ...(body.visibility !== undefined && { visibility: body.visibility }),
    ...(body.isPrivate !== undefined && { isPrivate: body.isPrivate ? 1 : 0 }),
    updatedAt: now,
  }).where(eq(schema.collaborationPosts.id, postId));

  return c.json({ ok: true });
});

// ---- DELETE /api/collab/posts/:id ----
collabRoutes.delete("/posts/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const postId = c.req.param("id");
  const post = await db.select().from(schema.collaborationPosts).where(eq(schema.collaborationPosts.id, postId)).get();
  if (!post || post.deletedAt) return c.json({ error: { code: "not_found", message: "投稿が見つかりません" } }, 404);
  if (post.authorId !== meId) return c.json({ error: { code: "forbidden", message: "自分の投稿のみ削除できます" } }, 403);

  await db.update(schema.collaborationPosts)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.collaborationPosts.id, postId));

  return c.json({ ok: true });
});

// ---- POST /api/collab/posts/:id/reactions ----
collabRoutes.post("/posts/:id/reactions", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const postId = c.req.param("id");
  const { type, message } = await c.req.json<{ type: "ouen" | "shokai" | "join"; message?: string }>();
  if (!["ouen", "shokai", "join"].includes(type)) {
    return c.json({ error: { code: "invalid_input", message: "不正なリアクションです" } }, 400);
  }

  const post = await db.select().from(schema.collaborationPosts).where(eq(schema.collaborationPosts.id, postId)).get();
  if (!post || post.deletedAt) return c.json({ error: { code: "not_found", message: "投稿が見つかりません" } }, 404);
  if (post.source === "system") {
    return c.json({ error: { code: "invalid_input", message: "この投稿にはリアクションできません" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  if (type === "ouen") {
    // トグル
    const existing = await db.select().from(schema.collaborationPostReactions)
      .where(and(eq(schema.collaborationPostReactions.postId, postId), eq(schema.collaborationPostReactions.memberId, meId), eq(schema.collaborationPostReactions.type, "ouen")))
      .get();
    if (existing) {
      await db.delete(schema.collaborationPostReactions).where(eq(schema.collaborationPostReactions.id, existing.id));
      return c.json({ data: { on: false } });
    }
    await db.insert(schema.collaborationPostReactions).values({ id: newId(), postId, memberId: meId, type: "ouen", createdAt: now });
    return c.json({ data: { on: true } });
  }

  // shokai / join は追加のみ（既に押していれば何もしない）。
  // 初回リアクション時は「投稿者へのメッセージ」を必須にし、投稿者＋関係者へメール＋ホーム通知を送る。
  const existing = await db.select().from(schema.collaborationPostReactions)
    .where(and(eq(schema.collaborationPostReactions.postId, postId), eq(schema.collaborationPostReactions.memberId, meId), eq(schema.collaborationPostReactions.type, type)))
    .get();
  if (!existing) {
    const trimmedMessage = message?.trim() ?? "";
    if (!trimmedMessage) {
      return c.json({ error: { code: "invalid_input", message: "投稿者へのメッセージを入力してください" } }, 400);
    }

    await db.insert(schema.collaborationPostReactions).values({ id: newId(), postId, memberId: meId, type, createdAt: now });

    if (type === "join" && post.contextType === "team" && post.teamId) {
      const existingMembership = await db.select().from(schema.collabTeamMembers)
        .where(and(eq(schema.collabTeamMembers.teamId, post.teamId), eq(schema.collabTeamMembers.memberId, meId)))
        .get();
      if (!existingMembership) {
        await db.insert(schema.collabTeamMembers).values({
          id: newId(), teamId: post.teamId, memberId: meId, status: "pending",
          invitedBy: null, respondedAt: null, createdAt: now,
        });
      }
    }

    await notifyCollabReaction(db, c.env, { post, reactorId: meId, type, message: trimmedMessage, now });
  }

  return c.json({ data: { on: true } });
});

// ---- POST /api/collab/posts/:id/promote-to-story ---- シェアストーリーへ昇格（下書き生成）
collabRoutes.post("/posts/:id/promote-to-story", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const postId = c.req.param("id");
  const post = await db.select().from(schema.collaborationPosts).where(eq(schema.collaborationPosts.id, postId)).get();
  if (!post || post.deletedAt) return c.json({ error: { code: "not_found", message: "投稿が見つかりません" } }, 404);

  const now = Math.floor(Date.now() / 1000);
  const storyId = newId();
  await db.insert(schema.shareStories).values({
    id: storyId,
    teamId: post.teamId,
    seasonId: null,
    authorId: meId,
    title: post.body?.slice(0, 40) || "無題のシェアストーリー",
    summary: post.body ?? null,
    presentedOn: null,
    visibility: post.visibility,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  return c.json({ data: { id: storyId } }, 201);
});

/**
 * 会社名からWeb検索で事業概要を生成し、該当の人脈行に保存する。
 * 呼び出し側で c.executionCtx.waitUntil() を使うか、同期的に待つかを選べる
 * （登録時の自動生成は廃止し、実際に検索・参照された時や、ユーザーが明示的に
 * 「AIで生成」を押した時にだけ呼び出す）。
 */
async function generateAndSaveCompanySummary(
  db: ReturnType<typeof createDb>,
  env: Env,
  contactId: string,
  company: string,
  name: string
): Promise<void> {
  try {
    const result = await generateCompanySummary({
      company,
      name,
      apiKey: env.ANTHROPIC_API_KEY,
      isDev: env.ENVIRONMENT === "development",
    });
    await db.update(schema.externalContacts).set({
      businessSummary: result.summary,
      businessSummaryDetail: result.detail,
      businessSummaryStatus: result.status,
      businessSummaryGeneratedAt: Math.floor(Date.now() / 1000),
    }).where(eq(schema.externalContacts.id, contactId));
  } catch (err) {
    console.error("[collab] 会社概要の生成に失敗", contactId, err);
    await db.update(schema.externalContacts).set({
      businessSummaryStatus: "error",
      businessSummaryGeneratedAt: Math.floor(Date.now() / 1000),
    }).where(eq(schema.externalContacts.id, contactId)).catch(() => {});
  }
}

/** 複数件をまとめて生成する（CSV一括登録用）。API負荷を抑えるため少数ずつ並列実行する */
async function generateCompanySummariesForContacts(
  db: ReturnType<typeof createDb>,
  env: Env,
  contacts: { id: string; company: string; name?: string }[]
): Promise<void> {
  const CONCURRENCY = 3;
  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    const batch = contacts.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((c) => generateAndSaveCompanySummary(db, env, c.id, c.company, c.name ?? "")));
  }
}

/**
 * システム全体の「未生成（pending）」「生成中のまま停滞（processing）」の会社概要を、
 * 誰の登録かに関わらずまとめて処理する。1回のWorker呼び出しではwaitUntilの実行時間制限
 * （応答後およそ30秒）内に収まる件数しか処理できないため、まだ対象が残っていれば
 * 自分自身（このWorker）を新しいリクエストとして再度呼び出し、実行時間の制限をリセットしながら
 * 処理を継続する（Cron Triggerを使わない自己連鎖方式。Pages Functionsのデプロイ構成では
 * Cron Triggerが使えないため）。
 * 人脈が登録された直後にこの連鎖を開始することで、閲覧されるまで生成が始まらなかった
 * 従来の課題（遅延生成）を解消し、登録後すぐに全員分の生成が進むようにする。
 */
export async function sweepPendingCompanySummaries(
  db: ReturnType<typeof createDb>,
  env: Env,
  origin: string,
  hop: number
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const staleBefore = now - STALE_PROCESSING_SECONDS;

  const pendingFilter = and(
    or(
      eq(schema.externalContacts.businessSummaryStatus, "pending"),
      and(
        eq(schema.externalContacts.businessSummaryStatus, "processing"),
        or(
          isNull(schema.externalContacts.businessSummaryClaimedAt),
          lt(schema.externalContacts.businessSummaryClaimedAt, staleBefore)
        )
      )
    ),
    isNotNull(schema.externalContacts.company),
    ne(schema.externalContacts.company, ""),
    ne(schema.externalContacts.visibility, "private")
  );

  // まず対象IDを少数だけ確定させてから確認・claimを行う（一度に大量の行を抱え込まないため）
  const candidates = await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
    .where(pendingFilter)
    .limit(BACKGROUND_SWEEP_ROUND_SIZE)
    .all();
  if (candidates.length === 0) return;

  const candidateIds = candidates.map((c) => c.id);
  const claimed = await db.update(schema.externalContacts)
    .set({ businessSummaryStatus: "processing", businessSummaryClaimedAt: now })
    .where(and(inArray(schema.externalContacts.id, candidateIds), pendingFilter))
    .returning({ id: schema.externalContacts.id, company: schema.externalContacts.company, name: schema.externalContacts.name })
    .all();

  if (claimed.length > 0) {
    await generateCompanySummariesForContacts(db, env, claimed as { id: string; company: string; name: string }[]);
  }

  // 今回の取得件数が上限いっぱいだった場合、まだ他に対象が残っている可能性が高いので連鎖する
  if (candidates.length >= BACKGROUND_SWEEP_ROUND_SIZE && hop < BACKGROUND_SWEEP_MAX_HOPS) {
    await fetch(`${origin}/api/internal/sweep-pending-summaries`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-task-secret": env.INTERNAL_TASK_SECRET },
      body: JSON.stringify({ hop: hop + 1 }),
    }).catch((err) => console.error("[collab] sweepの自己連鎖呼び出しに失敗", err));
  }
}

// 関係性（BNI・倫理法人会 等）は複数所属できるため、入力値をトリム・重複除去してから扱う
function normalizeRelationships(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

// 対象人脈の関係性を丸ごと置き換える（一覧選択式のUIなので差分更新ではなく全置換にする）
async function replaceContactRelationships(
  db: ReturnType<typeof createDb>,
  contactId: string,
  relationships: string[]
): Promise<void> {
  await db.delete(schema.externalContactRelationships).where(eq(schema.externalContactRelationships.contactId, contactId));
  if (relationships.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.externalContactRelationships).values(
    relationships.map((relationship) => ({ id: newId(), contactId, relationship, createdAt: now }))
  );
}

// 複数の人脈に、それぞれの関係性一覧（relationships: string[]）を付与して返す
async function attachRelationships<T extends { id: string }>(
  db: ReturnType<typeof createDb>,
  rows: T[]
): Promise<(T & { relationships: string[] })[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const relRows = (
    await Promise.all(
      chunkIds(ids).map((chunk) =>
        db.select().from(schema.externalContactRelationships)
          .where(inArray(schema.externalContactRelationships.contactId, chunk)).all()
      )
    )
  ).flat();
  const map = new Map<string, string[]>();
  for (const r of relRows) {
    const list = map.get(r.contactId) ?? [];
    list.push(r.relationship);
    map.set(r.contactId, list);
  }
  return rows.map((row) => ({ ...row, relationships: map.get(row.id) ?? [] }));
}

// ---- GET /api/collab/contacts ---- 自分の人脈一覧（全項目・管理用）
collabRoutes.get("/contacts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select().from(schema.externalContacts)
    .where(eq(schema.externalContacts.ownerMemberId, meId))
    .orderBy(desc(schema.externalContacts.createdAt))
    .all();

  return c.json({ data: await attachRelationships(db, rows) });
});

// ---- POST /api/collab/contacts ---- 手動で1件登録
collabRoutes.post("/contacts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{
    name: string; specialty?: string; company?: string; relationships?: string[]; note?: string; visibility?: string;
    businessSummary?: string; businessSummaryDetail?: string;
    sourceBookingId?: string; // 外部ゲストとの予約から人脈登録した場合、その予約IDを紐づける
  }>();
  if (!body.name?.trim()) return c.json({ error: { code: "invalid_input", message: "名前を入力してください" } }, 400);

  const visibility = ["private", "existence", "full"].includes(body.visibility ?? "") ? body.visibility! : "existence";

  // 登録上限は非公開の人脈を含めない（非公開はメモ用途のため上限対象外）
  if (visibility !== "private") {
    const existingNonPrivateCount = await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
      .where(and(eq(schema.externalContacts.ownerMemberId, meId), ne(schema.externalContacts.visibility, "private"))).all();
    if (existingNonPrivateCount.length >= EXTERNAL_CONTACTS_LIMIT) {
      return c.json({ error: { code: "contact_limit_exceeded", message: `外部人脈は非公開を除いて合計${EXTERNAL_CONTACTS_LIMIT}件まで登録できます。すでに上限に達しています。` } }, 400);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  const company = body.company?.trim() || null;
  const businessSummary = body.businessSummary?.trim() || null;
  const businessSummaryDetail = body.businessSummaryDetail?.trim() || null;
  // 会社概要を手入力/AIで生成済みで送られてきた場合はそのまま保存し、
  // それ以外は「未生成（pending）」で保存したうえで、登録直後に生成を開始する（下記waitUntil）。
  await db.insert(schema.externalContacts).values({
    id, ownerMemberId: meId,
    name: body.name.trim(),
    specialty: body.specialty?.trim() || null,
    company,
    note: body.note?.trim() || null,
    visibility,
    source: "manual",
    createdAt: now, updatedAt: now,
    businessSummary,
    businessSummaryDetail,
    businessSummaryStatus: businessSummary ? "done" : (company ? "pending" : "skipped"),
    businessSummaryGeneratedAt: businessSummary ? now : null,
  });
  await replaceContactRelationships(db, id, normalizeRelationships(body.relationships));

  if (!businessSummary && company && visibility !== "private") {
    const origin = new URL(c.req.url).origin;
    c.executionCtx.waitUntil(sweepPendingCompanySummaries(db, c.env, origin, 0));
  }

  // 外部ゲストとの1to1予約から人脈登録した場合、その予約に人脈IDを紐づけて
  // ホーム画面の「人脈に追加しませんか？」プロンプトが再度出ないようにする
  if (body.sourceBookingId) {
    const booking = await db
      .select({ id: schema.bookings.id, guestMemberId: schema.bookings.guestMemberId })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.id, body.sourceBookingId), eq(schema.bookings.hostMemberId, meId)))
      .get();
    if (booking && !booking.guestMemberId) {
      await db.update(schema.bookings)
        .set({ externalContactId: id })
        .where(eq(schema.bookings.id, body.sourceBookingId));
    }
  }

  return c.json({ data: { id } }, 201);
});

// ---- POST /api/collab/contacts/import ---- CSVから一括登録（列マッピング済みの構造化データを受け取る）
collabRoutes.post("/contacts/import", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{
    source?: string;
    defaultVisibility?: string;
    contacts: { name: string; specialty?: string; company?: string; note?: string }[];
  }>();

  const visibility = ["private", "existence", "full"].includes(body.defaultVisibility ?? "") ? body.defaultVisibility! : "existence";
  const source = ["generic", "eight"].includes(body.source ?? "") ? body.source! : "manual";
  const rows = (body.contacts ?? []).filter((r) => r.name?.trim()).slice(0, 1000);
  if (rows.length === 0) return c.json({ error: { code: "invalid_input", message: "登録できる行がありません（名前が空です）" } }, 400);

  // 登録上限は非公開の人脈を含めない（非公開はメモ用途のため上限対象外）。取り込み先が非公開ならそもそも上限チェック不要。
  if (visibility !== "private") {
    const existingNonPrivateCount = await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
      .where(and(eq(schema.externalContacts.ownerMemberId, meId), ne(schema.externalContacts.visibility, "private"))).all();
    const remainingSlots = EXTERNAL_CONTACTS_LIMIT - existingNonPrivateCount.length;
    if (remainingSlots <= 0) {
      return c.json({ error: { code: "contact_limit_exceeded", message: `外部人脈は非公開を除いて合計${EXTERNAL_CONTACTS_LIMIT}件まで登録できます。すでに上限に達しているため、取り込めません。` } }, 400);
    }
    if (rows.length > remainingSlots) {
      return c.json({ error: { code: "contact_limit_exceeded", message: `外部人脈は非公開を除いて合計${EXTERNAL_CONTACTS_LIMIT}件まで登録できます。現在${existingNonPrivateCount.length}件登録済みのため、あと${remainingSlots}件までしか取り込めません（${rows.length}件を取り込もうとしています）。` } }, 400);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const shouldGenerateSummary = visibility !== "private";
  const values = rows.map((r) => {
    const company = r.company?.trim() || null;
    return {
      id: newId(), ownerMemberId: meId,
      name: r.name.trim(),
      specialty: r.specialty?.trim() || null,
      company,
      note: r.note?.trim() || null,
      visibility, source,
      createdAt: now, updatedAt: now,
      // 未生成（pending）のまま保存し、登録直後にバックグラウンドで生成を開始する（下記waitUntil）
      businessSummaryStatus: (company && shouldGenerateSummary) ? "pending" as const : "skipped" as const,
    };
  });

  // D1は1クエリあたりのバインド変数数に上限があり、まとめて数十件以上を
  // 一度にinsertすると "too many SQL variables" エラーになる（実測で確認済み）。
  // 1行10パラメータなので、余裕を持って5行（50パラメータ）ずつに分割する。
  const CHUNK_SIZE = 5;
  for (let i = 0; i < values.length; i += CHUNK_SIZE) {
    await db.insert(schema.externalContacts).values(values.slice(i, i + CHUNK_SIZE));
  }

  if (values.some((v) => v.businessSummaryStatus === "pending")) {
    const origin = new URL(c.req.url).origin;
    c.executionCtx.waitUntil(sweepPendingCompanySummaries(db, c.env, origin, 0));
  }

  return c.json({ data: { imported: rows.length } }, 201);
});

// D1のバインド変数上限を避けるため、IN句に渡すID件数を安全な単位に分割するヘルパー
const ID_CHUNK_SIZE = 50;
function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
  return chunks;
}

// ---- PATCH /api/collab/contacts/bulk ---- 選択した人脈をまとめて更新（公開範囲・専門分野・会社名/屋号・備考・関係性）
collabRoutes.patch("/contacts/bulk", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{
    ids: string[]; visibility?: string; specialty?: string; company?: string; note?: string; addRelationships?: string[];
  }>();
  const ids = [...new Set(body.ids ?? [])];
  if (ids.length === 0) return c.json({ error: { code: "invalid_input", message: "対象を選択してください" } }, 400);

  const patch: Record<string, unknown> = {};
  if (body.visibility !== undefined && ["private", "existence", "full"].includes(body.visibility)) {
    patch.visibility = body.visibility;
  }
  if (body.specialty !== undefined) {
    patch.specialty = body.specialty.trim() || null;
  }
  if (body.company !== undefined) {
    patch.company = body.company.trim() || null;
  }
  if (body.note !== undefined) {
    patch.note = body.note.trim() || null;
  }
  // 関係性は既存タグを消さず、指定したタグを未設定のものだけ追加する（一覧選択式の他項目とは異なり、丸ごと置換だと
  // 選択した人脈ごとに元々違うタグが付いていた場合に消えてしまい事故につながるため）
  const addRelationships = normalizeRelationships(body.addRelationships);

  if (Object.keys(patch).length === 0 && addRelationships.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "更新する内容がありません" } }, 400);
  }

  // 自分の所有分だけに絞り込む（他人の人脈IDが紛れ込んでいても無視される）
  // D1のバインド変数上限を避けるため、idsが多い場合に備えてチャンクごとに絞り込みクエリを実行する
  const ownRows: { id: string }[] = [];
  for (const idsChunk of chunkIds(ids)) {
    ownRows.push(...await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
      .where(and(eq(schema.externalContacts.ownerMemberId, meId), inArray(schema.externalContacts.id, idsChunk)))
      .all());
  }
  const ownIds = ownRows.map((r) => r.id);

  let updated = 0;
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = Math.floor(Date.now() / 1000);
    for (const idsChunk of chunkIds(ownIds)) {
      const result = await db.update(schema.externalContacts)
        .set(patch)
        .where(inArray(schema.externalContacts.id, idsChunk))
        .run();
      updated += result.meta?.changes ?? idsChunk.length;
    }
  } else {
    updated = ownIds.length;
  }

  if (addRelationships.length > 0 && ownIds.length > 0) {
    for (const idsChunk of chunkIds(ownIds)) {
      const existingRows = await db.select().from(schema.externalContactRelationships)
        .where(inArray(schema.externalContactRelationships.contactId, idsChunk)).all();
      const existingKeys = new Set(existingRows.map((r) => `${r.contactId}:${r.relationship}`));
      const now = Math.floor(Date.now() / 1000);
      const toInsert: { id: string; contactId: string; relationship: string; createdAt: number }[] = [];
      for (const contactId of idsChunk) {
        for (const relationship of addRelationships) {
          const key = `${contactId}:${relationship}`;
          if (!existingKeys.has(key)) {
            toInsert.push({ id: newId(), contactId, relationship, createdAt: now });
            existingKeys.add(key);
          }
        }
      }
      // D1のバインド変数上限を避けるため、1行4パラメータ × 20行=80パラメータずつに分割する
      for (let i = 0; i < toInsert.length; i += 20) {
        await db.insert(schema.externalContactRelationships).values(toInsert.slice(i, i + 20));
      }
    }
  }

  return c.json({ data: { updated } });
});

// ---- DELETE /api/collab/contacts/bulk ---- 選択した人脈をまとめて削除
collabRoutes.delete("/contacts/bulk", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{ ids: string[] }>();
  const ids = [...new Set(body.ids ?? [])];
  if (ids.length === 0) return c.json({ error: { code: "invalid_input", message: "対象を選択してください" } }, 400);

  // 自分の所有分だけに絞り込んでから削除する（他人の人脈IDが紛れ込んでいても無視される）
  // D1のバインド変数上限を避けるため、idsが多い場合に備えてチャンクごとに絞り込みクエリを実行する
  const ownRows: { id: string }[] = [];
  for (const idsChunk of chunkIds(ids)) {
    ownRows.push(...await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
      .where(and(eq(schema.externalContacts.ownerMemberId, meId), inArray(schema.externalContacts.id, idsChunk)))
      .all());
  }
  const ownIds = ownRows.map((r) => r.id);

  for (const idsChunk of chunkIds(ownIds)) {
    await db.delete(schema.externalContacts).where(inArray(schema.externalContacts.id, idsChunk));
    await db.delete(schema.collabIntroRequests).where(inArray(schema.collabIntroRequests.contactId, idsChunk));
    await db.delete(schema.externalContactRelationships).where(inArray(schema.externalContactRelationships.contactId, idsChunk));
    await db.delete(schema.externalContactFavorites).where(inArray(schema.externalContactFavorites.contactId, idsChunk));
    await db.delete(schema.enishiTransactedContacts).where(inArray(schema.enishiTransactedContacts.contactId, idsChunk));
    await db.delete(schema.enishiHiddenContacts).where(inArray(schema.enishiHiddenContacts.contactId, idsChunk));
    await db.delete(schema.enishiIntroducedContacts).where(inArray(schema.enishiIntroducedContacts.myContactId, idsChunk));
  }

  return c.json({ data: { deleted: ownIds.length } });
});

// ---- PATCH /api/collab/contacts/:id ----
collabRoutes.patch("/contacts/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const contactId = c.req.param("id");
  const contact = await db.select().from(schema.externalContacts).where(eq(schema.externalContacts.id, contactId)).get();
  if (!contact) return c.json({ error: { code: "not_found", message: "人脈が見つかりません" } }, 404);
  if (contact.ownerMemberId !== meId) return c.json({ error: { code: "forbidden", message: "自分の人脈のみ編集できます" } }, 403);

  const body = await c.req.json<{
    name?: string; specialty?: string; company?: string; relationships?: string[]; note?: string; visibility?: string;
    businessSummary?: string; businessSummaryDetail?: string;
  }>();
  const now = Math.floor(Date.now() / 1000);

  const finalCompany = body.company !== undefined ? (body.company?.trim() || null) : contact.company;

  // 会社概要欄が今回のリクエストで送られてきた場合は、その内容をそのまま確定（手入力／AI生成のいずれも同じ扱い）。
  // 送られてこず、会社名だけが変更された場合は、古い概要は無効として次に検索・参照された時に再生成できるようにする。
  let summaryPatch: Partial<typeof schema.externalContacts.$inferInsert> = {};
  if (body.businessSummary !== undefined || body.businessSummaryDetail !== undefined) {
    const summary = body.businessSummary?.trim() || null;
    summaryPatch = {
      businessSummary: summary,
      businessSummaryDetail: body.businessSummaryDetail?.trim() || null,
      businessSummaryStatus: summary ? "done" : (finalCompany ? "pending" : "skipped"),
      businessSummaryGeneratedAt: summary ? now : null,
    };
  } else if (body.company !== undefined && finalCompany !== contact.company) {
    summaryPatch = {
      businessSummary: null,
      businessSummaryDetail: null,
      businessSummaryStatus: finalCompany ? "pending" : "skipped",
      businessSummaryGeneratedAt: null,
    };
  }

  await db.update(schema.externalContacts).set({
    ...(body.name !== undefined && { name: body.name.trim() }),
    ...(body.specialty !== undefined && { specialty: body.specialty?.trim() || null }),
    ...(body.company !== undefined && { company: finalCompany }),
    ...(body.note !== undefined && { note: body.note?.trim() || null }),
    ...(body.visibility !== undefined && ["private", "existence", "full"].includes(body.visibility) && { visibility: body.visibility }),
    ...summaryPatch,
    updatedAt: now,
  }).where(eq(schema.externalContacts.id, contactId));

  if (body.relationships !== undefined) {
    await replaceContactRelationships(db, contactId, normalizeRelationships(body.relationships));
  }

  return c.json({ ok: true });
});

// ---- POST /api/collab/contacts/generate-summary-preview ---- フォームの「AIで生成」ボタン用（保存はしない、その場で結果だけ返す）
collabRoutes.post("/contacts/generate-summary-preview", async (c) => {
  const meId = await resolveEffectiveMemberId(createDb(c.env.DB), c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { company, name } = await c.req.json<{ company?: string; name?: string }>().catch(() => ({ company: undefined, name: undefined }));
  if (!company?.trim()) return c.json({ error: { code: "invalid_input", message: "会社名/屋号を入力してください" } }, 400);

  const result = await generateCompanySummary({
    company: company.trim(),
    name: name?.trim() ?? "",
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  return c.json({ data: result });
});

// ---- POST /api/collab/contacts/request-summaries ---- 「人脈をさがす」等で実際に画面に表示された人だけ、その場で生成をトリガーする（遅延生成）
collabRoutes.post("/contacts/request-summaries", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { ids } = await c.req.json<{ ids?: string[] }>().catch(() => ({ ids: undefined }));
  const targetIds = [...new Set(ids ?? [])].slice(0, LAZY_SUMMARY_BATCH_LIMIT);
  if (targetIds.length === 0) return c.json({ data: { processed: 0 } });

  const now = Math.floor(Date.now() / 1000);
  const staleBefore = now - STALE_PROCESSING_SECONDS;

  // 「未生成（pending）」に加えて、「processingのまま一定時間進捗がない行」も対象にする。
  // waitUntilの実行時間制限（応答後およそ30秒）に阻まれて生成が完走できなかった場合、
  // 従来はprocessingのまま二度と再試行されなかった（実際に発生を確認した不具合）。
  // 1つのUPDATE...WHERE...RETURNINGで確認と「生成中」への切り替えを同時に行うことで、
  // 同時に複数人が同じ相手を検索した際にAIを二重に呼んでしまうレースコンディションも防ぐ。
  const claimed = await db.update(schema.externalContacts)
    .set({ businessSummaryStatus: "processing", businessSummaryClaimedAt: now })
    .where(and(
      inArray(schema.externalContacts.id, targetIds),
      or(
        eq(schema.externalContacts.businessSummaryStatus, "pending"),
        and(
          eq(schema.externalContacts.businessSummaryStatus, "processing"),
          or(
            isNull(schema.externalContacts.businessSummaryClaimedAt),
            lt(schema.externalContacts.businessSummaryClaimedAt, staleBefore)
          )
        )
      ),
      isNotNull(schema.externalContacts.company),
      ne(schema.externalContacts.company, ""),
      ne(schema.externalContacts.visibility, "private")
    ))
    .returning({ id: schema.externalContacts.id, company: schema.externalContacts.company, name: schema.externalContacts.name })
    .all();
  if (claimed.length === 0) return c.json({ data: { processed: 0 } });

  // 1回のトリガーでは、waitUntilの実行時間制限内に確実に完了できる件数だけ実際に処理する。
  // 超過分はpendingに戻し、次にこの人脈が表示された際に改めて対象にする
  // （processingのまま溜め込んで新たな固着を生まないようにするため）。
  const toProcess = claimed.slice(0, LAZY_SUMMARY_ROUND_SIZE);
  const deferred = claimed.slice(LAZY_SUMMARY_ROUND_SIZE);
  if (deferred.length > 0) {
    await db.update(schema.externalContacts)
      .set({ businessSummaryStatus: "pending", businessSummaryClaimedAt: null })
      .where(inArray(schema.externalContacts.id, deferred.map((d) => d.id)));
  }

  c.executionCtx.waitUntil(generateCompanySummariesForContacts(db, c.env, toProcess as { id: string; company: string; name: string }[]));

  return c.json({ data: { processed: toProcess.length, remaining: deferred.length } });
});

// ---- POST /api/collab/contacts/bulk/generate-summary ---- 自分の人脈一覧から選択して一括AI生成（最大20件、同期的に結果を返す）
collabRoutes.post("/contacts/bulk/generate-summary", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { ids } = await c.req.json<{ ids?: string[] }>().catch(() => ({ ids: undefined }));
  const uniqueIds = [...new Set(ids ?? [])];
  if (uniqueIds.length === 0) return c.json({ error: { code: "invalid_input", message: "対象を選択してください" } }, 400);
  if (uniqueIds.length > BULK_SUMMARY_LIMIT) {
    return c.json({ error: { code: "bulk_limit_exceeded", message: `一括生成は一度に${BULK_SUMMARY_LIMIT}件までです。選択を減らしてください。` } }, 400);
  }

  const targets = await db.select({ id: schema.externalContacts.id, company: schema.externalContacts.company, name: schema.externalContacts.name })
    .from(schema.externalContacts)
    .where(and(eq(schema.externalContacts.ownerMemberId, meId), inArray(schema.externalContacts.id, uniqueIds)))
    .all();
  const withCompany = targets.filter((t): t is { id: string; company: string; name: string } => !!t.company);
  const skipped = targets.length - withCompany.length;

  await generateCompanySummariesForContacts(db, c.env, withCompany);

  return c.json({ data: { processed: withCompany.length, skipped } });
});

// ---- DELETE /api/collab/contacts/:id ----
collabRoutes.delete("/contacts/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const contactId = c.req.param("id");
  const contact = await db.select().from(schema.externalContacts).where(eq(schema.externalContacts.id, contactId)).get();
  if (!contact) return c.json({ error: { code: "not_found", message: "人脈が見つかりません" } }, 404);
  if (contact.ownerMemberId !== meId) return c.json({ error: { code: "forbidden", message: "自分の人脈のみ削除できます" } }, 403);

  await db.delete(schema.externalContacts).where(eq(schema.externalContacts.id, contactId));
  await db.delete(schema.collabIntroRequests).where(eq(schema.collabIntroRequests.contactId, contactId));
  await db.delete(schema.externalContactRelationships).where(eq(schema.externalContactRelationships.contactId, contactId));
  await db.delete(schema.externalContactFavorites).where(eq(schema.externalContactFavorites.contactId, contactId));
  await db.delete(schema.enishiTransactedContacts).where(eq(schema.enishiTransactedContacts.contactId, contactId));
  await db.delete(schema.enishiHiddenContacts).where(eq(schema.enishiHiddenContacts.contactId, contactId));
  await db.delete(schema.enishiIntroducedContacts).where(eq(schema.enishiIntroducedContacts.myContactId, contactId));

  return c.json({ ok: true });
});

// ---- POST /api/collab/contacts/:id/intro-request ---- 紹介依頼
collabRoutes.post("/contacts/:id/intro-request", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const contactId = c.req.param("id");
  const { message } = await c.req.json<{ message?: string }>().catch(() => ({ message: undefined }));

  const contact = await db.select().from(schema.externalContacts).where(eq(schema.externalContacts.id, contactId)).get();
  if (!contact) return c.json({ error: { code: "not_found", message: "人脈が見つかりません" } }, 404);
  if (contact.ownerMemberId === meId) {
    return c.json({ error: { code: "invalid_input", message: "自分の人脈には依頼できません" } }, 400);
  }
  if (contact.visibility === "private") {
    return c.json({ error: { code: "forbidden", message: "この人脈は非公開のため依頼できません" } }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  await db.insert(schema.collabIntroRequests).values({
    id, contactId, ownerMemberId: contact.ownerMemberId, requesterId: meId,
    message: message?.trim() || null, status: "pending", createdAt: now, respondedAt: null,
  });

  try {
    const [owner, requester] = await Promise.all([
      db.select({ email: schema.members.email, name: schema.members.name }).from(schema.members).where(eq(schema.members.id, contact.ownerMemberId)).get(),
      db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, meId)).get(),
    ]);
    if (owner?.email) {
      await new MailService(db, c.env).send("collab_intro_request", owner.email, {
        ownerName: owner.name,
        requesterName: requester?.name ?? "メンバー",
        contactName: contact.name,
      });
    }
  } catch (err) {
    console.error("[collab] 紹介依頼メール送信失敗", err);
  }

  return c.json({ data: { id } }, 201);
});

// ---- POST /api/collab/contacts/:id/favorite ---- 人脈をお気に入り登録
collabRoutes.post("/contacts/:id/favorite", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const contactId = c.req.param("id");
  const contact = await db.select().from(schema.externalContacts).where(eq(schema.externalContacts.id, contactId)).get();
  if (!contact) return c.json({ error: { code: "not_found", message: "人脈が見つかりません" } }, 404);
  if (contact.ownerMemberId !== meId && contact.visibility === "private") {
    return c.json({ error: { code: "forbidden", message: "この人脈はお気に入りに登録できません" } }, 403);
  }

  await db.insert(schema.externalContactFavorites).values({
    id: newId(), memberId: meId, contactId, createdAt: Math.floor(Date.now() / 1000),
  }).onConflictDoNothing();

  return c.json({ ok: true });
});

// ---- DELETE /api/collab/contacts/:id/favorite ---- お気に入り解除
collabRoutes.delete("/contacts/:id/favorite", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const contactId = c.req.param("id");
  await db.delete(schema.externalContactFavorites)
    .where(and(eq(schema.externalContactFavorites.memberId, meId), eq(schema.externalContactFavorites.contactId, contactId)));

  return c.json({ ok: true });
});

// ---- GET /api/collab/contacts/summary-issues ---- 自分が登録した人脈のうち、会社概要の生成が「該当なし」「エラー」だったもの一覧（ホーム画面通知用）
collabRoutes.get("/contacts/summary-issues", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select({
    id: schema.externalContacts.id,
    name: schema.externalContacts.name,
    company: schema.externalContacts.company,
    businessSummaryStatus: schema.externalContacts.businessSummaryStatus,
  }).from(schema.externalContacts)
    .where(and(
      eq(schema.externalContacts.ownerMemberId, meId),
      ne(schema.externalContacts.visibility, "private"),
      or(
        eq(schema.externalContacts.businessSummaryStatus, "error"),
        eq(schema.externalContacts.businessSummaryStatus, "not_found")
      )
    ))
    .orderBy(desc(schema.externalContacts.businessSummaryGeneratedAt))
    .all();

  return c.json({ data: rows });
});

// ---- GET /api/collab/contacts/intro-requests ---- 自分の人脈に届いた紹介依頼一覧
collabRoutes.get("/contacts/intro-requests", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select().from(schema.collabIntroRequests)
    .where(eq(schema.collabIntroRequests.ownerMemberId, meId))
    .orderBy(desc(schema.collabIntroRequests.createdAt))
    .all();
  if (rows.length === 0) return c.json({ data: [] });

  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const requesterIds = [...new Set(rows.map((r) => r.requesterId))];
  const [contacts, requesters] = await Promise.all([
    db.select().from(schema.externalContacts).where(inArray(schema.externalContacts.id, contactIds)).all(),
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members).where(inArray(schema.members.id, requesterIds)).all(),
  ]);
  const contactMap = new Map(contacts.map((ct) => [ct.id, ct]));
  const requesterMap = new Map(requesters.map((r) => [r.id, r]));

  const result = rows.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    createdAt: r.createdAt,
    contactName: contactMap.get(r.contactId)?.name ?? "削除済みの人脈",
    requester: requesterMap.get(r.requesterId) ?? null,
  }));

  return c.json({ data: result });
});

// ---- POST /api/collab/contacts/intro-requests/:id/handle ---- 対応済みにする
collabRoutes.post("/contacts/intro-requests/:id/handle", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const reqId = c.req.param("id");
  const row = await db.select().from(schema.collabIntroRequests).where(eq(schema.collabIntroRequests.id, reqId)).get();
  if (!row) return c.json({ error: { code: "not_found", message: "依頼が見つかりません" } }, 404);
  if (row.ownerMemberId !== meId) return c.json({ error: { code: "forbidden", message: "自分宛ての依頼のみ操作できます" } }, 403);

  await db.update(schema.collabIntroRequests)
    .set({ status: "handled", respondedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.collabIntroRequests.id, reqId));

  return c.json({ ok: true });
});

// ---- ユーティリティ ----
async function upsertLinkFlag(
  db: ReturnType<typeof createDb>,
  meId: string,
  otherMemberId: string,
  kind: "possible" | "referral",
  on: boolean
) {
  const [memberLowId, memberHighId] = normalizePair(meId, otherMemberId);
  const isLow = meId === memberLowId;
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .select()
    .from(schema.collaborationLinks)
    .where(and(eq(schema.collaborationLinks.memberLowId, memberLowId), eq(schema.collaborationLinks.memberHighId, memberHighId)))
    .get();

  const field = kind === "possible"
    ? (isLow ? "possibleLow" : "possibleHigh")
    : (isLow ? "referralLow" : "referralHigh");
  const promptedField = isLow ? "promptedCountLow" : "promptedCountHigh";

  if (existing) {
    const hasLoosePost = !!(await db.select({ id: schema.collaborationPosts.id })
      .from(schema.collaborationPosts)
      .where(and(
        eq(schema.collaborationPosts.contextType, "link"),
        eq(schema.collaborationPosts.linkId, existing.id),
        isNull(schema.collaborationPosts.deletedAt)
      ))
      .get());
    const updated = { ...existing, [field]: on ? 1 : 0 };
    const stage = deriveStage(updated, hasLoosePost);
    const stalled = computeStalled(updated.lastActivityAt, now);
    // possible/referralを自分から答えたということは、確認リマインダーにも答えたとみなす
    await db.update(schema.collaborationLinks)
      .set({ [field]: on ? 1 : 0, [promptedField]: existing.oneOnOneCount, stage, stalled, updatedAt: now })
      .where(eq(schema.collaborationLinks.id, existing.id));
    return { stage };
  }

  const base = {
    possibleLow: 0, possibleHigh: 0, referralLow: 0, referralHigh: 0, oneOnOneCount: 0,
  };
  const updated = { ...base, [field]: on ? 1 : 0 };
  const stage = deriveStage(updated, false); // 新規リンクにはまだ投稿がありえない

  try {
    await db.insert(schema.collaborationLinks).values({
      id: newId(),
      memberLowId, memberHighId,
      lastActivityAt: null,
      ...updated,
      stage,
      stalled: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { stage };
  } catch {
    // 同じメンバー間リンクへの possible/referral 更新が同時に飛んできた場合、
    // 両方とも「行がまだ存在しない」と判定してINSERTしにいき、片方がユニーク制約違反になりうる。
    // その場合は先に作られた行を取り直して更新側にフォールバックする。
    const raced = await db
      .select()
      .from(schema.collaborationLinks)
      .where(and(eq(schema.collaborationLinks.memberLowId, memberLowId), eq(schema.collaborationLinks.memberHighId, memberHighId)))
      .get();
    if (!raced) throw new Error("collaboration_links の作成に失敗しました");
    const racedUpdated = { ...raced, [field]: on ? 1 : 0 };
    const racedStage = deriveStage(racedUpdated, false);
    await db.update(schema.collaborationLinks)
      .set({ [field]: on ? 1 : 0, stage: racedStage, updatedAt: now })
      .where(eq(schema.collaborationLinks.id, raced.id));
    return { stage: racedStage };
  }
}
