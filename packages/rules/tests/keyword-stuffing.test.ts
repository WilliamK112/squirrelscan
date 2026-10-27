// content/keyword-stuffing — function-word stopwords + repeated CTA label
// exclusion (#695). Before this fix, generic function words ("get", "your")
// and repeated short CTA/button labels ("Learn more" x11 cards) tripped the
// density check on ordinary pages. Real prose stuffing must still flag.

import { describe, expect, test } from "bun:test";
import { parseHTML } from "@squirrelscan/parser/dom";

import { keywordStuffingRule, keywordTokens } from "../src/content/keyword-stuffing";
import type { ParsedPage, RuleContext } from "../src/types";

function ctx(html: string, options: Record<string, unknown> = {}): RuleContext {
  const doc = parseHTML(html).document;
  return {
    page: { url: "https://example.com/", html, statusCode: 200, loadTime: 0, headers: {} },
    parsed: { document: doc } as unknown as ParsedPage,
    options,
  } as unknown as RuleContext;
}

// Distinct low-frequency filler words (each capped at 5 repeats — at or
// below `min_occurrences`) so padding content never trips density itself.
const FILLER_BANK = [
  "zephyr",
  "quokka",
  "tundra",
  "basalt",
  "ember",
  "glacier",
  "meadow",
  "canyon",
  "harbor",
  "lattice",
  "marble",
  "nectar",
  "orchid",
  "pebble",
  "quartz",
  "ripple",
  "sable",
  "thicket",
  "umbra",
  "velvet",
  "willow",
  "xenial",
  "yonder",
  "zabra",
  "amber",
  "brisk",
  "cedar",
  "dune",
  "flint",
  "grove",
];

function filler(wordCount: number): string {
  return Array.from({ length: wordCount }, (_, i) => FILLER_BANK[i % FILLER_BANK.length]).join(" ");
}

describe("content/keyword-stuffing false-positive fixes (#695)", () => {
  test("'get' used heavily as a generic verb does not flag", () => {
    const html = `<html><body><p>${"get ".repeat(10)}${filler(120)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
  });

  test("'your' used heavily on a privacy-policy-style page does not flag", () => {
    const html = `<html><body><p>${"your ".repeat(10)}${filler(120)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
  });

  test("11 repeated 'Learn more' CTA links do not flag 'learn'", () => {
    // Real templated markup always has whitespace/newlines between sibling
    // cards; joining with "\n" keeps word tokenization realistic (adjacent
    // elements with zero separator would merge into a bogus compound token).
    const cards = Array.from(
      { length: 11 },
      () => `<div class="card"><a href="/x">Learn more</a></div>`,
    ).join("\n");
    const html = `<html><body>${cards}<p>${filler(120)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
  });

  test("true positive: real prose keyword stuffing outside CTAs still flags", () => {
    const html = `<html><body><p>${"widget ".repeat(30)}${filler(90)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((i) => i.id === "widget")).toBe(true);
  });

  test("true positive: CTA exclusion does not mask unrelated prose stuffing on the same page", () => {
    const cards = Array.from(
      { length: 11 },
      () => `<div class="card"><a href="/x">Learn more</a></div>`,
    ).join("\n");
    const html = `<html><body>${cards}<p>${"widget ".repeat(30)}${filler(90)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((i) => i.id === "widget")).toBe(true);
    expect(checks[0].items?.some((i) => i.id === "learn")).toBe(false);
  });

  test("review regression: nested <a><button> CTA counts once, so stuffing isn't masked", () => {
    // Each card matches BOTH the <a> and the <button>; double-counting the
    // label would over-deduct and could zero out organicTotal, silently
    // skipping the scan of the genuinely stuffed word below.
    const cards = Array.from(
      { length: 20 },
      () => `<div class="card"><a href="/x"><button>Learn more</button></a></div>`,
    ).join("\n");
    const html = `<html><body>${cards}<p>${"widget ".repeat(30)}${filler(60)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((i) => i.id === "widget")).toBe(true);
    expect(checks[0].items?.some((i) => i.id === "learn")).toBe(false);
  });

  test("true positive: repeated COMMERCIAL anchor text (not a generic CTA) still flags", () => {
    // The CTA exclusion is an allowlist of known boilerplate phrases, not
    // "any repeated short anchor text" — a spam/doorway page repeating a
    // real target keyword as a link label must still count fully.
    const links = Array.from(
      { length: 11 },
      () => `<div class="card"><a href="/plumber">Emergency Plumber</a></div>`,
    ).join("\n");
    const html = `<html><body>${links}<p>${filler(100)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((i) => i.id === "emergency")).toBe(true);
    expect(checks[0].items?.some((i) => i.id === "plumber")).toBe(true);
  });

  test("whitelist option still suppresses a configured brand/keyword", () => {
    const html = `<html><body><p>${"widget ".repeat(30)}${filler(90)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html, { whitelist: ["widget"] }));
    expect(checks[0].status).toBe("pass");
  });
});

