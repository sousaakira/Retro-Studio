// #89: importação/exportação de instrumentos (TFI, DMP, FUI novo e antigo, OPNI, WOPN). Os bytes de teste
// são montados aqui a partir da especificação (fileOpsIns.cpp e papers/*.md do Furnace): operadores na
// ordem dos registradores (S1, S3, S2, S4) e detune na escala do Furnace (3 = centro) nos formatos de tracker.
import assert from 'node:assert/strict'
import { importInstrumentFile, exportInstrument, instrumentIdFor, songInstrument } from '../shared/retro/instrumentFormats.js'
import { PRESET_INSTRUMENTS, validateInstrument } from '../shared/retro/chipInstruments.js'

// Operadores distintos por posição no arquivo: TL 10, 20, 30, 40 e MUL 1..4.
const fileOp = position => ({ mul: position + 1, tl: (position + 1) * 10, ar: 31 - position, d1r: 5 + position, d2r: position, rr: 8 + position, sl: position + 2, ks: position % 4, am: position & 1, ssg: 0 })
const ascii = text => [...text].map(c => c.charCodeAt(0))
const pad = (bytes, size) => [...bytes, ...new Array(size - bytes.length).fill(0)]
// Arquivo [S1, S3, S2, S4] → modelo [S1, S2, S3, S4]: TL esperado 10, 30, 20, 40.
const expectOrder = instrument => {
  assert.deepEqual(instrument.ops.map(op => op.tl), [10, 30, 20, 40], 'S2/S3 swapped from register order')
  assert.deepEqual(instrument.ops.map(op => op.mul), [1, 3, 2, 4])
}

// TFI: alg, fb, 4 × (mul, dt, tl, rs, ar, dr, d2r, rr, sl, ssg). Detune 3 = centro, 0 = −3, 6 = +3.
{
  const dts = [3, 0, 6, 4]
  const bytes = [4, 5, ...[0, 1, 2, 3].flatMap(p => { const o = fileOp(p); return [o.mul, dts[p], o.tl, o.ks, o.ar, o.d1r, o.d2r, o.rr, o.sl, o.ssg] })]
  const { instruments } = importInstrumentFile('Baixo.tfi', Uint8Array.from(bytes))
  const [ins] = instruments
  assert.equal(ins.name, 'Baixo'); assert.equal(ins.alg, 4); assert.equal(ins.fb, 5)
  expectOrder(ins)
  // Registrador: 0 = sem detune, 7 = −3, 3 = +3, 1 = +1. Arquivo [3,0,6,4] → S1 0, S3 7, S2 3, S4 1.
  assert.deepEqual(ins.ops.map(op => op.dt), [0, 3, 7, 1])
  assert.ok(ins.ops.every(op => op.am === 0), 'TFI has no AM bit')
  assert.throws(() => importInstrumentFile('x.tfi', new Uint8Array(41)), /42 bytes/)
}

// DMP v11 (Genesis, FM): versão, sistema, modo, PMS, FB, ALG, AMS e 4 × 11 bytes.
{
  const bytes = [11, 2, 1, 3, 6, 2, 1, ...[0, 1, 2, 3].flatMap(p => { const o = fileOp(p); return [o.mul, o.tl, o.ar, o.d1r, o.sl, o.rr, o.am, o.ks, 3 | (1 << 4), o.d2r, 0] })]
  assert.equal(bytes.length, 51)
  const [ins] = importInstrumentFile('Orgao.dmp', Uint8Array.from(bytes)).instruments
  assert.equal(ins.alg, 2); assert.equal(ins.fb, 6); assert.equal(ins.pms, 3); assert.equal(ins.ams, 1)
  expectOrder(ins)
  assert.ok(ins.ops.every(op => op.dt === 0), 'DT2 in the high nibble is ignored, 3 = no detune')
  assert.deepEqual(ins.ops.map(op => op.am), [0, 0, 1, 1])
  assert.throws(() => importInstrumentFile('x.dmp', Uint8Array.from([11, 4, 1])), /outro sistema/)
  // DMP do PSG (SMS): macro de volume 15, 12, 9, 9 vira envelope.
  const psg = importInstrumentFile('Pluck.dmp', Uint8Array.from([11, 3, 0, 4, ...[15, 12, 9, 9].flatMap(v => [v, 0, 0, 0]), 0xff]))
  assert.deepEqual(psg.instruments[0].envelope, { volume: 0, attack: 0, decay: 3, sustain: 6, release: 2 })
  assert.match(psg.warnings[0], /aproximado/)
}

