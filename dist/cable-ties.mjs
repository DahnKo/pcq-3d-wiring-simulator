import * as T from 'three';

export const CABLE_TIE_MAX_DRAG_MM=200;
export const CABLE_TIE_INFLUENCE_MM=100;
export const CABLE_TIE_MOVE_LIMIT_MM=50;
export const CABLE_TIE_HIT_RADIUS_PX=12;
export const CABLE_TIE_ROTATE_STEP_DEG=5;

export const wireRadius=wire=>wire?.area===2.5?1.05:.85;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const vec=value=>value instanceof T.Vector3?value.clone():new T.Vector3(...value);
const EPS=1e-6;

function xyUnit(value,fallback=[1,0,0]){
 const v=vec(value??fallback);v.z=0;if(v.lengthSq()<EPS)v.set(...fallback);return v.normalize();
}

function hexCandidates(count,spacing){
 const coords=[];const limit=Math.max(2,Math.ceil(Math.sqrt(count))*2);
 for(let q=-limit;q<=limit;q++)for(let r=-limit;r<=limit;r++){
  const x=spacing*(q+r/2),y=spacing*(Math.sqrt(3)/2*r);coords.push([x,y]);
 }
 coords.sort((a,b)=>Math.hypot(a[0],a[1])-Math.hypot(b[0],b[1])||a[1]-b[1]||a[0]-b[0]);
 return coords.slice(0,count);
}

export function packBundle(wires){
 const ordered=[...wires].sort((a,b)=>String(a.id).localeCompare(String(b.id))),maxRadius=Math.max(1,...ordered.map(wireRadius)),spacing=maxRadius*2+.25;
 const raw=hexCandidates(ordered.length,spacing),cx=raw.reduce((s,p)=>s+p[0],0)/Math.max(raw.length,1),cy=raw.reduce((s,p)=>s+p[1],0)/Math.max(raw.length,1);
 const slots={},radii={};let bundleRadius=maxRadius+.45;
 ordered.forEach((wire,index)=>{const point=[raw[index][0]-cx,raw[index][1]-cy];slots[wire.id]=point;radii[wire.id]=wireRadius(wire);bundleRadius=Math.max(bundleRadius,Math.hypot(...point)+radii[wire.id]+.45);});
 return {slots,radii,bundleRadius};
}

export function closestCurvePoint(curve,point,{samples=180}={}){
 const target=vec(point),length=Math.max(curve.getLength(),.001);let best={u:0,distanceSq:Infinity,point:curve.getPointAt(0)};
 for(let i=0;i<=samples;i++){const u=i/samples,p=curve.getPointAt(u),d=p.distanceToSquared(target);if(d<best.distanceSq)best={u,distanceSq:d,point:p};}
 const step=1/samples;let lo=Math.max(0,best.u-step),hi=Math.min(1,best.u+step);
 for(let i=0;i<8;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3,pa=curve.getPointAt(a),pb=curve.getPointAt(b);if(pa.distanceToSquared(target)<=pb.distanceToSquared(target))hi=b;else lo=a;}
 const u=(lo+hi)/2,p=curve.getPointAt(u),tangent=curve.getTangentAt(clamp(u,.001,.999)).normalize();
 return {u,distanceMm:u*length,point:p,tangent,length,distance:p.distanceTo(target)};
}

function averageAxis(samples){
 if(!samples.length)return new T.Vector3(1,0,0);const first=samples[0].tangent.clone();const sum=new T.Vector3();
 for(const sample of samples){const t=sample.tangent.clone();if(t.dot(first)<0)t.multiplyScalar(-1);sum.add(t);}
 sum.z=0;if(sum.lengthSq()<EPS){sum.copy(first);sum.z=0;}if(sum.lengthSq()<EPS)sum.set(1,0,0);return sum.normalize();
}

export function createCableTieDraft(connections,baseCurves,displayCurves,wireIds,midpoint,{influenceMm=CABLE_TIE_INFLUENCE_MM}={}){
 const ids=[...new Set(wireIds)].filter(id=>baseCurves.has(id)&&displayCurves.has(id));if(ids.length<2)throw Error('케이블타이는 2개 이상의 전선을 묶어야 합니다.');
 const wires=ids.map(id=>connections.find(w=>w.id===id)).filter(Boolean);if(wires.length<2)throw Error('묶을 전선을 찾을 수 없습니다.');
 const target=vec(midpoint),samples=ids.map(id=>({id,...closestCurvePoint(displayCurves.get(id),target)})),axis=averageAxis(samples),packing=packBundle(wires),anchors={};
 for(const sample of samples){const base=baseCurves.get(sample.id),baseLength=Math.max(base.getLength(),.001),baseDistance=clamp(sample.u*baseLength,0,baseLength),baseTangent=base.getTangentAt(clamp(sample.u,.001,.999)).normalize();anchors[sample.id]={distanceMm:baseDistance,direction:baseTangent.dot(axis)>=0?1:-1};}
 const position=[target.x,target.y,Math.max(4,packing.bundleRadius+2.5)];
 return {wireIds:ids,originPosition:position,axis:axis.toArray(),anchorAxis:axis.toArray(),positionOffsetMm:[0,0],rotationDeg:0,offsetMm:0,influenceMm,bundleRadius:packing.bundleRadius,slots:packing.slots,anchors,tailCut:false};
}

