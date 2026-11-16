// =============================================================
// メンバー・トラフィック・ライト・レポート（MTLR）— 点数の計算・表の読み取り・アドバイス
//
// BNIのMTLR（PDFの表）を読み込んで分析するための共通ロジック。フロント・バックの両方から使う。
// 点数の基準は「MTLR新基準（2025年10月〜）」。基準が変わったときは、この基準表（LADDERS）を直す。
//
// 【計算の前提（実際のレポート2か月分・計92人の「スコア」を、すべて再現できることを確認済み）】
// ・週あたりの数 ＝ その人の件数 ÷ その人の定例会の回数（出＋欠＋遅＋医＋代）。在籍が半年に満たない人は、
//   その人の定例会の回数が少ないので、自動的にその分で割ることになる
// ・出席率 ＝ （定例会の回数 − 欠席）÷ 定例会の回数（遅刻・医療・代理は出席に数える）
// ・総合点 ＝ 出席10 ＋ ビジター25 ＋ サンキュー5 ＋ 1to1 20 ＋ リファーラル25 ＋ CEU10 ＋ スポンサー5 ＝ 100点満点
// =============================================================

export type MtlrColor = "green" | "yellow" | "red" | "gray";

/** レポートの1行ぶんの数字（表の列と同じ順番） */
export type MtlrRaw = {
  attended: number;        // 出（出席）
  absent: number;          // 欠（欠席）
  late: number;            // 遅（遅刻）
  medical: number;         // 医（医療休暇）
  substitute: number;      // 代（代理出席）
  refInGiven: number;      // 内与（チャプター内へ渡したリファーラル）
  refOutGiven: number;     // 外与（チャプター外へ渡したリファーラル）
  refOutRate: number;      // 外与率（%）
  refInReceived: number;   // 内受（チャプター内からもらったリファーラル）
  refOutReceived: number;  // 外受（チャプター外からもらったリファーラル）
  visitors: number;        // ビ（ビジター招待）
  oneToOne: number;        // 1to1
  tyfcb: number;           // 千円（サンキュー金額。単位は千円）
  ceu: number;             // CEU
  recommend: number;       // 推薦
  sponsor: number;         // 後援（スポンサー）
  score: number;           // スコア（レポートに印刷されている総合点）
};

/** 表の列の順番（PDFの左から右） */
export const MTLR_COLUMNS: (keyof MtlrRaw)[] = [
  "attended", "absent", "late", "medical", "substitute",
  "refInGiven", "refOutGiven", "refOutRate", "refInReceived", "refOutReceived",
  "visitors", "oneToOne", "tyfcb", "ceu", "recommend", "sponsor", "score",
];

/** 表の見出し（PDFと同じ） */
export const MTLR_HEADERS: Record<keyof MtlrRaw, string> = {
  attended: "出", absent: "欠", late: "遅", medical: "医", substitute: "代",
  refInGiven: "内与", refOutGiven: "外与", refOutRate: "外与率", refInReceived: "内受", refOutReceived: "外受",
  visitors: "ビ", oneToOne: "1to1", tyfcb: "千円", ceu: "CEU", recommend: "推薦", sponsor: "後援", score: "スコア",
};

export const MTLR_STANDARD = "2025-10";

export const MTLR_COLOR_LABEL: Record<MtlrColor, string> = { green: "緑", yellow: "黄", red: "赤", gray: "グレー" };

// ---------------- 点数の基準 ----------------

export type MtlrCategoryKey = "attendance" | "visitors" | "tyfcb" | "oneToOne" | "referrals" | "ceu" | "sponsors";

type Step = {
  /** この値以上（strict なら「超える」）で、この点数 */
  at: number;
  strict?: boolean;
  points: number;
  color: MtlrColor;
};

