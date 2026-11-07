# EMMA — Market Intelligence

EMMA is a local application for **Mac and Windows** that follows competitors and other companies for you:

- what they do and what they publish;
- which trade fairs they attend;
- who works there and who they are hiring;
- what others write about them.

Everything is stored on your computer. Nothing is sent to EMMA's author, and there is no account to create.

---

## Contents

1. [Install on a Mac (recommended: one command)](#1-install-on-a-mac-recommended-one-command)
2. [Install on a Mac from the ZIP (alternative)](#2-install-on-a-mac-from-the-zip-alternative)
3. [Install on Windows](#3-install-on-windows)
4. [The first start: the welcome screen](#4-the-first-start-the-welcome-screen)
5. [Already have EMMA? Update and keep your data](#5-already-have-emma-update-and-keep-your-data)
6. [First steps in EMMA](#6-first-steps-in-emma)
7. [The pages](#7-the-pages)
8. [Where the information comes from](#8-where-the-information-comes-from)
9. [AI (optional) and the local voice](#9-ai-optional-and-the-local-voice)
10. [Automatic update and alerts](#10-automatic-update-and-alerts)
11. [Your data and backup](#11-your-data-and-backup)
12. [Troubleshooting](#12-troubleshooting)
13. [Limits](#13-limits)
14. [For developers](#14-for-developers)

---

## 1. Install on a Mac (recommended: one command)

This is the easiest way. macOS shows **no security warning**, because the files do not come through the browser.

1. **Open Terminal.** Press `Cmd + Space`, type `Terminal` and press Enter. A window with text appears.
2. **Copy this line** (the copy button is at its right):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/LorenzoRD888/EMMA-app/main/install.sh | bash
   ```

3. **Paste it into Terminal** with `Cmd + V` and press **Enter**.
4. **Wait a few minutes.** Terminal shows four steps:
   - 1/4 Downloading EMMA
   - 2/4 Preparing Node.js
   - 3/4 Installing the libraries
   - 4/4 Creating the EMMA app

   When you read **"✓ EMMA is installed"**, EMMA opens by itself.
5. **From then on**, just double-click the **EMMA** icon in Applications or on the Desktop. You can drag it to the Dock to keep it handy.

**What the installer does:**

- It puts EMMA in a folder called **EMMA** in your home folder (Finder → Go → Home).
- It downloads its own copy of Node.js inside that folder. You do not need to install anything else, you do not need an administrator password, and nothing else on the Mac changes.
- It installs the libraries.
- It creates the EMMA app with its icon and opens it.

**To update EMMA later**, paste the same line again. Your companies, news, settings and keys are kept.

---

## 2. Install on a Mac from the ZIP (alternative)

Use this only if you prefer not to use Terminal.

1. At the top of this page press the green **Code** button → **Download ZIP**.
2. Open the ZIP from Downloads: you get a folder called **EMMA-app-main**.
3. **Move that folder out of Downloads**, for example into your home folder. macOS protects Desktop, Documents and Downloads, and EMMA may not be able to read its own files there.
4. Double-click **Start EMMA - Mac.command**.
5. **macOS says the file "cannot be opened"** and offers *Move to Trash*. Choose **Done** and do **not** move it to the Trash. macOS does this with every file that is not signed with a paid Apple developer account; it is not a virus warning.
6. Open **System Settings → Privacy & Security** and scroll down. Next to *"Start EMMA - Mac.command" was blocked* press **Open Anyway**, then confirm with your password.
7. Double-click **Start EMMA - Mac.command** again. A Terminal window opens.
   - The first time, it downloads what EMMA needs. This takes a few minutes.
   - Then EMMA opens in your browser at **http://127.0.0.1:4317**.
8. **Keep that Terminal window open** while you use EMMA. Closing it stops EMMA.

You only need to do steps 5–6 the first time.

**Optional: get the app with the icon.** Open Terminal, type `bash ` (with a space), drag the file **app/assets/install-app.sh** from the EMMA folder into the window and press Enter. The script:

- moves the folder to your home folder if needed;
- creates **EMMA.app** in Applications and on the Desktop.

---

## 3. Install on Windows

1. At the top of this page press the green **Code** button → **Download ZIP**.
2. Right-click the ZIP → **Extract All…** → **Extract**. Choose a normal folder, for example *Documents*.
3. Open the extracted folder and double-click **Start EMMA - Windows.bat**.
4. **If Windows shows "Windows protected your PC"**, click **More info → Run anyway**. This happens only the first time, with every file that is not signed with a paid certificate.
5. A black window opens.
   - The first time, it downloads Node.js (into the EMMA folder, no administrator password) and the libraries. This takes a few minutes.
   - Then EMMA opens in your browser at **http://127.0.0.1:4317**.
6. **Keep the black window open** while you use EMMA. Closing it stops EMMA.

Next time just double-click **Start EMMA - Windows.bat** again. It starts in a few seconds.

---

## 4. The first start: the welcome screen

At the first start a **welcome screen** opens by itself. It asks you two things.

**1. Is EMMA already on this computer?**

- **Yes, update it and keep my data**: EMMA brings in the data of your old EMMA (see the next section).
- **No, this is my first time**: you continue with an empty EMMA.

**2. How do you want to use EMMA?**

| | With the local AI | Without AI |
|---|---|---|
| **Pros** | Summaries, automatic categories, a profile of each company, answers to your questions. Free and private: it runs on your computer. | Nothing to install. EMMA is ready at once and still collects everything: news, websites, fairs, people, LinkedIn, key facts, alerts. |
| **Cons** | Downloads 3–8 GB. It uses memory and processor while it works. | No summaries and no automatic categories. |

If you choose the local AI, the screen guides you in three steps:

1. **Install Ollama**, the free program that runs AI models. There is a button for Mac or for Windows, with instructions.
2. **Choose a model.**
   - If you already have models installed, just pick one.
   - Otherwise EMMA suggests one that fits your computer's memory.
   - You can also search other models on ollama.com, or type a name.
3. **Test it.** EMMA asks the model a short question to check that it works.

You can reopen the welcome screen any time from **Settings**. **Decide later** closes it; EMMA works anyway.

---

## 5. Already have EMMA? Update and keep your data

**If you installed with the Terminal command**, just paste the same line again. Everything is kept.

**If you have an older EMMA in another folder** (for example a ZIP you downloaded before):

1. Install the new version as described above and start it.
2. In the welcome screen, answer **"Yes, update it and keep my data"**.
3. Copy the path of the **old** EMMA folder (the one that contains the **data** folder):
   - **Mac:** in Finder, right-click the folder, hold the **⌥ Option** key and choose **Copy "EMMA" as Pathname**.
   - **Windows:** in File Explorer, right-click the folder and choose **Copy as path** (or click the address bar and copy it).
4. Paste it in the box (`Cmd + V` / `Ctrl + V`) and press **Check folder**.
5. EMMA shows what it found: version, number of companies, news and people, and the date of the last update. Press **Bring these data here**.

EMMA copies companies, news, people, notes, settings and API keys into the new version.

- **The old folder is not changed.**
- If the new EMMA already had some data, a copy is saved first in `data/backups`.
- When everything works, you can delete the old folder.

EMMA never searches your disk by itself: it only reads the folder you give it.

---

## 6. First steps in EMMA

A **Getting started** box in the Daily shows these steps and ticks them off as you go.

1. **Settings → 1 · Web search.** Create a free key with one service (for example **Tavily**) and paste it. Without a web search service EMMA still reads the official websites, but it finds much less.
2. **Settings → Your company** (optional): describe your company, its products and competitors. EMMA then explains *why* each news item matters to you.
3. **Archive → ＋ Add company.** Enter the name and official website of each company to follow.
4. **Press Update** in the Daily. News, posts, trade fairs, people and website changes appear within a few minutes.
5. **Add a post-it** to a company with something you want to know, for example *"new plant in Asia?"*. At the next update EMMA looks for news about it and shows what it found under the post-it.
6. **Keep or discard** what EMMA finds: star useful items and trash wrong ones. EMMA learns from you (see **Settings → What EMMA learned from you**).

---

## 7. The pages

- **Daily**: everything new at the companies you follow, mixed together and sorted by publication date. That includes news, LinkedIn posts, new pages on official websites, upcoming trade fairs, new people and publications.
  - At the top, **What changed** sums up what is new since your last visit.
  - Each card shows a preview, how it was found and why it was kept, and a link to the original.
  - **×** removes an article (it moves to the trash).
  - **＋ Add news** reads a link you paste: EMMA extracts the title, date, image and preview.
  - **▶ Listen** reads the Daily aloud with the local voice.
- **Archive**: one page per company, with these tabs:
  - **Overview**: what the company does, a brief of what changed, statistics, key facts with year and source, and activity per month;
  - **Strategic moves**: launches, investments, partnerships, distributors, certifications;
  - **Watched pages**: pages of the website that EMMA checks for changes;
  - **News and posts**: timeline by publication date, with search;
  - **People**: public LinkedIn profiles and executives quoted in sources;
  - **Documents**: datasheets, PDFs and products;
  - **Hiring**: job openings, with role, place and area;
  - **Trade fairs**;
  - **Publications**: scientific papers and patents;
  - **To review**: results EMMA is not sure about, for you to keep or discard.
- **Sectors**: a sector is a working lens on the market. You give the words, applications and companies that matter, and EMMA labels the news that really talks about it.
- **Compare**: selected companies side by side, plus a **who attends which fair** matrix.
- **Discover**: **Discover startups** finds new companies worldwide on a topic, from Crunchbase, Tracxn, F6S, Dealroom, LinkedIn company pages and funding news. Add the ones you want to follow with one click.
- **Settings**:
  1. Web search;
  2. Artificial intelligence;
  3. Updates and notifications;
  4. How much to search;
  5. Extra sources (including link safety);
  6. Log.

  Settings also includes **Your company**, **What EMMA learned from you**, **How EMMA works** and **Quit EMMA**.

**Link safety.** Every external link gets a sign:

- **✓** trusted source;
- **⚠** be careful, with the reason in the tooltip;
- **⛔** dangerous: EMMA asks before opening it.

It is an indication, not a guarantee. You can add a free Google Safe Browsing key in Settings → Extra sources.

---

## 8. Where the information comes from

- **Official website** (no key needed). EMMA finds the site's WordPress API, RSS feeds and sitemap. The first read is a baseline; from then on EMMA shows only new or changed pages. It recognises trade fair announcements automatically (fair, year, hall/stand, dates).
- **Web search** (one of Tavily, Exa, Jina AI, You.com, Brave Search, Google via SerpApi). This finds:
  - third-party news and LinkedIn posts;
  - people, taken from search engine results only (EMMA never logs into LinkedIn);
  - fairs mentioned by others, key facts and patents;
  - job openings, certifications and distributors;
  - trade press in the company's own language.

  With the fallback option on, if the main service fails or runs out of searches, EMMA uses the others you have set up. A **second round** searches again where the first one found little.
- **OpenAlex** (free): scientific papers with an author affiliated to the company.
- **Publication dates.** EMMA reads every page it finds and looks for the date in structured data, metadata, the address and the text. For LinkedIn posts it derives the date from the post ID. If a date is missing, EMMA keeps looking for it by itself in the background, every few hours. If the page has no date, it uses the date of the first copy saved by the Internet Archive and marks it as *approximate*.
- **Namesakes.** A result containing the company name is handled like this:
  - **kept** if it comes from the official website or contains industry terms;
  - **discarded** if it comes from social or music sites or contains a "word to exclude";
  - otherwise **put in To review**.

  What you keep or discard teaches EMMA which sites to trust.

---

## 9. AI (optional) and the local voice

**AI.** You can choose one of these in **Settings → 2 · Artificial intelligence**:

- **No AI**: everything works except the AI profile, summaries and answers.
- **Local model (Ollama)**: free and private.
- **Anthropic**: paid key.
- **OpenAI-compatible service**: DeepSeek, OpenAI, Mistral, or any https address. DeepSeek does not offer web search through its API, so a web search service is still needed.

**Local voice.** The Daily can be read aloud by **Kokoro**, a voice that runs on your computer and is included in EMMA.

- The first time you press play, EMMA downloads the voice model once (about 90 MB, from Hugging Face).
- After that the voice works offline.
- The text being read never leaves your computer.

---

## 10. Automatic update and alerts

In **Settings → 3 · Updates and notifications** you set how updates and alerts work:

- **Every day**, EMMA reads the official websites and searches news and posts.
- **Every 7 days**, it searches people, key facts, fairs and publications.
- **Desktop alerts** tell you when something important happens, on Mac and Windows.

EMMA must be running at that time. On a Mac you can start it at login: **System Settings → General → Login Items → + → EMMA**.

**Closing the browser window** leaves EMMA running in the background, so the automatic update can run. It uses very little. **To stop EMMA:** Settings → **Quit EMMA**, or close the Terminal or black window if you started it from there.

---

## 11. Your data and backup

All your data is in the **data** folder next to **app**:

| File | What it contains |
|---|---|
| `data/market.sqlite` | Companies, news, fairs, people, facts, notes. While EMMA runs you may also see `-wal` and `-shm` files. |
| `data/settings.json` | Settings and API keys, readable only by your user. Not encrypted: do not share it. |
| `data/.env` | API keys, if you put them there. |
| `data/kokoro/` | The voice model and recent audio. |
| `data/backups/` | Copies made before importing an older EMMA. |
| `data/emma.log` | The log, useful when something does not work. |

**To make a backup**, quit EMMA and copy the whole **data** folder. It contains your keys, so keep it safe.

**Updates never touch the data folder.** It is never uploaded to GitHub either (see `.gitignore`).

---

## 12. Troubleshooting

**A download does not work (VPN, proxy, company network).** The first time, EMMA downloads:

- Node.js and its libraries;
- the **local AI model** (several GB);
- the **voice model** (about 90 MB).

A **VPN**, a proxy or a company network can block or interrupt these downloads, especially the large local AI model. Typical signs are a download that stops or never ends, a "cannot connect" error, or the welcome screen saying the model is not ready. To fix it:

1. Turn off the VPN (or connect to a home network) just for the first setup.
2. Start EMMA again and repeat the step that failed (for the AI: the welcome screen, or Settings → 2 · Artificial intelligence).
3. When everything is downloaded, turn the VPN back on. The local AI and the voice then work offline.

**Other problems:**

- **"cannot be opened" (Mac) or "Windows protected your PC".** The file was downloaded with the browser and is not signed. Follow step 5–6 of [section 2](#2-install-on-a-mac-from-the-zip-alternative) or step 4 of [section 3](#3-install-on-windows), or install on the Mac with the Terminal command.
- **Mac: "EMMA did not start", or "EPERM: operation not permitted" in `data/emma.log`.** The EMMA folder is in Desktop, Documents or Downloads, which macOS protects. Move it to your home folder, or run `bash <EMMA folder>/app/assets/install-app.sh` once: it moves the folder (program and data) and rebuilds the app.
- **Nothing opens in the browser.** Check that the Terminal or black window shows *"EMMA is available at http://127.0.0.1:4317"*, then open that address yourself.
- **The local AI does not answer.** Check that Ollama is running: there is a llama icon in the menu bar (Mac) or near the clock (Windows). Then reopen the welcome screen from Settings.
- **The voice does not start.** The first time it needs the internet to download the model; see the VPN note above.
- **Still stuck?** The log is in `data/emma.log` inside the EMMA folder.

---

## 13. Limits

- Public sources give partial coverage; no service guarantees every page.
- Automatic recognition of fairs, dates and key facts can make mistakes: always check the linked source.
- AI summaries must be checked against the sources.
- Link safety is an indication, not a guarantee.

---

## 14. For developers

```bash
cd app
npm install
npm test        # node --test, about 100 tests
npm start       # http://127.0.0.1:4317
```

- Requires **Node.js 22.13 or later**, which includes the built-in SQLite database. No native database library is needed.
- Folder layout:

  ```
  EMMA/
    Start EMMA - Mac.command     starts EMMA on macOS
    Start EMMA - Windows.bat     starts EMMA on Windows
    READ ME FIRST.txt            short guide for users
    install.sh                   one-command installer for macOS
    data/                        user data (created at the first start, never on GitHub)
    app/                         the program: src, public, test, assets
  ```

- Technical notes are in `app/README.md`.
