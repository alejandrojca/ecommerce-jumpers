import { describe, expect, it } from "vitest";
import { anchorMobilityMultiplier, calculateAnchorLoads } from "../../server/src/game/AnchorLoadSystem";

describe("anchor hanging load", () => {
  it("assigns hanging players to the nearest stable anchor", () => {
    const loads = calculateAnchorLoads([
      { id: "anchor", hanging: false },
      { id: "h1", hanging: true },
      { id: "h2", hanging: true },
      { id: "h3", hanging: true },
    ]);
    expect(loads.get("anchor")).toBe(3);
  });

  it("shares an equidistant hanging player between two anchors", () => {
    const loads = calculateAnchorLoads([
      { id: "left", hanging: false },
      { id: "hanging", hanging: true },
      { id: "right", hanging: false },
    ]);
    expect(loads.get("left")).toBe(0.5);
    expect(loads.get("right")).toBe(0.5);
  });

  it("allows one hanging player normally and penalizes additional load", () => {
    expect(anchorMobilityMultiplier(1)).toBe(1);
    expect(anchorMobilityMultiplier(2)).toBeLessThan(1);
    expect(anchorMobilityMultiplier(3)).toBeLessThan(anchorMobilityMultiplier(2));
  });
});
