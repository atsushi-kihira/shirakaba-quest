// =============================================================
// 外部人脈検索の検索式パーサー（自分の人脈一覧・協働の人脈をさがす、両方で共用）
// スペース区切り＝AND、"OR"（大文字小文字を問わない）＝OR、括弧でグループ化に対応。
// 例:「システム開発 OR 税理士」「(システム開発 OR ITコンサル) BNI」
// =============================================================

type QueryNode =
  | { type: "term"; value: string }
  | { type: "and"; children: QueryNode[] }
  | { type: "or"; children: QueryNode[] };

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const ch of query) {
    if (ch === "(" || ch === ")") {
      if (current) { tokens.push(current); current = ""; }
      tokens.push(ch);
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// 括弧の対応が崩れている等、途中までしかパースできない入力でも、パースできた範囲で
// AND/OR解釈を試みる（例外は投げない）。
function parseOr(tokens: string[], pos: number): [QueryNode | null, number] {
  const children: QueryNode[] = [];
  const [first, afterFirst] = parseAnd(tokens, pos);
  if (first) children.push(first);
  let next = afterFirst;
  while (next < tokens.length && tokens[next].toUpperCase() === "OR") {
    const [node, after] = parseAnd(tokens, next + 1);
    if (node) children.push(node);
    next = after;
  }
  if (children.length === 0) return [null, next];
  if (children.length === 1) return [children[0], next];
  return [{ type: "or", children }, next];
}

function parseAnd(tokens: string[], pos: number): [QueryNode | null, number] {
  const children: QueryNode[] = [];
  let cur = pos;
  while (cur < tokens.length) {
    const upper = tokens[cur].toUpperCase();
    if (upper === "OR" || tokens[cur] === ")") break;
    if (upper === "AND") { cur += 1; continue; } // 明示的なANDは暗黙ANDと同じ扱いで読み飛ばす
    const [node, next] = parseTerm(tokens, cur);
    if (!node) break;
    children.push(node);
    cur = next;
  }
  if (children.length === 0) return [null, cur];
  if (children.length === 1) return [children[0], cur];
  return [{ type: "and", children }, cur];
}

function parseTerm(tokens: string[], pos: number): [QueryNode | null, number] {
  if (pos >= tokens.length) return [null, pos];
  const t = tokens[pos];
  if (t === "(") {
    const [inner, next] = parseOr(tokens, pos + 1);
    const afterClose = tokens[next] === ")" ? next + 1 : next;
    return [inner, afterClose];
  }
  if (t === ")") return [null, pos];
  return [{ type: "term", value: t }, pos + 1];
}

function evaluate(node: QueryNode, haystackLower: string): boolean {
  if (node.type === "term") return haystackLower.includes(node.value.toLowerCase());
  if (node.type === "and") return node.children.every((c) => evaluate(c, haystackLower));
  return node.children.some((c) => evaluate(c, haystackLower));
}

/**
 * 複数フィールドを結合したテキストに対して、AND/OR・括弧に対応した検索式で一致判定する。
 * 空欄の場合は常に一致する（絞り込みなし）。
 */
export function matchesSearchQuery(fields: (string | null | undefined)[], query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  const [node] = parseOr(tokenize(q), 0);
  if (!node) return true;
  return evaluate(node, haystack);
}
