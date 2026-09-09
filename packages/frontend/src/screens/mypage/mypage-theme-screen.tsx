// =============================================================
// マイページ — 個人用カラーテーマ設定
// 自分のアカウントの表示にのみ適用されるカラーテーマを選ぶ画面。
// 未選択（既定に戻す）の場合はアプリ全体のテーマに従う。
// =============================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { THEME_OPTIONS, useSettings, type AppTheme } from "@/hooks/use-settings";

export function MypageThemeScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  const appSettings = useSettings();
  const [saved, setSaved] = useState(false);

  const currentPersonalTheme = (user?.personalTheme ?? null) as AppTheme | null;

  const update = useMutation({
    mutationFn: (theme: AppTheme | null) => api.patch("/members/me/theme", { theme }),
    onSuccess: (_data, theme) => {
      if (user && token) setAuth(token, { ...user, personalTheme: theme });
      qc.invalidateQueries({ queryKey: ["me"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button
        onClick={() => navigate("/me")}
        className="flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={16} />
        マイページに戻る
      </button>

      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--color-ink-900)", fontFamily: "var(--font-klee)" }}>
        🎨 カラーテーマ設定
      </h1>
      <p className="text-xs mb-6" style={{ color: "var(--color-ink-500)" }}>
        ここで選んだ配色は、あなた自身の画面表示にだけ適用されます。他のメンバーの見え方には影響しません。
        選ばない場合は、運営が設定しているアプリ全体のテーマがそのまま使われます。
      </p>

      <div className="card-paper p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ink-700)" }}>
            自分だけのテーマ
          </p>
          {saved && (
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--color-success)" }}>
              <Check size={14} /> 保存しました
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* アプリ全体のテーマに従う（個人設定を解除） */}
          <button
            type="button"
            onClick={() => update.mutate(null)}
            disabled={update.isPending}
            className="rounded-2xl p-3 text-left border transition disabled:opacity-50"
            style={{
              borderColor: currentPersonalTheme === null ? "var(--color-brand)" : "var(--color-paper-300)",
              background: currentPersonalTheme === null ? "rgba(181,56,75,0.06)" : "var(--color-paper-50)",
            }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              {THEME_OPTIONS.find((t) => t.value === appSettings.theme)?.swatch.map((c, i) => (
                <span key={i} className="w-5 h-5 rounded-full border" style={{ background: c, borderColor: "rgba(0,0,0,0.08)" }} />
              ))}
              {currentPersonalTheme === null && <Check size={14} className="ml-auto" style={{ color: "var(--color-brand)" }} />}
            </div>
            <p className="text-xs font-medium" style={{ color: "var(--color-ink-700)" }}>
              🌐 アプリ全体のテーマに従う
            </p>
          </button>

          {THEME_OPTIONS.map((t) => {
            const active = currentPersonalTheme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => update.mutate(t.value)}
                disabled={update.isPending}
                className="rounded-2xl p-3 text-left border transition disabled:opacity-50"
                style={{
                  borderColor: active ? "var(--color-brand)" : "var(--color-paper-300)",
                  background: active ? "rgba(181,56,75,0.06)" : "var(--color-paper-50)",
                }}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  {t.swatch.map((c, i) => (
                    <span key={i} className="w-5 h-5 rounded-full border" style={{ background: c, borderColor: "rgba(0,0,0,0.08)" }} />
                  ))}
                  {active && <Check size={14} className="ml-auto" style={{ color: "var(--color-brand)" }} />}
                </div>
                <p className="text-xs font-medium" style={{ color: "var(--color-ink-700)" }}>{t.label}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{t.description}</p>
              </button>
            );
          })}
        </div>

        {update.isPending && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-400)" }}>
            <Loader2 size={14} className="animate-spin" /> 保存しています...
          </div>
        )}
      </div>
    </div>
  );
}
