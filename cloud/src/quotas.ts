// Limits per workspace plan. Sign-up is open to everyone, so every limit applies from day one. Pricing is
// undecided: everyone is on 'free', and a workspace's `plan` column picks another row here later.
export interface Quota {
  /** Workspaces a user can create. */
  workspacesPerUser: number;
  modelsPerWorkspace: number;
  membersPerWorkspace: number;
  /** Bytes of one model's JSON. The largest demo model is ~32 KB; 5,000-entity models are a few MB. */
  modelBytes: number;
  /** Saves per model per minute, across all its editors (the editor saves at most every 700 ms each). */
  savesPerMinute: number;
}

export const QUOTAS: Record<string, Quota> = {
  free: { workspacesPerUser: 3, modelsPerWorkspace: 50, membersPerWorkspace: 10, modelBytes: 5_000_000, savesPerMinute: 240 },
};

export const quotaFor = (plan: string): Quota => QUOTAS[plan] ?? QUOTAS.free;
