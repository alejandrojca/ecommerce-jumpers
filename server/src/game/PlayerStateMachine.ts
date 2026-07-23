import type { PlayerState } from "@tetherbound/shared";

export function derivePlayerState(
  vx: number,
  vy: number,
  grounded: boolean,
  dead: boolean,
  atExit: boolean,
  tension: number,
  forcedHanging = false
): PlayerState {
  if (dead) return "Dead";
  if (forcedHanging) return "Hanging";
  if (atExit) return "AtExit";
  if (!grounded && tension > 700 && vy > 40) return "Hanging";
  if (!grounded && tension > 450) return "BeingPulled";
  if (!grounded) return vy < 0 ? "Jumping" : "Falling";
  if (Math.abs(vx) > 20) return "Running";
  return "Idle";
}
