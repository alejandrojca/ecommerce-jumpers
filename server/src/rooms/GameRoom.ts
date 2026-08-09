import crypto from "node:crypto";
import type { Server } from "socket.io";
import {
  COLORS, NETWORK, ROOM_MAX_PLAYERS, ROOM_MIN_PLAYERS, type ClientToServerEvents,
  type EditableMapDefinition, type LobbyPlayer, type MatchState, type PlayerInput, type RoomView, type ServerToClientEvents
} from "@tetherbound/shared";
import { ServerGame } from "../game/ServerGame.js";
import { defaultMapDefinition } from "../levels/level1.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

interface Member extends LobbyPlayer {
  socketId?: string;
  reconnectToken: string;
  disconnectTimer?: NodeJS.Timeout;
  inputWindowStarted: number;
  inputCount: number;
}

export class GameRoom {
  readonly code: string;
  private readonly members = new Map<string, Member>();
  private state: MatchState = "lobby";
  private game?: ServerGame;
  private simulationTimer?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;
  private simulationAccumulator = 0;
  private lastSimulationTime = 0;
  readonly map: EditableMapDefinition;
  private readonly customMap?: EditableMapDefinition;

  constructor(code: string, private readonly io: IO, private readonly onEmpty: () => void, map?: EditableMapDefinition) {
    this.code = code;
    this.customMap = map ? structuredClone(map) : undefined;
    this.map = structuredClone(map ?? defaultMapDefinition());
  }

  get view(): RoomView {
    return { code: this.code, state: this.state, players: [...this.members.values()].map(this.publicMember), map: this.map };
  }

  createMember(socketId: string, name: string, color: number): Member {
    if (this.state !== "lobby") throw new Error("La partida ya comenzó.");
    if (this.members.size >= ROOM_MAX_PLAYERS) throw new Error("La sala está completa.");
    name = name.trim();
    if (!name || name.length > 18) throw new Error("El nombre debe tener entre 1 y 18 caracteres.");
    if (!COLORS.includes(color as (typeof COLORS)[number])) throw new Error("El color elegido no es válido.");
    if ([...this.members.values()].some((member) => member.color === color)) {
      throw new Error("Ese color ya está en uso. Elegí otro.");
    }
    const id = crypto.randomUUID();
    const member: Member = {
      id, name, color, ready: false, connected: true, leader: this.members.size === 0,
      socketId, reconnectToken: crypto.randomBytes(24).toString("base64url"),
      inputWindowStarted: Date.now(), inputCount: 0
    };
    this.members.set(id, member);
    this.broadcast(`${name} se unió.`);
    return member;
  }

  createMemberWithRandomColor(socketId: string, name: string): Member {
    const usedColors = new Set([...this.members.values()].map((member) => member.color));
    const availableColors = COLORS.filter((color) => !usedColors.has(color));
    if (availableColors.length === 0) throw new Error("No quedan colores disponibles.");
    const color = availableColors[Math.floor(Math.random() * availableColors.length)]!;
    return this.createMember(socketId, name, color);
  }

  reconnect(token: string, socketId: string): Member | undefined {
    const member = [...this.members.values()].find((m) => m.reconnectToken === token);
    if (!member) return undefined;
    if (member.disconnectTimer) clearTimeout(member.disconnectTimer);
    member.socketId = socketId;
    member.connected = true;
    member.disconnectTimer = undefined;
    this.game?.setConnected(member.id, true);
    this.broadcast(`${member.name} se reconectó.`);
    return member;
  }

  setReady(id: string, ready: boolean): void {
    const member = this.members.get(id);
    if (member && this.state === "lobby") {
      member.ready = ready;
      this.broadcast(ready ? `${member.name} está listo.` : `${member.name} dejó de estar listo.`);
    }
  }

  start(id: string): string | undefined {
    const member = this.members.get(id);
    if (!member?.leader) return "Solo el líder puede iniciar.";
    const connected = [...this.members.values()].filter((m) => m.connected);
    if (connected.length < ROOM_MIN_PLAYERS) return `Se necesitan al menos ${ROOM_MIN_PLAYERS} jugadores.`;
    if (!connected.every((m) => m.ready)) return "Todos los jugadores deben estar listos.";
    this.stopGame();
    this.game = new ServerGame(this.customMap);
    for (const m of connected) this.game.addPlayer(m.id, m.name, m.color);
    this.game.randomizeSpawnOrder();
    this.state = "playing";
    this.io.to(this.code).emit("game:started", this.map);
    this.emitView();
    this.startSimulation();
    return undefined;
  }

  playAgain(id: string): string | undefined {
    const member = this.members.get(id);
    if (!member?.leader) return "Solo el líder puede volver a jugar.";
    if (this.state !== "victory" || !this.game) return "La partida todavía no terminó.";
    this.game.restart();
    this.state = "playing";
    this.io.to(this.code).emit("game:started", this.map);
    this.emitView();
    this.startSimulation();
    return undefined;
  }

