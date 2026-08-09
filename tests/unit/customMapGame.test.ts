import { describe, expect, it } from "vitest";
import { editableMapSchema, type EditableMapDefinition } from "@tetherbound/shared";
import { ServerGame } from "../../server/src/game/ServerGame";

const customMap = (): EditableMapDefinition => ({
  schemaVersion: 1,
  id: "custom-test",
  name: "Mapa de prueba",
  width: 800,
  height: 500,
  background: { preset: "sky" },
  objects: [
    { id: "spawn", kind: "spawn", name: "Spawn", x: 100, y: 400, width: 42, height: 58, texture: "crystal" },
    { id: "floor", kind: "platform", name: "Piso", x: 250, y: 465, width: 500, height: 30, texture: "grass" },
    {
      id: "lift", kind: "movingPlatform", name: "Ascensor", x: 540, y: 360,
      width: 120, height: 24, texture: "metal",
      moving: { axis: "vertical", distance: 160, speed: 80 },
    },
    { id: "crate", kind: "box", name: "Caja", x: 300, y: 420, width: 48, height: 48, texture: "wood", mass: 7 },
    { id: "key", kind: "key", name: "Llave", x: 620, y: 310, width: 42, height: 42, texture: "crystal" },
    { id: "door", kind: "door", name: "Puerta", x: 735, y: 390, width: 70, height: 110, texture: "stone" },
    { id: "void", kind: "deathZone", name: "Vacío", x: 400, y: 495, width: 800, height: 10, texture: "hazard" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("custom authored maps", () => {
  it("validates and builds their authoritative physics objects", () => {
    const definition = editableMapSchema.parse(customMap());
    const game = new ServerGame(definition);
    game.addPlayer("a", "A", 0x49dcb1);
    game.addPlayer("b", "B", 0xff6b81);

    const snapshot = game.snapshot();
    expect(snapshot.objects.map((object) => object.id)).toEqual(expect.arrayContaining([
      "platform:floor", "moving:lift", "box:crate",
    ]));
    expect(snapshot.objects.find((object) => object.id === "moving:lift")?.texture).toBe("metal");
    expect(snapshot.players[0]!.x).not.toBe(snapshot.players[1]!.x);
    expect(snapshot.keyState).toMatchObject({ x: 620, y: 310 });
    expect(snapshot.doorState).toMatchObject({ x: 735, y: 390 });
  });

  it("moves every authored moving platform on its configured axis", () => {
    const game = new ServerGame(customMap());
    const before = game.snapshot().objects.find((object) => object.id === "moving:lift")!;
    for (let index = 0; index < 20; index++) game.step();
    const after = game.snapshot().objects.find((object) => object.id === "moving:lift")!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeGreaterThan(before.y);
  });
});
