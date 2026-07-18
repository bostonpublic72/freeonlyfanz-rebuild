import fs from "node:fs";
import path from "node:path";
import { loadCreators } from "./creators.mjs";
import { sortGuideCreators, isFreeGuideCreator, isFreeTrialGuideCreator, isFreeOrTrialGuideCreator } from "./guide-pages.mjs";

const ROOT = process.cwd();
const GUIDES_PATH = path.join(ROOT, "data", "monthly-guides.json");

function readGuidesFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(GUIDES_PATH, "utf8"));
    return Array.isArray(raw.guides) ? raw.guides : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function normalizeTag(value) {
  return String(value || "").trim().toLowerCase();
}

function creatorHasTags(creator, tags, tagMatch = "any") {
  const wanted = (tags || []).map(normalizeTag).filter(Boolean);
  if (wanted.length === 0) {
    return true;
  }

  const creatorTags = new Set((creator.tags || []).map(normalizeTag));
  if (tagMatch === "all") {
    return wanted.every((tag) => creatorTags.has(tag));
  }

  return wanted.some((tag) => creatorTags.has(tag));
}

function matchesGuideAccessRules(creator, guide) {
  if (guide.requireFreeTrialOnly) {
    return isFreeTrialGuideCreator(creator);
  }
  if (guide.requireFreeOrTrial !== false) {
    return isFreeOrTrialGuideCreator(creator);
  }
  if (guide.requireFreeOnly) {
    return isFreeGuideCreator(creator);
  }

  return true;
}

export function getPublishedMonthlyGuides() {
  return readGuidesFile()
    .filter((guide) => guide.status === "published" && guide.slug)
    .sort(
      (a, b) =>
        String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")) ||
        String(a.h1 || "").localeCompare(String(b.h1 || ""))
    );
}

export function getMonthlyGuideBySlug(slug) {
  return getPublishedMonthlyGuides().find((guide) => guide.slug === slug) || null;
}

export function getMonthlyGuideCreators(guide, limit = guide?.creatorLimit || 12) {
  if (!guide) {
    return [];
  }

  return sortGuideCreators(
    loadCreators().filter(
      (creator) => matchesGuideAccessRules(creator, guide) && creatorHasTags(creator, guide.tags, guide.tagMatch)
    )
  ).slice(0, limit);
}

export function getMonthlyGuideUrls() {
  return getPublishedMonthlyGuides().map((guide) => `/guides/${guide.slug}/`);
}
