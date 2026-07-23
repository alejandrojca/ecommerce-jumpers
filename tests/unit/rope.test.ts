import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import { PHYSICS } from "@tetherbound/shared";
import { RopeConstraintSimple, routeRopeAroundObstacles } from "../../server/src/game/RopeSystem";

function members(distance: number) {
  return [
    { id: "a", body: Matter.Bodies.rectangle(0, 0, 32, 42), active: true },
    { id: "b", body: Matter.Bodies.rectangle(distance, 0, 32, 42), active: true }
  ];
}

describe("RopeConstraintSimple", () => {
  it("does not apply tension while slack", () => {
    const result = new RopeConstraintSimple().solve(members(PHYSICS.ROPE_REST_LENGTH - 1), 1 / 60);
    expect(result[0]!.tension).toBe(0);
  });

  it("applies bounded tension beyond rest length", () => {
    const result = new RopeConstraintSimple().solve(members(500), 1 / 60);
    expect(result[0]!.tension).toBeGreaterThan(0);
    expect(result[0]!.tension).toBeLessThanOrEqual(PHYSICS.ROPE_MAX_FORCE);
  });

  it("reduces a separation beyond the maximum without NaN", () => {
    const pair = members(500);
    new RopeConstraintSimple().solve(pair, 1 / 60);
    const distance = Math.hypot(
      pair[1]!.body.position.x - pair[0]!.body.position.x,
      pair[1]!.body.position.y - pair[0]!.body.position.y
    );
    expect(distance).toBeLessThan(500);
    expect(Number.isFinite(pair[0]!.body.velocity.x)).toBe(true);
  });

  it("reconfigures when a disconnected member is removed", () => {
    const chain = [
      ...members(120),
      { id: "c", body: Matter.Bodies.rectangle(240, 0, 32, 42), active: true }
    ];
    const result = new RopeConstraintSimple().solve([chain[0]!, chain[2]!], 1 / 60);
    expect(result).toHaveLength(1);
    expect(result[0]!.a).toBe("a");
    expect(result[0]!.b).toBe("c");
  });

  it("routes around a platform corner instead of crossing the floor and wall", () => {
    const points = routeRopeAroundObstacles(
      { x: 60, y: -30 },
      { x: 60, y: 70 },
      [{ minX: 40, minY: -10, maxX: 80, maxY: 50 }]
    );
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0]!.y).toBe(-14);
    expect(points.at(-1)!.y).toBe(54);
    expect(points[0]!.x).toBe(points.at(-1)!.x);
    expect([36, 84]).toContain(points[0]!.x);
  });
});
