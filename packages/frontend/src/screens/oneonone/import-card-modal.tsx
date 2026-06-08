// =============================================================
// カード画像インポートモーダル
// システム外でもらった名刺/カード画像をOCRして1to1記録を登録する
// =============================================================
import { useState, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, X, Check, ChevronRight, Loader2, RefreshCw, Search, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";

type OcrInfo = {
  memberName: string | null;
  company: string | null;
  email: string | null;
  role: string | null;
};

type MemberCandidate = {
  id: string;
  name: string;
  furigana: string;
  emoji: string;
  bgColor: string;
  category: string;
  businessDescription: string;
  connectionStatus: "none" | "digital" | "real";
  score?: number;
};

type ScanResult = {
  ocr: OcrInfo;
  candidates: MemberCandidate[];
  allMembers: MemberCandidate[];
};

type Step = "capture" | "scanning" | "select" | "confirm" | "done";

type Props = {
  onClose: () => void;
};

export function ImportCardModal({ onClose }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("capture");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<MemberCandidate | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");

  // OCRスキャン
  const scanMutation = useMutation({
    mutationFn: (imageBase64: string) =>
      api.post<{ data: ScanResult }>("/members/scan-for-match", {
        imageBase64,
        side: "front",
      }),
    onSuccess: (res) => {
      setScanResult(res.data);
      setStep("select");
    },
    onError: (e: Error) => {
      setError(e.message);
      setStep("capture");
    },
  });

  // 1to1登録
  const importMutation = useMutation({
    mutationFn: () => api.post<{ data: { alreadyRecorded: boolean; message: string } }>(
      `/members/${selected!.id}/import-card`
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["members"] });
      setStep("done");
    },
    onError: (e: Error) => setError(e.message),
  });

  // 画像選択ハンドラー
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreviewUrl(dataUrl);
      setStep("scanning");
      scanMutation.mutate(dataUrl.split(",")[1]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [scanMutation]);

  // 検索フィルタ
  const displayMembers = (() => {
    if (!scanResult) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      // 候補がある場合は候補優先、なければ全員
      return scanResult.candidates.length > 0
        ? scanResult.candidates
        : scanResult.allMembers;
    }
    return scanResult.allMembers.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.furigana.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
    );
  })();

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="card-paper w-full sm:max-w-md max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            {step !== "capture" && step !== "done" && (
              <button
                onClick={() => {
                  if (step === "select") { setStep("capture"); setSearchQuery(""); }
                  if (step === "confirm") { setStep("select"); setSelected(null); }
                }}
                className="p-1.5 rounded-full hover:opacity-70"
              >
                <ArrowLeft size={18} style={{ color: "var(--color-ink-500)" }} />
              </button>
            )}
            <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              📷 カード画像から登録
            </h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:opacity-70">
            <X size={20} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>

        {/* ステップインジケーター */}
        {step !== "done" && (
          <div className="flex items-center gap-1.5 px-5 pb-3 shrink-0">
            {(["capture", "select", "confirm"] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    background: step === s ? "var(--color-brand)"
                      : (["capture", "select", "confirm"].indexOf(step) > i ? "var(--color-success)" : "var(--color-paper-300)"),
                    color: (step === s || ["capture", "select", "confirm"].indexOf(step) > i) ? "white" : "var(--color-ink-400)",
                  }}>
                  {["capture", "select", "confirm"].indexOf(step) > i ? <Check size={11} strokeWidth={3} /> : i + 1}
                </div>
                {i < 2 && <div className="w-6 h-0.5 rounded"
                  style={{ background: ["capture", "select", "confirm"].indexOf(step) > i ? "var(--color-success)" : "var(--color-paper-300)" }} />}
              </div>
            ))}
            <span className="ml-2 text-xs" style={{ color: "var(--color-ink-400)" }}>
              {step === "capture" || step === "scanning" ? "①カード撮影" : step === "select" ? "②メンバー確認" : "③登録確認"}
            </span>
          </div>
        )}

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">

          {/* ① 撮影ステップ */}
          {(step === "capture" || step === "scanning") && (
            <div>
              <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
                相手のカード（名刺）の写真を選択してください。OCRで相手を自動判定します。
              </p>

              {/* プレビュー */}
              {previewUrl && (
                <div className="mb-4 rounded-2xl overflow-hidden border"
                  style={{ borderColor: "var(--color-paper-300)" }}>
                  <img src={previewUrl} alt="カード画像" className="w-full object-contain max-h-48" />
                </div>
              )}

              {error && (
                <div className="mb-4 p-3 rounded-2xl text-sm" style={{ background: "#fee2e2", color: "#b91c1c" }}>
                  ⚠️ {error}
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              {step === "scanning" ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 size={32} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink-600)" }}>
                    カードを読み取り中...
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full py-4 rounded-2xl font-semibold text-sm text-white flex items-center justify-center gap-2 active:opacity-80 transition"
                    style={{ background: "var(--color-brand)" }}
                  >
                    <Camera size={18} />
                    {previewUrl ? "別の画像を選択" : "カードを撮影 / 画像を選択"}
                  </button>
                  <p className="text-center text-xs" style={{ color: "var(--color-ink-400)" }}>
                    ※ カメラロール内の写真も選択できます
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ② メンバー選択ステップ */}
          {step === "select" && scanResult && (
            <div>
              {/* OCR読み取り結果 */}
              {(scanResult.ocr.memberName || scanResult.ocr.company || scanResult.ocr.email) && (
                <div className="mb-4 p-3 rounded-2xl text-xs" style={{ background: "var(--color-paper-200)" }}>
                  <p className="font-semibold mb-1" style={{ color: "var(--color-ink-600)" }}>📝 読み取り結果</p>
                  {scanResult.ocr.memberName && <p style={{ color: "var(--color-ink-700)" }}>名前: {scanResult.ocr.memberName}</p>}
                  {scanResult.ocr.company && <p style={{ color: "var(--color-ink-500)" }}>会社: {scanResult.ocr.company}</p>}
                  {scanResult.ocr.email && <p style={{ color: "var(--color-ink-500)" }}>メール: {scanResult.ocr.email}</p>}
                </div>
              )}

              {/* 候補がある場合の説明 */}
              {scanResult.candidates.length > 0 && !isSearching ? (
                <p className="text-sm mb-3" style={{ color: "var(--color-ink-600)" }}>
                  以下のメンバーが一致候補として見つかりました。
                  <span className="font-medium" style={{ color: "var(--color-brand)" }}>タップして選択</span>してください。
                </p>
              ) : (
                <p className="text-sm mb-3" style={{ color: "var(--color-ink-600)" }}>
                  {isSearching ? "検索結果:" : "一致するメンバーが自動判定できませんでした。メンバーを手動で選んでください。"}
                </p>
              )}

              {/* 検索ボックス */}
              <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--color-ink-400)" }} />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="名前で検索..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-2xl text-sm border"
                  style={{
                    borderColor: "var(--color-paper-300)",
                    background: "var(--color-paper-50)",
                    fontSize: "16px",
                  }}
                />
              </div>

              {/* メンバーリスト */}
              <div className="flex flex-col gap-2">
                {displayMembers.length === 0 && (
                  <p className="text-sm text-center py-6" style={{ color: "var(--color-ink-400)" }}>
                    該当するメンバーが見つかりません
                  </p>
                )}
                {displayMembers.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelected(m);
                      setStep("confirm");
                    }}
                    className="flex items-center gap-3 p-3 rounded-2xl text-left w-full transition hover:opacity-80 active:opacity-70"
                    style={{ background: "var(--color-paper-200)" }}
                  >
                    {/* アバター */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 ${m.bgColor}`}>
                      {m.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                        {m.connectionStatus !== "none" && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ background: "var(--color-success)", color: "white" }}>
                            {m.connectionStatus === "real" ? "🃏 リアル" : "✓ 登録済み"}
                          </span>
                        )}
                        {(m.score ?? 0) >= 50 && !isSearching && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ background: "var(--color-accent)", color: "white" }}>
                            ✨ 一致度高
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-500)" }}>
                        {m.category}
                      </p>
                    </div>
                    <ChevronRight size={16} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
                  </button>
                ))}
              </div>

              {/* 再スキャンボタン */}
              <button
                onClick={() => { setStep("capture"); setSearchQuery(""); setScanResult(null); setPreviewUrl(null); }}
                className="mt-4 w-full py-2.5 rounded-2xl text-sm flex items-center justify-center gap-2 transition hover:opacity-80"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                <RefreshCw size={14} />
                別の画像で再スキャン
              </button>
            </div>
          )}

          {/* ③ 確認ステップ */}
          {step === "confirm" && selected && (
            <div>
              <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
                以下のメンバーとの1to1を記録します。
              </p>

              {/* 選択されたメンバーカード */}
              <div className="card-paper p-4 mb-4 flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-3xl ${selected.bgColor}`}>
                  {selected.emoji}
                </div>
                <div>
                  <p className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                    {selected.name}
                  </p>
                  <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>{selected.category}</p>
                  {selected.businessDescription && (
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--color-ink-400)" }}>
                      {selected.businessDescription}
                    </p>
                  )}
                </div>
              </div>

              {/* 登録内容の説明 */}
              <div className="rounded-2xl p-3 mb-4 text-sm space-y-1.5"
                style={{ background: "var(--color-paper-200)" }}>
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--color-success)" }}>✅</span>
                  <span style={{ color: "var(--color-ink-700)" }}>{selected.name}さんのカードをデジタルで受け取る</span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--color-accent)" }}>✨</span>
                  <span style={{ color: "var(--color-ink-700)" }}>+1pt 獲得</span>
                </div>
                {selected.connectionStatus !== "none" && (
                  <div className="flex items-center gap-2">
                    <span>ℹ️</span>
                    <span style={{ color: "var(--color-ink-500)" }}>
                      すでに登録済みのため、ポイントは付与されません
                    </span>
                  </div>
                )}
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-2xl text-sm" style={{ background: "#fee2e2", color: "#b91c1c" }}>
                  ⚠️ {error}
                </div>
              )}

              <button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending}
                className="w-full py-4 rounded-2xl font-semibold text-sm text-white flex items-center justify-center gap-2 active:opacity-80 transition disabled:opacity-50"
                style={{ background: "var(--color-brand)" }}
              >
                {importMutation.isPending ? (
                  <><Loader2 size={16} className="animate-spin" />登録中...</>
                ) : (
                  <><Check size={16} />1to1を記録する</>
                )}
              </button>
            </div>
          )}

          {/* 完了 */}
          {step === "done" && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                登録完了！
              </h3>
              <p className="text-sm mb-1" style={{ color: "var(--color-ink-600)" }}>
                <strong>{selected?.name}</strong>さんとの1to1を記録しました。
              </p>
              <p className="text-sm mb-6" style={{ color: "var(--color-accent)" }}>
                ✨ +1pt 獲得
              </p>
              <button
                onClick={onClose}
                className="px-8 py-3 rounded-2xl font-semibold text-sm text-white transition active:opacity-80"
                style={{ background: "var(--color-brand)" }}
              >
                閉じる
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
