import {
  OBSTACLE_HEIGHTS, PHYSICS, ROOM_MAX_PLAYERS, validateObstacle, type EditableMapDefinition
} from "@tetherbound/shared";

export interface RectDef { id: string; x: number; y: number; width: number; height: number }
export interface MandatoryAscent { supportId: string; obstacleId: string }

const ENTRY = { x: 230, topY: 625, width: 460 } as const;

/** Deterministic, grounded, non-overlapping slots spanning the initial platform. */
export function initialSpawnSlots(count = ROOM_MAX_PLAYERS): { x: number; y: number }[] {
  if (!Number.isInteger(count) || count < 1 || count > ROOM_MAX_PLAYERS) {
    throw new RangeError(`spawn count must be between 1 and ${ROOM_MAX_PLAYERS}`);
  }
  const margin = 2;
  const minX = ENTRY.x - ENTRY.width / 2 + PHYSICS.PLAYER_WIDTH / 2 + margin;
  const maxX = ENTRY.x + ENTRY.width / 2 - PHYSICS.PLAYER_WIDTH / 2 - margin;
  const step = count === 1 ? 0 : (maxX - minX) / (count - 1);
  if (count > 1 && step <= PHYSICS.PLAYER_WIDTH) throw new Error("initial platform cannot fit safe spawn slots");
  const y = ENTRY.topY - PHYSICS.PLAYER_HEIGHT / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: count === 1 ? ENTRY.x : minX + step * index,
    y,
  }));
}

/**
 * Places a required landing relative to the surface that supports the player's
 * feet. This keeps authored geometry valid if the collider height changes.
 */
function mandatoryStep(definition: RectDef, supportTopY: number): RectDef {
  const top = validateObstacle({ topY: definition.y - definition.height / 2 }, supportTopY);
  return { ...definition, y: top.topY + definition.height / 2 };
}

const startTop = 625;
const trailStepTop = startTop - OBSTACLE_HEIGHTS.easy;
const highTrailTop = trailStepTop - OBSTACLE_HEIGHTS.normal;
const meadowTop = 625;
const liftTop = meadowTop - OBSTACLE_HEIGHTS.easy;
const lookoutTop = liftTop - OBSTACLE_HEIGHTS.normal;
const ruinsTop = 625;
const keyStepTop = ruinsTop - OBSTACLE_HEIGHTS.normal;
const keyDaisTop = keyStepTop - OBSTACLE_HEIGHTS.normal;

/**
 * Forest Ruins: a left-to-right route with two safe valleys, a moving bridge,
 * and a short staircase to the key before the final door.
 */
export const level1 = {
  width: 2700,
  height: 800,
  spawn: initialSpawnSlots(1)[0]!,
  checkpoint: { x: 1010, y: meadowTop - 45 },
  deathY: 830,
  platforms: [
    { id: "forest-entry", x: 230, y: 650, width: 460, height: 50 },
    mandatoryStep({ id: "trail-step", x: 535, y: trailStepTop + 15, width: 150, height: 30 }, startTop),
    mandatoryStep({ id: "high-trail", x: 735, y: highTrailTop + 18, width: 230, height: 36 }, trailStepTop),

    { id: "meadow", x: 1030, y: 650, width: 330, height: 50 },
    mandatoryStep({ id: "bridge-approach", x: 1215, y: liftTop + 16, width: 100, height: 32 }, meadowTop),
    mandatoryStep({ id: "lookout", x: 1535, y: lookoutTop + 18, width: 240, height: 36 }, liftTop),

    { id: "ruins-floor", x: 1835, y: 650, width: 350, height: 50 },
    mandatoryStep({ id: "key-step", x: 2075, y: keyStepTop + 17, width: 150, height: 34 }, ruinsTop),
    mandatoryStep({ id: "key-dais", x: 2250, y: keyDaisTop + 18, width: 170, height: 36 }, keyStepTop),
    { id: "exit-causeway", x: 2500, y: 650, width: 400, height: 50 },

    { id: "left-wall", x: -20, y: 375, width: 40, height: 750 },
    { id: "right-wall", x: 2720, y: 375, width: 40, height: 750 },
  ] satisfies RectDef[],
  movingPlatform: {
    id: "river-bridge", x: 1350, y: liftTop + 12, width: 150, height: 24,
    fromX: 1300, toX: 1415, speed: 48,
  },
  /** Every upward transition required by the intended route, for load-time auditing. */
  mandatoryAscents: [
    { supportId: "forest-entry", obstacleId: "trail-step" },
    { supportId: "trail-step", obstacleId: "high-trail" },
    { supportId: "meadow", obstacleId: "bridge-approach" },
    { supportId: "bridge-approach", obstacleId: "river-bridge" },
    { supportId: "river-bridge", obstacleId: "lookout" },
    { supportId: "ruins-floor", obstacleId: "key-step" },
    { supportId: "key-step", obstacleId: "key-dais" },
  ] satisfies MandatoryAscent[],
  boxes: [
    { id: "ruins-crate", x: 1810, y: 585, width: 62, height: 62, mass: 9 },
  ],
  key: { x: 2250, y: keyDaisTop - 42 },
  door: { x: 2580, y: 570, width: 80, height: 110 },
};

/** Serializable representation sent to clients and shown in the map library/lobby. */
export function defaultMapDefinition(): EditableMapDefinition {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "builtin-forest-ruins",
    name: "Ruinas del bosque",
    width: level1.width,
    height: level1.height,
    background: { preset: "forest" },
    objects: [
      { id: "spawn", kind: "spawn", name: "Spawn", x: level1.spawn.x, y: level1.spawn.y, width: 42, height: 58, texture: "crystal" },
      ...level1.platforms.map((platform) => ({ ...platform, kind: "platform" as const, name: platform.id, texture: "grass" as const })),
      {
        id: level1.movingPlatform.id, kind: "movingPlatform", name: "Puente móvil",
        x: level1.movingPlatform.x, y: level1.movingPlatform.y,
        width: level1.movingPlatform.width, height: level1.movingPlatform.height, texture: "metal",
        moving: {
          axis: "horizontal", distance: level1.movingPlatform.toX - level1.movingPlatform.fromX,
          speed: level1.movingPlatform.speed,
        },
      },
      ...level1.boxes.map((box) => ({ ...box, kind: "box" as const, name: box.id, texture: "wood" as const })),
      { id: "checkpoint", kind: "checkpoint", name: "Checkpoint", x: level1.checkpoint.x, y: level1.checkpoint.y, width: 54, height: 90, texture: "crystal" },
      { id: "key", kind: "key", name: "Llave", x: level1.key.x, y: level1.key.y, width: 42, height: 42, texture: "crystal" },
      { id: "door", kind: "door", name: "Puerta", x: level1.door.x, y: level1.door.y, width: level1.door.width, height: level1.door.height, texture: "stone" },
      { id: "void", kind: "deathZone", name: "Vacío", x: level1.width / 2, y: level1.deathY + 20, width: level1.width, height: 40, texture: "hazard" },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
