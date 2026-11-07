// Local voice (Kokoro, installed with EMMA as the kokoro-js library).
// The text you listen to never leaves the computer: it is read by a model that runs here.
// The only network access ever allowed is the one-time download of the voice model
// (about 90 MB, from Hugging Face) into data/kokoro/models. After that EMMA works offline.
import {KokoroTTS} from 'kokoro-js';
import {env} from '@huggingface/transformers';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const MODEL='onnx-community/Kokoro-82M-v1.0-ONNX',DTYPE='q8',VOICE='af_heart';
const cache=process.env.EMMA_VOICE_CACHE;
const files=['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx'].map(f=>path.join(cache,MODEL,f));
const installed=()=>files.every(f=>existsSync(f));
const MODEL_HOSTS=/(^|\.)(huggingface\.co|hf\.co)$/i;

env.cacheDir=cache;env.localModelPath=cache;env.useFSCache=true;env.allowLocalModels=true;
const realFetch=globalThis.fetch;let downloading=false;
globalThis.fetch=async(url,options)=>{
 const host=(()=>{try{return new URL(String(url?.url||url)).hostname;}catch{return '';}})();
 if(downloading&&MODEL_HOSTS.test(host))return realFetch(url,options);
 throw new Error('Network access is disabled for local speech.');
};

let model;
async function load(){
 if(model)return model;
 const first=!installed();
 env.allowRemoteModels=first;downloading=first;
 try{model=await KokoroTTS.from_pretrained(MODEL,{dtype:DTYPE,device:'cpu'});}
 finally{downloading=false;env.allowRemoteModels=false;}
 if(first)await writeFile(path.join(path.dirname(cache),'ready.json'),JSON.stringify({model:MODEL,dtype:DTYPE,voice:VOICE,readyAt:new Date().toISOString()})).catch(()=>{});
 return model;
}

process.on('message',async message=>{
 try {
  const tts=await load();
  const audio=await tts.generate(message.text,{voice:VOICE,speed:1});
  process.send?.({id:message.id,audio:Buffer.from(audio.toWav()).toString('base64')});
 } catch(error) {process.send?.({id:message.id,error:String(error.message).slice(0,500)});}
});
process.on('disconnect',()=>process.exit(0));
