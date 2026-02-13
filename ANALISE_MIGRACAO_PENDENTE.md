# Análise Profunda: Migração Pendente Retro Studio

## Resumo Executivo

| Categoria | Status | Prioridade |
|-----------|--------|------------|
| **IPC / Backend** | ~85% migrado | - |
| **Componentes UI** | ~70% migrado | - |
| **Integrações** | ~60% migrado | - |
| **Utilitários** | ~50% migrado | - |

---

## 1. IPC Handlers — Gaps

### ✅ Já migrado
- `retro:req-project`, `retro:get-project-config`, `retro:is-retro-project`, `retro:create-project`
- `retro:scan-resources`, `retro:add-asset-to-config`, `retro:save-project-config`
- `retro:get-asset-preview`, `retro:get-palette-colors`, `retro:copy-asset-to-project`
- `retro:register-asset-resource`, `retro:remove-asset-from-config`, `retro:rename-asset-file`
- `retro:find-definition`, `retro:select-folder`, `retro:get-ui-settings`, `retro:save-ui-settings`, `retro:select-file`
- `retro:get-available-emulators`, `retro:get-emulator-config`, `retro:set-emulator-config`
- `retro:get-custom-emulator-paths`, `retro:set-custom-emulator-paths`, `retro:browse-emulator-path`
- `retro:detect-cartridge-device`, `retro:check-device-permissions`, `retro:connect-serial`, `retro:disconnect-serial`, `retro:write-serial`
- `retro:read-file-buffer`, `retro:get-current-rom-info`, `retro:validate-rom-file`
- `retro:save-scene`, `retro:load-scene`, `retro:export-scene`
- `retro:load-markdown-file`, `retro:load-content-topics`, `retro:load-tutorials`
- `retro:get-downloadable-packages`, `retro:download-package`
- `retro:run-game`, `retro:build-only`, `retro:stop-build` (game.js)

### ❌ Pendente

| Handler | Antigo | Novo | Uso |
|---------|--------|------|-----|
| `open-external-editor` | `ui.js` | **ausente** | Abrir imagem/mapa em Aseprite, Tiled etc. |
| `retro:get-cartridge-config` | `cartridge.js` | **ausente** | Carregar config do cart (vendorId, baud, chunkSize) |
| `retro:save-cartridge-config` | `cartridge.js` | **ausente** | Salvar config do cart |
| `retro:start-device-polling` | `cartridge.js` | **ausente** | Polling automático de dispositivo USB |
| `retro:stop-device-polling` | `cartridge.js` | **ausente** | Parar polling |
| `retro:get-res-files` | `project.js` | **ausente** | Listar arquivos de `res/` |
| `retro:add-detected-assets` | `project.js` | **ausente** | Adicionar assets detectados em batch |

---

## 2. Componentes UI — Gaps

### ✅ Já migrado
- `Settings.vue` (com Modo Visual, Ferramentas Externas, Emuladores, Cart Programmer)
- `EmulatorSettings.vue`, `ToolkitDownloads.vue`, `NewProjectModal.vue`
- `HelpViewer.vue`, `ResourcesPanel.vue`, `AssetsManager.vue`
- `VisualEditor.vue`, `SceneViewport.vue`, `SceneHierarchy.vue`, `InspectorPanel.vue`
- `ViewportToolbar.vue`, `FsNamePrompt.vue`, `CartridgeProgrammer.vue` (básico)

### ❌ Pendente / Parcial

| Componente | Antigo | Novo | Gap |
|------------|--------|------|-----|
| **FileTree** | `FileExplorer.vue` | `FileTree.vue` | **Sem menu "Editar com"** para imagens/mapas em projetos Retro |
| **AssetsManager** | Context menu completo | `AssetsManager.vue` | **Sem "Editar com"** (imageEditorPath, mapEditorPath, open-external-editor) |
| **CartridgeProgrammer** | Completo (flash, progress, config) | Simplificado | Falta: **Program Cartridge**, **Progress bar**, **Config UI** (vendorId, baud, chunkSize), **Device polling** |
| **ErrorPanel** | `ErrorPanel.vue` | **ausente** | Painel de erros de compilação |
| **PaletteEditor** | `PaletteEditor.vue` | **ausente** | Editor de paletas |
| **TileSpriteEditor** | `TileSpriteEditor.vue` | **ausente** | Editor de tiles/sprites |
| **ViewportMinimap** | `ViewportMinimap.vue` | **ausente** | Minimap no viewport visual |
| **CodeEditor** | Formatação C | Monaco | **codeFormatter** não integrado |

---

## 3. Utilitários — Gaps

### ✅ Já migrado
- `sgdkAutocomplete.js`, `sgdkSnippets.js`, `sgdkHoverProvider.js`, `sgdkDocsData.js`
- `markdownTutorialsLoader.js`, `projectAssetManager.js`
- `errorParser.js` (em `electron/retro/`)
- `helpWatcher.js` (em `electron/`)

### ❌ Pendente

