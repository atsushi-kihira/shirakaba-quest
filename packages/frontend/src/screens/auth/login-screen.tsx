// =============================================================
// ログイン画面 — パスワードレス OTP
// =============================================================
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Mail, Sparkles, ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { PublicMember } from "@shared/types";

type Step = "email" | "otp";

type VerifyResponse = {
  token: string;
  userType: "member" | "admin";
  user: Pick<PublicMember, "id" | "name" | "email" | "emoji" | "bgColor">;
};

export function LoginScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);

  // /admin からのリダイレクト時は管理者ログインモード
  const redirectTo = searchParams.get("redirect") ?? null;
  const isAdminMode = redirectTo === "/admin";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // ---- Step1: メールアドレス送信 ----
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await api.post<{ ok: boolean; status?: string; message?: string }>(
        "/auth/request-otp",
        { email, context: isAdminMode ? "admin" : "member" }
      );
      // 承認待ち・停止中の場合はメッセージを表示してOTPステップには進まない
      if (!res.ok && res.message) {
        setIsPending(res.status === "pending");
        setError(res.message);
        return;
      }
      setStep("otp");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("通信エラーが発生しました。もう一度お試しください。");
      }
    } finally {
      setIsLoading(false);
    }
  }

  // ---- Step2: OTPコード検証 ----
  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await api.post<VerifyResponse>("/auth/verify-otp", {
        email,
        code: otp,
        context: isAdminMode ? "admin" : "member",
      });
      setAuth(res.token, {
        id: res.user.id,
        userType: res.userType,
        name: res.user.name ?? "",
        email: res.user.email ?? "",
        emoji: res.user.emoji,
        bgColor: res.user.bgColor,
      });
      // redirect パラメータがあればそこへ、なければ種別に応じてデフォルト遷移
      navigate(redirectTo ?? (res.userType === "admin" ? "/admin" : "/"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("コードが正しくないか、有効期限が切れています。もう一度お試しください。");
      } else {
        setError("エラーが発生しました。もう一度お試しください。");
      }
    } finally {
      setIsLoading(false);
    }
  }

  // 管理者ログインモード時はダークスレートテーマ
  if (isAdminMode) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-8"
        style={{ background: "#0f172a" }}>
        {/* ロゴ・タイトル */}
        <div className="mb-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}>
            <span className="text-3xl">⚙️</span>
          </div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "white" }}>
            管理ダッシュボード
          </h1>
          <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
            白樺クエスト 運営者専用
          </p>
        </div>

        {/* 承認待ちバナー（管理者では不要だが念のため） */}
        {isPending && error && (
          <div className="w-full max-w-sm mb-4 rounded-2xl px-4 py-3"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>⚠️ {error}</p>
          </div>
        )}

        {/* ログインカード */}
        <div className="w-full max-w-sm rounded-2xl p-8"
          style={{ background: "#1e293b", border: "1px solid #334155" }}>
          {step === "email" ? (
            <AdminEmailStep
              email={email}
              onChange={setEmail}
              onSubmit={handleEmailSubmit}
              isLoading={isLoading}
              error={isPending ? null : error}
            />
          ) : (
            <AdminOtpStep
              email={email}
              otp={otp}
              onChange={setOtp}
              onSubmit={handleOtpSubmit}
              onBack={() => { setStep("email"); setOtp(""); setError(null); }}
              isLoading={isLoading}
              error={error}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-8" style={{ background: "var(--color-paper-100)" }}>
      {/* ロゴ・タイトル */}
      <div className="mb-8 text-center">
        <div className="text-6xl mb-3">🃏</div>
        <h1 className="text-3xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
          白樺クエスト
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-ink-500)" }}>
          仲間と一緒に、1to1でつながろう
        </p>
      </div>

      {/* 承認待ちバナー */}
      {isPending && error && (
        <div className="w-full max-w-sm mb-4 rounded-3xl p-5 text-center"
          style={{ background: "var(--color-paper-200)" }}>
          <div className="text-4xl mb-2">⏳</div>
          <p className="font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
            承認待ちです
          </p>
          <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>
            {error}
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--color-ink-400)" }}>
            承認されると登録したメールアドレスに通知が届きます
          </p>
        </div>
      )}

      {/* カード */}
      <div className="card-paper w-full max-w-sm rounded-3xl p-8">
        {step === "email" ? (
          <EmailStep
            email={email}
            onChange={setEmail}
            onSubmit={handleEmailSubmit}
            isLoading={isLoading}
            error={isPending ? null : error}
          />
        ) : (
          <OtpStep
            email={email}
            otp={otp}
            onChange={setOtp}
            onSubmit={handleOtpSubmit}
            onBack={() => { setStep("email"); setOtp(""); setError(null); }}
            isLoading={isLoading}
            error={error}
          />
        )}
      </div>

      {/* 新規登録リンク */}
      {step === "email" && (
        <div className="mt-6 text-center text-sm" style={{ color: "var(--color-ink-600)" }}>
          まだアカウントがない方は{" "}
          <a
            href="/register"
            className="font-semibold underline"
            style={{ color: "var(--color-brand)" }}
          >
            こちらから登録
          </a>
        </div>
      )}
    </div>
  );
}

