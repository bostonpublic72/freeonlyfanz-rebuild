require("dotenv").config({ quiet: true });

const fs = require("fs/promises");
const path = require("path");
const slugify = require("slugify");

const API_URL = "https://partner.onlytraffic.com/api/marketer?do=campaigns";
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const REPORTS_DIR = path.join(ROOT, "data", "reports");
const RAW_CAMPAIGNS_PATH = path.join(RAW_DIR, "onlytraffic-campaigns.json");
const IMPORT_META_PATH = path.join(RAW_DIR, "import-meta.json");
const CREATORS_PATH = path.join(ROOT, "data", "creators.json");

async function ensureProjectFolders() {
  const folders = [
    path.join(ROOT, "data"),
    RAW_DIR,
    REPORTS_DIR,
    path.join(ROOT, "scripts"),
    path.join(ROOT, "public"),
    path.join(ROOT, "public", "images"),
    path.join(ROOT, "public", "images", "creators"),
    path.join(ROOT, "src"),
    path.join(ROOT, "docs"),
  ];

  await Promise.all(folders.map((folder) => fs.mkdir(folder, { recursive: true })));
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

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const normalized = String(value)
    .replace(/,/g, "")
    .replace(/[$%]/g, "")
    .trim();
  const parsed = Number.parseFloat(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (["true", "1", "yes", "y", "active", "finished", "ended"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "inactive", "unfinished", "not_finished", "open"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function asArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    return trimmed
      .split(/[,|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.values(value);
  }

  return [];
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    const normalized = String(value).trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function decodeHtmlEntities(text) {
  if (!text) {
    return "";
  }

  const namedEntities = {
    amp: "&",
    apos: "'",
    copy: "(c)",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    reg: "(r)",
  };

  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();

    if (key[0] === "#") {
      const isHex = key[1] === "x";
      const codePoint = Number.parseInt(isHex ? key.slice(2) : key.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch (_error) {
          return "";
        }
      }
    }

    return namedEntities[key] || match;
  });
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function removeBoilerplate(text) {
  const patterns = [
    /copyright\s+(?:notice|warning)[\s\S]{0,700}(?=(?:\n|$))/gi,
    /all\s+(?:content|material|images|videos|media)[^.]{0,240}(?:copyright|protected|reserved)[^.]*\.?/gi,
    /(?:reproduction|redistribution|recording|screen\s*recording|sharing)[^.]{0,240}(?:prohibited|forbidden|illegal|not allowed)[^.]*\.?/gi,
    /violators?\s+(?:will|may)[^.]{0,180}\.?/gi,
    /by\s+subscribing[^.]{0,240}(?:terms|conditions|agree)[^.]*\.?/gi,
    /dmca[^.]{0,140}\.?/gi,
    /all\s+rights\s+reserved\.?/gi,
  ];

  return patterns.reduce((current, pattern) => current.replace(pattern, " "), text);
}

function truncateAtWord(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  const sliced = text.slice(0, maxLength - 3).replace(/\s+\S*$/, "").trim();
  return `${sliced || text.slice(0, maxLength - 3).trim()}...`;
}

function cleanBio(rawAboutHtml) {
  const plain = removeBoilerplate(decodeHtmlEntities(stripHtml(rawAboutHtml)))
    .replace(/\s+/g, " ")
    .trim();

  return truncateAtWord(plain, 280);
}

function normalizeUsername(value) {
  if (!value) {
    return "";
  }

  let username = String(value).trim();

  try {
    if (/^https?:\/\//i.test(username)) {
      const url = new URL(username);
      username = url.pathname.split("/").filter(Boolean)[0] || username;
    }
  } catch (_error) {
    // Fall through to text cleanup.
  }

  username = username
    .replace(/^@+/, "")
    .replace(/^onlyfans\.com\//i, "")
    .split(/[?#]/)[0]
    .trim()
    .toLowerCase();

  return username;
}

function normalizeOfferType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized.includes("free_trial") || normalized.includes("trial")) {
    return "free_trial";
  }
  if (normalized.includes("free")) {
    return "free";
  }
  if (normalized.includes("paid")) {
    return "paid";
  }
  if (normalized.includes("cpl") || normalized.includes("lead")) {
    return "cpl";
  }

  return normalized || "unknown";
}

function getMonetizationBucket(commissionType, offerType) {
  const text = `${commissionType || ""} ${offerType || ""}`.toLowerCase();

  if (/(rev\s*share|revshare|revenue\s*share)/i.test(text)) {
    return "revshare";
  }

  if (/(cpl|cpa|lead|subscription|fixed|payout|cost\s*per\s*lead)/i.test(text)) {
    return "cpl";
  }

  return "unknown";
}

function extractUrl(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "object") {
    return (
      pick(value, ["url", "src", "href", "original", "path", "image", "image_url", "imageUrl"], "") || ""
    );
  }

  return "";
}

function collectImages(campaign, account) {
  const buckets = [
    account.images,
    account.photos,
    account.demo_content,
    account.demo_images,
    account.demoImages,
    account.demoContent,
    account.preview_images,
    account.previewImages,
    account.gallery,
    account.media,
    campaign.images,
    campaign.demo_content,
    campaign.demo_images,
    campaign.demoImages,
    campaign.demoContent,
    campaign.creatives,
  ];

  const urls = [];
  for (const bucket of buckets) {
    for (const item of asArray(bucket)) {
      const url = extractUrl(item);
      if (url) {
        urls.push(url);
      }
    }
  }

  return uniqueStrings(urls);
}

function normalizePromotions(account) {
  const rawPromotions = asArray(
    pick(account, [
      "promotions",
      "promo",
      "active_promotions",
      "activePromotions",
      "subscription_promotions",
      "subscriptionPromotions",
    ])
  );

  return rawPromotions.map((promo) => {
    if (typeof promo !== "object" || promo === null) {
      return {
        price: toNumberOrNull(promo),
        isFinished: false,
      };
    }

    return {
      id: pick(promo, ["id", "promotion_id", "promotionId"], undefined),
      price: toNumberOrNull(pick(promo, ["price", "promo_price", "promoPrice", "discount_price", "discountPrice"])),
      isFinished: toBoolean(pick(promo, ["isFinished", "is_finished", "finished", "is_finished_bool", "ended"]), false),
      dateStart: pick(promo, ["date_start", "dateStart", "start_date", "startDate"], null),
      dateEnd: pick(promo, ["date_end", "dateEnd", "end_date", "endDate"], null),
    };
  });
}

function collectBlockedCountries(campaign, account) {
  const countries = asArray(
    pick(account, [
      "blocked_countries",
      "blockedCountries",
      "blocked_country_codes",
      "blockedCountryCodes",
      "blacklist_countries",
    ]) ||
      pick(campaign, ["blocked_countries", "blockedCountries", "blocked_country_codes", "blockedCountryCodes"])
  );

  return uniqueStrings(
    countries.map((country) => {
      if (typeof country === "object" && country !== null) {
        return pick(country, ["code", "country_code", "countryCode", "name", "title"], "");
      }
      return country;
    })
  );
}

function makeSlug(username, name, campaignId) {
  const base = username || name || `campaign-${campaignId || "unknown"}`;
  return slugify(base, {
    lower: true,
    strict: true,
    trim: true,
  });
}

function normalizeCreator(campaign) {
  const account = pick(campaign, ["onlyfans_account", "onlyfansAccount", "account", "creator", "performer"], {}) || {};
  const publicAccount = pick(campaign, ["public_account", "publicAccount"], {}) || {};
  const accountData = { ...publicAccount, ...account };

  const campaignId = pick(campaign, ["campaignId", "campaign_id", "id", "campaign.id"], "");
  const publicId = pick(campaign, ["publicId", "public_id", "public.id", "hash"], "");
  const offerId = pick(
    campaign,
    ["offerId", "offer_id", "offer.id", "commission_data.offer_id", "commissionData.offerId"],
    ""
  );
  const campaignName = pick(campaign, ["campaignName", "campaign_name", "name", "title"], "");
  const commissionType = String(
    pick(campaign, [
      "commissionType",
      "commission_type",
      "commission.type",
      "payoutType",
      "payout_type",
      "paymentType",
      "payment_type",
    ], "")
  );
  const offerType = normalizeOfferType(
    pick(campaign, ["offerType", "offer_type", "offer.type", "type", "category"], "")
  );
  const trackingUrl = extractUrl(
    pick(campaign, [
      "trackingUrl",
      "tracking_url",
      "affiliateUrl",
      "affiliate_url",
      "tracking_link",
      "trackingLink",
      "url",
    ])
  );
  const onlyfansUrl = extractUrl(
    pick(campaign, [
      "onlyfansUrl",
      "onlyfans_url",
      "onlyfansAccountUrl",
      "onlyfans_account_url",
      "account.url",
      "account.onlyfans_url",
      "onlyfans_account.url",
      "onlyfans_account.onlyfans_url",
    ]) || pick(accountData, ["url", "onlyfans_url", "onlyfansUrl", "link"], "")
  );
  const onlyfansId = pick(campaign, ["onlyfansId", "onlyfans_id"], "") || pick(accountData, ["onlyfansId", "onlyfans_id", "id"], "");

  const username = normalizeUsername(
    pick(accountData, ["username", "user_name", "onlyfans_username", "screen_name", "slug"], "") ||
      pick(campaign, ["username", "onlyfans_username", "onlyfansUsername"], "") ||
      onlyfansUrl
  );
  const name = String(
    pick(accountData, ["name", "display_name", "displayName", "title"], "") ||
      pick(campaign, ["creator_name", "creatorName"], "") ||
      campaignName ||
      username
  ).trim();
  const rawAboutHtml = String(pick(accountData, ["about", "bio", "description"], "") || "");
  const avatarOriginal = extractUrl(
    pick(accountData, [
      "avatar",
      "avatar_original",
      "avatarOriginal",
      "avatar_url",
      "avatarUrl",
      "photo",
      "image",
      "profile_image",
      "profileImage",
    ])
  );
  const avatarThumbnail = extractUrl(
    pick(accountData, ["avatar_thumbnail", "avatarThumbnail", "avatar_thumb", "avatarThumb", "thumb", "thumbnail"])
  );
  const avatarThumbnail640 = extractUrl(
    pick(accountData, ["avatar_thumbnail_640", "avatarThumbnail640", "avatar_640", "avatar640", "thumbnail_640"])
  );
  const images = collectImages(campaign, accountData);

  const regularPrice = toNumberOrNull(
    pick(accountData, [
      "regularPrice",
      "regular_price",
      "subscribe_price",
      "subscribePrice",
      "subscription_price",
      "subscriptionPrice",
      "price",
    ])
  );
  const promotions = normalizePromotions(accountData);
  const hasActiveFreePromo = promotions.some((promo) => promo.price === 0 && promo.isFinished === false);
  const isFree = regularPrice === 0 || hasActiveFreePromo;
  const isFreeTrial = offerType === "free_trial";

  const visits = toNumber(pick(campaign, ["visits", "visit_count", "visitCount", "clicks", "stats.visits", "stats.clicks"], 0));
  const subscribers = toNumber(
    pick(campaign, ["subscribers", "subscriber_count", "subscriberCount", "leads", "conversions", "stats.subscribers"], 0)
  );
  const subscribersToday = toNumber(
    pick(campaign, ["subscribersToday", "subscribers_today", "leads_today", "conversions_today", "stats.subscribersToday"], 0)
  );
  const commissionIncome = toNumber(
    pick(campaign, ["commissionIncome", "commission_income", "income", "earnings", "stats.income", "stats.commissionIncome"], 0)
  );
  const commissionIncomeToday = toNumber(
    pick(campaign, ["commissionIncomeToday", "commission_income_today", "income_today", "earnings_today", "stats.incomeToday"], 0)
  );
  const commissionRevenue = toNumber(
    pick(campaign, ["commissionRevenue", "commission_revenue", "revenue", "gross_revenue", "stats.revenue"], 0)
  );

  const visitToSubscriberRate = visits > 0 ? subscribers / visits : 0;
  const revenuePerSubscriber = subscribers > 0 ? commissionIncome / subscribers : 0;
  const revenuePerVisit = visits > 0 ? commissionIncome / visits : 0;
  const blockedCountries = collectBlockedCountries(campaign, accountData);
  const monetizationBucket = getMonetizationBucket(commissionType, offerType);

  return {
    campaignId,
    publicId,
    offerId,
    campaignName,
    commissionType,
    commissionIncome,
    commissionIncomeToday,
    commissionRevenue,
    offerType,
    monetizationBucket,
    trackingUrl,
    onlyfansUrl,
    onlyfansId,

    name,
    username,
    slug: makeSlug(username, name, campaignId),
    bio: cleanBio(rawAboutHtml),
    rawAboutHtml,

    avatarOriginal,
    avatarThumbnail,
    avatarThumbnail640,
    images,

    tags: uniqueStrings(asArray(pick(accountData, ["tags", "categories", "niches"]))),
    campaignTags: uniqueStrings(asArray(pick(campaign, ["tags", "campaignTags", "campaign_tags", "categories"]))),

    regularPrice,
    promotions,
    isFree,
    isFreeTrial,
    hasActiveFreePromo,

    visits,
    subscribers,
    subscribersToday,
    visitToSubscriberRate,
    revenuePerSubscriber,
    revenuePerVisit,

    likesCount: toNumber(pick(accountData, ["likesCount", "likes_count", "likes", "favoritedCount"], 0)),
    postsCount: toNumber(pick(accountData, ["postsCount", "posts_count", "posts"], 0)),
    photosCount: toNumber(pick(accountData, ["photosCount", "photos_count", "photos"], 0)),
    videosCount: toNumber(pick(accountData, ["videosCount", "videos_count", "videos"], 0)),
    performerTop: pick(accountData, ["performerTop", "performer_top", "top", "top_percent", "topPercent"], null),

    blockedCountries,
    blockedCountryCount: blockedCountries.length,

    dateCreate: pick(campaign, ["dateCreate", "date_create", "created_at", "createdAt"], null),
    dateUpdate: pick(campaign, ["dateUpdate", "date_update", "updated_at", "updatedAt"], null),

    source: "onlytraffic",
    trafficSourceNotes: "OnlyTraffic campaign import. Evaluate FreeOnlyFanz SEO, TwerkQueens cold traffic, and warm direct social traffic separately.",
    provenSource: "unknown",
    recommendedTrafficSource: "unknown",

    isWarmSocialDirectWinner: false,
    isSiteSeoTestCandidate: false,
    isColdTrafficTestCandidate: false,

    manualPriority: null,
    manualNotes: "",

    duplicateUsername: false,
    duplicateGroupId: null,
  };
}

function applyDuplicateMarkers(creators) {
  const groups = new Map();

  for (const creator of creators) {
    const key = creator.username || `campaign:${creator.campaignId || creator.publicId || creator.slug}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(creator);
  }

  for (const [username, group] of groups.entries()) {
    if (!username || username.startsWith("campaign:") || group.length < 2) {
      continue;
    }

    const duplicateGroupId = `username:${makeSlug(username, username, "")}`;
    for (const creator of group) {
      creator.duplicateUsername = true;
      creator.duplicateGroupId = duplicateGroupId;
    }
  }
}

function extractCampaigns(payload) {
  const directCandidates = [
    payload,
    payload && payload.data,
    payload && payload.campaigns,
    payload && payload.items,
    payload && payload.results,
    payload && payload.result,
    payload && payload.data && payload.data.campaigns,
    payload && payload.data && payload.data.items,
    payload && payload.data && payload.data.results,
    payload && payload.response && payload.response.campaigns,
    payload && payload.response && payload.response.data,
  ];

  for (const candidate of directCandidates) {
    const array = normalizeCampaignCollection(candidate);
    if (array) {
      return array;
    }
  }

  return findFirstCampaignArray(payload) || [];
}

function normalizeCampaignCollection(candidate) {
  if (!candidate) {
    return null;
  }

  if (Array.isArray(candidate)) {
    return candidate.filter((item) => item && typeof item === "object");
  }

  if (typeof candidate === "object") {
    const values = Object.values(candidate);
    const looksLikeRecordMap =
      values.length > 0 &&
      values.every((item) => item && typeof item === "object" && !Array.isArray(item)) &&
      values.some((item) =>
        ["id", "campaign_id", "campaignId", "onlyfans_account", "onlyfansAccount", "commission_type"].some((key) => key in item)
      );

    if (looksLikeRecordMap) {
      return values;
    }
  }

  return null;
}

function findFirstCampaignArray(value, depth = 0) {
  if (!value || depth > 4) {
    return null;
  }

  const normalized = normalizeCampaignCollection(value);
  if (normalized && normalized.length > 0) {
    return normalized;
  }

  if (typeof value !== "object") {
    return null;
  }

  for (const child of Object.values(value)) {
    const result = findFirstCampaignArray(child, depth + 1);
    if (result) {
      return result;
    }
  }

  return null;
}

function statusLooksSuccessful(payload) {
  if (!payload || typeof payload !== "object" || !("status" in payload)) {
    return true;
  }

  const status = String(payload.status).toLowerCase();
  return ["ok", "success", "successful", "true", "1"].includes(status);
}

function errorLooksLikeLimit(error) {
  return /limit|per_page|page size|too many|maximum/i.test(error.message || "");
}

function getPayloadMessage(payload) {
  return (
    pick(payload, ["message", "error", "errors.0", "data.message", "data.error"], "") ||
    "OnlyTraffic returned an error status."
  );
}

async function requestCampaignPage({ apiKey, authMode, limit, offset }) {
  const form = new URLSearchParams();
  form.set("limit", String(limit));
  form.set("offset", String(offset));
  form.set("onlyfans_id", "");
  form.set("offer_id", "");

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (authMode === "authorization_header") {
    headers.Authorization = apiKey;
  } else {
    form.set("api_auth_key", apiKey);
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers,
    body: form,
  });

  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`OnlyTraffic returned non-JSON response (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok || !statusLooksSuccessful(payload)) {
    throw new Error(`OnlyTraffic API error (${response.status}): ${getPayloadMessage(payload)}`);
  }

  return {
    payload,
    campaigns: extractCampaigns(payload),
  };
}

async function chooseWorkingImportMode(apiKey) {
  const attempts = [
    { authMode: "authorization_header", limit: 100 },
    { authMode: "authorization_header", limit: 10 },
    { authMode: "api_auth_key_body", limit: 100 },
    { authMode: "api_auth_key_body", limit: 10 },
  ];
  let lastError;

  for (const attempt of attempts) {
    if (lastError && attempt.limit === 10 && !errorLooksLikeLimit(lastError) && attempt.authMode === "authorization_header") {
      continue;
    }

    try {
      const result = await requestCampaignPage({
        apiKey,
        authMode: attempt.authMode,
        limit: attempt.limit,
        offset: 0,
      });
      return {
        ...attempt,
        firstPage: result.campaigns,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to connect to OnlyTraffic.");
}

function pageSignature(campaigns) {
  return JSON.stringify(
    campaigns.map((campaign) => pick(campaign, ["campaignId", "campaign_id", "id", "publicId", "public_id"], "")).slice(0, 20)
  );
}

async function importCampaigns(apiKey) {
  const mode = await chooseWorkingImportMode(apiKey);
  const campaigns = [...mode.firstPage];
  const seenPages = new Set([pageSignature(mode.firstPage)]);
  let offset = mode.firstPage.length;

  while (mode.firstPage.length > 0) {
    const page = await requestCampaignPage({
      apiKey,
      authMode: mode.authMode,
      limit: mode.limit,
      offset,
    });

    if (page.campaigns.length === 0) {
      break;
    }

    const signature = pageSignature(page.campaigns);
    if (seenPages.has(signature)) {
      console.warn("OnlyTraffic returned a repeated page; stopping pagination to avoid duplicate looping.");
      break;
    }

    seenPages.add(signature);
    campaigns.push(...page.campaigns);
    offset += page.campaigns.length;
  }

  return {
    campaigns,
    limitUsed: mode.limit,
    authModeUsed: mode.authMode,
  };
}

function buildMetadata(creators, limitUsed, authModeUsed) {
  const usernameCounts = new Map();
  for (const creator of creators) {
    if (!creator.username) {
      continue;
    }
    usernameCounts.set(creator.username, (usernameCounts.get(creator.username) || 0) + 1);
  }

  const duplicateUsernameList = [...usernameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([username]) => username)
    .sort();

  return {
    importedAt: new Date().toISOString(),
    totalCampaigns: creators.length,
    limitUsed,
    authModeUsed,
    uniqueUsernames: usernameCounts.size,
    duplicateUsernames: duplicateUsernameList.length,
    duplicateUsernameList,
    revshareCount: creators.filter((creator) => creator.monetizationBucket === "revshare").length,
    cplCount: creators.filter((creator) => creator.monetizationBucket === "cpl").length,
    freeCount: creators.filter((creator) => creator.isFree).length,
    freeTrialCount: creators.filter((creator) => creator.isFreeTrial).length,
  };
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  await ensureProjectFolders();

  const apiKey = process.env.ONLYTRAFFIC_API_KEY;
  if (!apiKey) {
    throw new Error("ONLYTRAFFIC_API_KEY is missing. Add it to .env before running the importer.");
  }

  const { campaigns, limitUsed, authModeUsed } = await importCampaigns(apiKey);
  const creators = campaigns.map(normalizeCreator);
  applyDuplicateMarkers(creators);

  const metadata = buildMetadata(creators, limitUsed, authModeUsed);

  await writeJson(RAW_CAMPAIGNS_PATH, campaigns);
  await writeJson(IMPORT_META_PATH, metadata);
  await writeJson(CREATORS_PATH, creators);

  console.log("OnlyTraffic import complete.");
  console.log(`Total campaigns imported: ${metadata.totalCampaigns}`);
  console.log(`Total unique usernames: ${metadata.uniqueUsernames}`);
  console.log(`Duplicate usernames found: ${metadata.duplicateUsernames}`);
  console.log(`Revshare count: ${metadata.revshareCount}`);
  console.log(`CPL count: ${metadata.cplCount}`);
  console.log(`Free count: ${metadata.freeCount}`);
  console.log(`Free trial count: ${metadata.freeTrialCount}`);
  console.log(`Raw data saved to: ${path.relative(ROOT, RAW_CAMPAIGNS_PATH)}`);
  console.log(`Normalized creators saved to: ${path.relative(ROOT, CREATORS_PATH)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
