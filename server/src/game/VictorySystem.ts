import type { VictoryResult } from "@tetherbound/shared";

export interface VictoryPlayer {
  id: string;
  name: string;
  color: number;
}

export function recordFirstExit(
  exitTimes: Map<string, number>,
  playerId: string,
  matchStartedAt: number,
  now: number
): void {
  if (!exitTimes.has(playerId)) {
    exitTimes.set(playerId, Math.max(0, now - matchStartedAt));
  }
}

export function buildVictoryResults(
  players: VictoryPlayer[],
  exitTimes: ReadonlyMap<string, number>
): VictoryResult[] {
  return players
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      color: player.color,
      timeMs: exitTimes.get(player.id) ?? 0,
    }))
    .sort((a, b) => b.timeMs - a.timeMs || a.name.localeCompare(b.name));
}
