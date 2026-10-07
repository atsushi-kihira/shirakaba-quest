// =============================================================
// 管理画面 — メンバー詳細
// 一般ユーザーがメンバーのプロフィールで確認できる内容（名刺情報・カード画像・USP・協働の状況・
// 金の卵/ガチョウ・バッジ・ポイント/活動履歴）を、1to1の有無にかかわらずすべて表示する。
// ポイントの見せ方（シーズン／累計）は、一般ユーザーのプロフィールと同じ PointsSummary を使う。
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { Building2, Calendar, Mail, MapPin, Phone, X } from "lucide-react";
import { api } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { PointsSummary } from "@/components/points-summary";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateISO, fmtDateTimeFull } from "@/lib/date";
import { buildSkillDescription } from "@shared/types";
import type { MemberBadge, Skill } from "@shared/types";

export type AdminMemberDetailBase = {
  id: string;
  name: string;
  furigana: string;
  romaji?: string | null;
  email: string;
  emoji: string;
  bgColor: string;
  avatarImageKey?: string | null;
  category: string;
  businessDescription: string | null;
  company: string | null;
  role: string | null;
  phone?: string | null;
  address?: string | null;
  qrCodeUrl?: string | null;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  customFields?: Record<string, unknown> | null;
  businessCommunityJoinedDate?: string | null;
  skills: Skill[];
  status: string;
  approvedAt: number | null;
  createdAt: number;
};

type Detail = {
  guilds: { id: string; name: string; emblemEmoji: string; isLeader: boolean }[];
  collabTeams: { id: string; name: string; type: "loose" | "power"; status: "active" | "pending" | "declined" }[];
  seedPartners: { id: string; name: string; emoji: string }[];
  oneOnOneCompleted: number;
  externalContacts: { total: number; private: number; existence: number; full: number };
  goldenEggs: { id: string; description: string; issue: string | null }[];
  goldenGeese: { id: string; description: string; contactHypothesis: string | null }[];
  lastLoginAt: number | null;
  hasCardImage: boolean;
};
type HistoryItem = { id: string; delta: number; label: string; detail?: string; createdAt: number };
type History = { totalPoints: number; seasonPoints: number; seasonName: string | null; history: HistoryItem[] };

const STATUS_LABEL: Record<string, string> = {
  pending: "承認待ち", active: "アクティブ", guest: "ゲストユーザー", on_leave: "休会中", rejected: "利用却下", deleted: "削除済み",
};

