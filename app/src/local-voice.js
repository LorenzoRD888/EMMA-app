import express from 'express';
import {fork} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
const fail=(message,status=400)=>Object.assign(new Error(message),{status,public:true});
export function createLocalVoice(dataDir,{synthesize,maxEntries=48}={}){
 const root=path.join(dataDir,'kokoro'),cache=path.join(root,'audio');
 let worker,request=null,idleTimer,tail=Promise.resolve(),pending=0;
 function close(){clearTimeout(idleTimer);const old=worker;worker=null;old?.kill();if(request){clearTimeout(request.timer);request.reject(fail('Reading was interrupted. Please try again.',503));request=null;}}
 function generate(text){return new Promise((resolve,reject)=>{
  clearTimeout(idleTimer);
  if(!worker){
   worker=fork(new URL('./local-voice-worker.js',import.meta.url),[],{env:{...process.env,EMMA_VOICE_CACHE:path.join(root,'models')},stdio:['ignore','ignore','pipe','ipc']});
   // Drain diagnostics without logging article text or returning internal paths.
   const child=worker;worker.stderr.on('data',()=>{});
   worker.on('error',()=>{if(worker===child)close();});worker.on('exit',()=>{if(worker!==child)return;worker=null;if(request){clearTimeout(request.timer);request.reject(fail('The local voice could not start. Please restart EMMA.',503));request=null;}});
   worker.on('message',m=>{if(request?.id!==m.id)return;const current=request;request=null;clearTimeout(current.timer);if(m.error)current.reject(fail('The local voice is not ready. The first time EMMA downloads the voice (about 90 MB): check the internet connection and try again.',503));else current.resolve(Buffer.from(m.audio,'base64'));idleTimer=setTimeout(close,300000);idleTimer.unref();});
  }
  // The first time the voice model (about 90 MB) is downloaded: allow up to 10 minutes.
  const id=randomUUID(),timer=setTimeout(()=>{close();},600000);timer.unref();
  request={id,resolve,reject,timer};worker.send({id,text});
 });}
 async function trim(){const names=(await readdir(cache)).filter(n=>/^[a-f0-9]{64}\.wav$/.test(n));if(names.length<=maxEntries)return;const records=await Promise.all(names.map(async name=>({name,time:(await stat(path.join(cache,name))).mtimeMs})));records.sort((a,b)=>a.time-b.time);for(const r of records.slice(0,records.length-maxEntries))await unlink(path.join(cache,r.name)).catch(()=>{});}
 async function speak(value){
  if(typeof value!=='string'||!value.trim()||value.length>1200)throw fail('Enter between 1 and 1200 characters to read.');
  const text=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();if(!text)throw fail('There is no text to read.');
  const key=createHash('sha256').update('kokoro-heart-v1-speed1:'+text).digest('hex'),file=path.join(cache,key+'.wav');
  try{return await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(pending>=6)throw fail('The voice is busy. Please try again shortly.',429);pending++;
  const job=tail.then(async()=>{
   try{return await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
   const audio=await (synthesize||generate)(text);
   if(!Buffer.isBuffer(audio)||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw fail('The local voice returned invalid audio.',503);
   await mkdir(cache,{recursive:true});await writeFile(file,audio,{mode:0o600});await trim();return audio;
  });tail=job.catch(()=>{});try{return await job;}finally{pending--;}
 }
 return {speak,close};
}
export function localVoiceRoutes(dataDir){const router=express.Router(),voice=createLocalVoice(dataDir);router.post('/speak',(req,res,next)=>voice.speak(req.body?.text).then(audio=>{res.set('Cache-Control','private, no-store').type('audio/wav').send(audio);},next));return router;}