/** 高い順に並べる。上から順に見て、最初に当てはまった段が、その人の点数になる */
const LADDERS: Record<MtlrCategoryKey, Step[]> = {
  // 出席率（%、6か月）
  attendance: [
    { at: 96, points: 10, color: "green" },
    { at: 88, points: 5, color: "yellow" },
    { at: 0, points: 0, color: "red" },
  ],
  // ビジター数（6か月）
  visitors: [
    { at: 5, points: 25, color: "green" },
    { at: 4, points: 20, color: "green" },
    { at: 3, points: 15, color: "yellow" },
    { at: 2, points: 10, color: "yellow" },
    { at: 1, points: 5, color: "red" },
    { at: 0, points: 0, color: "gray" },
  ],
  // サンキュー金額（6か月）。単位は千円（570万円 = 5,700千円）
  tyfcb: [
    { at: 5700, points: 5, color: "green" },
    { at: 2850, points: 4, color: "green" },
    { at: 950, points: 3, color: "yellow" },
    { at: 380, points: 2, color: "yellow" },
    { at: 1, points: 1, color: "red" },
    { at: 0, points: 0, color: "gray" },
  ],
  // 1to1（1週あたり。at は「1週あたり」を4倍した数。4 = 1.00回）
  oneToOne: [
    { at: 4, points: 20, color: "green" },
    { at: 3, points: 15, color: "yellow" },
    { at: 2, points: 10, color: "yellow" },
    { at: 1, points: 5, color: "red" },
    { at: 0, points: 0, color: "gray" },
  ],
  // リファーラル（渡した数 = 内与＋外与、1週あたり。at は4倍した数。5 = 1.25件）
  referrals: [
    { at: 5, points: 25, color: "green" },
    { at: 4, points: 20, color: "green" },
    { at: 3, points: 15, color: "yellow" },
    { at: 2, points: 10, color: "yellow" },
    { at: 1, points: 5, color: "red" },
    { at: 0, points: 0, color: "gray" },
  ],
  // CEU（1週あたり。at は4倍した数。2 = 0.5を超える、0 = 0を超える）
  ceu: [
    { at: 2, strict: true, points: 10, color: "green" },
    { at: 0, strict: true, points: 5, color: "yellow" },
    { at: 0, points: 0, color: "red" },
  ],
  // スポンサー数（6か月）
  sponsors: [
    { at: 1, points: 5, color: "green" },
    { at: 0, points: 0, color: "red" },
  ],
};

/** 総合点の色（70以上 緑 / 50以上 黄 / 30以上 赤 / 30未満 グレー） */
export function totalColor(score: number): MtlrColor {
  if (score >= 70) return "green";
  if (score >= 50) return "yellow";
  if (score >= 30) return "red";
  return "gray";
}

export const MTLR_CATEGORY_LABEL: Record<MtlrCategoryKey, string> = {
  attendance: "出席",
  visitors: "ビジター",
  tyfcb: "サンキュー金額",
  oneToOne: "1to1",
  referrals: "リファーラル",
  ceu: "CEU",
  sponsors: "スポンサー",
};

export const MTLR_CATEGORY_ORDER: MtlrCategoryKey[] = ["attendance", "visitors", "tyfcb", "oneToOne", "referrals", "ceu", "sponsors"];

export type MtlrNextStep = {
  /** 次の段に届くために必要な数（その項目の数え方で） */
  need: number;
  /** あと何足りないか */
  gap: number;
  /** 次の段の点数と、いまとの差 */
  points: number;
  gain: number;
  color: MtlrColor;
};

export type MtlrCategoryResult = {
  key: MtlrCategoryKey;
  /** いまの数（出席は出席した回数、ほかは件数・千円） */
  value: number;
  points: number;
  max: number;
  color: MtlrColor;
  next: MtlrNextStep | null;
};

export type MtlrBreakdown = {
  /** 定例会の回数（出＋欠＋遅＋医＋代）。「週あたり」の割り算に使う */
  meetings: number;
  /** 出席率（%。小数1桁まで） */
  attendanceRate: number;
  categories: Record<MtlrCategoryKey, MtlrCategoryResult>;
  /** 項目ごとの点数を足した総合点 */
  total: number;
  totalColor: MtlrColor;
  /** レポートに印刷されたスコアと、計算した総合点が一致するか */
  matchesReported: boolean;
};

/** 「at」に届くために必要な件数。multiplier / divisor は項目ごとの数え方の違い */
function needCount(step: Step, multiplier: number, divisor: number): number {
  const x = (step.at * multiplier) / divisor;
  return step.strict ? Math.floor(x) + 1 : Math.ceil(x);
}

