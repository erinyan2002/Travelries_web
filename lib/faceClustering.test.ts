import { describe, it, expect } from "vitest";
import { clusterByPerson, buildPersonGroups, MATCH_THRESHOLD } from "./faceClustering";
import type { FacePhoto } from "./types";

let n = 0;
function photo(descriptors: number[][], extra: Partial<FacePhoto> = {}): FacePhoto {
  n++;
  return {
    id: `p${n}`, fileName: `p${n}.jpg`, imageUrl: "", faceCount: descriptors.length,
    uploadedAt: new Date(2026, 0, n).toISOString(),
    boxes: descriptors.map(() => ({ x: 0, y: 0, width: 0.1, height: 0.1 })),
    descriptors, ...extra,
  };
}
// A 128-dim face-api-style descriptor: `base` everywhere, nudged by `jitter`.
const fa = (base: number, jitter = 0) => Array.from({ length: 128 }, (_, i) => base + (i % 2 ? jitter : -jitter));
// A raw (unnormalized, norm ~20) 512-dim ArcFace embedding pointing along `dir`.
const arc = (dir: number, jitter = 0) =>
  Array.from({ length: 512 }, (_, i) => 20 * (i === dir ? 0.9 : 0) + (i === (dir + 1) % 512 ? 20 * 0.4 + jitter : 0));

describe("clusterByPerson", () => {
  it("groups the same person and separates different people (128-dim)", () => {
    const clusters = clusterByPerson(
      [photo([fa(0.10)]), photo([fa(0.10, 0.005)]), photo([fa(0.30)])], MATCH_THRESHOLD);
    expect(clusters.map((c) => c.faces.length).sort()).toEqual([1, 2]);
  });

  it("groups raw 512-dim ArcFace embeddings of the same person (regression)", () => {
    const clusters = clusterByPerson([photo([arc(0)]), photo([arc(0, 1)])], MATCH_THRESHOLD);
    expect(clusters).toHaveLength(1);
  });

  it("keeps different ArcFace people apart", () => {
    const clusters = clusterByPerson([photo([arc(0)]), photo([arc(100)])], MATCH_THRESHOLD);
    expect(clusters).toHaveLength(2);
  });

  it("never compares a 128-dim descriptor with a 512-dim one", () => {
    const clusters = clusterByPerson([photo([fa(0)]), photo([arc(0)])], MATCH_THRESHOLD);
    expect(clusters).toHaveLength(2);
  });

  it("never puts two faces from the same photo in one cluster", () => {
    const clusters = clusterByPerson([photo([fa(0.1), fa(0.1)])], MATCH_THRESHOLD);
    expect(clusters).toHaveLength(2);
  });

  it("skips removed (tombstoned) faces", () => {
    const clusters = clusterByPerson([photo([fa(0.1), []])], MATCH_THRESHOLD);
    expect(clusters).toHaveLength(1);
  });
});

describe("buildPersonGroups", () => {
  it("a manual person tag wins over descriptor distance", () => {
    const tagged = photo([fa(0.1)], { personIds: ["alice"] });
    const lookalike = photo([fa(0.1)]);
    const groups = buildPersonGroups(
      [tagged, lookalike], [{ id: "alice", name: "Alice", createdAt: "" }], MATCH_THRESHOLD);
    const alice = groups.find((g) => g.personId === "alice");
    expect(alice?.label).toBe("Alice");
    expect(alice?.faces.map((f) => f.photo.id)).toEqual([tagged.id]);
    expect(groups).toHaveLength(2);
  });
});
