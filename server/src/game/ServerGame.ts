import Matter from "matter-js";
import {
  advanceJumpControl, jumpGravity, advanceHorizontalMotion, INITIAL_CRYSTAL_MOTION, NETWORK, PHYSICS, ROOM_MAX_PLAYERS,
  type CrystalMotionState, type EditableMapDefinition, type EditableMapObject,
  type GameSnapshot, type PlayerContactEvent, type PlayerInput, type PlayerSnapshot
} from "@tetherbound/shared";
import { initialSpawnSlots, level1 } from "../levels/level1.js";
import { derivePlayerState } from "./PlayerStateMachine.js";
import { buildVictoryResults, recordFirstExit } from "./VictorySystem.js";
import { allConnectedPlayersInVoid } from "./RespawnSystem.js";
import { findGroundContact } from "./GroundContactSystem.js";

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
  jumpCutApplied: boolean;
  jumpStartFeetY?: number;
  deadUntil: number;
  invulnerableUntil: number;
  checkpoint: { x: number; y: number };
  connected: boolean;
  voidLocked: boolean;
  supportedHangingPlayers: number;
  supportBody?: Matter.Body;
  lastValid: { x: number; y: number; vx: number; vy: number };
  exitedAt?: number;
  electrocutedUntil?: number;
  inWorld: boolean;
  spawnSlot: number;
  crystalMotion: CrystalMotionState;
}

const EMPTY_INPUT: PlayerInput = {
  sequence: 0, left: false, right: false, jumpPressed: false, jumpHeld: false, clientTime: 0
};

interface MovingPlatformRuntime {
  body: Matter.Body;
  definition: EditableMapObject;
  axis: "horizontal" | "vertical";
  minimum: number;
  maximum: number;
  direction: number;
  speed: number;
}

function customSpawnSlots(map: EditableMapDefinition): Array<{ x: number; y: number }> {
  const spawns = map.objects.filter((object) => object.kind === "spawn");
  if (spawns.length >= ROOM_MAX_PLAYERS) {
    return spawns.slice(0, ROOM_MAX_PLAYERS).map(({ x, y }) => ({ x, y }));
  }
  const primary = spawns[0]!;
  const support = map.objects
    .filter((object) => object.kind === "platform" || object.kind === "movingPlatform")
    .filter((object) => {
      const top = object.y - object.height / 2;
      return primary.x >= object.x - object.width / 2 && primary.x <= object.x + object.width / 2
        && top >= primary.y && top - primary.y < 180;
    })
    .sort((a, b) => (a.y - a.height / 2) - (b.y - b.height / 2))[0];
  if (!support) {
    return Array.from({ length: ROOM_MAX_PLAYERS }, (_, index) => ({
      x: Math.max(PHYSICS.PLAYER_WIDTH / 2, Math.min(map.width - PHYSICS.PLAYER_WIDTH / 2, primary.x + index * (PHYSICS.PLAYER_WIDTH + 4))),
      y: primary.y,
    }));
  }
  const margin = PHYSICS.PLAYER_WIDTH / 2 + 3;
  const minimum = Math.max(margin, support.x - support.width / 2 + margin);
  const maximum = Math.min(map.width - margin, support.x + support.width / 2 - margin);
  const step = (maximum - minimum) / Math.max(1, ROOM_MAX_PLAYERS - 1);
  return Array.from({ length: ROOM_MAX_PLAYERS }, (_, index) => ({
    x: minimum + step * index,
    y: primary.y,
  }));
}

