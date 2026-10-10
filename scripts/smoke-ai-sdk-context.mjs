import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSdkApiBlock, isSgdkProject } from '../electron/ai/sdk/sgdkApi.js'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-sdk-context-'))
try {
  const project = path.join(temporary, 'game')
  const inc = path.join(temporary, 'sdk', 'inc')
  fs.mkdirSync(project, { recursive: true })
  fs.mkdirSync(inc, { recursive: true })
  fs.writeFileSync(path.join(inc, 'genesis.h'), '#define SGDK_VERSION 1.81\n')
  fs.writeFileSync(path.join(inc, 'vdp_tile.h'), '/* Wrong: void VDP_loadTileSet(nope); */\nu16 VDP_loadTileSet(const TileSet *tileset, u16 index, TransferMethod tm);\n')
  fs.writeFileSync(path.join(inc, 'vdp_bg.h'), 'void VDP_setHorizontalScroll(VDPPlane plane, s16 value);\n')
  fs.writeFileSync(path.join(project, 'retro-studio.json'), JSON.stringify({
    template: 'sgdk-skeleton', apiKey: 'SECRET_DO_NOT_INCLUDE', assets: [{ id: 'a' }],
    retroStudio: { contractVersion: 1, target: { platform: 'megadrive', sdk: 'sgdk', videoMode: 'H40', region: 'pal' },
      adapter: { id: 'my-adapter', version: 1, capabilities: ['map.bg'] }, modules: [] }
  }))
  fs.mkdirSync(path.join(project, '.retrostudio'))
  fs.writeFileSync(path.join(project, '.retrostudio', 'last-acp-build.json'), JSON.stringify({
    action: 'build', success: false, at: 1700000000000, stderr: 'SECRET_BUILD_LOG', env: { token: 'SECRET_ENV' }
  }))
  assert.equal(isSgdkProject(project), true)
  const body = getSdkApiBlock({ workspacePath: project, toolkitPath: path.join(temporary, 'sdk') })
  assert.ok(body.includes('SGDK 1.81'))
  assert.ok(body.includes('my-adapter'))
  assert.ok(body.includes('H40, pal'))
  assert.ok(body.includes('u16 VDP_loadTileSet(const TileSet *tileset, u16 index, TransferMethod tm);'))
  assert.ok(body.includes('VDP_setHorizontalScroll(VDPPlane plane, s16 value);'))
  assert.ok(!body.includes('nope'))
  assert.ok(!body.includes('XGM2_play('))
  assert.ok(!body.includes('SECRET'))
  assert.ok(body.includes('falha'))
  assert.ok(body.length < 3900)
  // #43: natureza dos números, módulos instalados e recibo do último build.
  assert.ok(body.includes('ESTIMATIVA') && body.includes('DADO COMPILADO') && body.includes('MEDIÇÃO'))
  assert.ok(body.includes('Sem registro de instalação de módulos de runtime'))
  assert.ok(body.includes('Sem registro de build da IDE'))
  fs.writeFileSync(path.join(project, '.retrostudio', 'runtime-installation.json'), JSON.stringify({ version: 1, token: 'SECRET_RECORD', modules: [
    { id: 'core', version: 1, files: [{ target: 'src/retro_runtime/core/SECRET_FILE.h' }] }, { id: 'audio', version: 1, files: [] },
    { id: 'SECRET MODULE', version: 1, files: [] }, { id: 'debug', version: 'SECRET_VERSION', files: [] }] }))
  fs.mkdirSync(path.join(project, '.retro-studio', 'builds'), { recursive: true })
  fs.mkdirSync(path.join(project, 'src'))
  fs.writeFileSync(path.join(project, 'src', 'main.c'), 'int main(void){return 0;}\n')
  const receiptFile = path.join(project, '.retro-studio', 'builds', 'latest.json')
  // Fontes e ROM mais antigas que o recibo, como depois de um build real.
  const past = new Date(Date.now() - 3600000)
  fs.utimesSync(path.join(project, 'src', 'main.c'), past, past)
  fs.mkdirSync(path.join(project, 'out'))
  fs.writeFileSync(path.join(project, 'out', 'rom.bin'), Buffer.alloc(131072))
  fs.utimesSync(path.join(project, 'out', 'rom.bin'), past, past)
  const receipt = { version: 1, producer: 'retro-studio-build', finishedAt: new Date(Date.now() - 1800000).toISOString(), note: 'SECRET_RECEIPT', inputStability: 'unchanged-between-observations',
    inputs: [{ path: 'src/main.c', hash: 'SECRET_HASH', size: 26 }], outputs: [{ path: 'out/rom.bin', hash: 'SECRET_HASH', size: 131072 }] }
  fs.writeFileSync(receiptFile, JSON.stringify(receipt))
  let withBuild = getSdkApiBlock({ workspacePath: project, toolkitPath: path.join(temporary, 'sdk') })
  assert.ok(withBuild.includes('instalados (src/retro_runtime): core v1, audio v1; 2 entrada(s) do registro não listada(s)'))
  assert.ok(withBuild.includes('ROM de 131072 bytes (dado compilado)') && withBuild.includes('Nenhuma entrada padrão com data ou tamanho diferentes'))
  assert.ok(!withBuild.includes('SECRET'))
  fs.writeFileSync(path.join(project, 'src', 'main.c'), 'int main(void){return 1; /* editado */}\n')
  withBuild = getSdkApiBlock({ workspacePath: project, toolkitPath: path.join(temporary, 'sdk') })
  assert.ok(withBuild.includes('1 arquivo(s) de entrada com data ou tamanho diferentes desde então: a ROM pode estar desatualizada.'))
  // Revisão da #43: o bloco não afirma o que o disco não confirma.
  const block = () => getSdkApiBlock({ workspacePath: project, toolkitPath: null })
  const write = value => fs.writeFileSync(receiptFile, JSON.stringify(value))
  fs.utimesSync(path.join(project, 'src', 'main.c'), past, past)
  write({ ...receipt, inputs: [{ path: 'src/main.c', size: 40 }, { path: '..gen.c', size: 1 }] })
  assert.ok(block().includes('1 arquivo(s) de entrada'), 'nome começando por ".." é um arquivo do projeto (ausente), não uma fuga')
  write({ ...receipt, inputs: [] })
  assert.ok(block().includes('O recibo não lista entradas: não há como dizer se as fontes mudaram.'))
  write({ ...receipt, inputs: [{ path: 'src/main.c', size: 40 }], inputStability: 'changed-during-build' })
  assert.ok(block().includes('Entradas mudaram durante aquele build'))
  for (const size of [99999999999, -5, 4096]) {
    write({ ...receipt, inputs: [{ path: 'src/main.c', size: 40 }], outputs: [{ path: 'out/rom.bin', size }] })
    assert.ok(!block().includes('dado compilado') && (size < 0 || block().includes('A ROM registrada não está mais no disco')), 'tamanho de ROM sem lastro: ' + size)
  }
  // Entrada que é symlink para fora nunca é consultada como se fosse do projeto.
  fs.writeFileSync(path.join(temporary, 'outside-input.c'), 'int outside;\n')
  fs.utimesSync(path.join(temporary, 'outside-input.c'), past, past)
  fs.symlinkSync(path.join(temporary, 'outside-input.c'), path.join(project, 'src', 'link.c'))
  write({ ...receipt, inputs: [{ path: 'src/link.c', size: 13 }] })
  assert.ok(block().includes('1 arquivo(s) de entrada'))
  // Registro de módulos truncado ou adulterado não vira "nenhum módulo".
  const recordFile = path.join(project, '.retrostudio', 'runtime-installation.json'), recordBackup = fs.readFileSync(recordFile)
  fs.writeFileSync(recordFile, '{"modules":[{"id":"core","version":1}')
  assert.ok(block().includes('Registro de módulos de runtime ilegível') && !block().includes('não use funções retro*'))
  fs.writeFileSync(recordFile, JSON.stringify({ modules: [] }))
  assert.ok(block().includes('Registro de runtime sem módulos instalados'))
  fs.writeFileSync(recordFile, JSON.stringify({ modules: [{ id: 'My_Module.v2', version: 2 }] }))
  assert.ok(block().includes('My_Module.v2 v2. Só eles constam no registro'))
  fs.writeFileSync(recordFile, recordBackup)
  // Recibo de outro produtor, com caminho fora do projeto, data inválida ou futura não vira afirmação.
  for (const bad of [{ ...receipt, producer: 'outro' }, { ...receipt, inputs: [{ path: '../outside.json', size: 1 }] }, { ...receipt, finishedAt: 'ontem' }, { ...receipt, finishedAt: '2999-01-01T00:00:00.000Z' }]) {
    fs.writeFileSync(receiptFile, JSON.stringify(bad))
    assert.ok(getSdkApiBlock({ workspacePath: project, toolkitPath: null }).includes('Sem registro de build da IDE'))
  }
  fs.unlinkSync(receiptFile)
  fs.writeFileSync(path.join(temporary, 'outside-receipt.json'), JSON.stringify(receipt))
  fs.symlinkSync(path.join(temporary, 'outside-receipt.json'), receiptFile)
  assert.ok(getSdkApiBlock({ workspacePath: project, toolkitPath: null }).includes('Sem registro de build da IDE'))
  // SGDK 2.x guarda os drivers de som em inc/snd/: o XGM2 só aparece quando o SDK configurado o declara.
  const sdk2 = path.join(temporary, 'sdk2', 'inc')
  fs.mkdirSync(path.join(sdk2, 'snd'), { recursive: true })
  fs.writeFileSync(path.join(sdk2, 'genesis.h'), '#define SGDK_VERSION    2.00\n')
  fs.writeFileSync(path.join(sdk2, 'snd', 'xgm2.h'), 'bool XGM2_play(const u8 *song);\n')
  const second = getSdkApiBlock({ workspacePath: project, toolkitPath: path.join(temporary, 'sdk2') })
  assert.ok(second.includes('SGDK 2.00') && second.includes('bool XGM2_play(const u8 *song);'))
  assert.ok(getSdkApiBlock({ workspacePath: project, toolkitPath: null }).includes('Headers locais indisponíveis'))
  // Workspace symlinks must not add arbitrary outside config/log contents.
  fs.unlinkSync(path.join(project, 'retro-studio.json'))
  fs.writeFileSync(path.join(temporary, 'outside.json'), '{"secret":"SECRET_OUTSIDE"}')
  fs.symlinkSync(path.join(temporary, 'outside.json'), path.join(project, 'retro-studio.json'))
  assert.ok(!getSdkApiBlock({ workspacePath: project, toolkitPath: null }).includes('SECRET_OUTSIDE'))
  const agent = fs.readFileSync(new URL('../electron/ai/agent.js', import.meta.url), 'utf8')
  assert.ok(!agent.includes('64 tiles/linha, 512 tiles VRAM'))
  assert.ok(agent.includes('H32: até 64'))
  assert.ok(agent.includes('240 linhas (V30) só em PAL') && agent.includes('áudio: ${result.sounds.join'))
  const tools = fs.readFileSync(new URL('../electron/ai/tools.js', import.meta.url), 'utf8')
  assert.ok(tools.includes("['XGM', 'XGM2', 'VGM', 'WAV', 'SGDK']"))
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
console.log('Contexto IA: versão local, assinaturas, capacidades, módulos, recibo de build, natureza dos números e proteção de dados conferidos.')
