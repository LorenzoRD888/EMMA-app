// Product and brand names of a company, used to search for articles,
// datasheets and distributors that talk about a product without naming the
// company. Two sources:
//   · names you type in the company card ("Products and brands");
//   · names detected automatically: words written with ® or ™ in the
//     collected news and pages that ALSO appear in the company's own website
//     (page addresses or titles). Brands of other companies quoted in an
//     article (e.g. a supplier's material) are therefore left out.
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const GENERIC = new Set('the and for new our with group company products product solutions technology film films coating coatings system systems series line range spa srl ltd inc gmbh llc'.split(' '));

export function userProducts(company) {
  return String(company.products || '').split(/[,;\n]/).map(s => s.trim()).filter(s => s.length >= 2).slice(0, 15);
}

export function detectBrands(db, company, { limit = 5 } = {}) {
  const own = new Set([company.name, ...(company.aliases || [])].map(norm));
  const rows = [
    ...db.prepare("SELECT n.title||' '||n.summary t FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0").all(company.id),
    ...db.prepare("SELECT title||' '||summary t FROM active_site_pages WHERE companyId=?").all(company.id),
  ];
  const counts = new Map(), shown = new Map();
  for (const r of rows) for (const m of String(r.t).matchAll(/(?<![\p{L}\d])([\p{L}][\p{L}\d-]{2,24})\s?[®™]/gu)) {
    const k = norm(m[1]); if (own.has(k) || GENERIC.has(k)) continue;
    counts.set(k, (counts.get(k) || 0) + 1); if (!shown.has(k)) shown.set(k, m[1]);
  }
  // Must appear on the official website (address or title) to count as the company's own brand.
  const site = db.prepare("SELECT lower(url)||' '||lower(COALESCE(title,'')) s FROM active_site_pages WHERE companyId=?").all(company.id).map(r => norm(r.s)).join(' \n ');
  return [...counts].filter(([k]) => site.includes(k)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, n]) => ({ name: shown.get(k), mentions: n }));
}

// Names actually used for searching: yours first, then the detected ones.
export function productNames(db, company, { limit = 5 } = {}) {
  const mine = userProducts(company);
  const seen = new Set(mine.map(norm));
  const auto = detectBrands(db, company, { limit: limit + 3 }).map(b => b.name).filter(n => !seen.has(norm(n)));
  return { names: [...mine, ...auto].slice(0, limit), mine, auto: auto.slice(0, Math.max(0, limit - mine.length)) };
}

// Does a text mention one of the product names (as a whole word)?
export function mentionsProduct(text, names) {
  const t = ' ' + norm(text) + ' ';
  return names.some(n => { const k = norm(n); let i = -1; while ((i = t.indexOf(k, i + 1)) !== -1) if (!/[a-z0-9]/.test(t[i - 1] || ' ') && !/[a-z0-9]/.test(t[i + k.length] || ' ')) return true; return false; });
}
