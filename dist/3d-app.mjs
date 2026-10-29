import {createHardwareProblem} from './hardware.mjs';
import {Attempt,formatTime} from './engine.mjs';
import {WiringController,connectionNets,STAGES} from './wiring-controller.mjs';
import {Workbench3D} from './workbench-3d.mjs';
import {ViewerState,pageGeometry} from './viewer-state.mjs';
import {SplitState} from './split-state.mjs';
import {groupErrorsForMarkers} from './error-markers.mjs';
import {ProgressStore,captureProgress,restoreProgress} from './progress-storage.mjs';
import {assessPractice} from './practice-feedback.mjs';
import {analyzeProgress,progressFilter as matchesProgressFilter,progressPanelPresentation} from './progress-status.mjs';
import {ANNOTATABLE_PAGES,ANNOTATION_COLORS,DEFAULT_ANNOTATION_SETTINGS,createAnnotationDocument,createStroke,appendPoint,strokePath,addAnnotationStroke,removeAnnotationStroke,clearAnnotationStrokes,undoAnnotation,redoAnnotation,cloneAnnotationSettings,strokeHitByEraser} from './annotations.mjs';
import {AnnotationStore} from './annotation-store.mjs';

const $=id=>document.getElementById(id);
const catalog=await fetch('./catalog.json').then(r=>r.ok?r.json():Promise.reject(Error('문제 목록을 불러오지 못했습니다.')));
const requestedId=new URLSearchParams(location.search).get('problem')??'p01',problemItem=catalog.find(x=>x.id===requestedId)??catalog[0],problemId=problemItem.id;
const p=createHardwareProblem(problemId),attempt=new Attempt(),wiring=new WiringController(p,attempt);
const progressStore=new ProgressStore(),savedProgress=await progressStore.load(problemId);
const readStored=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const saveStored=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const viewerStorageKey=`pcq-3d-view-v2:${problemId}`,viewerState=new ViewerState(readStored(viewerStorageKey,{})),splitState=new SplitState(readStored('pcq-3d-split-v1',60));
const annotationSettingsKey='pcq-3d-annotation-settings-v1',annotationStore=new AnnotationStore(),annotationSettings=cloneAnnotationSettings(readStored(annotationSettingsKey,DEFAULT_ANNOTATION_SETTINGS)),annotationDocs=new Map();
for(const annotationPage of ANNOTATABLE_PAGES){const loaded=await annotationStore.load(problemId,annotationPage);annotationDocs.set(annotationPage,createAnnotationDocument(loaded.strokes));}
let lastWire=readStored('pcq-3d-wire-v2',{kind:'연선',area:1.5,color:'노란색'});
let sessionMode=readStored('pcq-3d-session-mode-v1','exam');
if(!['exam','practice'].includes(sessionMode))sessionMode='exam';
let board,selectedWireId=null,selectedCableTieId=null,workToolMode=null,viewerResizeTimer=null,statusTimer=null,progressFilterMode='all';
let annotationEnabled=false,annotationToolbarCollapsed=false,annotationDraft=null,annotationPointerId=null,annotationEraserPointer=null;const annotationSaveTimers=new Map();
let progressSaveTimer=null,progressSaveChain=Promise.resolve();
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const act=fn=>{try{return fn();}catch(e){notify(e.message);return null;}};
function notify(text,{warning=false,duration=2600}={}){const box=$('status');box.textContent=text;box.classList.toggle('warning',warning);box.classList.add('show');clearTimeout(statusTimer);statusTimer=setTimeout(()=>{box.classList.remove('show');box.classList.remove('warning');},duration);}
function progressSnapshot(){return captureProgress(p,attempt,wiring,{selectedWireId,selectedCableTieId,lastWire});}
function saveProgressNow(){clearTimeout(progressSaveTimer);progressSaveTimer=null;const snapshot=progressSnapshot();if(snapshot)progressSaveChain=progressSaveChain.then(()=>progressStore.save(snapshot));return progressSaveChain;}
function scheduleProgressSave(){if(!['running','finished'].includes(attempt.state))return;clearTimeout(progressSaveTimer);progressSaveTimer=setTimeout(saveProgressNow,80);}
function clearProgress(){clearTimeout(progressSaveTimer);progressSaveTimer=null;progressSaveChain=progressSaveChain.then(()=>progressStore.delete(problemId));return progressSaveChain;}

document.title=`${problemItem.name} · PCQ 3D 배선 실습`;$('problem-title').textContent=problemItem.name.replace(' 기출문제','')+' · 3D 배선 실습';
const problemSelect=$('problem-select');for(const item of [...catalog].sort((a,b)=>a.name.localeCompare(b.name,'ko'))){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;option.selected=item.id===problemId;problemSelect.append(option);}
problemSelect.onchange=()=>{if(attempt.state==='running'&&!confirm('진행 중인 작업을 끝내고 다른 문제로 이동할까요?')){problemSelect.value=problemId;return;}location.href=`3d.html?problem=${encodeURIComponent(problemSelect.value)}`;};
const modeSelect=$('mode-select');modeSelect.value=sessionMode;modeSelect.onchange=()=>{if(attempt.state!=='ready'){modeSelect.value=sessionMode;return;}sessionMode=modeSelect.value;saveStored('pcq-3d-session-mode-v1',sessionMode);refreshModeUi();notify(sessionMode==='practice'?'연습 모드: 연결할 때마다 즉시 확인합니다.':'시험 모드: 완료 후 채점합니다.');};
function closeProgressPanel(){const panel=$('progress-panel'),toggle=$('progress-toggle');panel.classList.remove('open');panel.setAttribute('aria-hidden','true');toggle.setAttribute('aria-expanded','false');}
function refreshModeUi(){const practice=sessionMode==='practice',presentation=progressPanelPresentation(sessionMode,attempt.state);document.body.dataset.mode=sessionMode;$('instruction').classList.toggle('practice',practice&&attempt.state==='running');$('progress-toggle').hidden=!presentation.visible;$('progress-toggle-label').textContent=presentation.toggleLabel;$('progress-panel-title').textContent=presentation.title;$('progress-panel-subtitle').textContent=presentation.subtitle;if(!presentation.visible)closeProgressPanel();else refreshProgressPanel();}

