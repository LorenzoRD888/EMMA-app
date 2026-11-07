import path from 'node:path';
import {createCompanyEntries} from './company-entries.js';
import openDatabase from './db.js';
import { randomUUID, createHash } from 'node:crypto';
import { isSafeExternalUrl } from './services/urlSafety.js';
import { migrateIntel } from './intel/intel.js';
import { strategicEvent, similarTitle, STRATEGIC_EVENT_TYPES } from './intel/strategic-events.js';
export const TOPICS={events:'Trade fairs and events',social:'Social post',products:'Products and technologies',finance:'Finance and results',deals:'Deals and acquisitions',people:'People and hiring',operations:'Plants and production',patents:'Patents and research',risk:'Risk and regulation',sustainability:'Sustainability',general:'Other news'};
export function fail(message,status=400){return Object.assign(new Error(message),{status,public:true});}
export const clean=(v,max=1000)=>String(v??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
export function canonical(raw){if(!isSafeExternalUrl(raw).ok)throw fail('Enter a valid public web address.');const u=new URL(raw);u.hash='';for(const key of [...u.searchParams.keys()])if(/^(utm_|fbclid|gclid)/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href.replace(/\/$/,'');}
export function dayKey(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function localDayStart(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw fail('Invalid date.');
 const target=Date.parse(day+'T00:00:00Z');let guess=target;
 for(let i=0;i<3;i++){const zone=new Intl.DateTimeFormat('en',{timeZone:'Europe/Rome',timeZoneName:'longOffset'}).formatToParts(new Date(guess)).find(p=>p.type==='timeZoneName').value;const m=/GMT([+-])(\d{2}):(\d{2})/.exec(zone);const offset=m?(m[1]==='+'?1:-1)*(Number(m[2])*60+Number(m[3]))*60000:0;guess=target-offset;}return new Date(guess).toISOString();
}
export function classify(text){const t=text.toLowerCase();const patterns={events:/\b(trade ?fair|trade ?show|exhibition|exhibitor|booth|fiera|padiglione|messe|expo\b|stand [a-z]?\d|hall [a-z]?\d)|展会|展位/,deals:/acquis|merger|partnership|accord|joint venture|fusione/,finance:/revenue|fatturato|profit|ricavi|earnings|bilancio|funding|finanziament/,people:/appoint|nomina|ceo|hiring|assunzion|layoff|licenziament/,operations:/factory|plant|capacity|impianto|stabiliment|supply chain|produzione/,patents:/patent|brevett|research|ricerca|r&d/,risk:/lawsuit|litigation|recall|antitrust|sanzion|regulat|normativ|richiamo|cyber/,sustainability:/sustainab|sostenib|emission|recycl|ricicl|decarbon/,products:/launch|product|prodot|tecnolog|technology|lancio/};return Object.entries(patterns).find(([,re])=>re.test(t))?.[0]||'general';}
export function openMarket(filename){
 const db=openDatabase(filename);db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');
 db.exec(`CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,website TEXT NOT NULL DEFAULT '',sector TEXT NOT NULL DEFAULT '',country TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',aliases TEXT NOT NULL DEFAULT '[]',keywords TEXT NOT NULL DEFAULT '',feeds TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,createdAt TEXT NOT NULL,lastChecked TEXT,lastError TEXT);
 CREATE TABLE IF NOT EXISTS news(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',publishedAt TEXT,discoveredAt TEXT NOT NULL,source TEXT NOT NULL,category TEXT NOT NULL,method TEXT NOT NULL DEFAULT 'rules',aiSummary TEXT NOT NULL DEFAULT '',isRead INTEGER NOT NULL DEFAULT 0,starred INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',storyKey TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS news_companies(newsId TEXT REFERENCES news(id),companyId TEXT REFERENCES companies(id),PRIMARY KEY(newsId,companyId));
 CREATE INDEX IF NOT EXISTS news_dates ON news(publishedAt,discoveredAt);CREATE INDEX IF NOT EXISTS news_topic ON news(category);CREATE INDEX IF NOT EXISTS company_news ON news_companies(companyId,newsId);
 CREATE VIRTUAL TABLE IF NOT EXISTS news_fts USING fts5(id UNINDEXED,title,summary,tokenize='unicode61 remove_diacritics 2');
 CREATE TRIGGER IF NOT EXISTS news_insert AFTER INSERT ON news BEGIN INSERT INTO news_fts(id,title,summary) VALUES(new.id,new.title,new.summary); END;
 CREATE TRIGGER IF NOT EXISTS news_update AFTER UPDATE OF title,summary ON news BEGIN DELETE FROM news_fts WHERE id=old.id; INSERT INTO news_fts(id,title,summary) VALUES(new.id,new.title,new.summary); END;
 CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,startedAt TEXT NOT NULL,endedAt TEXT,status TEXT NOT NULL,newCount INTEGER NOT NULL DEFAULT 0,queries INTEGER NOT NULL DEFAULT 0,detail TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS briefs(day TEXT PRIMARY KEY,generatedAt TEXT NOT NULL,newsIds TEXT NOT NULL,runId TEXT);
 CREATE TABLE IF NOT EXISTS views(id TEXT PRIMARY KEY,name TEXT NOT NULL,filters TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS insights(id TEXT PRIMARY KEY,createdAt TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,newsIds TEXT NOT NULL,provider TEXT NOT NULL);`);
 migrateIntel(db);
 for(const table of ['news','site_pages']) {
  if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='deletedAt'))db.exec(`ALTER TABLE ${table} ADD COLUMN deletedAt TEXT`);
  db.exec(`CREATE VIEW IF NOT EXISTS active_${table} AS SELECT * FROM ${table} WHERE deletedAt IS NULL AND NOT EXISTS (SELECT 1 FROM ${table==='news'?'site_pages':'news'} other WHERE other.url=${table}.url AND other.deletedAt IS NOT NULL)`);
 }

 db.prepare("UPDATE runs SET status='interrupted', endedAt=? WHERE status='running'").run(new Date().toISOString());
 // v2 classifier (title-first, non-event pages excluded): reclassify every stored item once.
 if(!db.prepare("SELECT 1 FROM preferences WHERE key='migration:strategic-events-v2'").get()){
  const update=db.prepare("UPDATE news SET eventType=?,eventDate=?,eventDateKind=?,evidence=?,confidence=? WHERE id=?");
  const rows=db.prepare(`SELECT n.id,n.url,n.title,n.summary,c.website FROM news n
    JOIN news_companies nc ON nc.newsId=n.id JOIN companies c ON c.id=nc.companyId
    `).all();
  db.transaction(()=>{for(const row of rows){const signal=strategicEvent(row,{officialWebsite:row.website});update.run(signal.eventType,signal.eventDate,signal.eventDateKind,signal.evidence,signal.confidence,row.id);}})();
  db.prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('migration:strategic-events-v2','true')").run();
 }
 // v3: job postings and new distributors are recognised too; only items without a type (and never your corrections) are updated.
 if(!db.prepare("SELECT 1 FROM preferences WHERE key='migration:strategic-events-v3'").get()){
  const update=db.prepare("UPDATE news SET eventType=?,eventDate=?,eventDateKind=?,evidence=?,confidence=? WHERE id=?");
  const rows=db.prepare(`SELECT n.id,n.url,n.title,n.summary,c.website FROM news n JOIN news_companies nc ON nc.newsId=n.id JOIN companies c ON c.id=nc.companyId WHERE n.eventType='' AND n.eventBy=''`).all();
  db.transaction(()=>{for(const row of rows){const signal=strategicEvent(row,{officialWebsite:row.website});if(signal.eventType)update.run(signal.eventType,signal.eventDate,signal.eventDateKind,signal.evidence,signal.confidence,row.id);}})();
  db.prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('migration:strategic-events-v3','true')").run();
 }
 const corrections=()=>db.prepare('SELECT title,eventType FROM event_corrections ORDER BY createdAt DESC LIMIT 500').all();
 // A correction made by you: applied to this item and to similar articles not already checked by you.
 function correctEvent(id,eventType){const n=db.prepare('SELECT * FROM news WHERE id=?').get(id);if(!n)throw fail('News item not found.',404);if(eventType&&!STRATEGIC_EVENT_TYPES[eventType]||eventType==='page_change')throw fail('Unknown event type.');
  const own=db.prepare('SELECT c.website FROM companies c JOIN news_companies nc ON nc.companyId=c.id WHERE nc.newsId=?').get(id);const sig=strategicEvent(n,{officialWebsite:own?.website||''});
  const set=db.prepare("UPDATE news SET eventType=?,confidence=?,evidence=CASE WHEN evidence='' THEN ? ELSE evidence END,eventDate=CASE WHEN ?='' THEN NULL ELSE eventDate END,eventBy=? WHERE id=?");
  set.run(eventType,eventType?'high':'',sig.evidence||'secondary',eventType,'you',id);
  db.prepare('INSERT INTO event_corrections(id,title,eventType,companyId,createdAt) VALUES(?,?,?,?,?)').run(randomUUID(),n.title,eventType,'',new Date().toISOString());
  let similar=0;for(const o of db.prepare("SELECT id,title,url,summary,evidence FROM news WHERE id<>? AND eventBy<>'you'").all(id))if(similarTitle(o.title,n.title)){set.run(eventType,eventType?'medium':'',o.evidence||'secondary',eventType,'learned',o.id);similar++;}
  return {id,eventType,similar};}
 const parseCompany=c=>c?{...c,aliases:JSON.parse(c.aliases),feeds:JSON.parse(c.feeds),watchEvents:JSON.parse(c.watchEvents||'[]'),active:!!c.active}:null;
 const company=id=>parseCompany(db.prepare('SELECT * FROM companies WHERE id=?').get(id));
 const companies=()=>db.prepare('SELECT * FROM companies ORDER BY active DESC,name').all().map(parseCompany);
 function saveCompany(body,id=randomUUID()){
  const old=company(id)||{};const c={...old,...body};c.name=clean(c.name,150);if(!c.name)throw fail('Enter the company name.');
  const website=c.website?canonical(c.website):'';
  const aliases=(Array.isArray(c.aliases)?c.aliases:String(c.aliases||'').split(',')).map(s=>clean(s,100)).filter(Boolean).slice(0,12);
  const feeds=(Array.isArray(c.feeds)?c.feeds:String(c.feeds||'').split('\n')).filter(Boolean).slice(0,5).map(canonical);
  const watchEvents=[...new Set((Array.isArray(c.watchEvents)?c.watchEvents:[]).filter(v=>typeof v==='string'))].slice(0,20);
  try{db.prepare(`INSERT INTO companies(id,name,website,sector,country,description,aliases,keywords,feeds,active,createdAt,excludeTerms,watchEvents,products) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,website=excluded.website,sector=excluded.sector,country=excluded.country,description=excluded.description,aliases=excluded.aliases,keywords=excluded.keywords,feeds=excluded.feeds,active=excluded.active,excludeTerms=excluded.excludeTerms,watchEvents=excluded.watchEvents,products=excluded.products`).run(id,c.name,website,clean(c.sector,150),clean(c.country,100),clean(c.description,3000),JSON.stringify(aliases),clean(c.keywords,300),JSON.stringify(feeds),c.active===false?0:1,old.createdAt||new Date().toISOString(),clean(c.excludeTerms,500),JSON.stringify(watchEvents),clean(c.products,500));}catch(e){if(e.code?.startsWith('SQLITE_CONSTRAINT'))throw fail('This company is already in the archive.');throw e;}return company(id);
 }
 function ingest(items,companyId){const owner=company(companyId);if(!owner)throw fail('Company not found.',404);let added=0,linked=0;db.transaction(()=>{for(const item of items){let url;try{url=canonical(item.url);}catch{continue;}const title=clean(item.title,500);if(!title)continue;const summary=clean(item.summary,6000);const id=createHash('sha256').update(url).digest('hex').slice(0,32);let date=item.publishedAt&&Number.isFinite(Date.parse(item.publishedAt))?new Date(item.publishedAt).toISOString():null;if(date&&Date.parse(date)>Date.now()+86400000)date=null;
  let signal=strategicEvent({url,title,summary},{officialWebsite:owner.website}),eventBy='';const learned=corrections().find(x=>similarTitle(x.title,title));if(learned){eventBy='learned';signal=learned.eventType?{...signal,eventType:learned.eventType,evidence:signal.evidence||(new URL(url).hostname.replace(/^www\./,'')===(owner.website?new URL(owner.website).hostname.replace(/^www\./,''):'-')?'primary':'secondary'),confidence:signal.confidence&&signal.confidence!=='low'?signal.confidence:'medium'}:{eventType:'',eventDate:null,eventDateKind:'',evidence:'',confidence:''};}const image=/^https?:\/\//i.test(item.image||'')?String(item.image).slice(0,1000):'';const result=db.prepare('INSERT OR IGNORE INTO news(id,url,title,summary,publishedAt,discoveredAt,source,category,storyKey,review,reviewReason,image,lead,foundVia,dateHow,dateNote,eventType,eventDate,eventDateKind,evidence,confidence,eventBy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,url,title,summary,date,new Date().toISOString(),new URL(url).hostname.replace(/^www\./,''),TOPICS[item.category]?item.category:classify(title+' '+summary),title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,''),item.review?1:0,clean(item.reviewReason,300),image,clean(item.lead,800),item.foundVia?JSON.stringify(item.foundVia).slice(0,1500):'',date?clean(item.dateHow||'given by the source',80):'',date?'':clean(item.dateNote||'Date not found',200),signal.eventType,signal.eventDate,signal.eventDateKind,signal.evidence,signal.confidence,eventBy);if(!result.changes&&(image||item.lead||date||signal.eventType))db.prepare("UPDATE news SET image=CASE WHEN image='' THEN ? ELSE image END,lead=CASE WHEN lead='' THEN ? ELSE lead END,publishedAt=COALESCE(publishedAt,?),dateHow=CASE WHEN publishedAt IS NULL AND ? IS NOT NULL THEN ? ELSE dateHow END,dateNote=CASE WHEN ? IS NOT NULL THEN '' ELSE dateNote END,eventType=CASE WHEN eventType='' AND eventBy='' THEN ? ELSE eventType END,eventDate=COALESCE(eventDate,?),eventDateKind=CASE WHEN eventDateKind='' THEN ? ELSE eventDateKind END,evidence=CASE WHEN evidence='' THEN ? ELSE evidence END,confidence=CASE WHEN confidence='' AND eventBy='' THEN ? ELSE confidence END WHERE id=?").run(image,clean(item.lead,800),date,date,clean(item.dateHow||'given by the source',80),date,signal.eventType,signal.eventDate,signal.eventDateKind,signal.evidence,signal.confidence,id);added+=result.changes;
  linked+=db.prepare('INSERT OR IGNORE INTO news_companies(newsId,companyId) VALUES(?,?)').run(id,companyId).changes;
 }} )();return {added,linked};}
 const hydrate=n=>({...n,isRead:!!n.isRead,starred:!!n.starred,companies:db.prepare('SELECT c.id,c.name FROM companies c JOIN news_companies nc ON c.id=nc.companyId WHERE nc.newsId=? ORDER BY c.name').all(n.id)});
 function query(filters={},limit=100,offset=0){const clauses=['deletedAt IS NULL', 'NOT EXISTS (SELECT 1 FROM site_pages p WHERE p.url=news.url AND p.deletedAt IS NOT NULL)'],args=[];const ids=String(filters.companies||'').split(',').filter(Boolean).slice(0,30);if(ids.length){const qs=ids.map(()=>'?').join(',');clauses.push(`id IN (SELECT newsId FROM news_companies WHERE companyId IN (${qs}) GROUP BY newsId ${filters.mode==='all'?'HAVING COUNT(DISTINCT companyId) = '+ids.length:''})`);args.push(...ids);}
 if(filters.q){const terms=String(filters.q).match(/[\p{L}\p{N}]+/gu)?.slice(0,15)||[];if(terms.length){clauses.push('id IN (SELECT id FROM news_fts WHERE news_fts MATCH ?)');args.push(terms.map(t=>'"'+t+'"*').join(' AND '));}}
 if(filters.category&&TOPICS[filters.category]){clauses.push('category=?');args.push(filters.category);}if(filters.source){clauses.push('source=?');args.push(clean(filters.source,200));}
 if(filters.state==='review')clauses.push('review=1');else clauses.push('review=0');if(filters.state==='unread')clauses.push('isRead=0');if(filters.state==='starred')clauses.push('starred=1');if(filters.undated==='true')clauses.push('publishedAt IS NULL');
 const field=filters.dateBasis==='discovered'?'discoveredAt':'publishedAt';
 if(filters.from){clauses.push(`${field} >= ?`);args.push(localDayStart(filters.from));}
 if(filters.to){localDayStart(filters.to);const next=new Date(Date.parse(filters.to+'T12:00:00Z')+86400000).toISOString().slice(0,10);clauses.push(`${field} < ?`);args.push(localDayStart(next));}
 const where=clauses.length?' WHERE '+clauses.join(' AND '):'';const total=db.prepare('SELECT COUNT(*) n FROM news'+where).get(...args).n;
 const items=db.prepare('SELECT * FROM news'+where+' ORDER BY COALESCE(publishedAt,discoveredAt) DESC LIMIT ? OFFSET ?').all(...args,Math.max(1,Math.min(limit,5000)),Math.max(0,offset)).map(hydrate);return {items,total};}
 function updateNews(id,body){const item=db.prepare('SELECT * FROM news WHERE id=?').get(id);if(!item)throw fail('News item not found.',404);if(body.publishedAt!==undefined){if(!/^\d{4}-\d{2}-\d{2}$/.test(body.publishedAt)||Date.parse(body.publishedAt)>Date.now()+86400000)throw fail('Invalid date.');db.prepare("UPDATE news SET publishedAt=?,dateHow='added by you',dateNote='' WHERE id=?").run(body.publishedAt+'T12:00:00.000Z',id);}const category=body.category??item.category;if(!TOPICS[category])throw fail('Invalid category.');db.prepare('UPDATE news SET isRead=?,starred=?,notes=?,category=?,method=? WHERE id=?').run(body.isRead===undefined?item.isRead:body.isRead?1:0,body.starred===undefined?item.starred:body.starred?1:0,body.notes===undefined?item.notes:clean(body.notes,3000),category,body.category?'manual':item.method,id);return hydrate(db.prepare('SELECT * FROM news WHERE id=?').get(id));}
 function pref(key,fallback){const row=db.prepare('SELECT value FROM preferences WHERE key=?').get(key);return row?JSON.parse(row.value):fallback;}
 function setPref(key,value){db.prepare('INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));return value;}
 function stats(){return {companies:companies().length,active:companies().filter(c=>c.active).length,news:db.prepare('SELECT COUNT(*) n FROM active_news WHERE deletedAt IS NULL AND review=0').get().n,unread:db.prepare('SELECT COUNT(*) n FROM active_news WHERE deletedAt IS NULL AND isRead=0 AND review=0').get().n,review:db.prepare('SELECT COUNT(*) n FROM active_news WHERE deletedAt IS NULL AND review=1').get().n,sources:db.prepare('SELECT COUNT(DISTINCT source) n FROM active_news WHERE deletedAt IS NULL AND review=0').get().n,topics:db.prepare('SELECT category,COUNT(*) n FROM active_news WHERE deletedAt IS NULL AND review=0 GROUP BY category').all(),sourceList:db.prepare('SELECT DISTINCT source FROM active_news ORDER BY source').all().map(r=>r.source),runs:db.prepare('SELECT * FROM runs ORDER BY startedAt DESC LIMIT 12').all().map(r=>{const detail=JSON.parse(r.detail);const {audit,...compact}=detail;return {...r,detail:compact};})};}
 const entries=createCompanyEntries(db,{company,attachmentDirectory:filename===':memory:'?null:path.join(path.dirname(path.resolve(filename)),'attachments')});
 return {db,entries,company,companies,saveCompany,ingest,correctEvent,query,updateNews,pref,setPref,stats,hydrate,close:()=>db.close()};
}
