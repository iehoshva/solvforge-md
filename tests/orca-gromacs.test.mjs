import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

function runModule(body) {
  const script = `import('./lib/workbench/orca-gromacs.ts').then(async module => { ${body} })`
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout.trim())
}

const xyz = `2
synthetic OH fragment
O 0.000000 0.000000 0.000000
H 1.000000 0.000000 0.000000
`

const out = `! BP86 def2-TZVP
* xyz 0 1
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
O       0.000000  0.000000  0.000000
H       1.000000  0.000000  0.000000

MULLIKEN ATOMIC CHARGES
-----------------------
 0 O :  -0.40000000
 1 H :   0.40000000
Sum of atomic charges : 0.00000000

ORCA TERMINATED NORMALLY
`

const topology = `[ moleculetype ]
MOL 3

[ atoms ]
1 opls_154 1 MOL O1 1 -0.600000 15.999
2 opls_155 1 MOL H1 1  0.600000 1.008

[ bonds ]
1 2 1
`

test("ORCA parser preserves order, raw Mulliken charges, and Å→nm conversion", () => {
  const result = runModule(`
    const molecule={id:'test',fullName:'Test',abbreviation:'TST',role:'custom',formula:'OH',molecularWeight:17.007,charge:0,moleculeCount:null,topologyFile:'',coordinateFile:'',residueName:'TST',notes:''};
    const source=(name,text)=>({name,text,size:text.length,lastModified:0,sha256:'test',importedAt:'2026-01-01T00:00:00Z'});
    let prep=module.emptyMoleculePreparation(molecule);
    prep=module.attachXyz(prep,source('test.xyz',${JSON.stringify(xyz)}));
    prep=module.attachOrcaOutput(prep,source('test.out',${JSON.stringify(out)}));
    console.log(JSON.stringify({atoms:prep.atoms,diagnostics:module.orcaDiagnostics(prep),pdb:module.generatePdb(prep),gro:module.generateGro(prep),sum:module.mappedChargeSum(prep),geometry:module.geometryDifference(prep)}));
  `)
  assert.deepEqual(result.atoms.map((atom) => atom.element), ["O", "H"])
  assert.deepEqual(result.atoms.map((atom) => atom.gromacsName), ["O1", "H1"])
  assert.deepEqual(result.atoms.map((atom) => atom.mullikenCharge), [-0.4, 0.4])
  assert.equal(result.sum, 0)
  assert.equal(result.diagnostics.filter((item) => item.severity === "ERROR").length, 0)
  assert.match(result.pdb, /\s+1\.000\s+0\.000\s+0\.000/)
  assert.match(result.gro, /\s+0\.100\s+0\.000\s+0\.000/)
  assert.equal(result.geometry.rmsdAngstrom, 0)
})

test("atom-order mismatch blocks preparation until an explicit bijective mapping is supplied", () => {
  const reversedOut = out.replace("O       0.000000  0.000000  0.000000\nH       1.000000  0.000000  0.000000", "H       1.000000  0.000000  0.000000\nO       0.000000  0.000000  0.000000").replace("0 O :  -0.40000000\n 1 H :   0.40000000", "0 H :   0.40000000\n 1 O :  -0.40000000")
  const result = runModule(`
    const molecule={id:'test',fullName:'Test',abbreviation:'TST',role:'custom',formula:'OH',molecularWeight:17.007,charge:0,moleculeCount:null,topologyFile:'',coordinateFile:'',residueName:'TST',notes:''};
    const source=(name,text)=>({name,text,size:text.length,lastModified:0,sha256:'test',importedAt:'2026-01-01T00:00:00Z'});
    let prep=module.attachXyz(module.emptyMoleculePreparation(molecule),source('test.xyz',${JSON.stringify(xyz)}));
    prep=module.attachOrcaOutput(prep,source('test.out',${JSON.stringify(reversedOut)}));
    const before=module.orcaDiagnostics(prep);
    prep=module.reconcilePreparation({...prep,atoms:prep.atoms.map(atom=>({...atom,outIndex:atom.index===1?2:1}))});
    const after=module.orcaDiagnostics(prep);
    console.log(JSON.stringify({before,after,charges:prep.atoms.map(atom=>atom.mullikenCharge),mapping:prep.atoms.map(atom=>atom.outIndex)}));
  `)
  assert.ok(result.before.some((item) => item.code === "ATOM_MAPPING_MISMATCH" && item.severity === "ERROR"))
  assert.deepEqual(result.mapping, [2, 1])
  assert.deepEqual(result.charges, [-0.4, 0.4])
  assert.equal(result.after.filter((item) => item.severity === "ERROR").length, 0)
})

