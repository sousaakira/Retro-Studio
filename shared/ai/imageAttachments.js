// ACP image content is inline base64, never a renderer-supplied file path/URL.
export const IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp'])
export const MAX_IMAGE_COUNT = 4
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000

export function imageAttachmentError(code) {
  const error = new Error(`ACP_IMAGE_${code}`)
  error.code = `ACP_IMAGE_${code}`
  return error
}

export function imageByteSize(data) {
  return data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
}

/** Shared checks also run in AcpClient, before any bytes go to an agent. */
export function validateImageAttachments(images = []) {
  if (!Array.isArray(images)) throw imageAttachmentError('INVALID')
  if (images.length > MAX_IMAGE_COUNT) throw imageAttachmentError('COUNT')
  let total = 0
  return images.map(image => {
    if (!image || !IMAGE_MIME_TYPES.includes(image.mimeType)) throw imageAttachmentError('FORMAT')
    const data = image.data
    if (typeof data !== 'string' || !data.length) throw imageAttachmentError('INVALID')
    if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw imageAttachmentError('SIZE')
    if (data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw imageAttachmentError('INVALID')
    const size = imageByteSize(data)
    if (size > MAX_IMAGE_BYTES) throw imageAttachmentError('SIZE')
    total += size
    if (total > MAX_TOTAL_IMAGE_BYTES) throw imageAttachmentError('TOTAL')
    const header = atob(data.slice(0, 32))
    const matches = image.mimeType === 'image/png'
      ? header.startsWith('\x89PNG\r\n\x1a\n')
      : image.mimeType === 'image/jpeg'
        ? header.startsWith('\xff\xd8\xff')
        : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP'
    if (!matches) throw imageAttachmentError('INVALID')
    return { type: 'image', mimeType: image.mimeType, data }
  })
}
