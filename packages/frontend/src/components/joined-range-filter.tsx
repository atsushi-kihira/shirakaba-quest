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

const FIRST_YEAR = 1995;

/**
 * 年と月を選ぶ入力。ブラウザ標準の月ピッカー（<input type="month">）は Safari などの一部ブラウザで
 * 使えず、ただの空欄に見えてしまうため、どのブラウザでも同じに動く選択式にしている。
 * 値は "YYYY-MM"（未指定は空文字）。年だけ・月だけを選んだときは、もう一方を自動で補う
 * （開始側は1月、終了側は12月）。
 */
function YearMonthSelect({ value, onChange, label, defaultMonth }: {
  value: string; onChange: (v: string) => void; label: string; defaultMonth: number;
}) {
  const thisYear = new Date().getFullYear();
  const [y, m] = value ? value.split("-") : ["", ""];
  const years = Array.from({ length: thisYear - FIRST_YEAR + 1 }, (_, i) => thisYear - i);
  const compose = (year: string, month: string): string => (year && month ? `${year}-${month.padStart(2, "0")}` : "");
  const selectStyle = { background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" } as const;
  return (
    <span className="inline-flex items-center gap-1">
      <select aria-label={`${label}（年）`} value={y}
        onChange={(e) => {
          const year = e.target.value;
          onChange(year ? compose(year, m || String(defaultMonth)) : "");
        }}
        className="rounded-xl px-2 py-1.5 text-sm outline-none" style={selectStyle}>
        <option value="">----</option>
        {years.map((yr) => <option key={yr} value={yr}>{yr}年</option>)}
      </select>
      <select aria-label={`${label}（月）`} value={m ? String(Number(m)) : ""}
        onChange={(e) => {
          const month = e.target.value;
          onChange(month ? compose(y || String(thisYear), month) : "");
        }}
        className="rounded-xl px-2 py-1.5 text-sm outline-none" style={selectStyle}>
        <option value="">--</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => <option key={mo} value={mo}>{mo}月</option>)}
      </select>
    </span>
  );
}

export function JoinedRangeFilter({ value, onChange }: { value: JoinedRange; onChange: (r: JoinedRange) => void }) {
  const { termBusinessCommunity } = useSettings();
  const swapped = !!value.from && !!value.to && value.from > value.to;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: "var(--color-ink-600)" }}>
        <span className="font-medium">📅 {termBusinessCommunity}入会日</span>
        <YearMonthSelect value={value.from} label="入会日（開始）" defaultMonth={1} onChange={(v) => onChange({ ...value, from: v })} />
        <span>〜</span>
        <YearMonthSelect value={value.to} label="入会日（終了）" defaultMonth={12} onChange={(v) => onChange({ ...value, to: v })} />
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
