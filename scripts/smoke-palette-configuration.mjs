// #57: formato das paletas, header gerado (compilado em C), custo, análise de imagem,
// composição com prioridade do VDP e serviço transacional do projeto.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createPaletteConfiguration,validatePaletteConfiguration,compilePaletteHeader,paletteCost,paletteWords,paletteRuntimeCycles,paletteRuntimeFades,vdpColor,vdpToRgb,rgbToVdp,vdpToHex} from '../shared/retro/paletteConfiguration.js'
import {imageColors,reduceColors,paletteFromImage,fitImageToPalette,assignmentConflicts} from '../shared/retro/paletteImage.js'
import {composeVdp} from '../shared/retro/vdpCompose.js'
import {createPaletteRuntime} from '../shared/retro/paletteRuntime.js'
import {paletteConfigurationStatus,savePaletteConfiguration,validatePaletteForBuild,readPaletteImage} from '../electron/retro/paletteConfiguration.js'
import {exportOverview} from '../electron/retro/exportOverview.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-palettes-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
const clone=value=>JSON.parse(JSON.stringify(value))
try{
 // Cores: 3 bits por canal, ida e volta sem perda.
 assert.equal(vdpColor(7,0,0),0x00E);assert.equal(vdpColor(0,7,0),0x0E0);assert.equal(vdpColor(0,0,7),0xE00)
 assert.deepEqual(vdpToRgb(0x0EEE),[252,252,252]);assert.equal(vdpToHex(0x02E),'#fc2400')
 for(let word=0;word<0x1000;word+=2)if(!(word&~0x0EEE))assert.equal(rgbToVdp(...vdpToRgb(word)),word)
 // Mesma conversão do rescomp do SGDK 1.81 (3 bits altos de cada canal, sem arredondar).
 assert.equal(rgbToVdp(255,255,255),0x0EEE);assert.equal(rgbToVdp(31,31,31),0);assert.equal(rgbToVdp(32,31,31),0x002)
 assert.equal(rgbToVdp(90,90,90),0x0444);assert.equal(rgbToVdp(127,127,127),0x0666);assert.equal(rgbToVdp(128,128,128),0x0888);assert.equal(rgbToVdp(-5,300,18),0x0E0)
 // Configuração padrão e validação.
 const base=createPaletteConfiguration();validatePaletteConfiguration(base)
 assert.equal(base.palettes.length,4);assert.ok(base.palettes.every(palette=>palette.colors.length===16&&palette.colors[0]===0))
 const config=clone(base)
 config.palettes[0]={name:'Cenário',colors:[0,0x00E,0x0E0,0xE00,0x0EE,0xE0E,0xEE0,0xEEE,0x222,0x444,0x666,0x888,0xAAA,0xCCC,0x246,0x642]}
 config.palettes[1].name='Herói';config.backdrop=3
 config.assignments=[{resource:'res/cenario.png',palette:0},{resource:'res/heroi.png',palette:1}]
 config.cycles=[{id:'agua',palette:0,first:1,count:3,frames:4,direction:'forward'},{id:'lava',palette:0,first:8,count:6,frames:2,direction:'backward'}]
 config.fades=[{id:'entrada',kind:'in',palettes:[0,1,2,3],frames:30},{id:'dano',kind:'out',palettes:[1],frames:8}]
 validatePaletteConfiguration(config)
 const bad=(change,pattern)=>{const copy=clone(config);change(copy);assert.throws(()=>validatePaletteConfiguration(copy),pattern)}
 bad(c=>c.palettes.pop(),/exactly four/);bad(c=>c.palettes[2].colors[5]=0x0111,/colors of palette 2/);bad(c=>c.palettes[2].colors.push(0),/colors of palette 2/)
 bad(c=>c.palettes[0].name='a"b',/name/);bad(c=>c.palettes[0].name='a/*b',/name/);bad(c=>c.assignments[0].resource='src/main.c',/assignment/);bad(c=>c.backdrop=64,/backdrop/)
 bad(c=>c.assignments[0].resource='../x.png',/assignment/);bad(c=>c.assignments[0].resource='/abs/x.png',/assignment/);bad(c=>c.assignments[1].resource='res/cenario.png',/assignment/);bad(c=>c.assignments[0].palette=4,/assignment/)
 bad(c=>c.cycles[0].first=0,/cycle: agua/);bad(c=>c.cycles[0].count=1,/cycle: agua/);bad(c=>{c.cycles[0].first=14;c.cycles[0].count=3},/cycle: agua/);bad(c=>c.cycles[0].frames=0,/cycle: agua/)
 bad(c=>c.cycles[1].first=3,/overlap at color 3/);bad(c=>c.cycles[1].id='agua',/repeated/);bad(c=>c.fades[0].id='agua',/repeated/);bad(c=>c.cycles[0].id='Água',/name/)
 bad(c=>c.fades[0].palettes=[],/fade: entrada/);bad(c=>c.fades[0].palettes=[1,1],/fade: entrada/);bad(c=>c.fades[0].frames=256,/fade: entrada/);bad(c=>c.fades[1].kind='flash',/fade: dano/)
 bad(c=>c.cycles=Array.from({length:9},(_,i)=>({id:'c'+i,palette:0,first:1,count:2,frames:1,direction:'forward'})),/cycles/)
 // Header: compila em C99 com o runtime real e reproduz a configuração.
 const header=compilePaletteHeader(config)
 assert.match(header,/#define RETRO_CYCLE_AGUA 0\n#define RETRO_CYCLE_LAVA 1/);assert.match(header,/#define RETRO_FADE_ENTRADA 0\n#define RETRO_FADE_DANO 1/)
 assert.match(header,/#define RETRO_PROJECT_BACKDROP 3/);assert.equal(compilePaletteHeader(clone(config)),header,'saída determinística')
 const empty=compilePaletteHeader(base)
 const game=path.join(temporary,'c');fs.mkdirSync(path.join(game,'generated'),{recursive:true});fs.mkdirSync(path.join(game,'retro_runtime'))
 for(const file of ['core/retro_core.h','palette/retro_palette.h','palette/retro_palette.c'])fs.copyFileSync(path.join(library,file),path.join(game,'retro_runtime',path.basename(file)))
 const compileAndRun=(text,program)=>{
  fs.writeFileSync(path.join(game,'generated','palette_config.h'),text);fs.writeFileSync(path.join(game,'main.c'),program)
  const built=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-pedantic','-fsanitize=address,undefined',path.join(game,'main.c'),path.join(game,'retro_runtime','retro_palette.c'),'-o',path.join(game,'test')],{encoding:'utf8'})
  assert.equal(built.status,0,built.stderr);const ran=spawnSync(path.join(game,'test'),[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr+ran.stdout);return ran.stdout
 }
 const program=`#include <stdio.h>\n#include "generated/palette_config.h"\nint main(void){RetroPalette p;unsigned i,f;int c;if(!retroPaletteInit(&p,retroProjectPalettes,retroProjectCycles,RETRO_PROJECT_CYCLE_COUNT))return 1;
 for(c=0;c<RETRO_PROJECT_CYCLE_COUNT;c++)retroPaletteCycleEnable(&p,(uint8_t)c,1);
 for(f=0;f<40;f++){if(f==5&&RETRO_PROJECT_FADE_COUNT)retroPaletteFadeStart(&p,&retroProjectFades[RETRO_PROJECT_FADE_COUNT-1]);retroPaletteTick(&p);retroPaletteSent(&p);for(i=0;i<64;i++)printf("%x ",p.colors[i]);printf("\\n");}
 printf("%d %d %d\\n",RETRO_PROJECT_BACKDROP,RETRO_PROJECT_CYCLE_COUNT,RETRO_PROJECT_FADE_COUNT);return 0;}`
 const lines=compileAndRun(header,program).trim().split('\n')
 assert.equal(lines.pop(),'3 2 2')
 // A prévia do editor (JS) mostra, quadro a quadro, o que a ROM gerada do mesmo arquivo mostraria.
 const runtime=createPaletteRuntime(paletteWords(config),paletteRuntimeCycles(config)),fades=paletteRuntimeFades(config)
 config.cycles.forEach((_,index)=>runtime.cycle(index,1))
 lines.forEach((line,frame)=>{if(frame===5)runtime.fade(fades[fades.length-1]);runtime.tick();runtime.sent();assert.equal(runtime.state.colors.map(color=>color.toString(16)).join(' '),line.trim(),'quadro '+frame)})
 assert.equal(compileAndRun(empty,program).trim().split('\n').pop(),'0 0 0','projeto sem ciclos nem fades também compila')
 // Custo: faixa contínua por quadro, passos por segundo nas duas regiões.
 const cost=paletteCost(config)
 assert.deepEqual(cost.cycles,[{id:'agua',wordsPerStep:3,stepsPerSecond:{ntsc:15,pal:12.5},loopFrames:12},{id:'lava',wordsPerStep:6,stepsPerSecond:{ntsc:30,pal:25},loopFrames:12}])
 assert.deepEqual(cost.fades,[{id:'entrada',maxWordsPerFrame:64,frames:30,visibleSteps:7,seconds:{ntsc:0.5,pal:0.6}},{id:'dano',maxWordsPerFrame:16,frames:8,visibleSteps:7,seconds:{ntsc:0.13,pal:0.16}}])
 assert.deepEqual([cost.worstFrameWords,cost.romBytes,cost.ramBytes,cost.codeBytes,cost.loadWords,cost.fadeMultipliesPerPalette],[64,128+8+6,326,4742,64,7]);assert.ok(cost.limitations.includes('fade-to-black-only'))
 const onlyCycles=clone(config);onlyCycles.fades=[];assert.equal(paletteCost(onlyCycles).worstFrameWords,13,'do índice 1 ao 13');assert.equal(paletteCost(base).worstFrameWords,0)
 // Imagem → cores do console, redução e encaixe em uma paleta.
 const pixel=(r,g,b,a=255)=>[r,g,b,a],image=list=>Uint8ClampedArray.from(list.flat())
 const sample=image([pixel(252,0,0),pixel(250,2,1),pixel(0,252,0),pixel(0,0,0,0),pixel(0,0,252),pixel(0,0,252)])
 assert.deepEqual(imageColors(sample),{colors:[{word:0x00E,pixels:2},{word:0xE00,pixels:2},{word:0x0E0,pixels:1}],transparent:1,pixels:6})
 const many=image(Array.from({length:40},(_,i)=>pixel((i%8)*36,((i>>3)%8)*36,0))),reduced=reduceColors(imageColors(many).colors,15)
 assert.equal(reduced.colors.length,15);assert.equal(reduced.mapping.size,40);assert.equal(reduced.colors.reduce((sum,color)=>sum+color.pixels,0),40)
 assert.deepEqual(reduceColors(imageColors(many).colors,15).colors,reduced.colors,'redução determinística')
 const made=paletteFromImage(many);assert.deepEqual([made.colors.length,made.colors[0],made.quantized,made.sourceColors],[16,0,true,40])
 assert.deepEqual([paletteFromImage(sample).quantized,paletteFromImage(sample).colors.slice(0,4)],[false,[0,0x00E,0xE00,0x0E0]])
 const before=Uint8ClampedArray.from(sample),fit=fitImageToPalette(sample,config.palettes[0].colors)
 assert.deepEqual(sample,before,'a imagem recebida não é alterada')
 assert.deepEqual([[...fit.indices],fit.exact,fit.changedPixels,fit.usedIndices,fit.opaquePixels],[[1,1,2,0,3,3],true,0,[1,2,3],5])
 assert.deepEqual([...fit.after.slice(0,4)],[252,0,0,255]);assert.deepEqual([...fit.after.slice(12,16)],[0,0,0,0],'transparente continua transparente')
 // Cor ausente da paleta vai para a mais próxima, nunca para o índice 0 (transparência).
 const black=image([pixel(0,0,0),pixel(36,0,0)]),toGray=fitImageToPalette(black,[0,0x0EEE,0x0222,0,0,0,0,0,0,0,0,0,0,0,0,0])
 assert.ok(!toGray.indices.includes(0));assert.equal(toGray.exact,false);assert.equal(toGray.missing.length,1)
 const conflict=assignmentConflicts(many,config.palettes[0].colors)
 assert.deepEqual(conflict.conflicts.map(item=>item.code),['too-many-colors','colors-not-in-palette']);assert.equal(conflict.sourceColors,40)
 assert.deepEqual(assignmentConflicts(sample,config.palettes[0].colors).conflicts,[])
 // Composição: ordem de camadas do VDP, prioridade por tile, transparência e mascaramento entre sprites.
 const colors=Array.from({length:64},(_,i)=>i*2&0x0EEE),solid=(w,h,index)=>new Uint8Array(w*h).fill(index)
 const scene=options=>composeVdp({width:16,height:8,colors,backdrop:63,layers:true,...options})
 const planeB={width:16,height:8,indices:solid(16,8,1),palette:0},planeA={width:16,height:8,indices:solid(16,8,2),palette:1}
 const sprite={x:0,y:0,width:16,height:8,indices:solid(16,8,3),palette:2,priority:0}
 const top=options=>{const result=scene(options);return [result.layers[0],result.layers[8]]}
 assert.deepEqual(top({}),[0,0]);assert.equal(scene({}).pixels[0],colors[63])
 assert.deepEqual(top({planes:{b:planeB}}),[1,1]);assert.deepEqual(top({planes:{a:planeA,b:planeB}}),[2,2]);assert.deepEqual(top({planes:{a:planeA,b:planeB},sprites:[sprite]}),[3,3])
 // Tile 0 de B com prioridade alta passa por cima de A baixo e do sprite baixo; o tile 1 não.
 assert.deepEqual(top({planes:{a:planeA,b:{...planeB,priority:Uint8Array.from([1,0])}},sprites:[sprite]}),[4,3])
 assert.deepEqual(top({planes:{a:{...planeA,priority:Uint8Array.from([0,1])},b:{...planeB,priority:Uint8Array.from([1,1])}},sprites:[sprite]}),[4,5])
 assert.deepEqual(top({planes:{a:{...planeA,priority:Uint8Array.from([1,1])},b:planeB},sprites:[{...sprite,priority:1}]}),[6,6])
 // Índice 0 é transparente em qualquer camada: aparece o que está atrás.
 const holes=solid(16,8,2);holes.fill(0,0,8)
 assert.deepEqual(top({planes:{a:{...planeA,indices:holes},b:planeB}}),[1,2])
 // Sprite de baixa prioridade que vem antes na lista esconde o de alta que vem depois, e o plano alto cobre os dois.
 const low={...sprite,priority:0,palette:2},high={...sprite,priority:1,palette:3}
 assert.deepEqual(top({sprites:[low,high]}),[3,3]);assert.deepEqual(top({sprites:[high,low]}),[6,6])
 assert.deepEqual(top({planes:{a:{...planeA,priority:Uint8Array.from([1,1])}},sprites:[low,high]}),[5,5])
 assert.equal(scene({planes:{a:planeA}}).pixels[0],colors[18]);assert.equal(scene({planes:{a:{...planeA,paletteByTile:Uint8Array.from([3,1])}}}).pixels[0],colors[50])
 assert.equal(scene({planes:{a:{...planeA,x:8}}}).layers[0],0,'plano deslocado não cobre o que ficou fora dele')
 // Serviço do projeto: opt-in, transação, conflito, arquivo de outra ferramenta e portão de build.
 const root=path.join(temporary,'game');fs.mkdirSync(path.join(root,'res','sprites'),{recursive:true})
 fs.writeFileSync(path.join(root,'retro-studio.json'),'{}');fs.writeFileSync(path.join(root,'res','cenario.png'),'PNG-A');fs.writeFileSync(path.join(root,'res','sprites','heroi.png'),'PNG-B');fs.writeFileSync(path.join(root,'res','notas.txt'),'x')
 assert.deepEqual(validatePaletteForBuild(root),{configured:false})
 let status=paletteConfigurationStatus(root)
 assert.deepEqual([status.saved,status.exported,status.foreign,status.headerConflict,status.runtimeInstalled,status.images],[false,false,false,false,false,['res/cenario.png','res/sprites/heroi.png']])
 assert.deepEqual(status.config,base);assert.equal(status.compiled.built,false)
 assert.ok(!fs.existsSync(path.join(root,'palettes')),'consultar não cria nada no projeto')
 assert.throws(()=>savePaletteConfiguration(root,{config,revision:'outra'}),/changed; reload/)
 assert.throws(()=>savePaletteConfiguration(root,{config:{...config,palettes:[]},revision:status.revision}),/four palettes/)
 status=savePaletteConfiguration(root,{config,revision:status.revision})
 assert.deepEqual([status.saved,status.exported],[true,true]);assert.equal(fs.readFileSync(path.join(root,'src/generated/palette_config.h'),'utf8'),header)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'palettes/palettes.json'),'utf8')),config)
 assert.deepEqual(validatePaletteForBuild(root),{configured:true,revision:status.revision})
 assert.equal(exportOverview(root).rows.find(row=>row.id==='palettes').state,'current')
 // Fonte editada sem exportar: build recusado com instrução; header mexido à mão: preservado.
 const edited=clone(config);edited.backdrop=5;fs.writeFileSync(path.join(root,'palettes/palettes.json'),JSON.stringify(edited))
 assert.throws(()=>validatePaletteForBuild(root),/As paletas mudaram/);assert.equal(exportOverview(root).rows.find(row=>row.id==='palettes').state,'stale')
 status=savePaletteConfiguration(root,{config:edited,revision:paletteConfigurationStatus(root).revision});validatePaletteForBuild(root)
 fs.appendFileSync(path.join(root,'src/generated/palette_config.h'),'/* meu ajuste */\n')
 assert.throws(()=>validatePaletteForBuild(root),/personalizado/);assert.equal(paletteConfigurationStatus(root).headerConflict,true)
 assert.throws(()=>savePaletteConfiguration(root,{config,revision:paletteConfigurationStatus(root).revision}),/customized or unmanaged/)
 assert.ok(fs.readFileSync(path.join(root,'src/generated/palette_config.h'),'utf8').endsWith('/* meu ajuste */\n'))
 // A NOSSA fonte danificada não vira "de outra ferramenta": o build para em vez de seguir com o header antigo.
 {const broken=path.join(temporary,'broken');fs.mkdirSync(broken);fs.writeFileSync(path.join(broken,'retro-studio.json'),'{}')
  savePaletteConfiguration(broken,{config,revision:paletteConfigurationStatus(broken).revision});validatePaletteForBuild(broken)
  fs.writeFileSync(path.join(broken,'palettes/palettes.json'),'{"format":"retro-studio.palettes",');assert.throws(()=>validatePaletteForBuild(broken),/ilegível/);assert.throws(()=>paletteConfigurationStatus(broken),/ilegível/)}
 // palettes/palettes.json de outra ferramenta: recurso fora de uso, arquivo intacto, build livre.
 const other=path.join(temporary,'other');fs.mkdirSync(path.join(other,'palettes'),{recursive:true});fs.writeFileSync(path.join(other,'palettes','palettes.json'),'{"minhas":"cores"}')
 assert.deepEqual(validatePaletteForBuild(other),{configured:false});assert.equal(paletteConfigurationStatus(other).foreign,true)
 assert.throws(()=>savePaletteConfiguration(other,{config,revision:paletteConfigurationStatus(other).revision}),/belongs to another tool/)
 assert.equal(fs.readFileSync(path.join(other,'palettes','palettes.json'),'utf8'),'{"minhas":"cores"}')
 // Leitura de imagem: só PNG do projeto, sem escapar da raiz, original intacto.
 assert.equal(readPaletteImage(root,'res/cenario.png').dataUrl,'data:image/png;base64,'+Buffer.from('PNG-A').toString('base64'))
 assert.throws(()=>readPaletteImage(root,'../other/x.png'));assert.throws(()=>readPaletteImage(root,'res/notas.txt'),/Only PNG/);assert.throws(()=>readPaletteImage(root,'res/ausente.png'),/not found/)
 fs.symlinkSync(path.join(temporary,'other','palettes','palettes.json'),path.join(root,'res','link.png'));assert.throws(()=>readPaletteImage(root,'res/link.png'))
 assert.equal(fs.readFileSync(path.join(root,'res','cenario.png'),'utf8'),'PNG-A')
 assert.ok(!paletteConfigurationStatus(root).images.includes('res/link.png'))
 // Com --sgdk <GDK>: projeto inicial + módulo instalado + header exportado → ROM real (SGDK 1.81).
 const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]}
 const sdk=argument('--sgdk')
 if(sdk){
  const {copyProjectTemplate,prepareNewProject}=await import('../electron/retro/starterProject.js'),{installNewProjectRuntime}=await import('../electron/retro/newProject.js'),{installCutsceneRuntime}=await import('../electron/retro/cutsceneRuntime.js')
  const repository=fileURLToPath(new URL('../',import.meta.url)),template=path.join(repository,'assets/toolkit/examples/sgdk-starter'),rom=path.join(temporary,'rom')
  fs.mkdirSync(rom);copyProjectTemplate(template,rom,(source,target)=>fs.cpSync(source,target,{recursive:true,filter:file=>!file.includes(path.sep+'out'+path.sep)&&!file.endsWith(path.sep+'out')}))
  installNewProjectRuntime(rom);installCutsceneRuntime(rom)
  const project=JSON.parse(fs.readFileSync(path.join(template,'retro-studio.json'),'utf8'))
  fs.writeFileSync(path.join(rom,'retro-studio.json'),JSON.stringify({name:'game',resourcePath:'res',assets:[],mapExport:project.mapExport,retroStudio:project.retroStudio},null,2))
  assert.equal((await prepareNewProject(rom)).complete,true)
  for(const name of ['retro_palette.h','retro_palette.c','retro_palette_sgdk.h'])assert.ok(fs.statSync(path.join(rom,'src/retro_runtime',name)).isFile(),'o instalador distribui '+name)
  assert.equal(paletteConfigurationStatus(rom).runtimeInstalled,true)
  const shown=clone(config);shown.backdrop=0
  shown.palettes[1]={name:'Fogo',colors:[0,0x002,0x004,0x006,0x008,0x00A,0x00C,0x00E,0x02E,0x04E,0x06E,0x08E,0x0AE,0x0CE,0x0EE,0x4EE]}
  shown.palettes[2]={name:'Mar',colors:[0,0x200,0x400,0x600,0x800,0xA00,0xC00,0xE00,0xE20,0xE40,0xE60,0xE80,0xEA0,0xEC0,0xEE0,0xEE4]}
  shown.palettes[3].colors[15]=0x0EEE
  shown.cycles=[{id:'agua',palette:0,first:1,count:7,frames:6,direction:'forward'},{id:'mar',palette:2,first:1,count:15,frames:3,direction:'backward'}]
  shown.fades=[{id:'saida',kind:'out',palettes:[0,1,2],frames:60},{id:'entrada',kind:'in',palettes:[0,1,2],frames:60}]
  savePaletteConfiguration(rom,{config:shown,revision:paletteConfigurationStatus(rom).revision});validatePaletteForBuild(rom)
  // Inspeção do jogo compilado: sem o formato dos recursos confirmado nada é lido (e a tela diz isso);
  // com ele, as paletas vêm do ELF real e são comparadas com a paleta atribuída à imagem de origem.
  const options={cwd:rom,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024}
  {const game=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],options);assert.equal(game.status,0,(game.stdout+game.stderr).slice(-5000))}
  let compiledNow=paletteConfigurationStatus(rom).compiled
  assert.deepEqual([compiledNow.built,compiledNow.abi,compiledNow.resources.length],[true,null,0]);assert.ok(compiledNow.pending>0)
  const projectFile=path.join(rom,'retro-studio.json'),projectNow=JSON.parse(fs.readFileSync(projectFile,'utf8'))
  fs.writeFileSync(projectFile,JSON.stringify({...projectNow,hardwareBudget:{resourceAbi:'sgdk-1.81'}},null,2))
  compiledNow=paletteConfigurationStatus(rom).compiled
  assert.ok(compiledNow.resources.length>0,'paletas lidas do ELF');const first=compiledNow.resources[0]
  assert.ok(first.words.length>=16&&first.words.every(word=>!(word&~0x0EEE))&&first.palette===null&&first.different===null)
  const matching=clone(shown);matching.palettes[3]={name:'Do jogo',colors:first.words.slice(0,16)};matching.assignments=[{resource:first.origin,palette:3}]
  savePaletteConfiguration(rom,{config:matching,revision:paletteConfigurationStatus(rom).revision})
  assert.deepEqual(paletteConfigurationStatus(rom).compiled.resources.filter(item=>item.origin===first.origin).map(item=>[item.palette,item.different]),[[3,0]])
  matching.palettes[3].colors[5]^=0x00E;savePaletteConfiguration(rom,{config:matching,revision:paletteConfigurationStatus(rom).revision})
  assert.deepEqual(paletteConfigurationStatus(rom).compiled.resources.find(item=>item.origin===first.origin).different,1)
  savePaletteConfiguration(rom,{config:shown,revision:paletteConfigurationStatus(rom).revision})
  console.log('PASS compiled palettes read from the real ELF: '+compiledNow.resources.map(item=>item.kind+' '+item.symbol+' ('+item.origin+')').join(', '))
  fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/palette-diagnostic.c'),path.join(rom,'src/main.c'))
  const made=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],options);assert.equal(made.status,0,(made.stdout+made.stderr).slice(-5000))
  const bytes=fs.readFileSync(path.join(rom,'out/rom.bin'));assert.ok(bytes.length>=131072)
  // As 64 cores exportadas estão na ROM, na ordem do header.
  const table=Buffer.alloc(128);shown.palettes.flatMap(palette=>palette.colors).forEach((word,index)=>table.writeUInt16BE(word,index*2));assert.ok(bytes.includes(table),'a tabela de paletas exportada está na ROM')
  if(argument('--keep-rom'))fs.writeFileSync(argument('--keep-rom'),bytes)
  console.log('PASS palette diagnostic ROM built with SGDK ('+bytes.length+' bytes)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Palette configuration: colors, validation, compiled header with C/JS frame parity, cost, image analysis, VDP priority composition, transactional service, build gate and confinement passed.')
