// =============================================================
// メンバー登録画面 — 4ステップウィザード
// Step 1: カード表面撮影 (OCR)
// Step 2: OCR結果確認・スキル入力
// Step 3: 補足情報入力（名前・メールなど）
// Step 4: 完了
// =============================================================
import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Camera, ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

const AVATAR_BG_OPTIONS = [
  "bg-rose-100", "bg-amber-100", "bg-emerald-100",
  "bg-sky-100", "bg-violet-100", "bg-orange-100",
];
const AVATAR_EMOJIS = ["😊","😄","🤗","😎","🥰","🌟","💪","🎯","🌸","🦁","🐯","🦊"];

type OcrResult = {
  memberName?: string;
  skillName1?: string; skillEmoji1?: string; skillIssue1?: string; skillSolution1?: string;
  skillName2?: string; skillEmoji2?: string; skillIssue2?: string; skillSolution2?: string;
  skillName3?: string; skillEmoji3?: string; skillIssue3?: string; skillSolution3?: string;
  company?: string; role?: string; phone?: string; email?: string; address?: string;
};

type SkillForm = {
  name: string;
  emoji: string;
  issue: string;
  connector: string;
  solution: string;
};

const DEFAULT_SKILL: SkillForm = { name: "", emoji: "💡", issue: "", connector: "に対して、", solution: "" };

