import test from 'node:test';
import assert from 'node:assert/strict';
import {openMarket} from '../src/market-store.js';
import {createMarketService} from '../src/market-service.js';
const settings={snapshot:()=>({provider:'none'})};
test('a blocked news link saves without a title, date or readable page',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany({name:'Example'});const service=createMarketService(store,settings,{fetchPage:async()=>new Response('Access denied',{status:403})});const result=await service.addManualNews({companyId:c.id,url:'https://press.example/news/warehouse-automation'});assert.ok(result.id);assert.equal(result.read,false);assert.equal(result.publishedAt,null);assert.equal(store.query().total,1);const row=store.query().items[0];assert.equal(row.title,'warehouse automation');assert.equal(row.review,0);assert.equal(row.url,'https://press.example/news/warehouse-automation');
 }finally{store.close();}
});
test('LinkedIn, X and video URLs save immediately with optional user text and correct source labels',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany({name:'Example'});let calls=0;const service=createMarketService(store,settings,{fetchPage:async()=>{calls++;throw Error('No network should be needed for post links');}});
 for(const url of ['https://www.linkedin.com/posts/examplecompany_warehouse-activity-7306409644581666816','https://x.com/examplecompany/status/123456789','https://www.youtube.com/watch?v=example'])await service.addManualNews({companyId:c.id,url,description:'Text pasted by the user',notes:'Discuss at the meeting'});
 assert.equal(calls,0);assert.equal(store.query().total,3);const rows=store.query().items;assert.equal(rows.filter(n=>n.category==='social').length,2);assert.ok(rows.every(n=>n.summary==='Text pasted by the user'));assert.ok(rows.every(n=>n.notes==='Discuss at the meeting'));assert.ok(rows.some(n=>JSON.parse(n.foundVia).contentType==='X post'));
 }finally{store.close();}
});
test('manual saves update duplicates and refuse to silently restore either news or site-page Trash',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany({name:'Example'});const service=createMarketService(store,settings,{fetchPage:async()=>new Response('',{status:403})});const data={companyId:c.id,url:'https://press.example/news',title:'My headline',description:'My excerpt'};const r=await service.addManualNews(data);await service.addManualNews({...data,title:'Updated headline',notes:'My note'});assert.equal(store.query().total,1);assert.equal(store.query().items[0].title,'Updated headline');
 store.db.prepare('UPDATE news SET deletedAt=? WHERE id=?').run(new Date().toISOString(),r.id);await assert.rejects(service.addManualNews(data),/Trash/);
 store.db.prepare("INSERT INTO site_pages(id,companyId,url,title,summary,kind,via,firstSeen,baseline,deletedAt) VALUES('trashed-page',?,'https://example.com/news','Title','','news','sitemap',?,1,?)").run(c.id,new Date().toISOString(),new Date().toISOString());await assert.rejects(service.addManualNews({companyId:c.id,url:'https://example.com/news'}),/Trash/);
 }finally{store.close();}
});
test('sign-in content never becomes the saved title or excerpt',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany({name:'Example'});const service=createMarketService(store,settings,{fetchPage:async()=>new Response('<html><title>Welcome back</title><p>Continue to join or sign in to view this content.</p></html>',{headers:{'Content-Type':'text/html'}})});const result=await service.addManualNews({companyId:c.id,url:'https://press.example/story'});assert.equal(result.read,false);assert.equal(store.query().items[0].summary,'');assert.equal(store.query().items[0].title,'story');
 }finally{store.close();}
});
test('a pasted link without https is normalized and saved',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany({name:'Example'});const service=createMarketService(store,settings,{fetchPage:async()=>new Response('',{status:403})});await service.addManualNews({companyId:c.id,url:'www.press.example/latest'});assert.equal(store.query().items[0].url,'https://www.press.example/latest');
 }finally{store.close();}
});
