// PB-01 公開予約ページ — 統合カレンダー型（認証不要）
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import UnifiedCalendarGrid, { type Slot } from "@/components/unified-calendar-grid";

type MemberMeta = {
  memberSlug: string;
  memberName: string;
  memberEmoji: string;
  memberBgColor: string;
  displayTitle: string;
  description: string | null;
  durationMinutes: number;
  availableConferenceTypes: string[];
};

type SlotsResponse = {
  memberSlug: string;
  displayTitle: string;
  durationMinutes: number;
  timezone: string;
  availableSlots: Slot[];
  businessHours: Record<string, { start: string; end: string }>;
  availableConferenceTypes: string[];
};

function startOfWeekSunday(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const year = parseInt(get("year")), month = parseInt(get("month")) - 1, day = parseInt(get("day"));
  const weekday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(get("weekday"));
  return new Date(Date.UTC(year, month, day - weekday));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
}

function toYMD(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function fetchPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? "エラーが発生しました");
  }
  const json = await res.json() as { data: T };
  return json.data;
}

export function PublicBookingPage() {
  const { memberSlug } = useParams<{ memberSlug: string }>();
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState<Date>(startOfWeekSunday());
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const { data: meta, isLoading: metaLoading, error: metaError } = useQuery<MemberMeta>({
    queryKey: ["public", memberSlug, "meta"],
    queryFn: () => fetchPublic(`/scheduler/public/${memberSlug}`),
    enabled: !!memberSlug,
    retry: false,
  });

  const fromStr = toYMD(weekStart);
  const toStr = toYMD(addDays(weekStart, 6));

  const { data: slotsData, isLoading: slotsLoading } = useQuery<SlotsResponse>({
    queryKey: ["public", memberSlug, "slots", fromStr],
    queryFn: () => fetchPublic(`/scheduler/public/${memberSlug}/slots?from=${fromStr}&to=${toStr}&tz=Asia/Tokyo`),
    enabled: !!memberSlug && !metaError,
  });

  const handleSlotClick = (slot: Slot) => {
    setSelectedSlot(slot);
  };

  const handleProceed = () => {
    if (!selectedSlot || !memberSlug) return;
    const params = new URLSearchParams({
      slot: selectedSlot.startUtc,
      end: selectedSlot.endUtc,
    });
    navigate(`/book/${memberSlug}/form?${params.toString()}`);
  };

  const isPrevDisabled = weekStart.getTime() <= startOfWeekSunday().getTime();

  if (metaLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-paper-50)" }}>
        <Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
      </div>
    );
  }

  if (metaError || !meta) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--color-paper-50)" }}>
        <div className="text-center">
          <p className="text-4xl mb-4">🔍</p>
          <p className="font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>
            このページは見つかりませんでした
          </p>
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
            URLが正しいか確認してください
          </p>
        </div>
      </div>
    );
  }

  const slots = slotsData?.availableSlots ?? [];
  const durationMinutes = meta.durationMinutes;

  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-50)" }}>
      {/* ヘッダー */}
      <div style={{ background: "white", borderBottom: "1px solid var(--color-paper-300)" }}>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: "var(--color-paper-100)" }}
            >
              {meta.memberEmoji}
            </div>
            <div>
              <p className="font-bold text-lg" style={{ color: "var(--color-ink-900)" }}>
                {meta.memberName}
              </p>
              <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>
                {meta.displayTitle}（{durationMinutes}分）
              </p>
            </div>
          </div>
          {meta.description && (
            <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--color-ink-600)" }}>
              {meta.description}
            </p>
          )}
        </div>
      </div>

      {/* カレンダー */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: "white", border: "1px solid var(--color-paper-300)" }}
        >
          {/* 週ナビゲーション */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              disabled={isPrevDisabled}
              className="p-2 rounded-xl disabled:opacity-30"
              style={{ background: "var(--color-paper-100)" }}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-medium text-sm" style={{ color: "var(--color-ink-700)" }}>
              {new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" }).format(weekStart)}
            </span>
            <button
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              className="p-2 rounded-xl"
              style={{ background: "var(--color-paper-100)" }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {slotsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
            </div>
          ) : slots.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">📅</p>
              <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
                この週に予約可能な時間帯はありません
              </p>
              <button
                onClick={() => setWeekStart((w) => addDays(w, 7))}
                className="mt-3 text-sm font-medium"
                style={{ color: "var(--color-brand)" }}
              >
                次の週を見る →
              </button>
            </div>
          ) : (
            <UnifiedCalendarGrid
              mode="public_guest"
              availableSlots={slots}
              selectedSlot={selectedSlot}
              durationMinutes={durationMinutes}
              onSlotClick={handleSlotClick}
            />
          )}
        </div>

        {/* 選択中スロットの確認・次へ */}
        {selectedSlot && (
          <div
            className="rounded-2xl p-4 mb-4 sticky bottom-4"
            style={{
              background: "white",
              border: "2px solid var(--color-success)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
            }}
          >
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>選択した日時</p>
            <p className="font-bold" style={{ color: "var(--color-ink-900)" }}>
              {new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo",
                month: "long", day: "numeric", weekday: "short",
                hour: "2-digit", minute: "2-digit",
              }).format(new Date(selectedSlot.startUtc))}
              &nbsp;〜&nbsp;
              {new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo",
                hour: "2-digit", minute: "2-digit",
              }).format(new Date(selectedSlot.endUtc))}
            </p>
            <button
              onClick={handleProceed}
              className="w-full mt-3 py-3 rounded-xl font-bold text-white text-sm"
              style={{ background: "var(--color-brand)" }}
            >
              この日時で予約する →
            </button>
          </div>
        )}

        {/* フッター */}
        <p className="text-center text-xs mt-8" style={{ color: "#94A3B8" }}>
          © 2026 Bizolve Consulting, Inc. All rights reserved.
        </p>
      </div>
    </div>
  );
}
