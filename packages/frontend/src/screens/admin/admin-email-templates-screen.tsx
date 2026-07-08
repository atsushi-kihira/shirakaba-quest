// =============================================================
// 管理者向けメール配信管理画面
// /admin/email-templates
// =============================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, RotateCcw, Save, Info, Settings, AlignLeft } from "lucide-react";
import { request } from "@/lib/api";

type EmailVar = { key: string; label: string; example: string };

type EmailTemplate = {
  emailKey: string;
  label: string;
  category: string;
  categoryLabel: string;
  triggerDescription: string;
  availableVars: EmailVar[];
  enabled: boolean;
  fromEmail: string | null;
  subject: string;
  bodyText: string;
  disableCommonHeader: boolean;
  disableCommonFooter: boolean;
  defaultEnabled: boolean;
  defaultSubject: string;
  defaultBodyText: string;
  isCustomized: boolean;
};

const CATEGORY_ORDER = ["auth", "usp", "meeting", "oneonone", "scheduler", "card"];

function groupByCategory(templates: EmailTemplate[]) {
  const map = new Map<string, EmailTemplate[]>();
  for (const t of templates) {
    const arr = map.get(t.category) ?? [];
    arr.push(t);
    map.set(t.category, arr);
  }
  return map;
}

// ── システム設定カード ──────────────────────────────────────────

