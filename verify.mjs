import {readFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {getProblem} from './dist/problem.mjs';
import {createHardwareProblem} from './dist/hardware.mjs';
import {problemProfiles} from './dist/problem-profiles.mjs';
const catalog=JSON.parse(await readFile('dist/catalog.json','utf8'));
if(catalog.length!==26||catalog.filter(x=>x.status==='prototype').length!==1)throw Error('catalog scope');
for(const x of catalog)for(let i=1;i<=6;i++)await access(`dist/assets/${x.id}/${i}.webp`);
for(const x of ['index.html','style.css','assets/board.webp','3d.html','3d.css','vendor/three.module.js','vendor/three.core.js','vendor/OrbitControls.js','vendor/THREE-LICENSE.txt'])await access('dist/'+x);
for(const x of ['app.mjs','problem.mjs','problem-profiles.mjs','engine.mjs','hardware.mjs','scene-geometry.mjs','workbench-3d.mjs','wiring-controller.mjs','viewer-state.mjs','split-state.mjs','error-markers.mjs','progress-storage.mjs','cable-ties.mjs','3d-app.mjs'])execFileSync(process.execPath,['--check','dist/'+x]);
const catalogIds=new Set(catalog.map(x=>x.id)),profileIds=Object.keys(problemProfiles);if(profileIds.length!==26||profileIds.some(id=>!catalogIds.has(id))||catalog.some(x=>!problemProfiles[x.id]))throw Error('problem profile coverage');
for(const item of catalog){const p=createHardwareProblem(item.id),ids=new Set(p.terminals.map(t=>t.id));if(p.id!==item.id||p.devices.length!==31||p.terminals.length!==243)throw Error(`${item.id}: hardware scope`);if(ids.size!==p.terminals.length)throw Error(`${item.id}: duplicate terminal`);for(const n of p.nets)for(const id of n.members)if(!ids.has(id))throw Error(`${item.id}: unresolved ${id}`);for(const d of p.devices)for(const t of d.terminalObjects)if(p.terminalMap[t.id]!==t)throw Error(`${item.id}: detached terminal ${t.id}`);}
const p=getProblem();console.log(`Validated ${catalog.length} problems × 6 PDF pages, 26 hardware/netlist profiles, ${p.devices.length} device types.`);
