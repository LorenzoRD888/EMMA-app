import express from 'express';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { TOPICS,fail,clean,dayKey,canonical } from './market-store.js';
import { localBase } from './settings.js';
import { SECTOR_AREAS } from './intel/sectors.js';
import { buildCompanyDocx } from './company-export.js';
export function marketRoutes(store,service,settings){const router=express.Router();const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 // Any change to the archive (news, corrections, watched pages, reviews…) refreshes the sector labels.
 router.use((req,res,next)=>{if(req.method!=='GET')res.on('finish',()=>{if(res.statusCode<400&&!req.path.startsWith('/sectors'))service.retagSoon();});next();});
 router.get('/sectors',(req,res)=>res.json({sectors:service.sectors.all(),areas:SECTOR_AREAS}));
 router.post('/sectors',(req,res)=>res.json(service.sectors.save(req.body||{})));
 router.put('/sectors/:id',(req,res)=>{if(!service.sectors.get(req.params.id))throw fail('Sector not found.',404);res.json(service.sectors.save(req.body||{},req.params.id));});
 router.delete('/sectors/:id',(req,res)=>res.json({removed:service.sectors.remove(req.params.id)}));
 router.get('/sectors/:id/evidence',(req,res)=>res.json(service.sectors.evidence(req.params.id,req.query)));
 router.get('/sector-labels',(req,res)=>res.json(service.sectors.labels(req.query.companyId||'')));
 router.get('/state',(req,res)=>res.json({companies:store.companies(),sectors:service.sectors.all(),stats:store.stats(),topics:TOPICS,job:service.job(),daily:service.config(),research:service.research(),aiReady:service.aiReady(),searchReady:settings.snapshot().searchReady,searchLabel:settings.snapshot().activeSearchLabel,provider:settings.snapshot().provider,views:store.db.prepare('SELECT * FROM views').all().map(v=>({...v,filters:JSON.parse(v.filters)})),today:dayKey()}));
 router.get('/research-plan',(req,res)=>res.json({plans:service.plan(req.query.companies?String(req.query.companies).split(','):null)}));
 router.put('/research',wrap(async(req,res)=>{if(service.busy())throw fail('Wait for the search to finish.',409);res.json(service.saveResearch(req.body));}));
 router.get('/runs/:id',wrap(async(req,res)=>{const row=store.db.prepare('SELECT * FROM runs WHERE id=?').get(req.params.id);if(!row)throw fail('Search not found.',404);res.json({...row,detail:JSON.parse(row.detail)});}));
 router.post('/companies',wrap(async(req,res)=>res.json(store.saveCompany(req.body))));
 router.put('/companies/:id',wrap(async(req,res)=>{if(!store.company(req.params.id))throw fail('Company not found.',404);if(service.busy())throw fail('Wait for the update to finish.',409);res.json(store.saveCompany(req.body,req.params.id));}));
 router.get('/company/:companyId/entries',(req,res)=>{if(!store.company(req.params.companyId))throw fail('Company not found.',404);res.json({items:store.entries.list(req.params.companyId),sections:store.entries.sections,types:store.entries.types});});
 router.post('/company/:companyId/entries',wrap(async(req,res)=>{const e=store.entries.save(req.params.companyId,req.body||{});service.noteSaved(e);res.json(e);}));
 router.put('/company/:companyId/entries/:id',wrap(async(req,res)=>{const e=store.entries.save(req.params.companyId,req.body||{},req.params.id);service.noteSaved(e);res.json(e);}));
 router.post('/notes/:id/watch',(req,res)=>res.json({changed:service.notes.setWatch(req.params.id,req.body?.watch!==false)}));
 router.post('/entries/:id/file',express.raw({type:'application/octet-stream',limit:'10mb'}),wrap(async(req,res)=>{
  let name;try{name=decodeURIComponent(req.get('X-File-Name')||'');}catch{throw fail('Invalid filename.');}
  res.json(await store.entries.attach(req.params.id,req.body,name));
 }));
 router.get('/entries/:id/file',wrap(async(req,res)=>{const file=await store.entries.file(req.params.id);res.set('Content-Type','application/octet-stream');res.set('X-Content-Type-Options','nosniff');res.set('Content-Disposition',`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.send(file.bytes);}));
 router.get('/trash',(req,res)=>{
  const items=[];
  for(const [kind,table] of [['news','news'],['site','site_pages']])for(const row of store.db.prepare(`SELECT * FROM ${table} WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC`).all()){
   const companies=kind==='news'?store.hydrate(row).companies:[store.company(row.companyId)].filter(Boolean);
   items.push({id:row.id,kind,title:row.title,url:row.url,deletedAt:row.deletedAt,companies:companies.map(c=>({id:c.id,name:c.name}))});
  }
  for(const row of store.db.prepare('SELECT * FROM company_entries WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC').all()){const c=store.company(row.companyId);items.push({id:row.id,kind:'entry',title:row.title,url:row.url,deletedAt:row.deletedAt,companies:c?[{id:c.id,name:c.name}]:[]});}
  res.json(items.filter((n,i)=>n.kind==='entry'||items.findIndex(x=>x.kind!=='entry'&&x.url===n.url)===i).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt)));
 });
 router.post('/trash/:kind/:id',(req,res)=>{
  if(req.params.kind==='entry'){store.entries.trash(req.params.id,req.body.restore===true);return res.json({ok:true});}
  const table={news:'news',site:'site_pages'}[req.params.kind];if(!table)throw fail('Unknown article type.');
  const item=store.db.prepare(`SELECT url FROM ${table} WHERE id=?`).get(req.params.id);if(!item)throw fail('Article not found.',404);
  if(table==='news')service.intel.learnFromNews(req.params.id,req.body.restore===true?'restore':'discard');
  store.db.transaction(()=>{for(const t of ['news','site_pages'])store.db.prepare(`UPDATE ${t} SET deletedAt=? WHERE url=?`).run(req.body.restore===true?null:new Date().toISOString(),item.url);})();res.json({ok:true});
 });
 router.post('/people/:companyId', (req,res)=>{
  const company=store.company(req.params.companyId);if(!company)throw fail('Company not found.',404);
  const name=clean(req.body.name,150),role=clean(req.body.role,200),location=clean(req.body.location,150);
  if(!name)throw fail('Enter the person’s name.');
  const url=req.body.url?canonical(req.body.url):'https://www.linkedin.com/search/results/people/?keywords='+encodeURIComponent(name+' '+company.name);
  const existing=store.db.prepare('SELECT id FROM people WHERE companyId=? AND (lower(name)=lower(?) OR url=?)').get(company.id,name,url);
  const id=existing?.id||randomUUID(),time=new Date().toISOString();
  store.db.prepare(`INSERT INTO people(id,companyId,name,role,location,url,current,snippet,query,firstSeen,lastSeen,baseline,source,checked,hidden) VALUES(?,?,?,?,?,?,1,?,'added by you',?,?,1,'','verified',0)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,location=excluded.location,url=excluded.url,current=1,snippet=excluded.snippet,query='added by you',checked='verified',hidden=0,lastSeen=excluded.lastSeen`).run(id,company.id,name,role,location,url,clean(req.body.notes,2000),time,time);
  res.json({id});
 });
 router.get('/news',wrap(async(req,res)=>res.json(store.query(req.query,Number(req.query.limit)||40,Number(req.query.offset)||0))));
 router.post('/news',wrap(async(req,res)=>{if(!req.body.companyId||!req.body.title||!req.body.url)throw fail('Choose company, title and address of the news item.');canonical(req.body.url);res.json(store.ingest([{url:req.body.url,title:req.body.title,summary:req.body.summary,publishedAt:req.body.publishedAt}],req.body.companyId));}));
 router.patch('/news/:id',wrap(async(req,res)=>{const out=store.updateNews(req.params.id,req.body);if(req.body.starred===true)service.intel.learnFromNews(req.params.id,'star');res.json(out);}));
 router.post('/media/:companyId',wrap(async(req,res)=>res.status(202).json(service.startMedia(req.params.companyId))));
 router.post('/refresh',wrap(async(req,res)=>res.status(202).json(service.start(req.body))));
 // Intelligence: novità quotidiane, fiere, scheda per azienda
 router.get('/daily-feed',wrap(async(req,res)=>res.json(service.intel.dailyFeed(String(req.query.day||'')))));
 router.post('/daily/previews',wrap(async(req,res)=>res.json(await service.completePreviews(String(req.body.days||'30')))));
 router.get('/compare-intel',wrap(async(req,res)=>{const ids=String(req.query.companies||'').split(',').filter(Boolean).slice(0,8);res.json(service.compareIntel(ids.length?ids:store.companies().map(c=>c.id).slice(0,8),req.query.days));}));
 router.post('/facts/:id/hide',(req,res)=>res.json({hidden:store.db.prepare('UPDATE facts SET hidden=1 WHERE id=?').run(req.params.id).changes}));
 router.post('/dates/:id',wrap(async(req,res)=>{if(service.busy())throw fail('Wait for the update to finish.',409);res.json(await service.backfillDates(req.params.id,60,true));}));
 router.get('/discoveries',(req,res)=>res.json(service.discoveries()));
 router.post('/discover',wrap(async(req,res)=>res.json(await service.discoverCompanies(String(req.body.topic||'')))));
 router.post('/discoveries/:id',wrap(async(req,res)=>res.json(service.setDiscovery(req.params.id,req.body.status==='added'?'added':'dismissed'))));
 router.get('/feed',(req,res)=>res.json({...service.intel.feed(req.query),backfill:service.backfillState()}));
 router.get('/products/:id',(req,res)=>{const c=store.company(req.params.id);if(!c)throw fail('Company not found.',404);res.json({...service.products(c),detected:service.detectedBrands(c)});});
 // Company file: everything about one company in a Word document.
 router.get('/company/:id/export',wrap(async(req,res)=>{const d=service.intel.dossier(req.params.id);if(!d)throw fail('Company not found.',404);const sectors=service.sectors.all().filter(s=>!s.companyIds.length||s.companyIds.includes(d.company.id)).map(s=>s.name);const urls=store.db.prepare('SELECT url FROM active_site_pages WHERE companyId=? UNION SELECT n.url FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0').all(d.company.id,d.company.id);const sourceSites=new Set(urls.map(r=>{try{return new URL(r.url).hostname.replace(/^www\./,'');}catch{return '';}}).filter(Boolean)).size;const archiveCounts={sourceSites,webPages:Object.values(d.pageCounts).reduce((n,v)=>n+v,0),news:store.db.prepare('SELECT COUNT(*) n FROM active_news n JOIN news_companies nc ON nc.newsId=n.id WHERE nc.companyId=? AND n.review=0').get(d.company.id).n};const buffer=await buildCompanyDocx(d,{sectors,archiveCounts,keyPages:service.keyPages.list(d.company.id)});const name=(d.company.name.replace(/[^\p{L}\p{N} _-]+/gu,'').trim()||'company')+' - EMMA report.docx';res.set('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.set('Content-Disposition',`attachment; filename="company-report.docx"; filename*=UTF-8''${encodeURIComponent(name)}`);res.send(buffer);}));
 router.get('/signals',(req,res)=>res.json(service.signals(req.query)));
 router.post('/news/:id/event',(req,res)=>{const t=req.body?.eventType;if(typeof t!=='string')return res.status(400).json({error:'Choose an event type.'});res.json(service.correctEvent(req.params.id,t));});
 router.get('/key-pages/:companyId',(req,res)=>res.json(service.keyPages.list(req.params.companyId)));
 router.post('/key-pages/:companyId',wrap(async(req,res)=>res.json(await service.keyPages.add(req.params.companyId,req.body||{}))));
 router.post('/key-page/:id/check',wrap(async(req,res)=>res.json(await service.keyPages.check(req.params.id))));
 router.delete('/key-page/:id',(req,res)=>res.json({removed:service.keyPages.remove(req.params.id)}));
 router.get('/alerts',(req,res)=>res.json(service.alerts.get()));
 router.put('/alerts',(req,res)=>res.json(service.alerts.save(req.body||{})));
 router.post('/alerts/test',wrap(async(req,res)=>{const ok=await service.alerts.test();res.json({ok,message:ok?'Test alert sent: look at the top right of the screen.':'Alerts are available only on the Mac (EMMA running as the app).'});}));
 router.post('/feed/hide',wrap(async(req,res)=>res.json({changed:service.intel.hideFromDaily(String(req.body.kind||''),String(req.body.id||''),req.body.hide!==false)})));
 router.post('/news/manual',wrap(async(req,res)=>{const r=await service.addManualNews(req.body||{});try{service.intel.learnFromNews(r.id,'manual');}catch{}res.json(r);}));
 router.get('/brief',(req,res)=>res.json(service.brief.build({days:Number(req.query.days)||7,companies:String(req.query.companies||'').split(',').filter(Boolean)})));
 router.post('/brief/ai',wrap(async(req,res)=>res.json(await service.briefAI({days:Number(req.body?.days)||7}))));
 router.get('/my-company',(req,res)=>res.json(service.brief.profile()));
 router.put('/my-company',(req,res)=>res.json(service.brief.saveProfile(req.body||{})));
 router.get('/what-changed',(req,res)=>res.json(service.brief.whatChanged()));
 router.post('/what-changed/seen',(req,res)=>{service.brief.markSeen();res.json({ok:true});});
 router.post('/links/safety',wrap(async(req,res)=>res.json(await service.links.check(Array.isArray(req.body?.urls)?req.body.urls:[]))));
 // Getting started: what a new user has done, to guide the next step.
 router.get('/getting-started',(req,res)=>{const db=store.db,n=sql=>db.prepare(sql).get().n,companies=store.companies(),daily=store.pref('daily',{enabled:false});
  res.json({dismissed:store.pref('guide:dismissed',false)===true,search:!!settings?.snapshot?.().searchReady,profile:!!service.brief.profile().name,companies:companies.length,withWebsite:companies.filter(c=>c.website).length,
   runs:n("SELECT COUNT(*) n FROM runs WHERE status NOT IN ('running','failed')"),review:n('SELECT COUNT(*) n FROM active_news WHERE review=1'),decisions:n('SELECT COUNT(*) n FROM decisions'),notes:n("SELECT COUNT(*) n FROM company_entries WHERE type='note' AND deletedAt IS NULL"),auto:!!daily.enabled});});
 router.post('/getting-started/dismiss',(req,res)=>{store.setPref('guide:dismissed',req.body?.dismissed!==false);res.json({ok:true});});
 router.get('/learning',(req,res)=>res.json(service.intel.learning.summary()));
 router.post('/learning/forget',(req,res)=>res.json({changed:service.intel.learning.forget(String(req.body.kind||''),String(req.body.key||''),String(req.body.companyId||''))}));
 router.get('/radar',(req,res)=>res.json(service.intel.radar(req.query)));
 router.get('/fairs',(req,res)=>res.json(service.intel.fairsBoard()));
 router.get('/intel/:id',wrap(async(req,res)=>{const d=service.intel.dossier(req.params.id);if(!d)throw fail('Company not found.',404);d.noteWatch=service.notes.forCompany(req.params.id);res.json(d);}));
 router.post('/intel/:id/ai',wrap(async(req,res)=>res.json(await service.profileAI(req.params.id))));
 router.post('/people/:id/hide',(req,res)=>res.json({hidden:service.intel.hidePerson(req.params.id,req.body?.hide!==false)}));
router.post('/events/:id/hide',(req,res)=>res.json({hidden:service.intel.hideEvent(req.params.id)}));
 router.post('/news/:id/review',wrap(async(req,res)=>{const changed=service.intel.resolveReview(req.params.id,req.body.accept===true);if(!changed)throw fail('News item not found.',404);res.json({ok:true});}));
 router.post('/cancel',(req,res)=>res.json(service.cancel()));
 router.put('/daily',wrap(async(req,res)=>res.json(service.saveConfig(req.body))));
 router.post('/daily/build',(req,res)=>res.json({day:service.makeBrief()}));
 router.get('/daily',(req,res)=>{const dates=store.db.prepare('SELECT day,generatedAt,newsIds,runId FROM briefs ORDER BY day DESC LIMIT 90').all();const chosen=dates.find(d=>d.day===req.query.day)||dates[0];res.json({dates:dates.map(d=>({day:d.day,generatedAt:d.generatedAt,count:JSON.parse(d.newsIds).length})),brief:chosen?{...chosen,items:JSON.parse(chosen.newsIds).map(id=>store.db.prepare('SELECT * FROM active_news WHERE id=?').get(id)).filter(Boolean).map(store.hydrate)}:null});});
 router.post('/enrich',wrap(async(req,res)=>res.json(await service.enrich(req.body.ids))));
 router.post('/summary/:kind/:id',wrap(async(req,res)=>res.json(await service.summarizeItem(req.params.kind,req.params.id))));
 router.post('/insight',wrap(async(req,res)=>res.json(await service.insight(req.body.question,req.body.filters||{}))));
 router.get('/insights',(req,res)=>res.json(store.db.prepare('SELECT * FROM insights ORDER BY createdAt DESC LIMIT 20').all().map(r=>({...r,answer:JSON.parse(r.answer),sources:JSON.parse(r.newsIds).map(id=>store.db.prepare('SELECT * FROM active_news WHERE id=?').get(id)).filter(Boolean).map(store.hydrate)}))));
 router.get('/compare',wrap(async(req,res)=>{const ids=String(req.query.companies||'').split(',').filter(Boolean);if(ids.length<2||ids.length>6)throw fail('Choose 2 to 6 companies.');const columns=ids.map(id=>{const company=store.company(id);if(!company)throw fail('Company not found.',404);const result=store.query({...req.query,companies:id,mode:'any'},5000);return {company,total:result.total,sampled:result.items.length,undated:result.items.filter(n=>!n.publishedAt).length,topics:Object.fromEntries(Object.keys(TOPICS).map(k=>[k,result.items.filter(n=>n.category===k).length])),sources:new Set(result.items.map(n=>n.source)).size,latest:result.items.slice(0,3)};});const common=store.query({...req.query,companies:ids.join(','),mode:'all'},20);res.json({columns,common});}));
 router.post('/views',wrap(async(req,res)=>{const name=clean(req.body.name,100);if(!name)throw fail('Name the filter.');const filters=Object.fromEntries(['q','companies','mode','category','source','state','from','to','dateBasis','undated'].filter(k=>typeof req.body.filters?.[k]==='string').map(k=>[k,req.body.filters[k].slice(0,1500)]));const id=randomUUID();store.db.prepare('INSERT INTO views VALUES(?,?,?)').run(id,name,JSON.stringify(filters));res.json({id,name,filters});}));
 router.get('/export',wrap(async(req,res)=>{const result=store.query(req.query,5000);const csvCell=value=>'"'+String(value??'').replace(/^[=+@-]/,"' $&").replaceAll('"','""')+'"';const rows=[['Titolo','Companies','Categoria','Source','URL','Published','Rilevata','Estratto','AI summary'],...result.items.map(n=>[n.title,n.companies.map(c=>c.name).join('; '),TOPICS[n.category],n.source,n.url,n.publishedAt,n.discoveredAt,n.summary,n.aiSummary])];res.set('Content-Disposition','attachment; filename="emma-news.csv"').type('text/csv').send('\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));}));
 router.get('/local-info',wrap(async(req,res)=>{const s=settings.snapshot();const info={memoryGB:Math.round(os.totalmem()/1024**3),arch:os.arch(),models:[],available:false};try{const response=await fetch(localBase(s.localUrl)+'/models',{redirect:'error',signal:AbortSignal.timeout(3000)});if(response.ok){const data=await response.json();info.models=(data.data||[]).map(m=>clean(m.id,200)).filter(Boolean);info.available=true;}}catch{}res.json(info);}));
 return router;
}
