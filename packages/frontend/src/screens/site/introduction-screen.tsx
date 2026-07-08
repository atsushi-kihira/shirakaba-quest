import { SiteNav } from "./_site-nav";
import { SiteFooter } from "./_site-footer";

const STEPS = [
  {
    num: 1,
    tag: "お問い合わせ",
    title: "導入のご相談・お問い合わせ",
    desc: "まずはお問い合わせフォームまたはメールにてご連絡ください。ネットワークの規模・ご要望をヒアリングしたうえで、導入プランをご提案します。",
  },
  {
    num: 2,
    tag: "初期設定",
    title: "アプリのカスタマイズ設定",
    desc: "ネットワーク専用のアプリ名・ロゴ・キャラクター・カード項目を設定します。管理者ダッシュボードから担当者ご自身で設定できます。",
  },
  {
    num: 3,
    tag: "メンバー登録",
    title: "メンバーの招待・登録",
    desc: "メンバーリストをもとに管理者がアカウントを作成し、招待メールを送信します。メンバーは届いたメールからログインして自分のスキルを登録します。",
  },
  {
    num: 4,
    tag: "カード作成",
    title: "スキルカードの作成",
    desc: "各メンバーが自分のUSP・強みを3つ登録してスキルカードを作成します。必要に応じて名刺のOCR読み取り機能が利用できます。",
  },
  {
    num: 5,
    tag: "運用開始",
    title: "ゲームスタート・運用開始",
    desc: "管理者がクエストを作成（またはAI自動生成）するとゲームが始まります。あとはメンバーが自然と1on1・クエスト・ランキングを楽しむだけです。",
  },
];

const FAQS = [
  {
    q: "何人から導入できますか？",
    a: "5名以上のネットワーク・コミュニティから導入いただけます。規模に応じたプランをご提案しますので、まずはご相談ください。",
  },
  {
    q: "ITに不慣れなメンバーでも使えますか？",
    a: "はい。パスワード不要のメール認証（ワンタイムコード）でログインでき、操作もスマートフォンに最適化されています。絵文字や親しみやすい日本語で設計しているため、IT操作が苦手な方にも安心してお使いいただけます。",
  },
  {
    q: "BNI以外の組織でも使えますか？",
    a: "はい。BizQuestはアプリ名・ロゴ・カード項目などをカスタマイズできる設計のため、業界団体・異業種交流会・社内コミュニティなど幅広い組織形態でご利用いただけます。",
  },
  {
    q: "料金はどうなっていますか？",
    a: "ネットワークの規模・利用状況に応じた料金プランをご用意しています。詳細はお問い合わせいただくか、担当者よりご説明します。",
  },
];

export function IntroductionScreen() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100)" }}>
      <SiteNav />

      <div className="py-12 text-center px-6" style={{ background: "var(--color-paper-200)", borderBottom: "1px solid var(--color-paper-300)" }}>
        <h1 className="text-2xl font-semibold mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          ネットワーク向け導入案内
        </h1>
        <p className="text-sm leading-relaxed text-center" style={{ color: "var(--color-ink-500)" }}>
          BizQuestはビジネスネットワーク・コミュニティ単位で導入するプラットフォームです。導入から運用開始まで、担当者がサポートします。
        </p>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12 space-y-14">

        {/* 必要なもの */}
        <section>
          <div className="text-xs font-medium tracking-wider mb-2" style={{ color: "var(--color-brand)" }}>REQUIREMENTS</div>
          <h2 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>導入に必要なもの</h2>
          <p className="text-sm mb-6" style={{ color: "var(--color-ink-400)" }}>特別なシステム知識は不要です。以下が揃えば導入できます。</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: "👤", title: "管理者アカウント", desc: "ネットワークを管理するメールアドレス（1名以上）" },
              { icon: "📋", title: "メンバーリスト", desc: "参加メンバーの氏名・メールアドレスの一覧" },
              { icon: "🎨", title: "アプリ設定情報", desc: "アプリ名・ロゴ・キャラクターなどのブランド設定" },
            ].map((item) => (
              <div key={item.title} className="rounded-xl p-5 text-center"
                style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-800)" }}>{item.title}</h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-400)" }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 導入ステップ */}
        <section>
          <div className="text-xs font-medium tracking-wider mb-2" style={{ color: "var(--color-brand)" }}>STEPS</div>
          <h2 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>導入の流れ</h2>
          <p className="text-sm mb-6" style={{ color: "var(--color-ink-400)" }}>お問い合わせから運用開始まで、最短1週間で導入できます。</p>
          <div className="rounded-xl overflow-hidden divide-y" style={{ border: "1px solid var(--color-paper-300)", borderColor: "var(--color-paper-300)" }}>
            {STEPS.map((step) => (
              <div key={step.num} className="flex" style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)" }}>
                <div className="w-14 flex items-center justify-center shrink-0 py-5"
                  style={{ background: "var(--color-paper-200)", borderRight: "1px solid var(--color-paper-300)" }}>
                  <div className="w-7 h-7 rounded-full text-white text-xs font-medium flex items-center justify-center"
                    style={{ background: "var(--color-brand)" }}>
                    {step.num}
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="text-xs font-medium mb-1" style={{ color: "var(--color-success)" }}>{step.tag}</div>
                  <h3 className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-800)" }}>{step.title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-500)" }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section>
          <div className="text-xs font-medium tracking-wider mb-2" style={{ color: "var(--color-brand)" }}>FAQ</div>
          <h2 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>よくある質問</h2>
          <p className="text-sm mb-6" style={{ color: "var(--color-ink-400)" }}>導入前によくいただくご質問をまとめました。</p>
          <div className="space-y-3">
            {FAQS.map((faq) => (
              <div key={faq.q} className="rounded-xl p-5"
                style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
                <p className="text-sm font-medium mb-2 flex gap-2" style={{ color: "var(--color-ink-900)" }}>
                  <span className="shrink-0 font-bold" style={{ color: "var(--color-brand)" }}>Q</span>
                  {faq.q}
                </p>
                <p className="text-sm leading-relaxed pl-5" style={{ color: "var(--color-ink-500)" }}>{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-2xl p-8 text-center"
          style={{ background: "rgba(181,56,75,0.06)", border: "1px solid rgba(181,56,75,0.2)" }}>
          <h2 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            導入のご相談はお気軽に
          </h2>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--color-ink-500)" }}>
            ネットワークの規模・状況に合わせた導入プランをご提案します。<br className="hidden sm:inline" />
            まずはお気軽にお問い合わせください。
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <a href="mailto:contact@bizolve.jp"
              className="px-6 py-2.5 rounded-lg text-white text-sm font-medium transition hover:opacity-90"
              style={{ background: "var(--color-brand)" }}>
              メールで問い合わせる
            </a>
            <a href="mailto:contact@bizolve.jp"
              className="px-6 py-2.5 rounded-lg text-sm transition hover:opacity-80"
              style={{ border: "1px solid var(--color-paper-300)", color: "var(--color-ink-600)", background: "var(--color-paper-50)" }}>
              contact@bizolve.jp
            </a>
          </div>
        </section>

      </div>

      <SiteFooter />
    </div>
  );
}
