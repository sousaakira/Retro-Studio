// #89: entrada MIDI do compositor. Duas fontes, mesmo formato de evento:
// - Bluetooth LE (Web Bluetooth + parser BLE-MIDI): o SMK-25 no Linux, onde o BlueZ não cria porta ALSA;
// - Web MIDI: teclados USB e portas que o sistema já expõe (inclusive BLE no macOS).
// Estado único por janela: o editor de instrumento e o piano roll ouvem a mesma conexão.
import { reactive, readonly } from 'vue'
import { BLE_MIDI_SERVICE, BLE_MIDI_CHARACTERISTIC, createBleMidiParser, decodeMidiMessage, midiBindingFor, midiBindingMatches, createPortDeduper } from '../../shared/retro/midi.js'

const STORAGE_KEY = 'retro-studio.midi'
const MONITOR_SIZE = 40
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000]
const IGNORED = new Set(['clock', 'active-sensing'])

const state = reactive({
  sources: [],          // { id, name, kind: 'bluetooth' | 'midi', status: 'connected' | 'connecting' | 'lost' }
  choosing: false,      // seletor Bluetooth aberto
  choices: [],          // { deviceId, deviceName }
  webMidi: 'off',       // 'off' | 'on' | 'unavailable' | 'denied'
  hiddenPorts: 0,       // portas USB ocultas pelo usuário
  error: '',
  monitor: [],          // últimos eventos, mais recente primeiro
  notes: {},            // nota → velocity, teclas pressionadas agora
  bindings: {},         // ação → { type, channel, controller? }
  learning: ''          // ação aguardando o próximo knob/roda
})
const listeners = new Set()
const bluetoothDevices = new Map()
let midiAccess = null
let stopChoices = null
let monitorId = 0

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {} } catch (_) { return {} }
}
function saveSettings(patch) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSettings(), ...patch })) } catch (_) {}
}
state.bindings = loadSettings().bindings || {}

function upsertSource(source) {
  const index = state.sources.findIndex(item => item.id === source.id)
  if (index < 0) state.sources.push(source)
  else state.sources[index] = { ...state.sources[index], ...source }
}
function removeSource(id) {
  state.sources = state.sources.filter(item => item.id !== id)
}

function dispatch(source, timestamp, data) {
  const decoded = decodeMidiMessage(data)
  if (!decoded || IGNORED.has(decoded.type)) return
  const event = { ...decoded, source: source.id, sourceName: source.name, timestamp, raw: [...data] }
  if (event.type === 'note-on') state.notes[event.note] = event.velocity
  else if (event.type === 'note-off') delete state.notes[event.note]
  if (state.learning) {
    const binding = midiBindingFor(event)
    if (binding) {
      state.bindings = { ...state.bindings, [state.learning]: binding }
      saveSettings({ bindings: state.bindings })
      state.learning = ''
    }
  }
  event.actions = Object.keys(state.bindings).filter(action => midiBindingMatches(state.bindings[action], event))
  state.monitor = [{ id: ++monitorId, ...event }, ...state.monitor].slice(0, MONITOR_SIZE)
  for (const listener of listeners) {
    try { listener(event) } catch (error) { console.error('[midi] listener', error) }
  }
}

// ---- Bluetooth LE ----

function watchChoices() {
  stopChoices?.()
  // O ID do seletor (endereço no Linux) não é o device.id do Web Bluetooth: lembra-se o do seletor.
  const remembered = loadSettings().bluetoothChoice
  let chosen = false
  stopChoices = window.retroStudio?.midi?.onBluetoothDevices?.(devices => {
    state.choices = devices
    // O teclado já usado reconecta sem pedir de novo.
    if (!chosen && remembered && devices.some(device => device.deviceId === remembered)) { chosen = true; chooseBluetooth(remembered) }
  }) || null
}

/** Precisa vir de um clique: o Chromium só abre a busca Bluetooth com gesto do usuário. */
export async function connectBluetooth() {
  state.error = ''
  if (!navigator.bluetooth?.requestDevice) { state.error = 'Bluetooth indisponível nesta janela.'; return false }
  state.choosing = true
  state.choices = []
  watchChoices()
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }] })
    await openBluetooth(device)
    return true
  } catch (error) {
    if (error?.name !== 'NotFoundError') state.error = bluetoothMessage(error)
    return false
  } finally {
    state.choosing = false
    state.choices = []
    stopChoices?.()
    stopChoices = null
  }
}

export function chooseBluetooth(deviceId) {
  if (deviceId) saveSettings({ bluetoothChoice: deviceId })
  return window.retroStudio?.midi?.chooseBluetoothDevice?.(deviceId || '').catch(error => { state.error = error.message })
}

