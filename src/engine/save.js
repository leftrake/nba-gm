// Save-file protection for long franchises: a version stamp on the data
// format and a hard cap on the news feed so the localStorage save doesn't
// grow without bound or break silently when the format changes.

// Bump this whenever the league/team/player shape changes in a way old
// builds (or old saves) can't handle; checkSave refuses any version it
// can't migrate instead of loading it broken.
export const SAVE_VERSION = 1;

// Per-season cap on the live feed (league.news); when a new season starts,
// the old season's items leave the feed entirely — majors into the archive,
// the rest dropped.
export const NEWS_MAX = 100;

// How many major headlines each past season keeps in league.newsArchive
// (keyed by season, chronological) for the "biggest stories" history view.
export const ARCHIVE_PER_SEASON = 20;

// Every news item carries:
//   { day, text, category, season, phase, teamIds?, major? }
// category: trade | signing | injury | draft | award | milestone | league
// teamIds:  the teams the story is about (drives the News screen team filter)
// major:    headline-worthy — highlighted in the UI and archived past seasons

// Majors leaving the live feed land in their season's archive bucket.
// Items always leave oldest-first, so buckets read chronologically.
function archiveItem(league, n) {
  if (!n.major) return;
  const bucket = (league.newsArchive[n.season] ??= []);
  if (bucket.length < ARCHIVE_PER_SEASON) bucket.push(n);
}

// Move any items from finished seasons out of the live feed: majors are
// archived under their season, routine items are dropped.
export function archivePastNews(league) {
  if (!league.newsArchive) league.newsArchive = {};
  if (!league.news.some((n) => n.season != null && n.season !== league.season)) return;
  const keep = [];
  const old = []; // newest-first, like the feed
  for (const n of league.news) {
    if (n.season != null && n.season !== league.season) old.push(n);
    else keep.push(n);
  }
  for (const n of old.reverse()) archiveItem(league, n);
  league.news = keep;
}

// All news goes through here: stamps the season/phase, rolls finished
// seasons into the archive, and keeps the live feed capped at NEWS_MAX —
// a headline evicted by the cap mid-season still makes the archive.
// Eviction trims the oldest item of the most crowded category, so noisy
// ones (injuries) can't push a whole rare category (trades) off the feed.
export function pushNews(league, item) {
  item.season ??= league.season;
  item.phase ??= league.phase;
  archivePastNews(league);
  league.news.unshift(item);
  while (league.news.length > NEWS_MAX) {
    const counts = {};
    for (const n of league.news) counts[n.category] = (counts[n.category] || 0) + 1;
    const cat = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a));
    const i = league.news.findLastIndex((n) => n.category === cat); // oldest — the feed is newest-first
    archiveItem(league, league.news.splice(i, 1)[0]);
  }
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
