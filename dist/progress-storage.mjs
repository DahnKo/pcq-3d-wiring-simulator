export const PROGRESS_VERSION=2;

const DB_NAME='pcq-3d-progress';
const STORE_NAME='attempts';
const FALLBACK_PREFIX='pcq-3d-progress-v2:';
const LEGACY_FALLBACK_PREFIX='pcq-3d-progress-v1:';
const clone=value=>value==null?value:structuredClone(value);

function compactDraft(draft){
 if(!draft)return null;
 const copy=clone(draft);
 if(copy.source)copy.source={id:copy.source.id};
 if(copy.destination)copy.destination={id:copy.destination.id};
 return copy;
}
function compactWiring(snapshot){return {...clone(snapshot),draft:compactDraft(snapshot?.draft)};}
function validConnection(problem,wire){return wire&&typeof wire.id==='string'&&problem.terminalMap[wire.from]?.connectable!==false&&problem.terminalMap[wire.to]?.connectable!==false&&wire.from!==wire.to;}
function validCableTie(tie,connections){
 if(!tie||typeof tie.id!=='string'||!Array.isArray(tie.wireIds)||tie.wireIds.length<2)return false;
 const ids=new Set(connections.map(w=>w.id));if(!tie.wireIds.every(id=>ids.has(id)))return false;
 if(!Array.isArray(tie.originPosition)||tie.originPosition.length<3||!Array.isArray(tie.axis)||tie.axis.length<3)return false;
 return tie.wireIds.every(id=>tie.anchors?.[id]&&Array.isArray(tie.slots?.[id]));
}
function normalizeAttemptSnapshot(snapshot){return Array.isArray(snapshot)?{connections:clone(snapshot),cableTies:[]}:{connections:clone(snapshot?.connections??[]),cableTies:clone(snapshot?.cableTies??[])};}
function validAttemptSnapshot(problem,snapshot){const normalized=normalizeAttemptSnapshot(snapshot);return normalized.connections.every(w=>validConnection(problem,w))&&normalized.cableTies.every(t=>validCableTie(t,normalized.connections));}
function validateWiring(problem,snapshot){
 if(!snapshot||typeof snapshot.stage!=='string')throw Error('저장된 배선 단계가 올바르지 않습니다.');
 for(const terminal of [snapshot.draft?.source,snapshot.draft?.destination])if(terminal&&!problem.terminalMap[terminal.id])throw Error('저장된 배선 단자를 찾을 수 없습니다.');
 return compactWiring(snapshot);
}

export function captureProgress(problem,attempt,wiring,{selectedWireId=null,selectedCableTieId=null,lastWire=null,now=Date.now}={}){
 if(!['running','finished'].includes(attempt.state))return null;
 return {
  version:PROGRESS_VERSION,problemId:problem.id,savedAt:now(),
  attempt:{state:attempt.state,elapsedMs:attempt.elapsed(),serial:attempt.serial,tieSerial:attempt.tieSerial??0,connections:clone(attempt.connections),cableTies:clone(attempt.cableTies??[]),history:clone(attempt.history),future:clone(attempt.future)},
  wiring:compactWiring(wiring.snapshot()),wiringHistory:wiring.history.map(compactWiring),wiringFuture:wiring.future.map(compactWiring),
  selectedWireId,selectedCableTieId,lastWire:clone(lastWire)
 };
}

