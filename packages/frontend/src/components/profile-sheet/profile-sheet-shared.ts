// =============================================================
// 相手の紹介シート（略歴シート・GAINSシート・1to1シートの内容）の共通部分
//   ・登録した本人だけが見られる（他のメンバーには見えない）
// =============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProfileSheet, ProfileSheetFields, ProfileSheetLinksResponse, ProfileSheetSubjectType } from "@shared/types";

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
  { key: "impression", label: "自分から見た印象", multiline: true, hint: "1to1をしてみての印象・感想（あなただけのメモです）" },
  { key: "contactInfo", label: "連絡手段", multiline: true },
  { key: "supplement", label: "補足情報（議事メモなど）", multiline: true, hint: "決まった項目に入らない内容（話した内容・宿題・次の一手など）" },
];

export const EMPTY_FIELDS: ProfileSheetFields = {
  name: "", furigana: "", company: "", title: "", oneononeDate: "",
  expertise: "", wantedReferrals: "", personality: "", contactInfo: "", tags: [],
  impression: "", supplement: "", companyUrl: "", companyDescription: "",
};

export function sheetToFields(s: ProfileSheet | null | undefined, fallbackName = ""): ProfileSheetFields {
  if (!s) return { ...EMPTY_FIELDS, name: fallbackName };
  const { name, furigana, company, title, oneononeDate, expertise, wantedReferrals, personality, contactInfo, tags, impression, supplement, companyUrl, companyDescription } = s;
  return { name, furigana, company, title, oneononeDate, expertise, wantedReferrals, personality, contactInfo, tags, impression, supplement, companyUrl, companyDescription };
}

export const sheetKey = (type: ProfileSheetSubjectType, id: string) => ["profile-sheet", type, id] as const;
export const sheetIndexKey = (type: ProfileSheetSubjectType) => ["profile-sheet", "index", type] as const;

export function useProfileSheet(type: ProfileSheetSubjectType, id: string) {
  return useQuery({
    queryKey: sheetKey(type, id),
    queryFn: () => api.get<{ data: ProfileSheet | null }>(`/profile-sheets?subjectType=${type}&subjectId=${encodeURIComponent(id)}`),
    select: (r) => r.data,
    // 会社のホームページ・事業内容を自動取得しているあいだは、数秒おきに見に行く
    refetchInterval: (q) => (q.state.data?.data?.companyLookupStatus === "pending" ? 4000 : false),
  });
}

/** 会社のホームページ・事業内容を、もう一度自動取得する */
export function useCompanyLookup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id }: { type: ProfileSheetSubjectType; id: string }) =>
      api.post<{ data: ProfileSheet | null }>("/profile-sheets/company-lookup", { subjectType: type, subjectId: id }),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: sheetKey(v.type, v.id) }); },
  });
}

// ---- 紹介できそうな人 ----
export const linksKey = (type: ProfileSheetSubjectType, id: string) => ["profile-sheet", "links", type, id] as const;

export function useSheetLinks(type: ProfileSheetSubjectType, id: string) {
  return useQuery({
    queryKey: linksKey(type, id),
    queryFn: () => api.get<{ data: ProfileSheetLinksResponse }>(`/profile-sheets/links?subjectType=${type}&subjectId=${encodeURIComponent(id)}`),
    select: (r) => r.data,
    // AIがさがしているあいだは、数秒おきに見に行く
    refetchInterval: (q) => (q.state.data?.data?.run?.status === "running" ? 4000 : false),
  });
}

export function useStartMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id }: { type: ProfileSheetSubjectType; id: string }) =>
      api.post<{ data: ProfileSheetLinksResponse }>("/profile-sheets/match", { subjectType: type, subjectId: id }),
    onSuccess: (r, v) => { qc.setQueryData(linksKey(v.type, v.id), r); },
  });
}

export function useAddLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, targetId }: { type: ProfileSheetSubjectType; id: string; targetId: string }) =>
      api.post<{ data: ProfileSheetLinksResponse }>("/profile-sheets/links", { subjectType: type, subjectId: id, targetId }),
    onSuccess: (r, v) => { qc.setQueryData(linksKey(v.type, v.id), r); },
  });
}

export function useToggleLinkStar(type: ProfileSheetSubjectType, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, starred }: { linkId: string; starred: boolean }) => api.patch(`/profile-sheets/links/${linkId}`, { starred }),
    onSettled: () => { qc.invalidateQueries({ queryKey: linksKey(type, id) }); },
  });
}

export function useRemoveLink(type: ProfileSheetSubjectType, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => api.delete(`/profile-sheets/links/${linkId}`),
    onSettled: () => { qc.invalidateQueries({ queryKey: linksKey(type, id) }); },
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
export async function extractSheet(
  file: File, subject: { type: ProfileSheetSubjectType; id: string } | { hintName?: string }, opts: { memo?: boolean } = {},
): Promise<ProfileSheetFields> {
  const form = new FormData();
  form.append("file", file);
  if (opts.memo) form.append("memo", "1");
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

/** 複数行の項目に、新しい内容を足す（すでに同じ行があれば足さない） */
function appendLines(base: string, next: string): string {
  if (!next.trim()) return base;
  if (!base.trim()) return next;
  const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();
  const have = new Set(base.split(/\r?\n/).map(norm).filter(Boolean));
  const add = next.split(/\r?\n/).filter((l) => l.trim() && !have.has(norm(l)));
  return add.length > 0 ? `${base.replace(/\s+$/, "")}\n${add.join("\n")}` : base;
}

/**
 * 内容を足し合わせる（「追加情報として読み込む」と、複数の資料をまとめるときに使う）
 *   ・1行の項目（名前・ふりがな・会社・日付）：すでに入っていればそのまま、空なら新しい内容で埋める
 *   ・複数行の項目：新しい内容を後ろに足す（同じ行は足さない）
 *   ・タグ：重ねて、重複はまとめる
 */
export function combineFields(base: ProfileSheetFields, next: ProfileSheetFields): ProfileSheetFields {
  const out: ProfileSheetFields = { ...base };
  for (const f of SHEET_FIELDS) {
    out[f.key] = f.multiline ? appendLines(base[f.key], next[f.key]) : (base[f.key].trim() ? base[f.key] : next[f.key]);
  }
  if (!base.companyUrl.trim()) out.companyUrl = next.companyUrl;
  if (!base.companyDescription.trim()) out.companyDescription = next.companyDescription;
  const seen = new Set<string>();
  out.tags = [...base.tags, ...next.tags].filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20);
  return out;
}

/** 名前・日付以外に、内容が入っているか */
export function hasSheetContent(f: ProfileSheetFields): boolean {
  return SHEET_FIELDS.some((x) => x.key !== "name" && x.key !== "oneononeDate" && f[x.key].trim()) || f.tags.length > 0;
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
