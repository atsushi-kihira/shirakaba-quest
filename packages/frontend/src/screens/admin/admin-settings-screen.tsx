// =============================================================
// 管理画面 — アプリ設定（用語カスタマイズ含む）
// =============================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { api } from "@/lib/api";

type AppSettings = {
  id: string;
  appTitle: string;
  appLogo: string;
  appPointName: string;
  termQuest: string;
  termUsp: string;
  termOneOnOne: string;
};

type FormState = {
  appTitle: string;
  appLogo: string;
  appPointName: string;
  termQuest: string;
  termUsp: string;
  termOneOnOne: string;
};

const DEFAULTS: FormState = {
  appTitle: "白樺クエスト",
  appLogo: "🃏",
  appPointName: "pt",
  termQuest: "お題",
  termUsp: "USP",
  termOneOnOne: "1to1",
};

export function AdminSettingsScreen() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "app-settings"],
    queryFn: () => api.get<{ data: AppSettings }>("/admin/app-settings"),
  });

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.data) {
      setForm({
        appTitle:     data.data.appTitle     ?? DEFAULTS.appTitle,
        appLogo:      data.data.appLogo      ?? DEFAULTS.appLogo,
        appPointName: data.data.appPointName ?? DEFAULTS.appPointName,
        termQuest:    data.data.termQuest    ?? DEFAULTS.termQuest,
        termUsp:      data.data.termUsp      ?? DEFAULTS.termUsp,
        termOneOnOne: data.data.termOneOnOne ?? DEFAULTS.termOneOnOne,
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.patch("/admin/app-settings", form),
    onSuccess: () => {
      setSaved(true);
      // 公開設定キャッシュも無効化して全画面に反映
      qc.invalidateQueries({ queryKey: ["settings"] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (isLoading) {
    return (
      <div className="px-4 py-6 text-center" style={{ color: "var(--color-ink-400)" }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-10 max-w-lg">
      <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        ⚙️ アプリ設定
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        アプリの表示名・ポイント単位・用語をカスタマイズできます。
      </p>

      {saved && (
        <div className="mb-4 p-3 rounded-2xl text-sm text-white"
          style={{ background: "var(--color-success)" }}>
          ✅ 設定を保存しました
        </div>
      )}

      {/* ---- アプリ基本設定 ---- */}
      <div className="card-paper p-6 space-y-5 mb-5">
        <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
          🏷️ アプリ基本設定
        </h2>

        <div className="flex gap-3">
          <div className="w-20">
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              アプリロゴ
            </label>
            <input
              value={form.appLogo}
              onChange={(e) => set("appLogo", e.target.value)}
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
              onChange={(e) => set("appTitle", e.target.value)}
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
              onChange={(e) => set("appPointName", e.target.value)}
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
      </div>

      {/* ---- 用語カスタマイズ ---- */}
      <div className="card-paper p-6 space-y-5 mb-5">
        <div>
          <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
            💬 用語カスタマイズ
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
            アプリ内で使用する専門用語を変更できます。変更はすべての画面に即時反映されます。
          </p>
        </div>

        {/* お題 */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            📜 クエスト／課題の呼び方
          </label>
          <input
            value={form.termQuest}
            onChange={(e) => set("termQuest", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }}
            placeholder="お題"
          />
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
            デフォルト: 「お題」。例: クエスト / 課題 / ミッション など
          </p>
        </div>

        {/* USP */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            ✨ 強みの呼び方
          </label>
          <input
            value={form.termUsp}
            onChange={(e) => set("termUsp", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }}
            placeholder="USP"
          />
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
            デフォルト: 「USP」。例: 強み / 価値 / スキル など
          </p>
        </div>

        {/* 1to1 */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            🤝 個別面談の呼び方
          </label>
          <input
            value={form.termOneOnOne}
            onChange={(e) => set("termOneOnOne", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }}
            placeholder="1to1"
          />
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
            デフォルト: 「1to1」。例: 1 on 1 / 面談 / ミーティング など
          </p>
        </div>

        {/* 用語プレビュー */}
        <div className="p-4 rounded-2xl" style={{ background: "var(--color-paper-200)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>用語プレビュー</p>
          <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>
            「{form.termUsp || "USP"}を {form.termQuest || "お題"}に組み合わせて、{form.termOneOnOne || "1to1"}でなかまのカードを集めよう！」
          </p>
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
  );
}
