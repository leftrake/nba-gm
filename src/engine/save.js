// Save-file protection for long franchises: a version stamp on the data
// format and a hard cap on the news feed so the localStorage save doesn't
// grow without bound or break silently when the format changes.

// Bump this whenever the league/team/player shape changes in a way old
// builds (or old saves) can't handle; checkSave refuses any version it
// can't migrate instead of loading it broken.
export const SAVE_VERSION = 1;

export const NEWS_MAX = 100;

// All news goes through here so the feed stays capped at NEWS_MAX.
export function pushNews(league, item) {
  league.news.unshift(item);
  if (league.news.length > NEWS_MAX) league.news.length = NEWS_MAX;
}

// Validate parsed save data (from localStorage or an imported file).
// Returns { league } when usable, otherwise { error } with a user-facing
// message. Stamps the normalized version on success.
export function checkSave(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.teams) || data.userTeamId == null) {
    return { error: 'This is not an NBA GM save.' };
  }
  const version = data.saveVersion ?? 1; // saves predating versioning are v1
  if (version > SAVE_VERSION) {
    return { error: `This save is from a newer version of the game (save format v${version}; this build reads v${SAVE_VERSION}).` };
  }
  if (version < SAVE_VERSION) {
    // future format migrations go here; any version left unmigrated is incompatible
    return { error: `This save uses an old data format (v${version}) that this version of the game can no longer read.` };
  }
  data.saveVersion = SAVE_VERSION;
  return { league: data };
}
