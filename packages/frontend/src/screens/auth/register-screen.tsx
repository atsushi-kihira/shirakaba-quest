// =============================================================
// メンバー登録画面 — iPhone 最適化 4ステップウィザード
// Step 1: カード表面撮影（OCR）
// Step 2: スキル確認・補足入力
// Step 3: プロフィール（名前・メール）
// Step 4: 完了
// =============================================================
import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Camera, ArrowLeft, ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

// ---- 型定義 ----
type SkillOcr = {
  name: string;
  emoji: string;
  issue: string;
  connector: string;
  solution: string;
};

type CardOcrResult = {
  memberName?: string;
  skills: SkillOcr[];
  rawText: string;
};

type SkillForm = SkillOcr;

const EMPTY_SKILL = (emoji = "💡"): SkillForm => ({
  name: "", emoji, issue: "", connector: "に対して、", solution: "",
});

const AVATAR_BG_OPTIONS = [
  { cls: "bg-rose-100",    label: "ローズ" },
  { cls: "bg-amber-100",   label: "アンバー" },
  { cls: "bg-emerald-100", label: "グリーン" },
  { cls: "bg-sky-100",     label: "スカイ" },
  { cls: "bg-violet-100",  label: "バイオレット" },
  { cls: "bg-orange-100",  label: "オレンジ" },
];
const AVATAR_EMOJIS = ["😊","😄","🤗","😎","🥰","🌟","💪","🎯","🌸","🦁","🐯","🦊"];

