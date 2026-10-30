// =============================================================
// プロフィール編集モーダル
//   ・本人が、マイページで自分のプロフィールを編集する（mode="self"）
//   ・管理者が、管理画面のメンバー管理で、メンバーのプロフィールを編集する（mode="admin"）。編集できる項目は、どちらも同じ
// =============================================================
import { LOCATION_VALUES } from "@shared/prefectures";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { api, API_BASE_URL } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { CARD_CHARACTERS } from "@/screens/card-order/card-order-screen";
import type { Skill } from "@shared/types";

const AVATAR_BG = [
  { cls: "bg-rose-100" }, { cls: "bg-amber-100" }, { cls: "bg-emerald-100" },
  { cls: "bg-sky-100" }, { cls: "bg-violet-100" }, { cls: "bg-orange-100" },
];
const AVATAR_EMOJIS = ["😊","😄","🤗","😎","🥰","🌟","💪","🎯","🌸","🦁","🐯","🦊"];


const TIMEZONE_OPTIONS = [
  { value: "Asia/Tokyo",     label: "🇯🇵 日本標準時 (UTC+9)" },
  { value: "Asia/Seoul",     label: "🇰🇷 韓国標準時 (UTC+9)" },
  { value: "Asia/Shanghai",  label: "🇨🇳 中国標準時 (UTC+8)" },
  { value: "Asia/Singapore", label: "🇸🇬 シンガポール標準時 (UTC+8)" },
  { value: "Europe/London",  label: "🇬🇧 グリニッジ標準時 (UTC+0)" },
  { value: "Europe/Paris",   label: "🇫🇷 中央ヨーロッパ時間 (UTC+1)" },
  { value: "America/New_York", label: "🇺🇸 東部標準時 (UTC-5)" },
  { value: "America/Los_Angeles", label: "🇺🇸 太平洋標準時 (UTC-8)" },
  { value: "UTC",            label: "🌐 協定世界時 (UTC)" },
];

type EditForm = {
  name: string; furigana: string; romaji: string; emoji: string; bgColor: string;
  category: string; businessDescription: string; company: string; role: string;
  phone: string; address: string; characterKey: string;
  skills: Skill[];
  timezone: string;
  businessCommunityJoinedDate: string;
  prefecture: string;
};

/** 編集の対象になるメンバー（マイページの本人の情報・管理画面のメンバーの情報の、どちらも渡せる） */
export type EditableMember = {
  id: string;
  name: string;
  furigana?: string | null;
  romaji?: string | null;
  emoji?: string | null;
  bgColor?: string | null;
  category?: string | null;
  businessDescription?: string | null;
  company?: string | null;
  role?: string | null;
  phone?: string | null;
  address?: string | null;
  characterKey?: string | null;
  skills?: Skill[] | null;
  businessCommunityJoinedDate?: string | null;
  prefecture?: string | null;
  avatarImageKey?: string | null;
  timezone?: string | null;
};

