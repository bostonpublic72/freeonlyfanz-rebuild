require("dotenv").config({ quiet: true });

const fs = require("fs/promises");
const path = require("path");

const API_URL = "https://partner.onlytraffic.com/api/marketer?do=transactions";
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const RAW_TRANSACTIONS_PATH = path.join(RAW_DIR, "onlytraffic-transactions.json");
const TRANSACTIONS_META_PATH = path.join(RAW_DIR, "transactions-meta.json");

async function ensureProjectFolders() {
  await fs.mkdir(RAW_DIR, { recursive: true });
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

function statusLooksSuccessful(payload) {
  if (!payload || typeof payload !== "object" || !("status" in payload)) {
    return true;
  }

  const status = String(payload.status).toLowerCase();
  return ["ok", "success", "successful", "true", "1"].includes(status);
}

function getPayloadMessage(payload) {
  return (
    pick(payload, ["message", "error", "errors.0", "data.message", "data.error"], "") ||
    "OnlyTraffic returned an error status."
  );
}

function errorLooksLikeLimit(error) {
  return /limit|per_page|page size|too many|maximum/i.test(error.message || "");
}

function normalizeTransactionCollection(candidate) {
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
        [
          "id",
          "transaction_id",
          "transactionId",
          "status",
          "income",
          "profit",
          "revenue",
          "amount",
          "campaign_id",
          "campaignId",
          "offer_id",
          "onlyfans_id",
          "username",
        ].some((key) => key in item)
      );

    if (looksLikeRecordMap) {
      return values;
    }
  }

  return null;
}

function findFirstTransactionArray(value, depth = 0) {
  if (!value || depth > 5) {
    return null;
  }

  const normalized = normalizeTransactionCollection(value);
  if (normalized && normalized.length > 0) {
    return normalized;
  }

  if (typeof value !== "object") {
    return null;
  }

  for (const child of Object.values(value)) {
    const result = findFirstTransactionArray(child, depth + 1);
    if (result) {
      return result;
    }
  }

  return null;
}

function extractTransactions(payload) {
  const directCandidates = [
    payload,
    payload && payload.data,
    payload && payload.transactions,
    payload && payload.items,
    payload && payload.results,
    payload && payload.result,
    payload && payload.data && payload.data.transactions,
    payload && payload.data && payload.data.items,
    payload && payload.data && payload.data.results,
    payload && payload.response && payload.response.transactions,
    payload && payload.response && payload.response.data,
  ];

  for (const candidate of directCandidates) {
    const array = normalizeTransactionCollection(candidate);
    if (array) {
      return array;
    }
  }

  return findFirstTransactionArray(payload) || [];
}

async function requestTransactionPage({ apiKey, authMode, limit, offset }) {
  const form = new URLSearchParams();
  form.set("limit", String(limit));
  form.set("offset", String(offset));

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
  } catch (_error) {
    throw new Error(`OnlyTraffic returned non-JSON response (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok || !statusLooksSuccessful(payload)) {
    throw new Error(`OnlyTraffic API error (${response.status}): ${getPayloadMessage(payload)}`);
  }

  return {
    payload,
    transactions: extractTransactions(payload),
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
      const result = await requestTransactionPage({
        apiKey,
        authMode: attempt.authMode,
        limit: attempt.limit,
        offset: 0,
      });
      return {
        ...attempt,
        firstPage: result.transactions,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to connect to OnlyTraffic transactions.");
}

function pageSignature(transactions) {
  return JSON.stringify(
    transactions.slice(0, 20).map((transaction) => {
      const id = pick(transaction, ["id", "transaction_id", "transactionId", "uuid", "hash"], "");
      return id || JSON.stringify(transaction).slice(0, 300);
    })
  );
}

async function importTransactions(apiKey) {
  const mode = await chooseWorkingImportMode(apiKey);
  const transactions = [...mode.firstPage];
  const seenPages = new Set([pageSignature(mode.firstPage)]);
  let offset = mode.firstPage.length;

  while (mode.firstPage.length > 0) {
    const page = await requestTransactionPage({
      apiKey,
      authMode: mode.authMode,
      limit: mode.limit,
      offset,
    });

    if (page.transactions.length === 0) {
      break;
    }

    const signature = pageSignature(page.transactions);
    if (seenPages.has(signature)) {
      console.warn("OnlyTraffic returned a repeated transaction page; stopping pagination to avoid duplicate looping.");
      break;
    }

    seenPages.add(signature);
    transactions.push(...page.transactions);
    offset += page.transactions.length;
  }

  return {
    transactions,
    limitUsed: mode.limit,
    authModeUsed: mode.authMode,
  };
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (/(approved|paid|confirmed|complete|completed|success|successful)/i.test(normalized)) {
    return "approved";
  }
  if (/(pending|hold|review|processing|waiting)/i.test(normalized)) {
    return "pending";
  }
  if (/(reject|rejected|declin|denied|cancel|failed|void|chargeback|refund)/i.test(normalized)) {
    return "rejected";
  }

  return normalized || "unknown";
}

function normalizeTransactionStatus(transaction) {
  const isUndo = pick(transaction, ["is_undo", "isUndo", "undo"], false);
  if (isUndo === true || String(isUndo).trim().toLowerCase() === "true" || isUndo === 1 || isUndo === "1") {
    return "rejected";
  }

  const status = pick(
    transaction,
    ["status", "state", "transaction_status", "transactionStatus", "approval_status", "approvalStatus"],
    ""
  );

  return status === "" ? "approved" : normalizeStatus(status);
}

function getFirstTransactionKeys(transactions) {
  const first = transactions.find((transaction) => transaction && typeof transaction === "object");
  return first ? Object.keys(first).sort() : [];
}

function buildMetadata(transactions, limitUsed, authModeUsed) {
  const statusCounts = {};

  for (const transaction of transactions) {
    const status = normalizeTransactionStatus(transaction);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return {
    importedAt: new Date().toISOString(),
    totalTransactions: transactions.length,
    limitUsed,
    authModeUsed,
    firstTransactionKeys: getFirstTransactionKeys(transactions),
    statusCounts,
  };
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  await ensureProjectFolders();

  const apiKey = process.env.ONLYTRAFFIC_API_KEY;
  if (!apiKey) {
    throw new Error("ONLYTRAFFIC_API_KEY is missing. Add it to .env before running the transactions importer.");
  }

  const { transactions, limitUsed, authModeUsed } = await importTransactions(apiKey);
  const metadata = buildMetadata(transactions, limitUsed, authModeUsed);

  await writeJson(RAW_TRANSACTIONS_PATH, transactions);
  await writeJson(TRANSACTIONS_META_PATH, metadata);

  console.log("OnlyTraffic transactions import complete.");
  console.log(`Total transactions imported: ${metadata.totalTransactions}`);
  console.log(`First transaction keys: ${metadata.firstTransactionKeys.length ? metadata.firstTransactionKeys.join(", ") : "(none)"}`);
  console.log(`Raw transactions saved to: ${path.relative(ROOT, RAW_TRANSACTIONS_PATH)}`);
  console.log(`Metadata saved to: ${path.relative(ROOT, TRANSACTIONS_META_PATH)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
