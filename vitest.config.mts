import { defineConfig } from "vitest/config";

// Unit tests cover the pure logic modules in lib/ (no Supabase/DOM needed).
export default defineConfig({
  test: { include: ["lib/**/*.test.ts"] },
});
