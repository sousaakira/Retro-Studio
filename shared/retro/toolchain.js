// #61: technical base of a project (SDK, runtime, generators) and what a failure is about.
export const TOOLCHAIN_FILE='retro-studio.toolchain.json'
const version=/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/
export function createToolchainRecord({sdk,compiler='',modules={},generators={},ide=''}){
 return validateToolchainRecord({format:'retro-studio.toolchain',version:1,sdk:{name:sdk.name,version:sdk.version},compiler,runtime:{modules:{...modules}},generators:{...generators},ide})
}
export function validateToolchainRecord(value){
 if(!value||typeof value!=='object'||value.format!=='retro-studio.toolchain'||value.version!==1)throw Error('Unsupported toolchain record.')
 if(!value.sdk||typeof value.sdk.name!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(value.sdk.name)||typeof value.sdk.version!=='string'||!version.test(value.sdk.version))throw Error('Invalid toolchain SDK.')
 if(typeof value.compiler!=='string'||value.compiler.length>128||typeof value.ide!=='string'||value.ide.length>64)throw Error('Invalid toolchain tools.')
 const modules=value.runtime?.modules
 if(!modules||typeof modules!=='object'||Array.isArray(modules)||Object.keys(modules).length>64)throw Error('Invalid toolchain runtime modules.')
 for(const [id,number] of Object.entries(modules))if(!/^[a-z][a-z0-9-]{0,31}$/.test(id)||!Number.isInteger(number)||number<1||number>65535)throw Error('Invalid toolchain runtime module: '+id)
 if(!value.generators||typeof value.generators!=='object'||Array.isArray(value.generators)||Object.keys(value.generators).length>32)throw Error('Invalid toolchain generators.')
 for(const [id,item] of Object.entries(value.generators))if(!/^[a-z][a-z0-9-]{0,31}$/.test(id)||!(typeof item==='string'?version.test(item):Number.isInteger(item)&&item>=0&&item<=65535))throw Error('Invalid toolchain generator: '+id)
 return value
}
/** record: saved base or null; detected: what this machine has; library: what this IDE ships.
 * scope tells whose problem it is: 'environment' (tools on this machine) or 'project'. */
