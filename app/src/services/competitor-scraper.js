import {auditedFetch as fetch} from "./research-audit.js";
import { fetchExternalUrl } from "./externalFetch.js";
// ═══════════════════════════════════════════════════
// Competitor Intelligence 360° — PHASE 2: multi-source scraper.
//
// CRITICAL RULE, enforced twice over (never trust the prompt alone):
//   1. Every extraction prompt below tells the model to return NULL for
//      anything not explicitly backed by a URL in the material it was
//      given, and to never invent a number, date, or URL.
//   2. Every source_url the model returns is then cross-checked in code
//      against the actual set of URLs we supplied it (see
//      `verifiedUrl` below). A URL the model didn't get from us — even a
//      plausible-looking one — is discarded, and the fact it was
//      attached to is nulled out rather than kept "unsourced." This is
//      the same discipline schemas.js's validateCompetitorSchema enforces
//      structurally: a value without a real source is not data.
//
// Each fetch* function is independent and never throws — a failure in one
// category (Tavily down, a page unreachable, a malformed model response)
// degrades that one category to null rather than failing the whole profile.
// See buildCompetitorProfile for the orchestrator that assembles all
// categories into a single, schema-validated competitorSchema object.
// ═══════════════════════════════════════════════════
import Anthropic from "@anthropic-ai/sdk";
import { tavilySearch, tavilyPatentSearch } from "./search.js";
import { isSafeExternalUrl } from "./urlSafety.js";
import { parseJSON } from "./jsonUtils.js";
import { recordUsage } from "./tokenlog.js";
import { createEmptyCompetitorSchema, computeCompetitorConfidenceScore, computeCompetitorEnrichmentScore, ALL_COMPETITOR_CATEGORY_KEYS, competitorFactKeysForCategories } from "./schemas.js";
import { getLearnings } from "./memory.js";
import { searchUSPTOPatents, searchEPOPatents, searchWIPOPatents, namesLikelyMatch } from "./patentApis.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "not-configured" });
const EXTRACTION_MODEL = "claude-haiku-4-5-20251001"; // cheap classification/extraction tier, per this codebase's model-tiering convention

// The material handed to these prompts can be in any language (a company's
// own site is frequently scraped from a non-English locale path — e.g.
// alphafilm.example/it/ — and web search snippets can just as easily be Italian,
// German, etc.). Every field in the JSON response must still come back in
// English: descriptions, titles, and any other prose are TRANSLATED, never
// carried over verbatim in the source language. Proper nouns — a product's
// own trademarked/brand name (e.g. "Betaflex®", "Alphamat®") or a person's/
// company's name — are not translated (a brand name has no "English
// version"), only the descriptive prose around them is.
const NO_INVENT_RULE = `Extract ONLY facts explicitly present in the material below, each attached to one of the URLs given. Return NULL (not a guess, not an approximation) for any field you cannot back with a specific URL from the material. Never invent a number, date, name, or URL — if you are not looking at it in the text, it does not go in your answer. Every "source_url" you return MUST be copied verbatim from the URLs listed in the material — never construct, guess, or paraphrase a URL.

Always write every text field of your answer in English, regardless of what language the source material is in — translate, don't transcribe. The only exception is a proper noun with no English equivalent (a trademarked product/brand name, a person's name, a company name): keep those as written, but translate the descriptive text around them.`;

// ── Shared helpers ──────────────────────────────────────────────────────

async function runSearches(webSearchFn, queries, count = 6, freshness = null) {
  const seen = new Set();
  const results = [];
  for (const q of queries) {
    try {
      const r = await webSearchFn(q, count, freshness);
      for (const item of r) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        results.push(item);
      }
    } catch { /* one failed query is not fatal — the others still stand */ }
  }
  return results;
}

