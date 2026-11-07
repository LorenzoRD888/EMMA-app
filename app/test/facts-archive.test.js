import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openMarket} from '../src/market-store.js';
import {createIntel} from '../src/intel/intel.js';
import {searchFacts} from '../src/intel/facts.js';

test('facts reuse accepted archive without web search, respect hidden facts and trash', async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'emma-facts-'));
 const store=openMarket(path.join(dir,'market.sqlite'));
 try {
  const company=store.saveCompany({name:'Acme Robotics'});
  const intel=createIntel(store);
  store.ingest([{url:'https://news.example/a',title:'Acme Robotics results',summary:'Acme Robotics reported revenue of $30 million in 2024.',publishedAt:'2025-02-01'}],company.id);
  store.db.prepare('UPDATE news SET review=0').run();
  const result=await intel.scanFacts(company,{web:false});
  assert.equal(result.added,1);
  const f=intel.dossier(company.id).facts[0];
  assert.equal(f.year,2024);assert.equal(f.url,'https://news.example/a');
  store.db.prepare('UPDATE facts SET hidden=1').run();
  assert.equal((await intel.scanFacts(company,{web:false})).added,0);
  store.db.prepare('DELETE FROM facts').run();
  store.db.prepare('UPDATE news SET deletedAt=?').run(new Date().toISOString());
  assert.equal((await intel.scanFacts(company,{web:false})).added,0);
 } finally {store.close();await rm(dir,{recursive:true,force:true});}
});

test('facts search includes aliases and founding/funding sources without recency limit',async()=>{
 const calls=[];
 await searchFacts({name:'Geek+',aliases:['Geekplus']},async(q,opts)=>{calls.push({q,opts});return [];});
 assert.ok(calls.some(x=>x.q.includes('"Geekplus"')));
 assert.ok(calls.some(x=>x.q.includes('founded funding')));
 assert.ok(calls.every(x=>x.opts.recent===false));
});
