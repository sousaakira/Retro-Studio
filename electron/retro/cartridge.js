import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const serialConnections = new Map()

export function setupCartridgeHandlers() {
  ipcMain.handle('retro:detect-cartridge-device', async () => {
    try {
      const { stdout } = await execAsync('lsusb')
      const lines = stdout.split('\n')
      let deviceFound = null
      let devicePath = null
      for (const line of lines) {
        if (line.includes('2e8a:0009') && line.includes('Raspberry Pi')) {
          const busMatch = line.match(/Bus (\d+) Device (\d+):/)
          deviceFound = {
            vendor: '2e8a',
            product: '0009',
            manufacturer: 'Raspberry Pi',
            name: 'Pico',
            description: 'Cartridge Programmer',
            bus: busMatch ? `Bus ${busMatch[1]} Device ${busMatch[2]}` : null
          }
          break
        }
      }
      if (deviceFound) {
        try {
          const { stdout: dmesgOutput } = await execAsync('dmesg | grep -E "ttyACM|ttyUSB" | tail -20')
          const dmesgLines = dmesgOutput.split('\n').reverse()
          for (const line of dmesgLines) {
            if (line.includes('ttyACM') || line.includes('ttyUSB')) {
              const match = line.match(/(ttyACM\d+|ttyUSB\d+)/)
              if (match) {
                devicePath = `/dev/${match[1]}`
                break
              }
            }
          }
          if (!devicePath) {
            const commonDevices = ['/dev/ttyACM0', '/dev/ttyACM1', '/dev/ttyUSB0', '/dev/ttyUSB1']
            for (const testPath of commonDevices) {
              if (fs.existsSync(testPath)) {
                devicePath = testPath
                break
              }
            }
          }
        } catch (e) {}
      }
      return {
        success: true,
        device: deviceFound,
        devicePath,
        connected: !!deviceFound,
        needsPermission: devicePath && fs.existsSync(devicePath)
      }
    } catch (error) {
      return { success: false, error: error.message, connected: false }
    }
  })

  ipcMain.handle('retro:check-device-permissions', async (_event, devicePath = '/dev/ttyACM0') => {
    try {
      if (!fs.existsSync(devicePath)) {
        return { exists: false, readable: false, writable: false, message: 'Device not found' }
      }
      fs.accessSync(devicePath, fs.constants.R_OK | fs.constants.W_OK)
      return { exists: true, readable: true, writable: true, message: 'OK' }
    } catch (e) {
      return {
        exists: fs.existsSync(devicePath),
        readable: false,
        writable: false,
        message: 'Permission denied. Run: sudo chmod 666 ' + devicePath
      }
    }
  })

  ipcMain.handle('retro:read-file-buffer', async (_event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
      const stats = fs.statSync(filePath)
      const fileBuffer = fs.readFileSync(filePath)
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      )
      return { success: true, buffer: arrayBuffer, size: stats.size, path: filePath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:get-current-rom-info', async (_event, projectPath) => {
    try {
      const basePath = projectPath || process.cwd()
      const possibleRomPaths = [
        path.join(basePath, 'out', 'game.bin'),
        path.join(basePath, 'out', 'game.md'),
        path.join(basePath, 'out', 'game.smd'),
        path.join(basePath, 'game.bin'),
        path.join(basePath, 'game.srm')
      ]
      for (const romPath of possibleRomPaths) {
        if (fs.existsSync(romPath)) {
          const stats = fs.statSync(romPath)
          return { success: true, path: romPath, size: stats.size, name: path.basename(romPath) }
        }
      }
      return { success: false, error: 'No compiled ROM found. Build your project first.' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:validate-rom-file', async (_event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
      const stats = fs.statSync(filePath)
      const fileBuffer = fs.readFileSync(filePath)
      const validation = { isValid: false, format: 'unknown', warnings: [], errors: [] }
      const sizeKB = stats.size / 1024
      if (sizeKB < 8 || sizeKB > 4096) {
        validation.errors.push(`Invalid ROM size: ${sizeKB.toFixed(1)}KB (expected 8KB - 4MB)`)
      }
      if (fileBuffer.length >= 0x100) {
        const consoleName = fileBuffer.toString('ascii', 0x80, 0x90).replace(/\0/g, '')
        if (consoleName.includes('SEGA')) {
          validation.isValid = true
          validation.format = 'megadrive'
        }
        const header = fileBuffer.toString('ascii', 0x100, 0x104)
        if (header === 'SEGA') {
          validation.isValid = true
          validation.format = 'megadrive'
        }
      }
      const ext = path.extname(filePath).toLowerCase()
      if (['.bin', '.md', '.smd'].includes(ext)) validation.format = ext.substring(1).toUpperCase()
      if (validation.errors.length === 0 && validation.format !== 'unknown') validation.isValid = true
      return { success: true, validation, size: stats.size, path: filePath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:connect-serial', async (event, devicePath) => {
    try {
      if (serialConnections.has(devicePath)) {
        const c = serialConnections.get(devicePath)
        if (c.readStream) c.readStream.destroy()
        if (c.writeStream) c.writeStream.destroy()
        serialConnections.delete(devicePath)
      }
      if (!fs.existsSync(devicePath)) throw new Error(`Device not found: ${devicePath}`)
      const readStream = fs.createReadStream(devicePath, { flags: 'r', encoding: 'utf8', autoClose: true })
      const writeStream = fs.createWriteStream(devicePath, { flags: 'w', encoding: 'utf8', autoClose: true })
      let buffer = ''
      readStream.on('data', (data) => {
        buffer += data
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.trim()) {
            event.sender.send('retro:serial-data', { devicePath, data: line.trim(), timestamp: Date.now() })
          }
        }
      })
      readStream.on('error', (err) => event.sender.send('retro:serial-error', { devicePath, error: err.message }))
      writeStream.on('error', (err) => event.sender.send('retro:serial-error', { devicePath, error: err.message }))
      serialConnections.set(devicePath, { readStream, writeStream, devicePath })
      return { success: true, message: `Connected to ${devicePath}`, devicePath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:disconnect-serial', async (_event, devicePath) => {
    try {
      if (serialConnections.has(devicePath)) {
        const c = serialConnections.get(devicePath)
        if (c.readStream) c.readStream.destroy()
        if (c.writeStream) c.writeStream.destroy()
        serialConnections.delete(devicePath)
        return { success: true, message: `Disconnected from ${devicePath}` }
      }
      return { success: false, error: 'No active connection' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:write-serial', async (_event, devicePath, data) => {
    try {
      if (!serialConnections.has(devicePath)) return { success: false, error: 'No active connection' }
      const c = serialConnections.get(devicePath)
      if (!c.writeStream || c.writeStream.destroyed) return { success: false, error: 'Write stream unavailable' }
      let writeData = data
      if (Array.isArray(data)) writeData = Buffer.from(data)
      else if (data?.buffer && data.byteLength) writeData = Buffer.from(data)
      else if (typeof data === 'string') writeData = data
      else if (!data) throw new Error('No data provided')
      else writeData = Buffer.from(data.toString())
      await new Promise((resolve, reject) => {
        c.writeStream.write(writeData, (err) => (err ? reject(err) : resolve()))
      })
      return { success: true, message: 'Data written' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}
