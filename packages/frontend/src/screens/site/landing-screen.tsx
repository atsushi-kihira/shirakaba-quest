import { useState, useEffect } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { SiteNav } from "./_site-nav";
import { SiteFooter } from "./_site-footer";

const OTP_TTL_MS = 600_000;

type Step = "email" | "otp";

export function LandingScreen() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  useEffect(() => {
    if (token) navigate("/home", { replace: true });
  }, [token, navigate]);

  if (token) return null;

  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-100)" }}>
      <SiteNav />

      {/* ヒーロー */}
      <section className="py-20 px-6 text-center" style={{ background: "var(--color-paper-200)", borderBottom: "1px solid var(--color-paper-300)" }}>
        <div className="flex justify-center mb-6">
          <img src="/bizquest-logo.png" alt="BizQuest" className="w-28 h-28 sm:w-36 sm:h-36 object-contain drop-shadow-md" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold leading-tight mb-4"
          style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          深く知り合うほど、<br />信頼は強くなる
        </h1>
        <p className="text-base leading-relaxed mb-8 text-center" style={{ color: "var(--color-ink-500)" }}>
          BizQuestは、メンバー同士がゲームを通じてお互いをもっと深く理解し、
          本当に頼り合える信頼のネットワークへと育てるためのプラットフォームです。
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <a href="#login" className="px-6 py-2.5 rounded-lg text-white text-sm font-medium transition hover:opacity-90"
            style={{ background: "var(--color-brand)" }}>
            ログインして始める
          </a>
          <NavLink to="/features"
            className="px-6 py-2.5 rounded-lg text-sm transition hover:opacity-80"
            style={{ border: "1px solid var(--color-paper-300)", color: "var(--color-ink-600)", background: "var(--color-paper-50)" }}>
            機能を見る
          </NavLink>
        </div>
      </section>

      {/* 特徴 */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-xl font-semibold text-center mb-2"
          style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          BizQuestでできること
        </h2>
        <p className="text-sm text-center mb-10" style={{ color: "var(--color-ink-400)" }}>
          ゲームの力で、メンバー同士の理解と信頼を深める
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {[
            { icon: "🃏", title: "お互いの強みを知る", desc: "1on1を実施するとお互いのスキルカードを入手。メンバーが持つ3つの強みをゲームを通じて自然に覚えられます。" },
            { icon: "⚔️", title: "クエストで理解を深める", desc: "AIが生成するビジネス課題に、仲間のスキルを組み合わせて挑戦。誰が何を得意としているのか自然に理解できます。" },
            { icon: "📅", title: "交流の機会を効率よく増やす", desc: "1on1から複数人のミーティングまで対応した日程調整ツールで交流の機会をスムーズに設定。外部ゲストをURLで招待することも可能です。" },
            { icon: "🏆", title: "ネットワークを可視化する", desc: "1on1・クエスト・リアルカード交換でポイントを獲得。ランキングで交流の活発さをネットワーク全体で共有します。" },
          ].map((f) => (
            <div key={f.title} className="flex gap-4 p-5 rounded-xl transition hover:opacity-90"
              style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
              <div className="text-3xl shrink-0">{f.icon}</div>
              <div>
                <h3 className="text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-800)" }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--color-ink-400)" }}>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 使い方 */}
      <section className="py-16 px-6" style={{ background: "var(--color-paper-200)", borderTop: "1px solid var(--color-paper-300)", borderBottom: "1px solid var(--color-paper-300)" }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold text-center mb-2"
            style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            使い方の流れ
          </h2>
          <p className="text-sm text-center mb-10" style={{ color: "var(--color-ink-400)" }}>
            登録から、信頼のネットワーク作りへ
          </p>
          <div className="rounded-xl overflow-hidden divide-y" style={{ border: "1px solid var(--color-paper-300)" }}>
            {[
              { n: 1, title: "自分のスキルカードを登録する", desc: "管理者承認後、自分の得意なこと・強みを3つ登録。あなたを表すスキルカードが作られます。" },
              { n: 2, title: "1on1でカードを交換する", desc: "メンバーと1on1を実施すると、お互いのスキルカードが手に入ります。双方が完了ボタンを押すことで成立します。" },
              { n: 3, title: "クエストに挑戦してポイントを獲得する", desc: "集めたカードのスキルを組み合わせてビジネス課題を解決。正解でポイントが加算されます。" },
              { n: 4, title: "信頼のネットワークが育っていく", desc: "積み重ねた交流がポイントとランキングに反映され、メンバーへの理解と信頼が自然と深まっていきます。" },
            ].map((step) => (
              <div key={step.n} className="flex" style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)" }}>
                <div className="w-14 flex items-center justify-center shrink-0 py-5"
                  style={{ background: "var(--color-paper-200)", borderRight: "1px solid var(--color-paper-300)" }}>
                  <div className="w-7 h-7 rounded-full text-white text-xs font-medium flex items-center justify-center"
                    style={{ background: "var(--color-brand)" }}>
                    {step.n}
                  </div>
                </div>
                <div className="px-5 py-4">
                  <h3 className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-800)" }}>{step.title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-400)" }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ログインセクション */}
      <section id="login" className="py-16 px-6">
        <div className="max-w-sm mx-auto">
          <h2 className="text-xl font-semibold text-center mb-2"
            style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            ログインして始める
          </h2>
          <p className="text-sm text-center mb-8" style={{ color: "var(--color-ink-400)" }}>
            ネットワーク管理者から案内されたアカウントでログイン
          </p>
          <LoginCard />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

// ====================================================
// 白樺クエスト ログインカード（OTPフロー内蔵）
// ====================================================
function LoginCard() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { appTitle, appLogo, characterImageUrl } = useSettings();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await api.post<{ ok: boolean; status?: string; message?: string }>(
        "/auth/request-otp",
        { email, context: "member" }
      );
      if (!res.ok && res.message) {
        setIsPending(res.status === "pending");
        setError(res.message);
        return;
      }
      setOtpSentAt(Date.now());
      setStep("otp");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("通信エラーが発生しました。もう一度お試しください。");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await api.post<{
        token: string;
        userType: "member" | "admin";
        user: { id: string; name: string; email: string; emoji: string; bgColor: string };
      }>("/auth/verify-otp", { email, code: otp, context: "member" });
      setAuth(res.token, {
        id: res.user.id,
        userType: res.userType,
        name: res.user.name ?? "",
        email: res.user.email ?? "",
        emoji: res.user.emoji,
        bgColor: res.user.bgColor,
      });
      navigate(res.userType === "admin" ? "/admin" : "/home");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401)
        setError("コードが正しくないか、有効期限が切れています。もう一度お試しください。");
      else setError("エラーが発生しました。もう一度お試しください。");
    } finally {
      setIsLoading(false);
    }
  }

  function handleOtpExpired() {
    setStep("email");
    setOtp("");
    setOtpSentAt(null);
    setError("認証コードの有効期限が切れました。もう一度メールアドレスを入力してください。");
  }

  return (
    <div className="rounded-2xl overflow-hidden shadow-md" style={{ border: "1px solid var(--color-paper-300)" }}>
      {/* ヘッダー */}
      <div className="py-6 px-6 text-center" style={{ background: "var(--color-brand)" }}>
        {characterImageUrl ? (
          <img src={characterImageUrl} alt="キャラクター" className="w-20 h-20 object-contain mx-auto mb-3" />
        ) : (
          <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-4xl"
            style={{ background: "rgba(255,255,255,0.18)", border: "2px solid rgba(255,255,255,0.4)" }}>
            {appLogo}
          </div>
        )}
        <h3 className="text-xl font-semibold text-white mb-1" style={{ fontFamily: "var(--font-klee)" }}>
          {appTitle}
        </h3>
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>
          powered by BizQuest
        </p>
      </div>

      {/* フォーム */}
      <div className="px-6 py-6" style={{ background: "var(--color-paper-100)" }}>
        {isPending && error ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">⏳</div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-800)" }}>承認待ちです</p>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{error}</p>
          </div>
        ) : step === "email" ? (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="name@example.com"
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{
                  background: "var(--color-paper-50)",
                  border: "1px solid var(--color-paper-300)",
                  color: "var(--color-ink-900)",
                }}
              />
            </div>
            {error && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
                ⚠️ {error}
              </p>
            )}
            <button
              type="submit"
              disabled={isLoading || !email}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2 transition hover:opacity-90"
              style={{ background: "var(--color-brand)" }}
            >
              {isLoading ? <Loader2 size={15} className="animate-spin" /> : "✨"}
              {isLoading ? "送信中..." : "認証コードを送信する"}
            </button>
          </form>
        ) : (
          <OtpStep
            email={email}
            otp={otp}
            onChange={setOtp}
            onSubmit={handleOtpSubmit}
            onBack={() => { setStep("email"); setOtp(""); setOtpSentAt(null); setError(null); }}
            onExpired={handleOtpExpired}
            otpSentAt={otpSentAt}
            isLoading={isLoading}
            error={error}
          />
        )}

        <div className="mt-4 pt-4 flex items-center justify-center gap-2"
          style={{ borderTop: "1px solid var(--color-paper-300)" }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-success)" }} />
          <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>BizQuest プラットフォームで稼働中</span>
        </div>
      </div>
    </div>
  );
}

