import { describe, expect, it } from "vitest";
import { inputSchema } from "@tetherbound/shared";

describe("input validation", () => {
  const valid = { sequence: 12, left: false, right: true, jumpPressed: true, jumpHeld: true, clientTime: 1234 };

  it("accepts a strict boolean input contract", () => {
    expect(inputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects forged positions and non-boolean movement", () => {
    expect(inputSchema.safeParse({ ...valid, x: 9999 }).success).toBe(false);
    expect(inputSchema.safeParse({ ...valid, right: 1 }).success).toBe(false);
  });

  it("rejects duplicate-friendly invalid sequences", () => {
    expect(inputSchema.safeParse({ ...valid, sequence: -1 }).success).toBe(false);
    expect(inputSchema.safeParse({ ...valid, sequence: 1.5 }).success).toBe(false);
  });
});
