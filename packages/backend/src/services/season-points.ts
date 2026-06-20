import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { schema } from "../db/index.ts";

export type SeasonPointConfig = {
  oneOnOne:          number;
  realCard:          number;
  questNormal:       number;
  questHard:         number;
  welcomeQuestBonus: number;
};

const DEFAULTS: SeasonPointConfig = {
  oneOnOne:          1,
  realCard:          1,
  questNormal:       5,
  questHard:         10,
  welcomeQuestBonus: 1,
};

export async function getActiveSeasonPoints(db: DrizzleD1Database<typeof schema>): Promise<SeasonPointConfig> {
  const season = await db
    .select()
    .from(schema.seasons)
    .where(eq(schema.seasons.isActive, 1))
    .get();

  if (!season) return DEFAULTS;
  return {
    oneOnOne:          season.pointOneOnOne          ?? DEFAULTS.oneOnOne,
    realCard:          season.pointRealCard           ?? DEFAULTS.realCard,
    questNormal:       season.pointQuestNormal        ?? DEFAULTS.questNormal,
    questHard:         season.pointQuestHard          ?? DEFAULTS.questHard,
    welcomeQuestBonus: season.pointWelcomeQuestBonus  ?? DEFAULTS.welcomeQuestBonus,
  };
}
