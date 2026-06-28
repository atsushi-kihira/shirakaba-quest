// =============================================================
// マイページ — プロフィール・QR・ポイント履歴・スキル・編集
// =============================================================
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, QrCode, X, ChevronRight, Pencil, Check, Plus, Trash2, Camera, RefreshCw, Upload, RotateCcw } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import QRCode from "qrcode";
import { api, API_BASE_URL } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateTime } from "@/lib/date";
import { queryClient as globalQc } from "@/lib/query-client";
import { buildSkillDescription } from "@shared/types";
import type { PublicMember, Skill } from "@shared/types";

import type { MemberBadge } from "@shared/types";

type MeResponse      = { data: { id: string; name: string; email: string; emoji: string; bgColor: string; userType: string } };
type MemberResponse  = { data: PublicMember };
type MyRankResponse  = { data: { points: number; rank: number } };
type HistoryItem     = { id: string; delta: number; reason: string; label: string; detail?: string; createdAt: number };
type HistoryResponse = { data: HistoryItem[]; totalPoints: number };
type AdminMemberResponse = { data: { id: string; name: string; furigana: string; emoji: string; bgColor: string; category: string; businessDescription: string; skills: Skill[]; company?: string; role?: string; status: string } | null };
type CardImageResponse = { data: { imageDataUrl: string } };
type BadgesResponse = { data: MemberBadge[] };

const AVATAR_BG = [
  { cls: "bg-rose-100" }, { cls: "bg-amber-100" }, { cls: "bg-emerald-100" },
  { cls: "bg-sky-100" }, { cls: "bg-violet-100" }, { cls: "bg-orange-100" },
];
const AVATAR_EMOJIS = ["😊","😄","🤗","😎","🥰","🌟","💪","🎯","🌸","🦁","🐯","🦊"];

