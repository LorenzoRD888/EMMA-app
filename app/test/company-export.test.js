import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {buildCompanyDocx} from '../src/company-export.js';
const sample=()=>({company:{name:'Example Robotics',aliases:[],description:'Warehouse robotics and intelligent automation.',website:'https://example.com'},facts:[],factLabels:{revenue:'Revenue'},news:[],products:[],publishing:{documents:[],careers:[],news:[]},people:[],events:[],publications:[],manualEntries:[]});
const read=async d=>{const zip=await JSZip.loadAsync(await buildCompanyDocx(d));return {xml:await zip.file('word/document.xml').async('string'),rels:await zip.file('word/_rels/document.xml.rels').async('string'),zip};};

test('company report includes source excerpts and complete personal notes rather than link-only entries',async()=>{
 const d=sample();d.products=[{title:'Picking platform',url:'https://example.com/product',summary:'An archived description of the picking platform with modular robot scheduling and workflows.'}];
 d.manualEntries=[{section:'docs',type:'note',title:'My detailed note',content:'Important detail. '.repeat(80)+'Final sentence must remain complete.',fileName:'technical.pdf'}];
 const {xml,rels}=await read(d);
 assert.match(xml,/modular robot scheduling/);assert.match(xml,/Final sentence must remain complete/);assert.match(xml,/Attachment technical.pdf/);assert.match(xml,/Source register/);assert.match(rels,/https:\/\/example.com\/product/);
 assert.match(xml,/w:bookmarkStart/);assert.match(xml,/w:anchor=/);
});

test('shortlisted records keep every source in the register and explain the selection',async()=>{
 const d=sample();d.news=Array.from({length:11},(_,i)=>({title:'Archived news '+i,url:'https://press.example/'+i,summary:'More detailed archived source content for this article.',publishedAt:'2026-01-'+String(i+1).padStart(2,'0')}));
 const {xml,rels}=await read(d);
 assert.match(xml,/8 of 11 collected items/);
 for(let i=0;i<11;i++)assert.ok(rels.includes('https://press.example/'+i));
 assert.match(xml,/Archived news 0/);
});

test('report has page fields, no empty sections, and rejects unsafe source targets',async()=>{
 const d=sample();d.manualEntries=[{section:'docs',type:'note',title:'Unsafe reference',content:'User text remains visible.',url:'javascript:alert(1)'}];
 const {xml,rels,zip}=await read(d);
 assert.doesNotMatch(rels,/javascript:/);assert.doesNotMatch(xml,/No trade fair participation|<w:t[^>]*>Trade fairs and events<\/w:t>/);
 assert.match(xml,/User text remains visible/);
 const footer=await zip.file('word/footer1.xml').async('string');
 assert.match(footer,/PAGE/);assert.match(footer,/NUMPAGES/);
});

test('media and hiring have their own sections and event excerpts are preserved',async()=>{
 const d=sample();d.news=[{title:'BBC interview',url:'https://www.youtube.com/watch?v=test',summary:'Public broadcaster interview excerpt.',foundVia:{media:'video'}},{title:'Example Robotics is hiring',url:'https://example.com/jobs',summary:'Recruitment details from the archived source.'},{title:'New robotics partnership',url:'https://press.example/deal',summary:'This explains the partnership in detail.',eventType:'partnership',confidence:'high'}];
 const {xml}=await read(d);
 assert.match(xml,/Media interviews and public posts/);assert.match(xml,/Hiring and careers/);assert.match(xml,/This explains the partnership in detail/);assert.match(xml,/Recruitment details/);
});


test('separate video IDs remain distinct in the detailed report',async()=>{
 const d=sample();d.news=[{title:'First product video',url:'https://www.youtube.com/watch?v=one',summary:'First video describes a robot picking solution in detail.',eventType:'product_launch',confidence:'high'},{title:'Second product video',url:'https://www.youtube.com/watch?v=two',summary:'Second video describes a different robot solution in detail.',eventType:'product_launch',confidence:'high'}];
 const {xml}=await read(d);
 assert.match(xml,/First video describes/);assert.match(xml,/Second video describes/);assert.doesNotMatch(xml,/1 of 2 collected/);
});


test('cover combines company identity, archive counts and navigation without a separate contents page',async()=>{
 const d=sample();d.pageCounts={document:15,product:25,news:60};
 const {xml}=await read(d);
 assert.match(xml,/Web pages collected/);assert.match(xml,/Source websites/);assert.match(xml,/Report summary/);assert.doesNotMatch(xml,/Inside this report/);
 assert.ok(xml.indexOf('Report summary')<xml.indexOf('w:pageBreakBefore'));
});

