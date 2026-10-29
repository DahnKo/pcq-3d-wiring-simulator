import test from 'node:test';
import assert from 'node:assert/strict';
import {Attempt} from '../dist/engine.mjs';
import {WiringController,STAGES} from '../dist/wiring-controller.mjs';
import {ProgressStore,captureProgress,restoreProgress} from '../dist/progress-storage.mjs';

function fixture(){
 const terminals=['A','B','C'].map(id=>({id,deviceId:id,displayNumber:id,connectable:true,crimp:'1.5-3Y',insulationTube:false,maxConnections:2}));
 return {id:'saved-test',terminals,terminalMap:Object.fromEntries(terminals.map(t=>[t.id,t])),routePorts:[],internalLinks:[],pending:[],nets:[{id:'ABC',members:['A','B','C'],policy:{kind:'연선',area:1.5,color:'노란색'},status:'confirmed'}]};
}
function beginWire(wiring,source){wiring.chooseWire({kind:'연선',area:1.5,color:'노란색'});wiring.chooseTube(false);wiring.chooseCrimp('1.5-3Y');wiring.select(source);}
function finishWire(wiring,destination){wiring.select(destination);wiring.chooseTube(false);return wiring.chooseCrimp('1.5-3Y');}

test('running attempt restores elapsed time, exact terminal references and unfinished wire',()=>{
 const problem=fixture();let clock=1000;const attempt=new Attempt(()=>clock),wiring=new WiringController(problem,attempt);attempt.start();clock=2500;beginWire(wiring,problem.terminalMap.A);wiring.waypoint([1,2,3]);
 const saved=captureProgress(problem,attempt,wiring,{lastWire:{kind:'연선',area:1.5,color:'노란색'},now:()=>123});
 let restoredClock=9000;const restoredAttempt=new Attempt(()=>restoredClock),restoredWiring=new WiringController(problem,restoredAttempt),result=restoreProgress(saved,problem,restoredAttempt,restoredWiring);
 assert.equal(restoredAttempt.elapsed(),1500);assert.equal(restoredWiring.stage,STAGES.ROUTE);assert.equal(restoredWiring.draft.source,problem.terminalMap.A);assert.deepEqual(restoredWiring.draft.via,[{point:[1,2,3]}]);assert.equal(result.lastWire.color,'노란색');
 finishWire(restoredWiring,problem.terminalMap.B);assert.equal(restoredAttempt.connections.length,1);assert.equal(restoredAttempt.connections[0].from,'A');
});

test('connection undo history survives restore and keeps wire serials unique',()=>{
 const problem=fixture(),attempt=new Attempt(()=>0),wiring=new WiringController(problem,attempt);attempt.start();beginWire(wiring,problem.terminalMap.A);finishWire(wiring,problem.terminalMap.B);
 const saved=captureProgress(problem,attempt,wiring),restoredAttempt=new Attempt(()=>500),restoredWiring=new WiringController(problem,restoredAttempt);restoreProgress(saved,problem,restoredAttempt,restoredWiring);
 assert.equal(restoredWiring.undo().type,'connection');assert.equal(restoredAttempt.connections.length,0);beginWire(restoredWiring,problem.terminalMap.B);const event=finishWire(restoredWiring,problem.terminalMap.C);assert.equal(event.id,'W002');
});

test('finished attempt restores locked and can be graded, while ready and graded are not persisted',()=>{
 const problem=fixture(),attempt=new Attempt(()=>0),wiring=new WiringController(problem,attempt);assert.equal(captureProgress(problem,attempt,wiring),null);attempt.start();beginWire(wiring,problem.terminalMap.A);finishWire(wiring,problem.terminalMap.B);beginWire(wiring,problem.terminalMap.B);finishWire(wiring,problem.terminalMap.C);attempt.finish();
 const saved=captureProgress(problem,attempt,wiring),restoredAttempt=new Attempt(()=>100),restoredWiring=new WiringController(problem,restoredAttempt);restoreProgress(saved,problem,restoredAttempt,restoredWiring);assert.equal(restoredAttempt.state,'finished');assert.equal(restoredAttempt.score(problem).count,0);assert.equal(captureProgress(problem,restoredAttempt,restoredWiring),null);
});

