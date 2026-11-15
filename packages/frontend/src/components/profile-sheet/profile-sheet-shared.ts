// =============================================================
// 相手の紹介シート（略歴シート・GAINSシート・1to1シートの内容）の共通部分
//   ・登録した本人だけが見られる（他のメンバーには見えない）
// =============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProfileSheet, ProfileSheetFields, ProfileSheetSubjectType } from "@shared/types";

export type SheetSubject = { type: ProfileSheetSubjectType; id: string; name: string };

/** 表示・編集の項目（この順に並べる） */
export const SHEET_FIELDS: { key: keyof Omit<ProfileSheetFields, "tags">; label: string; multiline: boolean; hint?: string }[] = [
  { key: "name", label: "名前", multiline: false },
  { key: "furigana", label: "ふりがな", multiline: false },
  { key: "company", label: "会社・屋号", multiline: false },
  { key: "title", label: "業種・肩書き", multiline: true, hint: "キャッチコピーも一緒に書けます" },
  { key: "oneononeDate", label: "1to1した日", multiline: false },
  { key: "expertise", label: "専門・強み", multiline: true },
  { key: "wantedReferrals", label: "紹介してほしい相手（理想のお客様）", multiline: true },
  { key: "personality", label: "人柄・話題メモ", multiline: true },
  { key: "contactInfo", label: "連絡手段", multiline: true },
];

export const EMPTY_FIELDS: ProfileSheetFields = {
  name: "", furigana: "", company: "", title: "", oneononeDate: "",
  expertise: "", wantedReferrals: "", personality: "", contactInfo: "", tags: [],
};

export function sheetToFields(s: ProfileSheet | null | undefined, fallbackName = ""): ProfileSheetFields {
  if (!s) return { ...EMPTY_FIELDS, name: fallbackName };
  const { name, furigana, company, title, oneononeDate, expertise, wantedReferrals, personality, contactInfo, tags } = s;
  return { name, furigana, company, title, oneononeDate, expertise, wantedReferrals, personality, contactInfo, tags };
}

export const sheetKey = (type: ProfileSheetSubjectType, id: string) => ["profile-sheet", type, id] as const;
export const sheetIndexKey = (type: ProfileSheetSubjectType) => ["profile-sheet", "index", type] as const;

export function useProfileSheet(type: ProfileSheetSubjectType, id: string) {
  return useQuery({
    queryKey: sheetKey(type, id),
    queryFn: () => api.get<{ data: ProfileSheet | null }>(`/profile-sheets?subjectType=${type}&subjectId=${encodeURIComponent(id)}`),
    select: (r) => r.data,
  });
}

/** シートを登録済みの相手のID一覧（一覧に「シートあり」の印を出すため） */
export function useSheetIndex(type: ProfileSheetSubjectType) {
  return useQuery({
    queryKey: sheetIndexKey(type),
    queryFn: () => api.get<{ data: string[] }>(`/profile-sheets/index?subjectType=${type}`),
    select: (r) => new Set(r.data),
  });
}

/** 一覧の検索用：相手のIDごとの、自分のメモの検索用テキスト（専門・強み・紹介してほしい相手・人柄・タグ） */
export function useSheetSearchText(type: ProfileSheetSubjectType) {
  return useQuery({
    queryKey: ["profile-sheet", "search-index", type],
    queryFn: () => api.get<{ data: Record<string, string> }>(`/profile-sheets/search-index?subjectType=${type}`),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}

export function useSaveSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, fields }: { type: ProfileSheetSubjectType; id: string; fields: ProfileSheetFields }) =>
      api.put<{ data: ProfileSheet }>("/profile-sheets", { subjectType: type, subjectId: id, fields }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: sheetKey(v.type, v.id) });
      qc.invalidateQueries({ queryKey: sheetIndexKey(v.type) });
    },
  });
}

export function useDeleteSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id }: { type: ProfileSheetSubjectType; id: string }) =>
      api.delete(`/profile-sheets?subjectType=${type}&subjectId=${encodeURIComponent(id)}`),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: sheetKey(v.type, v.id) });
      qc.invalidateQueries({ queryKey: sheetIndexKey(v.type) });
    },
  });
}

/** 資料のファイルを、AIで項目に読み取る（保存はしない） */
export async function extractSheet(file: File, subject: { type: ProfileSheetSubjectType; id: string } | { hintName?: string }): Promise<ProfileSheetFields> {
  const form = new FormData();
  form.append("file", file);
  if ("type" in subject) { form.append("subjectType", subject.type); form.append("subjectId", subject.id); }
  else if (subject.hintName) form.append("hintName", subject.hintName);
  const res = await api.upload<{ data: ProfileSheetFields }>("/profile-sheets/extract", form);
  return res.data;
}

export const SHEET_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,application/pdf,image/*,text/plain";
export const SHEET_FILE_MAX_MB = 10;

export function tagsToText(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(" ");
}

export function textToTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,、，;；]+/)) {
    const t = raw.replace(/^[#＃]+/, "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 20);
}

/** 今日の日付を "YYYY-MM-DD" で（指定のタイムゾーンで）。クリックなど、操作のときに呼ぶ */
export function todayIso(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** 登録した人脈に、取り込んだ資料のメモを保存する。失敗しても人脈の登録は取り消さない（成功したかを返す） */
export async function saveDeferredSheet(contactId: string, fields: ProfileSheetFields | null): Promise<boolean> {
  if (!fields) return true;
  try {
    await api.put("/profile-sheets", { subjectType: "contact", subjectId: contactId, fields });
    return true;
  } catch {
    return false;
  }
}