function pickStep(ladder: Step[], value: number, need: (s: Step) => number): { index: number; step: Step } {
  for (let i = 0; i < ladder.length; i++) {
    if (value >= need(ladder[i])) return { index: i, step: ladder[i] };
  }
  const last = ladder.length - 1;
  return { index: last, step: ladder[last] };
}

function evaluate(
  key: MtlrCategoryKey,
  value: number,
  need: (s: Step) => number,
): MtlrCategoryResult {
  const ladder = LADDERS[key];
  const { index, step } = pickStep(ladder, value, need);
  const max = ladder[0].points;
  let next: MtlrNextStep | null = null;
  if (index > 0) {
    const up = ladder[index - 1];
    const n = need(up);
    next = { need: n, gap: Math.max(0, n - value), points: up.points, gain: up.points - step.points, color: up.color };
  }
  return { key, value, points: step.points, max, color: step.color, next };
}

/** 1行ぶんの数字から、項目ごとの点数・色・総合点を計算する */
export function computeMtlr(raw: MtlrRaw): MtlrBreakdown {
  const meetings = raw.attended + raw.absent + raw.late + raw.medical + raw.substitute;
  const m = Math.max(meetings, 1); // 0で割らないように
  const present = Math.max(0, meetings - raw.absent);
  const given = raw.refInGiven + raw.refOutGiven;

  const categories: Record<MtlrCategoryKey, MtlrCategoryResult> = {
    attendance: evaluate("attendance", present, (s) => needCount(s, meetings, 100)),
    visitors: evaluate("visitors", raw.visitors, (s) => needCount(s, 1, 1)),
    tyfcb: evaluate("tyfcb", raw.tyfcb, (s) => needCount(s, 1, 1)),
    oneToOne: evaluate("oneToOne", raw.oneToOne, (s) => needCount(s, m, 4)),
    referrals: evaluate("referrals", given, (s) => needCount(s, m, 4)),
    ceu: evaluate("ceu", raw.ceu, (s) => needCount(s, m, 4)),
    sponsors: evaluate("sponsors", raw.sponsor, (s) => needCount(s, 1, 1)),
  };
  // 出席の「value」は出席した回数。わかりやすいよう、基準の判定と同じ回数で持つ
  const total = MTLR_CATEGORY_ORDER.reduce((sum, k) => sum + categories[k].points, 0);
  return {
    meetings,
    attendanceRate: meetings > 0 ? Math.round((present / meetings) * 1000) / 10 : 0,
    categories,
    total,
    totalColor: totalColor(raw.score),
    matchesReported: total === raw.score,
  };
}

// ---------------- 名前の読み取り・照合 ----------------

// 旧字体・異体字の一部を、ふつうの字にそろえる（髙橋と高橋を同じ人として扱うため）
const VARIANTS: Record<string, string> = {
  "髙": "高", "﨑": "崎", "德": "徳", "廣": "広", "澤": "沢", "齋": "斎", "齊": "斉", "邊": "辺", "邉": "辺",
  "嶋": "島", "濵": "浜", "濱": "浜", "國": "国", "學": "学", "惠": "恵", "邨": "村", "桒": "桑", "冨": "富",
  "增": "増", "槇": "槙", "𠮷": "吉",
};

// ひらがな・カタカナ・漢字（「・」は含めない）
const CJK = /[぀-ゟァ-ヺー-ヿ㐀-鿿豈-﫿]/;

function cleanTokens(name: string): string[] {
  const s = name.normalize("NFKC").replace(/\([^)]*\)/g, " ").replace(/（[^）]*）/g, " ");
  return s.split(/\s+/).filter(Boolean);
}

/** 画面に出す名前。ローマ字のふりがなが混ざっている名前（「田鍋 Tanabe 智之 Tomoyuki」）は、漢字の部分だけにする */
export function mtlrDisplayName(rawName: string): string {
  const tokens = cleanTokens(rawName);
  const cjk = tokens.filter((t) => CJK.test(t));
  return (cjk.length > 0 ? cjk : tokens).join(" ");
}

