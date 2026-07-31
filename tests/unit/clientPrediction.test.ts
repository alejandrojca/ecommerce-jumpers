import { describe, expect, it } from "vitest";
import type { GameSnapshot, PlayerInput, PlayerSnapshot } from "@tetherbound/shared";
import { ClientPrediction } from "../../client/src/network/ClientPrediction";

const player = (overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id: "p",
  name: "Player",
  color: 0xffffff,
  x: 100,
  y: 604,
  velocityX: 0,
  velocityY: 0,
  state: "Idle",
  facing: "right",
  grounded: true,
  connected: true,
  lastProcessedInput: 0,
  supportedHangingPlayers: 0,
  ...overrides
});

const input = (sequence: number, jumpPressed = false): PlayerInput => ({
  sequence,
  left: false,
  right: false,
  jumpPressed,
  jumpHeld: jumpPressed,
  clientTime: sequence
});

const world = (local: PlayerSnapshot, others: PlayerSnapshot[] = []): GameSnapshot => ({
  serverTick: 1,
  serverTime: 1000,
  players: [local, ...others],
  ropes: [], teamCharge: { current: 6, max: 6 },
  objects: [{
    id: "platform:start", kind: "platform", x: 200, y: 650, width: 400, height: 50,
    velocityX: 0, velocityY: 0
  }],
  keyState: { collected: false, x: 0, y: 0 },
  doorState: { open: false, inside: 0, required: 1, x: 0, y: 0 },
  matchState: "playing",
  victoryResults: []
});

describe("ClientPrediction", () => {
  it("does not sink a grounded local player below the authoritative floor", () => {
    const prediction = new ClientPrediction();
    prediction.reconcile(player());
    for (let sequence = 1; sequence <= 10; sequence++) {
      prediction.predict(input(sequence), 1 / 60);
    }
    prediction.reconcile(player({ lastProcessedInput: 10 }));
    expect(prediction.y).toBe(604);
    expect(prediction.vy).toBe(0);
  });

  it("still predicts a grounded jump immediately", () => {
    const prediction = new ClientPrediction();
    prediction.reconcile(player());
    prediction.predict(input(1, true), 1 / 60);
    expect(prediction.y).toBeLessThan(604);
    expect(prediction.vy).toBeLessThan(0);
  });

  it("does not predict movement or jumping while the player is hanging in the void", () => {
    const prediction = new ClientPrediction();
    prediction.reconcile(player({ state: "Hanging", grounded: false }));
    prediction.predict({ ...input(1, true), right: true }, 1 / 60);
    expect(prediction.x).toBe(100);
    expect(prediction.vy).toBeGreaterThan(0);
  });

  it("replays each pending input only once during reconciliation", () => {
    const prediction = new ClientPrediction();
    prediction.reconcile(player());
    prediction.predict({ ...input(1), right: true }, 1 / 60);
    const before = prediction.x;
    prediction.reconcile(player({ lastProcessedInput: 0 }));
    expect(prediction.x).toBeCloseTo(before, 5);
  });

  it("lands predicted falling movement on a platform instead of crossing it", () => {
    const prediction = new ClientPrediction();
    const falling = player({
      y: 590, velocityY: 300, grounded: false, state: "Falling"
    });
    prediction.reconcile(falling, world(falling));
    for (let sequence = 1; sequence <= 10; sequence++) {
      prediction.predict(input(sequence), 1 / 60);
    }
    expect(prediction.y).toBeCloseTo(604);
    expect(prediction.vy).toBe(0);
  });

  it("snaps an authoritative grounded player to the reported support top", () => {
    const prediction = new ClientPrediction();
    const grounded = player({
      y: 612,
      support: { id: "platform:start", topY: 625, velocityX: 0, velocityY: 0 }
    });
    prediction.reconcile(grounded, world(grounded));
    expect(prediction.y).toBe(604);
  });

  it("uses the same grounded acceleration and stopping law as the server", () => {
    const prediction = new ClientPrediction();
    prediction.reconcile(player());
    prediction.predict({ ...input(1), right: true }, 1 / 60);
    expect(prediction.vx).toBeCloseTo(30, 6);
    prediction.predict(input(2), 1 / 60);
    expect(prediction.vx).toBe(0);
  });

  it("predicts a horizontal platform collision instead of crossing it", () => {
    const prediction = new ClientPrediction();
    const local = player({ x: 80, y: 604, velocityX: 240 });
    const snapshot = world(local);
    snapshot.objects.push({
      id: "platform:wall", kind: "platform", x: 102, y: 604,
      width: 12, height: 100, velocityX: 0, velocityY: 0
    });
    prediction.reconcile(local, snapshot);
    prediction.predict({ ...input(1), right: true }, 1 / 60);
    expect(prediction.x).toBeLessThanOrEqual(80);
    expect(prediction.vx).toBe(0);
  });

  it("keeps rendering continuous for a large active-play reconciliation", () => {
    const prediction = new ClientPrediction();
    prediction.reconcile(player({ x: 100 }));
    const before = prediction.x;
    const error = prediction.reconcile(player({ x: 210, lastProcessedInput: 1 }));
    expect(error).toBeGreaterThan(80);
    expect(prediction.x).toBeCloseTo(before, 6);
    prediction.predict(input(2), 1 / 60);
    expect(prediction.x).toBeGreaterThan(before);
    expect(prediction.x).toBeLessThan(210);
  });
});
