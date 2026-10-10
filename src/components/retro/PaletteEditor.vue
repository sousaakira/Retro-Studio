<script setup>
import {ref,computed,watch,nextTick,onMounted,onBeforeUnmount} from 'vue'
import {validatePaletteConfiguration,paletteCost,paletteWords,paletteRuntimeCycles,paletteRuntimeFades,vdpChannels,vdpColor,vdpToHex,vdpToRgb,PALETTE_LIMITS} from '../../../shared/retro/paletteConfiguration.js'
import {paletteFromImage,assignmentConflicts,fitImageToPalette} from '../../../shared/retro/paletteImage.js'
import {composeVdp} from '../../../shared/retro/vdpCompose.js'
import {createPaletteRuntime} from '../../../shared/retro/paletteRuntime.js'
import {encodeIndexedPng} from '../../../shared/retro/indexedPng.js'
import {paletteDrafts} from '../../utils/retro/paletteDrafts.js'
import {draftTimer} from '../../utils/retro/durableDrafts.js'
import {useDocumentUndo} from '../../composables/useDocumentUndo.js'
const props=defineProps({projectPath:{type:String,required:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),config=ref(null),baseline=ref(''),status=ref(null),loading=ref(false),saving=ref(false),error=ref(''),saved=ref(false),notice=ref('')
const tab=ref('palettes'),selected=ref({palette:0,color:1}),picked=ref(''),chosen=ref('')
// Composição: escolhas desta sessão (não fazem parte do arquivo do projeto).
const scene=ref({b:'',a:'',sprite:'',spriteX:128,spriteY:96,spritePriority:false,paint:'a',showLayers:false,playing:false,region:'ntsc'})
const priorityA=ref(new Set()),priorityB=ref(new Set()),images=ref({}),previewCanvas=ref(null),beforeCanvas=ref(null),afterCanvas=ref(null)
const WIDTH=320,HEIGHT=224
let request=0,disposed=false,runtime=null,timer=0
const clone=value=>JSON.parse(JSON.stringify(value))
const blocked=computed(()=>loading.value||saving.value)
// #52: desfazer/refazer das paletas e rascunho que sobrevive a um fechamento inesperado.
const history=useDocumentUndo(config,{blocked:()=>blocked.value}),recoveredAt=ref(''),draftStale=ref(false),staleAccepted=ref(false)
let draftProject=''
function stashDraft(){
 if(!draftProject||!config.value||!status.value)return
 if(JSON.stringify(config.value)!==baseline.value)paletteDrafts.set(draftProject,{config:JSON.parse(JSON.stringify(config.value)),revision:status.value.revision})
 else paletteDrafts.delete(draftProject)
}
const draftSaver=draftTimer(()=>{if(!disposed&&!loading.value&&!saving.value)stashDraft()})
watch(()=>config.value?JSON.stringify(config.value):null,(now,before)=>{if(now&&before)draftSaver.touch()})
const dirty=computed(()=>!!config.value&&JSON.stringify(config.value)!==baseline.value)
// O validador e o serviço respondem em inglês (são compartilhados com o processo principal); a tela traduz.
const MESSAGES=[[/Invalid name of palette (\d)/,m=>'O nome da PAL'+m[1]+' está vazio, longo demais ou tem um caractere não aceito (aspas, barras, asterisco).'],
 [/Invalid colors of palette (\d)/,m=>'A PAL'+m[1]+' tem uma cor inválida.'],[/Invalid backdrop/,()=>'A cor de fundo é inválida.'],
 [/Invalid palette assignment/,()=>'Há uma imagem atribuída inválida ou repetida (só imagens PNG do projeto).'],
 [/Invalid or repeated palette effect name/,()=>'Nome de efeito inválido ou repetido: use letras minúsculas, números e _ (começando por letra), sem repetir entre ciclos e fades.'],
 [/Invalid palette cycle: (.*)\./,m=>'O ciclo “'+m[1]+'” não cabe na paleta: comece entre as cores 1 e 14, gire de 2 a 15 cores sem passar da cor 15 e use de 1 a 255 quadros por passo.'],
 [/Palette cycles overlap at color (\d+)/,m=>'Dois ciclos giram a mesma cor (PAL'+(m[1]>>4)+', cor '+(m[1]&15)+'). Cada cor pode pertencer a um ciclo só.'],
 [/Invalid palette fade: (.*)\./,m=>'O fade “'+m[1]+'” precisa de pelo menos uma paleta e de 1 a 255 quadros.'],
 [/Invalid palette (cycles|fades)/,m=>'Há '+(m[1]==='cycles'?'ciclos':'fades')+' demais.'],
 [/changed; reload before saving/,()=>'As paletas mudaram no disco depois que este editor as leu. Recarregue antes de exportar (as alterações feitas aqui serão descartadas).'],
 [/customized or unmanaged/,()=>'O header src/generated/palette_config.h foi alterado fora da IDE e foi preservado. Revise-o antes de exportar.'],
 [/belongs to another tool/,()=>'O arquivo palettes/palettes.json é de outra ferramenta e foi preservado.'],
 [/An export is active or requires recovery/,()=>'Outra exportação está em andamento ou precisa ser recuperada (Recursos → Uso dos recursos).'],
 [/Image exceeds 8 MiB/,()=>'A imagem passa de 8 MiB.'],[/Image not found/,()=>'A imagem não existe mais no projeto.']]
const translate=message=>{const text=String(message||'').replace(/^Error invoking remote method '[^']*': (?:Error: )?/,'');for(const [pattern,write] of MESSAGES){const match=text.match(pattern);if(match)return write(match)}return text}
const validation=computed(()=>{try{if(config.value)validatePaletteConfiguration(config.value);return ''}catch(e){return translate(e.message)}})
const cost=computed(()=>{try{return config.value&&!validation.value?paletteCost(config.value):null}catch{return null}})
const channels=computed(()=>config.value?vdpChannels(config.value.palettes[selected.value.palette].colors[selected.value.color]):[0,0,0])
const unassigned=computed(()=>(status.value?.images||[]).filter(file=>!config.value?.assignments.some(item=>item.resource===file)))
const LIMITATIONS={'four-palettes':'O console tem quatro paletas de 16 cores; não há como ter mais na tela ao mesmo tempo sem efeitos por linha.',
 'fifteen-colors-plus-transparent':'A cor 0 de cada paleta é a transparência dos desenhos: sobram 15 cores visíveis por paleta.',
 'one-transfer-per-frame':'As cores alteradas vão ao console em uma única faixa contínua por quadro, no intervalo vertical.',
 'fade-to-black-only':'Os fades vão do preto para a paleta e da paleta para o preto, a partir do brilho em que cada paleta está. Fade para branco ou entre duas paletas não é gerado. Um fade novo substitui o anterior: paletas que ele não cita ficam no brilho em que estavam.',
 'no-raster-effects':'Troca de cores no meio da tela (por linha) não é suportada.','no-shadow-highlight':'O modo sombra/realce do console não é usado nem simulado na prévia.',
 'not-with-sgdk-fades':'Não use os fades do próprio SGDK nas mesmas paletas (eles guardam uma cópia das cores e a escrevem por cima). Para trocar uma paleta, use retroPaletteSet em vez de PAL_setPalette.'}
const CONFLICTS={'too-many-colors':item=>'A imagem usa '+item.count+' cores; uma paleta comporta 15 mais a transparência.','colors-not-in-palette':item=>item.count+' cor(es) da imagem não estão na paleta ('+item.pixels+' pixels mudam).'}
const LAYERS=['cor de fundo','BG B','BG A','sprite','BG B · prioridade','BG A · prioridade','sprite · prioridade'],LAYER_COLORS=[0x000,0x840,0x084,0x08E,0xE80,0x0E8,0xE0E]
function apply(result){status.value=result;config.value=clone(result.config);baseline.value=JSON.stringify(result.config);runtime=null}
async function load(discard=false){
 if(saving.value)return
 if(!discard)stashDraft()
 const projectPath=props.projectPath,id=++request
 loading.value=true;error.value='';notice.value='';status.value=null;config.value=null;saved.value=false;images.value={}
 try{
  const result=await window.retroStudio?.retro?.paletteConfiguration?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.config)throw Error(result?.error||'Paletas indisponíveis.')
  if(discard)paletteDrafts.delete(projectPath);else if(paletteDrafts.needsHydration(projectPath)){await paletteDrafts.hydrate(projectPath);if(disposed||id!==request)return}
  apply(result);draftProject=projectPath
  const draft=paletteDrafts.get(projectPath)
  recoveredAt.value='';draftStale.value=false;staleAccepted.value=false
  if(draft?.config){try{validatePaletteConfiguration(draft.config);config.value=clone(draft.config);recoveredAt.value=paletteDrafts.recoveredAt(projectPath);draftStale.value=draft.revision!==result.revision}catch{paletteDrafts.delete(projectPath)}}
 }catch(e){if(!disposed&&id===request)error.value=translate(e.message)}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function save(){
 if(blocked.value||!config.value||validation.value||status.value?.headerConflict||status.value?.foreign||(draftStale.value&&!staleAccepted.value))return
 const projectPath=props.projectPath,id=request
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.savePaletteConfiguration?.({projectPath,config:clone(config.value),revision:status.value.revision})
  if(!result?.success)throw Error(result?.error||'Não foi possível exportar as paletas.')
  if(disposed||id!==request||projectPath!==props.projectPath)return
  paletteDrafts.delete(projectPath);recoveredAt.value='';draftStale.value=false
  apply(result);saved.value=true
 }catch(e){if(!disposed&&id===request)error.value=translate(e.message)}
 finally{if(!disposed){saving.value=false;if(id!==request)void load()}}
}
function close(discard=false){
 if(saving.value)return
 if(dirty.value&&!discard){error.value='Exporte as paletas ou use “Descartar e fechar”.';return}
 if(discard)paletteDrafts.delete(props.projectPath)
 emit('close')
}
function canClose(){return !dirty.value&&!saving.value}
defineExpose({canClose})
// Imagens do projeto: lidas uma vez para a memória. O arquivo nunca é alterado por este editor.
async function image(file){
 if(!file)return null
 if(images.value[file])return images.value[file]
 const projectPath=props.projectPath,id=request
 try{
  const result=await window.retroStudio?.retro?.paletteImage?.({projectPath,path:file})
  if(!result?.dataUrl)throw Error(result?.error||'Imagem indisponível.')
  const element=new Image();element.src=result.dataUrl;await element.decode()
  if(element.naturalWidth>1024||element.naturalHeight>1024)throw Error('Imagens de até 1024 × 1024 pixels podem ser inspecionadas aqui.')
  const canvas=document.createElement('canvas');canvas.width=element.naturalWidth;canvas.height=element.naturalHeight
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(element,0,0)
  const data={width:canvas.width,height:canvas.height,rgba:context.getImageData(0,0,canvas.width,canvas.height).data}
  if(disposed||id!==request)return null
  images.value={...images.value,[file]:data};return data
 }catch(e){if(!disposed&&id===request)error.value=file+': '+translate(e.message);return null}
}
// Encaixe de uma imagem em uma paleta: refeito só quando a imagem ou as 16 cores mudam.
const fits=new Map()
function fit(file,colors){
 const data=images.value[file];if(!data)return null
 const key=colors.join(','),cached=fits.get(file)
 if(cached&&cached.key===key&&cached.rgba===data.rgba)return cached.value
 const value=assignmentConflicts(data.rgba,colors);fits.set(file,{key,rgba:data.rgba,value});return value
}
const analysis=computed(()=>{
 const result={}
 for(const item of config.value?.assignments||[]){const found=fit(item.resource,config.value.palettes[item.palette].colors);if(found)result[item.resource]=found}
 return result
})
function setChannel(channel,value){
 const levels=[...channels.value];levels[channel]=Math.max(0,Math.min(7,Number(value)||0))
 config.value.palettes[selected.value.palette].colors[selected.value.color]=vdpColor(...levels)
}
async function fillFromImage(){
 const data=await image(picked.value);if(!data)return
 const made=paletteFromImage(data.rgba,config.value.palettes[selected.value.palette].colors[0])
 config.value.palettes[selected.value.palette].colors=made.colors
 notice.value=made.quantized?'A imagem tem '+made.sourceColors+' cores; as mais parecidas foram unidas até caber em 15. Confira o resultado em Recursos.':'Paleta preenchida com as '+made.sourceColors+' cores da imagem.'
}
function assign(){
 if(!picked.value||config.value.assignments.length>=PALETTE_LIMITS.assignments)return
 config.value.assignments.push({resource:picked.value,palette:selected.value.palette});chosen.value=picked.value;picked.value='';void image(chosen.value)
}
function unassign(resource){
 config.value.assignments=config.value.assignments.filter(item=>item.resource!==resource)
 if(chosen.value===resource)chosen.value=''
 for(const key of ['a','b','sprite'])if(scene.value[key]===resource)scene.value[key]=''
}
function draw(canvas,width,height,rgba){
 if(!canvas)return
 canvas.width=width;canvas.height=height
 canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0)
}
async function compare(){
 const item=config.value?.assignments.find(entry=>entry.resource===chosen.value);if(!item)return
 const data=await image(item.resource);if(!data)return
 await nextTick()
 draw(beforeCanvas.value,data.width,data.height,data.rgba)
 draw(afterCanvas.value,data.width,data.height,fit(item.resource,config.value.palettes[item.palette].colors).fit.after)
}
// Cópia indexada: arquivo novo ao lado do original, já com as cores da paleta escolhida.
async function saveIndexedCopy(){
 const item=config.value.assignments.find(entry=>entry.resource===chosen.value),data=item&&images.value[item.resource]
 if(!data||blocked.value)return
 const projectPath=props.projectPath,id=request
 try{
  const palette=config.value.palettes[item.palette].colors,fitted=fitImageToPalette(data.rgba,palette)
  const bytes=await encodeIndexedPng({width:data.width,height:data.height,indices:fitted.indices,palette})
  if(disposed||id!==request||projectPath!==props.projectPath)return
  // O nome leva a pasta de origem: res/a/x.png e res/b/x.png não disputam a mesma cópia.
  const name=item.resource.replace(/^res\//,'').replace(/\.png$/i,'').replace(/[^A-Za-z0-9_.-]+/g,'-')+'-pal'+item.palette+'.png'
  const result=await window.retroStudio?.retro?.copyAssetToProject?.(projectPath,name,Array.from(bytes))
  if(!result?.success)throw Error(result?.error||'Não foi possível salvar a cópia.')
  if(disposed||id!==request)return
  notice.value='Cópia indexada salva em '+String(result.assetPath).replace(/\\/g,'/')+'. O original '+item.resource+' não foi alterado. Para usar a cópia no jogo, declare-a em resources.res.'
 }catch(e){if(!disposed&&id===request)error.value=translate(e.message)}
}
// Prévia composta: mesma ordem de camadas do console e mesmo código de ciclos/fades do jogo.
function indexed(file){
 const item=config.value.assignments.find(entry=>entry.resource===file),data=item&&images.value[file]
 if(!data)return null
 return {width:data.width,height:data.height,palette:item.palette,indices:fit(file,config.value.palettes[item.palette].colors).fit.indices}
}
function plane(file,priority){
 const source=indexed(file);if(!source)return null
 // Recorte na área visível, em múltiplos de 8, para a prioridade valer por tile.
 const width=Math.min(WIDTH,source.width)&~7,height=Math.min(HEIGHT,source.height)&~7
 if(!width||!height)return null
 const indices=new Uint8Array(width*height),flags=new Uint8Array((width>>3)*(height>>3))
 for(let y=0;y<height;y++)indices.set(source.indices.subarray(y*source.width,y*source.width+width),y*width)
 for(const key of priority){const [tx,ty]=key.split(',').map(Number);if(tx<width>>3&&ty<height>>3)flags[ty*(width>>3)+tx]=1}
 return {width,height,indices,palette:source.palette,priority:flags}
}
function ensureRuntime(){
 if(!runtime&&config.value&&!validation.value){runtime=createPaletteRuntime(paletteWords(config.value),paletteRuntimeCycles(config.value));config.value.cycles.forEach((_,index)=>runtime.cycle(index,1))}
 return runtime
}
function render(){
 const canvas=previewCanvas.value;if(!canvas||!config.value)return
 const live=scene.value.playing?ensureRuntime():null,colors=live?live.state.colors:paletteWords(config.value)
 const sprite=indexed(scene.value.sprite)
 const result=composeVdp({width:WIDTH,height:HEIGHT,colors,backdrop:config.value.backdrop,layers:true,planes:{a:plane(scene.value.a,priorityA.value),b:plane(scene.value.b,priorityB.value)},
  sprites:sprite?[{x:Number(scene.value.spriteX)||0,y:Number(scene.value.spriteY)||0,width:sprite.width,height:sprite.height,indices:sprite.indices,palette:sprite.palette,priority:scene.value.spritePriority?1:0}]:[]})
 const rgba=new Uint8ClampedArray(WIDTH*HEIGHT*4)
 for(let i=0;i<WIDTH*HEIGHT;i++){const rgb=vdpToRgb(scene.value.showLayers?LAYER_COLORS[result.layers[i]]:result.pixels[i]);rgba[i*4]=rgb[0];rgba[i*4+1]=rgb[1];rgba[i*4+2]=rgb[2];rgba[i*4+3]=255}
 draw(canvas,WIDTH,HEIGHT,rgba)
}
const tile=ref({x:0,y:0})
function togglePriority(event){
 const canvas=previewCanvas.value,box=canvas.getBoundingClientRect()
 toggleTile(Math.floor((event.clientX-box.left)*WIDTH/box.width/8),Math.floor((event.clientY-box.top)*HEIGHT/box.height/8))
}
// Mesma ação sem mouse: tile escolhido pelos campos ou pelas setas com a prévia em foco.
function toggleTile(tx,ty){
 tx=Math.trunc(Number(tx));ty=Math.trunc(Number(ty))
 if(!(tx>=0&&ty>=0&&tx<WIDTH/8&&ty<HEIGHT/8))return
 tile.value={x:tx,y:ty}
 const target=scene.value.paint==='a'?priorityA:priorityB,next=new Set(target.value),key=tx+','+ty
 if(next.has(key))next.delete(key);else next.add(key)
 target.value=next
}
function onPreviewKey(event){
 const move={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key]
 if(move){event.preventDefault();tile.value={x:Math.max(0,Math.min(WIDTH/8-1,tile.value.x+move[0])),y:Math.max(0,Math.min(HEIGHT/8-1,tile.value.y+move[1]))}}
 else if(event.key===' '||event.key==='Enter'){event.preventDefault();toggleTile(tile.value.x,tile.value.y)}
}
function play(on){
 scene.value.playing=on;clearInterval(timer);timer=0;runtime=null
 if(on){
  // Quadros contados pelo relógio, não pelo número de disparos do temporizador: a velocidade
  // continua a do console mesmo quando o navegador atrasa ou agrupa os disparos.
  const rate=scene.value.region==='pal'?50:60,started=performance.now();let done=0
  timer=setInterval(()=>{
   const live=ensureRuntime();if(!live){play(false);return}
   const due=Math.floor((performance.now()-started)*rate/1000)
   for(let step=Math.min(due-done,rate*2);step>0;step--){live.tick();live.sent()}
   done=due;render()
  },1000/rate)
 }
 render()
}
function startFade(index){if(!scene.value.playing)play(true);ensureRuntime()?.fade(paletteRuntimeFades(config.value)[index])}
function freeName(prefix){const used=new Set([...config.value.cycles,...config.value.fades].map(item=>item.id));let number=1;while(used.has(prefix+number))number++;return prefix+number}
// O ciclo novo começa nas duas primeiras cores livres da paleta selecionada (ou de outra, se ela estiver cheia).
function addCycle(){
 const taken=new Set(config.value.cycles.flatMap(cycle=>Array.from({length:cycle.count},(_,i)=>cycle.palette*16+cycle.first+i)))
 for(const palette of [selected.value.palette,0,1,2,3])for(let first=1;first<15;first++)if(!taken.has(palette*16+first)&&!taken.has(palette*16+first+1)){config.value.cycles.push({id:freeName('ciclo'),palette,first,count:2,frames:8,direction:'forward'});return}
 notice.value='Não há duas cores vizinhas livres para um novo ciclo.'
}
function addFade(){config.value.fades.push({id:freeName('fade'),kind:'out',palettes:[0,1,2,3],frames:30})}
function toggleFadePalette(fade,index){fade.palettes=fade.palettes.includes(index)?fade.palettes.filter(value=>value!==index):[...fade.palettes,index].sort()}
watch(()=>props.projectPath,()=>{stashDraft();saving.value=false;play(false);void load()},{immediate:true})
watch([chosen,()=>config.value?.palettes,()=>config.value?.assignments],()=>{void compare()},{deep:true})
watch([tab,scene,priorityA,priorityB,images,()=>config.value],async()=>{
 if(tab.value!=='scene'||!config.value)return
 for(const key of ['a','b','sprite'])if(scene.value[key]&&!images.value[scene.value[key]])await image(scene.value[key])
 await nextTick();render()
},{deep:true})
watch(()=>scene.value.region,()=>{if(scene.value.playing)play(true)})
// Cores ou efeitos editados com a animação ligada: a prévia recomeça com a configuração nova.
watch(()=>JSON.stringify([config.value?.palettes,config.value?.cycles,config.value?.fades]),()=>{runtime=null})
watch(tab,value=>{notice.value='';if(value!=='scene')play(false);if(value==='resources')for(const item of config.value?.assignments||[])void image(item.resource)})
onMounted(()=>dialogElement.value?.showModal())
onBeforeUnmount(()=>{stashDraft();disposed=true;request++;clearInterval(timer);dialogElement.value?.close()})
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="palette-dialog" aria-labelledby="palette-title" @cancel.prevent="close()" @keydown="history.onKeydown">
   <header><div><small>MEGA DRIVE · CORES</small><h2 id="palette-title">Paletas e composição</h2></div><button type="button" :disabled="saving" autofocus @click="close()">Fechar</button></header>
   <nav class="tabs" aria-label="Seções do editor de paletas">
    <button v-for="[id,label] in [['palettes','Paletas'],['resources','Recursos'],['scene','Composição'],['effects','Ciclos e fades'],['compiled','No jogo compilado']]" :key="id" type="button" :aria-pressed="tab===id" @click="tab=id">{{ label }}</button>
   </nav>
   <div class="palette-body">
    <p v-if="loading" role="status" class="notice">Carregando paletas…</p>
    <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <p v-if="recoveredAt && dirty && !draftStale" role="status" class="notice">Alterações não exportadas de {{ recoveredAt }} foram recuperadas.</p>
    <p v-if="draftStale && dirty" role="alert" class="notice problem">Estas alterações não exportadas<span v-if="recoveredAt"> (de {{ recoveredAt }})</span> foram feitas sobre uma versão anterior do arquivo de paletas, que mudou no disco depois disso. Exportar agora substitui o que está no disco.
     <button v-if="!staleAccepted" type="button" @click="staleAccepted=true">Manter minhas alterações e permitir exportar</button><span v-else> Exportação liberada.</span> Para ficar com o que está no disco, use “Descartar e recarregar”.</p>
    <p v-if="status?.foreign" role="alert" class="notice problem">Existe um palettes/palettes.json de outra ferramenta neste projeto. Ele foi preservado e as paletas da IDE não podem ser exportadas aqui.</p>
    <template v-if="config">
     <section v-show="tab==='palettes'" aria-label="Paletas">
      <p class="help">O console mostra quatro paletas de 16 cores. Cada cor tem 8 níveis de vermelho, verde e azul (512 cores); as cores das imagens são convertidas como o SGDK converte ao compilar (os 3 bits mais altos de cada canal). A cor 0 de cada paleta é a transparência dos desenhos; a cor de fundo da tela é escolhida abaixo.</p>
      <div v-for="(palette,index) in config.palettes" :key="index" class="slot">
       <label><span class="visually-hidden">Nome da paleta {{ index }}</span><input v-model="palette.name" type="text" maxlength="24" :disabled="blocked" :aria-label="'Nome da paleta '+index" /></label><small>PAL{{ index }}</small>
       <div class="swatches" role="group" :aria-label="'Cores da paleta '+index">
        <button v-for="(color,position) in palette.colors" :key="position" type="button" class="swatch" :class="{transparent:position===0}" :style="{background:vdpToHex(color)}" :disabled="blocked"
         :aria-pressed="selected.palette===index&&selected.color===position" :aria-label="'PAL'+index+' cor '+position+(position===0?' (transparência)':'')+' '+vdpToHex(color)" :title="position===0?'Cor 0: transparência nos desenhos':'Cor '+position+' · '+vdpToHex(color)" @click="selected={palette:index,color:position}"></button>
       </div>
      </div>
      <fieldset :disabled="blocked"><legend>PAL{{ selected.palette }} · cor {{ selected.color }}<span v-if="selected.color===0"> · transparência nos desenhos</span></legend>
       <div class="mixer">
        <span class="big-swatch" :style="{background:vdpToHex(config.palettes[selected.palette].colors[selected.color])}"></span>
        <label v-for="(name,channel) in ['Vermelho','Verde','Azul']" :key="name">{{ name }} <input type="range" min="0" max="7" step="1" :value="channels[channel]" @input="setChannel(channel,$event.target.value)" /> <output>{{ channels[channel] }}</output></label>
       </div>
       <label class="field"><span>Cor de fundo da tela</span><select v-model.number="config.backdrop"><option v-for="index in 64" :key="index" :value="index-1">PAL{{ (index-1)>>4 }} · cor {{ (index-1)&15 }}</option></select></label>
      </fieldset>
      <fieldset :disabled="blocked"><legend>Preencher PAL{{ selected.palette }} a partir de uma imagem</legend>
       <div class="row"><select v-model="picked" aria-label="Imagem do projeto"><option value="">Escolha uma imagem do projeto…</option><option v-for="file in status.images" :key="file" :value="file">{{ file }}</option></select>
        <button type="button" :disabled="!picked" @click="fillFromImage">Usar as cores desta imagem</button></div>
       <p class="help">A imagem é apenas lida. Com mais de 15 cores, as mais parecidas são unidas; a imagem original não muda.</p>
      </fieldset>
     </section>
     <section v-show="tab==='resources'" aria-label="Recursos">
      <p class="help">Diga qual paleta cada imagem usa. A IDE compara as cores da imagem com a paleta e mostra o que mudaria no console.</p>
      <div class="row"><select v-model="picked" aria-label="Imagem a atribuir" :disabled="blocked"><option value="">Escolha uma imagem do projeto…</option><option v-for="file in unassigned" :key="file" :value="file">{{ file }}</option></select>
       <button type="button" :disabled="blocked||!picked" @click="assign">Atribuir à PAL{{ selected.palette }}</button></div>
      <p v-if="!config.assignments.length" class="notice">Nenhuma imagem atribuída ainda.</p>
      <table v-else><thead><tr><th scope="col">Imagem</th><th scope="col">Paleta</th><th scope="col">Situação</th><th scope="col"><span class="visually-hidden">Ações</span></th></tr></thead>
       <tbody><tr v-for="item in config.assignments" :key="item.resource" :class="{current:chosen===item.resource}">
        <th scope="row">{{ item.resource }}</th>
        <td><select v-model.number="item.palette" :disabled="blocked" :aria-label="'Paleta de '+item.resource"><option v-for="(palette,index) in config.palettes" :key="index" :value="index">PAL{{ index }} · {{ palette.name }}</option></select></td>
        <td><template v-if="analysis[item.resource]"><span v-if="!analysis[item.resource].conflicts.length">Sem conflito · {{ analysis[item.resource].sourceColors }} cores</span>
          <ul v-else class="conflicts"><li v-for="conflict in analysis[item.resource].conflicts" :key="conflict.code">{{ CONFLICTS[conflict.code](conflict) }}</li></ul></template><span v-else>Não lida</span></td>
        <td><button type="button" :disabled="blocked" @click="chosen=item.resource">Comparar</button> <button type="button" :disabled="blocked" @click="unassign(item.resource)">Remover</button></td>
       </tr></tbody></table>
      <div v-if="chosen" class="compare">
       <figure><canvas ref="beforeCanvas" class="pixel" aria-label="Imagem original"></canvas><figcaption>Antes · original</figcaption></figure>
       <figure><canvas ref="afterCanvas" class="pixel" aria-label="Imagem com a paleta atribuída"></canvas><figcaption>Depois · com a paleta atribuída</figcaption></figure>
       <div><p v-if="analysis[chosen]" class="help">{{ analysis[chosen].fit.changedPixels }} de {{ analysis[chosen].fit.opaquePixels }} pixels opacos mudam de cor<span v-if="analysis[chosen].fit.changedPixels"> (maior diferença: {{ analysis[chosen].fit.worstDistance }} níveis)</span>. Transparentes: {{ analysis[chosen].transparentPixels }}.</p>
        <button type="button" :disabled="blocked" @click="saveIndexedCopy">Salvar cópia indexada…</button><p class="help">Grava em res/ um PNG novo de 16 cores com esta paleta (índice 0 transparente). O original é preservado; para usar a cópia, declare-a em resources.res.</p></div>
      </div>
     </section>
     <section v-show="tab==='scene'" aria-label="Composição">
      <p class="help">Monte uma tela com as imagens atribuídas para ver como o console as empilha: fundo, BG B, BG A, sprites e, por cima, o que tiver prioridade. Nos planos a prioridade vale por tile de 8×8; clique na prévia para marcar.</p>
      <div class="scene">
       <div><canvas ref="previewCanvas" class="pixel preview" width="320" height="224" tabindex="0" role="img" :aria-label="'Prévia da composição, 320 por 224. Tile '+tile.x+', '+tile.y+' selecionado: setas movem, Espaço marca ou desmarca a prioridade.'" @click="togglePriority" @keydown="onPreviewKey"></canvas>
        <div class="row"><button type="button" :disabled="!!validation" @click="play(!scene.playing)">{{ scene.playing ? 'Parar ciclos' : 'Animar ciclos' }}</button>
         <label>Região <select v-model="scene.region"><option value="ntsc">NTSC · 60 quadros/s</option><option value="pal">PAL · 50 quadros/s</option></select></label>
         <button v-for="(fade,index) in config.fades" :key="fade.id" type="button" :disabled="!!validation" @click="startFade(index)">Fade {{ fade.id }}</button></div>
       </div>
       <fieldset><legend>Camadas</legend>
        <label v-for="[key,label] in [['b','BG B (atrás)'],['a','BG A'],['sprite','Sprite']]" :key="key" class="field"><span>{{ label }}</span><select v-model="scene[key]"><option value="">Nenhuma</option><option v-for="item in config.assignments" :key="item.resource" :value="item.resource">{{ item.resource }} · PAL{{ item.palette }}</option></select></label>
        <label class="field"><span>Sprite: posição X</span><input v-model.number="scene.spriteX" type="number" min="-64" max="320" /></label>
        <label class="field"><span>Sprite: posição Y</span><input v-model.number="scene.spriteY" type="number" min="-64" max="224" /></label>
        <label class="check"><input v-model="scene.spritePriority" type="checkbox" />Sprite com prioridade</label>
        <label class="field"><span>Clique na prévia marca prioridade em</span><select v-model="scene.paint"><option value="a">BG A</option><option value="b">BG B</option></select></label>
        <div class="row"><label>Tile X <input v-model.number="tile.x" type="number" min="0" max="39" class="short" /></label><label>Tile Y <input v-model.number="tile.y" type="number" min="0" max="27" class="short" /></label><button type="button" @click="toggleTile(tile.x,tile.y)">Alternar prioridade neste tile</button></div>
        <p class="help">Tiles com prioridade: BG A {{ priorityA.size }} · BG B {{ priorityB.size }}. <button type="button" @click="priorityA=new Set();priorityB=new Set()">Limpar</button></p>
        <label class="check"><input v-model="scene.showLayers" type="checkbox" />Mostrar qual camada venceu em cada pixel</label>
        <ul v-if="scene.showLayers" class="legend"><li v-for="(label,index) in LAYERS" :key="label"><span :style="{background:vdpToHex(LAYER_COLORS[index])}"></span>{{ label }}</li></ul>
        <p v-if="!config.assignments.length" class="notice">Atribua imagens às paletas na seção Recursos para usá-las aqui.</p>
        <p class="help">As escolhas desta prévia valem só enquanto o editor está aberto. Planos são recortados em 320×224; rolagem, janela e sombra/realce não são simulados.</p>
       </fieldset>
      </div>
     </section>
     <section v-show="tab==='effects'" aria-label="Ciclos e fades">
      <p class="help">Ciclos giram um trecho de uma paleta (água, lava, luzes). Fades escurecem ou acendem paletas inteiras. O jogo liga cada efeito pelo nome, usando o módulo <code>palette</code>.</p>
      <fieldset :disabled="blocked"><legend>Ciclos · {{ config.cycles.length }} de {{ PALETTE_LIMITS.cycles }}</legend>
       <div v-for="(cycle,index) in config.cycles" :key="index" class="effect">
        <label>Nome <input v-model="cycle.id" type="text" maxlength="24" /></label>
        <label>Paleta <select v-model.number="cycle.palette"><option v-for="n in 4" :key="n" :value="n-1">PAL{{ n-1 }}</option></select></label>
        <label>Primeira cor <input v-model.number="cycle.first" type="number" min="1" max="14" /></label>
        <label>Quantas <input v-model.number="cycle.count" type="number" min="2" max="15" /></label>
        <label>Quadros por passo <input v-model.number="cycle.frames" type="number" min="1" max="255" /></label>
        <label>Sentido <select v-model="cycle.direction"><option value="forward">Para a frente</option><option value="backward">Para trás</option></select></label>
        <button type="button" @click="config.cycles.splice(index,1)">Remover</button>
       </div>
       <button type="button" :disabled="config.cycles.length>=PALETTE_LIMITS.cycles" @click="addCycle">Adicionar ciclo</button>
      </fieldset>
      <fieldset :disabled="blocked"><legend>Fades · {{ config.fades.length }} de {{ PALETTE_LIMITS.fades }}</legend>
       <div v-for="(fade,index) in config.fades" :key="index" class="effect">
        <label>Nome <input v-model="fade.id" type="text" maxlength="24" /></label>
        <label>Tipo <select v-model="fade.kind"><option value="out">Para o preto</option><option value="in">Do preto</option></select></label>
        <span role="group" :aria-label="'Paletas do fade '+fade.id"><label v-for="n in 4" :key="n" class="inline"><input type="checkbox" :checked="fade.palettes.includes(n-1)" @change="toggleFadePalette(fade,n-1)" />PAL{{ n-1 }}</label></span>
        <label>Duração (quadros) <input v-model.number="fade.frames" type="number" min="1" max="255" /></label>
        <button type="button" @click="config.fades.splice(index,1)">Remover</button>
       </div>
       <button type="button" :disabled="config.fades.length>=PALETTE_LIMITS.fades" @click="addFade">Adicionar fade</button>
      </fieldset>
      <template v-if="cost">
       <h3>Custo estimado</h3>
       <p class="help">Calculado a partir desta configuração; não é uma medição na ROM. Memória: {{ cost.romBytes }} bytes de tabelas mais cerca de {{ (cost.codeBytes/1024).toFixed(1).replace('.', ',') }} KiB de código do módulo na ROM, e {{ cost.ramBytes }} bytes de RAM. Carga inicial: {{ cost.loadWords }} cores de uma vez. Pior quadro depois disso: {{ cost.worstFrameWords }} cores. Um fade custa {{ cost.fadeMultipliesPerPalette }} multiplicações por paleta por quadro; as 16 cores só são recompostas nos quadros em que algum nível visível muda.</p>
       <table v-if="cost.cycles.length||cost.fades.length"><thead><tr><th scope="col">Efeito</th><th scope="col">Cores por atualização</th><th scope="col">NTSC</th><th scope="col">PAL</th></tr></thead><tbody>
        <tr v-for="item in cost.cycles" :key="'c'+item.id"><th scope="row">Ciclo {{ item.id }}</th><td>{{ item.wordsPerStep }}</td><td>{{ item.stepsPerSecond.ntsc }} passos/s</td><td>{{ item.stepsPerSecond.pal }} passos/s</td></tr>
        <tr v-for="item in cost.fades" :key="'f'+item.id"><th scope="row">Fade {{ item.id }}</th><td>até {{ item.maxWordsPerFrame }}, em no máximo {{ item.visibleSteps }} níveis por cor</td><td>{{ item.seconds.ntsc }} s</td><td>{{ item.seconds.pal }} s</td></tr>
       </tbody></table>
       <h3>Limitações</h3><ul class="notes"><li v-for="code in cost.limitations" :key="code">{{ LIMITATIONS[code] }}</li></ul>
      </template>
     </section>
     <section v-show="tab==='compiled'" aria-label="No jogo compilado">
      <p class="help">Paletas lidas do jogo compilado no último build (arquivo ELF). São o que o rescomp realmente gravou para cada recurso, não uma estimativa.</p>
      <p v-if="status.compiled.error" role="alert" class="notice problem">{{ status.compiled.error }}</p>
      <p v-else-if="!status.compiled.built" class="notice">Ainda não há jogo compilado neste projeto. Faça um build para inspecionar as paletas dos recursos.</p>
      <template v-else>
       <p class="notice">{{ status.compiled.elf.path }} · {{ status.compiled.snapshot==='matches-recorded-files' ? 'os arquivos do projeto não mudaram desde o build registrado pela IDE' : status.compiled.snapshot==='changed-since-build' ? 'arquivos do projeto mudaram desde o build: as paletas abaixo podem estar desatualizadas' : 'sem registro de build da IDE: não se sabe se o jogo compilado corresponde aos arquivos atuais' }}.
        <span v-if="!status.compiled.abi"> O formato dos recursos deste SDK não foi confirmado no Relatório de hardware; sem isso as paletas não são lidas.</span></p>
       <p v-if="!status.compiled.resources.length" class="notice">Nenhum recurso com paleta foi lido do jogo compilado.</p>
       <table v-else><thead><tr><th scope="col">Recurso</th><th scope="col">Cores gravadas</th><th scope="col">Comparação</th></tr></thead><tbody>
        <tr v-for="item in status.compiled.resources" :key="item.symbol"><th scope="row">{{ item.symbol }}<br /><small>{{ item.kind }} · {{ item.origin }}</small></th>
         <td><span class="swatches small"><span v-for="(word,index) in item.words" :key="index" class="swatch" :style="{background:vdpToHex(word)}" :title="'Cor '+index+' · '+vdpToHex(word)"></span></span></td>
         <td>{{ item.palette===null ? 'Imagem sem paleta atribuída' : item.different ? item.different+' cor(es) diferentes da PAL'+item.palette+' configurada' : 'Igual à PAL'+item.palette+' configurada' }}</td></tr>
       </tbody></table>
      </template>
     </section>
     <p v-if="validation" role="alert" class="notice problem">{{ validation }}</p>
     <p v-if="status?.headerConflict" role="alert" class="notice problem">O header src/generated/palette_config.h foi alterado fora da IDE e será preservado. O build fica bloqueado até ele ser revisado; para voltar ao gerado, apague o arquivo e exporte de novo.</p>
     <p v-if="!status.runtimeInstalled" class="notice">O módulo <code>palette</code> do runtime ainda não está instalado neste projeto. Instale-o em Recursos → Runtime antes de usar o header no jogo.</p>
    </template>
   </div>
   <footer><div><small role="status">{{ saving ? 'Exportando…' : dirty ? 'Alterações não exportadas.' : saved ? 'Paletas exportadas. Faça um build para aplicar.' : 'palettes/palettes.json · src/generated/palette_config.h' }}</small></div><span class="history-buttons" role="group" aria-label="Histórico de edição"><button type="button" :disabled="blocked || !history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button><button type="button" :disabled="blocked || !history.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="history.redo()">Refazer</button></span><button type="button" :disabled="blocked" @click="load(true)">{{ dirty ? 'Descartar e recarregar' : 'Recarregar' }}</button><button v-if="dirty" type="button" :disabled="saving" @click="close(true)">Descartar e fechar</button><button type="button" class="primary" :disabled="blocked||!dirty&&status?.exported||!!validation||status?.headerConflict||status?.foreign||(draftStale&&!staleAccepted)" @click="save">Salvar e exportar paletas</button></footer>
  </dialog>
 </Teleport>
</template>
<style scoped>
.palette-dialog{box-sizing:border-box;width:min(980px,96vw);max-width:96vw;height:min(760px,94vh);max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.palette-dialog[open]{display:flex;flex-direction:column}.palette-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-shrink:0}header{justify-content:space-between;border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d);flex-wrap:wrap}footer div{flex:1;min-width:160px}
.tabs{display:flex;gap:4px;padding:8px 12px 0;flex-wrap:wrap;flex-shrink:0}.tabs button[aria-pressed="true"]{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
.palette-body{padding:14px;overflow:auto;min-height:0;flex:1}
h2{margin:3px 0;font-size:19px}h3{margin:14px 0 4px;font-size:13px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:6px 0;line-height:1.5}code{font-size:11px}
button,select,input[type="text"],input[type="number"]{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px}button{cursor:pointer}button:disabled,fieldset:disabled{opacity:.6;cursor:default}
.primary{border-color:var(--accent,#5bbda5)}:is(button,select,input):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
fieldset{min-width:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;margin:10px 0}
.slot{display:grid;grid-template-columns:150px 40px minmax(0,1fr);align-items:center;gap:8px;margin:6px 0}.slot input{width:100%}
.swatches{display:grid;grid-template-columns:repeat(16,minmax(0,1fr));gap:3px}.swatches.small{grid-template-columns:repeat(16,12px);gap:1px}
.swatch{aspect-ratio:1;min-width:0;padding:0;border:1px solid #0008;border-radius:2px}.swatches.small .swatch{display:block;height:12px}
.swatch[aria-pressed="true"]{outline:2px solid #fff;outline-offset:1px}.swatch.transparent{background-image:repeating-linear-gradient(45deg,#fff3 0 3px,#0000 3px 6px)!important}
.mixer{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.mixer label{display:flex;align-items:center;gap:6px}.big-swatch{width:44px;height:44px;border:1px solid #0008;border-radius:3px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0}.row select{flex:1;min-width:0}
.field{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:8px;margin:6px 0}.field :is(select,input){width:100%}.short{width:64px}
.check,.inline{display:flex;align-items:center;gap:6px;margin:6px 0}.inline{display:inline-flex;margin:0 8px 0 0}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{text-align:left;padding:6px;border-bottom:1px solid var(--border,#41464d);vertical-align:top;overflow-wrap:anywhere}th{font-weight:600}tr.current{background:#ffffff0d}
.conflicts,.notes{margin:0;padding-left:18px;line-height:1.5}.conflicts{color:#f0b3a3}.notes{color:var(--muted,#a7b2b9)}
.compare{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;margin:10px 0}.compare figure{margin:0}.compare canvas{display:block;max-width:300px;max-height:260px;min-width:192px;border:1px solid var(--border,#41464d);background:repeating-conic-gradient(#333 0 25%,#222 0 50%) 0 0/12px 12px}
.pixel{image-rendering:pixelated}.scene{display:grid;grid-template-columns:minmax(0,640px) minmax(220px,1fr);gap:12px;align-items:start}.preview{width:100%;height:auto;aspect-ratio:320/224;border:1px solid var(--border,#41464d);cursor:crosshair}
.effect{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin:8px 0;padding-bottom:8px;border-bottom:1px solid var(--border,#41464d)}.effect label{display:grid;gap:3px}.effect input[type="number"]{width:84px}.effect input[type="text"]{width:130px}
.legend{list-style:none;margin:4px 0;padding:0;display:grid;gap:3px}.legend span{display:inline-block;width:12px;height:12px;margin-right:6px;border:1px solid #0008;vertical-align:middle}
.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4;overflow-wrap:anywhere}.problem{border-color:#e38269;color:#f0b3a3}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media(max-width:760px){.scene{grid-template-columns:1fr}.slot{grid-template-columns:1fr 40px}.slot .swatches{grid-column:1/-1}.field{grid-template-columns:1fr}}
.history-buttons{display:inline-flex;gap:4px}
</style>
