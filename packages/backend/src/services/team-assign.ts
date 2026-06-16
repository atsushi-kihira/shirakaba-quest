// =============================================================
// チーム自動振り分けサービス
// =============================================================
import type { Skill } from "@shared/types";

export type MemberForAssign = {
  id: string;
  name: string;
  category: string;
  businessDescription: string;
  skills: Skill[];
};

export type TeamAssignment = {
  teamIndex: number;
  memberIds: string[];
  leaderId?: string;
};

/** ランダム振り分け */
export function randomAssign(
  members: MemberForAssign[],
  teamSize: number,
  leaderIds: string[] = []
): TeamAssignment[] {
  // シャッフル（リーダー以外）
  const nonLeaders = members.filter((m) => !leaderIds.includes(m.id));
  const shuffled = [...nonLeaders].sort(() => Math.random() - 0.5);

  const teamCount = Math.ceil(members.length / teamSize);
  const assignments: TeamAssignment[] = Array.from({ length: teamCount }, (_, i) => ({
    teamIndex: i,
    memberIds: [],
    leaderId: leaderIds[i],
  }));

  // リーダーを各チームに配置
  leaderIds.forEach((leaderId, i) => {
    if (assignments[i]) assignments[i].memberIds.push(leaderId);
  });

  // 残りをラウンドロビン
  shuffled.forEach((m, idx) => {
    assignments[idx % teamCount].memberIds.push(m.id);
  });

  return assignments;
}

/** AI振り分け（Anthropic API使用） */
export async function aiAssign(
  members: MemberForAssign[],
  teamSize: number,
  prompt: string,
  anthropicApiKey: string
): Promise<TeamAssignment[]> {
  const memberList = members.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    skills: m.skills.map((s) => s.name),
  }));

  const systemPrompt = `あなたはチーム編成の専門家です。以下のメンバーリストを、1チームあたり約${teamSize}名になるようにバランスよくチーム分けしてください。
JSONのみを返してください。フォーマット: [{"teamIndex":0,"memberIds":["id1","id2"]},...]`;

  const userContent = `メンバー情報:\n${JSON.stringify(memberList, null, 2)}\n\n振り分けの方針:\n${prompt}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);

  const json = await resp.json() as { content: Array<{ type: string; text: string }> };
  const text = json.content.find((c) => c.type === "text")?.text ?? "[]";

  // JSON部分を抽出してパース
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("AI response did not contain valid JSON array");

  const raw = JSON.parse(match[0]) as Array<{ teamIndex: number; memberIds: string[] }>;
  return raw.map((t) => ({ teamIndex: t.teamIndex, memberIds: t.memberIds }));
}
