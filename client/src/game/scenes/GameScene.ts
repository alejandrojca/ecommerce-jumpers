import Phaser from "phaser";
import {
  PHYSICS, type EditableMapDefinition, type EditableMapObject, type GameSnapshot, type MapTexture, type PlayerInput
} from "@tetherbound/shared";
import type { SocketClient } from "../../network/SocketClient";
import { SnapshotBuffer } from "../../network/SnapshotBuffer";
import { ClientPrediction } from "../../network/ClientPrediction";
import { InputController } from "../../input/InputController";
import { CLIENT_CONFIG } from "../../config/clientConfig";
import { gameAudio } from "../../audio/GameAudio";

interface FrictionParticle {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  life: number;
  maxLife: number;
  size: number;
}

export class GameScene extends Phaser.Scene {
  private static readonly BACKGROUND_KEY = "level-background";
  private static readonly BACKGROUND_URL = "/assets/game/forest-background.png";
  private static readonly PLATFORM_KEY = "stone-grass-platform";
  private static readonly PLATFORM_URL = "/assets/game/stone-grass-platform.png";
  private readonly snapshots = new SnapshotBuffer();
  private readonly prediction = new ClientPrediction();
  private readonly pressed = new Set<string>();
  private readonly inputController = new InputController(this.pressed);
  private graphics!: Phaser.GameObjects.Graphics;
  private latest?: GameSnapshot;
  private predictionError = 0;
  private accumulator = 0;
  private sentThisSecond = 0;
  private statWindow = performance.now();
  private rttMs = 0;
  private pingTimer?: ReturnType<typeof setInterval>;
  private background?: Phaser.GameObjects.Image;
  private readonly platformImages = new Map<string, Phaser.GameObjects.Image>();
  private currentMap?: EditableMapDefinition;
  private previousSnapshot?: GameSnapshot;
  private lastFootstepAt = 0;
  private lastJumpSoundAt = 0;
  private lastPredictedVelocityX = 0;
  private lastFrictionBurstAt = 0;
  private frictionParticles: FrictionParticle[] = [];

  constructor(private readonly network: SocketClient, private readonly debugElement: HTMLElement) {
    super("GameScene");
  }

  preload(): void {
    // Vite serves files below client/public from the site root. If the optional
    // raster is unavailable Phaser simply keeps the procedural fallback below.
    this.load.image(GameScene.BACKGROUND_KEY, GameScene.BACKGROUND_URL);
    this.load.image(GameScene.PLATFORM_KEY, GameScene.PLATFORM_URL);
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#11172b");
    this.cameras.main.setBounds(0, 0, 2700, 800);
    if (this.textures.exists(GameScene.BACKGROUND_KEY)) {
      this.background = this.add.image(0, 0, GameScene.BACKGROUND_KEY)
        .setOrigin(0)
        .setScrollFactor(0)
        .setDepth(-10);
      this.coverBackground();
      this.scale.on(Phaser.Scale.Events.RESIZE, this.coverBackground, this);
    }
    // Dynamic gameplay graphics stay above the persistent raster platform visuals.
    this.graphics = this.add.graphics().setDepth(10);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.network.socket.on("game:snapshot", this.onSnapshot);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    this.measureRtt();
    this.pingTimer = setInterval(() => this.measureRtt(), 2000);
  }

  update(_time: number, deltaMs: number): void {
    if (!this.latest) return;
    const dt = Math.min(deltaMs, 33) / 1000;
    this.accumulator += dt;
    while (this.accumulator >= 1 / 60) {
      const input = this.inputController.read();
      const local = this.latest.players.find((p) => p.id === this.network.playerId);
      if (local && local.state !== "AtExit" && local.state !== "Dead" && local.state !== "Respawning") {
        if (input.jumpPressed && local.grounded && performance.now() - this.lastJumpSoundAt > 180) {
          gameAudio.jump();
          this.lastJumpSoundAt = performance.now();
        }
        this.sendInput(input);
        this.prediction.predict(input, 1 / 60);
      }
      this.accumulator -= 1 / 60;
    }
    this.renderWorld();
    const local = this.latest.players.find((p) => p.id === this.network.playerId);
    if (local) {
      this.updateFootsteps(local);
      this.updateFrictionEffect(local, deltaMs);
      const worldWidth = this.currentMap?.width ?? 2700;
      const target = Math.max(0, Math.min(worldWidth - this.scale.width, this.prediction.x - this.scale.width * 0.45));
      this.cameras.main.scrollX += (target - this.cameras.main.scrollX) * 0.08;
    }
    this.updateDebug();
  }

