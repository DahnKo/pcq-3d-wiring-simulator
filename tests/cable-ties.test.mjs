import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {Attempt} from '../dist/engine.mjs';
import {CABLE_TIE_MOVE_LIMIT_MM,bendRadiusForChord,closestCurvePoint,packBundle,constrainedWireCurve,createCableTieDraft,midpointAlongPolyline,movePositionOffsetFromPoints,rotateAxis,wireRadius} from '../dist/cable-ties.mjs';

const wire=(id,area=1.5)=>({id,area,from:'A',to:'B'});
const straight=(y=0,z=35)=>new T.CatmullRomCurve3([new T.Vector3(-150,y,z),new T.Vector3(0,y,z),new T.Vector3(150,y,z)],false,'centripetal');

test('bundle packing keeps circular wires separated and computes a tight enclosing radius',()=>{
 const wires=Array.from({length:10},(_,i)=>wire(`W${i+1}`,i%3===0?2.5:1.5)),packed=packBundle(wires);
 for(let i=0;i<wires.length;i++)for(let j=i+1;j<wires.length;j++){
  const a=packed.slots[wires[i].id],b=packed.slots[wires[j].id],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);
  assert.ok(distance+1e-6>=wireRadius(wires[i])+wireRadius(wires[j]));
 }
 for(const w of wires){const p=packed.slots[w.id];assert.ok(Math.hypot(...p)+wireRadius(w)<=packed.bundleRadius);}
});

test('cable tie draft needs at least two wires and stores stable per-wire anchors',()=>{
 const connections=[wire('W001'),wire('W002')],base=new Map([['W001',straight(-6)],['W002',straight(6)]]),display=new Map(base);
 assert.throws(()=>createCableTieDraft(connections,base,display,['W001'],new T.Vector3(0,0,28)),/2개 이상의 전선/);
 const tie=createCableTieDraft(connections,base,display,['W001','W002'],new T.Vector3(0,0,28));
 assert.deepEqual(tie.wireIds,['W001','W002']);assert.equal(tie.tailCut,false);assert.ok(tie.bundleRadius>0);assert.ok(tie.anchors.W001.distanceMm>100);assert.ok(Array.isArray(tie.slots.W002));assert.deepEqual(tie.positionOffsetMm,[0,0]);assert.deepEqual(tie.anchorAxis,tie.axis);
});

test('tie constraint lowers only the local wire segment while leaving distant ends unchanged',()=>{
 const w=wire('W001'),base=straight(0,45),tie={id:'T001',wireIds:['W001'],originPosition:[0,0,7],axis:[1,0,0],anchorAxis:[1,0,0],positionOffsetMm:[0,0],influenceMm:100,bundleRadius:3,slots:{W001:[0,0]},anchors:{W001:{distanceMm:base.getLength()/2,direction:1}},tailCut:false},curve=constrainedWireCurve(base,w,[tie]);
 assert.ok(Math.abs(curve.getPointAt(0).z-base.getPointAt(0).z)<.5);assert.ok(Math.abs(curve.getPointAt(1).z-base.getPointAt(1).z)<.5);assert.ok(closestCurvePoint(curve,new T.Vector3(0,0,7)).distance<1);
});

test('tie movement is free in the board plane but limited to a 50 mm radius',()=>{
 const tie={axis:[1,0,0],anchorAxis:[1,0,0]};
 assert.deepEqual(movePositionOffsetFromPoints(tie,[0,0,0],[30,40,0],[0,0]).map(Math.round),[30,40]);
 const limited=movePositionOffsetFromPoints(tie,[0,0,0],[80,60,0],[0,0]);assert.ok(Math.abs(Math.hypot(...limited)-CABLE_TIE_MOVE_LIMIT_MM)<1e-6);
 const shifted=movePositionOffsetFromPoints(tie,[10,10,0],[20,5,0],[5,5]);assert.deepEqual(shifted.map(Math.round),[15,0]);
});

test('90 degree adjacent anchors use the geometric bend-radius relation',()=>{
 const radius=bendRadiusForChord(Math.sqrt(8),Math.PI/2);assert.ok(Math.abs(radius-2)<1e-9);
});

test('adjacent cable ties remain hard anchors instead of dissolving each other',()=>{
 const w=wire('W001'),base=straight(0,35),length=base.getLength(),aDistance=length*.42,bDistance=length*.58;
 const a={id:'T001',wireIds:['W001'],originPosition:[-24,0,7],axis:[1,0,0],anchorAxis:[1,0,0],positionOffsetMm:[0,0],influenceMm:100,bundleRadius:2.5,slots:{W001:[0,0]},anchors:{W001:{distanceMm:aDistance,direction:1}},tailCut:false};
 const b={id:'T002',wireIds:['W001'],originPosition:[20,18,7],axis:rotateAxis([1,0,0],70),anchorAxis:[1,0,0],positionOffsetMm:[0,0],influenceMm:100,bundleRadius:2.5,slots:{W001:[0,0]},anchors:{W001:{distanceMm:bDistance,direction:1}},tailCut:false};
 const curve=constrainedWireCurve(base,w,[a,b]);
 assert.ok(closestCurvePoint(curve,new T.Vector3(...a.originPosition)).distance<1,'first tie must remain an anchor');
 assert.ok(closestCurvePoint(curve,new T.Vector3(...b.originPosition)).distance<1,'second tie must remain an anchor');
});

test('drag midpoint follows travelled polyline length rather than bounding-box center',()=>{
 const p=midpointAlongPolyline([[0,0,0],[100,0,0],[100,20,0]]);assert.ok(Math.abs(p.x-60)<1e-6);assert.equal(p.y,0);
});

test('Attempt cable-tie movement, rotation and cutting share undo/redo history with wire changes',()=>{
 const a=new Attempt(()=>0);a.start();const w1=a.add({from:'A',to:'B'}),w2=a.add({from:'C',to:'D'}),draft={wireIds:[w1,w2],originPosition:[0,0,7],axis:[1,0,0],anchorAxis:[1,0,0],positionOffsetMm:[0,0],rotationDeg:0,offsetMm:0,influenceMm:100,bundleRadius:4,slots:{[w1]:[-1,0],[w2]:[1,0]},anchors:{[w1]:{distanceMm:50,direction:1},[w2]:{distanceMm:50,direction:1}},tailCut:false},tieId=a.addCableTie(draft);
 assert.equal(a.cableTies.length,1);a.cutCableTie(tieId);assert.equal(a.cableTies[0].tailCut,true);a.undo();assert.equal(a.cableTies[0].tailCut,false);a.undo();assert.equal(a.cableTies.length,0);a.redo();assert.equal(a.cableTies.length,1);
 a.moveCableTie(tieId,[80,0]);assert.equal(Math.round(a.cableTies[0].positionOffsetMm[0]),50);a.rotateCableTie(tieId,5);assert.equal(Math.round(a.cableTies[0].rotationDeg),5);a.undo();assert.equal(Math.round(a.cableTies[0].rotationDeg),0);a.removeCableTie(tieId);assert.equal(a.cableTies.length,0);
});
