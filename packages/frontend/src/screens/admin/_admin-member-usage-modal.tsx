// =============================================================
// 管理画面 — メンバーの利用状況（利用状況レポートのメンバー行から開く）
//   ・プロフィール（詳しい内容は「プロフィールの詳細」から、メンバー詳細で確認できる）
//   ・訪問回数（期間に応じた棒グラフ）
//   ・訪問回数・画面閲覧数・操作件数と、機能ごとの操作件数
//   ・よくやりとりしている相手（1to1・ミーティング）
// 期間（日・週・月・累計）は、このダイアログの中で切り替えられる。開いたときは利用状況レポートの期間と同じ。
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import { MemberAvatar } from "@/components/member-avatar";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateISO } from "@/lib/date";
import { AdminMemberDetailModal, type AdminMemberDetailBase } from "./_admin-member-detail-modal";
import { AccessChart } from "./_access-chart";
import { PeriodSwitcher } from "./_period-switcher";
import { FEATURES, STATUS_LABEL, fmtDate, useUsagePeriod, type MemberUsage } from "./_usage-shared";
import type { PeriodChoice } from "./_period-switcher";

type Partner = {
  id: string; name: string; emoji: string; bgColor: string; avatarImageKey: string | null; status: string;
  oneonone: number; meeting: number; total: number;
};
type MemberUsageDetail = {
  row: MemberUsage;
  screens: { screen: string; label: string }[];
  partners: Partner[];
  externalOneOnOne: number;
  unit: PeriodChoice;
  rangeStart: string | null;
  rangeEnd: string | null;
};

type Props = {
  memberId: string;
  initialUnit: PeriodChoice;
  initialDate: string;
  onClose: () => void;
};

