import { PHYSICS } from "./constants.js";

export const OBSTACLE_HEIGHTS = {
  easy: PHYSICS.PLAYER_HEIGHT * 0.5,
  normal: PHYSICS.PLAYER_HEIGHT * 0.75,
  hard: PHYSICS.PLAYER_HEIGHT,
} as const;

export interface ObstacleTop {
  topY: number;
}

/**
 * Clamps a mandatory step against the local surface supporting the player's
 * feet. Coordinates are world-space, so rendering scale and zoom are irrelevant.
 */
export function validateObstacle<T extends ObstacleTop>(
  obstacle: T,
  supportTopY: number,
  maxHeight = PHYSICS.MAX_OBSTACLE_HEIGHT
): T {
  const obstacleHeight = supportTopY - obstacle.topY;
  if (obstacleHeight > maxHeight) obstacle.topY = supportTopY - maxHeight;
  return obstacle;
}

export function jumpVelocityFor(
  colliderHeight: number,
  gravity = PHYSICS.GRAVITY
): number {
  return Math.sqrt(2 * gravity * colliderHeight * 3);
}
