<template>
  <div v-if="show" class="cartridge-programmer">
    <div class="programmer-header">
      <h3>Mark 1 Cartridge Programmer</h3>
      <button @click="closeModal" class="close-btn">
        <i class="fas fa-times"></i>
      </button>
    </div>

    <!-- Device Status Section -->
    <div class="settings-section">
      <label class="section-label">🔌 Device Status</label>
      <div class="device-status-card">
        <div class="device-status-header">
          <div class="status-indicator" :class="{ connected: isConnected, disconnected: !isConnected }">
            <i :class="isConnected ? 'fas fa-check-circle' : 'fas fa-times-circle'"></i>
          </div>
          <span class="status-text">
            {{ isConnected ? 'Mark 1 Connected' : 'No Device Connected' }}
          </span>
          <button 
            v-if="!isConnected"
            @click="connectSerial"
            :disabled="isConnecting"
            class="connect-btn"
            :title="isConnecting ? 'Connecting...' : 'Connect Device'"
          >
            <i :class="isConnecting ? 'fas fa-spinner fa-spin' : 'fas fa-plug'"></i>
            {{ isConnecting ? 'Connecting...' : 'Connect' }}
          </button>
          <button 
            v-else
            @click="disconnectSerial"
            class="disconnect-btn"
            title="Disconnect Device"
          >
            <i class="fas fa-unlink"></i>
            Disconnect
          </button>
        </div>
        
        <!-- Device Info -->
        <div v-if="deviceInfo" class="device-info">
          <div class="device-info-row">
            <span class="info-label">Device:</span>
            <span class="info-value">{{ deviceInfo.manufacturer }} {{ deviceInfo.name }}</span>
          </div>
          <div class="device-info-row">
            <span class="info-label">Product ID:</span>
            <span class="info-value">{{ deviceInfo.vendor }}:{{ deviceInfo.product }}</span>
          </div>
          <div v-if="deviceInfo.bus" class="device-info-row">
            <span class="info-label">Bus:</span>
            <span class="info-value">{{ deviceInfo.bus }}</span>
          </div>
          <div v-if="devicePermissions" class="device-info-row">
            <span class="info-label">Path:</span>
            <span class="info-value">{{ devicePermissions }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- File Selection Section -->
    <div class="settings-section">
      <label class="section-label">📁 ROM File</label>
      <div class="file-selection">
        <div class="file-input-group">
          <div class="input-row">
            <input 
              type="file" 
              @change="handleFileSelect"
              accept=".bin,.md,.smd,application/octet-stream"
              class="file-input"
              ref="fileInput"
            />
            <button 
              v-if="selectedFile"
              @click="clearFile"
              class="clear-btn"
              title="Clear Selection"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
        <div v-if="selectedFile" class="file-info">
          <div class="file-info-row">
            <span class="info-label">File:</span>
            <span class="info-value">{{ selectedFile.name }}</span>
          </div>
          <div class="file-info-row">
            <span class="info-label">Size:</span>
            <span class="info-value">{{ formatFileSize(selectedFile.size) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Programming Section -->
    <div class="settings-section">
      <label class="section-label">⚡ Programming</label>
      <div class="programming-controls">
        <button 
          @click="programCartridge"
          :disabled="!selectedFile || !isConnected || isProgramming"
          class="program-btn"
          :title="!selectedFile ? 'Select a ROM file first' : !isConnected ? 'Connect device first' : isProgramming ? 'Programming in progress...' : 'Start programming'"
        >
          <i :class="isProgramming ? 'fas fa-spinner fa-spin' : 'fas fa-microchip'"></i>
          {{ isProgramming ? `Programming... ${Math.round(programmingProgress)}%` : 'Program Cartridge' }}
        </button>

        <!-- Progress Bar -->
        <div v-if="isProgramming" class="progress-section">
          <div class="progress-header">
            <span class="progress-label">Progress</span>
            <span class="progress-value">{{ Math.round(programmingProgress) }}%</span>
          </div>
          <div class="progress-bar">
            <div 
              class="progress-fill" 
              :style="{ width: programmingProgress + '%' }"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Serial Monitor Section -->
    <div class="settings-section">
      <label class="section-label">📡 Serial Monitor</label>
      <div class="serial-monitor">
        <div class="monitor-header">
          <span class="monitor-title">Device Messages</span>
          <button 
            @click="clearSerialMessages"
            class="clear-btn"
            title="Clear Messages"
          >
            <i class="fas fa-trash"></i>
            Clear
          </button>
        </div>
        <div class="monitor-output">
          <div 
            v-for="(message, index) in serialMessages.slice(-10)" 
            :key="index"
            class="serial-message"
            :class="{ 
              'message-error': message.includes('Error') || message.includes('Failed'),
              'message-warning': message.includes('Warning'),
              'message-success': message.includes('complete') || message.includes('success')
            }"
          >
            {{ message }}
          </div>
          <div v-if="serialMessages.length === 0" class="monitor-empty">
            Waiting for device messages...
          </div>
        </div>
      </div>
    </div>

    <!-- Status Messages -->
    <div v-if="statusMessages.length > 0" class="settings-info">
      <div 
        v-for="(message, index) in statusMessages.slice(-3)" 
        :key="index"
        class="status-message"
        :class="message.type"
      >
        <i :class="getStatusIcon(message.type)"></i>
        {{ message.text }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useStore } from 'vuex'

const store = useStore()

// Props for controlling component visibility
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

// State management
const isConnected = ref(false)
const isConnecting = ref(false)
const isProgramming = ref(false)
const connectionError = ref('')
const selectedFile = ref(null)
const programmingProgress = ref(0)
const bytesTransferred = ref(0)
const totalBytes = ref(0)
const statusMessage = ref('')
const statusMessageType = ref('info')
const statusMessages = ref([])
const serialMessages = ref([])
const deviceInfo = ref(null)
const isDeviceConnected = ref(false)
const devicePermissions = ref(null)
const isScanning = ref(false)

// Methods
const displayStatusMessage = (message, type = 'info') => {
  statusMessage.value = message
  statusMessageType.value = type
  
  // Also add to statusMessages array for the new UI
  statusMessages.value.push({ text: message, type, timestamp: Date.now() })
  
  // Keep only last 5 messages
  if (statusMessages.value.length > 5) {
    statusMessages.value.shift()
  }
}

const clearSerialMessages = () => {
  serialMessages.value = []
}

const clearFile = () => {
  selectedFile.value = null
  displayStatusMessage('File cleared', 'info')
}

const closeModal = () => {
  store.commit('setShowCartridgeProgrammer', false)
}

const getStatusIcon = (type) => {
  switch (type) {
    case 'success': return 'fas fa-check-circle'
    case 'error': return 'fas fa-exclamation-triangle'
    default: return 'fas fa-info-circle'
  }
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const handleFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    selectedFile.value = file
    displayStatusMessage(`Selected: ${file.name}`, 'info')
  }
}

const scanForDevice = async () => {
  isScanning.value = true
  console.log('[Cartridge Vue] Starting device scan...')
  try {
    console.log('[Cartridge Vue] Calling detect-cartridge-device...')
    const result = await window.ipc?.invoke('detect-cartridge-device')
    console.log('[Cartridge Vue] Scan result:', result)
    if (result.success) {
      deviceInfo.value = result.device
      isDeviceConnected.value = result.connected
      devicePermissions.value = result.devicePath
      
      console.log('[Cartridge Vue] Device state updated:', {
        deviceInfo: deviceInfo.value,
        isDeviceConnected: isDeviceConnected.value,
        devicePermissions: devicePermissions.value
      })
      
      if (result.connected) {
        displayStatusMessage('Mark 1 device detected!', 'success')
        // Check permissions
        await checkDevicePermissions()
      } else {
        displayStatusMessage(result.message || 'Mark 1 not found', 'info')
      }
    } else {
      displayStatusMessage('Failed to scan for devices', 'error')
    }
  } catch (error) {
    console.error('[Cartridge Vue] Device scan error:', error)
    displayStatusMessage('Device scan failed', 'error')
  } finally {
    isScanning.value = false
    console.log('[Cartridge Vue] Device scan completed')
  }
}

const checkDevicePermissions = async () => {
  if (!devicePermissions.value) return
  
  try {
    console.log('[Cartridge Vue] Checking device permissions...')
    const result = await window.ipc?.invoke('check-device-permissions', devicePermissions.value)
    console.log('[Cartridge Vue] Permission check result:', result)
    
    if (result.success) {
      if (result.readable) {
        displayStatusMessage('Device permissions OK', 'success')
      } else {
        displayStatusMessage('Permission denied. Check device access.', 'error')
      }
    }
  } catch (error) {
    console.error('[Cartridge Vue] Permission check error:', error)
  }
}

const startDeviceMonitoring = async () => {
  console.log('[Cartridge Vue] Starting device monitoring...')
  try {
    console.log('[Cartridge Vue] Calling start-device-polling...')
    await window.ipc?.invoke('start-device-polling')
    console.log('[Cartridge Vue] Device polling started successfully')
    
    // Define the event handler function
    const deviceStateHandler = (event) => {
      console.log('[Cartridge Vue] Device state changed event:', event)
      if (event.type === 'connect') {
        displayStatusMessage('Mark 1 connected!', 'success')
        isDeviceConnected.value = true
        scanForDevice()
      } else if (event.type === 'disconnect') {
        displayStatusMessage('Mark 1 disconnected', 'info')
        isDeviceConnected.value = false
        deviceInfo.value = null
        if (isConnected.value) {
          disconnectSerial()
        }
      }
    }
    
    // Listen for device state changes
    window.ipc?.on('device-state-changed', deviceStateHandler)
    
    // Store the handler reference for cleanup
    window._deviceStateHandler = deviceStateHandler
    
  } catch (error) {
    console.error('[Cartridge Vue] Failed to start device monitoring:', error)
  }
}

const connectSerial = async () => {
  if (!devicePermissions.value) {
    connectionError.value = 'No device path available. Please scan for device first.'
    displayStatusMessage('Device not detected', 'error')
    return
  }

  isConnecting.value = true
  connectionError.value = ''

  try {
    console.log('[Cartridge Vue] Attempting to connect via IPC to:', devicePermissions.value)
    
    // Use IPC to connect directly via Node.js SerialPort
    const result = await window.ipc?.invoke('connect-serial', devicePermissions.value)
    console.log('[Cartridge Vue] IPC connection result:', result)
    
    if (result.success) {
      isConnected.value = true
      displayStatusMessage('Mark 1 connected successfully via IPC!', 'success')
      
      // Set up listeners for serial data and errors
      const serialDataHandler = (event) => {
        console.log('[Cartridge Vue] Serial data received via IPC:', event.data)
        serialMessages.value.push(event.data)
        
        // Keep only last 50 messages
        if (serialMessages.value.length > 50) {
          serialMessages.value.shift()
        }
      }
      
      const serialErrorHandler = (event) => {
        console.error('[Cartridge Vue] Serial error via IPC:', event.error)
        displayStatusMessage(`Serial error: ${event.error}`, 'error')
      }
      
      window.ipc?.on('serial-data', serialDataHandler)
      window.ipc?.on('serial-error', serialErrorHandler)
      
      // Store handlers for cleanup
      window._serialDataHandler = serialDataHandler
      window._serialErrorHandler = serialErrorHandler
      
    } else {
      throw new Error(result.error || 'Failed to connect via IPC')
    }
    
  } catch (error) {
    console.error('[Cartridge Vue] IPC connection error:', error)
    
    // Provide detailed error messages
    if (error.message.includes('Access denied') || error.message.includes('permission')) {
      connectionError.value = `Access denied to serial port. Common solutions:\n\n1. Linux permissions: sudo chmod 777 ${devicePermissions.value}\n2. User group: sudo usermod -a -G dialout $USER\n3. Unplug and reconnect the device\n4. Refresh the page and try again\n\nDevice path: ${devicePermissions.value} should be accessible`
      displayStatusMessage('Permission denied. Check device access.', 'error')
    } else if (error.message.includes('No such file') || error.message.includes('not found')) {
      connectionError.value = `Device not found: ${devicePermissions.value}\n\nTroubleshooting:\n1. Check if Mark 1 is connected via USB\n2. Verify device exists: ls ${devicePermissions.value}\n3. Try rescanning for device\n4. Check USB cable and port`
      displayStatusMessage('Device not found. Check connection.', 'error')
    } else if (error.message.includes('busy') || error.message.includes('in use')) {
      connectionError.value = `Serial port is busy or in use.\n\nSolutions:\n1. Close any other terminal/program using the device\n2. Disconnect and reconnect the device\n3. Try a different USB port\n4. Restart the application`
      displayStatusMessage('Device busy. Close other programs.', 'error')
    } else {
      connectionError.value = `Connection failed: ${error.message}\n\nTroubleshooting steps:\n1. Verify Mark 1 is connected via USB\n2. Check device exists: ls ${devicePermissions.value}\n3. Fix permissions: sudo chmod 777 ${devicePermissions.value}\n4. Refresh page and try again\n5. Try a different USB cable or port`
      displayStatusMessage('Failed to connect to Mark 1', 'error')
    }
  } finally {
    isConnecting.value = false
  }
}

const disconnectSerial = async () => {
  if (!devicePermissions.value) {
    console.log('[Cartridge Vue] No device path to disconnect')
    return
  }

  try {
    console.log('[Cartridge Vue] Disconnecting via IPC from:', devicePermissions.value)
    
    // Use IPC to disconnect
    const result = await window.ipc?.invoke('disconnect-serial', devicePermissions.value)
    console.log('[Cartridge Vue] IPC disconnection result:', result)
    
    // Clean up IPC listeners
    if (window._serialDataHandler) {
      window.ipc?.off('serial-data', window._serialDataHandler)
      delete window._serialDataHandler
    }
    
    if (window._serialErrorHandler) {
      window.ipc?.off('serial-error', window._serialErrorHandler)
      delete window._serialErrorHandler
    }
    
    // Reset connection state
    isConnected.value = false
    
    if (result.success) {
      console.log('[Cartridge Vue] Successfully disconnected from Mark 1')
      displayStatusMessage('Disconnected from Mark 1', 'info')
    } else {
      console.log('[Cartridge Vue] Disconnection warning:', result.error)
      displayStatusMessage('Disconnection completed with warnings', 'info')
    }
    
  } catch (error) {
    console.error('[Cartridge Vue] Error disconnecting:', error)
    // Force reset state even on error
    isConnected.value = false
    displayStatusMessage(`Disconnection failed: ${error.message}`, 'error')
  }
}

const programCartridge = async () => {
  if (!selectedFile.value || !isConnected.value || !devicePermissions.value) return
  
  isProgramming.value = true
  programmingProgress.value = 0
  bytesTransferred.value = 0
  totalBytes.value = selectedFile.value.size
  
  try {
    console.log('[Cartridge Vue] Starting cartridge programming via IPC...')
    displayStatusMessage('Programming cartridge...', 'info')
    
    // Read file as ArrayBuffer
    const fileBuffer = await selectedFile.value.arrayBuffer()
    const fileSize = fileBuffer.byteLength
    
    console.log('[Cartridge Vue] File size:', fileSize, 'bytes')
    
    // Send programming data following the exact original protocol
    console.log('[Cartridge Vue] File size:', fileSize, 'bytes')
    
    // 0. Send a single byte to initiate programming procedure (0x01)
    const startByte = [0x01]
    console.log('[Cartridge Vue] Sending start programming byte (0x01):', startByte)
    const startResult = await window.ipc?.invoke('write-serial', devicePermissions.value, startByte)
    if (!startResult.success) {
      throw new Error(`Failed to send start byte: ${startResult.error}`)
    }
    
    // Add a small delay to allow the device to process the start byte
    await new Promise(resolve => setTimeout(resolve, 50))

    // 1. Send file size (32-bit LITTLE-endian - as per original code)
    const sizeArray = new Uint8Array(4)
    const dataView = new DataView(sizeArray.buffer)
    dataView.setUint32(0, fileSize, true) // true for LITTLE-endian
    const sizeRegularArray = Array.from(sizeArray)
    
    console.log('[Cartridge Vue] Sending file size array (LITTLE-endian):', sizeRegularArray)
    const sizeResult = await window.ipc?.invoke('write-serial', devicePermissions.value, sizeRegularArray)
    if (!sizeResult.success) {
      throw new Error(`Failed to send file size: ${sizeResult.error}`)
    }
    
    // Add a small delay to allow the device to process the size before data
    await new Promise(resolve => setTimeout(resolve, 50))

    // Add a delay to allow the device to complete erase before sending data
    await new Promise(resolve => setTimeout(resolve, 2000)) // 2 seconds delay for erase completion

    // 2. Send file data in chunks with 16-bit word byte order swap
    const chunkSize = 1024 // Define a chunk size (1KB)
    let bytesSent = 0

    console.log('[Cartridge Vue] Starting to send file data chunks...')

    try {
      for (let i = 0; i < fileSize; i += chunkSize) {
        const chunk = new Uint8Array(fileBuffer, i, Math.min(chunkSize, fileSize - i))
        
        // Apply 16-bit word byte order swap to the chunk (from original code)
        const swappedChunk = new Uint8Array(chunk.length)
        for (let j = 0; j < chunk.length; j += 2) {
          if (j + 1 < chunk.length) {
            // Swap adjacent bytes (e.g., B0 B1 becomes B1 B0)
            swappedChunk[j] = chunk[j + 1]
            swappedChunk[j + 1] = chunk[j]
          } else {
            // If there's an odd number of bytes, copy the last byte directly
            swappedChunk[j] = chunk[j]
          }
        }
        
        const chunkArray = Array.from(swappedChunk)
        const chunkResult = await window.ipc?.invoke('write-serial', devicePermissions.value, chunkArray)
        
        if (!chunkResult.success) {
          throw new Error(`Failed to send chunk at offset ${i}: ${chunkResult.error}`)
        }
        
        bytesSent += chunk.byteLength // Use original chunk length for progress calculation
        programmingProgress.value = (bytesSent / fileSize) * 100
        
        // Small delay to prevent overwhelming the serial buffer
        await new Promise(resolve => setTimeout(resolve, 1)) // Back to 1ms like original
      }
      
      displayStatusMessage('Programming complete!', 'success')
      
    } catch (error) {
      // If programming fails due to device disconnect, it might be a hardware issue
      if (error.message.includes('EIO') || error.message.includes('device disconnected')) {
        displayStatusMessage('Programming failed - possible cartridge hardware issue. Try reformatting the cartridge.', 'error')
      } else {
        throw error // Re-throw other errors
      }
    }

    displayStatusMessage('Programming complete!', 'success')

  } catch (error) {
    console.error('Programming error:', error)
    displayStatusMessage(`Programming failed: ${error.message}`, 'error')
  } finally {
    isProgramming.value = false
    programmingProgress.value = 0
    bytesTransferred.value = 0
    totalBytes.value = 0
  }
}

// Reset state function
const resetState = () => {
  console.log('[Cartridge Vue] Resetting component state...')
  
  // Reset connection state (IPC approach - no port variable)
  if (isConnected.value && devicePermissions.value) {
    disconnectSerial()
  }
  
  // Reset all reactive state
  isConnecting.value = false
  isProgramming.value = false
  connectionError.value = ''
  selectedFile.value = null
  programmingProgress.value = 0
  bytesTransferred.value = 0
  totalBytes.value = 0
  statusMessage.value = ''
  statusMessageType.value = 'info'
  statusMessages.value = []
  serialMessages.value = []
  
  // Reset device detection state
  deviceInfo.value = null
  isDeviceConnected.value = false
  devicePermissions.value = null
  isScanning.value = false
  
  console.log('[Cartridge Vue] State reset completed')
}

// Watch for component visibility changes
watch(() => props.show, (newShow, oldShow) => {
  console.log('[Cartridge Vue] Component visibility changed from', oldShow, 'to', newShow)
  if (newShow && !oldShow) {
    // Component is being shown, reset state and scan
    console.log('[Cartridge Vue] Component being shown, resetting state and scanning')
    resetState()
    // Small delay to ensure component is fully rendered
    setTimeout(() => {
      console.log('[Cartridge Vue] Executing delayed scan...')
      scanForDevice()
    }, 100)
  } else if (!newShow && oldShow) {
    // Component is being hidden, clean up
    console.log('[Cartridge Vue] Component being hidden, cleaning up')
    if (isConnected.value && devicePermissions.value) {
      disconnectSerial()
    }
  }
})

// Also watch for immediate show when component is already visible
watch(() => props.show, (newShow) => {
  if (newShow && !deviceInfo.value) {
    console.log('[Cartridge Vue] Component is visible but no device info, scanning immediately')
    scanForDevice()
  }
}, { immediate: true })

// Initialize device monitoring on mount
onMounted(() => {
  console.log('[Cartridge Vue] Component mounted, initializing...')
  // Reset any stale state
  resetState()
  startDeviceMonitoring()
  // Don't scan here - let the watch handle it when component becomes visible
  console.log('[Cartridge Vue] Component initialization completed')
})

// Cleanup on unmount
onUnmounted(() => {
  console.log('[Cartridge Vue] Cleaning up component...')
  if (isConnected.value && devicePermissions.value) {
    disconnectSerial()
  }
  // Stop device polling
  window.ipc?.invoke('stop-device-polling').then(() => {
    console.log('[Cartridge Vue] Device polling stopped')
  }).catch(error => {
    console.log('[Cartridge Vue] Error stopping polling:', error)
  })
  // Clean up IPC listeners - remove the specific handlers
  if (window.ipc && window._deviceStateHandler) {
    window.ipc.off('device-state-changed', window._deviceStateHandler)
    delete window._deviceStateHandler
  }
  if (window.ipc && window._serialDataHandler) {
    window.ipc.off('serial-data', window._serialDataHandler)
    delete window._serialDataHandler
  }
  if (window.ipc && window._serialErrorHandler) {
    window.ipc.off('serial-error', window._serialErrorHandler)
    delete window._serialErrorHandler
  }
  console.log('[Cartridge Vue] Component cleanup completed')
})
</script>

<style scoped>
/* Cartridge Programmer Styles - Following Retro Studio Pattern */
.cartridge-programmer {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 16px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Header */
.programmer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid #333;
}

.programmer-header h3 {
  margin: 0;
  color: #ccc;
  font-size: 16px;
  font-weight: 500;
}

.close-btn {
  background: #333;
  border: 1px solid #444;
  color: #aaa;
  padding: 6px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
}

.close-btn:hover {
  background: #3b3b3b;
  color: #fff;
  border-color: #555;
}

/* Section Styles */
.settings-section {
  background: #252525;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-label {
  color: #aaa;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 8px;
}

/* Device Status */
.device-status-card {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 12px;
}

.device-status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-indicator.connected {
  color: #4ade80;
}

.status-indicator.disconnected {
  color: #f87171;
}

.status-text {
  color: #ccc;
  font-size: 13px;
  font-weight: 500;
  flex: 1;
}

.connect-btn, .disconnect-btn {
  background: #333;
  border: 1px solid #444;
  color: #aaa;
  padding: 6px 12px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.connect-btn:hover:not(:disabled) {
  background: #3b3b3b;
  color: #fff;
  border-color: #555;
}

.disconnect-btn:hover {
  background: #dc2626;
  color: #fff;
  border-color: #ef4444;
}

.connect-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Device Info */
.device-info {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 8px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.device-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.info-label {
  color: #888;
  font-weight: 500;
}

.info-value {
  color: #ccc;
  font-family: 'Courier New', monospace;
}

/* File Selection */
.file-selection {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-row {
  display: flex;
  gap: 6px;
}

.file-input {
  flex: 1;
  background: #2a2a2a;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  transition: all 0.2s;
}

.file-input:focus {
  outline: none;
  border-color: #3b82f6;
  background: #333;
}

.clear-btn {
  background: #333;
  border: 1px solid #444;
  color: #aaa;
  padding: 6px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
}

.clear-btn:hover {
  background: #3b3b3b;
  color: #fff;
  border-color: #555;
}

.file-info {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Programming Controls */
.programming-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.program-btn {
  background: #059669;
  border: 1px solid #047857;
  color: #fff;
  padding: 10px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.program-btn:hover:not(:disabled) {
  background: #047857;
  border-color: #065f46;
}

.program-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Progress Bar */
.progress-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-label, .progress-value {
  color: #aaa;
  font-size: 12px;
}

.progress-bar {
  background: #333;
  border: 1px solid #444;
  border-radius: 3px;
  height: 8px;
  overflow: hidden;
}

.progress-fill {
  background: #059669;
  height: 100%;
  transition: width 0.3s ease;
}

/* Serial Monitor */
.serial-monitor {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.monitor-title {
  color: #aaa;
  font-size: 12px;
  font-weight: 500;
}

.monitor-output {
  background: #000;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 8px;
  height: 120px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 11px;
}

.serial-message {
  color: #4ade80;
  margin-bottom: 2px;
  word-wrap: break-word;
}

.serial-message.message-error {
  color: #f87171;
}

.serial-message.message-warning {
  color: #fbbf24;
}

.serial-message.message-success {
  color: #4ade80;
}

.monitor-empty {
  color: #666;
  font-style: italic;
}

/* Status Messages */
.settings-info {
  background: #252525;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 12px;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-message {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 1.4;
}

.status-message.success {
  color: #4ade80;
}

.status-message.error {
  color: #f87171;
}

.status-message.info {
  color: #60a5fa;
}

/* Scrollbar Styles */
.cartridge-programmer::-webkit-scrollbar {
  width: 8px;
}

.cartridge-programmer::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.cartridge-programmer::-webkit-scrollbar-thumb {
  background: #464647;
  border-radius: 4px;
}

.cartridge-programmer::-webkit-scrollbar-thumb:hover {
  background: #5a5a5a;
}

.monitor-output::-webkit-scrollbar {
  width: 6px;
}

.monitor-output::-webkit-scrollbar-track {
  background: #000;
}

.monitor-output::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 3px;
}

.monitor-output::-webkit-scrollbar-thumb:hover {
  background: #444;
}
</style>