function formatResultsForPrompt(results) {
  return results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`).join("\n\n");
}

// The anti-hallucination cross-check described in the file header — a
// source_url is only trusted if it is byte-identical to one of the URLs we
// actually supplied. No fuzzy matching: a model that "corrects" or
// shortens a URL is exactly the failure mode this guards against.
function verifiedUrl(claimedUrl, allowedUrls) {
  return typeof claimedUrl === "string" && allowedUrls.includes(claimedUrl) ? claimedUrl : null;
}

async function extractJSON(anthropicClient, system, userContent, maxTokens = 800) {
  const result = await anthropicClient.messages.create({
    model: EXTRACTION_MODEL, max_tokens: maxTokens,
    system, messages: [{ role: "user", content: userContent }],
  });
  recordUsage(EXTRACTION_MODEL, result.usage);
  return parseJSON(result.content?.[0]?.text?.trim() || "{}", {});
}

// ═══════════════════════════════════════════════════
// 1. fetchFinancialData — revenue + employee count.
// ═══════════════════════════════════════════════════
export async function fetchFinancialData(companyName, { anthropicClient = anthropic, webSearchFn = tavilySearch } = {}) {
  const empty = { revenue: null, employee_count: null };
  try {
    const results = await runSearches(webSearchFn, [
      `"${companyName}" revenue`,
      `"${companyName}" financial results`,
      `"${companyName}" annual report`,
    ]);
    if (!results.length) return empty;
    const allowedUrls = results.map(r => r.url);

    const parsed = await extractJSON(anthropicClient,
      `You are extracting FINANCIAL facts about a company from web search snippets. ${NO_INVENT_RULE}
"unit" must describe the magnitude the SOURCE actually used — e.g. if the source says "revenue of €98.7 million", return amount:98.7, unit:"million" (do NOT expand it to 98700000 yourself). If the source already gives the full number (e.g. "€98,700,000" or "98700000 EUR"), use unit:"actual" and put the full number in amount. Never guess the unit if it's genuinely ambiguous — default to "actual" rather than assuming a magnitude the text didn't state.
Return ONLY JSON: {"revenue": {"amount": number, "unit": "actual"|"thousand"|"million"|"billion", "currency": string, "year": number} | null, "revenue_source_url": string | null, "revenue_source_name": string | null, "employee_count": number | null, "employee_count_source_url": string | null, "employee_count_source_name": string | null}`,
      `Company: ${companyName}\n\nSearch results:\n${formatResultsForPrompt(results)}`);

    const revenueUrl = verifiedUrl(parsed.revenue_source_url, allowedUrls);
    const revenueOk = revenueUrl && parsed.revenue && typeof parsed.revenue.amount === "number" && typeof parsed.revenue.currency === "string" && typeof parsed.revenue.year === "number";
    // Defaults to "actual" (never assume a magnitude) if the model omits
    // unit or returns something outside the fixed enum — this is what was
    // silently missing before: the amount alone (e.g. 98.7 from "€98.7
    // million") was kept with no record of what it was 98.7 OF, so it
    // rendered as if 98.7 were the whole revenue figure.
    const REVENUE_UNITS = ["actual", "thousand", "million", "billion"];
    const revenueUnit = REVENUE_UNITS.includes(parsed.revenue?.unit) ? parsed.revenue.unit : "actual";
    const revenue = revenueOk ? { value: { amount: parsed.revenue.amount, unit: revenueUnit, currency: parsed.revenue.currency, year: parsed.revenue.year }, source_url: revenueUrl, source_name: parsed.revenue_source_name || null } : null;

    const empUrl = verifiedUrl(parsed.employee_count_source_url, allowedUrls);
    const empOk = empUrl && typeof parsed.employee_count === "number";
    const employee_count = empOk ? { value: parsed.employee_count, source_url: empUrl, source_name: parsed.employee_count_source_name || null } : null;

    return { revenue, employee_count };
  } catch (err) {
    console.warn("fetchFinancialData failed:", err.message);
    return empty;
  }
}

// ═══════════════════════════════════════════════════
// 2. fetchHiringData — open positions + hiring trend.
// ═══════════════════════════════════════════════════
export async function fetchHiringData(companyName, { anthropicClient = anthropic, webSearchFn = tavilySearch } = {}) {
  try {
    const results = await runSearches(webSearchFn, [
      `"${companyName}" careers`,
      `"${companyName}" hiring`,
      `"${companyName}" jobs`,
      `"${companyName}" LinkedIn`,
      // Broader job-board coverage — same "open positions" data, just more
      // sources, not a separate category (see the public-presence
      // extension's design note on why this folds in here rather than
      // becoming its own schema branch).
      `"${companyName}" site:indeed.com`,
      `"${companyName}" site:glassdoor.com`,
      `"${companyName}" site:wellfound.com`,
    ]);
    if (!results.length) return null;
    const allowedUrls = results.map(r => r.url);

    // founded_year/employee_count_estimate/role_pattern_summary are best-
    // effort, read only from whatever text a search snippet happens to
    // surface — this never fetches linkedin.com or any job board directly
    // (LinkedIn's ToS prohibits scraping, and most structured profile
    // fields sit behind an authenticated, JS-rendered view a plain fetch
    // wouldn't see anyway). All frequently null, which is the honest,
    // expected outcome, not a bug — founded_year/source feed
    // computeCompanyMaturity below as one candidate signal among several,
    // not a guaranteed field.
    const parsed = await extractJSON(anthropicClient,
      `You are extracting HIRING signals about a company from web search snippets. ${NO_INVENT_RULE} A "trend" or "role_pattern_summary" judgment is only valid if clearly evidenced by MULTIPLE listings/snippets — otherwise null. role_pattern_summary describes what KIND of company the hiring pattern suggests (e.g. "Primarily ML/AI engineering roles" or "Mostly QC/manufacturing roles"), distinct from trend (which describes hiring VELOCITY/intensity, e.g. "Aggressive R&D hiring"). founded_year and employee_count_estimate should ONLY be set if a snippet explicitly states them (e.g. "Founded 2025", "11-50 employees") — never estimate or infer any of these from context.
Return ONLY JSON: {"open_positions": [{"title": string, "department": string | null, "url": string}] | null, "trend": string | null, "source_url": string | null, "founded_year": number | null, "founded_year_source_url": string | null, "employee_count_estimate": string | null, "employee_count_source_url": string | null, "role_pattern_summary": string | null}`,
      `Company: ${companyName}\n\nSearch results:\n${formatResultsForPrompt(results)}`);

    const verifiedPositions = Array.isArray(parsed.open_positions)
      ? parsed.open_positions
          .filter(p => verifiedUrl(p?.url, allowedUrls))
          .map(p => ({ title: p.title || null, department: p.department || null, url: p.url }))
      : [];

    let sourceUrl = verifiedUrl(parsed.source_url, allowedUrls);
    if (!sourceUrl && verifiedPositions.length) sourceUrl = verifiedPositions[0].url; // fall back to a position's own verified URL

    const trend = sourceUrl ? (parsed.trend || null) : null; // a trend claim with no verified source is discarded, not kept unsourced
    const role_pattern_summary = (sourceUrl && verifiedPositions.length >= 2) ? (parsed.role_pattern_summary || null) : null; // needs both a verified source AND multiple actual postings to back the pattern claim
    const open_positions = verifiedPositions.length ? verifiedPositions : null;

    const foundedYearSourceUrl = verifiedUrl(parsed.founded_year_source_url, allowedUrls);
    const founded_year = (foundedYearSourceUrl && typeof parsed.founded_year === "number") ? parsed.founded_year : null;

    const employeeCountSourceUrl = verifiedUrl(parsed.employee_count_source_url, allowedUrls);
    const employee_count_estimate = (employeeCountSourceUrl && parsed.employee_count_estimate) ? String(parsed.employee_count_estimate) : null;

    if (!open_positions && !trend && !founded_year && !employee_count_estimate) return null; // nothing survived verification

    return {
      open_positions, trend, source_url: sourceUrl, role_pattern_summary,
      founded_year, founded_year_source_url: founded_year ? foundedYearSourceUrl : null,
      employee_count_estimate, employee_count_source_url: employee_count_estimate ? employeeCountSourceUrl : null,
    };
  } catch (err) {
    console.warn("fetchHiringData failed:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// 3. fetchAcquisitions — M&A activity.
// ═══════════════════════════════════════════════════
export async function fetchAcquisitions(companyName, { anthropicClient = anthropic, webSearchFn = tavilySearch } = {}) {
  try {
    const results = await runSearches(webSearchFn, [
      `"${companyName}" acquisition`,
      `"${companyName}" merger`,
      `"${companyName}" acquired`,
    ]);
    if (!results.length) return null;
    const allowedUrls = results.map(r => r.url);

    const parsed = await extractJSON(anthropicClient,
      `You are extracting M&A (mergers & acquisitions) facts about a company from web search snippets. ${NO_INVENT_RULE}
Return ONLY JSON: {"acquisitions": [{"company_name": string, "date": string | null, "amount": string | null, "source_url": string, "source_name": string | null}] | null}`,
      `Company: ${companyName}\n\nSearch results:\n${formatResultsForPrompt(results)}`);

    const verified = Array.isArray(parsed.acquisitions)
      ? parsed.acquisitions
          .filter(a => a?.company_name && verifiedUrl(a?.source_url, allowedUrls))
          .map(a => ({ company_name: a.company_name, date: a.date || null, amount: a.amount || null, source_url: a.source_url, source_name: a.source_name || null }))
      : [];

    return verified.length ? verified : null;
  } catch (err) {
    console.warn("fetchAcquisitions failed:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// 4. fetchTechnicalCapabilities — products + technology signals, from the
// company's own site (when a URL is known/reachable) plus a web-search
// supplement — same two-source approach the pre-existing /competitor-
// analysis route already used, factored out here as the canonical version.
// ═══════════════════════════════════════════════════
async function fetchSiteText(baseUrl, fetchFn) {
  const pages = []; // { url, text }
  const urlCheck = isSafeExternalUrl(baseUrl);
  if (!urlCheck.ok) return pages;
  try {
    const r = await fetchFn(baseUrl, { headers: { "User-Agent": "Mozilla/5.0 EMMA local app" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return pages;
    const html = await r.text();
    const strip = (h) => h.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 6000);
    pages.push({ url: baseUrl, text: strip(html) });

    const domain = new URL(baseUrl).hostname;
    const linkMatches = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map(m => m[1]);
    const candidates = linkMatches
      .filter(href => /product|technolog|solution|about|company/i.test(href))
      .map(href => { try { return new URL(href, baseUrl).href; } catch { return null; } })
      .filter(href => { try { return href && new URL(href).hostname === domain; } catch { return false; } })
      .filter((href, i, arr) => arr.indexOf(href) === i)
      .slice(0, 2);

    for (const link of candidates) {
      try {
        const r2 = await fetchFn(link, { headers: { "User-Agent": "Mozilla/5.0 EMMA local app" }, signal: AbortSignal.timeout(9000) });
        if (r2.ok) pages.push({ url: link, text: strip(await r2.text()).slice(0, 5000) });
      } catch { /* a failed secondary page is not fatal */ }
    }
  } catch { /* homepage unreachable — pages stays empty, caller falls back to web search only */ }
  return pages;
}

export async function fetchTechnicalCapabilities(companyName, { url = null, anthropicClient = anthropic, webSearchFn = tavilySearch, fetchFn = fetchExternalUrl } = {}) {
  const empty = { key_products: null, technologies: null };
  try {
    const sitePages = url?.trim() ? await fetchSiteText(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`, fetchFn) : [];
    const searchResults = await runSearches(webSearchFn, [`"${companyName}" products`, `"${companyName}" technology`]);

    const allowedUrls = [...sitePages.map(p => p.url), ...searchResults.map(r => r.url)];
    if (!allowedUrls.length) return empty;

    const material = [
      ...sitePages.map(p => `=== ${p.url} ===\n${p.text}`),
      searchResults.length ? `=== Web search results ===\n${formatResultsForPrompt(searchResults)}` : "",
    ].filter(Boolean).join("\n\n");

    const parsed = await extractJSON(anthropicClient,
      `You are extracting PRODUCT and TECHNOLOGY facts about a company from its own website content and/or web search snippets. ${NO_INVENT_RULE}
Return ONLY JSON: {"key_products": [{"name": string, "description": string | null, "source_url": string}] | null, "technologies": [{"name": string, "source_url": string}] | null}`,
      `Company: ${companyName}\n\n${material}`, 1200);

    const key_products = Array.isArray(parsed.key_products)
      ? parsed.key_products.filter(p => p?.name && verifiedUrl(p?.source_url, allowedUrls)).map(p => ({ name: p.name, description: p.description || null, source_url: p.source_url }))
      : [];
    const technologies = Array.isArray(parsed.technologies)
      ? parsed.technologies.filter(t => t?.name && verifiedUrl(t?.source_url, allowedUrls)).map(t => ({ name: t.name, source_url: t.source_url }))
      : [];

    return { key_products: key_products.length ? key_products : null, technologies: technologies.length ? technologies : null };
  } catch (err) {
    console.warn("fetchTechnicalCapabilities failed:", err.message);
    return empty;
  }
}

