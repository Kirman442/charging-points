import initWasm,{readParquet} from 'parquet-wasm/esm'
import wasmUrl from 'parquet-wasm/esm/parquet_wasm_bg.wasm?url'
import {tableFromIPC} from 'apache-arrow'
import {readRuntimeIndexes as attach24} from './fixtures/runtime24.js'
import {readRuntimeIndexes as attach25,fingerprint} from '../src/data/runtimeIndexes.js'
import {selectPoints} from '../src/data/pointSelection.js'
self.onmessage=async ({data:{step,round,root}})=>{
 try{
  const names=[step===24?'charging_sites_browser':'charging_sites_startup','charging_point_groups_numeric','charging_runtime_catalog']
  const [buffers]=await Promise.all([Promise.all(names.map(async n=>new Uint8Array(await (await fetch(root+n+'_zstd10.parquet')).arrayBuffer()))),initWasm(wasmUrl)])
  const decode=bytes=>{
   const start=performance.now(),table=tableFromIPC(readParquet(bytes,{batchSize:16384}).intoIPCStream())
   return {table,ms:performance.now()-start}
  }
  const sites=decode(buffers[0]),groups=decode(buffers[1]),catalog=decode(buffers[2])
  const hashes={sites:await fingerprint(buffers[0]),groups:await fingerprint(buffers[1])}
  const samples=[];let selection
  for(let i=0;i<4;i++){
   const start=performance.now(), indexes=(step===24?attach24:attach25)(sites.table,groups.table,catalog.table,hashes), attached=performance.now()
   selection=selectPoints(sites.table,indexes.pointGroups,{},indexes.operatorIndex)
   const ended=performance.now()
   samples.push({index:attached-start,analytics:ended-attached})
  }
  const sha=await fingerprint(new TextEncoder().encode(JSON.stringify(selection)))
  const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)]
  self.postMessage({step,round,siteDecode:Math.round(sites.ms),groupDecode:Math.round(groups.ms),coldIndex:Math.round(samples[0].index),coldAnalytics:Math.round(samples[0].analytics),warmIndex:Math.round(median(samples.slice(1).map(x=>x.index))),warmAnalytics:Math.round(median(samples.slice(1).map(x=>x.analytics))),sha})
 }catch(error){self.postMessage({error:error.stack||String(error)})}
}
