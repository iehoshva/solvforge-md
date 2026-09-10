/** Public-UI tests; every selector refers to a visible scientific control. */
const b=(t,n)=>t.playwright.getByRole('button',{name:n,exact:true})
const c=(t,n)=>t.playwright.getByRole('combobox',{name:n,exact:true})
const assert=(x,m)=>{if(!x)throw Error(m)}
export async function protocolControls(t){
 const cases=[
 ['EM integrator','cg','em','integrator','cg',true],['EM maximum steps','70000','em','nsteps','70000'],['Fmax target (kJ mol⁻¹ nm⁻¹)','500','em','emtol','500'],
 ['NVT duration (ns)','8','nvt','nsteps','8000000'],['NVT timestep (fs)','2','nvt','dt','0.002'],['Thermostat','Nose-Hoover','prod','tcoupl','Nose-Hoover',true],['Temperature coupling τT (ps)','0.3','npt','tau-t','0.3'],
 ['NPT duration (ns)','12','npt','nsteps','6000000'],['NPT timestep (fs)','1','npt','dt','0.001'],['Barostat','C-rescale','prod','pcoupl','C-rescale',true],['Pressure coupling τP (ps)','3','prod','tau-p','3'],['Compressibility (bar⁻¹)','0.0002','npt','compressibility','0.0002'],
 ['Initial production duration (ns)','120','prod','nsteps','60000000'],['Production timestep (fs)','1','prod','dt','0.001'],['Trajectory frame interval (ps)','10','prod','nstxout-compressed','5000'],
 ['Nonbonded cutoff (nm)','1.4','em','rcoulomb','1.4'],['Coulomb method','Cut-off','npt','coulombtype','Cut-off',true],['PME order','6','nvt','pme-order','6'],['Fourier spacing (nm)','0.15','em','fourierspacing','0.15'],
 ['Constraints','all-bonds','prod','constraints','all-bonds',true],['Constraint algorithm','shake','nvt','constraint-algorithm','shake',true],['Pressure (bar)','2','prod','ref-p','2'],['Random seed base','98765','nvt','gen-seed','98765']]
 const out=[]
 for(const [name,value,stage,key,expected,isSelect] of cases){
  const control=t.playwright.getByRole(isSelect?'combobox':'spinbutton',{name,exact:true}),old=await control.evaluate(el=>el.value)
  if(isSelect)await control.selectOption(value);else await control.fill(value)
  await c(t,'Input preview file').click();await t.playwright.getByRole('option',{name:stage+'.mdp',exact:true}).click()
  const mdp=await t.playwright.getByRole('textbox',{name:'Resolved input file',exact:true}).evaluate(el=>el.value)
  const actual=mdp.split('\n').map(l=>l.split(';')[0].split('=').map(x=>x.trim())).find(x=>x[0]===key)?.[1]
  assert(actual===expected,`${name}: ${key} expected ${expected}, got ${actual}`)
  if(isSelect)await control.selectOption(old);else await control.fill(old)
  out.push({control:name,directive:key,status:'PASS'})
 }
 for(const name of ['Implemented force field','Implemented charge pipeline'])assert(!await t.playwright.getByRole('textbox',{name,exact:true}).isEnabled(),name+' must be disabled')
 return{test:'23 editable protocol controls change actual MDPs; unsupported pipelines disabled',status:'PASS',controls:out}
}
export async function ssmPreviewInvalidation(t){
 await b(t,'SSM / Finite Size').click();await c(t,'Finite-size base run').selectOption({index:1});await b(t,'Preview distinct systems').click()
 assert(await b(t,'Add finite-size runs').isEnabled(),'Expected generated systems')
 await t.playwright.getByRole('textbox',{name:'Integer population multipliers',exact:true}).fill('1,3,5')
 assert(!await b(t,'Add finite-size runs').isEnabled(),'Changed sizes must invalidate old preview')
 return{test:'Changing finite-size design invalidates stale generated systems',status:'PASS'}
}
