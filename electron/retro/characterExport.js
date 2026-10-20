import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { publishProjectOutputs, readProjectOutput } from './exportTransaction.js'
import { sameCharsetOwner, validateCharsetSourceReferences } from '../../shared/retro/charsetSources.js'
import { charsetFrameOffset, charsetProjectVersion } from '../../shared/retro/charsetAlignment.js'

const hash = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex')
function textBytes(value, label, nullable = false) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || Buffer.byteLength(value) > 4 * 1024 * 1024)
    throw new Error('Invalid character export ' + label + '.')
  return Buffer.from(value)
}
/** Fixed character outputs; no renderer-supplied arbitrary output list. */
export function exportCharacterToProject(projectPath, request, options = {}) {
  const root = fs.realpathSync(projectPath)
  const { characterName, imageName, projectFile, png, resources, header,
    characterProject, expectedResources, expectedHeader, expectedProject } = request || {}
  if (typeof characterName !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(characterName) ||
      typeof imageName !== 'string' || !/^[a-zA-Z0-9_.-]{1,200}\.png$/i.test(imageName) ||
      typeof projectFile !== 'string' || !/^charsets\/[a-zA-Z0-9_.-]{1,200}\.charset\.json$/.test(projectFile))
    throw new Error('Invalid character export names.')
  if ((!Array.isArray(png) && !Buffer.isBuffer(png) && !(png instanceof Uint8Array)) ||
      png.length > 24 * 1024 * 1024 || (Array.isArray(png) && png.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)))
    throw new Error('Invalid character PNG bytes.')
  const pngBytes = Buffer.from(png)
  if (!pngBytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    throw new Error('Character atlas must be a PNG.')
  const resourceBytes = textBytes(resources, 'resources')
  const headerBytes = textBytes(header, 'header')
  const projectBytes = textBytes(characterProject, 'project')
  const oldResourceBytes = textBytes(expectedResources, 'resource revision', true)
  const oldHeaderBytes = textBytes(expectedHeader, 'header revision', true)
  const oldProjectBytes = textBytes(expectedProject, 'project revision', true)
  if (hash(readProjectOutput(root, projectFile)) !== hash(oldProjectBytes))
    throw new Error('Character project revision changed; refresh before exporting.')
  const data = JSON.parse(projectBytes.toString('utf8'))
  const saved = oldProjectBytes ? JSON.parse(oldProjectBytes.toString('utf8')) : null
  const headerName = characterName + '_animations.h'
  if (data?.format !== 'retro-studio-charset-project' || ![4,5,6,7,8].includes(data.version) ||
      !Array.isArray(data.animations) || !data.animations.length ||
      data.exportedFileName !== imageName || data.exportedHeaderName !== headerName)
    throw new Error('Invalid character project export metadata.')
  if (data.version >= 7) {
    if (typeof data.characterId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.characterId)) throw new Error('Invalid character identity.')
    validateCharsetSourceReferences(data)
  }
  for (const animation of data.animations) for (const frame of animation.frames || []) charsetFrameOffset(frame)
  if (charsetProjectVersion(data.animations) === 8 && data.version < 8) throw new Error('Fine alignment requires character project version 8.')
  const currentPng = readProjectOutput(root, 'res/' + imageName)
  const sameSource = sameCharsetOwner(root, saved, data)
  if (currentPng !== null && (!sameSource || saved.exportedFileName !== imageName))
    throw new Error('Existing PNG belongs to another source; choose a different name.')
  if (oldHeaderBytes !== null && (!sameSource || saved.exportedHeaderName !== headerName))
    throw new Error('Existing animation header belongs to another character.')
  const configBytes = readProjectOutput(root, 'retro-studio.json')
  if (configBytes === null || configBytes.length > 1024 * 1024) throw new Error('Project configuration is missing or too large.')
  const config = JSON.parse(configBytes.toString('utf8'))
  if (config.resourcePath && config.resourcePath !== 'res')
    throw new Error('Character export currently requires resourcePath=res.')
  if (config.assets !== undefined && !Array.isArray(config.assets)) throw new Error('Invalid project asset inventory.')
  config.assets ||= []
  const assetPath = 'res/' + imageName
  const existing = config.assets.find(asset => asset.path?.replaceAll('\\', '/') === assetPath)
  const asset = { ...existing, id: existing?.id || 'charset_' + randomUUID(), name: imageName,
    type: 'sprite', size: pngBytes.length, path: assetPath, createdAt: existing?.createdAt || new Date().toISOString(),
    metadata: { ...existing?.metadata, charset: true, character: characterName } }
  if (existing) config.assets[config.assets.indexOf(existing)] = asset
  else config.assets.push(asset)
  const receipt = publishProjectOutputs(root, [
    { path: assetPath, bytes: pngBytes, expectedHash: hash(currentPng) },
    { path: 'res/resources.res', bytes: resourceBytes, expectedHash: hash(oldResourceBytes) },
    { path: 'src/' + headerName, bytes: headerBytes, expectedHash: hash(oldHeaderBytes) },
    { path: projectFile, bytes: projectBytes, expectedHash: hash(oldProjectBytes) },
    { path: 'retro-studio.json', bytes: Buffer.from(JSON.stringify(config, null, 2) + '\n'), expectedHash: hash(configBytes) }
  ], { producer: 'character-export', ...options })
  return { ...receipt, assetPath, asset }
}
