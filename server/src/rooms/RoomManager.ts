import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents, ServerToClientEvents
} from "@tetherbound/shared";
import { GameRoom } from "./GameRoom.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly sessions = new Map<string, { room: GameRoom; playerId: string }>();

  constructor(private readonly io: IO) {}

  create(socket: GameSocket, name: string, color: number): { room: GameRoom; playerId: string; token: string } {
    this.leaveCurrent(socket.id);
    let code = "";
    do code = Math.random().toString(36).slice(2, 7).toUpperCase(); while (this.rooms.has(code));
    const room = new GameRoom(code, this.io, () => this.rooms.delete(code));
    this.rooms.set(code, room);
    const member = room.createMember(name, color, socket.id);
    socket.join(code);
    this.sessions.set(socket.id, { room, playerId: member.id });
    return { room, playerId: member.id, token: member.reconnectToken };
  }

  join(socket: GameSocket, code: string, name: string, color: number, reconnectToken?: string): { room: GameRoom; playerId: string; token: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new Error("Sala inexistente.");
    this.leaveCurrent(socket.id);
    const member = reconnectToken ? room.reconnect(reconnectToken, socket.id) : room.createMember(name, color, socket.id);
    if (!member) throw new Error("La reconexión ya no es válida.");
    socket.join(room.code);
    this.sessions.set(socket.id, { room, playerId: member.id });
    return { room, playerId: member.id, token: member.reconnectToken };
  }

  session(socketId: string) { return this.sessions.get(socketId); }

  disconnect(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;
    this.sessions.delete(socketId);
    session.room.disconnect(session.playerId, socketId);
  }

  private leaveCurrent(socketId: string): void {
    const previous = this.sessions.get(socketId);
    if (previous) previous.room.disconnect(previous.playerId, socketId);
    this.sessions.delete(socketId);
  }
}
