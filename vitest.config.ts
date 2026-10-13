import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Test shared source directly: never require a build or consume stale dist.
export default defineConfig({
  resolve: { alias: { "@tetherbound/shared": fileURLToPath(new URL("./shared/src/index.ts", import.meta.url)) } },
});
