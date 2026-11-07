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
- **Optional local AI** (Ollama + Gemma): summaries and briefs without sending anything outside your computer. EMMA also works without AI.

## Install

### Mac (one line)

Open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/LorenzoRD888/EMMA-app/main/install.sh | bash
```

This installs EMMA in `~/EMMA`, with a private Node.js (no administrator password), and creates the EMMA app in Applications and on the Desktop. Running it again updates EMMA and keeps your data.

### Mac or Windows (zip)

1. **Code → Download ZIP**, then unzip it.
2. Double-click **Start EMMA - Mac.command** (Mac) or **Start EMMA - Windows.bat** (Windows).
3. The first start downloads what EMMA needs. Then EMMA opens at http://127.0.0.1:4317.

A welcome screen then guides you through:

- the setup, with or without local AI;
- importing the data of a previous EMMA;
- the first steps.

More details are in **READ ME FIRST.txt**.

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
