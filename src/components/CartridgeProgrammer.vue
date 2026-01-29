<template>
  <div class="cartridge-programmer">
    <div class="programmer-header">
      <h3 class="text-xl font-bold mb-4">Mark 1 Cart Programmer</h3>
      <div class="connection-status" :class="connectionStatusClass">
        <i :class="connectionStatusIcon"></i>
        <span>{{ connectionStatusText }}</span>
      </div>
    </div>

    <!-- Device Detection Status -->
    <div class="device-status mb-4">
      <div class="status-header">
        <i :class="deviceStatusIcon"></i>
        <span>{{ deviceStatusText }}</span>
        <button @click="scanForDevice" class="scan-btn" :disabled="isScanning">
          <i class="fas fa-sync-alt" :class="{ 'fa-spin': isScanning }"></i>
          {{ isScanning ? 'Scanning...' : 'Rescan' }}
        </button>
      </div>
      
      <!-- Device Info -->
      <div v-if="deviceInfo" class="device-info">
        <div class="info-header">
          <i class="fas fa-microchip"></i>
          Mark 1 Cartridge Programmer
        </div>
        <div class="info-details">
          <div class="detail-item">
            <span class="label">Manufacturer:</span>
            <span class="value">{{ deviceInfo.manufacturer }}</span>
          </div>
          <div class="detail-item">
            <span class="label">Model:</span>
            <span class="value">{{ deviceInfo.name }}</span>
          </div>
          <div class="detail-item">
            <span class="label">USB ID:</span>
            <span class="value">{{ deviceInfo.vendor }}:{{ deviceInfo.product }}</span>
          </div>
          <div v-if="deviceInfo.bus" class="detail-item">
            <span class="label">Bus:</span>
            <span class="value">{{ deviceInfo.bus }}</span>
          </div>
          <div v-if="devicePermissions" class="detail-item">
            <span class="label">Device:</span>
            <span class="value" :class="{ 'permission-error': !devicePermissions.readable }">
              {{ devicePermissions.exists ? devicePermissions.message : 'Not found' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <p class="text-gray-600 mb-4">Connect to your Mark 1 cartridge programmer via IPC serial communication.</p>
    
    <!-- Linux Permission Helper -->
    <div v-if="connectionError && (connectionError.includes('chmod') || connectionError.includes('Permission denied'))" class="linux-helper mb-4">
      <div class="helper-header">
        <i class="fab fa-linux"></i>
        Linux Permission Fix
      </div>
      <div class="helper-content">
        <p>If your Mark 1 device is connected but not accessible:</p>
        <div class="code-block">
          <code>sudo chmod 777 /dev/ttyACM0</code>
          <button @click="copyCommand" class="copy-btn" title="Copy to clipboard">
            <i class="fas fa-copy"></i>
          </button>
        </div>
        <p class="helper-note">For permanent fix: <code>sudo usermod -a -G dialout $USER</code></p>
        <p class="helper-note">After fixing permissions: <code>Refresh the page and try again</code></p>
      </div>
    </div>

    <!-- Connection Troubleshooting -->
    <div v-if="connectionError && !connectionError.includes('chmod')" class="troubleshooting-helper mb-4">
      <div class="helper-header">
        <i class="fas fa-wrench"></i>
        Connection Troubleshooting
      </div>
      <div class="helper-content">
        <p v-if="connectionError.includes('No port selected')">
          The browser couldn't find any serial devices. Follow these steps:
        </p>
        <p v-else>
          Connection failed. Try these steps:
        </p>
        <ol class="troubleshooting-steps">
          <li><strong>Check physical connection:</strong> Make sure Mark 1 is connected via USB</li>
          <li><strong>Verify device exists:</strong> Run <code>ls /dev/ttyACM0</code> in terminal</li>
          <li><strong>Fix permissions:</strong> Run <code>sudo chmod 777 /dev/ttyACM0</code></li>
          <li><strong>Refresh page:</strong> Press F5 to reload the page</li>
          <li><strong>Select device carefully:</strong> When prompted, choose "Raspberry Pi Pico" or similar</li>
          <li><strong>Try different approach:</strong> If no devices appear, try a different USB cable/port</li>
        </ol>
        
        <div class="device-selection-guide">
          <h5>How to Select the Correct Device:</h5>
          <ul>
            <li>Click "Connect to Mark 1" button</li>
            <li>A dialog will appear showing available serial devices</li>
            <li>Look for device names containing:
              <ul>
                <li><strong>"Raspberry Pi Pico"</strong></li>
                <li><strong>"ttyACM0"</strong> (Linux)</li>
                <li><strong>"USB Serial Device"</strong> (Windows)</li>
                <li><strong>"cu.usbmodem"</strong> (macOS)</li>
              </ul>
            </li>
            <li>If you see multiple devices, choose the one that appeared when you connected Mark 1</li>
            <li>If unsure, disconnect Mark 1, refresh, see what disappears, then reconnect and select that device</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Connection Controls -->
    <div class="connection-controls">
      <button 
        @click="connectSerial" 
        class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 w-full"
        :disabled="isConnecting || !isDeviceConnected"
      >
        <i class="fas fa-usb mr-2"></i>
        {{ isConnecting ? 'Connecting...' : 'Connect to Mark 1' }}
      </button>
      
      <button 
        v-if="isConnected" 
        @click="disconnectSerial" 
        class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 w-full mt-2"
        :disabled="isProgramming"
      >
        <i class="fas fa-unlink mr-2"></i>
        Disconnect
      </button>
    </div>

    <!-- File Selection -->
    <div v-if="isConnected" class="file-section mt-4">
      <h4 class="text-lg font-semibold mb-2">ROM File</h4>
      <div class="file-input-group">
        <input 
          type="file" 
          ref="fileInput"
          @change="handleFileSelect" 
          accept=".bin,.rom,.md"
          class="file-input"
          :disabled="isProgramming"
        />
        <button 
          @click="$refs.fileInput.click()" 
          class="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
          :disabled="isProgramming"
        >
          <i class="fas fa-file-upload mr-2"></i>
          Select ROM File
        </button>
      </div>
      
      <div v-if="selectedFile" class="file-info mt-2">
        <p class="text-sm text-gray-300">
          <i class="fas fa-file mr-2"></i>
          {{ selectedFile.name }} ({{ formatFileSize(selectedFile.size) }})
        </p>
      </div>
    </div>

    <!-- Programming Controls -->
    <div v-if="isConnected && selectedFile" class="programming-section mt-4">
      <h4 class="text-lg font-semibold mb-2">Programming</h4>
      
      <div v-if="isProgramming" class="programming-progress">
        <div class="progress-bar">
          <div 
            class="progress-fill" 
            :style="{ width: programmingProgress + '%' }"
          ></div>
        </div>
        <p class="text-sm text-gray-300 mt-2">
          Progress: {{ programmingProgress.toFixed(1) }}% ({{ formatFileSize(bytesTransferred) }} / {{ formatFileSize(totalBytes) }})
        </p>
      </div>
      
      <button 
        @click="programCartridge" 
        class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 w-full"
        :disabled="isProgramming || !selectedFile"
      >
        <i class="fas fa-download mr-2"></i>
        {{ isProgramming ? 'Programming...' : 'Program Cartridge' }}
      </button>
    </div>

    <!-- Status Messages -->
    <div v-if="statusMessage" class="status-message mt-4" :class="statusMessageType">
      <i :class="statusMessageIcon"></i>
      <span>{{ statusMessage }}</span>
    </div>

    <!-- Serial Monitor -->
    <div v-if="isConnected" class="serial-monitor mt-4">
      <h4 class="text-lg font-semibold mb-2">Serial Monitor</h4>
      <div class="serial-output">
        <div 
          v-for="(message, index) in serialMessages" 
          :key="index"
          class="serial-message"
        >
          <span class="timestamp">{{ new Date().toLocaleTimeString() }}</span>
          <span class="message-text">{{ message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
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
const serialMessages = ref([])
const deviceInfo = ref(null)
const isDeviceConnected = ref(false)
const devicePermissions = ref(null)
const isScanning = ref(false)

// Serial port references (no longer needed with IPC approach)
// let port = null
// let reader = null
// let writer = null
// let readingLoopActive = false

// Computed properties
const connectionStatusClass = computed(() => ({
  'connected': isConnected.value,
  'connecting': isConnecting.value,
  'disconnected': !isConnected.value && !isConnecting.value
}))

const connectionStatusText = computed(() => {
  if (isConnecting.value) return 'Connecting...'
  if (isConnected.value) return 'Mark 1 Connected'
  return 'Disconnected'
})

const connectionStatusIcon = computed(() => {
  if (isConnecting.value) return 'fas fa-spinner fa-spin'
  if (isConnected.value) return 'fas fa-check-circle'
  return 'fas fa-unlink'
})

const deviceStatusIcon = computed(() => {
  if (isScanning.value) return 'fas fa-spinner fa-spin'
  if (isDeviceConnected.value) return 'fas fa-check-circle'
  return 'fas fa-unlink'
})

const deviceStatusText = computed(() => {
  if (isScanning.value) return 'Scanning...'
  if (isDeviceConnected.value) return 'Mark 1 Connected'
  return 'No Device Found'
})

const statusMessageIcon = computed(() => {
  switch (statusMessageType.value) {
    case 'success': return 'fas fa-check-circle'
    case 'error': return 'fas fa-exclamation-triangle'
    default: return 'fas fa-info-circle'
  }
})

// Methods
const displayStatusMessage = (message, type = 'info') => {
  statusMessage.value = message
  statusMessageType.value = type
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const copyCommand = () => {
  navigator.clipboard.writeText('sudo chmod 777 /dev/ttyACM0')
  displayStatusMessage('Command copied to clipboard!', 'success')
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
.cartridge-programmer {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 20px;
  color: #ccc;
}

.programmer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #333;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
}

.connection-status.connected {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  border: 1px solid #22c55e;
}

.connection-status.connecting {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
  border: 1px solid #3b82f6;
}

.connection-status.disconnected {
  background: rgba(107, 114, 128, 0.2);
  color: #6b7280;
  border: 1px solid #6b7280;
}

.device-status {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 16px;
}

.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.status-header i {
  font-size: 18px;
  margin-right: 8px;
}

.scan-btn {
  background: #444;
  border: 1px solid #555;
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.scan-btn:hover:not(:disabled) {
  background: #555;
  color: #fff;
}

.scan-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.device-info {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid #444;
  border-radius: 6px;
  padding: 12px;
}

.info-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 500;
  color: #3b82f6;
}

.info-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.detail-item .label {
  color: #999;
}

.detail-item .value {
  color: #fff;
  font-family: monospace;
}

.detail-item .permission-error {
  color: #ef4444;
}

.device-selection-guide {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 12px;
  margin-top: 12px;
}

.device-selection-guide h5 {
  color: #3b82f6;
  margin-bottom: 8px;
  font-size: 14px;
}

.device-selection-guide ul {
  margin: 0;
  padding-left: 20px;
  color: #ccc;
  font-size: 12px;
}

.device-selection-guide li {
  margin-bottom: 4px;
}

.device-selection-guide li ul {
  margin-top: 4px;
  margin-bottom: 4px;
}

.device-selection-guide li ul li {
  margin-bottom: 2px;
  color: #aaa;
}

.troubleshooting-steps li strong {
  color: #fff;
}

.troubleshooting-steps li code {
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 3px;
  border-radius: 2px;
  color: #00ff00;
  font-family: monospace;
}

.linux-helper {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid #3b82f6;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.troubleshooting-helper {
  background: rgba(251, 146, 60, 0.1);
  border: 1px solid #fb923c;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.troubleshooting-helper .helper-header {
  color: #fb923c;
}

.troubleshooting-steps {
  margin: 8px 0 0 0;
  padding-left: 20px;
  color: #ccc;
  font-size: 12px;
}

.troubleshooting-steps li {
  margin-bottom: 4px;
}

.helper-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 500;
  color: #3b82f6;
}

.helper-content p {
  margin-bottom: 8px;
  font-size: 14px;
}

.code-block {
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px 12px;
  margin: 8px 0;
  font-family: monospace;
  font-size: 13px;
}

.code-block code {
  flex: 1;
  color: #00ff00;
}

.copy-btn {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
  padding: 4px;
  border-radius: 2px;
  transition: background 0.2s;
}

.copy-btn:hover {
  background: rgba(59, 130, 246, 0.2);
}

.helper-note {
  font-size: 12px;
  color: #999;
  margin: 4px 0;
}

.helper-note code {
  background: rgba(0, 0, 0, 0.2);
  padding: 2px 4px;
  border-radius: 2px;
  color: #00ff00;
}

.connection-controls {
  margin-bottom: 20px;
}

.file-section {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 16px;
}

.file-input-group {
  display: flex;
  gap: 12px;
  align-items: center;
}

.file-input {
  display: none;
}

.file-info {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px 12px;
}

.programming-section {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 16px;
}

.programming-progress {
  margin-bottom: 16px;
}

.progress-bar {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #444;
  border-radius: 4px;
  height: 8px;
  overflow: hidden;
}

.progress-fill {
  background: linear-gradient(90deg, #3b82f6, #22c55e);
  height: 100%;
  transition: width 0.3s ease;
}

.status-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 6px;
  font-size: 14px;
}

.status-message.success {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  border: 1px solid #22c55e;
}

.status-message.error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border: 1px solid #ef4444;
}

.status-message.info {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
  border: 1px solid #3b82f6;
}

.serial-monitor {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 16px;
}

.serial-output {
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
}

.serial-message {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.timestamp {
  color: #666;
  font-size: 11px;
}

.message-text {
  color: #00ff00;
}

button {
  transition: all 0.2s;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
