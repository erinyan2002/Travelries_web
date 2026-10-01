import { describe, it, expect } from "vitest";
import { centeredView, clampView, cropRectOf, zoomView } from "./crop";

const frame = { width: 400, height: 500 };      // 4:5
const portrait = { width: 3000, height: 4000 }; // 3:4 phone photo

describe("crop geometry", () => {
  it("starts centered and covering the frame", () => {
    const r = cropRectOf(centeredView(portrait, frame), portrait, frame);
    expect(r.width).toBeCloseTo(1);                 // full width visible
    expect(r.height).toBeCloseTo(0.9375);           // 4:5 out of 3:4 (15/16)
    expect(r.y).toBeCloseTo(0.03125);               // centered vertically
  });

  it("never lets the image leave an empty edge", () => {
    const v = clampView({ zoom: 1, x: 120, y: -10000 }, portrait, frame);
    const r = cropRectOf(v, portrait, frame);
    expect(r.x).toBeCloseTo(0);
    expect(r.y + r.height).toBeCloseTo(1);           // dragged to the bottom edge, not past it
  });

  it("zooms around the center of the frame", () => {
    const before = cropRectOf(centeredView(portrait, frame), portrait, frame);
    const after = cropRectOf(zoomView(centeredView(portrait, frame), 2, portrait, frame), portrait, frame);
    expect(after.width).toBeCloseTo(before.width / 2);
    expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2);
    expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2);
  });
});
