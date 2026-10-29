// =============================================================
// マイページ — プロフィール・QR・ポイント履歴・スキル・編集
// =============================================================
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, QrCode, X, ChevronRight, Pencil, Camera, RefreshCw, CreditCard, Lock } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { useTimezone } from "@/hooks/use-timezone";
import { usePushNotifications } from "@/hooks/use-push";
import { useBroadcastNotifications } from "@/hooks/use-broadcast-notifications";
import { PointsSummary } from "@/components/points-summary";
import { fmtDateTime } from "@/lib/date";
import { buildSkillDescription } from "@shared/types";
import type { PublicMember, Skill } from "@shared/types";
import { ChangeEmailModal } from "./change-email-modal";
import { MemberProfileEditModal } from "@/components/member-profile-edit-modal";
import { ReminderDefaultsRow } from "@/components/reminder-settings";

import type { MemberBadge } from "@shared/types";

type MeResponse      = { data: { id: string; adminId?: string | null; name: string; email: string; emoji: string; bgColor: string; userType: string } };
type MemberResponse  = { data: PublicMember };
type MyRankResponse  = { data: { points: number; rank: number } };
type HistoryItem     = { id: string; delta: number; reason: string; label: string; detail?: string; createdAt: number };
type HistoryResponse = { data: HistoryItem[]; totalPoints: number };
type AdminMemberResponse = { data: { id: string; name: string; furigana: string; emoji: string; bgColor: string; category: string; businessDescription: string; skills: Skill[]; company?: string; role?: string; status: string } | null };
type CardImageResponse = { data: { imageDataUrl: string } };
type BadgesResponse = { data: MemberBadge[] };
type GoldenEgg  = { id: string; description: string };
type GoldenGoose = { id: string; description: string };
type GoldenEggsResponse  = { data: GoldenEgg[] };
type GoldenGeeseResponse = { data: GoldenGoose[] };

