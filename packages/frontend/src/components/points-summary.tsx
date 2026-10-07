// =============================================================
// ポイントの表示（プロフィール・管理画面のメンバー詳細で共通）
// ふだんは「現在のシーズンポイント」を大きく見せ、「累計ポイントを見る」で全期間の合計も確認できる。
// =============================================================
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function PointsSummary({ seasonPoints, seasonName, totalPoints, rank, size = "lg" }: {
  seasonPoints: number;
  /** 現在のシーズン名（シーズンが設定されていないときは null） */
  seasonName: string | null;
  totalPoints: number;
  /** シーズン内の順位（表示しないときは省略） */
  rank?: number | null;
  size?: "lg" | "xl";
}) {
  const [showTotal, setShowTotal] = useState(false);
  return (
    <div>
      <p className="text-xs font-medium mb-0.5" style={{ color: "var(--color-ink-500)" }}>
        現在のシーズンポイント{seasonName ? `（${seasonName}）` : ""}
      </p>
      <div className="flex items-end gap-4">
        <div className={`${size === "xl" ? "text-4xl" : "text-3xl"} font-bold`} style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
          {seasonPoints}<span className="text-base ml-1 font-normal" style={{ color: "var(--color-ink-400)" }}>pt</span>
        </div>
        {rank != null && (
          <div className="text-sm pb-1" style={{ color: "var(--color-ink-500)" }}>
            シーズン <span className="font-bold text-lg" style={{ color: "var(--color-ink-800)" }}>{rank}</span> 位
          </div>
        )}
      </div>
      {seasonName === null && (
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>いまはシーズンが開催されていません</p>
      )}
      <button type="button" onClick={() => setShowTotal((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs font-medium" style={{ color: "var(--color-brand)" }}>
        累計ポイントを{showTotal ? "閉じる" : "見る"}
        <ChevronDown size={13} className="transition-transform" style={{ transform: showTotal ? "rotate(180deg)" : "none" }} />
      </button>
      {showTotal && (
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-700)" }}>
          これまでの累計：<span className="font-bold" style={{ color: "var(--color-ink-800)" }}>{totalPoints}</span> pt
          <span className="text-xs ml-1" style={{ color: "var(--color-ink-400)" }}>（全シーズンの合計）</span>
        </p>
      )}
    </div>
  );
}