export function compareToolchain(record,detected,library){
 const issues=[],issue=(severity,scope,code,message)=>issues.push({severity,scope,code,message})
 if(!detected.toolkit)issue('error','environment','toolkit-missing','O caminho do toolkit não está configurado ou não existe. Configure-o nas preferências da IDE.')
 else{
  if(!detected.sdk)issue('error','environment','sdk-missing','O toolkit configurado não tem o SGDK (inc/genesis.h não foi encontrado).')
  if(!detected.compiler)issue('error','environment','compiler-missing','O compilador m68k-elf-gcc não foi encontrado no toolkit.')
  if(!detected.rescomp)issue('error','environment','rescomp-missing','O rescomp.jar não foi encontrado no toolkit; os recursos não podem ser compilados.')
 }
 for(const [tool,reason] of [['make','o build'],['java','o rescomp'],['python3','a exportação de mapas']])
  if(!detected.tools?.[tool])issue(tool==='python3'?'warning':'error','environment','tool-missing','“'+tool+'” não foi encontrado nesta máquina; '+reason+' depende dele.')
 if(detected.layout==='sdk-root')issue('warning','environment','toolkit-layout','O caminho do toolkit aponta para a pasta do SDK. O build procura o SDK em “m68k-elf” dentro do toolkit: configure a pasta acima.')
 if(!record){
  issue('info','project','not-recorded','Este projeto ainda não registrou sua base técnica. Registrar não altera o jogo.')
  return issues
 }
 if(detected.sdk){
  if(detected.sdk.name!==record.sdk.name)issue('error','environment','sdk-different','O projeto foi registrado para '+record.sdk.name+' '+record.sdk.version+' e o toolkit configurado é '+detected.sdk.name+' '+detected.sdk.version+'.')
  else if(detected.sdk.version==='unknown')issue('warning','environment','sdk-version','A versão do SGDK do toolkit não pôde ser lida; o projeto foi registrado para a '+record.sdk.version+'.')
  else if(detected.sdk.version!==record.sdk.version){
   const major=text=>text.split('.')[0]
   issue(major(detected.sdk.version)!==major(record.sdk.version)?'error':'warning','environment','sdk-version',
    'O projeto foi registrado para o SGDK '+record.sdk.version+' e o toolkit configurado tem o SGDK '+detected.sdk.version+'. APIs e recursos podem ser incompatíveis.')
  }
 }
 if(record.compiler&&detected.compiler&&record.compiler!==detected.compiler)issue('info','environment','compiler-version','Compilador registrado: '+record.compiler+'; nesta máquina: '+detected.compiler+'.')
 for(const [id,number] of Object.entries(record.runtime.modules)){
  const current=library.modules?.[id]
  if(current===undefined)issue('warning','project','module-unknown','O projeto registra o módulo de runtime “'+id+'”, que esta versão da IDE não distribui.')
  else if(current>number)issue('info','project','module-outdated','Módulo “'+id+'”: o projeto registra a v'+number+' e a IDE distribui a v'+current+'. A atualização é opcional, em Runtime.')
  else if(current<number)issue('warning','project','module-newer','Módulo “'+id+'”: o projeto registra a v'+number+', mais nova que a v'+current+' desta IDE. Atualize a IDE antes de exportar.')
 }
 for(const [id,item] of Object.entries(record.generators)){
  const current=library.generators?.[id]
  if(current!==undefined&&current!==item)issue(typeof item==='number'&&typeof current==='number'&&current<item?'warning':'info','project','generator-version','Gerador “'+id+'”: registrado '+item+', nesta IDE '+current+'.')
 }
 return issues
}
const TOOL='(make|gmake|java|python3?|node|m68k-elf-[a-z+-]+)(?:\\.exe)?'
const missing=m=>m[1].startsWith('m68k-elf')?'O compilador m68k-elf não foi encontrado no toolkit.':'O programa “'+m[1]+'” não está instalado ou não está no PATH.'
// Every pattern is a whole line as a shell or make prints it: text of the game cannot match by accident.
const ENVIRONMENT=[
 [new RegExp('^(?:/bin/)?(?:sh|bash|dash|zsh): (?:line )?\\d+: (?:\\S*/)?'+TOOL+': (?:command )?not found\\s*$','im'),missing],
 [new RegExp('^(?:sh|bash|zsh): (?:\\S*/)?'+TOOL+': (?:command )?not found\\s*$','im'),missing],
 [new RegExp('^(?:g?make(?:\\[\\d+\\])?): (?:\\S*/)?'+TOOL+': (?:Command not found|No such file or directory)\\s*$','im'),missing],
 [new RegExp('^\'"?(?:[^\'"\\n]*[\\\\/])?'+TOOL+'"?\' is not recognized as an internal or external command','im'),missing],
 [new RegExp('^process_begin: CreateProcess\\(NULL, (?:\\S*[\\\\/])?'+TOOL+'\\b[^\\n]*\\) failed','im'),missing],
 [/^Error: Unable to access jarfile (\S+)\s*$/im,m=>'O Java não encontrou '+m[1]+'; o toolkit está incompleto.'],
 [/^g?make(?:\[\d+\])?: (?:\*\*\* )?(?:\S*makefile\.gen: No such file or directory|No rule to make target '[^']*makefile\.gen')/im,()=>'O makefile do SGDK não foi encontrado; confira o caminho do toolkit.'],
 [/^ModuleNotFoundError: No module named '(PIL|Pillow)'\s*$/m,()=>'O módulo Python “Pillow” não está instalado nesta máquina (a exportação de mapas usa imagens).'],
 [/No space left on device/i,()=>'O disco está cheio.'],
 [/^(?:Exception in thread "main" )?java\.lang\.UnsupportedClassVersionError|Unsupported major\.minor version/im,()=>'A versão do Java instalada é antiga demais para o rescomp.']
]
const GAME=[
 [/(?:^|\n)([^\s:][^:\n]*\.(?:c|h|s|asm|res)):(\d+)(?::\d+)?: (?:fatal )?error/i,m=>'Erro no código ou nos recursos do jogo: '+m[1]+', linha '+m[2]+'.'],
 [/undefined reference to [`']([^'`]+)'/,m=>'O jogo usa “'+m[1]+'”, que não foi definido em nenhum arquivo compilado.'],
 [/multiple definition of [`']([^'`]+)'/,m=>'“'+m[1]+'” está definido mais de uma vez no jogo.'],
 [/region [`']?rom'? overflowed|will not fit in region/i,()=>'A ROM ficou maior do que o espaço disponível.'],
 [/Error: (?:cannot compile|.*resource)[^\n]*/i,m=>'O rescomp recusou um recurso do jogo: '+m[0].slice(0,160)],
 [/Validação d[oae]s? [^:\n]+: [^\n]+/,m=>m[0]]
]
/** Whose problem a failed build is. Environment patterns win: a missing tool also
 * produces follow-up errors that look like the game's. */
export function classifyBuildFailure(output){
 const text=String(output||'')
 for(const [pattern,describe] of ENVIRONMENT){const match=text.match(pattern);if(match)return {scope:'environment',message:describe(match)}}
 for(const [pattern,describe] of GAME){const match=text.match(pattern);if(match)return {scope:'game',message:describe(match)}}
 return {scope:'unknown',message:'A saída do build não indica se o problema é da ferramenta ou do jogo.'}
}
