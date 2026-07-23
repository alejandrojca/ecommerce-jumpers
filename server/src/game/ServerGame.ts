import Matter from "matter-js";
import {
  NETWORK, PHYSICS, type GameSnapshot, type PlayerInput, type PlayerSnapshot, type RopeSnapshot
} from "@tetherbound/shared";
import { level1 } from "../levels/level1.js";
import { RopeConstraintSimple } from "./RopeSystem.js";
import { derivePlayerState } from "./PlayerStateMachine.js";
import { buildVictoryResults, recordFirstExit } from "./VictorySystem.js";
import { allConnectedPlayersInVoid } from "./RespawnSystem.js";
import { anchorMobilityMultiplier, calculateAnchorLoads } from "./AnchorLoadSystem.js";

interface PlayerRuntime {
  id: string;
  name: string;
  color: number;
  body: Matter.Body;
  input: PlayerInput;
  lastSequence: number;
  grounded: boolean;
  coyoteUntil: number;
  jumpBufferedUntil: number;
  jumpWasHeld: boolean;
  deadUntil: number;
  invulnerableUntil: number;
  checkpoint: { x: number; y: number };
  connected: boolean;
  voidLocked: boolean;
  supportedHangingPlayers: number;
  lastValid: { x: number; y: number; vx: number; vy: number };
}

const EMPTY_INPUT: PlayerInput = {
  sequence: 0, left: false, right: false, jumpPressed: false, jumpHeld: false, clientTime: 0
};

export class ServerGame {
  private readonly engine = Matter.Engine.create({ enableSleeping: false });
  private readonly players = new Map<string, PlayerRuntime>();
  private readonly platforms: Matter.Body[] = [];
  private readonly boxes: Matter.Body[] = [];
  private readonly rope = new RopeConstraintSimple();
  private ropes: RopeSnapshot[] = [];
  private tick = 0;
  private keyCollected = false;
  private keyHolder?: string;
  private victory = false;
  private liftDirection = 1;
  private matchStartedAt = Date.now();
  private readonly exitTimes = new Map<string, number>();
  private teamRespawnAt = 0;

  constructor() {
    this.engine.gravity.y = 1;
    this.engine.gravity.scale = 0.00039;
    for (const p of level1.platforms) {
      const body = Matter.Bodies.rectangle(p.x, p.y, p.width, p.height, {
        isStatic: true, label: `platform:${p.id}`, friction: 0.9, restitution: 0
      });
      this.platforms.push(body);
    }
    const lift = level1.movingPlatform;
    this.platforms.push(Matter.Bodies.rectangle(lift.x, lift.y, lift.width, lift.height, {
      isStatic: true, label: `moving:${lift.id}`, friction: 1
    }));
    for (const box of level1.boxes) {
      const body = Matter.Bodies.rectangle(box.x, box.y, box.width, box.height, {
        label: `box:${box.id}`, friction: 0.85, restitution: 0, chamfer: { radius: 4 }
      });
      Matter.Body.setMass(body, box.mass);
      this.boxes.push(body);
    }
    Matter.Composite.add(this.engine.world, [...this.platforms, ...this.boxes]);
  }

  addPlayer(id: string, name: string, color: number): void {
    if (this.players.has(id)) {
      this.players.get(id)!.connected = true;
      return;
    }
    const index = this.players.size;
    const x = 24 + index * 35;
    const body = Matter.Bodies.rectangle(x, level1.spawn.y, PHYSICS.PLAYER_WIDTH, PHYSICS.PLAYER_HEIGHT, {
      label: `player:${id}`,
      friction: 0.2,
      frictionStatic: 0.7,
      frictionAir: 0,
      restitution: 0,
      inertia: Infinity,
      chamfer: { radius: 5 },
    });
    Matter.Body.setMass(body, 1.2);
    Matter.Composite.add(this.engine.world, body);
    this.players.set(id, {
      id, name, color, body, input: { ...EMPTY_INPUT }, lastSequence: 0,
      grounded: false, coyoteUntil: 0, jumpBufferedUntil: 0, jumpWasHeld: false,
      deadUntil: 0, invulnerableUntil: 0, checkpoint: { x, y: level1.spawn.y }, connected: true,
      voidLocked: false, supportedHangingPlayers: 0,
      lastValid: { x, y: level1.spawn.y, vx: 0, vy: 0 },
    });
  }

