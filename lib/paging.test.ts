import { describe, it, expect } from "vitest";
import { selectAllPages } from "./paging";

// A fake table of `total` rows served `max` at a time, like PostgREST.
const table = (total: number, max: number) => (from: number, to: number) =>
  Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(to, total - 1, from + max - 1) - from + 1) }, (_, i) => from + i), error: null });

describe("selectAllPages", () => {
  it("returns every row past the 1,000-row cap", async () => {
    const r = await selectAllPages(table(2500, 1000));
    expect(r.data).toHaveLength(2500);
    expect(r.data.at(-1)).toBe(2499);
  });

  it("stops after one short page, and handles exactly one full page", async () => {
    expect((await selectAllPages(table(10, 1000))).data).toHaveLength(10);
    expect((await selectAllPages(table(1000, 1000))).data).toHaveLength(1000);
  });

  it("returns the error and the rows read so far", async () => {
    let calls = 0;
    const r = await selectAllPages(() => Promise.resolve(++calls === 1
      ? { data: Array(1000).fill(0), error: null }
      : { data: null, error: { message: "boom" } }));
    expect(r.error?.message).toBe("boom");
    expect(r.data).toHaveLength(1000);
  });
});
