// =============================================================
// 外部人脈タブ（なかま画面内）
// CSVインポート（汎用フォーマット / Eightエクスポート形式）・自分の人脈一覧・
// 受け取った紹介依頼一覧
// 連絡先情報（メール・電話・住所・SNS）はそもそも保存しない設計。
// =============================================================
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { matchesSearchQuery } from "@/lib/contact-search";

type Visibility = "private" | "existence" | "full";
type BusinessSummaryStatus = "pending" | "processing" | "done" | "not_found" | "skipped" | "error";
type Contact = {
  id: string;
  name: string;
  specialty: string | null;
  company: string | null;
  relationships: string[];
  note: string | null;
  visibility: Visibility;
  source: string;
  createdAt: number;
  businessSummary: string | null;
  businessSummaryDetail: string | null;
  businessSummaryStatus: BusinessSummaryStatus;
};

// 会社概要の生成状況を一覧で見分けるためのバッジ（一括生成の対象選びに使う。生成済みも含め常に状態を表示する）
function summaryStatusBadge(ct: Contact): { label: string; bg: string; color: string } {
  if (ct.businessSummary) return { label: "✅ 会社概要：あり", bg: "rgba(90,140,92,0.14)", color: "var(--color-success)" };
  if (!ct.company) return { label: "✏️ 会社概要：会社名未入力", bg: "var(--color-paper-300)", color: "var(--color-ink-600)" };
  switch (ct.businessSummaryStatus) {
    case "processing":
      return { label: "⏳ 会社概要：生成中…", bg: "rgba(212,160,59,0.18)", color: "var(--color-accent)" };
    case "not_found":
      return { label: "❓ 会社概要：見つからず（要手入力）", bg: "rgba(181,56,75,0.12)", color: "var(--color-brand)" };
    case "error":
      return { label: "❗ 会社概要：生成エラー（要手入力）", bg: "rgba(181,56,75,0.12)", color: "var(--color-brand)" };
    default:
      return { label: "⚠️ 会社概要：未生成", bg: "rgba(212,160,59,0.18)", color: "var(--color-accent)" };
  }
}

const EXTERNAL_CONTACTS_LIMIT = 300;
const BULK_SUMMARY_LIMIT = 20;

// 公開レベルごとの色分け（詳細まで公開＝開いている＝エメラルド、存在まで公開＝控えめな金、非公開＝閉じている＝グレー）
const VISIBILITY_STYLE: Record<Visibility, { bg: string; border: string; badgeBg: string; badgeColor: string }> = {
  full:      { bg: "rgba(90,140,92,0.10)",   border: "var(--color-success)", badgeBg: "rgba(90,140,92,0.18)",   badgeColor: "var(--color-success)" },
  existence: { bg: "rgba(212,160,59,0.10)",  border: "var(--color-accent)",  badgeBg: "rgba(212,160,59,0.18)",  badgeColor: "var(--color-accent)" },
  private:   { bg: "var(--color-paper-200)", border: "var(--color-ink-400)", badgeBg: "var(--color-paper-300)", badgeColor: "var(--color-ink-600)" },
};

// 公開レベルの並び順（詳細まで公開 → 存在まで公開 → 非公開）
const VISIBILITY_RANK: Record<Visibility, number> = { full: 0, existence: 1, private: 2 };

type ContactSortOrder = "newest" | "oldest" | "visibility";
const CONTACT_SORT_LABEL: Record<ContactSortOrder, string> = {
  newest: "登録日時（新しい順）",
  oldest: "登録日時（古い順）",
  visibility: "公開レベル順",
};
function sortContacts(list: Contact[], order: ContactSortOrder): Contact[] {
  const sorted = [...list];
  if (order === "newest") sorted.sort((a, b) => b.createdAt - a.createdAt);
  else if (order === "oldest") sorted.sort((a, b) => a.createdAt - b.createdAt);
  else sorted.sort((a, b) => VISIBILITY_RANK[a.visibility] - VISIBILITY_RANK[b.visibility] || b.createdAt - a.createdAt);
  return sorted;
}

type IntroRequest = {
  id: string;
  status: "pending" | "handled";
  message: string | null;
  createdAt: number;
  contactName: string;
  requester: { id: string; name: string; emoji: string; bgColor: string } | null;
};

const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: "🔒 非公開（自分だけ）",
  existence: "🌫️ 存在のみ公開（詳細は非公開）",
  full: "📖 詳細まで公開（連絡先は非公開）",
};

type MappedField = "name" | "specialty" | "company" | "note";
const GENERIC_HINTS: Record<MappedField, string[]> = {
  name: ["名前", "氏名", "お名前"],
  specialty: ["専門分野", "専門", "業種"],
  company: ["会社名", "屋号", "会社", "組織"],
  note: ["備考", "関係性", "メモ"],
};

const SPECIALTY_DATALIST_ID = "external-contacts-specialty-options";
const RELATIONSHIP_DATALIST_ID = "external-contacts-relationship-options";

