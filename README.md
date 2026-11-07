# EMMA — Market Intelligence

EMMA follows competitors and other companies for you: news, official websites, LinkedIn posts and people, trade fairs, publications and patents, job openings, certifications and distributors. It runs on your own computer (Mac or Windows) and keeps every piece of data there.

## What it does

- **Daily**: everything new at the companies you follow, sorted by publication date, with "What changed since your last visit".
- **Archive**: one page per company, with an overview and brief, news, people, documents, trade fairs, publications and items to review.
- **Compare**: companies side by side, plus a "who attends which fair" matrix.
- **Discover startups**: finds new companies on a topic.
- **Post-its that EMMA follows**: write a note on a company and the next update looks for news about it.
- **Learns from you**: sources you keep or discard change what EMMA keeps next time.
- **Link safety**: every external link is checked (✓ trusted, ⚠ be careful, ⛔ dangerous).
- **Listen to the Daily**: a local voice (Kokoro, included) reads the news aloud. The voice model (about 90 MB) is downloaded once, the first time you press play; the text never leaves your computer.
- **Optional local AI** (Ollama + Gemma): summaries and briefs without sending anything outside your computer. EMMA also works without AI.

## Install

### Mac — recommended: one command in Terminal

This is the easiest way, and macOS shows **no security warning**.

1. Open **Terminal**: press `Cmd + Space`, type `Terminal` and press Enter.
2. Copy this line, paste it into Terminal and press Enter:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/LorenzoRD888/EMMA-app/main/install.sh | bash
   ```

3. Wait a few minutes. The installer:
   - downloads EMMA into the **EMMA** folder in your home folder;
   - downloads its own copy of Node.js (no administrator password, nothing else on your Mac changes);
   - creates the **EMMA** icon in Applications and on the Desktop;
   - opens EMMA.

From then on, double-click the **EMMA** icon. To update EMMA, paste the same line again: your data is kept.

### Why not just download the zip on a Mac?

You can, but macOS blocks the first opening of any file downloaded with the browser that is not signed by Apple. It shows the message *"Start EMMA - Mac.command" cannot be opened*. EMMA is fine; macOS does this for every unsigned download. The Terminal command above avoids it.

If you downloaded the zip anyway:

1. Click **Done** in the message.
2. Open **System Settings → Privacy & Security**.
3. Scroll down to *"Start EMMA - Mac.command" was blocked* and click **Open Anyway**.
4. Confirm.

You only need to do this the first time.

### Windows

1. On this page click **Code → Download ZIP**, then unzip it (right-click → *Extract All*).
2. Double-click **Start EMMA - Windows.bat**.
3. If Windows shows *"Windows protected your PC"*, click **More info → Run anyway**. This happens only the first time.
4. The first start downloads what EMMA needs (a few minutes). Then EMMA opens in the browser at http://127.0.0.1:4317.

Keep the small black window open while you use EMMA; closing it stops EMMA.

### First start

A welcome screen guides you through:

- the setup, with or without local AI;
- importing the data of a previous EMMA;
- the first steps.

More details are in **READ ME FIRST.txt**.

## If a download does not work (VPN, proxy, company network)

The first time, EMMA downloads a few things from the internet:

- Node.js and its libraries;
- the **local AI model** (Ollama + Gemma, several GB);
- the **voice model** (about 90 MB, from Hugging Face).

A **VPN**, a proxy or a company network can block or interrupt these downloads, especially the large local AI model. The usual symptoms are:

- the download stops or never ends;
- the error says it cannot connect;
- the welcome screen says the model is not ready.

What to do:

1. Turn off the VPN (or connect to a home network) just for the first setup.
2. Start EMMA again and repeat the step that failed (for the AI: the welcome screen, or **Settings → AI**).
3. When everything is downloaded you can turn the VPN back on. The local AI and the voice then work offline.

## Your data

Everything you collect, and your API keys, live in the `data/` folder next to `app/`. That folder is never uploaded here (see `.gitignore`) and updates never touch it.

## For developers

```bash
cd app
npm install
npm test        # node --test
npm start       # http://127.0.0.1:4317
```

Requires Node.js 22.13 or later, which includes the built-in SQLite database. Technical notes are in `app/README.md`.
