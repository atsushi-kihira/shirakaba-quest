// 外部人脈の登録画面で、公開範囲の下に出す注意書き
// 会社名からAIが調べても見つからなかった人脈は、自動で「非公開」になる（AIの費用をむだに使わないため）
export function NotFoundPrivateNote() {
  return (
    <p className="text-[11px] -mt-2 mb-3 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
      ℹ️ 会社名からAIが事業内容を調べますが、情報が見つからなかった場合は、自動で「🔒 非公開」になります（検索の対象から外れます）。あとから公開に戻せます。
    </p>
  );
}
