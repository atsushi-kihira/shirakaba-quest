// =============================================================
// 定例会の外部ゲスト（主催者向け）
//   ・ゲスト用の共有URL（投票中のみ。作成前に発行していれば、そのURL）
//   ・ゲストの一覧（専用URLのコピー・招待メールの送信状況・回答の有無・削除）
// ゲストは、回答表にも並ぶ。確定すると、メールアドレスのあるゲストへ開催日を案内する
// =============================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link as LinkIcon, Loader2, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";

export type SeriesExternalInvitee = { id: string; name: string; email: string | null; url: string | null; invitedAt: number | null; company?: string | null; responded: boolean };

type Props = { seriesId: string; voting: boolean; inviteToken: string | null; guests: SeriesExternalInvitee[] };

export function SeriesGuestPanel({ seriesId, voting, inviteToken, guests }: Props) {
  const { termExternalGuest } = useSettings();
  const qc = useQueryClient();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["meeting-series", seriesId] });

  const issue = useMutation({ mutationFn: () => api.post(`/meeting-series/${seriesId}/invite`, {}), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (externalId: string) => api.delete(`/meeting-series/${seriesId}/external/${externalId}`), onSuccess: refresh });

  const sharedUrl = inviteToken ? `${window.location.origin}/schedule/series-invite/${inviteToken}` : null;
  if (!voting && guests.length === 0) return null;

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 2000); }).catch(() => undefined);
  }
  const CopyButton = ({ k, text, label }: { k: string; text: string; label: string }) => (
    <button type="button" onClick={() => copy(k, text)} className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium"
      style={{ background: copiedKey === k ? "rgba(90,140,92,0.15)" : "var(--color-brand)", color: copiedKey === k ? "var(--color-success)" : "white" }}>
      {copiedKey === k ? <Check size={12} /> : <Copy size={12} />}{copiedKey === k ? "コピー済" : label}
    </button>
  );

  return (
    <div className="card-paper rounded-2xl p-4 mb-5 space-y-3">
      <p className="text-sm font-semibold" style={{ color: "var(--color-ink-700)" }}>🌐 {termExternalGuest}</p>

      {voting && (sharedUrl ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>🔗 共有URL（複数人に共有できます。回答すると、各自の専用ページができます）</p>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
            <span className="flex-1 text-xs break-all" style={{ color: "var(--color-ink-600)" }}>{sharedUrl}</span>
            <CopyButton k="shared" text={sharedUrl} label="コピー" />
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          {issue.isPending ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}{termExternalGuest}用の共有URLを発行する
        </button>
      ))}
      {issue.isError && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{issue.error instanceof ApiError ? issue.error.message : "発行できませんでした"}</p>}

      {guests.length > 0 && (
        <div className="space-y-1">
          {guests.map((g) => (
            <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
              <span className="text-sm shrink-0">👤</span>
              <span className="text-xs flex-1 min-w-0 truncate" style={{ color: "var(--color-ink-600)" }}>
                {g.name || "（名前未入力）"}
                {g.company && <span style={{ color: "var(--color-ink-400)" }}> · {g.company}</span>}
                {g.email && <span style={{ color: "var(--color-ink-400)" }}> · {g.email}</span>}
                {g.invitedAt && <span style={{ color: "var(--color-success)" }}> · ✉ 招待メール送信済み</span>}
                <span style={{ color: g.responded ? "var(--color-success)" : "var(--color-ink-400)" }}> · {g.responded ? "回答済み" : "未回答"}</span>
              </span>
              {g.url && <CopyButton k={g.id} text={g.url} label="URL" />}
              <button type="button" aria-label={`${g.name || "ゲスト"}を外す`} disabled={remove.isPending}
                onClick={() => { if (window.confirm(`「${g.name || "このゲスト"}」を、この定例会から外しますか？`)) remove.mutate(g.id); }}
                className="shrink-0 p-1 rounded-lg disabled:opacity-40" style={{ color: "var(--color-ink-400)" }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
