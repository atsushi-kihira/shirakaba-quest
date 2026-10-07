// =============================================================
// 管理画面 — 通知配信
// 利用が進んでいない人にもっと使ってもらうための「アプリ内通知＋メール」を、宛先・文面を選んで配信する。
// =============================================================
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Eye, Plus, Pencil, Trash2, X, ChevronDown, ChevronUp } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  RecipientScopePicker, EMPTY_CRITERIA, isRecipientReady, toRecipientPayload,
  type RecipientOptions, type RecipientValue,
} from "@/components/recipient-scope-picker";
import { LinkifiedText } from "@/components/linkified-text";

type Template = {
  id: string; name: string; title: string; body: string; systemKey: string | null;
  includeUsage: boolean; includeRecommendations: boolean; updatedAt: number;
};
type FeatureInfo = { key: string; name: string; emoji: string };
type OptionsResponse = { data: RecipientOptions & { features: FeatureInfo[] } };
type RecipientRow = { id: string; name: string; emoji: string; hasEmail: boolean; used: string[]; recommended: string[] };
type PreviewResult = { title: string; body: string; used: string[]; recommended: string[] };
type HistoryRow = {
  id: string; title: string; body: string; scopeLabel: string; recipientCount: number; sendEmail: boolean;
  includeUsage: boolean; includeRecommendations: boolean; readCount: number; createdAt: number;
};

const VARS_HELP = [
  ["{{memberName}}", "受信者のお名前"],
  ["{{appTitle}}", "アプリ名"],
  ["{{appUrl}}", "アプリのURL"],
  ["{{usageSummary}}", "ご利用状況（利用した機能・していない機能）※下の「ご利用状況を載せる」がオンのとき"],
  ["{{recommendations}}", "おすすめ機能とそのメリット ※下の「おすすめ機能を載せる」がオンのとき"],
];

const CARD = "card-paper rounded-2xl p-4";
const INPUT_STYLE = { borderColor: "var(--color-paper-300)" } as const;

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

