export interface VoidPlayer {
  connected: boolean;
  y: number;
}

export function allConnectedPlayersInVoid(players: VoidPlayer[], deathY: number): boolean {
  const connected = players.filter((player) => player.connected);
  return connected.length > 0 && connected.every((player) => player.y > deathY);
}
