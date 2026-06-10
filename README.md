# 🏀 NBA GM

A franchise-management game: pick one of the 30 real NBA teams (with generated fictional players), run the front office, and chase a ring across multiple seasons.

## Run it

Requires [Node.js](https://nodejs.org). In this folder:

```
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

## How to play

1. **Pick a team** on the start screen.
2. **Sim the season** — Sim Day / Sim Week / Sim to Playoffs. Standings, player stats, and league news update as you go.
3. **Make trades** any time during the season. AI teams evaluate offers based on player value (overall, age, potential, contract). Salary matching rules apply if you're over the cap.
4. **Playoffs** — top 8 per conference, best-of-7 rounds.
5. **Offseason** — players develop or decline by age, contracts tick down, expiring players hit free agency.
6. **Free agency** — 5 signing rounds. Sign players with your cap room while AI teams compete for the same pool. Then a new season starts.

Your save is stored in the browser (localStorage) and persists between visits. "New Game" wipes it.

## Structure

- `src/engine/` — pure game logic (players, sim, league, trades), no UI
- `src/components/` — React screens
- `src/data/teams.js` — the 30 teams + cap constants

## Ideas for v2

Draft + prospects, lineup/rotation control, in-game injuries, contract extensions, draft pick trading, game-by-game box scores.
