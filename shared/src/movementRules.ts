import { PHYSICS } from "./constants.js";

export interface CrystalMotionState {
  glideRemaining: number;
  coasting: boolean;
  wasOnCrystal: boolean;
  lastDirection: number;
}

export const INITIAL_CRYSTAL_MOTION: CrystalMotionState = {
  glideRemaining: 0,
  coasting: false,
  wasOnCrystal: false,
  lastDirection: 0,
};

export function advanceHorizontalMotion(
  velocityX: number,
  direction: number,
  grounded: boolean,
  onCrystal: boolean,
  dt: number,
  previous: CrystalMotionState
): { velocityX: number; crystal: CrystalMotionState } {
  const crystal = { ...previous };
  if (!onCrystal) {
    crystal.glideRemaining = 0;
    crystal.coasting = false;
  }
  const enteredCrystal = onCrystal && !crystal.wasOnCrystal;
  if (
    onCrystal && direction === 0 && Math.abs(velocityX) > 0
    && !crystal.coasting && (crystal.lastDirection !== 0 || enteredCrystal)
  ) {
    crystal.glideRemaining = PHYSICS.CRYSTAL_GLIDE_DISTANCE;
    crystal.coasting = true;
  }

  let nextVelocity = velocityX;
  if (direction !== 0) {
    const counterSteering = onCrystal && velocityX !== 0 && Math.sign(velocityX) !== direction;
    if (counterSteering) {
      if (crystal.lastDirection !== direction || enteredCrystal) {
        crystal.glideRemaining = PHYSICS.CRYSTAL_COUNTER_GLIDE_DISTANCE;
        crystal.coasting = true;
      }
      if (crystal.coasting && crystal.glideRemaining > 0) {
        crystal.glideRemaining = Math.max(0, crystal.glideRemaining - Math.abs(velocityX) * dt);
      } else {
        const braking = PHYSICS.CRYSTAL_COUNTER_BRAKE * dt;
        nextVelocity = Math.abs(velocityX) <= braking ? 0 : velocityX + direction * braking;
        crystal.glideRemaining = 0;
        crystal.coasting = false;
      }
    } else {
      const acceleration = grounded ? PHYSICS.GROUND_ACCELERATION : PHYSICS.AIR_ACCELERATION;
      nextVelocity = Math.max(
        -PHYSICS.MAX_RUN_SPEED,
        Math.min(PHYSICS.MAX_RUN_SPEED, velocityX + direction * acceleration * dt)
      );
      crystal.glideRemaining = 0;
      crystal.coasting = false;
    }
  } else if (onCrystal && crystal.coasting && crystal.glideRemaining > 0) {
    crystal.glideRemaining = Math.max(0, crystal.glideRemaining - Math.abs(velocityX) * dt);
  } else {
    const deceleration = PHYSICS.GROUND_DECELERATION * dt;
    nextVelocity = Math.abs(velocityX) <= deceleration
      ? 0
      : velocityX - Math.sign(velocityX) * deceleration;
  }

  crystal.wasOnCrystal = onCrystal;
  crystal.lastDirection = direction;
  return { velocityX: nextVelocity, crystal };
}