  setConnected(id: string, connected: boolean): void {
    const player = this.players.get(id);
    if (player) {
      player.connected = connected;
      if (!connected) player.input = { ...EMPTY_INPUT };
    }
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    Matter.Composite.remove(this.engine.world, player.body);
    this.players.delete(id);
  }

  acceptInput(id: string, input: PlayerInput): boolean {
    const p = this.players.get(id);
    if (!p || !p.connected || input.sequence <= p.lastSequence || p.deadUntil > Date.now()) return false;
    p.input = p.voidLocked
      ? { ...input, left: false, right: false, jumpPressed: false, jumpHeld: false }
      : input;
    p.lastSequence = input.sequence;
    if (!p.voidLocked && input.jumpPressed) {
      p.jumpBufferedUntil = Date.now() + PHYSICS.JUMP_BUFFER_MS;
    }
    return true;
  }

  step(): void {
    const dt = 1 / NETWORK.SERVER_TICK_RATE;
    const now = Date.now();
    this.tick++;
    this.moveLift(dt);
    const anchorLoads = calculateAnchorLoads(
      [...this.players.values()].map((player) => ({ id: player.id, hanging: player.voidLocked }))
    );
    for (const player of this.players.values()) {
      player.supportedHangingPlayers = anchorLoads.get(player.id) ?? 0;
    }
    for (const p of this.players.values()) this.updatePlayer(p, now, dt);
    this.ropes = this.rope.solve(
      [...this.players.values()].map((p) => ({ id: p.id, body: p.body, active: p.deadUntil <= now })),
      dt,
      this.platforms.map((platform) => ({
        minX: platform.bounds.min.x,
        minY: platform.bounds.min.y,
        maxX: platform.bounds.max.x,
        maxY: platform.bounds.max.y,
      }))
    );
    Matter.Engine.update(this.engine, 1000 / NETWORK.SERVER_TICK_RATE);
    for (const p of this.players.values()) this.postPhysics(p, now);
    this.updateTeamRespawn(now);
  }

  private updatePlayer(p: PlayerRuntime, now: number, dt: number): void {
    if (p.deadUntil > now) {
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      Matter.Body.setPosition(p.body, { x: -200, y: -200 });
      return;
    }
    if (p.deadUntil !== 0) {
      p.deadUntil = 0;
      p.invulnerableUntil = now + PHYSICS.INVULNERABILITY_AFTER_RESPAWN_MS;
      Matter.Body.setPosition(p.body, p.checkpoint);
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
    }
    if (p.voidLocked) {
      p.input = { ...p.input, left: false, right: false, jumpPressed: false, jumpHeld: false };
      p.jumpBufferedUntil = 0;
      p.coyoteUntil = 0;
      p.jumpWasHeld = false;
      Matter.Body.setVelocity(p.body, {
        x: p.body.velocity.x,
        y: Math.min(p.body.velocity.y, PHYSICS.MAX_FALL_SPEED / 60)
      });
      return;
    }
    const vx = p.body.velocity.x * 60;
    const direction = Number(p.input.right) - Number(p.input.left);
    const mobility = anchorMobilityMultiplier(p.supportedHangingPlayers);
    const accel = (p.grounded ? PHYSICS.GROUND_ACCELERATION : PHYSICS.AIR_ACCELERATION) * mobility;
    const maxSpeed = PHYSICS.MAX_RUN_SPEED * Math.max(0.55, mobility);
    let nextVx = vx;
    if (direction !== 0) {
      nextVx += direction * accel * dt;
      nextVx = Math.max(-maxSpeed, Math.min(maxSpeed, nextVx));
    } else {
      const decel = PHYSICS.GROUND_DECELERATION * dt;
      nextVx = Math.abs(nextVx) <= decel ? 0 : nextVx - Math.sign(nextVx) * decel;
    }
    Matter.Body.setVelocity(p.body, {
      x: nextVx / 60,
      y: Math.min(p.body.velocity.y, PHYSICS.MAX_FALL_SPEED / 60)
    });
    if (p.grounded) p.coyoteUntil = now + PHYSICS.COYOTE_TIME_MS;
    if (p.jumpBufferedUntil >= now && p.coyoteUntil >= now) {
      Matter.Body.setVelocity(p.body, { x: p.body.velocity.x, y: PHYSICS.JUMP_VELOCITY / 60 });
      p.jumpBufferedUntil = 0;
      p.coyoteUntil = 0;
      p.grounded = false;
    }
    if (p.jumpWasHeld && !p.input.jumpHeld && p.body.velocity.y < 0) {
      Matter.Body.setVelocity(p.body, {
        x: p.body.velocity.x,
        y: p.body.velocity.y * PHYSICS.JUMP_CUT_MULTIPLIER
      });
    }
    p.jumpWasHeld = p.input.jumpHeld;
  }

