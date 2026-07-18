import fs from "node:fs";
import path from "node:path";
import slugify from "slugify";
import { categoryCopy } from "./site-copy.mjs";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "data", "reports", "offer-analysis.json");
const CREATORS_PATH = path.join(ROOT, "data", "creators.json");
const MANUAL_CURATION_PATH = path.join(ROOT, "data", "manual-curation.json");
const CREATOR_FOLDER_SNAPSHOT_PATH = path.join(ROOT, "data", "creator-folder-snapshot.json");

const TQ_UTM_PARAMS = {
  utm_source: "twerkqueens",
  utm_medium: "nav",
  utm_campaign: "freeonlyfanz_tq",
};

const TQ_RECOMMENDATION_WEIGHTS = {
  feature_new_inventory: 35,
  feature_now: 30,
  feature_revshare: 30,
  test_revshare_free_trial: 25,
  test_new_inventory: 22,
  new_cpl_candidate: 18,
  test_cpl: 18,
  keep_revshare_direct: 10,
};

const TQ_ELIGIBLE_RECOMMENDATIONS = new Set(Object.keys(TQ_RECOMMENDATION_WEIGHTS));

const PUBLIC_FREE_INVENTORY_RECOMMENDATIONS = new Set([
  "feature_new_inventory",
  "test_new_inventory",
  "test_revshare_free_trial",
  "new_cpl_candidate",
  "test_cpl",
]);

const SECTION_LIMITS = {
  recent: 24,
  featured: 12,
  free_trial: 12,
  cpl_tests: 12,
  popular: 6,
};

const FEATURED_RECOMMENDATIONS = ["feature_new_inventory", "feature_now", "feature_revshare"];

const RECENT_CREATOR_DAYS = 14;

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

function readManualCurationRaw() {
  return readJson(MANUAL_CURATION_PATH, {});
}

function addCreatorSlugVariants(slugs, value) {
  const username = normalizeUsername(value);
  const slug = makeCreatorSlug(username || value);
  if (username) {
    slugs.add(username);
  }
  if (slug) {
    slugs.add(slug);
  }
}

function getManualBlockedSlugSet() {
  const manual = readManualCurationRaw();
  const slugs = new Set();

  for (const value of manual.forceExclude || []) {
    addCreatorSlugVariants(slugs, value);
  }

  return slugs;
}

export function getImportedCreatorSlugSet() {
  const slugs = new Set();
  const rawCreators = readJson(CREATORS_PATH, []);
  const report = readJson(REPORT_PATH, { creators: [] });

  for (const creator of [...rawCreators, ...(report.creators || [])]) {
    addCreatorSlugVariants(slugs, creator.slug || creator.username || creator.onlyfansUrl || "");
  }

  return slugs;
}

export function getSnapshotCreatorSlugSet() {
  const snapshot = readJson(CREATOR_FOLDER_SNAPSHOT_PATH, { slugs: [] });
  return new Set((snapshot.slugs || []).map((slug) => String(slug).trim()).filter(Boolean));
}

export function getPublicCreatorSlugSet() {
  return new Set(loadCreators().map((creator) => creator.slug).filter(Boolean));
}

export function getOrphanCreatorSlugs() {
  const publicSlugs = getPublicCreatorSlugSet();
  const candidates = new Set([
    ...getImportedCreatorSlugSet(),
    ...getSnapshotCreatorSlugSet(),
    ...getManualBlockedSlugSet(),
  ]);

  return [...candidates]
    .filter((slug) => slug && !slug.includes("@") && !publicSlugs.has(slug))
    .sort();
}

function isBlockedCreator(creator) {
  const manualBlocked = getManualBlockedSlugSet();
  const username = normalizeUsername(creator.username || creator.onlyfansUrl || "");
  const slug = makeCreatorSlug(creator.slug || creator.username || creator.onlyfansUrl || "");

  return Boolean(
    (username && manualBlocked.has(username)) ||
      (slug && manualBlocked.has(slug)) ||
      creator.manualCuration?.forceExclude ||
      creator.forceExcluded
  );
}

