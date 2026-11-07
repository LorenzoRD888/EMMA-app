import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {openMarket} from '../src/market-store.js';
import {createMarketService} from '../src/market-service.js';
import {marketRoutes} from '../src/market-routes.js';
test('trash excludes articles, survives re-ingestion, restores associations; manual people persist',async()=>{
 const store=openMarket(':memory:');
 const settings={snapshot:()=>({provider:'none',searchReady:false}),client:()=>null};
 const service=createMarketService(store,settings);
 const app=express();app.use(express.json());app.use('/api',marketRoutes(store,service,settings));app.use((e,q,r,n)=>r.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 const post=async(path,body={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{
  const c=store.saveCompany({name:'Acme',website:'https://acme.example',keywords:'film'}),d=store.saveCompany({name:'Beta'});
  const article={title:'Acme launches film',url:'https://acme.example/news/film',publishedAt:new Date().toISOString(),summary:'Acme film product'};
  store.ingest([article],c.id);store.ingest([article],d.id);const id=store.query().items[0].id;
  await post('/trash/news/'+id);assert.equal(store.query().total,0);assert.equal(service.intel.dossier(c.id).news.length,0);assert.equal(service.intel.feed({days:30}).items.filter(i=>i.id===id).length,0);
  store.ingest([article],c.id);assert.equal(store.query().total,0);const trash=await(await fetch(base+'/trash')).json();assert.equal(trash.length,1);assert.equal(trash[0].companies.length,2);
  await post('/trash/news/'+id,{restore:true});assert.equal(store.query().total,1);assert.equal(store.query().items[0].companies.length,2);
  store.db.prepare(`INSERT INTO site_pages(id,companyId,url,title,summary,kind,via,firstSeen,baseline) VALUES('site-test',?,?,?,'','news','test',?,0)`).run(c.id,'https://acme.example/site-news','Site update',new Date().toISOString());
  await post('/trash/site/site-test');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM active_site_pages').get().n,0);await post('/trash/site/site-test',{restore:true});assert.equal(store.db.prepare('SELECT COUNT(*) n FROM active_site_pages').get().n,1);
  await post('/people/'+c.id,{name:'Luca Rossi',role:'Engineer',notes:'Known colleague'});
  await post('/people/'+c.id,{name:'Luca Rossi',role:'R&D Manager'});
  let people=service.intel.dossier(c.id).people;assert.equal(people.length,1);assert.equal(people[0].checked,'verified');assert.equal(people[0].query,'added by you');assert.equal(people[0].role,'R&D Manager');
  service.intel.recheckAll();assert.equal(service.intel.dossier(c.id).people[0].checked,'verified');
  const bad=await fetch(base+'/people/'+c.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Luca',url:'javascript:alert(1)'})});assert.equal(bad.status,400);
 }finally{await new Promise(r=>server.close(r));store.close();}
});
