import Matter from "matter-js";
import { PHYSICS, type RopeSnapshot } from "@tetherbound/shared";

export interface RopeMember { id: string; body: Matter.Body; active: boolean }
export interface RopeObstacle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Point { x: number; y: number }

const ROPE_CLEARANCE = 4;
const GEOMETRY_EPSILON = 0.01;

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function segmentCrossesInterior(a: Point, b: Point, obstacle: RopeObstacle): boolean {
  const minX = obstacle.minX + GEOMETRY_EPSILON;
  const minY = obstacle.minY + GEOMETRY_EPSILON;
  const maxX = obstacle.maxX - GEOMETRY_EPSILON;
  const maxY = obstacle.maxY - GEOMETRY_EPSILON;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let near = 0;
  let far = 1;
  const clips: Array<[number, number]> = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ];
  for (const [p, q] of clips) {
    if (Math.abs(p) < GEOMETRY_EPSILON) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) near = Math.max(near, ratio);
    else far = Math.min(far, ratio);
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}

function hasClearLine(a: Point, b: Point, obstacles: RopeObstacle[]): boolean {
  return obstacles.every((obstacle) => !segmentCrossesInterior(a, b, obstacle));
}

function inflate(obstacle: RopeObstacle): RopeObstacle {
  return {
    minX: obstacle.minX - ROPE_CLEARANCE,
    minY: obstacle.minY - ROPE_CLEARANCE,
    maxX: obstacle.maxX + ROPE_CLEARANCE,
    maxY: obstacle.maxY + ROPE_CLEARANCE,
  };
}

export function routeRopeAroundObstacles(start: Point, end: Point, sourceObstacles: RopeObstacle[]): Point[] {
  const obstacles = sourceObstacles.map(inflate);
  if (hasClearLine(start, end, obstacles)) return [];

  const nodes: Point[] = [start, end];
  for (const obstacle of obstacles) {
    nodes.push(
      { x: obstacle.minX, y: obstacle.minY },
      { x: obstacle.maxX, y: obstacle.minY },
      { x: obstacle.maxX, y: obstacle.maxY },
      { x: obstacle.minX, y: obstacle.maxY },
    );
  }
  const valid = nodes.map((point, index) =>
    index < 2 || obstacles.every((obstacle) =>
      point.x <= obstacle.minX + GEOMETRY_EPSILON
      || point.x >= obstacle.maxX - GEOMETRY_EPSILON
      || point.y <= obstacle.minY + GEOMETRY_EPSILON
      || point.y >= obstacle.maxY - GEOMETRY_EPSILON
    )
  );
  const costs = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const visited = nodes.map(() => false);
  costs[0] = 0;

  for (let step = 0; step < nodes.length; step++) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (valid[i] && !visited[i] && (current === -1 || costs[i]! < costs[current]!)) current = i;
    }
    if (current === -1 || !Number.isFinite(costs[current])) break;
    if (current === 1) break;
    visited[current] = true;
    for (let next = 0; next < nodes.length; next++) {
      if (next === current || !valid[next] || visited[next]) continue;
      if (!hasClearLine(nodes[current]!, nodes[next]!, obstacles)) continue;
      const candidate = costs[current]! + distance(nodes[current]!, nodes[next]!);
      if (candidate < costs[next]!) {
        costs[next] = candidate;
        previous[next] = current;
      }
    }
  }

  if (!Number.isFinite(costs[1])) return [];
  const route: Point[] = [];
  let current = 1;
  while (true) {
    const prior = previous[current];
    if (prior === undefined || prior <= 0) break;
    current = prior;
    route.push(nodes[current]!);
  }
  return route.reverse();
}

export class RopeConstraintSimple {
  solve(members: RopeMember[], dt: number, obstacles: RopeObstacle[] = []): RopeSnapshot[] {
    const result: RopeSnapshot[] = [];
    for (let i = 0; i < members.length - 1; i++) {
      const a = members[i]!;
      const b = members[i + 1]!;
      const points = routeRopeAroundObstacles(a.body.position, b.body.position, obstacles);
      const path = [a.body.position, ...points, b.body.position];
      const pathDistance = Math.max(0.001, path.slice(1).reduce(
        (total, point, index) => total + distance(path[index]!, point),
        0
      ));
      const aTarget = path[1]!;
      const bTarget = path[path.length - 2]!;
      const aDx = aTarget.x - a.body.position.x;
      const aDy = aTarget.y - a.body.position.y;
      const bDx = bTarget.x - b.body.position.x;
      const bDy = bTarget.y - b.body.position.y;
      const aLength = Math.max(0.001, Math.hypot(aDx, aDy));
      const bLength = Math.max(0.001, Math.hypot(bDx, bDy));
      const anx = aDx / aLength;
      const any = aDy / aLength;
      const bnx = bDx / bLength;
      const bny = bDy / bLength;
      const active = a.active && b.active;
      let tension = 0;
      if (active && pathDistance > PHYSICS.ROPE_REST_LENGTH) {
        const avx = a.body.velocity.x * 60;
        const avy = a.body.velocity.y * 60;
        const bvx = b.body.velocity.x * 60;
        const bvy = b.body.velocity.y * 60;
        const separatingVelocity = -(avx * anx + avy * any + bvx * bnx + bvy * bny);
        tension = Math.min(
          PHYSICS.ROPE_MAX_FORCE,
          Math.max(0, (pathDistance - PHYSICS.ROPE_REST_LENGTH) * PHYSICS.ROPE_STIFFNESS + separatingVelocity * PHYSICS.ROPE_DAMPING)
        );
        const dv = tension * dt / 60;
        Matter.Body.setVelocity(a.body, { x: a.body.velocity.x + anx * dv, y: a.body.velocity.y + any * dv });
        Matter.Body.setVelocity(b.body, { x: b.body.velocity.x + bnx * dv, y: b.body.velocity.y + bny * dv });
      }
      if (active && pathDistance > PHYSICS.ROPE_MAX_LENGTH) {
        const excess = Math.min(10, (pathDistance - PHYSICS.ROPE_MAX_LENGTH) * 0.18);
        Matter.Body.translate(a.body, { x: anx * excess * 0.5, y: any * excess * 0.5 });
        Matter.Body.translate(b.body, { x: bnx * excess * 0.5, y: bny * excess * 0.5 });
      }
      result.push({ a: a.id, b: b.id, distance: pathDistance, tension, active, points });
    }
    return result;
  }
}

// Segment collision is intentionally a separate future-compatible implementation.
export class RopeConstraintWithSegments extends RopeConstraintSimple {}
