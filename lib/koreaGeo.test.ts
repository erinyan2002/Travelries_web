import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { regionCodeOf, ProvinceGeoData } from "./koreaGeo";

const geo = JSON.parse(
  readFileSync(join(__dirname, "../public/data/skorea-provinces.geo.json"), "utf-8"),
) as ProvinceGeoData;

describe("regionCodeOf", () => {
  it("places photos by coordinates, even when the address has no province", () => {
    // Browser-style addresses: "road, neighbourhood, district, city"
    expect(regionCodeOf({ lat: 37.541, lng: 127.069, location: "Dongil-ro 22-gil, Hwayang-dong, Seoul" }, geo)).toBe("11");
    expect(regionCodeOf({ lat: 37.7519, lng: 128.8761, location: "Gyeongpo-ro, Gangneung-si" }, geo)).toBe("32");
    expect(regionCodeOf({ lat: 37.6360, lng: 127.2165, location: "Namyangju-si" }, geo)).toBe("31");
    expect(regionCodeOf({ lat: 33.4996, lng: 126.5312 }, geo)).toBe("39");
  });

  it("snaps a photo just off the simplified coastline to the nearest province", () => {
    expect(regionCodeOf({ lat: 37.5245, lng: 129.1260 }, geo)).toBe("32"); // Donghae harbour
  });

  it("falls back to the location text without coordinates", () => {
    expect(regionCodeOf({ location: "Haeundae, Busan" }, geo)).toBe("21");
    expect(regionCodeOf({ location: "Somewhere" }, geo)).toBeNull();
  });
});
