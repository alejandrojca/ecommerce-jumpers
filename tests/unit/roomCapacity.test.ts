import { describe, expect, it } from "vitest";
import { COLORS, ROOM_MAX_PLAYERS } from "@tetherbound/shared";

describe("room capacity", () => {
  it("supports twelve players with a complete color palette", () => {
    expect(ROOM_MAX_PLAYERS).toBe(12);
    expect(COLORS).toHaveLength(12);
    expect(new Set(COLORS).size).toBe(12);
  });
});
