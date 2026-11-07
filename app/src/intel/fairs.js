// Fiere: catalogo delle manifestazioni di settore e riconoscimento di
// partecipazioni (fiera, edizione, padiglione/stand, date) nei testi.
// Il catalogo è un punto di partenza modificabile: le fiere non presenti
// vengono comunque riconosciute dai testi tramite i segnali generici.

export const FAIR_CATALOG = [
  // Fotovoltaico ed energia
  { key: 'intersolar-europe', name: 'Intersolar Europe / The smarter E', city: 'Munich', country: 'DE', sector: 'Photovoltaics', month: 6, aliases: ['intersolar europe', 'the smarter e europe', 'the smarter e', 'ees europe'] },
  { key: 'intersolar-na', name: 'Intersolar North America', city: 'USA', country: 'US', sector: 'Photovoltaics', month: 2, aliases: ['intersolar north america'] },
  { key: 'intersolar-sa', name: 'Intersolar South America', city: 'São Paulo', country: 'BR', sector: 'Photovoltaics', month: 8, aliases: ['intersolar south america'] },
  { key: 'intersolar-india', name: 'Intersolar India', city: 'Gandhinagar', country: 'IN', sector: 'Photovoltaics', month: 3, aliases: ['intersolar india'] },
  { key: 'intersolar', name: 'Intersolar (edition not specified)', city: '', country: '', sector: 'Photovoltaics', month: null, aliases: ['intersolar'] },
  { key: 'snec', name: 'SNEC PV Power Expo', city: 'Shanghai', country: 'CN', sector: 'Photovoltaics', month: 6, aliases: ['snec', 'snec pv', 'snec pv power expo', 'snec pv+'] },
  { key: 're-plus', name: 'RE+ (Solar Power International)', city: 'USA', country: 'US', sector: 'Photovoltaics', month: 9, aliases: ['re+', 're plus', 'solar power international', 'replus'] },
  { key: 'pv-expo', name: 'PV EXPO · Smart Energy Week', city: 'Tokyo', country: 'JP', sector: 'Photovoltaics', month: 3, aliases: ['pv expo', 'smart energy week', 'world smart energy week'] },
  { key: 'key-energy', name: 'KEY – The Energy Transition Expo', city: 'Rimini', country: 'IT', sector: 'Energy', month: 3, aliases: ['key energy', 'key - the energy transition expo', 'key – the energy transition expo', 'key the energy transition expo'] },
  { key: 'battery-show-europe', name: 'The Battery Show Europe', city: 'Stuttgart', country: 'DE', sector: 'Batteries / e-mobility', month: 6, aliases: ['the battery show europe', 'battery show europe'] },
  { key: 'battery-show-na', name: 'The Battery Show North America', city: 'Detroit', country: 'US', sector: 'Batteries / e-mobility', month: 10, aliases: ['the battery show north america', 'battery show north america', 'the battery show'] },
  { key: 'hannover-messe', name: 'Hannover Messe', city: 'Hannover', country: 'DE', sector: 'Industry', month: 4, aliases: ['hannover messe', 'hanover fair', 'hannover fair'] },
  // Isolamento elettrico, avvolgimenti, motori
  { key: 'cwieme-berlin', name: 'CWIEME Berlin', city: 'Berlin', country: 'DE', sector: 'Electrical insulation', month: 5, aliases: ['cwieme berlin', 'coil winding berlin', 'cwieme'] },
  { key: 'cwieme-shanghai', name: 'CWIEME Shanghai', city: 'Shanghai', country: 'CN', sector: 'Electrical insulation', month: 6, aliases: ['cwieme shanghai'] },
  { key: 'coiltech-italia', name: 'Coiltech Italia', city: 'Pordenone', country: 'IT', sector: 'Electrical insulation', month: 9, aliases: ['coiltech italia', 'coiltech italy', 'coiltech pordenone'] },
  { key: 'coiltech-deutschland', name: 'Coiltech Deutschland', city: 'Augsburg', country: 'DE', sector: 'Electrical insulation', month: 3, aliases: ['coiltech deutschland', 'coiltech germany', 'coiltech augsburg'] },
  { key: 'coiltech', name: 'Coiltech (edition not specified)', city: '', country: '', sector: 'Electrical insulation', month: null, aliases: ['coiltech'] },
  { key: 'eic', name: 'IEEE Electrical Insulation Conference (EIC)', city: '', country: 'US', sector: 'Electrical insulation', month: 6, aliases: ['electrical insulation conference', 'ieee eic'] },
  { key: 'insucon', name: 'INSUCON', city: '', country: '', sector: 'Electrical insulation', month: null, aliases: ['insucon'] },
  // Etichette, stampa, packaging
  { key: 'labelexpo-europe', name: 'Labelexpo Europe', city: 'Brussels / Barcelona', country: 'EU', sector: 'Labels', month: 9, aliases: ['labelexpo europe'] },
  { key: 'labelexpo-americas', name: 'Labelexpo Americas', city: 'Chicago', country: 'US', sector: 'Labels', month: 9, aliases: ['labelexpo americas'] },
  { key: 'labelexpo-asia', name: 'Labelexpo Asia', city: 'Shanghai', country: 'CN', sector: 'Labels', month: 12, aliases: ['labelexpo asia', 'labelexpo southeast asia', 'labelexpo india'] },
  { key: 'labelexpo', name: 'Labelexpo (edition not specified)', city: '', country: '', sector: 'Labels', month: null, aliases: ['labelexpo'] },
  { key: 'drupa', name: 'drupa', city: 'Düsseldorf', country: 'DE', sector: 'Printing', month: 5, aliases: ['drupa'] },
  { key: 'print4all', name: 'Print4All', city: 'Milan', country: 'IT', sector: 'Printing', month: 5, aliases: ['print4all', 'print 4 all'] },
  { key: 'fespa', name: 'FESPA Global Print Expo', city: '', country: 'EU', sector: 'Printing', month: 5, aliases: ['fespa'] },
  { key: 'interpack', name: 'interpack', city: 'Düsseldorf', country: 'DE', sector: 'Packaging', month: 5, aliases: ['interpack'] },
  // Plastica, film, coating
  { key: 'k-fair', name: 'K – Plastics and Rubber Fair', city: 'Düsseldorf', country: 'DE', sector: 'Plastics', month: 10, aliases: ['k fair', 'k show', 'k-messe', 'k messe', 'k düsseldorf', 'k dusseldorf'], pattern: /\bK\s?(?:20\d\d)\b/ },
  { key: 'chinaplas', name: 'CHINAPLAS', city: 'Shanghai / Shenzhen', country: 'CN', sector: 'Plastics', month: 4, aliases: ['chinaplas'] },
  { key: 'plast', name: 'Plast Milan', city: 'Milan', country: 'IT', sector: 'Plastics', month: 6, aliases: ['plast milano', 'plast milan'], pattern: /\bPlast\s20\d\d\b/ },
  { key: 'ecs', name: 'European Coatings Show', city: 'Nuremberg', country: 'DE', sector: 'Coating', month: 3, aliases: ['european coatings show', 'ecs nuremberg', 'ecs nürnberg'] },
  { key: 'chinacoat', name: 'CHINACOAT', city: 'Guangzhou / Shanghai', country: 'CN', sector: 'Coating', month: 11, aliases: ['chinacoat'] },
  { key: 'ice-europe', name: 'ICE Europe (converting)', city: 'Munich', country: 'DE', sector: 'Converting', month: 3, aliases: ['ice europe'] },
  // Elettronica, circuiti flessibili
  { key: 'productronica', name: 'productronica', city: 'Munich', country: 'DE', sector: 'Electronics', month: 11, aliases: ['productronica'] },
  { key: 'electronica', name: 'electronica', city: 'Munich', country: 'DE', sector: 'Electronics', month: 11, aliases: ['electronica munich', 'electronica münchen'], pattern: /\belectronica\s20\d\d\b/i },
  { key: 'lopec', name: 'LOPEC (printed electronics)', city: 'Munich', country: 'DE', sector: 'Printed electronics', month: 3, aliases: ['lopec'] },
  { key: 'ipc-apex', name: 'IPC APEX EXPO', city: 'USA', country: 'US', sector: 'Electronics', month: 3, aliases: ['ipc apex', 'apex expo'] },
  // Biomedicale
  { key: 'compamed', name: 'COMPAMED / MEDICA', city: 'Düsseldorf', country: 'DE', sector: 'Biomedical', month: 11, aliases: ['compamed', 'medica düsseldorf', 'medica dusseldorf'] },
];

