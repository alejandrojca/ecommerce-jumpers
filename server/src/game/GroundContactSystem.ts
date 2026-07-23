import Matter from "matter-js";

export interface GroundContact {
  support: Matter.Body;
  normalY: number;
}

export function findGroundContact(
  body: Matter.Body,
  pairs: Matter.Pair[],
  minimumUpNormal = 0.65
): GroundContact | undefined {
  let best: GroundContact | undefined;
  for (const pair of pairs) {
    if (!pair.isActive || pair.isSensor) continue;
    let support: Matter.Body | undefined;
    let orientedNormalY = 0;
    if (pair.bodyA === body) {
      support = pair.bodyB;
      orientedNormalY = pair.collision.normal.y;
    } else if (pair.bodyB === body) {
      support = pair.bodyA;
      orientedNormalY = -pair.collision.normal.y;
    }
    if (!support || orientedNormalY > -minimumUpNormal) continue;
    if (!best || orientedNormalY < best.normalY) {
      best = { support, normalY: orientedNormalY };
    }
  }
  return best;
}
