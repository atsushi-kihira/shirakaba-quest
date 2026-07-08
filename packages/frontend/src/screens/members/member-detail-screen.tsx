// =============================================================
// メンバー詳細画面 + 1to1フロー
// =============================================================
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Handshake, CheckCircle2, Clock, Phone, Mail, MapPin, Building2, Camera } from "lucide-react";
import { ImportCardModal } from "@/screens/oneonone/import-card-modal";
import { api, ApiError } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateISO } from "@/lib/date";
import { buildSkillDescription } from "@shared/types";
import type { PublicMember, Skill, MemberBadge } from "@shared/types";

type MemberResponse  = { data: PublicMember };
type OnoResponse     = { data: { id: string; status: string; partner?: unknown; myRole?: string; bothCompleted?: boolean } };
type OnoSession = { id: string; status: "pending" | "accepted" | "completed" | "rejected" | "cancelled"; requesterId: string; responderId: string; myRole: string; requesterCompletedAt: number | null; responderCompletedAt: number | null; completedAt: number | null; requesterSchedulerUrl?: string | null };
type OnoListResponse = { data: OnoSession[] };
type MySchedulerSettings = { data: { slug: string; isPublic: number } | null };
type CardImageResponse = { data: { imageDataUrl: string } };
type BadgesResponse = { data: MemberBadge[] };
type HistoryItem = { id: string; delta: number; label: string; detail?: string; createdAt: number };
type MemberHistoryResponse = { data: { totalPoints: number; history: HistoryItem[] } };

const STATUS_LABEL: Record<string, { label: string; emoji: string; className: string }> = {
  none:    { label: "未交流",   emoji: "🤝", className: "bg-stone-200 text-stone-600 ring-stone-300" },
  digital: { label: "デジタル", emoji: "📱", className: "bg-amber-200 text-amber-900 ring-amber-300" },
  real:    { label: "リアル✕2", emoji: "🃏", className: "bg-rose-500 text-white ring-rose-300" },
  self:    { label: "自分",     emoji: "👤", className: "bg-violet-100 text-violet-700 ring-violet-300" },
};

