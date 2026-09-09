// =============================================================
// Zoom連携ガイド（Zoom Marketplace審査向けドキュメントページ）
// /zoom-integration
// =============================================================
export function ZoomIntegrationDocsScreen() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100, #FAF5E8)" }}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* ヘッダー */}
        <div className="mb-10">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: "var(--font-klee, 'Klee One', serif)", color: "var(--color-ink-900, #1a1a1a)" }}
          >
            Zoom連携ガイド
          </h1>
          <p className="text-sm" style={{ color: "var(--color-ink-400, #888)" }}>
            BizQuestとZoomの連携の追加・使い方・削除方法についてご案内します。
          </p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed" style={{ color: "var(--color-ink-800, #333)" }}>

          {/* 追加方法 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              1. Zoom連携の追加方法
            </h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>BizQuestにログインします</li>
              <li>「マイページ」→「スケジュール調整設定」を開きます</li>
              <li>「外部連携」から「Zoomと連携する」を選択します</li>
              <li>Zoomのログイン画面が表示されるので、ご自身のZoomアカウントでログインし、権限の許可（Authorize）を行います</li>
              <li>BizQuestの画面に戻り、「連携済み」と表示されれば設定は完了です</li>
            </ol>
            <p className="mt-3 p-3 rounded-xl text-xs" style={{ background: "rgba(90,140,92,0.08)", color: "var(--color-ink-700, #555)" }}>
              うまく連携できない場合は、一度「連携解除」を行ってから再度お試しください。それでも解決しない場合は、
              <a href="/support" style={{ color: "var(--color-brand, #B5384B)" }}>サポート窓口</a>
              までご連絡ください。
            </p>
          </section>

          {/* 使い方 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              2. 使い方
            </h2>
            <p className="mb-2">
              Zoom連携を行うと、メンバー同士の1to1やミーティングの日程が確定した際に、Zoomミーティングの参加URLが自動的に発行されます。発行されたURLは、確認メールおよびBizQuest画面上の該当ミーティング詳細ページに自動的に反映されます。手動でZoomアプリを開いてミーティングを作成する必要はありません。
            </p>
            <p className="font-semibold mb-1">前提条件</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>有効なZoomアカウント（無料プランでも利用可能）をお持ちであること</li>
              <li>上記「1. Zoom連携の追加方法」の手順を完了していること</li>
            </ul>
          </section>

          {/* 削除方法 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              3. Zoom連携の削除方法
            </h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>「マイページ」→「スケジュール調整設定」→「外部連携」を開きます</li>
              <li>Zoomの項目にある「連携解除」を選択します</li>
            </ol>
            <p className="mt-3">
              連携を解除すると、BizQuestに保存されているZoomのアクセストークン・リフレッシュトークンは直ちに削除され、以降Zoomミーティングの自動作成は行われなくなります。すでに発行済みのミーティングURLには影響しません。詳しい個人情報の取り扱いについては
              <a href="/privacy" style={{ color: "var(--color-brand, #B5384B)" }}>プライバシーポリシー</a>
              をご確認ください。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              関連ページ
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <a href="/support" style={{ color: "var(--color-brand, #B5384B)" }}>サポート</a>
              </li>
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
