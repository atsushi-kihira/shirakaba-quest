// =============================================================
// 管理画面 — アプリ設定（用語カスタマイズ含む）
// =============================================================
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Upload, RotateCcw, ImageIcon } from "lucide-react";
import { api, API_BASE_URL } from "@/lib/api";

type AppSettings = {
  id: string;
  appTitle: string;
  appLogo: string;
  appPointName: string;
  termQuest: string;
  termUsp: string;
  termOneOnOne: string;
  characterImageKey: string | null;
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

  // キャラクター画像
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [characterPreview, setCharacterPreview] = useState<string | null>(null);
  const hasCustomCharacter = data?.data?.characterImageKey != null;

  const [uploadTs, setUploadTs] = useState<number>(0);

  const uploadCharacter = useMutation({
    mutationFn: (imageBase64: string) =>
      api.post("/admin/app-settings/character", {
        imageBase64,
        mimeType: imageBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg",
      }),
    onSuccess: () => {
      setUploadTs(Date.now());
      qc.invalidateQueries({ queryKey: ["admin", "app-settings"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const resetCharacter = useMutation({
    mutationFn: () => api.delete("/admin/app-settings/character"),
    onSuccess: () => {
      setCharacterPreview(null);
      qc.invalidateQueries({ queryKey: ["admin", "app-settings"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setCharacterPreview(base64);
      uploadCharacter.mutate(base64);
    };
    reader.readAsDataURL(file);
  }

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
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24 max-w-lg">
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

      {/* ---- キャラクター画像 ---- */}
      <div className="card-paper p-6 space-y-4 mb-5">
        <div>
          <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
            🧙 トップキャラクター画像
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
            ログイン画面などに大きく表示されるキャラクター画像。PNG・JPEGに対応。
          </p>
        </div>

        {/* プレビュー */}
        <div className="flex items-center gap-4">
          <div className="w-28 h-28 rounded-2xl overflow-hidden flex items-center justify-center shrink-0"
            style={{ background: "var(--color-paper-200)", border: "2px solid var(--color-paper-300)" }}>
            {characterPreview ? (
              <img src={characterPreview} alt="キャラクタープレビュー" className="w-full h-full object-contain" />
            ) : hasCustomCharacter ? (
              <img src={`${API_BASE_URL}/character-image?t=${uploadTs || Date.now()}`} alt="現在のキャラクター" className="w-full h-full object-contain" />
            ) : (
              <img src="/character-default.png" alt="デフォルトキャラクター" className="w-full h-full object-contain" />
            )}
          </div>
          <div className="flex flex-col gap-2 flex-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadCharacter.isPending}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
              style={{ background: "var(--color-brand)", color: "white" }}
            >
              <Upload size={15} />
              {uploadCharacter.isPending ? "アップロード中..." : "画像を変更する"}
            </button>
            {hasCustomCharacter || characterPreview ? (
              <button
                onClick={() => resetCharacter.mutate()}
                disabled={resetCharacter.isPending}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}
              >
                <RotateCcw size={14} />
                デフォルトに戻す
              </button>
            ) : (
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                <ImageIcon size={12} className="inline mr-1" />
                現在はデフォルト画像を使用中
              </p>
            )}
            {uploadCharacter.isSuccess && (
              <p className="text-xs" style={{ color: "var(--color-success)" }}>✅ アップロード完了</p>
            )}
            {uploadCharacter.isError && (
              <p className="text-xs" style={{ color: "var(--color-brand)" }}>
                ❌ {uploadCharacter.error instanceof Error ? uploadCharacter.error.message : "アップロードに失敗しました"}
              </p>
            )}
          </div>
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
