<template>
  <dialog ref="dialog" class="autotile-dialog" :class="{ compact }" aria-modal="true" aria-labelledby="autotile-title" @cancel.prevent="a.close()">
    <header class="auto-header"><div><small>{{ t('tilemap.autotile.experimental') }}</small><h2 id="autotile-title">{{ t('tilemap.autotile.title') }}</h2></div><button type="button" :disabled="a.busy.value" @click="a.close()">{{ t('tilemap.autotile.close') }}</button></header>
    <div class="auto-content" :inert="a.busy.value">
      <div v-show="!compact" class="auto-file-bar"><input v-model="a.draft.value.name" maxlength="80" :aria-label="t('tilemap.autotile.name')" /><button type="button" @click="a.load()">{{ t('tilemap.autotile.load') }}</button><button type="button" :disabled="!!a.validation.value" @click="a.save()">{{ t('tilemap.autotile.save') }}</button><small>{{ a.dirty.value ? t('tilemap.autotile.unsaved') : t('tilemap.autotile.saved') }}</small></div>
      <p v-if="a.error.value" role="alert" class="auto-error">{{ errorText(a.error.value) }}</p>
      <div v-show="!compact" class="auto-workbench">
        <section class="auto-rules">
          <label>{{ t('tilemap.autotile.tileset') }}<select v-model="a.tilesetId.value"><option v-for="ts in state.userTilesets.value" :key="ts.id" :value="ts.id">{{ ts.name }}</option></select></label>
          <div v-if="a.tileset.value" class="auto-sheet-scroll">
            <div class="auto-sheet" :style="{ width: a.tileset.value.columns * 16 + 'px' }" @pointerdown="pickTile">
              <img :src="a.tileset.value.preview" alt="" draggable="false" />
              <div class="auto-sheet-grid" />
              <i :style="{ left: a.chosenTile.value % a.tileset.value.columns * 16 + 'px', top: Math.floor(a.chosenTile.value / a.tileset.value.columns) * 16 + 'px' }" />
            </div>
          </div>
          <label>{{ t('tilemap.autotile.outputTile') }}<input type="number" :value="a.chosenTile.value" min="0" :max="(a.tileset.value?.tilecount || 1) - 1" @change="setTile(Number($event.target.value))" /></label>
          <button type="button" @click="a.preset(true)">{{ t('tilemap.autotile.freePreset') }}</button>
          <p class="auto-hint">{{ t('tilemap.autotile.freePresetHint') }}</p>
          <div class="auto-pieces" role="group" :aria-label="t('tilemap.autotile.pieces')">
            <button v-for="(piece,index) in pieces" :key="index" type="button" :disabled="piece.ruleIndex < 0" :aria-label="t('tilemap.autotile.pieceNames.'+index)" :aria-pressed="a.selectedRule.value === piece.ruleIndex" :title="t('tilemap.autotile.pieceNames.'+index)" @click="a.selectedRule.value = piece.ruleIndex; a.chosenTile.value = piece.tile">
              <i :style="pieceStyle(piece.tile)" /><small>{{ t('tilemap.autotile.pieceNames.'+index) }}</small>
            </button>
          </div>
          <button type="button" @click="a.preset()">{{ t('tilemap.autotile.preset') }}</button>
          <p class="auto-hint">{{ t('tilemap.autotile.presetHint') }}</p>
          <div class="auto-rule-heading"><strong>{{ t('tilemap.autotile.rules') }}</strong><button type="button" :disabled="a.draft.value.rules.length >= 256" @click="a.addRule()">＋</button></div>
          <ol class="auto-rule-list"><li v-for="(rule, index) in a.draft.value.rules" :key="index"><button type="button" :class="{ selected: a.selectedRule.value === index }" :aria-pressed="a.selectedRule.value === index" @click="a.selectedRule.value = index; a.chosenTile.value = rule.tile"><span>{{ index + 1 }} · {{ rule.name }}</span><small>#{{ rule.tile }}{{ rule.enabled === false ? ' ○' : '' }}</small></button></li></ol>
          <template v-if="activeRule">
            <input v-model="activeRule.name" maxlength="80" :aria-label="t('tilemap.autotile.ruleName')" />
            <label class="auto-check"><input v-model="activeRule.enabled" type="checkbox" />{{ t('tilemap.autotile.enabled') }}</label>
            <div class="auto-pattern" role="group" :aria-label="t('tilemap.autotile.pattern')"><button v-for="(value,index) in activeRule.pattern" :key="index" type="button" :disabled="index === 4" :class="'cell-' + value" :title="patternTitle(index,value)" :aria-label="patternTitle(index,value)" @click="cyclePattern(index)">{{ value === 1 ? '■' : value === 0 ? '×' : '·' }}</button></div>
            <p class="auto-hint">{{ t('tilemap.autotile.patternHint') }}</p>
            <div class="auto-buttons"><button type="button" :disabled="a.selectedRule.value === 0" @click="moveRule(-1)">↑</button><button type="button" :disabled="a.selectedRule.value === a.draft.value.rules.length-1" @click="moveRule(1)">↓</button><button type="button" @click="removeRule">{{ t('tilemap.autotile.removeRule') }}</button></div>
          </template>
        </section>
        <section class="auto-shape">
          <div class="auto-size"><label>{{ t('tilemap.autotile.width') }}<input type="number" min="1" max="64" :value="a.draft.value.width" @change="a.resize($event.target.value,a.draft.value.height)" /></label><label>{{ t('tilemap.autotile.height') }}<input type="number" min="1" max="64" :value="a.draft.value.height" @change="a.resize(a.draft.value.width,$event.target.value)" /></label><label class="auto-check"><input v-model="erasing" type="checkbox" />{{ t('tilemap.autotile.erase') }}</label></div>
          <p class="auto-hint">{{ t('tilemap.autotile.paintHint') }}</p>
          <h3>{{ t('tilemap.autotile.shape') }}</h3>
          <div class="auto-canvas-scroll"><canvas ref="shapeCanvas" tabindex="0" :aria-label="t('tilemap.autotile.shapeKeyboard')" @pointerdown="startStroke" @pointermove="paintStroke" @pointerup="endStroke" @pointercancel="endStroke" @contextmenu.prevent @keydown="onShapeKey" /></div>
          <div class="auto-rule-heading"><h3>{{ t('tilemap.autotile.result') }}</h3><span>{{ a.output.value.occupied }} {{ t('tilemap.autotile.cells') }}</span></div>
          <div class="auto-canvas-scroll"><canvas ref="resultCanvas" :aria-label="t('tilemap.autotile.result')" /></div>
          <p class="auto-hint">{{ t('tilemap.autotile.matchHint') }}</p>
          <p v-if="a.output.value.unmatched" class="auto-error">{{ t('tilemap.autotile.unmatchedCount',{count:a.output.value.unmatched}) }}</p>
        </section>
      </div>
      <div class="auto-placement"><label>{{ t('tilemap.autotile.layer') }}<select v-model="a.layer.value"><option value="bg">BG</option><option value="fg">FG</option></select></label><label>X <small>tiles</small><input v-model.number="a.originX.value" type="number" min="0" :max="state.mapWidth.value-1" /></label><label>Y <small>tiles</small><input v-model.number="a.originY.value" type="number" min="0" :max="state.mapHeight.value-1" /></label></div>
      <p v-if="a.placement.value.error" class="auto-error" role="status">{{ errorText(a.placement.value.error) }}</p>
      <p v-else class="auto-hint">{{ t('tilemap.autotile.placement',{count:a.placement.value.cells.length,replaced:a.placement.value.replaced}) }}</p>
      <p class="auto-hint">{{ t('tilemap.autotile.preserveHint') }}</p>
    </div>
    <footer class="auto-footer"><button type="button" :disabled="a.busy.value || !!a.placement.value.error" @click="toggleMapPreview">{{ t(compact ? 'tilemap.autotile.backToRules' : 'tilemap.autotile.mapPreview') }}</button><button type="button" class="auto-apply" :disabled="a.busy.value || !!a.placement.value.error || !a.placement.value.cells.length" @click="a.apply()">{{ t('tilemap.autotile.apply') }}</button></footer>
  </dialog>
