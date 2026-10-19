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

type GoogleAccount = {
  id: string;
  googleAccountEmail: string;
  connectedAt: string;
  isDefault: boolean;
  busyCalendars: BusyCalendar[];
};

type GoogleStatus = { accounts: GoogleAccount[] };

type ZoomStatus = {
  connected: boolean;
  zoomAccountEmail: string | null;
  connectedAt: string | null;
};

export function SchedulerIntegrationsScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);

  const { data: googleData, isLoading: googleLoading } = useQuery<{ data: GoogleStatus }>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => request("/scheduler/oauth/google/status"),
  });

  const { data: zoomData, isLoading: zoomLoading } = useQuery<{ data: ZoomStatus }>({
    queryKey: ["scheduler", "zoom-status"],
    queryFn: () => request("/scheduler/oauth/zoom/status"),
  });

  const googleAccounts = googleData?.data.accounts ?? [];
  const zoomStatus = zoomData?.data;

  const invalidateGoogleStatus = () => queryClient.invalidateQueries({ queryKey: ["scheduler", "google-status"] });

  const startGoogleOAuth = useMutation({
    mutationFn: () =>
      request<{ data: { authUrl: string } }>("/scheduler/oauth/google/start"),
    onSuccess: (res: { data: { authUrl: string } }) => {
      window.location.href = res.data.authUrl;
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  const disconnectGoogleAccount = useMutation({
    mutationFn: (accountId: string) =>
      request(`/scheduler/oauth/google/accounts/${accountId}/disconnect`, { method: "POST", body: {} }),
    onSuccess: invalidateGoogleStatus,
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  const setDefaultGoogleAccount = useMutation({
    mutationFn: (accountId: string) =>
      request(`/scheduler/oauth/google/accounts/${accountId}/default`, { method: "PATCH", body: {} }),
    onSuccess: invalidateGoogleStatus,
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

      {/* Google カレンダー連携カード（複数アカウント対応） */}
      <GoogleAccountsCard
        accounts={googleAccounts}
        connectPending={startGoogleOAuth.isPending}
        onConnect={() => startGoogleOAuth.mutate()}
        onSetDefault={(id) => setDefaultGoogleAccount.mutate(id)}
        setDefaultPending={setDefaultGoogleAccount.isPending}
        onDisconnect={(id) => {
          if (confirm("このGoogleアカウントの連携を解除しますか？")) disconnectGoogleAccount.mutate(id);
        }}
        disconnectPending={disconnectGoogleAccount.isPending}
        onEditCalendars={(id) => setEditingAccountId(id)}
      />

      {editingAccountId && (
        <GoogleCalendarSettingsModal
          accountId={editingAccountId}
          onClose={() => setEditingAccountId(null)}
          onSaved={() => {
            invalidateGoogleStatus();
            setEditingAccountId(null);
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

      {/* 会議ツールの選び方（GoogleとZoomの両方を連携しているときだけ） */}
      {googleAccounts.length > 0 && zoomStatus?.connected && <ConferencePreferenceCard />}

      {/* 次のステップ */}
      {(googleAccounts.length > 0 || zoomStatus?.connected) && (
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

// ---- 会議ツールの選び方（相手に選んでもらうか、Google Meet／Zoomのどちらかに固定するか） ----
type ConferencePreference = "choose" | "google_meet" | "zoom";
const CONFERENCE_PREFERENCE_OPTIONS: { value: ConferencePreference; label: string; note: string }[] = [
  { value: "choose", label: "相手に選んでもらう", note: "予約する人・日程を選ぶ人が、Google MeetかZoomを選びます" },
  { value: "google_meet", label: "Google Meetだけ使う", note: "相手にはZoomの選択肢を出さず、常にGoogle Meetで会議URLを作ります" },
  { value: "zoom", label: "Zoomだけ使う", note: "相手にはGoogle Meetの選択肢を出さず、常にZoomで会議URLを作ります" },
];

function ConferencePreferenceCard() {
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data, isLoading } = useQuery<{ data: { preference: ConferencePreference } }>({
    queryKey: ["scheduler", "conference-preference"],
    queryFn: () => request("/scheduler/me/conference-preference"),
  });
  const save = useMutation({
    mutationFn: (preference: ConferencePreference) =>
      request("/scheduler/me/conference-preference", { method: "PUT", body: { preference } }),
    onSuccess: () => { setSaveError(null); queryClient.invalidateQueries({ queryKey: ["scheduler", "conference-preference"] }); },
    onError: (e) => setSaveError(e instanceof ApiError ? e.message : "保存できませんでした。もう一度お試しください。"),
  });
  const current = data?.data.preference ?? "choose";

  return (
    <div className="card-paper p-4 mt-4">
      <h2 className="text-sm font-bold mb-1" style={{ color: "var(--color-ink-900)" }}>🎛️ 会議ツールの選び方</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
        GoogleとZoomの両方を連携しているときの、1to1・公開予約URLでの会議ツールの決め方です。
        複数人ミーティング・定例会では、これまでどおり主催者が選べます。
      </p>
      {isLoading ? (
        <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>
      ) : (
        <div className="space-y-1.5">
          {CONFERENCE_PREFERENCE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer"
              style={{
                background: current === opt.value ? "rgba(181,56,75,0.08)" : "var(--color-paper-100)",
                border: current === opt.value ? "1.5px solid var(--color-brand)" : "1.5px solid transparent",
              }}
            >
              <input
                type="radio"
                name="conference-preference"
                checked={current === opt.value}
                disabled={save.isPending}
                onChange={() => save.mutate(opt.value)}
                className="w-4 h-4 mt-0.5"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{opt.label}</span>
                <span className="block text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{opt.note}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {saveError && <p className="text-xs mt-2" style={{ color: "var(--color-brand)" }}>{saveError}</p>}
    </div>
  );
}

// ---- Google カレンダー連携カード（複数アカウント対応） ----
function GoogleAccountsCard({
  accounts, connectPending, onConnect, onSetDefault, setDefaultPending,
  onDisconnect, disconnectPending, onEditCalendars,
}: {
  accounts: GoogleAccount[];
  connectPending: boolean;
  onConnect: () => void;
  onSetDefault: (accountId: string) => void;
  setDefaultPending: boolean;
  onDisconnect: (accountId: string) => void;
  disconnectPending: boolean;
  onEditCalendars: (accountId: string) => void;
}) {
  const connectedFeatures = ["空き時間の自動確認", "Google Meet URLの自動発行", "Googleカレンダーへの予定自動登録"];
  return (
    <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--color-paper-50)", border: "2px solid var(--color-paper-300)" }}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
          style={{ background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
          📅
        </div>
        <div>
          <p className="font-bold" style={{ color: "var(--color-ink-900)" }}>Google</p>
          {accounts.length > 0 ? (
            <p className="text-xs mt-0.5" style={{ color: "var(--color-success)" }}>
              <CheckCircle2 size={12} className="inline mr-1" />
              {accounts.length}件のアカウントを連携中
            </p>
          ) : (
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>未連携</p>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
        {accounts.length === 0 ? (
          <>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>連携すると以下が自動化されます：</p>
            <ul className="text-xs mt-1 mb-3 space-y-0.5" style={{ color: "var(--color-ink-500)" }}>
              {connectedFeatures.map((f) => <li key={f}>• {f}</li>)}
            </ul>
            <button onClick={onConnect} disabled={connectPending}
              className="text-sm px-4 py-2 rounded-xl font-bold text-white flex items-center gap-1.5"
              style={{ background: "var(--color-brand)" }}>
              {connectPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              連携する
            </button>
          </>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
              {connectedFeatures.map((f) => `✅ ${f}`).join("\n").split("\n").map((line, i) => (
                <span key={i}>{line}<br /></span>
              ))}
            </p>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
              会議URLの発行・ダブルブッキング防止のための予定ブロックは、下の「デフォルト」のアカウントが使われます。
              複数アカウントを連携している場合は、アカウントごとに予定の書き込み先・空き状況確認に使うカレンダーを設定できます。
            </p>
            <p className="text-xs mb-2 px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.08)", color: "var(--color-ink-600)" }}>
              📅 ミーティング・定例会・1to1に<strong>招待された予定</strong>も、「デフォルト」のアカウントの書き込み先カレンダーに自動で登録されます
              （日時の変更・キャンセル・不参加の回答にも追従します）。
            </p>
            <div className="space-y-2.5">
              {accounts.map((acc) => (
                <div key={acc.id} className="rounded-xl p-3" style={{ background: "white", border: "1px solid var(--color-paper-300)" }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{acc.googleAccountEmail}</span>
                      {acc.isDefault && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: "var(--color-brand)" }}>
                          デフォルト
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onDisconnect(acc.id)}
                      disabled={disconnectPending}
                      className="text-xs px-2.5 py-1 rounded-lg border shrink-0"
                      style={{ borderColor: "var(--color-paper-400)", color: "var(--color-ink-500)" }}>
                      解除
                    </button>
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-500)" }}>
                    🗓️ 空き状況の確認に使うカレンダー：{acc.busyCalendars.length > 0 ? acc.busyCalendars.map((c) => c.summary).join("、") : "メインカレンダー"}
                  </p>
                  {acc.busyCalendars.length <= 1 && (
                    <p className="text-xs mt-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-700)" }}>
                      💡 Googleカレンダーの予定が複数のカレンダーに分かれている場合は、「カレンダー設定を変更する」から、空き状況を確認するカレンダーを追加してください。
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {!acc.isDefault && (
                      <button
                        onClick={() => onSetDefault(acc.id)}
                        disabled={setDefaultPending}
                        className="text-xs font-medium"
                        style={{ color: "var(--color-brand)" }}>
                        デフォルトにする
                      </button>
                    )}
                    <button
                      onClick={() => onEditCalendars(acc.id)}
                      className="flex items-center gap-1 text-xs font-medium"
                      style={{ color: "var(--color-brand)" }}>
                      <Settings2 size={12} />
                      カレンダー設定を変更する
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={onConnect}
              disabled={connectPending}
              className="mt-3 text-xs font-medium px-3 py-2 rounded-xl flex items-center gap-1.5"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
              {connectPending ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
              別のGoogleアカウントを追加する
            </button>
          </>
        )}
      </div>
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

// ---- Google カレンダー設定モーダル（書き込み先カレンダーの単一選択＋空き状況判定に使うカレンダーの複数選択） ----
type GoogleCalendarOption = {
  id: string; summary: string; primary: boolean;
  selected: boolean; accessRole: string; kind: "normal" | "holiday" | "birthday";
};

function GoogleCalendarSettingsModal({
  accountId, onClose, onSaved,
}: {
  accountId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // チェック状態は必ずこのクエリが返す selectedBusyIds/writeCalendarId（"primary" エイリアスを
  // 実IDに正規化済み）から初期化する。連携状態表示（/status）側の値は正規化していないため、
  // そちらを初期値に使うと「メインカレンダーがデフォルトで選ばれているのにチェックが付かない」不具合になる。
  const [busyIds, setBusyIds] = useState<Set<string> | null>(null);
  const [writeId, setWriteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery<{ data: { calendars: GoogleCalendarOption[]; selectedBusyIds: string[]; writeCalendarId: string; googleSelectedIds: string[] } }>({
    queryKey: ["scheduler", "google-calendars", accountId],
    queryFn: () => request(`/scheduler/oauth/google/accounts/${accountId}/calendars`),
  });

  const calendars = data?.data.calendars ?? [];

  if (busyIds === null && data) {
    setBusyIds(new Set(data.data.selectedBusyIds));
    setWriteId(data.data.writeCalendarId);
  }
  const checked = busyIds ?? new Set<string>();

  const save = useMutation({
    mutationFn: () => {
      const selected = calendars
        .filter((cal) => checked.has(cal.id))
        .map((cal) => ({ id: cal.id, summary: cal.summary }));
      return request(`/scheduler/oauth/google/accounts/${accountId}/calendars`, {
        method: "PATCH",
        body: { busyCalendars: selected, writeCalendarId: writeId },
      });
    },
    onSuccess: onSaved,
    onError: (e) => setSaveError(e instanceof ApiError ? e.message : "保存に失敗しました"),
  });

  function toggleBusy(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBusyIds(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            🗓️ カレンダー設定
          </h2>
          <button onClick={onClose} className="shrink-0"><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-brand)" }} />
          </div>
        ) : loadError ? (
          <p className="text-xs mb-3 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
            {loadError instanceof ApiError ? loadError.message : "カレンダー一覧の取得に失敗しました"}
          </p>
        ) : (
          <>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-700)" }}>
              📝 予定の追加先カレンダー
            </p>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
              会議URL発行・ダブルブッキング防止のブロック予定など、自動で作成される予定の追加先です。1つ選んでください。
            </p>
            <div className="space-y-1.5 mb-4 max-h-40 overflow-y-auto">
              {calendars.map((cal) => (
                <label
                  key={cal.id}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer"
                  style={{
                    background: writeId === cal.id ? "rgba(181,56,75,0.08)" : "var(--color-paper-100)",
                    border: writeId === cal.id ? "1.5px solid var(--color-brand)" : "1.5px solid transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="write-calendar"
                    checked={writeId === cal.id}
                    onChange={() => setWriteId(cal.id)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm flex-1" style={{ color: "var(--color-ink-800)" }}>
                    {cal.summary}{cal.primary && "（メイン）"}
                  </span>
                </label>
              ))}
            </div>

            <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-700)" }}>
              🔍 空き状況を確認するカレンダー
            </p>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
              チェックしたカレンダーの予定がまとめて「予約不可（埋まっている）」時間として扱われます。複数選択できます。
            </p>
            <button
              type="button"
              onClick={() => setBusyIds(new Set(data?.data.googleSelectedIds ?? []))}
              className="text-xs font-medium px-3 py-1.5 rounded-xl mb-2"
              style={{ background: "var(--color-paper-200)", color: "var(--color-brand)" }}>
              ✨ Googleカレンダーで表示中のものに合わせる
            </button>
            <div className="space-y-3 mb-3 max-h-64 overflow-y-auto">
              {[
                { title: "マイカレンダー", items: calendars.filter((cal) => cal.accessRole === "owner") },
                { title: "他のカレンダー", items: calendars.filter((cal) => cal.accessRole !== "owner") },
              ].filter((g) => g.items.length > 0).map((g) => (
                <div key={g.title} className="space-y-1.5">
                  <p className="text-[11px] font-bold" style={{ color: "var(--color-ink-500)" }}>{g.title}</p>
                  {g.items.map((cal) => (
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
                        onChange={() => toggleBusy(cal.id)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm flex-1" style={{ color: "var(--color-ink-800)" }}>
                        {cal.summary}{cal.primary && "（メイン）"}
                        {cal.kind !== "normal" && <span className="text-[11px] ml-1.5" style={{ color: "var(--color-ink-400)" }}>{cal.kind === "holiday" ? "祝日" : "誕生日"}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        {saveError && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{saveError}</p>}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button
            onClick={() => {
              setSaveError("");
              if (!writeId) { setSaveError("予定の追加先カレンダーを選択してください"); return; }
              if (checked.size === 0) { setSaveError("空き状況を確認するカレンダーを少なくとも1つ選択してください"); return; }
              save.mutate();
            }}
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
