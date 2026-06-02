import { loadCreators } from "./creators.mjs";

export function sortGuideCreators(creators) {
  return [...creators].sort(
    (a, b) =>
      Number(b.homepagePriority || 0) - Number(a.homepagePriority || 0) ||
      Number(b.score || 0) - Number(a.score || 0) ||
      String(a.displayName || a.name || "").localeCompare(String(b.displayName || b.name || ""))
  );
}

export function isFreeGuideCreator(creator) {
  return Boolean(creator.isFree || creator.hasActiveFreePromo);
}

export function isFreeTrialGuideCreator(creator) {
  return Boolean(creator.isFreeTrial);
}

export function isFreeOrTrialGuideCreator(creator) {
  return Boolean(isFreeGuideCreator(creator) || isFreeTrialGuideCreator(creator));
}

export function getFreeGuideCreators(limit = 12) {
  return sortGuideCreators(loadCreators().filter(isFreeGuideCreator)).slice(0, limit);
}

export function getFreeTrialGuideCreators(limit = 12) {
  return sortGuideCreators(loadCreators().filter(isFreeTrialGuideCreator)).slice(0, limit);
}

export function getBestFreeGuideCreators(limit = 12) {
  return sortGuideCreators(loadCreators().filter(isFreeOrTrialGuideCreator)).slice(0, limit);
}