export function getBlockedCreatorSlugs() {
  return getOrphanCreatorSlugs();
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

export function makeCreatorSlug(value) {
  const source =
    typeof value === "object" && value !== null
      ? normalizeUsername(value.username || value.onlyfansUrl || "") ||
        value.slug ||
        value.name ||
        value.displayName ||
        `creator-${value.campaignId || value.publicId || "unknown"}`
      : value;

  return slugify(String(source || ""), {
    lower: true,
    strict: true,
    trim: true,
  });
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cappedBoost(value, divisor, cap) {
  return Math.min(cap, toNumber(value) / divisor);
}

function compactText(value, maxLength = 170) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text.replace(/\s*(?:\.{3,}|…)+\s*$/u, "").trim();
  }

  const sentenceMatches = [...text.slice(0, maxLength).matchAll(/[.!?](?=\s|$)/g)];
  const lastSentence = sentenceMatches.at(-1);
  if (lastSentence && lastSentence.index >= 70) {
    return text.slice(0, lastSentence.index + 1).trim();
  }

  return text
    .slice(0, maxLength)
    .replace(/\s+\S*$/, "")
    .replace(/\s*(?:\.{3,}|…)+\s*$/u, "")
    .trim();
}

function cleanBioExcerpt(value, maxLength = 170) {
  const source = String(value || "");
  const blockedPublicCopyPattern =
    /\b(18|19|teen|teens|teenage|teenager|student|senior year|freshman|sophomore|junior year|high school|schoolgirl|schoolboy|barely legal|underage|jailbait|loli|little|baby)\b|lilcutie/i;

  if (blockedPublicCopyPattern.test(source)) {
    return "";
  }

  return compactText(source, maxLength);
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

function seededRandom(seed) {
  let hash = 1779033703 ^ String(seed).length;

  for (let index = 0; index < String(seed).length; index += 1) {
    hash = Math.imul(hash ^ String(seed).charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return function random() {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  };
}

function cleanTag(value) {
  const raw = String(value || "").trim();
  const normalized = raw.replace(/[_-]+/g, " ");
  const blockedTagPattern =
    /\b(teen|teens|teenage|teenager|young|schoolgirl|schoolboy|school|barely|legal|college|student|freshman|sophomore|junior|senior|18|19)\b|\b(?:1[89]|[2-9]\d)\s*(?:yo|y\/o|yr\s*old|yrs\s*old|year\s*old|years\s*old|old)\b/i;

  if (
    !raw ||
    raw.length > 28 ||
    blockedTagPattern.test(normalized) ||
    /https?:|onlyfans|revc_|cplo_|^\d+$|[^\w\s-]/i.test(raw)
  ) {
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

function hasAgeCodedPublicName(creator) {
  const publicText = `${creator.displayName || creator.name || ""} ${creator.username || ""} ${creator.slug || ""}`
    .replace(/[_\s.-]+/g, "")
    .toLowerCase();

  // Only block explicit high-risk age-coded terms in public names/usernames.
  // Words like "baby" or "little" in real display names are allowed.
  return /teen|schoolgirl|schoolboy|barelylegal|underage|jailbait|loli/.test(publicText);
}

function isKnownValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function isManualUnknownAccessAllowed(creator) {
  const manual = creator.manualCuration || {};

  return Boolean(
    manual.allowMissingAccessEvidence ||
      manual.forceFeatureNewInventory ||
      manual.forceHomepageTest ||
      creator.allowMissingAccessEvidence
  );
}

function hasFreeAccessEvidence(creator) {
  const offerType = String(creator.offerType || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const regularPriceKnown = isKnownValue(creator.regularPrice);

  return Boolean(
    creator.isFree ||
      creator.isFreeTrial ||
      creator.hasActiveFreePromo ||
      offerType === "free" ||
      offerType === "free_trial" ||
      (regularPriceKnown && toNumber(creator.regularPrice) === 0)
  );
}

export function isPremiumOnlyCreator(creator) {
  if (hasFreeAccessEvidence(creator)) {
    return false;
  }

  const regularPriceKnown = isKnownValue(creator.regularPrice);
  if (regularPriceKnown) {
    return toNumber(creator.regularPrice) > 0;
  }

  return !isManualUnknownAccessAllowed(creator);
}

function isCreatorActive(creator) {
  if (creator.isActive === false) {
    return false;
  }

  const dateFinish = creator.dateFinish || creator.date_finish || creator.campaignDateFinish;
  if (!dateFinish) {
    return true;
  }

  const finishMs = Date.parse(dateFinish);
  return !Number.isFinite(finishMs) || finishMs > Date.now();
}

function isPublicFreeInventoryRecommendation(creator) {
  return PUBLIC_FREE_INVENTORY_RECOMMENDATIONS.has(creator.recommendation);
}

function isCplCampaignCreator(creator) {
  const commissionType = String(creator.commissionType || "").trim().toLowerCase();
  const monetizationBucket = String(creator.monetizationBucket || "").trim().toLowerCase();

  return commissionType === "cpl" || monetizationBucket === "cpl";
}

export function getPublicEligibilityDetails(creator) {
  const isPremiumOnly = isPremiumOnlyCreator(creator);
  const publicAccessEvidence = hasFreeAccessEvidence(creator) || isPublicFreeInventoryRecommendation(creator);

  if (isCplCampaignCreator(creator)) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "cpl_campaign" };
  }
  if (isBlockedCreator(creator)) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "force_excluded" };
  }
  if (creator.duplicateBestCandidate === false) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "duplicate_slug_loser" };
  }
  if (!isCreatorActive(creator)) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "inactive_campaign" };
  }
  if (!creator.slug) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "inactive_campaign" };
  }
  if (!String(creator.displayName || creator.name || "").trim()) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "inactive_campaign" };
  }
  if (!hasUsableOutboundUrl(creator)) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "missing_tracking_url" };
  }
  if (!getImageUrl(creator)) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "missing_image" };
  }
  if (isPremiumOnly || !publicAccessEvidence) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "premium_only_hidden" };
  }
  if (hasAgeCodedPublicName(creator)) {
    return { isPremiumOnly, publicEligible: false, hiddenReason: "force_excluded" };
  }

  return { isPremiumOnly, publicEligible: true, hiddenReason: "" };
}