// ═══════════════════════════════════════════════════
// 5. fetchPatents — every source below (search.js's tavilyPatentSearch,
// and patentApis.js's USPTO/EPO/WIPO functions) is individually
// responsible for verifying the company name before returning a result —
// tavilyPatentSearch/searchWIPOPatents check title+description text,
// searchUSPTOPatents checks the real assignee_organization field,
// searchEPOPatents checks the real applicant field. That per-source
// guarantee was silently broken once already: searchWIPOPatents shipped
// with NO filter at all, and searchUSPTOPatents requested but never
// checked its assignee field — both real gaps that let unrelated
// same-named companies' patents reach real reports (confirmed against a
// live contamination incident), not just a theoretical risk.
//
// The fix is the SECOND-LAYER check below, applied at this single merge
// point every source funnels through — the actual enforcement point,
// not the per-source functions alone, so a future 5th source that
// forgets its own filter can't silently reintroduce this bug the way
// searchWIPOPatents did. It only re-checks entries carrying a real title
// (the generic/WIPO sources, whose own verification IS title-text based,
// making this genuinely redundant-but-harmless defense in depth for
// them) — structured USPTO/EPO entries are deliberately NOT re-checked
// against title text here, because a patent's title almost never mentions
// its assignee company name at all (titles describe the invention, e.g.
// "Anti-corrosion coating composition") — applying a title-text check to
// them would incorrectly discard correctly-verified results. Their
// guarantee rests entirely on their own function's field-based check.
// No LLM call anywhere in this function: the patent number is only ever
// taken from a literal Google Patents URL pattern, never guessed from
// prose. `date` is null for generic/WIPO entries — neither Brave's nor
// Tavily's search snippets carry a structured date field, and free-text
// date-guessing from a snippet is exactly the kind of inference this
// feature exists to forbid.
// ═══════════════════════════════════════════════════
const GOOGLE_PATENTS_NUMBER_RE = /patents\.google\.com\/patent\/([A-Z]{2}\d+[A-Z]\d?)/i;

