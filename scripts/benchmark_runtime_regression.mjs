import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root=fileURLToPath(new URL('../',import.meta.url))
if(isMainThread){
 const results=[]
 for(let round=0;round<6;round++) {
  for(const step of round%2 ? [25,24] : [24,25]) {
   const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{step,round:round+1}})
    worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error(`Exit ${code}`))})
   })
   results.push(result)
  }
 }
 console.table(results.map(({sha,...r})=>r))
 if(new Set(results.map(r=>r.sha)).size!==1) throw Error('Selections differ')
 console.log('Every selection has identical SHA-256')
 console.log(JSON.stringify(results))
}else{
 const require=createRequire(root+'package.json')
 const {readParquet}=require('parquet-wasm/node'), {tableFromIPC}=require('apache-arrow')
 const {step,round}=workerData
 const {readRuntimeIndexes,fingerprint}=await import(step===24 ? './fixtures/runtime24.js' : pathToFileURL(root+'src/data/runtimeIndexes.js'))
 const {selectPoints}=await import(pathToFileURL(root+'src/data/pointSelection.js'))
 function read(name){
  const bytes=fs.readFileSync(root+'public/data/'+name+'_zstd10.parquet'), start=performance.now()
  const table=tableFromIPC(readParquet(bytes,{batchSize:16384}).intoIPCStream())
  return {bytes,table,ms:performance.now()-start}
 }
 const sites=read(step===24 ? 'charging_sites_browser' : 'charging_sites_startup')
 const groups=read('charging_point_groups_numeric'),catalog=read('charging_runtime_catalog')
 const hashes={sites:await fingerprint(sites.bytes),groups:await fingerprint(groups.bytes)}
 const samples=[];let selection
 for(let sample=0;sample<4;sample++) {
  const start=performance.now(),indexes=readRuntimeIndexes(sites.table,groups.table,catalog.table,hashes), attached=performance.now()
  selection=selectPoints(sites.table,indexes.pointGroups,{},indexes.operatorIndex)
  const ended=performance.now()
  samples.push({index:attached-start,analytics:ended-attached})
 }
 const sha=createHash('sha256').update(JSON.stringify(selection)).digest('hex')
 const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)]
 parentPort.postMessage({step,round,siteDecode:Math.round(sites.ms),groupDecode:Math.round(groups.ms),coldIndex:Math.round(samples[0].index),coldAnalytics:Math.round(samples[0].analytics),warmIndex:Math.round(median(samples.slice(1).map(x=>x.index))),warmAnalytics:Math.round(median(samples.slice(1).map(x=>x.analytics))),sha})
}