export function isPublicFreeOnlyFanzCreator(creator) {
  return getPublicEligibilityDetails(creator).publicEligible;
}

function withPublicEligibilityFields(creator) {
  return {
    ...creator,
    ...getPublicEligibilityDetails(creator),
  };
}

function mergeCreatorRows(reportCreator, rawCreator) {
  const merged = {
    ...(rawCreator || {}),
    ...(reportCreator || {}),
  };
  const username = normalizeUsername(merged.username || merged.onlyfansUrl || merged.slug);
  const normalizedCreator = {
    ...merged,
    username,
  };

  return {
    ...normalizedCreator,
    username,
    slug: makeCreatorSlug(normalizedCreator),
    displayName: String(merged.name || username || "Creator").trim(),
    shortBio: cleanBioExcerpt(merged.bio || "", 190),
    homepagePriority: toNumber(merged.homepagePriority),
    score: toNumber(merged.score),
    tags: cleanTags([...(merged.tags || []), ...(merged.campaignTags || [])]),
  };
}

function creatorKey(creator) {
  return normalizeUsername(creator.username) || String(creator.slug || creator.campaignId || creator.publicId);
}

function shouldIncludeCreator(creator) {
  return isPublicFreeOnlyFanzCreator(creator);
}

function getCreatorDateMs(creator, fields = ["dateCreate", "dateUpdate"]) {
  for (const field of fields) {
    const value = creator?.[field];
    if (value === null || value === undefined || value === "") {
      continue;
    }

    if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value).trim())) {
      const numericValue = Number(value);
      const timestamp = numericValue > 9999999999 ? numericValue : numericValue * 1000;
      if (Number.isFinite(timestamp)) {
        return timestamp;
      }
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function recentCreatorSort(a, b) {
  return getCreatorDateMs(b) - getCreatorDateMs(a) || creatorSort(a, b);
}

function isRecentlyAddedCreator(creator) {
  if (["feature_new_inventory", "test_new_inventory", "new_cpl_candidate"].includes(creator.recommendation)) {
    return true;
  }

  const dateCreateMs = getCreatorDateMs(creator, ["dateCreate"]);
  if (!dateCreateMs) {
    return false;
  }

  return Date.now() - dateCreateMs <= RECENT_CREATOR_DAYS * 24 * 60 * 60 * 1000;
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

  const bySlug = new Map();

  for (const creator of byUsername.values()) {
    if (!creator.slug) {
      continue;
    }

    const existing = bySlug.get(creator.slug);
    if (!existing || creatorSort(creator, existing) < 0) {
      bySlug.set(creator.slug, creator);
    }
  }

  return [...bySlug.values()].sort(creatorSort);
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

function getManualTrafficWeights() {
  const manual = readManualCurationRaw();
  const rawWeights = manual.trafficWeights && typeof manual.trafficWeights === "object" ? manual.trafficWeights : {};
  const weights = new Map();

  for (const [rawKey, rawWeight] of Object.entries(rawWeights)) {
    const normalizedKey = normalizeUsername(rawKey) || makeCreatorSlug(rawKey);
    const slugKey = makeCreatorSlug(rawKey);
    const weight = toNumber(rawWeight);

    if (!weight || weight <= 0) {
      continue;
    }
    if (normalizedKey) {
      weights.set(normalizedKey, weight);
    }
    if (slugKey) {
      weights.set(slugKey, weight);
    }
  }

  return weights;
}

function getManualTrafficWeight(creator, trafficWeights = getManualTrafficWeights()) {
  return (
    trafficWeights.get(normalizeUsername(creator.username)) ||
    trafficWeights.get(makeCreatorSlug(creator.slug)) ||
    trafficWeights.get(makeCreatorSlug(creator.onlyfansUrl)) ||
    0
  );
}

function hasUsableOutboundUrl(creator) {
  const value = String(creator.trackingUrl || "").trim();

  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (_error) {
    return false;
  }
}

function isTqRecommendationCandidate(creator) {
  return TQ_ELIGIBLE_RECOMMENDATIONS.has(creator.recommendation);
}

function getTqEligibility(creator) {
  const publicEligibility = getPublicEligibilityDetails(creator);
  const imagePresent = Boolean(getImageUrl(creator));
  const trackingUrlPresent = hasUsableOutboundUrl(creator);
  const freeOrTestCandidate = Boolean(
    creator.isFree ||
      creator.isFreeTrial ||
      creator.hasActiveFreePromo ||
      isTqRecommendationCandidate(creator)
  );

  if (!publicEligibility.publicEligible) {
    return {
      eligible: false,
      reason: `excluded: ${publicEligibility.hiddenReason}`,
      imagePresent,
      trackingUrlPresent,
    };
  }
  if (creator.manualCuration?.forceExclude) {
    return { eligible: false, reason: "excluded: manual forceExclude", imagePresent, trackingUrlPresent };
  }
  if (!trackingUrlPresent) {
    return { eligible: false, reason: "excluded: missing trackingUrl", imagePresent, trackingUrlPresent };
  }
  if (!imagePresent) {
    return { eligible: false, reason: "excluded: missing usable image", imagePresent, trackingUrlPresent };
  }
  if (!freeOrTestCandidate) {
    return { eligible: false, reason: "excluded: not a free/trial/test candidate", imagePresent, trackingUrlPresent };
  }

  return { eligible: true, reason: "eligible", imagePresent, trackingUrlPresent };
}

export function appendTqTrackingParams(trackingUrl) {
  const rawUrl = String(trackingUrl || "").trim();

  if (!rawUrl) {
    return "";
  }

  try {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(TQ_UTM_PARAMS)) {
      if (!url.searchParams.has(key)) {
        url.searchParams.append(key, value);
      }
    }
    return url.toString();
  } catch (_error) {
    const separator = rawUrl.includes("?") ? "&" : "?";
    const existingParams = new URLSearchParams(rawUrl.split("?")[1] || "");
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(TQ_UTM_PARAMS)) {
      if (!existingParams.has(key)) {
        params.append(key, value);
      }
    }

    const suffix = params.toString();
    return suffix ? `${rawUrl}${separator}${suffix}` : rawUrl;
  }
}

