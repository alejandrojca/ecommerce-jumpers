import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import { PHYSICS } from "../../shared/src/constants";

const STEP_MS = 1000 / 60 / PHYSICS.PHYSICS_SUBSTEPS;

function step(engine: Matter.Engine, frames: number, beforeFrame?: () => void): void {
  for (let frame = 0; frame < frames; frame++) {
    beforeFrame?.();
    for (let substep = 0; substep < PHYSICS.PHYSICS_SUBSTEPS; substep++) {
      Matter.Engine.update(engine, STEP_MS);
    }
  }
}

function player(x: number, y: number): Matter.Body {
  const body = Matter.Bodies.rectangle(x, y, PHYSICS.PLAYER_WIDTH, PHYSICS.PLAYER_HEIGHT, {
    friction: PHYSICS.PLAYER_CONTACT_FRICTION,
    frictionStatic: PHYSICS.PLAYER_STATIC_FRICTION,
    frictionAir: 0,
    inertia: Infinity,
  });
  Matter.Body.setMass(body, 1.2);
  return body;
}

describe("collision movement regression", () => {
  it("does not pin a falling player when movement is held into a vertical face", () => {
    const engine = Matter.Engine.create();
    engine.gravity.scale = 0.00039;
    const body = player(24, -50);
    const wall = Matter.Bodies.rectangle(50, 0, 20, 240, {
      isStatic: true,
      friction: 0.9,
    });
    Matter.Composite.add(engine.world, [body, wall]);

    step(engine, 60, () => {
      Matter.Body.setVelocity(body, {
        x: PHYSICS.MAX_RUN_SPEED / 60,
        y: Math.min(body.velocity.y, PHYSICS.MAX_FALL_SPEED / 60),
      });
    });

    // The horizontal component is correctly blocked, but lateral contact must
    // not become a brake on gravity (the old friction values left y near -50).
    expect(body.position.x).toBeLessThan(35);
    expect(body.position.y).toBeGreaterThan(25);
    expect(body.velocity.y).toBeGreaterThan(0);
  });

  it("keeps useful horizontal motion while continuously pushing a movable crate", () => {
    const engine = Matter.Engine.create();
    engine.gravity.scale = 0.00039;
    const ground = Matter.Bodies.rectangle(0, 100, 1_000, 20, {
      isStatic: true,
      friction: 0.9,
    });
    const body = player(-70, 69);
    const crate = Matter.Bodies.rectangle(0, 59, 62, 62, {
      friction: 0.85,
      restitution: 0,
      chamfer: { radius: 4 },
    });
    Matter.Body.setMass(crate, 9);
    Matter.Composite.add(engine.world, [ground, body, crate]);

    step(engine, 180, () => {
      Matter.Body.setVelocity(body, {
        x: PHYSICS.MAX_RUN_SPEED / 60,
        y: Math.min(body.velocity.y, PHYSICS.MAX_FALL_SPEED / 60),
      });
    });

    expect(crate.position.x).toBeGreaterThan(300);
    expect(crate.velocity.x * 60).toBeGreaterThan(PHYSICS.MAX_RUN_SPEED * 0.25);
    expect(body.velocity.x * 60).toBeGreaterThan(PHYSICS.MAX_RUN_SPEED * 0.25);
  });
});
