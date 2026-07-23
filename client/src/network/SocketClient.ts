import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents, JoinRequest, RoomReply, ServerToClientEvents
} from "@tetherbound/shared";

export class SocketClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  playerId = "";
  roomCode = "";
  private reconnectingSession = false;

  constructor() {
    this.socket = io(import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001", {
      autoConnect: true, reconnection: true, reconnectionAttempts: Infinity
    });
    this.socket.on("connect", () => this.reconnectSaved());
  }

  create(data: JoinRequest): Promise<RoomReply> {
    return new Promise((resolve) => this.socket.emit("room:create", data, (reply) => {
      this.capture(reply);
      resolve(reply);
    }));
  }

  join(code: string, data: JoinRequest): Promise<RoomReply> {
    return new Promise((resolve) => this.socket.emit("room:join", { ...data, code }, (reply) => {
      this.capture(reply);
      resolve(reply);
    }));
  }

  reconnectSaved(): void {
    if (this.reconnectingSession || !this.socket.connected) return;
    const raw = localStorage.getItem("tetherbound-session");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { code: string; name: string; color: number; reconnectToken: string };
      this.reconnectingSession = true;
      void this.join(saved.code, saved).finally(() => {
        this.reconnectingSession = false;
      });
    } catch { localStorage.removeItem("tetherbound-session"); }
  }

  private capture(reply: RoomReply): void {
    if (!reply.ok || !reply.room || !reply.playerId || !reply.reconnectToken) return;
    this.playerId = reply.playerId;
    this.roomCode = reply.room.code;
  }
}