// ---- メインコンポーネント ----
export function RegisterScreen() {
  const [step, setStep] = useState(1);

  // Step1
  const [frontImage, setFrontImage]   = useState<string | null>(null);
  const [ocrDone, setOcrDone]         = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step2: スキル（デフォルト3枠）
  const [skills, setSkills] = useState<SkillForm[]>([
    EMPTY_SKILL("💡"), EMPTY_SKILL("🔧"), EMPTY_SKILL("🎯"),
  ]);

  // Step3: プロフィール
  const [profile, setProfile] = useState({
    name: "", furigana: "", email: "",
    emoji: "😊", bgColor: "bg-rose-100",
    category: "", businessDescription: "",
    company: "", role: "",
  });

  // ---- OCR mutation ----
  const ocrMutation = useMutation({
    mutationFn: (imageBase64: string) =>
      api.post<{ data: CardOcrResult }>("/register/scan-card", { imageBase64, side: "front" }),
    onSuccess: (res) => {
      const d = res.data;
      // 名前を自動補完
      if (d.memberName) {
        setProfile((p) => ({ ...p, name: d.memberName ?? p.name }));
      }
      // スキルを自動補完（最大3枠）
      if (d.skills && d.skills.length > 0) {
        setSkills(
          [0, 1, 2].map((i) =>
            d.skills[i] ?? EMPTY_SKILL(["💡","🔧","🎯"][i])
          )
        );
      }
      setOcrDone(true);
    },
  });

  // ---- 登録 mutation ----
  const submitMutation = useMutation({
    mutationFn: () =>
      api.post("/register/submit", {
        ...profile,
        skills: skills.filter((s) => s.name.trim()),
      }),
    onSuccess: () => setStep(4),
  });

  // ---- ファイル選択ハンドラー ----
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setFrontImage(dataUrl);
      setOcrDone(false);
      ocrMutation.mutate(dataUrl.split(",")[1]);
    };
    reader.readAsDataURL(file);
    // 同じファイルを再選択できるようにリセット
    e.target.value = "";
  }, [ocrMutation]);

  const updateSkill = (idx: number, field: keyof SkillForm, value: string) => {
    setSkills((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  return (
    <div
      className="min-h-dvh flex flex-col"
      style={{ background: "var(--color-paper-100)" }}
    >
      {/* ヘッダー（safe-area 対応） */}
      <div
        className="sticky top-0 z-10 px-4 pt-safe flex items-center gap-3 border-b"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 16px)",
          paddingBottom: "12px",
          background: "var(--color-paper-100)",
          borderColor: "var(--color-paper-200)",
        }}
      >
        {step < 4 ? (
          <button
            onClick={() => step > 1 ? setStep(step - 1) : undefined}
            className="p-2 -ml-2 rounded-full active:opacity-60"
          >
            <ArrowLeft size={22} style={{ color: "var(--color-ink-500)" }} />
          </button>
        ) : <div className="w-10" />}

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">🃏</span>
            <span
              className="font-semibold text-base"
              style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}
            >
              メンバー登録
            </span>
          </div>
          {step < 4 && <StepDots current={step} total={3} />}
        </div>

        <div
          className="text-xs font-medium px-2 py-1 rounded-full"
          style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}
        >
          {step < 4 ? `${step} / 3` : "完了"}
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-5 pb-8 max-w-lg mx-auto w-full">
          {step === 1 && (
            <Step1Scan
              frontImage={frontImage}
              scanning={ocrMutation.isPending}
              scanDone={ocrDone}
              scanError={ocrMutation.isError}
              fileRef={fileRef}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step2Skills
              skills={skills}
              onUpdate={updateSkill}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <Step3Profile
              profile={profile}
              onUpdate={(field, value) => setProfile((p) => ({ ...p, [field]: value }))}
              onSubmit={() => submitMutation.mutate()}
              loading={submitMutation.isPending}
              error={submitMutation.error?.message}
            />
          )}
          {step === 4 && <Step4Done />}
        </div>
      </div>

      {/* 隠しファイル入力 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden
      />
    </div>
  );
}

// ---- ステップドット ----
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1 mt-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="h-1.5 rounded-full transition-all duration-300"
          style={{
            width: i + 1 === current ? "24px" : "8px",
            background: i + 1 <= current ? "var(--color-brand)" : "var(--color-paper-300)",
          }}
        />
      ))}
    </div>
  );
}

// ================================================================
// Step 1: カード撮影
// ================================================================
function Step1Scan({
  frontImage, scanning, scanDone, scanError, fileRef, onNext,
}: {
  frontImage: string | null;
  scanning: boolean;
  scanDone: boolean;
  scanError: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onNext: () => void;
}) {
  return (
    <div>
      <h2
        className="text-xl font-semibold mb-1"
        style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}
      >
        カードを撮影
      </h2>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
        名刺カード（表面）を撮影してください。<br />
        スキル情報を自動で読み取ります。
      </p>

      {/* 撮影エリア */}
      <button
        type="button"
        className="w-full rounded-3xl overflow-hidden border-2 border-dashed active:opacity-80 transition relative"
        style={{
          minHeight: frontImage ? "auto" : "220px",
          borderColor: scanDone ? "var(--color-success)" : "var(--color-paper-300)",
          background: "var(--color-paper-50)",
        }}
        onClick={() => fileRef.current?.click()}
      >
        {frontImage ? (
          <>
            <img
              src={frontImage}
              alt="カード表面"
              className="w-full object-contain max-h-72"
            />
            {/* オーバーレイ：スキャン中 */}
            {scanning && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                style={{ background: "rgba(250,245,232,0.9)" }}
              >
                <Loader2
                  size={40}
                  className="animate-spin"
                  style={{ color: "var(--color-brand)" }}
                />
                <p className="text-sm font-medium" style={{ color: "var(--color-brand)" }}>
                  読み取り中...
                </p>
              </div>
            )}
            {/* オーバーレイ：完了 */}
            {scanDone && !scanning && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                style={{ background: "rgba(90,140,92,0.15)" }}
              >
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: "var(--color-success)" }}
                >
                  <Check size={28} color="white" />
                </div>
                <p className="text-sm font-semibold" style={{ color: "var(--color-success)" }}>
                  読み取り完了！
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-14">
            <Camera size={52} style={{ color: "var(--color-paper-400)" }} />
            <p className="text-base font-medium" style={{ color: "var(--color-ink-500)" }}>
              タップして撮影
            </p>
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
              カメラロールから選択も可能
            </p>
          </div>
        )}
      </button>

      {/* 撮り直しボタン */}
      {frontImage && !scanning && (
        <button
          type="button"
          className="mt-3 w-full py-2.5 rounded-2xl text-sm flex items-center justify-center gap-2 active:opacity-70"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          onClick={() => fileRef.current?.click()}
        >
          <RefreshCw size={14} />
          撮り直す
        </button>
      )}

      {/* エラー表示 */}
      {scanError && (
        <div className="mt-3 p-3 rounded-2xl text-sm" style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
          ⚠️ 読み取りに失敗しました。次のステップで手入力できます。
        </div>
      )}

      {/* ナビゲーションボタン */}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={onNext}
          disabled={scanning}
          className="w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50 transition"
          style={{ background: "var(--color-brand)", minHeight: "52px" }}
        >
          {scanDone ? "確認する" : "手入力で続ける"}
          <ArrowRight size={18} />
        </button>
        <Link
          to="/login"
          className="text-center text-sm py-2"
          style={{ color: "var(--color-ink-400)" }}
        >
          ← ログイン画面に戻る
        </Link>
      </div>
    </div>
  );
}