export class ServerGame {
  private readonly engine = Matter.Engine.create({ enableSleeping: false });
  private readonly players = new Map<string, PlayerRuntime>();
  private readonly platforms: Matter.Body[] = [];
  private readonly boxes: Matter.Body[] = [];
  private readonly platformDefinitions: EditableMapObject[];
  private readonly boxDefinitions: EditableMapObject[];
  private readonly movingPlatforms: MovingPlatformRuntime[] = [];
  private readonly spawnSlots: Array<{ x: number; y: number }>;
  private readonly checkpoints: EditableMapObject[];
  private readonly deathZones: EditableMapObject[];
  private readonly keyDefinition: EditableMapObject;
  private readonly doorDefinition: EditableMapObject;
  private readonly deathY: number;
  private tick = 0;
  private keyCollected = false;
  private keyHolder?: string;
  private victory = false;
  private matchStartedAt = Date.now();
  private readonly exitTimes = new Map<string, number>();
  private teamRespawnAt = 0;

  constructor(map?: EditableMapDefinition) {
    this.engine.gravity.y = 1;
    this.engine.gravity.scale = PHYSICS.GRAVITY / 1_000_000;
    if (map) {
      this.platformDefinitions = map.objects.filter((object) => object.kind === "platform" || object.kind === "movingPlatform");
      this.boxDefinitions = map.objects.filter((object) => object.kind === "box");
      this.spawnSlots = customSpawnSlots(map);
      this.checkpoints = map.objects.filter((object) => object.kind === "checkpoint");
      this.deathZones = map.objects.filter((object) => object.kind === "deathZone");
      this.keyDefinition = map.objects.find((object) => object.kind === "key")!;
      this.doorDefinition = map.objects.find((object) => object.kind === "door")!;
      this.deathY = map.height + 120;
    } else {
      this.platformDefinitions = [
        ...level1.platforms.map((platform) => ({ ...platform, kind: "platform" as const, name: platform.id, texture: "grass" as const })),
        {
          id: level1.movingPlatform.id, kind: "movingPlatform", name: level1.movingPlatform.id,
          x: level1.movingPlatform.x, y: level1.movingPlatform.y,
          width: level1.movingPlatform.width, height: level1.movingPlatform.height, texture: "metal",
          moving: { axis: "horizontal", distance: level1.movingPlatform.toX - level1.movingPlatform.fromX, speed: level1.movingPlatform.speed },
        },
      ];
      this.boxDefinitions = level1.boxes.map((box) => ({ ...box, kind: "box" as const, name: box.id, texture: "wood" as const }));
      this.spawnSlots = initialSpawnSlots();
      this.checkpoints = [{ id: "checkpoint", kind: "checkpoint", name: "Checkpoint", x: level1.checkpoint.x, y: level1.checkpoint.y, width: 54, height: 90, texture: "crystal" }];
      this.deathZones = [];
      this.keyDefinition = { id: "key", kind: "key", name: "Llave", x: level1.key.x, y: level1.key.y, width: 42, height: 42, texture: "crystal" };
      this.doorDefinition = { id: "door", kind: "door", name: "Puerta", x: level1.door.x, y: level1.door.y, width: level1.door.width, height: level1.door.height, texture: "stone" };
      this.deathY = level1.deathY;
    }
    for (const p of this.platformDefinitions) {
      const body = Matter.Bodies.rectangle(p.x, p.y, p.width, p.height, {
        isStatic: true, label: `${p.kind === "movingPlatform" ? "moving" : "platform"}:${p.id}`,
        friction: p.kind === "movingPlatform" ? 1 : 0.9, restitution: 0
      });
      this.platforms.push(body);
      if (p.kind === "movingPlatform") {
        const moving = p.moving ?? { axis: "horizontal" as const, distance: 220, speed: 50 };
        const minimum = map
          ? (moving.axis === "horizontal" ? p.x : p.y) - moving.distance / 2
          : level1.movingPlatform.fromX;
        const maximum = map
          ? (moving.axis === "horizontal" ? p.x : p.y) + moving.distance / 2
          : level1.movingPlatform.toX;
        this.movingPlatforms.push({ body, definition: p, axis: moving.axis, minimum, maximum, direction: 1, speed: moving.speed });
      }
    }
    for (const box of this.boxDefinitions) {
      const body = Matter.Bodies.rectangle(box.x, box.y, box.width, box.height, {
        label: `box:${box.id}`, friction: 0.85, restitution: 0, chamfer: { radius: 4 }
      });
      Matter.Body.setMass(body, box.mass ?? 9);
      this.boxes.push(body);
    }
    Matter.Composite.add(this.engine.world, [...this.platforms, ...this.boxes]);
  }

