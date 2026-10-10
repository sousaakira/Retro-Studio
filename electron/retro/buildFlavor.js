// #64: "comum" (release) e "para depurar" (debug) usam os mesmos objetos em out/. Trocar de um
// para o outro sem limpar ligaria objetos de um tipo na ROM do outro; por isso a troca limpa antes.
import fs from 'node:fs'
import path from 'node:path'
const FILE=['.retrostudio','build-flavor.json']
export const BUILD_FLAVORS=Object.freeze(['release','debug'])
/** Tipo do último build feito pela IDE. Sem registro = comum (o único tipo que existia). */
export function lastBuildFlavor(projectPath){
 try{const value=JSON.parse(fs.readFileSync(path.join(projectPath,...FILE),'utf8')).flavor;return ['release','debug','unknown'].includes(value)?value:'unknown'}
 catch(error){return error.code==='ENOENT'?'release':'unknown'}
}
/** Nunca derruba um build: falha ao gravar só faz o próximo build limpar por garantia. */
export function markBuildFlavor(projectPath,flavor,{create=flavor==='debug'}={}){
 const file=path.join(projectPath,...FILE)
 // Projetos que nunca usaram o build de depuração não ganham arquivo novo.
 if(!create&&!fs.existsSync(file))return
 try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({flavor})+'\n')}catch{/* registro local; ver comentário */}
}
// Um build por projeto: "make" comum, para depurar e o da IA escrevem no mesmo out/.
const building=new Map()
const key=projectPath=>{try{return fs.realpathSync(projectPath)}catch{return path.resolve(projectPath)}}
/** Devolve a função que libera a vez, ou null se outro build do mesmo projeto está rodando. */
export function acquireBuild(projectPath,owner){
 const id=key(projectPath);if(building.has(id))return null
 const token={owner};building.set(id,token)
 return ()=>{if(building.get(id)===token)building.delete(id)}
}
export const buildOwner=projectPath=>building.get(key(projectPath))?.owner||null
/** {flavor, goal, clean}: alvo do make e se é preciso limpar antes. */
export function planBuildFlavor(projectPath,wanted='release'){
 const flavor=BUILD_FLAVORS.includes(wanted)?wanted:'release'
 return {flavor,goal:flavor==='debug'?' debug':'',clean:lastBuildFlavor(projectPath)!==flavor}
}