// ================================================================
// Step 2: スキル確認・入力
// ================================================================
function Step2Skills({
  skills, onUpdate, onNext,
}: {
  skills: SkillForm[];
  onUpdate: (idx: number, field: keyof SkillForm, value: string) => void;
  onNext: () => void;
}) {
  const canProceed = skills.some((s) => s.name.trim());

  return (
    <div>
      <h2
        className="text-xl font-semibold mb-1"
        style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}
      >
        スキルを入力
      </h2>
      <p className="text-sm mb-1" style={{ color: "var(--color-ink-500)" }}>
        カードに記載のスキルを確認・入力してください。
      </p>
      <p className="text-xs mb-5" style={{ color: "var(--color-ink-400)" }}>
        ※ 1つ以上入力すれば次に進めます
      </p>

      <div className="space-y-4">
        {skills.map((skill, idx) => (
          <SkillCard
            key={idx}
            index={idx}
            skill={skill}
            onUpdate={(field, value) => onUpdate(idx, field, value)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!canProceed}
        className="mt-6 w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50 transition"
        style={{ background: "var(--color-brand)", minHeight: "52px" }}
      >
        次へ
        <ArrowRight size={18} />
      </button>
    </div>
  );
}

// ---- スキルカード（1枠） ----
function SkillCard({
  index, skill, onUpdate,
}: {
  index: number;
  skill: SkillForm;
  onUpdate: (field: keyof SkillForm, value: string) => void;
}) {
  const hasContent = skill.name.trim();

  return (
    <div
      className="card-paper p-4 rounded-3xl"
      style={{
        borderLeft: `3px solid ${hasContent ? "var(--color-brand)" : "var(--color-paper-300)"}`,
      }}
    >
      {/* ヘッダー */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}
        >
          スキル {index + 1}
        </span>
        {hasContent && <Check size={14} style={{ color: "var(--color-success)" }} />}
      </div>

      {/* 絵文字 + スキル名 */}
      <div className="flex gap-2 mb-3">
        <input
          value={skill.emoji}
          onChange={(e) => onUpdate("emoji", e.target.value)}
          className="w-14 text-center rounded-xl border bg-transparent"
          style={{
            fontSize: "24px",
            lineHeight: "1",
            padding: "8px 4px",
            borderColor: "var(--color-paper-300)",
          }}
          maxLength={2}
        />
        <input
          value={skill.name}
          onChange={(e) => onUpdate("name", e.target.value)}
          placeholder="スキル名（例: 相続対策力）"
          className="flex-1 rounded-xl border px-3"
          style={{
            fontSize: "16px",   // iOS zoom 防止
            padding: "10px 12px",
            borderColor: "var(--color-paper-300)",
            background: "var(--color-paper-50)",
            color: "var(--color-ink-800)",
          }}
        />
      </div>

      {/* 課題シーン */}
      <div className="mb-2">
        <label
          className="block text-xs mb-1"
          style={{ color: "var(--color-ink-500)" }}
        >
          課題シーン
        </label>
        <input
          value={skill.issue}
          onChange={(e) => onUpdate("issue", e.target.value)}
          placeholder="例: 相続税の申告漏れ"
          className="w-full rounded-xl border px-3"
          style={{
            fontSize: "16px",
            padding: "10px 12px",
            borderColor: "var(--color-paper-300)",
            background: "var(--color-paper-50)",
            color: "var(--color-ink-800)",
          }}
        />
      </div>

      {/* 解決内容 */}
      <div>
        <label
          className="block text-xs mb-1"
          style={{ color: "var(--color-ink-500)" }}
        >
          解決内容
        </label>
        <input
          value={skill.solution}
          onChange={(e) => onUpdate("solution", e.target.value)}
          placeholder="例: 適切な節税対策ができる"
          className="w-full rounded-xl border px-3"
          style={{
            fontSize: "16px",
            padding: "10px 12px",
            borderColor: "var(--color-paper-300)",
            background: "var(--color-paper-50)",
            color: "var(--color-ink-800)",
          }}
        />
      </div>

      {/* プレビュー */}
      {hasContent && (
        <div
          className="mt-3 p-3 rounded-2xl text-sm"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
        >
          <span className="mr-1">{skill.emoji}</span>
          <strong>{skill.name}</strong>
          {skill.issue && (
            <>
              {" "}― {skill.issue}
              {skill.solution && <>{skill.connector}{skill.solution}</>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ================================================================
// Step 3: プロフィール
// ================================================================
function Step3Profile({
  profile, onUpdate, onSubmit, loading, error,
}: {
  profile: Record<string, string>;
  onUpdate: (field: string, value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error?: string;
}) {
  const canSubmit = profile.name.trim() && profile.email.trim();

  return (
    <div>
      <h2
        className="text-xl font-semibold mb-1"
        style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}
      >
        プロフィール入力
      </h2>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
        ログインに使うメールアドレスと名前を入力してください。
      </p>

      {error && (
        <div
          className="mb-4 p-3 rounded-2xl text-sm"
          style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* アバター選択 */}
      <div className="card-paper p-4 mb-5 rounded-3xl">
        <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-ink-500)" }}>
          アバターを選んでください
        </p>
        <div className="flex items-center gap-4 mb-3">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center text-4xl shrink-0 ${profile.bgColor}`}
          >
            {profile.emoji}
          </div>
          <div className="flex flex-wrap gap-2">
            {AVATAR_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onUpdate("emoji", e)}
                className="text-2xl w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition"
                style={{
                  background: profile.emoji === e ? "var(--color-paper-300)" : "transparent",
                  outline: profile.emoji === e ? "2px solid var(--color-brand)" : "none",
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {AVATAR_BG_OPTIONS.map(({ cls, label }) => (
            <button
              key={cls}
              type="button"
              onClick={() => onUpdate("bgColor", cls)}
              className={`w-9 h-9 rounded-full ${cls} active:scale-95 transition`}
              style={{
                outline: profile.bgColor === cls ? "2.5px solid var(--color-brand)" : "none",
                outlineOffset: "2px",
              }}
              aria-label={label}
            />
          ))}
        </div>
      </div>

      {/* フォームフィールド */}
      <div className="space-y-4">
        <FormField
          label="お名前 *"
          value={profile.name}
          onChange={(v) => onUpdate("name", v)}
          placeholder="山田 太郎"
        />
        <FormField
          label="ふりがな"
          value={profile.furigana}
          onChange={(v) => onUpdate("furigana", v)}
          placeholder="やまだ たろう"
        />
        <FormField
          label="メールアドレス *"
          value={profile.email}
          onChange={(v) => onUpdate("email", v)}
          placeholder="taro@example.com"
          type="email"
          inputMode="email"
        />
        <FormField
          label="職種カテゴリー"
          value={profile.category}
          onChange={(v) => onUpdate("category", v)}
          placeholder="例: 税理士、コンサルタント"
        />
        <FormField
          label="事業内容（一言で）"
          value={profile.businessDescription}
          onChange={(v) => onUpdate("businessDescription", v)}
          placeholder="例: 中小企業の節税・資産管理を支援"
        />
        <div className="flex gap-3">
          <div className="flex-1">
            <FormField
              label="会社名"
              value={profile.company}
              onChange={(v) => onUpdate("company", v)}
              placeholder="〇〇株式会社"
            />
          </div>
          <div className="flex-1">
            <FormField
              label="役職"
              value={profile.role}
              onChange={(v) => onUpdate("role", v)}
              placeholder="代表取締役"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || loading}
        className="mt-6 w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50 transition"
        style={{ background: "var(--color-brand)", minHeight: "52px" }}
      >
        {loading ? (
          <><Loader2 size={18} className="animate-spin" />送信中...</>
        ) : (
          <>登録申請する <ArrowRight size={18} /></>
        )}
      </button>
    </div>
  );
}

// ---- 汎用フォームフィールド ----
function FormField({
  label, value, onChange, placeholder, type = "text", inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div>
      <label
        className="block text-sm font-medium mb-1.5"
        style={{ color: "var(--color-ink-600)" }}
      >
        {label}
      </label>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-2xl border"
        style={{
          fontSize: "16px",    // iOS Safari のズーム防止
          padding: "12px 16px",
          borderColor: "var(--color-paper-300)",
          background: "var(--color-paper-50)",
          color: "var(--color-ink-800)",
          WebkitAppearance: "none",
        }}
      />
    </div>
  );
}

// ================================================================
// Step 4: 完了
// ================================================================
function Step4Done() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-7xl mb-6">🎉</div>
      <h2
        className="text-2xl font-semibold mb-3"
        style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}
      >
        申請が完了しました！
      </h2>
      <p className="text-base mb-2" style={{ color: "var(--color-ink-600)" }}>
        管理者の承認をお待ちください。
      </p>
      <p className="text-sm mb-10" style={{ color: "var(--color-ink-400)" }}>
        承認されるとログインできるようになります。
      </p>
      <Link
        to="/login"
        className="px-10 py-4 rounded-2xl text-white font-semibold text-base active:opacity-80 transition"
        style={{ background: "var(--color-brand)" }}
      >
        ログイン画面へ
      </Link>
    </div>
  );
}
