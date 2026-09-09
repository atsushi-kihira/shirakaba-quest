// =============================================================
// 日程調整の公開URL（期限付き）の表示・発行を行う共通パネル。
// 恒久URLは廃止し、発行のたびに新しいトークンに切り替わる期限付きURLに一本化した。
//
// 2種類の使い分け:
// - useSchedulerShareLink / SchedulerShareLinkPanel（手動）
//     マイページの受付時間設定など、ユーザーが明示的にリンクを発行・再発行する画面用。
//     未発行・期限切れの場合は「リンクを発行する」ボタンを表示し、自動では発行しない。
// - useAutoSchedulerShareLink / AutoSchedulerShareLinkPanel（自動）
//     1to1の設定画面（外部ゲスト向け・メンバー向けいずれも）など、
//     都度手動でリンクを発行させるのが不便な導線用。
//     有効なリンクが無ければ表示時に自動で発行してから見せる。
//     （どちらも「新しいリンクを発行する」による明示的な再発行は可能）
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { Copy, Check, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type PublicUrlData = { publicUrl: string | null; expiresAt: number | null };

function useShareLinkGenerateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ data: PublicUrlData }>("/scheduler/me/share-link"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduler", "public-url"] }),
  });
}

export function useSchedulerShareLink() {
  const query = useQuery({
    queryKey: ["scheduler", "public-url"],
    queryFn: () => api.get<{ data: PublicUrlData }>("/scheduler/me/public-url"),
  });
  const generate = useShareLinkGenerateMutation();
  return { data: query.data?.data, isLoading: query.isLoading, generate };
}

// 有効なリンクが無ければ自動で発行してから返す（1to1の設定画面など向け）
export function useAutoSchedulerShareLink() {
  const query = useQuery({
    queryKey: ["scheduler", "public-url", "auto"],
    queryFn: () => api.get<{ data: PublicUrlData }>("/scheduler/me/public-url?ensure=1"),
  });
  const generate = useShareLinkGenerateMutation();
  return { data: query.data?.data, isLoading: query.isLoading, generate };
}

function formatExpiry(expiresAtSec: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(expiresAtSec * 1000));
}

type SharedState = {
  data: PublicUrlData | undefined;
  isLoading: boolean;
  generate: UseMutationResult<{ data: PublicUrlData }, Error, void>;
};

function ShareLinkBody({ data, isLoading, generate, autoMode }: SharedState & { autoMode: boolean }) {
  const [copied, setCopied] = useState(false);
  const publicUrl = data?.publicUrl ?? null;
  const expiresAt = data?.expiresAt ?? null;
  const errorMessage = generate.error instanceof Error ? generate.error.message : null;

  async function copy() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // コピーした今のURLは自身の有効期限まで引き続き使える（無効にはならない）。
    // 同じURLの使い回しを防ぐため、次に表示・コピーする分だけ新しいURLに切り替える。
    generate.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-400)" }}>
        <Loader2 size={13} className="animate-spin" />
        リンクを準備しています…
      </div>
    );
  }

  if (publicUrl && expiresAt) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="text-xs flex-1 truncate px-2 py-1.5 rounded-lg"
            style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>
            {publicUrl}
          </code>
          <button onClick={copy} className="p-1.5 rounded-lg flex-shrink-0" style={{ background: "var(--color-paper-200)" }}>
            {copied ? <Check size={14} style={{ color: "var(--color-success)" }} /> : <Copy size={14} />}
          </button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer"
            className="p-1.5 rounded-lg flex-shrink-0" style={{ background: "var(--color-paper-200)" }}>
            <ExternalLink size={14} />
          </a>
        </div>
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
          ⏳ {formatExpiry(expiresAt)}まで有効です
        </p>
        <div className="text-xs px-2.5 py-2 rounded-lg space-y-1.5" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-500)" }}>
          <p>
            💡 このURLは<strong style={{ color: "var(--color-ink-600)" }}>コピーするたびに新しいURLへ自動的に切り替わります</strong>。
            1人に送ったら、次の人には改めて「コピー」ボタンを押して、新しく発行されたURLを送ってください（同じURLを複数の人に使い回さないでください）。
          </p>
          <p>
            🔒 URLに有効期限があるのは、万が一URLが他の人に転送されてしまっても、期限が過ぎれば使えなくなるようにするためです。
            すでにコピーして送ったURLは、この有効期限まではそのまま使えます。
          </p>
        </div>
        <button onClick={() => generate.mutate()} disabled={generate.isPending}
          className="flex items-center gap-1.5 text-xs font-medium disabled:opacity-50" style={{ color: "var(--color-brand)" }}>
          <RefreshCw size={12} className={generate.isPending ? "animate-spin" : ""} />
          新しいリンクを今すぐ発行する
        </button>
      </div>
    );
  }

  if (autoMode) {
    // ensure指定でも取得できなかった = 受付時間が未設定・非公開のため自動発行もできなかった
    return (
      <div className="space-y-1">
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
          先に受付時間を設定すると、予約URLが自動的に発行されます。
        </p>
        {errorMessage && (
          <p className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
            {errorMessage}
          </p>
        )}
        <a href="/scheduler/settings" className="text-xs font-medium underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
          受付時間を設定する →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
        リンクが未発行、または有効期限が切れています。共有するには新しいリンクを発行してください。
      </p>
      <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
        発行したURLは安全のため一定期間で使えなくなります。コピーするたびに新しいURLに切り替わるので、送る相手ごとにコピーし直してください。
      </p>
      {errorMessage && (
        <p className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
          {errorMessage}
        </p>
      )}
      <button onClick={() => generate.mutate()} disabled={generate.isPending}
        className="w-full py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "var(--color-brand)" }}>
        {generate.isPending ? "発行中..." : "🔗 リンクを発行する"}
      </button>
    </div>
  );
}

// 手動: マイページの受付時間設定など、ユーザーが明示的にリンクを発行する画面用
export function SchedulerShareLinkPanel() {
  const { data, isLoading, generate } = useSchedulerShareLink();
  return <ShareLinkBody data={data} isLoading={isLoading} generate={generate} autoMode={false} />;
}

// 自動: 1to1の設定画面など、都度の手動発行を求めるのが不便な導線用
export function AutoSchedulerShareLinkPanel() {
  const { data, isLoading, generate } = useAutoSchedulerShareLink();
  return <ShareLinkBody data={data} isLoading={isLoading} generate={generate} autoMode={true} />;
}
