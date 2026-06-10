# NBA GM — Complete Setup Guide: GitHub + Claude Code

Every step, every click, written for someone doing this for the first time. Total time: roughly 30–45 minutes.

---

## Part 0: Open PowerShell (you'll need it throughout)

1. Press the **Windows key** on your keyboard.
2. Type `powershell`.
3. Click **Windows PowerShell** (the blue icon). A window opens showing something like `PS C:\Users\jondu>`.
4. The `PS` at the start means you're in PowerShell — that matters later. Keep this window open; every command in this guide gets typed (or pasted) here and run by pressing **Enter**.

Tip: paste into PowerShell by right-clicking inside the window.

---

## Part 1: Install Git for Windows

Git is the version-control tool. GitHub is the website that hosts git projects. You need the tool before the website is useful.

1. In your web browser, go to **https://git-scm.com/downloads/win**
2. Click **"Click here to download"** (the 64-bit installer).
3. Run the downloaded `.exe`.
4. The installer asks many questions. **Accept the default on every screen** by clicking **Next** repeatedly, then **Install**, then **Finish**. None of the options matter for this project.
5. **Close and reopen PowerShell** (installs only take effect in new windows).
6. Verify — type this and press Enter:

   ```
   git --version
   ```

   You should see something like `git version 2.x.x`. If you see "git is not recognized," close PowerShell, reopen it, and try again.

7. Tell git who you are (used to label your saves — do this once, ever):

   ```
   git config --global user.name "Tate Duensing"
   git config --global user.email "tateduensing@gmail.com"
   ```

   Use the same email as your GitHub account (next step) so your commits link to your profile.

---

## Part 2: Create a GitHub account + repository

### Create the account (skip if you have one)

1. Go to **https://github.com** and click **Sign up**.
2. Use `tateduensing@gmail.com`, pick a username and password, verify the email code it sends you.
3. The free plan is all you need.

### Create the repository (the online home for your project)

1. Once signed in, click the **+** in the top-right corner → **New repository**.
2. Fill in:
   - **Repository name:** `nba-gm`
   - **Description (optional):** `NBA franchise management game`
   - **Public or Private:** your choice. Private = only you can see it. Public = anyone can see it (normal for hobby projects, and required for free GitHub Pages hosting later if you want it).
   - **Leave ALL checkboxes unchecked** — no README, no .gitignore, no license. The project already has these; adding them here causes a conflict on your first push.
3. Click **Create repository**.
4. You'll land on a page titled "Quick setup." **Keep this tab open** — you'll need the URL it shows, which looks like:
   `https://github.com/YOUR_USERNAME/nba-gm.git`

---

## Part 3: Move the project out of OneDrive

OneDrive constantly syncs files, and git creates thousands of tiny files (especially `node_modules`). They fight. Moving the project to a plain folder avoids headaches.

In PowerShell:

```
mkdir C:\dev
Move-Item "C:\Users\jondu\OneDrive\Documents\Claude\Projects\NBA GM" C:\dev\nba-gm
```

