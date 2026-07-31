import Matter from "matter-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHYSICS } from "../../shared/src/constants";
import { ServerGame } from "../../server/src/game/ServerGame";
import { initialSpawnSlots, level1 } from "../../server/src/levels/level1";

type Runtime = { body: Matter.Body; deadUntil: number };
const player = (game: ServerGame, id: string): Runtime =>
  (game as unknown as { players: Map<string, Runtime> }).players.get(id)!;

function collide(game: ServerGame, a: string, b: string): void {
  const pa = player(game, a).body;
  Matter.Body.setPosition(pa, { x: 400, y: 300 });
  Matter.Body.setPosition(player(game, b).body, { x: 400 + PHYSICS.PLAYER_WIDTH - 2, y: 300 });
  Matter.Body.setVelocity(pa, { x: 0, y: 0 });
  Matter.Body.setVelocity(player(game, b).body, { x: 0, y: 0 });
  game.step();
}

function separate(game: ServerGame, id: string): void {
  Matter.Body.setPosition(player(game, id).body, { x: 650, y: 300 });
  game.step();
  // Matter retains an inactive pair for one engine update; advance once more
  // so the authoritative edge detector observes a real separation.
  game.step();
}

describe("authoritative global team charge", () => {
  afterEach(() => vi.useRealTimers());

  it("starts full and counts a sustained contact only once", () => {
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    expect(game.snapshot().teamCharge).toEqual({ current: 6, max: 6 });
    collide(game, "a", "b");
    expect(game.snapshot().teamCharge.current).toBe(5);
    game.step();
    expect(game.snapshot().teamCharge.current).toBe(5);
  });

  it("requires both separation and the 1500ms per-pair cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    collide(game, "a", "b");
    separate(game, "b");
    vi.advanceTimersByTime(PHYSICS.PLAYER_COLLISION_COOLDOWN_MS - 1);
    collide(game, "a", "b");
    expect(game.snapshot().teamCharge.current).toBe(5);
    separate(game, "b");
    vi.advanceTimersByTime(1);
    collide(game, "a", "b");
    expect(game.snapshot().teamCharge.current).toBe(4);
  });

  it("kills the active team on the sixth collision and restores six charge at initial spawn", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    for (let count = 0; count < 6; count++) {
      collide(game, "a", "b");
      if (count < 5) {
        separate(game, "b");
        vi.advanceTimersByTime(PHYSICS.PLAYER_COLLISION_COOLDOWN_MS);
      }
    }
    expect(game.snapshot().teamCharge.current).toBe(0);
    expect(game.snapshot().players.every((p) => p.state === "Dead")).toBe(true);
    vi.advanceTimersByTime(PHYSICS.RESPAWN_DELAY_MS + 1);
    game.step();
    expect(game.snapshot().teamCharge.current).toBe(6);
    expect(Math.abs(player(game, "a").body.position.x - initialSpawnSlots()[0]!.x)).toBeLessThan(3);
    expect(Math.abs(player(game, "a").body.position.y - initialSpawnSlots()[0]!.y)).toBeLessThan(3);
  });

  it("does not constrain separated players and never emits ropes", () => {
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    Matter.Body.setPosition(player(game, "a").body, { x: 50, y: 300 });
    Matter.Body.setPosition(player(game, "b").body, { x: 2000, y: 300 });
    game.step();
    expect(game.snapshot().ropes).toEqual([]);
    expect(Math.abs(player(game, "b").body.position.x - player(game, "a").body.position.x)).toBeGreaterThan(1500);
  });

  it("counts simultaneous eligible pairs and excludes disconnected players", () => {
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    game.addPlayer("c", "C", 3);
    Matter.Body.setPosition(player(game, "a").body, { x: 400, y: 300 });
    Matter.Body.setPosition(player(game, "b").body, { x: 400 + PHYSICS.PLAYER_WIDTH - 2, y: 300 });
    Matter.Body.setPosition(player(game, "c").body, { x: 400 + (PHYSICS.PLAYER_WIDTH - 2) * 2, y: 300 });
    game.setConnected("c", false);
    game.step();
    expect(game.snapshot().teamCharge.current).toBe(5);
  });

  it("tracks cooldown independently for different player pairs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    game.addPlayer("c", "C", 3);
    collide(game, "a", "b");
    separate(game, "b");
    collide(game, "a", "c");
    expect(game.snapshot().teamCharge.current).toBe(4);
  });

  it("spawns twelve grounded players without overlap or an initial charge loss", () => {
    const game = new ServerGame();
    for (let index = 0; index < 12; index++) game.addPlayer(`p${index}`, `P${index}`, index);
    const bodies = Array.from({ length: 12 }, (_, index) => player(game, `p${index}`).body);
    const entry = level1.platforms.find((platform) => platform.id === "forest-entry")!;
    for (let index = 0; index < bodies.length; index++) {
      const body = bodies[index]!;
      expect(body.bounds.min.x).toBeGreaterThanOrEqual(entry.x - entry.width / 2);
      expect(body.bounds.max.x).toBeLessThanOrEqual(entry.x + entry.width / 2);
      expect(body.bounds.max.y).toBeCloseTo(entry.y - entry.height / 2, 5);
      for (let other = index + 1; other < bodies.length; other++) {
        const b = bodies[other]!;
        const overlaps = body.bounds.min.x < b.bounds.max.x && body.bounds.max.x > b.bounds.min.x
          && body.bounds.min.y < b.bounds.max.y && body.bounds.max.y > b.bounds.min.y;
        expect(overlaps).toBe(false);
      }
    }
    game.step();
    expect(game.snapshot().teamCharge).toEqual({ current: 6, max: 6 });
  });
});