export async function fetchPatents(companyName, { patentSearchFn = tavilyPatentSearch, webSearchFn = tavilySearch, monthsBack = 12 } = {}) {
  try {
    const [tavilyResults, usptoResults, epoResults, wipoResults] = await Promise.allSettled([
      patentSearchFn(companyName, 6),
      searchUSPTOPatents(companyName, monthsBack),
      searchEPOPatents(companyName, monthsBack),
      searchWIPOPatents(companyName, webSearchFn),
    ]);

    // titleVerifiable: true for sources whose own verification is
    // title-text based, so the merge-point second-layer check below is a
    // genuine (harmless, redundant) extra pass for them — false for
    // sources verified via a structured identity field, where a
    // title-text re-check would be actively wrong (see header comment).
    const fromGenericSearch = (tavilyResults.status === "fulfilled" ? tavilyResults.value : []).map(r => ({
      number: GOOGLE_PATENTS_NUMBER_RE.exec(r.url || "")?.[1] || null,
      title: r.title || null,
      date: null,
      source_url: r.url || null,
      titleVerifiable: true,
    })).filter(p => p.source_url);

    const fromStructuredApis = [
      ...(usptoResults.status === "fulfilled" ? usptoResults.value.map(p => ({ ...p, titleVerifiable: false })) : []),
      ...(epoResults.status === "fulfilled" ? epoResults.value.map(p => ({ ...p, titleVerifiable: false })) : []),
      ...(wipoResults.status === "fulfilled" ? wipoResults.value.map(p => ({ ...p, titleVerifiable: true })) : []),
    ];

    // Structured (dated) entries listed first so they win the dedupe when
    // the same patent shows up in both — a real filing date beats a
    // date:null duplicate of the same number/URL.
    const seenNumbers = new Set();
    const seenUrls = new Set();
    const merged = [];
    for (const p of [...fromStructuredApis, ...fromGenericSearch]) {
      if (p.titleVerifiable && p.title && !namesLikelyMatch(p.title, companyName)) continue; // second-layer check — see header comment on why this only applies here
      const numberKey = p.number;
      if (numberKey && seenNumbers.has(numberKey)) continue;
      if (!p.source_url || seenUrls.has(p.source_url)) continue;
      if (numberKey) seenNumbers.add(numberKey);
      seenUrls.add(p.source_url);
      merged.push({ number: p.number || null, title: p.title || null, date: p.date || null, source_url: p.source_url });
    }
    return merged.length ? merged.slice(0, 12) : null;
  } catch (err) {
    console.warn("fetchPatents failed:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// 6. fetchRecentNews — a rolling 5-month window, several targeted queries
// rather than one generic one, deduped by URL. Same window/technique the
// original /competitor-analysis route used for its "recent activity"
// section. `date` is null for the same reason as fetchPatents above —
// search results carry no structured date field.
// ═══════════════════════════════════════════════════
export async function fetchRecentNews(companyName, { webSearchFn = tavilySearch } = {}) {
  try {
    const fiveMonthsAgo = new Date();
    fiveMonthsAgo.setMonth(fiveMonthsAgo.getMonth() - 5);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const freshness = `${fmt(fiveMonthsAgo)}to${fmt(new Date())}`;

    const results = await runSearches(webSearchFn, [
      `"${companyName}" news`,
      `"${companyName}" press release OR announcement`,
      `"${companyName}" study OR paper OR publication OR citation`,
      // Trade-press sources — these cover a newly founded coatings/
      // adhesives company months before general press picks it up, which
      // is exactly the early-signal case this whole feature targets.
      `"${companyName}" site:coatings.com/news`,
      `"${companyName}" site:pcimag.com/news`,
      `"${companyName}" site:adhesivesmag.com`,
    ], 8, freshness);
    if (!results.length) return null;

    return results.slice(0, 10).map(r => ({ title: r.title || null, summary: r.description || null, date: null, url: r.url }));
  } catch (err) {
    console.warn("fetchRecentNews failed:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// Public-presence enrichment categories — surfaces people who work at the
// company and what they publish online, using only legitimately
// accessible public sources: search-engine-indexed snippets via Tavily,
// never a direct authenticated-page fetch of LinkedIn/Indeed/Glassdoor/
// GitHub/Reddit/etc. Scored separately from the 8 core categories above
// (see computeCompetitorEnrichmentScore in schemas.js) — these are
// genuinely optional enrichment, not something every real company will
// have (many legitimate companies have no public GitHub org or Reddit
// mentions at all, which must not read as "this analysis is weak").
// ═══════════════════════════════════════════════════

// 7. fetchPeopleMentioned — named individuals from public LinkedIn search
// snippets and general "who works here" searches. Never fetches
// linkedin.com directly (same ToS/technical reasoning as the founded_year
// signal in fetchHiringData above) — only reads what a search engine has
// already indexed and surfaced as a snippet.
export async function fetchPeopleMentioned(companyName, { anthropicClient = anthropic, webSearchFn = tavilySearch } = {}) {
  try {
    const results = await runSearches(webSearchFn, [
      `site:linkedin.com/in "${companyName}"`,
      `"${companyName}" employees team`,
      `"${companyName}" founder CEO CTO`,
    ]);
    if (!results.length) return null;
    const allowedUrls = results.map(r => r.url);

    const parsed = await extractJSON(anthropicClient,
      `You are extracting named individuals (people, not the company itself) associated with a company from web search snippets. ${NO_INVENT_RULE} Only include a person if their name AND some role/title both appear in the material — never invent a role for a name with no stated title, and never invent a name.
Return ONLY JSON: {"people": [{"name": string, "role": string, "source_url": string}] | null}`,
      `Company: ${companyName}\n\nSearch results:\n${formatResultsForPrompt(results)}`);

    const people = Array.isArray(parsed.people)
      ? parsed.people
          .filter(p => p?.name && p?.role && verifiedUrl(p?.source_url, allowedUrls))
          .map(p => ({ name: p.name, role: p.role, source_url: p.source_url }))
      : [];
    return people.length ? people.slice(0, 10) : null;
  } catch (err) {
    console.warn("fetchPeopleMentioned failed:", err.message);
    return null;
  }
}

// 8. fetchGithubPresence — a single site-restricted search; no LLM call
// needed since a repository name/owner is read directly from the
// github.com URL structure itself, not inferred from prose (same
// "extract from the literal URL, never guess" discipline as fetchPatents'
// Google Patents number extraction above).
const GITHUB_REPO_RE = /github\.com\/([^\/\s]+\/[^\/\s?#]+)/i;

export async function fetchGithubPresence(companyName, { webSearchFn = tavilySearch } = {}) {
  try {
    const results = await webSearchFn(`site:github.com "${companyName}"`, 8);
    if (!results?.length) return null;
    const seen = new Set();
    const repos = results
      .map(r => {
        const match = GITHUB_REPO_RE.exec(r.url || "");
        if (!match) return null;
        return { repository_name: match[1], description: r.description || null, source_url: r.url };
      })
      .filter(r => r && r.repository_name && !seen.has(r.repository_name) && seen.add(r.repository_name));
    return repos.length ? repos.slice(0, 8) : null;
  } catch (err) {
    console.warn("fetchGithubPresence failed:", err.message);
    return null;
  }
}

// 9. fetchCommunityMentions — Reddit/forums/Q&A. No LLM extraction (same
// direct-mapping approach as fetchGithubPresence) — the search result's
// own title/description already IS the mention, nothing to extract.
export async function fetchCommunityMentions(companyName, { webSearchFn = tavilySearch } = {}) {
  try {
    const results = await runSearches(webSearchFn, [
      `"${companyName}" site:reddit.com`,
      `"${companyName}" forum discussion`,
      `"${companyName}" review OR experience site:quora.com`,
    ]);
    if (!results.length) return null;
    return results.slice(0, 10).map(r => ({ title: r.title || null, summary: r.description || null, source_url: r.url }));
  } catch (err) {
    console.warn("fetchCommunityMentions failed:", err.message);
    return null;
  }
}

// 10. fetchAcademicMentions — ResearchGate/arXiv/Scholar, all reached via
// Tavily's own web index (site:-restricted search), never a direct
// scrape/API call against Google Scholar's own search interface (which
// has no free API and whose ToS forbids scraping — see this feature's
// design discussion). Surfaces founder/technical backgrounds for
// research-derived companies.
export async function fetchAcademicMentions(companyName, { anthropicClient = anthropic, webSearchFn = tavilySearch } = {}) {
  try {
    const results = await runSearches(webSearchFn, [
      `"${companyName}" site:researchgate.net`,
      `"${companyName}" site:arxiv.org`,
      `"${companyName}" site:scholar.google.com`,
    ]);
    if (!results.length) return null;
    const allowedUrls = results.map(r => r.url);

    const parsed = await extractJSON(anthropicClient,
      `You are extracting academic paper mentions of a company from web search snippets. ${NO_INVENT_RULE} authors should ONLY be set if names are explicitly given in the material — never invent an author list.
Return ONLY JSON: {"papers": [{"title": string, "authors": [string] | null, "source_url": string}] | null}`,
      `Company: ${companyName}\n\nSearch results:\n${formatResultsForPrompt(results)}`);

    const papers = Array.isArray(parsed.papers)
      ? parsed.papers
          .filter(p => p?.title && verifiedUrl(p?.source_url, allowedUrls))
          .map(p => ({ title: p.title, authors: Array.isArray(p.authors) && p.authors.length ? p.authors : null, source_url: p.source_url }))
      : [];
    return papers.length ? papers.slice(0, 10) : null;
  } catch (err) {
    console.warn("fetchAcademicMentions failed:", err.message);
    return null;
  }
}

// 11. fetchRegistryInfo — real Companies House API for UK companies
// (structured, authoritative: founding date, current directors), a
// site-restricted Tavily search fallback for IT/FR/DE and any company
// Companies House doesn't have. Companies House is tried FIRST regardless
// of the given URL/name (a name search there is cheap and works even when
// a UK company was given a .com URL) — falling through to the Tavily
// multi-registry search only if it finds no match.
// ═══════════════════════════════════════════════════

const COMPANIES_HOUSE_BASE = "https://api.company-information.service.gov.uk";

async function tryCompaniesHouseRegistry(companyName) {
  if (!process.env.COMPANIES_HOUSE_API_KEY || !companyName?.trim()) return null;
  try {
    const authHeader = "Basic " + Buffer.from(`${process.env.COMPANIES_HOUSE_API_KEY}:`).toString("base64");
    const searchRes = await fetch(`${COMPANIES_HOUSE_BASE}/search/companies?q=${encodeURIComponent(companyName.trim())}&items_per_page=5`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(8000),
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const items = searchData?.items || [];
    if (!items.length) return null;

    // Prefer an exact (case-insensitive) name match; otherwise the top
    // search result, same as Companies House's own relevance ranking.
    const nameLower = companyName.trim().toLowerCase();
    const best = items.find(i => (i.title || "").toLowerCase() === nameLower) || items[0];
    const companyNumber = best?.company_number;
    if (!companyNumber) return null;

    const [profileRes, officersRes] = await Promise.all([
      fetch(`${COMPANIES_HOUSE_BASE}/company/${companyNumber}`, { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(8000) }),
      fetch(`${COMPANIES_HOUSE_BASE}/company/${companyNumber}/officers`, { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(8000) }),
    ]);
    if (!profileRes.ok) return null;
    const profile = await profileRes.json();

    let directors = null;
    if (officersRes.ok) {
      const officersData = await officersRes.json();
      const current = (officersData?.items || []).filter(o => !o.resigned_on && o.officer_role === "director");
      directors = current.length ? current.map(o => o.name).filter(Boolean) : null;
    }

    return {
      country: "UK",
      registry_name: "Companies House",
      founding_date: profile.date_of_creation || null,
      directors,
      capital: null, // not exposed by the basic company-profile endpoint used here — left honestly null, not guessed
      source_url: `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}`,
    };
  } catch (err) {
    console.warn("Companies House lookup failed:", err.message);
    return null;
  }
}

const REGISTRY_DOMAINS = { FR: "infogreffe.fr", DE: "handelsregister.de", IT: "registroimprese.it" };

async function tryTavilyRegistrySearch(companyName, webSearchFn, anthropicClient) {
  if (!companyName?.trim() || !webSearchFn) return null;
  for (const [country, domain] of Object.entries(REGISTRY_DOMAINS)) {
    try {
      const results = await webSearchFn(`"${companyName.trim()}" site:${domain}`, 3);
      if (!results?.length) continue;

      const parsed = await extractJSON(anthropicClient,
        `This is a search result snippet from a national company registry (${domain}). Extract ONLY facts explicitly stated in the snippet. ${NO_INVENT_RULE}
Return ONLY JSON: {"founding_date": string | null, "directors": [string] | null, "capital": string | null}`,
        formatResultsForPrompt(results), 300);

      return {
        country,
        registry_name: domain,
        founding_date: parsed.founding_date || null,
        directors: Array.isArray(parsed.directors) && parsed.directors.length ? parsed.directors : null,
        capital: parsed.capital || null,
        source_url: results[0].url,
      };
    } catch { /* this registry failed/found nothing — try the next one */ }
  }
  return null;
}

export async function fetchRegistryInfo(companyName, { anthropicClient = anthropic, webSearchFn = tavilySearch } = {}) {
  const fromCompaniesHouse = await tryCompaniesHouseRegistry(companyName);
  if (fromCompaniesHouse) return fromCompaniesHouse;
  return await tryTavilyRegistrySearch(companyName, webSearchFn, anthropicClient);
}

// ═══════════════════════════════════════════════════
// Company identification / anchor-search disambiguation — the pre-flight
// step that runs BEFORE any paid analysis, when the caller has a company
// name but no URL. Its only job is to resolve a possibly-ambiguous name to
// one specific, real company URL with genuine confidence — never to
// extract financial/hiring/technical data itself (that's still entirely
// buildCompetitorProfile's job, run afterward, unchanged, once a URL is
// confirmed). Same anti-fabrication discipline as every fetch* above: the
// model only ever picks from real search results, and any URL it returns is
// cross-checked against what was actually supplied before being trusted —
// see verifiedUrl below.
// ═══════════════════════════════════════════════════

// Coarse hub -> industry-guess keyword mapping, used only to bias the
// anchor search toward the user's own domain when no explicit context is
// given (e.g. a Memory full of resin/formulation nodes should search for
// "coatings" companies, not guess blindly). Never shown to the user or
// treated as a fact about the company itself — purely a search-query bias.
const HUB_INDUSTRY_HINTS = {
  resins: "coatings resin manufacturer",
  crosslinkers: "coatings chemical manufacturer",
  additives: "specialty chemical additives",
  pigments: "pigments coatings manufacturer",
  formulations: "coatings formulation company",
  processes: "industrial coatings manufacturer",
  equipment: "coatings equipment manufacturer",
  defects: "coatings manufacturer",
  regulations: "chemical manufacturer",
  patents: "chemical technology company",
  competitor: "coatings industry",
  general: "industrial manufacturer",
};

async function guessIndustryHints(userId, { getLearningsFn = getLearnings } = {}) {
  if (!userId) return [];
  try {
    const nodes = await getLearningsFn(userId);
    if (!nodes.length) return [];
    const counts = {};
    for (const n of nodes) { if (n.hub) counts[n.hub] = (counts[n.hub] || 0) + 1; }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([hub]) => HUB_INDUSTRY_HINTS[hub])
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return []; // no Memory signal available — callers fall back to a generic query, never a fabricated guess
  }
}

function buildIdentifyPrompt(companyName, formattedResults) {
  return `You are identifying which REAL company (among the search results below) a user means by "${companyName}". ${NO_INVENT_RULE}

Decide one of three outcomes:
- "confirmed": ONE company is clearly the best match — a real business with a real website, clearly the most prominent/relevant result for this name.
- "ambiguous": 2-4 DIFFERENT real companies plausibly match this name (genuine ambiguity — same or very similar name, different businesses). List the most likely first.
- "none": nothing in the results is a clear, real company match for this name.

Every name/url/description you return MUST come directly from one of the numbered results below. url must be copied verbatim from that result's "URL:" line — never construct, guess, or shorten a URL. description is a one-sentence honest summary of what that result actually says the company does — never invented or assumed. matchedKeyword is the query label shown before that result's group, copied verbatim.

Return ONLY this JSON shape, no markdown, no explanation:
{"status":"confirmed","match":{"name":"","url":"","description":""}}
or
{"status":"ambiguous","candidates":[{"name":"","url":"","description":"","matchedKeyword":""}]}
or
{"status":"none"}

Search results:
${formattedResults}`;
}

export async function identifyCompanyUrl(companyName, { context = null, userId = null, webSearchFn = tavilySearch, anthropicClient = anthropic, getLearningsFn = getLearnings } = {}) {
  const name = (companyName || "").trim();
  if (!name) return { status: "none" };

  let queries; // [{ label, query }]
  if (context?.trim()) {
    const ctx = context.trim();
    const hints = await guessIndustryHints(userId, { getLearningsFn });
    const industry = hints[0] || "";
    queries = [
      { label: ctx, query: `"${name}" ${ctx}` },
      { label: `${ctx}, LinkedIn`, query: `"${name}" ${ctx} site:linkedin.com` },
    ];
    if (industry) queries.push({ label: `${ctx}, ${industry}`, query: `"${name}" ${ctx} ${industry}` });
  } else {
    // No anchor provided — bias toward the user's own likely industry
    // (from Memory) instead of a blind guess. If Memory has no signal
    // either (new user, empty tree), fall back to one plain query rather
    // than fabricating an industry that isn't actually known.
    const hints = await guessIndustryHints(userId, { getLearningsFn });
    const guesses = hints.length ? hints : [""];
    queries = guesses.slice(0, 3).map(g => ({ label: g || "general search", query: g ? `"${name}" ${g}` : `"${name}" company` }));
  }

  const perQuery = await Promise.allSettled(
    queries.map(async ({ label, query }) => ({ label, results: await webSearchFn(query, 5) }))
  );

  const grouped = [];
  const seenUrls = new Set();
  for (const r of perQuery) {
    if (r.status !== "fulfilled") continue;
    const { label, results } = r.value;
    for (const item of results || []) {
      if (!item.url || seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      grouped.push({ ...item, matchedLabel: label });
    }
  }
  if (!grouped.length) return { status: "none" };

  const formatted = grouped
    .map((r, i) => `[${i + 1}] (from query: "${r.matchedLabel}")\n${r.title}\nURL: ${r.url}\n${r.description}`)
    .join("\n\n");

  const allowedUrls = new Set(grouped.map(g => g.url));
  const verifiedUrl = (u) => (u && allowedUrls.has(u)) ? u : null;

  try {
    const result = await anthropicClient.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: buildIdentifyPrompt(name, formatted) }],
    });
    recordUsage(EXTRACTION_MODEL, result.usage);
    const raw = result.content?.map(b => b.text || "").join("") || "{}";
    const parsed = parseJSON(raw, { status: "none" });

    if (parsed.status === "confirmed" && parsed.match) {
      const url = verifiedUrl(parsed.match.url);
      // A URL the model didn't actually get from us is discarded outright
      // (never "trusted anyway") — same rule as every fetch* function's
      // source_url cross-check. Downgrading to "none" here is the honest
      // outcome, not a silent guess dressed up as confidence.
      if (!url) return { status: "none" };
      return { status: "confirmed", url, name: parsed.match.name || name, description: parsed.match.description || "" };
    }
    if (parsed.status === "ambiguous" && Array.isArray(parsed.candidates)) {
      const candidates = parsed.candidates
        .map(c => ({ name: c.name || name, url: verifiedUrl(c.url), description: c.description || "", matchedKeyword: c.matchedKeyword || "" }))
        .filter(c => c.url)
        .slice(0, 4);
      return candidates.length ? { status: "ambiguous", candidates } : { status: "none" };
    }
    return { status: "none" };
  } catch (err) {
    console.warn("identifyCompanyUrl: extraction failed:", err.message);
    return { status: "none" };
  }
}

// ═══════════════════════════════════════════════════
// Aggregator-URL detection — a direct URL normally skips identifyCompanyUrl
// entirely ("the user already told us exactly which company"), but a URL
// on one of these domains is a THIRD-PARTY page ABOUT a company, not the
// company's own site — confirmed root cause of a real incident: a direct
// Preqin profile URL anchored only the technical/products category (the
// one category that actually uses the given URL), while every other
// category still searched the bare, unanchored company name and mixed in
// several unrelated same-named companies. A hint, not a confirmed identity.
// ═══════════════════════════════════════════════════
const AGGREGATOR_DOMAINS = ["preqin.com", "crunchbase.com", "linkedin.com", "tracxn.com", "pitchbook.com", "owler.com"];

function isAggregatorUrl(url) {
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    return AGGREGATOR_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Resolves a possibly-aggregator URL into a real, usable anchor before the
// rest of buildCompetitorProfile runs. Non-aggregator URLs pass through
// completely unchanged (zero extra cost, zero behavior change) — this only
// does anything when the fast isAggregatorUrl check actually matches.
async function resolveAggregatorUrl(companyName, url, { anthropicClient = anthropic, webSearchFn = tavilySearch, userId = null, fetchFn = fetchExternalUrl } = {}) {
  const passthrough = { effectiveName: companyName, effectiveUrl: url, aggregatorDetected: false, aggregatorSourceUrl: null };
  if (!url || !isAggregatorUrl(url)) return passthrough;

  // Extract the company name from the aggregator page itself when
  // possible — the page content is a more specific signal than whatever
  // name (or, worse, the aggregator's own hostname as a route-level
  // fallback) was already in hand. Same NO_INVENT_RULE discipline as
  // every other extraction here: falls back to the given companyName,
  // never invents one.
  let effectiveName = companyName;
  try {
    const baseUrl = url.startsWith("http") ? url : `https://${url}`;
    const pages = await fetchSiteText(baseUrl, fetchFn);
    const pageText = pages[0]?.text;
    if (pageText) {
      const parsed = await extractJSON(anthropicClient,
        `This is text scraped from a third-party company database/aggregator profile page (e.g. Preqin, Crunchbase, LinkedIn). Identify ONLY the specific company/entity this profile page is actually about. ${NO_INVENT_RULE}
Return ONLY JSON: {"company_name": string | null}`,
        `Page text:\n${pageText.slice(0, 3000)}`, 200);
      if (parsed.company_name && typeof parsed.company_name === "string" && parsed.company_name.trim()) {
        effectiveName = parsed.company_name.trim();
      }
    }
  } catch (err) {
    console.warn("resolveAggregatorUrl: name extraction failed:", err.message);
  }

  // Now run the same disambiguation search a name-only submission would
  // have gone through, using the (possibly refined) name — no separate
  // user-facing confirmation round-trip here (the user already committed
  // to this analysis by submitting a URL and spending the credit); a
  // confident match is used directly, anything less falls back to a bare
  // name search rather than guessing among candidates.
  const identified = await identifyCompanyUrl(effectiveName, { userId, webSearchFn, anthropicClient });
  const effectiveUrl = identified.status === "confirmed" ? identified.url : null;

  return { effectiveName, effectiveUrl, aggregatorDetected: true, aggregatorSourceUrl: url };
}

// ═══════════════════════════════════════════════════
// 12. computeCompanyMaturity — early-signal detection. Derives an honest
// maturity classification from real dates already found in the other
// categories: a registry founding date (Companies House or the national-
// registry search fallback — the single most authoritative source, see
// below), patent filing dates (USPTO/EPO structured sources only — WIPO's
// site-search fallback and the generic Google Patents search never carry
// a real date), and a LinkedIn-sourced founded_year. recent_news dates
// are deliberately NOT used here: search snippets carry no structured
// date field (see fetchRecentNews's own comment), so "a news article
// turned up within the last 5 months" says nothing about how OLD the
// company is, only that it was mentioned recently — using it as an age
// signal would be exactly the kind of unsourced inference this whole
// pipeline exists to forbid.
//
// registry_info.founding_date, when present, is used DIRECTLY rather than
// competing on raw "earliest wins" with patent/LinkedIn dates — a
// government registry filing is legally authoritative; a patent or
// LinkedIn signal that appears to predate it would mean that signal is
// misattributed to a different entity, not evidence the company is
// actually older. Absent a registry date, classification falls back to
// the EARLIEST (oldest) verified date across patents/LinkedIn, since
// that's a genuine lower bound on how long the company has existed — a
// company can't have filed a patent before it existed. No usable date at
// all -> "unverified", the honest default, not a guess.
// ═══════════════════════════════════════════════════
function yearsSince(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function classifyByAge(age) {
  return age >= 5 ? "established" : age >= 1 ? "growth_stage" : "early_stage";
}

export function computeCompanyMaturity(schema) {
  const empty = { classification: "unverified", earliest_signal_date: null, earliest_signal_source: null, earliest_signal_type: null };

  if (schema.registry_info?.founding_date) {
    const age = yearsSince(schema.registry_info.founding_date);
    if (age != null) {
      return { classification: classifyByAge(age), earliest_signal_date: schema.registry_info.founding_date, earliest_signal_source: schema.registry_info.source_url, earliest_signal_type: "registry" };
    }
  }

  const candidates = [];
  for (const p of schema.patents || []) {
    if (p.date) candidates.push({ date: p.date, source: p.source_url, type: "patent" });
  }
  if (schema.hiring_activity?.founded_year) {
    candidates.push({ date: `${schema.hiring_activity.founded_year}-01-01`, source: schema.hiring_activity.founded_year_source_url, type: "linkedin" });
  }
  if (!candidates.length) return empty;

  candidates.sort((a, b) => new Date(a.date) - new Date(b.date));
  const earliest = candidates[0];
  const age = yearsSince(earliest.date);
  if (age == null) return empty;

  return { classification: classifyByAge(age), earliest_signal_date: earliest.date, earliest_signal_source: earliest.source, earliest_signal_type: earliest.type };
}

// ═══════════════════════════════════════════════════
// 13. checkCrossSourceConsistency — the automated equivalent of a human
// analyst noticing "wait, these don't describe the same company" after 30
// seconds of reading. Each of the categories above is independently
// searched by bare company name (or a company-URL-scraped page, when one
// was given) with no cross-category anchoring — a common/ambiguous name
// can pull in genuinely different companies per category with nothing
// upstream to catch it (confirmed root cause of a real incident: a
// direct-URL "sinexus" analysis silently mixed data from four unrelated
// companies — AI/GPU, UK clinical trials, antifungals, and eyewear —
// because the given URL was a third-party aggregator page, not the
// company's own site, so it anchored only the technical/products category
// while every other category still searched the bare, unanchored name).
//
// One Haiku call, run only when there's actually more than one category
// with real data to cross-check (nothing to compare otherwise — skip the
// call rather than spend it for no reason). Never blocks the report: a
// failure here just means no consistency signal, same fail-open pattern
// as every fetch* above — an unrun check is honestly "unknown," not a
// false "consistent."
// ═══════════════════════════════════════════════════
function summarizeForConsistencyCheck(schema) {
  const lines = [];
  if (schema.acquisitions?.length) lines.push(`Acquisitions: ${schema.acquisitions.map(a => a.company_name).filter(Boolean).join("; ")}`);
  if (schema.key_products?.length) lines.push(`Products: ${schema.key_products.map(p => p.name).filter(Boolean).join("; ")}`);
  if (schema.technologies?.length) lines.push(`Technologies: ${schema.technologies.map(t => t.name).filter(Boolean).join("; ")}`);
  if (schema.patents?.length) lines.push(`Patents: ${schema.patents.map(p => p.title).filter(Boolean).join("; ")}`);
  if (schema.recent_news?.length) lines.push(`News headlines: ${schema.recent_news.map(n => n.title).filter(Boolean).join("; ")}`);
  if (schema.hiring_activity?.trend) lines.push(`Hiring trend: ${schema.hiring_activity.trend}`);
  if (schema.hiring_activity?.open_positions?.length) lines.push(`Open positions: ${schema.hiring_activity.open_positions.map(p => p.title).filter(Boolean).join("; ")}`);
  if (schema.hiring_activity?.role_pattern_summary) lines.push(`Hiring role pattern: ${schema.hiring_activity.role_pattern_summary}`);
  if (schema.people_mentioned?.length) lines.push(`People: ${schema.people_mentioned.map(p => `${p.name} (${p.role})`).join("; ")}`);
  if (schema.github_presence?.length) lines.push(`GitHub repositories: ${schema.github_presence.map(g => g.repository_name).filter(Boolean).join("; ")}`);
  if (schema.academic_mentions?.length) lines.push(`Academic papers: ${schema.academic_mentions.map(a => a.title).filter(Boolean).join("; ")}`);
  if (schema.registry_info?.registry_name) lines.push(`Registry: ${schema.registry_info.registry_name}${schema.registry_info.country ? ` (${schema.registry_info.country})` : ""}`);
  return lines;
}

export async function checkCrossSourceConsistency(companyName, schema, { anthropicClient = anthropic } = {}) {
  const lines = summarizeForConsistencyCheck(schema);
  if (lines.length < 2) return null; // fewer than 2 populated categories — nothing to cross-check

  try {
    const parsed = await extractJSON(anthropicClient,
      `You are checking whether the data points below, all supposedly about ONE company, plausibly describe the SAME real company — or whether they look like they were mixed together from different companies that happen to share a similar name (a real, known failure mode of automated company-name search).

Look for categorical mismatches: wildly different industries/sectors, technologies or products that have nothing to do with each other, acquisitions or patents that belong to an obviously different kind of business. Minor inconsistency (a large company with genuinely diverse product lines) is normal and NOT a mismatch — only flag a CLEAR, categorical mismatch a human would notice immediately (e.g. semiconductor patents next to pharmaceutical clinical-trial news).

Return ONLY JSON: {"consistent": boolean, "reasoning": string | null} — reasoning explains the mismatch in one sentence, only when consistent is false; null when consistent is true.`,
      `Company being profiled: ${companyName}\n\n${lines.join("\n")}`,
      300);

    if (typeof parsed.consistent !== "boolean") return null; // malformed response — no signal, not a false negative
    return { consistent: parsed.consistent, reasoning: parsed.consistent ? null : (parsed.reasoning || null) };
  } catch (err) {
    console.warn("checkCrossSourceConsistency failed:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// Orchestrator — runs all 6 categories in parallel (one category's failure
// never blocks the others, via allSettled) and assembles a single,
// schema-shaped, confidence-scored competitorSchema object. Caller is
// responsible for running validateCompetitorSchema on the result before
// persisting/serving it — this function does not throw on validation
// failure, it just returns the best object it could honestly build.
//
// `categories` (default: all 6 keys from schemas.js's COMPETITOR_CATEGORIES)
// lets a caller run only a subset — the frontend's category-selection
// checkboxes (see routes/competitorIntel.js's /analyze). Excluded
// categories' fetchers are never invoked at all (Promise.resolve(null) in
// their place below), not just hidden from the response afterward — the
// whole point is skipping the actual Tavily/Anthropic calls to save cost.
// Every existing caller (scheduler.js's tickCompetitorRefresh, tests) omits
// this option and gets today's unchanged full-spectrum behavior.
// ═══════════════════════════════════════════════════
export async function buildCompetitorProfile(companyName, { url = null, userId = null, categories = ALL_COMPETITOR_CATEGORY_KEYS, anthropicClient = anthropic, webSearchFn = tavilySearch, patentSearchFn = tavilyPatentSearch, fetchFn = fetchExternalUrl } = {}) {
  let name = (companyName || "").trim();
  const schema = createEmptyCompetitorSchema();
  schema.company_name = name || null;
  if (!name) return schema;

  const enabled = new Set(categories);
  const skippedCategories = ALL_COMPETITOR_CATEGORY_KEYS.filter(k => !enabled.has(k));
  schema.skipped_categories = skippedCategories;

  // Aggregator-URL resolution — see resolveAggregatorUrl's own header for
  // why this exists. A no-op (returns url/name unchanged) for the common
  // case of a real company-site URL or no URL at all.
  const resolved = await resolveAggregatorUrl(name, url, { anthropicClient, webSearchFn, userId, fetchFn });
  name = resolved.effectiveName;
  url = resolved.effectiveUrl;
  schema.company_name = name;
  if (resolved.aggregatorDetected) {
    schema.aggregator_warning = "Analysis anchored on aggregator data — verify company identity before relying on results.";
  }

  const [financial, hiring, acquisitions, technical, patents, recentNews, people, github, community, academic, registry] = await Promise.allSettled([
    enabled.has("financial")       ? fetchFinancialData(name, { anthropicClient, webSearchFn })                    : Promise.resolve(null),
    enabled.has("news_hiring")     ? fetchHiringData(name, { anthropicClient, webSearchFn })                       : Promise.resolve(null),
    enabled.has("news_hiring")     ? fetchAcquisitions(name, { anthropicClient, webSearchFn })                     : Promise.resolve(null),
    enabled.has("technical")       ? fetchTechnicalCapabilities(name, { url, anthropicClient, webSearchFn, fetchFn }) : Promise.resolve(null),
    enabled.has("patents")         ? fetchPatents(name, { patentSearchFn, webSearchFn })                           : Promise.resolve(null),
    enabled.has("news_hiring")     ? fetchRecentNews(name, { webSearchFn })                                        : Promise.resolve(null),
    enabled.has("public_presence") ? fetchPeopleMentioned(name, { anthropicClient, webSearchFn })                  : Promise.resolve(null),
    enabled.has("public_presence") ? fetchGithubPresence(name, { webSearchFn })                                    : Promise.resolve(null),
    enabled.has("public_presence") ? fetchCommunityMentions(name, { webSearchFn })                                 : Promise.resolve(null),
    enabled.has("public_presence") ? fetchAcademicMentions(name, { anthropicClient, webSearchFn })                 : Promise.resolve(null),
    enabled.has("public_presence") ? fetchRegistryInfo(name, { anthropicClient, webSearchFn })                     : Promise.resolve(null),
  ]);

  // `r.value != null` (not just `status === "fulfilled"`) — a skipped
  // category's placeholder promise (Promise.resolve(null) above) fulfills
  // with null, same as a genuine "nothing found," so it must fall back to
  // the same default shape a rejection would produce.
  const settled = (r, fallback) => (r.status === "fulfilled" && r.value != null ? r.value : fallback);

  const fin = settled(financial, { revenue: null, employee_count: null });
  if (fin.revenue) schema.revenue = fin.revenue;
  if (fin.employee_count) schema.employee_count = fin.employee_count;

  const hiringResult = settled(hiring, null);
  if (hiringResult) schema.hiring_activity = hiringResult;

  const acqResult = settled(acquisitions, null);
  if (acqResult?.length) schema.acquisitions = acqResult;

  const tech = settled(technical, { key_products: null, technologies: null });
  if (tech.key_products?.length) schema.key_products = tech.key_products;
  if (tech.technologies?.length) schema.technologies = tech.technologies;

  const patentsResult = settled(patents, null);
  if (patentsResult?.length) schema.patents = patentsResult;

  const newsResult = settled(recentNews, null);
  if (newsResult?.length) schema.recent_news = newsResult;

  const peopleResult = settled(people, null);
  if (peopleResult?.length) schema.people_mentioned = peopleResult;

  const githubResult = settled(github, null);
  if (githubResult?.length) schema.github_presence = githubResult;

  const communityResult = settled(community, null);
  if (communityResult?.length) schema.community_mentions = communityResult;

  const academicResult = settled(academic, null);
  if (academicResult?.length) schema.academic_mentions = academicResult;

  const registryResult = settled(registry, null);
  if (registryResult) schema.registry_info = registryResult;

  // Unlike every other category, "maturity" excluded doesn't skip a
  // network call (computeCompanyMaturity is a free derivation over data
  // fetched above) — this is purely "the user doesn't want this field in
  // the report," honored the same explicit way as any other exclusion.
  schema.company_maturity = enabled.has("maturity") ? computeCompanyMaturity(schema) : null;
  const attemptedFactKeys = competitorFactKeysForCategories(ALL_COMPETITOR_CATEGORY_KEYS.filter(k => enabled.has(k) && k !== "public_presence"));
  const attemptedEnrichmentKeys = enabled.has("public_presence") ? competitorFactKeysForCategories(["public_presence"]) : [];
  schema.confidence_score = computeCompetitorConfidenceScore(schema, attemptedFactKeys);
  schema.enrichment_score = computeCompetitorEnrichmentScore(schema, attemptedEnrichmentKeys);
  schema.consistency_check = await checkCrossSourceConsistency(name, schema, { anthropicClient });
  schema.last_updated = new Date().toISOString();
  return schema;
}