/** UTF-8として読み、文字化け（置換文字）が多ければShift-JISとして読み直す */
async function decodeFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const brokenCount = (utf8.match(/�/g) ?? []).length;
  if (brokenCount > 0) {
    try {
      return new TextDecoder("shift_jis" as never).decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/** カンマ／タブ区切り・引用符対応の簡易パーサー */
function parseDelimited(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^﻿/, "");
  const firstLine = normalized.split("\n")[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Eightのエクスポートファイルは本文の前に「◯件生成されました」等の説明行が
 * 数行入っており、そのままだと1行目をヘッダーと誤認してしまう。
 * 「会社名」と「氏名/名前/姓」を含む行を実際のヘッダー行とみなして、それより前を捨てる。
 */
function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    const hasCompany = row.some((c) => c.includes("会社名"));
    const hasName = row.some((c) => c.includes("氏名") || c.includes("名前") || c === "姓");
    if (hasCompany && hasName) return i;
  }
  return 0;
}

const COMBINED_NAME_HEADER = "氏名結合（姓+名）";

/** Eight形式で姓・名が別列の場合、結合した仮想列を追加する */
function synthesizeEightName(head: string[], body: string[][]): { head: string[]; body: string[][] } {
  const seiIdx = head.indexOf("姓");
  const meiIdx = head.indexOf("名");
  if (seiIdx < 0 || meiIdx < 0) return { head, body };
  const newHead = [...head, COMBINED_NAME_HEADER];
  const newBody = body.map((r) => [...r, `${(r[seiIdx] ?? "").trim()} ${(r[meiIdx] ?? "").trim()}`.trim()]);
  return { head: newHead, body: newBody };
}

function guessMapping(headers: string[], format: "generic" | "eight"): Record<MappedField, string | null> {
  const find = (hints: string[]) => headers.find((h) => hints.some((hint) => h.includes(hint))) ?? null;
  if (format === "eight") {
    return {
      name: headers.includes(COMBINED_NAME_HEADER) ? COMBINED_NAME_HEADER : find(["氏名", "名前"]),
      // Eight形式には「専門分野」に相当する列がそもそもないため、役職などを安易に流用せず
      // 空欄のままにする（会社名や独自タグ列からの推定は取り込み時のレビュー画面で行う）
      specialty: null,
      company: find(["会社名", "会社"]),
      note: find(["部署名", "部署"]),
    };
  }
  return {
    name: find(GENERIC_HINTS.name),
    specialty: find(GENERIC_HINTS.specialty),
    company: find(GENERIC_HINTS.company),
    note: find(GENERIC_HINTS.note),
  };
}

// ---------------------------------------------------------------
// 専門分野の提案（空欄・表記揺れの解消）
// ---------------------------------------------------------------

/** これまでの人脈データ整理で実際に使ってきた業種カテゴリ一覧（新規インポート時の統一候補） */
const CANONICAL_SPECIALTIES = [
  "システム開発", "ITプロダクト", "ITサービス", "ITコンサルタント", "通信事業", "通信機器",
  "経営コンサルタント", "HRコンサルタント", "人材サービス", "建設・不動産", "商社", "メディア",
  "団体・組合", "金融・保険", "医療・ヘルスケア", "小売", "その他サービス", "広告・マーケティング",
  "教育・研修", "官公庁・自治体", "冠婚葬祭", "飲食", "美容・健康", "エネルギー・環境",
  "運輸・物流", "流通", "弁護士", "会計士・税理士", "社会保険労務士", "行政書士", "弁理士",
  "司法書士", "中小企業診断士", "機械・電機メーカー", "製造業（その他）",
];

/** 会社名・タグ名などのテキストから業種を推定するための簡易キーワード辞書（上から優先） */
const SPECIALTY_KEYWORD_RULES: { keywords: string[]; label: string }[] = [
  { keywords: ["法律事務所", "弁護士法人", "弁護士"], label: "弁護士" },
  { keywords: ["社会保険労務士", "社労士"], label: "社会保険労務士" },
  { keywords: ["司法書士"], label: "司法書士" },
  { keywords: ["行政書士"], label: "行政書士" },
  { keywords: ["弁理士", "特許事務所", "商標"], label: "弁理士" },
  { keywords: ["会計士", "税理士", "会計事務所"], label: "会計士・税理士" },
  { keywords: ["中小企業診断士"], label: "中小企業診断士" },
  { keywords: ["ITコンサル"], label: "ITコンサルタント" },
  { keywords: ["HRコンサル", "人事コンサル"], label: "HRコンサルタント" },
  { keywords: ["経営コンサル", "コンサルティング", "コンサルタント"], label: "経営コンサルタント" },
  { keywords: ["不動産", "建設", "工務店", "リフォーム"], label: "建設・不動産" },
  { keywords: ["システム", "ソフトウェア", "ソフト開発", "エンジニアリング", "SE"], label: "システム開発" },
  { keywords: ["人材", "採用", "派遣"], label: "人材サービス" },
  { keywords: ["広告", "マーケティング", "宣伝", "PR"], label: "広告・マーケティング" },
  { keywords: ["保険", "金融", "銀行", "証券"], label: "金融・保険" },
  { keywords: ["医療", "クリニック", "病院", "ヘルスケア", "介護"], label: "医療・ヘルスケア" },
  { keywords: ["商社"], label: "商社" },
  { keywords: ["通信"], label: "通信事業" },
  { keywords: ["メディア", "出版", "放送", "新聞"], label: "メディア" },
  { keywords: ["教育", "研修", "スクール", "塾"], label: "教育・研修" },
  { keywords: ["飲食", "レストラン", "カフェ"], label: "飲食" },
  { keywords: ["美容", "エステ", "サロン"], label: "美容・健康" },
  { keywords: ["冠婚葬祭", "結婚式", "葬儀"], label: "冠婚葬祭" },
  { keywords: ["運輸", "物流", "配送", "輸送"], label: "運輸・物流" },
  { keywords: ["機械", "電機", "精密機器"], label: "機械・電機メーカー" },
  { keywords: ["製造", "工業"], label: "製造業（その他）" },
  { keywords: ["官公庁", "自治体", "役所"], label: "官公庁・自治体" },
  { keywords: ["組合", "協会", "団体"], label: "団体・組合" },
  { keywords: ["エネルギー", "環境"], label: "エネルギー・環境" },
  { keywords: ["卸売", "流通"], label: "流通" },
  { keywords: ["小売", "店舗"], label: "小売" },
];

/** 全角/半角・記号・空白の表記ゆれを吸収して比較するための正規化 */
function normalizeForCompare(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・･/／、,.]/g, "");
}

/** 既存の業種候補（自分の過去データ＋定番カテゴリ）の中から、表記ゆれを吸収して一致するものを探す */
function findCanonicalMatch(raw: string, canonicalPool: string[]): string | null {
  const target = normalizeForCompare(raw);
  if (!target) return null;
  for (const c of canonicalPool) {
    if (normalizeForCompare(c) === target) return c;
  }
  for (const c of canonicalPool) {
    const nc = normalizeForCompare(c);
    if (nc.length >= 2 && (target.includes(nc) || nc.includes(target))) return c;
  }
  return null;
}

/** 会社名やEightのタグ列名などのテキストから、キーワード辞書で業種を推定する */
function keywordGuess(text: string): string | null {
  if (!text) return null;
  for (const rule of SPECIALTY_KEYWORD_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.label;
  }
  return null;
}

type SpecialtySuggestion = { suggestion: string; needsReview: boolean };

/**
 * 専門分野の提案を1件分計算する。
 * - 元の値が候補一覧と（表記ゆれを吸収して）一致していればそのまま採用（レビュー不要）
 * - 元の値が空欄、または候補一覧に見当たらない場合は、会社名やタグのキーワードから推定して提案する
 */
function suggestSpecialty(
  raw: string,
  context: { company: string; tagHints: string[] },
  canonicalPool: string[]
): SpecialtySuggestion {
  if (raw) {
    const match = findCanonicalMatch(raw, canonicalPool);
    if (match) return { suggestion: match, needsReview: normalizeForCompare(match) !== normalizeForCompare(raw) };
    return { suggestion: raw, needsReview: true };
  }
  const fromCompany = keywordGuess(context.company);
  if (fromCompany) return { suggestion: fromCompany, needsReview: true };
  for (const tag of context.tagHints) {
    const fromTag = keywordGuess(tag);
    if (fromTag) return { suggestion: fromTag, needsReview: true };
  }
  return { suggestion: "", needsReview: true };
}

/** 自分がこれまでに使った専門分野＋定番カテゴリを合わせた候補一覧（表記統一のためのdatalistに使う） */
function useSpecialtyOptions(): string[] {
  const { data } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
  });
  return useMemo(() => {
    const mine = (data?.data ?? []).map((c) => c.specialty).filter((s): s is string => !!s);
    return [...new Set([...CANONICAL_SPECIALTIES, ...mine])].sort((a, b) => a.localeCompare(b, "ja"));
  }, [data]);
}

