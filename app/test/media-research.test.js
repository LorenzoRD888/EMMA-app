import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaTasks,collectMedia,publicMediaType,matchesMediaCompany} from '../src/media-research.js';
import {researchPlan,RESEARCH_DEFAULTS} from '../src/research-plan.js';
import {openMarket} from '../src/market-store.js';
import {createIntel} from '../src/intel/intel.js';
import {createMarketService} from '../src/market-service.js';
const company={id:'a',name:'Geek+',aliases:['Geekplus'],keywords:'warehouse robotics',website:'https://www.geekplus.com',feeds:[],mediaPeople:[{name:'Luca Rossi'}]};
test('historical media searches cover newspapers, TV, video, X and confirmed people without restricting to recent news',()=>{
 const tasks=mediaTasks(company);assert.ok(tasks.every(t=>!t.recent&&t.topic==='general'));
 for(const label of ['Bloomberg','BBC','Fox','YouTube','X posts','Luca Rossi'])assert.ok(tasks.some(t=>t.label.includes(label)));
 assert.ok(tasks.some(t=>t.query.includes('Geekplus')));
 const wide=researchPlan(company,RESEARCH_DEFAULTS,{tavily:true});assert.ok(wide.tasks.some(t=>t.media));
 const daily=researchPlan(company,{...RESEARCH_DEFAULTS,mode:'daily'},{tavily:true});assert.ok(!daily.tasks.some(t=>t.media));
});
test('only content URLs on X and YouTube are accepted; unrelated namesakes remain rejected',()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany(company),intel=createIntel(store);
 for(const url of ['https://x.com/geekplus/status/123456','https://www.youtube.com/watch?v=xyz','https://youtu.be/xyz'])assert.equal(intel.judge({url,title:'Geekplus warehouse robotics interview',summary:'Geekplus discusses warehouse robotics'},c,true).verdict,'accept');
 assert.equal(intel.judge({url:'https://x.com/geekplus',title:'Geekplus warehouse robotics',summary:''},c,true).verdict,'reject');
 assert.equal(publicMediaType('https://youtube.com.evil.example/watch?v=x'),'');assert.equal(matchesMediaCompany({title:'Greek National Tourism Organisation'},c),false);
 }finally{store.close();}
});
test('media collection keeps original links, historical dates and unavailable-page excerpts, with Trash respected',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany(company),intel=createIntel(store);
 const rows=[{url:'https://www.bloomberg.com/news/videos/2019-02-17/geekplus',title:'Geekplus warehouse robotics interview',summary:'Geekplus discusses warehouse robotics and automation in an interview.',publishedAt:'2019-02-17'}, {url:'https://x.com/geekplus/status/123456',title:'Geekplus announces warehouse robots',summary:'Geekplus warehouse robotics announcement.'}, {url:'https://www.youtube.com/watch?v=original',title:'Geekplus warehouse robotics interview',summary:'Geekplus interview on warehouse automation.',publishedAt:'2025-07-10'}];
 let calls=0;const run=()=>collectMedia({store,intel,company:c,tasks:mediaTasks(c).slice(0,2),search:async(q,o)=>{assert.equal(o.recent,false);return rows;},fetchPage:async()=>{calls++;return new Response('Blocked',{status:403});}});
 const result=await run();assert.equal(result.added,3);assert.equal(calls,1);
 const saved=store.query({},100).items;assert.equal(saved.find(n=>n.url===rows[0].url).publishedAt,'2019-02-17T00:00:00.000Z');
 const x=saved.find(n=>n.url===rows[1].url);assert.equal(x.category,'social');assert.equal(JSON.parse(x.foundVia).contentType,'X post');
 assert.equal(JSON.parse(saved.find(n=>n.url===rows[0].url).foundVia).coverage,'Search excerpt');
 store.db.prepare('UPDATE news SET deletedAt=? WHERE id=?').run(new Date().toISOString(),x.id);await run();assert.equal(store.query().total,2);
 }finally{store.close();}
});
test('AI profile receives external excerpts and people notes and exposes only valid source links',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany(company);store.ingest([{url:'https://bbc.com/news/robotics',title:'Geekplus robotics',summary:'Warehouse robotics interview',publishedAt:'2025-07-10'}],c.id);const n=store.query().items[0];
 const settings={snapshot:()=>({aiReady:true,provider:'local'}),client:()=>({messages:{create:async req=>{const material=JSON.parse(req.messages[0].content);assert.equal(material.externalSources[0].url,n.url);return {content:[{text:JSON.stringify({summary:'Robotics company',sourceIds:[n.id,'invented']})}]};}}})};
 const service=createMarketService(store,settings);const ai=await service.profileAI(c.id);assert.deepEqual(ai.sources,[{id:n.id,title:n.title,url:n.url}]);
 }finally{store.close();}
});
test('associated-person articles without company evidence require review',()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany(company);store.db.prepare("INSERT INTO people(id,companyId,name,role,location,url,current,snippet,query,firstSeen,lastSeen,baseline,source,checked) VALUES('person',?,'Luca Rossi','Engineer','','https://linkedin.com/in/lucarossi',1,'','added by you',?,?,1,'','verified')").run(c.id,new Date().toISOString(),new Date().toISOString());
 const intel=createIntel(store);assert.equal(intel.judge({title:'Luca Rossi discusses football',summary:'Sports and basketball',url:'https://x.com/lucarossi/status/123456'},c,false).verdict,'reject');assert.equal(intel.judge({title:'Luca Rossi',summary:'warehouse robotics',url:'https://x.com/lucarossi'},c,false).verdict,'reject');assert.equal(intel.judge({title:'Interview with Luca Rossi',summary:'A discussion about warehouse robotics',url:'https://bbc.com/news/interview'},c,false).verdict,'review');
 }finally{store.close();}
});
test('dedicated media job records original URLs and source failures without scanning company website',async()=>{
 const old=process.env.TAVILY_API_KEY;process.env.TAVILY_API_KEY='test-only';const store=openMarket(':memory:');
 try{const c=store.saveCompany(company);let calls=0;
 const service=createMarketService(store,{snapshot:()=>({provider:'none'})},{search:async(q,o)=>{calls++;if(o.domain==='bloomberg.com')throw Object.assign(Error('Provider unavailable'),{public:true});return [{url:'https://bbc.com/news/robotics',title:'Geekplus warehouse robotics',summary:'Geekplus is interviewed about warehouse robotics',publishedAt:'2020-01-01'}];},fetchPage:async()=>new Response('Forbidden',{status:403}),fetchSite:async()=>{throw Error('Company website must not be scanned by media job');}});
 service.startMedia(c.id);assert.throws(()=>service.startMedia(c.id),/already running/);
 for(let i=0;i<100&&service.job().status==='running';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(service.job().status,'partial');assert.equal(calls,13);assert.equal(store.query().items[0].url,'https://bbc.com/news/robotics');
 const detail=JSON.parse(store.db.prepare('SELECT detail FROM runs').get().detail);assert.equal(detail.kind,'media');assert.equal(detail.issues.length,1);assert.ok(detail.audit.every(a=>a.kind!=='search'||a.recent===false));
 }finally{store.close();if(old===undefined)delete process.env.TAVILY_API_KEY;else process.env.TAVILY_API_KEY=old;}
});
test('BBC report title is followed to discover a video without the company in its headline',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany(company),intel=createIntel(store);const report='The Chinese robot army transforming the UK retail industry';const calls=[];
 const result=await collectMedia({store,intel,company:c,tasks:[{query:'Geekplus BBC',label:'Media · BBC',media:true,recent:false}],maxPages:0,search:async(q,o)=>{calls.push({q,o});return o.relatedArticle?[{url:'https://www.youtube.com/watch?v=bbc-original',title:report+' | BBC News',summary:'A BBC News report about warehouse automation.'}]:[{url:'https://www.bbc.com/news/articles/report',title:report,summary:'Geekplus warehouse robotics feature on BBC News.'}];}});
 assert.equal(calls.length,2);assert.equal(calls[1].o.domain,'youtube.com');assert.equal(calls[1].o.recent,false);assert.ok(calls[1].q.includes(report));assert.equal(result.added,2);
 const video=store.db.prepare("SELECT * FROM news WHERE url='https://www.youtube.com/watch?v=bbc-original'").get();assert.ok(video);assert.equal(video.review,1);assert.equal(JSON.parse(video.foundVia).relatedArticle,'https://www.bbc.com/news/articles/report');
 }finally{store.close();}
});
