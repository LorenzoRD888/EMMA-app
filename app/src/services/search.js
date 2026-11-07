import { webSearch as genericSearch } from '../search/providers.js';
import {auditedFetch as fetch} from "./research-audit.js";
// ═══════════════════════════════════════════════════
// Web Search Service — Brave Search API
// EMMA uses this when he needs current data:
// TDS sheets online, new products, normative updates,
// supplier info, or anything not in the knowledge base.
//
// Cost: free tier = 2000 searches/month
// Each web search = 1 Brave API call
// ═══════════════════════════════════════════════════


const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

// Perform a web search and return clean results for injection into agent context.
// `freshness` is an optional Brave freshness filter — either a shorthand
// (pd/pw/pm/py) or a custom "YYYY-MM-DDtoYYYY-MM-DD" range — used to scope
// results to a recent window (e.g. competitor-analysis recent-articles search).
export async function webSearch(query, count = 5, freshness = null) {
  if (!process.env.BRAVE_API_KEY) {
    console.warn("process.env.BRAVE_API_KEY not set — web search disabled");
    return [];
  }

  try {
    const url = new URL(BRAVE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(count, 10)));
    url.searchParams.set("search_lang", "en");
    url.searchParams.set("result_filter", "web");
    if (freshness) url.searchParams.set("freshness", freshness);

    const r = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": process.env.BRAVE_API_KEY,
      },
      signal: AbortSignal.timeout(8000), // 8s timeout
    });

    if (!r.ok) {
      console.warn("Brave search failed:", r.status);
      return [];
    }

    const data = await r.json();
    const results = data?.web?.results || [];

    return results.map(r => ({
      title:       r.title       || "",
      url:         r.url         || "",
      description: r.description || "",
    }));
  } catch (err) {
    console.warn("Web search error:", err.message);
    return [];
  }
}

// Format search results as a context string for agents
export function formatSearchResults(results, query) {
  if (!results.length) return "";
  return `\n\n=== WEB SEARCH RESULTS FOR: "${query}" ===\n` +
    results.map((r, i) =>
      `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`
    ).join("\n\n") +
    "\n=== END SEARCH RESULTS ===\n" +
    "Use these results to supplement your knowledge. Always cite the source URL when using information from search results. Never fabricate information not present in the results.";
}

// Decide if a query needs web search (called by EMMA)
// Returns the search query string if search is needed, null otherwise
export async function shouldSearch(question) {
  // Keywords that suggest web search would help
  const triggers = [
    /tds\b|data sheet|technical sheet/i,
    /price|cost|available|supplier|distributor|buy/i,
    /regulation|directive|norm|standard|iso \d|astm \d|reach|rohs|2024|2025|2026/i,
    /new product|latest|recent|current|today/i,
    /\b(cas|cas number)\b.*\d/i,
  ];
  return triggers.some(t => t.test(question));
}