test("OPLS-AA topology import remains gated and merged .itp uses ORCA Mulliken charges", () => {
  const result = runModule(`
    const molecule={id:'test',fullName:'Test',abbreviation:'TST',role:'custom',formula:'OH',molecularWeight:17.007,charge:0,moleculeCount:null,topologyFile:'',coordinateFile:'',residueName:'TST',notes:''};
    const source=(name,text)=>({name,text,size:text.length,lastModified:0,sha256:'test',importedAt:'2026-01-01T00:00:00Z'});
    let prep=module.attachXyz(module.emptyMoleculePreparation(molecule),source('test.xyz',${JSON.stringify(xyz)}));
    prep=module.attachOrcaOutput(prep,source('test.out',${JSON.stringify(out)}));
    prep=module.importTopology(prep,source('test_raw.top',${JSON.stringify(topology)}));
    const gated=module.preparationStatus(prep);
    prep={...prep,connectivityApproved:true,topologyReviewed:true,gromppValidated:true,atoms:prep.atoms.map(atom=>({...atom,mappingStatus:'AUTO-MAPPED'}))};
    console.log(JSON.stringify({gated,ready:module.preparationStatus(prep),itp:module.generateItp(prep),mapping:module.generateAtomMappingCsv(prep),diagnostics:module.topologyDiagnostics(prep)}));
  `)
  assert.match(result.gated, /INCOMPLETE/)
  assert.match(result.ready, /RESEARCHER ACCEPTED/)
  assert.doesNotMatch(result.ready, /AUTOMATICALLY VERIFIED/)
  assert.match(result.itp, /-0\.40000000/)
  assert.match(result.itp, /0\.40000000/)
  assert.doesNotMatch(result.itp, /-0\.600000\s/)
  assert.match(result.mapping, /opls_154/)
  assert.match(result.mapping, /-0\.6/)
  assert.equal(result.diagnostics.filter((item) => item.severity === "ERROR").length, 0)
})

test("Packmol, system topology, symmetric RDF pairs, blocks, and packed-count validation are deterministic", () => {
  const result = runModule(`
    const atom=(index,element,name,charge)=>({index,element,x:index-1,y:0,z:0,outIndex:index,outElement:element,gromacsName:name,residueName:'',mullikenCharge:charge,existingTopologyCharge:charge,finalCharge:charge,oplsType:'opls_test',mass:element==='H'?1.008:15.999,ljSource:'test',mappingStatus:'AUTO-MAPPED'});
    const prep=(id,residue)=>({moleculeId:id,residueName:residue,expectedFormalCharge:0,chargeTolerance:1e-4,chargeAcknowledged:false,xyzFile:null,outFile:null,xyzComment:'',xyzAtoms:[{index:1,element:'O',x:0,y:0,z:0},{index:2,element:'H',x:1,y:0,z:0}],outCoordinates:[],outCharges:[],atoms:[{...atom(1,'O','O1',-0.4),residueName:residue},{...atom(2,'H','H1',0.4),residueName:residue}],bonds:[{id:'1-2',ai:1,aj:2,elementI:'O',elementJ:'H',distanceAngstrom:1,proposed:false,accepted:true,source:'user'}],connectivityApproved:true,coordinateSettings:{center:false,translateAngstrom:{x:0,y:0,z:0}},orcaMetadata:{inputLine:'',method:'BP86',basis:'def2-TZVP',parsedTotalCharge:0,terminatedNormally:true},topologyFileName:'',topologyText:'[ atoms ]\\n1 opls_test 1 MOL O1 1 -0.6 15.999\\n2 opls_test 1 MOL H1 1 0.6 1.008\\n[ bonds ]\\n1 2 1',topologySections:[{name:'atoms',lines:['1 opls_test 1 MOL O1 1 -0.6 15.999','2 opls_test 1 MOL H1 1 0.6 1.008']},{name:'bonds',lines:['1 2 1']}],topologyReviewed:true,gromppValidated:true,notes:'',updatedAt:'now'});
    const preparations={a:prep('a','AAA'),b:prep('b','BBB'),s:prep('s','SOL')};
    const run={runId:'TEST_RUN',stage:'A',desId:'des',desName:'A:B',desAbbreviation:'A-B',components:[{moleculeId:'a',name:'A',count:5,molecularWeight:17},{moleculeId:'b',name:'B',count:1,molecularWeight:17}],soluteId:'s',soluteName:'Solute',soluteAbbreviation:'S',soluteCount:2,moleFraction:0.25,totalMoleculeCount:8,moleFractions:{a:0.625,b:0.125,s:0.25},massFractions:null,numberDensitiesNm3:null,boxVolumeNm3:125,compositionCalculation:null,compositionDiagnostics:[],concentrationLabel:'N2',temperatureK:323.15,pressureBar:1,box:{x:5,y:5,z:5,geometry:'cubic',unit:'nm'},replica:1,randomSeed:1,protocolName:'test',forceField:'OPLS-AA',chargeScheme:'Mulliken-derived charges from ORCA BP86/def2-TZVP',resolvedProtocol:{topologyInclude:'oplsaa.ff/forcefield.itp'},productionNs:100,status:'planned'};
    const packedAtoms=[]; let serial=1,residueNumber=1; for (const [residue,count] of [['AAA',5],['BBB',1],['SOL',2]]) for(let m=0;m<count;m++){ packedAtoms.push({serial:serial++,atomName:'O1',residueName:residue,residueNumber,xAngstrom:1,yAngstrom:1,zAngstrom:1,element:'O'}); packedAtoms.push({serial:serial++,atomName:'H1',residueName:residue,residueNumber:residueNumber++,xAngstrom:2,yAngstrom:1,zAngstrom:1,element:'H'}); }
    const packed={runId:run.runId,sourceFile:{name:'packed.pdb',text:'',size:0,lastModified:0,sha256:'test',importedAt:'now'},atoms:packedAtoms,cryst1Angstrom:{x:50,y:50,z:50},importedAt:'now'};
    const state={schemaVersion:'0.1',tutorialMode:true,selectedMoleculeId:'',selectedRunId:'',molecules:preparations,packedSystems:{},execution:{},packmol:{toleranceAngstrom:2,marginAngstrom:1,periodic:true},rdf:{mode:'center-of-mass',binWidthNm:0.002,rmaxNm:2.4,beginNs:0,endNs:100,customSelections:{},blocks:'0-20,20-40'},ssm:{sizesNm:'1.5,2.0,2.5',beginNs:0,endNs:100,pair:''},updatedAt:'now'};
    console.log(JSON.stringify({packmol:module.generatePackmolInput(run,preparations,state.packmol),topol:module.generateTopolTop(run,preparations),pairs:module.pairwiseSpecies(run,preparations),rdf:module.generateRdfCommands(run,preparations,state.rdf),blocks:module.generateBlockRdfCommands(run,preparations,state.rdf),diagnostics:module.validatePackedSystem(run,packed,preparations),index:module.generateIndexNdx(packed,run,preparations),gro:module.generatePackedGro(run,packed)}));
  `)
  assert.match(result.packmol, /pbc 0\.000 0\.000 0\.000 50\.000 50\.000 50\.000/)
  assert.match(result.packmol, /number 5/)
  assert.match(result.packmol, /number 2/)
  assert.match(result.topol, /AAA\s+5/)
  assert.match(result.topol, /SOL\s+2/)
  assert.equal(result.pairs.length, 6)
  assert.equal((result.rdf.match(/gmx rdf/g) ?? []).length, 6)
  assert.equal((result.blocks.match(/gmx rdf/g) ?? []).length, 12)
  assert.equal(result.diagnostics.filter((item) => item.severity === "ERROR").length, 0)
  assert.match(result.index, /\[ AAA \]/)
  assert.match(result.gro, /5\.00000\s+5\.00000\s+5\.00000/)
})

