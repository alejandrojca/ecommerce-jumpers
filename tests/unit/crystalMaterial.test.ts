import { describe, expect, it, vi } from "vitest";
import { paintCrystalMaterial } from "../../client/src/game/rendering/crystalMaterial";

function context() {
  return {
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
    strokeRect: vi.fn(), save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: "", strokeStyle: "", lineWidth: 1,
  };
}

describe("crystal surface material", () => {
  it.each([[320, 20], [24, 800], [1, 1], [2048, 250]])("paints %i x %i with bounded edges and clipping", (width, height) => {
    const ctx = context();
    paintCrystalMaterial(ctx as unknown as CanvasRenderingContext2D, width, height);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, width, height);
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
    for (const call of ctx.strokeRect.mock.calls) {
      expect(call.every(Number.isFinite)).toBe(true);
      expect(call[2]).toBeGreaterThanOrEqual(0);
      expect(call[3]).toBeGreaterThanOrEqual(0);
    }
    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(ctx.fill.mock.calls.length).toBeGreaterThan(4);
  });

  it("uses deterministic facets so regeneration does not flicker", () => {
    const first = context();
    const second = context();
    paintCrystalMaterial(first as unknown as CanvasRenderingContext2D, 200, 40);
    paintCrystalMaterial(second as unknown as CanvasRenderingContext2D, 200, 40);
    expect(first.lineTo.mock.calls).toEqual(second.lineTo.mock.calls);
  });
});
