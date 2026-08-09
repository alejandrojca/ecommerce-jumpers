import Matter from "matter-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHYSICS } from "../../shared/src/constants";
import { ServerGame } from "../../server/src/game/ServerGame";
import { initialSpawnSlots, level1 } from "../../server/src/levels/level1";

interface RuntimePlayer {
  body: Matter.Body;
  exitedAt?: number;
  inWorld: boolean;
  voidLocked: boolean;
  deadUntil: number;
}

interface GameInternals {
  engine: Matter.Engine;
  players: Map<string, RuntimePlayer>;
  teamCharge: number;
  enterExit(player: RuntimePlayer, now: number): void;
}

const internals = (game: ServerGame): GameInternals => game as unknown as GameInternals;
const player = (game: ServerGame, id: string): RuntimePlayer => internals(game).players.get(id)!;

function exitPlayer(game: ServerGame, id: string, now: number): RuntimePlayer {
  const exited = player(game, id);
  internals(game).enterExit(exited, now);
  return exited;
}

function expectStillExited(game: ServerGame, exited: RuntimePlayer, exitedAt: number): void {
  expect(exited.exitedAt).toBe(exitedAt);
  expect(exited.inWorld).toBe(false);
  expect(Matter.Composite.allBodies(internals(game).engine.world).includes(exited.body)).toBe(false);
  expect(game.snapshot().players.find((candidate) => candidate.id === "exited")?.state).toBe("AtExit");
}

describe("exited players remain outside the match during respawns", () => {
  afterEach(() => vi.useRealTimers());

  it("does not restore an exited player after charge depletion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const now = Date.now();
    const game = new ServerGame();
    game.addPlayer("exited", "Exited", 1);
    game.addPlayer("a", "A", 2);
    game.addPlayer("b", "B", 3);
    const exited = exitPlayer(game, "exited", now);
    internals(game).teamCharge = 1;
    Matter.Body.setPosition(player(game, "a").body, { x: 400, y: 300 });
    Matter.Body.setPosition(player(game, "b").body, { x: 400 + PHYSICS.PLAYER_WIDTH - 2, y: 300 });
    game.step();

    vi.advanceTimersByTime(PHYSICS.RESPAWN_DELAY_MS + 1);
    game.step();

    expectStillExited(game, exited, now);
    const activeSpawnXs = [player(game, "a").body.position.x, player(game, "b").body.position.x]
      .sort((left, right) => left - right);
    const expectedSpawnXs = [initialSpawnSlots()[1]!.x, initialSpawnSlots()[2]!.x]
      .sort((left, right) => left - right);
    expect(activeSpawnXs[0]).toBeCloseTo(expectedSpawnXs[0]!, 0);
    expect(activeSpawnXs[1]).toBeCloseTo(expectedSpawnXs[1]!, 0);
  });

  it("preserves an exited player through partial and all-active void recovery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const now = Date.now();
    const game = new ServerGame();
    game.addPlayer("exited", "Exited", 1);
    game.addPlayer("a", "A", 2);
    game.addPlayer("b", "B", 3);
    const exited = exitPlayer(game, "exited", now);

    Matter.Body.setPosition(player(game, "a").body, { x: 500, y: level1.deathY + 20 });
    game.step();
    vi.advanceTimersByTime(PHYSICS.RESPAWN_DELAY_MS + 1);
    game.step();
    expectStillExited(game, exited, now);
    expect(player(game, "a").voidLocked).toBe(false);

    Matter.Body.setPosition(player(game, "a").body, { x: 500, y: level1.deathY + 20 });
    Matter.Body.setPosition(player(game, "b").body, { x: 600, y: level1.deathY + 20 });
    game.step();
    vi.advanceTimersByTime(PHYSICS.RESPAWN_DELAY_MS + 1);
    game.step();
    expectStillExited(game, exited, now);
    expect(player(game, "a").body.position.y).toBeCloseTo(initialSpawnSlots()[1]!.y, 0);
    expect(player(game, "b").body.position.y).toBeCloseTo(initialSpawnSlots()[2]!.y, 0);
  });

  it("restores exited players only when a new match is started", () => {
    const game = new ServerGame();
    game.addPlayer("exited", "Exited", 1);
    const exited = exitPlayer(game, "exited", Date.now());

    game.restart();

    expect(exited.exitedAt).toBeUndefined();
    expect(exited.inWorld).toBe(true);
    expect(exited.body.position.x).toBeCloseTo(initialSpawnSlots()[0]!.x, 0);
    expect(game.snapshot().players[0]?.state).not.toBe("AtExit");
  });
});
