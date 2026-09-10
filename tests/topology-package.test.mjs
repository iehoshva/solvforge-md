import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {fixture,addRun,source} from './scientific-fixture.mjs'
import {importTopology,topologyDiagnostics,systemTopologyDiagnostics} from '../lib/workbench/orca-gromacs.ts'

async function withParameters(w,duplicate=false){
 for(const [i,[id,p]]of Object.entries(w.orcaGromacs.molecules).entries()){
  const type=duplicate?'sf_duplicate':'sf_fixture_'+i
  const text='[ atomtypes ]\n'+type+' 8 15.999 0 A 0.3 0.5\n'+p.topologyText.replace('opls_154',type)
  const mapped=importTopology(p,await source(id+'.top',text))
  w.orcaGromacs.molecules[id]={...mapped,connectivityApproved:true,topologyReviewed:true,gromppValidated:false,atoms:mapped.atoms.map(a=>({...a,mappingStatus:'USER-OVERRIDDEN',ljSource:'Synthetic parameter fixture only'}))}
 }
}

test('complete reviewed inputs export before external grompp; preprocessed system parameters precede all molecules',async()=>{
 const w=await fixture();await withParameters(w);const r=await addRun(w)
 const files=r.inputSnapshots[0].files,top=files.find(f=>f.path==='00_input/topol.top').content
 assert.match(top,/READY FOR GROMPP VALIDATION/)
 assert.doesNotMatch(top,/AUTOMATICALLY VERIFIED|RESEARCHER ACCEPTED/)
 const root=mkdtempSync(join(tmpdir(),'solvforge-topology-'))
 try{
  for(const f of files.filter(f=>f.path.startsWith('00_input/')&&/\.(top|itp)$/.test(f.path))){const path=join(root,f.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,f.content)}
  mkdirSync(join(root,'00_input/oplsaa.ff'));writeFileSync(join(root,'00_input/oplsaa.ff/forcefield.itp'),'; Synthetic preprocessing fixture, not the OPLS-AA distribution.\n[ defaults ]\n1 3 yes 0.5 0.5\n')
  // Independent C preprocessor checks the same #define/#ifndef/#include subset
  // documented by GROMACS. This is not a replacement for external grompp.
  const expanded=execFileSync('cpp',['-P','-traditional-cpp',join(root,'00_input/topol.top')],{encoding:'utf8'})
  const headers=[...expanded.matchAll(/^\s*\[\s*(\w+)\s*\]/gm)].map(m=>m[1])
  assert.equal(headers.filter(h=>h==='atomtypes').length,3)
  assert.equal(headers.filter(h=>h==='moleculetype').length,3)
  assert.ok(!headers.slice(headers.indexOf('moleculetype')).includes('atomtypes'))
  assert.equal((expanded.match(/sf_fixture_\d 8 15.999/g)??[]).length,3)
  assert.equal((expanded.match(/-0\.400000000000000/g)??[]).length,3)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('unresolved imported preprocessor branches block topology merge',async()=>{
 const w=await fixture(),p=Object.values(w.orcaGromacs.molecules)[0]
 const conditional=importTopology(p,await source('conditional.top','#ifdef USE_ALTERNATIVE\n'+p.topologyText+'\n#endif\n'))
 assert.ok(topologyDiagnostics(conditional).some(d=>d.code==='UNRESOLVED_TOPOLOGY_PREPROCESSOR'&&d.severity==='ERROR'))
})

test('duplicate cross-molecule atom definitions fail the same system gate used by package export',async()=>{
 const w=await fixture(),r=await addRun(w);await withParameters(w,true)
 assert.ok(systemTopologyDiagnostics(r,w.orcaGromacs.molecules).some(d=>d.code==='DUPLICATE_SYSTEM_ATOMTYPE'&&d.severity==='ERROR'))
})