export function MemberDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const { termUsp } = useSettings();
  const tz = useTimezone();

  // isSelf はバックエンドの connectionStatus: "self" を使って判定
  // (管理者ログイン時も me.id が admin_id なので ID比較では不一致になるため)
  const isSelfById = me?.id === id;

  const { data, isLoading } = useQuery({
    queryKey: ["member", id],
    queryFn: () => api.get<MemberResponse>(`/members/${id}`),
    enabled: !!id,
  });

  const member = data?.data;
  // バックエンドが connectionStatus: "self" を返すので、それを isSelf として使う
  const isSelf = member ? member.connectionStatus === "self" : isSelfById;

  const { data: onoData } = useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<OnoListResponse>("/oneonone"),
    enabled: !isSelf,
  });

  const isUnlockedForCard = !!member && member.connectionStatus !== "none";

  const { data: cardImageData } = useQuery({
    queryKey: ["card-image", id],
    queryFn: () => api.get<CardImageResponse>(`/members/${id}/card-image`),
    enabled: !!id && isUnlockedForCard,
    retry: false,
  });

  const { data: badgesData } = useQuery({
    queryKey: ["member-badges", id],
    queryFn: () => api.get<BadgesResponse>(`/members/${id}/badges`),
    enabled: !!id,
  });

  const { data: memberHistoryData } = useQuery({
    queryKey: ["member-history", id],
    queryFn: () => api.get<MemberHistoryResponse>(`/members/${id}/history`),
    enabled: !!id,
  });

  const sessions = onoData?.data ?? [];

  // この相手との最新セッション
  const activeSession = sessions.find(
    (s) =>
      (s.requesterId === id || s.responderId === id) &&
      (s.status === "pending" || s.status === "accepted")
  );

  // 申込
  const [notifyByEmail, setNotifyByEmail] = useState(true);
  const requestMutation = useMutation({
    mutationFn: () => api.post<OnoResponse>("/oneonone", { responderId: id, notifyByEmail }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oneonone"] }),
  });

  // 自分の公開スケジュールURL（申込ボタン押下後に画面表示するため）
  const { data: mySchedulerData } = useQuery({
    queryKey: ["scheduler", "my-settings"],
    queryFn: () => api.get<MySchedulerSettings>("/scheduler/me/settings"),
  });
  const mySchedulerSettings = mySchedulerData?.data;
  const mySchedulerUrl = mySchedulerSettings?.isPublic && mySchedulerSettings.slug
    ? `${window.location.origin}/book/${mySchedulerSettings.slug}`
    : null;
  const [copiedSchedulerUrl, setCopiedSchedulerUrl] = useState(false);

  // 完了押下
  const completeMutation = useMutation({
    mutationFn: (sessionId: string) => api.patch<OnoResponse>(`/oneonone/${sessionId}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["member", id] });
      qc.invalidateQueries({ queryKey: ["members"] });
    },
  });

  // 完了取り消し
  const uncompleteMutation = useMutation({
    mutationFn: (sessionId: string) => api.patch(`/oneonone/${sessionId}/uncomplete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["ranking", "me"] });
      showToast("完了を取り消しました", true);
    },
    onError: (e: Error) => showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false),
  });

  // キャンセル
  const cancelMutation = useMutation({
    mutationFn: (sessionId: string) => api.patch(`/oneonone/${sessionId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      showToast("1to1をキャンセルしました", true);
    },
    onError: (e: Error) => showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false),
  });

  // 記録削除
  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => api.delete(`/oneonone/${sessionId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      showToast("記録を削除しました", true);
    },
    onError: (e: Error) => showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false),
  });


  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showImportCard, setShowImportCard] = useState(false);

  async function handleRequest() {
    try {
      await requestMutation.mutateAsync();
      showToast("1to1を申し込みました！🎉", true);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false);
    }
  }

  async function handleComplete(sessionId: string) {
    try {
      const res = await completeMutation.mutateAsync(sessionId);
      if (res.data.bothCompleted) {
        showToast("🎉 1to1完了！+1pt 獲得しました！", true);
      } else {
        showToast("✅ あなたの完了を記録しました。相手の確認を待っています", true);
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false);
    }
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }
  if (!member) return null;

  const connStatus = member.connectionStatus;
  const badge = STATUS_LABEL[connStatus] ?? STATUS_LABEL.none;
  // "self" も含めて none 以外なら解放済み
  const isUnlocked = connStatus !== "none";

  // この相手との完了・キャンセル・拒否済みセッション一覧
  const pastSessions = sessions.filter(
    (s) =>
      (s.requesterId === id || s.responderId === id) &&
      (s.status === "completed" || s.status === "cancelled" || s.status === "rejected")
  );

  // 自分がこのセッションで完了押下済みか
  const myRole = activeSession?.myRole;
  const alreadyCompleted = myRole === "requester"
    ? !!activeSession?.requesterCompletedAt
    : !!activeSession?.responderCompletedAt;

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      {/* 戻るボタン */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm mb-5"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={16} /> なかま一覧に戻る
      </button>

      {/* プロフィールカード */}
      <div className="card-paper rounded-3xl p-6 mb-4">
        <div className="flex items-start gap-4">
          <MemberAvatar
            memberId={member.id}
            emoji={member.emoji}
            bgColor={member.bgColor}
            avatarImageKey={member.avatarImageKey}
            size="xl"
            rounded="rounded-2xl"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>
                {member.name}
              </h1>
              <span className={`text-xs px-2.5 py-1 rounded-full ring-1 font-medium ${badge.className}`}>
                {badge.emoji} {badge.label}
              </span>
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              {member.furigana}
            </p>
            <p className="text-sm font-medium mt-1" style={{ color: "var(--color-ink-600)" }}>
              {member.category}
            </p>
          </div>
        </div>

        {/* 事業内容 */}
        <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-ink-700)" }}>
          {member.businessDescription}
        </p>

        {/* 名刺情報（1to1後に解放） */}
        {isUnlocked ? (
          <div className="mt-4 space-y-2">
            {member.company && (
              <InfoRow icon={<Building2 size={14} />} text={`${member.company}${member.role ? ` / ${member.role}` : ""}`} />
            )}
            {member.email && <InfoRow icon={<Mail size={14} />} text={member.email} />}
            {member.phone && <InfoRow icon={<Phone size={14} />} text={member.phone} />}
            {member.address && <InfoRow icon={<MapPin size={14} />} text={member.address} />}
          </div>
        ) : (
          <div className="mt-4 rounded-xl p-3 flex items-center gap-2"
            style={{ background: "var(--color-paper-200)" }}>
            <span className="text-lg">🔒</span>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              1to1を完了すると会社名・連絡先が表示されます
            </p>
          </div>
        )}
      </div>

      {/* リアルカード（撮影画像） */}
      {!isSelf && (
        <div className="card-paper rounded-3xl p-5 mb-4">
          <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>🃏 リアルカード</h2>
          {isUnlocked ? (
            cardImageData?.data?.imageDataUrl ? (
              <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-paper-300)" }}>
                <img src={cardImageData.data.imageDataUrl} alt={`${member.name}のカード`} className="w-full object-contain max-h-72" />
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>カード画像はまだ登録されていません</p>
            )
          ) : (
            <div className="rounded-xl p-3 flex items-center gap-2"
              style={{ background: "var(--color-paper-200)" }}>
              <span className="text-lg">🔒</span>
              <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                1to1を完了するとカード画像が見られます
              </p>
            </div>
          )}
        </div>
      )}

      {/* スキルカード */}
      <div className="card-paper rounded-3xl p-5 mb-4">
        <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>
          ✨ {termUsp}
        </h2>
        <div className="space-y-3">
          {member.skills.map((skill: Skill) => (
            <SkillRow key={skill.name} skill={skill} />
          ))}
        </div>
      </div>

      {/* バッジ */}
      {badgesData && badgesData.data.length > 0 && (
        <div className="card-paper rounded-3xl p-5 mb-4">
          <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>🏅 獲得バッジ</h2>
          <div className="flex flex-wrap gap-2">
            {badgesData.data.map((mb) => (
              <div key={mb.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm"
                style={{ background: "var(--color-paper-200)" }} title={mb.badge.description}>
                <span>{mb.badge.emoji}</span>
                <span style={{ color: "var(--color-ink-700)" }}>{mb.badge.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 1to1 アクションブロック（自分のページ以外） */}
      {!isSelf && (
        <div className="card-paper rounded-3xl p-5">
          <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>
            🤝 1to1
          </h2>

          {/* リアルカードを持っている → カード画像から直接登録（申し込み不要） */}
          {connStatus !== "real" && (
            <button
              onClick={() => setShowImportCard(true)}
              className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 font-medium text-sm transition mb-3"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)", border: "1.5px solid var(--color-paper-300)" }}
            >
              <Camera size={16} />
              🃏 カード画像から登録する（リアルカード交換済みの場合）
            </button>
          )}

          {connStatus === "real" && (
            <div className="rounded-xl p-3 mb-3 text-sm flex items-center gap-2"
              style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)" }}>
              <CheckCircle2 size={16} /> リアルカード取得済み ✨
            </div>
          )}

          {/* アクティブセッションがない → 申込ボタン */}
          {!activeSession && (
            <>
              {pastSessions.length > 0 && (
                <p className="text-xs mb-3 px-1" style={{ color: "var(--color-ink-500)" }}>
                  過去に {pastSessions.length} 回の1to1を実施済みです。何度でも申し込めます。
                </p>
              )}
              <label className="flex items-center gap-2 mb-3 text-sm cursor-pointer" style={{ color: "var(--color-ink-600)" }}>
                <input
                  type="checkbox"
                  checked={notifyByEmail}
                  onChange={(e) => setNotifyByEmail(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                📧 {member.name}さんにメールで通知する
              </label>
              <button
                onClick={handleRequest}
                disabled={requestMutation.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 font-medium text-sm transition disabled:opacity-50"
                style={{ background: "var(--color-brand)", color: "white" }}
              >
                {requestMutation.isPending
                  ? <><Loader2 size={16} className="animate-spin" /> 申込中...</>
                  : <><Handshake size={16} /> 1to1を申し込む</>
                }
              </button>
            </>
          )}

          {/* 申込中（相手待ち） */}
          {activeSession?.status === "pending" && myRole === "requester" && (
            <div className="space-y-2">
              <div className="rounded-xl p-3 text-sm flex items-center gap-2"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <Clock size={16} /> 相手の承諾を待っています...
              </div>

              {/* 自分の公開スケジュールURL（メールが届きにくい場合の代替共有用） */}
              {mySchedulerUrl ? (
                <div className="rounded-xl p-3" style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.2)" }}>
                  <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-success)" }}>
                    📅 あなたの予約URL（{member.name}さんに直接共有できます）
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs flex-1 truncate px-2 py-1.5 rounded-lg"
                      style={{ background: "white", color: "var(--color-ink-700)" }}>
                      {mySchedulerUrl}
                    </code>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(mySchedulerUrl);
                        setCopiedSchedulerUrl(true);
                        setTimeout(() => setCopiedSchedulerUrl(false), 2000);
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-medium flex-shrink-0"
                      style={{ background: "var(--color-success)", color: "white" }}
                    >
                      {copiedSchedulerUrl ? "コピー済み" : "コピー"}
                    </button>
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-500)" }}>
                    メールが届きにくい場合は、このURLをLINEなどで直接送ってください
                  </p>
                </div>
              ) : (
                <div className="rounded-xl p-3 text-xs" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-500)" }}>
                  💡 スケジュール調整設定を公開すると、ここに予約URLが表示され{member.name}さんに直接共有できます（マイページ → スケジュール調整設定）
                </div>
              )}

              <button
                onClick={() => cancelMutation.mutate(activeSession.id)}
                disabled={cancelMutation.isPending}
                className="w-full py-2 rounded-2xl text-xs font-medium disabled:opacity-50"
                style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
              >
                {cancelMutation.isPending ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                申込をキャンセルする
              </button>
            </div>
          )}

          {/* 完了ボタン */}
          {(activeSession?.status === "accepted" || activeSession?.status === "pending") && !alreadyCompleted && (
            <button
              onClick={() => handleComplete(activeSession.id)}
              disabled={completeMutation.isPending}
              className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 font-medium text-sm transition disabled:opacity-50"
              style={{ background: "var(--color-success)", color: "white" }}
            >
              {completeMutation.isPending
                ? <><Loader2 size={16} className="animate-spin" /> 記録中...</>
                : <><CheckCircle2 size={16} /> 1to1完了！</>
              }
            </button>
          )}

          {/* 承諾済みでキャンセル可 */}
          {activeSession?.status === "accepted" && !alreadyCompleted && (
            <button
              onClick={() => cancelMutation.mutate(activeSession.id)}
              disabled={cancelMutation.isPending}
              className="w-full mt-2 py-2 rounded-2xl text-xs font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
            >
              {cancelMutation.isPending ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
              この1to1をキャンセルする
            </button>
          )}

          {/* 完了押下済み（相手待ち）→ 取り消しボタン付き */}
          {activeSession && alreadyCompleted && (
            <div className="space-y-2">
              <div className="rounded-xl p-3 text-sm flex items-center gap-2"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <Clock size={16} /> あなたは完了済み。相手の確認を待っています
              </div>
              <button
                onClick={() => uncompleteMutation.mutate(activeSession.id)}
                disabled={uncompleteMutation.isPending}
                className="w-full py-2 rounded-2xl text-xs font-medium transition disabled:opacity-50"
                style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
              >
                {uncompleteMutation.isPending ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                完了を取り消す
              </button>
            </div>
          )}

          {/* 過去の1to1履歴 */}
          {pastSessions.length > 0 && !activeSession && (
            <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-500)" }}>📋 1to1履歴</p>
              <div className="space-y-1.5">
                {pastSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs px-1 gap-2">
                    {s.status === "completed" ? (
                      <span style={{ color: "var(--color-success)" }}>
                        <CheckCircle2 size={12} className="inline mr-1" />完了
                      </span>
                    ) : s.status === "cancelled" ? (
                      <span style={{ color: "var(--color-ink-400)" }}>キャンセル</span>
                    ) : (
                      <span style={{ color: "var(--color-ink-400)" }}>辞退</span>
                    )}
                    <span className="flex-1 text-right" style={{ color: "var(--color-ink-400)" }}>
                      {s.completedAt ? fmtDateISO(s.completedAt, tz) : ""}
                    </span>
                    <div className="flex gap-2 shrink-0">
                      {s.status === "completed" && (
                        <button
                          onClick={() => uncompleteMutation.mutate(s.id)}
                          disabled={uncompleteMutation.isPending}
                          className="text-xs underline disabled:opacity-50"
                          style={{ color: "var(--color-ink-400)" }}
                        >
                          取り消す
                        </button>
                      )}
                      <button
                        onClick={() => deleteMutation.mutate(s.id)}
                        disabled={deleteMutation.isPending}
                        className="text-xs underline disabled:opacity-50"
                        style={{ color: "var(--color-ink-400)" }}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ポイント・活動履歴 */}
      {memberHistoryData?.data && (
        <div className="card-paper rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⭐️</span>
            <h3 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
              獲得ポイント・活動履歴
            </h3>
          </div>
          <div className="text-3xl font-bold mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
            {memberHistoryData.data.totalPoints}
            <span className="text-base ml-1 font-normal" style={{ color: "var(--color-ink-400)" }}>pt</span>
          </div>
          {memberHistoryData.data.history.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>まだ活動記録がありません</p>
          ) : (
            <div className="space-y-1.5">
              {memberHistoryData.data.history.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium leading-snug" style={{ color: "var(--color-ink-700)" }}>{item.label}</p>
                    {item.detail && (
                      <p className="text-xs leading-snug" style={{ color: "var(--color-ink-500)" }}>{item.detail}</p>
                    )}
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                      {fmtDateISO(item.createdAt, tz)}
                    </p>
                  </div>
                  <span className="text-sm font-bold shrink-0 ml-2" style={{ color: item.delta >= 0 ? "var(--color-accent)" : "var(--color-brand)" }}>
                    {item.delta >= 0 ? "+" : ""}{item.delta}pt
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* トースト通知 */}
      {toast && (
        <div
          className="fixed bottom-24 left-4 right-4 rounded-2xl px-4 py-3 text-sm font-medium shadow-lg transition-all z-50"
          style={{
            background: toast.ok ? "var(--color-success)" : "#dc2626",
            color: "white",
            maxWidth: "480px",
            margin: "0 auto",
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* カード画像から登録モーダル */}
      {showImportCard && (
        <ImportCardModal
          onClose={() => {
            setShowImportCard(false);
            qc.invalidateQueries({ queryKey: ["member", id] });
          }}
          targetMember={{
            id: member.id,
            name: member.name,
            emoji: member.emoji,
            bgColor: member.bgColor,
            category: member.category ?? "",
            businessDescription: member.businessDescription,
            connectionStatus: connStatus === "self" || connStatus === "none" || connStatus === "digital" || connStatus === "real"
              ? (connStatus as "none" | "digital" | "real")
              : "none",
          }}
        />
      )}
    </div>
  );
}

function SkillRow({ skill }: { skill: Skill }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`text-xs px-2.5 py-1 rounded-full ring-1 font-medium shrink-0 ${skill.color}`}
      >
        {skill.emoji} {skill.name}
      </span>
      <p className="text-xs leading-relaxed pt-0.5" style={{ color: "var(--color-ink-600)" }}>
        {buildSkillDescription(skill)}
      </p>
    </div>
  );
}

function InfoRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-600)" }}>
      <span style={{ color: "var(--color-ink-400)" }}>{icon}</span>
      {text}
    </div>
  );
}
