// Strategic moves are deliberately rule-first: they work without an AI model
// and every conclusion remains attached to the original page.
//
// How an item is classified:
// 1. Pages that describe the company rather than report an event (about us,
//    history, FAQ, annual reports, product catalogues…) are never events.
// 2. The event type is decided on the TITLE, with precise expressions; the
//    most specific rules come first (e.g. "invests in" before "partner").
// 3. If only the excerpt mentions an event, the item is kept with LOW
//    confidence and stays out of the Signal Center.
// 4. Confidence: high = official source and event in the title; medium =
//    third-party source and event in the title; low = excerpt only.
// 5. The event date is a date written in the title, or in the excerpt
//    sentence that describes the event; otherwise none.

export const STRATEGIC_EVENT_TYPES={
  product_launch:'Product launch',capacity_investment:'Capacity or investment',partnership:'Partnership or M&A',
  hiring:'Hiring or workforce',patent:'Patent or research',certification:'Certification or compliance',
  leadership:'Leadership change',market_expansion:'New market or geography',distribution:'New distributor or sales channel',funding:'Funding or financial move',pricing:'Pricing or commercial move',page_change:'Key page changed'
};

// Ordered from most to least specific: the first match wins.
const TITLE_RULES=[
 ['funding',/\b(rais(?:es|ed|ing)\s+(?:[$€£]|usd|eur|\d)|funding round|series [a-e]\b(?! of)|seed round|secures? (?:[$€£]?\d|funding|financing|investment)|closes? (?:a |its )?(?:funding|financing|round)|ipo\b|goes public|round di finanziamento|raccolt[ao] (?:di )?(?:fondi|capitali)|chiude un round)/i],
 ['partnership',/\b(acquir(?:es|ed|ing)|acquisition of|to acquire|takes? over|merg(?:es|er) with|minority stake|majority stake|stake in|invests? in|investment in|joint venture|strategic partnership|announces? (?:a |an |its |new )?(?:strategic |new )?(?:partnership|collaboration|alliance|agreement)|partners? with|teams? up with|signs? (?:an? )?(?:agreement|mou|contract|deal)|enters? into (?:an? )?(?:agreement|partnership)|collaborat(?:es|ion) with|acquisisce|acquisizione di|rileva\b|partecipazione (?:di minoranza|di maggioranza|in)|investe in|joint-venture|accordo (?:con|di|strategico)|firma (?:un )?accordo|partnership con)/i],
 ['distribution',/\b(distribut(?:ion|or) (?:agreement|deal|contract|partnership)|exclusive distribut\w*|new (?:distributor|dealer|reseller|sales agent)|(?:appoints?|appointed|names?|signs?|signed|selects?|welcomes?|adds?)\b.{0,50}\b(?:as (?:its |the )?)?(?:exclusive )?(?:distributor|dealer|reseller|sales (?:agent|representative|partner))|(?:accordo|contratto) di distribuzione|(?:nuovo|nuova) (?:distributore|rivenditore)|distributore (?:esclusivo|ufficiale)|vertriebs(?:partner|vereinbarung|vertrag)|neuer (?:vertriebspartner|händler)|(?:nouveau|nouvel) distributeur|accord de distribution|(?:nuevo|nueva) distribuidor|acuerdo de distribución)/i],
 ['capacity_investment',/\b(new (?:plant|factory|facility|production (?:line|site|plant)|manufacturing (?:site|plant|facility)|warehouse|line)|opens? (?:a |its |the )?(?:new )?(?:[\w-]+ )?(?:plant|factory|facility|production|manufacturing|line)|to open (?:a |its )?(?:new )?(?:[\w-]+ )?(?:plant|factory|facility)|expands? (?:its )?(?:plant|factory|facility|production|capacity|site)|capacity (?:expansion|increase)|breaks? ground|groundbreaking|invests? \S+ (?:million|billion|m|bn)|(?:million|billion)[- ](?:euro|dollar|€|\$)? ?investment in (?:its )?(?:plant|factory|site|production)|nuovo stabilimento|nuova linea|nuovo impianto|potenzia (?:lo |il )?(?:stabilimento|impianto|produzione)|amplia (?:lo |il )?(?:stabilimento|impianto)|investimento (?:da|di) \S+ (?:milioni|mln))/i],
 ['market_expansion',/\b(opens? (?:a |its |the )?(?:new )?(?:office|subsidiary|branch|sales office|hub)|opens? \S+ (?:america|usa|inc\.?|gmbh|china|india|asia|japan|ltd|s\.?a\.?)|(?:expands?|expansion) (?:into|to|in) (?:the )?[A-Z]|enters? (?:the )?\S+ market|market entry|new subsidiary|(?:launches?|establishes?) (?:a )?(?:subsidiary|presence)|apre (?:una )?(?:filiale|sede|ufficio)|nuova filiale|sbarca in|entra nel mercato)/i],
 ['leadership',/\b(appoints?|appointed|names? (?:a |its )?(?:new )?(?:ceo|cfo|cto|coo|chief|president|chair(?:man|woman)?|managing director|general manager|head|vp|director)|new (?:ceo|cfo|cto|coo|chief|president|chair(?:man|woman)?|managing director|general manager)|steps? down|retires? as|joins? (?:as|the board)|nomina(?:to)? (?:nuovo )?(?:ceo|amministratore|direttore|presidente|cfo)|nuovo (?:ceo|amministratore delegato|direttore generale|presidente)|lascia la carica)/i],
 ['product_launch',/\b(launch(?:es|ed|ing)? (?:a |an |its |the )?(?:new|first|next)|launch(?:es|ed)? \S+ (?:series|range|film|product|line|grade|solution|coating|technology)|unveils?|introduc(?:es|ed|ing) (?:a |an |its |the )?(?:new|first|next)|new (?:product|range|series|generation|grade)|debuts?|presenta (?:il |la |i |le )?nuov|lancia (?:il |la |i |le )?(?:nuov|sul mercato)|lancio (?:di|del|della) (?:nuov|prim))/i],
 ['patent',/\b(granted (?:a |the )?patent|patent (?:granted|awarded|filed|application)|files? (?:a )?patent|wins? (?:a |an )?(?:innovation )?award for|research (?:project|partnership|programme|program) (?:with|on|to)|ottiene (?:il )?brevetto|brevetto (?:concesso|depositato|europeo)|depositat[oa] (?:un )?brevett)/i],
 ['certification',/\b(obtains?|achieves?|receives?|awarded|earns?|gains?|ottiene|consegue|ha ottenuto)\b.{0,40}\b(certification|certificate|iso ?\d{4,5}|ecovadis|ul (?:listing|certification)|tüv|tuv|approval|accreditation|certificazione)/i],
 ['hiring',/\b(is hiring|hiring \d|to hire|will hire|creates? \d+ (?:new )?jobs|new jobs|job cuts|cuts? \d+ jobs|layoffs?|lays? off|recruiting \d|assum(?:e|erà) \d+|nuove assunzioni|\d+ (?:nuovi )?posti di lavoro|licenziament|esuberi|cassa integrazione)/i],
 ['pricing',/\b(price (?:increase|rise|hike|cut|reduction|adjustment)|raises? prices|increases? prices|new price list|surcharge|aumento (?:dei |di )?prezz|nuovo listino|rincar)/i],
];

