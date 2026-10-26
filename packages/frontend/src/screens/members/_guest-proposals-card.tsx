// =============================================================
// 外部ゲストの回答からの人脈の自動登録が、登録件数の上限で保留になったときの確認（人脈の管理ページの先頭に出る）
//   ・非公開として、新しく登録する
//   ・既存の人脈を1件、非公開に変えて、新しい人を「存在のみ公開」で登録する
//   ・登録しない
// =============================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { GUEST_PROPOSALS_KEY, useGuestContactProposals, type GuestContactProposal } from "@/hooks/use-guest-contact-proposals";

type Contact = { id: string; name: string; company: string | null; specialty: string | null; visibility: "private" | "existence" | "full"; createdAt: number };

export function GuestProposalsCard() {
  const { proposals, limit, publicCount } = useGuestContactProposals();
  if (proposals.length === 0) return null;
  return (
    <div className="card-paper p-4 mb-6" style={{ border: "1.5px solid rgba(212,160,59,0.6)" }}>
      <h2 className="text-sm font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
        📇 ゲストの連絡先を登録できません（確認をお願いします）
      </h2>
      <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
        外部ゲストが、会社名まで入力して回答してくれましたが、外部人脈の登録件数が上限（非公開を除いて{limit}件・現在{publicCount}件）に達しているため、登録を保留しています。
        どうするか、選んでください。
      </p>
      <div className="space-y-3">
        {proposals.map((p) => <ProposalRow key={p.id} proposal={p} />)}
      </div>
    </div>
  );
}

function ProposalRow({ proposal }: { proposal: GuestContactProposal }) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const { data: contactsData } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
    enabled: picking,
  });
  const choices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (contactsData?.data ?? [])
      .filter((c) => c.visibility !== "private")
      .filter((c) => !q || `${c.name} ${c.company ?? ""} ${c.specialty ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 30);
  }, [contactsData, search]);

  const resolve = useMutation({
    mutationFn: (body: { action: "private" | "swap" | "dismiss"; swapContactId?: string }) =>
      api.post(`/guest-contact-proposals/${proposal.id}/resolve`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GUEST_PROPOSALS_KEY });
      qc.invalidateQueries({ queryKey: ["collab", "contacts"] });
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : "うまくいきませんでした。時間をおいてもう一度お試しください"),
  });
  const run = (body: { action: "private" | "swap" | "dismiss"; swapContactId?: string }) => { setError(""); resolve.mutate(body); };

  return (
    <div className="rounded-2xl p-3" style={{ background: "var(--color-paper-100)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
        {proposal.name}さん <span className="text-xs font-normal" style={{ color: "var(--color-ink-500)" }}>（{proposal.company}）</span>
      </p>
      {proposal.context && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{proposal.context}</p>}

      {!picking ? (
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" disabled={resolve.isPending} onClick={() => run({ action: "private" })}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-60" style={{ background: "var(--color-brand)" }}>
            非公開として登録する
          </button>
          <button type="button" disabled={resolve.isPending} onClick={() => setPicking(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-60" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
            既存の人脈を非公開に変えて、公開で登録する
          </button>
          <button type="button" disabled={resolve.isPending}
            onClick={() => { if (window.confirm(`${proposal.name}さんを、人脈に登録しませんか？（この確認は消えます）`)) run({ action: "dismiss" }); }}
            className="px-3 py-1.5 rounded-xl text-xs disabled:opacity-60" style={{ color: "var(--color-ink-500)" }}>
            登録しない
          </button>
          {resolve.isPending && <Loader2 size={14} className="animate-spin self-center" style={{ color: "var(--color-ink-400)" }} />}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>
            非公開に変える人脈を1件選んでください。選んだ人脈は、あなただけに見える状態になり、{proposal.name}さんが「存在のみ公開」で登録されます。
          </p>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前・会社名・専門分野で探す"
            className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
          <div className="max-h-56 overflow-y-auto space-y-1">
            {choices.map((c) => (
              <button key={c.id} type="button" disabled={resolve.isPending}
                onClick={() => { if (window.confirm(`「${c.name}」さんを非公開に変えて、${proposal.name}さんを登録します。よろしいですか？`)) run({ action: "swap", swapContactId: c.id }); }}
                className="w-full text-left px-3 py-2 rounded-xl disabled:opacity-60" style={{ background: "var(--color-paper-200)" }}>
                <span className="text-sm font-medium block truncate" style={{ color: "var(--color-ink-800)" }}>{c.name}</span>
                <span className="text-xs block truncate" style={{ color: "var(--color-ink-500)" }}>{[c.company, c.specialty].filter(Boolean).join(" ・ ") || "（詳細未入力）"}</span>
              </button>
            ))}
            {contactsData && choices.length === 0 && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>該当する人脈がありません</p>}
          </div>
          <button type="button" onClick={() => setPicking(false)} className="text-xs underline" style={{ color: "var(--color-ink-500)" }}>戻る</button>
        </div>
      )}
      {error && <p className="text-xs mt-2" style={{ color: "var(--color-brand)" }}>{error}</p>}
    </div>
  );
}
