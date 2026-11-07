# EMMA — Market Intelligence (technical notes)

EMMA is a local application for Mac and Windows that follows competitors and other companies: what they do, what they publish, which trade fairs they attend, who works there, and what others write about them. Everything is stored on your computer.

For starting and updating EMMA see **READ ME FIRST.txt** in the EMMA folder.

## Folder layout

    EMMA/
      Start EMMA - Mac.command     starts EMMA on macOS
      Start EMMA - Windows.bat     starts EMMA on Windows
      READ ME FIRST.txt            short guide for users
      data/                        user data: market.sqlite, settings.json, .env, logs, backups
      app/                         the program: src, public, test, assets, package.json
        .runtime/                  private Node.js (downloaded on first start if needed)
        node_modules/              libraries (installed on first start)

Updating = replacing `app/`. The `data/` folder is never touched by updates.

## Mac app (optional)

Once, in Terminal:

    bash <EMMA folder>/app/assets/install-app.sh

This creates **EMMA.app** in Applications, with a link on the Desktop. EMMA then runs in the background and opens in its own window. If the EMMA folder is on the Desktop, in Documents or in Downloads, the script first moves it into your home folder (macOS blocks apps there). The startup log is `data/emma.log`.

Requirements: Node.js 22.13 or later, which includes the built-in SQLite database (downloaded automatically by the start files if missing).

## The four pages

- **Daily** — everything new at the companies you follow, mixed together and sorted by publication date: news, LinkedIn posts, new pages on official websites, upcoming trade fairs, new people and publications. Each card shows a preview, how it was found and why it was kept, and a link to the original. Use × to remove a card from the Daily (it stays in the Archive). **＋ Add news**: paste a link and EMMA extracts title, date, image and preview.
- **Archive** — one page per company: Overview (what it does, statistics, key facts with year and source, activity per month), News and posts (timeline by publication date, search, CSV export), People (public LinkedIn profiles and executives quoted in sources), Documents (datasheets, PDFs, products, job openings), Trade fairs, Publications (papers and patents) and items To review. **Discover new companies** finds startups worldwide on a topic (Crunchbase, Tracxn, F6S, Dealroom, LinkedIn company pages, funding news).
- **Compare** — selected companies side by side, plus a “who attends which fair” matrix.
- **Settings** — web search service, AI, automatic update, search breadth, extra sources, log.

## Where the information comes from

- **Official website** (no key needed): EMMA finds the site’s WordPress API, RSS feeds and sitemap, takes the first read as a baseline and from then on shows only new or changed pages. Trade fair announcements (fair, year, hall/stand, dates) are recognised automatically.
- **Web search** (one of: Tavily, Exa, Jina AI, You.com, Brave Search, Google via SerpApi): third-party news, LinkedIn posts and people (from search engine results only — EMMA never logs into LinkedIn), fairs mentioned by others, key facts, patents, startups. With the fallback option on, if the main service fails or runs out of searches EMMA uses the others you have set up.
- **OpenAlex** (free): scientific papers with an author affiliated to the company.
- **Publication dates**: EMMA reads every page it finds and looks for the date in structured data, metadata, the address and the text; for LinkedIn posts it derives the date from the post ID. Items without a date never enter the Daily; you can set the date by hand in the Archive timeline. On startup EMMA looks up missing dates in the background.
- **Namesakes**: a result containing the company name is kept if it comes from the official website or contains industry terms (keywords, industry and terms learned from the site), discarded if it comes from social or music sites or contains a “word to exclude”, and otherwise placed in **To review**.

## AI (optional)

Four choices: **No AI** (everything works except AI profile and summaries), **Anthropic**, **DeepSeek and OpenAI-compatible services** (DeepSeek, OpenAI, Mistral or any https address), **Local model** (Ollama). DeepSeek does not offer web search through its API, so a web search service is still needed.

## Automatic update

Settings → Automatic update. Once a day EMMA reads official websites and searches news and posts; people, key facts, fairs and publications are searched every 7 days. EMMA must be running at that time (start it at login to be sure).

## Data and backup

- `data/market.sqlite`: companies, news, fairs, people, facts, notes. While running there may also be `-wal` and `-shm` files.
- `data/settings.json`: keys and settings, readable only by your user. It is not encrypted: do not share it.
- `data/.env` (optional): keys written by hand, one per line (`TAVILY_API_KEY=...`).
- `data/backups`: copies made before importing data from an older EMMA.

To back up, quit EMMA and copy the whole `data` folder (it contains your keys: keep it safe).

## Limits

Public sources give partial coverage; no service guarantees every page. Automatic recognition of fairs, dates and key facts can make mistakes: always check the linked source. AI summaries must be checked against the sources.

## Tests

In the `app` folder:

    npm test
