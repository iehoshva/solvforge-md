/** Browser E2E through the supported browser-client Tab API.
 * No storage injection, DOM mutation, hidden application state or browser-driver fallback.
 * Provide an already-open preview Tab and synthetic fixture paths visible to that browser.
 * Run each exported phase separately so failures and progress remain observable.
 */
const assert=(value,message)=>{if(!value)throw new Error(message)}
const button=(t,name)=>t.playwright.getByRole('button',{name,exact:true})
const select=(t,name)=>t.playwright.getByRole('combobox',{name,exact:true})
export async function importFixture(tab,path){
 await button(tab,'Data / Export').click()
 const pending=tab.playwright.waitForEvent('filechooser',{timeoutMs:10000})
 await button(tab,'Import complete project').click();const chooser=await pending;await chooser.setFiles([path])
 await button(tab,'KBI Analyzer 18').waitFor({state:'visible',timeoutMs:15000})
 return{test:'Complete ZIP restores 18 raw RDF records',status:'PASS'}
}
export async function matrixGate(tab){
 await button(tab,'KB Matrix / Thermo').click()
 await select(tab,'Thermodynamic run').selectOption({index:1});await select(tab,'Thermodynamic density source').selectOption({index:1})
 const pairs=await tab.playwright.getByRole('table').getByRole('combobox').all();assert(pairs.length===6,'Expected six independent molecular-pair terms')
 for(const pair of pairs)await pair.selectOption({index:1})
 await button(tab,'Calculate Γ from selected evidence').click()
 assert((await tab.playwright.getByRole('alert').innerText()).includes('Finite-size correction missing'),'Missing finite-size evidence must block strict inversion')
 await tab.playwright.getByRole('textbox',{name:'Advanced override rationale (blank = strict gates)',exact:true}).fill('SYNTHETIC E2E: finite-size override tests software only.')
 await button(tab,'Calculate Γ from selected evidence').click()
 const text=await tab.playwright.getByText(/Γ along fixed DES ratio/).innerText()
 assert(text.includes('1.0000')&&text.includes('CURRENT EVIDENCE')&&text.includes('OVERRIDDEN'),'Explicit override must remain current and visible after persistence')
 return{test:'Strict KB gate and explicit override survive UI persistence',status:'PASS'}
}
export async function replicasAndRejection(tab){
 await button(tab,'KBI Analyzer 18').click();await tab.playwright.getByRole('tab',{name:'Replicas',exact:true}).click()
 const text=await tab.playwright.getByRole('tabpanel',{name:'Replicas',exact:true}).innerText()
 assert((text.match(/Independent replicas: 1/g)??[]).length===6,'Six RDF pairs must remain six n=1 summaries')
 assert(!text.includes('Independent replicas: 18'),'Blocks are not independent replicas')
 await tab.playwright.getByRole('tab',{name:'Block convergence',exact:true}).click()
 assert((await tab.playwright.getByRole('tabpanel',{name:'Block convergence',exact:true}).innerText()).includes('Authoritative status: RESEARCHER ACCEPTED'),'Expected accepted same-trajectory time windows')
 await tab.playwright.getByRole('tab',{name:'Plateau',exact:true}).click();await tab.playwright.getByRole('textbox',{name:'Plateau decision rationale',exact:true}).fill('SYNTHETIC E2E: reject source and invalidate downstream result.')
 await button(tab,'Reject plateau').click();await button(tab,'KB Matrix / Thermo').click();await select(tab,'Thermodynamic run').selectOption({index:1});await select(tab,'Thermodynamic density source').selectOption({index:1})
 assert((await tab.playwright.getByText(/Γ along fixed DES ratio/).innerText()).includes('STALE / BLOCKED'),'Rejected ancestor must invalidate Gamma')
 return{test:'Pair/replica separation, block decisions and rejected-source propagation',status:'PASS'}
}
export async function projectIsolation(tab){
 await button(tab,'Project').click();await button(tab,'New custom project').click()
 await tab.playwright.getByRole('textbox',{name:'Project name',exact:true}).fill('E2E CLEAN PROJECT')
 await button(tab,'KBI Analyzer').click();assert(await tab.playwright.getByRole('heading',{name:'Import processed RDF',exact:true}).isVisible(),'New project must have no RDF evidence')
 await button(tab,'KB Matrix / Thermo').click();assert((await select(tab,'Thermodynamic run').textContent()).trim()==='Select exact run','New project must have no runs')
 await tab.reload();await tab.playwright.getByRole('textbox',{name:'Project name',exact:true}).waitFor({state:'visible',timeoutMs:10000})
 assert(await tab.playwright.getByRole('textbox',{name:'Project name',exact:true}).getAttribute('value')==='E2E CLEAN PROJECT','Project must persist on reload')
 await select(tab,'Open saved project').selectOption({label:'SYNTHETIC SOFTWARE TEST — NOT RESEARCH DATA'})
 await button(tab,'KBI Analyzer 18').waitFor({state:'visible',timeoutMs:10000})
 return{test:'New project isolation, reload and explicit reopen of previous evidence',status:'PASS'}
}
export async function manifestIsolation(tab,path){
 await button(tab,'Data / Export').click();const pending=tab.playwright.waitForEvent('filechooser',{timeoutMs:10000});await button(tab,'Import complete project').click();const chooser=await pending;await chooser.setFiles([path])
 await button(tab,'KBI Analyzer').waitFor({state:'visible',timeoutMs:15000});await button(tab,'KB Matrix / Thermo').click()
 assert((await select(tab,'Thermodynamic run').textContent()).trim()==='Select exact run','Manifest-only import must clear scientific state, even with the same projectId')
 return{test:'Design-only import cannot inherit previous project evidence',status:'PASS'}
}
export async function numericalModule(tab){
 await button(tab,'Validation Tests').click();await button(tab,'Run all tests').click()
 const text=await tab.playwright.getByRole('table').innerText()
 assert((text.match(/PASS/g)??[]).length===5&&!text.includes('FAIL'),'All five visible implementation tests must pass')
 return{test:'Five visible numerical implementation tests',status:'PASS'}
}
