import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "data", "reports", "offer-analysis.json");
const CREATORS_PATH = path.join(ROOT, "data", "creators.json");

const SECTION_LIMITS = {
  feature_new_inventory: 8,
  featured: 12,
  free_trial: 12,
  cpl_tests: 12,
  popular: 6,
};

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^onlyfans\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactText(value, maxLength = 170) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }

  const sentenceMatches = [...text.slice(0, maxLength).matchAll(/[.!?](?=\s|$)/g)];
  const lastSentence = sentenceMatches.at(-1);
  if (lastSentence && lastSentence.index >= 70) {
    return text.slice(0, lastSentence.index + 1).trim();
  }

  return text.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    output.push(text);
  }

  return output;
}

function cleanTag(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 28 || /https?:|onlyfans|revc_|cplo_|^\d+$|[^\w\s-]/i.test(raw)) {
    return "";
  }

  const words = raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 1);

  if (words.length === 0 || words.length > 4) {
    return "";
  }

  return words
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function cleanTags(values) {
  return uniqueStrings(values.map(cleanTag).filter(Boolean));
}

function mergeCreatorRows(reportCreator, rawCreator) {
  const merged = {
    ...(rawCreator || {}),
    ...(reportCreator || {}),
  };
  const username = normalizeUsername(merged.username || merged.onlyfansUrl || merged.slug);

  return {
    ...merged,
    username,
    slug: merged.slug || username || `creator-${merged.campaignId || merged.publicId}`,
    displayName: String(merged.name || username || "Creator").trim(),
    shortBio: compactText(merged.bio || "", 190),
    homepagePriority: toNumber(merged.homepagePriority),
    score: toNumber(merged.score),
    tags: cleanTags([...(merged.tags || []), ...(merged.campaignTags || [])]),
  };
}

function creatorKey(creator) {
  return normalizeUsername(creator.username) || String(creator.slug || creator.campaignId || creator.publicId);
}

function shouldIncludeCreator(creator) {
  if (creator.manualCuration?.forceExclude) {
    return false;
  }
  if (creator.manualCuration?.forceFeatureNewInventory || creator.manualCuration?.forceHomepageTest) {
    return true;
  }
  return creator.recommendation !== "exclude_for_now";
}

function creatorSort(a, b) {
  return (
    toNumber(b.homepagePriority) - toNumber(a.homepagePriority) ||
    toNumber(b.score) - toNumber(a.score) ||
    String(a.displayName).localeCompare(String(b.displayName))
  );
}

function dedupeByUsername(creators) {
  const byUsername = new Map();

  for (const creator of creators) {
    const key = creatorKey(creator);
    if (!key) {
      continue;
    }

    const existing = byUsername.get(key);
    if (!existing || creatorSort(creator, existing) < 0) {
      byUsername.set(key, creator);
    }
  }

  return [...byUsername.values()].sort(creatorSort);
}

export function getImageUrl(creator) {
  return (
    creator.avatarThumbnail640 ||
    creator.avatarThumbnail ||
    (Array.isArray(creator.images) ? creator.images.find(Boolean) : "") ||
    creator.avatarOriginal ||
    ""
  );
}

export function getGalleryImages(creator, limit = 6) {
  return uniqueStrings([
    creator.avatarThumbnail640,
    creator.avatarThumbnail,
    creator.avatarOriginal,
    ...(Array.isArray(creator.images) ? creator.images : []),
  ]).slice(0, limit);
}

export function getCreatorBadges(creator) {
  const badges = [];

  if (
    ["feature_new_inventory", "test_new_inventory", "test_revshare_free_trial"].includes(creator.recommendation)
  ) {
    badges.push("New");
  }
  if (creator.recommendation === "feature_now" || creator.recommendation === "feature_revshare") {
    badges.push("Featured");
  }
  if (creator.isFree || creator.hasActiveFreePromo) {
    badges.push("Free");
  }
  if (creator.isFreeTrial) {
    badges.push("Free Trial");
  }

  return uniqueStrings(badges).slice(0, 3);
}

export function getCardCtaText() {
  return "View Profile";
}

export function getOutboundCtaText() {
  return "Open Free Page";
}

export function loadCreators() {
  const report = readJson(REPORT_PATH, { creators: [] });
  const rawCreators = readJson(CREATORS_PATH, []);
  const rawByCampaignId = new Map();
  const rawByUsername = new Map();

  for (const creator of rawCreators) {
    if (creator.campaignId !== undefined && creator.campaignId !== null) {
      rawByCampaignId.set(String(creator.campaignId), creator);
    }
    const username = normalizeUsername(creator.username || creator.onlyfansUrl || creator.slug);
    if (username) {
      rawByUsername.set(username, creator);
    }
  }

  const mergedCreators = (report.creators || []).map((creator) => {
    const raw =
      rawByCampaignId.get(String(creator.campaignId)) ||
      rawByUsername.get(normalizeUsername(creator.username || creator.onlyfansUrl || creator.slug));
    return mergeCreatorRows(creator, raw);
  });

  return dedupeByUsername(mergedCreators.filter(shouldIncludeCreator));
}

