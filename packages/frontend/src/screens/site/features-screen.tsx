import { SiteNav } from "./_site-nav";
import { SiteFooter } from "./_site-footer";

type Feature = { icon: string; title: string; desc: string };

const CATEGORIES: { label: string; desc: string; accent: string; bg: string; features: Feature[] }[] = [
  {
    label: "スキルカード",
    desc: "メンバーの強みをカード化して共有する",
    accent: "var(--color-brand)",
    bg: "rgba(181,56,75,0.07)",
    features: [
      { icon: "✏️", title: "スキル登録・編集", desc: "自分のUSP・強みを3つ登録。いつでも編集できます。" },
      { icon: "📷", title: "名刺OCR読み取り", desc: "名刺を撮影するとAIが情報を自動入力します。" },
      { icon: "🃏", title: "デジタルカード入手", desc: "1on1完了でお互いのスキルカードがデジタルで手に入ります。" },
      { icon: "📱", title: "リアルカード交換記録", desc: "QRコードで物理的なカード交換を記録。ポイントが加算されます。" },
    ],
  },
  {
    label: "交流 & ミーティング",
    desc: "1on1から複数人の集まりまでスムーズに管理",
    accent: "var(--color-success)",
    bg: "rgba(90,140,92,0.07)",
    features: [
      { icon: "🤝", title: "1on1申込・完了管理", desc: "相手にリクエストを送り、双方の確認で1on1を記録します。" },
      { icon: "📅", title: "日程候補の作成・共有", desc: "複数の日程候補を作成し、URLをシェアするだけで参加者が回答できます。" },
      { icon: "📧", title: "外部ゲスト招待", desc: "メンバー外の方もURLだけで日程回答に参加できます。ログイン不要。" },
      { icon: "📆", title: "Googleカレンダー連携", desc: "確定したミーティングをGoogleカレンダーに自動追加します。" },
    ],
  },
  {
    label: "クエスト & ゲーム",
    desc: "ゲームを通じてメンバーへの理解を深める",
    accent: "var(--color-accent)",
    bg: "rgba(212,160,59,0.1)",
    features: [
      { icon: "🤖", title: "AIクエスト自動生成", desc: "AIがネットワークに合わせたビジネス課題を自動生成します。" },
      { icon: "⚔️", title: "クエスト挑戦・判定", desc: "集めたスキルカードを組み合わせて解答。サーバー側で正誤判定します。" },
      { icon: "🪙", title: "ポイント管理", desc: "1on1・クエスト・カード交換の活動に応じてポイントが自動加算されます。" },
      { icon: "🏆", title: "ランキング表示", desc: "ネットワーク全体のポイントランキングをリアルタイムで確認できます。" },
    ],
  },
  {
    label: "管理者機能",
    desc: "ネットワーク運営をトータルサポート",
    accent: "#7c5cbc",
    bg: "rgba(124,92,188,0.07)",
    features: [
      { icon: "👥", title: "メンバー管理", desc: "新規登録の承認・停止・削除をダッシュボードで一元管理します。" },
      { icon: "📨", title: "メール配信管理", desc: "システムが送信する全メールの文面・送信可否をカスタマイズできます。" },
      { icon: "🎨", title: "アプリカスタマイズ", desc: "タイトル・ロゴ・キャラクター・カード項目をネットワークに合わせて設定できます。" },
      { icon: "🔄", title: "ポイントリセット", desc: "シーズン区切りなどのタイミングでポイントを一括リセットできます。" },
    ],
  },
];

export function FeaturesScreen() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100)" }}>
      <SiteNav />

      <div className="py-12 text-center px-6" style={{ background: "var(--color-paper-200)", borderBottom: "1px solid var(--color-paper-300)" }}>
        <h1 className="text-2xl font-semibold mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          機能一覧
        </h1>
        <p className="text-sm leading-relaxed text-center" style={{ color: "var(--color-ink-500)" }}>
          BizQuestが提供する全機能の一覧です。メンバー向け機能と管理者向け機能を合わせて、ネットワークの活性化をトータルでサポートします。
        </p>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-12">
        {CATEGORIES.map((cat) => (
          <section key={cat.label}>
            <div className="flex items-center gap-3 mb-6 pb-4" style={{ borderBottom: "1px solid var(--color-paper-300)" }}>
              <div className="text-xs font-medium px-2.5 py-1 rounded-md" style={{ background: cat.bg, color: cat.accent }}>
                {cat.label}
              </div>
              <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>{cat.desc}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {cat.features.map((f) => (
                <div key={f.title} className="flex gap-4 p-4 rounded-xl transition hover:opacity-90"
                  style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
                  <div className="text-2xl shrink-0 mt-0.5">{f.icon}</div>
                  <div>
                    <h3 className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-800)" }}>{f.title}</h3>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-500)" }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <SiteFooter />
    </div>
  );
}