// Same types, wider words: only to confirm an event or find it with low confidence in the excerpt.
const TEXT_RULES={
 funding:/\b(funding|financing|investors?|raised|series [a-e]|finanziament|investitori)\b/i,
 partnership:/\b(acquisition|acquired|merger|stake|joint venture|partnership|agreement|acquisizion|accordo|partecipazione)\b/i,
 capacity_investment:/\b(plant|factory|facility|production|line|capacity|investment|stabiliment|impianto|linea produttiva|capacità produttiva|line opens|new line)\b/i,
 market_expansion:/\b(subsidiary|new office|market entry|expansion into|filiale|nuovo mercato)\b/i,
 leadership:/\b(appointed|appointment|new ceo|managing director|steps down|nominat[oa]|amministratore delegato)\b/i,
 product_launch:/\b(launch(?:ed|es)?|unveil(?:ed|s)?|new product|new range|introduced|lancio|nuov[oa] (?:prodotto|gamma))\b/i,
 patent:/\b(patent(?:ed)?|brevett)\w*/i,
 certification:/\b(certification|certified|iso ?\d{4,5}|certificazione|certificat[oa])\b/i,
 hiring:/\b(hiring|new jobs|layoffs?|assunzion|posti di lavoro|licenziament)\w*/i,
 distribution:/\b(distribut(?:or|ion)|reseller|dealer|distributore|rivenditore|vertrieb|distributeur|distribuidor)\w*/i,
 pricing:/\b(price increase|price list|surcharge|listino|aumento (?:dei )?prezz)\w*/i,
};

