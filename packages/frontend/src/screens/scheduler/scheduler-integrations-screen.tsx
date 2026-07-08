// SC-02 外部連携設定画面 — Google カレンダー / Zoom の接続・解除
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

type ZoomStatus = {
  connected: boolean;
  zoomAccountEmail: string | null;
  connectedAt: string | null;
};

export function SchedulerIntegrationsScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: googleData, isLoading: googleLoading } = useQuery<{ data: GoogleStatus }>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => request("/scheduler/oauth/google/status"),
  });

  const { data: zoomData, isLoading: zoomLoading } = useQuery<{ data: ZoomStatus }>({
    queryKey: ["scheduler", "zoom-status"],
    queryFn: () => request("/scheduler/oauth/zoom/status"),
  });

  const googleStatus = googleData?.data;
  const zoomStatus = zoomData?.data;

  const startGoogleOAuth = useMutation({
    mutationFn: () =>
      request<{ data: { authUrl: string } }>("/scheduler/oauth/google/start"),
    onSuccess: (res: { data: { authUrl: string } }) => {
      window.location.href = res.data.authUrl;
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  const disconnectGoogle = useMutation({
    mutationFn: () =>
      request("/scheduler/oauth/google/disconnect", { method: "POST", body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler", "google-status"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  const startZoomOAuth = useMutation({
    mutationFn: () =>
      request<{ data: { authUrl: string } }>("/scheduler/oauth/zoom/start"),
    onSuccess: (res: { data: { authUrl: string } }) => {
      window.location.href = res.data.authUrl;
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  const disconnectZoom = useMutation({
    mutationFn: () =>
      request("/scheduler/oauth/zoom/disconnect", { method: "POST", body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler", "zoom-status"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  const params = new URLSearchParams(window.location.search);
  const justGoogleConnected = params.get("google_connected") === "1";
  const justZoomConnected = params.get("zoom_connected") === "1";
  const googleError = params.get("google_error");
  const zoomError = params.get("zoom_error");

  const isLoading = googleLoading || zoomLoading;

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
        カレンダーや会議ツールと連携すると、空き時間の自動確認と会議URLの自動発行ができます。
      </p>

      {/* 成功バナー */}
      {justGoogleConnected && (
        <div className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm"
          style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)" }}>
          <CheckCircle2 size={16} />
          Googleカレンダーとの連携が完了しました！
        </div>
      )}
      {justZoomConnected && (
        <div className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm"
          style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)" }}>
          <CheckCircle2 size={16} />
          Zoomとの連携が完了しました！
        </div>
      )}

      {/* エラーバナー */}
      {(googleError || zoomError || error) && (
        <div className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm"
          style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
          <AlertCircle size={16} />
          {googleError === "no_refresh_token"
            ? "連携が完了しませんでした。「別のアカウントで試す」を選択してアクセス許可してください。"
            : error ?? "連携中にエラーが発生しました。もう一度お試しください。"}
        </div>
      )}

      {/* Google カレンダー連携カード */}
      <IntegrationCard
        icon="📅"
        name="Googleカレンダー"
        connected={!!googleStatus?.connected}
        connectedEmail={googleStatus?.googleAccountEmail ?? null}
        connectedFeatures={["空き時間の自動確認", "Google Meet URLの自動発行", "Googleカレンダーへの予定自動登録"]}
        isPending={startGoogleOAuth.isPending || disconnectGoogle.isPending}
        onConnect={() => startGoogleOAuth.mutate()}
        onDisconnect={() => {
          if (confirm("Googleカレンダーの連携を解除しますか？")) disconnectGoogle.mutate();
        }}
        disconnectPending={disconnectGoogle.isPending}
      />

      {/* Zoom 連携カード */}
      <IntegrationCard
        icon="🎥"
        name="Zoom"
        connected={!!zoomStatus?.connected}
        connectedEmail={zoomStatus?.zoomAccountEmail ?? null}
        connectedFeatures={["Zoom ミーティングURLの自動発行"]}
        isPending={startZoomOAuth.isPending || disconnectZoom.isPending}
        onConnect={() => startZoomOAuth.mutate()}
        onDisconnect={() => {
          if (confirm("Zoomの連携を解除しますか？")) disconnectZoom.mutate();
        }}
        disconnectPending={disconnectZoom.isPending}
      />

      {/* 次のステップ */}
      {(googleStatus?.connected || zoomStatus?.connected) && (
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

type IntegrationCardProps = {
  icon: string;
  name: string;
  connected: boolean;
  connectedEmail: string | null;
  connectedFeatures: string[];
  isPending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  disconnectPending: boolean;
};

function IntegrationCard({
  icon, name, connected, connectedEmail, connectedFeatures,
  isPending, onConnect, onDisconnect, disconnectPending,
}: IntegrationCardProps) {
  return (
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
            {icon}
          </div>
          <div>
            <p className="font-bold" style={{ color: "var(--color-ink-900)" }}>{name}</p>
            {connected ? (
              <p className="text-xs mt-0.5" style={{ color: "var(--color-success)" }}>
                <CheckCircle2 size={12} className="inline mr-1" />
                {connectedEmail ? `${connectedEmail} で連携中` : "連携中"}
              </p>
            ) : (
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>未連携</p>
            )}
          </div>
        </div>

        {connected ? (
          <button
            onClick={onDisconnect}
            disabled={disconnectPending}
            className="text-sm px-3 py-1.5 rounded-xl border flex-shrink-0"
            style={{ borderColor: "var(--color-paper-400)", color: "var(--color-ink-500)" }}
          >
            {disconnectPending ? "解除中..." : "連携を解除"}
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={isPending}
            className="text-sm px-4 py-2 rounded-xl font-bold text-white flex-shrink-0 flex items-center gap-1.5"
            style={{ background: "var(--color-brand)" }}
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            連携する
          </button>
        )}
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
        {connected ? (
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            {connectedFeatures.map((f) => `✅ ${f}`).join("\n").split("\n").map((line, i) => (
              <span key={i}>{line}<br /></span>
            ))}
          </p>
        ) : (
          <>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>連携すると以下が自動化されます：</p>
            <ul className="text-xs mt-1 space-y-0.5" style={{ color: "var(--color-ink-500)" }}>
              {connectedFeatures.map((f) => <li key={f}>• {f}</li>)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
