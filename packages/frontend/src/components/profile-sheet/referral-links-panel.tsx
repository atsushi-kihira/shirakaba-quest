// =============================================================
// 紹介できそうな人（「もらった資料のメモ」の表の中に出す）
//   ・なかまの詳細画面：そのなかまに紹介できそうな、自分の外部人脈
//   ・外部人脈の詳細画面：その人を紹介すると意味がありそうな、メンバー
//   AIでさがす（貢献のご縁の仕組みを使う）・自分で追加・重点（⭐）のチェック・外す ができる。登録した本人だけが見られる
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, Star, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { ProfileSheetSubjectType } from "@shared/types";
import { useAddLink, useRemoveLink, useSheetLinks, useStartMatch, useToggleLinkStar } from "./profile-sheet-shared";

type Props = { type: ProfileSheetSubjectType; subjectId: string; subjectName: string };
type Option = { id: string; label: string };

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function ReferralLinksPanel({ type, subjectId, subjectName }: Props) {
  const me = useAuthStore((st) => st.user);
  const toMembers = type === "contact"; // 紹介の相手がメンバーか（外部人脈の詳細画面）
  const { data, isLoading, isError } = useSheetLinks(type, subjectId);
  const start = useStartMatch();
  const toggle = useToggleLinkStar(type, subjectId);
  const remove = useRemoveLink(type, subjectId);
  const add = useAddLink();
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);

  const contactsQ = useQuery({
    queryKey: ["collab", "contacts"], enabled: adding && !toMembers,
    queryFn: () => api.get<{ data: { id: string; name: string; company: string | null }[] }>("/collab/contacts"),
  });
  const membersQ = useQuery({
    queryKey: ["members"], enabled: adding && toMembers,
    queryFn: () => api.get<{ data: { id: string; name: string }[] }>("/members"),
  });

  const links = data?.links ?? [];
  const run = data?.run ?? null;
  const running = start.isPending || run?.status === "running";
  const linked = new Set(links.map((l) => l.targetId));
  const options: Option[] = (toMembers
    ? (membersQ.data?.data ?? []).filter((m) => m.id !== me?.id).map((m) => ({ id: m.id, label: m.name }))
    : (contactsQ.data?.data ?? []).map((c) => ({ id: c.id, label: c.company ? `${c.name}（${c.company}）` : c.name }))
  ).filter((o) => !linked.has(o.id)).sort((a, b) => a.label.localeCompare(b.label, "ja"));

  function startMatch() {
    setError(null);
    start.mutate({ type, id: subjectId }, { onError: (e) => setError(errText(e, "さがせませんでした。少し待ってから、もう一度お試しください")) });
  }

  function addLink() {
    if (!pick) return;
    setError(null);
    add.mutate({ type, id: subjectId, targetId: pick }, {
      onSuccess: () => { setPick(""); setAdding(false); },
      onError: (e) => setError(errText(e, "追加できませんでした。もう一度お試しください")),
    });
  }

  const hint = toMembers
    ? `${subjectName}さんの情報と、メンバーの金の卵・金のガチョウを照らして、紹介すると意味がありそうなメンバーをAIがさがします。重点的に紹介したいメンバーには ⭐ を付けておけます。`
    : `${subjectName}さんの「紹介してほしい相手」と、金の卵・金のガチョウから、あなたの外部人脈の中で紹介できそうな人をAIがさがします。有望な人には ⭐ を付けておけます。`;

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>{hint}</p>

      <div className="flex flex-wrap gap-2">
        <button onClick={startMatch} disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-60" style={{ background: "var(--color-brand)" }}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          {running ? "さがしています…" : run ? "AIでさがし直す" : "AIでさがす"}
        </button>
        <button onClick={() => { setAdding((v) => !v); setError(null); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          <Plus size={13} /> {toMembers ? "メンバーを追加" : "外部人脈を追加"}
        </button>
      </div>

      {running && (
        <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
          AIが照らし合わせています（1〜2分ほどかかることがあります）。このまま画面を閉じても、結果は残ります。
        </p>
      )}
      {!running && run?.status === "error" && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{run.message || "さがせませんでした。もう一度お試しください"}</p>}
      {!running && run?.status === "done" && run.message && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{run.message}</p>}
      {error && <p className="text-xs whitespace-pre-line" style={{ color: "var(--color-brand)" }}>{error}</p>}

      {adding && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="flex-1 min-w-40 px-2 py-1.5 rounded-lg border text-xs" style={{ borderColor: "var(--color-paper-300)" }}>
            <option value="">{(toMembers ? membersQ.isLoading : contactsQ.isLoading) ? "読み込み中…" : "選んでください"}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button onClick={addLink} disabled={!pick || add.isPending}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            {add.isPending ? "追加中…" : "追加する"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-2"><Loader2 size={16} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>
      ) : isError ? (
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>読み込めませんでした。少し待ってから、もう一度開いてください。</p>
      ) : links.length === 0 ? (
        !running && <p className="text-xs" style={{ color: "var(--color-ink-300)" }}>まだ、ありません</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="flex items-start gap-2 rounded-xl px-2.5 py-2"
              style={{
                background: l.starred ? "rgba(212,160,59,0.2)" : "var(--color-paper-100)",
                border: l.starred ? "1.5px solid var(--color-accent)" : "1px solid var(--color-paper-300)",
              }}>
              <button onClick={() => toggle.mutate({ linkId: l.id, starred: !l.starred })} aria-pressed={l.starred}
                aria-label={l.starred ? "重点のチェックを外す" : "重点にする（有望な人としてチェックする）"}
                title={l.starred ? "重点のチェックを外す" : "重点にする"} className="shrink-0 mt-0.5"
                style={{ color: l.starred ? "var(--color-accent)" : "var(--color-ink-300)" }}>
                <Star size={18} fill={l.starred ? "currentColor" : "none"} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link to={l.kind === "member" ? `/members/${l.targetId}` : `/members/contacts/${l.targetId}`}
                    className="text-sm font-semibold underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                    {l.emoji ? `${l.emoji} ` : ""}{l.name}
                  </Link>
                  {l.starred && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "var(--color-accent)", color: "white" }}>⭐ 重点</span>}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                    {l.source === "ai" ? "AIの提案" : "自分で追加"}
                  </span>
                </div>
                {l.subtitle && <p className="text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>{l.subtitle}</p>}
                {l.reason && <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: "var(--color-ink-700)" }}>{l.reason}</p>}
              </div>
              <button onClick={() => remove.mutate(l.id)} aria-label={`${l.name}さんを外す`} title="一覧から外す" className="shrink-0 p-1 rounded-md"
                style={{ color: "var(--color-ink-400)" }}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
