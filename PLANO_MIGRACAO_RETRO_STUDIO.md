# Plano de Migração: Retro Studio → Monarco (retro-studio-new)

## Resumo Executivo

**Objetivo:** Integrar as funcionalidades de criação de jogos retro (Sega Mega Drive / SGDK) do `retro-studio` no `retro-studio-new` (Monarco), resultando em um único IDE com editor + IA local + toolchain de desenvolvimento de jogos.

**Base:** Monarco (retro-studio-new) — arquitetura mais moderna, electron-vite, Monaco, IA integrada.  
**Origem:** Retro Studio — Vuex, Vuetify, CodeMirror/Monaco, toolchain SGDK/MarsDev.

---

## 1. Inventário: retro-studio (o que migrar)

### 1.1 IPC Handlers (Main Process)
| Handler | Arquivo | Função |
|---------|---------|--------|
| `game.js` | Build + emulador | `run-game`, spawn make, spawn emulador, parse erros |
| `project.js` | Projetos | `create-project`, `req-projec`, `scan-resources`, assets, paletas, preview |
| `emulator.js` | Emuladores | Listar, configurar, resolver path |
| `scene.js` | Cenas visuais | CRUD cenas, nodes |
| `cartridge.js` | Cart Programmer | Flash ROM em cartucho físico |
| `downloads.js` | Toolkit | Download MarsDev/SGDK |
| `fs.js` | FS | read/write, select-folder, select-file |
| `ui.js` | UI | save-ui-settings, get-ui-settings |
| `tutorials.js` | Tutoriais | Markdown help |
| `terminal.js` | Terminal | PTY (já existe no Monarco) |

### 1.2 Utilitários Main
| Arquivo | Função |
|---------|--------|
| `projectUtils.js` | Templates (md-skeleton, sgdk-skeleton), `lerDiretorio`, `getProjectConfig` |
| `assetUtils.js` | `getResourcePath`, `scanResourcesFolder`, `detectAssetType` |
| `emulatorUtils.js` | `resolveEmulatorPath`, `findRomOutput` |
| `downloadManager.js` | Download e extração do toolkit |
| `utils.js` | `loadConfigFile`, `copyDirectoryRecursive`, `ensureConfigDir`, TOOLKIT_DIR |

### 1.3 Componentes Vue (Frontend)
| Componente | Função |
|------------|--------|
| `MainLayout.vue` | Layout principal, top bar, play, emulator selector, cartridge |
| `FileExplorer.vue` | Árvore de arquivos (Monarco tem FileTree) |
| `CodeEditor.vue` | Monaco com SGDK (autocomplete, snippets, LSP) |
| `VisualEditor.vue` | Modo visual (Godot-like) |
| `SceneViewport.vue` | Viewport 2D |
| `SceneHierarchy.vue` | Árvore de nodes |
| `InspectorPanel.vue` | Propriedades do node |
| `AssetsManager.vue` | Sprites, tiles, paletas, sons |
| `ResourcesPanel.vue` | Lista de recursos |
| `CartridgeProgrammer.vue` | Flash cartucho |
| `EmulatorSettings.vue` | Config emulador |
| `ToolkitDownloads.vue` | Download MarsDev |
| `NewProjectModal.vue` | Criar projeto com template |
| `HelpViewer.vue` | Tutoriais markdown |
| `CommandPalette.vue` | Comandos (Monarco tem) |
| `Terminal*` | Terminal (Monarco tem) |

### 1.4 Utilitários Frontend
| Arquivo | Função |
|---------|--------|
| `sgdkAutocomplete.js` | Autocomplete C/SGDK |
| `sgdkSnippets.js` | Snippets |
| `sgdkHoverProvider.js` | Hover docs |
| `sgdkLSPProviders.js` | LSP-like providers |
| `sgdkDocsData.js` | Dados de documentação |
| `errorParser.js` | Parse saída do make |
| `megadriveExport.js` | Export ROM |
| `projectAssetManager.js` | Gerenciar assets no projeto |
| `assetManager.js` | Utilitários de assets |
| `paletteValidator.js` | Validar paletas |
| `palettePreviewGenerator.js` | Preview de paleta |
| `markdownTutorialsLoader.js` | Carregar tutoriais |

### 1.5 Toolkit / Exemplos
- `toolkit/examples/md-skeleton/`
- `toolkit/examples/sgdk-skeleton/`
- `toolkit/examples/sgdk-stage9-sample/`
- `toolkit/examples/32x-skeleton/` (se existir)
- `toolkit/examples/md-echo-test/`, `md-newlib-test/`

### 1.6 Estado (Vuex)
- `projectConfig`, `resources`, `sceneNodes`, `selectedNode`, `currentScene`
- `uiSettings`: toolkitPath, emulator, cartridge, imageEditorPath, mapEditorPath
- `enableVisualMode`, `viewMode` (code/visual)

---

## 2. Inventário: Monarco (retro-studio-new)

### 2.1 Arquitetura
- **Build:** electron-vite
- **State:** Composables (sem Vuex)
- **Editor:** Monaco (monaco-editor-vue3)
- **IA:** `electron/ai/` — AIAgent, tools (read_file, write_file, etc.), autocomplete
- **IPC:** `workspace:*`, `fs:*`, `git:*`, `terminal:*`, `ai:*`, `settings:*`