/** 同じ人かどうかを見分けるためのキー（空白・かっこ・ローマ字のふりがな・異体字の違いを無視する） */
export function mtlrPersonKey(rawName: string): string {
  const joined = mtlrDisplayName(rawName).replace(/\s+/g, "").toLowerCase();
  return Array.from(joined).map((ch) => VARIANTS[ch] ?? ch).join("");
}

/** ローマ字の名前（「FUKANO HIROYUKI」）の照合用。順番が違っても同じになるよう、単語を並べ替える */
export function mtlrLatinKey(name: string): string {
  const tokens = cleanTokens(name).filter((t) => !CJK.test(t)).map((t) => t.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean);
  return tokens.sort().join(" ");
}

// ---------------- PDF・貼り付けテキストの読み取り ----------------

export type ParsedMtlrRow = { rawName: string; raw: MtlrRaw };

export type ParsedMtlr = {
  periodFrom: string | null; // YYYY-MM-DD
  periodTo: string | null;
  createdOn: string | null;
  rows: ParsedMtlrRow[];
  /** 数字の行として読み取れなかった行（確認用） */
  skipped: string[];
};

function ymd(y: string, m: string, d: string): string {
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** PDFから取り出した「1行ごとの文字」を、表として読み取る */
export function parseMtlrLines(lines: string[]): ParsedMtlr {
  const text = lines.join("\n").normalize("NFKC");
  const dates = [...text.matchAll(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)];
  const created = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*作成/);
  const periodFrom = dates[0] ? ymd(dates[0][1], dates[0][2], dates[0][3]) : null;
  const periodTo = dates[1] ? ymd(dates[1][1], dates[1][2], dates[1][3]) : null;
  const createdOn = created ? ymd(created[1], created[2], created[3]) : null;

  const rows: ParsedMtlrRow[] = [];
  const skipped: string[] = [];
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens[0] === "名前") continue; // 見出しの行
    if (tokens.length < MTLR_COLUMNS.length + 1) {
      if (/\d/.test(line) && tokens.length >= 6 && !/年|作成|Ver\./.test(line)) skipped.push(line.trim());
      continue;
    }
    const nums = tokens.slice(-MTLR_COLUMNS.length);
    if (!nums.every((t) => /^\d[\d,]*$/.test(t))) {
      skipped.push(line.trim());
      continue;
    }
    const rawName = tokens.slice(0, -MTLR_COLUMNS.length).join(" ");
    if (!rawName || rawName === "名前" || /^[\d,]+$/.test(rawName)) continue;
    const raw = {} as MtlrRaw;
    MTLR_COLUMNS.forEach((k, i) => { raw[k] = Number(nums[i].replace(/,/g, "")); });
    if (raw.score > 100) {
      skipped.push(line.trim());
      continue;
    }
    rows.push({ rawName, raw });
  }
  return { periodFrom, periodTo, createdOn, rows, skipped };
}

/** "2026-10" → "2026年10月" */
export function mtlrYmLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

/** 取り込んだレポートの「年月」。期間の終わりの日の年月 */
export function mtlrYmOf(periodTo: string): string {
  return periodTo.slice(0, 7);
}

// ---------------- 集計・アドバイス ----------------

export type MtlrHistoryPoint = { ym: string; raw: MtlrRaw };

export type AdviceItem = {
  kind: "good" | "next" | "watch" | "info";
  icon: string;
  title: string;
  body: string;
};

export type ChapterContext = {
  /** その月の順位（同点は同順位）と人数 */
  rank: number;
  count: number;
  averageScore: number;
  /** その月で、いちばん多かった定例会の回数（新しいメンバーかどうかの目安） */
  maxMeetings: number;
};

export type MemberAdvice = { summary: string; items: AdviceItem[] };

const UNIT: Record<MtlrCategoryKey, string> = {
  attendance: "回",
  visitors: "名",
  tyfcb: "千円",
  oneToOne: "回",
  referrals: "件",
  ceu: "CEU",
  sponsors: "名",
};

function fmtGap(key: MtlrCategoryKey, gap: number): string {
  if (key === "tyfcb") {
    const man = Math.ceil(gap / 10); // 1万円 = 10千円
    return `約${man.toLocaleString()}万円`;
  }
  return `${gap.toLocaleString()}${UNIT[key]}`;
}