// Pages that describe the company instead of reporting an event.
const NOT_EVENT_TITLE=/\b(about us|chi siamo|who we are|our (?:story|history|mission|values|commitment|company|team|products|solutions)|history|storia|timeline|milestones|faq|questions about|frequently asked|annual report|sustainability report|bilancio|relazione|privacy|cookie|terms (?:and|&) conditions|contact(?:s| us)?|contatti|careers?$|lavora con noi|home ?page|valuation|funding history|company profile|profilo aziendale|market (?:size|share|report|analysis)|datasheet|scheda tecnica|catalog(?:ue)?|brochure)\b/i;
const NOT_EVENT_PATH=/\/(about|about-us|chi-siamo|company|azienda|history|storia|timeline|faq|privacy|cookie|contact|contatti|careers|lavora-con-noi|products?|prodotti|solutions|soluzioni|applications|applicazioni|category|tag|downloads?)(\/|$)/i;

const isoDate=/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.]([0-3]?\d)\b/;
const euDate=/\b([0-3]?\d)[/.]([01]?\d)[/.](20\d{2})\b/;
const MONTHS={jan:1,january:1,gen:1,gennaio:1,feb:2,february:2,febbraio:2,mar:3,march:3,marzo:3,apr:4,april:4,aprile:4,may:5,mag:5,maggio:5,jun:6,june:6,giu:6,giugno:6,jul:7,july:7,lug:7,luglio:7,aug:8,august:8,ago:8,agosto:8,sep:9,sept:9,september:9,set:9,settembre:9,oct:10,october:10,ott:10,ottobre:10,nov:11,november:11,novembre:11,dec:12,december:12,dic:12,dicembre:12};
const wordDate=new RegExp(`\\b([0-3]?\\d)(?:st|nd|rd|th)?\\s+(${Object.keys(MONTHS).join('|')})\\.?,?\\s+(20\\d{2})\\b|\\b(${Object.keys(MONTHS).join('|')})\\.?\\s+([0-3]?\\d)(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`,'i');
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}};
const path=value=>{try{return new URL(value).pathname.toLowerCase();}catch{return '';}};
const iso=(y,m,d)=>{const v=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if(!Number.isFinite(Date.parse(v)))return null;const out=new Date(v+'T12:00:00.000Z');return out.getTime()>Date.now()+366*86400000?null:out.toISOString();};
function findDate(text){
 const a=text.match(isoDate);if(a)return iso(a[1],a[2],a[3]);
 const b=text.match(euDate);if(b)return iso(b[3],b[2],b[1]);
 const c=text.match(wordDate);if(c)return c[1]?iso(c[3],MONTHS[c[2].toLowerCase()],c[1]):iso(c[6],MONTHS[c[4].toLowerCase()],c[5]);
 return null;
}
const EMPTY={eventType:'',eventDate:null,eventDateKind:'',evidence:'',confidence:''};

