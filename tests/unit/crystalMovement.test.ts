import { describe, expect, it } from "vitest";
import {
  advanceHorizontalMotion, INITIAL_CRYSTAL_MOTION, PHYSICS, type CrystalMotionState
} from "@tetherbound/shared";

const movingRight = (): CrystalMotionState => ({
  ...INITIAL_CRYSTAL_MOTION,
  wasOnCrystal: true,
  lastDirection: 1,
});

describe("crystal surface movement", () => {
  it("slides at least 200 units without input before slowing down", () => {
    let velocity = 120;
    let crystal = movingRight();
    let distance = 0;
    while (crystal.glideRemaining > 0 || distance === 0) {
      const next = advanceHorizontalMotion(velocity, 0, true, true, 1 / 60, crystal);
      velocity = next.velocityX;
      crystal = next.crystal;
      distance += velocity / 60;
    }
    expect(velocity).toBe(120);
    expect(distance).toBeGreaterThanOrEqual(PHYSICS.CRYSTAL_GLIDE_DISTANCE);
    expect(distance).toBeLessThan(PHYSICS.CRYSTAL_GLIDE_DISTANCE + velocity / 60 + 0.001);
    expect(crystal.glideRemaining).toBeCloseTo(0);

    const afterGlide = advanceHorizontalMotion(velocity, 0, true, true, 1 / 60, crystal);
    expect(afterGlide.velocityX).toBeLessThan(velocity);
  });

  it("slides at least 30 units before counter-steering can brake or reverse it", () => {
    let velocity = 120;
    let crystal = movingRight();
    let distance = 0;
    while (crystal.glideRemaining > 0 || distance === 0) {
      const next = advanceHorizontalMotion(velocity, -1, true, true, 1 / 60, crystal);
      velocity = next.velocityX;
      crystal = next.crystal;
      distance += velocity / 60;
      expect(velocity).toBe(120);
    }
    expect(distance).toBeGreaterThanOrEqual(PHYSICS.CRYSTAL_COUNTER_GLIDE_DISTANCE);
    expect(distance).toBeLessThan(PHYSICS.CRYSTAL_COUNTER_GLIDE_DISTANCE + velocity / 60 + 0.001);

    const braking = advanceHorizontalMotion(velocity, -1, true, true, 1 / 60, crystal);
    expect(braking.velocityX).toBe(120 - PHYSICS.CRYSTAL_COUNTER_BRAKE / 60);
    expect(braking.crystal.coasting).toBe(false);
  });

  it("keeps the normal stopping law on non-crystal surfaces", () => {
    const stopped = advanceHorizontalMotion(30, 0, true, false, 1 / 60, movingRight());
    expect(stopped.velocityX).toBe(0);
  });
});
