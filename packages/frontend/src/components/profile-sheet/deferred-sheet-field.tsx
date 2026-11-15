// =============================================================
// 人脈をこれから登録するときの「もらった資料（任意）」欄
//   取り込んだ内容は、いったん手元に持っておき、人脈の登録が終わったあとで保存する
// =============================================================
import { useState } from "react";
import { FileUp } from "lucide-react";
import type { ProfileSheetFields } from "@shared/types";
import { ProfileSheetImportModal } from "./profile-sheet-import-modal";
import { todayIso } from "./profile-sheet-shared";
import { useTimezone } from "@/hooks/use-timezone";

type Props = {
  /** 相手の名前（入力中のもの。読み取りの手がかりにする） */
  name: string;
  value: ProfileSheetFields | null;
  onChange: (v: ProfileSheetFields | null) => void;
  /** 1to1した日の初期値を、今日にする（1to1のあとに登録するとき） */
  defaultToday?: boolean;
};

export function DeferredSheetField({ name, value, onChange, defaultToday }: Props) {
  const tz = useTimezone();
  const [open, setOpen] = useState<null | { date?: string }>(null);
  return (
    <div className="rounded-2xl p-3 mb-3" style={{ background: value ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--color-ink-700)" }}>
          {value ? "📎 もらった資料を、取り込みました" : "📎 もらった資料はありますか？（任意）"}
          <span className="block text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            {value
              ? `${[value.company, value.title].filter(Boolean).join("・") || "内容を入力済み"}${value.tags.length > 0 ? `（タグ${value.tags.length}個）` : ""}。登録のあとで保存します`
              : "略歴シート・GAINSシート・1to1シートなど。登録したあなただけが見られます"}
          </span>
        </p>
        <div className="flex gap-1.5 shrink-0">
          <button type="button" onClick={() => setOpen({ date: defaultToday ? todayIso(tz) : undefined })}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-white" style={{ background: "var(--color-brand)" }}>
            <FileUp size={13} /> {value ? "見る・直す" : "取り込む"}
          </button>
          {value && (
            <button type="button" onClick={() => onChange(null)} className="px-2.5 py-1.5 rounded-xl text-xs" style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>やめる</button>
          )}
        </div>
      </div>
      {open && (
        <div onClick={(e) => e.stopPropagation()}>
          <ProfileSheetImportModal
            subject={{ type: "contact", id: null, name: name.trim() }}
            existing={null}
            defaultDate={open.date}
            deferSave
            startAtEdit={false}
            initialFields={value}
            onClose={() => setOpen(null)}
            onDone={(f) => { onChange(f); setOpen(null); }}
          />
        </div>
      )}
    </div>
  );
}
