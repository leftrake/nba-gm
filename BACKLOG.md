# Backlog

Quality-of-life ideas and tweaks that aren't urgent enough for immediate work.

**How to use:** add items as a one-line description under the relevant
section. Remove an item once it's been implemented (don't mark it done,
just delete it — git history keeps the record).

## UI/UX


## Bugs


## Balance tweaks

## New features


## Trade

## Player Profile

## Scouting

- Allow scouting trips to be initiated during the regular season, not just the pre-draft offseason window; budget is still annual but can be spent any time, useful for evaluating trade targets and free agents mid-season as well as draft prospects.

## Sim Flow

- Pause the sim when a player is injured during a game: do not interrupt mid-game/mid-possession — finish the current game first, then show the full box score with the injury flagged (severity and timeline), and prompt the user to adjust their lineup/rotation before the next game starts. Similarly pause when an injured player's return date is reached so the user can add them back into the rotation before the next game.
- Always pause the sim and surface an incoming trade offer immediately when one arrives, rather than letting it sit in the inbox while games continue simming; the user should never miss a time-sensitive offer because they were simming.

## News

- Audit the news feed for gaps and add game-generated items: notable individual game performances (40+ points, triple-doubles, player milestones), weekly league transaction summaries, coaching changes, rivalry game results, and end-of-month standings shifts.

## Historical Records

- Add All-NBA team history to the Legacy screen showing every season's first/second/third team selections going back to the start of the save, filterable by player and season; similar archives for All-Defensive teams, All-Star rosters, and award winners.

## Offseason Flow

- Break the offseason into distinct named phases with engagement at each step: Award Ceremony (MVP/DPOY/ROY announcements with a visual moment), Development Report (player progression), Coaching Decisions (re-sign or replace staff), Draft Lottery (animated reveal), Draft, Free Agency, and Season Preview (projected standings, goals). Currently these happen too fast with no separation.
- Award Ceremony phase (triggered after the regular season ends, before the playoffs begin): a full-screen slideshow modal covering most of the screen, one award per slide, navigated via left/right arrows or a next button. Slide order: MVP, Defensive Player of the Year, Rookie of the Year, Sixth Man of the Year, All-NBA First/Second/Third Team, All-Defensive First/Second Team. Each slide shows the award name large at top, the winner's name and team (or all 5 players for team awards) prominently centered, key stats that earned the award, and a gold/trophy visual treatment. If the winner or any All-NBA/All-Defensive selection is on the user's team, add extra emphasis (confetti, team color treatment, "Your Player" callout). Dismissible at any point via a skip button, but defaults to showing all slides in sequence; shows once per season. Finishing or skipping transitions to the playoff bracket.

## Ratings System

- Expand the rating system beyond the current 7 attributes: consider splitting defense into perimeter defense and interior defense, adding a court vision sub-rating to passing, a handle/ball security rating affecting turnovers, and a motor/hustle rating affecting loose balls and charges. Large change touching `overall()`, the sim, and every display that shows ratings.

## Tech debt
