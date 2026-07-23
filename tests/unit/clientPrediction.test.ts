import { describe, expect, it } from "vitest";
import type { PlayerInput, PlayerSnapshot } from "@tetherbound/shared";
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
});
