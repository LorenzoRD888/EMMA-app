import {auditedFetch as fetch} from "./research-audit.js";
// ═══════════════════════════════════════════════════
// Structured patent-office search — USPTO (PatentsView, real free API),
// EPO (Open Patent Services, real API, needs a free registered developer
// account), and WIPO (PatentScope's programmatic API is a paid 2,000 CHF/
// year subscription — not used here; searchWIPOPatents instead falls back
// to a site-restricted web search of patentscope.wipo.int's public pages,
// same pattern as the existing Google Patents query in search.js).
//
// Why this exists separately from search.js's tavilySearch/patentSearch:
// those are generic web-search wrappers with a uniform {title, url,
// description} shape; USPTO and EPO are genuine structured APIs with real
// filing dates, inventor names, and assignee data — worth their own
// parsing rather than flattening into a generic search-result shape.
//
// Every function here follows the same contract as every fetch* in
// competitor-scraper.js: never throws, degrades to an empty array on any
// failure (missing credentials, network error, malformed response,
// unexpected schema) — a caller can always Promise.allSettled these
// alongside the rest of buildCompetitorProfile without special-casing.
// ═══════════════════════════════════════════════════


const PATENTSVIEW_URL = "https://search.patentsview.org/api/v1/patent/";



const EPO_OPS_TOKEN_URL = "https://ops.epo.org/3.2/auth/accesstoken";
const EPO_OPS_SEARCH_URL = "https://ops.epo.org/3.2/rest-services/published-data/search";

function isoDateMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// Shared hard-filter helper — the Alphafilm-incident guarantee, applied at
// the source for every patent search function here (searchWIPOPatents
// previously had NO equivalent check at all; searchUSPTOPatents requested
// the assignee field but silently discarded it instead of checking it —
// both real gaps, not just theoretical ones, confirmed against a live
// contamination incident). Normalizes common corporate suffixes so
// "Acme Coatings" still matches an assignee/title recorded as "Acme
// Coatings, LLC" or "ACME COATINGS INC" — a real name still has to be
// present, this only tolerates legal-entity-suffix noise, never a
// genuinely different name.
export function namesLikelyMatch(candidate, companyName) {
  const norm = (s) => (s || "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co|company|plc|sa|srl|spa)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const c = norm(candidate);
  const q = norm(companyName);
  return !!c && !!q && (c.includes(q) || q.includes(c));
}

// ── USPTO (PatentsView) ─────────────────────────────────────────────────
// Structured query DSL: {"_and":[{"_text_any":{"assignees.assignee_organization": name}}, {"_gte":{"patent_date": since}}]}
// _text_any does a fuzzy/keyword match rather than requiring an exact
// legal-entity-name match, since a company's colloquial name rarely
// matches its exact assignee-of-record string (e.g. "Acme Coatings" vs
// "ACME COATINGS LLC"). Real filing dates and inventor names come back
// directly from the API — never guessed or extracted via an LLM.
export async function searchUSPTOPatents(companyName, monthsBack = 12) {
  if (!process.env.PATENTSVIEW_API_KEY || !companyName?.trim()) return [];
  try {
    const body = {
      q: {
        _and: [
          { _text_any: { "assignees.assignee_organization": companyName.trim() } },
          { _gte: { patent_date: isoDateMonthsAgo(monthsBack) } },
        ],
      },
      f: ["patent_id", "patent_title", "patent_date", "assignees.assignee_organization", "inventors.inventor_name_last", "inventors.inventor_name_first"],
      s: [{ patent_date: "desc" }],
      o: { size: 10 },
    };
    const r = await fetch(PATENTSVIEW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": process.env.PATENTSVIEW_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.warn("USPTO PatentsView search failed:", r.status); return []; }
    const data = await r.json();
    const patents = Array.isArray(data?.patents) ? data.patents : [];
    return patents
      .map(p => {
        // assignees is an array (a patent can have multiple) — take every
        // assignee_organization string present, any one of them matching
        // is enough.
        const assigneeNames = Array.isArray(p.assignees) ? p.assignees.map(a => a?.assignee_organization).filter(Boolean) : [];
        return {
          number: p.patent_id || null,
          title: p.patent_title || null,
          date: p.patent_date || null,
          source_url: p.patent_id ? `https://patents.google.com/patent/US${p.patent_id}` : null,
          inventors: Array.isArray(p.inventors) ? p.inventors.map(i => [i.inventor_name_first, i.inventor_name_last].filter(Boolean).join(" ")).filter(Boolean) : [],
          _assigneeNames: assigneeNames,
        };
      })
      // The actual fix: _text_any is a fuzzy relevance match, not a hard
      // constraint — PatentsView can and does return results whose real
      // assignee_organization doesn't match the query at all. This is the
      // field PatentsView itself returns for exactly this purpose (it was
      // requested in `f` above but previously never checked) — a real
      // identity field, not a title-text heuristic, and the correct check
      // for a structured source like this.
      .filter(p => p.number && p.source_url && p._assigneeNames.some(a => namesLikelyMatch(a, companyName)))
      .map(({ _assigneeNames, ...p }) => p);
  } catch (err) {
    console.warn("USPTO PatentsView search error:", err.message);
    return [];
  }
}

// ── EPO (Open Patent Services) ──────────────────────────────────────────
let epoTokenCache = null; // { token, expiresAt } — avoid re-authenticating on every call within the same process

async function getEpoAccessToken() {
  if (!process.env.EPO_OPS_CLIENT_ID || !process.env.EPO_OPS_CLIENT_SECRET) return null;
  if (epoTokenCache && epoTokenCache.expiresAt > Date.now()) return epoTokenCache.token;
  try {
    const basicAuth = Buffer.from(`${process.env.EPO_OPS_CLIENT_ID}:${process.env.EPO_OPS_CLIENT_SECRET}`).toString("base64");
    const r = await fetch(EPO_OPS_TOKEN_URL, {
      method: "POST",
      headers: { "Authorization": `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { console.warn("EPO OPS auth failed:", r.status); return null; }
    const data = await r.json();
    if (!data.access_token) return null;
    // expires_in is in seconds; refresh a minute early to be safe.
    epoTokenCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 1200) - 60) * 1000 };
    return epoTokenCache.token;
  } catch (err) {
    console.warn("EPO OPS auth error:", err.message);
    return null;
  }
}

// pa="..." in the CQL query below is a real structured-field constraint
// EPO's own server enforces (unlike WIPO's/Tavily's soft quoted-phrase
// heuristic), so this is already less exposed to the contamination
// pattern than searchWIPOPatents was. Still worth a client-side re-check
// as defense-in-depth (and consistency with USPTO's assignee check
// above) — this uses the /search/biblio endpoint variant specifically so
// applicant names are actually present in the response to check against.
//
// EPO OPS's exact biblio-response JSON schema has not been verified
// against a live response (no registered credentials available at
// implementation time — see the .env.example comment). Deliberately
// fails CLOSED here: if an entry's applicant name can't be found at any
// of the plausible field paths below, that entry is excluded rather than
// passed through unchecked — under-returning (fewer patents than exist)
// is the safe failure mode, over-returning (an unverified/wrong patent)
// is not. If EPO results come back empty in practice once real
// credentials are added, these field paths are the first thing to check
// against an actual response.
export async function searchEPOPatents(companyName, monthsBack = 12) {
  if (!companyName?.trim()) return [];
  const token = await getEpoAccessToken();
  if (!token) return [];
  try {
    const since = isoDateMonthsAgo(monthsBack).replace(/-/g, "");
    const cql = `pa="${companyName.trim()}" AND pd within "${since}-${new Date().toISOString().slice(0,10).replace(/-/g,"")}"`;
    const url = `${EPO_OPS_SEARCH_URL}/biblio?q=${encodeURIComponent(cql)}&Range=1-10`;
    const r = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.warn("EPO OPS search failed:", r.status); return []; }
    const data = await r.json();
    const docs = data?.["ops:world-patent-data"]?.["ops:biblio-search"]?.["ops:search-result"]?.["exchange-documents"]?.["exchange-document"];
    const list = Array.isArray(docs) ? docs : (docs ? [docs] : []);
    return list.map(d => {
      const docId = d?.["bibliographic-data"]?.["publication-reference"]?.["document-id"];
      const docIdEntry = Array.isArray(docId) ? docId[0] : docId;
      const number = [docIdEntry?.country, docIdEntry?.["doc-number"], docIdEntry?.kind].filter(Boolean).join("");
      const date = docIdEntry?.date || null;

      const applicants = d?.["bibliographic-data"]?.parties?.applicants?.applicant;
      const applicantList = Array.isArray(applicants) ? applicants : (applicants ? [applicants] : []);
      const applicantNames = applicantList
        .map(a => a?.["applicant-name"]?.name || a?.["applicant-name"])
        .filter(n => typeof n === "string");

      if (!number || !applicantNames.some(n => namesLikelyMatch(n, companyName))) return null;
      return { number, title: null, date, source_url: `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(number)}` };
    }).filter(Boolean);
  } catch (err) {
    console.warn("EPO OPS search error:", err.message);
    return [];
  }
}

// ── WIPO (PatentScope) — site-restricted search fallback, not a real API
// (the real API is a paid 2,000 CHF/year subscription) ─────────────────
// The quoted company name in the query is only a soft ranking hint to the
// search engine, not an enforced constraint — Tavily can and does return
// results that don't actually contain the exact phrase. This was the
// confirmed root cause of a real contamination incident (unrelated
// patents from differently-named companies reaching the report): this
// function previously had NO filter at all. Now applies the exact same
// title+description hard filter search.js's tavilyPatentSearch already
// uses for its own generic web-search patent results.
export async function searchWIPOPatents(companyName, webSearchFn) {
  if (!companyName?.trim() || !webSearchFn) return [];
  try {
    const results = await webSearchFn(`site:patentscope.wipo.int "${companyName.trim()}"`, 5);
    return (results || [])
      .filter(r => r.url && namesLikelyMatch(`${r.title || ""} ${r.description || ""}`, companyName))
      .map(r => ({ number: null, title: r.title || null, date: null, source_url: r.url }));
  } catch (err) {
    console.warn("WIPO PatentScope search error:", err.message);
    return [];
  }
}