const SECTION = "card-paper rounded-2xl p-4";
const H = { fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" } as const;

export function AdminMemberUsageModal({ memberId, initialUnit, initialDate, onClose }: Props) {
  const { timezone: tz, termUsp } = useSettings();
  // 開いたときは、利用状況レポートで見ていた期間（基準日つき）から始める
  const period = useUsagePeriod(initialUnit, initialDate);
  const { unit, date } = period;
  const [showProfile, setShowProfile] = useState(false);

  // プロフィールは、メンバー管理の一覧と同じデータを使う（すでに読み込まれていればそのまま表示できる）
  const { data: membersData } = useQuery({
    queryKey: ["admin", "members"],
    queryFn: () => api.get<{ data: AdminMemberDetailBase[] }>("/admin/members"),
  });
  const member = membersData?.data.find((m) => m.id === memberId);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "usage-report", "member", memberId, unit, date, period.tz],
    queryFn: () => api.get<{ data: MemberUsageDetail }>(
      `/admin/usage-report/members/${memberId}?unit=${unit}&date=${date}&tz=${encodeURIComponent(period.tz)}`),
    placeholderData: (prev) => prev,
  });
  const detail = data?.data;
  const row = detail?.row;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-4 sm:p-5 space-y-3"
        style={{ background: "var(--color-paper-100)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>メンバーの利用状況</h2>
          <DialogCloseButton onClick={onClose} />
        </div>

        {/* プロフィール */}
        <div className={SECTION}>
          {member ? (
            <>
              <div className="flex items-center gap-3">
                <MemberAvatar memberId={member.id} emoji={member.emoji} bgColor={member.bgColor} avatarImageKey={member.avatarImageKey} size="lg" rounded="rounded-2xl" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>{member.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      {STATUS_LABEL[member.status] ?? member.status}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{member.furigana}</p>
                  {(member.company || member.role) && (
                    <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-600)" }}>{member.company}{member.role ? ` / ${member.role}` : ""}</p>
                  )}
                  {member.category && <p className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>{member.category}</p>}
                </div>
              </div>
              {member.businessDescription && (
                <p className="mt-3 text-sm leading-relaxed line-clamp-3" style={{ color: "var(--color-ink-700)" }}>{member.businessDescription}</p>
              )}
              {member.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5" aria-label={termUsp}>
                  {member.skills.map((skill, i) => (
                    <span key={i} className={`text-xs px-2.5 py-1 rounded-full ring-1 font-medium ${skill.color}`}>{skill.emoji} {skill.name}</span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                  登録：{fmtDateISO(member.createdAt, tz)}
                  {row && ` ／ 最終ログイン・利用：${row.lastLoginAt ? fmtDate(row.lastLoginAt) : "利用なし"}`}
                </p>
                <button onClick={() => setShowProfile(true)} className="text-xs underline" style={{ color: "var(--color-brand)" }}>
                  プロフィールの詳細を見る
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              {row ? row.name : "メンバー"}
              <span className="text-xs ml-2" style={{ color: "var(--color-ink-400)" }}>（プロフィールを読み込み中、または表示できません）</span>
            </p>
          )}
        </div>

        {/* 期間の切り替え（以降の訪問回数・機能ごとの操作件数・やりとりの相手がこの期間の数字になる） */}
        <div className={SECTION}>
          <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>📅 集計期間（この下のすべてが、この期間の数字です）</p>
          <PeriodSwitcher
            units={["day", "week", "month", "all"]}
            unit={unit}
            rangeStart={detail?.rangeStart ?? null}
            rangeEnd={detail?.rangeEnd ?? null}
            today={period.today}
            onUnitChange={period.changeUnit}
            onShift={(dir) => period.shift(detail?.rangeStart ?? null, dir)}
            onToday={period.backToToday}
          />
        </div>

        {/* 訪問回数 */}
        <AccessChart unit={unit} date={date} memberId={memberId} title="📈 このメンバーの訪問回数" hideUniqueMembers />

        {/* 訪問回数・画面閲覧数・操作件数と、機能ごとの操作件数 */}
        <div className={SECTION}>
          <h3 className="text-sm font-semibold mb-3" style={H}>📊 利用のまとめ</h3>
          {isLoading && !row ? (
            <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>
          ) : isError || !row ? (
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>利用数を取得できませんでした。時間をおいてもう一度お試しください。</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {([
                  { label: "訪問回数", value: row.visits, unit: "回", color: "var(--color-ink-800)" },
                  { label: "画面閲覧数", value: row.views, unit: "回", color: "var(--color-ink-800)" },
                  { label: "操作件数", value: row.actions, unit: "件", color: "var(--color-brand)" },
                ]).map((m) => (
                  <div key={m.label} className="rounded-xl px-3 py-2" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
                    <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>{m.label}</p>
                    <p className="text-xl font-bold tabular-nums" style={{ color: m.value === 0 ? "var(--color-ink-400)" : m.color }}>
                      {m.value}<span className="text-xs font-normal ml-0.5" style={{ color: "var(--color-ink-500)" }}>{m.unit}</span>
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>画面閲覧数の内訳</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                {(detail?.screens ?? []).map((s) => {
                  const n = row.viewsByScreen[s.screen] ?? 0;
                  return (
                    <div key={s.screen} className="rounded-xl px-3 py-2" style={{ background: "var(--color-paper-200)" }}>
                      <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>{s.label}</p>
                      <p className="text-lg font-bold tabular-nums" style={{ color: n === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>
                        {n}<span className="text-xs font-normal ml-0.5" style={{ color: "var(--color-ink-500)" }}>回</span>
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>操作件数の内訳</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FEATURES.map((f) => {
                  const value = row[f.key];
                  return (
                    <div key={f.key} className="rounded-xl px-3 py-2" style={{ background: "var(--color-paper-200)" }}>
                      <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>{f.label}</p>
                      <p className="text-lg font-bold tabular-nums" style={{ color: value === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>
                        {value}
                        {f.key === "contact" && row.contactEight > 0 && (
                          <span className="text-[11px] font-normal ml-1" style={{ color: "var(--color-ink-400)" }}>（内Eight {row.contactEight}）</span>
                        )}
                        <span className="text-xs font-normal ml-0.5" style={{ color: "var(--color-ink-500)" }}>件</span>
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs mt-3" style={{ color: "var(--color-ink-500)" }}>
                訪問回数は、最後の利用から30分あいたら別の訪問と数えます。画面閲覧数は、見た画面の数です（同じ画面の5分以内の連続閲覧は1回）。
                操作件数は、上の内訳の合計です（ログイン・訪問・画面の閲覧は含みません）。
              </p>
            </>
          )}
        </div>

        {/* よくやりとりしている相手 */}
        <div className={SECTION}>
          <h3 className="text-sm font-semibold mb-1" style={H}>🤝 よくやりとりしている相手</h3>
          <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>1to1とミーティングで、ご一緒した回数の多いメンバーです（上で選んだ期間の分）。</p>
          {!detail ? (
            <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>
          ) : detail.partners.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>この期間は、1to1やミーティングでご一緒した相手がまだいません</p>
          ) : (
            <ul className="space-y-2">
              {detail.partners.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="w-5 text-center text-xs font-bold tabular-nums" style={{ color: "var(--color-ink-400)" }}>{i + 1}</span>
                  <MemberAvatar memberId={p.id} emoji={p.emoji} bgColor={p.bgColor} avatarImageKey={p.avatarImageKey} size="sm" />
                  <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{p.name}</span>
                  <span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--color-ink-600)" }}>
                    1to1 <b>{p.oneonone}</b>回 ／ ミーティング <b>{p.meeting}</b>回
                  </span>
                </li>
              ))}
            </ul>
          )}
          {detail && detail.externalOneOnOne > 0 && (
            <p className="text-xs mt-3" style={{ color: "var(--color-ink-500)" }}>
              このほか、外部ゲストとの1to1が <b>{detail.externalOneOnOne}</b> 件あります。
            </p>
          )}
          <p className="text-xs mt-2" style={{ color: "var(--color-ink-400)" }}>
            ミーティングは、主催・招待・出欠の回答・参加記録のいずれかで関わった回のうち、参加者が15人以内の回を数えています（全員向けの定例会などは、誰とでも同じ回数になるため除いています）。
          </p>
        </div>
      </div>
    </div>
    {/* プロフィールの詳細は、このダイアログの上に重ねて開く（閉じるとこのダイアログに戻る） */}
    {showProfile && member && <AdminMemberDetailModal member={member} onClose={() => setShowProfile(false)} />}
    </>
  );
}
