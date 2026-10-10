<script setup>
// #65: HUD, fonte, menus e caixa de diálogo do jogo. A prévia usa as mesmas regras do runtime
// (shared/retro/hudRuntime.js); o que não cabe no console aparece como problema, com a saída.
import {ref,computed,watch,nextTick,onMounted,onBeforeUnmount} from 'vue'
import {validateHudConfiguration,layoutHud,hudCost,HUD_ANCHORS,HUD_LIMITS,SGDK_FONT_MAP,glyphTable} from '../../../shared/retro/hudConfiguration.js'
import {renderHud} from '../../../shared/retro/hudRuntime.js'
import {fontFromImage,emptyGlyphs} from '../../../shared/retro/hudFont.js'
import {HUD_SAMPLE_FONT} from '../../../shared/retro/hudSampleFont.js'
import {vdpToRgb,vdpToHex,vdpChannels,vdpColor} from '../../../shared/retro/paletteConfiguration.js'
import {hudDrafts} from '../../utils/retro/hudDrafts.js'
import {draftTimer} from '../../utils/retro/durableDrafts.js'
import {useDocumentUndo} from '../../composables/useDocumentUndo.js'
const props=defineProps({projectPath:{type:String,required:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),config=ref(null),baseline=ref(''),status=ref(null),loading=ref(false),saving=ref(false),error=ref(''),saved=ref(false),notice=ref('')
const tab=ref('layout'),selected=ref(0),selectedMenu=ref(0),canvas=ref(null),fontCanvas=ref(null),fontInput=ref(null)
// Prévia: valores de exemplo e o que está aberto por cima. Não fazem parte do arquivo do projeto.
const sample=ref({}),overlay=ref('none'),menuItem=ref(0),showSafe=ref(true),zoom=ref(2)
let request=0,disposed=false
const clone=value=>JSON.parse(JSON.stringify(value))
const blocked=computed(()=>loading.value||saving.value)
const history=useDocumentUndo(config,{blocked:()=>blocked.value}),recoveredAt=ref(''),draftStale=ref(false),staleAccepted=ref(false)
let draftProject=''
function stashDraft(){
 if(!draftProject||!config.value||!status.value)return
 if(JSON.stringify(config.value)!==baseline.value)hudDrafts.set(draftProject,{config:clone(config.value),revision:status.value.revision})
 else hudDrafts.delete(draftProject)
}
const draftSaver=draftTimer(()=>{if(!disposed&&!loading.value&&!saving.value)stashDraft()})
watch(()=>config.value?JSON.stringify(config.value):null,(now,before)=>{if(now&&before)draftSaver.touch()})
const dirty=computed(()=>!!config.value&&JSON.stringify(config.value)!==baseline.value)
const clean=message=>String(message||'').replace(/^Error invoking remote method '[^']*': (?:Error: )?/,'')
const validation=computed(()=>{try{if(config.value)validateHudConfiguration(config.value);return ''}catch(e){return e.message}})
const layout=computed(()=>{try{return config.value&&!validation.value?layoutHud(config.value):null}catch{return null}})
const cost=computed(()=>{try{return config.value&&!validation.value?hudCost(config.value):null}catch{return null}})
const element=computed(()=>config.value?.elements[selected.value]||null),menu=computed(()=>config.value?.menus[selectedMenu.value]||null)
const custom=computed(()=>!!config.value?.font.glyphs.length)
const mapLength=computed(()=>config.value?Array.from(config.value.font.map).length:0)
const blankGlyphs=computed(()=>config.value&&custom.value?emptyGlyphs(config.value.font):[])
const TYPES={text:'Texto fixo',number:'Número',bar:'Barra',icons:'Ícones repetidos'}
const ANCHORS={'top-left':'Alto, esquerda','top':'Alto, centro','top-right':'Alto, direita','left':'Meio, esquerda','center':'Centro','right':'Meio, direita','bottom-left':'Embaixo, esquerda','bottom':'Embaixo, centro','bottom-right':'Embaixo, direita'}
const PLANES={window:'Janela (fixa na tela, por cima do plano A)','bg-a':'Plano A (rola com o cenário)','bg-b':'Plano B (rola com o cenário)'}
function apply(result){status.value=result;config.value=clone(result.config);baseline.value=JSON.stringify(result.config);selected.value=0;selectedMenu.value=0}
async function load(discard=false){
 if(saving.value)return
 if(!discard)stashDraft()
 const projectPath=props.projectPath,id=++request
 loading.value=true;error.value='';notice.value='';status.value=null;config.value=null;saved.value=false
 try{
  const result=await window.retroStudio?.retro?.hudConfiguration?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.config)throw Error(result?.error||'HUD indisponível.')
  if(discard)hudDrafts.delete(projectPath);else if(hudDrafts.needsHydration(projectPath)){await hudDrafts.hydrate(projectPath);if(disposed||id!==request)return}
  apply(result);draftProject=projectPath
  const draft=hudDrafts.get(projectPath)
  recoveredAt.value='';draftStale.value=false;staleAccepted.value=false
  if(draft?.config){try{validateHudConfiguration(draft.config);config.value=clone(draft.config);recoveredAt.value=hudDrafts.recoveredAt(projectPath);draftStale.value=draft.revision!==result.revision}catch{hudDrafts.delete(projectPath)}}
 }catch(e){if(!disposed&&id===request)error.value=clean(e.message)}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function save(){
 if(blocked.value||!config.value||validation.value||status.value?.conflicts.length||status.value?.foreign||(draftStale.value&&!staleAccepted.value))return
 const projectPath=props.projectPath,id=request
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.saveHudConfiguration?.({projectPath,config:clone(config.value),revision:status.value.revision})
  if(!result?.success)throw Error(result?.error||'Não foi possível exportar o HUD.')
  if(disposed||id!==request||projectPath!==props.projectPath)return
  hudDrafts.delete(projectPath);recoveredAt.value='';draftStale.value=false
  const keep=[selected.value,selectedMenu.value];apply(result);selected.value=Math.min(keep[0],Math.max(0,config.value.elements.length-1));selectedMenu.value=Math.min(keep[1],Math.max(0,config.value.menus.length-1));saved.value=true
 }catch(e){if(!disposed&&id===request)error.value=clean(e.message)}
 finally{if(!disposed){saving.value=false;if(id!==request)void load()}}
}
function close(discard=false){
 if(saving.value)return
 if(dirty.value&&!discard){error.value='Exporte o HUD ou use “Descartar e fechar”.';return}
 if(discard)hudDrafts.delete(props.projectPath)
 emit('close')
}
function canClose(){return !dirty.value&&!saving.value}
defineExpose({canClose})
// ---- Edição ---------------------------------------------------------------------------------
const unique=(prefix,list)=>{for(let i=1;;i++){const id=prefix+(i>1?'_'+i:'');if(!list.some(item=>item.id===id))return id}}
function addElement(type){
 const c=config.value;if(c.elements.length>=HUD_LIMITS.elements)return
 // O elemento novo nasce válido: ícones precisam de um valor pequeno (um ícone por unidade); sem um, cria-se um.
 let source=type==='icons'?c.values.filter(item=>item.max<=32).sort((x,y)=>x.max-y.max)[0]:c.values[0]
 if(type!=='text'&&!source){
  if(c.values.length>=HUD_LIMITS.values){notice.value='Não há valor do jogo que sirva para este elemento e o limite de valores foi atingido.';return}
  source={id:unique(type==='icons'?'vidas':'valor',c.values),max:type==='icons'?5:99};c.values.push(source)
 }
 const value=source?.id,table=glyphTable(c.font),pick=(...options)=>options.find(character=>table.has(character))||Array.from(c.font.map).find(character=>character!==' ')||' '
 const base={id:unique(type==='text'?'texto':type==='number'?'numero':type==='bar'?'barra':'icones',c.elements),type,anchor:'top-left',x:0,y:8*c.elements.length}
 c.elements.push(type==='text'?{...base,text:Array.from('TEXTO').every(character=>table.has(character))?'TEXTO':pick('A')}:type==='number'?{...base,value,digits:String(source.max).length,pad:pick('0',' ')}
  :type==='bar'?{...base,value,width:8,full:pick('#','*'),empty:pick('-','.')}:{...base,value,max:source.max,full:pick('*','#'),empty:pick('.','-')})
 selected.value=c.elements.length-1
}
function removeElement(){config.value.elements.splice(selected.value,1);selected.value=Math.max(0,selected.value-1)}
function addValue(){const c=config.value;if(c.values.length<HUD_LIMITS.values)c.values.push({id:unique('valor',c.values),max:99})}
function removeValue(index){
 const c=config.value,id=c.values[index].id
 if(c.elements.some(item=>item.value===id)){notice.value='O valor “'+id+'” está em uso por um elemento. Troque o valor do elemento antes de removê-lo.';return}
 c.values.splice(index,1)
}
function renameValue(index,next){
 const c=config.value,before=c.values[index].id
 if(next===before)return
 if(c.values.some(item=>item.id===next)){notice.value='Já existe um valor chamado “'+next+'”. Escolha outro nome.';return}
 c.values[index].id=next;for(const item of c.elements)if(item.value===before)item.value=next
}
function addMenu(){const c=config.value;if(c.menus.length>=HUD_LIMITS.menus)return;const table=glyphTable(c.font);c.menus.push({id:unique('menu',c.menus),anchor:'center',x:0,y:0,title:'',cursor:table.has('>')?'>':Array.from(c.font.map).find(character=>character!==' ')||' ',items:[{id:'item',text:table.has('A')?'A':Array.from(c.font.map).find(character=>character!==' ')||' '}]});selectedMenu.value=c.menus.length-1;overlay.value='menu'}
function removeMenu(){config.value.menus.splice(selectedMenu.value,1);selectedMenu.value=Math.max(0,selectedMenu.value-1);if(!config.value.menus.length&&overlay.value==='menu')overlay.value='none'}
function addItem(){if(menu.value.items.length<HUD_LIMITS.items)menu.value.items.push({id:unique('item',menu.value.items),text:menu.value.items[0]?.text||'A'})}
// ---- Fonte ----------------------------------------------------------------------------------
function useSgdkFont(){
 const c=config.value
 if(c.elements.some(item=>item.sprite)){notice.value='Há elementos em sprites: eles precisam de uma fonte importada. Tire a opção de sprite desses elementos antes de voltar à fonte do SGDK.';return}
 c.font={name:'',glyphs:[],map:SGDK_FONT_MAP,colors:[0,c.font.colors[1]||0x0EEE,0,0,0,0,0,0,0,0,0,0,0,0,0,0]};notice.value='Fonte padrão do SGDK: só ASCII, sem acentos.'
}
function useSampleFont(){config.value.font={name:HUD_SAMPLE_FONT.name,map:HUD_SAMPLE_FONT.map,glyphs:[...HUD_SAMPLE_FONT.glyphs],colors:[...HUD_SAMPLE_FONT.colors]};notice.value='Fonte de exemplo com acentos carregada (96 glifos). Textos com caracteres fora do mapa aparecem como problema.'}
async function importFont(event){
 const file=event.target.files?.[0];event.target.value=''
 if(!file)return
 notice.value='';error.value=''
 try{
  if(file.size>2*1024*1024)throw Error('A imagem da fonte passa de 2 MiB.')
  const bitmap=await createImageBitmap(file)
  if(bitmap.width>512||bitmap.height>512)throw Error(`A imagem da fonte tem ${bitmap.width} × ${bitmap.height} px; o máximo é 512 × 512.`)
  const surface=document.createElement('canvas');surface.width=bitmap.width;surface.height=bitmap.height
  const context=surface.getContext('2d');context.drawImage(bitmap,0,0)
  const font=fontFromImage(context.getImageData(0,0,bitmap.width,bitmap.height).data,bitmap.width,bitmap.height)
  if(disposed)return
  config.value.font={name:file.name.slice(0,64),glyphs:font.glyphs,map:font.map,colors:font.colors}
  notice.value=`${font.glyphs.length} glifos lidos de ${file.name} (${font.columns} por linha${font.dropped?', '+font.dropped+' células vazias no fim descartadas':''}${font.backgroundAssumed?'; a imagem não tem transparência, então a cor do canto de cima à esquerda foi tratada como fundo':''}). O mapa começou na ordem ASCII: confira se cada caractere corresponde ao desenho e corrija o que for diferente.`
 }catch(e){error.value=clean(e.message)}
}
const channels=index=>vdpChannels(config.value.font.colors[index])
function setChannel(index,channel,level){const next=channels(index);next[channel]=Math.max(0,Math.min(7,Number(level)||0));config.value.font.colors[index]=vdpColor(...next)}
const usedColors=computed(()=>{const used=new Set();for(const glyph of config.value?.font.glyphs||[])for(const pixel of glyph)if(pixel!=='0')used.add(parseInt(pixel,16));return [...used].sort((a,b)=>a-b)})
// ---- Prévia ---------------------------------------------------------------------------------
const state=computed(()=>{
 const c=config.value,values={};if(!c)return {}
 for(const item of c.values)values[item.id]=sample.value[item.id]??Math.min(item.max,Math.round(item.max*0.6))
 const view={values}
 if(overlay.value==='menu'&&menu.value)view.menu={id:menu.value.id,item:Math.min(menuItem.value,menu.value.items.length-1)}
 else if(overlay.value==='dialogue'&&c.dialogue.enabled)view.dialogue={speaker:'Guardião',lines:['Olá! A ponte está fechada.','Volte amanhã de manhã.','Não diga que não avisei.','Quarta linha de exemplo.']}
 else if(overlay.value==='choice'&&c.dialogue.enabled)view.choice={prompt:'Abrir a porta?',options:['Sim','Não','Talvez','Depois'],selected:1}
 return view
})
function paint(){
 const target=canvas.value,c=config.value
 if(!target||!c||validation.value)return
 const view=renderHud(c,state.value,{vdpToRgb}),context=target.getContext('2d')
 target.width=view.width;target.height=view.height
 // Fundo: um "jogo" quadriculado, para ver o que o HUD cobre e o que deixa passar.
 for(let y=0;y<view.height;y+=16)for(let x=0;x<view.width;x+=16){context.fillStyle=(x+y)%32?'#2b3a55':'#243049';context.fillRect(x,y,16,16)}
 if(view.layout.window){
  const band=view.band
  if(band){context.fillStyle='#00000066';context.fillRect(0,band.edge==='top'?0:view.height-band.rows*8,view.width,band.rows*8)}
 }
 const image=new ImageData(view.rgba,view.width,view.height),layer=document.createElement('canvas');layer.width=view.width;layer.height=view.height;layer.getContext('2d').putImageData(image,0,0);context.drawImage(layer,0,0)
 if(showSafe.value){context.strokeStyle='#ffd24a';context.setLineDash([4,3]);context.strokeRect(c.safe.left+.5,c.safe.top+.5,view.width-c.safe.left-c.safe.right-1,view.height-c.safe.top-c.safe.bottom-1);context.setLineDash([])}
 const place=view.layout.elements[selected.value]
 if(tab.value==='layout'&&place){context.strokeStyle='#5bbda5';context.strokeRect((place.sprite?place.x:place.col*8)+.5,(place.sprite?place.y:place.row*8)+.5,place.width*8-1,7)}
}
function paintFont(){
 const target=fontCanvas.value,c=config.value
 if(!target||!c||!custom.value)return
 const count=c.font.glyphs.length,rows=Math.ceil(count/16);target.width=128;target.height=rows*8
 const context=target.getContext('2d'),image=context.createImageData(128,rows*8)
 c.font.glyphs.forEach((glyph,index)=>{for(let y=0;y<8;y++)for(let x=0;x<8;x++){const pixel=parseInt(glyph[y*8+x],16);if(!pixel)continue;const at=(((index>>4)*8+y)*128+(index&15)*8+x)*4,[r,g,b]=vdpToRgb(c.font.colors[pixel]);image.data[at]=r;image.data[at+1]=g;image.data[at+2]=b;image.data[at+3]=255}})
 context.putImageData(image,0,0)
}
watch(()=>[JSON.stringify(config.value),JSON.stringify(state.value),showSafe.value,selected.value,tab.value],()=>nextTick(()=>{paint();paintFont()}))
watch(overlay,()=>{menuItem.value=0})
watch(()=>props.projectPath,()=>void load(),{immediate:true})
onMounted(()=>dialogElement.value?.showModal())
onBeforeUnmount(()=>{stashDraft();disposed=true;request++;dialogElement.value?.close()})
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="hud-dialog" aria-labelledby="hud-title" @cancel.prevent="close()" @keydown="history.onKeydown">
   <header><div><small>MEGA DRIVE · INTERFACE DO JOGO</small><h2 id="hud-title">HUD e textos</h2></div><button type="button" :disabled="saving" autofocus @click="close()">Fechar</button></header>
   <nav class="tabs" aria-label="Seções do editor de HUD">
    <button v-for="[id,label] in [['layout','Layout'],['font','Fonte'],['menus','Menus'],['dialogue','Diálogo'],['values','Valores do jogo'],['game','No jogo']]" :key="id" type="button" :aria-pressed="tab===id" @click="tab=id;notice=''">{{ label }}</button>
   </nav>
   <div class="hud-body">
    <p v-if="loading" role="status">Carregando o HUD…</p>
    <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <template v-if="config&&status">
     <p v-if="status.foreign" role="alert" class="notice problem">O arquivo hud/hud.json deste projeto é de outra ferramenta. Ele foi preservado e o HUD não pode ser exportado por aqui.</p>
     <p v-if="recoveredAt" role="status" class="notice">Alterações não exportadas de {{ recoveredAt }} foram recuperadas.<template v-if="draftStale"> O HUD mudou no disco depois delas: <label class="inline"><input v-model="staleAccepted" type="checkbox"> exportar mesmo assim, por cima do que está no disco</label></template></p>
     <div class="split">
      <div class="side">
       <!-- ---- Layout ---- -->
       <section v-show="tab==='layout'" aria-labelledby="hud-layout">
        <h3 id="hud-layout">Tela e área segura</h3>
        <p class="help">Posições em pixels a partir da âncora, dentro da área segura (a margem que TVs antigas podem cortar). Texto em plano cai em múltiplos de 8 px; elementos em sprites ficam em qualquer pixel.</p>
        <div class="field"><label for="hud-plane">Onde o HUD é desenhado</label><select id="hud-plane" v-model="config.plane"><option v-for="(label,id) in PLANES" :key="id" :value="id">{{ label }}</option></select></div>
        <div class="field"><label for="hud-width">Tela do jogo</label><span><select id="hud-width" v-model.number="config.screen.width" aria-label="Largura da tela"><option :value="320">320 px (H40)</option><option :value="256">256 px (H32)</option></select> <select v-model.number="config.screen.height" aria-label="Altura da tela"><option :value="224">224 linhas</option><option :value="240">240 linhas (PAL)</option></select></span></div>
        <fieldset><legend>Área segura (px)</legend>
         <label v-for="[side,label] in [['left','Esquerda'],['top','Alto'],['right','Direita'],['bottom','Embaixo']]" :key="side" class="inline">{{ label }} <input v-model.number="config.safe[side]" type="number" min="0" max="64" step="8" class="short"></label>
        </fieldset>
        <div class="field"><label for="hud-palette">Paleta do texto</label><select id="hud-palette" v-model.number="config.palette"><option v-for="index in 4" :key="index" :value="index-1">PAL{{ index-1 }}</option></select></div>
        <label class="check"><input v-model="config.priority" type="checkbox"> Por cima dos sprites do jogo (prioridade)</label>
        <h3>Elementos</h3>
        <div class="row"><button v-for="(label,type) in TYPES" :key="type" type="button" :disabled="config.elements.length>=HUD_LIMITS.elements" @click="addElement(type)">+ {{ label }}</button></div>
        <ul class="list" aria-label="Elementos do HUD">
         <li v-for="(item,index) in config.elements" :key="index"><button type="button" :aria-pressed="selected===index" @click="selected=index">{{ item.id }} <small>{{ TYPES[item.type] }}{{ item.sprite ? ' · sprites' : '' }}</small></button></li>
        </ul>
        <p v-if="!config.elements.length" class="help">Nenhum elemento. Acrescente um texto, número, barra ou ícones.</p>
        <fieldset v-if="element"><legend>{{ TYPES[element.type] }}</legend>
         <div class="field"><label for="hud-el-id">Nome (só neste editor)</label><input id="hud-el-id" v-model.trim="element.id" type="text" maxlength="24" spellcheck="false"></div>
         <div class="field"><label for="hud-el-anchor">Âncora</label><select id="hud-el-anchor" v-model="element.anchor"><option v-for="anchor in HUD_ANCHORS" :key="anchor" :value="anchor">{{ ANCHORS[anchor] }}</option></select></div>
         <div class="field"><label for="hud-el-x">Deslocamento X, Y (px)</label><span><input id="hud-el-x" v-model.number="element.x" type="number" :step="element.sprite?1:8" class="short"> <input v-model.number="element.y" type="number" :step="element.sprite?1:8" class="short" aria-label="Deslocamento Y"></span></div>
         <div v-if="element.type==='text'" class="field"><label for="hud-el-text">Texto</label><input id="hud-el-text" v-model="element.text" type="text" :maxlength="HUD_LIMITS.text"></div>
         <template v-else>
          <div class="field"><label for="hud-el-value">Valor do jogo</label><select id="hud-el-value" v-model="element.value"><option v-for="item in config.values" :key="item.id" :value="item.id">{{ item.id }} (até {{ item.max }})</option></select></div>
          <template v-if="element.type==='number'">
           <div class="field"><label for="hud-el-digits">Dígitos</label><input id="hud-el-digits" v-model.number="element.digits" type="number" min="1" max="8" class="short"></div>
           <div class="field"><label for="hud-el-pad">Preenchimento à esquerda</label><input id="hud-el-pad" v-model="element.pad" type="text" maxlength="2" class="short"></div>
          </template>
          <template v-else>
           <div class="field"><label for="hud-el-size">{{ element.type==='bar' ? 'Largura (caracteres)' : 'Quantidade máxima' }}</label><input v-if="element.type==='bar'" id="hud-el-size" v-model.number="element.width" type="number" min="1" max="32" class="short"><input v-else id="hud-el-size" v-model.number="element.max" type="number" min="1" max="32" class="short"></div>
           <div class="field"><label for="hud-el-full">Caractere cheio / vazio</label><span><input id="hud-el-full" v-model="element.full" type="text" maxlength="2" class="short"> <input v-model="element.empty" type="text" maxlength="2" class="short" aria-label="Caractere vazio"></span></div>
          </template>
          <label class="check"><input :checked="!!element.sprite" type="checkbox" :disabled="!custom" @change="element.sprite=$event.target.checked"> Desenhar com sprites (posição livre; cada caractere é um sprite)</label>
          <p v-if="!custom" class="help">Sprites precisam de uma fonte importada (aba Fonte).</p>
         </template>
         <button type="button" @click="removeElement">Remover elemento</button>
        </fieldset>
       </section>
       <!-- ---- Fonte ---- -->
       <section v-show="tab==='font'" aria-labelledby="hud-font">
        <h3 id="hud-font">Fonte</h3>
        <p class="help">Uma imagem PNG com os glifos em grade de 8 × 8 px, fundo transparente, até {{ HUD_LIMITS.glyphs }} glifos e 15 cores. Ela ocupa o lugar da fonte do SGDK na memória de vídeo: não custa tiles a mais. Os glifos ficam guardados em hud/hud.json.</p>
        <div class="row">
         <input ref="fontInput" class="visually-hidden" type="file" accept="image/png,.png" aria-label="Imagem da fonte" @change="importFont">
         <button type="button" @click="fontInput?.click()">Importar imagem de fonte…</button>
         <button type="button" @click="useSampleFont">Usar a fonte de exemplo com acentos</button>
         <button type="button" :disabled="!custom" @click="useSgdkFont">Voltar à fonte do SGDK</button>
        </div>
        <p class="notice">{{ custom ? `Fonte importada: ${config.font.name||'sem nome'} · ${config.font.glyphs.length} glifos.` : 'Fonte padrão do SGDK (ASCII, sem acentos). A prévia marca as células ocupadas, sem desenhar as letras.' }}</p>
        <template v-if="custom">
         <canvas ref="fontCanvas" class="pixel font-sheet" role="img" aria-label="Glifos da fonte, 16 por linha"></canvas>
         <div class="field wide"><label for="hud-map">Mapa de caracteres: um caractere por glifo, na ordem da imagem ({{ mapLength }} de {{ config.font.glyphs.length }})</label><textarea id="hud-map" v-model="config.font.map" rows="3" spellcheck="false" autocomplete="off"></textarea></div>
         <p v-if="blankGlyphs.length" class="notice problem">Estes caracteres do mapa apontam para glifos sem nenhum pixel — o mapa pode estar desalinhado com a imagem: {{ blankGlyphs.join(' ') }}</p>
         <fieldset><legend>Cores da fonte</legend>
          <div v-for="index in usedColors" :key="index" class="mixer"><span class="big-swatch" :style="{background:vdpToHex(config.font.colors[index])}"></span><span>Cor {{ index }}</span>
           <label v-for="[channel,label] in [[0,'R'],[1,'G'],[2,'B']]" :key="channel">{{ label }} <input type="number" min="0" max="7" class="short" :value="channels(index)[channel]" :aria-label="'Cor '+index+' canal '+label" @change="setChannel(index,channel,$event.target.value)"></label></div>
          <p class="help">Níveis de 0 a 7 por canal (as cores do console). Ao iniciar, o HUD carrega estas 16 cores na paleta escolhida.</p>
         </fieldset>
        </template>
        <div v-else class="field"><label for="hud-color">Cor do texto</label><span class="mixer"><span class="big-swatch" :style="{background:vdpToHex(config.font.colors[1])}"></span>
         <label v-for="[channel,label] in [[0,'R'],[1,'G'],[2,'B']]" :key="channel">{{ label }} <input :id="channel===0?'hud-color':undefined" type="number" min="0" max="7" class="short" :value="channels(1)[channel]" @change="setChannel(1,channel,$event.target.value)"></label></span></div>
       </section>
       <!-- ---- Menus ---- -->
       <section v-show="tab==='menus'" aria-labelledby="hud-menus">
        <h3 id="hud-menus">Menus</h3>
        <p class="help">Listas com cursor (pausa, opções, confirmação). O jogo abre e fecha o menu e recebe o item escolhido; um menu por vez.</p>
        <div class="row"><button type="button" :disabled="config.menus.length>=HUD_LIMITS.menus" @click="addMenu">+ Menu</button></div>
        <ul class="list" aria-label="Menus"><li v-for="(item,index) in config.menus" :key="index"><button type="button" :aria-pressed="selectedMenu===index" @click="selectedMenu=index;overlay='menu'">{{ item.id }} <small>{{ item.items.length }} item(ns)</small></button></li></ul>
        <fieldset v-if="menu"><legend>Menu</legend>
         <div class="field"><label for="hud-menu-id">Nome (só no código)</label><input id="hud-menu-id" v-model.trim="menu.id" type="text" maxlength="24" spellcheck="false"></div>
         <div class="field"><label for="hud-menu-title">Título (opcional)</label><input id="hud-menu-title" v-model="menu.title" type="text" :maxlength="HUD_LIMITS.text"></div>
         <div class="field"><label for="hud-menu-anchor">Âncora</label><select id="hud-menu-anchor" v-model="menu.anchor"><option v-for="anchor in HUD_ANCHORS" :key="anchor" :value="anchor">{{ ANCHORS[anchor] }}</option></select></div>
         <div class="field"><label for="hud-menu-x">Deslocamento X, Y (px)</label><span><input id="hud-menu-x" v-model.number="menu.x" type="number" step="8" class="short"> <input v-model.number="menu.y" type="number" step="8" class="short" aria-label="Deslocamento Y do menu"></span></div>
         <div class="field"><label for="hud-menu-cursor">Cursor</label><input id="hud-menu-cursor" v-model="menu.cursor" type="text" maxlength="2" class="short"></div>
         <div v-for="(item,index) in menu.items" :key="index" class="row"><input v-model.trim="item.id" type="text" maxlength="24" spellcheck="false" class="narrow" :aria-label="'Nome do item '+(index+1)+' (só no código)'"><input v-model="item.text" type="text" :maxlength="HUD_LIMITS.text-2" :aria-label="'Texto do item '+(index+1)"><button type="button" :disabled="menu.items.length<2" :aria-label="'Remover item '+(index+1)" @click="menu.items.splice(index,1)">×</button></div>
         <div class="row"><button type="button" :disabled="menu.items.length>=HUD_LIMITS.items" @click="addItem">+ Item</button><button type="button" @click="removeMenu">Remover menu</button></div>
        </fieldset>
       </section>
       <!-- ---- Diálogo ---- -->
       <section v-show="tab==='dialogue'" aria-labelledby="hud-dialogue">
        <h3 id="hud-dialogue">Caixa de diálogo</h3>
        <p class="help">Onde aparecem as falas e escolhas das cenas (cutscenes) e qualquer texto que o jogo mande mostrar, com a fonte do HUD.</p>
        <label class="check"><input v-model="config.dialogue.enabled" type="checkbox"> Usar a caixa de diálogo do HUD</label>
        <fieldset :disabled="!config.dialogue.enabled"><legend>Caixa</legend>
         <div class="field"><label for="hud-dlg-anchor">Âncora</label><select id="hud-dlg-anchor" v-model="config.dialogue.anchor"><option v-for="anchor in HUD_ANCHORS" :key="anchor" :value="anchor">{{ ANCHORS[anchor] }}</option></select></div>
         <div class="field"><label for="hud-dlg-x">Deslocamento X, Y (px)</label><span><input id="hud-dlg-x" v-model.number="config.dialogue.x" type="number" step="8" class="short"> <input v-model.number="config.dialogue.y" type="number" step="8" class="short" aria-label="Deslocamento Y da caixa"></span></div>
         <div class="field"><label for="hud-dlg-width">Caracteres por linha</label><input id="hud-dlg-width" v-model.number="config.dialogue.width" type="number" min="8" max="40" class="short"></div>
         <div class="field"><label for="hud-dlg-lines">Linhas de texto</label><input id="hud-dlg-lines" v-model.number="config.dialogue.lines" type="number" min="1" :max="HUD_LIMITS.dialogueLines" class="short"></div>
         <label class="check"><input v-model="config.dialogue.speaker" type="checkbox"> Linha com o nome de quem fala (ou a pergunta de uma escolha)</label>
         <div class="field"><label for="hud-dlg-cursor">Cursor das escolhas</label><input id="hud-dlg-cursor" v-model="config.dialogue.cursor" type="text" maxlength="2" class="short"></div>
        </fieldset>
        <ul v-if="status.cutsceneNotes.length" class="conflicts" aria-label="Avisos sobre as cenas do projeto"><li v-for="note in status.cutsceneNotes" :key="note">{{ note }}</li></ul>
        <p v-if="status.cutsceneNotes.length&&dirty" class="help">Estes avisos são do que está exportado; exporte para conferi-los de novo.</p>
       </section>
       <!-- ---- Valores ---- -->
       <section v-show="tab==='values'" aria-labelledby="hud-values">
        <h3 id="hud-values">Valores do jogo</h3>
        <p class="help">Quantidades que o jogo informa a cada quadro (pontos, vidas, energia). O nome vira uma constante no código (<code>RETRO_HUD_VALUE_…</code>) e nunca aparece na tela; o máximo decide quantos dígitos ou ícones são necessários.</p>
        <div v-for="(item,index) in config.values" :key="index" class="row"><input :value="item.id" type="text" maxlength="24" spellcheck="false" :aria-label="'Nome do valor '+(index+1)" @change="renameValue(index,$event.target.value.trim())"><label class="inline">máximo <input v-model.number="item.max" type="number" min="1" max="99999999" class="medium"></label>
         <label class="inline">na prévia <input type="number" min="0" class="medium" :value="state.values?.[item.id]" :aria-label="'Valor de '+item.id+' na prévia'" @input="sample={...sample,[item.id]:Number($event.target.value)||0}"></label><button type="button" :aria-label="'Remover valor '+item.id" @click="removeValue(index)">×</button></div>
        <div class="row"><button type="button" :disabled="config.values.length>=HUD_LIMITS.values" @click="addValue">+ Valor</button></div>
       </section>
       <!-- ---- No jogo ---- -->
       <section v-show="tab==='game'" aria-labelledby="hud-game">
        <h3 id="hud-game">Custo no console</h3>
        <dl v-if="cost"><dt>Tiles de vídeo além da fonte</dt><dd>{{ cost.vramTiles }} <small>(a fonte importada usa os {{ HUD_LIMITS.glyphs }} tiles da fonte do SGDK)</small></dd>
         <dt>Sprites</dt><dd>{{ cost.sprites }} <small>(um por caractere dos elementos em sprites; cada um usa 1 tile da reserva de sprites)</small></dd>
         <dt>Memória (RAM)</dt><dd>{{ cost.ramBytes }} bytes</dd><dt>Dados na ROM</dt><dd>≈ {{ cost.romBytes }} bytes</dd>
         <dt>Células de tela</dt><dd>HUD {{ cost.hudCells }} · menus e diálogo {{ cost.overlayCells }} <small>(o jogo escreve até 64 por quadro, por padrão)</small></dd></dl>
        <p v-else class="notice">Corrija os problemas para ver o custo.</p>
        <ul v-if="layout" class="notes"><li v-for="note in layout.notes" :key="note">{{ note }}</li></ul>
        <h3>Como o jogo usa</h3>
        <p class="help">Inclua <code>generated/hud_config.h</code> e <code>retro_runtime/retro_hud_sgdk.h</code>, forneça a função que devolve cada valor e chame a atualização uma vez por quadro, antes de <code>SPR_update</code>:</p>
        <pre class="code" tabindex="0">static u32 valor(void *contexto,u16 id){
 return {{ config.values.map((item,index)=>(index?' ':'')+'id==RETRO_HUD_VALUE_'+item.id.toUpperCase()+'?'+item.id).join(':\n       ')||'0' }}{{ config.values.length?':0':'' }};
}
static const RetroHudHost host={valor,escolheu,cancelou,0};
retroHudSgdkInitProject(&amp;hud,&amp;host,celulas,celulasPorCima,{{ cost?.sprites ? '&amp;RETRO_HUD_GLYPHS /* #include "hud_resources.h" */' : '0' }},0);
/* a cada quadro */ retroHudSgdkUpdate(&amp;hud);</pre>
        <p class="help">As cores da fonte são gravadas ao iniciar. Se o jogo recarregar ou fizer fade da paleta (troca de sala, cena), chame <code>retroHudSgdkColors</code> em seguida.</p>
        <p class="help">Menus: <code>retroHudMenuOpen</code>, <code>retroHudMenuInput</code> e <code>retroHudOverlayHide</code>. Diálogos das cenas: <code>retroHudCutscenePresent</code> (de <code>retro_hud_cutscene.h</code>). Guia: docs/HUD_RUNTIME.md.</p>
        <p v-if="!status.runtimeInstalled" class="notice">Os módulos <code>hud</code> e <code>hud-sgdk</code> do runtime ainda não estão instalados neste projeto. Instale-os em Recursos → Runtime antes de usar o header no jogo.</p>
       </section>
      </div>
      <aside class="preview" aria-label="Prévia do HUD">
       <div class="row">
        <label class="inline" for="hud-overlay">Na prévia</label><select id="hud-overlay" v-model="overlay"><option value="none">Só o HUD</option><option value="menu" :disabled="!config.menus.length">Menu selecionado</option><option value="dialogue" :disabled="!config.dialogue.enabled">Diálogo</option><option value="choice" :disabled="!config.dialogue.enabled">Escolha</option></select>
        <label v-if="overlay==='menu'&&menu" class="inline">cursor no item <input v-model.number="menuItem" type="number" min="0" :max="menu.items.length-1" class="short"></label>
        <label class="inline"><input v-model="showSafe" type="checkbox"> área segura</label>
        <label class="inline">zoom <select v-model.number="zoom" aria-label="Zoom da prévia"><option :value="1">1×</option><option :value="2">2×</option><option :value="3">3×</option></select></label>
       </div>
       <canvas v-show="!validation" ref="canvas" class="pixel screen" role="img" :style="{width:config.screen.width*zoom+'px'}" :aria-label="'Prévia do HUD em '+config.screen.width+' × '+config.screen.height+' pixels'"></canvas>
       <p class="help">Fundo quadriculado = o jogo. Faixa escura = linhas em que a janela cobre o plano A. Tracejado = área segura.</p>
      </aside>
     </div>
     <p v-if="validation" role="alert" class="notice problem">{{ validation }}</p>
     <p v-if="status.conflicts.length" role="alert" class="notice problem">Arquivo gerado alterado fora da IDE (preservado): {{ status.conflicts.join(', ') }}. O build fica bloqueado até ele ser revisado; para voltar ao gerado, apague o arquivo e exporte de novo.</p>
    </template>
   </div>
   <footer><div><small role="status">{{ saving ? 'Exportando…' : dirty ? 'Alterações não exportadas.' : saved ? 'HUD exportado. Faça um build para aplicar.' : 'hud/hud.json · src/generated/hud_config.h' }}</small></div>
    <span class="history-buttons"><button type="button" :disabled="blocked||!history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button><button type="button" :disabled="blocked||!history.canRedo.value" title="Refazer (Ctrl+Y)" @click="history.redo()">Refazer</button></span>
    <button type="button" :disabled="blocked" @click="load(true)">{{ dirty ? 'Descartar e recarregar' : 'Recarregar' }}</button><button type="button" :disabled="saving" @click="close(true)">Descartar e fechar</button>
    <button type="button" class="primary" :disabled="blocked||!dirty&&status?.exported||!!validation||!!status?.conflicts.length||status?.foreign||(draftStale&&!staleAccepted)" @click="save">Salvar e exportar HUD</button></footer>
  </dialog>
 </Teleport>
</template>
<style scoped>
.hud-dialog{box-sizing:border-box;width:min(1180px,97vw);max-width:97vw;height:min(800px,95vh);max-height:95vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.hud-dialog[open]{display:flex;flex-direction:column}.hud-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-shrink:0}header{justify-content:space-between;border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d);flex-wrap:wrap}footer div{flex:1;min-width:160px}
.tabs{display:flex;gap:4px;padding:8px 12px 0;flex-wrap:wrap;flex-shrink:0}.tabs button[aria-pressed="true"],.list button[aria-pressed="true"]{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
.hud-body{padding:14px;overflow:auto;min-height:0;flex:1}.split{display:grid;grid-template-columns:minmax(300px,420px) minmax(0,1fr);gap:16px;align-items:start}.side{min-width:0}.preview{min-width:0;overflow:auto;position:sticky;top:0}
h2{margin:3px 0;font-size:19px}h3{margin:14px 0 4px;font-size:13px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:6px 0;line-height:1.5}code{font-size:11px}
button,select,textarea,input[type="text"],input[type="number"]{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px}button{cursor:pointer}button:disabled,fieldset:disabled{opacity:.55;cursor:default}
.primary{border-color:var(--accent,#5bbda5)}:is(button,select,input,textarea,pre):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
fieldset{min-width:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;margin:10px 0}
.field{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:8px;margin:6px 0}.field :is(select,input[type="text"]){width:100%}.field.wide{grid-template-columns:1fr}.field textarea{width:100%;font-family:ui-monospace,monospace;font-size:13px;letter-spacing:2px}
.short{width:64px}.medium{width:104px}.narrow{width:110px}.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0}.row input[type="text"]{flex:1;min-width:0}.row .narrow{flex:0 0 110px}
.check,.inline{display:flex;align-items:center;gap:6px;margin:6px 0}.inline{display:inline-flex;margin:0 8px 0 0}
.list{list-style:none;margin:6px 0;padding:0;display:grid;gap:4px}.list button{width:100%;text-align:left}
.pixel{image-rendering:pixelated}.screen{display:block;max-width:none;height:auto;border:1px solid var(--border,#41464d)}.font-sheet{display:block;width:384px;max-width:100%;height:auto;border:1px solid var(--border,#41464d);background:repeating-conic-gradient(#333 0 25%,#222 0 50%) 0 0/16px 16px}
.mixer{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:4px 0}.mixer label{display:flex;align-items:center;gap:4px}.big-swatch{width:28px;height:28px;border:1px solid #0008;border-radius:3px}
dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:6px 0}dt{color:var(--muted,#a7b2b9)}dd{margin:0;overflow-wrap:anywhere}
.conflicts,.notes{margin:6px 0;padding-left:18px;line-height:1.5}.conflicts{color:#f0b3a3}.notes{color:var(--muted,#a7b2b9)}
.code{margin:6px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;overflow:auto;font-family:ui-monospace,monospace;font-size:11px;line-height:1.45;white-space:pre}
.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4;overflow-wrap:anywhere}.problem{border-color:#e38269;color:#f0b3a3}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.history-buttons{display:inline-flex;gap:4px}
@media(max-width:900px){.split{grid-template-columns:1fr}.preview{position:static}.field{grid-template-columns:1fr}}
</style>
