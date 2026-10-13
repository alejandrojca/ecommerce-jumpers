import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import {
  PHYSICS,
  jumpVelocityFor,
  validateObstacle,
  type PlayerInput,
  type PlayerSnapshot,
  type GameSnapshot,
} from "@tetherbound/shared";
import { ClientPrediction } from "../../client/src/network/ClientPrediction";
import { findGroundContact } from "../../server/src/game/GroundContactSystem";
import { level1 } from "../../server/src/levels/level1";

const groundedPlayer = (y = 604): PlayerSnapshot => ({
  id: "p", name: "P", color: 0, x: 100, y,
  velocityX: 0, velocityY: 0, state: "Idle", facing: "right",
  grounded: true, connected: true, lastProcessedInput: 0,
  supportedHangingPlayers: 0,
});

const command = (sequence: number, jumpPressed: boolean, jumpHeld = jumpPressed): PlayerInput => ({
  sequence, left: false, right: false, jumpPressed, jumpHeld, clientTime: sequence,
});

function simulateJump(fps: number, held = true, extraPressAt?: number) {
  const prediction = new ClientPrediction();
  const start = groundedPlayer();
  prediction.reconcile(start);
  const startFeet = start.y + PHYSICS.PLAYER_HEIGHT / 2;
  let minimumFeet = startFeet;
  for (let frame = 0; frame < fps * 2; frame++) {
    const press = frame === 0 || frame === extraPressAt;
    prediction.predict(command(frame + 1, press, held || press), 1 / fps);
    minimumFeet = Math.min(minimumFeet, prediction.y + PHYSICS.PLAYER_HEIGHT / 2);
  }
  return { rise: startFeet - minimumFeet, prediction };
}

function obstacleWorld(local: PlayerSnapshot): GameSnapshot {
  const groundTop = 625;
  const obstacleTop = groundTop - PHYSICS.PLAYER_HEIGHT;
  return {
    serverTick: 1, serverTime: 0, players: [local], ropes: [],
    objects: [
      { id: "ground", kind: "platform", x: 100, y: 650, width: 240, height: 50, velocityX: 0, velocityY: 0 },
      { id: "full-height-step", kind: "platform", x: 200, y: obstacleTop + 20, width: 120, height: 40, velocityX: 0, velocityY: 0 },
    ],
    keyState: { collected: false, x: 0, y: 0 },
    doorState: { open: false, inside: 0, required: 1, x: 0, y: 0 },
    matchState: "playing", victoryResults: [],
  };
}

