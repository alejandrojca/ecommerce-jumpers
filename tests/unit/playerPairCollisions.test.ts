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

  it("emits one event for sustained contact and exposes no global counter", () => {
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    expect(game.snapshot()).not.toHaveProperty("teamCharge");
    collide(game, "a", "b");
    expect(game.drainPlayerContactEvents()).toEqual([{
      playerA: { id: "a", name: "A", color: 1 },
      playerB: { id: "b", name: "B", color: 2 },
      occurredAt: expect.any(Number),
      collisionCount: 1,
      collisionLimit: 3,
      fatal: false,
    }]);
    game.step();
    expect(game.drainPlayerContactEvents()).toEqual([]);
  });

  it("requires separation and the per-pair cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    collide(game, "a", "b");
    separate(game, "b");
    vi.advanceTimersByTime(PHYSICS.PLAYER_COLLISION_COOLDOWN_MS - 1);
    collide(game, "a", "b");
    expect(player(game, "a").deadUntil).toBe(0);
    separate(game, "b");
    vi.advanceTimersByTime(1);
    collide(game, "a", "b");
    expect(player(game, "a").deadUntil).toBe(0);
  });

  it("kills only the pair on its third valid collision and respawns each at its checkpoint", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    game.addPlayer("c", "C", 3);

    Matter.Body.setPosition(player(game, "a").body, { x: level1.checkpoint.x + 10, y: 300 });
    game.step();
    expect(player(game, "a").checkpoint).toEqual({ x: level1.checkpoint.x, y: level1.checkpoint.y });

    collide(game, "a", "b");
    collideAgainAfterCooldown(game, "a", "b");
    collideAgainAfterCooldown(game, "a", "b");

    expect(game.snapshot().players.find((p) => p.id === "a")?.state).toBe("Dead");
    expect(game.snapshot().players.find((p) => p.id === "a")?.electrocutedUntil).toBe(Date.now() + PHYSICS.RESPAWN_DELAY_MS);
    expect(game.snapshot().players.find((p) => p.id === "b")?.state).toBe("Dead");
    expect(game.snapshot().players.find((p) => p.id === "c")?.state).not.toBe("Dead");
    expect(player(game, "c").deadUntil).toBe(0);

    vi.advanceTimersByTime(PHYSICS.RESPAWN_DELAY_MS + 1);
    game.step();
    expect(player(game, "a").body.position.x).toBeCloseTo(level1.checkpoint.x, 0);
    expect(player(game, "a").body.position.y).toBeCloseTo(level1.checkpoint.y, 0);
    expect(player(game, "b").body.position.x).toBeCloseTo(initialSpawnSlots()[1]!.x, 0);
    expect(game.snapshot().players.find((p) => p.id === "a")?.electrocutedUntil).toBeUndefined();
  });

  it("tracks collision limits independently for different pairs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    game.addPlayer("c", "C", 3);
    collide(game, "a", "b");
    collideAgainAfterCooldown(game, "a", "b");
    separate(game, "b");
    collide(game, "a", "c");
    expect(player(game, "a").deadUntil).toBe(0);
    expect(player(game, "b").deadUntil).toBe(0);
    expect(player(game, "c").deadUntil).toBe(0);
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
