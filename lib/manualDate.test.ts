import { describe, it, expect } from "vitest";
import { toDateInputValue, captureFromDateInput } from "./manualDate";

describe("manual capture date", () => {
  it("keeps the picked calendar day in local time", () => {
    const r = captureFromDateInput("2026-09-29")!;
    const d = new Date(r.captureTimestamp);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([2026, 9, 29, 12]);
    expect(toDateInputValue(d)).toBe("2026-09-29");
  });

  it("rejects an empty or malformed value", () => {
    expect(captureFromDateInput("")).toBeNull();
    expect(captureFromDateInput("29/09/2026")).toBeNull();
  });
});