/** 自分がこれまでに使った関係性の一覧（表記統一のためのdatalistに使う。専門分野と違い定番一覧は持たず、実際に使った値のみ候補にする） */
function useRelationshipOptions(): string[] {
  const { data } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
  });
  return useMemo(() => {
    const mine = (data?.data ?? []).flatMap((c) => c.relationships);
    return [...new Set(mine)].sort((a, b) => a.localeCompare(b, "ja"));
  }, [data]);
}

export function ExternalContactsTab() {
  const specialtyOptions = useSpecialtyOptions();
  const relationshipOptions = useRelationshipOptions();

  return (
    <div>
      {/* 専門分野の入力候補（各セクションの specialty 入力から list="…" で共通参照する） */}
      <datalist id={SPECIALTY_DATALIST_ID}>
        {specialtyOptions.map((s) => <option key={s} value={s} />)}
      </datalist>
      {/* 関係性の入力候補（各セクションの relationship 入力から list="…" で共通参照する） */}
      <datalist id={RELATIONSHIP_DATALIST_ID}>
        {relationshipOptions.map((s) => <option key={s} value={s} />)}
      </datalist>

      <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
        Eightなどで交換した名刺情報を取り込んで、協働マップの人脈レイヤーに表示します。メール・電話番号・住所・SNSなどの連絡先は保存されません。
      </p>

      <ManualAddSection />
      <ImportSection />
      <IntroRequestsSection />
      <MyContactsSection />
    </div>
  );
}

/** 会社概要（一覧表示用の一言概要・詳細）の入力欄＋「AIで生成」ボタン。1件登録フォーム・編集モーダルで共用する */
function BusinessSummaryFields({
  company, name, summary, setSummary, detail, setDetail,
}: {
  company: string;
  name: string;
  summary: string;
  setSummary: (v: string) => void;
  detail: string;
  setDetail: (v: string) => void;
}) {
  const [genError, setGenError] = useState("");

  const generate = useMutation({
    mutationFn: () => api.post<{ data: { status: "done" | "not_found" | "error"; summary: string | null; detail: string | null } }>(
      "/collab/contacts/generate-summary-preview", { company: company.trim(), name: name.trim() }
    ),
    onSuccess: (res) => {
      if (res.data.status === "done") {
        setGenError("");
        setSummary(res.data.summary ?? "");
        setDetail(res.data.detail ?? "");
      } else {
        setGenError("会社概要が見つかりませんでした。お手数ですが手入力をお願いします。");
      }
    },
    onError: (e: Error) => setGenError(e.message || "生成に失敗しました"),
  });

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>
          会社概要（人脈をさがす一覧に出る一言概要）
        </label>
        <button type="button" onClick={() => generate.mutate()} disabled={generate.isPending || !company.trim()}
          className="text-xs px-2.5 py-1 rounded-full font-medium disabled:opacity-50 shrink-0"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          {generate.isPending ? "生成中…" : "🤖 AIで生成"}
        </button>
      </div>
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="例: ふるさと納税ポータルサイトの運営"
        className="w-full px-3 py-2 rounded-xl border text-sm mb-1" style={{ borderColor: "var(--color-paper-300)" }} />
      {!company.trim() && (
        <p className="text-[11px] mb-2" style={{ color: "var(--color-ink-400)" }}>AIで生成するには、先に会社名/屋号を入力してください</p>
      )}
      {genError && <p className="text-[11px] mb-2" style={{ color: "var(--color-brand)" }}>{genError}</p>}

      <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>会社概要（詳細）</label>
      <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3}
        placeholder="「もっと詳しく見る」で表示される説明文（任意）"
        className="w-full px-3 py-2 rounded-xl border text-sm mb-3 resize-none" style={{ borderColor: "var(--color-paper-300)" }} />
    </>
  );
}

/**
 * 関係性の複数選択入力（例: BNIであり倫理法人会でもある、のように複数の所属を持てる）。
 * チップとして追加済みの関係性を表示し、候補から選ぶか新規入力してEnter/追加ボタンで追加できる。
 * 1件登録フォーム・編集モーダルで共用する。
 */
function RelationshipTagsInput({ relationships, setRelationships }: {
  relationships: string[];
  setRelationships: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addTag() {
    const v = draft.trim();
    if (!v) return;
    if (!relationships.includes(v)) setRelationships([...relationships, v]);
    setDraft("");
  }
  function removeTag(tag: string) {
    setRelationships(relationships.filter((r) => r !== tag));
  }

  return (
    <>
      <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>関係性</label>
      {relationships.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {relationships.map((r) => (
            <span key={r} className="text-xs pl-2.5 pr-1 py-1 rounded-full font-medium flex items-center gap-1"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
              {r}
              <button type="button" onClick={() => removeTag(r)} aria-label={`${r}を削除`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5 mb-1">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          list={RELATIONSHIP_DATALIST_ID} placeholder="例: BNI"
          className="flex-1 min-w-0 px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
        <button type="button" onClick={addTag}
          className="text-xs px-3 py-2 rounded-xl font-medium shrink-0"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          追加
        </button>
      </div>
      <p className="text-[11px] mb-3" style={{ color: "var(--color-ink-400)" }}>
        候補から選ぶか、新しい関係性を入力してEnterまたは「追加」で加えられます（複数追加可）
      </p>
    </>
  );
}

function ManualAddSection() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [company, setCompany] = useState("");
  const [relationships, setRelationships] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("existence");
  const [businessSummary, setBusinessSummary] = useState("");
  const [businessSummaryDetail, setBusinessSummaryDetail] = useState("");
  const [error, setError] = useState("");

  const { data: contactsData } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
  });
  // 登録上限は非公開を除いた件数で判定する（非公開はメモ用途のため上限に含めない）
  const nonPrivateCount = (contactsData?.data ?? []).filter((c) => c.visibility !== "private").length;
  const atLimit = nonPrivateCount >= EXTERNAL_CONTACTS_LIMIT;

  const create = useMutation({
    mutationFn: () => api.post("/collab/contacts", {
      name: name.trim(), specialty: specialty.trim() || undefined, company: company.trim() || undefined,
      relationships, note: note.trim() || undefined, visibility,
      businessSummary: businessSummary.trim() || undefined, businessSummaryDetail: businessSummaryDetail.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "contacts"] });
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
      setName(""); setSpecialty(""); setCompany(""); setRelationships([]); setNote(""); setVisibility("existence");
      setBusinessSummary(""); setBusinessSummaryDetail("");
      setOpen(false);
    },
    onError: (e: Error) => setError(e.message || "登録に失敗しました"),
  });

  function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("名前を入力してください"); return; }
    create.mutate();
  }

  return (
    <div className="card-paper p-4 mb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
          ✍️ 1件ずつ登録する
        </h2>
        <button onClick={() => setOpen((v) => !v)} disabled={atLimit && !open}
          className="text-xs px-3 py-1.5 rounded-full font-medium disabled:opacity-50"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          {open ? "閉じる" : "＋ 人脈を登録"}
        </button>
      </div>

      {atLimit && !open && (
        <p className="text-xs mt-2" style={{ color: "var(--color-brand)" }}>
          登録できる人脈は非公開を除いて{EXTERNAL_CONTACTS_LIMIT}件までです。新しく登録するには、既存の人脈を削除するか、非公開に変更してください。
        </p>
      )}

      {open && (
        <div className="mt-3">
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>名前 *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 高橋 健一"
            className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>専門分野</label>
          <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="例: 税務相談"
            list={SPECIALTY_DATALIST_ID}
            className="w-full px-3 py-2 rounded-xl border text-sm mb-1" style={{ borderColor: "var(--color-paper-300)" }} />
          <p className="text-[11px] mb-3" style={{ color: "var(--color-ink-400)" }}>
            候補から選ぶか、なければ新しい専門分野をそのまま入力してください
          </p>

          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>会社名/屋号</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="例: 高橋会計事務所"
            className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

          <BusinessSummaryFields company={company} name={name} summary={businessSummary} setSummary={setBusinessSummary}
            detail={businessSummaryDetail} setDetail={setBusinessSummaryDetail} />

          <RelationshipTagsInput relationships={relationships} setRelationships={setRelationships} />

          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>備考</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 展示会で名刺交換"
            className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>公開範囲</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}
            className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
            {(["existence", "private", "full"] as Visibility[]).map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
          </select>

          {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

          <button onClick={handleSubmit} disabled={create.isPending}
            className="w-full py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            登録する
          </button>
        </div>
      )}
    </div>
  );
}

