// =============================================================
// 候補日時ごとの「自分のカレンダーでの空き状況」の表示（1to1の候補日時から選ぶ画面で共通）
// ・ログイン済み・Google連携済み → 候補ごとに「空いています／予定あり」を表示
// ・Google未連携 → 連携のご案内
// ・未ログイン → ログインして確認できる案内（ログイン後、この画面に戻る）
// =============================================================
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useCandidateAvailability, type CandidateSlotLike, type SlotAvailability } from "@/hooks/use-candidate-availability";

function hm(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** 候補ごとの空き状況（空き状況が分からないときは何も出さない） */
export function SlotAvailabilityNote({ availability }: { availability: SlotAvailability | undefined }) {
  if (!availability) return null;
  if (availability.status === "free") {
    return <span className="text-[11px] font-medium" style={{ color: "var(--color-success)" }}>✅ あなたのカレンダーは空いています</span>;
  }
  if (availability.status === "allday") {
    return <span className="text-[11px] font-medium" style={{ color: "var(--color-accent)" }}>📅 終日の予定があります（{availability.allDayTitles.slice(0, 2).join("、")}）</span>;
  }
  return (
    <span className="text-[11px] font-medium" style={{ color: "var(--color-brand)" }}>
      ⚠️ 予定があります：{availability.conflicts.slice(0, 2).map((c) => `${c.summary || "予定"}（${hm(c.startUtc)}〜${hm(c.endUtc)}）`).join("、")}
      {availability.conflicts.length > 2 ? ` ほか${availability.conflicts.length - 2}件` : ""}
    </span>
  );
}

/**
 * 空き状況の確認に必要な状態をまとめて扱う。
 * loginRedirectPath があれば、未ログインのときに「ログインして確認する」を案内する。
 */
export function useAvailabilityForSlots(slots: CandidateSlotLike[], canCheck = true) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const loggedIn = !!token && !!user;
  const result = useCandidateAvailability(slots, loggedIn && canCheck);
  return { loggedIn, ...result };
}

/** 候補リストの上に出す、状態の案内（読み込み中・未ログイン・未連携） */
export function AvailabilityNotice({ loggedIn, isLoading, connected, loginRedirectPath }: {
  loggedIn: boolean; isLoading: boolean; connected: boolean | undefined;
  /** 未ログインのとき、ログイン後に戻るパス */
  loginRedirectPath?: string;
}) {
  if (!loggedIn) {
    if (!loginRedirectPath) return null;
    return (
      <div className="mb-2 px-3 py-2 rounded-xl text-xs flex items-center justify-between gap-2 flex-wrap" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
        <span>📅 ログインすると、あなたのカレンダーで候補日時が空いているか確認できます</span>
        <Link to={`/login?redirect=${encodeURIComponent(loginRedirectPath)}`} className="font-medium underline shrink-0" style={{ color: "var(--color-brand)" }}>
          ログインして確認する →
        </Link>
      </div>
    );
  }
  if (isLoading) {
    return <div className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-400)" }}><Loader2 size={12} className="animate-spin" />カレンダーの空き状況を確認しています…</div>;
  }
  if (connected === false) {
    return (
      <div className="mb-2 px-3 py-2 rounded-xl text-xs" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
        📅 Googleカレンダーと連携すると、候補日時が空いているかここに表示されます。
        <Link to="/scheduler/settings" className="ml-1 font-medium underline" style={{ color: "var(--color-brand)" }}>連携する →</Link>
      </div>
    );
  }
  return null;
}