describe("global jump and obstacle rules", () => {
  it("clears a full-character obstacle comfortably with a normal jump", () => {
    const prediction = new ClientPrediction();
    const local = { ...groundedPlayer(), support: { id: "ground", topY: 625, velocityX: 0, velocityY: 0 } };
    prediction.reconcile(local, obstacleWorld(local));
    // A broad input window proves this is a normal running jump, not a
    // single-frame/edge-position trick.
    const obstacleTop = 625 - PHYSICS.PLAYER_HEIGHT;
    const landingY = obstacleTop - PHYSICS.PLAYER_HEIGHT / 2;
    let landed = false;
    for (let frame = 0; frame < 90; frame++) {
      prediction.predict({ ...command(frame + 1, frame === 0, true), right: true }, 1 / 60);
      if (Math.abs(prediction.y - landingY) < 0.001 && prediction.vy === 0) {
        landed = true;
        break;
      }
    }
    expect(landed).toBe(true);
    expect(prediction.y).toBeCloseTo(landingY, 5);
    expect(prediction.x).toBeGreaterThan(140);
    // Landing is valid while the collider still overlaps the platform. With
    // server-matched ground acceleration the center can advance slightly past
    // the platform edge during the landing tick without falling off it.
    expect(prediction.x - PHYSICS.PLAYER_WIDTH / 2).toBeLessThan(260);
  });

  it("limits maximum feet rise to approximately three collider heights", () => {
    const { rise } = simulateJump(60);
    expect(jumpVelocityFor(PHYSICS.PLAYER_HEIGHT)).toBeCloseTo(-PHYSICS.JUMP_VELOCITY, 8);
    expect(rise).toBeGreaterThan(PHYSICS.MAX_JUMP_HEIGHT - 6);
    expect(rise).toBeLessThanOrEqual(PHYSICS.MAX_JUMP_HEIGHT);
  });

  it("clamps every mandatory upward level step against its local support", () => {
    const surfaces = new Map(
      [...level1.platforms, level1.movingPlatform]
        .map((surface) => [surface.id, surface.y - surface.height / 2])
    );
    expect(level1.mandatoryAscents.length).toBeGreaterThan(0);
    for (const ascent of level1.mandatoryAscents) {
      const supportTop = surfaces.get(ascent.supportId);
      const obstacleTop = surfaces.get(ascent.obstacleId);
      expect(supportTop, `unknown support ${ascent.supportId}`).toBeDefined();
      expect(obstacleTop, `unknown obstacle ${ascent.obstacleId}`).toBeDefined();
      expect(
        supportTop! - obstacleTop!,
        `${ascent.supportId} -> ${ascent.obstacleId}`
      ).toBeLessThanOrEqual(PHYSICS.MAX_OBSTACLE_HEIGHT);
    }
    const local = validateObstacle({ topY: 300 }, 400);
    expect(400 - local.topY).toBe(PHYSICS.PLAYER_HEIGHT);
  });

  it("produces a stable maximum height at different FPS", () => {
    const rises = [30, 60, 120].map((fps) => simulateJump(fps).rise);
    expect(Math.max(...rises) - Math.min(...rises)).toBeLessThan(0.5);
  });

  it("does not perform a second jump in the air", () => {
    const normal = simulateJump(60).rise;
    const attemptedDoubleJump = simulateJump(60, true, 12).rise;
    expect(attemptedDoubleJump).toBeCloseTo(normal, 8);
  });

  it("does not gain indefinite height while jump is held", () => {
    expect(simulateJump(60, true).rise).toBeLessThanOrEqual(PHYSICS.MAX_JUMP_HEIGHT);
  });

  it("does not treat brushing a platform side as a landing", () => {
    const engine = Matter.Engine.create();
    engine.gravity.y = 0;
    const player = Matter.Bodies.rectangle(30, 0, PHYSICS.PLAYER_WIDTH, PHYSICS.PLAYER_HEIGHT);
    const wall = Matter.Bodies.rectangle(50, 0, 20, 200, { isStatic: true });
    Matter.Composite.add(engine.world, [player, wall]);
    Matter.Engine.update(engine, 1000 / 60);
    expect(findGroundContact(player, engine.pairs.list)).toBeUndefined();
  });

  it("measures jump height from the initial feet rather than the center", () => {
    const { rise, prediction } = simulateJump(60);
    const initialFeet = groundedPlayer().y + PHYSICS.PLAYER_HEIGHT / 2;
    const highestFeet = initialFeet - rise;
    expect(initialFeet - highestFeet).toBeGreaterThan(PHYSICS.MAX_JUMP_HEIGHT - 6);
    expect(groundedPlayer().y - highestFeet).not.toBeCloseTo(PHYSICS.MAX_JUMP_HEIGHT, 1);
    expect(Number.isFinite(prediction.y)).toBe(true);
  });
});

  it("defines the Forest Ruins route with unique gameplay ids and valid endpoints", () => {
    const surfaces = [...level1.platforms, level1.movingPlatform];
    const ids = [
      ...surfaces.map((surface) => surface.id),
      ...level1.boxes.map((box) => box.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(surfaces.map((surface) => surface.id)).toEqual(expect.arrayContaining([
      "forest-entry", "high-trail", "meadow", "river-bridge", "lookout",
      "ruins-floor", "key-step", "key-dais", "exit-causeway",
    ]));
    expect(level1.spawn.x).toBeGreaterThanOrEqual(0);
    expect(level1.spawn.x).toBeLessThan(level1.checkpoint.x);
    expect(level1.checkpoint.x).toBeLessThan(level1.key.x);
    expect(level1.key.x).toBeLessThan(level1.door.x);
    expect(level1.door.x + level1.door.width / 2).toBeLessThanOrEqual(level1.width);
    expect(level1.deathY).toBeGreaterThan(level1.height);
  });

  it("declares a complete, comfortable mandatory ascent route", () => {
    const surfaces = new Map(
      [...level1.platforms, level1.movingPlatform]
        .map((surface) => [surface.id, surface] as const)
    );
    expect(level1.mandatoryAscents).toEqual([
      { supportId: "forest-entry", obstacleId: "trail-step" },
      { supportId: "trail-step", obstacleId: "high-trail" },
      { supportId: "meadow", obstacleId: "bridge-approach" },
      { supportId: "bridge-approach", obstacleId: "river-bridge" },
      { supportId: "river-bridge", obstacleId: "lookout" },
      { supportId: "ruins-floor", obstacleId: "key-step" },
      { supportId: "key-step", obstacleId: "key-dais" },
    ]);
    for (const { supportId, obstacleId } of level1.mandatoryAscents) {
      const support = surfaces.get(supportId)!;
      const obstacle = surfaces.get(obstacleId)!;
      const rise = (support.y - support.height / 2) - (obstacle.y - obstacle.height / 2);
      expect(rise, `${supportId} -> ${obstacleId}`).toBeGreaterThanOrEqual(0);
      expect(rise, `${supportId} -> ${obstacleId}`).toBeLessThanOrEqual(PHYSICS.PLAYER_HEIGHT);
      // Required landings remain broad enough that success is not pixel-perfect.
      expect(obstacle.width).toBeGreaterThanOrEqual(100);
    }
  });
