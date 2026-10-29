export class UnionFind {
 constructor(ids){this.parent=new Map(ids.map(x=>[x,x]));}
 find(x){if(!this.parent.has(x))throw Error(`알 수 없는 단자: ${x}`);let p=this.parent.get(x);if(p!==x)this.parent.set(x,p=this.find(p));return p;}
 join(a,b){a=this.find(a);b=this.find(b);if(a!==b)this.parent.set([a,b].sort()[1],[a,b].sort()[0]);}
}
export function groupRepairErrors(errors){
 const grouped=[],seen=new Map();
 for(const error of errors){
  const terminals=[...(error.terminalIds??[])].sort(),wires=[...(error.wireIds??[])].sort();
  const scope=error.type==='잘못된 연결'?`wire:${wires.join(',')}`:error.type==='단자 체결 수'||error.type==='2개 압착단자 체결'?`terminal:${terminals.join(',')}`:`${terminals.join(',')}|${wires.join(',')}`;
  const key=error.type+'|'+scope;if(!seen.has(key)){seen.set(key,error);grouped.push(error);continue;}
  const previous=seen.get(key);previous.deviceIds=[...new Set([...previous.deviceIds,...error.deviceIds])];previous.terminalIds=[...new Set([...previous.terminalIds,...terminals])];previous.wireIds=[...new Set([...previous.wireIds,...wires])];
 }
 return grouped;
}
export function grade(problem,connections){
 // Resolve non-polar / physically reversible terminal roles from the user's
 // connections without changing physical terminal IDs or wire metadata.
 // Some devices swap one pair independently; MCCB swaps input/output pole pairs together.
 if(problem.equivalentPairs?.length||problem.equivalentPairGroups?.length){
  problem={...problem,nets:structuredClone(problem.nets)};
  const roles=new Map(problem.nets.flatMap(n=>n.status==='confirmed'?n.members.map(t=>[t,n.id]):[]));
  const same=(a,b)=>roles.has(a)&&roles.get(a)===roles.get(b);
  const applySwap=pairs=>{
   const swap=id=>{for(const [a,b] of pairs){if(id===a)return b;if(id===b)return a;}return id;};
   const touched=new Set(pairs.flat());
   const relevant=connections.filter(w=>touched.has(w.from)||touched.has(w.to));
   const before=relevant.filter(w=>same(w.from,w.to)).length;
   const after=relevant.filter(w=>same(swap(w.from),swap(w.to))).length;
   if(after<=before)return false;
   const previous=new Map(pairs.flat().map(id=>[id,roles.get(id)]));
   for(const [a,b] of pairs){roles.set(a,previous.get(b));roles.set(b,previous.get(a));}
   for(const n of problem.nets)n.members=n.members.map(swap);
   return true;
  };
  const choices=[...(problem.equivalentPairs??[]).map(pair=>[pair]),...(problem.equivalentPairGroups??[])];
  for(let pass=0;pass<choices.length;pass++){
   let changed=false;
   for(const pairs of choices)if(applySwap(pairs))changed=true;
   if(!changed)break;
  }
 }
 const errors=[],reviews=[],ts=problem.terminalMap,netOf=new Map(),pending=new Set(),pendingNetOf=new Map();
 const reviewPairs=(problem.reviewPairs??[]).map(item=>Array.isArray(item)?{terminals:item}:item);
 const pairReviewFor=(a,b)=>reviewPairs.find(item=>{const pair=item.terminals??[];return pair.length===2&&pair.includes(a)&&pair.includes(b);});
 for(const n of problem.nets)for(const id of n.members){
  if(!ts[id])throw Error(`정답 데이터 단자 누락: ${id}`);
  if(netOf.has(id)||pending.has(id))throw Error(`정답 NET 중복: ${id}`);
  if(n.status==='pending'){pending.add(id);pendingNetOf.set(id,n);}
  else netOf.set(id,n);
 }
 for(const t of problem.terminals)if(!netOf.has(t.id)&&!pending.has(t.id))netOf.set(t.id,{id:'unused:'+t.id,members:[t.id],policy:{},status:'confirmed'});
 const uf=new UnionFind(problem.terminals.map(t=>t.id)),incident=new Map(),wrong=[];
 for(const [a,b] of problem.internalLinks??[])uf.join(a,b);
 const add=(id,type,terminalIds,wireIds,wrongText,correct,extra={})=>{const deviceIds=[...new Set(terminalIds.map(t=>ts[t]?.deviceId).filter(Boolean))],terminals=[...new Set(terminalIds)],wires=[...new Set(wireIds)];const e={id,type,deviceIds,terminalIds:terminals,wireIds:wires,wrong:wrongText,correct,errorId:id,errorType:type,relatedDevice:deviceIds,relatedTerminal:terminals,relatedConnection:wires,relatedPathSegment:extra.relatedPathSegment??null,markerPosition:null,title:type,reason:wrongText,expected:correct,actual:wrongText,correctionGuide:correct,...extra};errors.push(e);return e;};
 const ids=new Set();
 for(const w of [...connections].sort((a,b)=>a.id.localeCompare(b.id))){
  if(ids.has(w.id))throw Error('중복 전선 ID');ids.add(w.id);
  if(!ts[w.from]||!ts[w.to]||w.from===w.to||ts[w.from].connectable===false||ts[w.to].connectable===false){add('invalid:'+w.id,'연결 데이터',[w.from,w.to],[w.id],'유효하지 않은 단자 연결입니다.','서로 다른 실제 등록 단자를 선택하세요.');continue;}
  for(const [side,id]of [['from',w.from],['to',w.to]]){if(!incident.has(id))incident.set(id,[]);incident.get(id).push({w,side});}
  const pairReview=pairReviewFor(w.from,w.to);
  if(pairReview){const evidence=problem.pending?.find(x=>x.id===pairReview.pendingId);reviews.push({id:'review:'+w.id,wireIds:[w.id],terminalIds:[w.from,w.to],pendingId:pairReview.pendingId??null,title:pairReview.title??evidence?.title??'확인 필요',detail:pairReview.detail??evidence?.detail??'이 연결은 확인이 필요합니다.'});}
  const pn=pendingNetOf.get(w.from),pm=pendingNetOf.get(w.to);
  if(pn||pm){
   if(pn&&pm&&pn.id===pm.id){
    reviews.push({id:'review:'+w.id,wireIds:[w.id],terminalIds:[w.from,w.to],title:pn.id,detail:`${pn.id}: 도면·유의사항 상충으로 연결 관계 확인 필요`});
    // Pending NETs are excluded from scoring, but their internal connectivity is
    // still useful for practice-mode progress visualization.
    uf.join(w.from,w.to);
   }else{
    const left=pn?.id??netOf.get(w.from)?.id??'미분류',right=pm?.id??netOf.get(w.to)?.id??'미분류';
    wrong.push(add('electrical:'+w.id,'잘못된 연결',[w.from,w.to],[w.id],`${w.from} ↔ ${w.to}: 확인 필요 NET과 다른 NET을 연결했습니다.`,`${left} / ${right}를 분리하고 목적지를 확인하세요.`));
   }
  }else if(netOf.get(w.from).id!==netOf.get(w.to).id){
   wrong.push(add('electrical:'+w.id,'잘못된 연결',[w.from,w.to],[w.id],`${w.from} ↔ ${w.to}: 서로 다른 NET을 연결했습니다.`,`${netOf.get(w.from).id} / ${netOf.get(w.to).id}를 분리하고 목적지를 확인하세요.`));
  }else uf.join(w.from,w.to);
  const n=netOf.get(w.from),m=netOf.get(w.to);
  // A cross-net wire has no unambiguous circuit class. Do not invent material errors.
  const samePending=pn&&pm&&pn.id===pm.id;
  const policy=n&&m&&n.id===m.id?n.policy:(samePending?pn.policy:null);
  if(policy&&![w.from,w.to].some(id=>problem.materialUnconfirmedTerminals?.includes(id)))for(const [field,label]of [['kind','전선 종류'],['area','전선 굵기'],['color','전선 색상']])if(policy[field]!=null&&w[field]!==policy[field])add(`${field}:${w.id}`,label,[w.from,w.to],[w.id],`${label}: 사용 ${w[field]??'미선택'}`,`필요: ${policy[field]}${field==='area'?'㎟':''}`);
  if(w.route?.inDuct===false)add('route:'+w.id,'배선 경로',[w.from,w.to],[w.id],'음영 배선 구역을 벗어난 경로로 지정했습니다.','4페이지 음영 구역을 따르고 기구 사이를 통과하지 마세요.');
  if(w.route?.touchesDevice===true)add('touch:'+w.id,'기구 접촉',[w.from,w.to],[w.id],'기구 접촉 상태로 지정했습니다.','전선이 기구에 닿지 않도록 배선하세요.');
  if(w.route?.tieSpacingMm>100||w.route?.tieTrimmed===false)add('tie:'+w.id,'케이블타이',[w.from,w.to],[w.id],'타이 간격 또는 잔여 부분 마감이 기준과 다릅니다.','최대 100mm 간격으로 묶고 잔여 부분을 남김없이 자르세요.');
 }
 // Count one repair per disconnected component beyond the first. A wrong wire can
 for(const rule of problem.requiredPassages??[]){
  const candidates=connections.filter(w=>[w.from,w.to].includes(rule.destination)&&netOf.get(w.from)?.id===rule.netId&&netOf.get(w.to)?.id===rule.netId);
  if(candidates.length&&!candidates.some(w=>(w.via??[]).includes(rule.portId)))add('passage:'+rule.portId,'CT 관통',[rule.destination],candidates.map(w=>w.id),'주회로 전선이 '+rule.portId+' 관통 경로를 지나지 않습니다.','해당 상의 전선을 CT 구멍으로 통과시키세요.');
 }
 // Count one repair per disconnected component beyond the first. A wrong wire can
 // absorb at most ONE such repair, so independent omissions remain visible.
 const absorbed=new Set();
 for(const n of problem.nets.filter(n=>n.status==='confirmed')){
  const groups=new Map();for(const t of n.members){const root=uf.find(t);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(t);}
  const parts=[...groups.values()].map(a=>a.sort()).sort((a,b)=>b.length-a.length||a[0].localeCompare(b[0]));
  for(let i=1;i<parts.length;i++){
   const involved=[...parts[0],...parts[i]],candidate=wrong.find(e=>!absorbed.has(e.id)&&e.terminalIds.some(t=>involved.includes(t)));
   if(candidate){absorbed.add(candidate.id);candidate.terminalIds=[...new Set([...candidate.terminalIds,...involved])];candidate.deviceIds=[...new Set(candidate.terminalIds.map(t=>ts[t].deviceId))];candidate.correct+=` ${n.id}의 끊어진 연결도 복구하세요 (${parts[0][0]} ↔ ${parts[i][0]} 또는 동등한 JUMP).`;}
   else add(`missing:${n.id}:${parts[i][0]}`,'필수 연결 누락',involved,[],`${n.id}: ${parts[i].join(', ')}이 나머지 NET과 분리되어 있습니다.`,`${parts[0][0]} ↔ ${parts[i][0]} 또는 같은 NET 내 동등한 JUMP 연결이 필요합니다.`);
  }
 }
 for(const [id,ends]of [...incident].sort(([a],[b])=>a.localeCompare(b))){
  const t=ts[id];
  if(ends.length>t.maxConnections)add('capacity:'+id,'단자 체결 수',[id],ends.map(x=>x.w.id),`${id}: 한 단자에 ${ends.length}가닥을 연결했습니다.`,`이 단자는 최대 ${t.maxConnections}가닥입니다. 다른 단자로 JUMP를 분산하세요.`);
  for(const {w,side}of ends){const e=w.ends?.[side]??{},key=`${w.id}:${side}`;
   if(t.crimp&&e.crimp!==t.crimp)add('crimp:'+key,'압착단자 규격',[id],[w.id],`${id}: 사용 ${e.crimp??'미선택'}`,`필요: ${t.crimp} (1페이지 표1)`);
   if(t.insulationTube&&!e.tube)add('tube:'+key,'절연튜브',[id],[w.id],`${id}: 절연튜브가 사용되지 않았습니다.`,'PLC의 모든 단자에 절연튜브를 적용하세요 (2페이지 12항).');
   if(e.bareMm>=2||e.insulationClamped||e.tight===false)add('fastening:'+key,'단자 조임',[id],[w.id],`${id}: 나선 노출·피복 물림·조임 상태가 기준과 다릅니다.`,'나선 노출 2mm 미만, 피복 물림 없음, 나사를 견고하게 조이세요.');
   if(t.orientationRule&&(!t.orientationYOnly||e.crimp?.endsWith('Y'))&&e.orientation!==t.orientationRule)add('direction:'+key,'압착단자 방향',[id],[w.id],`${id}: 압착단자 방향 ${e.orientation}`,`필요: ${t.orientationRule}${t.orientationSource?' ('+t.orientationSource+')':''}`);
  }
  if(ends.length===2&&t.doubleCrimpRule&&(!t.orientationYOnly||ends.every(({w,side})=>w.ends[side].crimp?.endsWith('Y')))&&ends.some(({w,side})=>w.ends[side].doubleMount!==t.doubleCrimpRule))add('double:'+id,'2개 압착단자 체결',[id],ends.map(x=>x.w.id),`${id}: 2개 압착단자 체결 방법이 다릅니다.`,`필요: ${t.doubleCrimpRule}`);
 }
 const repairErrors=groupRepairErrors(errors);
 const blockingProgressTypes=new Set(['잘못된 연결','연결 데이터','CT 관통']);
 const netProgress=problem.nets.map(n=>{
  const memberSet=new Set(n.members),groups=new Map();
  for(const t of n.members){const root=uf.find(t);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(t);}
  const components=[...groups.values()].map(items=>items.sort()).sort((a,b)=>b.length-a.length||a[0].localeCompare(b[0]));
  const wireIds=connections.filter(w=>memberSet.has(w.from)||memberSet.has(w.to)).map(w=>w.id);
  const relatedErrors=repairErrors.filter(e=>(e.terminalIds??[]).some(t=>memberSet.has(t)));
  const relatedReviews=reviews.filter(r=>(r.terminalIds??[]).some(t=>memberSet.has(t)));
  const blockers=relatedErrors.filter(e=>blockingProgressTypes.has(e.type));
  const warnings=relatedErrors.filter(e=>e.type!=='필수 연결 누락'&&!blockingProgressTypes.has(e.type));
  const started=wireIds.length>0;
  let state;
  if(n.status==='pending')state=blockers.length?'error':started?'review':'pending';
  else if(blockers.length)state='error';
  else if(relatedReviews.length)state='review';
  else if(components.length===1)state='complete';
  else state=started?'progress':'not-started';
  return {id:n.id,status:n.status,state,members:[...n.members],components,componentCount:components.length,wireIds:[...new Set(wireIds)].sort(),errorIds:blockers.map(e=>e.id).sort(),warningIds:warnings.map(e=>e.id).sort(),warningCount:warnings.length,reviewIds:relatedReviews.map(r=>r.id).sort(),reviewCount:relatedReviews.length,reviewDetails:relatedReviews.map(r=>({id:r.id,title:r.title??'확인 필요',detail:r.detail,wireIds:[...(r.wireIds??[])]})),requiredPassages:(problem.requiredPassages??[]).filter(r=>r.netId===n.id).map(r=>r.portId).sort()};
 });
 return {errors:repairErrors,count:repairErrors.length,reviews,pending:problem.pending,completeAssessment:false,netGroups:netProgress.filter(n=>n.status==='confirmed').map(n=>({id:n.id,components:n.componentCount})),netProgress,basis:'확정된 NET 및 명시 규칙에 대한 부분 채점. 확인 필요 항목은 오류 개수에서 제외.'};
}
export class Attempt {
 constructor(now=()=>performance.now()){this.now=now;this.reset();}
 reset(){this.state='ready';this.startedAt=null;this.elapsedMs=0;this.connections=[];this.cableTies=[];this.history=[];this.future=[];this.result=null;this.serial=0;this.tieSerial=0;}
 snapshot(){return {connections:structuredClone(this.connections),cableTies:structuredClone(this.cableTies)};}
 restoreSnapshot(snapshot){if(Array.isArray(snapshot)){this.connections=structuredClone(snapshot);this.cableTies=[];return;}this.connections=structuredClone(snapshot?.connections??[]);this.cableTies=structuredClone(snapshot?.cableTies??[]);}
 start(){if(this.state!=='ready')return false;this.startedAt=this.now();this.state='running';return true;}
 elapsed(){return this.state==='running'?Math.max(0,this.now()-this.startedAt):this.elapsedMs;}
 finish(){if(this.state!=='running')return false;this.elapsedMs=this.elapsed();this.state='finished';return true;}
 mutate(fn){if(this.state!=='running')throw Error('배선 작업이 잠겨 있습니다.');this.history.push(this.snapshot());this.future=[];fn(this.connections,this.cableTies);}
 add(w){const id='W'+String(++this.serial).padStart(3,'0');this.mutate(a=>a.push({...structuredClone(w),id}));return id;}
 update(id,w){this.mutate(a=>{const i=a.findIndex(x=>x.id===id);if(i<0)throw Error('전선 없음');a[i]={...structuredClone(w),id};});}
 remove(id){this.mutate((connections,ties)=>{const i=connections.findIndex(x=>x.id===id);if(i>=0)connections.splice(i,1);for(let t=ties.length-1;t>=0;t--){const tie=ties[t];if(!tie.wireIds?.includes(id))continue;tie.wireIds=tie.wireIds.filter(x=>x!==id);if(tie.anchors)delete tie.anchors[id];if(tie.slots)delete tie.slots[id];if(tie.wireIds.length<2)ties.splice(t,1);}});}
 addCableTie(tie){const id='T'+String(++this.tieSerial).padStart(3,'0');this.mutate((_,ties)=>ties.push({...structuredClone(tie),id}));return id;}
 moveCableTie(id,positionOffsetMm){const tie=this.cableTies.find(t=>t.id===id);if(!tie)throw Error('케이블타이를 찾을 수 없습니다.');const raw=Array.isArray(positionOffsetMm)?positionOffsetMm:[0,0],x=Number(raw[0])||0,y=Number(raw[1])||0,length=Math.hypot(x,y),scale=length>50?50/length:1,next=[x*scale,y*scale],current=Array.isArray(tie.positionOffsetMm)?tie.positionOffsetMm:[0,0];if(Math.hypot((Number(current[0])||0)-next[0],(Number(current[1])||0)-next[1])<=.01)return false;this.mutate((_,ties)=>{const target=ties.find(t=>t.id===id);target.positionOffsetMm=next;target.offsetMm=0;});return true;}
 rotateCableTie(id,degrees){const tie=this.cableTies.find(t=>t.id===id);if(!tie)throw Error('케이블타이를 찾을 수 없습니다.');const delta=Number(degrees)||0;if(!delta)return false;this.mutate((_,ties)=>{const target=ties.find(t=>t.id===id),axis=target.axis??[1,0,0],x=Number(axis[0])||0,y=Number(axis[1])||0,length=Math.hypot(x,y)||1,unit=[x/length,y/length,0];if(!Array.isArray(target.anchorAxis))target.anchorAxis=[...unit];if(!Array.isArray(target.positionOffsetMm)){const legacy=Number(target.offsetMm)||0;target.positionOffsetMm=[unit[0]*legacy,unit[1]*legacy];target.offsetMm=0;}const r=delta*Math.PI/180,c=Math.cos(r),s=Math.sin(r);target.axis=[unit[0]*c-unit[1]*s,unit[0]*s+unit[1]*c,0];target.rotationDeg=((Number(target.rotationDeg)||0)+delta)%360;});return true;}
 cutCableTie(id){const tie=this.cableTies.find(t=>t.id===id);if(!tie)throw Error('케이블타이를 찾을 수 없습니다.');if(tie.tailCut)return false;this.mutate((_,ties)=>{ties.find(t=>t.id===id).tailCut=true;});return true;}
 removeCableTie(id){if(!this.cableTies.some(t=>t.id===id))return false;this.mutate((_,ties)=>{const i=ties.findIndex(t=>t.id===id);if(i>=0)ties.splice(i,1);});return true;}
 undo(){if(this.state!=='running')throw Error('배선 작업이 잠겨 있습니다.');if(!this.history.length)return false;this.future.push(this.snapshot());this.restoreSnapshot(this.history.pop());return true;}
 redo(){if(this.state!=='running')throw Error('배선 작업이 잠겨 있습니다.');if(!this.future.length)return false;this.history.push(this.snapshot());this.restoreSnapshot(this.future.pop());return true;}
 score(problem){if(!['finished','graded'].includes(this.state))throw Error('완료 후에만 채점할 수 있습니다.');this.result=grade(problem,this.connections);this.state='graded';return this.result;}
}
export function formatTime(ms){const s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');}