test('browser-local fallback store saves, loads and deletes one problem independently',async()=>{
 const values=new Map(),localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},store=new ProgressStore({indexedDB:null,localStorage}),record={version:1,problemId:'p01',attempt:{state:'running'}};
 await store.save(record);assert.deepEqual(await store.load('p01'),record);assert.equal(await store.load('p02'),null);await store.delete('p01');assert.equal(await store.load('p01'),null);
});

test('mismatched or malformed saved data is rejected instead of mutating the attempt',()=>{
 const problem=fixture(),attempt=new Attempt(()=>0),wiring=new WiringController(problem,attempt);assert.throws(()=>restoreProgress({version:1,problemId:'other'},problem,attempt,wiring));assert.equal(attempt.state,'ready');
});


test('redo histories survive progress save and restore',()=>{
 const problem=fixture(),attempt=new Attempt(()=>0),wiring=new WiringController(problem,attempt);attempt.start();beginWire(wiring,problem.terminalMap.A);finishWire(wiring,problem.terminalMap.B);wiring.undo();
 assert.equal(attempt.future.length,1);
 beginWire(wiring,problem.terminalMap.A);wiring.undo();
 assert.equal(wiring.future.length,1);
 const saved=captureProgress(problem,attempt,wiring),restoredAttempt=new Attempt(()=>100),restoredWiring=new WiringController(problem,restoredAttempt);restoreProgress(saved,problem,restoredAttempt,restoredWiring);
 assert.equal(restoredWiring.future.length,1);assert.equal(restoredAttempt.future.length,0);
 assert.equal(restoredWiring.redo().type,'draft');
});


test('connection redo history also survives progress save and restore',()=>{
 const problem=fixture(),attempt=new Attempt(()=>0),wiring=new WiringController(problem,attempt);attempt.start();beginWire(wiring,problem.terminalMap.A);finishWire(wiring,problem.terminalMap.B);wiring.undo();
 const saved=captureProgress(problem,attempt,wiring),restoredAttempt=new Attempt(()=>100),restoredWiring=new WiringController(problem,restoredAttempt);restoreProgress(saved,problem,restoredAttempt,restoredWiring);
 assert.equal(restoredAttempt.future.length,1);assert.equal(restoredWiring.redo().type,'connection');assert.equal(restoredAttempt.connections.length,1);
});

test('cable ties, cut state and mixed undo history survive progress save and restore',()=>{
 const problem=fixture(),attempt=new Attempt(()=>0),wiring=new WiringController(problem,attempt);attempt.start();beginWire(wiring,problem.terminalMap.A);finishWire(wiring,problem.terminalMap.B);beginWire(wiring,problem.terminalMap.B);finishWire(wiring,problem.terminalMap.C);
 const ids=attempt.connections.map(w=>w.id),tieId=attempt.addCableTie({wireIds:ids,originPosition:[0,0,7],axis:[1,0,0],offsetMm:0,influenceMm:100,bundleRadius:4,slots:Object.fromEntries(ids.map((id,i)=>[id,[i*3,0]])),anchors:Object.fromEntries(ids.map(id=>[id,{distanceMm:30,direction:1}])),tailCut:false});attempt.cutCableTie(tieId);
 const saved=captureProgress(problem,attempt,wiring,{selectedCableTieId:tieId}),restoredAttempt=new Attempt(()=>500),restoredWiring=new WiringController(problem,restoredAttempt),restored=restoreProgress(saved,problem,restoredAttempt,restoredWiring);
 assert.equal(restoredAttempt.cableTies.length,1);assert.equal(restoredAttempt.cableTies[0].tailCut,true);assert.equal(restored.selectedCableTieId,tieId);assert.ok(restoredAttempt.tieSerial>=1);assert.equal(restoredWiring.undo().type,'connection');assert.equal(restoredAttempt.cableTies[0].tailCut,false);
});