  private sendInput(input: PlayerInput): void {
    const jitter = CLIENT_CONFIG.DEBUG_JITTER_MS ? (Math.random() * 2 - 1) * CLIENT_CONFIG.DEBUG_JITTER_MS : 0;
    if (Math.random() < CLIENT_CONFIG.DEBUG_PACKET_LOSS) return;
    const delay = Math.max(0, CLIENT_CONFIG.DEBUG_LATENCY_MS + jitter);
    if (delay) setTimeout(() => this.network.socket.emit("game:input", input), delay);
    else this.network.socket.emit("game:input", input);
    this.sentThisSecond++;
  }

  private onSnapshot = (snapshot: GameSnapshot): void => {
    this.configureMap();
    this.processAudioTransitions(snapshot);
    this.latest = snapshot;
    this.snapshots.push(snapshot);
    const local = snapshot.players.find((p) => p.id === this.network.playerId);
    if (local) this.predictionError = this.prediction.reconcile(local, snapshot);
  };

  private processAudioTransitions(snapshot: GameSnapshot): void {
    const previous = this.previousSnapshot;
    this.previousSnapshot = snapshot;
    if (!previous) return;
    const current = snapshot.players.find((player) => player.id === this.network.playerId);
    const prior = previous.players.find((player) => player.id === this.network.playerId);
    if (current && prior) {
      if (current.state === "Jumping" && prior.state !== "Jumping" && performance.now() - this.lastJumpSoundAt > 180) {
        gameAudio.jump();
        this.lastJumpSoundAt = performance.now();
      }
      if (!prior.grounded && current.grounded && current.state !== "Dead" && current.state !== "Respawning") {
        gameAudio.land(Math.abs(prior.velocityY) / PHYSICS.MAX_FALL_SPEED);
      }
      if (!current.grounded && current.velocityY > 260 && prior.velocityY <= 260) gameAudio.fall();
      if (current.state === "Dead" && prior.state !== "Dead") gameAudio.death();
      if (current.state === "Respawning" && prior.state !== "Respawning") gameAudio.respawn();
      if (current.state === "AtExit" && prior.state !== "AtExit") gameAudio.exit();
    }
    if (!previous.keyState.collected && snapshot.keyState.collected) gameAudio.collectKey();
    if (!previous.doorState.open && snapshot.doorState.open) gameAudio.doorOpen();
  }

  private updateFootsteps(local: GameSnapshot["players"][number]): void {
    if (!local.grounded || Math.abs(this.prediction.vx) < 55 || local.state === "Dead" || local.state === "Respawning") return;
    const now = performance.now();
    const speed = Math.min(1, Math.abs(this.prediction.vx) / PHYSICS.MAX_RUN_SPEED);
    const texture = this.supportTexture(local);
    const interval = texture === "crystal"
      ? Phaser.Math.Linear(250, 175, speed)
      : Phaser.Math.Linear(390, 230, speed);
    if (now - this.lastFootstepAt < interval) return;
    this.lastFootstepAt = now;
    if (texture === "crystal") {
      gameAudio.skate(speed);
      return;
    }
    gameAudio.footstep(texture === "metal" || texture === "stone" ? "hard" : "soft");
  }

  private supportTexture(local: GameSnapshot["players"][number]): MapTexture | undefined {
    if (!local.support) return undefined;
    return this.definitionForSnapshot(local.support.id)?.texture
      ?? this.latest?.objects.find((object) => object.id === local.support?.id)?.texture;
  }

  private updateFrictionEffect(local: GameSnapshot["players"][number], deltaMs: number): void {
    const dt = Math.min(deltaMs, 33) / 1000;
    for (const particle of this.frictionParticles) {
      particle.x += particle.velocityX * dt;
      particle.y += particle.velocityY * dt;
      particle.velocityY += 115 * dt;
      particle.velocityX *= Math.pow(0.96, dt * 60);
      particle.life -= dt;
    }
    this.frictionParticles = this.frictionParticles.filter((particle) => particle.life > 0);

    const velocityX = this.prediction.vx;
    const previousSpeed = Math.abs(this.lastPredictedVelocityX);
    const speed = Math.abs(velocityX);
    const lostSpeed = previousSpeed - speed;
    const onCrystal = local.grounded && this.supportTexture(local) === "crystal";
    const now = performance.now();
    if (onCrystal && previousSpeed > 65 && lostSpeed > 4 && now - this.lastFrictionBurstAt > 55) {
      this.lastFrictionBurstAt = now;
      const direction = Math.sign(this.lastPredictedVelocityX) || 1;
      const intensity = Math.min(1, previousSpeed / PHYSICS.MAX_RUN_SPEED);
      const count = 2 + Math.round(intensity * 3);
      const feetY = this.prediction.y + PHYSICS.PLAYER_HEIGHT / 2 - 2;
      for (let index = 0; index < count && this.frictionParticles.length < 70; index++) {
        const life = 0.28 + Math.random() * 0.25;
        this.frictionParticles.push({
          x: this.prediction.x - direction * (PHYSICS.PLAYER_WIDTH * 0.28) + (Math.random() - 0.5) * 10,
          y: feetY - Math.random() * 5,
          velocityX: -direction * (25 + Math.random() * 75) + (Math.random() - 0.5) * 28,
          velocityY: -(25 + Math.random() * 70) * (0.65 + intensity * 0.55),
          life,
          maxLife: life,
          size: 2.5 + Math.random() * 4.5 * intensity,
        });
      }
    }
    this.lastPredictedVelocityX = velocityX;
  }