// OPNI: bytes crus de registrador; detune já no formato do YM2612.
const rawOp = (o, dt) => [(dt << 4) | o.mul, o.tl, (o.ks << 6) | o.ar, (o.am << 7) | o.d1r, o.d2r, (o.sl << 4) | o.rr, 0]
const opniRecord = (name, dts = [0, 5, 3, 7]) => [...pad(new TextEncoder().encode(name), 32), 0, 0, 0, (3 << 3) | 5, (2 << 4) | 4, ...[0, 1, 2, 3].flatMap(p => rawOp(fileOp(p), dts[p]))]
{
  const bytes = [...ascii('WOPN2-INST'), 0, 2, 0, 0, ...opniRecord('Sino OPN'), 0, 0, 0, 0]
  const [ins] = importInstrumentFile('qualquer.opni', Uint8Array.from(bytes)).instruments
  assert.equal(ins.name, 'Sino OPN'); assert.equal(ins.alg, 5); assert.equal(ins.fb, 3); assert.equal(ins.ams, 2); assert.equal(ins.pms, 4)
  expectOrder(ins)
  assert.deepEqual(ins.ops.map(op => op.dt), [0, 3, 5, 7], 'OPNI detune is the raw register value')
  // Versão 1 (sem campo de versão).
  const v1 = importInstrumentFile('v1.opni', Uint8Array.from([...ascii('WOPN2-INST'), 0, 0, ...opniRecord('V1')]))
  assert.equal(v1.instruments[0].name, 'V1')
}

// WOPN v2: 1 banco melódico + 1 de percussão, 128 patches cada; patches vazios ficam de fora.
{
  const empty = new Array(69).fill(0)
  const melodic = Array.from({ length: 128 }, (_, index) => index === 0 ? [...opniRecord('Piano GM'), 0, 0, 0, 0] : index === 33 ? [...opniRecord(''), 0, 0, 0, 0] : empty).flat()
  const percussion = Array.from({ length: 128 }, (_, index) => index === 35 ? [...opniRecord('Bumbo'), 0, 0, 0, 0] : empty).flat()
  const bytes = [...ascii('WOPN2-BANK'), 0, 2, 0, 0, 1, 0, 1, 0, ...new Array(68).fill(0), ...melodic, ...percussion]
  const { instruments } = importInstrumentFile('Banco.wopn', Uint8Array.from(bytes))
  assert.deepEqual(instruments.map(item => item.name), ['Piano GM', 'Banco 34', 'Bumbo'])
  instruments.forEach(expectOrder)
}

// FUI novo (FINS): recursos NA e FM; versão >= 224 tem o byte de bloco.
const fuiOps = (dts = [3, 3, 3, 3]) => [0, 1, 2, 3].flatMap(p => { const o = fileOp(p); return [(dts[p] << 4) | o.mul, o.tl, (o.ks << 6) | o.ar, (o.am << 7) | o.d1r, o.d2r, (o.sl << 4) | o.rr, 0, 0] })
const feature = (code, data) => [...ascii(code), data.length & 0xff, data.length >> 8, ...data]
for (const version of [189, 224]) {
  const fm = [0xf4, (3 << 4) | 7, (1 << 3) | 2, 0, ...(version >= 224 ? [0] : []), ...fuiOps([0, 3, 6, 3])]
  const bytes = [...ascii('FINS'), version & 0xff, version >> 8, 1, 0, ...feature('NA', [...ascii('Lead Furnace'), 0]), ...feature('FM', fm), ...ascii('EN')]
  const { instruments, warnings } = importInstrumentFile('x.fui', Uint8Array.from(bytes))
  const [ins] = instruments
  assert.equal(ins.name, 'Lead Furnace'); assert.equal(ins.alg, 3); assert.equal(ins.fb, 7); assert.equal(ins.ams, 1); assert.equal(ins.pms, 2)
  expectOrder(ins)
  assert.deepEqual(ins.ops.map(op => op.dt), [7, 3, 0, 0], 'FUI version ' + version + ': Furnace detune scale')
  assert.match(warnings[0], /Macros/)
}
// FUI de SN76489: recurso MA, macro 0 (volume) em 8 bits → envelope. A macro 1 (arpejo, 8 bits com sinal) é ignorada.
{
  const macro = (code, values, flags = 0) => [code, values.length, 255, 255, 0, flags, 0, 1, ...values.map(v => v & 0xff)]
  const ma = [8, 0, ...macro(1, [0, 12, -12], 1 << 6), ...macro(0, [15, 13, 11, 11]), 255]
  const bytes = [...ascii('FINS'), 224, 0, 0, 0, ...feature('NA', [...ascii('Pluck PSG'), 0]), ...feature('MA', ma), ...ascii('EN')]
  const { instruments, warnings } = importInstrumentFile('p.fui', Uint8Array.from(bytes))
  assert.deepEqual(instruments[0], { name: 'Pluck PSG', kind: 'psg', envelope: { volume: 0, attack: 0, decay: 3, sustain: 4, release: 2 } })
  assert.match(warnings[0], /aproximado/)
}
assert.throws(() => importInstrumentFile('opl.fui', Uint8Array.from([...ascii('FINS'), 224, 0, 14, 0])), /não é do Mega Drive/)

