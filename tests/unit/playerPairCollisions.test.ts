import Matter from "matter-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHYSICS } from "../../shared/src/constants";
import { ServerGame } from "../../server/src/game/ServerGame";
import { initialSpawnSlots, level1 } from "../../server/src/levels/level1";

type Runtime = { body: Matter.Body; deadUntil: number; checkpoint: { x: number; y: number } };
const player = (game: ServerGame, id: string): Runtime =>
  (game as unknown as { players: Map<string, Runtime> }).players.get(id)!;

function collide(game: ServerGame, a: string, b: string): void {
  Matter.Body.setPosition(player(game, a).body, { x: 400, y: 300 });
  Matter.Body.setPosition(player(game, b).body, { x: 400 + PHYSICS.PLAYER_WIDTH - 2, y: 300 });
  Matter.Body.setVelocity(player(game, a).body, { x: 0, y: 0 });
  Matter.Body.setVelocity(player(game, b).body, { x: 0, y: 0 });
  game.step();
}

function separate(game: ServerGame, id: string): void {
  Matter.Body.setPosition(player(game, id).body, { x: 650, y: 300 });
  game.step();
  game.step();
}

function collideAgainAfterCooldown(game: ServerGame, a: string, b: string): void {
  separate(game, b);
  vi.advanceTimersByTime(PHYSICS.PLAYER_COLLISION_COOLDOWN_MS);
  collide(game, a, b);
}

describe("authoritative per-player-pair collisions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("never kills or emits effects for sustained and repeated contact", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    collide(game, "a", "b");
    game.step();
    expect(game.drainPlayerContactEvents()).toEqual([]);
    for (let index = 0; index < 10; index++) {
      collideAgainAfterCooldown(game, "a", "b");
      expect(game.drainPlayerContactEvents()).toEqual([]);
      for (const id of ["a", "b"]) {
        expect(player(game, id).deadUntil).toBe(0);
        expect(player(game, id).body.isStatic).toBe(false);
        expect(player(game, id).body.isSensor).toBe(false);
        const snapshot = game.snapshot().players.find((p) => p.id === id)!;
        expect(snapshot.state).not.toBe("Dead");
        expect(snapshot.electrocutedUntil).toBeUndefined();
      }
    }
  });

  it("spawns twelve players without overlap or an initial collision penalty", () => {
    const game = new ServerGame();
    for (let index = 0; index < 12; index++) game.addPlayer(`p${index}`, `P${index}`, index);
    const bodies = Array.from({ length: 12 }, (_, index) => player(game, `p${index}`).body);
    const entry = level1.platforms.find((platform) => platform.id === "forest-entry")!;
    for (let index = 0; index < bodies.length; index++) {
      const body = bodies[index]!;
      expect(body.bounds.min.x).toBeGreaterThanOrEqual(entry.x - entry.width / 2);
      expect(body.bounds.max.x).toBeLessThanOrEqual(entry.x + entry.width / 2);
      for (let other = index + 1; other < bodies.length; other++) {
        const b = bodies[other]!;
        expect(body.bounds.min.x < b.bounds.max.x && body.bounds.max.x > b.bounds.min.x).toBe(false);
      }
    }
    game.step();
    expect(game.snapshot()).not.toHaveProperty("teamCharge");
  });
});
