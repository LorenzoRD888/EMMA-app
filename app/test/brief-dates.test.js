import {test} from 'node:test';import assert from 'node:assert/strict';
import {openMarket} from '../src/market-store.js';import {createMarketService} from '../src/market-service.js';
const days=n=>new Date(Date.now()-n*86400000).toISOString();
test('recent brief excludes old, future and undated fairs even if just collected',()=>{
 const store=openMarket(':memory:');try{
 const c=store.saveCompany({name:'Date Example',website:'https://example.com'});
 const settings={snapshot:()=>({provider:'none',configured:{}}),client:()=>null};const service=createMarketService(store,settings);
 const insert=store.db.prepare('INSERT INTO events(id,companyId,fairKey,fairName,year,startDate,sourceUrl,firstSeen,baseline) VALUES(?,?,?,?,?,?,?,?,0)');
 for(const [id,date] of [['old',days(500)],['future',days(-150)],['undated',null],['recent',days(3)]])insert.run(id,c.id,id,id,2026,date,'https://example.com/'+id,days(1));
 const items=service.brief.build({days:30,companies:[c.id]}).companies[0]?.items||[];
 assert.deepEqual(items.filter(x=>x.kind==='fair').map(x=>x.id),['recent']);assert.equal(items[0].dateBasis,'event');
 }finally{store.close();}
});