  private drawFrictionParticles(g: Phaser.GameObjects.Graphics): void {
    for (const particle of this.frictionParticles) {
      const progress = particle.life / particle.maxLife;
      const size = particle.size * (1.15 - progress * 0.25);
      g.fillStyle(0xeafcff, Math.min(0.78, progress * 0.9)).fillCircle(particle.x, particle.y, size);
      if (size > 4) {
        g.fillStyle(0xa9e9f5, progress * 0.32).fillCircle(particle.x - size * 0.45, particle.y + 1, size * 0.65);
      }
    }
  }

  private renderWorld(): void {
    const snapshot = this.latest!;
    const g = this.graphics.clear();
    this.drawEnvironment(g);
    this.drawAuthoredFeatures(g);

    const visiblePlatformIds = new Set<string>();
    for (const object of snapshot.objects) {
      const rendered = this.snapshots.sampleObject(object.id) ?? object;
      const left = rendered.x - rendered.width / 2;
      const top = rendered.y - rendered.height / 2;
      if (rendered.kind === "platform") {
        const definition = this.definitionForSnapshot(rendered.id);
        const texture = definition?.texture ?? (rendered.id.startsWith("moving:") ? "metal" : "grass");
        if (rendered.id.startsWith("moving:")) this.drawTexturedPlatform(g, left, top, rendered.width, rendered.height, texture, true);
        else if (texture === "grass" && this.syncPlatformImage(rendered.id, left, top, rendered.width, rendered.height)) {
          visiblePlatformIds.add(rendered.id);
        } else {
          this.drawTexturedPlatform(g, left, top, rendered.width, rendered.height, texture, false);
        }
      } else {
        this.drawCrate(g, left, top, rendered.width, rendered.height);
      }
    }
    for (const [id, image] of this.platformImages) {
      if (visiblePlatformIds.has(id)) continue;
      image.destroy();
      this.platformImages.delete(id);
    }

    if (!snapshot.keyState.collected) this.drawKey(g, snapshot.keyState.x, snapshot.keyState.y);
    this.drawDoor(g, snapshot);
    this.drawFrictionParticles(g);
    for (const player of snapshot.players) this.drawPlayer(g, player.id);
    this.drawTeamCharge(g, snapshot);
  }

  private configureMap(): void {
    const map = this.network.activeMap;
    if (!map || this.currentMap?.id === map.id) return;
    this.currentMap = map;
    this.cameras.main.setBounds(0, 0, map.width, map.height);
    this.background?.destroy();
    this.background = undefined;
    if (map.background.preset === "forest" && this.textures.exists(GameScene.BACKGROUND_KEY)) {
      this.background = this.add.image(0, 0, GameScene.BACKGROUND_KEY).setOrigin(0).setScrollFactor(0).setDepth(-10);
      this.coverBackground();
    } else if (map.background.preset === "custom" && map.background.value) {
      const mapId = map.id;
      const textureKey = `custom-map-background:${mapId}`;
      const source = new Image();
      source.onload = () => {
        if (this.currentMap?.id !== mapId) return;
        if (!this.textures.exists(textureKey)) this.textures.addImage(textureKey, source);
        this.background?.destroy();
        this.background = this.add.image(0, 0, textureKey).setOrigin(0).setScrollFactor(0).setDepth(-10);
        this.coverBackground();
      };
      source.src = map.background.value;
    }
  }

  private definitionForSnapshot(snapshotId: string): EditableMapObject | undefined {
    const separator = snapshotId.indexOf(":");
    const authoredId = separator >= 0 ? snapshotId.slice(separator + 1) : snapshotId;
    return this.currentMap?.objects.find((object) => object.id === authoredId);
  }