  exitToLobby(id: string): string | undefined {
    const member = this.members.get(id);
    if (!member?.leader) return "Solo el líder puede salir al lobby.";
    if (this.state !== "victory") return "La partida todavía no terminó.";
    this.returnToLobby();
    return undefined;
  }

  endGame(id: string): string | undefined {
    const member = this.members.get(id);
    if (!member?.leader) return "Solo el líder puede terminar la partida.";
    if (this.state !== "playing" && this.state !== "victory") return "No hay una partida en curso.";
    this.closeRoom();
    return undefined;
  }

  private startSimulation(): void {
    const stepMs = 1000 / NETWORK.SERVER_TICK_RATE;
    this.simulationAccumulator = 0;
    this.lastSimulationTime = performance.now();
    this.simulationTimer = setInterval(() => {
      const now = performance.now();
      this.simulationAccumulator += Math.min(250, now - this.lastSimulationTime);
      this.lastSimulationTime = now;
      let steps = 0;
      while (this.simulationAccumulator >= stepMs && steps < 5) {
        this.game?.step();
        for (const contact of this.game?.drainPlayerContactEvents() ?? []) {
          this.io.to(this.code).emit("game:playerContact", contact);
        }
        this.simulationAccumulator -= stepMs;
        steps++;
      }
      if (steps === 5) this.simulationAccumulator = 0;
    }, Math.max(1, stepMs / 2));
    this.snapshotTimer = setInterval(() => {
      const snapshot = this.game?.snapshot();
      if (!snapshot) return;
      this.io.to(this.code).emit("game:snapshot", snapshot);
      if (snapshot.matchState === "victory" && this.state !== "victory") {
        this.state = "victory";
        this.stopGame();
        this.io.to(this.code).emit("game:victory", snapshot.victoryResults);
        this.emitView();
      }
    }, 1000 / NETWORK.SNAPSHOT_RATE);
  }

  input(id: string, value: PlayerInput): void {
    const member = this.members.get(id);
    if (!member || this.state !== "playing") return;
    const now = Date.now();
    if (now - member.inputWindowStarted >= 1000) {
      member.inputWindowStarted = now;
      member.inputCount = 0;
    }
    if (++member.inputCount > NETWORK.MAX_INPUTS_PER_SECOND) return;
    this.game?.acceptInput(id, value);
  }

  restart(id: string): void {
    const member = this.members.get(id);
    if (member?.leader && process.env.NODE_ENV !== "production") this.game?.restart();
  }

  disconnect(id: string, socketId?: string): void {
    const member = this.members.get(id);
    if (!member) return;
    // Ignore a late disconnect from a socket that has already been replaced by reconnection.
    if (socketId && member.socketId && member.socketId !== socketId) return;
    member.connected = false;
    member.socketId = undefined;
    this.game?.setConnected(id, false);
    this.transferLeadership();
    this.broadcast(`${member.name} perdió la conexión.`);
    member.disconnectTimer = setTimeout(() => this.remove(id), Number(process.env.RECONNECT_TIMEOUT_MS) || NETWORK.RECONNECT_TIMEOUT_MS);
  }

  private remove(id: string): void {
    const member = this.members.get(id);
    if (!member || member.connected) return;
    this.game?.removePlayer(id);
    this.members.delete(id);
    this.transferLeadership();
    this.emitView();
    if (this.members.size === 0) {
      this.stopGame();
      this.onEmpty();
    }
  }

  private returnToLobby(): void {
    this.stopGame();
    this.state = "lobby";
    for (const member of this.members.values()) member.ready = false;
    this.emitView();
  }

  private closeRoom(): void {
    this.stopGame();
    this.io.to(this.code).emit("room:closed", "El creador cerró la partida.");
  }

  private stopGame(): void {
    if (this.simulationTimer) clearInterval(this.simulationTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.simulationTimer = this.snapshotTimer = undefined;
    this.simulationAccumulator = 0;
  }

  private transferLeadership(): void {
    const connected = [...this.members.values()].filter((m) => m.connected);
    if (connected.some((m) => m.leader)) return;
    for (const m of this.members.values()) m.leader = false;
    if (connected[0]) connected[0].leader = true;
  }

  private publicMember(member: Member): LobbyPlayer {
    return {
      id: member.id, name: member.name, color: member.color, ready: member.ready,
      connected: member.connected, leader: member.leader
    };
  }

  private emitView(): void {
    this.io.to(this.code).emit("room:update", this.view);
  }

  private broadcast(message: string): void {
    this.io.to(this.code).emit("room:notice", message);
    this.emitView();
  }
}