async function openBluetooth(device) {
  const id = 'ble:' + device.id
  const source = { id, name: device.name || 'Teclado Bluetooth', kind: 'bluetooth', status: 'connecting' }
  upsertSource(source)
  const previous = bluetoothDevices.get(id)
  previous?.characteristic?.removeEventListener('characteristicvaluechanged', previous.onValue)
  const parse = createBleMidiParser()
  const entry = { device, manual: false, onValue: null, characteristic: null }
  entry.onValue = event => {
    for (const message of parse(new Uint8Array(event.target.value.buffer))) dispatch(source, message.timestamp, message.data)
  }
  if (!previous) device.addEventListener('gattserverdisconnected', () => reconnectBluetooth(id))
  bluetoothDevices.set(id, entry)
  const server = await device.gatt.connect()
  const characteristic = await (await server.getPrimaryService(BLE_MIDI_SERVICE)).getCharacteristic(BLE_MIDI_CHARACTERISTIC)
  // A especificação BLE-MIDI pede uma leitura (vazia) antes das notificações; alguns teclados exigem.
  try { await characteristic.readValue() } catch (_) {}
  characteristic.addEventListener('characteristicvaluechanged', entry.onValue)
  await characteristic.startNotifications()
  entry.characteristic = characteristic
  upsertSource({ id, status: 'connected' })
}

async function reconnectBluetooth(id) {
  const entry = bluetoothDevices.get(id)
  if (!entry || entry.manual) return
  state.notes = {}
  upsertSource({ id, status: 'lost' })
  for (const delay of RECONNECT_DELAYS) {
    await new Promise(resolve => setTimeout(resolve, delay))
    if (bluetoothDevices.get(id) !== entry || entry.manual) return
    try {
      upsertSource({ id, status: 'connecting' })
      await openBluetooth(entry.device)
      return
    } catch (_) {
      upsertSource({ id, status: 'lost' })
    }
  }
}

function bluetoothMessage(error) {
  const text = String(error?.message || error)
  if (/User cancelled|chooser/i.test(text)) return ''
  if (/adapter|Bluetooth is not available|powered/i.test(text)) return 'Bluetooth desligado ou sem adaptador.'
  return 'Não foi possível conectar o teclado Bluetooth: ' + text
}

// ---- Web MIDI ----

// Portas que não são teclado: a "Midi Through" do ALSA só devolve o que outro programa manda nela.
const VIRTUAL_PORT = /^Midi Through/i
const hiddenPorts = new Set(loadSettings().hiddenPorts || [])
// O SMK-25 por USB manda cada nota pelas portas Master e Private (a segunda em blocos atrasados): uma só vale.
const acceptPort = createPortDeduper()
state.hiddenPorts = hiddenPorts.size

function syncMidiInputs() {
  if (!midiAccess) return
  const seen = new Set()
  for (const input of midiAccess.inputs.values()) {
    const id = 'midi:' + input.id
    // Desconectada (cabo puxado) sai da lista e volta sozinha; oculta pelo usuário não toca.
    if (input.state !== 'connected' || VIRTUAL_PORT.test(input.name || '') || hiddenPorts.has(input.id)) { input.onmidimessage = null; continue }
    seen.add(id)
    const source = { id, name: input.name || 'Entrada MIDI', kind: 'midi', status: 'connected' }
    upsertSource(source)
    const device = (input.manufacturer || '') + '|' + (input.name || '').replace(/\s+\S*$/, '')
    input.onmidimessage = message => { if (acceptPort(device, input.id, message.timeStamp, message.data)) dispatch(source, message.timeStamp, message.data) }
  }
  for (const source of state.sources) if (source.kind === 'midi' && !seen.has(source.id)) removeSource(source.id)
}

export async function enableWebMidi() {
  if (midiAccess) return true
  if (!navigator.requestMIDIAccess) { state.webMidi = 'unavailable'; return false }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false })
    midiAccess.onstatechange = syncMidiInputs
    state.webMidi = 'on'
    syncMidiInputs()
    return true
  } catch (_) {
    state.webMidi = 'denied'
    return false
  }
}

// ---- Geral ----

export function disconnectSource(id) {
  const entry = bluetoothDevices.get(id)
  if (entry) {
    entry.manual = true
    entry.characteristic?.removeEventListener('characteristicvaluechanged', entry.onValue)
    try { entry.device.gatt.disconnect() } catch (_) {}
    bluetoothDevices.delete(id)
    saveSettings({ bluetoothChoice: '' })
  } else if (id.startsWith('midi:')) {
    // Porta USB oculta: para de tocar e continua oculta nas próximas sessões.
    hiddenPorts.add(id.slice(5))
    saveSettings({ hiddenPorts: [...hiddenPorts] }); state.hiddenPorts = hiddenPorts.size
    const input = midiAccess?.inputs.get(id.slice(5))
    if (input) input.onmidimessage = null
  }
  removeSource(id)
  state.notes = {}
}
/** Mostra de novo as portas USB ocultas. */
export function showHiddenPorts() {
  hiddenPorts.clear(); state.hiddenPorts = 0
  saveSettings({ hiddenPorts: [] })
  syncMidiInputs()
}

export function learnBinding(action) { state.learning = action || '' }
export function clearBinding(action) {
  const { [action]: _removed, ...rest } = state.bindings
  state.bindings = rest
  saveSettings({ bindings: rest })
}
export function clearMonitor() { state.monitor = [] }

/** Recebe cada evento MIDI decodificado; devolve a função que cancela a inscrição. */
export function onMidiEvent(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMidiInput() {
  return {
    midi: readonly(state),
    connectBluetooth, chooseBluetooth, enableWebMidi, disconnectSource, showHiddenPorts,
    learnBinding, clearBinding, clearMonitor, onMidiEvent
  }
}
