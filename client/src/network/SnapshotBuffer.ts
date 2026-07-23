import { NETWORK, type GameSnapshot, type PlayerSnapshot } from "@tetherbound/shared";

export class SnapshotBuffer {
  private snapshots: GameSnapshot[] = [];

  push(snapshot: GameSnapshot): void {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 40) this.snapshots.shift();
  }

  latest(): GameSnapshot | undefined { return this.snapshots.at(-1); }

  samplePlayer(id: string, now = Date.now()): PlayerSnapshot | undefined {
    const target = now - NETWORK.INTERPOLATION_DELAY_MS;
    if (this.snapshots.length === 0) return undefined;
    let older = this.snapshots[0]!;
    let newer = this.snapshots.at(-1)!;
    for (let i = 1; i < this.snapshots.length; i++) {
      if (this.snapshots[i]!.serverTime >= target) {
        older = this.snapshots[i - 1]!;
        newer = this.snapshots[i]!;
        break;
      }
    }
    const a = older.players.find((p) => p.id === id);
    const b = newer.players.find((p) => p.id === id);
    if (!a || !b) return b ?? a;
    const span = Math.max(1, newer.serverTime - older.serverTime);
    const t = Math.max(0, Math.min(1, (target - older.serverTime) / span));
    return { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
}
