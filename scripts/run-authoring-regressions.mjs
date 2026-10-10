// Issue #44: deterministic authoring checks; no game workspace or original ROM.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const tests = [
  'packaged-shared', 'compiled-resources', 'build-snapshot', 'error-parser', 'hardware-dialog', 'hardware-budget-editor', 'workspace-layout', 'runtime-scene', 'scene-export', 'runtime-core', 'runtime-collision', 'runtime-combat', 'runtime-input', 'input-mapping', 'runtime-install', 'new-project-runtime', 'project-contract', 'ai-sdk-context', 'project-assets', 'asset-report',
  'export-transaction', 'asset-quarantine', 'character-export', 'character-workspace', 'charset-export-save', 'charset-frames',
  'map-composition', 'map-objects', 'map-export', 'map-save', 'map-workspace', 'map-library', 'map-layers', 'map-recent',
  'map-kit-files', 'map-kit-authoring', 'tmx-attrs', 'animation-editor',
  'cutscene-runtime', 'cutscene-editor', 'cutscene-export', 'cutscene-cli', 'character-runtime', 'character-controller', 'character-preview', 'character-sprite', 'character-geometry', 'runtime-slopes', 'map-terrain', 'collision-diagnostic', 'runtime-movement', 'movement-configuration', 'movement-lab', 'movement-editor', 'movement-diagnostic', 'movement-diagnostic-service', 'runtime-world', 'world-configuration', 'world-editor', 'world-build', 'runtime-world-sgdk', 'world-diagnostic', 'world-maps', 'world-map-export', 'world-refresh',
  'runtime-camera', 'camera-configuration', 'camera-preview', 'camera-editor',
  'runtime-progress', 'progress-configuration', 'progress-editor',
  'runtime-audio', 'audio-configuration', 'audio-editor',
  'runtime-cutscene-host', 'cutscene-adapter', 'cutscene-adapter-panel',
  'toolchain', 'toolchain-panel', 'starter-project',
  'runtime-debug', 'debug-configuration', 'debug-panel', 'custom-adapter', 'export-overview', 'sdk-suggestions', 'portable-paths', 'asset-import', 'runtime-palette', 'palette-configuration', 'palette-editor', 'run-workspace', 'document-history', 'editor-drafts', 'editor-recovery', 'gdb-remote', 'debug-session', 'rom-debugger', 'build-flavor', 'runtime-scenery', 'runtime-scenery-sgdk', 'scenery-export', 'scenery-composition', 'runtime-hud', 'hud-configuration', 'hud-editor'
]
const failures = []
for (const test of tests) {
  const result = spawnSync(process.execPath, ['scripts/smoke-' + test + '.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024
  })
  if (result.status === 0 && !result.error) console.log('PASS ' + test)
  else {
    failures.push(test)
    console.error('FAIL ' + test + '\n' + (result.error?.message || '') + '\n' +
      String(result.stdout || '').slice(-8000) + String(result.stderr || '').slice(-8000))
  }
}
console.log((tests.length - failures.length) + '/' + tests.length + ' authoring regressions passed.')
if (failures.length) process.exitCode = 1
