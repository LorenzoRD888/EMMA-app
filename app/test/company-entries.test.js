import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {openMarket} from '../src/market-store.js';
import {createMarketService} from '../src/market-service.js';
import {marketRoutes} from '../src/market-routes.js';
import {COMPANY_SECTIONS} from '../src/company-entries.js';
test('each company section accepts editable information and confirmed sources; data survives reopening',async()=>{
 const sectionCount=Object.keys(COMPANY_SECTIONS).length;const dir=await mkdtemp(path.join(os.tmpdir(),'emma-entries-'));let store=openMarket(path.join(dir,'market.sqlite'));
 try{const c=store.saveCompany({name:'Example'}),other=store.saveCompany({name:'Other'});
 for(const section of Object.keys(COMPANY_SECTIONS))store.entries.save(c.id,{section,title:section+' note',content:'First line\nSecond line',confirmed:true,url:'https://example.com/reference',contentDate:'2026-11-05'});
 assert.equal(store.entries.list(c.id).length,sectionCount);let item=store.entries.list(c.id)[0];assert.ok(item.confirmedAt);assert.match(item.content,/\n/);
 assert.throws(()=>store.entries.save(other.id,{title:'Wrong company'},item.id),/not found/);assert.throws(()=>store.entries.save(c.id,{section:'unknown',title:'X'}),/section/);assert.throws(()=>store.entries.save(c.id,{section:'docs',title:'X',url:'javascript:alert(1)'}),/address/);assert.throws(()=>store.entries.save(c.id,{section:'docs',title:'X',contentDate:'2026-02-31'}),/date/);
 item=store.entries.save(c.id,{content:'Changed',confirmed:false},item.id);assert.equal(item.confirmedAt,null);assert.equal(item.content,'Changed');
 const id=c.id;store.close();store=openMarket(path.join(dir,'market.sqlite'));assert.equal(store.entries.list(id).length,sectionCount);
 const service=createMarketService(store,{snapshot:()=>({provider:'none'})});assert.equal(service.intel.dossier(id).manualEntries.length,sectionCount);
 store.entries.trash(item.id);assert.equal(store.entries.list(id).length,sectionCount-1);store.entries.trash(item.id,true);assert.equal(store.entries.list(id).length,sectionCount);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('attachments download unchanged, reject unsafe types and remain recoverable with Trash',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'emma-attachments-'));const store=openMarket(path.join(dir,'market.sqlite'));
 try{const c=store.saveCompany({name:'Example'});const e=store.entries.save(c.id,{section:'docs',title:'Technical sheet'});const bytes=Buffer.from('%PDF-1.4\nexample');
 const attached=await store.entries.attach(e.id,bytes,'../../Technical sheet.pdf');assert.equal(attached.fileName,'Technical sheet.pdf');assert.deepEqual((await store.entries.file(e.id)).bytes,bytes);
 await assert.rejects(store.entries.attach(e.id,Buffer.from('script'),'script.html'),/PDF/);await assert.rejects(store.entries.attach(e.id,Buffer.alloc(10*1024*1024+1),'big.pdf'),/10 MB/);
 store.entries.trash(e.id);await assert.rejects(store.entries.file(e.id),/not found/);store.entries.trash(e.id,true);assert.deepEqual((await store.entries.file(e.id)).bytes,bytes);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('API saves notes, handles raw file uploads and restores user information from shared Trash',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'emma-entry-api-')),store=openMarket(path.join(dir,'market.sqlite'));let server;
 try{const c=store.saveCompany({name:'Example'}),service=createMarketService(store,{snapshot:()=>({provider:'none'})});const app=express();app.use(express.json({limit:'2mb'}));app.use('/api',marketRoutes(store,service,{}));app.use((e,q,r,n)=>r.status(e.status||500).json({error:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const json=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return response.json();};
 const e=await json('/company/'+c.id+'/entries',{section:'docs',title:'Datasheet',content:'My notes'});
 const bytes=Buffer.alloc(2*1024*1024+10,65);const upload=await fetch(base+'/entries/'+e.id+'/file',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent('Manual.pdf')},body:bytes});assert.equal(upload.status,200,await upload.clone().text());
 const download=await fetch(base+'/entries/'+e.id+'/file');assert.match(download.headers.get('content-disposition'),/attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 await json('/trash/entry/'+e.id,{});const trash=await(await fetch(base+'/trash')).json();assert.equal(trash[0].kind,'entry');await json('/trash/entry/'+e.id,{restore:true});assert.equal(store.entries.list(c.id).length,1);
 }finally{if(server)await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
});
test('AI profile receives section notes and file metadata without pretending file content was read',async()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany({name:'Example'});store.entries.save(c.id,{section:'overview',title:'Technology',type:'technology',content:'Barrier coating',confirmed:true});
 const settings={snapshot:()=>({aiReady:true,provider:'local'}),client:()=>({messages:{create:async req=>{const material=JSON.parse(req.messages[0].content);assert.equal(material.manualInformation[0].content,'Barrier coating');assert.equal(material.manualInformation[0].confirmed,true);assert.equal(material.manualInformation[0].attachmentContentRead,false);return {content:[{text:'{"summary":"Company profile"}'}]};}}})};
 await createMarketService(store,settings).profileAI(c.id);
 }finally{store.close();}
});

test('post-it colors and section changes persist, including Hiring; trash preserves the color',()=>{
 const store=openMarket(':memory:');try{const c=store.saveCompany({name:'Example'});
 for(const color of ['yellow','pink','blue','green','purple']){const n=store.entries.save(c.id,{section:'docs',type:'note',title:'Reminder',content:'Follow up',color});assert.equal(n.color,color);const moved=store.entries.save(c.id,{section:'hiring',color:'pink'},n.id);assert.equal(moved.section,'hiring');assert.equal(moved.color,'pink');store.entries.trash(n.id);store.entries.trash(n.id,true);assert.equal(store.entries.get(n.id).color,'pink');}
 assert.throws(()=>store.entries.save(c.id,{section:'docs',title:'Invalid',color:'red'}),/color/);
 }finally{store.close();}
});
