// =============================================================
// 協働マップ — 段階・停滞の判定ロジック
// =============================================================

export type CollabStage = "one" | "seed" | "loose";
export type StalledStatus = "active" | "stalled" | "intervene";

type LinkFlags = {
  possibleLow: number;
  possibleHigh: number;
  referralLow: number;
  referralHigh: number;
  oneOnOneCount: number;
};

/**
 * 段階を導出する。
 * possible・referral は「どちらか一方」ではなく「双方」がONのときのみ成立させる。
 * loose化にはさらに、このリンクについての協働の投稿（collaboration_post, context_type='link'）が
 * 1件以上存在すること（hasLoosePost）が必要。
 */
export function deriveStage(link: LinkFlags, hasLoosePost: boolean): CollabStage {
  const possible = !!link.possibleLow && !!link.possibleHigh;
  const referral = !!link.referralLow && !!link.referralHigh;

  if (referral && link.oneOnOneCount >= 3 && hasLoosePost) return "loose";
  if (possible) return "seed";
  return "one";
}

export function computeStalled(lastActivityAt: number | null, nowSec: number): StalledStatus {
  if (!lastActivityAt) return "active";
  const days = (nowSec - lastActivityAt) / 86400;
  if (days >= 60) return "intervene";
  if (days >= 30) return "stalled";
  return "active";
}
