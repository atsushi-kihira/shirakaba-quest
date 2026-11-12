// =============================================================
// お繋ぎ（ご紹介）の一覧 — 自分が紹介したお繋ぎ・自分に届いたお繋ぎ
// =============================================================
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtRange, STAGE_LABEL, TONE_STYLE, type OtsunagiItem } from "./_types";

export function StageBadge({ item }: { item: OtsunagiItem }) {
  const label = STAGE_LABEL[item.stage];
  const style = TONE_STYLE[label.tone];
  return (
    <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-medium" style={{ background: style.bg, color: style.color }}>
      {item.role === "introducer" ? label.introducer : label.member}
    </span>
  );
}

function ItemCard({ item }: { item: OtsunagiItem }) {
  const other = item.role === "introducer" ? item.member : item.introducer;
  return (
    <Link to={`/otsunagi/${item.id}`} className="card-paper rounded-2xl p-4 flex items-start gap-3 transition active:opacity-80">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: "rgba(181,56,75,0.1)" }}>🔗</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-900)" }}>
          {item.role === "introducer" ? `${item.member.name}さん ⇄ ${item.guestName}さん` : `${item.guestName}さん（${item.introducer.name}さんの紹介）`}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StageBadge item={item} />
          <span className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>{fmtDate(item.createdAt)}に{item.role === "introducer" ? "作成" : `${other.name}さんから`}</span>
        </div>
        {item.confirmed && (
          <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-600)" }}>📅 {fmtRange(item.confirmed.startAtUtc, item.confirmed.endAtUtc)}</p>
        )}
      </div>
      <ChevronRight size={16} className="mt-1 shrink-0" style={{ color: "var(--color-ink-300)" }} />
    </Link>
  );
}

export function OtsunagiScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"introduced" | "received">("introduced");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["otsunagi", "list"],
    queryFn: () => api.get<{ data: { introduced: OtsunagiItem[]; received: OtsunagiItem[] } }>("/otsunagi"),
    refetchOnWindowFocus: true,
  });
  const introduced = data?.data.introduced ?? [];
  const received = data?.data.received ?? [];
  const needsAction = received.filter((r) => r.stage === "waiting_member" || r.stage === "booking_cancelled").length;
  const list = tab === "introduced" ? introduced : received;

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70" style={{ background: "var(--color-paper-200)" }} aria-label="戻る">
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>🔗 お繋ぎ</h1>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
        メンバーと外部の方を、お繋ぎします。1to1の日程調整は、お繋ぎ先のメンバーが行うので、紹介する人は、途中で何もしなくて大丈夫です。
      </p>

      <Link to="/otsunagi/new" className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 mb-5" style={{ background: "var(--color-brand)" }}>
        <Plus size={16} /> 新しくお繋ぎする
      </Link>

      <div className="grid grid-cols-2 gap-2 mb-4">
        {([["introduced", `自分が紹介（${introduced.length}）`], ["received", `自分に届いた（${received.length}）`]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className="py-2.5 rounded-2xl text-sm font-medium transition relative"
            style={{ background: tab === key ? "var(--color-brand)" : "var(--color-paper-200)", color: tab === key ? "white" : "var(--color-ink-600)" }}>
            {label}
            {key === "received" && needsAction > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center text-white" style={{ background: "var(--color-accent)" }}>{needsAction}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>
      ) : isError ? (
        <p className="text-sm text-center py-10" style={{ color: "var(--color-ink-500)" }}>読み込めませんでした。少し待ってから、もう一度開いてください。</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-center py-10" style={{ color: "var(--color-ink-400)" }}>
          {tab === "introduced" ? "まだ、お繋ぎはありません。「新しくお繋ぎする」から、作れます。" : "お繋ぎは、届いていません。"}
        </p>
      ) : (
        <div className="space-y-3">{list.map((item) => <ItemCard key={item.id} item={item} />)}</div>
      )}
    </div>
  );
}