export function cableTieOffsetVector(tie){
 if(Array.isArray(tie.positionOffsetMm))return new T.Vector3(Number(tie.positionOffsetMm[0])||0,Number(tie.positionOffsetMm[1])||0,0);
 const legacy=Number(tie.offsetMm)||0;return xyUnit(tie.anchorAxis??tie.axis).multiplyScalar(legacy);
}

export function cableTiePosition(tie){return vec(tie.originPosition??tie.position??[0,0,6]).add(cableTieOffsetVector(tie));}

function basisForTie(tie){const axis=xyUnit(tie.axis),side=new T.Vector3(-axis.y,axis.x,0).normalize(),up=new T.Vector3(0,0,1);return {axis,side,up};}

export function rotateAxis(axis,degrees){
 const v=xyUnit(axis),r=Number(degrees||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return new T.Vector3(v.x*c-v.y*s,v.x*s+v.y*c,0).normalize().toArray();
}

export function clampPlanarOffset(offset,limit=CABLE_TIE_MOVE_LIMIT_MM){
 const x=Number(offset?.[0])||0,y=Number(offset?.[1])||0,length=Math.hypot(x,y);if(length<=limit||length<EPS)return [x,y];const scale=limit/length;return [x*scale,y*scale];
}

export function movePositionOffsetFromPoints(tie,startPoint,currentPoint,startOffset=[0,0]){
 const delta=vec(currentPoint).sub(vec(startPoint));return clampPlanarOffset([(Number(startOffset?.[0])||0)+delta.x,(Number(startOffset?.[1])||0)+delta.y]);
}

// Backward-compatible helper for older callers/tests. New code uses planar offsets.
export function moveOffsetFromPoints(tie,startPoint,currentPoint,startOffset=0){
 const axis=xyUnit(tie.anchorAxis??tie.axis),delta=vec(currentPoint).sub(vec(startPoint)).dot(axis);return clamp((Number(startOffset)||0)+delta,-CABLE_TIE_MOVE_LIMIT_MM,CABLE_TIE_MOVE_LIMIT_MM);
}

export function bendRadiusForChord(chordMm,turnRadians){
 const d=Math.max(0,Number(chordMm)||0),theta=Math.abs(Number(turnRadians)||0);if(d<EPS)return 0;if(theta<1e-4)return Infinity;return d/(2*Math.sin(Math.min(Math.PI,theta)/2));
}

export function bezierHandleForTurn(chordMm,turnRadians,{maxHandleMm=CABLE_TIE_INFLUENCE_MM}={}){
 const d=Math.max(0,Number(chordMm)||0),theta=Math.min(Math.PI,Math.abs(Number(turnRadians)||0));if(d<EPS)return 0;
 let handle=d/3;if(theta>=1e-4){const radius=bendRadiusForChord(d,theta);handle=(4/3)*radius*Math.tan(theta/4);}
 return clamp(handle,Math.min(d*.08,2),Math.min(maxHandleMm,d*.45));
}

function oriented(dir,chord){const out=dir.clone().normalize();if(out.dot(chord)<0)out.multiplyScalar(-1);return out;}
function angleBetween(a,b){return Math.acos(clamp(a.clone().normalize().dot(b.clone().normalize()),-1,1));}
function pushUnique(points,point){if(!points.length||points.at(-1).distanceToSquared(point)>1e-6)points.push(point.clone());}

function appendBase(points,curve,startMm,endMm,stepMm=7){
 const length=Math.max(curve.getLength(),.001),a=clamp(startMm,0,length),b=clamp(endMm,0,length);if(b<a+EPS){pushUnique(points,curve.getPointAt(b/length));return;}
 const count=Math.max(1,Math.ceil((b-a)/stepMm));for(let i=0;i<=count;i++){const d=a+(b-a)*i/count;pushUnique(points,curve.getPointAt(d/length));}
}

function appendBezier(points,p0,t0,p3,t3,{maxHandleMm=CABLE_TIE_INFLUENCE_MM}={}){
 const chord=p3.clone().sub(p0),distance=chord.length();if(distance<EPS){pushUnique(points,p3);return;}
 const chordDir=chord.clone().normalize(),d0=oriented(t0,chordDir),d3=oriented(t3,chordDir),turn=angleBetween(d0,d3),handle=bezierHandleForTurn(distance,turn,{maxHandleMm});
 const p1=p0.clone().addScaledVector(d0,handle),p2=p3.clone().addScaledVector(d3,-handle),samples=Math.max(3,Math.ceil(distance/6));
 for(let i=0;i<=samples;i++){const t=i/samples,u=1-t,point=p0.clone().multiplyScalar(u*u*u).addScaledVector(p1,3*u*u*t).addScaledVector(p2,3*u*t*t).addScaledVector(p3,t*t*t);pushUnique(points,point);}
}

function resolvedTieAnchor(baseCurve,wireId,tie){
 const length=Math.max(baseCurve.getLength(),.001),anchor=tie.anchors[wireId],offset=cableTieOffsetVector(tie),anchorAxis=xyUnit(tie.anchorAxis??tie.axis),alongShift=offset.dot(anchorAxis)*(anchor.direction??1),distanceMm=clamp((Number(anchor.distanceMm)||0)+alongShift,0,length),{axis,side,up}=basisForTie(tie),center=cableTiePosition(tie),slot=tie.slots?.[wireId]??[0,0],target=center.clone().addScaledVector(side,Number(slot[0])||0).addScaledVector(up,Number(slot[1])||0),tangent=axis.clone().multiplyScalar(anchor.direction??1).normalize();
 return {tie,anchor,distanceMm,target,tangent,influence:Math.max(1,Number(tie.influenceMm)||CABLE_TIE_INFLUENCE_MM)};
}

export function constrainedWireCurve(baseCurve,wire,cableTies=[]){
 const relevant=cableTies.filter(t=>t.wireIds?.includes(wire.id)&&t.anchors?.[wire.id]).map(t=>resolvedTieAnchor(baseCurve,wire.id,t)).sort((a,b)=>a.distanceMm-b.distanceMm);if(!relevant.length)return baseCurve;
 const length=Math.max(baseCurve.getLength(),.001),points=[],first=relevant[0],firstReach=Math.min(first.influence,first.distanceMm),firstBaseDistance=first.distanceMm-firstReach;
 appendBase(points,baseCurve,0,firstBaseDistance);appendBezier(points,baseCurve.getPointAt(firstBaseDistance/length),baseCurve.getTangentAt(clamp(firstBaseDistance/length,.001,.999)),first.target,first.tangent,{maxHandleMm:firstReach||first.influence});
 for(let i=0;i<relevant.length-1;i++){
  const a=relevant[i],b=relevant[i+1],gap=Math.max(0,b.distanceMm-a.distanceMm),combined=a.influence+b.influence;
  if(gap<=combined+EPS){appendBezier(points,a.target,a.tangent,b.target,b.tangent,{maxHandleMm:Math.max(2,gap/2)});continue;}
  const aOut=Math.min(length,a.distanceMm+a.influence),bIn=Math.max(0,b.distanceMm-b.influence),aBase=baseCurve.getPointAt(aOut/length),aTangent=baseCurve.getTangentAt(clamp(aOut/length,.001,.999)),bBase=baseCurve.getPointAt(bIn/length),bTangent=baseCurve.getTangentAt(clamp(bIn/length,.001,.999));
  appendBezier(points,a.target,a.tangent,aBase,aTangent,{maxHandleMm:a.influence});appendBase(points,baseCurve,aOut,bIn);appendBezier(points,bBase,bTangent,b.target,b.tangent,{maxHandleMm:b.influence});
 }
 const last=relevant.at(-1),lastReach=Math.min(last.influence,length-last.distanceMm),lastBaseDistance=last.distanceMm+lastReach;appendBezier(points,last.target,last.tangent,baseCurve.getPointAt(lastBaseDistance/length),baseCurve.getTangentAt(clamp(lastBaseDistance/length,.001,.999)),{maxHandleMm:lastReach||last.influence});appendBase(points,baseCurve,lastBaseDistance,length);
 return new T.CatmullRomCurve3(points,false,'centripetal');
}

export function cableTieMesh(tie,{selected=false}={}){
 const g=new T.Group(),{axis}=basisForTie(tie),position=cableTiePosition(tie),radius=Math.max(2.4,Number(tie.bundleRadius)||2.4),color=selected?'#ff704f':'#e8ece8';g.userData.cableTie=tie;g.position.copy(position);
 const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),axis),material=new T.MeshStandardMaterial({color,roughness:.48,metalness:.05}),majorRadius=radius+.8,bandRadius=.72;
 const ring=new T.Mesh(new T.TorusGeometry(majorRadius,bandRadius,8,32),material);ring.quaternion.copy(q);ring.userData.cableTie=tie;g.add(ring);
 const outward=new T.Vector3(0,0,1),lock=new T.Mesh(new T.BoxGeometry(2.8,2.8,2.8),material);lock.position.copy(outward).multiplyScalar(majorRadius);lock.userData.cableTie=tie;g.add(lock);
 if(!tie.tailCut){const tailLength=24,tail=new T.Mesh(new T.BoxGeometry(1.35,1.35,tailLength),material);tail.position.copy(outward).multiplyScalar(majorRadius+tailLength/2);tail.userData.cableTie=tie;g.add(tail);}
 return g;
}

export function midpointAlongPolyline(points){
 if(!points?.length)return null;if(points.length===1)return vec(points[0]);const lengths=[];let total=0;for(let i=1;i<points.length;i++){const d=vec(points[i]).distanceTo(vec(points[i-1]));lengths.push(d);total+=d;}let remaining=total/2;for(let i=1;i<points.length;i++){const len=lengths[i-1];if(remaining<=len){const a=vec(points[i-1]),b=vec(points[i]);return a.lerp(b,len?remaining/len:0);}remaining-=len;}return vec(points.at(-1));
}
