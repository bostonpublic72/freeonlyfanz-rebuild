import fs from "node:fs";
import path from "node:path";
import {
  getImportedCreatorSlugSet,
  getOrphanCreatorSlugs,
  getPublicCreatorSlugSet,
  getSnapshotCreatorSlugSet,
} from "../src/lib/creators.mjs";

const distCreator = path.join(process.cwd(), "dist", "creator");
const folderSlugs = fs.existsSync(distCreator)
  ? fs.readdirSync(distCreator, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

console.log({
  public: getPublicCreatorSlugSet().size,
  import: getImportedCreatorSlugSet().size,
  snapshot: getSnapshotCreatorSlugSet().size,
  folders: folderSlugs.length,
  orphans: getOrphanCreatorSlugs().length,
});
console.log(getOrphanCreatorSlugs().join("\n"));
