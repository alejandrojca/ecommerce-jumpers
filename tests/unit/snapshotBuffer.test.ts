import { describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@tetherbound/shared";
import { SnapshotBuffer } from "../../client/src/network/SnapshotBuffer";

const snapshot = (time: number, x: number): GameSnapshot => ({
  serverTick: time / 50, serverTime: time,
  players: [{ id: "p", name: "P", color: 1, x, y: 20, velocityX: 0, velocityY: 0, state: "Idle", facing: "right", grounded: true, connected: true, lastProcessedInput: 1, supportedHangingPlayers: 0 }],
  ropes: [], objects: [],
  keyState: { collected: false, x: 0, y: 0 },
  doorState: { open: false, inside: 0, required: 1, x: 0, y: 0 },
  matchState: "playing",
  victoryResults: []
});

describe("SnapshotBuffer", () => {
  it("interpolates a remote player between snapshots", () => {
    vi.setSystemTime(1200);
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1000, 0));
    buffer.push(snapshot(1200, 100));
    expect(buffer.samplePlayer("p", 1200)?.x).toBeCloseTo(50);
    vi.useRealTimers();
  });
});
