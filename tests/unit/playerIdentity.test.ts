import { describe, expect, it } from "vitest";
import { COLORS } from "@tetherbound/shared";
import { joinSchema } from "../../shared/src/validationSchemas";
import { GameRoom } from "../../server/src/rooms/GameRoom";

const silentIo = {
  to: () => ({ emit: () => undefined }),
};

describe("player identity", () => {
  it("requires a valid name except when reconnecting", () => {
    expect(joinSchema.safeParse({}).success).toBe(false);
    expect(joinSchema.safeParse({ name: "Ada" }).success).toBe(true);
    expect(joinSchema.safeParse({ reconnectToken: "saved-session" }).success).toBe(true);
  });

  it("assigns distinct random colors to new members", () => {
    const room = new GameRoom("TEST", silentIo as never, () => undefined);
    const ada = room.createMemberWithRandomColor("socket-a", "Ada");
    const lin = room.createMemberWithRandomColor("socket-b", "Lin");

    expect(COLORS).toContain(ada.color);
    expect(COLORS).toContain(lin.color);
    expect(lin.color).not.toBe(ada.color);
  });

  it("preserves the chosen identity in the room view", () => {
    const room = new GameRoom("TEST", silentIo as never, () => undefined);
    const member = room.createMember("socket-a", "Ada", COLORS[0]);

    expect(room.view.players[0]).toMatchObject({ id: member.id, name: "Ada", color: COLORS[0] });
  });

  it("rejects a duplicate color", () => {
    const room = new GameRoom("TEST", silentIo as never, () => undefined);
    room.createMember("socket-a", "Ada", COLORS[0]);
    expect(() => room.createMember("socket-b", "Lin", COLORS[0])).toThrow(/color ya está en uso/i);
  });

  it("keeps the original identity when reconnecting", () => {
    const room = new GameRoom("TEST", silentIo as never, () => undefined);
    const member = room.createMember("socket-a", "Ada", COLORS[0]);
    room.disconnect(member.id, "socket-a");
    const reconnected = room.reconnect(member.reconnectToken, "socket-b");
    expect(reconnected).toMatchObject({ id: member.id, name: "Ada", color: COLORS[0] });
  });
});
