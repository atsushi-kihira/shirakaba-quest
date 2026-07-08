// =============================================================
// カード発注画面（メンバー向け）
// 登録完了後のプロモーション + マイページからの再発注に対応
// =============================================================
import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Camera, ArrowRight, ArrowLeft, Check, Loader2, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { useAuthStore } from "@/stores/auth-store";
import type { Skill } from "@shared/types";

type Plan = { name: string; price: number };

type CardPrintSettings = {
  enabled: boolean;
  companyName: string;
  imageOnlyPrice: number | null;
  imageOnlyName: string;
  plans: Plan[];
  thankYouMessage: string;
};

type MyOrder = {
  id: string;
  characterKey: string;
  characterLabel: string;
  planName: string;
  planPrice: number;
  status: string;
  createdAt: number;
};

type MemberProfile = {
  id: string;
  name: string;
  furigana: string;
  romaji: string | null;
  email: string | null;
  company: string | null;
  role: string | null;
  category: string;
  businessDescription: string;
  skills: Skill[];
};

// カードキャラクター定義（固定）
export const CARD_CHARACTERS = [
  { key: "hero",    label: "勇者（ヒーロー）",    emoji: "⚔️",  desc: "剣や魔法を使いこなし、攻守のバランスに優れるパーティのリーダー格。" },
  { key: "fighter", label: "戦士（ファイター）",   emoji: "🛡️", desc: "高いHPと攻撃力を持ち、最前線で敵の攻撃を一手に引き受ける盾役。" },
  { key: "monk",    label: "武闘家（モンク）",    emoji: "👊",  desc: "武器を使わず、自身の肉体（拳や足）を駆使して素早い連続攻撃を繰り出す。" },
  { key: "priest",  label: "僧侶（プリースト）",  emoji: "✨",  desc: "回復魔法や状態異常の治療を行い、パーティの生存を支える要。" },
  { key: "wizard",  label: "魔法使い（ウィザード）", emoji: "🧙", desc: "強力な攻撃魔法で敵全体を一掃する火力担当。防御力は低い。" },
  { key: "sage",    label: "賢者（セージ）",      emoji: "📚",  desc: "攻撃魔法と回復魔法の両方を極めた万能型の上級職。" },
  { key: "thief",   label: "盗賊（シーフ）",      emoji: "🗡️", desc: "素早さが高く、罠の解除やアイテムの盗み、鍵開けなどが得意。" },
  { key: "ranger",  label: "狩人（レンジャー）",  emoji: "🏹",  desc: "弓矢などを使い、遠距離から確実にダメージを与えたり、索敵に長けている。" },
  { key: "bard",    label: "吟遊詩人（バード）",  emoji: "🎵",  desc: "歌や楽器で味方の能力を強化（バフ）したり、敵を弱体化（デバフ）するサポート役。" },
] as const;

type Step = "select" | "photo" | "info" | "plan" | "confirm" | "done";