try{
 board=new Workbench3D($('viewport'),p,{
  terminal:t=>act(()=>pickTerminal(t)),
  device:d=>board?.focus(d.id),
  wire:w=>selectWire(w.id),
  cableTie:tie=>selectCableTie(tie.id),
  createCableTie:draft=>act(()=>createCableTie(draft)),
  moveCableTie:(tie,offset)=>act(()=>moveCableTie(tie.id,offset)),
  cutCableTie:tie=>act(()=>cutCableTie(tie.id)),
  tieInvalid:message=>notify(message),
  blank:()=>deselectWorkItem(),
  port:port=>act(()=>{if(wiring.through(port)){notify('✓ '+port.label+' 경로를 통과합니다.');refreshDraft();}}),
  autoPort:port=>act(()=>{if(wiring.through(port)){notify('✓ '+port.label+' 자동 통과를 감지했습니다.');refreshDraft();}}),
  routePoint:point=>act(()=>{wiring.waypoint(point);notify('경로 지점을 추가했습니다.');refreshDraft();}),
  error:e=>showError(e),
  hover:item=>{$('hover').textContent=item?(item.id?.startsWith('T')?`${item.id} · 케이블타이${item.tailCut?' · 절단 완료':''}`:item.displayNumber?item.deviceId+' · '+item.displayNumber:item.label??''):'';}
 });
}catch(e){notify('3D 초기화 실패: '+e.message);$('start').disabled=true;}

