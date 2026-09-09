import { describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@tetherbound/shared";
import { SnapshotBuffer } from "../../client/src/network/SnapshotBuffer";

const snapshot = (time: number, x: number): GameSnapshot => ({
  serverTick: time / 50, serverTime: time,
  players: [{ id: "p", name: "P", color: 1, x, y: 20, velocityX: 0, velocityY: 0, state: "Idle", facing: "right", grounded: true, connected: true, lastProcessedInput: 1, supportedHangingPlayers: 0 }],
  ropes: [{ a: "p", b: "q", distance: x, tension: x, active: true, points: [{ x, y: 10 }] }],
  objects: [{
    id: "moving", kind: "platform", x, y: 30, width: 80, height: 20,
    velocityX: 0, velocityY: 0
  }],
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
    expect(buffer.sampleObject("moving", 1200)?.x).toBeCloseTo(50);
    expect(buffer.sampleRope("p", "q", 1200)?.tension).toBeCloseTo(50);
    expect(buffer.sampleRope("p", "q", 1200)?.points[0]?.x).toBeCloseTo(50);
    vi.useRealTimers();
  });

  it("measures snapshot cadence and jitter from local arrival times", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1000, 0), 2000);
    buffer.push(snapshot(1050, 10), 2050);
    buffer.push(snapshot(1100, 20), 2100);
    expect(buffer.measuredRate).toBeCloseTo(20);
    expect(buffer.jitterMs).toBe(0);
  });

  it("does not interpolate a remote player across a death teleport", () => {
    const buffer = new SnapshotBuffer();
    const alive = snapshot(1000, 500);
    const dead = snapshot(1050, -200);
    dead.players[0]!.state = "Dead";
    buffer.push(alive, 1000);
    buffer.push(dead, 1050);
    expect(buffer.samplePlayer("p", 1100)?.x).toBe(-200);
    expect(buffer.samplePlayer("p", 1100)?.state).toBe("Dead");
  });
});
