// #89: BLE-MIDI parser and MIDI decoder. Packets 1 and 2 are real captures from an M-Vave SMK-25 V2.
import assert from 'node:assert/strict'
import { createBleMidiParser, decodeMidiMessage, midiDataLength, midiNoteName, midiBindingFor, midiBindingMatches, MIDI_SYSEX_LIMIT, createPortDeduper } from '../shared/retro/midi.js'

const parse = createBleMidiParser()
const events = packet => parse(Uint8Array.from(packet)).map(message => decodeMidiMessage(message.data))

assert.deepEqual(events([0x80, 0x80, 0x90, 0x30, 0x37]), [{ type: 'note-on', channel: 0, note: 48, velocity: 55 }], 'SMK-25 note-on')
assert.deepEqual(events([0x80, 0x80, 0x80, 0x34, 0x40]), [{ type: 'note-off', channel: 0, note: 52, velocity: 64 }], 'SMK-25 note-off')
assert.deepEqual(events([0x80, 0x80, 0x90, 0x3c, 0x00]), [{ type: 'note-off', channel: 0, note: 60, velocity: 0 }], 'velocity 0 is note-off')

// Header 0x81 + low 0x85 → 133 ms; second message with its own timestamp, third by running status.
const chord = parse(Uint8Array.from([0x81, 0x85, 0x90, 60, 100, 0x86, 0x90, 64, 90, 67, 80]))
assert.deepEqual(chord.map(m => m.timestamp), [133, 134, 134])
assert.deepEqual(chord.map(m => m.data), [[0x90, 60, 100], [0x90, 64, 90], [0x90, 67, 80]])

// Low timestamp wrap inside one packet advances the high part.
assert.deepEqual(parse(Uint8Array.from([0x80, 0xfe, 0x90, 60, 1, 0x82, 0x80, 60, 0])).map(m => m.timestamp), [126, 130])

// Real-time clock interleaved inside a note message does not break it.
assert.deepEqual(parse(Uint8Array.from([0x80, 0x80, 0x90, 60, 0x81, 0xf8, 100])).map(m => m.data), [[0xf8], [0x90, 60, 100]])

// Controls the editor learns: knobs (CC), pitch wheel, mod wheel.
assert.deepEqual(events([0x80, 0x80, 0xb0, 1, 64]), [{ type: 'control-change', channel: 0, controller: 1, value: 64 }])
assert.deepEqual(events([0x80, 0x80, 0xe0, 0x00, 0x40]), [{ type: 'pitch-bend', channel: 0, value: 0 }])
assert.deepEqual(events([0x80, 0x80, 0xe0, 0x7f, 0x7f]), [{ type: 'pitch-bend', channel: 0, value: 8191 }])
assert.deepEqual(events([0x80, 0x80, 0xc9, 5]), [{ type: 'program-change', channel: 9, program: 5 }])
assert.deepEqual(events([0x80, 0x80, 0xd0, 30]), [{ type: 'channel-pressure', channel: 0, value: 30 }])

// SysEx split across two packets; the end F7 follows a timestamp byte.
const split = createBleMidiParser()
assert.deepEqual(split(Uint8Array.from([0x80, 0x80, 0xf0, 0x7e, 0x7f])), [])
assert.deepEqual(split(Uint8Array.from([0x80, 0x06, 0x01, 0x81, 0xf7])).map(m => m.data), [[0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]])
const big = createBleMidiParser()
big(Uint8Array.from([0x80, 0x80, 0xf0, ...new Array(MIDI_SYSEX_LIMIT + 50).fill(1)]))
assert.equal(big(Uint8Array.from([0x80, 0x80, 0xf7]))[0].data.length, MIDI_SYSEX_LIMIT + 1, 'SysEx is capped')

// Malformed packets are ignored instead of throwing.
for (const packet of [[], [0x80], [0x00, 0x80, 0x90, 1, 1], [0xc0, 0x80, 0x90, 1, 1]]) assert.deepEqual(parse(Uint8Array.from(packet)), [])
assert.deepEqual(createBleMidiParser()(Uint8Array.from([0x80, 0x40, 0x10])), [], 'data without running status is dropped')
assert.equal(decodeMidiMessage([0x40]), null)

assert.equal(midiDataLength(0x90), 2)
assert.equal(midiDataLength(0xc3), 1)
assert.equal(midiDataLength(0xf8), 0)
assert.equal(midiDataLength(0xf4), -1)
assert.equal(midiNoteName(60), 'C4')
assert.equal(midiNoteName(48), 'C3')
assert.equal(midiNoteName(61), 'C#4')

const knob = midiBindingFor({ type: 'control-change', channel: 0, controller: 21, value: 3 })
assert.ok(midiBindingMatches(knob, { type: 'control-change', channel: 0, controller: 21, value: 90 }))
assert.ok(!midiBindingMatches(knob, { type: 'control-change', channel: 0, controller: 22, value: 90 }))
assert.ok(midiBindingMatches(midiBindingFor({ type: 'pitch-bend', channel: 0, value: 5 }), { type: 'pitch-bend', channel: 0, value: -100 }))
assert.equal(midiBindingFor({ type: 'note-on', channel: 0, note: 60, velocity: 1 }), null)
// USB: o SMK-25 manda cada mensagem pela porta 0 (Private) e pela 1 (Master) — captura real com aseqdump.
{
  const accept = createPortDeduper()
  const smk = [[0, 0, [0x90, 64, 59]], [1, 0.4, [0x90, 64, 59]], [0, 120, [0x90, 52, 91]], [0, 300, [0x80, 52, 64]], [1, 120.3, [0x90, 52, 91]], [1, 300.2, [0x80, 52, 64]]]
  const passed = smk.filter(([port, time, data]) => accept('Jieli Technology|SINCO', port, time, data)).map(([port, , data]) => port + ':' + data.join(','))
  assert.deepEqual(passed, ['0:144,64,59', '0:144,52,91', '0:128,52,64'], 'each key once, from the first port that delivered it')
  const same = createPortDeduper()
  assert.ok(same('a', 0, 0, [0x90, 60, 100]) && same('a', 0, 5, [0x90, 60, 100]), 'the same port is never filtered (fast repeated notes)')
  assert.ok(same('a', 1, 700, [0x90, 60, 100]), 'another port after the window is a new message')
  assert.ok(same('b', 2, 700.1, [0x90, 60, 100]), 'another keyboard is never filtered')
  assert.ok(same('a', 1, 701, [0x90, 61, 100]), 'a different message passes')
  // Porta 1 chega em bloco, depois de a porta 0 já ter tocado a mesma nota duas vezes (C4 rápido).
  const late = createPortDeduper(), on = [0x90, 60, 90], off = [0x80, 60, 64]
  const order = [[0, 0, on], [0, 80, off], [0, 160, on], [0, 240, off], [1, 250, on], [1, 251, off], [1, 252, on], [1, 253, off]]
  assert.deepEqual(order.map(([port, time, data]) => late('k', port, time, data)), [true, true, true, true, false, false, false, false], 'a delayed block from the mirror port is dropped whole')
}
console.log('ble-midi smoke passed')
