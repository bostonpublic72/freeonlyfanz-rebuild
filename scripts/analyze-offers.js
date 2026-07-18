const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CREATORS_PATH = path.join(ROOT, "data", "creators.json");
const MANUAL_CURATION_PATH = path.join(ROOT, "data", "manual-curation.json");
const RAW_TRANSACTIONS_PATH = path.join(ROOT, "data", "raw", "onlytraffic-transactions.json");
const REPORTS_DIR = path.join(ROOT, "data", "reports");
const JSON_REPORT_PATH = path.join(REPORTS_DIR, "offer-analysis.json");
const CSV_REPORT_PATH = path.join(REPORTS_DIR, "offer-analysis.csv");

const THRESHOLDS = {
  cplBaselineLow: 0.64,
  cplBaselineStrong: 0.8,
  revshareKeeper: 0.8,
  revshareMaybe: 0.4,
  provenDirectRevshare: 1.5,
  lowConversionVisits: 50,
  badConversionVisits: 100,
  badVisitToSubscriberRate: 0.02,
  tooManyBlockedCountries: 40,
};

const MANUAL_OVERRIDES = {
  miami_candy: {
    isWarmSocialDirectWinner: true,
    provenSource: "warm_social_direct",
    recommendedTrafficSource: "warm_social_direct",
    manualNotes:
      "Known direct social revshare winner. Do not automatically rank for FreeOnlyFanz SEO without testing.",
  },
};

const DEFAULT_MANUAL_CURATION = {
  forceFeatureNewInventory: [],
  forceHomepageTest: [],
  forceExclude: [],
  notes: {},
};