export function MemberProfileEditModal({ member, mode = "self", onClose, onSaved }: {
  member: EditableMember; mode?: "self" | "admin"; onClose: () => void; onSaved: () => void;
}) {
  const qcEdit = useQueryClient();
  const admin = mode === "admin";
  // 保存先: 本人は /members/me、管理者は /admin/members/:id
  const profileUrl = admin ? `/admin/members/${member.id}/profile` : "/members/me";
  const avatarUrl = admin ? `/admin/members/${member.id}/avatar` : "/members/me/avatar";
  const { user: authUser } = useAuthStore();
  const { termBusinessCommunity } = useSettings();
  const [form, setForm] = useState<EditForm>({
    name: member.name ?? "",
    furigana: member.furigana ?? "",
    romaji: member.romaji ?? "",
    emoji: member.emoji ?? "😊",
    bgColor: member.bgColor ?? "bg-rose-100",
    category: member.category ?? "",
    businessDescription: member.businessDescription ?? "",
    company: member.company ?? "",
    role: member.role ?? "",
    phone: member.phone ?? "",
    address: member.address ?? "",
    characterKey: member.characterKey ?? "",
    skills: (member.skills ?? []) as Skill[],
    timezone: (admin ? member.timezone : authUser?.timezone) ?? "Asia/Tokyo",
    businessCommunityJoinedDate: member.businessCommunityJoinedDate ?? "",
    prefecture: member.prefecture ?? "",
  });
  const [error, setError] = useState("");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const hasAvatar = !!member.avatarImageKey || !!avatarPreview;

  const uploadAvatar = useMutation({
    mutationFn: (imageBase64: string) => api.post(avatarUrl, { imageBase64 }),
    onSuccess: () => {
      setUploadStatus("success");
      qcEdit.invalidateQueries({ queryKey: ["member", member.id] });
      qcEdit.invalidateQueries({ queryKey: ["me"] });
      qcEdit.invalidateQueries({ queryKey: ["admin", "members"] });
    },
    onError: () => {
      setUploadStatus("error");
      setAvatarPreview(null);
    },
  });

  const deleteAvatar = useMutation({
    mutationFn: () => api.delete(avatarUrl),
    onSuccess: () => {
      setAvatarPreview(null);
      setUploadStatus("idle");
      qcEdit.invalidateQueries({ queryKey: ["member", member.id] });
      qcEdit.invalidateQueries({ queryKey: ["me"] });
      qcEdit.invalidateQueries({ queryKey: ["admin", "members"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => api.patch(profileUrl, {
      name: form.name,
      furigana: form.furigana,
      romaji: form.romaji,
      emoji: form.emoji,
      bgColor: form.bgColor,
      category: form.category,
      businessDescription: form.businessDescription,
      company: form.company,
      role: form.role,
      phone: form.phone,
      address: form.address,
      characterKey: form.characterKey || null,
      skills: form.skills,
      timezone: form.timezone,
      businessCommunityJoinedDate: form.businessCommunityJoinedDate || null,
      // 所在地は、変えたときだけ送る（変えていない自動入力の値が、手入力として固定されないように）。空は「自動で入力」に戻す
      ...(form.prefecture !== (member.prefecture ?? "") ? { prefecture: form.prefecture } : {}),
    }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const updateSkill = (idx: number, field: keyof Skill, value: string) => {
    setForm((f) => {
      const skills = [...f.skills];
      skills[idx] = { ...skills[idx], [field]: value };
      return { ...f, skills };
    });
  };

  const addSkill = () => {
    if (form.skills.length >= 5) return;
    setForm((f) => ({ ...f, skills: [...f.skills, { name: "", emoji: "💡", issue: "", connector: "に対して、", solution: "", color: "bg-blue-100 ring-blue-300 text-blue-700" }] }));
  };

  const removeSkill = (idx: number) => {
    setForm((f) => ({ ...f, skills: f.skills.filter((_, i) => i !== idx) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="card-paper w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>✏️ プロフィール編集{admin && `（${member.name}さん）`}</h2>
          <button onClick={onClose} className="p-2 rounded-full active:opacity-70"><X size={20} /></button>
        </div>

        {error && <div className="mb-3 p-3 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>{error}</div>}

        <div className="space-y-4">
          {/* アバター */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: "var(--color-ink-500)" }}>アバター</label>
            <div className="flex items-center gap-4 mb-3">
              {/* プレビュー */}
              <div className={`w-14 h-14 rounded-2xl shrink-0 overflow-hidden flex items-center justify-center ${avatarPreview || member.avatarImageKey ? "" : form.bgColor}`}>
                {avatarPreview ? (
                  <img src={avatarPreview} alt="アバタープレビュー" className="w-full h-full object-cover" />
                ) : member.avatarImageKey ? (
                  <img src={`${API_BASE_URL}/members/${member.id}/avatar?t=${Date.now()}`} alt="アバター" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl">{form.emoji}</span>
                )}
              </div>
              <div className="flex flex-col gap-2 flex-1">
                <input ref={avatarFileRef} type="file" accept="image/png,image/jpeg" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadStatus("idle");
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const original = ev.target?.result as string;
                      const img = new Image();
                      img.onload = () => {
                        const ratio = Math.min(1, 160 / img.width, 160 / img.height);
                        const w = Math.round(img.width * ratio);
                        const h = Math.round(img.height * ratio);
                        const canvas = document.createElement("canvas");
                        canvas.width = w; canvas.height = h;
                        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
                        const resized = canvas.toDataURL("image/png");
                        setAvatarPreview(resized);
                        uploadAvatar.mutate(resized.split(",")[1]);
                      };
                      img.src = original;
                    };
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }} />
                <button type="button" onClick={() => avatarFileRef.current?.click()}
                  disabled={uploadAvatar.isPending}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium disabled:opacity-50"
                  style={{ background: "var(--color-brand)", color: "white" }}>
                  <Upload size={12} />
                  {uploadAvatar.isPending ? "アップロード中..." : "アバター画像をアップロード"}
                </button>
                {uploadStatus === "success" && (
                  <p className="text-xs font-medium" style={{ color: "var(--color-success)" }}>✅ アップロード完了</p>
                )}
                {uploadStatus === "error" && (
                  <p className="text-xs font-medium" style={{ color: "var(--color-brand)" }}>⚠️ アップロードに失敗しました</p>
                )}
                {hasAvatar && (
                  <button type="button" onClick={() => deleteAvatar.mutate()}
                    disabled={deleteAvatar.isPending}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
                    <RotateCcw size={12} />
                    絵文字に戻す
                  </button>
                )}
              </div>
            </div>
            {!hasAvatar && (
            <div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {AVATAR_EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                    className="text-xl w-9 h-9 rounded-full flex items-center justify-center active:scale-90"
                    style={{ outline: form.emoji === e ? "2px solid var(--color-brand)" : "none", background: form.emoji === e ? "var(--color-paper-200)" : "transparent" }}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {AVATAR_BG.map(({ cls }) => (
                  <button key={cls} type="button" onClick={() => setForm((f) => ({ ...f, bgColor: cls }))}
                    className={`w-8 h-8 rounded-full ${cls} active:scale-90`}
                    style={{ outline: form.bgColor === cls ? "2.5px solid var(--color-brand)" : "none", outlineOffset: "2px" }} />
                ))}
              </div>
            </div>
            )}
          </div>

          {/* 基本情報 */}
          {[
            { label: "名前 *",    key: "name",                ph: "山田 太郎" },
            { label: "ふりがな", key: "furigana",             ph: "やまだ たろう" },
            { label: "ローマ字", key: "romaji",               ph: "Taro Yamada" },
            { label: "職種",      key: "category",            ph: "税理士、コンサルタント" },
            { label: "事業内容", key: "businessDescription",   ph: "中小企業の節税・資産管理を支援" },
            { label: "会社名",   key: "company",              ph: "〇〇株式会社" },
            { label: "役職",      key: "role",                ph: "代表取締役" },
          ].map(({ label, key, ph }) => (
            <div key={key}>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>{label}</label>
              <input
                value={(form as unknown as Record<string, string>)[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={ph}
                className="w-full rounded-2xl border px-3"
                style={{ fontSize: "16px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
              />
            </div>
          ))}

          {/* 連絡先・住所 */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>電話番号</label>
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="03-1234-5678"
              type="tel"
              className="w-full rounded-2xl border px-3"
              style={{ fontSize: "16px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>会社住所</label>
            <input
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="〒123-4567 東京都..."
              className="w-full rounded-2xl border px-3"
              style={{ fontSize: "16px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
            />
          </div>

          {/* 所在地（都道府県） */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>📍 所在地（会社・屋号のある都道府県）</label>
            <select
              value={form.prefecture}
              onChange={(e) => setForm((f) => ({ ...f, prefecture: e.target.value }))}
              className="w-full rounded-2xl border px-3"
              style={{ fontSize: "15px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-800)" }}
            >
              <option value="">（会社名・住所から自動で入力）</option>
              {LOCATION_VALUES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              会社名や住所を入れると、自動で入力されます。違っていたら、ここで選び直してください。
            </p>
          </div>

          {/* ビジネスコミュニティ入会日 */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              📅 {termBusinessCommunity}入会日
            </label>
            <input
              value={form.businessCommunityJoinedDate}
              onChange={(e) => setForm((f) => ({ ...f, businessCommunityJoinedDate: e.target.value }))}
              type="date"
              className="w-full rounded-2xl border px-3"
              style={{ fontSize: "16px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
            />
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              日にちは正確でなくても大丈夫です。覚えている範囲で構いません（年月だけは正しく入力してください）
            </p>
          </div>

          {/* キャラクター */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>🃏 キャラクター</label>
            <select
              value={form.characterKey}
              onChange={(e) => setForm((f) => ({ ...f, characterKey: e.target.value }))}
              className="w-full rounded-2xl border px-3"
              style={{ fontSize: "15px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-800)" }}
            >
              <option value="">（未選択）</option>
              {CARD_CHARACTERS.map((c) => (
                <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>
              ))}
            </select>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              カード作成時に使うキャラクターデザインです
            </p>
          </div>

          {/* スキル */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold" style={{ color: "var(--color-ink-500)" }}>スキル（最大5つ）</label>
              {form.skills.length < 5 && (
                <button onClick={addSkill} className="flex items-center gap-1 text-xs px-2 py-1 rounded-xl"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
                  <Plus size={12} /> 追加
                </button>
              )}
            </div>
            <div className="space-y-3">
              {form.skills.map((skill, idx) => (
                <div key={idx} className="card-paper p-3 rounded-2xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold" style={{ color: "var(--color-brand)" }}>スキル {idx + 1}</span>
                    <button onClick={() => removeSkill(idx)} className="p-1 rounded-lg active:opacity-70">
                      <Trash2 size={12} style={{ color: "var(--color-brand)" }} />
                    </button>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input value={skill.emoji} onChange={(e) => updateSkill(idx, "emoji", e.target.value)}
                      className="w-12 text-center rounded-xl border" style={{ fontSize: "20px", padding: "6px", borderColor: "var(--color-paper-300)" }} maxLength={2} />
                    <input value={skill.name} onChange={(e) => updateSkill(idx, "name", e.target.value)}
                      placeholder="スキル名" className="flex-1 rounded-xl border px-3"
                      style={{ fontSize: "16px", padding: "8px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
                  </div>
                  <input value={skill.issue} onChange={(e) => updateSkill(idx, "issue", e.target.value)}
                    placeholder="課題シーン" className="w-full rounded-xl border px-3 mb-2"
                    style={{ fontSize: "16px", padding: "8px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
                  <input value={skill.solution} onChange={(e) => updateSkill(idx, "solution", e.target.value)}
                    placeholder="解決内容" className="w-full rounded-xl border px-3"
                    style={{ fontSize: "16px", padding: "8px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
                </div>
              ))}
            </div>
          </div>
        </div>

          {/* タイムゾーン */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-500)" }}>🕐 タイムゾーン</label>
            <select
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              className="w-full rounded-2xl border px-3"
              style={{ fontSize: "15px", padding: "10px 12px", borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
            >
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              日時の表示に使用するタイムゾーン（デフォルト: 日本標準時）
            </p>
          </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}
            className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            保存する
          </button>
        </div>
      </div>
    </div>
  );
}

