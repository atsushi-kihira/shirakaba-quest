// =============================================================
// 管理画面 — カード作成設定 & 発注一覧
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

type Plan = { name: string; price: number };

type CardPrintSettings = {
  cardPrintEnabled: boolean;
  cardPrintCompanyName: string;
  cardPrintCompanyUrl: string;
  cardPrintContactPerson: string;
  cardPrintContactEmail: string;
  cardPrintContactPhone: string;
  cardPrintImageOnlyPrice: number | null;
  cardPrintImageOnlyName: string;
  cardPrintPlans: Plan[];
  cardPrintThankYouMessage: string;
};

type CardOrder = {
  id: string;
  memberId: string;
  characterLabel: string;
  planName: string;
  planPrice: number;
  status: string;
  createdAt: number;
  address: string | null;
  phone: string | null;
  memberSnapshot: {
    name: string;
    furigana: string;
    romaji: string;
    email: string;
    category: string;
    businessDescription: string;
    company: string;
    role: string;
    skills: Array<{ name: string; emoji: string; issue: string; connector: string; solution: string }>;
  };
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "⏳ 受付済み",
  processing: "🔧 制作中",
  completed: "✅ 完了",
  cancelled: "❌ キャンセル",
};

export function AdminCardSettingsScreen() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [showOrders, setShowOrders] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "card-print"],
    queryFn: () => api.get<{ data: CardPrintSettings | null }>("/admin/card-print"),
  });

  const { data: ordersData } = useQuery({
    queryKey: ["admin", "card-print-orders"],
    queryFn: () => api.get<{ data: CardOrder[] }>("/admin/card-print/orders"),
  });

  const settings = data?.data;
  const orders = ordersData?.data ?? [];
  const pendingOrders = orders.filter((o) => o.status === "pending").length;

  const [form, setForm] = useState<CardPrintSettings>({
    cardPrintEnabled: false,
    cardPrintCompanyName: "",
    cardPrintCompanyUrl: "",
    cardPrintContactPerson: "",
    cardPrintContactEmail: "",
    cardPrintContactPhone: "",
    cardPrintImageOnlyPrice: null,
    cardPrintImageOnlyName: "カードイメージデータ作成のみ",
    cardPrintPlans: [],
    cardPrintThankYouMessage: "ご注文いただきありがとうございました。",
  });

  // 設定が取得できたらフォームに反映（一度だけ）
  const [initialized, setInitialized] = useState(false);
  if (settings && !initialized) {
    setForm(settings);
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => api.put("/admin/card-print", form),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["admin", "card-print"] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/admin/card-print/orders/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "card-print-orders"] }),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/card-print/orders/${id}`),
    onSuccess: () => {
      setConfirmDeleteId(null);
      setExpandedOrder(null);
      qc.invalidateQueries({ queryKey: ["admin", "card-print-orders"] });
    },
  });

  function addPlan() {
    setForm((f) => ({ ...f, cardPrintPlans: [...f.cardPrintPlans, { name: "", price: 0 }] }));
  }

  function removePlan(idx: number) {
    setForm((f) => ({ ...f, cardPrintPlans: f.cardPrintPlans.filter((_, i) => i !== idx) }));
  }

  function updatePlan(idx: number, field: keyof Plan, value: string | number) {
    setForm((f) => {
      const plans = [...f.cardPrintPlans];
      plans[idx] = { ...plans[idx], [field]: value };
      return { ...f, cardPrintPlans: plans };
    });
  }

  if (isLoading) {
    return <div className="px-4 py-6 text-center" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>;
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24">
      <h1 className="text-2xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        🃏 カード作成設定
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        メンバーが実際のカードを発注できる機能の設定を行います。
      </p>

      {/* 発注一覧 */}
      <div className="mb-6 rounded-3xl overflow-hidden" style={{ border: "1.5px solid var(--color-paper-300)" }}>
        <button
          type="button"
          onClick={() => setShowOrders((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold transition hover:opacity-80"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
        >
          <span>📦 発注一覧</span>
          {pendingOrders > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs text-white font-bold" style={{ background: "var(--color-brand)" }}>
              {pendingOrders}件 新規
            </span>
          )}
          {showOrders ? <ChevronUp size={16} className="ml-auto" style={{ color: "var(--color-ink-400)" }} />
            : <ChevronDown size={16} className="ml-auto" style={{ color: "var(--color-ink-400)" }} />}
        </button>

        {showOrders && (
          <div>
            {orders.length === 0 ? (
              <p className="px-4 py-4 text-sm" style={{ color: "var(--color-ink-400)" }}>発注はまだありません</p>
            ) : (
              orders.map((order) => (
                <div key={order.id} className="border-t" style={{ borderColor: "var(--color-paper-300)" }}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 text-left active:opacity-70 transition"
                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>
                        {order.memberSnapshot?.name ?? "—"}
                        <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-400)" }}>
                          {new Date(order.createdAt * 1000).toLocaleDateString("ja-JP")}
                        </span>
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                        {order.planName} · {order.characterLabel}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full shrink-0" style={{
                      background: order.status === "pending" ? "rgba(181,56,75,0.1)" :
                        order.status === "completed" ? "rgba(90,140,92,0.1)" : "var(--color-paper-200)",
                      color: order.status === "pending" ? "var(--color-brand)" :
                        order.status === "completed" ? "var(--color-success)" : "var(--color-ink-500)",
                    }}>
                      {ORDER_STATUS_LABELS[order.status] ?? order.status}
                    </span>
                    {expandedOrder === order.id ? <ChevronUp size={14} style={{ color: "var(--color-ink-400)" }} />
                      : <ChevronDown size={14} style={{ color: "var(--color-ink-400)" }} />}
                  </button>

                  {expandedOrder === order.id && (
                    <div className="px-4 pb-4 space-y-3" style={{ background: "var(--color-paper-50)" }}>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <DetailRow label="お名前" value={`${order.memberSnapshot?.name}（${order.memberSnapshot?.furigana}）`} />
                        <DetailRow label="ローマ字" value={order.memberSnapshot?.romaji || "—"} />
                        <DetailRow label="メール" value={order.memberSnapshot?.email} />
                        <DetailRow label="会社名" value={order.memberSnapshot?.company || "—"} />
                        <DetailRow label="役職" value={order.memberSnapshot?.role || "—"} />
                        <DetailRow label="キャラクター" value={order.characterLabel} />
                        <DetailRow label="プラン" value={`${order.planName}  ¥${order.planPrice?.toLocaleString()}`} />
                        <DetailRow label="住所（カード）" value={order.address || "—"} />
                        <DetailRow label="電話（カード）" value={order.phone || "—"} />
                      </div>
                      {order.memberSnapshot?.skills?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>USP</p>
                          <ul className="space-y-0.5">
                            {order.memberSnapshot.skills.map((s, i) => (
                              <li key={i} className="text-xs" style={{ color: "var(--color-ink-700)" }}>
                                {s.emoji} <strong>{s.name}</strong>
                                {s.issue ? `：${s.issue}${s.connector}${s.solution}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {["pending", "processing", "completed", "cancelled"].map((st) => (
                          <button
                            key={st}
                            disabled={order.status === st || updateStatusMutation.isPending}
                            onClick={() => updateStatusMutation.mutate({ id: order.id, status: st })}
                            className="px-3 py-1.5 rounded-2xl text-xs font-medium transition hover:opacity-80 disabled:opacity-40"
                            style={{
                              background: order.status === st ? "var(--color-brand)" : "var(--color-paper-200)",
                              color: order.status === st ? "white" : "var(--color-ink-600)",
                            }}
                          >
                            {ORDER_STATUS_LABELS[st]}
                          </button>
                        ))}
                      </div>
                      {(order.status === "completed" || order.status === "cancelled") && (
                        <div className="pt-1 border-t" style={{ borderColor: "var(--color-paper-300)" }}>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(order.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium transition hover:opacity-80"
                            style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}
                          >
                            <Trash2 size={12} />
                            この発注データを削除
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 設定フォーム */}
      <div className="space-y-6">
        {/* 機能ON/OFF */}
        <div className="card-paper p-5 rounded-3xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>カード作成機能を有効にする</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                OFFにするとメンバーからの発注フォームが非表示になります
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, cardPrintEnabled: !f.cardPrintEnabled }))}
              className="relative inline-flex h-7 w-12 items-center rounded-full transition"
              style={{ background: form.cardPrintEnabled ? "var(--color-brand)" : "var(--color-paper-300)" }}
            >
              <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
                style={{ transform: form.cardPrintEnabled ? "translateX(22px)" : "translateX(4px)" }} />
            </button>
          </div>
        </div>

        {/* 会社情報 */}
        <div className="card-paper p-5 rounded-3xl space-y-4">
          <h2 className="font-semibold text-base" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
            🏢 カード作成会社情報
          </h2>
          <SettingField label="会社名" value={form.cardPrintCompanyName}
            onChange={(v) => setForm((f) => ({ ...f, cardPrintCompanyName: v }))} placeholder="〇〇印刷株式会社" />
          <SettingField label="会社ホームページ" value={form.cardPrintCompanyUrl}
            onChange={(v) => setForm((f) => ({ ...f, cardPrintCompanyUrl: v }))} placeholder="https://example.com" />
          <SettingField label="受付担当者名" value={form.cardPrintContactPerson}
            onChange={(v) => setForm((f) => ({ ...f, cardPrintContactPerson: v }))} placeholder="山田 太郎" />
          <SettingField label="連絡先メールアドレス" value={form.cardPrintContactEmail} type="email"
            onChange={(v) => setForm((f) => ({ ...f, cardPrintContactEmail: v }))} placeholder="order@example.com" />
          <SettingField label="連絡先電話番号" value={form.cardPrintContactPhone}
            onChange={(v) => setForm((f) => ({ ...f, cardPrintContactPhone: v }))} placeholder="06-1234-5678" />
        </div>

        {/* 価格・プラン */}
        <div className="card-paper p-5 rounded-3xl space-y-4">
          <h2 className="font-semibold text-base" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
            💴 価格・プラン設定
          </h2>

          {/* 基本プラン */}
          <div>
            <p className="text-sm font-medium mb-2" style={{ color: "var(--color-ink-600)" }}>
              基本プラン
            </p>
            <div className="flex gap-2 items-center">
              <div className="flex-1">
                <input
                  value={form.cardPrintImageOnlyName}
                  onChange={(e) => setForm((f) => ({ ...f, cardPrintImageOnlyName: e.target.value }))}
                  placeholder="カードイメージデータ作成のみ"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", fontSize: "14px" }}
                />
              </div>
              <div className="w-28">
                <input
                  value={form.cardPrintImageOnlyPrice != null ? String(form.cardPrintImageOnlyPrice) : ""}
                  onChange={(e) => setForm((f) => ({ ...f, cardPrintImageOnlyPrice: e.target.value ? parseInt(e.target.value) : null }))}
                  placeholder="円"
                  type="number"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", fontSize: "14px" }}
                />
              </div>
              <div className="w-8 shrink-0" />
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              価格を空欄にするとこのプランは非表示になります
            </p>
          </div>

          <div>
            <p className="text-sm font-medium mb-2" style={{ color: "var(--color-ink-600)" }}>
              追加プラン（最大5つ）
            </p>
            <div className="space-y-2">
              {form.cardPrintPlans.map((plan, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <input
                      value={plan.name}
                      onChange={(e) => updatePlan(idx, "name", e.target.value)}
                      placeholder={`例: データ作成＋${10 * (idx + 1)}枚印刷`}
                      className="w-full rounded-xl border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", fontSize: "14px" }}
                    />
                  </div>
                  <div className="w-28">
                    <input
                      value={plan.price || ""}
                      onChange={(e) => updatePlan(idx, "price", parseInt(e.target.value) || 0)}
                      placeholder="円"
                      type="number"
                      className="w-full rounded-xl border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", fontSize: "14px" }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removePlan(idx)}
                    className="p-2 rounded-xl hover:opacity-70 shrink-0"
                    style={{ background: "var(--color-paper-200)" }}
                  >
                    <Trash2 size={14} style={{ color: "var(--color-brand)" }} />
                  </button>
                </div>
              ))}
            </div>
            {form.cardPrintPlans.length < 5 && (
              <button
                type="button"
                onClick={addPlan}
                className="mt-2 flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm transition hover:opacity-80"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                <Plus size={14} />
                プランを追加
              </button>
            )}
          </div>
        </div>

        {/* お礼メッセージ */}
        <div className="card-paper p-5 rounded-3xl">
          <h2 className="font-semibold text-base mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
            💌 発注お礼メッセージ
          </h2>
          <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
            発注後に表示される画面と確認メールに付与されるメッセージです。
          </p>
          <textarea
            value={form.cardPrintThankYouMessage}
            onChange={(e) => setForm((f) => ({ ...f, cardPrintThankYouMessage: e.target.value }))}
            rows={3}
            className="w-full rounded-2xl border px-3 py-2 text-sm resize-none"
            style={{
              borderColor: "var(--color-paper-300)",
              background: "var(--color-paper-50)",
              color: "var(--color-ink-800)",
              fontSize: "14px",
            }}
          />
        </div>

        {/* 保存ボタン */}
        {saved && (
          <div className="p-3 rounded-2xl text-sm text-center" style={{ background: "rgba(90,140,92,0.15)", color: "var(--color-success)" }}>
            ✅ 設定を保存しました
          </div>
        )}
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full py-4 rounded-2xl text-base font-semibold text-white transition hover:opacity-80 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}
        >
          {saveMutation.isPending ? "保存中..." : "設定を保存する"}
        </button>
      </div>

      {/* 削除確認モーダル */}
      {confirmDeleteId && (() => {
        const target = orders.find((o) => o.id === confirmDeleteId);
        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={() => !deleteOrderMutation.isPending && setConfirmDeleteId(null)}
          >
            <div
              className="w-full max-w-sm mx-4 mb-4 sm:mb-0 rounded-3xl p-6 space-y-4"
              style={{ background: "var(--color-paper-100)", border: "1.5px solid var(--color-paper-300)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-2xl p-2.5 shrink-0" style={{ background: "rgba(181,56,75,0.1)" }}>
                  <AlertTriangle size={20} style={{ color: "var(--color-brand)" }} />
                </div>
                <div>
                  <p className="font-semibold text-base" style={{ color: "var(--color-ink-900)" }}>
                    発注データを削除しますか？
                  </p>
                  {target && (
                    <p className="text-sm mt-1" style={{ color: "var(--color-ink-600)" }}>
                      {target.memberSnapshot?.name}さんの「{target.planName}」を削除します。この操作は取り消せません。
                    </p>
                  )}
                </div>
              </div>
              {deleteOrderMutation.isError && (
                <p className="text-xs text-center" style={{ color: "var(--color-brand)" }}>
                  ⚠️ 削除に失敗しました。もう一度お試しください。
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  disabled={deleteOrderMutation.isPending}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => deleteOrderMutation.mutate(confirmDeleteId)}
                  disabled={deleteOrderMutation.isPending}
                  className="flex-1 py-3 rounded-2xl text-sm font-semibold text-white transition hover:opacity-80 disabled:opacity-50"
                  style={{ background: "var(--color-brand)" }}
                >
                  {deleteOrderMutation.isPending ? "削除中..." : "削除する"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SettingField({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border px-3 py-2.5 text-sm"
        style={{
          borderColor: "var(--color-paper-300)",
          background: "var(--color-paper-50)",
          color: "var(--color-ink-800)",
          fontSize: "14px",
        }}
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>{label}</span>
      <p className="text-sm" style={{ color: "var(--color-ink-800)" }}>{value}</p>
    </div>
  );
}