export function getTqWeightDetails(creator, trafficWeights = getManualTrafficWeights()) {
  const parts = [];
  let weight = 1;
  const add = (points, reason) => {
    const value = toNumber(points);
    if (value <= 0) {
      return;
    }
    weight += value;
    parts.push(`${reason} +${Math.round(value * 100) / 100}`);
  };

  const manualTrafficWeight = getManualTrafficWeight(creator, trafficWeights);
  add(manualTrafficWeight, "manual traffic weight");

  if (creator.manualCuration?.forceFeatureNewInventory) {
    add(40, "forceFeatureNewInventory");
  }

  add(TQ_RECOMMENDATION_WEIGHTS[creator.recommendation] || 0, creator.recommendation || "recommendation");

  if (creator.isFree) {
    add(10, "free profile");
  }
  if (creator.isFreeTrial) {
    add(10, "free trial");
  }
  if (creator.hasActiveFreePromo) {
    add(8, "active free promo");
  }

  const galleryImages = getGalleryImages(creator, 4);
  if (galleryImages.length > 1) {
    add(8, "multiple images");
  }

  add(toNumber(creator.score) / 5, "score");
  add(toNumber(creator.homepagePriority) / 2, "homepagePriority");
  add(toNumber(creator.manualPriority) / 2, "manualPriority");
  add(cappedBoost(creator.transactionIncome, 20, 12), "transactionIncome");
  add(cappedBoost(creator.subscribers, 25, 12), "subscribers");
  add(cappedBoost(creator.realRevenuePerSubscriber, 0.5, 10), "realRevenuePerSubscriber");

  return {
    tqWeight: Math.max(1, Math.round(weight * 100) / 100),
    reason: parts.join("; ") || "base eligible weight",
    manualTrafficWeight,
  };
}

