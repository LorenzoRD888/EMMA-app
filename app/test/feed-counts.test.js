import {test} from 'node:test';import assert from 'node:assert/strict';
import {openMarket} from '../src/market-store.js';import {createIntel} from '../src/intel/intel.js';
test('Daily type counts are stable across filters while article selection changes',()=>{
 const store=openMarket(':memory:');try{
 const intel=createIntel(store,{}),c=store.saveCompany({name:'Counts Example',website:'https://example.com'}),now=new Date().toISOString();
 store.ingest([{title:'Counts Example update',url:'https://news.example/update',publishedAt:now}],c.id);store.db.prepare('UPDATE news SET review=0').run();
 store.db.prepare('INSERT INTO site_pages(id,companyId,url,title,kind,via,publishedAt,firstSeen,baseline) VALUES(?,?,?,?,?,?,?,?,0)').run('site-one',c.id,'https://example.com/product','Product','product','sitemap',now,now);
 const all=intel.feed({days:30});assert.equal(all.counts.news,1);assert.equal(all.counts.site,1);
 for(const type of ['news','site','event','people','publication']){const feed=intel.feed({days:30,types:type});assert.deepEqual(feed.counts,all.counts);assert.ok(feed.items.every(i=>i.type===type));}
 const other=store.saveCompany({name:'Other Counts',website:'https://other.example'});const empty=intel.feed({days:30,companies:other.id});assert.equal(empty.items.length,0);assert.ok(Object.values(empty.counts).every(n=>n===0));
 }finally{store.close();}
});