const instruction={
 [STAGES.WIRE]:'선을 선택해주세요',
 [STAGES.START_TUBE]:'절연튜브 사용 유무를 선택해주세요',
 [STAGES.START_CRIMP]:'압착단자를 선택해주세요',
 [STAGES.START_TERMINAL]:'시작 지점을 클릭해주세요',
 [STAGES.ROUTE]:'경로를 따라 이동해주세요',
 [STAGES.END_TUBE]:'끝측 절연튜브 사용 유무를 선택해주세요',
 [STAGES.END_CRIMP]:'끝측 압착단자를 선택해주세요'
};
const wireOptions=[
 {label:'갈색 단선',kind:'단선',area:2.5,color:'갈색',css:'brown'},
 {label:'검은색 단선',kind:'단선',area:2.5,color:'검은색',css:'black'},
 {label:'회색 단선',kind:'단선',area:2.5,color:'회색',css:'gray'},
 {label:'녹색 단선',kind:'단선',area:2.5,color:'녹색-노란색',css:'green'},
 {label:'노란 연선',kind:'연선',area:1.5,color:'노란색',css:'yellow flexible'}
];
const crimps=['1.5-3Y','1.5-4Y','2.5-3Y','2.5-4Y','1.5-3Blade','2.5-4Blade'];
function materialButton(label,kind,value,visual){
 const b=document.createElement('button');b.type='button';b.dataset.kind=kind;b.dataset.value=value;b.setAttribute('aria-label',label);b.title=label;b.innerHTML=visual;b.onclick=()=>handleMaterial(b);return b;
}
function buildShelf(){
 const host=$('material-shelf');host.replaceChildren();
 const wires=document.createElement('div');wires.className='shelf-group wire-rack';wires.dataset.group='wire';
 for(const w of wireOptions)wires.append(materialButton(w.label,'wire',w.color,`<span class="wire-piece ${w.css}"><i></i></span>`));
 const tubes=document.createElement('div');tubes.className='shelf-group tube-rack';tubes.dataset.group='tube';
 tubes.append(materialButton('절연튜브 사용','tube','yes','<span class="tube-piece"></span><small>사용</small>'),materialButton('절연튜브 사용 안 함','tube','no','<span class="skip-piece">×</span>'));
 const lugs=document.createElement('div');lugs.className='shelf-group lug-rack';lugs.dataset.group='crimp';
 for(const c of crimps){const visual=c.includes('Blade')?'<span class="blade-piece"><i></i></span>':'<span class="lug-piece"><i></i><i></i></span>';lugs.append(materialButton(c,'crimp',c,`${visual}<small>${c}</small>`));}
 const tools=document.createElement('div');tools.className='shelf-group cable-tool-rack';tools.dataset.group='cable-tools';
 const tie=document.createElement('button');tie.type='button';tie.id='cable-tie-tool';tie.dataset.tool='cable-tie';tie.title='케이블타이 모드';tie.setAttribute('aria-pressed','false');tie.innerHTML='<span class="cable-tie-piece"><i></i></span><small>케이블타이</small>';tie.onclick=()=>toggleWorkTool('cable-tie');
 const nipper=document.createElement('button');nipper.type='button';nipper.id='nipper-tool';nipper.dataset.tool='nipper';nipper.title='니퍼 모드';nipper.setAttribute('aria-pressed','false');nipper.innerHTML='<span class="nipper-piece">✂</span><small>니퍼</small>';nipper.onclick=()=>toggleWorkTool('nipper');tools.append(tie,nipper);
 host.append(wires,tubes,lugs,tools);
}
function animatePick(button){button.classList.remove('picked');void button.offsetWidth;button.classList.add('picked');setTimeout(()=>button.classList.remove('picked'),520);}
function handleMaterial(button){
 if(attempt.state!=='running'){notify('먼저 시작 버튼을 눌러주세요.');return;}
 const kind=button.dataset.kind,value=button.dataset.value;let event=null;
 if(kind==='wire'){const option=wireOptions.find(w=>w.color===value);event=act(()=>wiring.chooseWire(option));if(event){lastWire=option;saveStored('pcq-3d-wire-v2',option);}}
 else if(kind==='tube')event=act(()=>wiring.chooseTube(value==='yes'));
 else event=act(()=>wiring.chooseCrimp(value));
 if(!event)return;animatePick(button);
 if(event.type==='connection'){selectedWireId=event.id;if(sessionMode==='exam')notify(event.id+' 체결이 완료되었습니다.');refreshConnections(event.id);}
 refreshDraft();
}
function pickTerminal(t){
 const event=wiring.select(t);board?.highlight([t.id]);
 if(event.type==='source')notify(t.id+' 시작측을 체결했습니다.');
 if(event.type==='destination')notify(t.id+' 끝부분 피복을 자동으로 제거했습니다.');
 refreshDraft();
}
function deselectWorkItem({notifyUser=false}={}){const hadWire=Boolean(selectedWireId),hadTie=Boolean(selectedCableTieId);if(!hadWire&&!hadTie)return false;selectedWireId=null;selectedCableTieId=null;board?.setSelectedCableTie(null);board?.highlight();refreshControls();scheduleProgressSave();if(notifyUser)notify('선택을 해제했습니다.');return true;}
function deselectWire(options={}){if(!selectedWireId)return false;return deselectWorkItem(options);}
function selectWire(id){const w=attempt.connections.find(x=>x.id===id);if(!w)return;if(selectedWireId===id&&!selectedCableTieId){deselectWorkItem({notifyUser:true});return;}selectedCableTieId=null;selectedWireId=id;board?.setSelectedCableTie(null);board?.focusItems([w.from,w.to],[id]);notify(id+' 전선을 선택했습니다.');refreshControls();scheduleProgressSave();}
function selectCableTie(id){const tie=attempt.cableTies.find(x=>x.id===id);if(!tie)return;if(selectedCableTieId===id&&!selectedWireId){deselectWorkItem({notifyUser:true});return;}selectedWireId=null;selectedCableTieId=id;board?.setSelectedCableTie(id);board?.focusCableTie(id);notify(`${id} 케이블타이를 선택했습니다.`);refreshControls();scheduleProgressSave();}
function createCableTie(draft){if(attempt.state!=='running')throw Error('배선 작업 중에만 케이블타이를 설치할 수 있습니다.');const id=attempt.addCableTie(draft);selectedWireId=null;selectedCableTieId=id;refreshConnections();board?.setSelectedCableTie(id);notify(`${id} 케이블타이로 ${draft.wireIds.length}개 전선을 정리했습니다.`);}
function moveCableTie(id,offset){if(attempt.moveCableTie(id,offset)){selectedWireId=null;selectedCableTieId=id;refreshConnections();board?.setSelectedCableTie(id);notify(`${id} 위치를 기준점에서 ${Math.round(Math.hypot(Number(offset?.[0])||0,Number(offset?.[1])||0))}mm 이동했습니다.`);}}
function rotateCableTie(id,degrees){if(attempt.rotateCableTie(id,degrees)){selectedWireId=null;selectedCableTieId=id;refreshConnections();board?.setSelectedCableTie(id);const tie=attempt.cableTies.find(x=>x.id===id);notify(`${id} 방향을 ${degrees<0?'반시계':'시계'} 방향으로 ${Math.abs(degrees)}° 회전했습니다. (누적 ${Math.round(Number(tie?.rotationDeg)||0)}°)`);}}
function cutCableTie(id){const tie=attempt.cableTies.find(x=>x.id===id);if(!tie)throw Error('케이블타이를 찾을 수 없습니다.');if(tie.tailCut){notify(`${id} 케이블타이는 이미 꼬다리를 정리했습니다.`);return;}attempt.cutCableTie(id);selectedWireId=null;selectedCableTieId=id;refreshConnections();board?.setSelectedCableTie(id);notify(`${id} 케이블타이 꼬다리를 니퍼로 절단했습니다.`);}
function setWorkTool(mode,{silent=false}={}){workToolMode=mode;board?.setToolMode(mode);for(const button of document.querySelectorAll('[data-tool]')){const active=button.dataset.tool===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}refreshControls();refreshDraft();if(!silent){if(mode==='cable-tie')notify('⚠ 케이블타이 모드: 배선·케이블타이가 많으면 버벅임이나 응답 지연이 발생할 수 있습니다.',{warning:true,duration:5200});else notify(mode==='nipper'?'니퍼 모드: 케이블타이를 클릭하면 남은 꼬다리를 절단합니다.':'도구 모드를 종료했습니다.');}}
function toggleWorkTool(mode){if(attempt.state!=='running'){notify('먼저 시작 버튼을 눌러주세요.');return;}if(wiring.stage!==STAGES.WIRE||wiring.draft){notify('현재 전선 작업을 완료하거나 취소한 뒤 사용해주세요.');return;}setWorkTool(workToolMode===mode?null:mode);}
function refreshDraft(){
 const end=wiring.stage.startsWith('끝측')?wiring.draft?.ends?.to:wiring.draft?.ends?.from;
 board?.setDraft(wiring.draft,end??wiring.material.end);
 board?.showPreparation(wiring.stage,wiring.material,wiring.draft);
 const runningText=workToolMode==='cable-tie'?'케이블타이 모드 · 드래그로 묶기 · 타이 이동 · 선택 후 Q/E로 5° 회전':workToolMode==='nipper'?'니퍼 모드 · 케이블타이를 클릭해 꼬다리를 절단하세요':instruction[wiring.stage]??'선을 선택해주세요';$('instruction').textContent=attempt.state==='ready'?(sessionMode==='practice'?'연습 모드 · 시작 버튼을 눌러주세요':'시험 모드 · 시작 버튼을 눌러주세요'):attempt.state==='finished'?'채점하기를 눌러주세요':attempt.state==='graded'?'빨간 느낌표를 눌러 오류를 확인하세요':sessionMode==='practice'?`연습 모드 · ${runningText}`:runningText;refreshModeUi();
 document.querySelectorAll('#material-shelf button').forEach(b=>{
  const active=(b.dataset.kind==='wire'&&b.dataset.value===(wiring.draft?.material?.color??lastWire.color))||(b.dataset.kind==='tube'&&wiring.draft&&String((wiring.stage.startsWith('끝측')?wiring.draft.ends.to.tube:wiring.draft.ends.from.tube)===true)===(b.dataset.value==='yes'))||(b.dataset.kind==='crimp'&&b.dataset.value===end?.crimp);
  b.classList.toggle('active',active);
 });
 refreshControls();
 scheduleProgressSave();
}
function refreshControls(){
 const run=attempt.state==='running',done=['finished','graded'].includes(attempt.state);
 $('start').disabled=attempt.state!=='ready'||!board;$('finish').disabled=!run;$('grade').disabled=!done;$('undo').disabled=!run||(!wiring.history.length&&!attempt.history.length);$('redo').disabled=!run||(!wiring.future.length&&!attempt.future.length);$('delete').disabled=!run||(!selectedWireId&&!selectedCableTieId);$('cancel').disabled=!run||!wiring.draft;modeSelect.disabled=attempt.state!=='ready';$('clock-label').textContent=done?'최종 작업시간':'경과시간';
 for(const b of document.querySelectorAll('#material-shelf button')){if(b.dataset.tool){b.disabled=!run||wiring.stage!==STAGES.WIRE||Boolean(wiring.draft);continue;}const allowed=!workToolMode&&(b.dataset.kind==='wire'?wiring.stage===STAGES.WIRE:b.dataset.kind==='tube'?[STAGES.START_TUBE,STAGES.END_TUBE].includes(wiring.stage):[STAGES.START_CRIMP,STAGES.END_CRIMP].includes(wiring.stage));b.disabled=!run||!allowed;}
}
const progressStateUi={
 complete:{icon:'✓',label:'완료'},progress:{icon:'◐',label:'진행 중'},'not-started':{icon:'○',label:'미시작'},error:{icon:'!',label:'오류'},review:{icon:'?',label:'확인 필요'},pending:{icon:'?',label:'확인 필요'}
};
function compactMembers(members){const shown=members.slice(0,3).join(' · ');return members.length>3?`${shown} 외 ${members.length-3}개`:shown;}
function refreshProgressPanel(){
 const toggle=$('progress-toggle'),presentation=progressPanelPresentation(sessionMode,attempt.state);if(!presentation.visible){toggle.hidden=true;return;}toggle.hidden=false;
 const summary=analyzeProgress(p,attempt.connections),{counts}=summary;toggle.querySelector('#progress-toggle-count').textContent=`${counts.completed}/${counts.total}`;
 $('progress-score').textContent=`${counts.completed} / ${counts.total}`;$('progress-bar').style.width=`${Math.round(summary.ratio*100)}%`;
 $('progress-stats').innerHTML=`<span>완료 <b>${counts.completed}</b></span><span>진행 중 <b>${counts.progress}</b></span><span>오류 <b>${counts.error}</b></span><span>미시작 <b>${counts.notStarted}</b></span>${counts.reviewRequired?`<span>확인 필요 <b>${counts.reviewRequired}</b></span>`:''}${counts.warnings?`<span>시공 경고 <b>${counts.warnings}</b></span>`:''}`;
 const host=$('progress-groups');host.replaceChildren();let visible=0;
 for(const group of summary.groups){
  const items=group.items.filter(n=>matchesProgressFilter(n,progressFilterMode));if(!items.length)continue;visible+=items.length;
  const details=document.createElement('details');details.className='progress-group';details.open=true;
  const head=document.createElement('summary');const confirmed=items.filter(n=>n.status==='confirmed'),done=confirmed.filter(n=>n.state==='complete').length;head.innerHTML=`${escapeHtml(group.name)} <span>${done}/${confirmed.length}${items.some(n=>n.state==='review'||n.state==='pending'||n.reviewCount)?' · 확인 필요':''}</span>`;details.append(head);
  for(const net of items){const ui=progressStateUi[net.state]??progressStateUi['not-started'],reviewDetails=net.reviewDetails??[],hasReviewDetail=reviewDetails.length>0,entry=hasReviewDetail?document.createElement('details'):null,button=hasReviewDetail?document.createElement('summary'):document.createElement('button');if(!hasReviewDetail)button.type='button';button.className=`progress-net ${net.state}${net.warningCount?' has-warning':''}`;button.title=hasReviewDetail?'클릭하면 확인 필요 설명을 펼치거나 접고, 관련 위치를 표시합니다.':'클릭하면 관련 단자와 배선을 3D 작업판에서 표시합니다.';
   const extra=net.warningCount?` · 시공 경고 ${net.warningCount}`:net.reviewCount?` · 확인 ${net.reviewCount}`:'';
   button.innerHTML=`<span class="state" aria-hidden="true">${ui.icon}</span><span class="net-copy"><strong>${escapeHtml(net.id)}</strong><small>${escapeHtml(compactMembers(net.members))}</small></span><span class="net-meta">${escapeHtml(ui.label+extra)}</span>`;
   button.onclick=()=>{board?.focusItems(net.members,net.wireIds);if(net.state==='error')notify(`${net.id}: 오류가 있는 NET입니다.`);else if(net.state==='complete')notify(`${net.id}: 연결 완료`);else notify(`${net.id}: ${ui.label}`);};
   if(hasReviewDetail){entry.className='progress-net-item';entry.append(button);const explanation=document.createElement('div');explanation.className='progress-review-detail';explanation.innerHTML=reviewDetails.map(item=>`<p><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span>${item.wireIds?.length?`<small>관련 배선: ${escapeHtml(item.wireIds.join(' · '))}</small>`:''}</p>`).join('');entry.append(explanation);details.append(entry);}else details.append(button);
  }
  host.append(details);
 }
 if(!visible){const empty=document.createElement('div');empty.className='progress-empty';empty.textContent=progressFilterMode==='all'?'표시할 NET이 없습니다.':'현재 필터에 해당하는 NET이 없습니다.';host.append(empty);}
}
function openProgressPanel(){if(!progressPanelPresentation(sessionMode,attempt.state).visible)return;refreshProgressPanel();const panel=$('progress-panel');panel.setAttribute('aria-hidden','false');requestAnimationFrame(()=>panel.classList.add('open'));$('progress-toggle').setAttribute('aria-expanded','true');}
function refreshPracticeFeedback(latestWireId=null){
 if(sessionMode!=='practice'||attempt.state!=='running'){if(attempt.state==='running')board?.setErrorMarkers([]);return;}
 const assessment=assessPractice(p,attempt.connections,latestWireId),groups=groupErrorsForMarkers(p,assessment.errors,attempt.connections);
 board?.setErrorMarkers(groups);
 if(latestWireId){
  if(assessment.latestErrors.length)notify(`${latestWireId} 연결에 오류가 있습니다. 느낌표를 확인하세요.`);
  else if(assessment.latestImpacts.length)notify(`${latestWireId} 연결 자체는 맞지만 현재 연결망에 기존 오결선이 있습니다. 느낌표를 확인하세요.`);
  else if(assessment.latestReviews.length)notify(`${latestWireId} 연결은 확인 필요 항목입니다. 진행상황의 오류·확인에서 근거를 확인하세요.`);
  else notify(`${latestWireId} 연결이 올바릅니다.`);
 }
}
function refreshConnections(latestWireId=null){board?.setConnections(attempt.connections,attempt.cableTies);if(selectedWireId&&!attempt.connections.some(w=>w.id===selectedWireId))selectedWireId=null;if(selectedCableTieId&&!attempt.cableTies.some(t=>t.id===selectedCableTieId))selectedCableTieId=null;board?.setSelectedCableTie(selectedCableTieId);refreshPracticeFeedback(latestWireId);refreshProgressPanel();refreshControls();scheduleProgressSave();}
function showError(e){
 e.viewed=true;board?.markErrorViewed(e.id);const pop=$('error-popover');pop.hidden=false;const items=(e.errors??[e]).map(x=>`<li>${escapeHtml(x.simpleMessage??x.wrong)}</li>`).join('');pop.innerHTML=`<button aria-label="닫기">×</button><strong>${escapeHtml(e.title??e.type)} · ${e.count??1}개</strong><ol>${items}</ol>`;pop.querySelector('button').onclick=()=>pop.hidden=true;board?.focusItems(e.terminalIds,e.wireIds);
}
function renderResults(r){
 const groups=groupErrorsForMarkers(p,r.errors,attempt.connections);$('results').hidden=false;$('result-summary').textContent=`작업시간 ${formatTime(attempt.elapsed())} · 오류 ${r.count}개 · ${groups.length}곳`;const host=$('errors');host.replaceChildren();
 for(const group of groups){const b=document.createElement('button');b.textContent=group.title+' '+group.count+'개';b.onclick=()=>showError(group);host.append(b);}
 board?.setErrorMarkers(groups);
}

