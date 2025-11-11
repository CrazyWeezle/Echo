export type HabitDef = {
  id: string;
  name: string;
  pos: number;
};

export type HabitParticipant = {
  userId: string;
  name?: string | null;
};

export type HabitUserProgress = {
  userId: string;
  name?: string | null;
  public: boolean;
  days: string[];
};

export type HabitLeaderboardEntry = {
  userId: string;
  name?: string | null;
  count: number;
};

export type HabitStatePayload = {
  defs: HabitDef[];
  my: Record<string, { trackerId?: string; public: boolean; days: string[] }>;
  publicByHabit: Record<string, HabitUserProgress[]>;
  optedByHabit: Record<string, string[]>;
  leaderboard?: HabitLeaderboardEntry[];
  participants?: HabitParticipant[];
};