  addPlayer(id: string, name: string, color: number): void {
    if (this.players.has(id)) {
      this.players.get(id)!.connected = true;
      return;
    }
    const usedSlots = new Set([...this.players.values()].map((player) => player.spawnSlot));
    const index = this.spawnSlots.findIndex((_, slot) => !usedSlots.has(slot));
    if (index < 0) throw new Error("No safe player spawn slot available");
    const spawn = this.spawnSlots[index]!;
    const x = spawn.x;
    const body = Matter.Bodies.rectangle(x, spawn.y, PHYSICS.PLAYER_WIDTH, PHYSICS.PLAYER_HEIGHT, {
      label: `player:${id}`,
      // Locomotion and stopping are applied explicitly in updatePlayer.
      // Contact friction would also act on vertical faces, producing wall
      // sticking and excessive drag at platform/crate corners.
      friction: PHYSICS.PLAYER_CONTACT_FRICTION,
      frictionStatic: PHYSICS.PLAYER_STATIC_FRICTION,
      frictionAir: 0,
      restitution: 0,
      inertia: Infinity,
      chamfer: { radius: 5 },
    });
    Matter.Body.setMass(body, 1.2);
    Matter.Composite.add(this.engine.world, body);
    this.players.set(id, {
      id, name, color, body, input: { ...EMPTY_INPUT }, lastSequence: 0,
      grounded: false, coyoteUntil: 0, jumpBufferedUntil: 0, jumpCutApplied: false,
      jumpStartFeetY: undefined,
      deadUntil: 0, invulnerableUntil: 0, checkpoint: { ...spawn }, connected: true,
      voidLocked: false, supportedHangingPlayers: 0,
      supportBody: undefined,
      lastValid: { ...spawn, vx: 0, vy: 0 },
      inWorld: true,
      spawnSlot: index,
      crystalMotion: { ...INITIAL_CRYSTAL_MOTION },
    });
  }

  setConnected(id: string, connected: boolean): void {
    const player = this.players.get(id);
    if (player) {
      player.connected = connected;
      if (!connected) player.input = { ...EMPTY_INPUT };
    }
  }

  randomizeSpawnOrder(): void {
    const players = [...this.players.values()].filter((player) => player.exitedAt === undefined);
    const slots = players.map((player) => player.spawnSlot);
    for (let index = slots.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [slots[index], slots[swapIndex]] = [slots[swapIndex]!, slots[index]!];
    }
    const spawns = this.spawnSlots;
    players.forEach((player, index) => {
      player.spawnSlot = slots[index]!;
      const spawn = spawns[player.spawnSlot]!;
      Matter.Body.setPosition(player.body, spawn);
      Matter.Body.setVelocity(player.body, { x: 0, y: 0 });
      player.checkpoint = spawn;
      player.lastValid = { x: spawn.x, y: spawn.y, vx: 0, vy: 0 };
    });
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    if (player.inWorld) Matter.Composite.remove(this.engine.world, player.body);
    this.players.delete(id);
  }

  acceptInput(id: string, input: PlayerInput): boolean {
    const p = this.players.get(id);
    if (!p || !p.connected || p.exitedAt !== undefined || input.sequence <= p.lastSequence || p.deadUntil > Date.now()) return false;
    const previousJumpHeld = p.input.jumpHeld;
    p.input = p.voidLocked
      ? { ...input, left: false, right: false, jumpPressed: false, jumpHeld: false }
      : input;
    p.lastSequence = input.sequence;
    if (!p.voidLocked && input.jumpPressed && !previousJumpHeld) {
      p.jumpBufferedUntil = Date.now() + PHYSICS.JUMP_BUFFER_MS;
    }
    return true;
  }

