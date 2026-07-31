import Matter from "matter-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHYSICS } from "../../shared/src/constants";
import { ServerGame } from "../../server/src/game/ServerGame";
import { level1 } from "../../server/src/levels/level1";

interface RuntimePlayer {
  body: Matter.Body;
  grounded: boolean;
  voidLocked: boolean;
  deadUntil: number;
}

function runtime(game: ServerGame, id: string): RuntimePlayer {
  return (game as unknown as { players: Map<string, RuntimePlayer> }).players.get(id)!;
}

function input(sequence: number, right = false) {
  return { sequence, left: false, right, jumpPressed: false, jumpHeld: false, clientTime: 0 };
}

describe("partial team void recovery", () => {
  afterEach(() => vi.useRealTimers());

  it("detaches and individually respawns a fallen player without immobilizing the survivor", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("fallen", "Fallen", 1);
    game.addPlayer("survivor", "Survivor", 2);
    const fallen = runtime(game, "fallen");
    const survivor = runtime(game, "survivor");

    Matter.Body.setPosition(fallen.body, { x: survivor.body.position.x, y: level1.deathY + 20 });
    game.step();
    expect(fallen.voidLocked).toBe(true);
    expect(fallen.deadUntil).toBe(Date.now() + PHYSICS.RESPAWN_DELAY_MS);

    survivor.grounded = true;
    expect(game.acceptInput("survivor", input(1, true))).toBe(true);
    game.step();
    expect(survivor.body.velocity.x * 60).toBeGreaterThan(0);
    expect(game.snapshot().ropes.every((rope) => rope.a !== "fallen" && rope.b !== "fallen")).toBe(true);

    vi.advanceTimersByTime(PHYSICS.RESPAWN_DELAY_MS + 1);
    game.step();
    expect(fallen.voidLocked).toBe(false);
    expect(fallen.deadUntil).toBe(0);
    expect(fallen.body.position.y).toBeLessThan(level1.deathY);
  });

  it("keeps the existing group reset when every connected player falls", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const game = new ServerGame();
    game.addPlayer("a", "A", 1);
    game.addPlayer("b", "B", 2);
    Matter.Body.setPosition(runtime(game, "a").body, { x: 100, y: level1.deathY + 20 });
    Matter.Body.setPosition(runtime(game, "b").body, { x: 140, y: level1.deathY + 20 });
    game.step();

    vi.advanceTimersByTime(PHYSICS.RESPAWN_DELAY_MS + 1);
    game.step();

    for (const id of ["a", "b"]) {
      const player = runtime(game, id);
      expect(player.voidLocked).toBe(false);
      expect(player.deadUntil).toBe(0);
      expect(player.body.position.y).toBeCloseTo(level1.spawn.y, 0);
    }
  });
});
