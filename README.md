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

1. **Pick a team** on the start screen — or check the box for a **Fantasy Draft**, which pools every player from all 30 teams plus free agents and lets you build your roster from scratch in a 15-round snake draft.
2. **Sim the season** — Sim Day / Sim Week / Sim to Playoffs. Standings, stats, box scores, and league news update as you go, including injuries and All-Star Weekend.
3. **Make trades** any time, including players and draft picks. AI teams evaluate offers based on player value (overall, age, potential, contract) and salary-matching rules if you're over the cap.
4. **Scout** upcoming draft prospects (international players must be discovered first) and watch current players on your pro scouting list to narrow their hidden ratings.
5. **Playoffs** — top 8 per conference, best-of-7 rounds, with an awards ceremony and Finals MVP along the way.
6. **Offseason** — players develop or decline by age (with a development report), contract extensions come due, you make coaching decisions, the draft lottery sets the order, then the draft itself.
7. **Free agency** — several signing rounds. Sign players with your cap room while AI teams compete for the same pool. Then a new season starts.

Throughout the game, ownership tracks your approval rating, which drives your spending budget and the occasional front-office directive. Your save is stored in the browser (localStorage) and persists between visits; Settings lets you export/import a save file. "New Game" wipes the current save, and **Legacy** keeps a cross-save record of past franchises, the all-time record book, and the Hall of Fame.

## Structure

- `src/engine/` — pure game logic (players, sim, league, trades, draft, scouting, contracts, injuries, awards, legacy), no UI
- `src/components/` — React screens, one per nav tab
- `src/data/teams.js` — the 30 teams + cap constants
