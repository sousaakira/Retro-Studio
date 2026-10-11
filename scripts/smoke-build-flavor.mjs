// #64: tipo de build (comum / para depurar) com make de verdade: troca limpa antes, um build
// por projeto, Makefile sem o alvo "debug" não perde a ROM, cancelamento, e projeto que nunca
// depurou não ganha arquivo novo.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {lastBuildFlavor,acquireBuild,buildOwner} from '../electron/retro/buildFlavor.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-build-flavor-'))
try{
 const toolkit=path.join(temporary,'sgdk-toolkit');fs.mkdirSync(path.join(toolkit,'m68k-elf'),{recursive:true})
 const emulatorSource=fs.readFileSync(new URL('../electron/retro/emulatorUtils.js',import.meta.url),'utf8'),findRom=emulatorSource.slice(emulatorSource.indexOf('export function findRomOutput')).replace('export function','function')
 async function importBuild(name){
  let code=fs.readFileSync(new URL('../electron/retro/'+name+'.js',import.meta.url),'utf8')
  code=code.replace("import { loadConfigFile } from './utils.js'",'const loadConfigFile = (_name,fallback) => fallback')
   .replace("import { resolveEmulatorPath, findRomOutput } from './emulatorUtils.js'",'const resolveEmulatorPath = () => null\n'+findRom)
   .replace("import { ipcMain } from 'electron'",'export const fixtureHandlers=new Map();const ipcMain={on(name,fn){fixtureHandlers.set(name,fn)}}')
  code=code.replace("'../../shared/retro/toolchain.js'",JSON.stringify(new URL('../shared/retro/toolchain.js',import.meta.url).href)).replace("'../../shared/retro/buildProgress.js'",JSON.stringify(new URL('../shared/retro/buildProgress.js',import.meta.url).href))
  for(const module of ['errorParser','buildSnapshot','worldConfiguration','cameraConfiguration','progressConfiguration','audioConfiguration','cutsceneAdapter','debugConfiguration','paletteConfiguration','buildFlavor','hudConfiguration'])code=code.replace("'./"+module+".js'",JSON.stringify(new URL('../electron/retro/'+module+'.js',import.meta.url).href))
  const file=path.join(temporary,name+'.mjs');fs.writeFileSync(file,code);return import(pathToFileURL(file).href)
 }
 const tools=await importBuild('buildForTools'),ide=await importBuild('game');ide.setupGameHandlers()
 const project=(name,makefile)=>{const root=path.join(temporary,name);fs.mkdirSync(path.join(root,'src'),{recursive:true});fs.writeFileSync(path.join(root,'src/main.c'),'int main(void){return 0;}\n');fs.writeFileSync(path.join(root,'Makefile'),makefile);return root}
 const read=(root,file)=>{try{return fs.readFileSync(path.join(root,file),'utf8')}catch{return null}}
 const marker=root=>read(root,'.retrostudio/build-flavor.json')
 const runIde=(root,{clean=false,flavor}={})=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('IDE build did not finish')),15000)
  ide.fixtureHandlers.get('retro:build-only')({reply(channel,payload){if(['retro:run-game-error','retro:build-complete'].includes(channel)){clearTimeout(timer);resolve({channel,payload})}}},{path:root,toolkitPath:toolkit,clean,flavor})
 })
 // Objetos guardam o tipo com que foram feitos; a ROM junta o que estiver em out/.
 const MAKE=`.PHONY: all release debug clean
all: release
release: KIND=release
debug: KIND=debug
release debug: out/main.o
\tcat out/main.o > out/rom.bin
\tprintf elf > out/rom.out
out/main.o: src/main.c
\tmkdir -p out
\t$(SLOW)
\tprintf '%s' $(KIND) > out/main.o
clean:
\tprintf cleaned >> clean-log
\trm -rf out
`
 // 1. Projeto que nunca depurou: builds comuns (inclusive limpos e com falha) não criam o registro.
 const root=project('jogo',MAKE)
 let result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,true,result.error);assert.deepEqual([read(root,'out/rom.bin'),result.flavor,marker(root),read(root,'clean-log')],['release','release',null,null])
 result=await tools.runBuildAsync(root,toolkit,{clean:true});assert.equal(result.success,true);assert.deepEqual([marker(root),read(root,'clean-log')],[null,'cleaned'])
 assert.equal((await runIde(root,{clean:true})).channel,'retro:build-complete');assert.equal(marker(root),null)
 fs.writeFileSync(path.join(root,'Makefile'),MAKE.replace("printf '%s' $(KIND) > out/main.o",'exit 7'))
 fs.rmSync(path.join(root,'out'),{recursive:true});result=await tools.runBuildAsync(root,toolkit,{clean:true});assert.equal(result.success,false);assert.equal(marker(root),null,'falha de build comum não cria o registro nem força limpeza depois')
 fs.writeFileSync(path.join(root,'Makefile'),MAKE);fs.writeFileSync(path.join(root,'clean-log'),'')
 result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,true);assert.equal(read(root,'clean-log'),'','o build seguinte continua incremental')
 // 2. Para depurar: limpa antes (os objetos comuns não entram na ROM de depuração) e registra o tipo.
 result=await tools.runBuildAsync(root,toolkit,{flavor:'debug'});assert.equal(result.success,true,result.error)
 assert.deepEqual([read(root,'out/rom.bin'),result.flavor,lastBuildFlavor(root),read(root,'clean-log')],['debug','debug','debug','cleaned'])
 result=await tools.runBuildAsync(root,toolkit,{flavor:'debug'});assert.equal(read(root,'clean-log'),'cleaned','mesmo tipo de novo: incremental')
 // 3. De volta ao comum pela IDE: limpa sozinho; o canal não aceita pedir "debug".
 let reply=await runIde(root,{flavor:'debug'});assert.equal(reply.channel,'retro:build-complete');assert.deepEqual([read(root,'out/rom.bin'),lastBuildFlavor(root),read(root,'clean-log')],['release','release','cleanedcleaned'])
 // 4. Build de depuração que falha: o registro fica "unknown" e o próximo build limpa.
 fs.writeFileSync(path.join(root,'Makefile'),MAKE.replace("printf '%s' $(KIND) > out/main.o","printf '%s' $(KIND) > out/main.o; test $(KIND) = release"))
 result=await tools.runBuildAsync(root,toolkit,{flavor:'debug'});assert.equal(result.success,false);assert.equal(lastBuildFlavor(root),'unknown');assert.equal(read(root,'out/main.o'),'debug','objeto de depuração ficou em out/')
 fs.writeFileSync(path.join(root,'clean-log'),'');result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,true)
 assert.deepEqual([read(root,'out/rom.bin'),read(root,'clean-log'),lastBuildFlavor(root)],['release','cleaned','release'],'a ROM comum não aproveita o objeto de depuração')
 // 5. Um build por projeto: com o de depuração rodando, o da IDE e o da IA são recusados; outro projeto não é afetado.
 fs.writeFileSync(path.join(root,'Makefile'),MAKE.replace('$(SLOW)','sleep 1'))
 const slow=tools.runBuildAsync(root,toolkit,{flavor:'debug'});await new Promise(resolve=>setTimeout(resolve,150))
 assert.equal(buildOwner(root),'tools')
 reply=await runIde(root);assert.equal(reply.channel,'retro:run-game-error');assert.match(reply.payload.message,/Já há um build deste projeto em andamento/)
 result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,false);assert.match(result.error,/Já há um build deste projeto em andamento/)
 const other=project('outro',MAKE);assert.equal((await tools.runBuildAsync(other,toolkit)).success,true)
 result=await slow;assert.equal(result.success,true,result.error);assert.deepEqual([read(root,'out/rom.bin'),lastBuildFlavor(root),buildOwner(root)],['debug','debug',null],'ninguém mexeu em out/ durante o build')
 // 6. Cancelar: o make para, a vez é liberada, o registro fica "unknown".
 fs.writeFileSync(path.join(root,'Makefile'),MAKE.replace('$(SLOW)','sleep 30'));fs.writeFileSync(path.join(root,'src/main.c'),'int main(void){return 1;}\n')
 let stop=null;const started=Date.now(),cancelled=tools.runBuildAsync(root,toolkit,{flavor:'debug',clean:true,onProcess:fn=>{stop=fn}});await new Promise(resolve=>setTimeout(resolve,300));stop()
 result=await cancelled;assert.deepEqual([result.success,result.cancelled,buildOwner(root)],[false,true,null]);assert.ok(Date.now()-started<8000);assert.equal(lastBuildFlavor(root),'unknown')
 // 7. Makefile próprio sem o alvo "debug": nada é limpo, a ROM fica, nenhum registro é criado, e a saída do make aparece.
 const custom=project('proprio','.PHONY: all clean\nall:\n\tmkdir -p out\n\tprintf custom > out/rom.bin\nclean:\n\trm -rf out\n')
 assert.equal((await tools.runBuildAsync(custom,toolkit)).success,true)
 result=await tools.runBuildAsync(custom,toolkit,{flavor:'debug'})
 assert.deepEqual([result.success,result.missingGoal,read(custom,'out/rom.bin'),marker(custom),buildOwner(custom)],[false,true,'custom',null,null]);assert.match(result.error,/não constrói o alvo “debug”\. Nada foi limpo nem alterado\. Saída do make: .*debug/)
 assert.equal((await tools.runBuildAsync(custom,toolkit)).success,true,'o build comum segue como antes')
 // O ensaio falhar por outro motivo (arquivo que a geração do próprio build cria) não impede o build.
 const generated=project('gerado','.PHONY: all debug gen clean\nall debug: gen\n\t$(MAKE) real\nreal: out/made.txt\n\tprintf ok > out/rom.bin\nout/made.txt: gerado.txt\n\tcp gerado.txt out/made.txt\ngen:\n\tmkdir -p out\n\tprintf g > gerado.txt\nclean:\n\trm -rf out gerado.txt\n')
 result=await tools.runBuildAsync(generated,toolkit,{flavor:'debug'});assert.equal(result.success,true,result.error);assert.equal(read(generated,'out/rom.bin'),'ok')
 // #34: projeto SEM Makefile próprio usa o makefile.gen do toolkit (build e limpeza pela mesma escolha);
 // projeto COM Makefile usa o dele — nos dois caminhos de build (IDE e ferramentas).
 fs.writeFileSync(path.join(toolkit,'m68k-elf/makefile.gen'),'.PHONY: release clean\nrelease:\n\tmkdir -p out\n\tprintf toolkit > out/rom.bin\nclean:\n\tprintf gen-clean >> clean-log\n\trm -rf out\n')
 const plain=path.join(temporary,'sem-makefile');fs.mkdirSync(path.join(plain,'src'),{recursive:true});fs.writeFileSync(path.join(plain,'src/main.c'),'int main(void){return 0;}\n')
 result=await tools.runBuildAsync(plain,toolkit);assert.equal(result.success,true,result.error);assert.equal(read(plain,'out/rom.bin'),'toolkit','sem Makefile do projeto: makefile.gen do toolkit')
 result=await tools.runBuildAsync(plain,toolkit,{clean:true});assert.equal(result.success,true);assert.equal(read(plain,'clean-log'),'gen-clean','a limpeza usa o mesmo makefile')
 assert.equal((await runIde(plain,{clean:true})).channel,'retro:build-complete');assert.deepEqual([read(plain,'out/rom.bin'),read(plain,'clean-log')],['toolkit','gen-cleangen-clean'])
 assert.equal((await tools.runBuildAsync(custom,toolkit)).success,true);assert.equal(read(custom,'out/rom.bin'),'custom','com Makefile do projeto: o do projeto, não o do toolkit');assert.equal((await runIde(custom)).channel,'retro:build-complete');assert.equal(read(custom,'out/rom.bin'),'custom')
 // 8. A trava em si.
 const release=acquireBuild(other,'ide');assert.equal(acquireBuild(other,'tools'),null);assert.equal(acquireBuild(path.join(other,'.'),'tools'),null);release();release();const again=acquireBuild(other,'tools');assert.ok(again);again()
 console.log('Build flavor: old projects untouched, flavor switch cleans, failed debug build cleans next, one build per project, cancel, Makefile without debug target keeps the ROM, project Makefile vs toolkit makefile.gen (#34).')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
