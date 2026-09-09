// PB-01 公開予約ページ — 統合カレンダー型（認証不要、メンバーはログインして自分の予定も確認可）
import { useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, LogIn, Plus } from "lucide-react";
import { API_BASE_URL, api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import UnifiedCalendarGrid, { type Slot, type MyEvent } from "@/components/unified-calendar-grid";
import { MyEventModal } from "./_my-calendar-event-modal";

type MemberMeta = {
  memberSlug: string;
  memberName: string;
  memberEmoji: string;
  memberBgColor: string;
  displayTitle: string;
  description: string | null;
  durationMinutes: number;
  availableConferenceTypes: string[];
  existingBooking: { startAtUtc: string; endAtUtc: string; conferenceType: string; conferenceUrl: string | null } | null;
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

class PublicFetchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function fetchPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    throw new PublicFetchError(err.error?.code ?? "unknown", err.error?.message ?? "エラーが発生しました");
  }
  const json = await res.json() as { data: T };
  return json.data;
}

type MyCalendarEventsResponse = {
  data: { connected: boolean; events: MyEvent[]; calendars: { id: string; summary: string }[] };
};

export function PublicBookingPage() {
  const { memberSlug } = useParams<{ memberSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const oneOnOneId = searchParams.get("oneOnOneId");
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [weekStart, setWeekStart] = useState<Date>(startOfWeekSunday());
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [editingMyEvent, setEditingMyEvent] = useState<MyEvent | null>(null);
  const [creatingMyEvent, setCreatingMyEvent] = useState(false);
  const [showMyEvents, setShowMyEvents] = useState(false);

  const { data: meta, isLoading: metaLoading, error: metaError } = useQuery<MemberMeta>({
    queryKey: ["public", memberSlug, "meta", oneOnOneId],
    queryFn: () => fetchPublic(`/scheduler/public/${memberSlug}${oneOnOneId ? `?oneOnOneId=${oneOnOneId}` : ""}`),
    enabled: !!memberSlug,
    retry: false,
  });

  const fromStr = toYMD(weekStart);
  const toStr = toYMD(addDays(weekStart, 6));

  const { data: slotsData, isLoading: slotsLoading, error: slotsError } = useQuery<SlotsResponse>({
    queryKey: ["public", memberSlug, "slots", fromStr, oneOnOneId],
    queryFn: () => fetchPublic(`/scheduler/public/${memberSlug}/slots?from=${fromStr}&to=${toStr}&tz=Asia/Tokyo${oneOnOneId ? `&oneOnOneId=${oneOnOneId}` : ""}`),
    enabled: !!memberSlug && !metaError,
    retry: 1,
  });

  // ログイン中のメンバーは、自分の予定（タイトル付き）もカレンダーに重ねて表示し、その場で編集できるようにする
  const myEventsQueryKey = ["scheduler", "my-calendar-events", fromStr];
  const { data: myEventsData } = useQuery<MyCalendarEventsResponse>({
    queryKey: myEventsQueryKey,
    queryFn: () => api.get<MyCalendarEventsResponse>(`/scheduler/me/calendar-events?from=${fromStr}&to=${toStr}`),
    enabled: !!token,
  });
  const myEvents = myEventsData?.data.events ?? [];
  const myCalendars = myEventsData?.data.calendars ?? [];

  // 自分の予定をドラッグで移動・伸縮した際、その場でPATCHして保存する（PC専用の操作）。
  // 場所・メモなど他の項目は現在の値をそのまま送り、上書きで消えないようにする。
  const dragUpdateMutation = useMutation({
    mutationFn: ({ event, startUtc, endUtc }: { event: MyEvent; startUtc: string; endUtc: string }) =>
      api.patch(`/scheduler/me/calendar-events/${event.id}`, {
        calendarId: event.calendarId,
        summary: event.summary,
        startUtc,
        endUtc,
        location: event.location ?? "",
        description: event.description ?? "",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduler", "my-calendar-events"] }),
  });

  function refreshMyEvents() {
    qc.invalidateQueries({ queryKey: ["scheduler", "my-calendar-events"] });
    setEditingMyEvent(null);
    setCreatingMyEvent(false);
  }

  const handleSlotClick = (slot: Slot) => {
    setSelectedSlot(slot);
  };

  const handleProceed = () => {
    if (!selectedSlot || !memberSlug) return;
    const params = new URLSearchParams({
      slot: selectedSlot.startUtc,
      end: selectedSlot.endUtc,
    });
    if (oneOnOneId) params.set("oneOnOneId", oneOnOneId);
    navigate(`/book/${memberSlug}/form?${params.toString()}`);
  };

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

      {/* ログイン誘導 / ログイン中バッジ */}
      <div className="max-w-2xl mx-auto px-4 pt-4">
        {token ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(90,140,92,0.08)", color: "var(--color-success)" }}>
            <LogIn size={13} />
            {user?.name ?? "メンバー"}さんとしてログイン中
            {showMyEvents && myEvents.length > 0 && " ・あなたの予定をカレンダーに重ねて表示しています"}
          </div>
        ) : (
          <Link
            to={`/login?redirect=${encodeURIComponent(`/book/${memberSlug}`)}`}
            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs"
            style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)", border: "1px solid var(--color-paper-300)" }}
          >
            <span className="flex items-center gap-1.5">
              <LogIn size={13} />
              白樺クエストのメンバーの方はログインすると、自分の予定と見比べられます
            </span>
            <span className="font-medium shrink-0" style={{ color: "var(--color-brand)" }}>ログイン →</span>
          </Link>
        )}
      </div>

      {/* すでに日程が確定している場合は、二重予約を防ぐため予約フォームの代わりに確定内容を表示する */}
      {meta.existingBooking ? (
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="rounded-2xl p-5" style={{ background: "rgba(90,140,92,0.08)", border: "2px solid var(--color-success)" }}>
            <p className="text-sm font-bold mb-2" style={{ color: "var(--color-success)" }}>✅ すでに日程が確定しています</p>
            <p className="font-bold" style={{ color: "var(--color-ink-900)" }}>
              {new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short",
                hour: "2-digit", minute: "2-digit",
              }).format(new Date(meta.existingBooking.startAtUtc))}
              &nbsp;〜&nbsp;
              {new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(meta.existingBooking.endAtUtc))}
            </p>
            {meta.existingBooking.conferenceUrl && (
              <p className="text-sm mt-2 break-all">
                <a href={meta.existingBooking.conferenceUrl} target="_blank" rel="noopener noreferrer"
                  className="underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                  🔗 会議URL: {meta.existingBooking.conferenceUrl}
                </a>
              </p>
            )}
            <p className="text-xs mt-3" style={{ color: "var(--color-ink-500)" }}>
              重ねて予約すると二重の予定になってしまうため、この予約ページからは新しい予約はできません。日程を変更したい場合は、マイページの予約一覧からキャンセルしてからやり直してください。
            </p>
          </div>
          <p className="text-center text-xs mt-8" style={{ color: "#94A3B8" }}>
            © 2026 Bizolve Consulting, Inc. All rights reserved.
          </p>
        </div>
      ) : (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: "white", border: "1px solid var(--color-paper-300)" }}
        >
          {!slotsLoading && !slotsError && slots.length === 0 && (
            <div className="text-center py-4 mb-2">
              <p className="text-2xl mb-1">📅</p>
              <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
                この週に予約可能な時間帯はありません
              </p>
            </div>
          )}
          <UnifiedCalendarGrid
            mode="public_guest"
            availableSlots={slots}
            selectedSlot={selectedSlot}
            durationMinutes={durationMinutes}
            onSlotClick={handleSlotClick}
            myEvents={myEvents}
            onMyEventClick={token ? setEditingMyEvent : undefined}
            onMyEventDragEnd={token ? (event, newStartUtc, newEndUtc) => dragUpdateMutation.mutate({ event, startUtc: newStartUtc, endUtc: newEndUtc }) : undefined}
            weekStart={weekStart}
            onWeekChange={setWeekStart}
            loading={slotsLoading}
            errorMessage={
              slotsError
                ? (slotsError instanceof PublicFetchError ? slotsError.message : "現在カレンダーの空き状況を確認できません。しばらく経ってからもう一度お試しください。")
                : null
            }
            showMyEvents={showMyEvents}
            onToggleShowMyEvents={setShowMyEvents}
          />
        </div>

        {/* 自分の予定一覧（カレンダー上は文字数が限られて読みにくいため、タイトルが読める形でも表示する） */}
        {token && showMyEvents && myEvents.length > 0 && (
          <div className="rounded-2xl p-4 mb-4" style={{ background: "white", border: "1px solid var(--color-paper-300)" }}>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>
              🗓️ あなたの今週の予定
            </p>
            <div className="space-y-1.5">
              {[...myEvents]
                .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
                .map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => setEditingMyEvent(ev)}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left"
                    style={{ background: "rgba(181,56,75,0.06)" }}
                  >
                    <span className="text-xs shrink-0 mt-0.5 whitespace-nowrap" style={{ color: "var(--color-ink-500)" }}>
                      {new Intl.DateTimeFormat("ja-JP", {
                        timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short",
                      }).format(new Date(ev.startUtc))}
                      {!ev.allDay && (
                        <>
                          {" "}
                          {new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(ev.startUtc))}
                          〜
                          {new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(ev.endUtc))}
                        </>
                      )}
                      {ev.allDay && " 終日"}
                    </span>
                    <span className="text-sm break-words" style={{ color: "var(--color-ink-800)" }}>
                      {ev.summary}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* 自分の予定を追加（ログイン中のみ・Google連携済みのみ） */}
        {token && myCalendars.length > 0 && (
          <button
            onClick={() => setCreatingMyEvent(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 mb-4 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)", border: "1px dashed var(--color-paper-400)" }}
          >
            <Plus size={15} />
            自分の予定を追加する
          </button>
        )}

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
      )}

      {(editingMyEvent || creatingMyEvent) && (
        <MyEventModal
          calendars={myCalendars}
          initial={editingMyEvent}
          defaultStart={selectedSlot ? new Date(selectedSlot.startUtc) : new Date(`${fromStr}T00:00:00+09:00`)}
          onClose={() => { setEditingMyEvent(null); setCreatingMyEvent(false); }}
          onSaved={refreshMyEvents}
        />
      )}
    </div>
  );
}
