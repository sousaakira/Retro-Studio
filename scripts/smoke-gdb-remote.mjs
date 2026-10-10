// #64: protocolo remoto do GDB — pacotes, escape, repetição, fluxo com ruído e registros do 68000.
import assert from 'node:assert/strict'
import {encodePacket,decodeBody,parseStream,checksum,hexToBytes,bytesToHex,parseM68kRegisters,parseStopReply,commands,M68K_REGISTERS} from '../shared/retro/gdbRemote.js'
assert.equal(encodePacket('g'),'$g#67');assert.equal(encodePacket('?'),'$?#3f');assert.equal(encodePacket('m100,10'),'$m100,10#8b')
assert.equal(checksum(''),'00');assert.equal(encodePacket('a#b$c}d*e'),'$a}\x03b}\x04c}]d}\x0ae#'+checksum('a}\x03b}\x04c}]d}\x0ae'))
assert.equal(decodeBody('a}\x03b}\x04c}]d}\x0ae'),'a#b$c}d*e');assert.equal(decodeBody('0* '),'0000','"0* " = 0 repetido mais 3 vezes');assert.equal(decodeBody('ab*"c'),'abbbbbbc')
assert.throws(()=>decodeBody('a*\x10'),/run length/);assert.equal(decodeBody('*x'),'*x','repetição sem caractere anterior é texto')
// Fluxo: confirmações, ruído do emulador, pacotes colados, pacote partido e soma errada.
let state=parseStream('+$S05#b8lixo do emulador\n$OK#9a+-$1234#ca$incompl')
assert.deepEqual(state.events,[{type:'ack'},{type:'packet',data:'S05'},{type:'packet',data:'OK'},{type:'ack'},{type:'nak'},{type:'packet',data:'1234'}]);assert.equal(state.rest,'$incompl')
state=parseStream(state.rest+'eto#');assert.deepEqual(state.events,[]);assert.equal(state.rest,'$incompleto#')
state=parseStream(state.rest+checksum('incompleto'));assert.deepEqual(state.events,[{type:'packet',data:'incompleto'}]);assert.equal(state.rest,'')
assert.deepEqual(parseStream('$OK#00').events,[{type:'bad'}]);assert.deepEqual(parseStream('$S05#B8').events,[{type:'packet',data:'S05'}],'soma em maiúsculas, como o BlastEm envia')
assert.deepEqual(parseStream('').events,[]);assert.equal(parseStream('$a#6').rest,'$a#6')
assert.deepEqual([...hexToBytes('53454741')],[0x53,0x45,0x47,0x41]);assert.equal(bytesToHex(Uint8Array.from([0,255,16])),'00ff10');assert.throws(()=>hexToBytes('abc'));assert.throws(()=>hexToBytes('zz'))
// Registros: resposta real do BlastEm 0.6.3 logo depois de iniciar.
const real='000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000E10000000000270000000200'
const registers=parseM68kRegisters(real);assert.deepEqual(Object.keys(registers),[...M68K_REGISTERS]);assert.deepEqual([registers.d0,registers.a7,registers.sr,registers.pc],[0,0xE1000000,0x2700,0x200])
assert.throws(()=>parseM68kRegisters('E01'),/refused/);assert.throws(()=>parseM68kRegisters('00'),/Unexpected/);assert.throws(()=>parseM68kRegisters('zz'.repeat(72)),/Unexpected/)
assert.deepEqual(parseStopReply('S05'),{kind:'stopped',signal:5,reason:'breakpoint-or-step'});assert.equal(parseStopReply('T02thread:1;').reason,'interrupted');assert.equal(parseStopReply('S0b').reason,'signal')
assert.deepEqual([parseStopReply('W00').kind,parseStopReply('X09').kind,parseStopReply('').kind,parseStopReply('E01').kind,parseStopReply('qualquer').kind],['exited','exited','unsupported','error','unknown'])
assert.equal(commands.readMemory(0x100,16),'m100,10');assert.equal(commands.breakpoint(0x602,true),'Z0,602,2');assert.equal(commands.breakpoint(0x602,false),'z0,602,2');assert.equal(commands.readMemory(0xFFFF0000,2),'mffff0000,2')
console.log('GDB remote: packets, escaping, run length, noisy streams, split packets, bad checksums, 68000 registers and stop replies passed.')
