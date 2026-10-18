// =============================================================
// メンバー登録 — メールアドレス確認リンク着地画面
// 確認メール内のリンクから開かれる。リンクを開いた時点で、入力済みの内容で仮登録（承認待ち）が完了する。
// =============================================================
import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";

export function RegisterVerifyScreen() {
  const { appTitle } = useSettings();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  // true: この画面を開いた時点で登録申請まで完了した ／ false: メールの確認のみ完了（元の登録画面で続きを送信する）
  const [registered, setRegistered] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("確認リンクが正しくありません。");
      return;
    }
    api.post<{ data: { email: string; registered?: boolean } }>("/register/verify-email", { token })
      .then((res) => { setRegistered(!!res.data?.registered); setState("done"); })
      .catch((e) => {
        setState("error");
        setMessage(e instanceof ApiError ? e.message : "確認に失敗しました。もう一度お試しください。");
      });
  }, [token]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6"
      style={{ background: "var(--color-paper-100)" }}>
      <div className="card-paper p-8 max-w-sm w-full text-center">
        {state === "loading" && (
          <>
            <Loader2 size={40} className="animate-spin mx-auto mb-4" style={{ color: "var(--color-brand)" }} />
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>確認しています...</p>
          </>
        )}
        {state === "done" && registered && (
          <>
            <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: "var(--color-success)" }} />
            <h1 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              登録申請を受け付けました
            </h1>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
              メールアドレスの確認と、{appTitle}への登録申請が完了しました。<br />
              管理者の承認をお待ちください。承認されると、ログインしてご利用いただけます。
            </p>
            <p className="text-xs mb-4" style={{ color: "var(--color-ink-400)" }}>
              ※ 金の卵・金のガチョウは、承認後の初めてのログインのときにご案内します。
            </p>
            <Link to="/login" className="text-sm underline" style={{ color: "var(--color-brand)" }}>ログイン画面へ</Link>
          </>
        )}
        {state === "done" && !registered && (
          <>
            <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: "var(--color-success)" }} />
            <h1 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              メールアドレスを確認できました
            </h1>
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              このタブは閉じていただいて大丈夫です。<br />
              もとの{appTitle}登録画面のタブに戻ると、自動的に続きが始まります。
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <XCircle size={48} className="mx-auto mb-4" style={{ color: "var(--color-brand)" }} />
            <h1 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              確認できませんでした
            </h1>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>{message}</p>
            <Link to="/register" className="text-sm underline" style={{ color: "var(--color-brand)" }}>
              登録をやり直す
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