// ====================================================
// OTPステップ
// ====================================================
type OtpStepProps = {
  email: string;
  otp: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  onExpired: () => void;
  otpSentAt: number | null;
  isLoading: boolean;
  error: string | null;
};

function OtpStep({ email, otp, onChange, onSubmit, onBack, onExpired, otpSentAt, isLoading, error }: OtpStepProps) {
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    if (!otpSentAt) return OTP_TTL_MS / 1000;
    return Math.max(0, Math.round((OTP_TTL_MS - (Date.now() - otpSentAt)) / 1000));
  });

  useEffect(() => {
    if (timeLeft <= 0) { onExpired(); return; }
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(timer); onExpired(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="text-center text-sm mb-2" style={{ color: "var(--color-ink-600)" }}>
        📬 <span className="font-medium">{email}</span> に6桁のコードを送信しました
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
          確認コード（6桁）
        </label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={otp}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
          placeholder="123456"
          className="w-full rounded-xl px-4 py-2.5 text-center text-xl tracking-[0.4em] font-semibold outline-none font-mono"
          style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-900)" }}
        />
        <p className="mt-1 text-xs text-center" style={{ color: "var(--color-ink-400)" }}>
          残り {minutes}:{String(seconds).padStart(2, "0")}
        </p>
      </div>
      {error && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
          ⚠️ {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isLoading || otp.length !== 6}
        className="w-full py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2 transition hover:opacity-90"
        style={{ background: "var(--color-brand)" }}
      >
        {isLoading ? <Loader2 size={15} className="animate-spin" /> : "✅ ログインする"}
      </button>
      <button type="button" onClick={onBack}
        className="flex items-center justify-center gap-1 text-xs w-full py-1.5 rounded-lg transition"
        style={{ color: "var(--color-ink-500)" }}>
        <ArrowLeft size={12} />
        メールアドレスを入力し直す
      </button>
    </form>
  );
}
