// #65: HUD, fonte, menus e diálogo do projeto → header gerenciado (e planilha de glifos para os
// elementos em sprites). Jogos sem hud/hud.json da IDE não são tocados.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {HUD_FORMAT,createHudConfiguration,validateHudConfiguration,compileHudHeader,hudCost,hudSpriteSheet,glyphTable,layoutHud} from '../../shared/retro/hudConfiguration.js'
import {encodeIndexedPng} from '../../shared/retro/indexedPng.js'
const SOURCE='hud/hud.json',HEADER='src/generated/hud_config.h',RECORD='.retrostudio/hud-export.json',RUNTIME='src/retro_runtime/retro_hud.h'
const SHEET='res/generated/hud_glyphs.png',RESOURCES='res/hud_resources.res'
// Uma linha de glifos de 8 × 8 (1 × 1 tile por quadro), sem compressão, sem caixa de colisão.
const RESOURCE_LINE='SPRITE RETRO_HUD_GLYPHS "generated/hud_glyphs.png" 1 1 NONE 0\n',NO_SPRITES='// HUD sem elementos em sprites.\n'
const LIMIT=512*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
// Uma pasta hud/ pode ser do jogo. Arquivo ali que não é nosso = recurso não usado; nunca é lido como configuração nem regravado.
function source(root){
 let bytes
 try{bytes=readProjectOutput(root,SOURCE)}catch{return {bytes:null,foreign:true}}
 if(bytes===null)return {bytes:null,foreign:false}
 let ours=false
 try{ours=bytes.length<=LIMIT&&JSON.parse(bytes.toString('utf8'))?.format===HUD_FORMAT}catch{ours=false}
 if(ours)return {bytes,foreign:false}
 let exported=false
 try{exported=readProjectOutput(root,RECORD)!==null}catch{exported=true}
 if(exported)throw Error('hud/hud.json está ilegível ou não é mais uma configuração de HUD da IDE. Restaure o arquivo (ou apague-o junto com src/generated/hud_config.h) antes de continuar.')
 return {bytes:null,foreign:true}
}
/** Arquivos gerados para esta configuração: header sempre; planilha e .res quando há elementos em sprites. */
async function outputs(config,hadResources){
 const files=new Map([[HEADER,Buffer.from(compileHudHeader(config))]])
 if(config.elements.some(element=>element.sprite)){
  const sheet=hudSpriteSheet(config)
  files.set(SHEET,Buffer.from(await encodeIndexedPng({width:sheet.width,height:sheet.height,indices:sheet.indices,palette:config.font.colors})));files.set(RESOURCES,Buffer.from(RESOURCE_LINE))
 }else if(hadResources)files.set(RESOURCES,Buffer.from(NO_SPRITES)) // o .res já existe e é nosso: fica vazio em vez de apontar para uma planilha velha
 return files
}
function read(root){
 const found=source(root),record=readProjectOutput(root,RECORD)
 const config=found.bytes===null?createHudConfiguration():JSON.parse(found.bytes.toString('utf8'))
 validateHudConfiguration(config)
 let ownership=null
 if(record!==null){
  try{ownership=JSON.parse(record.toString('utf8'))}catch{ownership=null}
  if(!ownership||ownership.version!==1||!Array.isArray(ownership.files)||ownership.files.length>4||ownership.files.some(file=>![HEADER,SHEET,RESOURCES].includes(file?.path)||!/^[a-f0-9]{64}$/.test(file.hash)))throw Error('Registro de exportação do HUD em formato desconhecido.')
 }
 const current=new Map([HEADER,SHEET,RESOURCES].map(name=>[name,readProjectOutput(root,name)]))
 for(const bytes of current.values())if(bytes&&bytes.length>LIMIT)throw Error('Arquivo gerado do HUD passa de 512 KiB.')
 const owned=new Map((ownership?.files||[]).map(file=>[file.path,file.hash]))
 return {config,source:found.bytes,foreign:found.foreign,record,ownership,current,owned,
  revision:hash(Buffer.from(JSON.stringify([hash(found.bytes),hash(record),...[...current.values()].map(hash)])))}
}
// Arquivo gerado que existe sem ser o que a IDE gravou por último: alguém o editou (ou é de outra ferramenta).
const customized=data=>[...data.current].filter(([name,bytes])=>bytes!==null&&hash(bytes)!==data.owned.get(name)).map(([name])=>name)
async function exported(data){
 if(data.source===null||!data.ownership)return false
 const wanted=await outputs(data.config,data.owned.has(RESOURCES))
 return [...wanted].every(([name,bytes])=>data.current.get(name)&&bytes.equals(data.current.get(name))&&data.owned.get(name)===hash(bytes))
}
// O compilador de cenas, com asciiOnly, troca acentos por letras simples e o resto por "?" antes
// de o texto chegar ao jogo. Mesma regra aqui, para conferir o que a caixa realmente recebe.
const fold=text=>text.replace(/[…]/g,'...').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e\n]/g,'?')
/** Textos das cenas do projeto que a caixa de diálogo vai mostrar, conferidos contra a fonte e o tamanho da caixa. */
function cutsceneNotes(root,config){
 const notes=[]
 if(!config.dialogue.enabled)return notes
 const base=path.join(root,'cutscenes'),files=[]
 const walk=(directory,depth)=>{
  let entries
  try{if(fs.lstatSync(directory).isSymbolicLink())return;entries=fs.readdirSync(directory,{withFileTypes:true})}catch{return}
  for(const entry of entries.sort((x,y)=>x.name.localeCompare(y.name))){
   if(files.length>=128||entry.name.startsWith('.')||entry.isSymbolicLink())continue
   const file=path.join(directory,entry.name)
   if(entry.isDirectory()){if(depth<6)walk(file,depth+1)}
   else if(entry.isFile()&&entry.name.endsWith('.cutscene.json'))files.push(file)
  }
 }
 walk(base,0)
 const json=file=>{try{return fs.statSync(file).size<=LIMIT?JSON.parse(fs.readFileSync(file,'utf8')):null}catch{return null}}
 const project=json(path.join(base,'cutscene-config.json'))
 if(!files.length&&!project)return notes
 // Sem arquivo de configuração valem os padrões do compilador de cenas.
 const settings={charsPerLine:32,linesPerPage:2,asciiOnly:true,uppercaseSpeaker:true,...(project?.dialogue&&typeof project.dialogue==='object'?project.dialogue:{})}
 const texts=[],speakers=(Array.isArray(project?.actors)?project.actors:[]).map(actor=>actor?.name).filter(name=>typeof name==='string')
 const collect=value=>{
  if(Array.isArray(value))value.forEach(collect)
  else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
   if(typeof item==='string'&&(key==='text'||key==='prompt'))texts.push(item)
   else if(typeof item==='string'&&key==='speaker')speakers.push(item)
   else collect(item)
  }
 }
 for(const file of files)collect(json(file))
 if(settings.charsPerLine>config.dialogue.width)notes.push(`As cenas quebram o texto em ${settings.charsPerLine} caracteres por linha, mas a caixa de diálogo tem ${config.dialogue.width}: o fim das linhas seria cortado. Ajuste a largura da caixa ou “caracteres por linha” em Cenas.`)
 if(settings.linesPerPage>config.dialogue.lines)notes.push(`As cenas usam ${settings.linesPerPage} linhas por página e a caixa de diálogo tem ${config.dialogue.lines}: as últimas linhas não apareceriam.`)
 const table=glyphTable(config.font),ascii=settings.asciiOnly!==false
 if(ascii&&[...table.keys()].some(character=>character.codePointAt(0)>126))notes.push('A fonte tem acentos, mas as cenas estão configuradas para trocar acentos por letras simples (asciiOnly). Desligue essa opção na configuração de cenas para os diálogos usarem os acentos da fonte.')
 // O que chega à caixa: quem fala em maiúsculas (padrão das cenas) e, com asciiOnly, tudo sem acentos.
 const missing=new Set(),check=text=>{for(const character of ascii?fold(text):text)if(character!=='\n'&&!table.has(character))missing.add(character)}
 texts.forEach(check);speakers.forEach(name=>check(settings.uppercaseSpeaker!==false?name.toUpperCase():name))
 if(missing.size)notes.push(`Os textos das cenas usam caracteres que a fonte não tem e que apareceriam como “?”: ${[...missing].slice(0,24).join(' ')}${missing.size>24?' …':''}`)
 return notes
}
export async function hudConfigurationStatus(projectPath){
 const root=fs.realpathSync(projectPath),data=read(root)
 return {config:data.config,revision:data.revision,saved:data.source!==null,exported:await exported(data),foreign:data.foreign,conflicts:customized(data),
  runtimeInstalled:readProjectOutput(root,RUNTIME)!==null,cost:hudCost(data.config),layout:layoutHud(data.config),cutsceneNotes:cutsceneNotes(root,data.config),
  files:{source:SOURCE,header:HEADER,sheet:SHEET,resources:RESOURCES}}
}
export async function saveHudConfiguration(projectPath,{config,revision}={}){
 validateHudConfiguration(config)
 const root=fs.realpathSync(projectPath),data=read(root)
 if(data.foreign)throw Error('hud/hud.json é de outra ferramenta; o arquivo foi preservado e o HUD não pode ser exportado aqui.')
 if(typeof revision!=='string'||revision!==data.revision)throw Error('A configuração do HUD mudou no disco; recarregue antes de salvar.')
 const conflicts=customized(data)
 if(conflicts.length)throw Error('Arquivo gerado do HUD foi personalizado ou é de outra ferramenta; nada foi alterado: '+conflicts.join(', '))
 const files=await outputs(config,data.owned.has(RESOURCES)),bytes=Buffer.from(JSON.stringify(config,null,2)+'\n')
 // A planilha de uma exportação anterior fica no disco quando os sprites saem (o .res não aponta
 // mais para ela): continua registrada como nossa, para não parecer um arquivo personalizado.
 const kept=[...data.owned].filter(([name])=>!files.has(name)&&data.current.get(name)!==null).map(([name,value])=>({path:name,hash:value}))
 const record=Buffer.from(JSON.stringify({version:1,files:[...[...files].map(([name,content])=>({path:name,hash:hash(content)})),...kept]},null,2)+'\n')
 const receipt=publishProjectOutputs(root,[{path:SOURCE,bytes,expectedHash:hash(data.source)},
  ...[...files].map(([name,content])=>({path:name,bytes:content,expectedHash:hash(data.current.get(name))})),{path:RECORD,bytes:record,expectedHash:hash(data.record)}],{producer:'hud-configuration'})
 return {...receipt,...await hudConfigurationStatus(root)}
}
/** Trava de build opcional: sem hud/hud.json da IDE, projetos antigos e próprios seguem intocados. */
export function validateHudForBuild(projectPath){
 const root=fs.realpathSync(projectPath)
 if(source(root).bytes===null)return {configured:false}
 const data=read(root),header=data.current.get(HEADER)
 if(header===null||data.ownership===null)throw Error('O HUD ainda não foi exportado. Use Salvar e exportar HUD.')
 const conflicts=customized(data)
 if(conflicts.length)throw Error('Arquivo gerado do HUD foi personalizado; revise-o (ou apague-o e exporte de novo) antes do build. O arquivo foi preservado: '+conflicts.join(', '))
 // O header sai só da configuração (sem imagem a codificar): basta compará-lo para saber se está em dia.
 const sprites=data.config.elements.some(element=>element.sprite)
 if(!Buffer.from(compileHudHeader(data.config)).equals(header)||(sprites&&(data.current.get(SHEET)===null||!data.current.get(RESOURCES)?.equals(Buffer.from(RESOURCE_LINE))))||(!sprites&&data.current.get(RESOURCES)?.equals(Buffer.from(RESOURCE_LINE))))
  throw Error('O HUD mudou. Use Salvar e exportar HUD antes do build.')
 return {configured:true,revision:data.revision}
}
