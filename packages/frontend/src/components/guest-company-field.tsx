// =============================================================
// 外部ゲストの回答画面の「会社名・屋号」の入力欄（ミーティング・定例会・1to1のお誘いの回答で共通）
// 回答すると、名前・メールアドレス・会社名が、招待した人（主催者）の連絡先（外部人脈）として保存される
// =============================================================
type Props = { value: string; onChange: (v: string) => void; hostName?: string | null; disabled?: boolean; className?: string };

export function GuestCompanyField({ value, onChange, hostName, disabled, className }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
        会社名・屋号 <span style={{ color: "var(--color-brand)" }}>*</span>
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="例: 株式会社◯◯（個人の方は「個人」）"
        className={className ?? "w-full px-4 py-3 rounded-2xl text-sm outline-none border"}
        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
      />
      <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
        お名前・メールアドレス・会社名は、{hostName ? `${hostName}さん` : "招待した方"}の連絡先として保存されます（他の方には公開されません）。
      </p>
    </div>
  );
}