function ImportSection() {
  const qc = useQueryClient();
  const [format, setFormat] = useState<"generic" | "eight">("generic");
  const [defaultVisibility, setDefaultVisibility] = useState<Visibility>("existence");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<MappedField, string | null>>({ name: null, specialty: null, company: null, note: null });
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [specialtyDrafts, setSpecialtyDrafts] = useState<{ value: string; apply: boolean; needsReview: boolean }[]>([]);

  const { data: existingContactsData } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
  });

  async function handleFile(file: File) {
    setError("");
    setFileName(file.name);
    try {
      const text = await decodeFile(file);
      const parsed = parseDelimited(text);
      if (parsed.length < 2) { setError("データ行が見つかりませんでした"); return; }
      // Eightのエクスポートは冒頭に説明文が数行入っているため、実際のヘッダー行を探して読み飛ばす
      const headerIdx = format === "eight" ? findHeaderRowIndex(parsed) : 0;
      const [rawHead, ...rawBody] = parsed.slice(headerIdx);
      if (rawBody.length === 0) { setError("データ行が見つかりませんでした"); return; }
      const { head, body } = format === "eight" ? synthesizeEightName(rawHead, rawBody) : { head: rawHead, body: rawBody };
      setHeaders(head);
      setRows(body);
      setMapping(guessMapping(head, format));
    } catch {
      setError("ファイルを読み込めませんでした");
    }
  }

  function colIndex(header: string | null): number {
    return header ? headers.indexOf(header) : -1;
  }

  const mappedRows = useMemo(() => {
    const ni = colIndex(mapping.name), si = colIndex(mapping.specialty), ci = colIndex(mapping.company), noi = colIndex(mapping.note);
    const mappedIdx = new Set([ni, si, ci, noi].filter((i) => i >= 0));
    return rows
      .map((r) => ({
        name: ni >= 0 ? (r[ni] ?? "").trim() : "",
        specialty: si >= 0 ? (r[si] ?? "").trim() : "",
        company: ci >= 0 ? (r[ci] ?? "").trim() : "",
        note: noi >= 0 ? (r[noi] ?? "").trim() : "",
        // マッピングに使っていない列で値が入っているもの（Eightの独自タグ列など）を専門分野推定のヒントにする
        tagHints: headers.filter((_, i) => !mappedIdx.has(i) && (r[i] ?? "").trim()),
      }))
      .filter((r) => r.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mapping, headers]);

  const canonicalPool = useMemo(() => {
    const mine = (existingContactsData?.data ?? []).map((c) => c.specialty).filter((s): s is string => !!s);
    return [...new Set([...CANONICAL_SPECIALTIES, ...mine])];
  }, [existingContactsData]);

  // ファイル・マッピングが変わるたびに、専門分野の提案を作り直す
  useEffect(() => {
    setSpecialtyDrafts(mappedRows.map((r) => {
      const { suggestion, needsReview } = suggestSpecialty(r.specialty, { company: r.company, tagHints: r.tagHints }, canonicalPool);
      return { value: suggestion, apply: true, needsReview };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedRows]);

  const finalRows = useMemo(
    () => mappedRows.map((r, i) => ({
      name: r.name,
      company: r.company,
      note: r.note,
      specialty: specialtyDrafts[i]?.apply ? (specialtyDrafts[i]?.value ?? "") : r.specialty,
    })),
    [mappedRows, specialtyDrafts]
  );

  const reviewIndices = useMemo(
    () => specialtyDrafts.map((d, i) => (d.needsReview ? i : -1)).filter((i) => i >= 0),
    [specialtyDrafts]
  );

  function updateDraft(i: number, patch: Partial<{ value: string; apply: boolean }>) {
    setSpecialtyDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  const importMutation = useMutation({
    mutationFn: () => api.post("/collab/contacts/import", { source: format, defaultVisibility, contacts: finalRows }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "contacts"] });
      setHeaders([]); setRows([]); setFileName(""); setSpecialtyDrafts([]);
      alert(`${finalRows.length}件の人脈を取り込みました`);
    },
    onError: (e: Error) => setError(e.message || "取り込みに失敗しました"),
  });

  return (
    <div className="card-paper p-4 mb-6">
      <h2 className="text-sm font-semibold mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
        📥 CSVから取り込む
      </h2>

      <div className="flex gap-2 mb-3">
        <button onClick={() => { setFormat("generic"); if (headers.length) setMapping(guessMapping(headers, "generic")); }}
          className="flex-1 py-2 rounded-2xl text-xs font-medium transition"
          style={{ background: format === "generic" ? "var(--color-brand)" : "var(--color-paper-200)", color: format === "generic" ? "white" : "var(--color-ink-600)" }}>
          汎用フォーマット
        </button>
        <button onClick={() => { setFormat("eight"); if (headers.length) setMapping(guessMapping(headers, "eight")); }}
          className="flex-1 py-2 rounded-2xl text-xs font-medium transition"
          style={{ background: format === "eight" ? "var(--color-brand)" : "var(--color-paper-200)", color: format === "eight" ? "white" : "var(--color-ink-600)" }}>
          Eightエクスポート形式
        </button>
      </div>

      {format === "generic" ? (
        <div className="text-xs mb-3 p-3 rounded-xl" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <p className="font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>📋 汎用フォーマットについて</p>
          <p className="mb-1.5">
            1行目に見出し（列名）が入ったCSVファイルに対応しています。次の4項目の列を用意してください（順番は自由、見出し名が多少違っても自動で認識します）。
          </p>
          <ul className="list-disc pl-4 mb-1.5 space-y-0.5">
            <li><span className="font-medium">名前</span>（必須）：例）名前 / 氏名 / お名前</li>
            <li>専門分野（任意）：例）専門分野 / 専門 / 業種</li>
            <li>会社名・屋号（任意）：例）会社名 / 屋号 / 会社 / 組織</li>
            <li>備考（任意）：例）備考 / 関係性 / メモ</li>
          </ul>
          <p>
            文字コードはUTF-8・Shift_JISのどちらでも自動判定します。区切り文字はカンマ（,）またはタブに対応しています。Excelで作成した表を「CSV UTF-8」または「CSV」形式で保存したものをそのままアップロードできます。列名が完全に一致しない場合も、アップロード後に下の「列の対応づけ」欄で手動で選び直せます。
          </p>
        </div>
      ) : (
        <div className="text-xs mb-3 p-3 rounded-xl" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-600)" }}>
          <p className="font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>⚠️ Eightからダウンロードする際の注意</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>氏名は分割せず、「氏名を統合する」を選んでください</li>
            <li>ダウンロード形式は「CSV（Shift_JIS）」を選んでください</li>
            <li>ダウンロードしたファイルはそのままアップロードできますが、Eightのエクスポートデータには「専門分野」の項目がないため、取り込み後に表示される一覧でそれぞれに合った専門分野を選択・入力してください</li>
          </ul>
        </div>
      )}

      <label className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium cursor-pointer mb-3"
        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)", border: "1px dashed var(--color-paper-300)" }}>
        <Upload size={16} />
        {fileName || "CSVファイルを選択"}
        <input type="file" accept=".csv,.txt,.tsv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </label>

      {headers.length > 0 && (
        <>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>列の対応づけ</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {(["name", "specialty", "company", "note"] as MappedField[]).map((f) => (
              <div key={f}>
                <label className="block text-[11px] mb-0.5" style={{ color: "var(--color-ink-400)" }}>
                  {f === "name" ? "名前 *" : f === "specialty" ? "専門分野" : f === "company" ? "会社名/屋号" : "備考"}
                </label>
                <select value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || null }))}
                  className="w-full px-2 py-1.5 rounded-lg border text-xs" style={{ borderColor: "var(--color-paper-300)" }}>
                  <option value="">（使用しない）</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>プレビュー（先頭5件・{finalRows.length}件を取り込み予定）</p>
          <div className="overflow-x-auto mb-3 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
            <table className="text-xs w-full">
              <thead>
                <tr style={{ color: "var(--color-ink-500)" }}>
                  <th className="text-left px-2 py-1">名前</th>
                  <th className="text-left px-2 py-1">専門分野</th>
                  <th className="text-left px-2 py-1">会社名/屋号</th>
                  <th className="text-left px-2 py-1">備考</th>
                </tr>
              </thead>
              <tbody>
                {finalRows.slice(0, 5).map((r, i) => (
                  <tr key={i} style={{ color: "var(--color-ink-700)" }}>
                    <td className="px-2 py-1">{r.name}</td>
                    <td className="px-2 py-1">{r.specialty}</td>
                    <td className="px-2 py-1">{r.company}</td>
                    <td className="px-2 py-1">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {reviewIndices.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
                専門分野をご確認ください（{reviewIndices.length}件・空欄または表記ゆれの可能性があるもの）
              </p>
              <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
                提案内容でよければチェックを入れたまま、違う場合はチェックを外すか、入力欄を直接書き換えてください（候補一覧から選ぶか、無ければ新しい専門分野をそのまま入力できます）。
              </p>
              <div className="max-h-72 overflow-y-auto rounded-xl" style={{ background: "var(--color-paper-200)" }}>
                <table className="text-xs w-full">
                  <thead>
                    <tr style={{ color: "var(--color-ink-500)" }}>
                      <th className="text-left px-2 py-1.5">名前</th>
                      <th className="text-left px-2 py-1.5">修正前</th>
                      <th className="text-left px-2 py-1.5">修正後</th>
                      <th className="text-center px-2 py-1.5">適用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewIndices.map((i) => {
                      const r = mappedRows[i];
                      const draft = specialtyDrafts[i];
                      if (!draft) return null;
                      return (
                        <tr key={i} style={{ color: "var(--color-ink-700)" }}>
                          <td className="px-2 py-1.5 whitespace-nowrap">{r.name}</td>
                          <td className="px-2 py-1.5" style={{ color: "var(--color-ink-400)" }}>{r.specialty || "（空欄）"}</td>
                          <td className="px-2 py-1.5">
                            <input value={draft.value} onChange={(e) => updateDraft(i, { value: e.target.value })}
                              list={SPECIALTY_DATALIST_ID}
                              className="w-full px-1.5 py-1 rounded border text-xs" style={{ borderColor: "var(--color-paper-300)" }} />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <input type="checkbox" checked={draft.apply} onChange={(e) => updateDraft(i, { apply: e.target.checked })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>公開範囲（あとから人脈ごとに変更できます）</label>
          <select value={defaultVisibility} onChange={(e) => setDefaultVisibility(e.target.value as Visibility)}
            className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
            {(["existence", "private", "full"] as Visibility[]).map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
          </select>

          {(() => {
            const currentCount = existingContactsData?.data.length ?? 0;
            const remainingSlots = EXTERNAL_CONTACTS_LIMIT - currentCount;
            const overLimit = finalRows.length > remainingSlots;
            return (
              <>
                {overLimit && (
                  <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>
                    外部人脈は合計{EXTERNAL_CONTACTS_LIMIT}件まで登録できます。現在{currentCount}件登録済みのため、あと{Math.max(remainingSlots, 0)}件までしか取り込めません（{finalRows.length}件を取り込もうとしています）。
                  </p>
                )}
                {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

                <button onClick={() => importMutation.mutate()} disabled={importMutation.isPending || finalRows.length === 0 || overLimit}
                  className="w-full py-3 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                  {finalRows.length}件を取り込む
                </button>
              </>
            );
          })()}
        </>
      )}
      {error && headers.length === 0 && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{error}</p>}
    </div>
  );
}

function IntroRequestsSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["collab", "contacts", "intro-requests"],
    queryFn: () => api.get<{ data: IntroRequest[] }>("/collab/contacts/intro-requests"),
  });
  const handleMutation = useMutation({
    mutationFn: (id: string) => api.post(`/collab/contacts/intro-requests/${id}/handle`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "contacts", "intro-requests"] }),
  });

  const requests = (data?.data ?? []).filter((r) => r.status === "pending");
  if (requests.length === 0) return null;

  return (
    <div className="card-paper p-4 mb-6">
      <h2 className="text-sm font-semibold mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
        🔔 届いた紹介依頼
      </h2>
      <div className="flex flex-col gap-2">
        {requests.map((r) => (
          <div key={r.id} className="p-3 rounded-xl flex items-center gap-2" style={{ background: "rgba(212,160,59,0.12)" }}>
            <div className="flex-1 min-w-0 text-sm" style={{ color: "var(--color-ink-700)" }}>
              {r.requester?.emoji} <span className="font-medium">{r.requester?.name ?? "だれか"}</span>さんが「{r.contactName}」さんの紹介を希望しています
              {r.message && <p className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>「{r.message}」</p>}
            </div>
            <button onClick={() => handleMutation.mutate(r.id)}
              className="text-xs px-3 py-1.5 rounded-full font-medium shrink-0" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
              対応しました
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MyContactsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
  });

  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPanel, setBulkPanel] = useState<"visibility" | "specialty" | "company" | "note" | "relationships" | null>(null);
  const [bulkVisibility, setBulkVisibility] = useState<Visibility>("existence");
  const [bulkSpecialty, setBulkSpecialty] = useState("");
  const [bulkCompany, setBulkCompany] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkAddRelationships, setBulkAddRelationships] = useState<string[]>([]);
  const [bulkGenerateMessage, setBulkGenerateMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSpecialties, setSelectedSpecialties] = useState<Set<string>>(new Set());
  const [selectedRelationships, setSelectedRelationships] = useState<Set<string>>(new Set());
  // ホーム画面の「会社概要を生成できませんでした」通知からのリンク（?summaryIssues=1）で開いた場合、最初から絞り込んだ状態にする
  const [summaryIssueOnly, setSummaryIssueOnly] = useState(() => searchParams.get("summaryIssues") === "1");
  const [sortOrder, setSortOrder] = useState<ContactSortOrder>("newest");
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["collab", "contacts"] });
    qc.invalidateQueries({ queryKey: ["collab", "graph"] });
  };

  const updateVisibility = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: Visibility }) => api.patch(`/collab/contacts/${id}`, { visibility }),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/collab/contacts/${id}`),
    onSuccess: invalidate,
  });
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.delete("/collab/contacts/bulk", { ids }),
    onSuccess: () => { invalidate(); setSelected(new Set()); },
  });
  const bulkUpdateMutation = useMutation({
    mutationFn: (patch: { ids: string[]; visibility?: Visibility; specialty?: string; company?: string; note?: string; addRelationships?: string[] }) =>
      api.patch("/collab/contacts/bulk", patch),
    onSuccess: () => { invalidate(); setSelected(new Set()); setBulkPanel(null); setBulkAddRelationships([]); },
  });
  const bulkGenerateMutation = useMutation({
    mutationFn: (ids: string[]) => api.post<{ data: { processed: number; skipped: number } }>("/collab/contacts/bulk/generate-summary", { ids }),
    onSuccess: (res) => {
      invalidate();
      const { processed, skipped } = res.data;
      setBulkGenerateMessage(
        skipped > 0
          ? `${processed}件の会社概要を生成しました（会社名が未入力の${skipped}件は対象外にしました）`
          : `${processed}件の会社概要を生成しました`
      );
    },
    onError: (e: Error) => setBulkGenerateMessage(e.message || "生成に失敗しました"),
  });

  const contacts = data?.data ?? [];
  // 表示件数（合計・専門分野別）は非公開の人脈を含めない。ただし一覧の行自体は
  // 管理（編集・削除・公開範囲の変更）のために非公開の人脈も引き続き表示する。
  const visibleCountContacts = useMemo(() => contacts.filter((ct) => ct.visibility !== "private"), [contacts]);

  // 専門分野・関係性は別々に複数選択でき、それぞれの選択内はOR、両者の間はANDで絞り込む
  // （例:{専門分野A or 専門分野B} and {関係性A or 関係性B}）。検索ボックスの自由入力はさらにAND。
  // 「会社概要に問題あり」はさらに別軸のANDで、生成が「見つからず」「エラー」だったものだけに絞り込む。
  function computeFilteredContacts(
    baseContacts: Contact[], q: string, specialties: Set<string>, relationships: Set<string>, issueOnly: boolean
  ): Contact[] {
    return baseContacts.filter((ct) => {
      if (issueOnly && ct.businessSummaryStatus !== "not_found" && ct.businessSummaryStatus !== "error") return false;
      if (specialties.size > 0 && (!ct.specialty || !specialties.has(ct.specialty))) return false;
      if (relationships.size > 0 && !ct.relationships.some((r) => relationships.has(r))) return false;
      if (q.trim() && !matchesSearchQuery([ct.name, ct.specialty, ct.company, ...ct.relationships], q)) return false;
      return true;
    });
  }

  const filteredContacts = useMemo(
    () => sortContacts(computeFilteredContacts(contacts, searchQuery, selectedSpecialties, selectedRelationships, summaryIssueOnly), sortOrder),
    [contacts, searchQuery, sortOrder, selectedSpecialties, selectedRelationships, summaryIssueOnly]
  );

  const specialtyTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ct of visibleCountContacts) {
      if (!ct.specialty) continue;
      counts.set(ct.specialty, (counts.get(ct.specialty) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [visibleCountContacts]);

  const relationshipTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ct of visibleCountContacts) {
      for (const r of ct.relationships) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [visibleCountContacts]);

  // 会社概要の生成に失敗した件数（非公開を除く。ホーム画面の通知件数と一致させる）
  const summaryIssueCount = useMemo(
    () => visibleCountContacts.filter((ct) => ct.businessSummaryStatus === "not_found" || ct.businessSummaryStatus === "error").length,
    [visibleCountContacts]
  );

  const hasActiveFilter = searchQuery.trim() !== "" || selectedSpecialties.size > 0 || selectedRelationships.size > 0 || summaryIssueOnly;

  // フィルタ条件が変わるたびに、一致した人脈を自動選択する（一括操作用）。
  // 手動でチェックを外した状態は、フィルタ自体を変えない限り保持される。
  function applyFilterAndAutoSelect(q: string, specialties: Set<string>, relationships: Set<string>, issueOnly: boolean) {
    if (!q.trim() && specialties.size === 0 && relationships.size === 0 && !issueOnly) { setSelected(new Set()); return; }
    const matched = computeFilteredContacts(contacts, q, specialties, relationships, issueOnly);
    setSelected(new Set(matched.map((c) => c.id)));
  }

  // ホーム画面の通知リンク（?summaryIssues=1）で開いた直後にも、絞り込み結果を自動選択しておく
  useEffect(() => {
    if (summaryIssueOnly) applyFilterAndAutoSelect(searchQuery, selectedSpecialties, selectedRelationships, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.length]);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    applyFilterAndAutoSelect(value, selectedSpecialties, selectedRelationships, summaryIssueOnly);
  }

  function toggleSpecialtyTag(tag: string) {
    setSelectedSpecialties((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      applyFilterAndAutoSelect(searchQuery, next, selectedRelationships, summaryIssueOnly);
      return next;
    });
  }

  function toggleRelationshipTag(tag: string) {
    setSelectedRelationships((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      applyFilterAndAutoSelect(searchQuery, selectedSpecialties, next, summaryIssueOnly);
      return next;
    });
  }

  function toggleSummaryIssueFilter() {
    setSummaryIssueOnly((prev) => {
      const next = !prev;
      applyFilterAndAutoSelect(searchQuery, selectedSpecialties, selectedRelationships, next);
      return next;
    });
  }

  function clearAllFilters() {
    setSearchQuery("");
    setSelectedSpecialties(new Set());
    setSelectedRelationships(new Set());
    setSummaryIssueOnly(false);
    setSelected(new Set());
  }

  const allSelected = filteredContacts.length > 0 && filteredContacts.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        for (const c of filteredContacts) next.delete(c.id);
        return next;
      }
      return new Set([...prev, ...filteredContacts.map((c) => c.id)]);
    });
  }

  return (
    <div className="card-paper p-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
          📇 自分の人脈一覧（{visibleCountContacts.length}件・非公開を除く）
        </h2>
        {filteredContacts.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-ink-500)" }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            すべて選択
          </label>
        )}
      </div>
      {visibleCountContacts.length >= EXTERNAL_CONTACTS_LIMIT ? (
        <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>
          登録できる人脈は非公開を除いて{EXTERNAL_CONTACTS_LIMIT}件までです。新しく登録するには、既存の人脈を削除するか、非公開に変更してください。
        </p>
      ) : (
        <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
          登録上限 {visibleCountContacts.length}/{EXTERNAL_CONTACTS_LIMIT}件（非公開を除く）
        </p>
      )}

      {contacts.length > 0 && (
        <div className="mb-3">
          <div className="relative mb-2">
            <input value={searchQuery} onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="🔍 名前・会社名で検索（AND/ORの検索式も使えます。例: システム開発 OR 税理士）"
              className="w-full px-3 pr-9 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
            {searchQuery && (
              <button type="button" onClick={() => handleSearchChange("")}
                aria-label="検索条件をクリア"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full"
                style={{ color: "var(--color-ink-400)" }}>
                <X size={14} />
              </button>
            )}
          </div>
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as ContactSortOrder)}
            className="px-2.5 py-1.5 rounded-full border text-xs mb-2" style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
            {(Object.keys(CONTACT_SORT_LABEL) as ContactSortOrder[]).map((o) => (
              <option key={o} value={o}>{CONTACT_SORT_LABEL[o]}</option>
            ))}
          </select>

          {specialtyTags.length > 0 && (
            <div className="mb-2">
              <p className="text-[11px] mb-1" style={{ color: "var(--color-ink-400)" }}>専門分野で絞り込み（複数選択可）</p>
              <div className="flex flex-wrap gap-1.5">
                {specialtyTags.map(([tag, count]) => {
                  const active = selectedSpecialties.has(tag);
                  return (
                    <button key={tag} onClick={() => toggleSpecialtyTag(tag)}
                      className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ background: active ? "var(--color-brand)" : "var(--color-paper-200)", color: active ? "white" : "var(--color-ink-600)" }}>
                      {tag} {count}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {relationshipTags.length > 0 && (
            <div className="mb-2">
              <p className="text-[11px] mb-1" style={{ color: "var(--color-ink-400)" }}>関係性で絞り込み（複数選択可）</p>
              <div className="flex flex-wrap gap-1.5">
                {relationshipTags.map(([tag, count]) => {
                  const active = selectedRelationships.has(tag);
                  return (
                    <button key={tag} onClick={() => toggleRelationshipTag(tag)}
                      className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ background: active ? "var(--color-accent)" : "var(--color-paper-200)", color: active ? "white" : "var(--color-ink-600)" }}>
                      {tag} {count}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {summaryIssueCount > 0 && (
            <div className="mb-2">
              <button onClick={toggleSummaryIssueFilter}
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: summaryIssueOnly ? "var(--color-brand)" : "rgba(181,56,75,0.12)", color: summaryIssueOnly ? "white" : "var(--color-brand)" }}>
                ⚠️ 会社概要に問題あり（見つからず・エラー） {summaryIssueCount}
              </button>
            </div>
          )}

          {hasActiveFilter && (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
              {filteredContacts.length}件が一致し、選択状態になっています
              {" "}
              <button type="button" onClick={clearAllFilters} className="underline" style={{ color: "var(--color-brand)" }}>
                絞り込みを解除
              </button>
            </p>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-3 p-3 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", border: "1px solid rgba(181,56,75,0.25)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium" style={{ color: "var(--color-ink-700)" }}>{selected.size}件選択中</span>
            <button onClick={() => { setSelected(new Set()); setBulkGenerateMessage(""); }} className="text-xs" style={{ color: "var(--color-ink-400)" }}>選択解除</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button
              onClick={() => { if (confirm(`選択した${selected.size}件を削除しますか？`)) bulkDeleteMutation.mutate([...selected]); }}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50"
              style={{ background: "var(--color-brand)" }}>
              <Trash2 size={12} /> まとめて削除
            </button>
            <button onClick={() => setBulkPanel(bulkPanel === "visibility" ? null : "visibility")}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ background: bulkPanel === "visibility" ? "var(--color-ink-700)" : "var(--color-paper-200)", color: bulkPanel === "visibility" ? "white" : "var(--color-ink-600)" }}>
              公開範囲を変更
            </button>
            <button onClick={() => setBulkPanel(bulkPanel === "specialty" ? null : "specialty")}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ background: bulkPanel === "specialty" ? "var(--color-ink-700)" : "var(--color-paper-200)", color: bulkPanel === "specialty" ? "white" : "var(--color-ink-600)" }}>
              業種・専門分野を変更
            </button>
            <button onClick={() => setBulkPanel(bulkPanel === "company" ? null : "company")}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ background: bulkPanel === "company" ? "var(--color-ink-700)" : "var(--color-paper-200)", color: bulkPanel === "company" ? "white" : "var(--color-ink-600)" }}>
              会社名・屋号を変更
            </button>
            <button onClick={() => setBulkPanel(bulkPanel === "note" ? null : "note")}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ background: bulkPanel === "note" ? "var(--color-ink-700)" : "var(--color-paper-200)", color: bulkPanel === "note" ? "white" : "var(--color-ink-600)" }}>
              備考を変更
            </button>
            <button onClick={() => setBulkPanel(bulkPanel === "relationships" ? null : "relationships")}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ background: bulkPanel === "relationships" ? "var(--color-ink-700)" : "var(--color-paper-200)", color: bulkPanel === "relationships" ? "white" : "var(--color-ink-600)" }}>
              関係性を追加
            </button>
            <button
              onClick={() => { setBulkGenerateMessage(""); bulkGenerateMutation.mutate([...selected]); }}
              disabled={bulkGenerateMutation.isPending || selected.size > BULK_SUMMARY_LIMIT}
              className="text-xs px-3 py-1.5 rounded-full font-medium disabled:opacity-50"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
              {bulkGenerateMutation.isPending ? "生成中…" : "🤖 AIで会社概要を一括生成"}
            </button>
          </div>
          {selected.size > BULK_SUMMARY_LIMIT && (
            <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>
              一括生成は一度に{BULK_SUMMARY_LIMIT}件までです。選択を{BULK_SUMMARY_LIMIT}件以下に減らしてください。
            </p>
          )}
          {bulkGenerateMessage && (
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-600)" }}>{bulkGenerateMessage}</p>
          )}

          {bulkPanel === "visibility" && (
            <div className="flex gap-2">
              <select value={bulkVisibility} onChange={(e) => setBulkVisibility(e.target.value as Visibility)}
                className="flex-1 px-2 py-1.5 rounded-lg border text-xs" style={{ borderColor: "var(--color-paper-300)" }}>
                {(["existence", "private", "full"] as Visibility[]).map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
              </select>
              <button onClick={() => bulkUpdateMutation.mutate({ ids: [...selected], visibility: bulkVisibility })}
                disabled={bulkUpdateMutation.isPending}
                className="text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                適用
              </button>
            </div>
          )}
          {bulkPanel === "specialty" && (
            <div className="flex gap-2">
              <input value={bulkSpecialty} onChange={(e) => setBulkSpecialty(e.target.value)}
                placeholder="例: IT・システム開発"
                list={SPECIALTY_DATALIST_ID}
                className="flex-1 px-2 py-1.5 rounded-lg border text-xs" style={{ borderColor: "var(--color-paper-300)" }} />
              <button onClick={() => bulkUpdateMutation.mutate({ ids: [...selected], specialty: bulkSpecialty })}
                disabled={bulkUpdateMutation.isPending || !bulkSpecialty.trim()}
                className="text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                適用
              </button>
            </div>
          )}
          {bulkPanel === "company" && (
            <div className="flex gap-2">
              <input value={bulkCompany} onChange={(e) => setBulkCompany(e.target.value)}
                placeholder="例: 白樺商事株式会社"
                className="flex-1 px-2 py-1.5 rounded-lg border text-xs" style={{ borderColor: "var(--color-paper-300)" }} />
              <button onClick={() => bulkUpdateMutation.mutate({ ids: [...selected], company: bulkCompany })}
                disabled={bulkUpdateMutation.isPending || !bulkCompany.trim()}
                className="text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                適用
              </button>
            </div>
          )}
          {bulkPanel === "note" && (
            <div className="flex gap-2">
              <input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)}
                placeholder="例: 紹介歓迎"
                className="flex-1 px-2 py-1.5 rounded-lg border text-xs" style={{ borderColor: "var(--color-paper-300)" }} />
              <button onClick={() => bulkUpdateMutation.mutate({ ids: [...selected], note: bulkNote })}
                disabled={bulkUpdateMutation.isPending || !bulkNote.trim()}
                className="text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                適用
              </button>
            </div>
          )}
          {bulkPanel === "relationships" && (
            <div>
              <RelationshipTagsInput relationships={bulkAddRelationships} setRelationships={setBulkAddRelationships} />
              <p className="text-[11px] mb-2" style={{ color: "var(--color-ink-400)" }}>
                選択した人脈それぞれの既存の関係性は消えず、ここで追加したタグが足されます
              </p>
              <button onClick={() => bulkUpdateMutation.mutate({ ids: [...selected], addRelationships: bulkAddRelationships })}
                disabled={bulkUpdateMutation.isPending || bulkAddRelationships.length === 0}
                className="text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                適用
              </button>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>読み込み中...</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>まだ人脈が登録されていません</p>
      ) : filteredContacts.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>検索条件に一致する人脈がありません</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredContacts.map((ct) => {
            const style = VISIBILITY_STYLE[ct.visibility];
            const summaryBadge = summaryStatusBadge(ct);
            return (
              <div key={ct.id} className="p-3 rounded-xl flex gap-2"
                style={{ background: style.bg, borderLeft: `4px solid ${style.border}` }}>
                <input type="checkbox" className="mt-1 shrink-0" checked={selected.has(ct.id)} onChange={() => toggle(ct.id)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{ct.name}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                          style={{ background: style.badgeBg, color: style.badgeColor }}>
                          {VISIBILITY_LABEL[ct.visibility]}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                          style={{ background: summaryBadge.bg, color: summaryBadge.color }}>
                          {summaryBadge.label}
                        </span>
                      </div>
                      <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>
                        {[ct.specialty, ct.company, ...ct.relationships].filter(Boolean).join(" ・ ") || "（詳細未入力）"}
                      </p>
                      {ct.businessSummary && (
                        <p className="text-xs truncate mt-0.5" style={{ color: "var(--color-ink-600)" }}>{ct.businessSummary}</p>
                      )}
                      {ct.note && <p className="text-xs truncate mt-0.5" style={{ color: "var(--color-ink-400)" }}>{ct.note}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0 self-start">
                      <button onClick={() => setEditingContact(ct)}
                        className="p-1 rounded-lg shrink-0" style={{ color: "var(--color-ink-400)" }}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => { if (confirm(`「${ct.name}」を削除しますか？`)) deleteMutation.mutate(ct.id); }}
                        className="p-1 rounded-lg shrink-0" style={{ color: "var(--color-ink-400)" }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <select value={ct.visibility}
                    onChange={(e) => updateVisibility.mutate({ id: ct.id, visibility: e.target.value as Visibility })}
                    className="w-full px-2 py-1.5 rounded-lg border text-xs" style={{ borderColor: "var(--color-paper-300)" }}>
                    {(["existence", "private", "full"] as Visibility[]).map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingContact && (
        <EditContactModal contact={editingContact} onClose={() => setEditingContact(null)} />
      )}
    </div>
  );
}

function EditContactModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(contact.name);
  const [specialty, setSpecialty] = useState(contact.specialty ?? "");
  const [company, setCompany] = useState(contact.company ?? "");
  const [relationships, setRelationships] = useState<string[]>(contact.relationships);
  const [note, setNote] = useState(contact.note ?? "");
  const [businessSummary, setBusinessSummary] = useState(contact.businessSummary ?? "");
  const [businessSummaryDetail, setBusinessSummaryDetail] = useState(contact.businessSummaryDetail ?? "");
  const [error, setError] = useState("");

  const update = useMutation({
    mutationFn: () => api.patch(`/collab/contacts/${contact.id}`, {
      name: name.trim(), specialty: specialty.trim(), company: company.trim(),
      relationships, note: note.trim(),
      businessSummary: businessSummary.trim(), businessSummaryDetail: businessSummaryDetail.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "contacts"] });
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "更新に失敗しました"),
  });

  function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("名前を入力してください"); return; }
    update.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>人脈を編集</h2>
          <button onClick={onClose}><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>名前 *</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>専門分野</label>
        <input value={specialty} onChange={(e) => setSpecialty(e.target.value)}
          list={SPECIALTY_DATALIST_ID}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>会社名/屋号</label>
        <input value={company} onChange={(e) => setCompany(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <BusinessSummaryFields company={company} name={name} summary={businessSummary} setSummary={setBusinessSummary}
          detail={businessSummaryDetail} setDetail={setBusinessSummaryDetail} />
        <p className="text-[11px] -mt-2 mb-3" style={{ color: "var(--color-ink-400)" }}>
          空欄のまま保存すると、次に検索・参照された時にあらためて自動生成されます
        </p>

        <RelationshipTagsInput relationships={relationships} setRelationships={setRelationships} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>備考</label>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <button onClick={handleSubmit} disabled={update.isPending}
          className="w-full py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
          更新する
        </button>
      </div>
    </div>
  );
}
