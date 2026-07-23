import { describe, expect, it } from "vitest";
import { allConnectedPlayersInVoid } from "../../server/src/game/RespawnSystem";

describe("team void respawn", () => {
  it("does not respawn while at least one connected player can perform a rescue", () => {
    expect(allConnectedPlayersInVoid([
      { connected: true, y: 900 },
      { connected: true, y: 600 },
    ], 790)).toBe(false);
  });

  it("respawns only after every connected player falls", () => {
    expect(allConnectedPlayersInVoid([
      { connected: true, y: 900 },
      { connected: true, y: 820 },
      { connected: false, y: 500 },
    ], 790)).toBe(true);
  });

  it("does not trigger without connected players", () => {
    expect(allConnectedPlayersInVoid([
      { connected: false, y: 900 },
    ], 790)).toBe(false);
  });
});