$('start').onclick=()=>{if(attempt.start()){wiring.cancel();setWorkTool(null,{silent:true});notify(sessionMode==='practice'?'연습 모드를 시작합니다. 연결마다 바로 확인합니다.':'시험 모드를 시작합니다.');refreshConnections();refreshDraft();}};
$('finish').onclick=()=>$('confirm').showModal();$('keepworking').onclick=()=>$('confirm').close();
$('confirmfinish').onclick=()=>{if(!attempt.finish())return;wiring.cancel();setWorkTool(null,{silent:true});$('confirm').close();saveStored(`pcq-3d-last-completed-v1:${problemId}`,{problemId:p.id,elapsedMs:attempt.elapsedMs,completedAt:new Date().toISOString(),connections:attempt.connections,cableTies:attempt.cableTies});refreshDraft();refreshConnections();saveProgressNow();notify('작업판이 잠겼습니다.');};
$('grade').onclick=()=>act(()=>{const r=attempt.score(p);clearProgress();renderResults(r);refreshDraft();if(sessionMode==='exam')openProgressPanel();notify('오류 위치에 느낌표를 표시했습니다.');});
$('retry').onclick=()=>{if((attempt.connections.length||attempt.cableTies.length||attempt.state==='running')&&!confirm('현재 작업을 지우고 같은 문제를 다시 풀까요?'))return;clearProgress();attempt.reset();wiring.cancel();selectedWireId=null;selectedCableTieId=null;setWorkTool(null,{silent:true});$('results').hidden=true;$('errors').replaceChildren();$('error-popover').hidden=true;$('clock').textContent='00:00:00';board?.setErrorMarkers([]);board?.highlight();board?.home();refreshConnections();refreshDraft();};
$('undo').onclick=()=>act(()=>{const e=wiring.undo();if(e?.type==='none')return;if(e.type==='connection')deselectWorkItem();refreshConnections();refreshDraft();notify('마지막 작업을 되돌렸습니다.');});
$('redo').onclick=()=>act(()=>{const e=wiring.redo();if(e?.type==='none')return;if(e.type==='connection')deselectWorkItem();refreshConnections();refreshDraft();notify('되돌린 작업을 다시 실행했습니다.');});
$('delete').onclick=()=>act(()=>{if(selectedCableTieId){const id=selectedCableTieId;attempt.removeCableTie(id);selectedCableTieId=null;board?.highlight();refreshConnections();notify(id+' 케이블타이를 삭제했습니다.');return;}if(!selectedWireId)throw Error('삭제할 전선 또는 케이블타이를 먼저 선택해주세요.');const id=selectedWireId;attempt.remove(id);selectedWireId=null;board?.highlight();refreshConnections();notify(id+' 전선을 삭제했습니다.');});
$('cancel').onclick=()=>{wiring.cancel();board?.setDraft(null);refreshDraft();notify('현재 전선 작업을 취소했습니다.');};
$('home').onclick=()=>board?.home();
$('progress-toggle').onclick=()=>$('progress-panel').classList.contains('open')?closeProgressPanel():openProgressPanel();
$('progress-close').onclick=closeProgressPanel;
document.querySelectorAll('[data-progress-filter]').forEach(button=>button.onclick=()=>{progressFilterMode=button.dataset.progressFilter;document.querySelectorAll('[data-progress-filter]').forEach(x=>x.classList.toggle('active',x===button));refreshProgressPanel();});