| Utilitário | Antigo | Novo | Uso |
|------------|--------|------|-----|
| `codeFormatter.js` | `utils/codeFormatter.js` | **ausente** | Formatar código C |
| `paletteValidator.js` | `utils/paletteValidator.js` | **ausente** | Validar paletas |
| `palettePreviewGenerator.js` | `utils/palettePreviewGenerator.js` | **ausente** | Preview de paleta |
| `megadriveExport.js` | `utils/megadriveExport.js` | **ausente** | Export ROM |
| `sgdkLSPProviders.js` | `utils/sgdkLSPProviders.js` | **ausente** | LSP-like providers |
| `importValidationHelper.js` | `utils/importValidationHelper.js` | **ausente** | Validação de imports |

---

## 4. Integrações — Gaps

### 4.1 Editor externo (imagens/mapas)
- **Antigo:** `open-external-editor` spawna `editorPath` com `filePath`
- **Novo:** Não existe. `imageEditorPath` e `mapEditorPath` estão em Settings, mas não são usados

**Ação:** Adicionar IPC `retro:open-external-editor` e integrar no FileTree + AssetsManager.

### 4.2 Config do Cartridge
- **Antigo:** `get-cartridge-config`, `save-cartridge-config` — persiste vendorId, baudRate, chunkSize, swapEndianness
- **Novo:** Config está em ui-settings, mas CartridgeProgrammer não carrega/exibe

**Ação:** CartridgeProgrammer deve usar `retroUiSettings` (cartridge*) e exibir no painel.

### 4.3 Device polling
- **Antigo:** `start-device-polling` / `stop-device-polling` — detecta dispositivo automaticamente
- **Novo:** Apenas `detectCartridgeDevice` manual

**Ação:** Migrar polling do `cartridge.js` antigo.

### 4.4 Erros de compilação
- **Antigo:** `ErrorPanel.vue` exibe erros parseados; `compilation-errors` é emitido
- **Novo:** `retro:compilation-errors` existe; mas não há painel dedicado

**Ação:** Criar painel ou integrar erros no Terminal/StatusBar.

### 4.5 Formatação de código
- **Antigo:** `formatCode` no CodeEditor (Ctrl+Shift+F)
- **Novo:** Monaco sem formatação C

**Ação:** Migrar `codeFormatter.js` e registrar no editor.

---

## 5. Fluxos de Uso — Verificação

| Fluxo | Antigo | Novo | Status |
|-------|--------|------|--------|
| Abrir projeto | ✅ | ✅ | OK |
| Build + Play | ✅ | ✅ | OK |
| Selecionar emulador | ✅ | ✅ | OK |
| Editar sprite com Aseprite | ✅ | ❌ | **Falta** |
| Editar mapa com Tiled | ✅ | ❌ | **Falta** |
| Ver erros de compilação | ✅ | Parcial | Terminal recebe; sem painel |
| Formatar código C | ✅ | ❌ | **Falta** |
| Gravar cartucho | ✅ | Parcial | Conecta; sem flash |
| Configurar cart (vendorId etc.) | ✅ | Parcial | Em Settings; sem UI no Cart |
| Device polling | ✅ | ❌ | **Falta** |

---

## 6. Priorização Recomendada

### Alta (impacto direto no UX)
1. **open-external-editor** — Editar imagens/mapas com ferramentas externas
2. **"Editar com" no FileTree** — Context menu para projetos Retro
3. **"Editar com" no AssetsManager** — Idem para assets
4. **ErrorPanel ou integração** — Erros de compilação visíveis

### Média
5. **CartridgeProgrammer completo** — Flash + progress + config UI
6. **Device polling** — Detecção automática de dispositivo
7. **codeFormatter** — Formatação C no editor

### Baixa
8. **PaletteEditor** — Edição avançada de paletas
9. **TileSpriteEditor** — Edição de tiles
10. **ViewportMinimap** — Minimap no viewport
11. **get-res-files** / **add-detected-assets** — Se houver fluxo de detecção em batch

---

## 7. Checklist de Implementação

### Fase A: Editor Externo (1–2 dias)
- [ ] IPC `retro:open-external-editor` em `project.js` ou `main.js`
- [ ] Preload: `openExternalEditor(editorPath, filePath)`
- [ ] FileTree: context menu "Editar com" para imagens/mapas em projetos Retro
- [ ] AssetsManager: context menu "Editar com" para sprites/tiles/tilemaps
- [ ] Usar `retroUiSettings.imageEditorPath` / `mapEditorPath`

### Fase B: Cartridge Programmer (2–3 dias)
- [ ] IPC `retro:get-cartridge-config`, `retro:save-cartridge-config`
- [ ] IPC `retro:start-device-polling`, `retro:stop-device-polling`
- [ ] CartridgeProgrammer: UI de config (vendorId, baud, chunkSize)
- [ ] CartridgeProgrammer: botão "Program Cartridge" + progress
- [ ] Migrar lógica de flash do `cartridge.js` antigo

### Fase C: Erros e Formatação (1 dia)
- [ ] ErrorPanel ou painel colapsável no Terminal
- [ ] codeFormatter.js integrado ao Monaco
- [ ] Atalho Ctrl+Shift+F para formatar

### Fase D: Opcional
- [ ] PaletteEditor, TileSpriteEditor
- [ ] ViewportMinimap
- [ ] get-res-files, add-detected-assets
