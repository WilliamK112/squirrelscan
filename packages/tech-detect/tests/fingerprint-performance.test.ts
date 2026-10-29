import { describe, expect, test } from "bun:test";
import { detectTechnologies } from "../src/detect";
import { ALL_FINGERPRINTS } from "../src/fingerprints";
import type { TechDetectInput } from "../src/types";

const ONE_MIB = 1024 * 1024;

function fillToOneMib(value: string): string {
  return value.repeat(Math.ceil(ONE_MIB / value.length)).slice(0, ONE_MIB);
}

const ADVERSARIAL_OPENERS = [
  ["script", fillToOneMib("<script ")],
  ["script-src", fillToOneMib('<script src="')],
  ["meta", fillToOneMib("<meta ")],
  ["link", fillToOneMib("<link ")],
  ["img", fillToOneMib("<img ")],
] as const;

function input(html: string): TechDetectInput {
  return { url: "https://example.com", headers: {}, html };
}

describe("per-fingerprint adversarial input budget", () => {
  for (const fingerprint of ALL_FINGERPRINTS) {
    test(`${fingerprint.id} stays below 250 ms per 1 MiB opener flood`, () => {
      const slowInputs: string[] = [];

      for (const [name, html] of ADVERSARIAL_OPENERS) {
        const startedAt = performance.now();
        detectTechnologies(input(html), [fingerprint]);
        const elapsedMs = performance.now() - startedAt;
        if (elapsedMs >= 250) slowInputs.push(`${name}: ${elapsedMs.toFixed(1)} ms`);
      }

      expect(slowInputs).toEqual([]);
    });
  }

  test("real RequireJS data-main markup still matches", () => {
    const requirejs = ALL_FINGERPRINTS.find((fingerprint) => fingerprint.id === "requirejs");
    expect(requirejs).toBeDefined();

    const ids = detectTechnologies(
      input('<script data-main="js/main" src="require.js"></script>'),
      requirejs ? [requirejs] : [],
    ).map((technology) => technology.id);

    expect(ids).toContain("requirejs");
  });
});
