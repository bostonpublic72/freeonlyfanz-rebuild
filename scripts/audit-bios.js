const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "data", "reports", "bio-audit.csv");

const CSV_COLUMNS = ["username", "name", "hasRawAboutHtml", "hasCleanBio", "bioLength", "usesFallbackBio"];

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

function toCsvRow(row) {
  return CSV_COLUMNS.map((column) => csvEscape(row[column])).join(",");
}

async function main() {
  const { getCreatorDisplayBio, loadCreators } = await import("../src/lib/creators.mjs");
  const creators = loadCreators();
  const rows = creators.map((creator) => {
    const cleanBio = String(creator.shortBio || "").trim();
    const displayBio = getCreatorDisplayBio(creator);

    return {
      username: creator.username || "",
      name: creator.displayName || creator.name || "",
      hasRawAboutHtml: creator.rawAboutHtml ? "true" : "false",
      hasCleanBio: cleanBio.length >= 24 ? "true" : "false",
      bioLength: cleanBio.length,
      usesFallbackBio: displayBio.usesFallbackBio ? "true" : "false",
    };
  });

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${CSV_COLUMNS.join(",")}\n${rows.map(toCsvRow).join("\n")}\n`, "utf8");

  const cleanBioCount = rows.filter((row) => row.hasCleanBio === "true").length;
  const fallbackCount = rows.filter((row) => row.usesFallbackBio === "true").length;

  console.log("Bio audit complete.");
  console.log(`Public creators: ${rows.length}`);
  console.log(`Creators with clean bios: ${cleanBioCount}`);
  console.log(`Creators using fallback bios: ${fallbackCount}`);
  console.log(`CSV report saved to: ${path.relative(ROOT, REPORT_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