test('profiles explicitly naming another official website are excluded from the company report',async()=>{
 const d=sample();d.profiles=[{title:'An unrelated company',url:'https://directory.example/other',summary:'Website: www.other.example Industry: Travel'}];
 const {xml}=await read(d);assert.doesNotMatch(xml,/An unrelated company/);
});

test('export endpoint returns the redesigned report with counts from active archive sources',async()=>{
 const [{default:express},{openMarket},{createIntel},{marketRoutes}]=await Promise.all([import('express'),import('../src/market-store.js'),import('../src/intel/intel.js'),import('../src/market-routes.js')]);
 const store=openMarket(':memory:');let server;
 try{
  const c=store.saveCompany({name:'Export Example',website:'https://company.example'});
  store.ingest([{title:'Export Example update',url:'https://press.example/news',summary:'Export Example announced a warehouse automation update.'}],c.id);
  store.db.prepare('UPDATE news SET review=0').run();
  store.db.prepare('INSERT INTO site_pages(id,companyId,url,title,kind,via,firstSeen) VALUES(?,?,?,?,?,?,?)').run('page',c.id,'https://company.example/product','Product page','product','test',new Date().toISOString());
  const app=express();app.use(marketRoutes(store,{intel:createIntel(store),sectors:{all:()=>[]},keyPages:{list:()=>[]}},{}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const res=await fetch(`http://127.0.0.1:${server.address().port}/company/${c.id}/export`);
  assert.equal(res.status,200);assert.match(res.headers.get('content-disposition'),/company-report\.docx/);
  const zip=await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));const xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/Web pages collected/);assert.match(xml,/Source websites/);assert.match(xml,/Report summary/);assert.match(xml,/Source register/);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));store.close();}
});


test('cover presents exact dated financial and workforce figures in a compact findings band',async()=>{
 const d=sample();d.factLabels={revenue:'Revenue',employees:'Employees',founded:'Founded'};d.facts=[{kind:'revenue',year:2025,text:'According to the report, the company revenue increased by 31.6% to 3.171 billion RMB.',url:'https://example.com/results'},{kind:'employees',year:2023,text:'Founded in 2015, Example Robotics has over 1500 employees.',url:'https://example.com/about'},{kind:'founded',year:2015,text:'Example Robotics was founded in 2015.',url:'https://example.com/about'}];
 const {xml}=await read(d);const cover=xml.slice(0,xml.indexOf('w:pageBreakBefore'));
 assert.match(cover,/3.171 billion RMB/);assert.match(cover,/Revenue  2025/);assert.match(cover,/over 1500/);assert.match(cover,/Employees  2023/);assert.match(cover,/Report summary/);
});


test('navigation bookmarks have unique numeric IDs and matching end markers for Word',async()=>{
 const d=sample();d.manualEntries=[{section:'docs',type:'note',title:'Saved note',content:'A useful note.'}];
 const {xml}=await read(d);
 const starts=[...xml.matchAll(/<w:bookmarkStart[^>]*w:id="(\d+)"/g)].map(m=>m[1]);
 const ends=[...xml.matchAll(/<w:bookmarkEnd[^>]*w:id="(\d+)"/g)].map(m=>m[1]);
 assert.ok(starts.length>2);assert.equal(new Set(starts).size,starts.length);assert.deepEqual(ends,starts);
});


test('stamp drawing includes the mandatory Office drawing name',async()=>{
 const {xml}=await read(sample());
 const drawings=[...xml.matchAll(/<wp:docPr\b([^>]+)\/?>/g)];
 assert.equal(drawings.length,1);
 for(const [,attributes] of drawings){assert.match(attributes,/\bname="[^"]+"/);assert.match(attributes,/\bid="\d+"/);}
});

test('cover tables use integer twip widths without fractional percentage cells',async()=>{
 const d=sample();d.facts=[{kind:'revenue',text:'Revenue reached 3.171 billion RMB.',year:2025},{kind:'employees',text:'Over 1500 employees.',year:2023},{kind:'founded',text:'Founded in 2015.',year:2015}];d.factLabels={revenue:'Revenue',employees:'Employees',founded:'Founded'};
 const {xml}=await read(d);
 const widths=[...xml.matchAll(/<w:(?:tblW|tcW)\b([^>]+)\/?>/g)];
 assert.ok(widths.length>=9);
 for(const [,attributes] of widths){assert.match(attributes,/w:type="dxa"/);assert.match(attributes,/w:w="\d+"/);}
});