function fmtValue(key: MtlrCategoryKey, raw: MtlrRaw, b: MtlrBreakdown): string {
  switch (key) {
    case "attendance": return `${b.attendanceRate}%`;
    case "visitors": return `${raw.visitors}名`;
    case "tyfcb": return raw.tyfcb >= 10 ? `${(raw.tyfcb / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}万円` : `${(raw.tyfcb * 1000).toLocaleString()}円`;
    case "oneToOne": return `${raw.oneToOne}回（週${(raw.oneToOne / Math.max(b.meetings, 1)).toFixed(2)}回）`;
    case "referrals": return `${raw.refInGiven + raw.refOutGiven}件（週${((raw.refInGiven + raw.refOutGiven) / Math.max(b.meetings, 1)).toFixed(2)}件）`;
    case "ceu": return `${raw.ceu}（週${(raw.ceu / Math.max(b.meetings, 1)).toFixed(2)}）`;
    case "sponsors": return `${raw.sponsor}名`;
  }
}

const COLOR_WORD: Record<MtlrColor, string> = { green: "緑", yellow: "黄色", red: "赤", gray: "グレー" };

/** このメンバーの、直近までの数字から読み取れるアドバイス（決まったルールで作るので、同じ数字なら同じ文章になる） */
export function buildMemberAdvice(history: MtlrHistoryPoint[], chapter?: ChapterContext): MemberAdvice {
  if (history.length === 0) return { summary: "まだデータがありません。", items: [] };
  const latest = history[history.length - 1];
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const b = computeMtlr(latest.raw);
  const pb = prev ? computeMtlr(prev.raw) : null;
  const items: AdviceItem[] = [];

  // ---- 概要 ----
  let summary = `${mtlrYmLabel(latest.ym)}のスコアは${latest.raw.score}点（${COLOR_WORD[b.totalColor]}）です。`;
  if (prev) {
    const d = latest.raw.score - prev.raw.score;
    summary += d > 0 ? `前回より${d}点アップしています。` : d < 0 ? `前回より${-d}点下がっています。` : "前回と同じ点数です。";
  }
  if (chapter && chapter.count > 0) {
    summary += `チャプター${chapter.count}人中${chapter.rank}位（平均${chapter.averageScore.toFixed(1)}点）です。`;
  }

  // ---- いいところ ----
  const full = MTLR_CATEGORY_ORDER.filter((k) => b.categories[k].points === b.categories[k].max);
  if (full.length > 0) {
    items.push({ kind: "good", icon: "🌟", title: "満点の項目", body: `${full.map((k) => MTLR_CATEGORY_LABEL[k]).join("・")}は満点です。この調子を続けましょう。` });
  }
  if (pb) {
    const up = MTLR_CATEGORY_ORDER.filter((k) => b.categories[k].points > pb.categories[k].points);
    if (up.length > 0) {
      items.push({ kind: "good", icon: "📈", title: "前回よりアップ", body: `${up.map((k) => `${MTLR_CATEGORY_LABEL[k]}（+${b.categories[k].points - pb.categories[k].points}点）`).join("、")}が上がりました。` });
    }
  }
  if (history.length >= 3) {
    const t = history.slice(-3).map((h) => h.raw.score);
    if (t[0] < t[1] && t[1] < t[2]) {
      items.push({ kind: "good", icon: "🚀", title: "3回連続でアップ", body: `スコアが ${t.join(" → ")} と、3回続けて上がっています。` });
    }
  }
  const given = latest.raw.refInGiven + latest.raw.refOutGiven;
  if (given >= 10 && latest.raw.refOutRate >= 85) {
    items.push({ kind: "good", icon: "🌐", title: "チャプターの外へのリファーラルが多い", body: `渡したリファーラルの${latest.raw.refOutRate}%が、チャプターの外のお客様です。外とのつながりが強みです。` });
  }

  // ---- 次の一歩 ----
  const candidates = MTLR_CATEGORY_ORDER
    .filter((k) => k !== "attendance" && b.categories[k].next)
    .map((k) => {
      const c = b.categories[k];
      const nx = c.next!;
      return { k, c, nx, relative: nx.gap / Math.max(nx.need, 1) };
    })
    .sort((x, y) => x.relative - y.relative || y.nx.gain - x.nx.gain)
    .slice(0, 3);
  for (const { k, c, nx } of candidates) {
    const colorNote = nx.color !== c.color ? `（${COLOR_WORD[nx.color]}にあがります）` : "";
    items.push({
      kind: "next",
      icon: "🎯",
      title: `${MTLR_CATEGORY_LABEL[k]}：あと${fmtGap(k, nx.gap)}で+${nx.gain}点`,
      body: `いまは${fmtValue(k, latest.raw, b)}で${c.points}点です。あと${fmtGap(k, nx.gap)}で${nx.points}点になります${colorNote}。`,
    });
  }
  if (b.total < 70) {
    const need = (b.total < 50 ? 50 : 70) - b.total;
    const target = b.total < 50 ? "黄色（50点）" : "緑（70点）";
    const gains = candidates.reduce((s, x) => s + x.nx.gain, 0);
    const reach = gains >= need ? "上の取り組みが全部できれば届きます。" : "";
    items.push({ kind: "next", icon: "🚦", title: `${target}まで、あと${need}点`, body: `いまの計算上の合計は${b.total}点です。${reach}` });
  }

  // ---- 気をつけたいところ ----
  if (pb && latest.raw.score - prev!.raw.score <= -5) {
    const down = MTLR_CATEGORY_ORDER.filter((k) => b.categories[k].points < pb.categories[k].points);
    items.push({
      kind: "watch",
      icon: "📉",
      title: "前回より点数が下がりました",
      body: `${down.length > 0 ? `${down.map((k) => `${MTLR_CATEGORY_LABEL[k]}（${b.categories[k].points - pb.categories[k].points}点）`).join("、")}が下がっています。` : ""}数字は「直近6か月」の合計なので、半年前の実績が外れて下がることもあります。`,
    });
  }
  if (history.length >= 3) {
    const t = history.slice(-3).map((h) => h.raw.score);
    if (t[0] > t[1] && t[1] > t[2]) {
      items.push({ kind: "watch", icon: "⚠️", title: "3回連続で下がっています", body: `スコアが ${t.join(" → ")} と下がっています。早めに、下がった項目を見直すと安心です。` });
    }
  }
  const low = MTLR_CATEGORY_ORDER.filter((k) => (b.categories[k].color === "red" || b.categories[k].color === "gray") && b.categories[k].points < b.categories[k].max);
  if (low.length > 0) {
    items.push({ kind: "watch", icon: "🔴", title: "点が低い項目", body: `${low.map((k) => `${MTLR_CATEGORY_LABEL[k]}（${COLOR_WORD[b.categories[k].color]}）`).join("、")}。ここを伸ばすと、スコアが大きく変わります。` });
  }
  if (b.attendanceRate < 96 && b.meetings > 0) {
    const present = b.meetings - latest.raw.absent;
    const k = Math.max(1, Math.ceil((96 * b.meetings - 100 * present) / 4));
    items.push({ kind: "watch", icon: "🗓️", title: `出席率は${b.attendanceRate}%`, body: `欠席は${latest.raw.absent}回です。あと${k}回続けて出席すると、出席率が96%（緑）に届きます。` });
  }
  const received = latest.raw.refInReceived + latest.raw.refOutReceived;
  if (given >= 10 && received >= given * 2) {
    items.push({ kind: "watch", icon: "🔁", title: "もらう数が、渡す数より多めです", body: `渡したリファーラル${given}件に対して、もらったのは${received}件です。もらったぶんを、お返しの紹介にもつなげてみましょう。` });
  } else if (given >= 20 && received * 3 <= given) {
    items.push({ kind: "watch", icon: "🎁", title: "たくさん渡していて、もらう数は少なめです", body: `渡したリファーラル${given}件に対して、もらったのは${received}件です。ご自身の「紹介してほしい相手」を、仲間に具体的に伝えてみましょう。` });
  }
  if (received >= 20 && latest.raw.tyfcb < 380) {
    items.push({ kind: "watch", icon: "💴", title: "もらったリファーラルが、サンキュー金額に届いていません", body: `もらったリファーラルは${received}件ですが、サンキュー金額は${latest.raw.tyfcb.toLocaleString()}千円です。成約したものの報告（サンキュースリップ）が、まだ出ていないかもしれません。` });
  }
  if (b.categories.oneToOne.points >= 20 && b.categories.referrals.points <= 15) {
    items.push({ kind: "watch", icon: "🤝", title: "1to1はたくさんしています", body: "1to1の回数は十分です。会って分かった相手の強みを、リファーラルにつなげると、点数がさらに伸びます。" });
  }
  if (history.length >= 3 && history.slice(-3).every((h) => h.raw.visitors === 0)) {
    items.push({ kind: "watch", icon: "🚪", title: "ビジターが3回続けて0名です", body: "ビジターは満点が25点と、いちばん配点が大きい項目です。まず1名の招待から始めてみましょう。" });
  }
  if (given >= 10 && latest.raw.refOutRate < 40) {
    items.push({ kind: "info", icon: "🏢", title: "リファーラルはメンバー同士が中心です", body: `渡したリファーラルの${latest.raw.refOutRate}%がチャプターの外です。外のお客様のご紹介も意識すると、広がりが出ます。` });
  }

  // ---- 見方のメモ ----
  if (chapter && chapter.maxMeetings > 0 && b.meetings < chapter.maxMeetings * 0.8) {
    items.push({ kind: "info", icon: "🌱", title: "在籍が半年に満たない期間のデータです", body: `定例会は${b.meetings}回（チャプターで最も多い人は${chapter.maxMeetings}回）です。「週あたり」の点数は、その人の定例会の回数で割って計算されます。` });
  }
  items.push({ kind: "info", icon: "📝", title: "数字の見方", body: "表の数字は、毎月ずらしながらの「直近6か月」の合計です。グラフの動きは、6か月の窓が1か月ずつ進んだ結果です。" });

  return { summary, items };
}

