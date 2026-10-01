import { describe, it, expect } from "vitest";
import { guessLocationByTime, describeGap, LocatedShot } from "./locationGuess";

const shot = (label: string, takenAt: string): LocatedShot => ({ label, takenAt, lat: 37.5, lng: 127, location: label });

describe("guessLocationByTime", () => {
  const shots = [shot("A", "2026-09-30T10:00:00Z"), shot("B", "2026-09-30T13:00:00Z")];

  it("picks the located photo closest in time", () => {
    expect(guessLocationByTime("2026-09-30T12:20:00Z", shots)?.label).toBe("B");
    expect(guessLocationByTime("2026-09-30T10:30:00Z", shots)?.gapMs).toBe(30 * 60 * 1000);
  });

  it("gives up beyond the max gap, or without a capture time", () => {
    expect(guessLocationByTime("2026-09-30T20:00:00Z", shots)).toBeNull();
    expect(guessLocationByTime(undefined, shots)).toBeNull();
    expect(guessLocationByTime("not a date", shots)).toBeNull();
  });
});

describe("describeGap", () => {
  it("reads in minutes, then hours", () => {
    expect(describeGap(20 * 1000)).toBe("at the same time");
    expect(describeGap(25 * 60 * 1000)).toBe("25 min apart");
    expect(describeGap(90 * 60 * 1000)).toBe("1.5 h apart");
  });
});