export function getHomepageSections() {
  const creators = loadCreators();
  const byRecommendation = (recommendations, limit) =>
    creators
      .filter((creator) => recommendations.includes(creator.recommendation))
      .sort(creatorSort)
      .slice(0, limit);

  return [
    {
      id: "new-free-creators",
      title: "New Free Creators to Check Out",
      kicker: "Fresh profiles we're currently testing for placement.",
      creators: byRecommendation(["feature_new_inventory"], SECTION_LIMITS.feature_new_inventory),
    },
    {
      id: "featured-free-creators",
      title: "Featured Free OnlyFans Creators",
      kicker: "Higher-priority creators from current campaign performance and curation.",
      creators: byRecommendation(["feature_now", "feature_revshare"], SECTION_LIMITS.featured),
    },
    {
      id: "free-trial-creators",
      title: "Free Trial Creator Picks",
      kicker: "Creators with free-trial or free-to-follow offers.",
      creators: byRecommendation(["test_revshare_free_trial"], SECTION_LIMITS.free_trial),
    },
    {
      id: "more-free-picks",
      title: "More Free Creator Picks",
      kicker: "Additional free profiles worth testing.",
      creators: byRecommendation(["test_cpl", "new_cpl_candidate", "test_new_inventory"], SECTION_LIMITS.cpl_tests),
    },
    {
      id: "popular-picks",
      title: "Popular Creator Picks",
      kicker: "Legacy and popular profiles kept lower on the page for discovery.",
      creators: byRecommendation(["keep_revshare_direct", "legacy_watch", "review_manually"], SECTION_LIMITS.popular),
    },
  ].filter((section) => section.creators.length > 0);
}

export function getCreatorBySlug(slug) {
  return loadCreators().find((creator) => creator.slug === slug);
}

export function getSimilarCreators(currentCreator, limit = 4) {
  const currentTags = new Set((currentCreator.tags || []).map((tag) => String(tag).toLowerCase()));

  return loadCreators()
    .filter((creator) => creator.slug !== currentCreator.slug)
    .map((creator) => {
      const tagScore = (creator.tags || []).filter((tag) => currentTags.has(String(tag).toLowerCase())).length;
      const recommendationScore = creator.recommendation === currentCreator.recommendation ? 2 : 0;
      return {
        creator,
        similarity: tagScore + recommendationScore,
      };
    })
    .filter((item) => item.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || creatorSort(a.creator, b.creator))
    .slice(0, limit)
    .map((item) => item.creator);
}

export function getProfileCompanions(currentCreator, limit = 6) {
  const similarCreators = getSimilarCreators(currentCreator, limit);
  if (similarCreators.length >= 3) {
    return {
      title: "Similar Creator Picks",
      creators: similarCreators.slice(0, limit),
    };
  }

  const seen = new Set([currentCreator.slug, ...similarCreators.map((creator) => creator.slug)]);
  const fallbackCreators = loadCreators()
    .filter((creator) => !seen.has(creator.slug))
    .slice(0, limit - similarCreators.length);

  return {
    title: "More Creator Picks",
    creators: [...similarCreators, ...fallbackCreators].slice(0, limit),
  };
}

export function getCategoryDefinitions() {
  return [
    {
      slug: "free",
      title: "Free Creator Picks",
      description: "Curated creators with free pages, free trials, or active free promotions.",
      filter: (creator) => creator.isFree || creator.isFreeTrial || creator.hasActiveFreePromo,
    },
    {
      slug: "free-trial",
      title: "Free Trial Creators",
      description: "Creator profiles currently grouped as free-trial tests.",
      filter: (creator) => creator.recommendation === "test_revshare_free_trial" || creator.isFreeTrial,
    },
    {
      slug: "new",
      title: "New Creator Tests",
      description: "New inventory selected for FreeOnlyFanz test placement.",
      filter: (creator) =>
        ["feature_new_inventory", "test_new_inventory", "new_cpl_candidate"].includes(creator.recommendation),
    },
    {
      slug: "featured",
      title: "Featured Creators",
      description: "Creators currently carrying the strongest FreeOnlyFanz placement signals.",
      filter: (creator) => ["feature_new_inventory", "feature_now", "feature_revshare"].includes(creator.recommendation),
    },
  ];
}

export function getCategoryBySlug(slug) {
  return getCategoryDefinitions().find((category) => category.slug === slug);
}