  private drawAuthoredFeatures(g: Phaser.GameObjects.Graphics): void {
    for (const object of this.currentMap?.objects ?? []) {
      const left = object.x - object.width / 2;
      const top = object.y - object.height / 2;
      if (object.kind === "deathZone") {
        g.fillStyle(0x8f263d, 0.62).fillRect(left, top, object.width, object.height);
        g.lineStyle(3, 0xff637d, 0.85).strokeRect(left, top, object.width, object.height);
        for (let x = left - object.height; x < left + object.width; x += 28) {
          g.lineStyle(8, 0x28121d, 0.7).lineBetween(x, top + object.height, x + object.height, top);
        }
      } else if (object.kind === "checkpoint") {
        g.lineStyle(5, 0x334355, 1).lineBetween(object.x, object.y + object.height / 2, object.x, object.y - object.height / 2);
        g.fillStyle(0x49dcb1, 0.9).fillTriangle(
          object.x + 2, object.y - object.height / 2,
          object.x + object.width, object.y - object.height / 2 + 14,
          object.x + 2, object.y - object.height / 2 + 28
        );
      } else if (object.kind === "decoration") {
        g.fillStyle(this.textureColor(object.texture), 0.48).fillRoundedRect(left, top, object.width, object.height, 8);
        g.lineStyle(2, 0xffffff, 0.35).strokeRoundedRect(left, top, object.width, object.height, 8);
      }
    }
  }

  private textureColor(texture: MapTexture): number {
    return ({
      grass: 0x5e9f35, stone: 0x667085, wood: 0x9a6338, metal: 0x8491a5,
      crystal: 0x4fd8dc, hazard: 0xd9415c, custom: 0x8e72d9,
    } as const)[texture];
  }

  private drawTexturedPlatform(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    texture: MapTexture,
    moving: boolean
  ): void {
    if (moving || texture === "metal") return this.drawMovingPlatform(g, x, y, width, height);
    if (texture === "grass") return this.drawStonePlatform(g, x, y, width, height);
    if (texture === "wood") {
      g.fillStyle(0x8b562f).fillRoundedRect(x, y, width, height, 5);
      g.lineStyle(3, 0x5f351f, 0.9).strokeRoundedRect(x, y, width, height, 5);
      for (let xx = x + 24; xx < x + width; xx += 32) g.lineBetween(xx, y + 2, xx, y + height - 2);
      return;
    }
    if (texture === "hazard") {
      g.fillStyle(0xc53c55).fillRect(x, y, width, height);
      for (let xx = x - height; xx < x + width; xx += 30) {
        g.lineStyle(9, 0x2b1720, 0.8).lineBetween(xx, y + height, xx + height, y);
      }
      return;
    }
    const color = this.textureColor(texture);
    g.fillStyle(color, 0.95).fillRoundedRect(x, y, width, height, 5);
    g.lineStyle(3, texture === "crystal" ? 0xb9ffff : 0x313848, 0.9).strokeRoundedRect(x, y, width, height, 5);
    if (texture === "crystal") {
      for (let xx = x + 12; xx < x + width; xx += 28) g.lineStyle(2, 0xffffff, 0.3).lineBetween(xx, y + 3, xx + 10, y + height - 3);
    }
  }