// ---- 既発注一覧（マイページからの再発注用） ----
export function MyCardOrders() {
  const { data } = useQuery({
    queryKey: ["card-orders", "my"],
    queryFn: () => api.get<{ data: MyOrder[] }>("/card-orders/my"),
  });
  const orders = data?.data ?? [];

  const STATUS_LABELS: Record<string, string> = {
    pending: "⏳ 受付済み",
    processing: "🔧 制作中",
    completed: "✅ 完了",
    cancelled: "❌ キャンセル",
  };

  if (orders.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>発注履歴</p>
      <div className="space-y-2">
        {orders.map((o) => (
          <div key={o.id} className="card-paper px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>
                {o.characterLabel}
                <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-400)" }}>
                  {new Date(o.createdAt * 1000).toLocaleDateString("ja-JP")}
                </span>
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                {o.planName} · ¥{o.planPrice.toLocaleString()}
              </p>
            </div>
            <span className="text-xs px-2 py-1 rounded-full shrink-0" style={{
              background: o.status === "pending" ? "rgba(181,56,75,0.1)" :
                o.status === "completed" ? "rgba(90,140,92,0.1)" : "var(--color-paper-200)",
              color: o.status === "pending" ? "var(--color-brand)" :
                o.status === "completed" ? "var(--color-success)" : "var(--color-ink-500)",
            }}>
              {STATUS_LABELS[o.status] ?? o.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- メインコンポーネント ----
export function CardOrderScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // マイページの「追加発注する」ボタンから ?additional=1 で遷移してくる
  const isAdditionalOrder = searchParams.get("additional") === "1";
  useSettings();
  const { user } = useAuthStore();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // 追加発注の場合は最初からプラン選択へ（useEffect での後変更は競合が起きるため使わない）
  const [step, setStep] = useState<Step>(() => isAdditionalOrder ? "plan" : "select");
  const [selectedChar, setSelectedChar] = useState<typeof CARD_CHARACTERS[number] | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [thankYouMessage, setThankYouMessage] = useState("");

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["card-print-settings"],
    queryFn: () => api.get<{ data: CardPrintSettings | null }>("/card-print-settings"),
  });
  const settings = settingsData?.data;

  // 既存の発注履歴（キャラスキップ判定用）
  const { data: existingOrdersData } = useQuery({
    queryKey: ["card-orders", "my"],
    queryFn: () => api.get<{ data: MyOrder[] }>("/card-orders/my"),
  });
  const existingOrders = existingOrdersData?.data ?? [];
  const lastOrder = existingOrders[0];
  // 追加発注モード（URLパラメータで判定）
  const isReturningUser = isAdditionalOrder;

  // メンバープロフィール（確認画面用）
  const memberId = user?.id;
  const { data: memberProfileData } = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => api.get<{ data: MemberProfile }>(`/members/${memberId}`),
    enabled: !!memberId,
  });
  const memberProfile = memberProfileData?.data;

  const allPlans: Plan[] = [
    ...(settings?.imageOnlyPrice != null ? [{ name: settings.imageOnlyName || "カードイメージデータ作成のみ", price: settings.imageOnlyPrice }] : []),
    ...(settings?.plans ?? []),
  ];

  const submitMutation = useMutation({
    mutationFn: () => {
      // 追加発注はキャラ選択をスキップするため、前回の発注情報をフォールバックに使う
      const charKey = selectedChar?.key ?? lastOrder?.characterKey ?? "hero";
      const charLabel = selectedChar
        ? `${selectedChar.emoji} ${selectedChar.label}`
        : lastOrder?.characterLabel ?? "";
      return api.post<{ data: { id: string; thankYouMessage: string } }>("/card-orders", {
        characterKey: charKey,
        characterLabel: charLabel,
        photoBase64: photoBase64 ? photoBase64.split(",")[1] : undefined,
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        planName: selectedPlan!.name,
        planPrice: selectedPlan!.price,
      });
    },
    onSuccess: (res) => {
      setThankYouMessage(res.data.thankYouMessage || "ご注文いただきありがとうございました。");
      setStep("done");
    },
  });

  const handlePhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoBase64(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  if (!settings?.enabled) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="text-5xl mb-4">🃏</div>
        <p className="font-semibold text-base mb-2" style={{ color: "var(--color-ink-700)" }}>
          カード作成はまだ準備中です
        </p>
        <p className="text-sm mb-8" style={{ color: "var(--color-ink-400)" }}>
          しばらく経ってから再度ご確認ください。
        </p>
        <button onClick={() => navigate(-1)} className="px-6 py-3 rounded-2xl text-sm"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          ← 戻る
        </button>
      </div>
    );
  }

  const stepBack = () => {
    if (isReturningUser) {
      // 追加発注フローはプラン選択から始まるので、プランより前はマイページへ戻る
      if (step === "plan" || step === "select") { navigate(-1); return; }
      const returningSteps: Step[] = ["plan", "confirm"];
      const idx = returningSteps.indexOf(step);
      if (idx > 0) setStep(returningSteps[idx - 1]);
      else navigate(-1);
    } else {
      const steps: Step[] = ["select", "photo", "info", "plan", "confirm", "done"];
      const idx = steps.indexOf(step);
      if (idx > 0) setStep(steps[idx - 1]);
      else navigate(-1);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--color-paper-100)" }}>
      {/* ヘッダー */}
      <div className="sticky top-0 z-10 px-4 flex items-center gap-3 border-b"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 16px)",
          paddingBottom: "12px",
          background: "var(--color-paper-100)",
          borderColor: "var(--color-paper-200)",
        }}>
        {step !== "done" && (
          <button onClick={stepBack} className="p-2 -ml-2 rounded-full active:opacity-60">
            <ArrowLeft size={22} style={{ color: "var(--color-ink-500)" }} />
          </button>
        )}
        <span className="text-lg">🃏</span>
        <span className="font-semibold text-base flex-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
          カード作成を申し込む
        </span>
        {step !== "done" && step !== "select" && (
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>
            {isReturningUser
              ? `${["plan", "confirm"].indexOf(step) + 1} / 2`
              : `${["select", "photo", "info", "plan", "confirm"].indexOf(step) + 1} / 5`}
          </span>
        )}
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-5 pb-10 max-w-lg mx-auto w-full">

          {/* Step 1: キャラクター選択 */}
          {step === "select" && (
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                キャラクターを選んでください
              </h2>
              <p className="text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
                あなたのイメージに合ったキャラクターをひとつ選んでください。
              </p>
              <div className="space-y-2">
                {CARD_CHARACTERS.map((ch) => (
                  <button
                    key={ch.key}
                    type="button"
                    onClick={() => setSelectedChar(ch)}
                    className="w-full card-paper flex items-start gap-3 p-4 active:opacity-80 transition"
                    style={{
                      outline: selectedChar?.key === ch.key ? "2px solid var(--color-brand)" : "none",
                      outlineOffset: "-2px",
                    }}
                  >
                    <span className="text-3xl mt-0.5 shrink-0">{ch.emoji}</span>
                    <div className="text-left flex-1">
                      <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>
                        {ch.label}
                        {selectedChar?.key === ch.key && <Check size={13} className="inline ml-1.5" style={{ color: "var(--color-brand)" }} />}
                      </p>
                      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>{ch.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStep("photo")}
                disabled={!selectedChar}
                className="mt-6 w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50 transition"
                style={{ background: "var(--color-brand)" }}
              >
                次へ <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Step 2: 顔写真 */}
          {step === "photo" && (
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                お顔の写真を登録してください
              </h2>
              <p className="text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
                ご自身の顔写真または似顔絵・イラストをご提供ください（任意）。
              </p>

              <div
                className="w-full rounded-3xl border-2 border-dashed flex flex-col items-center justify-center"
                style={{
                  minHeight: photoBase64 ? "auto" : "180px",
                  borderColor: photoBase64 ? "var(--color-success)" : "var(--color-paper-300)",
                  background: "var(--color-paper-50)",
                }}
              >
                {photoBase64 ? (
                  <div className="relative w-full">
                    <img src={photoBase64} alt="写真プレビュー" className="w-full object-contain max-h-64 rounded-3xl" />
                    <button
                      onClick={() => setPhotoBase64(null)}
                      className="absolute top-2 right-2 p-1.5 rounded-full"
                      style={{ background: "rgba(0,0,0,0.4)" }}
                    >
                      <X size={14} color="white" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-10">
                    <Camera size={40} style={{ color: "var(--color-paper-400)" }} />
                    <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>写真は任意です</p>
                  </div>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => cameraRef.current?.click()}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 active:opacity-80"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
                >
                  <Camera size={15} /> 撮影
                </button>
                <button
                  onClick={() => galleryRef.current?.click()}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 active:opacity-80"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
                >
                  🖼️ 選択
                </button>
              </div>

              <button
                type="button"
                onClick={() => setStep("info")}
                className="mt-5 w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 transition"
                style={{ background: "var(--color-brand)" }}
              >
                {photoBase64 ? "次へ" : "写真なしで続ける"} <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Step 3: 住所・電話番号 */}
          {step === "info" && (
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                カードに載せる情報
              </h2>
              <p className="text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
                名刺代わりに使用する場合は住所・電話番号もご入力ください（任意）。
              </p>
              <div className="space-y-4">
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
                onClick={() => setStep("plan")}
                className="mt-6 w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 transition"
                style={{ background: "var(--color-brand)" }}
              >
                次へ <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Step 4: プラン選択 */}
          {step === "plan" && (
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                作成プランを選んでください
              </h2>
              <p className="text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
                ご希望のカード作成プランをひとつ選んでください。
              </p>
              {allPlans.length === 0 ? (
                <div className="p-4 rounded-2xl text-sm text-center" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                  プランが設定されていません。管理者にお問い合わせください。
                </div>
              ) : (
                <div className="space-y-2">
                  {allPlans.map((plan, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedPlan(plan)}
                      className="w-full card-paper flex items-center gap-3 p-4 active:opacity-80 transition"
                      style={{
                        outline: selectedPlan?.name === plan.name ? "2px solid var(--color-brand)" : "none",
                        outlineOffset: "-2px",
                      }}
                    >
                      <div className="flex-1 text-left">
                        <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>
                          {plan.name}
                          {selectedPlan?.name === plan.name && <Check size={13} className="inline ml-1.5" style={{ color: "var(--color-brand)" }} />}
                        </p>
                      </div>
                      <p className="text-base font-bold shrink-0" style={{ color: "var(--color-brand)" }}>
                        ¥{plan.price.toLocaleString()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setStep("confirm")}
                disabled={!selectedPlan}
                className="mt-6 w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50 transition"
                style={{ background: "var(--color-brand)" }}
              >
                確認画面へ <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Step 5: 確認 */}
          {step === "confirm" && (
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                注文内容の確認
              </h2>
              <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
                以下の内容でカードを作成します。ご確認ください。
              </p>

              {/* 発注内容 */}
              <div className="card-paper p-4 rounded-3xl mb-4">
                <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-brand)" }}>🃏 発注内容</p>
                <div className="space-y-2.5">
                  {!isReturningUser && <ConfirmRow label="キャラクター" value={`${selectedChar?.emoji ?? ""} ${selectedChar?.label ?? "—"}`} bold />}
                  {!isReturningUser && <ConfirmRow label="写真" value={photoBase64 ? "提供あり ✅" : "なし"} />}
                  <ConfirmRow label="プラン" value={selectedPlan?.name ?? "—"} bold />
                  <ConfirmRow label="金額" value={`¥${selectedPlan?.price.toLocaleString() ?? "—"}`} bold />
                </div>
              </div>

              {/* プロフィール情報 */}
              <div className="card-paper p-4 rounded-3xl mb-4">
                <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-brand)" }}>👤 プロフィール情報</p>
                <div className="space-y-2.5">
                  <ConfirmRow label="氏名" value={memberProfile?.name ?? "—"} />
                  {memberProfile?.furigana && <ConfirmRow label="ふりがな" value={memberProfile.furigana} />}
                  {memberProfile?.romaji && <ConfirmRow label="ローマ字" value={memberProfile.romaji} />}
                  {memberProfile?.email && <ConfirmRow label="メール" value={memberProfile.email} />}
                  {memberProfile?.company && <ConfirmRow label="会社名" value={memberProfile.company} />}
                  {memberProfile?.role && <ConfirmRow label="役職" value={memberProfile.role} />}
                  {memberProfile?.category && <ConfirmRow label="カテゴリー" value={memberProfile.category} />}
                  {memberProfile?.businessDescription && <ConfirmRow label="事業内容" value={memberProfile.businessDescription} />}
                </div>
              </div>

              {/* USP/スキル */}
              {memberProfile?.skills && memberProfile.skills.length > 0 && (
                <div className="card-paper p-4 rounded-3xl mb-4">
                  <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-brand)" }}>⭐ USP（強み）</p>
                  <div className="space-y-2">
                    {memberProfile.skills.map((s, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-lg shrink-0">{s.emoji}</span>
                        <div>
                          <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{s.name}</p>
                          {(s.issue || s.solution) && (
                            <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--color-ink-500)" }}>
                              {s.issue && s.issue}{s.issue && s.solution && s.connector}{s.solution && s.solution}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 住所・電話番号 */}
              {(address || phone) && (
                <div className="card-paper p-4 rounded-3xl mb-4">
                  <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-brand)" }}>📍 カード掲載情報</p>
                  <div className="space-y-2.5">
                    {address && <ConfirmRow label="住所" value={address} />}
                    {phone && <ConfirmRow label="電話番号" value={phone} />}
                  </div>
                </div>
              )}

              {submitMutation.error && (
                <div className="mb-4 p-3 rounded-2xl text-sm" style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
                  ⚠️ {submitMutation.error.message}
                </div>
              )}

              {settings.companyName && (
                <p className="text-xs mb-4 text-center" style={{ color: "var(--color-ink-400)" }}>
                  注文後、{settings.companyName}にご注文情報が送られます。
                </p>
              )}

              <button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="w-full py-4 rounded-2xl font-semibold text-base text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50 transition"
                style={{ background: "var(--color-brand)" }}
              >
                {submitMutation.isPending ? (
                  <><Loader2 size={18} className="animate-spin" />送信中...</>
                ) : (
                  <>この内容で注文する <ArrowRight size={18} /></>
                )}
              </button>
            </div>
          )}

          {/* Step 6: 完了 */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-7xl mb-6">🎉</div>
              <h2 className="text-2xl font-semibold mb-3"
                style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
                ご注文ありがとうございます！
              </h2>
              <p className="text-base mb-6 leading-relaxed" style={{ color: "var(--color-ink-600)" }}>
                {thankYouMessage}
              </p>
              <p className="text-sm mb-10" style={{ color: "var(--color-ink-400)" }}>
                ご登録のメールアドレスに確認メールをお送りしました。
              </p>
              <Link
                to="/mypage"
                className="px-10 py-4 rounded-2xl text-white font-semibold text-base active:opacity-80 transition"
                style={{ background: "var(--color-brand)" }}
              >
                マイページへ
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* 隠しファイル入力 */}
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="sr-only" onChange={handlePhotoChange} />
      <input ref={galleryRef} type="file" accept="image/*" className="sr-only" onChange={handlePhotoChange} />
    </div>
  );
}

function ConfirmRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs shrink-0 mt-0.5 w-28" style={{ color: "var(--color-ink-400)" }}>{label}</span>
      <span className="text-sm flex-1 text-right" style={{ color: "var(--color-ink-800)", fontWeight: bold ? 700 : 400 }}>
        {value}
      </span>
    </div>
  );
}
