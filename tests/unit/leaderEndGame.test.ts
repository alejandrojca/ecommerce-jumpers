import { describe, expect, it } from "vitest";
import { COLORS } from "@tetherbound/shared";
import { GameRoom } from "../../server/src/rooms/GameRoom";

describe("leader game exit", () => {
  it("only lets the leader end an active game and sends everyone to the main menu", () => {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const io = {
      to: () => ({ emit: (event: string, payload: unknown) => { emitted.push({ event, payload }); } }),
    };
    const room = new GameRoom("TEST", io as never, () => undefined);
    const leader = room.createMember("socket-a", "Ada", COLORS[0]);
    const teammate = room.createMember("socket-b", "Lin", COLORS[1]);
    room.setReady(leader.id, true);
    room.setReady(teammate.id, true);

    expect(room.start(leader.id)).toBeUndefined();
    expect(room.view.state).toBe("playing");
    expect(room.endGame(teammate.id)).toMatch(/solo el líder/i);
    expect(room.view.state).toBe("playing");

    expect(room.endGame(leader.id)).toBeUndefined();
    expect(emitted).toContainEqual({ event: "room:closed", payload: "El creador cerró la partida." });
  });
});
