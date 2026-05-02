const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "data", "reports", "tq-explain.csv");

const CSV_COLUMNS = [
  "username",
  "slug",
  "name",
  "recommendation",
  "isPremiumOnly",
  "publicEligible",
  "hiddenReason",
  "homepagePriority",
  "manualPriority",
  "tqWeight",
  "shownOnTq",
  "tqSection",
  "reason",
  "trackingUrlPresent",
  "imagePresent",
];

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function toCsvRow(values) {
  return CSV_COLUMNS.map((column) => csvEscape(values[column])).join(",");
}

async function main() {
  const { getTqCreatorRows } = await import("../src/lib/creators.mjs");
  const tq = getTqCreatorRows();
  const rows = tq.rows.map((row) => ({
    username: row.creator.username || "",
    slug: row.creator.slug || "",
    name: row.creator.displayName || row.creator.name || "",
    recommendation: row.creator.recommendation || "",
    isPremiumOnly: row.creator.isPremiumOnly ? "true" : "false",
    publicEligible: row.creator.publicEligible ? "true" : "false",
    hiddenReason: row.creator.hiddenReason || "",
    homepagePriority: row.creator.homepagePriority || 0,
    manualPriority: row.creator.manualPriority || "",
    tqWeight: row.tqWeight || 0,
    shownOnTq: row.shownOnTq ? "true" : "false",
    tqSection: row.tqSection,
    reason: row.reason,
    trackingUrlPresent: row.trackingUrlPresent ? "true" : "false",
    imagePresent: row.imagePresent ? "true" : "false",
  }));

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${CSV_COLUMNS.join(",")}\n${rows.map(toCsvRow).join("\n")}\n`, "utf8");

  const topWeighted = tq.eligibleRows
    .slice()
    .sort((a, b) => b.tqWeight - a.tqWeight)
    .slice(0, 10)
    .map((row) => `${row.creator.username} (${row.tqWeight})`)
    .join(", ");

  console.log("TQ explain report complete.");
  console.log(`Seed: ${tq.seed}`);
  console.log(`Eligible creators: ${tq.eligibleRows.length}`);
  console.log(`Start Here shown: ${tq.mainCreators.length}`);
  console.log(`More Free Profiles shown: ${tq.moreCreators.length}`);
  console.log(`Daisy included: ${tq.poolCreators.some((creator) => creator.slug === "daisymayyxo") ? "yes" : "no"}`);
  console.log(`Top weighted creators: ${topWeighted}`);
  console.log(`CSV report saved to: ${path.relative(ROOT, REPORT_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
