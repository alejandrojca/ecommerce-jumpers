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
  const results = players
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      color: player.color,
      timeMs: exitTimes.get(player.id) ?? 0,
    }));
  return results.sort((a, b) => {
    const aFinished = exitTimes.has(a.playerId);
    const bFinished = exitTimes.has(b.playerId);
    if (aFinished !== bFinished) return aFinished ? 1 : -1;
    return b.timeMs - a.timeMs
      || a.name.localeCompare(b.name, "es")
      || a.playerId.localeCompare(b.playerId);
  });
}
