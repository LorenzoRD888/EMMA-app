// Readable company report, with substantial excerpts and a linked source register.
import {readFile} from 'node:fs/promises';
import {STRATEGIC_EVENT_TYPES} from './intel/strategic-events.js';
import {publicMediaType} from './media-research.js';
const clean=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const day=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):'';};
const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};
// Strip navigation and download-form text without rewriting source claims.
function readableText(value){
 const text=clean(value).replace(/-->/g,' ').replace(/Shelf-to-Person Tote-to-Person Pallet-to-Person Robot Arm Picking Station Sorting Intralogistics All-in-One Software 3D Experience/gi,'').split(/Document has been sent|Join Pilot Waitlist|Download Brochure|Contact us|Cookie policy/i)[0];
 const fragments=text.split(/(?<=[.!?。！？])\s+|\s+[—]\s+/u);
 const kept=fragments.filter(s=>{
  const letters=(s.match(/\p{L}/gu)||[]).length;
  return s.length>=40&&letters/s.length>.48&&!/document has been sent|still not downloaded|thank you|read on|accept cookies|privacy policy|sign in to|downloaded in your|all rights reserved|subscribe to|for inquiries|tel:|email:/i.test(s);
 });
 return kept.join(' ').trim();
}
const pageKey=url=>{try{const u=new URL(url);for(const key of [...u.searchParams.keys()])if(/^utm_|^(hsLang|fbclid|gclid)$/i.test(key))u.searchParams.delete(key);return u.hostname+u.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i,'')+u.search;}catch{return url;}};
const preferredLanguage=url=>{try{const part=new URL(url).pathname.split('/')[1];return !/^[a-z]{2}(?:-[a-z]{2})?$/i.test(part)||/^en$/i.test(part);}catch{return true;}};
const safeUrl=url=>{try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const titleOf=r=>{if(r.title&&!/^https?:\/\//i.test(r.title))return clean(r.title);try{return decodeURIComponent(new URL(r.url).pathname.split('/').filter(Boolean).pop()||'').replace(/[-_]+/g,' ').replace(/\.pdf$/i,'')||host(r.url);}catch{return clean(r.title)||'Source';}};
function excerpt(text,limit=1400){const s=clean(text);if(s.length<=limit)return s;const cut=s.slice(0,limit);const end=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('! '),cut.lastIndexOf('? '));return (end>limit*.55?cut.slice(0,end+1):cut.slice(0,cut.lastIndexOf(' ')))+' […]';}

export async function buildCompanyDocx(d,extra={}){
 const {Document,Packer,Paragraph,TextRun,HeadingLevel,ExternalHyperlink,InternalHyperlink,Bookmark,BookmarkStart,BookmarkEnd,Table,TableRow,TableCell,WidthType,BorderStyle,Header,Footer,PageNumber,ImageRun,AlignmentType}=extra.docx||await import('docx');
 const c=d.company,news=d.news||[],entries=d.manualEntries||[],facts=d.facts||[];
 const out=[],sources=[],sourceMap=new Map(),contents=[];
 // docx creates a fresh ID generator per Bookmark; assign document-wide IDs.
 let bookmarkId=0;
 const bookmark=options=>{const b=new Bookmark(options);const id=++bookmarkId;b.start=new BookmarkStart(options.id,id);b.end=new BookmarkEnd(id);return b;};
 const GREEN='285E4E',GRAY='62685F';
 const run=(text,options={})=>new TextRun({text:String(text||''),...options});
 const para=(text,options={})=>new Paragraph({children:[run(text)],spacing:{after:150,line:280},...options});
 const P=(text,options={})=>{if(text)out.push(para(text,options));};
 const small=text=>P(text,{style:'Caption',spacing:{after:140,line:240}});
 const link=(url,label)=>new ExternalHyperlink({link:url,children:[run(label,{color:GREEN,underline:{}})]});
 const source=(url,title)=>{
  const u=safeUrl(url);if(!u)return null;
  if(!sourceMap.has(u)){const s={id:sources.length+1,url:u,title:title||host(u)};sourceMap.set(u,s);sources.push(s);}
  return sourceMap.get(u);
 };
 const cite=(url,title)=>{const s=source(url,title);if(s)out.push(new Paragraph({children:[link(s.url,`Source ${String(s.id).padStart(3,'0')}  |  ${host(s.url)}`)],style:'Source',spacing:{after:200}}));};
 const H1=text=>{const id='section'+(contents.length+1);contents.push({id,text});out.push(new Paragraph({heading:HeadingLevel.HEADING_1,children:[bookmark({id,children:[run(text)]})],keepNext:true,spacing:{before:360,after:160}}));};
 const H2=text=>out.push(new Paragraph({text,heading:HeadingLevel.HEADING_2,keepNext:true,spacing:{before:240,after:100}}));
 const bodyText=r=>readableText(r.summary)||readableText(r.lead)||readableText(r.detail)||'';
 const entry=({title,meta,text,url,note,full=false})=>{
  out.push(new Paragraph({children:[run(title,{bold:true})],keepNext:true,spacing:{before:200,after:65}}));
  if(meta)out.push(para(meta,{style:'Caption',keepNext:!!text,spacing:{after:90,line:230}}));
  if(text){const paragraphs=full?String(text).split(/\n\s*\n/):[excerpt(text)];for(const t of paragraphs)P(t,{spacing:{after:100,line:275}});}
  if(note)P('Your note: '+note,{shading:{fill:'F3F1E6'},indent:{left:120,right:120},spacing:{before:60,after:100,line:270}});
  cite(url,title);
 };
 const noBorder={style:BorderStyle.NONE};
 const matrix=(labels,values,{fill='EFF3EA',valueSize=36}={})=>new Table({width:{size:9500,type:WidthType.DXA},layout:'fixed',columnWidths:labels.map(()=>Math.floor(9500/labels.length)),rows:[new TableRow({children:labels.map((label,i)=>new TableCell({width:{size:Math.floor(9500/labels.length),type:WidthType.DXA},margins:{top:210,bottom:210,left:210,right:170},shading:{fill},borders:{top:noBorder,bottom:noBorder,left:noBorder,right:noBorder},children:[para(String(values[i]),{children:[run(String(values[i]),{bold:true,size:valueSize,color:GREEN})],spacing:{after:65,line:300}}),para(label,{children:[run(label,{size:18,color:GRAY})],spacing:{after:0,line:230}})]}))})]});

 const latest=list=>[...list].sort((a,b)=>(Date.parse(b.publishedAt||b.contentDate||b.firstSeen)||0)-(Date.parse(a.publishedAt||a.contentDate||a.firstSeen)||0));
 const manual=section=>{
  const list=entries.filter(e=>e.section===section);if(!list.length)return;
  H2('Your notes and saved information');
  for(const e of list)entry({title:e.title,meta:[e.type==='note'?'Personal note':'Saved by you',e.confirmed?'Confirmed '+day(e.confirmedAt):'',e.contentDate,e.fileName?'Attachment '+e.fileName:''].filter(Boolean).join('  |  '),text:e.content,url:e.url,full:true});
 };
 const renderList=(list,render,{limit=8}={})=>{
  for(const r of list)source(r.url||r.sourceUrl,titleOf({...r,url:r.url||r.sourceUrl,title:r.title||r.fairName||r.name}));
  const seen=new Set();
  const ranked=latest(list).sort((a,b)=>Number(preferredLanguage(b.url))-Number(preferredLanguage(a.url))||Number(!!bodyText(b))-Number(!!bodyText(a)));
  const selected=ranked.filter(r=>{const key=pageKey(r.url||r.sourceUrl);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit);
  for(const r of selected)render(r);
  if(list.length>selected.length)small(`${selected.length} of ${list.length} collected items are described here. The remaining sources are listed in the source register. Language versions of the same page are grouped in this selection.`);
 };
 const moves=news.filter(n=>n.eventType&&n.confidence!=='low');
 const moveSet=new Set(moves.map(n=>n.url));
 const media=news.filter(n=>!moveSet.has(n.url)&&(publicMediaType(n.url)||(n.foundVia?.media&&host(n.url)!==host(c.website))));
 const mediaSet=new Set(media.map(n=>n.url));
 const regular=news.filter(n=>!mediaSet.has(n.url)&&!moveSet.has(n.url));
 const docs=d.publishing?.documents||[],products=d.products||[],careers=d.publishing?.careers||[];
 const hireNews=regular.filter(n=>/hiring|vacanc|job opening|recruit|careers|assum|lavoro|linkedin\.com\/jobs/i.test(n.title+' '+n.url));
 const hireSet=new Set(hireNews.map(n=>n.url));
 const sectionExists=key=>entries.some(e=>e.section===key);
 const profiles=(d.profiles||[]).filter(p=>{const website=String(p.summary||'').match(/website:\s*(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i)?.[1];return !website||!c.website||website.toLowerCase()===host(c.website);});
 // A single editorial brief: consistent alignment, restrained EMMA colors, clear hierarchy.
 const coverLabel=text=>out.push(new Paragraph({children:[run(text,{bold:true,size:18,color:GRAY,characterSpacing:12})],keepNext:true,spacing:{before:240,after:110,line:240}}));
 try{const bytes=extra.logo||await readFile(new URL('../public/emma-stamp.png',import.meta.url));out.push(new Paragraph({children:[new ImageRun({type:'png',data:bytes,transformation:{width:155,height:52},altText:{name:'EMMA ink stamp',title:'EMMA',description:'EMMA ink stamp'}}),run('\t'),run(day(extra.generatedAt||new Date()),{size:18,color:GRAY})],indent:{left:-420},tabStops:[{type:'right',position:9500}],spacing:{after:240}}));}catch{}
 P('COMPANY INTELLIGENCE',{children:[run('COMPANY INTELLIGENCE',{size:18,color:GREEN,bold:true,characterSpacing:25})],spacing:{after:90,line:240}});
 out.push(new Paragraph({text:c.name,heading:HeadingLevel.TITLE,spacing:{after:150}}));
 const intro=c.description||d.ai?.summary||d.profile?.description;
 if(intro)P(excerpt(intro,420),{children:[run(excerpt(intro,420),{size:25,color:'36453B'})],spacing:{after:160,line:315}});
 const identity=[c.sector,c.country,(c.aliases||[]).length?'Also known as '+(c.aliases||[]).join(', '):''].filter(Boolean);
 if(identity.length)P(identity.join('  |  '),{children:[run(identity.join('  |  '),{size:19,color:GRAY})],spacing:{after:90,line:255}});
 if(safeUrl(c.website))out.push(new Paragraph({children:[link(safeUrl(c.website),host(c.website))],spacing:{after:190}}));
 const allPages=Object.values(d.pageCounts||{}).reduce((n,v)=>n+Number(v||0),0);
 const siteUrls=[c.website,...news.map(n=>n.url),...products.map(p=>p.url),...docs.map(p=>p.url),...careers.map(p=>p.url),...(d.publishing?.news||[]).map(p=>p.url)].filter(Boolean);
 const sourceSites=extra.archiveCounts?.sourceSites??new Set(siteUrls.map(host).filter(Boolean)).size;
 coverLabel('Research coverage');
 out.push(matrix(['Web pages collected','Source websites','News and posts','People'],[extra.archiveCounts?.webPages??(allPages||siteUrls.length),sourceSites,extra.archiveCounts?.news??news.length,(d.people||[]).length]));
 const details=[[(d.pageCounts?.document??docs.length),'documents'],[(d.pageCounts?.product??products.length),'products'],[(d.publications||[]).length,'publications']].filter(([n])=>n>0).map(([n,label])=>n+' '+label);
 if(details.length)P(details.join('    ·    '),{children:[run(details.join('    ·    '),{size:18,color:GRAY})],spacing:{before:90,after:60,line:240}});
 const findingValue=f=>{
  if(f.kind==='founded'&&f.year&&String(f.text).includes(String(f.year)))return String(f.year);
  if(f.kind==='employees')return String(f.text).match(/(?:(?:over|more than|about|approximately|oltre|circa)\s+)?[\d,.]+\s+(?:employees|dipendenti|addetti)/i)?.[0]?.replace(/\s+(?:employees|dipendenti|addetti)$/i,'')||null;
  if(f.kind==='revenue')return String(f.text).match(/(?:revenue|turnover|fatturato|ricavi).{0,110}?\b(?:of|to|was|reached|totalled)\s+((?:[$€£]\s*)?[\d,.]+\s*(?:billion|million|bn|mln|miliard\w*|milion\w*)\s*(?:RMB|USD|EUR|GBP|dollars|euros|yuan)?)/i)?.[1]||null;
  return null;
 };
 const highlights=[];for(const k of Object.keys(d.factLabels||{})){const f=facts.find(f=>f.kind===k);const value=f&&findingValue(f);if(value)highlights.push({label:(d.factLabels[k]||k)+(f.year&&k!=='founded'?'  '+f.year:''),value});if(highlights.length===3)break;}
 if(highlights.length){coverLabel('Key findings');out.push(matrix(highlights.map(f=>f.label),highlights.map(f=>f.value),{fill:'F5F1E6',valueSize:26}));P('Historical figures retain their source year. Details and references follow.',{children:[run('Historical figures retain their source year. Details and references follow.',{size:17,color:GRAY})],spacing:{before:90,after:40,line:225}});}
 const coverEnd=out.length;
 H1('Company overview');
 if(c.description)P(c.description);
 if(d.ai?.summary){H2('EMMA analysis');P(d.ai.summary);if(d.ai.recentFocus)P(d.ai.recentFocus);small('AI analysis prepared '+(day(d.ai.generatedAt)||'previously')+'.');for(const s of d.ai.sources||[])cite(s.url,s.title);}
 if(d.profile?.description&&clean(d.profile.description)!==clean(c.description)){H2('From the official website');P(d.profile.description);cite(c.website,'Official website');}
 if(c.products)P('Products and brands: '+c.products);
 if(d.linkedin?.size||d.linkedin?.followers){P([d.linkedin.size&&'Company size on LinkedIn: '+d.linkedin.size,d.linkedin.followers&&'Followers: '+d.linkedin.followers].filter(Boolean).join('. '));cite(d.linkedin.url,'LinkedIn company profile');}
 manual('overview');
 if(facts.length){H1('Key facts');for(const [k,label] of Object.entries(d.factLabels||{})){const group=facts.filter(f=>f.kind===k);if(group.length){H2(label);for(const f of group)entry({title:f.year?'Year '+f.year:'Year not specified',text:f.text,meta:f.source,url:f.url,full:true});}}}
 const newsEntry=n=>entry({title:titleOf(n),meta:[n.publishedAt?'Published '+day(n.publishedAt):'Publication date unavailable',STRATEGIC_EVENT_TYPES[n.eventType],n.source||host(n.url),n.category==='social'?publicMediaType(n.url)||'Public post':''].filter(Boolean).join('  |  '),text:publicMediaType(n.url)==='LinkedIn post'?(readableText(n.lead)||bodyText(n)):bodyText(n),url:n.url,note:n.notes});
 if(moves.length||sectionExists('moves')){H1('Strategic moves');renderList(moves,newsEntry);manual('moves');}
 if(media.length){H1('Media interviews and public posts');renderList(media,newsEntry);}
 const ordinary=regular.filter(n=>!hireSet.has(n.url));
 if(ordinary.length||sectionExists('news')){H1('News and announcements');renderList(ordinary,newsEntry);manual('news');}
 const pageEntry=p=>entry({title:titleOf(p),meta:[p.publishedAt?'Published '+day(p.publishedAt):p.firstSeen?'Collected '+day(p.firstSeen):'',host(p.url)].filter(Boolean).join('  |  '),text:readableText(p.lead)||bodyText(p),url:p.url});
 if(products.length){H1('Products and technologies');renderList(products,pageEntry,{limit:6});}
 if(docs.length||sectionExists('docs')){H1('Documents and technical resources');renderList(docs,pageEntry);manual('docs');}
 if(careers.length||hireNews.length||sectionExists('hiring')){H1('Hiring and careers');renderList([...careers,...hireNews],pageEntry,{limit:6});manual('hiring');}
 const websiteNews=d.publishing?.news||[];
 if(websiteNews.length){H1('Official website announcements');renderList(websiteNews,pageEntry,{limit:6});}
 if((d.people||[]).length||sectionExists('people')){H1('People associated with the company');for(const p of d.people||[])entry({title:p.name,meta:[p.role,p.location,p.checked==='website'?'Listed on the official website':p.checked==='verified'?p.query==='added by you'?'Association confirmed by you':'Verified association':'Association to verify'].filter(Boolean).join('  |  '),text:p.snippet,url:p.url,note:p.notes});manual('people');}
 if((d.events||[]).length||sectionExists('fairs')){H1('Trade fairs and events');for(const e of d.events||[])entry({title:e.fairName+(e.year?' '+e.year:''),meta:[e.city,e.startDate&&day(e.startDate),e.booth&&'Stand '+e.booth,e.status].filter(Boolean).join('  |  '),url:e.sourceUrl});manual('fairs');}
 if((d.publications||[]).length||sectionExists('pubs')){H1('Research and patents');renderList(d.publications||[],p=>entry({title:titleOf(p),meta:[p.kind==='patent'?'Patent':'Research paper',day(p.publishedAt),p.venue].filter(Boolean).join('  |  '),text:[p.authors,p.detail].filter(Boolean).join('\n\n'),url:p.url}));manual('pubs');}
 if((extra.keyPages||[]).length||sectionExists('watch')){H1('Watched pages');for(const p of extra.keyPages||[]){entry({title:p.label||titleOf(p),meta:[p.lastChecked&&'Checked '+day(p.lastChecked),p.lastChanged&&'Changed '+day(p.lastChanged)].filter(Boolean).join('  |  '),url:p.url});for(const ch of (p.changes||[]).slice(0,3)){P('Change detected '+day(ch.detectedAt));if(ch.added?.length)P('Added: '+ch.added.join(' | '));if(ch.removed?.length)P('Removed: '+ch.removed.join(' | '));}}manual('watch');}
 if(profiles.length||sectionExists('profiles')){H1('Company profiles');for(const p of profiles)pageEntry(p);manual('profiles');}
 if(sectionExists('review')){H1('Your information to review');manual('review');}
 H1('Coverage and reading notes');
 P('The report brings together the company information, source excerpts and personal notes saved in EMMA. Source excerpts remain in their original language. The source register provides clickable access to the original publications.');
 P('An absent section means that no corresponding information was available in this archive snapshot. Publication dates and dates of collection are distinguished throughout the report. Historical employee counts and financial figures should be read with the year shown.');
 if(d.ai?.summary)P('The EMMA analysis is an AI summary. Other excerpts reproduce archived source text.');
 if(entries.some(e=>e.fileName))P('Saved attachments are identified by filename. Their files are not embedded in this report and their contents are not inferred from the filename.');
 const represented=docs.length+products.length+careers.length+websiteNews.length;
 const collected=['document','product','career','news'].reduce((n,k)=>n+(d.pageCounts?.[k]||0),0);
 if(collected>represented)P(`Website coverage: ${represented} recent pages are represented in this export, from ${collected} collected pages in these categories. Other pages remain accessible in the EMMA archive.`);
 H1('Source register');
 for(const s of sources)out.push(new Paragraph({children:[run(String(s.id).padStart(3,'0')+'  ',{bold:true}),link(s.url,s.title),run('  |  '+host(s.url),{color:GRAY,size:17})],spacing:{after:135,line:255}}));
 // Insert navigation after cover, before substantive content.
 const shortLabels={'Company overview':'Company overview','Key facts':'Key facts','Strategic moves':'Strategic moves','Media interviews and public posts':'Media and interviews','News and announcements':'News and announcements','Products and technologies':'Products and technology','Documents and technical resources':'Documents and resources','Hiring and careers':'Hiring','Official website announcements':'Company announcements','People associated with the company':'People','Trade fairs and events':'Trade fairs','Research and patents':'Research and patents','Watched pages':'Watched pages','Company profiles':'Company profiles','Your information to review':'Information to review','Coverage and reading notes':'Coverage notes','Source register':'Sources'};
 const nav=[new Paragraph({text:'Report summary',heading:HeadingLevel.HEADING_2,keepNext:true,spacing:{before:270,after:135}})];
 for(let i=0;i<contents.length;i+=2){const row=[];for(let j=i;j<Math.min(i+2,contents.length);j++){if(j>i)row.push(run('\t'));row.push(run(String(j+1).padStart(2,'0')+'   ',{color:GREEN,bold:true,size:18}),new InternalHyperlink({anchor:contents[j].id,children:[run(shortLabels[contents[j].text]||contents[j].text,{color:'303A32',size:20})]}));}nav.push(new Paragraph({children:row,tabStops:[{type:'left',position:4750}],spacing:{after:90,line:255}}));}
 out[coverEnd]=new Paragraph({pageBreakBefore:true,heading:HeadingLevel.HEADING_1,children:[bookmark({id:contents[0].id,children:[run(contents[0].text)]})],spacing:{before:0,after:160}});
 out.splice(coverEnd,0,...nav);
 const doc=new Document({creator:'EMMA',title:c.name+' company intelligence report',description:'Company report with archived excerpts and linked sources',styles:{default:{document:{run:{font:{ascii:'Calibri',hAnsi:'Calibri',eastAsia:'Arial Unicode MS',cs:'Arial'},size:22,color:'242922'},paragraph:{spacing:{after:150,line:280}}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',next:'Normal',run:{font:{ascii:'Calibri',hAnsi:'Calibri',eastAsia:'Arial Unicode MS'},size:80,bold:true,color:'000000'},paragraph:{keepNext:true}},{id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',run:{font:'Calibri',size:30,bold:true,color:'000000'},paragraph:{keepNext:true}},{id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',run:{font:'Calibri',size:24,bold:true,color:'000000'},paragraph:{keepNext:true}},{id:'Caption',name:'Caption',basedOn:'Normal',run:{size:18,color:GRAY}},{id:'Source',name:'Source',basedOn:'Normal',run:{size:18,color:GREEN}}]},sections:[{properties:{titlePage:true,page:{size:{width:11906,height:16838},margin:{top:1100,bottom:1100,left:1200,right:1200,header:500,footer:500}}},headers:{default:new Header({children:[para('EMMA    '+c.name,{children:[run('EMMA    '+c.name,{size:17,color:'000000'})],spacing:{after:0}})]})},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[run('EMMA   |   ',{size:17,color:GRAY}),new TextRun({children:[PageNumber.CURRENT],size:17}),run(' / ',{size:17}),new TextRun({children:[PageNumber.TOTAL_PAGES],size:17})]})]})},children:out}]});
 return Packer.toBuffer(doc);
}