document.addEventListener('keydown',event=>{
 const target=event.target,tag=target?.tagName?.toLowerCase();if(tag==='input'||tag==='textarea'||tag==='select'||target?.isContentEditable)return;
 const key=String(event.key||'').toLowerCase();if(!selectedCableTieId||attempt.state!=='running'||(key!=='q'&&key!=='e'))return;event.preventDefault();act(()=>rotateCableTie(selectedCableTieId,key==='q'?-5:5));
});

// PDF viewer + diagram annotations
const page=$('page'),stage=$('page-stage'),documentPane=$('document'),annotationLayer=$('annotation-layer'),annotationToolbar=$('annotation-toolbar'),annotationEraserCursor=$('annotation-eraser-cursor');
const annotationSvgNs='http://www.w3.org/2000/svg';
function saveViewer(){saveStored(viewerStorageKey,viewerState.snapshot());}
function viewerCenter(){return {x:(documentPane.scrollLeft+documentPane.clientWidth/2)/Math.max(documentPane.scrollWidth,1),y:(documentPane.scrollTop+documentPane.clientHeight/2)/Math.max(documentPane.scrollHeight,1)};}
function currentAnnotationPage(){return Number(viewerState.page);}
function currentAnnotationDoc(){return annotationDocs.get(currentAnnotationPage())??null;}
function saveAnnotationSettings(){saveStored(annotationSettingsKey,annotationSettings);}
function scheduleAnnotationSave(pageNumber=currentAnnotationPage()){
 if(!ANNOTATABLE_PAGES.has(Number(pageNumber)))return;clearTimeout(annotationSaveTimers.get(Number(pageNumber)));
 annotationSaveTimers.set(Number(pageNumber),setTimeout(()=>{annotationSaveTimers.delete(Number(pageNumber));const doc=annotationDocs.get(Number(pageNumber));if(doc)annotationStore.save(problemId,Number(pageNumber),doc.strokes);},120));
}
function flushAnnotationSaves(){for(const pageNumber of ANNOTATABLE_PAGES){clearTimeout(annotationSaveTimers.get(Number(pageNumber)));annotationSaveTimers.delete(Number(pageNumber));const doc=annotationDocs.get(Number(pageNumber));if(doc)annotationStore.save(problemId,Number(pageNumber),doc.strokes);}}
function annotationPathElement(stroke,{draft=false}={}){
 const path=document.createElementNS(annotationSvgNs,'path');path.setAttribute('d',strokePath(stroke.points));path.setAttribute('stroke',stroke.color);path.setAttribute('stroke-width',String(stroke.width));path.setAttribute('stroke-opacity',String(stroke.opacity));path.dataset.tool=stroke.tool;if(!draft)path.dataset.strokeId=stroke.id;return path;
}
function renderAnnotations(){
 annotationLayer.replaceChildren();if(!ANNOTATABLE_PAGES.has(currentAnnotationPage()))return;
 const doc=currentAnnotationDoc();for(const stroke of doc?.strokes??[])annotationLayer.append(annotationPathElement(stroke));
 if(annotationDraft)annotationLayer.append(annotationPathElement(annotationDraft,{draft:true}));
}
function annotationPoint(event){
 const matrix=annotationLayer.getScreenCTM();if(!matrix||!page.naturalWidth)return null;const pnt=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
 return {x:Math.max(0,Math.min(page.naturalWidth,pnt.x)),y:Math.max(0,Math.min(page.naturalHeight,pnt.y))};
}
function cancelAnnotationDraft(){annotationDraft=null;annotationPointerId=null;renderAnnotations();}
function finishAnnotationDraft(){
 if(!annotationDraft)return false;const doc=currentAnnotationDoc(),stroke=annotationDraft;annotationDraft=null;annotationPointerId=null;if(!doc)return false;
 const added=addAnnotationStroke(doc,stroke);renderAnnotations();refreshAnnotationUi();if(added)scheduleAnnotationSave();return added;
}
function eraseAnnotationAt(event){
 const point=annotationPoint(event),doc=currentAnnotationDoc();if(!point||!doc)return false;
 const width=annotationSettings.eraser?.width??DEFAULT_ANNOTATION_SETTINGS.eraser.width;
 for(let i=doc.strokes.length-1;i>=0;i--){const stroke=doc.strokes[i];if(!strokeHitByEraser(stroke,point,width))continue;if(!removeAnnotationStroke(doc,stroke.id))return false;renderAnnotations();refreshAnnotationUi();scheduleAnnotationSave();return true;}
 return false;
}
function updateAnnotationColors(){
 const host=$('annotation-colors');host.replaceChildren();const tool=annotationSettings.tool;if(!ANNOTATION_COLORS[tool])return;
 const current=annotationSettings[tool].color;for(const color of ANNOTATION_COLORS[tool]){const b=document.createElement('button');b.type='button';b.className='annotation-color'+(color===current?' active':'');b.title=color;b.setAttribute('aria-label',`${tool==='highlighter'?'형광펜':'사인펜'} 색상 ${color}`);const swatch=document.createElement('span');swatch.style.background=color;b.append(swatch);b.onclick=()=>{annotationSettings[tool].color=color;saveAnnotationSettings();refreshAnnotationUi();};host.append(b);}
}
function eraserCursorScale(){
 const matrix=annotationLayer.getScreenCTM();if(!matrix)return 1;const sx=Math.hypot(matrix.a,matrix.b),sy=Math.hypot(matrix.c,matrix.d);return Math.max(.01,(sx+sy)/2);
}
function refreshEraserCursor(){
 const supported=ANNOTATABLE_PAGES.has(currentAnnotationPage()),visible=supported&&annotationEnabled&&annotationSettings.tool==='eraser'&&annotationEraserPointer;
 annotationEraserCursor.classList.toggle('visible',!!visible);if(!visible)return;
 const width=annotationSettings.eraser?.width??DEFAULT_ANNOTATION_SETTINGS.eraser.width,size=Math.max(4,Math.min(240,width*eraserCursorScale()));
 annotationEraserCursor.style.width=`${size}px`;annotationEraserCursor.style.height=`${size}px`;annotationEraserCursor.style.left=`${annotationEraserPointer.x}px`;annotationEraserCursor.style.top=`${annotationEraserPointer.y}px`;
}
function moveEraserCursor(event){annotationEraserPointer={x:event.clientX,y:event.clientY};refreshEraserCursor();}
function hideEraserCursor(){annotationEraserPointer=null;refreshEraserCursor();}
function refreshAnnotationUi(){
 const pageNumber=currentAnnotationPage(),supported=ANNOTATABLE_PAGES.has(pageNumber),active=supported&&annotationEnabled,tool=annotationSettings.tool,eraser=tool==='eraser';
 const toggle=$('annotation-toggle'),toolbarToggle=$('annotation-toolbar-toggle');toggle.hidden=!supported;toggle.setAttribute('aria-pressed',String(active));toolbarToggle.hidden=!supported;toolbarToggle.disabled=false;toolbarToggle.setAttribute('aria-expanded',String(supported&&!annotationToolbarCollapsed));toolbarToggle.textContent=annotationToolbarCollapsed?'✏️ 펼치기':'✏️ 접기';annotationToolbar.hidden=!supported||annotationToolbarCollapsed;annotationLayer.classList.toggle('active',active);annotationLayer.classList.toggle('eraser',active&&eraser);annotationToolbar.classList.toggle('eraser-mode',eraser);
 document.querySelectorAll('[data-annotation-tool]').forEach(b=>b.classList.toggle('active',b.dataset.annotationTool===tool));
 const widthInput=$('annotation-width'),widthValue=$('annotation-width-value'),opacityInput=$('annotation-opacity'),opacityValue=$('annotation-opacity-value'),settings=annotationSettings[tool]??DEFAULT_ANNOTATION_SETTINGS[tool];
 widthInput.min=eraser?'4':'2';widthInput.max=eraser?'100':'48';widthInput.value=String(settings.width);widthValue.value=`${settings.width}px`;widthValue.textContent=`${settings.width}px`;
 opacityInput.disabled=eraser;$('annotation-opacity-control').setAttribute('aria-disabled',String(eraser));
 if(!eraser){opacityInput.value=String(Math.round(settings.opacity*100));opacityValue.value=`${Math.round(settings.opacity*100)}%`;opacityValue.textContent=`${Math.round(settings.opacity*100)}%`;}else{opacityValue.value='—';opacityValue.textContent='—';}
 updateAnnotationColors();const doc=currentAnnotationDoc();$('annotation-undo').disabled=!doc?.history.length;$('annotation-redo').disabled=!doc?.future.length;$('annotation-clear').disabled=!doc?.strokes.length;refreshEraserCursor();
}
function renderViewer({preserveCenter=true}={}){
 if(!page.naturalWidth)return;const center=viewerCenter(),g=pageGeometry(page.naturalWidth,page.naturalHeight,viewerState);stage.style.width=g.stageWidth+'px';stage.style.height=g.stageHeight+'px';
 for(const element of [page,annotationLayer]){element.style.width=g.imageWidth+'px';element.style.height=g.imageHeight+'px';element.style.left='50%';element.style.top='50%';element.style.transform=`translate(-50%,-50%) rotate(${g.rotation}deg)`;}
 annotationLayer.setAttribute('viewBox',`0 0 ${page.naturalWidth} ${page.naturalHeight}`);$('zoom-label').textContent=Math.round(viewerState.scale*100)+'%';renderAnnotations();refreshAnnotationUi();
 if(preserveCenter)requestAnimationFrame(()=>{documentPane.scrollLeft=center.x*documentPane.scrollWidth-documentPane.clientWidth/2;documentPane.scrollTop=center.y*documentPane.scrollHeight-documentPane.clientHeight/2;});saveViewer();
}
function fitViewer(){if(!page.naturalWidth)return;viewerState.fit(documentPane.clientWidth,documentPane.clientHeight,page.naturalWidth,page.naturalHeight);renderViewer({preserveCenter:false});requestAnimationFrame(()=>{documentPane.scrollLeft=(documentPane.scrollWidth-documentPane.clientWidth)/2;documentPane.scrollTop=(documentPane.scrollHeight-documentPane.clientHeight)/2;});}
function rotateViewer(degrees){if(annotationDraft)finishAnnotationDraft();viewerState.rotate(degrees);viewerState.fitMode?fitViewer():renderViewer();}
page.onload=()=>{viewerState.fitMode?fitViewer():renderViewer({preserveCenter:false});};if(page.complete)page.onload();
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{if(annotationDraft)finishAnnotationDraft();viewerState.setPage(b.dataset.page);document.querySelectorAll('[data-page]').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active));});page.src=`assets/${problemId}/${viewerState.page}.webp`;page.alt=`${problemItem.name} 원본 ${viewerState.page}페이지`;$('original').href=page.src;renderAnnotations();refreshAnnotationUi();saveViewer();});
$('zoomin').onclick=()=>{if(annotationDraft)finishAnnotationDraft();viewerState.zoom(1.25);renderViewer();};$('zoomout').onclick=()=>{if(annotationDraft)finishAnnotationDraft();viewerState.zoom(.8);renderViewer();};$('fit').onclick=()=>{if(annotationDraft)finishAnnotationDraft();fitViewer();};$('rotate-cw').onclick=()=>rotateViewer(90);$('rotate-ccw').onclick=()=>rotateViewer(-90);$('rotate-180').onclick=()=>rotateViewer(180);
$('annotation-toggle').onclick=()=>{if(!ANNOTATABLE_PAGES.has(currentAnnotationPage()))return;annotationEnabled=!annotationEnabled;if(!annotationEnabled&&annotationDraft)finishAnnotationDraft();refreshAnnotationUi();notify(annotationEnabled?'메모 모드를 켰습니다.':'메모 모드를 껐습니다.');};
$('annotation-toolbar-toggle').onclick=()=>{if(!ANNOTATABLE_PAGES.has(currentAnnotationPage()))return;if(annotationDraft)finishAnnotationDraft();annotationToolbarCollapsed=!annotationToolbarCollapsed;refreshAnnotationUi();};
document.querySelectorAll('[data-annotation-tool]').forEach(button=>button.onclick=()=>{annotationSettings.tool=button.dataset.annotationTool;saveAnnotationSettings();refreshAnnotationUi();});
$('annotation-width').oninput=e=>{const tool=annotationSettings.tool,max=tool==='eraser'?100:48,min=tool==='eraser'?4:2;annotationSettings[tool].width=Math.max(min,Math.min(max,Number(e.target.value)||min));saveAnnotationSettings();refreshAnnotationUi();};
$('annotation-opacity').oninput=e=>{const tool=annotationSettings.tool;if(tool==='eraser')return;annotationSettings[tool].opacity=Math.max(.05,Math.min(1,(Number(e.target.value)||5)/100));saveAnnotationSettings();refreshAnnotationUi();};
$('annotation-undo').onclick=()=>{const doc=currentAnnotationDoc();if(doc&&undoAnnotation(doc)){renderAnnotations();refreshAnnotationUi();scheduleAnnotationSave();}};
$('annotation-redo').onclick=()=>{const doc=currentAnnotationDoc();if(doc&&redoAnnotation(doc)){renderAnnotations();refreshAnnotationUi();scheduleAnnotationSave();}};
$('annotation-clear').onclick=()=>{const doc=currentAnnotationDoc();if(!doc?.strokes.length||!confirm('현재 도면의 모든 메모를 삭제할까요?'))return;if(clearAnnotationStrokes(doc)){renderAnnotations();refreshAnnotationUi();scheduleAnnotationSave();}};
annotationLayer.addEventListener('pointerenter',event=>{if(annotationEnabled&&annotationSettings.tool==='eraser')moveEraserCursor(event);});
annotationLayer.addEventListener('pointerleave',()=>{if(annotationPointerId===null)hideEraserCursor();});
annotationLayer.addEventListener('pointerdown',event=>{
 if(!annotationEnabled||!ANNOTATABLE_PAGES.has(currentAnnotationPage())||event.button!==0)return;event.preventDefault();annotationPointerId=event.pointerId;annotationLayer.setPointerCapture?.(event.pointerId);if(annotationSettings.tool==='eraser')moveEraserCursor(event);
 if(annotationSettings.tool==='eraser'){eraseAnnotationAt(event);return;}const point=annotationPoint(event);if(!point)return;annotationDraft=createStroke(annotationSettings.tool,annotationSettings,point);renderAnnotations();
});
annotationLayer.addEventListener('pointermove',event=>{
 if(annotationEnabled&&annotationSettings.tool==='eraser')moveEraserCursor(event);if(event.pointerId!==annotationPointerId)return;if(annotationSettings.tool==='eraser'){if(event.buttons&1)eraseAnnotationAt(event);return;}if(!annotationDraft)return;const point=annotationPoint(event);if(point&&appendPoint(annotationDraft,point,{minDistance:1,maxPoints:20000})){const draftPath=annotationLayer.querySelector('path:not([data-stroke-id])');if(draftPath)draftPath.setAttribute('d',strokePath(annotationDraft.points));}
});
const finishAnnotationPointer=event=>{if(event.pointerId!==annotationPointerId)return;try{annotationLayer.releasePointerCapture?.(event.pointerId);}catch{}if(annotationSettings.tool==='eraser'){annotationPointerId=null;if(!annotationLayer.matches(':hover'))hideEraserCursor();return;}finishAnnotationDraft();};
annotationLayer.addEventListener('pointerup',finishAnnotationPointer);annotationLayer.addEventListener('pointercancel',event=>{if(event.pointerId!==annotationPointerId)return;try{annotationLayer.releasePointerCapture?.(event.pointerId);}catch{}cancelAnnotationDraft();hideEraserCursor();});
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewer').requestFullscreen();}catch{notify('전체화면을 사용할 수 없습니다.');}};document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'종료':'전체화면';setTimeout(()=>viewerState.fitMode&&fitViewer(),50);});
const initialTab=document.querySelector(`[data-page="${viewerState.page}"]`)??document.querySelector('[data-page="5"]');initialTab.click();