### 2.2 O que já existe
- FileTree, EditorTabs, Terminal, AIChat, CommandPalette
- StatusBar, ActivityBar, TitleBar, Settings
- DiffViewer, ContextMenu, Toast
- Workspace: `currentWorkspacePath` (equivalente a `projectConfig.path`)

### 2.3 O que falta para o Retro Studio
- Conceito de **projeto** (não só workspace)
- `retro-studio.json` e configuração de assets
- Build (make) e emulador
- Templates de projeto
- Assets Manager, Resources Panel
- Editor visual (SceneViewport, Hierarchy, Inspector)
- Cartridge Programmer
- Toolkit Downloads
- SGDK autocomplete/snippets/hover
- Emulator selector

---

## 3. Estratégia de Migração

### Princípios
1. **Monarco como base** — não alterar estrutura core do Monarco
2. **Feature flags** — habilitar modo "Retro Studio" quando workspace for projeto SGDK
3. **Modular** — adicionar módulos em `src/retro/` ou `electron/retro/`
4. **Sem Vuex** — usar composables ou Pinia para estado do projeto

---

## 4. Fases de Implementação

### Fase 1: Detecção e Projeto (1–2 semanas)
**Objetivo:** Reconhecer workspace como projeto Retro Studio e carregar config.

| Tarefa | Descrição |
|--------|------------|
| 1.1 | Copiar `projectUtils.js`, `assetUtils.js` para `electron/retro/` |
| 1.2 | Criar IPC handlers: `retro:getProjectConfig`, `retro:createProject`, `retro:isRetroProject` |
| 1.3 | Composable `useRetroProject()` — detectar `retro-studio.json`, `Makefile` |
| 1.4 | Integrar `NewProjectModal` — criar projeto a partir de templates |
| 1.5 | Copiar templates para `assets/toolkit/examples/` ou bundle |

**Entregáveis:** Abrir pasta de projeto SGDK → carregar config e exibir indicador "Projeto Retro Studio".

---

### Fase 2: Build e Emulador (1 semana)
**Objetivo:** Compilar e rodar o jogo.

| Tarefa | Descrição |
|--------|------------|
| 2.1 | Migrar `game.js` → `electron/retro/game.js` |
| 2.2 | Migrar `emulatorUtils.js`, `emulator.js` |
| 2.3 | Adicionar IPC: `retro:run-game`, `retro:stop-build`, `retro:compilation-errors` |
| 2.4 | Settings: `toolkitPath` (MarsDev) |
| 2.5 | Botão Play na TitleBar ou ActivityBar quando projeto Retro |
| 2.6 | Integrar output do build no Terminal (já existe) |
| 2.7 | Migrar `errorParser.js` |

**Entregáveis:** Botão Play → make → emulador abre com a ROM.

---

### Fase 3: Assets e Recursos (1–2 semanas)
**Objetivo:** Gerenciar sprites, tiles, paletas, sons.

| Tarefa | Descrição |
|--------|------------|
| 3.1 | Migrar handlers de `project.js` (scan-resources, add-asset, get-asset-preview, etc.) |
| 3.2 | Criar painel `ResourcesPanel.vue` ou integrar no FileTree |
| 3.3 | Criar `AssetsManager.vue` (ou simplificado) |
| 3.4 | Migrar `paletteValidator.js`, `palettePreviewGenerator.js` |
| 3.5 | Integrar com `resources.res` (SGDK) |

**Entregáveis:** Ver assets, adicionar, preview, registrar em `resources.res`.

---

### Fase 4: Editor de Código SGDK (1 semana)
**Objetivo:** Autocomplete, snippets, hover para C/SGDK.

| Tarefa | Descrição |
|--------|------------|
| 4.1 | Migrar `sgdkAutocomplete.js`, `sgdkSnippets.js`, `sgdkHoverProvider.js` |
| 4.2 | Registrar providers no Monaco para `.c` e `.h` |
| 4.3 | `find-definition-in-project` (já existe no project.js) |
| 4.4 | Integrar com `electron/retro/` |

**Entregáveis:** Ao editar `.c`/`.h` em projeto Retro: autocomplete e hover funcionam.

---

### Fase 5: Toolkit Downloads e Settings (1 semana)
**Objetivo:** Baixar MarsDev/SGDK e configurar paths.

| Tarefa | Descrição |
|--------|------------|
| 5.1 | Migrar `downloadManager.js`, `downloads.js` |
| 5.2 | Componente `ToolkitDownloads.vue` |
| 5.3 | Settings: toolkitPath, imageEditorPath, mapEditorPath |
| 5.4 | EmulatorSettings no painel de configurações |

**Entregáveis:** Usuário pode baixar toolkit e configurar emulador.

---

### Fase 6: Editor Visual (1–2 semanas) — Opcional
**Objetivo:** Modo visual estilo Godot para cenas.

