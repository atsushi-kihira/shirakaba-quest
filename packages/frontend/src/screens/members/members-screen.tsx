// =============================================================
// なかま一覧画面
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { PublicMember } from "@shared/types";

type MembersResponse = { data: PublicMember[] };

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  none:    { label: "未交流",   className: "bg-stone-200 text-stone-600 ring-stone-300" },
  digital: { label: "デジタル", className: "bg-amber-200 text-amber-900 ring-amber-300" },
  real:    { label: "リアル✕2", className: "bg-rose-500 text-white ring-rose-300" },
  self:    { label: "自分",     className: "bg-violet-100 text-violet-700 ring-violet-300" },
};

export function MembersScreen() {
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
  });

  const members = data?.data ?? [];
  const filtered = members.filter((m) =>
    search === "" ||
    m.name.includes(search) ||
    m.furigana.includes(search) ||
    m.category.includes(search)
  );

  return (
    <div className="px-4 py-6 pb-24">
      {/* ヘッダー */}
      <div className="mb-5">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          👥 なかま
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-500)" }}>
          1to1してカードを集めよう
        </p>
      </div>

      {/* 検索 */}
      <div className="relative mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
        <input
          type="text"
          placeholder="名前・職種で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-2xl pl-9 pr-4 py-2.5 text-sm outline-none"
          style={{
            background: "var(--color-paper-50)",
            border: "1.5px solid var(--color-paper-300)",
            color: "var(--color-ink-800)",
          }}
        />
      </div>

      {/* ローディング */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {/* エラー */}
      {error && (
        <div className="rounded-2xl p-4 text-sm" style={{ background: "var(--color-paper-200)", color: "#b91c1c" }}>
          ⚠️ データの取得に失敗しました
        </div>
      )}

      {/* メンバーリスト */}
      {!isLoading && !error && (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <p className="text-center py-8 text-sm" style={{ color: "var(--color-ink-400)" }}>
              見つかりませんでした
            </p>
          )}
          {filtered.map((member) => (
            <MemberCard key={member.id} member={member} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCard({ member }: { member: PublicMember }) {
  const connStatus = member.connectionStatus;
  const badge = STATUS_LABEL[connStatus] ?? STATUS_LABEL.none;

  return (
    <Link
      to={`/members/${member.id}`}
      className="card-paper rounded-2xl p-4 flex items-start gap-3 block transition hover:opacity-90 active:scale-[0.98]"
    >
      {/* アバター */}
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 ${member.bgColor}`}
      >
        {member.emoji}
      </div>

      {/* 情報 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>
            {member.name}
          </span>
          <span
            className={`skill-badge text-xs px-2 py-0.5 rounded-full ring-1 ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          {member.category}
          {member.company && ` · ${member.company}`}
        </p>
        {/* スキルバッジ（最大3つ） */}
        <div className="flex flex-wrap gap-1 mt-2">
          {member.skills.map((skill) => (
            <span
              key={skill.name}
              className={`text-xs px-2 py-0.5 rounded-full ring-1 ${skill.color}`}
            >
              {skill.emoji} {skill.name}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
