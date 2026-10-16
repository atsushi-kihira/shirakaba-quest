// =============================================================
// 入会日の範囲で絞り込む入力（なかま一覧・管理画面のメンバー管理で共用）
// 入会日は「日にちは正確でなくてもよく、年月さえ合っていればよい」扱いなので、年月（YYYY-MM）で範囲を指定する。
// 範囲を指定したときは、入会日が未登録のメンバーは対象外になる。
// =============================================================
import { X } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";

export type JoinedRange = { from: string; to: string }; // "YYYY-MM" または空文字（未指定）
export const EMPTY_JOINED_RANGE: JoinedRange = { from: "", to: "" };

export function isJoinedRangeActive(r: JoinedRange): boolean {
  return !!r.from || !!r.to;
}

/** 入会日（"YYYY-MM-DD"）が、指定した年月の範囲（両端を含む）に入っているか */
export function inJoinedRange(joinedDate: string | null | undefined, r: JoinedRange): boolean {
  if (!isJoinedRangeActive(r)) return true;
  if (!joinedDate) return false;
  const ym = joinedDate.slice(0, 7);
  if (r.from && ym < r.from) return false;
  if (r.to && ym > r.to) return false;
  return true;
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

export function JoinedRangeFilter({ value, onChange }: { value: JoinedRange; onChange: (r: JoinedRange) => void }) {
  const { termBusinessCommunity } = useSettings();
  const swapped = !!value.from && !!value.to && value.from > value.to;
  const inputStyle = { background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" } as const;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: "var(--color-ink-600)" }}>
        <span className="font-medium">📅 {termBusinessCommunity}入会日</span>
        <input type="month" value={value.from} max={value.to || undefined} aria-label="入会日（開始）"
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="rounded-xl px-2.5 py-1.5 text-sm outline-none" style={inputStyle} />
        <span>〜</span>
        <input type="month" value={value.to} min={value.from || undefined} aria-label="入会日（終了）"
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="rounded-xl px-2.5 py-1.5 text-sm outline-none" style={inputStyle} />
        {isJoinedRangeActive(value) && (
          <button type="button" onClick={() => onChange(EMPTY_JOINED_RANGE)}
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            <X size={12} />範囲をクリア
          </button>
        )}
      </div>
      {swapped && (
        <p className="text-xs mt-1" style={{ color: "var(--color-brand)" }}>開始の年月が終了より後になっています。入れ替えてご確認ください。</p>
      )}
      {isJoinedRangeActive(value) && !swapped && (
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
          {value.from ? ymLabel(value.from) : "最初"}から{value.to ? ymLabel(value.to) : "現在"}までに入会した方を表示します（入会日が未登録の方は表示されません）
        </p>
      )}
    </div>
  );
}
