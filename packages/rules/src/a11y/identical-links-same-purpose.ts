// a11y/identical-links-same-purpose - Identical links go to same destination

import type { CheckResult, Rule, RuleContext, RuleResult } from "../types";

const MAX_CONTEXT_ANCESTORS = 64;
const MAX_LABELLED_BY_IDS = 8;

function normalizedText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function linkContext(link: Element, doc: Document): string {
  let ancestor = link.parentElement;

  for (let depth = 0; ancestor && depth < MAX_CONTEXT_ANCESTORS; depth++) {
    const labelledBy = ancestor.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy
        .trim()
        .split(/\s+/)
        .slice(0, MAX_LABELLED_BY_IDS)
        .map((id) => normalizedText(doc.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(" ");
      if (label) return label;
    }

    const ariaLabel = normalizedText(ancestor.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;

    if (ancestor.tagName.toLowerCase() === "li") {
      const leadingLink = ancestor.querySelector("a[href]");
      if (leadingLink && leadingLink !== link) {
        const label = normalizedText(leadingLink.textContent);
        if (label) return label;
      }
    }

    ancestor = ancestor.parentElement;
  }

  return "";
}

export const identicalLinksSamePurposeRule: Rule = {
  meta: {
    id: "a11y/identical-links-same-purpose",
    name: "Identical Links Same Purpose",
    description:
      "Checks that links with identical text in the same context go to the same destination",
    solution:
      "Links with the same visible text in the same programmatic context should go to the same URL. When identical link text leads to different destinations, it confuses screen reader users who navigate by listing links. Make link text unique or more descriptive, or label distinct navigation sections with aria-label or aria-labelledby.",
    category: "a11y",
    scope: "page",
    verdictScope: "page",
    severity: "warning",
    weight: 4,
  },

  run(ctx: RuleContext): RuleResult {
    const doc = ctx.parsed.document;
    if (!doc) return { checks: [] };
    const checks: CheckResult[] = [];

    const links = doc.querySelectorAll("a[href]");
    const linkGroups = new Map<string, { text: string; context: string; hrefs: Set<string> }>();

    for (const link of links) {
      const text = normalizedText(link.textContent);
      const href = link.getAttribute("href");

      if (!text || !href) continue;
      if (text.length < 2) continue; // Skip very short text like "1", "2"
      if (href.startsWith("#")) continue; // Skip anchor links

      // Normalize href for comparison
      let normalizedHref = href.toLowerCase();
      // Remove trailing slashes for comparison
      normalizedHref = normalizedHref.replace(/\/+$/, "");
      // Remove query strings for basic comparison
      const baseHref = normalizedHref.split("?")[0];

      const context = linkContext(link, doc);
      const groupKey = JSON.stringify([text, context]);
      let group = linkGroups.get(groupKey);
      if (!group) {
        group = { text, context, hrefs: new Set() };
        linkGroups.set(groupKey, group);
      }
      group.hrefs.add(baseHref);
    }

    const inconsistentLinks: string[] = [];

    for (const { text, context, hrefs } of linkGroups.values()) {
      if (hrefs.size > 1) {
        // Same text, different destinations
        const destinations = Array.from(hrefs);
        const contextLabel = context ? ` in "${context}"` : "";
        inconsistentLinks.push(`"${text}"${contextLabel} → ${destinations.length} different URLs`);
      }
    }

    if (inconsistentLinks.length > 0) {
      checks.push({
        name: "identical-links-same-purpose",
        status: "warn",
        message: `${inconsistentLinks.length} link text(s) lead to different destinations`,
        items: inconsistentLinks.slice(0, 10).map((id) => ({ id })),
        details: {
          suggestion: "Make link text unique to differentiate destinations",
          ...(inconsistentLinks.length > 10 ? { additional: inconsistentLinks.length - 10 } : {}),
        },
      });
    } else if (links.length > 0) {
      checks.push({
        name: "identical-links-same-purpose",
        status: "pass",
        message: "Identical link texts go to same destinations",
      });
    } else {
      checks.push({
        name: "identical-links-same-purpose",
        status: "info",
        message: "No links found",
      });
    }

    return { checks };
  },
};
