// #1225: --offline is a read-only crawl by default, even at the surface level.
// A real local server exposes a discovered GraphQL endpoint so an active run
// proves the fixture can receive probes while the default offline run cannot.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = join(import.meta.dir, "../../src/cli.ts");
const scratch = mkdtempSync(join(tmpdir(), "squirrel-offline-probe-"));
let requests: string[] = [];

const site = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    requests.push(url.href);
    if (url.pathname === "/") {
      return new Response(
        '<!doctype html><html lang="en"><head><title>Fixture</title></head><body><h1>Fixture</h1><a href="/graphql">GraphQL API</a></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n");
    }
    if (url.pathname === "/graphql") {
      return Response.json({ data: { __typename: "Query" } });
    }
    return new Response("not found", { status: 404 });
  },
});

beforeEach(() => {
  requests = [];
});

afterAll(() => {
  void site.stop(true);
  rmSync(scratch, { recursive: true, force: true });
});

let homes = 0;

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value === undefined ||
      /^(SQUIRREL|FORCE_COLOR|NO_COLOR|COLORTERM)/.test(key)
    ) {
      continue;
    }
    env[key] = value;
  }
  return {
    ...env,
    HOME: join(scratch, `home-${++homes}`),
    SQUIRREL_NO_UPDATE: "1",
    NO_TELEMETRY: "1",
    NO_COLOR: "1",
  };
}

async function run(probe?: "active"): Promise<number> {
  const proc = Bun.spawn(
    [
      process.execPath,
      "run",
      entry,
      "audit",
      site.url.origin,
      "--offline",
      "--level",
      "surface",
      "--max-pages",
      "1",
      "--no-incremental",
      "--rule-include",
      "security/graphql-introspection,security/graphql-get-mutations",
      "--format",
      "json",
      "--yes",
      ...(probe ? ["--probe", probe] : []),
    ],
    { env: cleanEnv(), stdin: "ignore", stdout: "ignore", stderr: "pipe" }
  );
  await new Response(proc.stderr).text();
  return proc.exited;
}

const graphqlQueries = () =>
  requests
    .map((raw) => new URL(raw))
    .filter(
      (url) => url.pathname === "/graphql" && url.searchParams.has("query")
    );

describe("squirrel audit --offline probing", () => {
  test("surface sends no GraphQL probe unless active probing is explicit", async () => {
    expect(await run()).toBe(0);
    expect(graphqlQueries()).toEqual([]);

    requests = [];
    expect(await run("active")).toBe(0);
    expect(graphqlQueries().length).toBeGreaterThan(0);
  }, 120_000);
});
