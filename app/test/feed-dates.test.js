import {test} from 'node:test';import assert from 'node:assert/strict';
import {openMarket} from '../src/market-store.js';import {createIntel} from '../src/intel/intel.js';
const ago=n=>new Date(Date.now()-n*86400000).toISOString();
test('Daily 7 days uses publication dates rather than date found for website pages and research',()=>{
 const store=openMarket(':memory:');try{
 const intel=createIntel(store,{}),c=store.saveCompany({name:'Dates',website:'https://example.com'});
 const insert=store.db.prepare('INSERT INTO site_pages(id,companyId,url,title,kind,via,publishedAt,firstSeen,baseline) VALUES(?,?,?,?,?,?,?,?,0)');
 for(const [id,published,found] of [['old',ago(200),ago(1)],['undated',null,ago(1)],['future',ago(-10),ago(1)],['recent',ago(2),ago(50)]])insert.run(id,c.id,'https://example.com/'+id,id,'product','sitemap',published,found);
 const pub=store.db.prepare('INSERT INTO publications(id,companyId,kind,url,title,publishedAt,firstSeen,baseline) VALUES(?,?,?,?,?,?,?,0)');
 for(const [id,date] of [['pub-old',ago(200)],['pub-undated',null],['pub-future',ago(-10)],['pub-recent',ago(2)]])pub.run(id,c.id,'paper','https://papers.example/'+id,id,date,ago(1));
 const f=intel.feed({days:7});assert.deepEqual(f.items.filter(x=>x.type==='publication').map(x=>x.id),['pub-recent']);assert.deepEqual(f.items.filter(x=>x.type==='site').map(x=>x.id),['recent']);assert.equal(f.counts.site,1);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM site_pages').get().n,4,'all sources remain in archive');
 }finally{store.close();}
});
test('Daily fairs follow actual event dates and never a recent discovery timestamp',()=>{
 const store=openMarket(':memory:');try{
 const intel=createIntel(store,{}),c=store.saveCompany({name:'Dates',website:'https://example.com'});
 const insert=store.db.prepare('INSERT INTO events(id,companyId,fairKey,fairName,year,startDate,endDate,sourceUrl,firstSeen,baseline) VALUES(?,?,?,?,?,?,?,?,?,0)');
 for(const [id,date] of [['old',ago(500)],['future',ago(-100)],['unknown',null],['recent',ago(2)]])insert.run(id,c.id,id,id,2026,date,date,'https://example.com/'+id,ago(1));
 assert.deepEqual(intel.feed({days:7}).items.filter(x=>x.type==='event').map(x=>x.id),['recent']);
 }finally{store.close();}
});