  private postPhysics(p: PlayerRuntime, now: number): void {
    const b = p.body;
    p.grounded = this.detectGrounded(b);
    if (b.position.y > level1.deathY) p.voidLocked = true;
    if (p.voidLocked && p.grounded) {
      p.voidLocked = false;
      p.input = { ...p.input, left: false, right: false, jumpPressed: false, jumpHeld: false };
    }
    Matter.Body.setAngle(b, 0);
    Matter.Body.setAngularVelocity(b, 0);
    const finite = [b.position.x, b.position.y, b.velocity.x, b.velocity.y].every(Number.isFinite);
    if (!finite) {
      Matter.Body.setPosition(b, { x: p.lastValid.x, y: p.lastValid.y });
      Matter.Body.setVelocity(b, { x: p.lastValid.vx, y: p.lastValid.vy });
    } else {
      p.lastValid = { x: b.position.x, y: b.position.y, vx: b.velocity.x, vy: b.velocity.y };
    }
    if (Math.hypot(b.position.x - level1.checkpoint.x, b.position.y - level1.checkpoint.y) < 85) {
      p.checkpoint = { ...level1.checkpoint };
    }
    if (!this.keyCollected && Math.hypot(b.position.x - level1.key.x, b.position.y - level1.key.y) < 46) {
      this.keyCollected = true;
      this.keyHolder = p.id;
    }
    if (this.keyCollected && this.isInsideExit(p)) {
      recordFirstExit(this.exitTimes, p.id, this.matchStartedAt, now);
    }
    this.updateVictory();
  }

  private detectGrounded(body: Matter.Body): boolean {
    const bottom = body.bounds.max.y;
    return [...this.platforms, ...this.boxes, ...[...this.players.values()].map((p) => p.body)]
      .some((other) => other !== body
        && body.bounds.max.x > other.bounds.min.x + 3
        && body.bounds.min.x < other.bounds.max.x - 3
        && bottom >= other.bounds.min.y - 6
        && bottom <= other.bounds.min.y + 10
        && body.velocity.y >= -0.2);
  }

  private moveLift(dt: number): void {
    const lift = this.platforms.find((p) => p.label.startsWith("moving:"))!;
    const def = level1.movingPlatform;
    if (lift.position.x >= def.toX) this.liftDirection = -1;
    if (lift.position.x <= def.fromX) this.liftDirection = 1;
    Matter.Body.setPosition(lift, { x: lift.position.x + this.liftDirection * def.speed * dt, y: lift.position.y });
  }

  private updateVictory(): void {
    if (!this.keyCollected || this.victory) return;
    const active = [...this.players.values()].filter((p) => p.connected && p.deadUntil === 0);
    this.victory = active.length > 0 && active.every((p) =>
      this.isInsideExit(p)
    );
  }

  private updateTeamRespawn(now: number): void {
    const players = [...this.players.values()];
    const everyoneFell = allConnectedPlayersInVoid(
      players.map((player) => ({ connected: player.connected, y: player.body.position.y })),
      level1.deathY
    );
    if (!everyoneFell) {
      this.teamRespawnAt = 0;
      return;
    }
    if (this.teamRespawnAt === 0) {
      this.teamRespawnAt = now + PHYSICS.RESPAWN_DELAY_MS;
      return;
    }
    if (now < this.teamRespawnAt) return;
    this.respawnTeamAtStart(now);
  }

