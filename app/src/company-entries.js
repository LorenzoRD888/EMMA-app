import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {clean,canonical,fail} from './market-store.js';
export const COMPANY_SECTIONS={overview:'Overview',moves:'Strategic moves',watch:'Watched pages',news:'News and media',people:'People',docs:'Documents',hiring:'Hiring',fairs:'Trade fairs',pubs:'Publications',profiles:'Profiles',review:'To review'};
export const ENTRY_TYPES={note:'Note',document:'Document',product:'Product',technology:'Technology',market:'Market',event:'Event',publication:'Publication',profile:'Profile',other:'Other'};
export const MAX_ATTACHMENT_BYTES=10*1024*1024;
export const NOTE_COLORS=['yellow','pink','blue','green','purple'];
const extensions=new Set(['.pdf','.doc','.docx','.xls','.xlsx','.csv','.ppt','.pptx','.txt','.md','.png','.jpg','.jpeg','.webp']);
export function createCompanyEntries(db,{company,attachmentDirectory}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS company_entries(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES companies(id),section TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',type TEXT NOT NULL DEFAULT 'note',contentDate TEXT NOT NULL DEFAULT '',confirmed INTEGER NOT NULL DEFAULT 0,confirmedAt TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,deletedAt TEXT,fileKey TEXT NOT NULL DEFAULT '',fileName TEXT NOT NULL DEFAULT '',fileSize INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS company_entries_sections ON company_entries(companyId,section,deletedAt);`);
 if(!db.prepare('PRAGMA table_info(company_entries)').all().some(c=>c.name==='color'))db.exec("ALTER TABLE company_entries ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow'");
 const hydrate=r=>r?{...r,confirmed:!!r.confirmed,fileUrl:r.fileKey?'/api/market/entries/'+r.id+'/file':''}:null;
 const get=id=>hydrate(db.prepare('SELECT * FROM company_entries WHERE id=?').get(id));
 function list(companyId,{trash=false}={}){return db.prepare(`SELECT * FROM company_entries WHERE companyId=? AND deletedAt IS ${trash?'NOT ':''}NULL ORDER BY confirmed DESC,updatedAt DESC`).all(companyId).map(hydrate);}
 function save(companyId,body,id){
  if(!company(companyId))throw fail('Company not found.',404);
  const previous=id?get(id):null;if(id&&(!previous||previous.companyId!==companyId||previous.deletedAt))throw fail('Information not found.',404);
  const section=body.section??previous?.section;if(!Object.hasOwn(COMPANY_SECTIONS,section))throw fail('Choose a company section.');
  const color=body.color??previous?.color??'yellow';if(!NOTE_COLORS.includes(color))throw fail('Choose a note color.');
  const title=clean(body.title??previous?.title,200);if(!title)throw fail('Enter a title.');
  const type=body.type??previous?.type??'note';if(!Object.hasOwn(ENTRY_TYPES,type))throw fail('Choose an information type.');
  const url=body.url===undefined?previous?.url||'':body.url?canonical(body.url):'';
  const contentDate=body.contentDate??previous?.contentDate??'';
  if(contentDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(contentDate)||!Number.isFinite(Date.parse(contentDate))||new Date(contentDate).toISOString().slice(0,10)!==contentDate))throw fail('Enter a valid date.');
  const content=String(body.content??previous?.content??'').replace(/<[^>]*>/g,'').trim().slice(0,20000),confirmed=body.confirmed===undefined?!!previous?.confirmed:body.confirmed===true;
  const time=new Date().toISOString(),entryId=id||randomUUID(),confirmedAt=confirmed?(body.confirmed===true?time:previous?.confirmedAt||time):null;
  db.prepare(`INSERT INTO company_entries(id,companyId,section,title,content,url,type,contentDate,confirmed,confirmedAt,createdAt,updatedAt,color) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET section=excluded.section,title=excluded.title,content=excluded.content,url=excluded.url,type=excluded.type,contentDate=excluded.contentDate,confirmed=excluded.confirmed,confirmedAt=excluded.confirmedAt,updatedAt=excluded.updatedAt,color=excluded.color`).run(entryId,companyId,section,title,content,url,type,contentDate,confirmed?1:0,confirmedAt,previous?.createdAt||time,time,color);
  return get(entryId);
 }
 function trash(id,restore=false){const row=get(id);if(!row)throw fail('Information not found.',404);db.prepare('UPDATE company_entries SET deletedAt=?,updatedAt=? WHERE id=?').run(restore?null:new Date().toISOString(),new Date().toISOString(),id);return get(id);}
 async function attach(id,bytes,rawName){
  const entry=get(id);if(!entry||entry.deletedAt)throw fail('Information not found.',404);
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_ATTACHMENT_BYTES)throw fail('Choose a file up to 10 MB.');
  const fileName=path.basename(String(rawName||'').replaceAll('\\','/')).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200),ext=path.extname(fileName).toLowerCase();
  if(!extensions.has(ext))throw fail('Use PDF, Office, text, CSV or an image file.');
  if(!attachmentDirectory)throw fail('Attachment storage unavailable.',503);
  await mkdir(attachmentDirectory,{recursive:true,mode:0o700});const fileKey=randomUUID()+ext;
  await writeFile(path.join(attachmentDirectory,fileKey),bytes,{mode:0o600,flag:'wx'});
  // A discarded entry is never silently restored by an upload finishing later.
  const result=db.prepare('UPDATE company_entries SET fileKey=?,fileName=?,fileSize=?,updatedAt=? WHERE id=? AND deletedAt IS NULL').run(fileKey,fileName,bytes.length,new Date().toISOString(),id);
  if(!result.changes)throw fail('Information moved to Trash while uploading.',409);
  return get(id);
 }
 async function file(id){const entry=get(id);if(!entry||entry.deletedAt||!entry.fileKey||!attachmentDirectory)throw fail('File not found.',404);return {name:entry.fileName,bytes:await readFile(path.join(attachmentDirectory,entry.fileKey))};}
 return {get,list,save,trash,attach,file,sections:COMPANY_SECTIONS,types:ENTRY_TYPES};
}