// Resizable split
const layout=$('split-layout'),splitter=$('splitter'),isStacked=()=>matchMedia('(max-width:840px)').matches;
function applySplit(){document.documentElement.style.setProperty('--split',splitState.value+'%');splitter.setAttribute('aria-valuenow',String(Math.round(splitState.value)));splitter.setAttribute('aria-orientation',isStacked()?'horizontal':'vertical');saveStored('pcq-3d-split-v1',splitState.value);clearTimeout(viewerResizeTimer);viewerResizeTimer=setTimeout(()=>viewerState.fitMode&&fitViewer(),80);}
function moveSplit(e){const r=layout.getBoundingClientRect();splitState.fromPointer(isStacked()?e.clientY-r.top:e.clientX-r.left,isStacked()?r.height:r.width);applySplit();}
splitter.onpointerdown=e=>{splitter.setPointerCapture(e.pointerId);splitter.classList.add('dragging');moveSplit(e);};splitter.onpointermove=e=>{if(splitter.hasPointerCapture(e.pointerId))moveSplit(e);};splitter.onpointerup=e=>{if(splitter.hasPointerCapture(e.pointerId))splitter.releasePointerCapture(e.pointerId);splitter.classList.remove('dragging');};splitter.onkeydown=e=>{const previous=isStacked()?'ArrowUp':'ArrowLeft',next=isStacked()?'ArrowDown':'ArrowRight';if(e.key===previous||e.key===next){e.preventDefault();splitState.nudge(e.key===previous?-2:2);applySplit();}};window.addEventListener('resize',applySplit);applySplit();

