// =============================================================
// メンバー登録画面 — iPhone 最適化 4ステップウィザード
// Step 1: カード表面撮影（OCR）
// Step 2: スキル確認・補足入力
// Step 3: プロフィール（名前・メール）
// Step 4: 完了
// =============================================================
import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, ArrowLeft, ArrowRight, Check, Loader2, RefreshCw, Plus, X, Upload } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { LogoOrbit } from "@/components/logo-orbit";
import { useSettings } from "@/hooks/use-settings";
import { CARD_CHARACTERS } from "@/screens/card-order/card-order-screen";
import type { Usp } from "@shared/types";

// ---- 型定義 ----
type SkillOcr = {
  name: string;
  emoji: string;
  issue: string;
  connector: string;
  solution: string;
};

type PendingUspRequest = {
  uspName: string;
  emoji: string;
  description: string;
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
  const navigate = useNavigate();
  const { appTitle, characterImageUrl, appLogo, isLoading: settingsLoading } = useSettings();
  const [step, setStep] = useState(1);

  // Step1
  const [frontImage, setFrontImage]   = useState<string | null>(null);
  const [ocrDone, setOcrDone]         = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Step2: スキル（デフォルト3枠）
  const [skills, setSkills] = useState<SkillForm[]>([
    EMPTY_SKILL("💡"), EMPTY_SKILL("🔧"), EMPTY_SKILL("🎯"),
  ]);

  // Step2: USP承認申請（リストにないUSP）
  const [pendingUspRequests, setPendingUspRequests] = useState<PendingUspRequest[]>([]);

  // Step3: プロフィール
  const [profile, setProfile] = useState({
    name: "", furigana: "", nameRomaji: "", email: "",
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

  const [registeredMemberId, setRegisteredMemberId] = useState<string | null>(null);

  // ---- 登録 mutation ----
  const submitMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: { id: string; message: string } }>("/register/submit", {
        ...profile,
        romaji: profile.nameRomaji,
        skills: skills.filter((s) => s.name.trim()),
        cardImageBase64: frontImage ? frontImage.split(",")[1] : undefined,
        uspRequests: pendingUspRequests.length > 0 ? pendingUspRequests : undefined,
      }),
    onSuccess: (res) => {
      setRegisteredMemberId(res.data?.id ?? null);
      setStep(4);
    },
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
            onClick={() => step > 1 ? setStep(step - 1) : navigate("/login")}
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
              cameraRef={cameraRef}
              galleryRef={galleryRef}
              appTitle={appTitle}
              appLogo={appLogo}
              characterImageUrl={characterImageUrl}
              settingsLoading={settingsLoading}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step2Skills
              skills={skills}
              onUpdate={updateSkill}
              onSkillsChange={setSkills}
              pendingUspRequests={pendingUspRequests}
              onPendingUspRequestsChange={setPendingUspRequests}
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
          {step === 4 && (
            <Step4Done
              memberId={registeredMemberId}
              memberInfo={{ ...profile, skills }}
            />
          )}
        </div>
      </div>

      {/* 隠しファイル入力（カメラ起動用） */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden
      />
      {/* 隠しファイル入力（アルバム選択用） */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
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
  frontImage, scanning, scanDone, scanError, cameraRef, galleryRef, appTitle, appLogo, characterImageUrl, settingsLoading, onNext,
}: {
  frontImage: string | null;
  scanning: boolean;
  scanDone: boolean;
  scanError: boolean;
  cameraRef: React.RefObject<HTMLInputElement | null>;
  galleryRef: React.RefObject<HTMLInputElement | null>;
  appTitle: string;
  appLogo: string;
  characterImageUrl: string | null;
  settingsLoading: boolean;
  onNext: () => void;
}) {
  return (
    <div>
      {/* キャラクター画像 + アプリ名 */}
      <div className="flex flex-col items-center mb-5">
        {characterImageUrl ? (
          <img
            src={characterImageUrl}
            alt="キャラクター"
            className="w-32 h-32 object-contain"
            style={{ filter: "drop-shadow(0 4px 12px rgba(181,56,75,0.15))" }}
          />
        ) : !settingsLoading ? (
          <LogoOrbit logo={appLogo} />
        ) : null}
        <p
          className="text-xl font-semibold"
          style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}
        >
          {appTitle}
        </p>
      </div>

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
        onClick={() => cameraRef.current?.click()}
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
          </div>
        )}
      </button>

      {/* アルバムから選ぶ */}
      {!scanning && (
        <button
          type="button"
          className="mt-2 w-full py-2 rounded-2xl text-xs flex items-center justify-center gap-1.5 active:opacity-70"
          style={{ color: "var(--color-ink-500)" }}
          onClick={() => galleryRef.current?.click()}
        >
          🖼️ カメラロールから選ぶ
        </button>
      )}

      {/* 撮り直しボタン */}
      {frontImage && !scanning && (
        <button
          type="button"
          className="mt-1 w-full py-2.5 rounded-2xl text-sm flex items-center justify-center gap-2 active:opacity-70"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          onClick={() => cameraRef.current?.click()}
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
// Step 2: USP 選択 + スキル詳細入力 + USP申請
// ================================================================
function Step2Skills({
  skills, onUpdate, onSkillsChange,
  pendingUspRequests, onPendingUspRequestsChange,
  onNext,
}: {
  skills: SkillForm[];
  onUpdate: (idx: number, field: keyof SkillForm, value: string) => void;
  onSkillsChange: (skills: SkillForm[]) => void;
  pendingUspRequests: PendingUspRequest[];
  onPendingUspRequestsChange: (reqs: PendingUspRequest[]) => void;
  onNext: () => void;
}) {
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [reqForm, setReqForm] = useState<PendingUspRequest>({ uspName: "", emoji: "⭐", description: "" });

  const { data: uspsData } = useQuery({
    queryKey: ["usps"],
    queryFn: () => api.get<{ data: Usp[] }>("/usps"),
    staleTime: 5 * 60 * 1000,
  });
  const usps = uspsData?.data ?? [];

  const selectedNames = skills.map((s) => s.name).filter(Boolean);
  const canProceed = selectedNames.length > 0 || pendingUspRequests.length > 0;

  function toggleUsp(usp: Usp) {
    if (selectedNames.includes(usp.name)) {
      onSkillsChange(skills.filter((s) => s.name !== usp.name));
    } else {
      onSkillsChange([...skills.filter((s) => s.name), {
        name: usp.name,
        emoji: usp.emoji,
        issue: "",
        connector: "に対して、",
        solution: "",
      }]);
    }
  }

  function addUspRequest() {
    if (!reqForm.uspName.trim()) return;
    onPendingUspRequestsChange([...pendingUspRequests, { ...reqForm, uspName: reqForm.uspName.trim() }]);
    setReqForm({ uspName: "", emoji: "⭐", description: "" });
    setShowRequestForm(false);
  }

  function removeUspRequest(idx: number) {
    onPendingUspRequestsChange(pendingUspRequests.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1"
        style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        あなたのUSP（強み）を選んでください
      </h2>
      <p className="text-sm mb-1" style={{ color: "var(--color-ink-500)" }}>
        カードに表示するUSP（独自の強み）を選択してください。
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-400)" }}>
        ※ 1つ以上選択するか、新しいUSPを申請すれば次に進めます
      </p>

      {/* USP チップ選択 */}
      {usps.length > 0 ? (
        <div className="mb-5">
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>
            USPを選ぶ（複数選択可）
          </p>
          <div className="flex flex-wrap gap-2">
            {usps.map((usp) => {
              const isSelected = selectedNames.includes(usp.name);
              return (
                <button
                  key={usp.id}
                  type="button"
                  onClick={() => toggleUsp(usp)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition active:opacity-70"
                  style={{
                    background: isSelected ? "var(--color-brand)" : "var(--color-paper-200)",
                    color: isSelected ? "white" : "var(--color-ink-700)",
                    border: isSelected ? "none" : "1.5px solid var(--color-paper-300)",
                  }}
                  title={usp.description ?? usp.name}
                >
                  <span>{usp.emoji}</span>
                  <span>{usp.name}</span>
                  {isSelected && <Check size={13} />}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-4 p-3 rounded-2xl text-sm"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
          読み込み中...
        </div>
      )}

      {/* 選択済み USP の詳細入力 */}
      {skills.filter((s) => s.name).length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>
            選択したUSPの説明を入力（任意）
          </p>
          <div className="space-y-3">
            {skills.filter((s) => s.name).map((skill) => {
              const idx = skills.indexOf(skill);
              return (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onUpdate={(field, value) => onUpdate(idx, field, value)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ---- リストにないUSPの申請 ---- */}
      <div className="mb-2">
        <div
          className="rounded-3xl overflow-hidden"
          style={{ border: "1.5px solid var(--color-paper-300)", background: "var(--color-paper-50)" }}
        >
          <button
            type="button"
            onClick={() => setShowRequestForm((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium active:opacity-70 transition"
            style={{ color: "var(--color-ink-600)" }}
          >
            <Plus size={15} style={{ color: "var(--color-brand)" }} />
            リストにないUSPを申請する
            <span className="ml-auto text-xs" style={{ color: "var(--color-ink-400)" }}>
              {showRequestForm ? "▲" : "▼"}
            </span>
          </button>

          {showRequestForm && (
            <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--color-paper-300)" }}>
              <p className="text-xs pt-3" style={{ color: "var(--color-ink-400)" }}>
                希望するUSP名と説明を入力してください。登録後に管理者が審査し、承認結果をメールでお知らせします。
              </p>
              <div className="flex gap-2">
                <div style={{ width: "52px" }}>
                  <label className="block text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>絵文字</label>
                  <input
                    value={reqForm.emoji}
                    onChange={(e) => setReqForm((f) => ({ ...f, emoji: e.target.value }))}
                    className="w-full rounded-xl border text-center text-lg"
                    style={{ padding: "8px 4px", borderColor: "var(--color-paper-300)", background: "white", fontSize: "20px" }}
                    maxLength={2}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>USP名 *</label>
                  <input
                    value={reqForm.uspName}
                    onChange={(e) => setReqForm((f) => ({ ...f, uspName: e.target.value }))}
                    placeholder="例: 事業再生支援力"
                    className="w-full rounded-xl border"
                    style={{ fontSize: "16px", padding: "8px 12px", borderColor: "var(--color-paper-300)", background: "white", color: "var(--color-ink-800)" }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>説明（任意）</label>
                <textarea
                  value={reqForm.description}
                  onChange={(e) => setReqForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="例: 事業の立て直しや再生計画の策定を支援する能力"
                  rows={2}
                  className="w-full rounded-xl border resize-none"
                  style={{ fontSize: "16px", padding: "8px 12px", borderColor: "var(--color-paper-300)", background: "white", color: "var(--color-ink-800)" }}
                />
              </div>
              <button
                type="button"
                onClick={addUspRequest}
                disabled={!reqForm.uspName.trim()}
                className="w-full py-2.5 rounded-2xl text-sm font-semibold flex items-center justify-center gap-1.5 active:opacity-80 disabled:opacity-40 transition"
                style={{ background: "var(--color-brand)", color: "white" }}
              >
                <Plus size={14} />
                申請リストに追加
              </button>
            </div>
          )}
        </div>

        {/* 追加済み申請一覧 */}
        {pendingUspRequests.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>
              📨 申請予定のUSP（登録完了時に申請されます）
            </p>
            {pendingUspRequests.map((req, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl"
                style={{ background: "rgba(181,56,75,0.08)", border: "1px solid rgba(181,56,75,0.2)" }}
              >
                <span className="text-lg">{req.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{req.uspName}</p>
                  {req.description && (
                    <p className="text-xs truncate" style={{ color: "var(--color-ink-400)" }}>{req.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeUspRequest(idx)}
                  className="shrink-0 p-1 rounded-full active:opacity-60"
                  style={{ color: "var(--color-ink-400)" }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
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

// ---- スキルカード（詳細入力枠） ----
function SkillCard({
  skill, onUpdate,
}: {
  skill: SkillForm;
  onUpdate: (field: keyof SkillForm, value: string) => void;
}) {
  return (
    <div className="card-paper p-4 rounded-3xl"
      style={{ borderLeft: "3px solid var(--color-brand)" }}>
      {/* ヘッダー: USP名・絵文字 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{skill.emoji}</span>
        <span className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>
          {skill.name}
        </span>
      </div>

      {/* 課題シーン */}
      <div className="mb-2">
        <label className="block text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>
          どんな課題に役立つか（任意）
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
        <label className="block text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>
          どう解決できるか（任意）
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
      {(skill.issue || skill.solution) && (
        <div className="mt-3 p-3 rounded-2xl text-sm"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
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
          label="ローマ字（名刺カードに表示されます）"
          value={profile.nameRomaji}
          onChange={(v) => onUpdate("nameRomaji", v)}
          placeholder="Taro Yamada"
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
// Step 4: 完了 + カード注文ウィザード（インライン・認証不要）
// ================================================================
type Plan = { name: string; price: number };
type OrderStep = "celebrate" | "select-char" | "select-photo" | "select-info" | "select-plan" | "confirm" | "ordered";

type MemberInfo = {
  name: string; furigana?: string; nameRomaji?: string; email?: string;
  company?: string; role?: string; category?: string; businessDescription?: string;
  skills?: SkillForm[];
};

function CRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="text-xs shrink-0 w-24" style={{ color: "var(--color-ink-400)" }}>{label}</span>
      <span className="text-sm font-medium flex-1" style={{ color: "var(--color-ink-800)" }}>{value}</span>
    </div>
  );
}

function Step4Done({ memberId, memberInfo }: { memberId: string | null; memberInfo?: MemberInfo }) {
  const [orderStep, setOrderStep] = useState<OrderStep>("celebrate");
  const [selectedChar, setSelectedChar] = useState<(typeof CARD_CHARACTERS)[number] | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [thankYouMessage, setThankYouMessage] = useState<string>("");
  const photoCameraRef = useRef<HTMLInputElement>(null);
  const photoGalleryRef = useRef<HTMLInputElement>(null);

  const { data: settingsData } = useQuery({
    queryKey: ["card-print-settings"],
    queryFn: () => api.get<{ data: { enabled: boolean; imageOnlyPrice: number | null; imageOnlyName: string; plans: Plan[]; thankYouMessage: string; companyName: string } | null }>("/card-print-settings"),
    retry: false,
  });
  const settings = settingsData?.data;
  const cardEnabled = settings?.enabled ?? false;
  const allPlans: Plan[] = [
    ...(settings?.imageOnlyPrice != null ? [{ name: settings.imageOnlyName || "カードイメージデータ作成のみ", price: settings.imageOnlyPrice }] : []),
    ...(settings?.plans ?? []),
  ];

  const handlePhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoBase64(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const orderMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: { id: string; thankYouMessage: string } }>("/register/card-order", {
        memberId,
        characterKey: selectedChar!.key,
        characterLabel: `${selectedChar!.emoji} ${selectedChar!.label}`,
        photoBase64: photoBase64 ? photoBase64.split(",")[1] : undefined,
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        planName: selectedPlan!.name,
        planPrice: selectedPlan!.price,
      }),
    onSuccess: (res) => {
      setThankYouMessage(res.data?.thankYouMessage ?? "ご注文ありがとうございました！");
      setOrderStep("ordered");
    },
  });

  // ---- 注文完了 ----
  if (orderStep === "ordered") {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="text-6xl mb-5">🃏✨</div>
        <h2 className="text-xl font-semibold mb-3"
          style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
          注文が完了しました！
        </h2>
        <p className="text-sm mb-2" style={{ color: "var(--color-ink-600)" }}>
          確認メールをお送りしました。
        </p>
        {thankYouMessage && (
          <p className="text-sm mb-6 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
            {thankYouMessage}
          </p>
        )}
        <p className="text-xs mb-8" style={{ color: "var(--color-ink-400)" }}>
          管理者の承認後にログインできるようになります。
        </p>
        <Link to="/login" className="px-10 py-4 rounded-2xl text-white font-semibold text-base active:opacity-80 transition"
          style={{ background: "var(--color-brand)" }}>
          ログイン画面へ
        </Link>
      </div>
    );
  }

  // ---- 申請完了メッセージ ----
  if (orderStep === "celebrate") {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="text-7xl mb-6">🎉</div>
        <h2 className="text-2xl font-semibold mb-3"
          style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
          申請が完了しました！
        </h2>
        <p className="text-base mb-2" style={{ color: "var(--color-ink-600)" }}>
          管理者の承認をお待ちください。
        </p>
        <p className="text-sm mb-8" style={{ color: "var(--color-ink-400)" }}>
          承認されるとログインできるようになります。
        </p>
        {cardEnabled && memberId && (
          <div className="w-full rounded-3xl p-5 mb-6 text-left"
            style={{ background: "rgba(181,56,75,0.06)", border: "1.5px solid rgba(181,56,75,0.2)" }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">🃏</span>
              <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>
                リアルカードを注文しませんか？
              </p>
            </div>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
              今すぐリアルカードを注文できます！ゲームをより楽しむためにリアルカードの作成をお勧めします。
            </p>
            <button
              type="button"
              onClick={() => setOrderStep("select-char")}
              className="w-full py-3 rounded-2xl text-white font-semibold text-sm active:opacity-80 transition mb-2"
              style={{ background: "var(--color-brand)" }}
            >
              🃏 カードを注文する
            </button>
            <p className="text-xs text-center" style={{ color: "var(--color-ink-400)" }}>
              ※ ログイン後のマイページからも申し込めます
            </p>
          </div>
        )}
        <Link to="/login"
          className="w-full text-center px-6 py-4 rounded-2xl font-semibold text-base active:opacity-80 transition"
          style={{
            background: cardEnabled && memberId ? "var(--color-paper-300)" : "var(--color-brand)",
            color: cardEnabled && memberId ? "var(--color-ink-600)" : "white",
          }}>
          {cardEnabled && memberId ? "カードを注文せずに今すぐログイン画面へ" : "ログイン画面へ"}
        </Link>
      </div>
    );
  }

  // ---- キャラクター選択 ----
  if (orderStep === "select-char") {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🃏 キャラクターを選んでください
        </h2>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          カードのキャラクターデザインを1つ選んでください。
        </p>
        <div className="grid grid-cols-1 gap-3 mb-6">
          {CARD_CHARACTERS.map((c) => {
            const isSelected = selectedChar?.key === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelectedChar(c)}
                className="text-left p-4 rounded-3xl transition active:opacity-70"
                style={{
                  background: isSelected ? "rgba(181,56,75,0.08)" : "var(--color-paper-50)",
                  border: isSelected ? "2px solid var(--color-brand)" : "1.5px solid var(--color-paper-300)",
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{c.emoji}</span>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: isSelected ? "var(--color-brand)" : "var(--color-ink-800)" }}>
                      {c.label}
                    </p>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--color-ink-500)" }}>
                      {c.desc}
                    </p>
                  </div>
                  {isSelected && <Check size={16} className="ml-auto shrink-0" style={{ color: "var(--color-brand)" }} />}
                </div>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => { if (selectedChar) setOrderStep("select-photo"); }}
          disabled={!selectedChar}
          className="w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-40 transition"
          style={{ background: "var(--color-brand)", minHeight: "52px" }}
        >
          次へ <ArrowRight size={18} />
        </button>
        <button type="button" onClick={() => setOrderStep("celebrate")}
          className="mt-3 w-full py-2 text-sm" style={{ color: "var(--color-ink-400)" }}>
          ← 戻る
        </button>
      </div>
    );
  }

  // ---- 顔写真登録 ----
  if (orderStep === "select-photo") {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📷 お顔の写真を登録してください
        </h2>
        <p className="text-xs mb-5" style={{ color: "var(--color-ink-500)" }}>
          ご自身の顔写真または似顔絵・イラストをご提供ください（任意）。
        </p>
        <div
          className="w-full rounded-3xl border-2 border-dashed flex flex-col items-center justify-center"
          style={{
            minHeight: photoBase64 ? "auto" : "160px",
            borderColor: photoBase64 ? "var(--color-success)" : "var(--color-paper-300)",
            background: "var(--color-paper-50)",
          }}
        >
          {photoBase64 ? (
            <div className="relative w-full">
              <img src={photoBase64} alt="写真プレビュー" className="w-full object-contain max-h-56 rounded-3xl" />
              <button
                onClick={() => setPhotoBase64(null)}
                className="absolute top-2 right-2 p-1.5 rounded-full"
                style={{ background: "rgba(0,0,0,0.4)" }}
              >
                <X size={14} color="white" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8">
              <Camera size={36} style={{ color: "var(--color-paper-400)" }} />
              <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>写真は任意です</p>
            </div>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => photoCameraRef.current?.click()}
            className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 active:opacity-80"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
          >
            <Camera size={15} /> 撮影
          </button>
          <button
            onClick={() => photoGalleryRef.current?.click()}
            className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 active:opacity-80"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
          >
            <Upload size={15} /> 選択
          </button>
        </div>
        <input ref={photoCameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={handlePhotoChange} />
        <input ref={photoGalleryRef} type="file" accept="image/*" className="sr-only" onChange={handlePhotoChange} />
        <button
          type="button"
          onClick={() => setOrderStep("select-info")}
          className="mt-5 w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 transition"
          style={{ background: "var(--color-brand)", minHeight: "52px" }}
        >
          {photoBase64 ? "次へ" : "写真なしで続ける"} <ArrowRight size={18} />
        </button>
        <button type="button" onClick={() => setOrderStep("select-char")}
          className="mt-3 w-full py-2 text-sm" style={{ color: "var(--color-ink-400)" }}>
          ← 戻る
        </button>
      </div>
    );
  }

  // ---- カード追加情報（住所・電話） ----
  if (orderStep === "select-info") {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📍 カードに載せる情報
        </h2>
        <p className="text-xs mb-5" style={{ color: "var(--color-ink-500)" }}>
          名刺代わりに使う場合は住所・電話番号もご入力ください（任意）。
        </p>
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>
              会社住所（任意）
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="〒123-4567 東京都..."
              className="w-full rounded-2xl border px-4 py-3"
              style={{ fontSize: "16px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-800)" }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>
              電話番号（任意）
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="03-1234-5678"
              type="tel"
              className="w-full rounded-2xl border px-4 py-3"
              style={{ fontSize: "16px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-800)" }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOrderStep("select-plan")}
          className="w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 transition"
          style={{ background: "var(--color-brand)", minHeight: "52px" }}
        >
          次へ <ArrowRight size={18} />
        </button>
        <button type="button" onClick={() => setOrderStep("select-photo")}
          className="mt-3 w-full py-2 text-sm" style={{ color: "var(--color-ink-400)" }}>
          ← 戻る
        </button>
      </div>
    );
  }

  // ---- プラン選択 ----
  if (orderStep === "select-plan") {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          💳 プランを選んでください
        </h2>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          ご希望の枚数・プランをお選びください。
        </p>
        {allPlans.length === 0 ? (
          <div className="p-4 rounded-2xl text-sm text-center" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
            プランが設定されていません。管理者にお問い合わせください。
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {allPlans.map((p) => {
              const isSelected = selectedPlan?.name === p.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setSelectedPlan(p)}
                  className="w-full text-left p-4 rounded-3xl transition active:opacity-70"
                  style={{
                    background: isSelected ? "rgba(181,56,75,0.08)" : "var(--color-paper-50)",
                    border: isSelected ? "2px solid var(--color-brand)" : "1.5px solid var(--color-paper-300)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm" style={{ color: isSelected ? "var(--color-brand)" : "var(--color-ink-800)" }}>
                      {p.name}
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-base font-bold" style={{ color: isSelected ? "var(--color-brand)" : "var(--color-ink-700)" }}>
                        ¥{p.price.toLocaleString()}
                      </p>
                      {isSelected && <Check size={16} style={{ color: "var(--color-brand)" }} />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => { if (selectedPlan) setOrderStep("confirm"); }}
          disabled={!selectedPlan}
          className="w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-40 transition"
          style={{ background: "var(--color-brand)", minHeight: "52px" }}
        >
          確認画面へ <ArrowRight size={18} />
        </button>
        <button type="button" onClick={() => setOrderStep("select-info")}
          className="mt-3 w-full py-2 text-sm" style={{ color: "var(--color-ink-400)" }}>
          ← 戻る
        </button>
      </div>
    );
  }

  // ---- 確認 ----
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        📋 注文内容の確認
      </h2>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
        以下の内容で注文します。内容をご確認ください。
      </p>

      {/* 発注内容 */}
      <div className="card-paper p-4 rounded-3xl mb-3">
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-brand)" }}>🃏 注文内容</p>
        <div className="divide-y" style={{ borderColor: "var(--color-paper-300)" }}>
          <CRow label="キャラクター" value={`${selectedChar?.emoji ?? ""} ${selectedChar?.label ?? ""}`} />
          <CRow label="写真" value={photoBase64 ? "提供あり ✅" : "なし"} />
          <CRow label="プラン" value={selectedPlan?.name ?? ""} />
          <CRow label="金額" value={`¥${selectedPlan?.price.toLocaleString() ?? ""}`} />
        </div>
      </div>

      {/* プロフィール情報 */}
      {memberInfo && (
        <div className="card-paper p-4 rounded-3xl mb-3">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-brand)" }}>👤 プロフィール情報</p>
          <div className="divide-y" style={{ borderColor: "var(--color-paper-300)" }}>
            {memberInfo.name && <CRow label="氏名" value={memberInfo.name} />}
            {memberInfo.furigana && <CRow label="ふりがな" value={memberInfo.furigana} />}
            {memberInfo.nameRomaji && <CRow label="ローマ字" value={memberInfo.nameRomaji} />}
            {memberInfo.email && <CRow label="メール" value={memberInfo.email} />}
            {memberInfo.company && <CRow label="会社名" value={memberInfo.company} />}
            {memberInfo.role && <CRow label="役職" value={memberInfo.role} />}
            {memberInfo.category && <CRow label="職種" value={memberInfo.category} />}
            {memberInfo.businessDescription && <CRow label="事業内容" value={memberInfo.businessDescription} />}
          </div>
        </div>
      )}

      {/* スキル */}
      {memberInfo?.skills && memberInfo.skills.filter((s) => s.name).length > 0 && (
        <div className="card-paper p-4 rounded-3xl mb-3">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-brand)" }}>✨ USP・スキル</p>
          <div className="space-y-2">
            {memberInfo.skills.filter((s) => s.name).map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-base shrink-0">{s.emoji}</span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>{s.name}</p>
                  {(s.issue || s.solution) && (
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--color-ink-500)" }}>
                      {s.issue}{s.issue && s.solution ? s.connector : ""}{s.solution}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 住所・電話 */}
      {(address || phone) && (
        <div className="card-paper p-4 rounded-3xl mb-3">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-brand)" }}>📍 カード掲載情報</p>
          <div className="divide-y" style={{ borderColor: "var(--color-paper-300)" }}>
            {address && <CRow label="住所" value={address} />}
            {phone && <CRow label="電話番号" value={phone} />}
          </div>
        </div>
      )}

      {orderMutation.isError && (
        <div className="mb-4 p-3 rounded-2xl text-sm"
          style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
          ⚠️ 注文に失敗しました。時間をおいて再度お試しください。
        </div>
      )}

      {settings?.companyName && (
        <p className="text-xs mb-4 text-center" style={{ color: "var(--color-ink-400)" }}>
          注文後、{settings.companyName}にご注文情報が送られます。
        </p>
      )}

      <button
        type="button"
        onClick={() => orderMutation.mutate()}
        disabled={orderMutation.isPending}
        className="w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50 transition"
        style={{ background: "var(--color-brand)", minHeight: "52px" }}
      >
        {orderMutation.isPending
          ? <><Loader2 size={18} className="animate-spin" />送信中...</>
          : <>🃏 この内容で注文する</>}
      </button>
      <button type="button" onClick={() => setOrderStep("select-plan")}
        className="mt-3 w-full py-2 text-sm" style={{ color: "var(--color-ink-400)" }}>
        ← 戻る
      </button>
    </div>
  );
}
