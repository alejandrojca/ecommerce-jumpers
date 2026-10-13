import { PHYSICS } from "./constants.js";

export interface JumpMotionState {
  coyoteUntil: number;
  jumpBufferedUntil: number;
  jumpCutApplied: boolean;
  jumpStartFeetY?: number;
}

export const initialJumpMotion = (): JumpMotionState => ({
  coyoteUntil: 0, jumpBufferedUntil: 0, jumpCutApplied: false,
});

export function advanceJumpControl(
  state: JumpMotionState, now: number, grounded: boolean,
  velocityY: number, feetY: number, held: boolean,
): { velocityY: number; jumped: boolean } {
  if (grounded) state.coyoteUntil = now + PHYSICS.COYOTE_TIME_MS;
  const jumped = state.jumpBufferedUntil > 0 && state.jumpBufferedUntil >= now
    && state.coyoteUntil > 0 && state.coyoteUntil >= now;
  if (jumped) {
    velocityY = PHYSICS.JUMP_VELOCITY;
    state.jumpBufferedUntil = 0;
    state.coyoteUntil = 0;
    state.jumpStartFeetY = feetY;
    state.jumpCutApplied = false;
  }
  // Apply ONCE, including a buffered tap already released before landing.
  if (!held && velocityY < 0 && state.jumpStartFeetY !== undefined && !state.jumpCutApplied) {
    velocityY *= PHYSICS.JUMP_CUT_MULTIPLIER;
    state.jumpCutApplied = true;
  }
  return { velocityY, jumped };
}

export function jumpGravity(velocityY: number): number {
  return PHYSICS.GRAVITY * (velocityY >= 0 ? PHYSICS.FALL_GRAVITY_MULTIPLIER : 1);
}