const CSV_COLUMNS = [
  "username",
  "name",
  "campaignId",
  "publicId",
  "campaignName",
  "commissionType",
  "offerType",
  "monetizationBucket",
  "isFree",
  "isFreeTrial",
  "hasActiveFreePromo",
  "isPremiumOnly",
  "publicEligible",
  "hiddenReason",
  "visits",
  "subscribers",
  "subscribersToday",
  "visitToSubscriberRate",
  "commissionIncome",
  "commissionRevenue",
  "revenuePerSubscriber",
  "revenuePerVisit",
  "transactionCount",
  "approvedTransactionCount",
  "transactionIncome",
  "transactionRevenue",
  "realRevenuePerSubscriber",
  "realRevenuePerVisit",
  "earningsSource",
  "regularPrice",
  "blockedCountryCount",
  "imagesCount",
  "likesCount",
  "postsCount",
  "photosCount",
  "videosCount",
  "performerTop",
  "duplicateUsername",
  "provenSource",
  "recommendedTrafficSource",
  "isWarmSocialDirectWinner",
  "recommendation",
  "score",
  "manualPriority",
  "homepagePriority",
  "warnings",
  "manualNotes",
  "trackingUrl",
];

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number.parseFloat(String(value).replace(/,/g, "").replace(/[$%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick(source, paths, fallback = undefined) {
  for (const rawPath of paths) {
    const parts = Array.isArray(rawPath) ? rawPath : String(rawPath).split(".");
    let current = source;

    for (const part of parts) {
      if (current == null || typeof current !== "object" || !(part in current)) {
        current = undefined;
        break;
      }
      current = current[part];
    }

    if (current !== undefined && current !== null && current !== "") {
      return current;
    }
  }

  return fallback;
}

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "approved", "paid", "complete", "completed"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "rejected", "declined", "failed", "cancelled"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeUsername(username) {
  if (!username) {
    return "";
  }

  let value = String(username).trim();

  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      value = url.pathname.split("/").filter(Boolean)[0] || value;
    }
  } catch (_error) {
    // Fall through to string cleanup.
  }

  return value
    .replace(/^@+/, "")
    .replace(/^onlyfans\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

function normalizeComparableText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function uniqueNonEmptyStrings(values) {
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

function joinNotes(values) {
  return uniqueNonEmptyStrings(values).join(" ");
}

function effectiveRevenuePerSubscriber(creator) {
  if (creator.realRevenuePerSubscriber !== undefined) {
    return toNumber(creator.realRevenuePerSubscriber);
  }

  return toNumber(creator.revenuePerSubscriber);
}

function getMonetizationBucket(creator) {
  if (creator.monetizationBucket) {
    return creator.monetizationBucket;
  }

  const text = `${creator.commissionType || ""} ${creator.offerType || ""}`.toLowerCase();
  if (/(rev\s*share|revshare|revenue\s*share)/i.test(text)) {
    return "revshare";
  }
  if (/(cpl|cpa|lead|subscription|fixed|payout|cost\s*per\s*lead)/i.test(text)) {
    return "cpl";
  }
  return "unknown";
}

function isKnownValue(value) {
  return value !== null && value !== undefined && value !== "";
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

function isManualUnknownAccessAllowed(creator) {
  const manual = creator.manualCuration || {};

  return Boolean(
    manual.allowMissingAccessEvidence ||
      manual.forceFeatureNewInventory ||
      manual.forceHomepageTest ||
      creator.allowMissingAccessEvidence
  );
}

function isPremiumOnlyCreator(creator) {
  if (hasFreeAccessEvidence(creator)) {
    return false;
  }

  const regularPriceKnown = isKnownValue(creator.regularPrice);
  if (regularPriceKnown) {
    return toNumber(creator.regularPrice) > 0;
  }

  return !isManualUnknownAccessAllowed(creator);
}

function hasAvatar(creator) {
  return Boolean(creator.avatarOriginal || creator.avatarThumbnail || creator.avatarThumbnail640);
}

function imagesCount(creator) {
  return Array.isArray(creator.images) ? creator.images.length : 0;
}

function parsePerformerTop(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  if (parsed > 0 && parsed < 1) {
    return parsed * 100;
  }

  return parsed;
}

function strongAccountStats(creator) {
  return (
    toNumber(creator.likesCount) >= 5000 ||
    toNumber(creator.postsCount) >= 100 ||
    toNumber(creator.photosCount) >= 50 ||
    toNumber(creator.videosCount) >= 20
  );
}

function parseDateMs(value) {
  if (!value) {
    return 0;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeManualUsernameList(values) {
  if (!Array.isArray(values)) {
    return new Set();
  }

  return new Set(values.map(normalizeUsername).filter(Boolean));
}

function normalizeManualNotes(notes) {
  const normalized = new Map();

  if (!notes || typeof notes !== "object") {
    return normalized;
  }

  for (const [username, note] of Object.entries(notes)) {
    const key = normalizeUsername(username);
    const value = String(note || "").trim();
    if (key && value) {
      normalized.set(key, value);
    }
  }

  return normalized;
}

function normalizeManualCuration(raw) {
  const data = raw && typeof raw === "object" ? raw : DEFAULT_MANUAL_CURATION;

  return {
    forceFeatureNewInventory: normalizeManualUsernameList(data.forceFeatureNewInventory),
    forceHomepageTest: normalizeManualUsernameList(data.forceHomepageTest),
    forceExclude: normalizeManualUsernameList(data.forceExclude),
    notes: normalizeManualNotes(data.notes),
  };
}

function getManualCurationForCreator(creator, manualCuration) {
  const username = normalizeUsername(creator.username || creator.slug || creator.onlyfansUrl);

  return {
    username,
    forceFeatureNewInventory: manualCuration.forceFeatureNewInventory.has(username),
    forceHomepageTest: manualCuration.forceHomepageTest.has(username),
    forceExclude: manualCuration.forceExclude.has(username),
    note: manualCuration.notes.get(username) || "",
  };
}

function addMatchKey(keys, kind, value, normalizer = normalizeComparableText) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  const normalized = normalizer(value);
  if (!normalized || normalized === "0") {
    return;
  }

  keys.add(`${kind}:${normalized}`);
}

function addPickedMatchKeys(keys, kind, source, paths, normalizer = normalizeComparableText) {
  for (const fieldPath of paths) {
    addMatchKey(keys, kind, pick(source, [fieldPath], undefined), normalizer);
  }
}

function collectCreatorMatchKeys(creator) {
  const keys = new Set();
  const campaignIds = [creator.campaignId, creator.campaign_id];
  const offerIds = [creator.offerId, creator.offer_id, creator.campaignId, creator.campaign_id];

  for (const value of campaignIds) {
    addMatchKey(keys, "campaign", value);
  }
  for (const value of offerIds) {
    addMatchKey(keys, "offer", value);
  }

  addMatchKey(keys, "public", creator.publicId || creator.public_id);
  addMatchKey(keys, "onlyfans_id", creator.onlyfansId || creator.onlyfans_id);
  addMatchKey(keys, "username", creator.username, normalizeUsername);
  addMatchKey(keys, "username", creator.onlyfansUrl || creator.onlyfans_url, normalizeUsername);
  addMatchKey(keys, "campaign_name", creator.campaignName || creator.campaign_name);

  return [...keys];
}

function collectTransactionMatchKeyGroups(transaction) {
  const campaignKeys = new Set();
  const offerKeys = new Set();
  const publicKeys = new Set();
  const onlyfansIdKeys = new Set();
  const usernameKeys = new Set();
  const urlKeys = new Set();
  const campaignNameKeys = new Set();

  addPickedMatchKeys(campaignKeys, "campaign", transaction, [
    "campaign_id",
    "campaignId",
    "campaign.id",
    "campaign.campaign_id",
    "campaign.campaignId",
  ]);
  addPickedMatchKeys(offerKeys, "offer", transaction, [
    "offer_id",
    "offerId",
    "offer.id",
    "offer.offer_id",
    "offer.offerId",
    "commission_data.offer_id",
  ]);
  addPickedMatchKeys(publicKeys, "public", transaction, [
    "public_id",
    "publicId",
    "campaign_public_id",
    "campaignPublicId",
    "campaign.public_id",
    "campaign.publicId",
  ]);
  addPickedMatchKeys(onlyfansIdKeys, "onlyfans_id", transaction, [
    "onlyfans_id",
    "onlyfansId",
    "onlyfans.id",
    "onlyfansAccount.id",
    "onlyfans_account.id",
    "account.onlyfans_id",
    "account.onlyfansId",
    "creator.onlyfans_id",
    "creator.onlyfansId",
  ]);
  addPickedMatchKeys(
    usernameKeys,
    "username",
    transaction,
    [
      "onlyfans_username",
      "onlyfansUsername",
      "username",
      "user_name",
      "campaign.onlyfans_username",
      "campaign.onlyfansUsername",
      "onlyfans.username",
      "onlyfansAccount.username",
      "onlyfans_account.username",
      "account.username",
      "creator.username",
    ],
    normalizeUsername
  );
  addPickedMatchKeys(
    urlKeys,
    "username",
    transaction,
    [
      "onlyfans_url",
      "onlyfansUrl",
      "url",
      "campaign.onlyfans_url",
      "campaign.onlyfansUrl",
      "campaign.url",
      "onlyfans.url",
      "onlyfansAccount.url",
      "onlyfans_account.url",
      "account.url",
      "creator.url",
    ],
    normalizeUsername
  );
  addPickedMatchKeys(campaignNameKeys, "campaign_name", transaction, [
    "campaign_name",
    "campaignName",
    "campaign.name",
    "offer_name",
    "offerName",
    "offer.name",
    "name",
    "title",
  ]);

  return [
    [...campaignKeys],
    [...offerKeys],
    [...publicKeys],
    [...onlyfansIdKeys],
    [...usernameKeys],
    [...urlKeys],
    [...campaignNameKeys],
  ].filter((group) => group.length > 0);
}

function buildCreatorMatchIndex(creators) {
  const index = new Map();

  creators.forEach((creator, creatorIndex) => {
    for (const key of collectCreatorMatchKeys(creator)) {
      if (!index.has(key)) {
        index.set(key, new Set());
      }
      index.get(key).add(creatorIndex);
    }
  });

  return index;
}

function matchTransactionToCreators(transaction, creatorMatchIndex) {
  for (const keyGroup of collectTransactionMatchKeyGroups(transaction)) {
    const matches = new Set();

    for (const key of keyGroup) {
      const creatorIndexes = creatorMatchIndex.get(key);
      if (!creatorIndexes) {
        continue;
      }

      for (const creatorIndex of creatorIndexes) {
        matches.add(creatorIndex);
      }
    }

    if (matches.size > 0) {
      return [...matches];
    }
  }

  return [];
}

function normalizeTransactionStatus(transaction) {
  if (toBoolean(pick(transaction, ["is_undo", "isUndo", "undo"], false), false)) {
    return "rejected";
  }
  if (toBoolean(pick(transaction, ["is_rejected", "isRejected", "rejected"], false), false)) {
    return "rejected";
  }
  if (toBoolean(pick(transaction, ["is_pending", "isPending", "pending"], false), false)) {
    return "pending";
  }
  if (toBoolean(pick(transaction, ["is_approved", "isApproved", "approved", "paid"], false), false)) {
    return "approved";
  }

  const rawStatus = String(
    pick(transaction, ["status", "state", "transaction_status", "transactionStatus", "approval_status", "approvalStatus"], "")
  )
    .trim()
    .toLowerCase();

  if (/(approved|paid|confirmed|complete|completed|success|successful)/i.test(rawStatus)) {
    return "approved";
  }
  if (/(pending|hold|review|processing|waiting)/i.test(rawStatus)) {
    return "pending";
  }
  if (/(reject|rejected|declin|denied|cancel|failed|void|chargeback|refund)/i.test(rawStatus)) {
    return "rejected";
  }

  return rawStatus || "approved";
}

function firstNumberFrom(transaction, paths) {
  for (const fieldPath of paths) {
    const value = pick(transaction, [fieldPath], undefined);
    if (value === undefined || value === null || value === "") {
      continue;
    }

    return toNumber(value);
  }

  return 0;
}

function getTransactionAmounts(transaction) {
  // OnlyTraffic transaction schemas vary. Prefer income/profit/payout style fields
  // for marketer earnings, but fall back through generic money fields when needed.
  const income = firstNumberFrom(transaction, [
    "income",
    "profit",
    "revenue",
    "amount",
    "payout",
    "commission",
    "total",
    "commission_amount",
    "commissionAmount",
    "payout_amount",
    "payoutAmount",
  ]);
  const revenue = firstNumberFrom(transaction, [
    "revenue",
    "gross_revenue",
    "grossRevenue",
    "amount",
    "total",
    "income",
    "profit",
    "payout",
    "commission",
    "total_amount",
    "totalAmount",
  ]);
  const amount = firstNumberFrom(transaction, [
    "amount",
    "total",
    "income",
    "profit",
    "revenue",
    "payout",
    "commission",
    "total_amount",
    "totalAmount",
  ]);

  return { income, revenue, amount };
}

function createEmptyTransactionMetrics() {
  return {
    transactionCount: 0,
    approvedTransactionCount: 0,
    pendingTransactionCount: 0,
    rejectedTransactionCount: 0,
    transactionRevenue: 0,
    transactionIncome: 0,
    transactionAmount: 0,
  };
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 1000000) / 1000000;
}

function attachFallbackEarnings(creator) {
  const subscribers = toNumber(creator.subscribers);
  const visits = toNumber(creator.visits);
  const commissionIncome = toNumber(creator.commissionIncome);
  const commissionRevenue = toNumber(creator.commissionRevenue);
  const hasCampaignEarnings = commissionIncome > 0 || commissionRevenue > 0 || toNumber(creator.revenuePerSubscriber) > 0;

  return {
    ...creator,
    ...createEmptyTransactionMetrics(),
    realRevenuePerSubscriber: subscribers > 0 ? commissionIncome / subscribers : 0,
    realRevenuePerVisit: visits > 0 ? commissionIncome / visits : 0,
    earningsSource: hasCampaignEarnings ? "campaign_commission_data" : "none",
  };
}

function attachTransactionEarnings(creators, transactionsData) {
  if (!transactionsData.exists) {
    return {
      creators: creators.map(attachFallbackEarnings),
      stats: {
        transactionsFileFound: false,
        totalTransactions: 0,
        matchedTransactions: 0,
        unmatchedTransactions: 0,
      },
    };
  }

  const metricsByCreator = creators.map(createEmptyTransactionMetrics);
  const creatorMatchIndex = buildCreatorMatchIndex(creators);
  let matchedTransactions = 0;

  for (const transaction of transactionsData.transactions) {
    if (!transaction || typeof transaction !== "object") {
      continue;
    }

    const matchedCreatorIndexes = matchTransactionToCreators(transaction, creatorMatchIndex);
    if (matchedCreatorIndexes.length === 0) {
      continue;
    }

    matchedTransactions += 1;
    const status = normalizeTransactionStatus(transaction);
    const amounts = getTransactionAmounts(transaction);
    const includeAmounts = status !== "rejected";

    for (const creatorIndex of matchedCreatorIndexes) {
      const metrics = metricsByCreator[creatorIndex];
      metrics.transactionCount += 1;

      if (status === "approved") {
        metrics.approvedTransactionCount += 1;
      } else if (status === "pending") {
        metrics.pendingTransactionCount += 1;
      } else if (status === "rejected") {
        metrics.rejectedTransactionCount += 1;
      }

      if (includeAmounts) {
        metrics.transactionIncome += amounts.income;
        metrics.transactionRevenue += amounts.revenue;
        metrics.transactionAmount += amounts.amount;
      }
    }
  }

  return {
    creators: creators.map((creator, index) => {
      const metrics = metricsByCreator[index];
      const subscribers = toNumber(creator.subscribers);
      const visits = toNumber(creator.visits);
      const transactionIncome = roundMoney(metrics.transactionIncome);

      return {
        ...creator,
        ...metrics,
        transactionIncome,
        transactionRevenue: roundMoney(metrics.transactionRevenue),
        transactionAmount: roundMoney(metrics.transactionAmount),
        realRevenuePerSubscriber: subscribers > 0 ? transactionIncome / subscribers : 0,
        realRevenuePerVisit: visits > 0 ? transactionIncome / visits : 0,
        earningsSource: metrics.transactionCount > 0 ? "transactions" : "none",
      };
    }),
    stats: {
      transactionsFileFound: true,
      totalTransactions: transactionsData.transactions.length,
      matchedTransactions,
      unmatchedTransactions: transactionsData.transactions.length - matchedTransactions,
    },
  };
}

function applyManualOverrides(creator) {
  const key = normalizeUsername(creator.username || creator.slug);
  const override = MANUAL_OVERRIDES[key];
  const monetizationBucket = getMonetizationBucket(creator);

  if (!override) {
    return {
      ...creator,
      monetizationBucket,
    };
  }

  return {
    ...creator,
    ...override,
    monetizationBucket,
    manualNotes: [creator.manualNotes, override.manualNotes].filter(Boolean).join(" "),
  };
}

function applyManualCurationFields(creator, manualCuration) {
  const curation = getManualCurationForCreator(creator, manualCuration);

  return {
    ...creator,
    manualCuration: {
      forceFeatureNewInventory: curation.forceFeatureNewInventory,
      forceHomepageTest: curation.forceHomepageTest,
      forceExclude: curation.forceExclude,
    },
    manualNotes: joinNotes([creator.manualNotes, curation.note]),
  };
}

function duplicateStrengthScore(creator) {
  let score = 0;
  const monetizationBucket = getMonetizationBucket(creator);

  if (monetizationBucket === "cpl") score += 16;
  if (monetizationBucket === "revshare") score += 6;
  if (creator.isFree) score += 12;
  if (creator.isFreeTrial) score += 14;
  if (creator.hasActiveFreePromo) score += 8;
  if (hasAvatar(creator)) score += 6;
  if (imagesCount(creator) >= 3) score += 8;
  score += Math.min(effectiveRevenuePerSubscriber(creator) * 10, 20);
  score += Math.min(toNumber(creator.visitToSubscriberRate) * 250, 25);
  score += parseDateMs(creator.dateUpdate) / 10000000000000;

  if (creator.isWarmSocialDirectWinner) {
    score += 4;
  }

  return score;
}

function markStrongestDuplicates(creators) {
  const groups = new Map();

  for (const creator of creators) {
    const username = normalizeUsername(creator.username);
    if (!username) {
      continue;
    }

    if (!groups.has(username)) {
      groups.set(username, []);
    }
    groups.get(username).push(creator);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const ranked = [...group].sort((a, b) => duplicateStrengthScore(b) - duplicateStrengthScore(a));
    const best = ranked[0];

    for (const creator of group) {
      creator.duplicateUsername = true;
      creator.duplicateGroupBestCampaignId = best.campaignId || best.publicId || best.slug;
      creator.duplicateBestCandidate = creator === best;
    }
  }
}

function addBreakdown(scoringBreakdown, bucket, factor, points) {
  scoringBreakdown[bucket].push({ factor, points });
}

function scoreCreator(creator) {
  const scoringBreakdown = {
    positive: [],
    negative: [],
    thresholds: THRESHOLDS,
  };
  const warnings = [];
  let score = 0;

  const monetizationBucket = getMonetizationBucket(creator);
  const avatarExists = hasAvatar(creator);
  const imageCount = imagesCount(creator);
  const visits = toNumber(creator.visits);
  const subscribers = toNumber(creator.subscribers);
  const visitToSubscriberRate = toNumber(creator.visitToSubscriberRate);
  const revenuePerSubscriber = effectiveRevenuePerSubscriber(creator);
  const blockedCountryCount = toNumber(creator.blockedCountryCount);
  const performerTopPercent = parsePerformerTop(creator.performerTop);
  const isNewZeroTrafficCpl = monetizationBucket === "cpl" && visits === 0 && subscribers === 0;

  function add(points, factor) {
    score += points;
    addBreakdown(scoringBreakdown, points >= 0 ? "positive" : "negative", factor, points);
  }

  if (monetizationBucket === "cpl") {
    add(18, "CPL/lead style offer fits FreeOnlyFanz SEO and cold traffic testing better than unproven revshare.");
  } else if (monetizationBucket === "revshare") {
    add(4, "Revshare offer can be useful, but should not dominate SEO rankings without source-specific evidence.");
  } else {
    add(-6, "Unknown monetization bucket.");
    warnings.push("unknown monetization bucket");
  }

  if (isNewZeroTrafficCpl) {
    warnings.push("new CPL campaign with no traffic yet");
  }

  if (creator.isFree) add(14, "Free-to-follow offer lowers search traffic friction.");
  if (creator.isFreeTrial) add(14, "Free trial offer lowers search and cold traffic friction.");
  if (creator.hasActiveFreePromo) add(9, "Active free promotion is available.");

  if (avatarExists) {
    add(6, "Avatar is available.");
  }

  if (imageCount >= 3) {
    add(9, "At least 3 demo images are available.");
  } else if (imageCount > 0) {
    add(3, "Some demo images are available.");
  }

  if (!avatarExists && imageCount < 3) {
    add(-16, "Missing avatar and fewer than 3 demo images.");
    warnings.push("missing avatar/images");
  } else if (!avatarExists) {
    add(-5, "Avatar is missing.");
    warnings.push("missing avatar");
  } else if (imageCount < 3) {
    add(-5, "Fewer than 3 demo images.");
    warnings.push("fewer than 3 demo images");
  }

  if (visits >= THRESHOLDS.lowConversionVisits && subscribers === 0) {
    add(-24, "Zero subscribers after meaningful visits.");
    warnings.push("zero subscribers after meaningful visits");
  }

  if (visits >= THRESHOLDS.badConversionVisits && visitToSubscriberRate < THRESHOLDS.badVisitToSubscriberRate) {
    add(-18, "Bad visit-to-subscriber rate after 100+ visits.");
    warnings.push("bad visit-to-subscriber rate");
  }

  if (visits >= 50 && subscribers > 0) {
    add(7, "Meaningful visits with at least one subscriber.");
  }

  if (visitToSubscriberRate >= 0.05) {
    add(15, "Strong visit-to-subscriber rate.");
  } else if (visitToSubscriberRate >= THRESHOLDS.badVisitToSubscriberRate) {
    add(8, "Acceptable visit-to-subscriber rate.");
  } else if (visitToSubscriberRate > 0) {
    add(3, "Some conversion signal exists.");
  }

  if (visits >= 100) {
    add(3, "Has enough visits to make conversion data more meaningful.");
  }

  if (blockedCountryCount >= THRESHOLDS.tooManyBlockedCountries) {
    add(-22, "Too many blocked countries.");
    warnings.push("too many blocked countries");
  } else if (blockedCountryCount >= 25) {
    add(-8, "Blocked country count is elevated.");
    warnings.push("elevated blocked country count");
  } else if (blockedCountryCount <= 10) {
    add(4, "Reasonable blocked country count.");
  }

  if (toNumber(creator.likesCount) >= 10000) {
    add(5, "Strong likes count.");
  } else if (toNumber(creator.likesCount) >= 1000) {
    add(3, "Useful likes count.");
  }

  if (toNumber(creator.postsCount) >= 100) {
    add(4, "Strong post count.");
  } else if (toNumber(creator.postsCount) >= 30) {
    add(2, "Useful post count.");
  }

  if (toNumber(creator.photosCount) >= 50) {
    add(4, "Strong photo count.");
  } else if (toNumber(creator.photosCount) >= 20) {
    add(2, "Useful photo count.");
  }

  if (toNumber(creator.videosCount) >= 20) {
    add(4, "Strong video count.");
  } else if (toNumber(creator.videosCount) >= 5) {
    add(2, "Useful video count.");
  }

  if (performerTopPercent !== null && performerTopPercent <= 10) {
    add(4, "Strong performer top ranking, treated as a secondary signal.");
  } else if (performerTopPercent !== null && performerTopPercent <= 25) {
    add(2, "Useful performer top ranking, treated as a secondary signal.");
  }

  if (monetizationBucket === "revshare") {
    if (revenuePerSubscriber >= THRESHOLDS.provenDirectRevshare) {
      add(14, "Very strong revshare revenue per subscriber.");
    } else if (revenuePerSubscriber >= THRESHOLDS.revshareKeeper) {
      add(10, "Strong revshare revenue per subscriber.");
    } else if (revenuePerSubscriber >= THRESHOLDS.revshareMaybe) {
      add(4, "Maybe-useful revshare revenue per subscriber.");
    } else {
      add(-12, "Revshare revenue per subscriber is below CPL baseline.");
      warnings.push("revshare revenue per subscriber below CPL baseline");
    }
  }

  if (strongAccountStats(creator) && visits >= 100 && visitToSubscriberRate < THRESHOLDS.badVisitToSubscriberRate) {
    add(-9, "High account stats but weak conversion from imported traffic.");
    warnings.push("high stats but weak conversion from imported traffic");
  }

  if (creator.duplicateUsername) {
    add(-6, "Duplicate username needs human campaign selection.");
    warnings.push("duplicate username");

    if (creator.duplicateBestCandidate) {
      warnings.push("appears strongest duplicate version");
    } else {
      add(-10, "Another campaign for this username appears stronger.");
      warnings.push(`stronger duplicate campaign appears to be ${creator.duplicateGroupBestCampaignId}`);
    }
  }

  if (creator.isWarmSocialDirectWinner) {
    add(-18, "Known warm social direct winner, but not proven for FreeOnlyFanz SEO.");
    warnings.push("warm social direct winner without FreeOnlyFanz SEO evidence");
  }

  return {
    score: Math.round(score * 100) / 100,
    warnings,
    scoringBreakdown,
  };
}

function chooseRecommendation(creator, analysis) {
  if (isPremiumOnlyCreator(creator)) {
    return "premium_hold";
  }

  const monetizationBucket = getMonetizationBucket(creator);
  const visits = toNumber(creator.visits);
  const subscribers = toNumber(creator.subscribers);
  const visitToSubscriberRate = toNumber(creator.visitToSubscriberRate);
  const revenuePerSubscriber = effectiveRevenuePerSubscriber(creator);
  const blockedCountryCount = toNumber(creator.blockedCountryCount);
  const imageCount = imagesCount(creator);
  const avatarExists = hasAvatar(creator);
  const lowFriction = Boolean(creator.isFree || creator.isFreeTrial || creator.hasActiveFreePromo || monetizationBucket === "cpl");
  const freeOrPromo = Boolean(creator.isFree || creator.isFreeTrial || creator.hasActiveFreePromo);
  const hasUsableImages = avatarExists && imageCount >= 3;
  const goodConversion = visits >= 50 && subscribers > 0 && visitToSubscriberRate >= THRESHOLDS.badVisitToSubscriberRate;
  const hardConversionFail =
    (visits >= THRESHOLDS.lowConversionVisits && subscribers === 0) ||
    (visits >= THRESHOLDS.badConversionVisits && visitToSubscriberRate < THRESHOLDS.badVisitToSubscriberRate);
  const hardAssetFail = !avatarExists && imageCount < 3;
  const hardBlockedFail = blockedCountryCount >= THRESHOLDS.tooManyBlockedCountries;
  const hasTrackingUrl = Boolean(creator.trackingUrl);
  const hasIdentity = Boolean(creator.username || creator.name || creator.onlyfansUrl);
  const strongStats = strongAccountStats(creator);
  const zeroTraffic = visits === 0 && subscribers === 0;
  const manualCuration = creator.manualCuration || {};
  const manuallyForcedFeatured = Boolean(manualCuration.forceFeatureNewInventory);

  if (creator.isWarmSocialDirectWinner) {
    return "keep_revshare_direct";
  }

  if (
    !manuallyForcedFeatured &&
    visits >= 300 &&
    subscribers >= 10 &&
    revenuePerSubscriber < THRESHOLDS.revshareMaybe
  ) {
    return "legacy_watch";
  }

  if (zeroTraffic) {
    if (creator.duplicateUsername && !creator.duplicateBestCandidate) {
      return "review_manually";
    }

    if (hardAssetFail || !hasTrackingUrl || !hasIdentity) {
      return "exclude_for_now";
    }

    if (freeOrPromo && hasUsableImages && blockedCountryCount < THRESHOLDS.tooManyBlockedCountries) {
      return monetizationBucket === "revshare" ? "test_revshare_free_trial" : "test_new_inventory";
    }

    return "review_manually";
  }

  if (hardBlockedFail || hardAssetFail || hardConversionFail) {
    return analysis.score <= 18 ? "exclude_for_now" : "review_manually";
  }

  if (creator.duplicateUsername && !creator.duplicateBestCandidate) {
    return "review_manually";
  }

  if (
    lowFriction &&
    hasUsableImages &&
    blockedCountryCount < THRESHOLDS.tooManyBlockedCountries &&
    (goodConversion || (monetizationBucket === "cpl" && strongStats)) &&
    analysis.score >= 45
  ) {
    return "feature_now";
  }

  if (
    lowFriction &&
    hasUsableImages &&
    blockedCountryCount < THRESHOLDS.tooManyBlockedCountries &&
    (monetizationBucket === "cpl" || creator.isFreeTrial || creator.hasActiveFreePromo || creator.isFree) &&
    analysis.score >= 24
  ) {
    if (monetizationBucket === "cpl") {
      return "test_cpl";
    }

    if (monetizationBucket === "revshare" && freeOrPromo) {
      return "test_revshare_free_trial";
    }

    return "test_new_inventory";
  }

  if (monetizationBucket === "revshare" && revenuePerSubscriber >= THRESHOLDS.revshareKeeper) {
    return "keep_revshare";
  }

  if (creator.duplicateUsername || monetizationBucket === "unknown" || analysis.score >= 10) {
    return "review_manually";
  }

  return "exclude_for_now";
}

function hasStrongerHomepageRecommendation(recommendation) {
  return ["feature_new_inventory", "feature_now", "feature_revshare"].includes(recommendation);
}

function applyManualRecommendationOverrides(creator, recommendation, warnings) {
  const manualCuration = creator.manualCuration || {};
  let finalRecommendation = recommendation;
  let manualPriority =
    creator.manualPriority !== null && creator.manualPriority !== undefined && creator.manualPriority !== ""
      ? toNumber(creator.manualPriority)
      : null;
  const finalWarnings = [...warnings];

  if (manualCuration.forceExclude) {
    finalRecommendation = "exclude_for_now";
    manualPriority = null;
    finalWarnings.push("manually excluded from FreeOnlyFanz placement");
  } else if (recommendation === "premium_hold") {
    finalRecommendation = "premium_hold";
    manualPriority = null;
    finalWarnings.push("premium-only creator held out of public FreeOnlyFanz pages");
  } else if (manualCuration.forceFeatureNewInventory) {
    finalRecommendation = "feature_new_inventory";
    manualPriority = 90;
    finalWarnings.push("manually selected new inventory for FreeOnlyFanz test placement");
  } else if (manualCuration.forceHomepageTest && !hasStrongerHomepageRecommendation(finalRecommendation)) {
    finalRecommendation = "test_new_inventory";
    finalWarnings.push("manually selected for FreeOnlyFanz homepage test");
  }

  return {
    recommendation: finalRecommendation,
    manualPriority,
    warnings: uniqueNonEmptyStrings(finalWarnings),
  };
}

function assignTrafficSource(creator, recommendation) {
  if (recommendation === "premium_hold") {
    return "premium_hold";
  }

  if (recommendation === "keep_revshare_direct") {
    return "warm_social_direct";
  }

  if (recommendation === "feature_now") {
    return "seo_site";
  }

  if (
    [
      "feature_new_inventory",
      "feature_revshare",
      "test_new_inventory",
      "test_revshare_free_trial",
      "test_cpl",
      "new_cpl_candidate",
    ].includes(recommendation)
  ) {
    return "seo_site_test";
  }

  if (recommendation === "keep_revshare") {
    return "seo_site_test";
  }

  if (recommendation === "legacy_watch") {
    return "seo_site_watch";
  }

  if (creator.isWarmSocialDirectWinner) {
    return "direct_only";
  }

  return creator.recommendedTrafficSource && creator.recommendedTrafficSource !== "unknown"
    ? creator.recommendedTrafficSource
    : "unknown";
}

function priorityFromScore(score, min, max, divisor = 6) {
  const spread = max - min;
  const scaled = Math.floor(Math.max(0, toNumber(score)) / divisor);
  return Math.min(max, min + Math.min(spread, scaled));
}

function computeHomepagePriority(creator, recommendation, score) {
  if (recommendation === "exclude_for_now" || recommendation === "premium_hold") {
    return 0;
  }

  const manualPriority = toNumber(creator.manualPriority);
  if (manualPriority > 0) {
    return manualPriority;
  }

  if (recommendation === "feature_new_inventory") {
    return 90;
  }
  if (recommendation === "feature_now" || recommendation === "feature_revshare") {
    return priorityFromScore(score, 80, 89, 8);
  }
  if (recommendation === "test_new_inventory" || recommendation === "test_revshare_free_trial") {
    return priorityFromScore(score, 65, 79, 5);
  }
  if (recommendation === "new_cpl_candidate" || recommendation === "test_cpl") {
    return priorityFromScore(score, 55, 70, 5);
  }
  if (recommendation === "keep_revshare_direct") {
    return priorityFromScore(score, 50, 60, 10);
  }
  if (recommendation === "legacy_watch") {
    return priorityFromScore(score, 35, 50, 7);
  }
  if (recommendation === "review_manually") {
    return priorityFromScore(score, 20, 40, 5);
  }

  return 0;
}

function analyzeCreator(creator) {
  const analysis = scoreCreator(creator);
  const manualResult = applyManualRecommendationOverrides(
    creator,
    chooseRecommendation(creator, analysis),
    analysis.warnings
  );
  const recommendation = manualResult.recommendation;
  const recommendedTrafficSource = assignTrafficSource(creator, recommendation);
  const monetizationBucket = getMonetizationBucket(creator);
  const coldCandidate =
    [
      "feature_new_inventory",
      "feature_now",
      "feature_revshare",
      "test_new_inventory",
      "test_revshare_free_trial",
      "test_cpl",
      "new_cpl_candidate",
    ].includes(recommendation) &&
    (monetizationBucket === "cpl" || creator.isFreeTrial || creator.hasActiveFreePromo || creator.isFree);
  const homepagePriority = computeHomepagePriority(
    {
      ...creator,
      manualPriority: manualResult.manualPriority,
    },
    recommendation,
    analysis.score
  );

  return {
    ...creator,
    isPremiumOnly: isPremiumOnlyCreator(creator),
    monetizationBucket,
    recommendedTrafficSource,
    isSiteSeoTestCandidate: [
      "feature_new_inventory",
      "feature_now",
      "feature_revshare",
      "test_new_inventory",
      "test_revshare_free_trial",
      "test_cpl",
      "new_cpl_candidate",
      "keep_revshare",
    ].includes(recommendation),
    isColdTrafficTestCandidate: coldCandidate,
    imagesCount: imagesCount(creator),
    score: analysis.score,
    manualPriority: manualResult.manualPriority,
    homepagePriority,
    recommendation,
    warnings: manualResult.warnings,
    scoringBreakdown: analysis.scoringBreakdown,
  };
}

function summarize(creators) {
  const uniqueUsernames = new Set(creators.map((creator) => normalizeUsername(creator.username)).filter(Boolean));
  const duplicateUsernames = new Set(
    creators
      .filter((creator) => creator.duplicateUsername)
      .map((creator) => normalizeUsername(creator.username))
      .filter(Boolean)
  );
  const earningsSources = creators.reduce((counts, creator) => {
    const source = creator.earningsSource || "none";
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});

  return {
    totalCreators: creators.length,
    uniqueUsernames: uniqueUsernames.size,
    duplicateUsernames: duplicateUsernames.size,
    featureNewInventoryCount: creators.filter((creator) => creator.recommendation === "feature_new_inventory").length,
    featureNowCount: creators.filter((creator) => creator.recommendation === "feature_now").length,
    featureRevshareCount: creators.filter((creator) => creator.recommendation === "feature_revshare").length,
    testNewInventoryCount: creators.filter((creator) => creator.recommendation === "test_new_inventory").length,
    testRevshareFreeTrialCount: creators.filter((creator) => creator.recommendation === "test_revshare_free_trial").length,
    newCplCandidateCount: creators.filter((creator) => creator.recommendation === "new_cpl_candidate").length,
    testCplCount: creators.filter((creator) => creator.recommendation === "test_cpl").length,
    legacyWatchCount: creators.filter((creator) => creator.recommendation === "legacy_watch").length,
    keepRevshareCount: creators.filter((creator) => creator.recommendation === "keep_revshare").length,
    keepRevshareDirectCount: creators.filter((creator) => creator.recommendation === "keep_revshare_direct").length,
    premiumHoldCount: creators.filter((creator) => creator.recommendation === "premium_hold").length,
    reviewManuallyCount: creators.filter((creator) => creator.recommendation === "review_manually").length,
    excludeForNowCount: creators.filter((creator) => creator.recommendation === "exclude_for_now").length,
    premiumOnlyCount: creators.filter((creator) => creator.isPremiumOnly).length,
    publicEligibleCount: creators.filter((creator) => creator.publicEligible).length,
    hiddenReasons: creators.reduce((counts, creator) => {
      const reason = creator.hiddenReason || "";
      if (reason) {
        counts[reason] = (counts[reason] || 0) + 1;
      }
      return counts;
    }, {}),
    earningsSources,
  };
}

function recommendationRank(recommendation) {
  const order = {
    feature_new_inventory: 1,
    feature_now: 2,
    feature_revshare: 3,
    test_new_inventory: 4,
    test_revshare_free_trial: 5,
    new_cpl_candidate: 6,
    test_cpl: 7,
    keep_revshare: 8,
    keep_revshare_direct: 9,
    legacy_watch: 10,
    premium_hold: 11,
    review_manually: 12,
    exclude_for_now: 13,
  };

  return order[recommendation] || 99;
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = Array.isArray(value) ? value.join("; ") : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function toCsvRow(creator) {
  const values = {
    ...creator,
    warnings: creator.warnings.join("; "),
  };

  return CSV_COLUMNS.map((column) => csvEscape(values[column])).join(",");
}

async function readCreators() {
  try {
    const raw = await fs.readFile(CREATORS_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("data/creators.json not found. Run npm run import:onlytraffic first.");
    }
    throw error;
  }
}

function getImportedUsernameSet(importedCreators) {
  return new Set(
    importedCreators
      .map((creator) => normalizeUsername(creator.username || creator.slug || creator.onlyfansUrl))
      .filter(Boolean)
  );
}

function pruneManualCurationToImport(raw, importedCreators) {
  const data = raw && typeof raw === "object" ? raw : DEFAULT_MANUAL_CURATION;
  const importedUsernames = getImportedUsernameSet(importedCreators);
  const keepUsername = (username) => importedUsernames.has(normalizeUsername(username));

  const forceFeatureNewInventory = (data.forceFeatureNewInventory || []).filter(keepUsername);
  const forceHomepageTest = (data.forceHomepageTest || []).filter(keepUsername);
  const forceExclude = (data.forceExclude || []).filter(keepUsername);
  const trafficWeights = Object.fromEntries(
    Object.entries(data.trafficWeights || {}).filter(([username]) => keepUsername(username))
  );
  const notes = Object.fromEntries(
    Object.entries(data.notes || {}).filter(([username]) => keepUsername(username))
  );

  return {
    forceFeatureNewInventory,
    forceHomepageTest,
    forceExclude,
    trafficWeights,
    notes,
  };
}

async function readManualCuration(importedCreators = []) {
  let raw = DEFAULT_MANUAL_CURATION;

  try {
    raw = JSON.parse(await fs.readFile(MANUAL_CURATION_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const pruned = pruneManualCurationToImport(raw, importedCreators);
  const removedFeatured = (raw.forceFeatureNewInventory || []).filter(
    (username) => !pruned.forceFeatureNewInventory.includes(username)
  );

  if (JSON.stringify(pruned) !== JSON.stringify(raw)) {
    await fs.mkdir(path.dirname(MANUAL_CURATION_PATH), { recursive: true });
    await fs.writeFile(MANUAL_CURATION_PATH, `${JSON.stringify(pruned, null, 2)}\n`, "utf8");
  }

  if (removedFeatured.length > 0) {
    console.log(`Removed featured entries not in API import: ${removedFeatured.join(", ")}`);
  }

  return normalizeManualCuration(pruned);
}

function normalizeLoadedTransactions(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === "object");
  }

  if (value && typeof value === "object" && Array.isArray(value.transactions)) {
    return value.transactions.filter((item) => item && typeof item === "object");
  }

  return [];
}

async function readTransactionsIfExists() {
  try {
    const raw = await fs.readFile(RAW_TRANSACTIONS_PATH, "utf8");
    return {
      exists: true,
      transactions: normalizeLoadedTransactions(JSON.parse(raw)),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        exists: false,
        transactions: [],
      };
    }
    throw error;
  }
}

async function writeReports(creators, earningsStats) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    summary: summarize(creators),
    earnings: earningsStats,
    creators,
  };

  const csv = [CSV_COLUMNS.join(","), ...creators.map(toCsvRow)].join("\n");

  await fs.writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(CSV_REPORT_PATH, `${csv}\n`, "utf8");

  return report;
}

async function main() {
  const { getPublicEligibilityDetails } = await import("../src/lib/creators.mjs");
  const importedCreators = await readCreators();
  const manualCuration = await readManualCuration(importedCreators);
  const transactionsData = await readTransactionsIfExists();
  const earnings = attachTransactionEarnings(importedCreators, transactionsData);
  const creators = earnings.creators.map(applyManualOverrides).map((creator) => applyManualCurationFields(creator, manualCuration));
  markStrongestDuplicates(creators);

  const analyzedCreators = creators
    .map(analyzeCreator)
    .map((creator) => ({
      ...creator,
      ...getPublicEligibilityDetails(creator),
    }))
    .sort(
      (a, b) =>
        toNumber(b.homepagePriority) - toNumber(a.homepagePriority) ||
        recommendationRank(a.recommendation) - recommendationRank(b.recommendation) ||
        b.score - a.score
    );

  const report = await writeReports(analyzedCreators, earnings.stats);
  const earningsSources = report.summary.earningsSources;

  console.log("Offer analysis complete.");
  console.log(
    `Earnings source mode: ${earnings.stats.transactionsFileFound ? "transactions" : "campaign_commission_data fallback"}`
  );
  console.log(
    `Earnings source counts: transactions=${earningsSources.transactions || 0}, campaign_commission_data=${
      earningsSources.campaign_commission_data || 0
    }, none=${earningsSources.none || 0}`
  );
  if (earnings.stats.transactionsFileFound) {
    console.log(
      `Transactions matched to creators: ${earnings.stats.matchedTransactions}/${earnings.stats.totalTransactions}`
    );
  }
  console.log(`feature_new_inventory: ${report.summary.featureNewInventoryCount}`);
  console.log(`feature_now: ${report.summary.featureNowCount}`);
  console.log(`feature_revshare: ${report.summary.featureRevshareCount}`);
  console.log(`test_new_inventory: ${report.summary.testNewInventoryCount}`);
  console.log(`test_revshare_free_trial: ${report.summary.testRevshareFreeTrialCount}`);
  console.log(`new_cpl_candidate: ${report.summary.newCplCandidateCount}`);
  console.log(`test_cpl: ${report.summary.testCplCount}`);
  console.log(`legacy_watch: ${report.summary.legacyWatchCount}`);
  console.log(`keep_revshare: ${report.summary.keepRevshareCount}`);
  console.log(`keep_revshare_direct: ${report.summary.keepRevshareDirectCount}`);
  console.log(`premium_hold: ${report.summary.premiumHoldCount}`);
  console.log(`review_manually: ${report.summary.reviewManuallyCount}`);
  console.log(`exclude_for_now: ${report.summary.excludeForNowCount}`);
  console.log(`public eligible: ${report.summary.publicEligibleCount}`);
  console.log(`premium-only hidden: ${report.summary.premiumOnlyCount}`);
  console.log(`JSON report saved to: ${path.relative(ROOT, JSON_REPORT_PATH)}`);
  console.log(`CSV report saved to: ${path.relative(ROOT, CSV_REPORT_PATH)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
