import {
  NETWORK, type GameSnapshot, type ObjectSnapshot, type PlayerSnapshot, type RopeSnapshot
} from "@tetherbound/shared";

interface StoredSnapshot {
  snapshot: GameSnapshot;
  receivedAt: number;
}

export class SnapshotBuffer {
  private snapshots: StoredSnapshot[] = [];
  private arrivalIntervals: number[] = [];

  push(snapshot: GameSnapshot, receivedAt = Date.now()): void {
    const previous = this.snapshots.at(-1);
    if (previous && snapshot.serverTime <= previous.snapshot.serverTime) return;
    if (previous) {
      this.arrivalIntervals.push(receivedAt - previous.receivedAt);
      if (this.arrivalIntervals.length > 30) this.arrivalIntervals.shift();
    }
    this.snapshots.push({ snapshot, receivedAt });
    if (this.snapshots.length > 40) this.snapshots.shift();
  }

  latest(): GameSnapshot | undefined { return this.snapshots.at(-1)?.snapshot; }

  samplePlayer(id: string, now = Date.now()): PlayerSnapshot | undefined {
    const pair = this.samplePair(now);
    if (!pair) return undefined;
    const { older, newer, t } = pair;
    const a = older.players.find((p) => p.id === id);
    const b = newer.players.find((p) => p.id === id);
    if (!a || !b) return b ?? a;
    return { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  sampleObject(id: string, now = Date.now()): ObjectSnapshot | undefined {
    const pair = this.samplePair(now);
    if (!pair) return undefined;
    const a = pair.older.objects.find((object) => object.id === id);
    const b = pair.newer.objects.find((object) => object.id === id);
    if (!a || !b) return b ?? a;
    return {
      ...b,
      x: a.x + (b.x - a.x) * pair.t,
      y: a.y + (b.y - a.y) * pair.t,
      width: a.width + (b.width - a.width) * pair.t,
      height: a.height + (b.height - a.height) * pair.t,
    };
  }

  sampleRope(aId: string, bId: string, now = Date.now()): RopeSnapshot | undefined {
    const pair = this.samplePair(now);
    if (!pair) return undefined;
    const matches = (rope: RopeSnapshot) => rope.a === aId && rope.b === bId;
    const a = pair.older.ropes.find(matches);
    const b = pair.newer.ropes.find(matches);
    if (!a || !b) return b ?? a;
    const points = a.points.length === b.points.length
      ? b.points.map((point, index) => ({
        x: a.points[index]!.x + (point.x - a.points[index]!.x) * pair.t,
        y: a.points[index]!.y + (point.y - a.points[index]!.y) * pair.t,
      }))
      : b.points;
    return {
      ...b,
      distance: a.distance + (b.distance - a.distance) * pair.t,
      tension: a.tension + (b.tension - a.tension) * pair.t,
      points,
    };
  }

  get measuredRate(): number {
    if (this.arrivalIntervals.length === 0) return 0;
    const average = this.arrivalIntervals.reduce((sum, value) => sum + value, 0) / this.arrivalIntervals.length;
    return average > 0 ? 1000 / average : 0;
  }

  get jitterMs(): number {
    if (this.arrivalIntervals.length < 2) return 0;
    const average = this.arrivalIntervals.reduce((sum, value) => sum + value, 0) / this.arrivalIntervals.length;
    const variance = this.arrivalIntervals.reduce((sum, value) => sum + (value - average) ** 2, 0)
      / this.arrivalIntervals.length;
    return Math.sqrt(variance);
  }

  private samplePair(now: number): { older: GameSnapshot; newer: GameSnapshot; t: number } | undefined {
    const latest = this.snapshots.at(-1);
    if (!latest) return undefined;
    const target = latest.snapshot.serverTime
      + (now - latest.receivedAt)
      - NETWORK.INTERPOLATION_DELAY_MS;
    let older = this.snapshots[0]!.snapshot;
    let newer = latest.snapshot;
    for (let index = 1; index < this.snapshots.length; index++) {
      const candidate = this.snapshots[index]!.snapshot;
      if (candidate.serverTime >= target) {
        older = this.snapshots[index - 1]!.snapshot;
        newer = candidate;
        break;
      }
    }
    const span = Math.max(1, newer.serverTime - older.serverTime);
    const t = Math.max(0, Math.min(1, (target - older.serverTime) / span));
    return { older, newer, t };
  }
}