// ---- 管理者向け Email 入力ステップ（ダークテーマ） ----
function AdminEmailStep({ email, onChange, onSubmit, isLoading, error }: EmailStepProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "white" }}>
          管理者ログイン
        </h2>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
          登録済みの管理者メールアドレスを入力してください
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.6)" }}>
          メールアドレス
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => onChange(e.target.value)}
          required
          autoComplete="email"
          placeholder="admin@example.com"
          className="w-full rounded-xl px-4 py-3 text-sm outline-none transition"
          style={{
            background: "#0f172a",
            border: "1.5px solid #334155",
            color: "white",
          }}
        />
      </div>

      {error && (
        <p className="text-xs rounded-xl px-4 py-3"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
          ⚠️ {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading || !email}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-medium text-sm transition disabled:opacity-40"
        style={{ background: "#6366f1", color: "white" }}
      >
        {isLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Sparkles size={16} />
        )}
        {isLoading ? "送信中..." : "認証コードを送信"}
      </button>
    </form>
  );
}

// ---- 管理者向け OTP 入力ステップ（ダークテーマ） ----
function AdminOtpStep({ email, otp, onChange, onSubmit, onBack, isLoading, error }: OtpStepProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "white" }}>
          確認コードを入力
        </h2>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>{email}</span> に送信した6桁のコードを入力してください
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.6)" }}>
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
          className="w-full rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] font-semibold outline-none transition"
          style={{
            background: "#0f172a",
            border: "1.5px solid #334155",
            color: "white",
            fontFamily: "monospace",
          }}
        />
        <p className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          ※ コードの有効期限は10分です
        </p>
      </div>

      {error && (
        <p className="text-xs rounded-xl px-4 py-3"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
          ⚠️ {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading || otp.length !== 6}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-medium text-sm transition disabled:opacity-40"
        style={{ background: "#6366f1", color: "white" }}
      >
        {isLoading ? <Loader2 size={16} className="animate-spin" /> : "ログインする"}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="flex items-center justify-center gap-1 text-sm w-full py-2 rounded-xl transition"
        style={{ color: "rgba(255,255,255,0.35)" }}
      >
        <ArrowLeft size={14} />
        メールアドレスを入力し直す
      </button>
    </form>
  );
}

// ---- Email 入力ステップ ----
type EmailStepProps = {
  email: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
};

function EmailStep({ email, onChange, onSubmit, isLoading, error }: EmailStepProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
          style={{ background: "var(--color-paper-200)" }}>
          <Mail size={22} style={{ color: "var(--color-brand)" }} />
        </div>
        <h2 className="text-xl" style={{ fontFamily: "var(--font-klee)" }}>
          メールアドレスでログイン
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-ink-500)" }}>
          登録したメールアドレスを入力してください
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-700)" }}>
          メールアドレス
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => onChange(e.target.value)}
          required
          autoComplete="email"
          placeholder="your@email.com"
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none transition"
          style={{
            background: "var(--color-paper-50)",
            border: "1.5px solid var(--color-paper-300)",
            color: "var(--color-ink-800)",
          }}
        />
      </div>

      {error && (
        <p className="text-sm rounded-xl px-4 py-3"
          style={{ background: "var(--color-paper-200)", color: "#b91c1c" }}>
          ⚠️ {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading || !email}
        className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 font-medium text-sm transition disabled:opacity-50"
        style={{ background: "var(--color-brand)", color: "white" }}
      >
        {isLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Sparkles size={16} />
        )}
        {isLoading ? "送信中..." : "コードを送信する"}
      </button>
    </form>
  );
}

// ---- OTP 入力ステップ ----
type OtpStepProps = {
  email: string;
  otp: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  isLoading: boolean;
  error: string | null;
};

function OtpStep({ email, otp, onChange, onSubmit, onBack, isLoading, error }: OtpStepProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="text-center">
        <div className="text-4xl mb-3">📬</div>
        <h2 className="text-xl" style={{ fontFamily: "var(--font-klee)" }}>
          確認コードを入力
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-ink-500)" }}>
          <span className="font-medium" style={{ color: "var(--color-ink-700)" }}>{email}</span>
          {" "}に送信した6桁のコードを入力してください
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-700)" }}>
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
          className="w-full rounded-2xl px-4 py-3 text-center text-2xl tracking-[0.5em] font-semibold outline-none transition"
          style={{
            background: "var(--color-paper-50)",
            border: "1.5px solid var(--color-paper-300)",
            color: "var(--color-ink-800)",
            fontFamily: "monospace",
          }}
        />
        <p className="mt-1 text-xs" style={{ color: "var(--color-ink-400)" }}>
          ※ コードの有効期限は10分です
        </p>
      </div>

      {error && (
        <p className="text-sm rounded-xl px-4 py-3"
          style={{ background: "var(--color-paper-200)", color: "#b91c1c" }}>
          ⚠️ {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading || otp.length !== 6}
        className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 font-medium text-sm transition disabled:opacity-50"
        style={{ background: "var(--color-brand)", color: "white" }}
      >
        {isLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          "✅ ログインする"
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="flex items-center justify-center gap-1 text-sm w-full py-2 rounded-xl transition"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={14} />
        メールアドレスを入力し直す
      </button>
    </form>
  );
}