// DMP do Neo Geo (YM2610, o mesmo FM OPN) entra; do YM2151 (arcade) não. Nome com mais de 64 caracteres é cortado.
{
  const fmBody = [3, 6, 2, 1, ...[0, 1, 2, 3].flatMap(p => { const o = fileOp(p); return [o.mul, o.tl, o.ar, o.d1r, o.sl, o.rr, o.am, o.ks, 3, o.d2r, 0] })]
  expectOrder(importInstrumentFile('neo.dmp', Uint8Array.from([11, 9, 1, ...fmBody])).instruments[0])
  assert.throws(() => importInstrumentFile('opm.dmp', Uint8Array.from([11, 8, 1, ...fmBody])), /YM2151/)
  const long = 'Nome muito comprido '.repeat(5)
  assert.equal(importInstrumentFile(long + '.dmp', Uint8Array.from([11, 2, 1, ...fmBody])).instruments[0].name.length, 64)
}

// FUI antigo (-Furnace instr.-): cabeçalho de 32 bytes, bloco INST e 4 operadores de 32 bytes.
{
  const ops = [0, 1, 2, 3].flatMap(p => { const o = fileOp(p); return [o.am, o.ar, o.d1r, o.mul, o.rr, o.sl, o.tl, 0, o.ks, p === 1 ? 0 : 3, o.d2r, 0, ...new Array(20).fill(0)] })
  const inst = [...ascii('INST'), 0, 0, 0, 0, 100, 0, 1, 0, ...ascii('Antigo'), 0, 6, 2, 3, 1, 4, 0, 0, 0, ...ops]
  const bytes = [...ascii('-Furnace instr.-'), 100, 0, 0, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...inst]
  const [ins] = importInstrumentFile('velho.fui', Uint8Array.from(bytes)).instruments
  assert.equal(ins.name, 'Antigo'); assert.equal(ins.alg, 6); assert.equal(ins.fb, 2); assert.equal(ins.pms, 3); assert.equal(ins.ams, 1)
  expectOrder(ins)
  assert.deepEqual(ins.ops.map(op => op.dt), [0, 0, 7, 0])
}

// Exportar e importar de volta preserva o patch (TFI não guarda AM).
for (const preset of PRESET_INSTRUMENTS.filter(item => item.kind === 'fm')) {
  for (const format of ['tfi', 'dmp', 'opni', 'fui']) {
    const back = importInstrumentFile('x.' + format, exportInstrument(preset, format)).instruments[0]
    const expected = format === 'tfi' ? preset.ops.map(op => ({ ...op, am: 0 })) : preset.ops
    assert.deepEqual(back.ops, expected, preset.id + ' → ' + format)
    assert.deepEqual([back.alg, back.fb], [preset.alg, preset.fb])
    if (format !== 'tfi') assert.deepEqual([back.ams, back.pms], [preset.ams, preset.pms])
    if (format === 'opni' || format === 'fui') assert.equal(back.name, preset.name)
  }
}
assert.equal(exportInstrument(PRESET_INSTRUMENTS[0], 'tfi').length, 42)
assert.equal(exportInstrument(PRESET_INSTRUMENTS[0], 'dmp').length, 51)
assert.throws(() => exportInstrument(PRESET_INSTRUMENTS.find(item => item.kind === 'psg'), 'tfi'), /Só instrumentos FM/)

// IDs na música: livres, sem colidir com o banco pronto.
assert.equal(instrumentIdFor('Baixo Ácido!', []), 'meu-baixo-acido')
assert.equal(instrumentIdFor('Baixo Ácido', ['meu-baixo-acido']), 'meu-baixo-acido-2')
const copy = songInstrument(PRESET_INSTRUMENTS[0], [])
assert.equal(copy.id, 'meu-piano-eletrico'); assert.equal(copy.category, 'Da música')
assert.doesNotThrow(() => validateInstrument(copy))
assert.throws(() => importInstrumentFile('x.mid', new Uint8Array(4)), /não reconhecido/)
console.log('instrument-formats smoke passed: TFI, DMP (FM e PSG), OPNI, WOPN, FUI novo e antigo, exportação de ida e volta e IDs.')