  step(): void {
    const dt = 1 / NETWORK.SERVER_TICK_RATE;
    const substeps = Math.max(1, PHYSICS.PHYSICS_SUBSTEPS);
    const substepDt = dt / substeps;
    const now = Date.now();
    this.tick++;
    // Resolve an all-team fall before individual death timers can respawn a
    // member. This preserves the cooperative team reset policy.
    this.updateTeamRespawn(now);
    for (const p of this.players.values()) {
      if (p.exitedAt === undefined) this.updatePlayer(p, now, dt);
    }
    for (let substep = 0; substep < substeps; substep++) {
      this.movePlatforms(substepDt);
      for (const p of this.players.values()) {
        if (p.exitedAt !== undefined || p.deadUntil > now || p.body.isStatic) continue;
        const extraGravity = jumpGravity(p.body.velocity.y * 60) - PHYSICS.GRAVITY;
        Matter.Body.applyForce(p.body, p.body.position, { x: 0, y: p.body.mass * extraGravity / 1_000_000 });
      }
      Matter.Engine.update(this.engine, (1000 / NETWORK.SERVER_TICK_RATE) / substeps);
      for (const p of this.players.values()) {
        if (p.body.velocity.y * 60 > PHYSICS.MAX_FALL_SPEED) {
          Matter.Body.setVelocity(p.body, { x: p.body.velocity.x, y: PHYSICS.MAX_FALL_SPEED / 60 });
        }
      }
    }
    for (const p of this.players.values()) {
      if (p.exitedAt === undefined) this.postPhysics(p, now);
    }
    this.updateTeamRespawn(now);
  }

  private updatePlayer(p: PlayerRuntime, now: number, dt: number): void {
    if (p.deadUntil > now) {
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      // Collision deaths remain visible at the impact point for the
      // authoritative electrocution window. Void deaths stay hidden.
      if ((p.electrocutedUntil ?? 0) <= now) Matter.Body.setPosition(p.body, { x: -200, y: -200 });
      return;
    }
    if (p.deadUntil !== 0) {
      p.deadUntil = 0;
      p.electrocutedUntil = undefined;
      Matter.Body.setStatic(p.body, false);
      p.body.isSensor = false;
      p.voidLocked = false;
      p.invulnerableUntil = now + PHYSICS.INVULNERABILITY_AFTER_RESPAWN_MS;
      Matter.Body.setPosition(p.body, p.checkpoint);
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      p.crystalMotion = { ...INITIAL_CRYSTAL_MOTION };
      p.grounded = false;
      p.supportBody = undefined;
      p.coyoteUntil = 0;
      p.jumpBufferedUntil = 0;
      p.jumpCutApplied = false;
      p.jumpStartFeetY = undefined;
      p.input = { ...EMPTY_INPUT, sequence: p.lastSequence };
    }
    if (p.voidLocked) {
      p.input = { ...p.input, left: false, right: false, jumpPressed: false, jumpHeld: false };
      p.jumpBufferedUntil = 0;
      p.coyoteUntil = 0;
      p.jumpCutApplied = false;
      Matter.Body.setVelocity(p.body, {
        x: p.body.velocity.x,
        y: Math.min(p.body.velocity.y, PHYSICS.MAX_FALL_SPEED / 60)
      });
      return;
    }
    const vx = p.body.velocity.x * 60;
    const direction = Number(p.input.right) - Number(p.input.left);
    const motion = advanceHorizontalMotion(
      vx, direction, p.grounded, this.isCrystalSupport(p.supportBody), dt, p.crystalMotion
    );
    p.crystalMotion = motion.crystal;
    Matter.Body.setVelocity(p.body, {
      x: motion.velocityX / 60,
      y: Math.min(p.body.velocity.y, PHYSICS.MAX_FALL_SPEED / 60)
    });
    const jump = advanceJumpControl(p, now, p.grounded, p.body.velocity.y * 60,
      p.body.position.y + PHYSICS.PLAYER_HEIGHT / 2, p.input.jumpHeld);
    Matter.Body.setVelocity(p.body, { x: p.body.velocity.x, y: jump.velocityY / 60 });
    if (jump.jumped) {
      p.grounded = false;
      p.supportBody = undefined;
    }
  }