// Job postings (job boards and company career portals): each one is a hiring signal with its role and place.
const JOB_HOSTS=/(^|\.)(indeed\.[a-z.]+|glassdoor\.[a-z.]+|stepstone\.[a-z.]+|infojobs\.[a-z.]+|monster\.[a-z.]+|ziprecruiter\.com|simplyhired\.com|xing\.com|welcometothejungle\.com|jobs\.lever\.co|lever\.co|greenhouse\.io|boards\.greenhouse\.io|smartrecruiters\.com|workable\.com|apply\.workable\.com|personio\.(?:de|com)|join\.com|recruitee\.com|teamtailor\.com|bamboohr\.com|myworkdayjobs\.com|successfactors\.(?:com|eu)|jobvite\.com|icims\.com|taleo\.net|51job\.com|zhipin\.com|liepin\.com|jobstreet\.[a-z.]+|naukri\.com|seek\.com\.au|vietnamworks\.com|topcv\.vn)$/i;
export function isJobPosting(url){
 let u;try{u=new URL(url);}catch{return false;}
 const h=u.hostname.replace(/^www\./,'').toLowerCase(),p=u.pathname.toLowerCase();
 if((h==='linkedin.com'||h.endsWith('.linkedin.com'))&&/^\/jobs\/view\//.test(p))return true;
 if(/(^|\.)indeed\./.test(h))return /\/(viewjob|rc\/clk|job\/|jobs\/view|cmp\/[^/]+\/jobs\/)/.test(p+u.search)||u.searchParams.has('jk');
 if(/(^|\.)glassdoor\./.test(h))return /\/job-listing\/|\/partner\/joblisting/.test(p);
 if(JOB_HOSTS.test(h))return /\d|job|position|stelle|offre|posting|vacanc|career/.test(p);
 return /\/(careers?|jobs?|lavora-con-noi|karriere|stellenangebote|offres?-d-emploi|empleo)\/[^/]*\d[^/]*\/?$|\/(job|position|stelle|vacancy|posizione)\/[^/]+/.test(p);
}
// "Acme hiring R&D Engineer in Ho Chi Minh City, Vietnam | LinkedIn", "Process Engineer - Acme - Milano, Lombardia".
export function jobDetails(item,companyNames=[]){
 const title=String(item.title||'').replace(/\s*[|·]\s*(LinkedIn|Indeed|Glassdoor|StepStone|Xing).*$/i,'').trim();
 let role='',place='';
 const li=title.match(/\bhiring\s+(.+?)\s+in\s+(.+)$/i);
 if(li){role=li[1];place=li[2];}
 else{
  const parts=title.split(/\s+[-–—|]\s+/).map(x=>x.trim()).filter(Boolean);
  const names=companyNames.map(n=>String(n).toLowerCase());
  const rest=parts.filter(x=>!names.some(n=>n&&x.toLowerCase().includes(n)));
  role=rest[0]||parts[0]||title;place=rest.length>1?rest[rest.length-1]:'';
  if(!place){const m=String(item.summary||'').match(/\b(?:location|sede|standort|lieu|ubicación)\s*:?\s*([^.;\n]{3,60})/i)||String(item.summary||'').match(/\bin\s+([A-Z][\p{L}.' -]+,\s*[A-Z][\p{L}.' -]+)/u);if(m)place=m[1];}
 }
 role=role.replace(/\s*\((?:m|f|w|d|x)[/|](?:m|f|w|d|x)(?:[/|](?:m|f|w|d|x))?\)\s*/gi,' ').replace(/\s+/g,' ').trim().slice(0,120);
 place=place.replace(/\s+/g,' ').trim().slice(0,80);
 const country=place.includes(',')?place.split(',').pop().trim():place;
 const area=/\b(r\s?&\s?d|research|development|scientist|chemist|laborator|innovation|ricerca|sviluppo|forschung|entwicklung)\b/i.test(role)?'R&D':/\b(sales|account|business development|commercial|vendite|vertrieb|commercial)\b/i.test(role)?'Sales':/\b(production|operator|process|manufactur|plant|maintenance|quality|produzione|stabilimento|qualit)\w*/i.test(role)?'Production and quality':/\b(engineer|ingegner|ingenieur|technician|tecnico)\b/i.test(role)?'Engineering':/\b(marketing|product manager|brand)\b/i.test(role)?'Marketing and product':'Other';
 return {role,place,country,area};
}

export function isNotEvent(item){return NOT_EVENT_TITLE.test(String(item.title||''))||NOT_EVENT_PATH.test(path(item.url));}

export function strategicEvent(item,{officialWebsite=''}={}){
 const title=String(item.title||''),summary=String(item.summary||'');
 if(isJobPosting(item.url))return {eventType:'hiring',eventDate:null,eventDateKind:'',evidence:host(item.url)===host(officialWebsite)?'primary':'secondary',confidence:'medium'};
 if(isNotEvent(item))return {...EMPTY};
 const primary=!!host(item.url)&&host(item.url)===host(officialWebsite);
 const hit=TITLE_RULES.find(([,re])=>re.test(title));
 let eventType,basis;
 if(hit){eventType=hit[0];basis='title';}
 else{
  // Excerpt only: the first sentences carry the news; later text is often boilerplate.
  const lead=summary.slice(0,400);
  const found=TITLE_RULES.find(([,re])=>re.test(lead));
  if(!found)return {...EMPTY};
  eventType=found[0];basis='excerpt';
 }
 // Only the article body: stop at headings and "related news" blocks, whose dates belong to other articles.
 const body=summary.split(/\n#{1,6}\s|#{2,6}\s|\b(?:related (?:news|articles|posts)|see all news|read more|you may also like|more news|articoli correlati|potrebbe interessarti|leggi anche)\b/i)[0].slice(0,1200);
 const sentences=body.split(/(?<=[.!?])\s+/);
 const eventSentence=sentences.find(s=>TEXT_RULES[eventType].test(s)||TITLE_RULES.find(([t])=>t===eventType)[1].test(s));
 const fromTitle=findDate(title),fromSentence=eventSentence?findDate(eventSentence):null;
 const eventDate=fromTitle||fromSentence;
 return {
  eventType,eventDate,
  eventDateKind:eventDate?(fromTitle?'date in the title':'date stated in the page'):'',
  evidence:primary?'primary':'secondary',
  confidence:basis==='excerpt'?'low':primary?'high':'medium'
 };
}

// Two titles describe the same event when they share most of their meaningful words.
const STOP=new Set('the a an of to in on for and with by at from its is as new announces announced says has have will be that this über und der die das il lo la le i gli di da del della dei per con su un una e ed al alla'.split(' '));
export const titleWords=t=>new Set(String(t||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9]+/).filter(w=>w.length>2&&!STOP.has(w)));
// Names in a title other than the company itself (e.g. "Fedrigoni", "Spicers"): used to group articles about the same event.
const properNames=(t,exclude)=>new Set((String(t||'').match(/\b[A-Z][\p{L}\d&'-]{2,}/gu)||[]).map(w=>w.toLowerCase()).filter(w=>!STOP.has(w)&&!exclude.has(w)&&!/^(new|group|the|company|press|news|post|linkedin)$/.test(w)));
// Strict similarity, used to reuse your corrections on other articles about the same thing.
export function similarTitle(a,b){const x=titleWords(a),y=titleWords(b);if(x.size<2||y.size<2)return false;let common=0;for(const w of x)if(y.has(w))common++;return common/(x.size+y.size-common)>=0.6;}
export function sameEvent(a,b,{companyNames=[]}={}){
 const exclude=new Set(companyNames.flatMap(n=>String(n).toLowerCase().split(/\s+/)));
 const x=titleWords(a),y=titleWords(b);let common=0;for(const w of x)if(y.has(w))common++;
 if(x.size&&y.size&&common/Math.min(x.size,y.size)>=0.6)return true;
 const p=properNames(a,exclude),q=properNames(b,exclude);for(const w of p)if(q.has(w))return true;
 return false;
}

export const strategicWhy=type=>({
 product_launch:'May indicate a new offer or technology focus.',capacity_investment:'May indicate more production capacity or a strategic investment.',partnership:'May indicate new capabilities, channels or market access.',hiring:'May indicate a change in priorities or organisational capacity.',patent:'May indicate a technical direction worth tracking.',certification:'May affect access to customers, markets or regulated applications.',distribution:'May indicate a new sales channel or entry into a market.',market_expansion:'May indicate entry into a new country or customer segment.',leadership:'May indicate a strategic or operational change.',market_expansion:'May indicate geographic or segment expansion.',funding:'May indicate available resources or a change in growth plans.',pricing:'May affect commercial positioning.',page_change:'Check what changed: products, prices, terms or claims.'
}[type]||'');