  private respawnTeamAtStart(now: number): void {
    let index = 0;
    for (const player of this.players.values()) {
      const spawn = { x: 24 + index++ * 35, y: level1.spawn.y };
      Matter.Body.setPosition(player.body, spawn);
      Matter.Body.setVelocity(player.body, { x: 0, y: 0 });
      Matter.Body.setAngle(player.body, 0);
      Matter.Body.setAngularVelocity(player.body, 0);
      player.input = { ...EMPTY_INPUT, sequence: player.lastSequence };
      player.grounded = false;
      player.coyoteUntil = 0;
      player.jumpBufferedUntil = 0;
      player.jumpWasHeld = false;
      player.deadUntil = 0;
      player.voidLocked = false;
      player.supportedHangingPlayers = 0;
      player.invulnerableUntil = now + PHYSICS.INVULNERABILITY_AFTER_RESPAWN_MS;
      player.checkpoint = spawn;
      player.lastValid = { x: spawn.x, y: spawn.y, vx: 0, vy: 0 };
    }
    this.teamRespawnAt = 0;
    this.ropes = [];
  }

  private isInsideExit(player: PlayerRuntime): boolean {
    return Math.abs(player.body.position.x - level1.door.x) < 85
      && Math.abs(player.body.position.y - level1.door.y) < 100;
  }

  snapshot(): GameSnapshot {
    const required = [...this.players.values()].filter((p) => p.connected).length;
    const inside = [...this.players.values()].filter((p) =>
      p.connected && this.isInsideExit(p)
    ).length;
    const players: PlayerSnapshot[] = [...this.players.values()].map((p) => {
      const tension = Math.max(0, ...this.ropes.filter((r) => r.a === p.id || r.b === p.id).map((r) => r.tension));
      const atExit = this.keyCollected && Math.abs(p.body.position.x - level1.door.x) < 85;
      return {
        id: p.id, name: p.name, color: p.color, x: p.body.position.x, y: p.body.position.y,
        velocityX: p.body.velocity.x * 60, velocityY: p.body.velocity.y * 60,
        state: derivePlayerState(
          p.body.velocity.x * 60,
          p.body.velocity.y * 60,
          p.grounded,
          p.deadUntil > Date.now(),
          atExit,
          tension,
          p.voidLocked
        ),
        facing: p.body.velocity.x < -0.05 ? "left" : "right", grounded: p.grounded,
        connected: p.connected, lastProcessedInput: p.lastSequence,
        supportedHangingPlayers: p.supportedHangingPlayers
      };
    });
    return {
      serverTick: this.tick, serverTime: Date.now(), players, ropes: this.ropes,
      objects: [
        ...this.boxes.map((b, i) => ({ id: level1.boxes[i]!.id, kind: "box" as const, x: b.position.x, y: b.position.y, width: level1.boxes[i]!.width, height: level1.boxes[i]!.height })),
        ...this.platforms.map((b) => ({ id: b.label, kind: "platform" as const, x: b.position.x, y: b.position.y, width: b.bounds.max.x - b.bounds.min.x, height: b.bounds.max.y - b.bounds.min.y }))
      ],
      keyState: { collected: this.keyCollected, holderId: this.keyHolder, ...level1.key },
      doorState: { open: this.keyCollected, inside, required, x: level1.door.x, y: level1.door.y },
      matchState: this.victory ? "victory" : "playing",
      victoryResults: this.victory
        ? buildVictoryResults(
          [...this.players.values()].filter((p) => p.connected),
          this.exitTimes
        )
        : []
    };
  }

  restart(): void {
    this.keyCollected = false;
    this.keyHolder = undefined;
    this.victory = false;
    this.matchStartedAt = Date.now();
    this.exitTimes.clear();
    this.teamRespawnAt = 0;
    let i = 0;
    for (const p of this.players.values()) {
      const spawn = { x: 24 + i++ * 35, y: level1.spawn.y };
      Matter.Body.setPosition(p.body, spawn);
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      p.checkpoint = spawn;
      p.deadUntil = 0;
      p.voidLocked = false;
      p.supportedHangingPlayers = 0;
    }
  }
}
