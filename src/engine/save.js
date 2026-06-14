// Save-file protection for long franchises: a version stamp on the data
// format and a hard cap on the news feed so the localStorage save doesn't
// grow without bound or break silently when the format changes.

// The day-to-day migration path for new fields is backfillPlayers()
// (league.js): any new league/team/player field gets a default there, keyed
// off `== null`/`!field` checks, so old saves are patched in place on load.
// That covers the overwhelming majority of schema growth — new optional
// fields, renamed-with-fallback fields, new sub-objects with sensible
// defaults — and keeps every save loadable forever.
//
// SAVE_VERSION exists only for the rare case backfillPlayers can't recover
// the old shape at all (e.g. a field's *meaning* changed, or data was
// restructured in a way no default can reconstruct). Only bump this, and
// only after adding real migration logic to the `version < SAVE_VERSION`
// branch below — bumping it without a migration permanently bricks every
// existing save (checkSave rejects anything it can't migrate rather than
// loading it broken).
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
    // Real migrations for unrecoverable shape changes go here, one `if
    // (version < N)` block per bump, each falling through to the next.
    // Any version left unhandled by a block below is incompatible.
    return { error: `This save uses an old data format (v${version}) that this version of the game can no longer read.` };
  }
  data.saveVersion = SAVE_VERSION;
  return { league: data };
}