function weightedShuffle(creators, seed) {
  const random = seededRandom(seed);

  return creators
    .map((creator) => {
      const weight = Math.max(1, toNumber(creator.tqWeight));
      const roll = Math.max(Number.EPSILON, random());
      return {
        creator,
        rank: -Math.log(roll) / weight,
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.creator);
}

export function getTqRotationSeed() {
  return process.env.TQ_ROTATION_SEED || new Date().toISOString().slice(0, 13);
}

export function getTqCreatorRows({ seed = getTqRotationSeed(), mainLimit = 12, moreLimit = 24, poolLimit = 60 } = {}) {
  const creators = loadCreators();
  const trafficWeights = getManualTrafficWeights();
  const rows = creators.map((creator) => {
    const eligibility = getTqEligibility(creator);
    const weightDetails = eligibility.eligible
      ? getTqWeightDetails(creator, trafficWeights)
      : { tqWeight: 0, reason: eligibility.reason, manualTrafficWeight: 0 };

    return {
      creator,
      ...eligibility,
      ...weightDetails,
      reason: eligibility.eligible ? weightDetails.reason : eligibility.reason,
      shownOnTq: false,
      tqSection: "",
    };
  });

  const eligibleRows = rows.filter((row) => row.eligible);
  const weightedCreators = eligibleRows.map((row) => ({
    ...row.creator,
    tqWeight: row.tqWeight,
    tqWeightReason: row.reason,
    tqTrackingUrl: appendTqTrackingParams(row.creator.trackingUrl),
  }));

  // Separate free-trial girls from pure free girls for Direction 1 positioning
  const freeTrialCreators = weightedCreators.filter(
    (c) => c.isFreeTrial || c.hasActiveFreePromo
  );
  const freeOnlyCreators = weightedCreators.filter(
    (c) => !c.isFreeTrial && !c.hasActiveFreePromo
  );

  // Shuffle within each group so rotation still feels fresh
  const shuffledFreeTrial = weightedShuffle(freeTrialCreators, seed);
  const shuffledFreeOnly = weightedShuffle(freeOnlyCreators, seed + "_free");

  // Build main section: free-trial girls first, then fill with free girls
  const mainTrialCount = Math.min(Math.ceil(mainLimit * 0.7), shuffledFreeTrial.length);
  const mainFreeCount = Math.min(mainLimit - mainTrialCount, shuffledFreeOnly.length);

  const mainCreators = [
    ...shuffledFreeTrial.slice(0, mainTrialCount),
    ...shuffledFreeOnly.slice(0, mainFreeCount),
  ].slice(0, mainLimit);

  // Remaining pool for "More Free Picks" (mixed, already rotated)
  const usedSlugs = new Set(mainCreators.map((c) => c.slug));
  const remainingPool = weightedCreators.filter((c) => !usedSlugs.has(c.slug));
  const moreCreators = remainingPool.slice(0, moreLimit);

  const sectionBySlug = new Map([
    ...mainCreators.map((creator) => [creator.slug, "Start Here"]),
    ...moreCreators.map((creator) => [creator.slug, "More Free Profiles"]),
  ]);

  for (const row of rows) {
    const tqSection = sectionBySlug.get(row.creator.slug) || "";
    row.shownOnTq = Boolean(tqSection);
    row.tqSection = tqSection;
  }

  return {
    seed,
    rows,
    eligibleRows,
    poolCreators: weightedCreators,
    mainCreators,
    moreCreators,
  };
}

export function getCreatorBadges(creator) {
  const badges = [];

  if (isPremiumOnlyCreator(creator)) {
    return badges;
  }

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

export function getTqCardCtaText(creator) {
  if (creator?.isFreeTrial || creator?.hasActiveFreePromo) {
    return "Start Free Trial";
  }

  if (creator?.isFree) {
    return "Open Free";
  }

  return "Open Free Page";
}

export function getCardCtaText() {
  return "View Profile";
}

export function getOutboundCtaText(creator = null) {
  if (creator && isPremiumOnlyCreator(creator)) {
    return "Open Profile";
  }

  return "Open Free Page";
}

export function getCreatorFallbackBio(creator) {
  if (creator?.isFreeTrial) {
    return "Open this creator's current free-trial profile and browse similar picks from FreeOnlyFanz.";
  }

  if (creator?.isFree || creator?.hasActiveFreePromo) {
    return "Open this creator's current free profile and browse similar picks from FreeOnlyFanz.";
  }

  return "Open this creator's current free or free-trial profile and browse similar picks from FreeOnlyFanz.";
}

export function getCreatorDisplayBio(creator) {
  const cleanBio = String(creator?.shortBio || "").replace(/\s+/g, " ").trim();

  if (cleanBio.length >= 24) {
    return {
      text: cleanBio,
      usesFallbackBio: false,
    };
  }

  return {
    text: getCreatorFallbackBio(creator),
    usesFallbackBio: true,
  };
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

  const annotatedCreators = mergedCreators.map(withPublicEligibilityFields);

  return dedupeByUsername(annotatedCreators.filter((creator) => creator.slug && shouldIncludeCreator(creator)));
}

export function getHomepageSections() {
  const creators = loadCreators();
  const byRecommendation = (recommendations, limit) =>
    creators
      .filter((creator) => recommendations.includes(creator.recommendation))
      .sort(creatorSort)
      .slice(0, limit);
  const recentCreators = creators.filter(isRecentlyAddedCreator).sort(recentCreatorSort).slice(0, SECTION_LIMITS.recent);

  return [
    {
      id: "new-free-creators",
      title: "New Free Profiles",
      kicker: "Fresh free profiles added to the list.",
      creators: recentCreators,
    },
    {
      id: "featured-free-creators",
      title: "Featured Creator Picks",
      kicker: "Creator pages worth opening first.",
      creators: byRecommendation(FEATURED_RECOMMENDATIONS, SECTION_LIMITS.featured),
    },
    {
      id: "free-trial-creators",
      title: "Free Trial Picks",
      kicker: "Free-trial picks with quick access.",
      creators: byRecommendation(["test_revshare_free_trial"], SECTION_LIMITS.free_trial),
    },
    {
      id: "more-free-picks",
      title: "More Free Profiles",
      kicker: "More free creator pages worth browsing.",
      creators: byRecommendation(["test_cpl", "new_cpl_candidate", "test_new_inventory"], SECTION_LIMITS.cpl_tests),
    },
    {
      id: "popular-picks",
      title: "Popular Picks",
      kicker: "Established picks and longtime favorites.",
      creators: byRecommendation(["keep_revshare_direct", "legacy_watch", "review_manually"], SECTION_LIMITS.popular),
    },
  ].filter((section) => section.creators.length > 0);
}

export function getCreatorBySlug(slug) {
  return loadCreators().find((creator) => creator.slug === makeCreatorSlug(slug));
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
      title: categoryCopy.free.title,
      description: categoryCopy.free.description,
      filter: (creator) => creator.isFree || creator.isFreeTrial || creator.hasActiveFreePromo,
    },
    {
      slug: "free-trial",
      title: categoryCopy["free-trial"].title,
      description: categoryCopy["free-trial"].description,
      filter: (creator) => creator.recommendation === "test_revshare_free_trial" || creator.isFreeTrial,
    },
    {
      slug: "new",
      title: categoryCopy.new.title,
      description: categoryCopy.new.description,
      filter: isRecentlyAddedCreator,
    },
    {
      slug: "featured",
      title: categoryCopy.featured.title,
      description: categoryCopy.featured.description,
      filter: (creator) => FEATURED_RECOMMENDATIONS.includes(creator.recommendation),
    },
  ];
}

export function getCategoryBySlug(slug) {
  return getCategoryDefinitions().find((category) => category.slug === slug);
}