- If `mkdir C:\dev` says the folder already exists, that's fine — continue.
- If `Move-Item` says the file is in use, close any program that has the folder open (including this Cowork session's folder access) and retry. Worst case, restart your PC and run just the `Move-Item` line again.

Verify:

```
dir C:\dev\nba-gm
```

You should see `package.json`, `index.html`, `src`, `README.md`, etc.

---

## Part 4: Install Node.js (needed to run the game)

1. Go to **https://nodejs.org** and download the **LTS** version (the big green button).
2. Run the installer. Defaults are fine — Next, Next, Install, Finish. (If it asks about "tools for native modules," leave it unchecked.)
3. Close and reopen PowerShell, then verify:

   ```
   node --version
   npm --version
   ```

   Both should print version numbers.

4. Now test the game itself:

   ```
   cd C:\dev\nba-gm
   npm install
   npm run dev
   ```

   - `npm install` takes a minute and creates a `node_modules` folder. Warnings are normal; errors in red are not.
   - `npm run dev` prints a line like `Local: http://localhost:5173/`. **Ctrl+click that link** (or copy it into your browser). You should see the team-picker screen. 🏀
   - When done playing, click back in PowerShell and press **Ctrl+C** (then `y` if asked) to stop the server.

---

## Part 5: Turn the folder into a git repository and push to GitHub

In PowerShell (make sure you're still in the project folder — the prompt should show `C:\dev\nba-gm`):

```
cd C:\dev\nba-gm
git init
git add .
git commit -m "NBA GM v1 - initial version"
```

What each line does:
- `git init` — makes this folder a git repository (creates a hidden `.git` folder).
- `git add .` — stages every file for saving. The `.gitignore` file already in the project automatically excludes `node_modules` and build output, so don't worry about those.
- `git commit -m "..."` — takes the snapshot. The message describes what this version is.

Now connect it to GitHub. Replace `YOUR_USERNAME` with your actual GitHub username (it's in the URL from Part 2):

```
git remote add origin https://github.com/YOUR_USERNAME/nba-gm.git
git branch -M main
git push -u origin main
```

- The first `git push` pops up a **"Connect to GitHub"** window. Click **Sign in with your browser**, approve it, and the push completes. This only happens once.
- When it finishes, refresh your GitHub tab — all your files are now visible online.

From now on, saving your work to GitHub is always the same three commands:

```
git add .
git commit -m "describe what you changed"
git push
```

(Or, as you'll see below, just ask Claude Code to do it.)

---

## Part 6: Install Claude Code

1. In PowerShell, run:

   ```
   irm https://claude.ai/install.ps1 | iex
   ```

2. Wait for it to finish, then **close and reopen PowerShell** and verify:

   ```
   claude --version
   ```

   If "claude is not recognized," reopen PowerShell once more — the installer updates your PATH, which only new windows pick up.

3. Note: Claude Code needs a Pro, Max, Team, or Enterprise Claude account — the same account you use for Cowork.

---

## Part 7: First Claude Code session

1. In PowerShell:

   ```
   cd C:\dev\nba-gm
   claude
   ```

2. **First-run login:** a browser tab opens asking you to log in to your Claude account. Approve it, return to the terminal.
3. **Trust prompt:** Claude Code asks if you trust the files in this folder. Choose **Yes**.
4. You now have a chat prompt inside your terminal. Good first message:

   ```
   Run /init to create a CLAUDE.md file documenting this codebase.
   ```

   `CLAUDE.md` is a notes file Claude Code reads at the start of every future session, so it always understands the project structure without re-exploring.

5. Commit that file (just ask in plain English):

   ```
   Commit the CLAUDE.md file and push to GitHub.
   ```

   Claude Code shows you each git command before running it and asks permission. Approve them.

### The everyday workflow

Every work session looks like this:

1. Open PowerShell → `cd C:\dev\nba-gm` → `claude`
2. Ask for what you want in plain English:
   - "Add an NBA draft with a lottery and scouted prospects"
   - "Let me set my starting lineup and rotation minutes"
   - "Players should occasionally get injured during sims"
   - "The trade screen feels cluttered, clean it up"
3. Claude Code edits files and shows you diffs. To see results live, keep `npm run dev` running in a **second** PowerShell window — the browser auto-refreshes when files change.
4. When you like what you have: **"commit and push this"**. Each commit is a save point on GitHub you can always roll back to ("revert to the previous commit" works too).
5. Exit Claude Code anytime with `/exit` or Ctrl+C.

### Useful Claude Code commands

| Command | What it does |
|---|---|
| `/init` | Generates CLAUDE.md project documentation |
| `/help` | Lists all commands |
| `/clear` | Starts a fresh conversation (use between unrelated tasks) |
| `/cost` | Shows usage for the session |
| `Esc` | Interrupts Claude mid-task |

---

## Troubleshooting

**"not recognized as the name of a cmdlet"** → The program isn't installed or PowerShell is stale. Close and reopen PowerShell first; reinstall second.

**`git push` rejected ("fetch first")** → The GitHub repo has a file the local one doesn't (usually a README created on the website). Run `git pull origin main --rebase --allow-unrelated-histories` then `git push` again.

**Game won't start after changes** → Read the error in the `npm run dev` window, then paste it into Claude Code: "the dev server shows this error, fix it."

**Want your old save back?** Game saves live in the browser's localStorage per URL, so they survive code changes — but "New Game" or clearing browser data wipes them.

---

## What you end up with

- **C:\dev\nba-gm** — the project on your machine
- **github.com/YOU/nba-gm** — full history online, every version recoverable
- **Claude Code** — your development partner inside the project folder
- **Cowork (here)** — planning, research, docs, and anything that isn't editing code