  private drawEnvironment(g: Phaser.GameObjects.Graphics): void {
    if (this.background) return;
    const worldWidth = this.currentMap?.width ?? 2700;
    const worldHeight = this.currentMap?.height ?? 800;
    const preset = this.currentMap?.background.preset ?? "sky";
    if (preset === "solid") {
      g.fillStyle(0x5672a0).fillRect(0, 0, worldWidth, worldHeight);
      return;
    }
    if (preset === "night") {
      g.fillGradientStyle(0x0b1024, 0x0b1024, 0x273b62, 0x273b62, 1).fillRect(0, 0, worldWidth, worldHeight);
      g.fillStyle(0xfff1b6, 0.9).fillCircle(worldWidth * 0.78, 110, 42);
      for (let x = 80; x < worldWidth; x += 170) g.fillStyle(0xffffff, 0.75).fillCircle(x, 55 + (x % 120), 2);
      return;
    }
    // Layered daylight landscape with depth cues inspired by the reference.
    g.fillGradientStyle(0x20aeea, 0x20aeea, 0xbcefff, 0xbcefff, 1).fillRect(0, 0, worldWidth, worldHeight);
    g.fillStyle(0xffffff, 0.9);
    for (const [x, y, scale] of [[120, 105, 1], [570, 155, .75], [1040, 88, 1.1], [1590, 145, .7], [2040, 92, .9]] as const) {
      g.fillEllipse(x, y, 150 * scale, 38 * scale).fillCircle(x - 48 * scale, y - 8 * scale, 28 * scale)
        .fillCircle(x, y - 25 * scale, 42 * scale).fillCircle(x + 44 * scale, y - 9 * scale, 30 * scale);
    }
    // Distant mountains and mist.
    g.fillStyle(0x7ac9db, 0.5);
    for (let x = -120; x < worldWidth; x += 310) g.fillTriangle(x, 470, x + 155, 255 + (x % 3) * 20, x + 330, 470);
    g.fillStyle(0xa9dfd2, 0.72);
    for (let x = -80; x < worldWidth; x += 180) g.fillCircle(x, 470, 115).fillCircle(x + 70, 450, 90);
    g.fillStyle(0x4fae7b, 0.55);
    for (let x = 20; x < worldWidth; x += 105) {
      const h = 52 + (x % 70);
      g.fillStyle(0x356f5b, 0.45).fillRect(x - 6, 525 - h, 12, h + 80);
      g.fillStyle(0x4fae7b, 0.62).fillCircle(x, 515 - h, 42).fillCircle(x - 28, 528 - h, 31).fillCircle(x + 29, 528 - h, 34);
    }
    g.fillStyle(0x2d7658, 0.32).fillRect(0, 545, worldWidth, Math.max(255, worldHeight - 545));
    // Foreground foliage silhouettes frame the play field without hiding collision surfaces.
    g.fillStyle(0x173f38, 0.8);
    for (const x of [25, 75, 145, 2060, 2125, 2180]) {
      g.fillTriangle(x - 48, 720, x, 635 - (x % 35), x + 28, 720);
      g.fillTriangle(x - 25, 720, x + 22, 650, x + 55, 720);
    }
  }

  private drawStonePlatform(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    g.fillStyle(0x3a241d, 0.24).fillRoundedRect(x + 4, y + 5, w, h, 6);
    g.fillStyle(0x70432f).fillRoundedRect(x, y, w, h, 5);
    g.lineStyle(2, 0x352119, 0.95).strokeRoundedRect(x, y, w, h, 5);
    const rowH = 22;
    for (let row = 0; row * rowH < h; row++) {
      const yy = y + row * rowH;
      const offset = row % 2 ? 18 : 0;
      g.lineStyle(2, 0x45291f, 0.8).lineBetween(x + 2, yy, x + w - 2, yy);
      for (let xx = x + offset + 34; xx < x + w - 2; xx += 42) {
        g.lineBetween(xx, yy, xx - 2, Math.min(y + h, yy + rowH));
      }
      // Small deterministic highlights break the flat brick pattern without
      // introducing frame-to-frame flicker.
      g.lineStyle(1, 0xa66a49, 0.45);
      for (let xx = x + 9 + offset; xx < x + w - 8; xx += 42) {
        const end = Math.min(x + w - 5, xx + 17);
        g.lineBetween(xx, yy + 6, end, yy + 4);
      }
    }
    // Bright, irregular grass cap echoes the reference while collision geometry stays untouched.
    g.fillStyle(0x285f1c).fillRoundedRect(x - 1, y - 1, w + 2, Math.min(14, h + 2), 5);
    g.fillStyle(0x65a923).fillRoundedRect(x, y - 5, w, 9, 4);
    g.lineStyle(2, 0x9bd43a, 0.9).lineBetween(x + 4, y - 4, x + w - 4, y - 4);
    for (let xx = x + 8; xx < x + w - 5; xx += 18) {
      const blade = 4 + ((xx * 7) % 7);
      g.fillTriangle(xx - 3, y, xx, y - blade, xx + 4, y);
    }
    if (h > 28 && w > 55) {
      g.lineStyle(3, 0x367a28, 0.9);
      for (let xx = x + 24; xx < x + w; xx += 92) {
        g.lineBetween(xx, y + 5, xx + 2, Math.min(y + h - 3, y + 25));
        g.fillStyle(0x4b9b31).fillCircle(xx - 3, y + 17, 4).fillCircle(xx + 6, y + 27, 4);
      }
    }
  }

  private drawMovingPlatform(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    g.fillStyle(0x4b3223).fillRoundedRect(x - 4, y - 3, w + 8, h + 6, 7);
    g.fillStyle(0xb97831).fillRoundedRect(x, y, w, h, 5);
    g.lineStyle(2, 0xf0b44e, 0.8).strokeRoundedRect(x + 2, y + 2, w - 4, h - 4, 4);
    for (let xx = x + 18; xx < x + w; xx += 30) g.lineStyle(2, 0x77431f, .7).lineBetween(xx, y + 2, xx, y + h - 2);
    g.fillStyle(0xf6c453).fillCircle(x + 12, y + h / 2, 4).fillCircle(x + w - 12, y + h / 2, 4);
  }

