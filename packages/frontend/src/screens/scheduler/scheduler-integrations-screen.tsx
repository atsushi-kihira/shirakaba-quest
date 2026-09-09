// SC-02 外部連携設定画面 — Google カレンダー / Zoom の接続・解除
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, CheckCircle2, AlertCircle, Loader2, ArrowLeft, CalendarDays, Settings2, X } from "lucide-react";
import { request, ApiError } from "@/lib/api";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  no_refresh_token: "連携が完了しませんでした。「別のアカウントで試す」を選択してアクセス許可してください。",
  db_error: "データの保存中にエラーが発生しました。時間をおいて再度お試しください。解消しない場合はサポート窓口までご連絡ください。",
  token_exchange_failed: "認証情報のやり取りに失敗しました。もう一度お試しください。",
  userinfo_failed: "アカウント情報の取得に失敗しました。もう一度お試しください。",
  server_config_error: "サーバー設定エラーが発生しました。サポート窓口までご連絡ください。",
  state_mismatch: "連携セッションの有効期限が切れました。もう一度お試しください。",
  state_error: "連携セッションの確認に失敗しました。もう一度お試しください。",
  no_member: "メンバーとして登録されていないため連携できません。",
  unknown: "連携中にエラーが発生しました。もう一度お試しください。",
};

function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return OAUTH_ERROR_MESSAGES[code] ?? `連携中にエラーが発生しました（${code}）。もう一度お試しください。`;
}

type BusyCalendar = { id: string; summary: string };

type GoogleStatus = {
  connected: boolean;
  googleAccountEmail: string | null;
  connectedAt: string | null;
  busyCalendars: BusyCalendar[];
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
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);

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
          Googleとの連携が完了しました！
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
          {oauthErrorMessage(googleError) ?? oauthErrorMessage(zoomError) ?? error ?? "連携中にエラーが発生しました。もう一度お試しください。"}
        </div>
      )}

      {/* Google カレンダー連携カード */}
      <IntegrationCard
        icon="📅"
        name="Google"
        connected={!!googleStatus?.connected}
        connectedEmail={googleStatus?.googleAccountEmail ?? null}
        connectedFeatures={["空き時間の自動確認", "Google Meet URLの自動発行", "Googleカレンダーへの予定自動登録"]}
        isPending={startGoogleOAuth.isPending || disconnectGoogle.isPending}
        onConnect={() => startGoogleOAuth.mutate()}
        onDisconnect={() => {
          if (confirm("Googleの連携を解除しますか？")) disconnectGoogle.mutate();
        }}
        disconnectPending={disconnectGoogle.isPending}
      >
        {googleStatus?.connected && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px dashed var(--color-paper-300)" }}>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              🗓️ 空き状況の確認に使うカレンダー
            </p>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
              {(googleStatus.busyCalendars ?? []).length > 0
                ? googleStatus.busyCalendars.map((cal) => cal.summary).join("、")
                : "メインカレンダー"}
            </p>
            <button
              onClick={() => setShowCalendarPicker(true)}
              className="flex items-center gap-1.5 text-xs font-medium"
              style={{ color: "var(--color-brand)" }}
            >
              <Settings2 size={13} />
              変更する
            </button>
          </div>
        )}
      </IntegrationCard>

      {showCalendarPicker && (
        <GoogleCalendarPickerModal
          onClose={() => setShowCalendarPicker(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["scheduler", "google-status"] });
            setShowCalendarPicker(false);
          }}
        />
      )}

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
  preConnectNotice?: React.ReactNode;
  children?: React.ReactNode;
};

function IntegrationCard({
  icon, name, connected, connectedEmail, connectedFeatures,
  isPending, onConnect, onDisconnect, disconnectPending, preConnectNotice, children,
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
            {preConnectNotice}
          </>
        )}
        {children}
      </div>
    </div>
  );
}

// ---- Google カレンダー選択モーダル（空き状況判定に使うカレンダーを複数選択） ----
type GoogleCalendarOption = { id: string; summary: string; primary: boolean };

function GoogleCalendarPickerModal({
  onClose, onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  // チェック状態は必ずこのクエリが返す selectedIds（"primary" エイリアスを実IDに正規化済み）から初期化する。
  // 連携状態表示（/status）側の値は正規化していないため、そちらを初期値に使うと
  // 「メインカレンダーがデフォルトで選ばれているのにチェックが付かない」不具合になる。
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery<{ data: { calendars: GoogleCalendarOption[]; selectedIds: string[] } }>({
    queryKey: ["scheduler", "google-calendars"],
    queryFn: () => request("/scheduler/oauth/google/calendars"),
  });

  const calendars = data?.data.calendars ?? [];

  if (selectedIds === null && data) {
    setSelectedIds(new Set(data.data.selectedIds));
  }
  const checked = selectedIds ?? new Set<string>();

  const save = useMutation({
    mutationFn: () => {
      const selected = calendars
        .filter((cal) => checked.has(cal.id))
        .map((cal) => ({ id: cal.id, summary: cal.summary }));
      return request("/scheduler/oauth/google/calendars", { method: "PATCH", body: { calendars: selected } });
    },
    onSuccess: onSaved,
    onError: (e) => setSaveError(e instanceof ApiError ? e.message : "保存に失敗しました"),
  });

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            🗓️ 空き状況を確認するカレンダー
          </h2>
          <button onClick={onClose} className="shrink-0"><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          チェックしたカレンダーの予定がまとめて「予約不可（埋まっている）」時間として扱われます。複数選択できます。
        </p>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-brand)" }} />
          </div>
        ) : loadError ? (
          <p className="text-xs mb-3 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
            {loadError instanceof ApiError ? loadError.message : "カレンダー一覧の取得に失敗しました"}
          </p>
        ) : (
          <div className="space-y-1.5 mb-3 max-h-64 overflow-y-auto">
            {calendars.map((cal) => (
              <label
                key={cal.id}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer"
                style={{
                  background: checked.has(cal.id) ? "rgba(90,140,92,0.1)" : "var(--color-paper-100)",
                  border: checked.has(cal.id) ? "1.5px solid rgba(90,140,92,0.3)" : "1.5px solid transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked.has(cal.id)}
                  onChange={() => toggle(cal.id)}
                  className="w-4 h-4"
                />
                <span className="text-sm flex-1" style={{ color: "var(--color-ink-800)" }}>
                  {cal.summary}{cal.primary && "（メイン）"}
                </span>
              </label>
            ))}
          </div>
        )}

        {saveError && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{saveError}</p>}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button
            onClick={() => { setSaveError(""); if (checked.size === 0) { setSaveError("少なくとも1つ選択してください"); return; } save.mutate(); }}
            disabled={save.isPending || isLoading}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {save.isPending ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
