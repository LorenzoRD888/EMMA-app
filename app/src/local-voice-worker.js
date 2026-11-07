import {KokoroTTS,env} from '../../emma voice/kokoro.js/src/kokoro.js';
import {env as transformersEnv} from '../../emma voice/kokoro.js/node_modules/@huggingface/transformers/dist/transformers.node.mjs';
env.cacheDir=process.env.EMMA_VOICE_CACHE;
transformersEnv.allowRemoteModels=false;
// Reading articles must never contact a speech provider, even by accident.
globalThis.fetch=async()=>{throw new Error('Network access is disabled for local speech.');};
let model;
process.on('message',async message=>{
 try {
  model??=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'cpu'});
  const audio=await model.generate(message.text,{voice:'af_heart',speed:1});
  process.send?.({id:message.id,audio:Buffer.from(audio.toWav()).toString('base64')});
 } catch(error) {process.send?.({id:message.id,error:String(error.message).slice(0,500)});}
});
process.on('disconnect',()=>process.exit(0));
