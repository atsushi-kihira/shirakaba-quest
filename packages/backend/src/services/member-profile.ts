// =============================================================
// メンバーのプロフィールの更新（本人がマイページで編集する場合と、管理者がメンバー管理で編集する場合の共通処理）
// 編集できる項目は、マイページの「プロフィール編集」と同じ。メールアドレスの変更は、別の処理（確認メール／代行変更）で行う。
// =============================================================
import type { schema } from "../db/index.ts";
import type { Skill } from "@shared/types";

export type ProfileBody = Partial<{
  name: string;
  furigana: string;
  romaji: string;
  emoji: string;
  bgColor: string;
  company: string;
  role: string;
  phone: string;
  address: string;
  characterKey: string | null;
  category: string;
  businessDescription: string;
  skills: Skill[];
  qrCodeUrl: string;
  facebookUrl: string;
  linkedinUrl: string;
  instagramUrl: string;
  customFields: Record<string, string>;
  timezone: string | null;
  businessCommunityJoinedDate: string | null;
  /** 所在地（都道府県）。空にすると、会社名・住所から自動で入れ直す */
  prefecture: string | null;
}>;

export const MAX_SKILLS = 5;

type MemberPatch = Partial<typeof schema.members.$inferInsert>;

/** 送られてきた項目だけを、更新内容にする（送られなかった項目は変えない）。不正な内容は、メッセージを返す */
export function buildProfilePatch(body: ProfileBody, now: number): { ok: true; patch: MemberPatch } | { ok: false; message: string } {
  if (body.businessCommunityJoinedDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.businessCommunityJoinedDate)) {
    return { ok: false, message: "入会日の形式が正しくありません" };
  }
  if (body.name !== undefined && !body.name.trim()) return { ok: false, message: "名前を入力してください" };
  if (body.skills !== undefined && (!Array.isArray(body.skills) || body.skills.length > MAX_SKILLS)) {
    return { ok: false, message: `スキルは最大${MAX_SKILLS}つまでです` };
  }
  return {
    ok: true,
    patch: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.furigana !== undefined && { furigana: body.furigana }),
      ...(body.romaji !== undefined && { romaji: body.romaji }),
      ...(body.emoji !== undefined && { emoji: body.emoji }),
      ...(body.bgColor !== undefined && { bgColor: body.bgColor }),
      ...(body.company !== undefined && { company: body.company }),
      ...(body.role !== undefined && { role: body.role }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.address !== undefined && { address: body.address }),
      ...(body.characterKey !== undefined && { characterKey: body.characterKey }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.businessDescription !== undefined && { businessDescription: body.businessDescription }),
      ...(body.skills !== undefined && { skills: JSON.stringify(body.skills) }),
      ...(body.qrCodeUrl !== undefined && { qrCodeUrl: body.qrCodeUrl }),
      ...(body.facebookUrl !== undefined && { facebookUrl: body.facebookUrl }),
      ...(body.linkedinUrl !== undefined && { linkedinUrl: body.linkedinUrl }),
      ...(body.instagramUrl !== undefined && { instagramUrl: body.instagramUrl }),
      ...(body.customFields !== undefined && { customFields: JSON.stringify(body.customFields) }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.businessCommunityJoinedDate !== undefined && { businessCommunityJoinedDate: body.businessCommunityJoinedDate }),
      updatedAt: now,
    },
  };
}
