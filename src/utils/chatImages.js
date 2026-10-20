import {
  IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, imageAttachmentError
} from '../../shared/ai/imageAttachments.js'

export function clipboardImageFiles(clipboardData) {
  const files = Array.from(clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter(Boolean)
  // Some clipboard implementations expose Files without DataTransferItems.
  return files.length ? files : Array.from(clipboardData?.files || [])
    .filter(file => file.type.startsWith('image/'))
}

export function imagePreviewSource(image) {
  return `data:${image.mimeType};base64,${image.data}`
}

export async function readChatImage(file) {
  if (!IMAGE_MIME_TYPES.includes(file.type)) throw imageAttachmentError('FORMAT')
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw imageAttachmentError('SIZE')
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw imageAttachmentError('DIMENSIONS')
    }
    const width = bitmap.width
    const height = bitmap.height
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(imageAttachmentError('INVALID'))
      reader.onabort = () => reject(imageAttachmentError('INVALID'))
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.readAsDataURL(file)
    })
    return {
      id: crypto.randomUUID(), name: String(file.name || '').slice(0, 120),
      mimeType: file.type, data, width, height, size: file.size
    }
  } catch (error) {
    throw error?.code ? error : imageAttachmentError('INVALID')
  } finally {
    bitmap?.close()
  }
}