export function AdminBroadcastsScreen() {
  const [tab, setTab] = useState<"send" | "templates" | "history">("send");
  const { data: tplData } = useQuery({
    queryKey: ["admin", "broadcasts", "templates"],
    queryFn: () => api.get<{ data: Template[] }>("/admin/broadcasts/templates"),
  });
  const { data: optData } = useQuery({
    queryKey: ["admin", "broadcasts", "options"],
    queryFn: () => api.get<OptionsResponse>("/admin/broadcasts/options"),
  });
  const templates = tplData?.data ?? [];
  const options = optData?.data;

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        📣 通知配信
      </h1>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
        利用が進んでいない方などに、アプリ内通知（ホーム画面・通知メニュー）と同じ内容のメールを配信します。
      </p>

      <div className="flex gap-2 mb-4">
        {([["send", "配信する"], ["templates", "文面テンプレート"], ["history", "配信履歴"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className="flex-1 py-2 rounded-2xl text-sm font-medium"
            style={{ background: tab === t ? "var(--color-brand)" : "var(--color-paper-200)", color: tab === t ? "white" : "var(--color-ink-600)" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "send" && <SendPanel templates={templates} options={options} />}
      {tab === "templates" && <TemplatesPanel templates={templates} />}
      {tab === "history" && <HistoryPanel />}
    </div>
  );
}

// ---------------------------------------------------------------
// 配信する
// ---------------------------------------------------------------
function SendPanel({ templates, options }: { templates: Template[]; options: (RecipientOptions & { features: FeatureInfo[] }) | undefined }) {
  const qc = useQueryClient();
  const [templateId, setTemplateId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [includeUsage, setIncludeUsage] = useState(false);
  const [includeRecommendations, setIncludeRecommendations] = useState(false);
  const [recipient, setRecipient] = useState<RecipientValue>({ scope: "all", teamId: null, collabTeamId: null, memberIds: [], criteria: EMPTY_CRITERIA });
  const [sendEmail, setSendEmail] = useState(true);
  const [showList, setShowList] = useState(false);
  const [previewMemberId, setPreviewMemberId] = useState("");
  const [previewSearch, setPreviewSearch] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const featureName = useMemo(() => new Map((options?.features ?? []).map((f) => [f.key, `${f.emoji} ${f.name}`])), [options]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    setPreview(null);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTitle(t.title); setBody(t.body);
    setIncludeUsage(t.includeUsage); setIncludeRecommendations(t.includeRecommendations);
  }

  const recipientReady = isRecipientReady(recipient);

  const { data: recData, isFetching: recLoading } = useQuery({
    queryKey: ["admin", "broadcasts", "recipients", recipient],
    queryFn: () => api.post<{ data: RecipientRow[] }>("/admin/broadcasts/recipients", toRecipientPayload(recipient)),
    enabled: recipientReady,
  });
  const recipients = recipientReady ? recData?.data ?? [] : [];

  // 宛先が変わったら、プレビュー対象は宛先の先頭に合わせる（宛先外のメンバーも選べる）
  useEffect(() => {
    if (!previewMemberId && recipients.length > 0) setPreviewMemberId(recipients[0].id);
  }, [recipients, previewMemberId]);

  const previewMutation = useMutation({
    mutationFn: () => api.post<{ data: PreviewResult }>("/admin/broadcasts/preview", { title, body, includeUsage, includeRecommendations, memberId: previewMemberId }),
    onSuccess: (res) => { setPreview(res.data); setMessage(null); },
    onError: (e) => setMessage({ kind: "error", text: errMsg(e, "プレビューの作成に失敗しました") }),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.post<{ data: { recipientCount: number } }>("/admin/broadcasts/send", {
      title, body, includeUsage, includeRecommendations, templateId: templateId || null, sendEmail, ...toRecipientPayload(recipient),
    }),
    onSuccess: (res) => {
      setMessage({ kind: "ok", text: `${res.data.recipientCount}名に配信しました${sendEmail ? "（メールは順次送信されます）" : ""}` });
      qc.invalidateQueries({ queryKey: ["admin", "broadcasts", "history"] });
    },
    onError: (e) => setMessage({ kind: "error", text: errMsg(e, "配信に失敗しました") }),
  });

  const previewCandidates = (options?.members ?? []).filter((m) => !previewSearch.trim() || m.name.includes(previewSearch.trim()));
  const contentReady = !!title.trim() && !!body.trim();

  function handleSend() {
    if (!contentReady || !recipientReady || recipients.length === 0) return;
    const noEmail = recipients.filter((r) => !r.hasEmail).length;
    const text = `${recipients.length}名に${sendEmail ? "アプリ内通知とメール" : "アプリ内通知"}を配信します。よろしいですか？${noEmail > 0 && sendEmail ? `\n（メールアドレス未登録の${noEmail}名にはメールは送られません）` : ""}`;
    if (confirm(text)) sendMutation.mutate();
  }

  return (
    <div className="space-y-4">
      {/* 1. 文面 */}
      <section className={CARD}>
        <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>① 文面を選ぶ・編集する</h2>
        <select value={templateId} onChange={(e) => applyTemplate(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-sm border mb-3" style={INPUT_STYLE}>
          <option value="">テンプレートを選択…（選ばずに直接入力もできます）</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          ここでの編集は今回の配信だけに反映されます（テンプレート自体は変わりません）。
        </p>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setPreview(null); }} placeholder="件名（通知のタイトル・メールの件名）"
          className="w-full rounded-xl px-3 py-2 text-sm border mb-2" style={INPUT_STYLE} />
        <textarea value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} rows={12} placeholder="本文"
          className="w-full rounded-xl px-3 py-2 text-sm border mb-2" style={INPUT_STYLE} />
        <label className="flex items-center gap-2 text-sm mb-1 cursor-pointer">
          <input type="checkbox" checked={includeUsage} onChange={(e) => { setIncludeUsage(e.target.checked); setPreview(null); }} />
          受信者ごとの「ご利用状況」（どの機能を使ったことがあるか）を載せる
        </label>
        <label className="flex items-center gap-2 text-sm mb-2 cursor-pointer">
          <input type="checkbox" checked={includeRecommendations} onChange={(e) => { setIncludeRecommendations(e.target.checked); setPreview(null); }} />
          受信者ごとの「おすすめ機能とそのメリット」（未利用・利用が少ない機能）を載せる
        </label>
        <VarsHelp />
      </section>

      {/* 2. 宛先 */}
      <section className={CARD}>
        <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>② 宛先を選ぶ</h2>
        <RecipientScopePicker value={recipient} onChange={(v) => { setRecipient(v); setPreview(null); }} options={options} />
        {recipientReady && (
          <div className="mt-3">
            <button onClick={() => setShowList((v) => !v)} className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--color-brand)" }}>
              {recLoading ? <Loader2 size={14} className="animate-spin" /> : null}
              宛先：{recipients.length}名（利用状況を確認）
              {showList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showList && (
              <div className="mt-2 max-h-72 overflow-y-auto rounded-xl" style={{ background: "var(--color-paper-100)" }}>
                {recipients.map((r) => (
                  <div key={r.id} className="px-3 py-2 border-b last:border-b-0" style={{ borderColor: "var(--color-paper-300)" }}>
                    <div className="flex items-center gap-2 text-sm">
                      <span>{r.emoji} {r.name}</span>
                      <span className="ml-auto text-xs font-bold" style={{ color: "var(--color-accent)" }}>
                        利用 {r.used.length}/{options?.features.length ?? 0}機能
                      </span>
                      {!r.hasEmail && <span className="text-[10px]" style={{ color: "var(--color-brand)" }}>メール未登録</span>}
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                      {r.used.length > 0 ? `利用済み：${r.used.map((k) => featureName.get(k) ?? k).join("、")}` : "まだどの機能も利用していません"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3. プレビュー */}
      <section className={CARD}>
        <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>③ 届く内容をプレビューする</h2>
        <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
          確認したいアカウントを選ぶと、そのアカウントに実際に届く通知・メールの文面を表示します（宛先に含まれない方も選べます）。
        </p>
        <input value={previewSearch} onChange={(e) => setPreviewSearch(e.target.value)} placeholder="名前で絞り込み…"
          className="w-full rounded-xl px-3 py-2 text-sm border mb-2" style={INPUT_STYLE} />
        <div className="flex gap-2">
          <select value={previewMemberId} onChange={(e) => { setPreviewMemberId(e.target.value); setPreview(null); }}
            className="flex-1 min-w-0 rounded-xl px-3 py-2 text-sm border" style={INPUT_STYLE}>
            <option value="">アカウントを選択…</option>
            {previewCandidates.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
          </select>
          <button onClick={() => previewMutation.mutate()} disabled={!contentReady || !previewMemberId || previewMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40" style={{ background: "var(--color-brand)" }}>
            {previewMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            プレビュー
          </button>
        </div>
        {preview && (
          <div className="mt-3 rounded-2xl p-4" style={{ background: "white", border: "1px dashed var(--color-paper-300)" }}>
            <p className="text-[11px] mb-1" style={{ color: "var(--color-ink-400)" }}>件名（通知タイトル）</p>
            <p className="text-sm font-bold mb-3" style={{ color: "var(--color-ink-900)" }}>{preview.title}</p>
            <p className="text-[11px] mb-1" style={{ color: "var(--color-ink-400)" }}>本文（通知・メール共通）</p>
            <LinkifiedText text={preview.body} className="text-sm leading-relaxed" style={{ color: "var(--color-ink-800)" }} />
            <div className="mt-3 pt-3 text-xs space-y-1" style={{ borderTop: "1px solid var(--color-paper-200)", color: "var(--color-ink-500)" }}>
              <p>このアカウントの利用済み機能：{preview.used.length > 0 ? preview.used.map((k) => featureName.get(k) ?? k).join("、") : "なし"}</p>
              <p>おすすめ対象の機能：{preview.recommended.length > 0 ? preview.recommended.map((k) => featureName.get(k) ?? k).join("、") : "なし（十分に活用中）"}</p>
            </div>
          </div>
        )}
      </section>

      {/* 4. 配信 */}
      <section className={CARD}>
        <h2 className="text-sm font-bold mb-2" style={{ color: "var(--color-ink-800)" }}>④ 配信する</h2>
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          メールも配信する（アプリ内通知と同じ内容）
        </label>
        {message && (
          <p className="text-sm mb-3 px-3 py-2 rounded-xl"
            style={{ background: message.kind === "ok" ? "rgba(90,140,92,0.12)" : "rgba(181,56,75,0.1)", color: message.kind === "ok" ? "var(--color-success)" : "var(--color-brand)" }}>
            {message.text}
          </p>
        )}
        <button onClick={handleSend} disabled={!contentReady || !recipientReady || recipients.length === 0 || sendMutation.isPending}
          className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40" style={{ background: "var(--color-brand)" }}>
          {sendMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {recipientReady ? `${recipients.length}名に配信する` : "宛先を選んでください"}
        </button>
      </section>
    </div>
  );
}

function VarsHelp() {
  return (
    <details className="text-xs" style={{ color: "var(--color-ink-500)" }}>
      <summary className="cursor-pointer">使える差し込み項目を見る</summary>
      <ul className="mt-1.5 space-y-0.5">
        {VARS_HELP.map(([k, d]) => (
          <li key={k}><code className="px-1 rounded" style={{ background: "var(--color-paper-200)" }}>{k}</code> {d}</li>
        ))}
      </ul>
      <p className="mt-1">※ ブロックをオンにして本文に項目を書かなかった場合は、本文の末尾に自動で追加されます。</p>
    </details>
  );
}

// ---------------------------------------------------------------
// 文面テンプレート
// ---------------------------------------------------------------
function TemplatesPanel({ templates }: { templates: Template[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/broadcasts/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "broadcasts", "templates"] }),
  });

  return (
    <div>
      <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium text-white mb-3" style={{ background: "var(--color-brand)" }}>
        <Plus size={14} /> テンプレートを追加
      </button>
      <div className="space-y-3">
        {templates.length === 0 && <p className="text-sm text-center py-8" style={{ color: "var(--color-ink-400)" }}>テンプレートがありません</p>}
        {templates.map((t) => (
          <div key={t.id} className={CARD}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>
                  {t.name}
                  {t.systemKey === "first_login" && (
                    <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full font-medium align-middle" style={{ background: "var(--color-brand)", color: "white" }}>
                      初めてのログイン時に自動配信
                    </span>
                  )}
                </p>
                <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-500)" }}>件名：{t.title}</p>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {t.includeUsage && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>ご利用状況つき</span>}
                  {t.includeRecommendations && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>おすすめ機能つき</span>}
                </div>
              </div>
              <button onClick={() => setEditing(t)} className="p-2 rounded-xl" style={{ background: "var(--color-paper-200)" }} title="編集"><Pencil size={14} style={{ color: "var(--color-ink-600)" }} /></button>
              {!t.systemKey && (
                <button onClick={() => { if (confirm(`「${t.name}」を削除しますか？`)) del.mutate(t.id); }} className="p-2 rounded-xl" style={{ background: "var(--color-paper-200)" }} title="削除"><Trash2 size={14} style={{ color: "var(--color-brand)" }} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && <TemplateModal template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateModal({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(template?.name ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [includeUsage, setIncludeUsage] = useState(template?.includeUsage ?? false);
  const [includeRecommendations, setIncludeRecommendations] = useState(template?.includeRecommendations ?? false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const payload = { name, title, body, includeUsage, includeRecommendations };
      return template ? api.patch(`/admin/broadcasts/templates/${template.id}`, payload) : api.post("/admin/broadcasts/templates", payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "broadcasts", "templates"] }); onClose(); },
    onError: (e) => setError(errMsg(e, "保存に失敗しました")),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-xl rounded-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)" }}>{template ? "テンプレートを編集" : "テンプレートを追加"}</h2>
          <button onClick={onClose}><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>
        {template?.systemKey === "first_login" && (
          <p className="text-xs rounded-xl px-3 py-2 mb-3" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-700)" }}>
            🆕 メンバーが<strong>初めてログインしたとき</strong>に、この内容が通知とメールで自動的に届きます（承認済みのメンバーが対象）。
            内容はここで自由に編集できます。
          </p>
        )}
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>テンプレート名（管理用）</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm border mb-3" style={INPUT_STYLE} />
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>件名</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm border mb-3" style={INPUT_STYLE} />
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>本文</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="w-full rounded-xl px-3 py-2 text-sm border mb-2" style={INPUT_STYLE} />
        <label className="flex items-center gap-2 text-sm mb-1 cursor-pointer">
          <input type="checkbox" checked={includeUsage} onChange={(e) => setIncludeUsage(e.target.checked)} />
          受信者ごとの「ご利用状況」を載せる
        </label>
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input type="checkbox" checked={includeRecommendations} onChange={(e) => setIncludeRecommendations(e.target.checked)} />
          受信者ごとの「おすすめ機能とそのメリット」を載せる
        </label>
        <VarsHelp />
        {error && <p className="text-xs mt-2" style={{ color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => save.mutate()} disabled={!name.trim() || !title.trim() || !body.trim() || save.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            {save.isPending ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// 配信履歴
// ---------------------------------------------------------------
function HistoryPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "broadcasts", "history"],
    queryFn: () => api.get<{ data: HistoryRow[] }>("/admin/broadcasts/history"),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = data?.data ?? [];
  const fmt = (ts: number) => new Date(ts * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" });

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>;
  if (rows.length === 0) return <p className="text-sm text-center py-10" style={{ color: "var(--color-ink-400)" }}>まだ配信していません</p>;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.id} className={CARD}>
          <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="w-full text-left">
            <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{r.title}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              {fmt(r.createdAt)} ・ 宛先：{r.scopeLabel} ・ {r.recipientCount}名（既読 {r.readCount}名）・ {r.sendEmail ? "メールあり" : "通知のみ"}
            </p>
          </button>
          {openId === r.id && <HistoryDetail broadcastId={r.id} sendEmail={r.sendEmail} fmt={fmt} />}
        </div>
      ))}
    </div>
  );
}

type HistoryRecipient = { memberId: string; name: string; emoji: string; hasEmail: boolean; readAt: number | null };
type HistoryMessage = { title: string; body: string; readAt: number | null; sentAt: number; memberName: string; email: string | null };

/** 配信先の一覧と、選んだ1名に実際に届いた内容（差し込み済みの通知・メール） */
function HistoryDetail({ broadcastId, sendEmail, fmt }: { broadcastId: string; sendEmail: boolean; fmt: (ts: number) => string }) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "broadcasts", "history", broadcastId, "recipients"],
    queryFn: () => api.get<{ data: HistoryRecipient[] }>(`/admin/broadcasts/history/${broadcastId}`),
  });
  const recipients = data?.data ?? [];
  const activeId = pickedId ?? recipients[0]?.memberId ?? null;

  const { data: msgData, isLoading: msgLoading } = useQuery({
    queryKey: ["admin", "broadcasts", "history", broadcastId, "message", activeId],
    queryFn: () => api.get<{ data: HistoryMessage }>(`/admin/broadcasts/history/${broadcastId}/recipients/${activeId}`),
    enabled: !!activeId,
  });
  const msg = msgData?.data;
  const unread = recipients.filter((r) => r.readAt === null).length;

  return (
    <div className="mt-3 pt-3 space-y-3" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
      <div>
        <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>
          配信先（{recipients.length}名）<span style={{ color: "var(--color-ink-400)" }}>　✓＝既読 ／ 未読 {unread}名 ／ 名前を押すとその人に届いた内容を表示</span>
        </p>
        {isLoading ? <Loader2 size={16} className="animate-spin" /> : (
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {recipients.map((r) => {
              const on = r.memberId === activeId;
              return (
                <button key={r.memberId} onClick={() => setPickedId(r.memberId)}
                  className="px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ background: on ? "var(--color-brand)" : "var(--color-paper-200)", color: on ? "white" : "var(--color-ink-700)" }}>
                  {r.emoji} {r.name} {r.readAt !== null ? "✓" : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {activeId && (
        <div className="rounded-xl p-3" style={{ background: "var(--color-paper-100)" }}>
          {msgLoading || !msg ? <Loader2 size={16} className="animate-spin" /> : (
            <>
              <p className="text-[11px] mb-1.5" style={{ color: "var(--color-ink-400)" }}>
                {msg.memberName}さんに実際に届いた内容（{fmt(msg.sentAt)}・{msg.readAt !== null ? `既読 ${fmt(msg.readAt)}` : "未読"}）
              </p>
              <p className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-800)" }}>{msg.title}</p>
              <LinkifiedText text={msg.body} className="text-sm" style={{ color: "var(--color-ink-700)" }} />
              <p className="text-[11px] mt-2" style={{ color: "var(--color-ink-400)" }}>
                {sendEmail
                  ? `アプリ内通知と同じ件名・本文でメールも送信${msg.email ? `（${msg.email}）` : "（メールアドレスなし）"}`
                  : "アプリ内通知のみ（メールは送っていません）"}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
