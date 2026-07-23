import type { GameSnapshot, RoomView, VictoryResult } from "./gameTypes.js";

export interface PlayerInput {
  sequence: number;
  left: boolean;
  right: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  clientTime: number;
}

export interface ClientToServerEvents {
  "room:create": (data: JoinRequest, reply: (result: RoomReply) => void) => void;
  "room:join": (data: JoinRequest & { code: string }, reply: (result: RoomReply) => void) => void;
  "room:ready": (ready: boolean) => void;
  "room:color": (color: number) => void;
  "room:start": (reply: (result: ActionReply) => void) => void;
  "net:ping": (clientTime: number, reply: (serverTime: number) => void) => void;
  "game:input": (input: PlayerInput) => void;
  "game:restart": () => void;
  "game:exitToLobby": (reply: (result: ActionReply) => void) => void;
  "game:playAgain": (reply: (result: ActionReply) => void) => void;
}
export interface ServerToClientEvents {
  "room:update": (room: RoomView) => void;
  "room:notice": (message: string) => void;
  "game:snapshot": (snapshot: GameSnapshot) => void;
  "game:started": () => void;
  "game:victory": (results: VictoryResult[]) => void;
}
export interface JoinRequest { name: string; color: number; reconnectToken?: string }
export interface RoomReply { ok: boolean; error?: string; room?: RoomView; playerId?: string; reconnectToken?: string }
export interface ActionReply { ok: boolean; error?: string }
