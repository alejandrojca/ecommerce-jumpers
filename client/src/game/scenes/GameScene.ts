import Phaser from "phaser";
import { PHYSICS, type GameSnapshot, type PlayerInput } from "@tetherbound/shared";
import type { SocketClient } from "../../network/SocketClient";
import { SnapshotBuffer } from "../../network/SnapshotBuffer";
import { ClientPrediction } from "../../network/ClientPrediction";
import { InputController } from "../../input/InputController";
import { CLIENT_CONFIG } from "../../config/clientConfig";

export class GameScene extends Phaser.Scene {
  private readonly snapshots = new SnapshotBuffer();
  private readonly prediction = new ClientPrediction();
  private readonly pressed = new Set<string>();
  private readonly inputController = new InputController(this.pressed);
  private graphics!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private latest?: GameSnapshot;
  private predictionError = 0;
  private accumulator = 0;
  private sentThisSecond = 0;
  private statWindow = performance.now();
  private rttMs = 0;
  private pingTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly network: SocketClient, private readonly debugElement: HTMLElement) {
    super("GameScene");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#11172b");
    this.cameras.main.setBounds(0, 0, 2200, 720);
    this.graphics = this.add.graphics();
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
      this.sendInput(input);
      this.prediction.predict(input, 1 / 60);
      this.accumulator -= 1 / 60;
    }
    this.renderWorld();
    const local = this.latest.players.find((p) => p.id === this.network.playerId);
    if (local) {
      const target = Math.max(0, Math.min(2200 - this.scale.width, this.prediction.x - this.scale.width * 0.45));
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
    this.latest = snapshot;
    this.snapshots.push(snapshot);
    const local = snapshot.players.find((p) => p.id === this.network.playerId);
    if (local) this.predictionError = this.prediction.reconcile(local);
  };

  private renderWorld(): void {
    const snapshot = this.latest!;
    const g = this.graphics.clear();
    g.fillStyle(0x151d35).fillRect(0, 0, 2200, 720);
    g.fillStyle(0x1b2945, 0.55);
    for (let x = 0; x < 2200; x += 90) g.fillCircle(x, 140 + Math.sin(x * 0.01) * 70, 2);
    for (const object of snapshot.objects) {
      const rendered = this.snapshots.sampleObject(object.id) ?? object;
      if (rendered.kind === "platform") {
        const moving = rendered.id.startsWith("moving:");
        g.fillStyle(moving ? 0x71a7ff : 0x2d3959);
        g.fillRoundedRect(
          rendered.x - rendered.width / 2, rendered.y - rendered.height / 2,
          rendered.width, rendered.height, 6
        );
        g.lineStyle(2, moving ? 0xa8c8ff : 0x435276, 0.8)
          .strokeRoundedRect(
            rendered.x - rendered.width / 2, rendered.y - rendered.height / 2,
            rendered.width, rendered.height, 6
          );
      } else {
        g.fillStyle(0xc68954).fillRoundedRect(
          rendered.x - rendered.width / 2, rendered.y - rendered.height / 2,
          rendered.width, rendered.height, 7
        );
        g.lineStyle(3, 0x8d5c39).strokeRoundedRect(
          rendered.x - rendered.width / 2, rendered.y - rendered.height / 2,
          rendered.width, rendered.height, 7
        );
      }
    }
    for (const latestRope of snapshot.ropes) {
      const rope = this.snapshots.sampleRope(latestRope.a, latestRope.b) ?? latestRope;
      const a = this.renderPosition(rope.a);
      const b = this.renderPosition(rope.b);
      if (!a || !b) continue;
      const stress = Math.min(1, rope.tension / PHYSICS.ROPE_MAX_FORCE);
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x49dcb1), Phaser.Display.Color.ValueToColor(0xff5f6d), 100, stress * 100
      );
      g.lineStyle(5, Phaser.Display.Color.GetColor(color.r, color.g, color.b), rope.active ? 0.9 : 0.25);
      if (rope.points.length > 0) {
        const route = [a, ...rope.points, b];
        for (let index = 0; index < route.length - 1; index++) {
          g.lineBetween(route[index]!.x, route[index]!.y, route[index + 1]!.x, route[index + 1]!.y);
        }
      } else {
        const sag = Math.max(0, 22 * (1 - stress));
        const curve = new Phaser.Curves.QuadraticBezier(
          new Phaser.Math.Vector2(a.x, a.y),
          new Phaser.Math.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2 + sag),
          new Phaser.Math.Vector2(b.x, b.y)
        );
        curve.draw(g, 24);
      }
    }
    if (!snapshot.keyState.collected) this.drawKey(g, snapshot.keyState.x, snapshot.keyState.y);
    this.drawDoor(g, snapshot);
    for (const player of snapshot.players) this.drawPlayer(g, player.id);
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics, id: string): void {
    const player = this.latest!.players.find((p) => p.id === id)!;
    const pos = this.renderPosition(id)!;
    const alpha = player.connected ? (player.state === "Dead" ? 0.2 : 1) : 0.38;
    g.fillStyle(player.color, alpha).fillRoundedRect(
      pos.x - PHYSICS.PLAYER_WIDTH / 2, pos.y - PHYSICS.PLAYER_HEIGHT / 2,
      PHYSICS.PLAYER_WIDTH, PHYSICS.PLAYER_HEIGHT, 8
    );
    g.lineStyle(id === this.network.playerId ? 3 : 2, id === this.network.playerId ? 0xffffff : 0x101426, alpha)
      .strokeRoundedRect(pos.x - PHYSICS.PLAYER_WIDTH / 2, pos.y - PHYSICS.PLAYER_HEIGHT / 2, PHYSICS.PLAYER_WIDTH, PHYSICS.PLAYER_HEIGHT, 8);
    const eyeX = pos.x + (player.facing === "right" ? 7 : -7);
    g.fillStyle(0x111526, alpha).fillCircle(eyeX, pos.y - 5, 3);
    let label = this.labels.get(id);
    if (!label) {
      label = this.add.text(0, 0, "", { fontFamily: "DM Sans", fontSize: "12px", color: "#ffffff", stroke: "#0c1020", strokeThickness: 4 }).setOrigin(0.5);
      this.labels.set(id, label);
    }
    label.setText(`${player.name}${player.connected ? "" : " • sin conexión"}`).setPosition(pos.x, pos.y - 34).setAlpha(alpha);
  }

  private drawKey(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.lineStyle(7, 0xffd166).strokeCircle(x, y, 11).lineBetween(x + 9, y + 8, x + 28, y + 27);
    g.lineBetween(x + 21, y + 20, x + 28, y + 13);
  }

  private drawDoor(g: Phaser.GameObjects.Graphics, snapshot: GameSnapshot): void {
    const d = snapshot.doorState;
    g.fillStyle(d.open ? 0x49dcb1 : 0x7e5978, 0.9).fillRoundedRect(d.x - 40, d.y - 55, 80, 110, 8);
    g.fillStyle(0x11172b).fillRoundedRect(d.x - 29, d.y - 43, 58, 98, 5);
    if (!d.open) g.fillStyle(0xffd166).fillCircle(d.x, d.y, 6);
  }

  private renderPosition(id: string): { x: number; y: number } | undefined {
    if (id === this.network.playerId) return { x: this.prediction.x, y: this.prediction.y };
    const sample = this.snapshots.samplePlayer(id);
    return sample ? { x: sample.x, y: sample.y } : undefined;
  }

  private updateDebug(): void {
    const now = performance.now();
    if (now - this.statWindow > 1000) {
      this.statWindow = now;
      this.sentThisSecond = 0;
    }
    const local = this.latest!.players.find((p) => p.id === this.network.playerId);
    const rope = this.latest!.ropes.find((r) => r.a === this.network.playerId || r.b === this.network.playerId);
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
      `rope distance   ${rope?.distance.toFixed(1) ?? "-"}`,
      `rope tension    ${rope?.tension.toFixed(0) ?? "-"}`,
      `hanging load    ${local?.supportedHangingPlayers.toFixed(1) ?? "-"}`,
      `substeps        ${PHYSICS.PHYSICS_SUBSTEPS}`,
      `players         ${this.latest!.players.length}`,
    ].join("\n");
  }

  private onKeyDown = (event: KeyboardEvent): void => {
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
  };
}
