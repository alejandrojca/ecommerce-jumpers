import { describe, expect, it } from "vitest";
import { buildVictoryResults, recordFirstExit } from "../../server/src/game/VictorySystem";

describe("VictorySystem", () => {
  it("records only the first valid exit time", () => {
    const times = new Map<string, number>();
    recordFirstExit(times, "a", 1_000, 6_432);
    recordFirstExit(times, "a", 1_000, 8_999);
    expect(times.get("a")).toBe(5_432);
  });

  it("orders the slowest player first with millisecond precision", () => {
    const players = [
      { id: "fast", name: "Rayo", color: 1 },
      { id: "slow", name: "Tortuga", color: 2 },
      { id: "middle", name: "Brisa", color: 3 },
    ];
    const results = buildVictoryResults(players, new Map([
      ["fast", 3_125],
      ["slow", 12_987],
      ["middle", 8_401],
    ]));
    expect(results.map((result) => result.playerId)).toEqual(["slow", "middle", "fast"]);
    expect(results[0]!.timeMs).toBe(12_987);
  });
});
