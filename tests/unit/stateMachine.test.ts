import { describe, expect, it } from "vitest";
import { derivePlayerState } from "../../server/src/game/PlayerStateMachine";

describe("player state machine", () => {
  it("derives locomotion from authoritative physics", () => {
    expect(derivePlayerState(0, 0, true, false, false, 0)).toBe("Idle");
    expect(derivePlayerState(100, 0, true, false, false, 0)).toBe("Running");
    expect(derivePlayerState(0, -100, false, false, false, 0)).toBe("Jumping");
    expect(derivePlayerState(0, 100, false, false, false, 0)).toBe("Falling");
  });

  it("prioritizes death and exit states", () => {
    expect(derivePlayerState(0, 0, true, true, true, 0)).toBe("Dead");
    expect(derivePlayerState(0, 0, true, false, true, 0)).toBe("AtExit");
  });
});
