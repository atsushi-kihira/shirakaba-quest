// =============================================================
// イベント詳細画面 /events/:id
// =============================================================
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Check, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type EventDetail = {
  id: string;
  type: string;
  eventTypeDefId: string | null;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number | null;
  relatedMemberId: string | null;
  relatedMemberIds: string[];
  multiplier: number | null;
  pointAwardTiming: string | null;
  allowRepeat: number;
  status: string;
  createdByMemberId: string | null;
  typeEmoji?: string | null;
  typeName?: string | null;
  triggerType?: string | null;
  pointValue?: number;
  rewardTarget?: string | null;
  relatedMembers?: { id: string; name: string; emoji: string }[];
  creatorName?: string | null;
  myParticipated: boolean;
  myActionCount?: number | null;
};

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("ja-JP", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function EventDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["events", "detail", id],
    queryFn: () => api.get<{ data: EventDetail }>(`/events/instances/${id}`),
    enabled: !!id && !!user,
  });

  const ev = data?.data;

  const participate = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; alreadyDone: boolean; pointsAwarded: number }>(
        `/events/instances/${id}/participate`,
        {}
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", "detail", id] });
      qc.invalidateQueries({ queryKey: ["events", "active"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.patch(`/events/instances/${id}`, { status: "deleted" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", "active"] });
      navigate("/events");
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  if (!ev) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-4xl mb-3">🔍</p>
        <p style={{ color: "var(--color-ink-500)" }}>イベントが見つかりません</p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 text-sm"
          style={{ color: "var(--color-brand)" }}
        >
          ← 戻る
        </button>
      </div>
    );
  }

  const effectivePointValue = ev.multiplier ?? 0;
  const isOwner = ev.createdByMemberId === user?.id;
  const creatorLabel = isOwner ? "あなた" : (ev.creatorName ?? "管理者");
  const isRepeat = ev.allowRepeat !== 0;
  const actionCount = ev.myActionCount ?? 0;

  const relatedMembers =
    ev.relatedMembers && ev.relatedMembers.length > 0
      ? ev.relatedMembers
      : ev.relatedMemberId
        ? [{ id: ev.relatedMemberId, name: "---", emoji: "" }]
        : [];

  const hasTargetMembers = relatedMembers.length > 0;
  // 対象メンバーが指定されているイベントはアクションボタン非表示（1to1完了で自動付与）
  const hasOnComplete = ev.triggerType === "on_action" && !hasTargetMembers;
  // 繰り返し可イベントは何度でもボタンを表示
  const canParticipateNow = hasOnComplete && (isRepeat ? true : !ev.myParticipated);

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto lg:max-w-none">
      {/* 戻るボタン */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm mb-4"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={15} /> イベント一覧に戻る
      </button>

      <div className="card-paper rounded-3xl p-5 space-y-4">
        {/* 種別バッジ */}
        {(ev.typeEmoji || ev.typeName) && (
          <span
            className="inline-block text-xs px-2.5 py-1 rounded-full"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}
          >
            {ev.typeEmoji} {ev.typeName}
          </span>
        )}

        {/* タイトル */}
        <h1
          className="text-xl font-semibold leading-snug"
          style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}
        >
          {ev.title}
        </h1>

        {/* 作成者 */}
        <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
          作成:{" "}
          <span style={{ color: isOwner ? "var(--color-brand)" : "var(--color-ink-600)" }}>
            {creatorLabel}
          </span>
        </p>

        {/* 説明 */}
        {ev.description ? (
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap"
            style={{ color: "var(--color-ink-700)" }}
          >
            {ev.description}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>
            （説明なし）
          </p>
        )}

        {/* 有効期間 */}
        <p
          className="text-xs flex items-center gap-1.5"
          style={{ color: "var(--color-ink-500)" }}
        >
          <Calendar size={13} />
          {fmtDate(ev.startsAt)}
          {ev.endsAt ? ` 〜 ${fmtDate(ev.endsAt)}` : "（期限なし）"}
        </p>

        {/* 対象メンバー */}
        {relatedMembers.length > 0 && (
          <div>
            <p
              className="text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-500)" }}
            >
              対象メンバー
            </p>
            <div className="flex flex-wrap gap-1.5">
              {relatedMembers.map((m) => (
                <Link
                  key={m.id}
                  to={`/members/${m.id}`}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full font-medium underline underline-offset-2"
                  style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}
                >
                  {m.emoji} {m.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ポイント情報 */}
        {hasOnComplete && effectivePointValue > 0 && canParticipateNow && (
          <div
            className="rounded-xl px-4 py-3"
            style={{
              background: "rgba(212,160,59,0.08)",
              border: "1px solid rgba(212,160,59,0.2)",
            }}
          >
            <p className="text-sm font-semibold" style={{ color: "var(--color-accent)" }}>
              🏆 +{effectivePointValue}pt 獲得チャンス
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              {isRepeat ? "何度でも実施できます。ボタンを押すたびにポイントが付与されます" : "下のボタンを押すとポイントが付与されます"}
            </p>
          </div>
        )}

        {/* 参加済みバッジ（1回限りイベント） */}
        {!isRepeat && ev.myParticipated && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-2"
            style={{
              background: "rgba(90,140,92,0.1)",
              border: "1px solid rgba(90,140,92,0.2)",
            }}
          >
            <Check size={16} style={{ color: "var(--color-success)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--color-success)" }}>
              実施済み{effectivePointValue > 0 ? `（+${effectivePointValue}pt）` : ""}
            </p>
          </div>
        )}

        {/* 実施回数（繰り返し可イベント） */}
        {isRepeat && actionCount > 0 && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-2"
            style={{
              background: "rgba(90,140,92,0.1)",
              border: "1px solid rgba(90,140,92,0.2)",
            }}
          >
            <Check size={16} style={{ color: "var(--color-success)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--color-success)" }}>
              {actionCount}回実施済み{effectivePointValue > 0 ? `（計+${effectivePointValue * actionCount}pt）` : ""}
            </p>
          </div>
        )}
      </div>

      {/* 対象メンバーありイベントの案内 */}
      {hasTargetMembers && ev.triggerType !== "on_action" && (
        <div className="mt-4 rounded-2xl p-4"
          style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.2)" }}>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-success)" }}>
            🤝 対象メンバーと1to1を行うとポイントが付与されます
          </p>
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            上の「対象メンバー」のリンクからプロフィールを開き、1to1を申し込んでください。
            双方が完了ボタンを押した時点でポイントが自動的に付与されます。
          </p>
        </div>
      )}

      {/* アクション実施ボタン */}
      {canParticipateNow && (
        <div className="mt-4">
          <button
            onClick={() => participate.mutate()}
            disabled={participate.isPending}
            className="w-full py-4 rounded-2xl text-base font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-success)" }}
          >
            {participate.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : effectivePointValue > 0 ? (
              `✅ アクションを実施する（+${effectivePointValue}pt）`
            ) : (
              "✅ アクションを実施する"
            )}
          </button>
        </div>
      )}

      {/* 削除ボタン（作成者のみ） */}
      {isOwner && ev.status === "active" && (
        <div className="mt-4">
          <button
            onClick={() => { if (window.confirm("このイベントを削除しますか？\n削除すると元に戻せません。")) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
            style={{ background: "transparent", color: "var(--color-brand)", border: "1px solid rgba(181,56,75,0.3)" }}
          >
            {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            イベントを削除する
          </button>
        </div>
      )}
    </div>
  );
}
