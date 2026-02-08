/* eslint-disable no-unused-vars */
'use strict'

import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Store serial port connections
const serialConnections = new Map()

/**
 * Setup IPC handlers for cartridge programming functionality
 */
export function setupCartridgeHandlers() {
  console.log('[Cartridge] Setting up IPC handlers...')
  
  /**
   * Detect connected cartridge programmer
   * Scans USB devices for the specific Vendor/Product ID using system commands
   */
  ipcMain.handle('detect-cartridge-device', async () => {
    console.log('[Cartridge] detect-cartridge-device called')
    try {
      // Check for Raspberry Pi Pico (Cartridge programmer) - Vendor: 2e8a, Product: 0009
      console.log('[Cartridge] Running lsusb command...')
      const { stdout } = await execAsync('lsusb')
      const lines = stdout.split('\n')
      console.log('[Cartridge] lsusb output:', stdout)
      
      let deviceFound = null
      let devicePath = null
      let deviceBus = null
      
      for (const line of lines) {
        // Look for Raspberry Pi Pico with Vendor ID 2e8a
        if (line.includes('2e8a:0009') && line.includes('Raspberry Pi')) {
          console.log('[Cartridge] Found Cartridge programmer device:', line)
          
          // Extract bus and device numbers for better identification
          const busMatch = line.match(/Bus (\d+) Device (\d+):/)
          if (busMatch) {
            deviceBus = `Bus ${busMatch[1]} Device ${busMatch[2]}`
          }
          
          deviceFound = {
            vendor: '2e8a',
            product: '0009',
            manufacturer: 'Raspberry Pi',
            name: 'Pico',
            description: 'Cartridge Programmer',
            bus: deviceBus
          }
          break
        }
      }
      
      if (deviceFound) {
        console.log('[Cartridge] Device found, looking for tty path...')
        // Find the corresponding tty device
        try {
          // Try to find ACM device from dmesg with bus info
          console.log('[Cartridge] Checking dmesg for tty devices...')
          const { stdout: dmesgOutput } = await execAsync('dmesg | grep -E "ttyACM|ttyUSB" | tail -20')
          const dmesgLines = dmesgOutput.split('\n').reverse()
          console.log('[Cartridge] dmesg output:', dmesgOutput)
          
          // Look for recent ACM device creation
          for (const line of dmesgLines) {
            if (line.includes('ttyACM') || line.includes('ttyUSB')) {
              const match = line.match(/(ttyACM\d+|ttyUSB\d+)/)
              if (match) {
                devicePath = `/dev/${match[1]}`
                console.log('[Cartridge] Found device path:', devicePath)
                break
              }
            }
          }
          
          // Fallback: check common ACM/USB devices
          if (!devicePath) {
            console.log('[Cartridge] Checking common device paths...')
            const commonDevices = ['/dev/ttyACM0', '/dev/ttyACM1', '/dev/ttyUSB0', '/dev/ttyUSB1']
            for (const testPath of commonDevices) {
              if (fs.existsSync(testPath)) {
                devicePath = testPath
                console.log('[Cartridge] Found fallback device path:', devicePath)
                break
              }
            }
          }
        } catch (error) {
          console.warn('[Cartridge] Could not determine tty device:', error.message)
        }
        
        const result = {
          success: true,
          device: deviceFound,
          devicePath,
          connected: true,
          needsPermission: devicePath && fs.existsSync(devicePath)
        }
        console.log('[Cartridge] Detection result:', result)
        return result
      }
      
      console.log('[Cartridge] No device found')
      return {
        success: true,
        device: null,
        devicePath: null,
        connected: false,
        message: 'Cartridge programmer device not found. Please connect via USB.'
      }
      
    } catch (error) {
      console.error('[Cartridge] Error detecting cartridge device:', error)
      return {
        success: false,
        error: error.message,
        connected: false
      }
    }
  })

  /**
   * Get device permissions status
   * Checks if the tty device is accessible
   */
  ipcMain.handle('check-device-permissions', async () => {
    console.log('[Cartridge] check-device-permissions called')
    try {
      const devicePath = '/dev/ttyACM0'
      console.log('[Cartridge] Checking permissions for:', devicePath)
      
      if (!fs.existsSync(devicePath)) {
        console.log('[Cartridge] Device does not exist:', devicePath)
        return {
          exists: false,
          readable: false,
          writable: false,
          message: 'Device not found at /dev/ttyACM0'
        }
      }
      
      // Check if we can read/write to the device
      try {
        fs.accessSync(devicePath, fs.constants.R_OK | fs.constants.W_OK)
        console.log('[Cartridge] Device permissions OK')
        return {
          exists: true,
          readable: true,
          writable: true,
          message: 'Device permissions OK'
        }
      } catch (accessError) {
        console.log('[Cartridge] Device permission denied:', accessError.message)
        return {
          exists: true,
          readable: false,
          writable: false,
          message: 'Permission denied. Run: sudo chmod 777 /dev/ttyACM0'
        }
      }
      
    } catch (error) {
      console.error('[Cartridge] Error checking permissions:', error)
      return {
        exists: false,
        readable: false,
        writable: false,
        error: error.message
      }
    }
  })

  /**
   * Simple device polling (alternative to USB monitoring)
   * Periodically checks if device is connected
   */
  let devicePollingInterval = null
  
  ipcMain.handle('start-device-polling', async (event) => {
    console.log('[Cartridge] start-device-polling called')
    try {
      // Clear any existing polling
      if (devicePollingInterval) {
        console.log('[Cartridge] Clearing existing polling interval')
        clearInterval(devicePollingInterval)
      }
      
      let lastDeviceState = false
      console.log('[Cartridge] Starting device polling every 2 seconds')
      
      // Poll every 2 seconds
      devicePollingInterval = setInterval(async () => {
        try {
          const result = await execAsync('lsusb | grep "2e8a:0009"')
          const deviceConnected = result.stdout.includes('2e8a:0009')
          
          // Send event if state changed
          if (deviceConnected !== lastDeviceState) {
            console.log('[Cartridge] Device state changed:', deviceConnected)
            event.sender.send('device-state-changed', {
              connected: deviceConnected,
              type: deviceConnected ? 'connect' : 'disconnect',
              vendor: '2e8a',
              product: '0009',
              message: deviceConnected ? 'Cartridge programmer connected' : 'Cartridge programmer disconnected'
            })
            lastDeviceState = deviceConnected
          }
        } catch (error) {
          // Device not found
          if (lastDeviceState) {
            console.log('[Cartridge] Device disconnected')
            event.sender.send('device-state-changed', {
              connected: false,
              type: 'disconnect',
              vendor: '2e8a',
              product: '0009',
              message: 'Cartridge programmer disconnected'
            })
            lastDeviceState = false
          }
        }
      }, 2000)
      
      console.log('[Cartridge] Device polling started successfully')
      return { success: true, message: 'Device polling started' }
      
    } catch (error) {
      console.error('[Cartridge] Error starting device polling:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('stop-device-polling', async () => {
    console.log('[Cartridge] stop-device-polling called')
    if (devicePollingInterval) {
      clearInterval(devicePollingInterval)
      devicePollingInterval = null
      console.log('[Cartridge] Device polling stopped')
    }
    return { success: true, message: 'Device polling stopped' }
  })

  /**
   * Read file as buffer for cartridge programming
   * This handler reads a ROM file and returns it as an ArrayBuffer
   */
  ipcMain.handle('read-file-buffer', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      const stats = fs.statSync(filePath)
      const fileBuffer = fs.readFileSync(filePath)
      
      // Convert Node.js Buffer to ArrayBuffer (compatible with browser)
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      )

      return {
        success: true,
        buffer: arrayBuffer,
        size: stats.size,
        path: filePath
      }
    } catch (error) {
      console.error('Error reading file for cartridge programming:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * Get current compiled ROM information
   * Returns the path and size of the most recently compiled ROM
   */
  ipcMain.handle('get-current-rom-info', async (event) => {
    try {
      // This would typically read from the project state or build output
      // For now, we'll check common ROM locations in the project
      const projectPath = global.currentProjectPath || process.cwd()
      const possibleRomPaths = [
        path.join(projectPath, 'out', 'game.bin'),
        path.join(projectPath, 'out', 'game.md'),
        path.join(projectPath, 'out', 'game.smd'),
        path.join(projectPath, 'game.bin'),
        path.join(projectPath, 'game.srm')
      ]

      for (const romPath of possibleRomPaths) {
        if (fs.existsSync(romPath)) {
          const stats = fs.statSync(romPath)
          return {
            success: true,
            path: romPath,
            size: stats.size,
            name: path.basename(romPath)
          }
        }
      }

      return {
        success: false,
        error: 'No compiled ROM found. Please build your project first.'
      }
    } catch (error) {
      console.error('Error getting current ROM info:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * Validate ROM file for cartridge programming
   * Checks if the file is a valid Mega Drive ROM format
   */
  ipcMain.handle('validate-rom-file', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      const stats = fs.statSync(filePath)
      const fileBuffer = fs.readFileSync(filePath)
      
      // Basic validation checks for Mega Drive ROM
      const validation = {
        isValid: false,
        format: 'unknown',
        warnings: [],
        errors: []
      }

      // Check file size (Mega Drive ROMs are typically between 8KB and 4MB)
      const sizeKB = stats.size / 1024
      if (sizeKB < 8 || sizeKB > 4096) {
        validation.errors.push(`Invalid ROM size: ${sizeKB.toFixed(1)}KB (expected 8KB - 4MB)`)
      }

      // Check for Mega Drive ROM header
      if (fileBuffer.length >= 0x100) {
        // Check console name at offset 0x80 (should be "SEGA MEGA DRIVE" or similar)
        const consoleName = fileBuffer.toString('ascii', 0x80, 0x90).replace(/\0/g, '')
        if (consoleName.includes('SEGA')) {
          validation.isValid = true
          validation.format = 'megadrive'
        } else {
          validation.warnings.push('No SEGA header found - may not be a valid Mega Drive ROM')
        }

        // Check for ROM header at offset 0x100 (should be "SEGA")
        const header = fileBuffer.toString('ascii', 0x100, 0x104)
        if (header === 'SEGA') {
          validation.isValid = true
          validation.format = 'megadrive'
        }
      }

      // Determine file format by extension
      const ext = path.extname(filePath).toLowerCase()
      if (['.bin', '.md', '.smd'].includes(ext)) {
        validation.format = ext === '.bin' ? 'binary' : ext.substring(1).toUpperCase()
      }

      // If no errors found and format detected, consider it valid
      if (validation.errors.length === 0 && validation.format !== 'unknown') {
        validation.isValid = true
      }

      return {
        success: true,
        validation,
        size: stats.size,
        path: filePath
      }
    } catch (error) {
      console.error('Error validating ROM file:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * Get cartridge programmer configuration
   * Returns stored settings for the cartridge programmer
   */
  ipcMain.handle('get-cartridge-config', async (event) => {
    try {
      // This would read from a configuration file or settings store
      // For now, return default configuration
      const defaultConfig = {
        vendorId: '0x2e8a', // Raspberry Pi Pico
        productId: '0x0009', // Pico Product ID
        baudRate: 115200,
        chunkSize: 1024,
        autoConnect: false,
        swapEndianness: true,
        supportedFormats: ['.bin', '.md', '.smd'],
        deviceName: 'Cartridge Programmer'
      }

      return {
        success: true,
        config: defaultConfig
      }
    } catch (error) {
      console.error('Error getting cartridge config:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * Save cartridge programmer configuration
   * Stores settings for the cartridge programmer
   */
  ipcMain.handle('save-cartridge-config', async (event, config) => {
    try {
      // This would save to a configuration file or settings store
      // For now, just validate the config
      const requiredFields = ['vendorId', 'productId', 'baudRate', 'chunkSize']
      const missingFields = requiredFields.filter(field => !(field in config))
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required config fields: ${missingFields.join(', ')}`)
      }

      // Validate vendor ID format
      if (typeof config.vendorId === 'string') {
        if (!config.vendorId.startsWith('0x')) {
          throw new Error('Vendor ID must be in hex format (e.g., 0x2e8a)')
        }
      }

      // Validate product ID format
      if (typeof config.productId === 'string') {
        if (!config.productId.startsWith('0x')) {
          throw new Error('Product ID must be in hex format (e.g., 0x0009)')
        }
      }

      // Validate baud rate
      if (config.baudRate < 9600 || config.baudRate > 921600) {
        throw new Error('Baud rate must be between 9600 and 921600')
      }

      // Validate chunk size
      if (config.chunkSize < 64 || config.chunkSize > 8192) {
        throw new Error('Chunk size must be between 64 and 8192 bytes')
      }

      // Store configuration (in a real implementation, this would save to disk)
      console.log('Cartridge configuration saved:', config)

      return {
        success: true,
        message: 'Configuration saved successfully'
      }
    } catch (error) {
      console.error('Error saving cartridge config:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * Connect to serial port directly via Node.js
   * This bypasses Web Serial API limitations in Electron
   */
  ipcMain.handle('connect-serial', async (event, devicePath) => {
    console.log('[Cartridge] connect-serial called for:', devicePath)
    try {
      // Close existing connection if any
      if (serialConnections.has(devicePath)) {
        const existingConnection = serialConnections.get(devicePath)
        if (existingConnection.readStream) {
          existingConnection.readStream.destroy()
        }
        if (existingConnection.writeStream) {
          existingConnection.writeStream.destroy()
        }
        serialConnections.delete(devicePath)
      }

      // Check if device exists and is accessible
      if (!fs.existsSync(devicePath)) {
        throw new Error(`Device not found: ${devicePath}`)
      }

      // Create read and write streams
      const readStream = fs.createReadStream(devicePath, {
        flags: 'r',
        encoding: 'utf8',
        fd: null,
        mode: 0o666,
        autoClose: true
      })

      const writeStream = fs.createWriteStream(devicePath, {
        flags: 'w',
        encoding: 'utf8',
        fd: null,
        mode: 0o666,
        autoClose: true
      })

      // Store the connection
      const connection = { readStream, writeStream, devicePath }
      serialConnections.set(devicePath, connection)

      console.log('[Cartridge] Serial connection established:', devicePath)

      // Set up data listener for line-by-line reading
      let buffer = ''
      readStream.on('data', (data) => {
        buffer += data
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim()) {
            console.log('[Cartridge] Serial data received:', line.trim())
            // Send data to renderer
            event.sender.send('serial-data', {
              devicePath,
              data: line.trim(),
              timestamp: Date.now()
            })
          }
        }
      })

      // Set up error listeners
      readStream.on('error', (err) => {
        console.error('[Cartridge] Serial read error:', err)
        event.sender.send('serial-error', {
          devicePath,
          error: err.message
        })
      })

      writeStream.on('error', (err) => {
        console.error('[Cartridge] Serial write error:', err)
        event.sender.send('serial-error', {
          devicePath,
          error: err.message
        })
      })

      return {
        success: true,
        message: `Connected to ${devicePath}`,
        devicePath
      }

    } catch (error) {
      console.error('[Cartridge] Error connecting to serial port:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * Disconnect from serial port
   */
  ipcMain.handle('disconnect-serial', async (event, devicePath) => {
    console.log('[Cartridge] disconnect-serial called for:', devicePath)
    try {
      if (serialConnections.has(devicePath)) {
        const connection = serialConnections.get(devicePath)
        
        // Close streams
        if (connection.readStream) {
          connection.readStream.destroy()
        }
        if (connection.writeStream) {
          connection.writeStream.destroy()
        }

        serialConnections.delete(devicePath)
        console.log('[Cartridge] Serial connection closed:', devicePath)

        return {
          success: true,
          message: `Disconnected from ${devicePath}`
        }
      } else {
        return {
          success: false,
          error: 'No active connection found'
        }
      }
    } catch (error) {
      console.error('[Cartridge] Error disconnecting serial port:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * Write data to serial port
   */
  ipcMain.handle('write-serial', async (event, devicePath, data) => {
    console.log('[Cartridge] write-serial called for:', devicePath)
    console.log('[Cartridge] Data type:', typeof data)
    console.log('[Cartridge] Data value:', data)
    console.log('[Cartridge] Data is null/undefined:', data == null)
    console.log('[Cartridge] Data is array:', Array.isArray(data))
    console.log('[Cartridge] Data length:', data && data.length)
    
    try {
      if (serialConnections.has(devicePath)) {
        const connection = serialConnections.get(devicePath)
        
        if (connection.writeStream && !connection.writeStream.destroyed) {
          // Convert various data types to Buffer
          let writeData = data
          if (Array.isArray(data)) {
            // It's a regular array, convert to Buffer
            writeData = Buffer.from(data)
            console.log('[Cartridge] Converted array to Buffer:', writeData)
          } else if (data && data.buffer && data.byteLength) {
            // It's a Uint8Array, convert to Buffer
            writeData = Buffer.from(data)
            console.log('[Cartridge] Converted Uint8Array to Buffer:', writeData)
          } else if (typeof data === 'string') {
            // It's a string, keep as is
            writeData = data
            console.log('[Cartridge] Using string data:', writeData)
          } else if (!data) {
            throw new Error('No data provided')
          } else {
            console.log('[Cartridge] Unknown data type, attempting conversion')
            writeData = Buffer.from(data.toString())
          }
          
          console.log('[Cartridge] Final write data:', writeData)
          console.log('[Cartridge] Final write data type:', typeof writeData)
          
          await new Promise((resolve, reject) => {
            connection.writeStream.write(writeData, (err) => {
              if (err) reject(err)
              else resolve()
            })
          })

          console.log('[Cartridge] Data written to serial port successfully')
          return {
            success: true,
            message: 'Data written successfully'
          }
        } else {
          return {
            success: false,
            error: 'Serial write stream is not available'
          }
        }
      } else {
        return {
          success: false,
          error: 'No active connection found'
        }
      }
    } catch (error) {
      console.error('[Cartridge] Error writing to serial port:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  console.log('[IPC] Cartridge programming handlers registered')
}
