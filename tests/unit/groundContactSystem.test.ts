import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import { findGroundContact } from "../../server/src/game/GroundContactSystem";

function settledPair(playerY: number, supportY: number) {
  const engine = Matter.Engine.create();
  const player = Matter.Bodies.rectangle(0, playerY, 32, 42, { label: "player:test" });
  const support = Matter.Bodies.rectangle(0, supportY, 200, 20, {
    isStatic: true,
    label: "platform:test"
  });
  Matter.Composite.add(engine.world, [player, support]);
  for (let index = 0; index < 10; index++) Matter.Engine.update(engine, 1000 / 60);
  return { engine, player, support };
}

describe("GroundContactSystem", () => {
  it("detects an actual upward collision normal as ground support", () => {
    const { engine, player, support } = settledPair(60, 100);
    expect(findGroundContact(player, engine.pairs.list)?.support).toBe(support);
  });

  it("does not treat a lateral wall contact as grounded", () => {
    const engine = Matter.Engine.create();
    engine.gravity.y = 0;
    const player = Matter.Bodies.rectangle(30, 0, 32, 42, { label: "player:test" });
    const wall = Matter.Bodies.rectangle(50, 0, 20, 200, { isStatic: true, label: "wall" });
    Matter.Composite.add(engine.world, [player, wall]);
    Matter.Engine.update(engine, 1000 / 60);
    expect(findGroundContact(player, engine.pairs.list)).toBeUndefined();
  });
});