const SECTION = "card-paper rounded-2xl p-4";
const H = { fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" } as const;

function fmtJoinedDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm" style={{ color: "var(--color-ink-700)" }}>
      <span className="mt-0.5 shrink-0" style={{ color: "var(--color-ink-400)" }}>{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function AdminMemberDetailModal({ member, onClose }: { member: AdminMemberDetailBase; onClose: () => void }) {
  const { termUsp, termBusinessCommunity, timezone: tz } = useSettings();
  const id = member.id;

  const { data: detailData, isLoading } = useQuery({
    queryKey: ["admin", "member-detail", id],
    queryFn: () => api.get<{ data: Detail }>(`/admin/members/${id}/detail`),
  });
  const detail = detailData?.data;

  const { data: cardData } = useQuery({
    queryKey: ["admin", "member-card-image", id],
    queryFn: () => api.get<{ data: { imageDataUrl: string } }>(`/admin/members/${id}/card-image`),
    enabled: !!detail?.hasCardImage,
    retry: false,
  });
  const { data: badgesData } = useQuery({
    queryKey: ["member-badges", id],
    queryFn: () => api.get<{ data: MemberBadge[] }>(`/members/${id}/badges`),
  });
  const { data: historyData } = useQuery({
    queryKey: ["member-history", id, "admin"],
    queryFn: () => api.get<{ data: History }>(`/members/${id}/history?limit=50`),
  });
  const history = historyData?.data;

  const customFields = Object.entries(member.customFields ?? {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  const hasBack = !!(member.company || member.role || member.email || member.phone || member.address
    || member.facebookUrl || member.linkedinUrl || member.instagramUrl || member.qrCodeUrl || customFields.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-4 sm:p-5 space-y-3"
        style={{ background: "var(--color-paper-100)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>メンバー詳細</h2>
          <button onClick={onClose} className="p-1.5 rounded-full" aria-label="閉じる"><X size={18} style={{ color: "var(--color-ink-500)" }} /></button>
        </div>

        {/* 基本情報 */}
        <div className={SECTION}>
          <div className="flex items-center gap-3">
            <MemberAvatar memberId={id} emoji={member.emoji} bgColor={member.bgColor} avatarImageKey={member.avatarImageKey} size="xl" rounded="rounded-2xl" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>{member.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                  {STATUS_LABEL[member.status] ?? member.status}
                </span>
              </div>
              <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>{member.furigana}{member.romaji ? `（${member.romaji}）` : ""}</p>
              {member.category && <p className="text-sm font-medium mt-0.5" style={{ color: "var(--color-ink-600)" }}>{member.category}</p>}
            </div>
          </div>
          {member.businessDescription && (
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{member.businessDescription}</p>
          )}
          <div className="mt-3 space-y-1 text-xs" style={{ color: "var(--color-ink-500)" }}>
            {member.businessCommunityJoinedDate && (
              <p className="flex items-center gap-1"><Calendar size={12} />{termBusinessCommunity}入会日：{fmtJoinedDate(member.businessCommunityJoinedDate)}</p>
            )}
            <p>登録：{fmtDateISO(member.createdAt, tz)}{member.approvedAt ? `　承認：${fmtDateISO(member.approvedAt, tz)}` : ""}</p>
            <p>最終ログイン：{detail ? (detail.lastLoginAt ? fmtDateTimeFull(detail.lastLoginAt, tz) : "ログイン記録なし") : "…"}</p>
          </div>
        </div>

        {/* 名刺情報（一般ユーザーは1to1後に見られる内容） */}
        <div className={SECTION}>
          <h3 className="text-sm font-semibold mb-2" style={H}>🪪 名刺情報</h3>
          {hasBack ? (
            <div className="space-y-1.5">
              {(member.company || member.role) && <Row icon={<Building2 size={14} />}>{member.company}{member.role ? ` / ${member.role}` : ""}</Row>}
              {member.email && <Row icon={<Mail size={14} />}>{member.email}</Row>}
              {member.phone && <Row icon={<Phone size={14} />}>{member.phone}</Row>}
              {member.address && <Row icon={<MapPin size={14} />}>{member.address}</Row>}
              {([["Facebook", member.facebookUrl], ["LinkedIn", member.linkedinUrl], ["Instagram", member.instagramUrl], ["QRコードのリンク", member.qrCodeUrl]] as const)
                .filter(([, url]) => !!url).map(([label, url]) => (
                  <Row key={label} icon={<span className="text-[10px] font-bold">🔗</span>}>
                    {label}：<a href={url!} target="_blank" rel="noreferrer" className="underline break-all" style={{ color: "var(--color-brand)" }}>{url}</a>
                  </Row>
                ))}
              {customFields.map(([k, v]) => (
                <Row key={k} icon={<span className="text-[10px]">▪</span>}>{k}：{String(v)}</Row>
              ))}
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>名刺情報はまだ登録されていません</p>
          )}
        </div>

        {/* リアルカード画像 */}
        <div className={SECTION}>
          <h3 className="text-sm font-semibold mb-2" style={H}>🃏 リアルカード</h3>
          {cardData?.data.imageDataUrl ? (
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--color-paper-300)" }}>
              <img src={cardData.data.imageDataUrl} alt={`${member.name}のカード`} className="w-full object-contain max-h-72" />
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{isLoading || detail?.hasCardImage ? "読み込み中..." : "カード画像はまだ登録されていません"}</p>
          )}
        </div>

        {/* USP */}
        <div className={SECTION}>
          <h3 className="text-sm font-semibold mb-2" style={H}>✨ {termUsp}</h3>
          {member.skills.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>まだ登録されていません</p>
          ) : (
            <div className="space-y-2.5">
              {member.skills.map((skill, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full ring-1 font-medium shrink-0 ${skill.color}`}>{skill.emoji} {skill.name}</span>
                  <p className="text-xs leading-relaxed pt-0.5" style={{ color: "var(--color-ink-600)" }}>{buildSkillDescription(skill)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 協働の状況・ギルド */}
        <div className={SECTION}>
          <h3 className="text-sm font-semibold mb-2" style={H}>🤝 協働の状況</h3>
          {!detail ? <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>読み込み中...</p> : (
            <div className="space-y-2.5 text-xs">
              <p style={{ color: "var(--color-ink-600)" }}>1to1 完了：<strong>{detail.oneOnOneCompleted}</strong> 件　／　外部人脈：<strong>{detail.externalContacts.total}</strong> 件
                <span style={{ color: "var(--color-ink-400)" }}>（詳細公開 {detail.externalContacts.full}・存在のみ {detail.externalContacts.existence}・非公開 {detail.externalContacts.private}）</span>
              </p>
              <Chips label="所属ギルド" empty="なし" items={detail.guilds.map((g) => `${g.emblemEmoji} ${g.name}${g.isLeader ? "（リーダー）" : ""}`)} />
              <Chips label="協働チーム" empty="なし"
                items={detail.collabTeams.map((t) => `${t.type === "power" ? "⚡" : "🌿"} ${t.name}${t.status === "pending" ? "（承認待ち）" : t.status === "declined" ? "（辞退）" : ""}`)} />
              <Chips label="🌱 協働の芽がある相手" empty="なし" items={detail.seedPartners.map((p) => `${p.emoji} ${p.name}`)} />
            </div>
          )}
        </div>

        {/* 金の卵・金のガチョウ */}
        {detail && (detail.goldenEggs.length > 0 || detail.goldenGeese.length > 0) && (
          <div className={SECTION}>
            <h3 className="text-sm font-semibold mb-2" style={H}>🥚 金の卵・🪙 金のガチョウ</h3>
            <div className="space-y-2">
              {detail.goldenEggs.map((e) => (
                <div key={e.id} className="text-xs px-3 py-2 rounded-xl leading-relaxed" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                  <p>🥚 {e.description}</p>
                  {e.issue && <p className="mt-1" style={{ color: "var(--color-ink-500)" }}>課題: {e.issue}</p>}
                </div>
              ))}
              {detail.goldenGeese.map((g) => (
                <div key={g.id} className="text-xs px-3 py-2 rounded-xl leading-relaxed" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                  <p>🪙 {g.description}</p>
                  {g.contactHypothesis && <p className="mt-1" style={{ color: "var(--color-ink-500)" }}>接点仮説: {g.contactHypothesis}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* バッジ */}
        {badgesData && badgesData.data.length > 0 && (
          <div className={SECTION}>
            <h3 className="text-sm font-semibold mb-2" style={H}>🏅 獲得バッジ</h3>
            <div className="flex flex-wrap gap-2">
              {badgesData.data.map((mb) => (
                <div key={mb.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm" style={{ background: "var(--color-paper-200)" }} title={mb.badge.description}>
                  <span>{mb.badge.emoji}</span><span style={{ color: "var(--color-ink-700)" }}>{mb.badge.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ポイント・活動履歴（一般ユーザーのプロフィールと同じ表示） */}
        <div className={SECTION}>
          <h3 className="text-sm font-semibold mb-3" style={H}>⭐️ 獲得ポイント・活動履歴</h3>
          {!history ? <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>読み込み中...</p> : (
            <>
              <div className="mb-3">
                <PointsSummary seasonPoints={history.seasonPoints} seasonName={history.seasonName} totalPoints={history.totalPoints} />
              </div>
              {history.history.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>まだ活動記録がありません</p>
              ) : (
                <div className="space-y-1.5">
                  {history.history.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-snug" style={{ color: "var(--color-ink-700)" }}>{item.label}</p>
                        {item.detail && <p className="text-xs leading-snug" style={{ color: "var(--color-ink-500)" }}>{item.detail}</p>}
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{fmtDateISO(item.createdAt, tz)}</p>
                      </div>
                      <span className="text-sm font-bold shrink-0 ml-2" style={{ color: item.delta >= 0 ? "var(--color-accent)" : "var(--color-brand)" }}>
                        {item.delta >= 0 ? "+" : ""}{item.delta}pt
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Chips({ label, empty, items }: { label: string; empty: string; items: string[] }) {
  return (
    <div>
      <p className="font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>{label}</p>
      {items.length === 0 ? <span style={{ color: "var(--color-ink-400)" }}>{empty}</span> : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t) => (
            <span key={t} className="px-2.5 py-1 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
