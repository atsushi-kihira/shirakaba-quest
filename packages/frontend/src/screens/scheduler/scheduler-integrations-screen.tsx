// SC-02 外部連携設定画面 — Google カレンダーの接続・解除
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, CheckCircle2, AlertCircle, Loader2, ArrowLeft, CalendarDays } from "lucide-react";
import { request, ApiError } from "@/lib/api";

type GoogleStatus = {
  connected: boolean;
  googleAccountEmail: string | null;
  connectedAt: string | null;
};

export function SchedulerIntegrationsScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ data: GoogleStatus }>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => request("/scheduler/oauth/google/status"),
  });

  const status = data?.data;

  // OAuth 開始（authUrl を取得して window.location.href でリダイレクト）
  const startOAuth = useMutation({
    mutationFn: () =>
      request<{ data: { authUrl: string } }>("/scheduler/oauth/google/start"),
    onSuccess: (res) => {
      window.location.href = res.data.authUrl;
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  const disconnect = useMutation({
    mutationFn: () =>
      request("/scheduler/oauth/google/disconnect", { method: "POST", body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler", "google-status"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  // コールバック後のクエリパラメータを確認
  const params = new URLSearchParams(window.location.search);
  const justConnected = params.get("google_connected") === "1";
  const googleError = params.get("google_error");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button
        onClick={() => navigate("/scheduler")}
        className="flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={16} />
        スケジューラーに戻る
      </button>

      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--color-ink-900)" }}>
        🔗 外部サービス連携
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        Googleカレンダーと連携すると、空き時間の自動確認と会議URLの自動発行ができます。
      </p>

      {/* 成功・エラーバナー */}
      {justConnected && (
        <div className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm"
          style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)" }}>
          <CheckCircle2 size={16} />
          Googleカレンダーとの連携が完了しました！
        </div>
      )}
      {(googleError || error) && (
        <div className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm"
          style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
          <AlertCircle size={16} />
          {googleError === "no_refresh_token"
            ? "連携が完了しませんでした。「別のアカウントで試す」を選択してアクセス許可してください。"
            : error ?? "連携中にエラーが発生しました。もう一度お試しください。"}
        </div>
      )}

      {/* Google カレンダー連携カード */}
      <div
        className="rounded-2xl p-5 mb-4"
        style={{ background: "var(--color-paper-50)", border: "2px solid var(--color-paper-300)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}
            >
              📅
            </div>
            <div>
              <p className="font-bold" style={{ color: "var(--color-ink-900)" }}>
                Googleカレンダー
              </p>
              {status?.connected ? (
                <p className="text-xs mt-0.5" style={{ color: "var(--color-success)" }}>
                  <CheckCircle2 size={12} className="inline mr-1" />
                  {status.googleAccountEmail} で連携中
                </p>
              ) : (
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                  未連携
                </p>
              )}
            </div>
          </div>

          {status?.connected ? (
            <button
              onClick={() => {
                if (confirm("Googleカレンダーの連携を解除しますか？\n解除後は空き時間の自動確認と会議URLの自動発行ができなくなります。")) {
                  disconnect.mutate();
                }
              }}
              disabled={disconnect.isPending}
              className="text-sm px-3 py-1.5 rounded-xl border flex-shrink-0"
              style={{ borderColor: "var(--color-paper-400)", color: "var(--color-ink-500)" }}
            >
              {disconnect.isPending ? "解除中..." : "連携を解除"}
            </button>
          ) : (
            <button
              onClick={() => startOAuth.mutate()}
              disabled={startOAuth.isPending}
              className="text-sm px-4 py-2 rounded-xl font-bold text-white flex-shrink-0 flex items-center gap-1.5"
              style={{ background: "var(--color-brand)" }}
            >
              {startOAuth.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Link2 size={14} />
              )}
              連携する
            </button>
          )}
        </div>

        {status?.connected && (
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              ✅ 空き時間の自動確認が有効です<br />
              ✅ Google Meet URLの自動発行が有効です
            </p>
          </div>
        )}

        {!status?.connected && (
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              連携すると以下が自動化されます：
            </p>
            <ul className="text-xs mt-1 space-y-0.5" style={{ color: "var(--color-ink-500)" }}>
              <li>• カレンダーの空き時間を自動確認</li>
              <li>• 予約確定時に Google Meet URL を自動発行</li>
              <li>• Google カレンダーへの予定自動登録</li>
            </ul>
          </div>
        )}
      </div>

      {/* 次のステップ */}
      {status?.connected && (
        <div className="mt-6">
          <button
            onClick={() => navigate("/scheduler/settings")}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
            style={{ background: "var(--color-brand)" }}
          >
            <CalendarDays size={16} />
            受付時間を設定する →
          </button>
        </div>
      )}
    </div>
  );
}