export function restoreProgress(record,problem,attempt,wiring){
 if(!record||![1,PROGRESS_VERSION].includes(record.version)||record.problemId!==problem.id)throw Error('이 문제의 저장 데이터가 아닙니다.');
 const saved=record.attempt;if(!saved||!['running','finished'].includes(saved.state)||!Array.isArray(saved.connections)||!Array.isArray(saved.history))throw Error('저장된 실습 상태가 올바르지 않습니다.');
 const future=saved.future??[],cableTies=saved.cableTies??[];if(!Array.isArray(future)||!Array.isArray(cableTies))throw Error('저장된 다시 실행 상태가 올바르지 않습니다.');
 if(!saved.connections.every(w=>validConnection(problem,w))||!cableTies.every(t=>validCableTie(t,saved.connections))||!saved.history.every(items=>validAttemptSnapshot(problem,items))||!future.every(items=>validAttemptSnapshot(problem,items)))throw Error('저장된 전선/케이블타이 데이터가 올바르지 않습니다.');
 attempt.state=saved.state;attempt.elapsedMs=Math.max(0,Number(saved.elapsedMs)||0);attempt.connections=clone(saved.connections);attempt.cableTies=clone(cableTies);attempt.history=clone(saved.history);attempt.future=clone(future);attempt.result=null;
 const greatest=attempt.connections.reduce((n,w)=>Math.max(n,Number(String(w.id).match(/^W(\d+)$/)?.[1])||0),0),greatestTie=attempt.cableTies.reduce((n,t)=>Math.max(n,Number(String(t.id).match(/^T(\d+)$/)?.[1])||0),0);attempt.serial=Math.max(greatest,Number(saved.serial)||0);attempt.tieSerial=Math.max(greatestTie,Number(saved.tieSerial)||0);
 attempt.startedAt=attempt.state==='running'?attempt.now()-attempt.elapsedMs:null;
 wiring.restore(validateWiring(problem,record.wiring));
 wiring.history=(record.wiringHistory??[]).map(s=>validateWiring(problem,s));
 wiring.future=(record.wiringFuture??[]).map(s=>validateWiring(problem,s));
 const selectedWireId=attempt.connections.some(w=>w.id===record.selectedWireId)?record.selectedWireId:null,selectedCableTieId=attempt.cableTies.some(t=>t.id===record.selectedCableTieId)?record.selectedCableTieId:null;
 return {selectedWireId,selectedCableTieId,lastWire:clone(record.lastWire)};
}

export class ProgressStore{
 constructor({indexedDB=globalThis.indexedDB,localStorage=globalThis.localStorage}={}){this.indexedDB=indexedDB;this.localStorage=localStorage;this.dbPromise=null;}
 fallbackKey(problemId){return FALLBACK_PREFIX+problemId;}
 legacyFallbackKey(problemId){return LEGACY_FALLBACK_PREFIX+problemId;}
 async db(){
  if(!this.indexedDB)return null;if(this.dbPromise)return this.dbPromise;
  this.dbPromise=new Promise((resolve,reject)=>{const request=this.indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE_NAME))request.result.createObjectStore(STORE_NAME,{keyPath:'problemId'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return this.dbPromise;
 }
 async transact(mode,action){const db=await this.db();if(!db)return null;return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,mode),request=action(tx.objectStore(STORE_NAME));request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);tx.onerror=()=>reject(tx.error);});}
 readFallback(problemId){try{return JSON.parse(this.localStorage?.getItem(this.fallbackKey(problemId)))??JSON.parse(this.localStorage?.getItem(this.legacyFallbackKey(problemId)))??null;}catch{return null;}}
 writeFallback(problemId,value){try{this.localStorage?.setItem(this.fallbackKey(problemId),JSON.stringify(value));this.localStorage?.removeItem(this.legacyFallbackKey(problemId));return true;}catch{return false;}}
 removeFallback(problemId){try{this.localStorage?.removeItem(this.fallbackKey(problemId));this.localStorage?.removeItem(this.legacyFallbackKey(problemId));}catch{}}
 async load(problemId){if(!this.indexedDB)return this.readFallback(problemId);try{return await this.transact('readonly',s=>s.get(problemId))??this.readFallback(problemId);}catch{return this.readFallback(problemId);}}
 async save(record){if(!record)return;if(!this.indexedDB){this.writeFallback(record.problemId,record);return;}try{await this.transact('readwrite',s=>s.put(clone(record)));this.removeFallback(record.problemId);}catch{this.writeFallback(record.problemId,record);}}
 async delete(problemId){if(this.indexedDB)try{await this.transact('readwrite',s=>s.delete(problemId));}catch{}this.removeFallback(problemId);}
}