const SIGNAL = /\b(trade ?fair|trade ?show|fair|exhibit|exhibits|exhibiting|exhibition|exhibitor|exhibitors|expo|aussteller|espone|espositore|messe|fiera|fiere|salone|booth|stand\s+(?:n|no|nr|#|[A-Z]?\d)|hall\s+[A-Z]?\d|padiglione|pad\.|halle|visit us|visitateci|vieni a trovarci|meet us|incontrarci|besuchen sie uns|conference|congress|congresso|webinar)\b|展会|展位|展台|博览会/i;

const MONTHS = {
  jan: 1, january: 1, gen: 1, gennaio: 1, januar: 1, feb: 2, february: 2, febbraio: 2, februar: 2,
  mar: 3, march: 3, marzo: 3, märz: 3, maerz: 3, apr: 4, april: 4, aprile: 4, may: 5, maggio: 5, mai: 5, mag: 5,
  jun: 6, june: 6, giugno: 6, juni: 6, giu: 6, jul: 7, july: 7, luglio: 7, juli: 7, lug: 7,
  aug: 8, august: 8, agosto: 8, ago: 8, sep: 9, sept: 9, september: 9, settembre: 9, set: 9,
  oct: 10, october: 10, ottobre: 10, oktober: 10, ott: 10, nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, dicembre: 12, dezember: 12, dic: 12,
};
const monthRe = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const iso = (y, m, d) => (y && m && d && m <= 12 && d <= 31) ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;

export function hasEventSignal(text) { return SIGNAL.test(String(text || '')); }

function containsPhrase(haystack, phrase) {
  let start = -1;
  while ((start = haystack.indexOf(phrase, start + 1)) !== -1) {
    const before = haystack[start - 1] || ' ', after = haystack[start + phrase.length] || ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
  }
  return false;
}

// Restituisce la voce di catalogo più specifica citata nel testo.
export function matchCatalog(text) {
  const t = ' ' + norm(text) + ' ';
  let best = null, bestLen = 0;
  for (const fair of FAIR_CATALOG) {
    for (const alias of fair.aliases) {
      const a = norm(alias);
      if (a.length > bestLen && containsPhrase(t, a)) { best = fair; bestLen = a.length; }
    }
    if (fair.pattern && fair.pattern.test(String(text || '')) && bestLen < 3) { best = fair; bestLen = 3; }
  }
  return best;
}

// Date: "18-20 June 2026", "June 18-20, 2026", "18–20 giugno 2026", "dal 3 al 5 marzo 2026", "2026-06-18"
export function extractDates(text) {
  const s = String(text || '');
  let m = s.match(new RegExp(`\\b(?:dal\\s+)?(\\d{1,2})\\.?\\s*(?:[-–/]|al|to|bis|until)\\s*(\\d{1,2})\\.?\\s*(?:de\\s+)?(${monthRe})\\.?,?\\s+(20\\d\\d)\\b`, 'i'));
  if (m) { const mo = MONTHS[m[3].toLowerCase()]; return { start: iso(+m[4], mo, +m[1]), end: iso(+m[4], mo, +m[2]) }; }
  m = s.match(new RegExp(`\\b(${monthRe})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*[-–]\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, 'i'));
  if (m) { const mo = MONTHS[m[1].toLowerCase()]; return { start: iso(+m[4], mo, +m[2]), end: iso(+m[4], mo, +m[3]) }; }
  m = s.match(new RegExp(`\\b(\\d{1,2})\\.?\\s*(${monthRe})\\.?\\s*[-–]\\s*(\\d{1,2})\\.?\\s*(${monthRe})\\.?,?\\s+(20\\d\\d)\\b`, 'i'));
  if (m) return { start: iso(+m[5], MONTHS[m[2].toLowerCase()], +m[1]), end: iso(+m[5], MONTHS[m[4].toLowerCase()], +m[3]) };
  m = s.match(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${monthRe})\\.?,?\\s+(20\\d\\d)\\b`, 'i'));
  if (m) { const d = iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]); return { start: d, end: d }; }
  m = s.match(new RegExp(`\\b(${monthRe})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, 'i'));
  if (m) { const d = iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]); return { start: d, end: d }; }
  m = s.match(/\b(20\d\d)年(\d{1,2})月(\d{1,2})日?(?:\s*[-–至]\s*(\d{1,2})日?)?/);
  if (m) return { start: iso(+m[1], +m[2], +m[3]), end: iso(+m[1], +m[2], +(m[4] || m[3])) };
  return { start: null, end: null };
}

export function extractBooth(text) {
  const s = String(text || '');
  const hall = s.match(/\b(?:hall|halle|padiglione|pad\.|pavilion)\s*(?:n\.?|no\.?|nr\.?|#)?\s*([A-Z]?\d[\w.]{0,5})\b/i)?.[1] || null;
  const stand = s.match(/\b(?:stand|booth|stand\s?n(?:o|r)?\.?|booth\s?no\.?)\s*(?:n\.?|no\.?|nr\.?|#|:)?\s*([A-Z]{0,2}[\s-]?\d[\w.\-/]{0,10})\b/i)?.[1]?.replace(/\s/g, '') || s.match(/展位号?[:：]?\s*([A-Z0-9][\w.\-]{1,10})/)?.[1] || null;
  return [hall && 'Hall ' + hall, stand && 'Stand ' + stand].filter(Boolean).join(' · ') || null;
}

// Nome di una fiera fuori catalogo, ricavato dal titolo: "X at Y 2026", "X alla fiera Y 2026"
function guessName(title) {
  const t = String(title || '');
  const m = t.match(/(?:\bat\b|\ba\b|\bal\b|\balla\b|\ball'|\bpresso\b|\bauf der\b|\bon\b|@)\s+(?:the\s+|la\s+|fiera\s+|il\s+)?([A-Z0-9][\w&+.'’\- ]{2,50}?)\s+(20\d\d)\b/);
  if (m) return { name: m[1].trim(), year: +m[2] };
  const m2 = t.match(/\b([A-Z][\w&+.\-]*(?:\s+[A-Z][\w&+.\-]*){0,4})\s+(20\d\d)\b/);
  if (m2 && hasEventSignal(t)) return { name: m2[1].trim(), year: +m2[2] };
  return null;
}

// Analizza un elemento (titolo + testo) e restituisce una partecipazione a fiera, se presente.
export function detectEvent({ title = '', summary = '', publishedAt = null, url = '' } = {}) {
  const text = `${title}\n${summary}`;
  const fair = matchCatalog(text);
  const signal = hasEventSignal(text) || /\/(event|events|fair|fairs|fiere|fiera|exhibition|messe)[/-]/i.test(url);
  if (!fair && !signal) return null;
  const guessed = !fair ? guessName(title) : null;
  if (!fair && !guessed) return null;
  if (!fair && !hasEventSignal(text)) return null;
  const dates = extractDates(text);
  const yearInText = (String(title).match(/\b(20\d\d)\b/) || text.match(/\b(20[2-3]\d)\b/))?.[1];
  const year = dates.start ? +dates.start.slice(0, 4) : guessed?.year || (yearInText ? +yearInText : publishedAt ? new Date(publishedAt).getUTCFullYear() : null);
  return {
    fairKey: fair?.key || 'other:' + norm(guessed.name).replace(/[^a-z0-9]+/g, '-'),
    fairName: fair?.name || guessed.name,
    city: fair?.city || '',
    sector: fair?.sector || '',
    year,
    startDate: dates.start,
    endDate: dates.end,
    booth: extractBooth(text),
    inCatalog: !!fair,
  };
}

export function eventStatus(event, today = new Date().toISOString().slice(0, 10)) {
  if (event.endDate) return event.endDate >= today ? 'upcoming' : 'past';
  if (event.startDate) return event.startDate >= today ? 'upcoming' : 'past';
  const year = +today.slice(0, 4);
  if (!event.year) return 'unknown';
  if (event.year > year) return 'upcoming';
  if (event.year < year) return 'past';
  const fair = FAIR_CATALOG.find(f => f.key === event.fairKey);
  if (fair?.month) return fair.month >= +today.slice(5, 7) ? 'upcoming' : 'past';
  return 'unknown';
}