| Tarefa | Descrição |
|--------|------------|
| 6.1 | Migrar `scene.js` IPC |
| 6.2 | Migrar `VisualEditor.vue`, `SceneViewport.vue`, `SceneHierarchy.vue`, `InspectorPanel.vue` |
| 6.3 | Composable `useSceneState()` (substituir Vuex) |
| 6.4 | Feature flag `enableVisualMode` |

**Entregáveis:** Botão "Visual" no modo projeto Retro → editor de cenas.

---

### Fase 7: Cartridge Programmer (1 semana) — Opcional
**Objetivo:** Flash ROM em cartucho físico.

| Tarefa | Descrição |
|--------|------------|
| 7.1 | Migrar `cartridge.js` |

**Entregáveis:** Painel para gravar ROM em cartucho.

---

### Fase 8: Tutoriais e Integração Final (1 semana)
**Objetivo:** Ajuda e polish.

| Tarefa | Descrição |
|--------|------------|
| 8.1 | Migrar `tutorials.js`, `helpWatcher.js` |
| 8.2 | Integrar `HelpViewer.vue` |
| 8.3 | Ajustar CommandPalette com comandos Retro |
| 8.4 | Renomear app para "Retro Studio" ou manter "Monarco" com modo Retro |

---

## 5. Estrutura de Arquivos Proposta

```
retro-studio-new/
├── electron/
│   ├── main.js              # existente
│   ├── retro/               # NOVO
│   │   ├── game.js
│   │   ├── project.js
│   │   ├── emulator.js
│   │   ├── scene.js
│   │   ├── cartridge.js
│   │   ├── downloads.js
│   │   ├── projectUtils.js
│   │   ├── assetUtils.js
│   │   ├── emulatorUtils.js
│   │   └── utils.js
│   └── ai/                  # existente
├── src/
│   ├── components/
│   │   ├── retro/           # NOVO
│   │   │   ├── AssetsManager.vue
│   │   │   ├── ResourcesPanel.vue
│   │   │   ├── NewProjectModal.vue
│   │   │   ├── ToolkitDownloads.vue
│   │   │   ├── EmulatorSettings.vue
│   │   │   ├── CartridgeProgrammer.vue
│   │   │   ├── HelpViewer.vue
│   │   │   ├── VisualEditor.vue
│   │   │   ├── SceneViewport.vue
│   │   │   ├── SceneHierarchy.vue
│   │   │   └── InspectorPanel.vue
│   │   └── ... (existentes)
│   ├── composables/
│   │   ├── useRetroProject.js  # NOVO
│   │   └── useSceneState.js    # NOVO (opcional)
│   ├── utils/
│   │   ├── retro/           # NOVO
│   │   │   ├── sgdkAutocomplete.js
│   │   │   ├── sgdkSnippets.js
│   │   │   ├── sgdkHoverProvider.js
│   │   │   ├── errorParser.js
│   │   │   └── ...
│   └── ...
├── assets/
│   └── toolkit/
│       └── examples/        # templates md-skeleton, sgdk-skeleton, etc.
└── ...
```

---

## 6. Pontos de Integração no Monarco

### 6.1 TitleBar / ActivityBar
- Se `isRetroProject` → mostrar botão Play, emulator selector
- Se `enableVisualMode` → toggle Code/Visual

### 6.2 FileTree
- Ao abrir workspace: verificar `retro-studio.json` → `isRetroProject = true`
- Opcional: aba "Resources" ao lado de "Explorer"

### 6.3 Editor
- Ao abrir `.c`/`.h` em projeto Retro: registrar providers SGDK

### 6.4 Settings
- Nova seção "Retro Studio" quando app detectar uso

### 6.5 Preload
- Expor `retro:*` IPC no preload

---

## 7. Conflitos e Decisões

| Conflito | Decisão |
|----------|---------|
| `workspace` vs `project` | `workspace` = pasta raiz. `project` = conceito Retro quando `retro-studio.json` existe |
| Vuex vs Composables | Usar composables para estado do projeto Retro |
| CodeMirror vs Monaco | Retro usava ambos; Monarco usa só Monaco. Migrar tudo para Monaco |
| `select-folder` vs `workspace:select` | Manter `workspace:select`; adicionar `retro:createProject` que usa path interno |
| Terminal PTY | Monarco já tem. Usar para output do build |

---

## 8. Ordem de Execução Recomendada

1. **Fase 1** — projeto e detecção
2. **Fase 2** — build e emulador (MVP jogável)
3. **Fase 4** — editor SGDK (melhora DX)
4. **Fase 5** — toolkit e settings
5. **Fase 3** — assets
6. **Fase 6** — visual (opcional)
7. **Fase 7** — cartridge (opcional)
8. **Fase 8** — tutoriais e polish

---

## 9. Estimativa de Esforço

| Fase | Semanas | Prioridade |
|------|---------|------------|
| 1 | 1–2 | Alta |
| 2 | 1 | Alta |
| 3 | 1–2 | Média |
| 4 | 1 | Alta |
| 5 | 1 | Média |
| 6 | 1–2 | Baixa |
| 7 | 1 | Baixa |
| 8 | 1 | Média |

**Total:** ~8–12 semanas para migração completa. MVP (Fases 1+2+4) em ~4 semanas.
