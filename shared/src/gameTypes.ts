export type PlayerState =
  | "Idle" | "Running" | "Jumping" | "Falling" | "Hanging" | "BeingPulled"
  | "Pushing" | "Stacked" | "Stunned" | "Dead" | "Respawning" | "AtExit";
export type MatchState = "lobby" | "playing" | "victory";
export type Facing = "left" | "right";

export interface LobbyPlayer {
  id: string;
  name: string;
  color: number;
  ready: boolean;
  connected: boolean;
  leader: boolean;
}

export interface RoomView {
  code: string;
  state: MatchState;
  players: LobbyPlayer[];
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  state: PlayerState;
  facing: Facing;
  grounded: boolean;
  connected: boolean;
  lastProcessedInput: number;
  supportedHangingPlayers: number;
  support?: {
    id: string;
    topY: number;
    velocityX: number;
    velocityY: number;
  };
}

export interface RopeSnapshot {
  a: string;
  b: string;
  distance: number;
  tension: number;
  active: boolean;
  points: Array<{ x: number; y: number }>;
}

export interface ObjectSnapshot {
  id: string;
  kind: "box" | "platform";
  x: number;
  y: number;
  width: number;
  height: number;
  velocityX: number;
  velocityY: number;
}

export interface VictoryResult {
  playerId: string;
  name: string;
  color: number;
  timeMs: number;
}

export interface GameSnapshot {
  serverTick: number;
  serverTime: number;
  players: PlayerSnapshot[];
  ropes: RopeSnapshot[];
  objects: ObjectSnapshot[];
  keyState: { collected: boolean; holderId?: string; x: number; y: number };
  doorState: { open: boolean; inside: number; required: number; x: number; y: number };
  matchState: MatchState;
  victoryResults: VictoryResult[];
}
