// =============================================================
// チーム案のメンバー選び（メンバー／自分の外部人脈。自分を含めて最大10名）
// ・MemberPickerPanel：選択の部分だけの部品（作成のダイアログと、メンバー追加のダイアログで共通利用）
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type PickMember = { id: string; name: string; emoji: string; bgColor: string; category: string | null };
type PickContact = { id: string; name: string; company: string | null; specialty: string | null };

export function MemberPickerPanel({ maxOthers, selMembers, selContacts, onChange }: {
  maxOthers: number; selMembers: Set<string>; selContacts: Set<string>; onChange: (members: Set<string>, contacts: Set<string>) => void;
}) {
  const [tab, setTab] = useState<"member" | "contact">("member");
  const [q, setQ] = useState("");
  const members = useQuery({ queryKey: ["members"], queryFn: () => api.get<{ data: PickMember[] }>("/members") });
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.get<{ data: { id: string } }>("/auth/me") });
  const contacts = useQuery({ queryKey: ["collab", "contacts"], queryFn: () => api.get<{ data: PickContact[] }>("/collab/contacts") });
  const meId = meQ.data?.data.id;
  const total = selMembers.size + selContacts.size;
  const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").toLowerCase();
  const needle = norm(q.trim());

  const toggleMember = (id: string) => {
    const next = new Set(selMembers);
    if (next.has(id)) next.delete(id); else if (total < maxOthers) next.add(id);
    onChange(next, selContacts);
  };
  const toggleContact = (id: string) => {
    const next = new Set(selContacts);
    if (next.has(id)) next.delete(id); else if (total < maxOthers) next.add(id);
    onChange(selMembers, next);
  };
  const memberList = (members.data?.data ?? []).filter((m) => m.id !== meId && (!needle || norm(`${m.name}${m.category ?? ""}`).includes(needle)));
  const contactList = (contacts.data?.data ?? []).filter((c) => !needle || norm(`${c.name}${c.company ?? ""}${c.specialty ?? ""}`).includes(needle));

  return (
    <div>
      <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>自分を含めて最大{maxOthers + 1}名まで（いま自分以外に {total}/{maxOthers} 名を選択中）</p>
      <div className="flex gap-2 mb-2">
        {(["member", "contact"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className="flex-1 py-2 rounded-2xl text-sm font-medium"
            style={{ background: tab === t ? "var(--color-brand)" : "var(--color-paper-200)", color: tab === t ? "white" : "var(--color-ink-600)" }}>
            {t === "member" ? `メンバー（${selMembers.size}）` : `自分の外部人脈（${selContacts.size}）`}
          </button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・職種・会社で絞り込み" className="w-full px-3 py-2 rounded-xl border text-sm mb-2" style={{ borderColor: "var(--color-paper-300)" }} />
      <div className="overflow-y-auto space-y-1 rounded-xl p-2" style={{ background: "var(--color-paper-200)", minHeight: 160, maxHeight: 280 }}>
        {tab === "member"
          ? (members.isLoading ? <Loader2 size={18} className="animate-spin mx-auto my-4" /> : memberList.length === 0 ? <p className="text-xs text-center py-4" style={{ color: "var(--color-ink-500)" }}>該当するメンバーがいません</p> :
            memberList.map((m) => {
              const on = selMembers.has(m.id);
              return (
                <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer" style={{ opacity: !on && total >= maxOthers ? 0.45 : 1 }}>
                  <input type="checkbox" checked={on} onChange={() => toggleMember(m.id)} />
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${m.bgColor}`}>{m.emoji}</span>
                  <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "var(--color-ink-700)" }}>{m.name}{m.category && <span className="text-xs ml-1.5" style={{ color: "var(--color-ink-500)" }}>{m.category}</span>}</span>
                </label>
              );
            }))
          : (contacts.isLoading ? <Loader2 size={18} className="animate-spin mx-auto my-4" /> : contactList.length === 0 ? <p className="text-xs text-center py-4" style={{ color: "var(--color-ink-500)" }}>該当する外部人脈がありません</p> :
            contactList.map((c) => {
              const on = selContacts.has(c.id);
              return (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer" style={{ opacity: !on && total >= maxOthers ? 0.45 : 1 }}>
                  <input type="checkbox" checked={on} onChange={() => toggleContact(c.id)} />
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 bg-stone-100">👤</span>
                  <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "var(--color-ink-700)" }}>{c.name}<span className="text-xs ml-1.5" style={{ color: "var(--color-ink-500)" }}>{[c.specialty, c.company].filter(Boolean).join("／")}</span></span>
                </label>
              );
            }))}
      </div>
    </div>
  );
}