describe("content/keyword-stuffing language stop words (#1042)", () => {
  test.each([
    ["de-DE", "und"],
    ["es", "para"],
    ["fr", "avec"],
    ["pt-BR", "para"],
    ["it", "della"],
    ["nl", "voor"],
  ])("%s excludes its own function word %p", (lang, word) => {
    const html = `<html lang="${lang}"><body><p>${`${word} `.repeat(30)}${filler(120)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
  });

  test("the German reproduction excludes its stop words", () => {
    const paragraph =
      "Hier findest du alles für den Sommer, alles aus weicher Baumwolle. " +
      "Unsere Shirts kommen aus fairer Produktion und halten lange. " +
      "Wähle aus vielen Farben die Bademode, die zu dir passt. " +
      "Versand und Rückgabe sind kostenlos, die Lieferung dauert zwei Tage. " +
      "Die Stoffe stammen aus Portugal, genäht wird in kleinen Werkstätten. " +
      "Pflegehinweise findest du auf jedem Etikett und in unserem Ratgeber.";
    const html = `<html lang="de"><body><p>${paragraph.repeat(12)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    const reported = new Set(checks[0].items?.map((item) => item.id));
    for (const stopWord of ["alles", "aus", "die", "und"]) {
      expect(reported.has(stopWord)).toBe(false);
    }
  });

  test("a German content word over the threshold is still reported", () => {
    const html = `<html lang="de"><body><p>${"bademode ".repeat(30)}${filler(120)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((item) => item.id === "bademode")).toBe(true);
  });

  test("an unknown page language keeps the English exclusions", () => {
    const html = `<html lang="xx"><body><p>${"the ".repeat(30)}${filler(120)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
  });
});

describe("content/keyword-stuffing main copy and Unicode words (#1182)", () => {
  test("navigation and header links outside main content do not affect density", () => {
    const links = Array.from(
      { length: 20 },
      (_, index) => `<a href="/${index}">Bademode ${FILLER_BANK[index]}</a>`,
    ).join("\n");
    const html = `<html lang="de"><body><header><nav>${links}</nav></header><main><p>${filler(120)}</p></main></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
    expect(checks[0].items?.some((item) => item.id === "bademode")).not.toBe(true);
  });

  test("commercial anchor text inside main content still flags", () => {
    const links = Array.from({ length: 12 }, () => '<a href="/plumber">Emergency Plumber</a>').join(
      "\n",
    );
    const html = `<html><body><header><nav><a href="/">Home</a></nav></header><main>${links}<p>${filler(100)}</p></main></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((item) => item.id === "plumber")).toBe(true);
  });

  test("a thin main falls back to substantial body copy", () => {
    const html = `<html><body><main><p>Short introduction only</p></main><section><p>${"widget ".repeat(20)}${filler(120)}</p></section></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((item) => item.id === "widget")).toBe(true);
  });

  test("the largest substantial main landmark is measured", () => {
    const html = `<html><body><main><p>${filler(100)}</p></main><main><p>${"widget ".repeat(20)}${filler(100)}</p></main></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((item) => item.id === "widget")).toBe(true);
  });

  test("thousands of nested main landmarks stay within a bounded scan", { timeout: 30_000 }, () => {
    const depth = 5_000;
    const html = `<html><body>${"<main>".repeat(depth)}<p>${filler(120)}</p>${"</main>".repeat(depth)}</body></html>`;
    const context = ctx(html);
    const started = performance.now();
    const { checks } = keywordStuffingRule.run(context);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(checks[0].status).toBe("pass");
  });

  test("a listing without main keeps every article", () => {
    const html = `<html><body><article><p>${filler(100)}</p></article><article><p>${"widget ".repeat(20)}${filler(20)}</p></article></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((item) => item.id === "widget")).toBe(true);
  });

  test("an article inside a sidebar is not selected as the page's main copy", () => {
    const html = `<html><body><aside><article><p>${filler(100)}</p></article></aside><section><p>${"widget ".repeat(20)}${filler(100)}</p></section></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((item) => item.id === "widget")).toBe(true);
  });

  test("a thin sole article falls back to the rest of the body", () => {
    const html = `<html><body><article><p>Short article</p></article><section><p>${"widget ".repeat(20)}${filler(120)}</p></section></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((item) => item.id === "widget")).toBe(true);
  });

  test("article headers remain part of body-fallback copy", () => {
    const html = `<html><body><header>${"global ".repeat(30)}</header><article><header>${"widget ".repeat(20)}</header><p>${filler(100)}</p></article><article><p>${filler(20)}</p></article></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((item) => item.id === "widget")).toBe(true);
    expect(checks[0].items?.some((item) => item.id === "global")).not.toBe(true);
  });

  test("umlauts, ß and decomposed letters stay in one normalized word", () => {
    expect(keywordTokens("gemäß gema\u0308ß Straße")).toEqual(["gemäß", "gemäß", "straße"]);
    const html = `<html lang="de"><body><main><p>${"gemäß ".repeat(15)}${filler(120)}</p></main></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].items?.some((item) => item.id === "gemäß")).toBe(true);
    expect(checks[0].items?.some((item) => item.id === "gem")).toBe(false);
  });

  test("German price-note boilerplate is ignored", () => {
    const notes = "inkl MwSt zzgl Versandkosten ".repeat(12);
    const html = `<html lang="de"><body><main><p>${notes}${filler(120)}</p></main></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
  });

  test("English price-note boilerplate is ignored", () => {
    const html = `<html lang="en"><body><main><p>${"incl VAT ".repeat(12)}${filler(120)}</p></main></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
  });

  test("a token longer than the item limit is ignored instead of split", () => {
    const longToken = "ä".repeat(80);
    expect(keywordTokens(`${longToken} normal`)).toEqual(["normal"]);
  });

  test("compatibility normalization is bounded to one short token", () => {
    expect(keywordTokens("ａｃｍｅ ﬀoo gemäß")).toEqual(["acme", "ffoo", "gemäß"]);
    expect(keywordTokens(`${"\uFDFA.".repeat(2_000)} normal`)).toEqual(["normal"]);
  });

  test("Han, Kana and Hangul runs are not treated as whole words", () => {
    expect(keywordTokens("検索検索 검색검색 カタカナカタカナ normal")).toEqual(["normal"]);
    const html = `<html lang="ja"><body><main><p>${"検索検索。".repeat(30)}${filler(120)}</p></main></body></html>`;
    const { checks } = keywordStuffingRule.run(ctx(html));
    expect(checks[0].status).toBe("pass");
  });
});

describe("content/keyword-stuffing ignores the site's own brand name", () => {
  function siteCtx(url: string, html: string): RuleContext {
    const doc = parseHTML(html).document;
    return {
      page: { url, html, statusCode: 200, loadTime: 0, headers: {} },
      parsed: { document: doc } as unknown as ParsedPage,
      options: {},
    } as unknown as RuleContext;
  }
  const launchPage = (name: string, head = "") =>
    `<html><head>${head}</head><body><h1>${name}</h1><p>${`${name} `.repeat(30)}${filler(90)}</p></body></html>`;

  test("a landing page repeating its own domain name does not flag it", () => {
    const { checks } = keywordStuffingRule.run(siteCtx("https://acme.com/", launchPage("Acme")));
    expect(checks[0].status).toBe("pass");
  });

  test("a launch domain prefix or suffix still resolves to the product name", () => {
    for (const url of ["https://getacme.com/", "https://acmehq.io/", "https://www.tryacme.co.uk/"]) {
      const { checks } = keywordStuffingRule.run(siteCtx(url, launchPage("Acme")));
      expect(checks[0].status).toBe("pass");
    }
  });

  test("a multi-word og:site_name carried by the domain is exempt word by word", () => {
    const head = `<meta property="og:site_name" content="Rocket Notes">`;
    const html = `<html><head>${head}</head><body><p>${"rocket notes ".repeat(20)}${filler(90)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(siteCtx("https://rocketnotes.app/", html));
    expect(checks[0].status).toBe("pass");
  });

  test("true positive: a site name the domain does not carry is not a free pass", () => {
    const head = `<meta property="og:site_name" content="Plumber">`;
    const html = `<html><head>${head}</head><body><p>${"plumber ".repeat(30)}${filler(90)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(siteCtx("https://acme.com/", html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.some((i) => i.id === "plumber")).toBe(true);
  });

  test("true positive: other stuffed words on the brand's own page still flag", () => {
    const html = `<html><body><p>${"acme ".repeat(30)}${"widget ".repeat(30)}${filler(90)}</p></body></html>`;
    const { checks } = keywordStuffingRule.run(siteCtx("https://acme.com/", html));
    expect(checks[0].status).toBe("warn");
    expect(checks[0].items?.map((i) => i.id)).toEqual(["widget"]);
  });
});