export function MypageScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, clearAuth } = useAuthStore();
  const approved = isApprovedMember(user);
  const { termUsp } = useSettings();
  const tz = useTimezone();
  const push = usePushNotifications();
  const { unreadCount: unreadNotificationCount } = useBroadcastNotifications();
  const [tab, setTab] = useState<"profile" | "history">("profile");
  const [showQr, setShowQr] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showChangeEmail, setShowChangeEmail] = useState(false);

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/auth/me"),
  });

  const memberId = meData?.data?.id ?? user?.id;
  const isAdmin = meData?.data?.userType === "admin";
  // 管理者でログインしていても、同じメールアドレスのメンバー登録がある人（adminId が付く）は、メンバーとしての表示・機能をすべて使える。
  // 「メンバーとしての情報がない管理者」だけが、簡易表示になる。
  const isAdminOnly = isAdmin && !meData?.data?.adminId;

  // 管理者の場合: 同メールアドレスのメンバーレコードを検索
  const { data: adminMemberData } = useQuery({
    queryKey: ["admin-my-member"],
    queryFn: () => api.get<AdminMemberResponse>("/admin/my-member"),
    enabled: isAdminOnly,
  });

  const { data: memberData, isLoading } = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => api.get<MemberResponse>(`/members/${memberId}`),
    enabled: !!memberId && !isAdminOnly,
  });

  const { data: rankData } = useQuery({
    queryKey: ["ranking", "me"],
    queryFn: () => api.get<MyRankResponse>("/ranking/me"),
    enabled: !isAdminOnly,
  });

  // 表示の主役はシーズンポイント（累計は rankData.points を「累計ポイントを見る」で表示）
  const { data: seasonRankData } = useQuery({
    queryKey: ["season", "ranking", "me"],
    queryFn: () => api.get<{ data: { points: number; rank: number | null; seasonName: string | null } }>("/season/ranking/me"),
    enabled: !isAdminOnly,
  });

  const { data: historyData } = useQuery({
    queryKey: ["points-history"],
    queryFn: () => api.get<HistoryResponse>("/ranking/history"),
    enabled: tab === "history" && !isAdminOnly && approved,
  });

  const { data: badgesData } = useQuery({
    queryKey: ["my-badges"],
    queryFn: () => api.get<BadgesResponse>("/members/me/badges"),
    enabled: !isAdminOnly && !!memberId,
  });

  const { data: goldenEggsData } = useQuery({
    queryKey: ["enishi", "eggs"],
    queryFn: () => api.get<GoldenEggsResponse>("/enishi/eggs"),
    enabled: !isAdminOnly,
  });
  const { data: goldenGeeseData } = useQuery({
    queryKey: ["enishi", "geese"],
    queryFn: () => api.get<GoldenGeeseResponse>("/enishi/geese"),
    enabled: !isAdminOnly,
  });

  // 外部人脈の登録件数（人脈の管理ページと同じデータ）
  const { data: externalContactsData } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: unknown[] }>("/collab/contacts"),
    enabled: !isAdminOnly && approved,
  });

  // 管理者の場合はadminMemberData、それ以外はmemberData
  const adminMember = adminMemberData?.data ?? null;
  const hasMemberProfile = isAdminOnly ? adminMember !== null : !!memberData?.data;
  const effectiveMemberId = isAdminOnly ? (adminMember?.id ?? null) : (memberId ?? null);

  // ---- 自分のカード画像（表面） ----
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const { data: cardImageData, isLoading: cardImageLoading } = useQuery({
    queryKey: ["card-image", effectiveMemberId],
    queryFn: () => api.get<CardImageResponse>(`/members/${effectiveMemberId}/card-image`),
    enabled: !!effectiveMemberId && hasMemberProfile,
    retry: false,
  });

  const cardImageMutation = useMutation({
    mutationFn: (imageBase64: string) => api.post("/members/me/card-image", { imageBase64 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["card-image", effectiveMemberId] });
      qc.invalidateQueries({ queryKey: ["member", memberId] });
    },
  });

  const handleCardImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      cardImageMutation.mutate(dataUrl.split(",")[1]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [cardImageMutation]);

  async function handleLogout() {
    await api.post("/auth/logout").catch(() => {});
    clearAuth();
    navigate("/login");
  }

  const member = isAdminOnly ? (adminMember as unknown as PublicMember | null) : (memberData?.data ?? null);
  const rank   = rankData?.data;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 pb-24 max-w-xl lg:max-w-3xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl lg:text-2xl font-semibold whitespace-nowrap" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          👤 マイページ
        </h1>
        <div className="flex gap-2">
          {/* スマホの下部メニューには「通知」がないため、ここから開けるようにする（未確認の件数つき） */}
          <Link to="/notifications"
            className="lg:hidden relative flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-xl font-medium whitespace-nowrap"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            🔔 通知
            {approved && unreadNotificationCount > 0 && (
              <span className="min-w-[18px] h-[18px] rounded-full text-white text-xs flex items-center justify-center px-1 font-bold"
                style={{ background: "var(--color-brand)" }}>
                {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
              </span>
            )}
          </Link>
          {isAdmin && (
            <Link to="/admin"
              className="text-sm px-3 py-1.5 rounded-xl font-medium"
              style={{ background: "var(--color-brand)", color: "white" }}>
              ⚙️ 管理
            </Link>
          )}
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-xl whitespace-nowrap"
            style={{ color: "var(--color-ink-400)", background: "var(--color-paper-200)" }}>
            <LogOut size={14} />
            ログアウト
          </button>
        </div>
      </div>

      {/* PC: 2カラムレイアウト / モバイル: 1カラム */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">

        {/* ===== 左カラム: プロフィール + マイカード + カード発注 ===== */}
        <div className="space-y-4 mb-4 lg:mb-0">
          {/* プロフィールカード */}
          <div className="card-paper rounded-3xl p-5">
            <div className="flex items-center gap-4 mb-4">
              <MemberAvatar
                memberId={effectiveMemberId ?? user?.id ?? ""}
                emoji={member?.emoji ?? user?.emoji ?? "🙂"}
                bgColor={member?.bgColor ?? user?.bgColor ?? "bg-amber-100"}
                avatarImageKey={(member as { avatarImageKey?: string | null } | null)?.avatarImageKey ?? user?.avatarImageKey}
                size="xl"
                rounded="rounded-2xl"
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold truncate" style={{ fontFamily: "var(--font-klee)" }}>
                  {member?.name ?? user?.name}
                </h2>
                {member?.furigana && <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>{member.furigana}</p>}
                {member?.category && <p className="text-sm font-medium mt-0.5" style={{ color: "var(--color-ink-600)" }}>{member.category}</p>}
              </div>
              {!isAdminOnly && hasMemberProfile && (
                <button onClick={() => setShowEdit(true)} className="p-2 rounded-xl active:opacity-70 hover:opacity-80 transition"
                  style={{ background: "var(--color-paper-200)" }}>
                  <Pencil size={16} style={{ color: "var(--color-ink-500)" }} />
                </button>
              )}
            </div>

            {member?.businessDescription && (
              <p className="text-sm leading-relaxed mb-4" style={{ color: "var(--color-ink-700)" }}>
                {member.businessDescription}
              </p>
            )}

            {/* QRコードボタン */}
            {effectiveMemberId && hasMemberProfile && (
              <button onClick={() => setShowQr(true)}
                className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 font-medium text-sm active:opacity-80 hover:opacity-80 transition"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                <QrCode size={18} />
                自分のQRコードを表示
              </button>
            )}

            {/* メールアドレスの変更（プロフィール編集とは別の独立した機能） */}
            {effectiveMemberId && (
              <button type="button" onClick={() => setShowChangeEmail(true)}
                className="mt-2 w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-2xl active:opacity-80 hover:opacity-90 transition"
                style={{ background: "var(--color-paper-100)" }}>
                <span className="text-lg">✉️</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>メールアドレスを変更する</div>
                  <div className="text-xs mt-0.5 break-all" style={{ color: "var(--color-ink-500)" }}>
                    ログインや各種のお知らせの送り先です。いまのメールアドレス：{meData?.data?.email ?? user?.email ?? ""}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-ink-400)" }} />
              </button>
            )}

            {/* スケジュール調整設定 */}
            <Link to="/scheduler"
              className="mt-2 flex items-center gap-3 px-3 py-2.5 rounded-2xl active:opacity-80 hover:opacity-90 transition"
              style={{ background: "var(--color-paper-100)" }}>
              <span className="text-lg">🗓️</span>
              <div className="flex-1">
                <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>日程調整設定</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>日程調整のためのGoogleカレンダーの連携、ミーティングツールのGoogle Meet、Zoomの設定、会議受付時間などの調整を行います</div>
              </div>
              <ChevronRight size={16} style={{ color: "var(--color-ink-400)" }} />
            </Link>

            {/* カラーテーマ設定 */}
            <Link to="/me/theme"
              className="mt-2 flex items-center gap-3 px-3 py-2.5 rounded-2xl active:opacity-80 hover:opacity-90 transition"
              style={{ background: "var(--color-paper-100)" }}>
              <span className="text-lg">🎨</span>
              <div className="flex-1">
                <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>カラーテーマ設定</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>自分のアカウントの表示にだけ適用されるカラーテーマを選べます（他のメンバーの表示には影響しません）</div>
              </div>
              <ChevronRight size={16} style={{ color: "var(--color-ink-400)" }} />
            </Link>

            {/* プッシュ通知設定 */}
            {!isAdminOnly && push.support !== "unsupported" && (
              <div className="mt-2 flex items-center gap-3 px-3 py-2.5 rounded-2xl"
                style={{ background: "var(--color-paper-100)" }}>
                <span className="text-lg">🔔</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>プッシュ通知</div>
                  {push.support === "ios-needs-install" ? (
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                      iPhoneで通知を受け取るには、まずこのアプリをホーム画面に追加してください（共有ボタン → 「ホーム画面に追加」）
                    </div>
                  ) : (
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                      {push.subscribed ? "メールと同じ内容をこの端末にも通知しています" : "メールでお届けしている通知を、この端末にも届けます"}
                    </div>
                  )}
                  {push.error && (
                    <div className="text-xs mt-1" style={{ color: "var(--color-brand)" }}>{push.error}</div>
                  )}
                </div>
                {push.support === "supported" && !push.loading && (
                  push.subscribed ? (
                    <button onClick={push.disable} disabled={push.busy}
                      className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full active:opacity-70 disabled:opacity-50 transition"
                      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      解除する
                    </button>
                  ) : (
                    <button onClick={push.enable} disabled={push.busy}
                      className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full active:opacity-70 disabled:opacity-50 transition"
                      style={{ background: "var(--color-brand)", color: "white" }}>
                      {push.busy ? "処理中…" : "有効にする"}
                    </button>
                  )
                )}
              </div>
            )}

            {/* リマインド通知の初期設定（プッシュ通知の次。承認済みメンバーのみ） */}
            {!isAdminOnly && approved && <ReminderDefaultsRow />}
          </div>

          {/* マイカード（撮影画像） */}
          {hasMemberProfile && (
            <div className="card-paper rounded-3xl p-5">
              <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>🃏 マイカード</h2>

              {cardImageLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                </div>
              ) : cardImageData?.data?.imageDataUrl ? (
                <div>
                  <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-paper-300)" }}>
                    <img src={cardImageData.data.imageDataUrl} alt="マイカード" className="w-full object-contain max-h-72" />
                  </div>
                  {!isAdminOnly && (
                    <button
                      onClick={() => cameraRef.current?.click()}
                      disabled={cardImageMutation.isPending}
                      className="mt-3 w-full py-2.5 rounded-2xl text-sm flex items-center justify-center gap-2 active:opacity-70 disabled:opacity-50"
                      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                    >
                      {cardImageMutation.isPending
                        ? <Loader2 size={14} className="animate-spin" />
                        : <RefreshCw size={14} />}
                      撮り直す
                    </button>
                  )}
                </div>
              ) : !isAdminOnly ? (
                <button
                  onClick={() => cameraRef.current?.click()}
                  disabled={cardImageMutation.isPending}
                  className="w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-10 active:opacity-80 transition disabled:opacity-50"
                  style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
                >
                  {cardImageMutation.isPending ? (
                    <Loader2 size={32} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                  ) : (
                    <>
                      <Camera size={32} style={{ color: "var(--color-paper-400)" }} />
                      <p className="text-sm font-medium" style={{ color: "var(--color-ink-500)" }}>タップしてカードを撮影</p>
                    </>
                  )}
                </button>
              ) : (
                <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>カード画像はまだありません</p>
              )}

              {!isAdminOnly && (
                <>
                  <button
                    onClick={() => galleryRef.current?.click()}
                    className="mt-2 w-full py-2 rounded-2xl text-xs flex items-center justify-center gap-1.5 active:opacity-70"
                    style={{ color: "var(--color-ink-500)" }}
                  >
                    🖼️ カメラロールから選ぶ
                  </button>
                  <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleCardImageChange} aria-hidden />
                  <input ref={galleryRef} type="file" accept="image/*" className="sr-only" onChange={handleCardImageChange} aria-hidden />
                </>
              )}
            </div>
          )}

          {/* カード発注 */}
          {!isAdminOnly && hasMemberProfile && (
            <CardOrderSection hasCardImage={!!cardImageData?.data?.imageDataUrl} />
          )}
        </div>

        {/* ===== 右カラム: ポイント + バッジ + 1to1 + USP/履歴タブ ===== */}
        <div className="space-y-4">
          {/* ポイント */}
          {!isAdminOnly && !approved && (
            <div className="card-paper rounded-3xl p-5 opacity-50">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)" }}>⭐ ポイント</h2>
                <Lock size={14} style={{ color: "var(--color-ink-400)" }} />
              </div>
              <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>承認されると表示されます</p>
            </div>
          )}
          {!isAdminOnly && approved && rank && (
            <div className="card-paper rounded-3xl p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)" }}>⭐ ポイント</h2>
                <button onClick={() => setTab("history")}
                  className="text-xs hover:underline" style={{ color: "var(--color-brand)" }}>
                  履歴を見る →
                </button>
              </div>
              {seasonRankData ? (
                <PointsSummary
                  size="xl"
                  seasonPoints={seasonRankData.data.points}
                  seasonName={seasonRankData.data.seasonName}
                  rank={seasonRankData.data.rank}
                  totalPoints={rank.points}
                />
              ) : (
                <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>読み込み中...</p>
              )}
            </div>
          )}

          {/* バッジ */}
          {!isAdminOnly && approved && badgesData && badgesData.data.length > 0 && (
            <div className="card-paper rounded-3xl p-5">
              <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>🏅 獲得バッジ</h2>
              <div className="flex flex-wrap gap-2">
                {badgesData.data.map((mb) => (
                  <div key={mb.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm" style={{ background: "var(--color-paper-200)" }}
                    title={mb.badge.description}>
                    <span>{mb.badge.emoji}</span>
                    <span style={{ color: "var(--color-ink-700)" }}>{mb.badge.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 1to1リンク */}
          {!isAdminOnly && (
            <Link to="/oneonone"
              className="card-paper rounded-3xl p-4 flex items-center gap-3 active:opacity-80 hover:opacity-90 transition block">
              <span className="text-2xl">🤝</span>
              <div className="flex-1">
                <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>1to1 の記録</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>申込・承諾・完了の確認</div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--color-ink-400)" }} />
            </Link>
          )}

          {/* USP/履歴タブ */}
          {hasMemberProfile && (
            <div>
              {/* タブ（管理者の場合はタブ切替なし・スキルのみ直接表示） */}
              {!isAdminOnly && (
                <div className="flex gap-2 mb-4">
                  {(["profile", "history"] as const).map((t) => {
                    const locked = t === "history" && !approved;
                    return (
                      <button key={t} onClick={() => !locked && setTab(t)}
                        disabled={locked}
                        className="flex-1 py-2 rounded-2xl text-sm font-medium transition flex items-center justify-center gap-1"
                        style={{
                          background: tab === t && !locked ? "var(--color-brand)" : "var(--color-paper-200)",
                          color: tab === t && !locked ? "white" : locked ? "var(--color-ink-300)" : "var(--color-ink-600)",
                          cursor: locked ? "not-allowed" : "pointer",
                        }}>
                        {{ profile: `✨ ${termUsp}`, history: "📊 履歴" }[t]}
                        {locked && <Lock size={12} />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* スキルタブ（管理者は常に表示、一般ユーザーはtab選択時） */}
              {(tab === "profile" || isAdminOnly) && (
                <div className="card-paper rounded-3xl p-5">
                  <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>✨ 私の{termUsp}</h2>
                  {member?.skills && member.skills.length > 0 ? (
                    <div className="space-y-3">
                      {member.skills.map((skill: Skill) => (
                        <div key={skill.name} className="flex items-start gap-3">
                          <span className="text-2xl shrink-0">{skill.emoji}</span>
                          <div>
                            <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{skill.name}</p>
                            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--color-ink-600)" }}>
                              {buildSkillDescription(skill)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>スキルが登録されていません</p>
                      {!isAdminOnly && (
                        <button onClick={() => setShowEdit(true)}
                          className="mt-3 text-sm px-4 py-2 rounded-2xl hover:opacity-80 transition"
                          style={{ background: "var(--color-brand)", color: "white" }}>
                          スキルを追加する
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ポイント履歴タブ */}
              {tab === "history" && approved && (
                <div className="card-paper rounded-3xl p-5">
                  <h2 className="text-base font-semibold mb-4" style={{ fontFamily: "var(--font-klee)" }}>📊 ポイント履歴</h2>
                  {!historyData ? (
                    <div className="flex justify-center py-8">
                      <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                    </div>
                  ) : historyData.data.length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: "var(--color-ink-400)" }}>
                      まだポイント履歴がありません
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {historyData.data.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 py-2 border-b last:border-0"
                          style={{ borderColor: "var(--color-paper-200)" }}>
                          <div className="flex-1">
                            <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{item.label}</p>
                            {item.detail && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{item.detail}</p>}
                            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                              {fmtDateTime(item.createdAt, tz)}
                            </p>
                          </div>
                          <div className="text-base font-bold shrink-0"
                            style={{ color: item.delta > 0 ? "var(--color-success)" : "var(--color-brand)" }}>
                            {item.delta > 0 ? "+" : ""}{item.delta}pt
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 金の卵・金のガチョウ */}
          {!isAdminOnly && !approved && (
            <div className="card-paper rounded-3xl p-5 opacity-50">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)" }}>🥚 金の卵・🪙 金のガチョウ</h2>
                <Lock size={14} style={{ color: "var(--color-ink-400)" }} />
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--color-ink-500)" }}>承認されると利用できます</p>
            </div>
          )}
          {!isAdminOnly && approved && (
            <div className="card-paper rounded-3xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)" }}>🥚 金の卵・🪙 金のガチョウ</h2>
                {goldenEggsData && goldenGeeseData && (
                  <span className="text-xs font-bold shrink-0 ml-2" style={{ color: "var(--color-accent)" }}>
                    卵 {goldenEggsData.data.length}/15 ・ ガチョウ {goldenGeeseData.data.length}/15
                  </span>
                )}
              </div>

              {(goldenEggsData?.data.length ?? 0) === 0 && (goldenGeeseData?.data.length ?? 0) === 0 ? (
                <p className="text-sm text-center py-4" style={{ color: "var(--color-ink-500)" }}>まだ登録がありません</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {goldenEggsData?.data.map((e) => (
                    <div key={e.id} className="text-xs px-3 py-2 rounded-xl line-clamp-2 leading-relaxed"
                      style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>
                      🥚 {e.description}
                    </div>
                  ))}
                  {goldenGeeseData?.data.map((g) => (
                    <div key={g.id} className="text-xs px-3 py-2 rounded-xl line-clamp-2 leading-relaxed"
                      style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>
                      🪙 {g.description}
                    </div>
                  ))}
                </div>
              )}

              <Link to="/enishi/register"
                className="text-sm font-medium py-2 rounded-2xl inline-flex items-center justify-center gap-1 w-full hover:opacity-80 transition"
                style={{ background: "var(--color-brand)", color: "white" }}>
                ✎ 登録・編集する
              </Link>
            </div>
          )}

          {/* 外部人脈（管理ページへのリンク） */}
          {!isAdminOnly && !approved && (
            <div className="card-paper rounded-3xl p-5 opacity-50">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)" }}>📇 外部人脈</h2>
                <Lock size={14} style={{ color: "var(--color-ink-400)" }} />
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--color-ink-500)" }}>承認されると利用できます</p>
            </div>
          )}
          {!isAdminOnly && approved && (
            <div className="card-paper rounded-3xl p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)" }}>📇 外部人脈</h2>
                {externalContactsData && (
                  <span className="text-xs font-bold shrink-0 ml-2" style={{ color: "var(--color-accent)" }}>
                    {externalContactsData.data.length}件 登録済み
                  </span>
                )}
              </div>
              <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
                チャプターの外のお知り合いを登録します。1件ずつの登録や、CSVからの取り込みができます。
                メールアドレス（任意）を登録しておくと、ミーティングへの招待が簡単になります（他のメンバーには見えません）。
              </p>
              <Link to="/members?tab=contacts"
                className="text-sm font-medium py-2 rounded-2xl inline-flex items-center justify-center gap-1 w-full hover:opacity-80 transition"
                style={{ background: "var(--color-brand)", color: "white" }}>
                ✎ 外部人脈を登録する
              </Link>
            </div>
          )}
        </div>

      </div>

      {/* QRモーダル（PC ではセンタリング） */}
      {showQr && effectiveMemberId && (
        <QrModal memberId={effectiveMemberId} memberName={member?.name ?? user?.name ?? ""} onClose={() => setShowQr(false)} />
      )}

      {/* メールアドレス変更モーダル */}
      {showChangeEmail && effectiveMemberId && (
        <ChangeEmailModal currentEmail={meData?.data?.email ?? user?.email ?? ""} onClose={() => setShowChangeEmail(false)} />
      )}

      {/* 編集モーダル（管理者セッションでは編集不可） */}
      {showEdit && member && memberId && !isAdminOnly && (
        <MemberProfileEditModal
          member={member}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            qc.invalidateQueries({ queryKey: ["member", memberId] });
            // ビジネスコミュニティ入会日等、認証ストア(useMe)側にも持つプロフィール項目があるため、
            // 保存直後にホーム画面の入力促しバナーがすぐ消えるよう合わせて無効化する
            qc.invalidateQueries({ queryKey: ["me"] });
          }}
        />
      )}
    </div>
  );
}

// ================================================================
// QRコードモーダル
// ================================================================
function QrModal({ memberId, memberName, onClose }: { memberId: string; memberName: string; onClose: () => void }) {
  const [qrUrl, setQrUrl] = useState<string>("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const url = `${window.location.origin}/receive-card/${memberId}`;
    QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: "#1A1410", light: "#FAF5E8" } })
      .then(setQrUrl);
  }, [memberId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="card-paper w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 pb-10 sm:pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)" }}>🃏 マイカード QR</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              このQRを相手がスキャンすると<br />リアルカードの受け取りが記録されます
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={18} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>
        <div className="flex flex-col items-center gap-4">
          {qrUrl ? (
            <div className="p-4 rounded-3xl" style={{ background: "#FAF5E8", border: "2px solid var(--color-paper-300)" }}>
              <img src={qrUrl} alt="QRコード" width={220} height={220} />
            </div>
          ) : (
            <div className="w-56 h-56 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-paper-200)" }}>
              <Loader2 size={32} className="animate-spin" style={{ color: "var(--color-brand)" }} />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
          <div className="text-center">
            <p className="font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>{memberName}</p>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>相手のスマホカメラで読み取ってください</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// プロフィール編集モーダル
// ================================================================
// カード発注セクション（マイページ用）
// ================================================================
function CardOrderSection({ hasCardImage }: { hasCardImage: boolean }) {
  const { data: settingsData } = useQuery({
    queryKey: ["card-print-settings"],
    queryFn: () => api.get<{ data: { enabled: boolean; companyName: string } | null }>("/card-print-settings"),
    retry: false,
  });
  const { data: ordersData } = useQuery({
    queryKey: ["card-orders", "my"],
    queryFn: () => api.get<{ data: Array<{ id: string; planName: string; status: string; createdAt: number }> }>("/card-orders/my"),
    retry: false,
  });

  const settings = settingsData?.data;
  const orders = ordersData?.data ?? [];
  // カード発注済み OR カード画像アップロード済み = カード作成済みメンバー
  const hasCreatedCard = orders.length > 0 || hasCardImage;

  if (!settings?.enabled) return null;

  const STATUS_LABELS: Record<string, string> = {
    pending: "⏳ 受付済み",
    processing: "🔧 制作中",
    completed: "✅ 完了",
    cancelled: "❌ キャンセル",
  };

  return (
    <div className="card-paper rounded-3xl p-5">
      <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>
        🃏 {hasCreatedCard ? "カードの追加作成" : "カードの新規作成"}
      </h2>

      {orders.length > 0 ? (
        <div className="space-y-2 mb-3">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between py-2 border-b last:border-0"
              style={{ borderColor: "var(--color-paper-300)" }}>
              <div>
                <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>{o.planName}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                  {new Date(o.createdAt * 1000).toLocaleDateString("ja-JP")}
                </p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full" style={{
                background: o.status === "pending" ? "rgba(181,56,75,0.1)" :
                  o.status === "completed" ? "rgba(90,140,92,0.1)" : "var(--color-paper-200)",
                color: o.status === "pending" ? "var(--color-brand)" :
                  o.status === "completed" ? "var(--color-success)" : "var(--color-ink-500)",
              }}>
                {STATUS_LABELS[o.status] ?? o.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm mb-3" style={{ color: "var(--color-ink-500)" }}>
          {hasCreatedCard
            ? "追加でカードを発注できます。"
            : "実際のカードを作成して、ゲームをさらに楽しみましょう！"}
        </p>
      )}

      <Link
        to={hasCreatedCard ? "/card-order?additional=1" : "/card-order"}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm font-semibold transition hover:opacity-80"
        style={{ background: "var(--color-brand)", color: "white" }}
      >
        <CreditCard size={15} />
        {hasCreatedCard ? "追加発注する" : "カードを新規作成する"}
      </Link>
    </div>
  );
}
