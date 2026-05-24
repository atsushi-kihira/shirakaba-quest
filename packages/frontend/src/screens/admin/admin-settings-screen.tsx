// =============================================================
// 管理画面 — アプリ設定
// =============================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { api } from "@/lib/api";

type AppSettings = {
  id: string;
  appTitle: string;
  appLogo: string;
  appPointName: string;
};

export function AdminSettingsScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "app-settings"],
    queryFn: () => api.get<{ data: AppSettings }>("/admin/app-settings"),
  });

  const [form, setForm] = useState({ appTitle: "", appLogo: "", appPointName: "" });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.data) {
      setForm({
        appTitle: data.data.appTitle ?? "白樺クエスト",
        appLogo: data.data.appLogo ?? "🃏",
        appPointName: data.data.appPointName ?? "pt",
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.patch("/admin/app-settings", form),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="px-4 py-6 text-center" style={{ color: "var(--color-ink-400)" }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div className="px-4 py-6 lg:px-0 max-w-md">
      <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        ⚙️ アプリ設定
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        アプリの表示名やポイントの単位を変更できます。
      </p>

      {saved && (
        <div className="mb-4 p-3 rounded-2xl text-sm text-white"
          style={{ background: "var(--color-success)" }}>
          ✅ 設定を保存しました
        </div>
      )}

      <div className="card-paper p-6 space-y-5">
        <div className="flex gap-3">
          <div className="w-20">
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              アプリロゴ
            </label>
            <input
              value={form.appLogo}
              onChange={(e) => setForm({ ...form, appLogo: e.target.value })}
              className="w-full text-center text-3xl px-2 py-2 rounded-xl border"
              style={{ borderColor: "var(--color-paper-300)" }}
              maxLength={2}
              placeholder="🃏"
            />
            <p className="text-xs mt-1 text-center" style={{ color: "var(--color-ink-400)" }}>絵文字1文字</p>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              アプリ名
            </label>
            <input
              value={form.appTitle}
              onChange={(e) => setForm({ ...form, appTitle: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}
              placeholder="白樺クエスト"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            ポイント単位
          </label>
          <div className="flex items-center gap-2">
            <input
              value={form.appPointName}
              onChange={(e) => setForm({ ...form, appPointName: e.target.value })}
              className="w-32 px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}
              placeholder="pt"
            />
            <span className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              例: &quot;100 {form.appPointName || "pt"}&quot;
            </span>
          </div>
        </div>

        {/* プレビュー */}
        <div className="p-4 rounded-2xl" style={{ background: "var(--color-paper-200)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>プレビュー</p>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{form.appLogo || "🃏"}</span>
            <span className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
              {form.appTitle || "白樺クエスト"}
            </span>
          </div>
          <div className="mt-2 text-sm" style={{ color: "var(--color-ink-600)" }}>
            ポイント: <strong>150 {form.appPointName || "pt"}</strong>
          </div>
        </div>

        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="w-full py-3 rounded-2xl font-semibold text-white transition hover:opacity-80 flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}
        >
          <Save size={16} />
          {save.isPending ? "保存中..." : "設定を保存する"}
        </button>
      </div>
    </div>
  );
}