</template>

<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nineSliceRules } from '../../../utils/retro/autotileRules.js'
const props = defineProps({ state:{ type:Object,required:true } })
const {t,te} = useI18n(), a = props.state.autotile
const dialog=ref(null),shapeCanvas=ref(null),resultCanvas=ref(null),compact=ref(false),erasing=ref(false)
const cursor=ref({x:0,y:0}),activeRule=computed(()=>a.draft.value.rules[a.selectedRule.value] || null)
watch(activeRule,rule=>{if(rule)a.chosenTile.value=rule.tile},{immediate:true})
const pieces = computed(() => nineSliceRules(0,3,9).map(template => {
  const ruleIndex = a.draft.value.rules.findIndex(rule => rule.pattern.every((value,index) => value === template.pattern[index]))
  return { ruleIndex, tile: a.draft.value.rules[ruleIndex]?.tile ?? -1 }
}))
function pieceStyle(tile) {
  const ts=a.tileset.value
  return tile < 0 || !ts ? {} : { backgroundImage:`url("${ts.preview}")`, backgroundSize:`${ts.columns*32}px auto`, backgroundPosition:`-${tile%ts.columns*32}px -${Math.floor(tile/ts.columns)*32}px` }
}
let stroke=null, image=null, imageTicket=0
watch(()=>[a.draft.value.width,a.draft.value.height],([w,h])=>{stroke=null;cursor.value={x:Math.min(cursor.value.x,w-1),y:Math.min(cursor.value.y,h-1)}})
const errorText=code=>te('tilemap.autotile.errors.'+code)?t('tilemap.autotile.errors.'+code):code
const patternTitle=(index,value)=>`${t('tilemap.autotile.neighbor')} ${index%3-1},${Math.floor(index/3)-1}: ${t(value===1?'tilemap.autotile.filled':value===0?'tilemap.autotile.empty':'tilemap.autotile.any')}`
function setTile(tile){if(!Number.isInteger(tile)||tile<0||tile>=(a.tileset.value?.tilecount||0))return;a.chosenTile.value=tile;if(activeRule.value)activeRule.value.tile=tile}
function pickTile(event){if(event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect(),ts=a.tileset.value;setTile(Math.floor((event.clientY-rect.top)/16)*ts.columns+Math.floor((event.clientX-rect.left)/16))}
function cyclePattern(index){const sequence=[-1,1,0];activeRule.value.pattern[index]=sequence[(sequence.indexOf(activeRule.value.pattern[index])+1)%3]}
function moveRule(delta){const i=a.selectedRule.value,j=i+delta;[a.draft.value.rules[i],a.draft.value.rules[j]]=[a.draft.value.rules[j],a.draft.value.rules[i]];a.selectedRule.value=j}
function removeRule(){a.draft.value.rules.splice(a.selectedRule.value,1);a.selectedRule.value=Math.max(0,Math.min(a.selectedRule.value,a.draft.value.rules.length-1))}
function point(event){const rect=shapeCanvas.value.getBoundingClientRect(),d=a.draft.value;return {x:Math.max(0,Math.min(d.width-1,Math.floor((event.clientX-rect.left)*shapeCanvas.value.width/rect.width/20))),y:Math.max(0,Math.min(d.height-1,Math.floor((event.clientY-rect.top)*shapeCanvas.value.height/rect.height/20)))}}
function writeCell(p,value){cursor.value=p;a.draft.value.mask[p.y*a.draft.value.width+p.x]=value}
function startStroke(event){if(![0,2].includes(event.button))return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);const p=point(event);stroke={...p,value:event.button===2||erasing.value?0:1};writeCell(p,stroke.value)}
function paintStroke(event){if(!stroke)return;const to=point(event);let {x,y}=stroke;const dx=Math.abs(to.x-x),dy=-Math.abs(to.y-y),sx=x<to.x?1:-1,sy=y<to.y?1:-1;let e=dx+dy;for(let guard=0;guard<128;guard++){writeCell({x,y},stroke.value);if(x===to.x&&y===to.y)break;const twice=2*e;if(twice>=dy){e+=dy;x+=sx}if(twice<=dx){e+=dx;y+=sy}}stroke={...to,value:stroke.value}}
function endStroke(){stroke=null}
function onShapeKey(event){const d=a.draft.value,p=cursor.value,delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(delta){event.preventDefault();cursor.value={x:Math.max(0,Math.min(d.width-1,p.x+delta[0])),y:Math.max(0,Math.min(d.height-1,p.y+delta[1]))}}else if([' ','Enter','Delete'].includes(event.key)){event.preventDefault();writeCell(p,event.key==='Delete'?0:1-d.mask[p.y*d.width+p.x])}}
function draw(){
 const d=a.draft.value;if(!d)return
 for(const [canvas,result] of [[shapeCanvas.value,false],[resultCanvas.value,true]]){
  if(!canvas)continue;canvas.width=d.width*20;canvas.height=d.height*20;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#17212a';ctx.fillRect(0,0,canvas.width,canvas.height)
  d.mask.forEach((filled,i)=>{const x=i%d.width*20,y=Math.floor(i/d.width)*20;if(filled){const tile=a.output.value.tiles[i];if(result&&image&&tile>=0){const cols=Math.floor(image.naturalWidth/8);ctx.drawImage(image,tile%cols*8,Math.floor(tile/cols)*8,8,8,x,y,20,20)}else{ctx.fillStyle=result?'#d98d40':'#68cbb2';ctx.fillRect(x+1,y+1,18,18)}}ctx.strokeStyle='#ffffff20';ctx.strokeRect(x+.5,y+.5,20,20)})
  if(!result){ctx.strokeStyle='#fff';ctx.strokeRect(Math.min(cursor.value.x,d.width-1)*20+.5,Math.min(cursor.value.y,d.height-1)*20+.5,19,19)}
 }
}
async function toggleMapPreview(){compact.value=!compact.value;a.showOnMap.value=compact.value;if(compact.value){const v=props.state.viewport.value;props.state.setViewportPosition(Math.max(0,a.originX.value*8-(v.w-a.draft.value.width*8)/2),Math.max(0,a.originY.value*8-(v.h-a.draft.value.height*8)/2))}await nextTick();draw()}
watch(()=>a.tileset.value?.preview,async src=>{const ticket=++imageTicket;image=null;if(!src)return;const img=new Image();img.src=src;try{await img.decode();if(ticket===imageTicket){image=img;draw()}}catch{}},{immediate:true})
watch([a.draft,a.output,cursor],async()=>{await nextTick();draw()},{deep:true})
onMounted(async()=>{await nextTick();dialog.value.showModal();draw()})
onBeforeUnmount(()=>{imageTicket++;image=null;a.showOnMap.value=false})
</script>

