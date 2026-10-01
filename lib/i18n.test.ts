import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { KO } from "./i18n-ko";
import { translate, translateN } from "./i18n";

const ROOT = join(__dirname, "..");
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const PATTERNS = [
  new RegExp(String.raw`\bt\(\s*` + STR, "g"),
  new RegExp(String.raw`\bmsg\(\s*` + STR, "g"),
  new RegExp(String.raw`\btn\([^,()]*(?:\([^()]*\))?[^,()]*,\s*` + STR + String.raw`,\s*` + STR, "g"),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|jsx?)$/.test(name) && !name.endsWith(".test.ts") ? [p] : [];
  });
}

function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const file of ["app", "components", "lib"].flatMap((d) => sourceFiles(join(ROOT, d)))) {
    const src = readFileSync(file, "utf-8");
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        for (const g of m.slice(1)) if (g !== undefined) keys.set(JSON.parse(`"${g}"`), file.slice(ROOT.length + 1));
      }
    }
  }
  return keys;
}

describe("i18n", () => {
  it("has a Korean entry for every UI string in the code", () => {
    const missing = [...usedKeys()].filter(([k]) => !(k in KO)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it("keeps the same {placeholders} in the Korean text", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const bad = Object.entries(KO).filter(([en, ko]) => names(en) !== names(ko)).map(([en]) => en);
    expect(bad).toEqual([]);
  });

  it("translates, interpolates and picks the plural form", () => {
    expect(translate("en", "Hello {name}", { name: "Erin" })).toBe("Hello Erin");
    expect(translate("ko", "No such key")).toBe("No such key");
    expect(translateN("en", 1, "{n} photo", "{n} photos")).toBe("1 photo");
    expect(translateN("en", 3, "{n} photo", "{n} photos")).toBe("3 photos");
  });
});