document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!$('confirm').open&&!document.fullscreenElement){if($('progress-panel').classList.contains('open')){e.preventDefault();closeProgressPanel();}else if(wiring.draft&&!$('cancel').disabled){e.preventDefault();$('cancel').click();}else if(workToolMode){e.preventDefault();setWorkTool(null);}else if(selectedWireId||selectedCableTieId){e.preventDefault();deselectWorkItem({notifyUser:true});}}
 if(attempt.state!=='running')return;
 const command=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
 if(command&&((key==='y')||(key==='z'&&e.shiftKey))&&!$('redo').disabled){e.preventDefault();$('redo').click();return;}
 if(command&&key==='z'&&!e.shiftKey&&!$('undo').disabled){e.preventDefault();$('undo').click();return;}
 if(e.key==='Delete'&&!$('delete').disabled){e.preventDefault();$('delete').click();}
});
setInterval(()=>{$('clock').textContent=formatTime(attempt.elapsed());},100);
setInterval(()=>{if(attempt.state==='running')saveProgressNow();},5000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){saveProgressNow();flushAnnotationSaves();}});
window.addEventListener('pagehide',()=>{saveProgressNow();flushAnnotationSaves();});
refreshModeUi();buildShelf();refreshConnections();refreshDraft();

const resumeDialog=$('resume-dialog');resumeDialog.oncancel=e=>e.preventDefault();
$('resume-saved').onclick=()=>{try{const restored=restoreProgress(savedProgress,p,attempt,wiring);selectedWireId=restored.selectedWireId;selectedCableTieId=restored.selectedCableTieId;if(restored.lastWire)lastWire=restored.lastWire;setWorkTool(null,{silent:true});resumeDialog.close();$('clock').textContent=formatTime(attempt.elapsed());refreshConnections();refreshDraft();notify('저장된 실습을 이어서 시작합니다.');}catch(e){clearProgress();resumeDialog.close();notify('저장된 진행상황을 불러올 수 없어 처음부터 시작합니다.');}};
$('restart-saved').onclick=async()=>{await clearProgress();attempt.reset();wiring.cancel();selectedWireId=null;selectedCableTieId=null;setWorkTool(null,{silent:true});resumeDialog.close();$('clock').textContent='00:00:00';refreshConnections();refreshDraft();notify('새 실습을 시작할 준비가 되었습니다.');};
if(savedProgress)resumeDialog.showModal();
