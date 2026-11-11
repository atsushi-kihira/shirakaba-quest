// =============================================================
// イベント種別の設定：ミーティング・定例会のタイトル文字の色
//   セミナーなどの種別を、招待された人のホーム画面・ミーティング画面で目立たせるために、タイトルの文字に色をつける。
//   チェックを外すと「色なし（ふつうの色）」になる。
// =============================================================
const PRESETS = ["#b5384b", "#d9622b", "#b8860b", "#3f7d4a", "#2f7f86", "#3f6fa6", "#7a4f9e", "#c2457f"];
export const DEFAULT_TITLE_COLOR = "#b5384b";

export function TitleColorSetting({ value, onChange, sampleText }: {
  /** 色（"#rrggbb"）。null = 色なし */
  value: string | null;
  onChange: (v: string | null) => void;
  /** 見本に表示する文字（種別名） */
  sampleText?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? DEFAULT_TITLE_COLOR : null)} className="rounded" />
        <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>タイトルの文字に色をつける（セミナーなどを目立たせる）</span>
      </label>
      {value !== null && (
        <div className="pl-6 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((c) => (
              <button key={c} type="button" aria-label={`色 ${c}`} onClick={() => onChange(c)}
                className="w-7 h-7 rounded-full"
                style={{ background: c, border: value.toLowerCase() === c ? "3px solid var(--color-ink-900)" : "2px solid var(--color-paper-50)", boxShadow: "0 0 0 1px var(--color-paper-300)" }} />
            ))}
            <label className="flex items-center gap-1.5 text-xs ml-1" style={{ color: "var(--color-ink-500)" }}>
              好きな色
              <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-8 h-8 p-0 border-0 bg-transparent cursor-pointer" />
            </label>
          </div>
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            見え方：<span className="font-semibold text-sm" style={{ color: value }}>{sampleText?.trim() || "セミナー"} ○○勉強会</span>
          </p>
          <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>
            この種別のミーティング・定例会は、招待された人のホーム画面・ミーティング画面・カレンダーで、タイトルがこの色で表示されます。
          </p>
        </div>
      )}
    </div>
  );
}