  private drawCrate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    g.fillStyle(0x6e3d20).fillRoundedRect(x, y, w, h, 5);
    g.fillStyle(0xb96d2d).fillRoundedRect(x + 4, y + 4, w - 8, h - 8, 2);
    g.lineStyle(5, 0x75401f).strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, 2)
      .lineBetween(x + 7, y + 7, x + w - 7, y + h - 7).lineBetween(x + w - 7, y + 7, x + 7, y + h - 7);
    g.lineStyle(2, 0xe29b4d, .65).strokeRoundedRect(x + 7, y + 7, w - 14, h - 14, 1);
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics, id: string): void {
    const player = this.latest!.players.find((p) => p.id === id)!;
    const pos = this.renderPosition(id)!;
    const exitProgress = player.exitedAt === undefined
      ? 0
      : Phaser.Math.Clamp((this.latest!.serverTime - player.exitedAt) / 500, 0, 1);
    const scale = 1 - exitProgress;
    const alpha = (player.connected ? (player.state === "Dead" ? 0.2 : 1) : 0.38) * scale;
    if (scale <= 0) {
      return;
    }
    const left = pos.x - PHYSICS.PLAYER_WIDTH / 2;
    const top = pos.y - PHYSICS.PLAYER_HEIGHT / 2;
    g.fillStyle(0x17222a, .22 * alpha).fillEllipse(pos.x + 2, pos.y + PHYSICS.PLAYER_HEIGHT / 2 + 4, 38 * scale, 9 * scale);
    g.fillStyle(player.color, alpha).fillRoundedRect(
      pos.x - PHYSICS.PLAYER_WIDTH * scale / 2,
      pos.y - (PHYSICS.PLAYER_HEIGHT - 5) * scale / 2,
      PHYSICS.PLAYER_WIDTH * scale,
      (PHYSICS.PLAYER_HEIGHT - 5) * scale,
      10 * scale
    );
    g.fillStyle(0xffffff, .18 * alpha).fillRoundedRect(left + 5, top + 8, 7, PHYSICS.PLAYER_HEIGHT - 16, 4);
    g.lineStyle(id === this.network.playerId ? 3 : 2, id === this.network.playerId ? 0xffffff : 0x38251d, alpha)
      .strokeRoundedRect(left, top + 5, PHYSICS.PLAYER_WIDTH, PHYSICS.PLAYER_HEIGHT - 5, 10);
    const facing = player.facing === "right" ? 1 : -1;
    const eyeX = pos.x + facing * 7;
    if (player.state === "Dead") {
      // Uneven crossed eyes make the requested `( X x )` death face readable:
      // the left mark is deliberately larger than the right one.
      g.lineStyle(3, 0x18212a, 1)
        .lineBetween(pos.x - 10, pos.y - 10, pos.x - 3, pos.y - 3)
        .lineBetween(pos.x - 3, pos.y - 10, pos.x - 10, pos.y - 3);
      g.lineStyle(2, 0x18212a, 1)
        .lineBetween(pos.x + 4, pos.y - 7, pos.x + 8, pos.y - 3)
        .lineBetween(pos.x + 8, pos.y - 7, pos.x + 4, pos.y - 3);
    } else {
      g.fillStyle(0xffffff, alpha).fillEllipse(eyeX, pos.y - 6, 7, 10);
      g.fillStyle(0x18212a, alpha).fillCircle(eyeX + facing, pos.y - 5, 2.5);
    }
    g.lineStyle(2, 0x38251d, alpha).lineBetween(pos.x + facing * 4, pos.y + 7, pos.x + facing * 9, pos.y + 8);
  }

  private drawTeamCharge(g: Phaser.GameObjects.Graphics, snapshot: GameSnapshot): void {
    const width = Math.min(620, this.scale.width * 0.62);
    const height = 76;
    const x = this.cameras.main.scrollX + (this.scale.width - width) / 2;
    const y = 64;
    const gap = 10;
    const padding = 12;
    const maxCharge = Math.max(1, snapshot.teamCharge.max);
    const segmentWidth = (width - padding * 2 - gap * (maxCharge - 1)) / maxCharge;
    g.fillStyle(0x07131e, 0.88).fillRoundedRect(x, y, width, height, 18);
    g.lineStyle(4, 0xffffff, 0.9).strokeRoundedRect(x, y, width, height, 18);
    for (let index = 0; index < maxCharge; index++) {
      const filled = index < snapshot.teamCharge.current;
      const sx = x + padding + index * (segmentWidth + gap);
      g.fillStyle(filled ? 0x62e36e : 0x3b4650, filled ? 1 : 0.7)
        .fillRoundedRect(sx, y + padding, segmentWidth, height - padding * 2, 12);
      g.lineStyle(3, filled ? 0xc9ffd0 : 0x78828b, 1)
        .strokeRoundedRect(sx, y + padding, segmentWidth, height - padding * 2, 12);
    }
  }

  private drawKey(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0xffed8a, .22).fillCircle(x + 8, y + 8, 28);
    g.lineStyle(9, 0x8c5718).strokeCircle(x, y, 11).lineBetween(x + 9, y + 8, x + 28, y + 27);
    g.lineBetween(x + 21, y + 20, x + 28, y + 13);
    g.lineStyle(5, 0xffd33d).strokeCircle(x, y, 11).lineBetween(x + 9, y + 8, x + 28, y + 27);
    g.lineBetween(x + 21, y + 20, x + 28, y + 13);
    g.fillStyle(0xffffff, .8).fillCircle(x - 4, y - 5, 3);
  }

  private drawDoor(g: Phaser.GameObjects.Graphics, snapshot: GameSnapshot): void {
    const d = snapshot.doorState;
    // Stone portal, warm timber door and a celebratory flag silhouette.
    g.fillStyle(0x513326).fillRoundedRect(d.x - 49, d.y - 61, 98, 121, 9);
    g.fillStyle(0x84513a).fillRoundedRect(d.x - 43, d.y - 56, 86, 116, 7);
    for (let yy = d.y - 48; yy < d.y + 50; yy += 22) g.lineStyle(2, 0x5a382b, .7).lineBetween(d.x - 42, yy, d.x + 42, yy);
    g.fillStyle(d.open ? 0x193c31 : 0x7c401f).fillRoundedRect(d.x - 30, d.y - 43, 60, 103, { tl: 25, tr: 25, bl: 4, br: 4 });
    g.lineStyle(4, d.open ? 0x68ce77 : 0xe1a14c).strokeRoundedRect(d.x - 30, d.y - 43, 60, 103, { tl: 25, tr: 25, bl: 4, br: 4 });
    if (d.open) {
      g.fillStyle(0xffe477, .28).fillRoundedRect(d.x - 21, d.y - 33, 42, 86, 15);
      g.fillStyle(0xb7f08a).fillTriangle(d.x - 12, d.y + 16, d.x + 15, d.y + 5, d.x + 15, d.y + 27);
    } else {
      g.lineStyle(2, 0x4d2819, .75);
      for (let xx = d.x - 17; xx < d.x + 25; xx += 14) g.lineBetween(xx, d.y - 27, xx, d.y + 48);
      g.fillStyle(0xffd64d).fillCircle(d.x + 14, d.y + 8, 6);
    }
    g.lineStyle(4, 0x633618).lineBetween(d.x + 38, d.y - 60, d.x + 38, d.y - 116);
    g.fillStyle(d.open ? 0xf03b2f : 0xe8b52e).fillTriangle(d.x + 40, d.y - 113, d.x + 82, d.y - 101, d.x + 40, d.y - 88);
  }

  private renderPosition(id: string): { x: number; y: number } | undefined {
    if (id === this.network.playerId) {
      const local = this.latest!.players.find((player) => player.id === id);
      if (local?.state === "AtExit" || local?.state === "Dead" || local?.state === "Respawning") {
        return { x: local.x, y: local.y };
      }
      return { x: this.prediction.x, y: this.prediction.y };
    }
    const sample = this.snapshots.samplePlayer(id);
    return sample ? { x: sample.x, y: sample.y } : undefined;
  }

  private syncPlatformImage(id: string, x: number, y: number, width: number, height: number): boolean {
    if (!this.textures.exists(GameScene.PLATFORM_KEY)) return false;

    const pixelWidth = Math.max(1, Math.ceil(width));
    const pixelHeight = Math.max(1, Math.ceil(height));
    const textureKey = `${GameScene.PLATFORM_KEY}:${pixelWidth}x${pixelHeight}`;
    if (!this.textures.exists(textureKey)) {
      this.createPlatformTexture(textureKey, pixelWidth, pixelHeight);
    }
    if (!this.textures.exists(textureKey)) return false;

    let image = this.platformImages.get(id);
    if (image && image.texture.key !== textureKey) {
      image.destroy();
      image = undefined;
    }
    if (!image) {
      image = this.add.image(x, y, textureKey).setOrigin(0).setDepth(0);
      this.platformImages.set(id, image);
    }
    image.setPosition(x, y).setDisplaySize(width, height).setVisible(true);
    return true;
  }

  private createPlatformTexture(textureKey: string, width: number, height: number): void {
    const source = this.textures.get(GameScene.PLATFORM_KEY).getSourceImage() as HTMLImageElement;
    const sourceWidth = source.naturalWidth || source.width;
    const sourceHeight = source.naturalHeight || source.height;
    if (!sourceWidth || !sourceHeight) return;

    // Crop with "cover" semantics. Vertical crops are anchored at the top so
    // every short platform preserves the grass cap from the source artwork.
    const targetAspect = width / height;
    const sourceAspect = sourceWidth / sourceHeight;
    let sourceX = 0;
    let sourceY = 0;
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;
    if (sourceAspect > targetAspect) {
      cropWidth = sourceHeight * targetAspect;
      sourceX = (sourceWidth - cropWidth) / 2;
    } else {
      cropHeight = sourceWidth / targetAspect;
    }

    const texture = this.textures.createCanvas(textureKey, width, height);
    if (!texture) return;
    texture.getContext().drawImage(
      source,
      sourceX, sourceY, cropWidth, cropHeight,
      0, 0, width, height
    );
    texture.refresh();
  }

  private coverBackground(): void {
    if (!this.background) return;
    const texture = this.background.texture.getSourceImage() as HTMLImageElement;
    const sourceWidth = texture.naturalWidth || texture.width;
    const sourceHeight = texture.naturalHeight || texture.height;
    if (!sourceWidth || !sourceHeight) return;
    const scale = Math.max(this.scale.width / sourceWidth, this.scale.height / sourceHeight);
    this.background.setScale(scale);
    this.background.setPosition(
      (this.scale.width - sourceWidth * scale) / 2,
      (this.scale.height - sourceHeight * scale) / 2
    );
  }

  private updateDebug(): void {
    const now = performance.now();
    if (now - this.statWindow > 1000) {
      this.statWindow = now;
      this.sentThisSecond = 0;
    }
    const local = this.latest!.players.find((p) => p.id === this.network.playerId);
    this.debugElement.textContent = [
      `FPS             ${Math.round(this.game.loop.actualFps)}`,
      `RTT             ${this.rttMs.toFixed(0)} ms`,
      `server tick     ${this.latest!.serverTick}`,
      `inputs/s        ${this.sentThisSecond}`,
      `snapshots/s     ${this.snapshots.measuredRate.toFixed(1)}`,
      `snapshot jitter ${this.snapshots.jitterMs.toFixed(1)} ms`,
      `pending inputs  ${this.prediction.pendingCount}`,
      `prediction err  ${this.predictionError.toFixed(1)} px`,
      `authoritative   ${local ? `${local.x.toFixed(1)}, ${local.y.toFixed(1)}` : "-"}`,
      `predicted       ${this.prediction.x.toFixed(1)}, ${this.prediction.y.toFixed(1)}`,
      `velocity        ${local ? `${local.velocityX.toFixed(0)}, ${local.velocityY.toFixed(0)}` : "-"}`,
      `state           ${local?.state ?? "-"}`,
      `grounded        ${local?.grounded ?? false}`,
      `team charge     ${this.latest!.teamCharge.current}/${this.latest!.teamCharge.max}`,
      `substeps        ${PHYSICS.PHYSICS_SUBSTEPS}`,
      `players         ${this.latest!.players.length}`,
    ].join("\n");
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    void gameAudio.unlock();
    this.pressed.add(event.code);
    if (event.code === "F3") {
      event.preventDefault();
      this.debugElement.classList.toggle("visible");
    }
    if (event.code === "KeyR") this.network.socket.emit("game:restart");
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.pressed.delete(event.code); };

  private measureRtt(): void {
    if (!this.network.socket.connected) return;
    const startedAt = performance.now();
    this.network.socket.timeout(3000).emit("net:ping", Date.now(), (error) => {
      if (!error) this.rttMs = performance.now() - startedAt;
    });
  }

  private onShutdown = (): void => {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.network.socket.off("game:snapshot", this.onSnapshot);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.coverBackground, this);
    for (const image of this.platformImages.values()) image.destroy();
    this.platformImages.clear();
    this.previousSnapshot = undefined;
    this.frictionParticles = [];
    this.lastPredictedVelocityX = 0;
  };
}