  private postPhysics(p: PlayerRuntime, now: number): void {
    const b = p.body;
    if (p.jumpStartFeetY !== undefined) {
      const minimumFeetY = p.jumpStartFeetY - PHYSICS.MAX_JUMP_HEIGHT;
      const feetY = b.position.y + PHYSICS.PLAYER_HEIGHT / 2;
      if (feetY < minimumFeetY) {
        Matter.Body.setPosition(b, { x: b.position.x, y: minimumFeetY - PHYSICS.PLAYER_HEIGHT / 2 });
        if (b.velocity.y < 0) Matter.Body.setVelocity(b, { x: b.velocity.x, y: 0 });
      }
    }
    // Matter may retain the launch contact for a substep: rising is not landing.
    const candidate = findGroundContact(b, this.engine.pairs.list);
    const contact = candidate && b.velocity.y >= candidate.support.velocity.y - 0.05 ? candidate : undefined;
    p.grounded = contact !== undefined;
    p.supportBody = contact?.support;
    if (contact) p.jumpStartFeetY = undefined;
    if (contact) {
      const expectedY = contact.support.bounds.min.y - PHYSICS.PLAYER_HEIGHT / 2;
      const penetration = b.position.y - expectedY;
      if (penetration > 0 && penetration <= 14) {
        Matter.Body.setPosition(b, { x: b.position.x, y: expectedY });
      }
      if (b.velocity.y > contact.support.velocity.y) {
        Matter.Body.setVelocity(b, { x: b.velocity.x, y: contact.support.velocity.y });
      }
    }
    if (this.isInDeathZone(b) && !p.voidLocked) {
      p.voidLocked = true;
      p.deadUntil = now + PHYSICS.RESPAWN_DELAY_MS;
      p.input = { ...EMPTY_INPUT, sequence: p.lastSequence };
      p.supportedHangingPlayers = 0;
    }
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
    // Checkpoints are progress lines, not pickups: crossing the flag's X is
    // sufficient even when the player jumps above its authored sprite bounds.
    const checkpoint = this.checkpoints
      .filter((definition) => b.position.x >= definition.x)
      .sort((a, b) => b.x - a.x)[0];
    if (checkpoint) {
      p.checkpoint = { x: checkpoint.x, y: checkpoint.y };
    }
    if (!this.keyCollected && Math.hypot(b.position.x - this.keyDefinition.x, b.position.y - this.keyDefinition.y) < 46) {
      this.keyCollected = true;
      this.keyHolder = p.id;
    }
    if (this.keyCollected && this.isInsideExit(p)) {
      recordFirstExit(this.exitTimes, p.id, this.matchStartedAt, now);
      this.enterExit(p, now);
    }
    this.updateVictory();
  }

  private movePlatforms(dt: number): void {
    for (const moving of this.movingPlatforms) {
      const coordinate = moving.axis === "horizontal" ? moving.body.position.x : moving.body.position.y;
      if (coordinate >= moving.maximum) moving.direction = -1;
      if (coordinate <= moving.minimum) moving.direction = 1;
      const next = Math.max(moving.minimum, Math.min(moving.maximum, coordinate + moving.direction * moving.speed * dt));
      Matter.Body.setPosition(moving.body, moving.axis === "horizontal"
        ? { x: next, y: moving.body.position.y }
        : { x: moving.body.position.x, y: next });
    }
  }

  private isInDeathZone(body: Matter.Body): boolean {
    if (body.position.y > this.deathY) return true;
    return this.deathZones.some((zone) =>
      body.bounds.max.x >= zone.x - zone.width / 2
      && body.bounds.min.x <= zone.x + zone.width / 2
      && body.bounds.max.y >= zone.y - zone.height / 2
      && body.bounds.min.y <= zone.y + zone.height / 2
    );
  }

