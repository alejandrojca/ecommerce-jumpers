import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceJumpControl, initialJumpMotion, jumpGravity, PHYSICS, type EditableMapDefinition, type PlayerInput } from "@tetherbound/shared";
import { ServerGame } from "../../server/src/game/ServerGame";
import { ClientPrediction } from "../../client/src/network/ClientPrediction";

const input = (sequence: number, held: boolean, press = false): PlayerInput => ({
  sequence, left: false, right: false, jumpPressed: press, jumpHeld: held, clientTime: 0,
});
const map = (ceiling = false): EditableMapDefinition => ({
  schemaVersion: 1, id: "jump", name: "Jump", width: 1000, height: 800,
  background: { preset: "sky" }, createdAt: "", updatedAt: "",
  objects: [
    { id: "spawn", kind: "spawn", name: "spawn", x: 100, y: 604, width: 42, height: 58, texture: "crystal" },
    { id: "floor", kind: "platform", name: "floor", x: 500, y: 650, width: 1000, height: 50, texture: "grass" },
    { id: "key", kind: "key", name: "key", x: 900, y: 300, width: 42, height: 42, texture: "crystal" },
    { id: "door", kind: "door", name: "door", x: 950, y: 604, width: 70, height: 110, texture: "stone" },
    ...(ceiling ? [{ id: "roof", kind: "platform" as const, name: "roof", x: 500, y: 525, width: 1000, height: 20, texture: "stone" as const }] : []),
  ],
});

afterEach(() => vi.useRealTimers());

function flight(releaseAt: number, ceiling = false) {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const game = new ServerGame(map(ceiling));
  game.addPlayer("p", "P", 0);
  for (let tick = 0; tick < 20; tick++) { vi.advanceTimersByTime(1000 / 60); game.step(); }
  const start = game.snapshot();
  expect(start.players[0]!.grounded).toBe(true);
  const prediction = new ClientPrediction();
  prediction.reconcile(start.players[0]!, start);
  let minServer = start.players[0]!.y;
  let minClient = prediction.y;
  let maxError = 0;
  let landedAt = 0;
  for (let tick = 0; tick < 100; tick++) {
    const command = input(tick + 1, tick < releaseAt, tick === 0);
    game.acceptInput("p", command);
    vi.advanceTimersByTime(1000 / 60);
    game.step();
    prediction.predict(command, 1 / 60);
    const player = game.snapshot().players[0]!;
    minServer = Math.min(minServer, player.y);
    minClient = Math.min(minClient, prediction.y);
    maxError = Math.max(maxError, Math.abs(player.y - prediction.y));
    if (!landedAt && tick > 2 && player.grounded) landedAt = tick;
  }
  return { serverRise: start.players[0]!.y - minServer, clientRise: start.players[0]!.y - minClient, maxError, landedAt, game };
}

describe("precise platformer jumping", () => {
  it("cuts a tap once, while a held jump retains the 126 px upper bound", () => {
    const full = flight(100);
    const tap = flight(1);
    expect(full.serverRise).toBeGreaterThan(120);
    expect(full.serverRise).toBeLessThanOrEqual(126);
    expect(tap.serverRise).toBeLessThan(full.serverRise / 2);
    expect(tap.clientRise).toBeLessThan(full.clientRise / 2);
    expect(full.maxError).toBeLessThan(2);
    expect(tap.maxError).toBeLessThan(2);
    expect(tap.landedAt).toBeLessThan(full.landedAt);
    expect(full.game.snapshot().players[0]!.grounded).toBe(true);
  });

  it("uses stronger falling gravity without accelerating the ascent", () => {
    expect(jumpGravity(-1)).toBe(PHYSICS.GRAVITY);
    expect(jumpGravity(0)).toBeGreaterThan(PHYSICS.GRAVITY);
    expect(jumpGravity(100)).toBe(PHYSICS.GRAVITY * 1.65);
  });

  it("consumes coyote once and buffers a released tap until landing", () => {
    const state = initialJumpMotion();
    advanceJumpControl(state, 1000, true, 0, 625, false);
    state.jumpBufferedUntil = 1170;
    expect(advanceJumpControl(state, 1050, false, 10, 626, true).jumped).toBe(true);
    state.jumpBufferedUntil = 1180;
    expect(advanceJumpControl(state, 1060, false, -500, 620, true).jumped).toBe(false);
    expect(advanceJumpControl(state, 1200, true, 0, 625, true).jumped).toBe(false);
    state.jumpBufferedUntil = 1350;
    const buffered = advanceJumpControl(state, 1300, true, 0, 625, false);
    expect(buffered.jumped).toBe(true);
    expect(buffered.velocityY).toBe(PHYSICS.JUMP_VELOCITY * PHYSICS.JUMP_CUT_MULTIPLIER);
    expect(advanceJumpControl(state, 1310, false, buffered.velocityY, 620, false).velocityY).toBe(buffered.velocityY);
  });

  it("stops rising at a ceiling in server physics and prediction", () => {
    const result = flight(100, true);
    expect(result.serverRise).toBeLessThanOrEqual(59);
    expect(result.clientRise).toBeLessThanOrEqual(59);
    expect(result.game.snapshot().players[0]!.grounded).toBe(true);
  });

  it("does not retrigger a held press or restore consumed coyote from stale launch contact", () => {
    const result = flight(100);
    const game = result.game;
    game.acceptInput("p", input(101, true, true));
    game.step();
    expect(game.snapshot().players[0]!.grounded).toBe(true);
    game.acceptInput("p", input(102, false));
    game.step();
    game.acceptInput("p", input(103, true, true));
    game.step();
    expect(game.snapshot().players[0]!.grounded).toBe(false);
    expect(game.snapshot().players[0]!.jumpMotion!.coyoteUntil).toBe(0);
  });

  it("replays released pending input without cutting an authoritative jump twice", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const game = new ServerGame(map());
    game.addPlayer("p", "P", 0);
    for (let tick = 0; tick < 20; tick++) game.step();
    game.acceptInput("p", input(1, true, true));
    game.step();
    game.acceptInput("p", input(2, false));
    game.step();
    const snapshot = game.snapshot();
    const local = snapshot.players[0]!;
    expect(local.jumpMotion!.jumpCutApplied).toBe(true);
    const prediction = new ClientPrediction();
    prediction.reconcile(local, snapshot);
    prediction.predict(input(3, false), 1 / 60);
    const expected = prediction.vy;
    prediction.reconcile(local, snapshot);
    expect(prediction.vy).toBeCloseTo(expected, 8);
    expect(prediction.vy).toBeLessThan(local.velocityY * PHYSICS.JUMP_CUT_MULTIPLIER);
  });
});
