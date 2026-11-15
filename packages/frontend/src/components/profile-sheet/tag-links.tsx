// =============================================================
// 詳細画面の「タグ」の行
//   ・タグごとに、同じタグを付けた人（なかま・外部人脈）の数を出し、押すと、その一覧に飛ぶ
//   ・あなた自身のプロフィール（職種・事業内容・スキル）にも出てくる言葉のタグには「あなたとの共通点」の印を付ける
//   タグは、登録した本人だけが見られる
// =============================================================
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Globe, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { ProfileSheetSubjectType, PublicMember } from "@shared/types";
import { normTag, useSheetTags } from "./profile-sheet-shared";

type Props = { type: ProfileSheetSubjectType; subjectId: string; tags: string[] };

const NONE = <span style={{ color: "var(--color-ink-300)" }}>記載なし</span>;

/** 自分のプロフィールの言葉（比較用に正規化して、ひとつの文字列にする） */
function myProfileText(me: PublicMember | undefined): string {
  if (!me) return "";
  const parts = [me.category, me.businessDescription, me.company ?? "", me.role ?? ""];
  for (const sk of me.skills ?? []) parts.push(sk.name, sk.issue, sk.solution);
  return normTag(parts.join(" "));
}

export function TagLinks({ type, subjectId, tags }: Props) {
  const meId = useAuthStore((s) => s.user?.id);
  const { data: tagMap } = useSheetTags();
  // 自分のプロフィール（なかま一覧のデータに、自分も入っている）
  const { data: members } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<{ data: PublicMember[] }>("/members"),
    select: (r) => r.data,
  });
  const myText = useMemo(() => myProfileText(members?.find((m) => m.id === meId)), [members, meId]);

  const rows = useMemo(() => {
    // タグごとに、同じタグを付けた「他の」なかま・外部人脈の数
    const count = (map: Record<string, string[]> | undefined, key: string, skipId: string | null) =>
      Object.entries(map ?? {}).filter(([id, ts]) => id !== skipId && ts.some((t) => normTag(t) === key)).length;
    return tags.map((t) => {
      const key = normTag(t);
      return {
        tag: t,
        members: count(tagMap?.member, key, type === "member" ? subjectId : null),
        contacts: count(tagMap?.contact, key, type === "contact" ? subjectId : null),
        // 短すぎる言葉（1文字）は、たまたま含まれるだけなので、共通点とは見なさない
        common: key.length >= 2 && myText.includes(key),
      };
    });
  }, [tags, tagMap, type, subjectId, myText]);

  if (tags.length === 0) return NONE;

  const commonTags = rows.filter((r) => r.common);

  return (
    <div className="space-y-2">
      {commonTags.length > 0 && (
        <p className="text-xs rounded-xl px-2.5 py-1.5" style={{ background: "rgba(90,140,92,0.14)", color: "var(--color-ink-800)" }}>
          🤝 あなたとの共通点：{commonTags.map((r) => `#${r.tag}`).join(" ")}
          <span className="block text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>話のきっかけにどうぞ。あなたの職種・事業内容・スキルに出てくる言葉から見つけています。</span>
        </p>
      )}
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.tag} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="px-2 py-0.5 rounded-full text-[11px]"
              style={{ background: r.common ? "rgba(90,140,92,0.22)" : "rgba(212,160,59,0.18)", color: "var(--color-ink-700)", fontWeight: r.common ? 600 : 400 }}>
              {r.common ? "🤝 " : ""}#{r.tag}
            </span>
            {r.members > 0 && (
              <Link to={`/members?tag=${encodeURIComponent(r.tag)}`} className="inline-flex items-center gap-1 text-[11px] underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                <Users size={11} /> 同じタグのなかま {r.members}人
              </Link>
            )}
            {r.contacts > 0 && (
              <Link to={`/members?tab=contacts&tag=${encodeURIComponent(r.tag)}`} className="inline-flex items-center gap-1 text-[11px] underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                <Globe size={11} /> 同じタグの外部人脈 {r.contacts}人
              </Link>
            )}
            {r.members === 0 && r.contacts === 0 && tagMap && (
              <span className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>ほかに同じタグの人はいません</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