<style scoped>
.autotile-dialog { width:min(1100px,94vw); max-height:92vh; padding:0; color:var(--text,#ddd); background:var(--bg,#1e1e1e); border:1px solid var(--border,#444); border-radius:6px; font:12px/1.45 system-ui,sans-serif; }
.autotile-dialog::backdrop { background:#0008; }
.autotile-dialog.compact { width:310px; position:fixed; inset:60px 20px auto auto; margin:0; }
.autotile-dialog.compact::backdrop { background:transparent; }
.auto-header,.auto-footer { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 16px; background:var(--panel,#252526); }
.auto-header { border-bottom:1px solid var(--border,#444); }
.auto-header small { color:var(--muted,#aaa); font-size:9px; text-transform:uppercase; letter-spacing:.12em; }
.auto-header h2 { font-size:18px; margin:2px 0; }
.auto-content { padding:12px 16px; overflow:auto; max-height:calc(92vh - 150px); }
.auto-workbench { display:grid; grid-template-columns:280px minmax(0,1fr); gap:20px; margin:12px 0; }
.auto-rules,.auto-shape { min-width:0; display:flex; flex-direction:column; gap:8px; }
.auto-rules { padding-right:16px; border-right:1px solid var(--border,#444); }
.auto-file-bar,.auto-size,.auto-placement,.auto-buttons { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.auto-file-bar input { flex:1; }
.auto-file-bar small,.auto-hint { color:var(--muted,#aaa); font-size:11px; }
.auto-hint { margin:2px 0; line-height:1.5; }
.auto-placement { padding-top:10px; border-top:1px solid var(--border,#444); }
.auto-size input,.auto-placement input { width:65px; }
.autotile-dialog label { display:flex; flex-direction:column; gap:4px; font-size:11px; }
.autotile-dialog .auto-check { flex-direction:row; align-items:center; }
.autotile-dialog input,.autotile-dialog select,.autotile-dialog button { color:inherit; background:var(--panel,#252526); border:1px solid var(--border,#444); border-radius:3px; padding:6px 8px; font:inherit; min-width:0; box-sizing:border-box; }
.autotile-dialog button { cursor:pointer; }
.autotile-dialog button:disabled { opacity:.4; cursor:default; }
.autotile-dialog button:focus-visible,.autotile-dialog input:focus-visible,.autotile-dialog select:focus-visible,.auto-canvas-scroll canvas:focus-visible { outline:2px solid var(--accent,#1687cf); outline-offset:2px; }
.auto-sheet-scroll { overflow:auto; max-height:150px; border:1px solid var(--border,#444); }
.auto-sheet { position:relative; cursor:crosshair; }
.auto-sheet img { display:block; width:100%; image-rendering:pixelated; user-select:none; }
.auto-sheet-grid { position:absolute; inset:0; pointer-events:none; background-image:linear-gradient(to right,#fff3 1px,transparent 1px),linear-gradient(to bottom,#fff3 1px,transparent 1px); background-size:16px 16px; }
.auto-sheet i { position:absolute; box-sizing:border-box; width:16px; height:16px; border:2px solid #68cbb2; pointer-events:none; }
.auto-pieces { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; }
.auto-pieces button { display:flex; flex-direction:column; align-items:center; gap:4px; padding:5px 2px; }
.auto-pieces button[aria-pressed="true"] { border-color:var(--accent,#1687cf); background:var(--input-bg,#1b1b1b); }
.auto-pieces i { display:block; width:32px; height:32px; background-repeat:no-repeat; image-rendering:pixelated; background-color:#10171c; }
.auto-pieces small { font-size:9px; }
.auto-rule-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.auto-rule-heading h3,.auto-shape h3 { margin:6px 0 0; font-size:12px; }
.auto-rule-list { margin:0; padding:0; list-style:none; max-height:130px; overflow:auto; }
.auto-rule-list button { display:flex; justify-content:space-between; gap:6px; width:100%; margin:2px 0; text-align:left; }
.auto-rule-list small { color:var(--muted,#aaa); }
.auto-rule-list button.selected { border-color:var(--accent,#1687cf); }
.auto-pattern { display:grid; grid-template-columns:repeat(3,36px); gap:4px; justify-content:center; margin:6px; }
.auto-pattern button { height:36px; padding:0; font-size:20px; }
.auto-pattern .cell-1 { color:#111; background:#68cbb2; }
.auto-pattern .cell-0 { color:#ffb785; }
.auto-canvas-scroll { overflow:auto; max-height:240px; padding:8px; background:#10171c; border:1px solid var(--border,#444); }
.auto-canvas-scroll canvas { display:block; image-rendering:pixelated; cursor:crosshair; touch-action:none; }
.auto-error { color:var(--danger,#ffa58f); font-size:11px; margin:8px 0; }
.auto-footer { border-top:1px solid var(--border,#444); }
.auto-footer .auto-apply { background:var(--accent,#1687cf); border-color:transparent; color:#fff; }
@media(max-width:760px){.auto-workbench{grid-template-columns:1fr}.auto-rules{border-right:0;padding-right:0}.auto-content{max-height:calc(92vh - 170px)}}
</style>