export function RegisterScreen() {
  const [step, setStep] = useState(1);

  // Step1: OCR
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step2: スキル
  const [skills, setSkills] = useState<[SkillForm, SkillForm, SkillForm]>([
    { ...DEFAULT_SKILL },
    { ...DEFAULT_SKILL, emoji: "🔧" },
    { ...DEFAULT_SKILL, emoji: "🎯" },
  ]);

  // Step3: 基本情報
  const [form, setForm] = useState({
    name: "",
    furigana: "",
    email: "",
    emoji: "😊",
    bgColor: "bg-rose-100",
    category: "",
    businessDescription: "",
    company: "",
    role: "",
    phone: "",
    address: "",
  });

  const ocrMutation = useMutation({
    mutationFn: (imageBase64: string) =>
      api.post<{ data: OcrResult }>("/register/scan-card", { imageBase64, side: "front" }),
    onSuccess: (res) => {
      const d = res.data;
      setOcrResult(d);
      // OCR結果でフォームを埋める
      if (d.memberName) setForm((f) => ({ ...f, name: d.memberName ?? f.name }));
      setSkills([
        { name: d.skillName1 ?? "", emoji: d.skillEmoji1 ?? "💡", issue: d.skillIssue1 ?? "", connector: "に対して、", solution: d.skillSolution1 ?? "" },
        { name: d.skillName2 ?? "", emoji: d.skillEmoji2 ?? "🔧", issue: d.skillIssue2 ?? "", connector: "に対して、", solution: d.skillSolution2 ?? "" },
        { name: d.skillName3 ?? "", emoji: d.skillEmoji3 ?? "🎯", issue: d.skillIssue3 ?? "", connector: "に対して、", solution: d.skillSolution3 ?? "" },
      ]);
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post("/register/submit", {
        ...form,
        skills: skills.filter((s) => s.name.trim()),
      }),
    onSuccess: () => setStep(4),
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setFrontImage(dataUrl);
      // base64部分のみ取り出してOCRに送る
      const base64 = dataUrl.split(",")[1];
      ocrMutation.mutate(base64);
    };
    reader.readAsDataURL(file);
  }, [ocrMutation]);

  const updateSkill = (idx: number, field: keyof SkillForm, value: string) => {
    setSkills((prev) => {
      const next = [...prev] as [SkillForm, SkillForm, SkillForm];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--color-paper-100)" }}>
      {/* ヘッダー */}
      <div className="px-4 pt-6 pb-4 flex items-center gap-3">
        <Link to="/login" className="p-2 rounded-full hover:opacity-70">
          <ArrowLeft size={20} style={{ color: "var(--color-ink-500)" }} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            🃏 メンバー登録
          </h1>
          <StepIndicator current={step} total={3} />
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 px-4 pb-8 max-w-md mx-auto w-full">
        {step === 1 && (
          <Step1CardScan
            frontImage={frontImage}
            ocrPending={ocrMutation.isPending}
            ocrDone={!!ocrResult}
            fileRef={fileRef}
            onSkip={() => setStep(2)}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <Step2Skills
            skills={skills}
            onUpdate={updateSkill}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <Step3Profile
            form={form}
            onUpdate={(field, value) => setForm((f) => ({ ...f, [field]: value }))}
            onBack={() => setStep(2)}
            onSubmit={() => submitMutation.mutate()}
            loading={submitMutation.isPending}
            error={submitMutation.error?.message}
          />
        )}

        {step === 4 && <Step4Done />}
      </div>

      {/* 非表示ファイル入力 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ---- ステップインジケーター ----
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 mt-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="h-1.5 rounded-full transition-all"
          style={{
            width: i + 1 === current ? "2rem" : "0.75rem",
            background: i + 1 <= current ? "var(--color-brand)" : "var(--color-paper-300)",
          }}
        />
      ))}
    </div>
  );
}

// ---- Step1: カード撮影 ----
function Step1CardScan({
  frontImage, ocrPending, ocrDone, fileRef, onSkip, onNext,
}: {
  frontImage: string | null;
  ocrPending: boolean;
  ocrDone: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onSkip: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
        カードを撮影しましょう
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
        名刺カードの表面を撮影すると、スキル情報を自動で読み取ります。
      </p>

      <div
        className="rounded-3xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition hover:opacity-80 overflow-hidden"
        style={{ minHeight: "200px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
        onClick={() => fileRef.current?.click()}
      >
        {frontImage ? (
          <div className="relative w-full">
            <img src={frontImage} alt="カード表面" className="w-full object-contain max-h-64" />
            {ocrPending && (
              <div className="absolute inset-0 flex items-center justify-center"
                style={{ background: "rgba(250,245,232,0.85)" }}>
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={32} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--color-brand)" }}>読み取り中...</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 p-8">
            <Camera size={48} style={{ color: "var(--color-paper-400)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--color-ink-500)" }}>タップして撮影</p>
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>カメラロールから選択も可能です</p>
          </div>
        )}
      </div>

      {ocrDone && (
        <div className="mt-3 p-3 rounded-2xl flex items-center gap-2"
          style={{ background: "rgba(90,140,92,0.1)" }}>
          <Check size={16} style={{ color: "var(--color-success)" }} />
          <span className="text-sm" style={{ color: "var(--color-success)" }}>読み取り完了！次のステップで確認してください。</span>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          onClick={onSkip}
          className="flex-1 py-3 rounded-2xl text-sm font-medium"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
        >
          スキップして手入力
        </button>
        <button
          onClick={onNext}
          disabled={ocrPending}
          className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}
        >
          次へ
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ---- Step2: スキル確認・入力 ----
function Step2Skills({
  skills, onUpdate, onBack, onNext,
}: {
  skills: [SkillForm, SkillForm, SkillForm];
  onUpdate: (idx: number, field: keyof SkillForm, value: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const canProceed = skills.some((s) => s.name.trim());
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
        スキルを確認・入力
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
        あなたの得意なスキルを3つ入力してください。
      </p>

      <div className="space-y-4">
        {skills.map((skill, idx) => (
          <div key={idx} className="card-paper p-4">
            <div className="text-xs font-semibold mb-2" style={{ color: "var(--color-brand)" }}>
              スキル {idx + 1}
            </div>
            <div className="flex gap-2 mb-2">
              <input
                value={skill.emoji}
                onChange={(e) => onUpdate(idx, "emoji", e.target.value)}
                className="w-12 text-center text-xl px-1 py-1 rounded-xl border"
                style={{ borderColor: "var(--color-paper-300)" }}
                maxLength={2}
              />
              <input
                value={skill.name}
                onChange={(e) => onUpdate(idx, "name", e.target.value)}
                placeholder="スキル名（例: リスク判断力）"
                className="flex-1 px-3 py-1.5 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }}
              />
            </div>
            <input
              value={skill.issue}
              onChange={(e) => onUpdate(idx, "issue", e.target.value)}
              placeholder="課題シーン（例: 法的リスクの見落とし）"
              className="w-full px-3 py-1.5 rounded-xl border text-sm mb-2"
              style={{ borderColor: "var(--color-paper-300)" }}
            />
            <input
              value={skill.solution}
              onChange={(e) => onUpdate(idx, "solution", e.target.value)}
              placeholder="解決（例: 法的リスクを回避することができる）"
              className="w-full px-3 py-1.5 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={onBack}
          className="py-3 px-5 rounded-2xl text-sm font-medium flex items-center gap-1"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <ArrowLeft size={16} />
          戻る
        </button>
        <button onClick={onNext} disabled={!canProceed}
          className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          次へ
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ---- Step3: 基本情報 ----
function Step3Profile({
  form, onUpdate, onBack, onSubmit, loading, error,
}: {
  form: Record<string, string>;
  onUpdate: (field: string, value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
  error?: string;
}) {
  const canSubmit = form.name.trim() && form.email.trim();

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
        基本情報を入力
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
        ログインに使うメールアドレスと名前を入力してください。
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>
          {error}
        </div>
      )}

      {/* アバター選択 */}
      <div className="card-paper p-4 mb-4">
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-500)" }}>アバター</div>
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center text-3xl ${form.bgColor}`}>
            {form.emoji}
          </div>
          <div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {AVATAR_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => onUpdate("emoji", e)}
                  className={`text-xl w-8 h-8 rounded-full transition ${form.emoji === e ? "ring-2 ring-rose-400" : ""}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {AVATAR_BG_OPTIONS.map((bg) => (
                <button
                  key={bg}
                  onClick={() => onUpdate("bgColor", bg)}
                  className={`w-6 h-6 rounded-full ${bg} transition ${form.bgColor === bg ? "ring-2 ring-offset-1" : ""}`}
                  style={{ outline: form.bgColor === bg ? "2px solid var(--color-brand)" : "none" }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>お名前 *</label>
            <input value={form.name} onChange={(e) => onUpdate("name", e.target.value)}
              placeholder="山田 太郎"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ふりがな</label>
            <input value={form.furigana} onChange={(e) => onUpdate("furigana", e.target.value)}
              placeholder="やまだ たろう"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メールアドレス *</label>
          <input type="email" value={form.email} onChange={(e) => onUpdate("email", e.target.value)}
            placeholder="taro@example.com"
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>職種カテゴリー</label>
          <input value={form.category} onChange={(e) => onUpdate("category", e.target.value)}
            placeholder="例: 税理士、コンサルタント、デザイナー"
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>事業内容</label>
          <textarea value={form.businessDescription} onChange={(e) => onUpdate("businessDescription", e.target.value)}
            placeholder="提供しているサービスや専門分野を一言で"
            rows={2} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>会社名</label>
            <input value={form.company} onChange={(e) => onUpdate("company", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>役職</label>
            <input value={form.role} onChange={(e) => onUpdate("role", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={onBack}
          className="py-3 px-5 rounded-2xl text-sm font-medium flex items-center gap-1"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <ArrowLeft size={16} />
          戻る
        </button>
        <button onClick={onSubmit} disabled={!canSubmit || loading}
          className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          {loading ? (
            <><Loader2 size={16} className="animate-spin" />送信中...</>
          ) : (
            <>登録申請する <ArrowRight size={16} /></>
          )}
        </button>
      </div>
    </div>
  );
}

// ---- Step4: 完了 ----
function Step4Done() {
  return (
    <div className="text-center py-12">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-2xl font-semibold mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
        登録申請が完了しました！
      </h2>
      <p className="text-sm mb-2" style={{ color: "var(--color-ink-600)" }}>
        管理者の承認をお待ちください。
      </p>
      <p className="text-sm mb-8" style={{ color: "var(--color-ink-400)" }}>
        承認が完了すると、ご登録のメールアドレスに通知が届きます。
      </p>
      <Link
        to="/login"
        className="inline-block px-8 py-3 rounded-2xl text-white font-medium transition hover:opacity-80"
        style={{ background: "var(--color-brand)" }}
      >
        ログイン画面へ
      </Link>
    </div>
  );
}