  private isCrystalSupport(body?: Matter.Body): boolean {
    if (!body) return false;
    const separator = body.label.indexOf(":");
    const authoredId = separator >= 0 ? body.label.slice(separator + 1) : body.label;
    return [...this.platformDefinitions, ...this.boxDefinitions]
      .find((definition) => definition.id === authoredId)?.texture === "crystal";
  }

  private updateVictory(): void {
    if (!this.keyCollected || this.victory) return;
    const active = [...this.players.values()].filter((p) => p.connected);
    this.victory = active.length > 0 && active.every((p) => p.exitedAt !== undefined);
  }

  private enterExit(player: PlayerRuntime, now: number): void {
    if (player.exitedAt !== undefined) return;
    player.exitedAt = now;
    player.input = { ...EMPTY_INPUT, sequence: player.lastSequence };
    player.grounded = false;
    player.supportBody = undefined;
    player.supportedHangingPlayers = 0;
    Matter.Body.setPosition(player.body, { x: this.doorDefinition.x, y: this.doorDefinition.y });
    Matter.Body.setVelocity(player.body, { x: 0, y: 0 });
    Matter.Composite.remove(this.engine.world, player.body);
    player.inWorld = false;
  }

  private updateTeamRespawn(now: number): void {
    const players = [...this.players.values()].filter((player) => player.exitedAt === undefined);
    if (players.length === 0) {
      this.teamRespawnAt = 0;
      return;
    }
    const everyoneFell = allConnectedPlayersInVoid(
      // A void-locked body is temporarily parked outside the world while its
      // timer runs, so use the logical death state rather than that parking Y.
      players.map((player) => ({
        connected: player.connected,
        y: player.voidLocked ? this.deathY + 1 : player.body.position.y,
      })),
      this.deathY
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
    this.respawnTeamAtCheckpoints(now);
  }

  private respawnTeamAtCheckpoints(now: number): void {
    for (const player of this.players.values()) {
      // Crossing the exit is irreversible for the current match. Exited
      // players have deliberately been removed from Matter and must not be
      // reintroduced by any death or team void respawn.
      if (player.exitedAt !== undefined) continue;
      const spawn = player.checkpoint;
      Matter.Body.setPosition(player.body, spawn);
      Matter.Body.setVelocity(player.body, { x: 0, y: 0 });
      Matter.Body.setAngle(player.body, 0);
      Matter.Body.setAngularVelocity(player.body, 0);
      player.input = { ...EMPTY_INPUT, sequence: player.lastSequence };
      player.grounded = false;
      player.supportBody = undefined;
      player.coyoteUntil = 0;
      player.jumpBufferedUntil = 0;
      player.jumpCutApplied = false;
      player.jumpStartFeetY = undefined;
      player.deadUntil = 0;
      player.voidLocked = false;
      player.supportedHangingPlayers = 0;
      player.invulnerableUntil = now + PHYSICS.INVULNERABILITY_AFTER_RESPAWN_MS;
      player.lastValid = { x: spawn.x, y: spawn.y, vx: 0, vy: 0 };
      player.crystalMotion = { ...INITIAL_CRYSTAL_MOTION };
      if (!player.inWorld) {
        Matter.Composite.add(this.engine.world, player.body);
        player.inWorld = true;
      }
    }
    this.teamRespawnAt = 0;
  }

  // Player contact is physical only: no penalties or presentation events.
  drainPlayerContactEvents(): PlayerContactEvent[] {
    return [];
  }

  private isInsideExit(player: PlayerRuntime): boolean {
    return Math.abs(player.body.position.x - this.doorDefinition.x) < Math.max(50, this.doorDefinition.width / 2 + PHYSICS.PLAYER_WIDTH / 2)
      && Math.abs(player.body.position.y - this.doorDefinition.y) < Math.max(70, this.doorDefinition.height / 2 + PHYSICS.PLAYER_HEIGHT / 2);
  }

  snapshot(): GameSnapshot {
    const required = [...this.players.values()].filter((p) => p.connected).length;
    const inside = [...this.players.values()].filter((p) =>
      p.connected && p.exitedAt !== undefined
    ).length;
    const players: PlayerSnapshot[] = [...this.players.values()].map((p) => {
      const atExit = p.exitedAt !== undefined;
      return {
        id: p.id, name: p.name, color: p.color, x: p.body.position.x, y: p.body.position.y,
        velocityX: p.body.velocity.x * 60, velocityY: p.body.velocity.y * 60,
        state: derivePlayerState(
          p.body.velocity.x * 60,
          p.body.velocity.y * 60,
          p.grounded,
          p.deadUntil > Date.now(),
          atExit,
          0,
          p.voidLocked
        ),
        facing: p.body.velocity.x < -0.05 ? "left" : "right", grounded: p.grounded,
        connected: p.connected, lastProcessedInput: p.lastSequence,
        supportedHangingPlayers: p.supportedHangingPlayers,
        crystalMotion: { ...p.crystalMotion },
        jumpHeld: p.input.jumpHeld,
        jumpMotion: { coyoteUntil: p.coyoteUntil, jumpBufferedUntil: p.jumpBufferedUntil, jumpCutApplied: p.jumpCutApplied, jumpStartFeetY: p.jumpStartFeetY },
        exitedAt: p.exitedAt,
        electrocutedUntil: p.electrocutedUntil && p.electrocutedUntil > Date.now()
          ? p.electrocutedUntil
          : undefined,
        support: p.supportBody ? {
          id: p.supportBody.label,
          topY: p.supportBody.bounds.min.y,
          velocityX: p.supportBody.velocity.x * 60,
          velocityY: p.supportBody.velocity.y * 60,
        } : undefined,
      };
    });
    return {
      serverTick: this.tick, serverTime: Date.now(), players, ropes: [],
      objects: [
        ...this.boxes.map((b, i) => ({
          id: b.label, kind: "box" as const, x: b.position.x, y: b.position.y,
          width: this.boxDefinitions[i]!.width, height: this.boxDefinitions[i]!.height,
          velocityX: b.velocity.x * 60, velocityY: b.velocity.y * 60,
          texture: this.boxDefinitions[i]!.texture,
        })),
        ...this.platforms.map((b, i) => ({
          id: b.label, kind: "platform" as const, x: b.position.x, y: b.position.y,
          width: b.bounds.max.x - b.bounds.min.x, height: b.bounds.max.y - b.bounds.min.y,
          velocityX: b.velocity.x * 60, velocityY: b.velocity.y * 60,
          texture: this.platformDefinitions[i]!.texture,
        }))
      ],
      keyState: { collected: this.keyCollected, holderId: this.keyHolder, x: this.keyDefinition.x, y: this.keyDefinition.y },
      doorState: { open: this.keyCollected, inside, required, x: this.doorDefinition.x, y: this.doorDefinition.y },
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
    for (const player of this.players.values()) player.exitedAt = undefined;
    this.randomizeSpawnOrder();
    const slots = this.spawnSlots;
    for (const p of this.players.values()) {
      const spawn = slots[p.spawnSlot]!;
      Matter.Body.setPosition(p.body, spawn);
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      p.checkpoint = spawn;
      p.deadUntil = 0;
      p.voidLocked = false;
      p.supportedHangingPlayers = 0;
      p.supportBody = undefined;
      p.jumpStartFeetY = undefined;
      p.grounded = false;
      p.coyoteUntil = 0;
      p.jumpBufferedUntil = 0;
      p.jumpCutApplied = false;
      p.input = { ...EMPTY_INPUT, sequence: p.lastSequence };
      p.crystalMotion = { ...INITIAL_CRYSTAL_MOTION };
      if (!p.inWorld) {
        Matter.Composite.add(this.engine.world, p.body);
        p.inWorld = true;
      }
    }
  }
}