// ---------------- チャプター全体の集計 ----------------

export type ChapterCategorySummary = {
  key: MtlrCategoryKey;
  /** 平均点 ÷ 満点（0〜1） */
  averageRatio: number;
  averagePoints: number;
  max: number;
  /** 赤・グレーの人数 */
  lowCount: number;
  /** 満点の人数 */
  fullCount: number;
};

export type ChapterSummary = {
  count: number;
  averageScore: number;
  colorCounts: Record<MtlrColor, number>;
  categories: ChapterCategorySummary[];
  maxMeetings: number;
};

export function summarizeChapter(rows: MtlrRaw[]): ChapterSummary {
  const colorCounts: Record<MtlrColor, number> = { green: 0, yellow: 0, red: 0, gray: 0 };
  const sums: Record<MtlrCategoryKey, { pts: number; low: number; full: number }> = {
    attendance: { pts: 0, low: 0, full: 0 }, visitors: { pts: 0, low: 0, full: 0 }, tyfcb: { pts: 0, low: 0, full: 0 },
    oneToOne: { pts: 0, low: 0, full: 0 }, referrals: { pts: 0, low: 0, full: 0 }, ceu: { pts: 0, low: 0, full: 0 },
    sponsors: { pts: 0, low: 0, full: 0 },
  };
  let scoreSum = 0;
  let maxMeetings = 0;
  for (const raw of rows) {
    const b = computeMtlr(raw);
    scoreSum += raw.score;
    colorCounts[totalColor(raw.score)]++;
    maxMeetings = Math.max(maxMeetings, b.meetings);
    for (const k of MTLR_CATEGORY_ORDER) {
      const c = b.categories[k];
      sums[k].pts += c.points;
      if (c.color === "red" || c.color === "gray") sums[k].low++;
      if (c.points === c.max) sums[k].full++;
    }
  }
  const n = rows.length;
  return {
    count: n,
    averageScore: n > 0 ? scoreSum / n : 0,
    colorCounts,
    maxMeetings,
    categories: MTLR_CATEGORY_ORDER.map((k) => {
      const max = LADDERS[k][0].points;
      const avg = n > 0 ? sums[k].pts / n : 0;
      return { key: k, averageRatio: max > 0 ? avg / max : 0, averagePoints: avg, max, lowCount: sums[k].low, fullCount: sums[k].full };
    }),
  };
}