test("unresolved absolute counts stop Packmol instead of turning a ratio into zero molecules", () => {
  const result = runModule(`
    const run={runId:'UNRESOLVED',stage:'A',desId:'des',desName:'A:B',desAbbreviation:'A-B',components:[{moleculeId:'a',name:'A',count:null,molecularWeight:17},{moleculeId:'b',name:'B',count:null,molecularWeight:17}],soluteId:'s',soluteName:'Solute',soluteAbbreviation:'S',soluteCount:1,moleFraction:null,totalMoleculeCount:null,moleFractions:null,massFractions:null,numberDensitiesNm3:null,boxVolumeNm3:125,compositionCalculation:null,compositionDiagnostics:[],concentrationLabel:'N1',temperatureK:323.15,pressureBar:1,box:{x:5,y:5,z:5,geometry:'cubic',unit:'nm'},replica:1,randomSeed:1,protocolName:'test',forceField:'OPLS-AA',chargeScheme:'Mulliken-derived charges from ORCA BP86/def2-TZVP',resolvedProtocol:{topologyInclude:'oplsaa.ff/forcefield.itp'},productionNs:100,status:'planned'};
    const state=module.defaultOrcaGromacsState();
    console.log(JSON.stringify({packmol:module.generatePackmolInput(run,{},state.packmol),topol:module.generateTopolTop(run,{})}));
  `)
  assert.match(result.packmol, /ERROR: absolute molecule count for A is unresolved/)
  assert.match(result.packmol, /ERROR: absolute molecule count for B is unresolved/)
  assert.doesNotMatch(result.packmol, /number 0/)
  assert.match(result.topol, /INCOMPLETE — DO NOT USE FOR PRODUCTION MD/)
  assert.match(result.topol, /UNRESOLVED/)
})

test("block parsing rejects malformed input and command drafts remain separate", () => {
  const result = runModule(`
    const state=module.defaultOrcaGromacsState(); state.commandOverrides['run:R1:rdf_all_pairs.sh']='researcher edited command';
    let invalid=false;try{module.parseBlocks('0-20,typo,40-60')}catch{invalid=true}
    console.log(JSON.stringify({blocks:module.parseBlocks('0-20,20-40'),invalid,edited:module.commandText(state,'run:R1:rdf_all_pairs.sh','generated'),generated:module.commandText(state,'run:R2:rdf_all_pairs.sh','generated')}));
  `)
  assert.deepEqual(result.blocks,[{startNs:0,endNs:20},{startNs:20,endNs:40}])
  assert.equal(result.invalid,true)
  assert.equal(result.edited, "researcher edited command")
  assert.equal(result.generated, "generated")
})
