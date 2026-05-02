const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

function creatorLabel(creator) {
  return `${creator.displayName || creator.name || "Creator"} (@${creator.username || "unknown"})`;
}

async function main() {
  const { getCategoryDefinitions, getHomepageSections, loadCreators } = await import("../src/lib/creators.mjs");

  const publicCreators = loadCreators();
  const routeSlugs = new Set();
  const duplicateSlugs = new Map();
  const errors = [];

  for (const creator of publicCreators) {
    if (!creator.slug) {
      errors.push(`Missing slug: ${creatorLabel(creator)}`);
      continue;
    }

    if (routeSlugs.has(creator.slug)) {
      duplicateSlugs.set(creator.slug, [...(duplicateSlugs.get(creator.slug) || []), creatorLabel(creator)]);
    }

    routeSlugs.add(creator.slug);
  }

  for (const [slug, creators] of duplicateSlugs) {
    errors.push(`Duplicate slug "${slug}": ${creators.join(", ")}`);
  }

  const homepageCreators = getHomepageSections().flatMap((section) =>
    section.creators.map((creator) => ({
      creator,
      source: `homepage:${section.id}`,
    }))
  );

  const categoryCreators = getCategoryDefinitions().flatMap((category) =>
    publicCreators
      .filter(category.filter)
      .slice(0, 24)
      .map((creator) => ({
        creator,
        source: `category:${category.slug}`,
      }))
  );

  const linkedCreators = [...homepageCreators, ...categoryCreators];

  for (const { creator, source } of linkedCreators) {
    if (!creator.slug) {
      errors.push(`Linked creator missing slug in ${source}: ${creatorLabel(creator)}`);
      continue;
    }

    if (!routeSlugs.has(creator.slug)) {
      errors.push(`Missing route for /creator/${creator.slug}/ from ${source}: ${creatorLabel(creator)}`);
    }
  }

  const distCreatorDir = path.join(ROOT, "dist", "creator");
  if (fs.existsSync(distCreatorDir)) {
    for (const { creator, source } of linkedCreators) {
      if (!creator.slug) {
        continue;
      }

      const generatedFile = path.join(distCreatorDir, creator.slug, "index.html");
      if (!fs.existsSync(generatedFile)) {
        errors.push(`Generated file missing for /creator/${creator.slug}/ from ${source}: ${generatedFile}`);
      }
    }
  } else {
    console.log("dist/creator not found; skipping generated file existence check.");
  }

  console.log("FreeOnlyFanz link validation complete.");
  console.log(`Public creators: ${publicCreators.length}`);
  console.log(`Generated route slugs: ${routeSlugs.size}`);
  console.log(`Homepage/category linked creators checked: ${linkedCreators.length}`);

  if (errors.length > 0) {
    console.error("\nBroken creator links found:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("All homepage/category creator links have matching generated creator routes.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
