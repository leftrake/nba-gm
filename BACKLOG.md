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

## Ratings System

- Expand the rating system beyond the current 7 attributes: consider splitting defense into perimeter defense and interior defense, adding a court vision sub-rating to passing, a handle/ball security rating affecting turnovers, and a motor/hustle rating affecting loose balls and charges. Large change touching `overall()`, the sim, and every display that shows ratings.

## Tech debt