export function MypageScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, clearAuth } = useAuthStore();
  const { termUsp } = useSettings();
  const tz = useTimezone();
  const [tab, setTab] = useState<"profile" | "history">("profile");
  const [showQr, setShowQr] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/auth/me"),
  });

  const memberId = meData?.data?.id ?? user?.id;
  const isAdmin = meData?.data?.userType === "admin";

  // 管理者の場合: 同メールアドレスのメンバーレコードを検索
  const { data: adminMemberData } = useQuery({
    queryKey: ["admin-my-member"],
    queryFn: () => api.get<AdminMemberResponse>("/admin/my-member"),
    enabled: isAdmin,
  });

  const { data: memberData, isLoading } = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => api.get<MemberResponse>(`/members/${memberId}`),
    enabled: !!memberId && !isAdmin,
  });

  const { data: rankData } = useQuery({
    queryKey: ["ranking", "me"],
    queryFn: () => api.get<MyRankResponse>("/ranking/me"),
    enabled: !isAdmin,
  });

  const { data: historyData } = useQuery({
    queryKey: ["points-history"],
    queryFn: () => api.get<HistoryResponse>("/ranking/history"),
    enabled: tab === "history" && !isAdmin,
  });

  const { data: badgesData } = useQuery({
    queryKey: ["my-badges"],
    queryFn: () => api.get<BadgesResponse>("/members/me/badges"),
    enabled: !isAdmin && !!memberId,
  });

  // 管理者の場合はadminMemberData、それ以外はmemberData
  const adminMember = adminMemberData?.data ?? null;
  const hasMemberProfile = isAdmin ? adminMember !== null : !!memberData?.data;
  const effectiveMemberId = isAdmin ? (adminMember?.id ?? null) : (memberId ?? null);

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
    globalQc.clear();
    navigate("/login");
  }

  const member = isAdmin ? (adminMember as unknown as PublicMember | null) : (memberData?.data ?? null);
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
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          👤 マイページ
        </h1>
        <div className="flex gap-2">
          {isAdmin && (
            <Link to="/admin"
              className="text-sm px-3 py-1.5 rounded-xl font-medium"
              style={{ background: "var(--color-brand)", color: "white" }}>
              ⚙️ 管理
            </Link>
          )}
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl"
            style={{ color: "var(--color-ink-400)", background: "var(--color-paper-200)" }}>
            <LogOut size={14} />
            ログアウト
          </button>
        </div>
      </div>

      {/* PC: 2カラムレイアウト / モバイル: 1カラム */}
      <div className="lg:grid lg:grid-cols-[1fr_1.2fr] lg:gap-6 lg:items-start">
        {/* 左カラム: プロフィール + ポイント */}
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
              {!isAdmin && hasMemberProfile && (
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
                  {!isAdmin && (
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
              ) : !isAdmin ? (
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

              {!isAdmin && (
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

          {/* ポイント */}
          {!isAdmin && rank && (
            <div className="card-paper rounded-3xl p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)" }}>⭐ ポイント</h2>
                <button onClick={() => setTab("history")}
                  className="text-xs hover:underline" style={{ color: "var(--color-brand)" }}>
                  履歴を見る →
                </button>
              </div>
              <div className="flex items-end gap-4">
                <div className="text-4xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
                  {rank.points}<span className="text-lg ml-1">pt</span>
                </div>
                <div className="text-sm pb-1" style={{ color: "var(--color-ink-500)" }}>
                  現在 <span className="font-bold text-lg" style={{ color: "var(--color-ink-800)" }}>{rank.rank}</span> 位
                </div>
              </div>
            </div>
          )}

          {/* バッジ */}
          {!isAdmin && badgesData && badgesData.data.length > 0 && (
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

          {/* 1to1リンク（PCでも左カラムに表示） */}
          {!isAdmin && (
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
        </div>

        {/* 右カラム: スキル / ポイント履歴タブ */}
        {hasMemberProfile && (
          <div>
            {/* タブ（管理者の場合はタブ切替なし・スキルのみ直接表示） */}
            {!isAdmin && (
              <div className="flex gap-2 mb-4">
                {(["profile", "history"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
                    style={{
                      background: tab === t ? "var(--color-brand)" : "var(--color-paper-200)",
                      color: tab === t ? "white" : "var(--color-ink-600)",
                    }}>
                    {{ profile: `✨ ${termUsp}`, history: "📊 履歴" }[t]}
                  </button>
                ))}
              </div>
            )}

            {/* スキルタブ（管理者は常に表示、一般ユーザーはtab選択時） */}
            {(tab === "profile" || isAdmin) && (
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
                    {!isAdmin && (
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
            {tab === "history" && (
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
      </div>

      {/* QRモーダル（PC ではセンタリング） */}
      {showQr && effectiveMemberId && (
        <QrModal memberId={effectiveMemberId} memberName={member?.name ?? user?.name ?? ""} onClose={() => setShowQr(false)} />
      )}

      {/* 編集モーダル（管理者セッションでは編集不可） */}
      {showEdit && member && memberId && !isAdmin && (
        <EditModal
          member={member}
          memberId={memberId}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            qc.invalidateQueries({ queryKey: ["member", memberId] });
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
const TIMEZONE_OPTIONS = [
  { value: "Asia/Tokyo",     label: "🇯🇵 日本標準時 (UTC+9)" },
  { value: "Asia/Seoul",     label: "🇰🇷 韓国標準時 (UTC+9)" },
  { value: "Asia/Shanghai",  label: "🇨🇳 中国標準時 (UTC+8)" },
  { value: "Asia/Singapore", label: "🇸🇬 シンガポール標準時 (UTC+8)" },
  { value: "Europe/London",  label: "🇬🇧 グリニッジ標準時 (UTC+0)" },
  { value: "Europe/Paris",   label: "🇫🇷 中央ヨーロッパ時間 (UTC+1)" },
  { value: "America/New_York", label: "🇺🇸 東部標準時 (UTC-5)" },
  { value: "America/Los_Angeles", label: "🇺🇸 太平洋標準時 (UTC-8)" },
  { value: "UTC",            label: "🌐 協定世界時 (UTC)" },
];

type EditForm = {
  name: string; furigana: string; emoji: string; bgColor: string;
  category: string; businessDescription: string; company: string; role: string;
  skills: Skill[];
  timezone: string;
};

function EditModal({ member, onClose, onSaved }: {
  member: PublicMember; memberId?: string; onClose: () => void; onSaved: () => void;
}) {
  const qcEdit = useQueryClient();
  const { user: authUser } = useAuthStore();
  const [form, setForm] = useState<EditForm>({
    name: member.name ?? "",
    furigana: member.furigana ?? "",
    emoji: member.emoji ?? "😊",
    bgColor: member.bgColor ?? "bg-rose-100",
    category: member.category ?? "",
    businessDescription: member.businessDescription ?? "",
    company: member.company ?? "",
    role: member.role ?? "",
    skills: (member.skills as Skill[]) ?? [],
    timezone: authUser?.timezone ?? "Asia/Tokyo",
  });
  const [error, setError] = useState("");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const hasAvatar = !!member.avatarImageKey || !!avatarPreview;

  const uploadAvatar = useMutation({
    mutationFn: (imageBase64: string) => api.post("/members/me/avatar", { imageBase64 }),
    onSuccess: () => {
      setUploadStatus("success");
      qcEdit.invalidateQueries({ queryKey: ["member", member.id] });
      qcEdit.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => {
      setUploadStatus("error");
      setAvatarPreview(null);
    },
  });

  const deleteAvatar = useMutation({
    mutationFn: () => api.delete("/members/me/avatar"),
    onSuccess: () => {
      setAvatarPreview(null);
      setUploadStatus("idle");
      qcEdit.invalidateQueries({ queryKey: ["member", member.id] });
      qcEdit.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/members/me`, {
      name: form.name,
      furigana: form.furigana,
      emoji: form.emoji,
      bgColor: form.bgColor,
      category: form.category,
      businessDescription: form.businessDescription,
      company: form.company,
      role: form.role,
      skills: form.skills,
      timezone: form.timezone,
    }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const updateSkill = (idx: number, field: keyof Skill, value: string) => {
    setForm((f) => {
      const skills = [...f.skills];
      skills[idx] = { ...skills[idx], [field]: value };
      return { ...f, skills };
    });
  };

  const addSkill = () => {
    if (form.skills.length >= 5) return;
    setForm((f) => ({ ...f, skills: [...f.skills, { name: "", emoji: "💡", issue: "", connector: "に対して、", solution: "", color: "bg-blue-100 ring-blue-300 text-blue-700" }] }));
  };

  const removeSkill = (idx: number) => {
    setForm((f) => ({ ...f, skills: f.skills.filter((_, i) => i !== idx) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="card-paper w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>✏️ プロフィール編集</h2>
          <button onClick={onClose} className="p-2 rounded-full active:opacity-70"><X size={20} /></button>
        </div>

        {error && <div className="mb-3 p-3 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>{error}</div>}

        <div className="space-y-4">
          {/* アバター */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: "var(--color-ink-500)" }}>アバター</label>
            <div className="flex items-center gap-4 mb-3">
              {/* プレビュー */}
              <div className={`w-14 h-14 rounded-2xl shrink-0 overflow-hidden flex items-center justify-center ${avatarPreview || member.avatarImageKey ? "" : form.bgColor}`}>
                {avatarPreview ? (
                  <img src={avatarPreview} alt="アバタープレビュー" className="w-full h-full object-cover" />
                ) : member.avatarImageKey ? (
                  <img src={`${API_BASE_URL}/members/${member.id}/avatar?t=${Date.now()}`} alt="アバター" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl">{form.emoji}</span>
                )}
              </div>
              <div className="flex flex-col gap-2 flex-1">
                <input ref={avatarFileRef} type="file" accept="image/png,image/jpeg" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadStatus("idle");
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const original = ev.target?.result as string;
                      const img = new Image();
                      img.onload = () => {
                        const ratio = Math.min(1, 160 / img.width, 160 / img.height);
                        const w = Math.round(img.width * ratio);
                        const h = Math.round(img.height * ratio);
                        const canvas = document.createElement("canvas");
                        canvas.width = w; canvas.height = h;
                        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
                        const resized = canvas.toDataURL("image/png");
                        setAvatarPreview(resized);
                        uploadAvatar.mutate(resized.split(",")[1]);
                      };
                      img.src = original;
                    };
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }} />
                <button type="button" onClick={() => avatarFileRef.current?.click()}
                  disabled={uploadAvatar.isPending}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium disabled:opacity-50"
                  style={{ background: "var(--color-brand)", color: "white" }}>
                  <Upload size={12} />
                  {uploadAvatar.isPending ? "アップロード中..." : "アバター画像をアップロード"}
                </button>
                {uploadStatus === "success" && (
                  <p className="text-xs font-medium" style={{ color: "var(--color-success)" }}>✅ アップロード完了</p>
                )}
                {uploadStatus === "error" && (
                  <p className="text-xs font-medium" style={{ color: "var(--color-brand)" }}>⚠️ アップロードに失敗しました</p>
                )}
                {hasAvatar && (
                  <button type="button" onClick={() => deleteAvatar.mutate()}
                    disabled={deleteAvatar.isPending}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
                    <RotateCcw size={12} />
                    絵文字に戻す
                  </button>
                )}
              </div>
            </div>
            {!hasAvatar && (
            <div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {AVATAR_EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                    className="text-xl w-9 h-9 rounded-full flex items-center justify-center active:scale-90"
                    style={{ outline: form.emoji === e ? "2px solid var(--color-brand)" : "none", background: form.emoji === e ? "var(--color-paper-200)" : "transparent" }}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {AVATAR_BG.map(({ cls }) => (
                  <button key={cls} type="button" onClick={() => setForm((f) => ({ ...f, bgColor: cls }))}
                    className={`w-8 h-8 rounded-full ${cls} active:scale-90`}
                    style={{ outline: form.bgColor === cls ? "2.5px solid var(--color-brand)" : "none", outlineOffset: "2px" }} />
                ))}
              </div>
            </div>
            )}
          </div>

          {/* 基本情報 */}
          {[
            { label: "名前 *",  key: "name",  ph: "山田 太郎" },
            { label: "ふりがな", key: "furigana", ph: "やまだ たろう" },
            { label: "職種",    key: "category", ph: "税理士、コンサルタント" },
            { label: "事業内容", key: "businessDescription", ph: "中小企業の節税・資産管理を支援" },
            { label: "会社名",  key: "company", ph: "〇〇株式会社" },
            { label: "役職",    key: "role",  ph: "代表取締役" },
          ].map(({ label, key, ph }) => (
            <div key={key}>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>{label}</label>
              <input
                value={(form as unknown as Record<string, string>)[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={ph}
                className="w-full rounded-2xl border px-3"
                style={{ fontSize: "16px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
              />
            </div>
          ))}

          {/* スキル */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold" style={{ color: "var(--color-ink-500)" }}>スキル（最大5つ）</label>
              {form.skills.length < 5 && (
                <button onClick={addSkill} className="flex items-center gap-1 text-xs px-2 py-1 rounded-xl"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
                  <Plus size={12} /> 追加
                </button>
              )}
            </div>
            <div className="space-y-3">
              {form.skills.map((skill, idx) => (
                <div key={idx} className="card-paper p-3 rounded-2xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold" style={{ color: "var(--color-brand)" }}>スキル {idx + 1}</span>
                    <button onClick={() => removeSkill(idx)} className="p-1 rounded-lg active:opacity-70">
                      <Trash2 size={12} style={{ color: "var(--color-brand)" }} />
                    </button>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input value={skill.emoji} onChange={(e) => updateSkill(idx, "emoji", e.target.value)}
                      className="w-12 text-center rounded-xl border" style={{ fontSize: "20px", padding: "6px", borderColor: "var(--color-paper-300)" }} maxLength={2} />
                    <input value={skill.name} onChange={(e) => updateSkill(idx, "name", e.target.value)}
                      placeholder="スキル名" className="flex-1 rounded-xl border px-3"
                      style={{ fontSize: "16px", padding: "8px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
                  </div>
                  <input value={skill.issue} onChange={(e) => updateSkill(idx, "issue", e.target.value)}
                    placeholder="課題シーン" className="w-full rounded-xl border px-3 mb-2"
                    style={{ fontSize: "16px", padding: "8px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
                  <input value={skill.solution} onChange={(e) => updateSkill(idx, "solution", e.target.value)}
                    placeholder="解決内容" className="w-full rounded-xl border px-3"
                    style={{ fontSize: "16px", padding: "8px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
                </div>
              ))}
            </div>
          </div>
        </div>

          {/* タイムゾーン */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-500)" }}>🕐 タイムゾーン</label>
            <select
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              className="w-full rounded-2xl border px-3"
              style={{ fontSize: "15px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
            >
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              日時の表示に使用するタイムゾーン（デフォルト: 日本標準時）
            </p>
          </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}
            className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            保存する
          </button>
        </div>
      </div>
    </div>
  );
}