function SystemSettingsCard() {
  const qc = useQueryClient();

  const { data: systemFromData } = useQuery({
    queryKey: ["admin-email-system-from"],
    queryFn: () => request<{ systemFromEmail: string | null }>("/admin/email-templates/system-from"),
  });

  const { data: layoutData } = useQuery({
    queryKey: ["admin-email-common-layout"],
    queryFn: () => request<{ emailCommonHeader: string | null; emailCommonFooter: string | null }>("/admin/email-templates/common-layout"),
  });

  const [editSystemFrom, setEditSystemFrom] = useState("");
  const [editHeader, setEditHeader] = useState("");
  const [editFooter, setEditFooter] = useState("");

  useEffect(() => {
    if (systemFromData !== undefined) {
      setEditSystemFrom(systemFromData.systemFromEmail ?? "");
    }
  }, [systemFromData]);

  useEffect(() => {
    if (layoutData !== undefined) {
      setEditHeader(layoutData.emailCommonHeader ?? "");
      setEditFooter(layoutData.emailCommonFooter ?? "");
    }
  }, [layoutData]);

  const saveFromMutation = useMutation({
    mutationFn: () => request<{ ok: boolean }>("/admin/email-templates/system-from", {
      method: "PATCH",
      body: { systemFromEmail: editSystemFrom.trim() || null },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-email-system-from"] }),
  });

  const saveLayoutMutation = useMutation({
    mutationFn: () => request<{ ok: boolean }>("/admin/email-templates/common-layout", {
      method: "PATCH",
      body: {
        emailCommonHeader: editHeader.trim() || null,
        emailCommonFooter: editFooter.trim() || null,
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-email-common-layout"] }),
  });

  return (
    <div className="card-paper rounded-2xl p-5 mb-6 space-y-5">
      {/* 送信元アドレス */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Settings size={15} style={{ color: "var(--color-brand)" }} />
          <h2 className="text-sm font-bold" style={{ color: "var(--color-ink-800)" }}>
            システム既定の送信元アドレス
          </h2>
        </div>
        <p className="text-xs mb-2.5" style={{ color: "var(--color-ink-400)" }}>
          各テンプレートで送信元が未指定の場合に使用されます。空欄の場合はサーバー設定のアドレスを使用します。
        </p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <input
              type="email"
              value={editSystemFrom}
              onChange={(e) => setEditSystemFrom(e.target.value)}
              placeholder="system@example.com"
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none border"
              style={{
                background: "var(--color-paper-50)",
                borderColor: "var(--color-paper-300)",
                color: "var(--color-ink-900)",
              }}
            />
          </div>
          <button
            onClick={() => saveFromMutation.mutate()}
            disabled={saveFromMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 shrink-0"
            style={{ background: "var(--color-brand)" }}
          >
            <Save size={14} />
            {saveFromMutation.isPending ? "保存中..." : "保存"}
          </button>
        </div>
        {saveFromMutation.isSuccess && (
          <p className="text-xs mt-1.5" style={{ color: "#5A8C5C" }}>✅ 保存しました</p>
        )}
        {saveFromMutation.isError && (
          <p className="text-xs mt-1.5" style={{ color: "var(--color-brand)" }}>⚠️ 保存に失敗しました</p>
        )}
      </div>

      <hr style={{ borderColor: "var(--color-paper-300)" }} />

      {/* 共通ヘッダー・フッター */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <AlignLeft size={15} style={{ color: "var(--color-brand)" }} />
          <h2 className="text-sm font-bold" style={{ color: "var(--color-ink-800)" }}>
            共通メールヘッダー・フッター
          </h2>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
          原則すべてのメールの先頭・末尾に付加されます。各テンプレートで個別に無効化できます。変数（<code className="font-mono text-xs px-1 rounded" style={{ background: "var(--color-paper-300)", color: "var(--color-brand)" }}>{"{{appTitle}}"}</code> など）が使えます。
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
              共通ヘッダー（本文の前に付加）
            </label>
            <textarea
              value={editHeader}
              onChange={(e) => setEditHeader(e.target.value)}
              rows={4}
              placeholder={"例：\n{{appTitle}} からのお知らせです。"}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border resize-y"
              style={{
                background: "var(--color-paper-50)",
                borderColor: "var(--color-paper-300)",
                color: "var(--color-ink-900)",
                fontFamily: "var(--font-zen)",
                lineHeight: "1.7",
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
              共通フッター（本文の後に付加）
            </label>
            <textarea
              value={editFooter}
              onChange={(e) => setEditFooter(e.target.value)}
              rows={4}
              placeholder={"例：\n---\n{{appTitle}}\nhttps://bizquest.jp"}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border resize-y"
              style={{
                background: "var(--color-paper-50)",
                borderColor: "var(--color-paper-300)",
                color: "var(--color-ink-900)",
                fontFamily: "var(--font-zen)",
                lineHeight: "1.7",
              }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          {saveLayoutMutation.isSuccess
            ? <p className="text-xs" style={{ color: "#5A8C5C" }}>✅ 保存しました</p>
            : saveLayoutMutation.isError
            ? <p className="text-xs" style={{ color: "var(--color-brand)" }}>⚠️ 保存に失敗しました</p>
            : <span />
          }
          <button
            onClick={() => saveLayoutMutation.mutate()}
            disabled={saveLayoutMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            <Save size={14} />
            {saveLayoutMutation.isPending ? "保存中..." : "ヘッダー・フッターを保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── メイン画面 ─────────────────────────────────────────────────

export function AdminEmailTemplatesScreen() {
  const qc = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-email-templates"],
    queryFn: () => request<{ data: EmailTemplate[] }>("/admin/email-templates"),
  });

  const templates = data?.data ?? [];
  const selected = templates.find((t) => t.emailKey === selectedKey);

  const [editEnabled, setEditEnabled] = useState(true);
  const [editFromEmail, setEditFromEmail] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBodyText, setEditBodyText] = useState("");
  const [editDisableHeader, setEditDisableHeader] = useState(false);
  const [editDisableFooter, setEditDisableFooter] = useState(false);

  function openEdit(t: EmailTemplate) {
    setSelectedKey(t.emailKey);
    setEditEnabled(t.enabled);
    setEditFromEmail(t.fromEmail ?? "");
    setEditSubject(t.subject);
    setEditBodyText(t.bodyText);
    setEditDisableHeader(t.disableCommonHeader);
    setEditDisableFooter(t.disableCommonFooter);
  }

  const saveMutation = useMutation({
    mutationFn: (key: string) =>
      request<{ ok: boolean }>(`/admin/email-templates/${key}`, {
        method: "PATCH",
        body: {
          enabled: editEnabled,
          fromEmail: editFromEmail.trim() || null,
          subject: editSubject,
          bodyText: editBodyText,
          disableCommonHeader: editDisableHeader,
          disableCommonFooter: editDisableFooter,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-email-templates"] }),
  });

  const resetMutation = useMutation({
    mutationFn: (key: string) =>
      request<{ ok: boolean }>(`/admin/email-templates/${key}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-email-templates"] });
      if (selected) {
        setEditEnabled(selected.defaultEnabled);
        setEditFromEmail("");
        setEditSubject(selected.defaultSubject);
        setEditBodyText(selected.defaultBodyText);
        setEditDisableHeader(false);
        setEditDisableFooter(false);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--color-brand)" }} />
      </div>
    );
  }

  const grouped = groupByCategory(templates);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Mail size={22} style={{ color: "var(--color-brand)" }} />
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            メール配信管理
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-400)" }}>
            システムが送信するメールのテンプレートを設定します
          </p>
        </div>
      </div>

      <SystemSettingsCard />

      <div className="flex gap-6">
        {/* 左：テンプレート一覧 */}
        <div className="w-72 shrink-0 space-y-4">
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped.get(cat);
            if (!items?.length) return null;
            const catLabel = items[0].categoryLabel;
            return (
              <div key={cat}>
                <p className="text-xs font-semibold px-2 mb-1" style={{ color: "var(--color-ink-400)" }}>
                  {catLabel}
                </p>
                <div className="space-y-1">
                  {items.map((t) => (
                    <button
                      key={t.emailKey}
                      onClick={() => openEdit(t)}
                      className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition flex items-center justify-between gap-2"
                      style={{
                        background: selectedKey === t.emailKey ? "var(--color-brand)" : "var(--color-paper-200)",
                        color: selectedKey === t.emailKey ? "white" : "var(--color-ink-800)",
                      }}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            background: t.enabled ? "rgba(90,140,92,0.15)" : "rgba(181,56,75,0.12)",
                            color: t.enabled ? "#5A8C5C" : "#B5384B",
                          }}
                        >
                          {t.enabled ? "ON" : "OFF"}
                        </span>
                        <span className="truncate">{t.label}</span>
                      </span>
                      {t.isCustomized && (
                        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(212,160,59,0.2)", color: "#D4A03B" }}>
                          カスタム
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 右：編集パネル */}
        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-64 text-center"
              style={{ color: "var(--color-ink-400)" }}>
              <Mail size={40} className="mb-3 opacity-30" />
              <p className="text-sm">左のリストからメールを選択してください</p>
            </div>
          ) : (
            <div className="card-paper rounded-3xl p-6 space-y-5">
              {/* ヘッダー */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                    {selected.label}
                  </h2>
                  <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: "var(--color-ink-400)" }}>
                    <Info size={13} />
                    {selected.triggerDescription}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {selected.isCustomized && (
                    <button
                      onClick={() => { if (confirm("デフォルト設定に戻しますか？")) resetMutation.mutate(selected.emailKey); }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
                      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                    >
                      <RotateCcw size={14} />
                      リセット
                    </button>
                  )}
                  <button
                    onClick={() => saveMutation.mutate(selected.emailKey)}
                    disabled={saveMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                    style={{ background: "var(--color-brand)" }}
                  >
                    <Save size={14} />
                    保存
                  </button>
                </div>
              </div>

              {/* 送信ON/OFF */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-ink-700)" }}>
                  送信設定
                </label>
                <div className="flex gap-3">
                  {[true, false].map((val) => (
                    <button
                      key={String(val)}
                      onClick={() => setEditEnabled(val)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition"
                      style={{
                        background: editEnabled === val
                          ? val ? "rgba(90,140,92,0.15)" : "rgba(181,56,75,0.12)"
                          : "var(--color-paper-200)",
                        color: editEnabled === val
                          ? val ? "#5A8C5C" : "#B5384B"
                          : "var(--color-ink-400)",
                        border: editEnabled === val
                          ? `1.5px solid ${val ? "#5A8C5C" : "#B5384B"}`
                          : "1.5px solid transparent",
                      }}
                    >
                      {val ? "✅ 送信する" : "🚫 送信しない"}
                    </button>
                  ))}
                </div>
              </div>

              {/* FROM アドレス */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
                  送信元アドレス（空欄=システム既定を使用）
                </label>
                <input
                  value={editFromEmail}
                  onChange={(e) => setEditFromEmail(e.target.value)}
                  placeholder="system@example.com"
                  type="email"
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none border"
                  style={{
                    background: "var(--color-paper-50)",
                    borderColor: "var(--color-paper-300)",
                    color: "var(--color-ink-900)",
                  }}
                />
              </div>

              {/* 件名 */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
                  件名
                </label>
                <input
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none border"
                  style={{
                    background: "var(--color-paper-50)",
                    borderColor: "var(--color-paper-300)",
                    color: "var(--color-ink-900)",
                  }}
                />
              </div>

              {/* 共通ヘッダー・フッターの個別無効化 */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-ink-700)" }}>
                  共通ヘッダー・フッター（このメールへの適用）
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setEditDisableHeader(!editDisableHeader)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition"
                    style={{
                      background: editDisableHeader ? "rgba(181,56,75,0.10)" : "rgba(90,140,92,0.10)",
                      color: editDisableHeader ? "#B5384B" : "#5A8C5C",
                      border: `1.5px solid ${editDisableHeader ? "#B5384B" : "#5A8C5C"}`,
                    }}
                  >
                    {editDisableHeader ? "🚫 共通ヘッダーを使わない" : "✅ 共通ヘッダーを使う"}
                  </button>
                  <button
                    onClick={() => setEditDisableFooter(!editDisableFooter)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition"
                    style={{
                      background: editDisableFooter ? "rgba(181,56,75,0.10)" : "rgba(90,140,92,0.10)",
                      color: editDisableFooter ? "#B5384B" : "#5A8C5C",
                      border: `1.5px solid ${editDisableFooter ? "#B5384B" : "#5A8C5C"}`,
                    }}
                  >
                    {editDisableFooter ? "🚫 共通フッターを使わない" : "✅ 共通フッターを使う"}
                  </button>
                </div>
              </div>

              {/* 利用可能な変数 */}
              {selected.availableVars.length > 0 && (
                <div className="p-3 rounded-xl text-xs" style={{ background: "var(--color-paper-200)" }}>
                  <p className="font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>
                    利用可能な変数（件名・本文・共通ヘッダー/フッターに挿入できます）
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {selected.availableVars.map((v) => (
                      <div key={v.key} className="flex flex-col">
                        <code className="font-mono text-xs px-1.5 py-0.5 rounded"
                          style={{ background: "var(--color-paper-300)", color: "var(--color-brand)" }}>
                          {"{{" + v.key + "}}"}
                        </code>
                        <span className="mt-0.5 text-xs" style={{ color: "var(--color-ink-500)" }}>
                          {v.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 本文（プレーンテキスト） */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
                  本文（テキスト）
                </label>
                <textarea
                  value={editBodyText}
                  onChange={(e) => setEditBodyText(e.target.value)}
                  rows={16}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none border resize-y"
                  style={{
                    background: "var(--color-paper-50)",
                    borderColor: "var(--color-paper-300)",
                    color: "var(--color-ink-900)",
                    fontFamily: "var(--font-zen)",
                    lineHeight: "1.8",
                  }}
                />
              </div>

              {saveMutation.isSuccess && (
                <p className="text-sm text-center" style={{ color: "#5A8C5C" }}>✅ 保存しました</p>
              )}
              {saveMutation.isError && (
                <p className="text-sm text-center" style={{ color: "var(--color-brand)" }}>
                  保存に失敗しました
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
