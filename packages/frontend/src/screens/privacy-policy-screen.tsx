// =============================================================
// プライバシーポリシー画面
// /privacy
// =============================================================
export function PrivacyPolicyScreen() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100, #FAF5E8)" }}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* ヘッダー */}
        <div className="mb-10">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: "var(--font-klee, 'Klee One', serif)", color: "var(--color-ink-900, #1a1a1a)" }}
          >
            プライバシーポリシー
          </h1>
          <p className="text-sm" style={{ color: "var(--color-ink-400, #888)" }}>
            制定日：2026年7月7日
          </p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed" style={{ color: "var(--color-ink-800, #333)" }}>

          {/* 1 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              1. はじめに
            </h2>
            <p>
              BizQuest（以下「本サービス」）は、ビジネスネットワーク・コミュニティ向けのコミュニケーション活性化プラットフォームです。各ネットワークの設定に応じたアプリ名でご利用いただけます。本ポリシーは、本サービスが収集する個人情報の種類、利用目的、管理方法について説明します。
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              2. 収集する情報
            </h2>

            <h3 className="font-semibold mb-2 mt-4">2-1. お客様が直接提供する情報</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>氏名（漢字・ふりがな・ローマ字）</li>
              <li>メールアドレス</li>
              <li>所属企業名、役職</li>
              <li>電話番号、住所</li>
              <li>事業内容・職種カテゴリー</li>
              <li>スキル・USP情報（3つのスキル）</li>
              <li>プロフィール写真</li>
            </ul>

            <h3 className="font-semibold mb-2 mt-4">2-2. サービス利用時に自動的に収集される情報</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>ログイン日時・操作履歴</li>
              <li>1to1の実施記録</li>
              <li>クエスト挑戦履歴・ポイント履歴</li>
              <li>ミーティングの日程回答</li>
              <li>名刺発注履歴</li>
            </ul>

            <h3 className="font-semibold mb-2 mt-4">2-3. Google連携により収集される情報</h3>
            <p className="mb-2">
              本サービスはGoogleカレンダー連携機能を提供しています。この機能を利用された場合、以下の情報にアクセスします。
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Googleカレンダーのイベント情報（読み取り・作成・更新）</li>
            </ul>
            <p className="mt-2 p-3 rounded-xl text-xs" style={{ background: "rgba(90,140,92,0.08)", color: "var(--color-ink-700, #555)" }}>
              Googleカレンダーへのアクセスは、明示的に連携を許可した管理者のアカウントのみが対象です。メンバーのGoogleアカウントにはアクセスしません。取得したカレンダー情報は、ミーティングスケジュールの管理機能のみに利用し、他の目的には使用しません。また、Google APIから取得したデータを第三者に販売・共有することはありません。
            </p>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              3. 情報の利用目的
            </h2>
            <p className="mb-2">収集した個人情報は、以下の目的のみに利用します。</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>本サービスの提供・運営・改善</li>
              <li>メンバー認証（ワンタイムパスワードの送信）</li>
              <li>ミーティング招待・日程調整の通知</li>
              <li>1to1完了・クエスト達成の通知</li>
              <li>名刺発注に関する連絡</li>
              <li>不正利用の防止・対応</li>
            </ol>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              4. 情報の第三者提供
            </h2>
            <p className="mb-3">
              以下の場合を除き、お客様の個人情報を第三者に提供することはありません。
            </p>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>お客様の事前同意がある場合</li>
              <li>法令に基づき開示が必要な場合</li>
              <li>人命・財産の保護のために緊急に必要な場合</li>
            </ul>

            <h3 className="font-semibold mb-2">業務委託先（外部サービス）</h3>
            <p className="mb-3">本サービスは以下の外部サービスを利用しており、業務上必要な範囲でデータが処理されます。</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ background: "var(--color-paper-300, #e8e0cc)" }}>
                    <th className="text-left px-3 py-2 rounded-tl-lg">サービス</th>
                    <th className="text-left px-3 py-2">用途</th>
                    <th className="text-left px-3 py-2 rounded-tr-lg">プライバシーポリシー</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Cloudflare", "サーバー・データベース・ファイル保管", "cloudflare.com/privacypolicy"],
                    ["SendGrid（Twilio）", "メール送信", "sendgrid.com/policies/privacy"],
                    ["Google", "カレンダー連携・OCR", "policies.google.com/privacy"],
                  ].map(([name, usage, url], i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "var(--color-paper-200, #f0e8d4)" : "transparent" }}>
                      <td className="px-3 py-2 font-medium">{name}</td>
                      <td className="px-3 py-2">{usage}</td>
                      <td className="px-3 py-2 font-mono" style={{ color: "var(--color-brand, #B5384B)" }}>{url}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              5. 情報の管理・保護
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>本サービスのデータはCloudflareのセキュアな環境に保管します</li>
              <li>通信はすべてHTTPS（TLS暗号化）で保護されます</li>
              <li>パスワードは保存せず、ワンタイムパスワード方式でログインします</li>
              <li>管理者以外のメンバーは、1to1が未実施の相手の名刺情報（会社・電話・住所）を閲覧できません</li>
            </ul>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              6. データの保存期間
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>アカウント情報：退会後180日間保存後、削除します</li>
              <li>ログイン履歴・操作ログ：1年間保存後、削除します</li>
              <li>Googleカレンダーの認証情報（アクセストークン）：連携解除後、直ちに削除します</li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              7. お客様の権利
            </h2>
            <p className="mb-2">お客様は以下の権利を有します。</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>自身の個人情報の開示・訂正・削除の請求</li>
              <li>個人情報の利用停止の請求</li>
              <li>Googleカレンダー連携の解除</li>
            </ul>
            <p className="mt-2">これらのご請求は、下記の問い合わせ先までご連絡ください。</p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              8. Cookieおよびローカルストレージ
            </h2>
            <p>
              本サービスはログイン状態の維持のために、ブラウザのローカルストレージに認証トークンを保存します。広告目的のトラッキングは行いません。
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              9. 未成年者について
            </h2>
            <p>
              本サービスは18歳以上のビジネスパーソンを対象としており、未成年者からの個人情報を意図的に収集しません。
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              10. プライバシーポリシーの変更
            </h2>
            <p>
              本ポリシーは法令の改正やサービス内容の変更に伴い、予告なく改定する場合があります。重要な変更がある場合は、本サービス内でお知らせします。
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              11. お問い合わせ
            </h2>
            <p className="mb-3">個人情報の取り扱いに関するお問い合わせは以下までご連絡ください。</p>
            <div
              className="p-4 rounded-2xl"
              style={{ background: "var(--color-paper-200, #f0e8d4)" }}
            >
              <p className="font-semibold mb-1">株式会社Bizolve Consulting</p>
              <p>
                メール：
                <a
                  href="mailto:contact@bizolve.jp"
                  style={{ color: "var(--color-brand, #B5384B)" }}
                >
                  contact@bizolve.jp
                </a>
              </p>
            </div>
          </section>

          {/* フッター注記 */}
          <p className="text-xs pt-4 border-t" style={{ borderColor: "var(--color-paper-300, #d8d0bc)", color: "var(--color-ink-400, #888)" }}>
            本ポリシーはGoogleのOAuth API利用ポリシー（Google API Services User Data Policy）に準拠しています。
          </p>
        </div>
      </div>
    </div>
  );
}
