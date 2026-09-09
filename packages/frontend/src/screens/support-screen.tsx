// =============================================================
// サポート画面
// /support
// =============================================================
export function SupportScreen() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100, #FAF5E8)" }}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* ヘッダー */}
        <div className="mb-10">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: "var(--font-klee, 'Klee One', serif)", color: "var(--color-ink-900, #1a1a1a)" }}
          >
            サポート
          </h1>
          <p className="text-sm" style={{ color: "var(--color-ink-400, #888)" }}>
            BizQuestに関するお問い合わせ窓口のご案内です。
          </p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed" style={{ color: "var(--color-ink-800, #333)" }}>

          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              お問い合わせ方法
            </h2>
            <p className="mb-3">
              ログインやアカウント登録、機能の使い方、Google／Zoom連携に関するご質問・不具合のご報告は、以下のメールアドレスまでご連絡ください。
            </p>
            <div
              className="p-4 rounded-2xl"
              style={{ background: "var(--color-paper-200, #f0e8d4)" }}
            >
              <p className="font-semibold mb-1">株式会社Bizolve Consulting サポート窓口</p>
              <p>
                メール：
                <a href="mailto:contact@bizolve.jp" style={{ color: "var(--color-brand, #B5384B)" }}>
                  contact@bizolve.jp
                </a>
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              対応時間・返信の目安
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>対応時間：平日 9:00〜18:00（日本時間、土日祝日・年末年始を除く）</li>
              <li>初回返信の目安：受付から2営業日以内</li>
              <li>緊急の障害・不具合については、可能な範囲で優先的に対応します</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              お問い合わせ時のお願い
            </h2>
            <p className="mb-2">スムーズな対応のため、お問い合わせの際は以下の情報を添えてください。</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>ログインに使用しているメールアドレス</li>
              <li>発生している状況（画面のスクリーンショットなど）</li>
              <li>発生日時</li>
              <li>ご利用の端末（スマートフォン／PC）とブラウザ</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              Zoom連携に関するお問い合わせ
            </h2>
            <p>
              Zoomとの連携方法・使い方・連携解除については、
              <a href="/zoom-integration" style={{ color: "var(--color-brand, #B5384B)" }}>
                Zoom連携ガイド
              </a>
              もあわせてご参照ください。ガイドで解決しない場合は、上記の窓口までご連絡ください。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              関連ページ
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <a href="/privacy" style={{ color: "var(--color-brand, #B5384B)" }}>プライバシーポリシー</a>
              </li>
              <li>
                <a href="/terms" style={{ color: "var(--color-brand, #B5384B)" }}>利用規約</a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
