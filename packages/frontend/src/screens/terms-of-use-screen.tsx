// =============================================================
// 利用規約画面
// /terms
// =============================================================
export function TermsOfUseScreen() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100, #FAF5E8)" }}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* ヘッダー */}
        <div className="mb-10">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: "var(--font-klee, 'Klee One', serif)", color: "var(--color-ink-900, #1a1a1a)" }}
          >
            利用規約
          </h1>
          <p className="text-sm" style={{ color: "var(--color-ink-400, #888)" }}>
            制定日：2026年7月21日
          </p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed" style={{ color: "var(--color-ink-800, #333)" }}>

          {/* 1 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              1. 適用
            </h2>
            <p>
              本規約は、株式会社Bizolve Consulting（以下「当社」）が提供するBizQuest（各ネットワークの設定に応じたアプリ名でご利用いただけます。以下「本サービス」）の利用条件を定めるものです。本サービスを利用するすべてのお客様（以下「利用者」）は、本規約に同意したものとみなします。
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              2. 利用資格
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>本サービスは、導入先のビジネスネットワーク・コミュニティや組織に所属する方を対象とした、招待制・承認制のサービスです</li>
              <li>新規登録は当社または導入先の管理者による承認をもって有効となります</li>
              <li>虚偽の情報での登録、なりすまし登録は禁止します</li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              3. アカウント管理
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>本サービスはパスワードを使用せず、メールアドレス宛のワンタイムコードによりログインします</li>
              <li>登録したメールアドレスの管理は利用者ご自身の責任で行ってください</li>
              <li>アカウントの第三者への譲渡・貸与はできません</li>
            </ul>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              4. 禁止事項
            </h2>
            <p className="mb-2">利用者は、本サービスの利用にあたり、以下の行為を行ってはなりません。</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>法令または公序良俗に違反する行為</li>
              <li>他の利用者になりすます行為、虚偽の情報を登録する行為</li>
              <li>本サービスのシステムに不正にアクセスする行為、脆弱性を悪用する行為</li>
              <li>他の利用者の個人情報を、本サービスの目的外に利用・開示する行為</li>
              <li>ポイント・ランキング等の仕組みを不正に操作する行為</li>
              <li>その他、当社が不適切と判断する行為</li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              5. ポイント・ランキングについて
            </h2>
            <p>
              本サービス内で付与される「ポイント」は、コミュニティ内での交流を促進するためのゲーム要素であり、金銭的価値を有さず、換金・譲渡はできません。ポイントの計算方法・付与ルールは、当社または導入先の管理者の判断により変更・リセットされる場合があります。
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              6. 実物カードの発注について
            </h2>
            <p>
              本サービスは、実物の名刺カードの発注機能を提供する場合があります。発注にあたって費用が発生する場合、その金額・支払い方法は発注画面に表示される内容に従います。発注後のキャンセル・返品については、導入先の運用方針に従うものとします。
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              7. 外部サービス連携
            </h2>
            <p>
              本サービスは、Googleカレンダー・Zoomとの連携機能を提供します。これらの連携は利用者自身の任意の操作により開始・解除でき、連携の利用は各サービスの利用規約にも従うものとします。連携により取得する情報の取り扱いは、
              <a href="/privacy" style={{ color: "var(--color-brand, #B5384B)" }}>プライバシーポリシー</a>
              をご確認ください。
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              8. サービスの停止・変更・終了
            </h2>
            <p>
              当社は、システムメンテナンス、障害対応、その他運営上必要と判断した場合、利用者への事前の通知なく、本サービスの全部または一部の提供を停止・変更・終了することがあります。
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              9. 免責事項
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>当社は、本サービスの内容の正確性・完全性・有用性について保証しません</li>
              <li>本サービスの利用によって利用者に生じたいかなる損害についても、当社の故意または重過失による場合を除き、責任を負いません</li>
              <li>利用者間のトラブル（1to1の実施・ミーティングの調整等）については、当事者間で解決するものとし、当社は関与しません</li>
            </ul>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              10. 利用停止・登録抹消
            </h2>
            <p>
              当社は、利用者が本規約に違反した場合、または不適切な利用があったと判断した場合、事前の通知なく当該利用者の利用を停止し、登録を抹消することがあります。
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              11. 規約の変更
            </h2>
            <p>
              当社は、必要と判断した場合、利用者への事前の通知なく本規約を変更することがあります。変更後の規約は、本サービス内に掲示した時点から効力を生じるものとします。
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              12. 準拠法・管轄裁判所
            </h2>
            <p>
              本規約の解釈にあたっては日本法を準拠法とします。本サービスに関して紛争が生じた場合には、当社の本店所在地を管轄する裁判所を専属的合意管轄とします。
            </p>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-ink-900, #1a1a1a)" }}>
              13. お問い合わせ
            </h2>
            <p className="mb-3">本規約に関するお問い合わせは以下までご連絡ください。</p>
            <div
              className="p-4 rounded-2xl"
              style={{ background: "var(--color-paper-200, #f0e8d4)" }}
            >
              <p className="font-semibold mb-1">株式会社Bizolve Consulting</p>
              <p>
                メール：
                <a href="mailto:contact@bizolve.jp" style={{ color: "var(--color-brand, #B5384B)" }}>
                  contact@bizolve.jp
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
