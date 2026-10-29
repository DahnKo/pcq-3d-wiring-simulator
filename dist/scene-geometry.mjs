import * as T from 'three';
import {colors} from './problem.mjs';
import {wireRadius,constrainedWireCurve} from './cable-ties.mjs';
const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.58,...extra});
export function block(parent,size,pos,color,extra={}){const m=new T.Mesh(new T.BoxGeometry(...size),mat(color,extra));m.position.set(...pos);parent.add(m);return m;}
export function cylinder(parent,r,h,pos,color){const m=new T.Mesh(new T.CylinderGeometry(r,r,h,16),mat(color,{metalness:.6}));m.rotation.x=Math.PI/2;m.position.set(...pos);parent.add(m);return m;}
export function deviceMesh(d){
 const g=new T.Group();g.userData.device=d;g.position.set(...d.centerMm);g.rotation.z=d.rotationZ;
 const [w,h,z]=d.displaySizeMm;
 if(d.id==='OCR'){
  // Hollow CT body: extruded X/Z profile, axis parallel to board Y.
  const shape=new T.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(w/2,87.5);shape.lineTo(-w/2,87.5);shape.closePath();
  for(let i=0;i<3;i++){const hole=new T.Path();hole.absarc((i-1)*11,i===1?73:61,5,0,Math.PI*2,true);shape.holes.push(hole);}
  const body=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:38,bevelEnabled:false,curveSegments:16}),mat('#cbcfc8'));body.rotation.x=Math.PI/2;body.position.y=19;g.add(body);
  cylinder(g,4,2,[-16,8,89],'#de7c38');cylinder(g,4,2,[16,8,89],'#de7c38');
 }else if(d.id==='PLC'){
  block(g,[w,h,48],[0,0,24],'#c8caca');block(g,[w,58,16],[0,0,56],'#c8caca');block(g,[90,47,2],[15,0,z+1],'#adb7bd');block(g,[95,13,8],[12,36,52],'#303839');block(g,[95,13,8],[12,-36,52],'#303839');
  for(let i=0;i<3;i++)cylinder(g,1.2,1,[-55,20-i*6,65],['#54a57e','#bfb65d','#bb524e'][i]);
 }else if(d.id==='INVERTER'){
  block(g,[w,h,94],[0,0,47],'#3a4149');block(g,[w,61,35],[0,33,111.5],'#414953');block(g,[54,17,2],[0,46,130],'#142c33');
  for(let i=0;i<6;i++)block(g,[7,6,2],[-20+(i%3)*10,28-Math.floor(i/3)*10,130],'#9aa4a7');cylinder(g,6,3,[20,20,131],'#1e232b');
 }else if(d.id==='MC'){
  block(g,[w,h,45],[0,0,22.5],'#272d32');block(g,[w,h-8,20],[0,0,55],'#d4d5c9');block(g,[26,32,20],[-5,0,75],'#42474a');block(g,[12,15,3],[-5,0,86],'#e88b34');
 }else if(d.id.startsWith('TB')){
  block(g,[w,h,10],[0,0,5],'#181c21');for(let i=0;i<4;i++){block(g,[w/4-3,h*.73,2],[(i-1.5)*w/4,0,12],'#c1ae71',{metalness:.8});}for(let i=0;i<5;i++)block(g,[2,h,18],[(i-2)*w/4,0,9],'#1d2225');
 }else if(d.id.startsWith('RY')){
  block(g,[w,h,10],[0,0,5],'#242b2c');block(g,[w*.7,h*.53,38],[0,0,29],'#b6c3c6',{transparent:true,opacity:.65});block(g,[w*.4,h*.3,20],[0,0,28],'#777964');
 }else if(/^(PB|SS|[RYG]L)/.test(d.id)){
  block(g,[w,h,13],[0,0,6.5],'#cbd0ce');cylinder(g,12,8,[0,0,17],'#b1b6b6');cylinder(g,10,4,[0,0,23],d.id.startsWith('RL')||d.id==='PB7'?'#a53a37':d.id.startsWith('YL')?'#c7ad25':'#26846a');
  if(d.id.startsWith('SS'))block(g,[5,14,5],[0,0,28],'#202525');
 }else if(d.id==='SMPS'){
  block(g,[w,h,z],[0,0,z/2],'#969e9f',{metalness:.6});for(let x=-3;x<=3;x++)for(let y=-2;y<=2;y++)cylinder(g,2,.2,[x*9,y*8,z+.2],'#303c42');
 }else{
  block(g,[w,h,z],[0,0,z/2],'#d8d8ce');block(g,[15,18,8],[0,0,z+4],'#363e43');cylinder(g,3,2,[w*.3,0,z+1],'#cebd36');
 }
 for(const t of d.terminalObjects){
  const term=new T.Group();term.userData.terminal=t;term.position.set(...t.localPositionMm);const screw=cylinder(term,t.connectable?2:1.5,1.4,[0,0,0],t.connectable?'#c6bb91':'#647077');screw.userData.terminal=t;
  block(term,[2.6,.5,.15],[0,0,.8],'#353a37');block(term,[.5,2.6,.15],[0,0,.8],'#353a37');
  const hit=new T.Mesh(new T.SphereGeometry(3,10,8),new T.MeshBasicMaterial({visible:false}));hit.userData.terminal=t;term.add(hit);g.add(term);
 }
 return g;
}
export function lugMesh(end,{paired=false,index=0}={}){
 const g=new T.Group();g.userData.end=end;
 if(end.crimp==='없음') {cylinder(g,.65,8,[0,-6,0],'#bc743c');return g;}
 const wide=end.crimp?.startsWith('2.5')?1.2:1,metal='#c6c2a4';
 if(end.crimp?.endsWith('Y')){
  // Open fork slot: two prongs and a bridge; raised barrel makes inversion visible.
  block(g,[1.3*wide,6,.6],[-2.4*wide,-.5,0],metal,{metalness:.85});block(g,[1.3*wide,6,.6],[2.4*wide,-.5,0],metal,{metalness:.85});block(g,[6*wide,1.6,.6],[0,-3.6,0],metal,{metalness:.85});
 }else block(g,[2,7,.7],[0,-1.5,0],metal,{metalness:.85});
 const barrel=cylinder(g,1.4*wide,5,[0,-6,1.2],metal);barrel.rotation.set(0,0,0);
 if(end.tube){const tube=cylinder(g,1.9*wide,7,[0,-8,1.2],'#3c87c2');tube.rotation.set(0,0,0);}
 let flip=end.orientation==='뒤집힘';if(paired&&index%2===1&&end.doubleMount==='등을 맞댐')flip=!flip;
 if(flip)g.rotation.y=Math.PI;g.position.z=index*2+1.7;return g;
}
export function wirePoints(problem,w,pointer){
 const fromTerminal=problem.terminalMap[w.from],toTerminal=pointer?null:problem.terminalMap[w.to],from=fromTerminal.positionMm,to=pointer??toTerminal.positionMm;
 const entry=(position,direction,distance,lift)=>new T.Vector3(position[0]+direction[0]*distance,position[1]+direction[1]*distance,Math.max(position[2]+lift,25));
 const fromDirection=fromTerminal.wireEntryDirection??[0,-1,0],toDirection=toTerminal?.wireEntryDirection??[0,-1,0];
 const points=[new T.Vector3(...from),entry(from,fromDirection,11,5),entry(from,fromDirection,21,13)];
 for(const via of w.via??[]){if(via?.point){points.push(new T.Vector3(...via.point));continue;}const port=problem.routePorts.find(p=>p.id===via);if(!port)continue;const [x,y,z]=port.positionMm;points.push(new T.Vector3(x,y+port.lengthMm/2+8,z),new T.Vector3(x,y,z),new T.Vector3(x,y-port.lengthMm/2-8,z));}
 if(!(w.via?.length))points.push(new T.Vector3((from[0]+to[0])/2,(from[1]+to[1])/2-22,Math.max(from[2],to[2])+24));
 points.push(entry(to,toDirection,20,14),entry(to,toDirection,10,4),new T.Vector3(...to));return points;
}
export function baseWireCurve(problem,w,pointer=null){return new T.CatmullRomCurve3(wirePoints(problem,w,pointer),false,'centripetal');}
export function displayWireCurve(problem,w,pointer=null,cableTies=[]){const base=baseWireCurve(problem,w,pointer);return pointer?base:constrainedWireCurve(base,w,cableTies);}
export function wireMesh(problem,w,pointer=null,mounts={},cableTies=[]){
 const g=new T.Group();g.userData.connection=w;const points=wirePoints(problem,w,pointer),curve=displayWireCurve(problem,w,pointer,cableTies);g.userData.curve=curve;
 const radius=wireRadius(w),mesh=new T.Mesh(new T.TubeGeometry(curve,Math.max(32,points.length*12),radius,8,false),mat(colors[w.color]??'#e0b600'));mesh.userData.connection=w;g.add(mesh);
 if(w.color==='녹색-노란색'){
  for(let i=1;i<24;i+=2){const pos=curve.getPoint(i/24),stripe=new T.Mesh(new T.SphereGeometry(radius*1.02,8,6),mat('#efcf2f'));stripe.position.copy(pos);g.add(stripe);}
 }
 for(const side of ['from','to']){
  const t=problem.terminalMap[w[side]];if(side==='to'&&pointer){const loose=lugMesh(w.ends.to);loose.position.add(new T.Vector3(...pointer));g.add(loose);continue;}
  if(!t)continue;const lug=lugMesh(w.ends[side],mounts[t.id]??{}),direction=t.wireEntryDirection??[0,-1,0];lug.rotation.z=Math.atan2(direction[0],-direction[1]);lug.position.add(new T.Vector3(...t.positionMm));lug.userData.terminal=t;lug.userData.connection=w;g.add(lug);
 }
 return g;
}
export function disposeGroup(g){g.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});g.clear();}
