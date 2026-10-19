// =============================================================
// メールアドレス変更 — 確認リンク着地画面
// 新しいメールアドレスに届いた確認メールのリンクから開かれる。開いた時点でメールアドレスが切り替わる。
// =============================================================
import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function EmailChangeVerifyScreen() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("確認リンクが正しくありません。");
      return;
    }
    api.post<{ data: { email: string } }>("/email-change/verify", { token })
      .then((res) => { setEmail(res.data.email); setState("done"); })
      .catch((e) => {
        setState("error");
        setMessage(e instanceof ApiError ? e.message : "確認に失敗しました。もう一度お試しください。");
      });
  }, [token]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6" style={{ background: "var(--color-paper-100)" }}>
      <div className="card-paper p-8 max-w-sm w-full text-center">
        {state === "loading" && (
          <>
            <Loader2 size={40} className="animate-spin mx-auto mb-4" style={{ color: "var(--color-brand)" }} />
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>確認しています...</p>
          </>
        )}
        {state === "done" && (
          <>
            <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: "var(--color-success)" }} />
            <h1 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              メールアドレスを変更しました
            </h1>
            <p className="text-sm mb-1 break-all" style={{ color: "var(--color-ink-700)" }}>{email}</p>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
              今後のログインや各種のお知らせは、このメールアドレスをご利用ください。
            </p>
            <Link to="/login" className="text-sm underline" style={{ color: "var(--color-brand)" }}>ログイン画面へ</Link>
          </>
        )}
        {state === "error" && (
          <>
            <XCircle size={48} className="mx-auto mb-4" style={{ color: "var(--color-brand)" }} />
            <h1 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              変更できませんでした
            </h1>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>{message}</p>
            <Link to="/login" className="text-sm underline" style={{ color: "var(--color-brand)" }}>ログイン画面へ</Link>
          </>
        )}
      </div>
    </div>
  );
}