// ═══════════════════════════════════════════════════
// Patent search — searches patent literature using Brave.
// Runs TWO separate queries for better coverage:
//   1. Google Patents scoped search
//   2. General patent + chemistry terms
export async function patentSearch(query, count = 5) {
  if (!process.env.BRAVE_API_KEY) return [];
  try {
    // Exact-phrase quoting forces the company/query name to actually appear,
    // rather than just contributing keyword overlap. The previous second
    // query ("${query} patent coating formulation prior art") had no such
    // constraint — it was a generic coatings-patent search that happened to
    // rank for the same terms, and returned patents with no real connection
    // to the company at all (confirmed case: a diagnostics test-strip patent
    // got attributed to a polyester film converter because both queries
    // shared unrelated keyword overlap). Dropped in favour of a second query
    // that still requires the exact name to appear, just without the
    // site: restriction, to also catch patent pages Google doesn't index
    // under patents.google.com.
    const queries = [
      `site:patents.google.com "${query}"`,
      `"${query}" patent assignee`,
    ];
    const allResults = [];
    for (const q of queries) {
      const url = new URL(BRAVE_URL);
      url.searchParams.set("q", q);
      url.searchParams.set("count", "5");
      url.searchParams.set("search_lang", "en");
      url.searchParams.set("result_filter", "web");
      const r = await fetch(url.toString(), {
        headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": process.env.BRAVE_API_KEY },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const results = data?.web?.results || [];
      allResults.push(...results.map(r => ({ title: r.title || "", url: r.url || "", description: r.description || "" })));
    }
    // Hard filter — this is the real fix: only keep a result if the company
    // name actually appears somewhere in its title or description. Without
    // this, "prioritise Google Patents results" just re-ordered irrelevant
    // matches instead of removing them, so an unrelated patent could still
    // end up in the final list and get written up as if it were confirmed.
    const nameLower = query.trim().toLowerCase();
    const seen = new Set();
    return allResults
      .filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; })
      .filter(r => (r.title + " " + r.description).toLowerCase().includes(nameLower))
      .sort((a, b) => (b.url.includes("patents.google") ? 1 : 0) - (a.url.includes("patents.google") ? 1 : 0))
      .slice(0, count);
  } catch (err) {
    console.warn("Patent search error:", err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════
// Tavily Search — used ONLY by the Competitor Intelligence pipeline
// (services/competitor-scraper.js). Chat/chemapi's general web search
// above stays on Brave — the two providers are kept fully separate, not
// swapped globally. Brave's free tier (2000/month) was getting exhausted
// during development by competitor analysis alone: a single run makes
// 17-20 Brave calls end to end (confirmed by direct audit of every fetch*
// function in competitor-scraper.js), so a handful of test runs burns
// through it fast. Tavily's free tier (1,000/month, no credit card) is a
// better fit for this specific, search-heavy feature.
//
// Deliberately mirrors webSearch()'s exact {title, url, description}
// return shape (mapping Tavily's "content" field to "description") so
// every fetch*/patentSearch caller in competitor-scraper.js needed zero
// logic changes — only which function they import as their default
// webSearchFn/patentSearchFn.
// ═══════════════════════════════════════════════════

const TAVILY_URL = "https://api.tavily.com/search";

// Brave's freshness param (a shorthand pd/pw/pm/py, or a custom
// "YYYY-MM-DDtoYYYY-MM-DD" range) has no single Tavily equivalent — Tavily
// splits this into time_range (coarse presets) vs. start_date/end_date
// (an exact range). Parsed here so every existing caller's freshness
// string (competitor-scraper.js's fetchRecentNews uses an exact 5-month
// range) keeps working unchanged.
function tavilyDateParams(freshness) {
  if (!freshness) return {};
  const rangeMatch = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/.exec(freshness);
  if (rangeMatch) return { start_date: rangeMatch[1], end_date: rangeMatch[2] };
  const shorthand = { pd: "day", pw: "week", pm: "month", py: "year" };
  return shorthand[freshness] ? { time_range: shorthand[freshness] } : {};
}

export async function tavilySearch(query, count = 5, freshness = null) {
  // Uses the web search service chosen in Settings (with its fallback), so the log shows the service really used.
    try {
      const days = { pd: 1, pw: 7, pm: 31, py: 365 }[freshness];
      const out = await genericSearch(query, { maxResults: count, recent: !!days, days: days || 7 });
      return out.map(r => ({ title: r.title || '', url: r.url || '', description: r.summary || '' }));
    } catch (err) { console.warn('Web search error:', err.message); return []; }
}

// Mirrors patentSearch()'s exact two-query/filter behavior above (same
// Google-Patents-scoped + general-assignee queries, same hard name-match
// filter guarding against the diagnostics/polyester-film misattribution
// incident documented on that function) — just against Tavily instead of
// Brave.
export async function tavilyPatentSearch(query, count = 5) {
  // Uses the web search service chosen in Settings (with its fallback), so the log shows the service really used.
    try {
      const out = [...await genericSearch(`"${query}" patent`, { maxResults: 10, domain: 'patents.google.com' }).catch(() => []), ...await genericSearch(`"${query}" patent assignee`, { maxResults: 5 }).catch(() => [])];
      const nameLower = query.trim().toLowerCase(), seen = new Set();
      return out.map(r => ({ title: r.title || '', url: r.url || '', description: r.summary || '' })).filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; }).filter(r => (r.title + ' ' + r.description).toLowerCase().includes(nameLower)).slice(0, count);
    } catch { return []; }
}

export function formatPatentResults(results, query) {
  if (!results.length) return "";
  return `\n\n=== PATENT LITERATURE FOR: "${query}" ===\n` +
    results.map((r, i) => `[P${i + 1}] ${r.title}\n${r.url}\n${r.description}`).join("\n\n") +
    `\n=== END PATENT RESULTS ===\n` +
    `Use these patents to UNDERSTAND THE REASONING — why a chemistry was chosen, what problem it solved, how the inventors approached it. Do NOT copy formulations verbatim. Extract the insight and the rationale. Always cite the patent number/URL. Note that patents in force are protected IP (typically 20 years from filing); flag whether a patent appears in force or likely expired, and remind the user to use it for understanding, not direct copying.`;
}
