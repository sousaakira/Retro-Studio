// #89: teclados MIDI por Bluetooth LE (ex.: M-Vave SMK-25). O BlueZ das distribuições Ubuntu vem sem o
// plugin MIDI, então o teclado não vira porta ALSA: o renderer lê o BLE-MIDI direto pelo Web Bluetooth
// e o processo principal só escolhe o dispositivo (a lista vai para a interface do app).
import { ipcMain, session } from 'electron'

const pending = new Map()

/** Antes de app.whenReady: no Linux o Web Bluetooth do Chromium vem desligado. */
export function enableMidiBluetooth(app) {
  if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'WebBluetooth')
}

// Páginas do próprio app: o build instalado (file://) e o servidor do electron-vite em desenvolvimento.
export const isAppPage = url => typeof url === 'string' && (url.startsWith('file://') || url.startsWith('http://localhost:5175/'))

/**
 * Depois de app.whenReady. Teclados USB chegam pelo Web MIDI; desde o Chromium 124 todo acesso a ele
 * pede a permissão "midiSysex", mesmo com { sysex: false } (negá-la bloqueava o USB inteiro). MIDI fica
 * liberado só para as páginas do app, que nunca pedem SysEx; as demais permissões seguem como antes.
 */
export function setupMidiPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'midi' || permission === 'midiSysex') return callback(isAppPage(details?.requestingUrl || webContents?.getURL?.()))
    callback(true)
  })
  ipcMain.handle('midi:bluetooth-choose', (event, deviceId) => {
    const request = pending.get(event.sender.id)
    if (!request) return false
    const id = typeof deviceId === 'string' ? deviceId : ''
    if (id && !request.devices.some(device => device.deviceId === id)) throw new Error('Dispositivo Bluetooth desconhecido.')
    pending.delete(event.sender.id)
    request.callback(id)
    return true
  })
}

/** O Chromium chama de novo a cada dispositivo encontrado; a interface recebe a lista atualizada. */
export function attachMidiBluetooth(webContents, log) {
  webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault()
    const devices = deviceList.slice(0, 50).map(device => ({ deviceId: String(device.deviceId), deviceName: String(device.deviceName || '').slice(0, 80) }))
    pending.set(webContents.id, { callback, devices })
    webContents.send('midi:bluetooth-devices', devices)
  })
  webContents.once('destroyed', () => pending.delete(webContents.id))
  log?.('verbose', 'midi:bluetooth', 'Seleção de dispositivo Bluetooth ligada à janela')
}
