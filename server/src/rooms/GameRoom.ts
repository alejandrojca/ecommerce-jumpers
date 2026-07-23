import crypto from "node:crypto";
import type { Server } from "socket.io";
import {
  NETWORK, ROOM_MAX_PLAYERS, ROOM_MIN_PLAYERS, type ClientToServerEvents,
  type LobbyPlayer, type MatchState, type PlayerInput, type RoomView, type ServerToClientEvents
} from "@tetherbound/shared";
import { ServerGame } from "../game/ServerGame.js";

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

  constructor(code: string, private readonly io: IO, private readonly onEmpty: () => void) {
    this.code = code;
  }

  get view(): RoomView {
    return { code: this.code, state: this.state, players: [...this.members.values()].map(this.publicMember) };
  }

  createMember(name: string, color: number, socketId: string): Member {
    if (this.state !== "lobby") throw new Error("La partida ya comenzó.");
    if (this.members.size >= ROOM_MAX_PLAYERS) throw new Error("La sala está completa.");
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
      this.emitView();
    }
  }

  setColor(id: string, color: number): void {
    const member = this.members.get(id);
    if (member && this.state === "lobby" && Number.isInteger(color) && color >= 0 && color <= 0xffffff) {
      member.color = color;
      this.emitView();
    }
  }

  start(id: string): string | undefined {
    const member = this.members.get(id);
    if (!member?.leader) return "Solo el líder puede iniciar.";
    const connected = [...this.members.values()].filter((m) => m.connected);
    if (connected.length < ROOM_MIN_PLAYERS) return `Se necesitan al menos ${ROOM_MIN_PLAYERS} jugadores.`;
    if (!connected.every((m) => m.ready)) return "Todos los jugadores deben estar listos.";
    this.stopGame();
    this.game = new ServerGame();
    for (const m of connected) this.game.addPlayer(m.id, m.name, m.color);
    this.state = "playing";
    this.io.to(this.code).emit("game:started");
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
    this.io.to(this.code).emit("game:started");
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

  private startSimulation(): void {
    this.simulationTimer = setInterval(() => this.game?.step(), 1000 / NETWORK.SERVER_TICK_RATE);
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

  private stopGame(): void {
    if (this.simulationTimer) clearInterval(this.simulationTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.simulationTimer = this.snapshotTimer = undefined;
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
