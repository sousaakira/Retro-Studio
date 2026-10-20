# AGENTS.md — Retro Studio

Instruções para agentes de IA que trabalham neste repositório.

**Fonte de verdade das políticas:** `agents/_shared-policies.md`  
**Agentes especializados:** `agents/*.md`  
**Wrappers Cursor:** `.cursor/agents/*.md` (delegação via subagents)

Este arquivo não executa tarefas. Ele orquestra **quem** deve executar e sob quais regras.

---

## Missão do projeto

IDE desktop para desenvolvimento Sega Mega Drive / Genesis (SGDK + MarsDev), com editor Monaco, tilemap, build/emulador, Git e assistente de IA.

Versão atual: ver `package.json` (`name: retro-studio`).

---

## Como escolher o agente

| Situação | Agente | Arquivo |
|----------|--------|---------|
| Melhorar o agente LLM interno (`electron/ai/`), tools, RAG, prompts, autocomplete | **ai-agent** | `agents/ai-agent.md` |
| Feature/bug geral Electron + Vue (fora de IA e fora de só-UI) | **developer** | `agents/developer.md` |
| UI Vue, painéis, motion, acessibilidade visual | **frontend** | `agents/frontend.md` |
| Código C/SGDK, skeletons, build ROM, APIs Genesis | **sgdk-specialist** | `agents/sgdk-specialist.md` |
| Revisão de diff / PR / qualidade | **reviewer** | `agents/reviewer.md` |
| IPC, preload, secrets, supply chain, superfícies de ataque | **security** | `agents/security.md` |
| Docs, README, guias em `docs/` | **documentation** | `agents/documentation.md` |

Se a tarefa cruzar dois domínios: o agente primário executa; o secundário só é acionado para review no fim (ex.: `ai-agent` implementa → `security` revisa IPC novo).

Evitar agente “faz tudo”. Não inventar novos agentes neste arquivo sem atualizar também `agents/` e `.cursor/agents/`.

---

## Fluxo padrão de trabalho

```text
1. Ler AGENTS.md + agents/_shared-policies.md + agents/<agente>.md
2. Confirmar Issue existente ou criar Issue (gh)
3. Implementar no menor escopo possível
4. Verificar (lint / smoke do caminho afetado)
5. Abrir Pull Request citando a Issue (Closes #N)
6. Aguardar review / autorização de merge
```

Deploy/release: **não** é responsabilidade dos agentes de desenvolvimento. Release via tag/`workflow_dispatch` (`.github/workflows/release.yml`).

---

## Regras globais (resumo)

Detalhes obrigatórios em `agents/_shared-policies.md`.

1. Segurança > autorização do operador > integridade > verificação > qualidade.
2. Sem dependência nova sem autorização + relatório de risco.
3. Sem inventar ferramentas, Skills, APIs ou configs.
4. Sem commits/PRs/push a menos que o operador peça (ou a Issue autorize o fluxo completo nesta sessão).
5. UI motion: consultar Skill `design-motion-principles` quando disponível.
6. Não registrar secrets em logs ou docs.

---

## Definition of Done (orquestração)

- [ ] Agente correto selecionado pelo escopo
- [ ] Políticas compartilhadas aplicadas
- [ ] Issue referenciada quando houver mudança de código
- [ ] Nenhum arquivo fora de escopo alterado
- [ ] Critérios de parada respeitados
- [ ] Documentação de agentes atualizada se as regras de operação mudaram

---

## Manutenção deste catálogo

Quem alterar comportamento operacional de um agente deve:

1. Atualizar o `.md` correspondente em `agents/`
2. Atualizar o wrapper em `.cursor/agents/` se a `description`/nome mudar
3. Atualizar a tabela “Como escolher o agente” neste arquivo
4. Manter cópia ou referência em `.qoder/agents/` se o time usar Qoder

Última revisão estrutural: 2026-09-03.

- Música por mapa: Retro Studio salva o ID em `retroStudio.musicTrack` no TMX. A sidebar lê catálogo JSON ou `XGM` em `res/resources.res`; string vazia preserva música padrão. `export-playable-map.py` valida ID, gera `*_MUSIC_TRACK`; `RoomDefinition.musicTrack` e `gameMusicSelectRoom` aplicam o índice da sala. Ao adicionar faixas, atualizar os catálogos JSON gerados e reexportar. Ver `docs/MUSICA.md`.
- Cenas programadas (cutscenes): biblioteca distribuída em `assets/toolkit/lib/cutscene/` (runtime C puro `cutscene_runner.c`, compilador `cutscene-compiler.mjs`, `docs/CUTSCENES.md`, schema, `manifest.json`). Projetos novos recebem o runtime em `retro:create-project`/`createProjectFromTemplate`; projetos existentes instalam pelo editor (IPC `tilemap:install-cutscene-runtime`, confinado ao workspace; arquivos alterados ganham `.bak-*`; `cutscene-config.json` nunca é sobrescrito). Editor: `TilemapCutsceneEditor.vue` + `useCutsceneAuthoring.js`; prévia em `src/utils/retro/cutscenePreview.js` deve acompanhar a semântica do runtime C. Bytecode/opcodes: manter `OP_SIZE` do compilador igual a `opSize` do runtime e incrementar `CUTSCENE_RUNTIME_VERSION` ao mudar o formato. Testes: `npm run smoke:cutscene-runtime` e `npm run smoke:cutscene-editor`. Guia: `docs/CENAS-PROGRAMADAS.md`.
- Inimigos (Jogo → Inimigos): definições em `enemies/enemies.json` (formato `retro-studio.enemies` v1, `shared/retro/enemies.js`), instâncias como objetos `type="enemy"` no TMX (propriedade `enemy` = ID estável; `kind` acompanha por compatibilidade). Exportador transacional `electron/retro/enemyConfiguration.js` gera `src/generated/enemy_data.h` (+ `res/enemies.res` e PNG remapeado quando as cores não cabem na paleta escolhida), registra hashes em `.retrostudio/enemy-export.json`, nunca sobrescreve gerado personalizado e barra o build se desatualizado (`validateEnemiesForBuild`). Salvar mapa reexporta os inimigos. Com inimigos configurados, `export-map.py` (modelo interno e cópias dos projetos) não exporta `type="enemy"` como decoração. Runtime: módulos `enemy`/`enemy-sgdk` em `assets/toolkit/lib/runtime/enemy/`. Editor: `EnemyEditor.vue`; instância: painel do objeto em `TilemapLibrary.vue`. Testes: `node scripts/smoke-runtime-enemy.mjs` e `node scripts/smoke-enemy-export.mjs`. Guia: `docs/ENEMY_RUNTIME.md`.
- Compositor de músicas (modo **Música**, Alt+7, issue #89): teclado MIDI por Bluetooth (BLE-MIDI lido pelo Web Bluetooth; o BlueZ do Ubuntu não cria porta ALSA) ou Web MIDI, YM2612 + SN76489 emulados em `shared/retro/` (`ym2612.js`, `sn76489.js`, `chipDriver.js`) tocando num AudioWorklet (`src/audio/chipWorklet.js`), piano roll e gravação (`useSongEditor.js`, `PianoRoll.vue`). Fonte em `music/<id>.song.json`; "Exportar para o jogo" (`electron/retro/musicProject.js`) gera `res/music/<id>.vgm` com a mesma linha do tempo do editor (`songTimeline.js` + `vgm.js`) e cadastra no catálogo de áudio pelo serviço de `audioConfiguration.js`; VGM alheio nunca é sobrescrito. Instrumentos próprios ficam em `instruments` da música; importação/exportação TFI, DMP, FUI (novo e antigo), OPNI e WOPN em `shared/retro/instrumentFormats.js` (operadores na ordem dos registradores S1, S3, S2, S4; detune na escala do Furnace em TFI/DMP/FUI); editor em `InstrumentEditor.vue`; instrumentos da internet (biblioteca do Furnace no GitHub ou link https, download só no processo principal, sem rede local) em `electron/retro/instrumentLibrary.js` + `InstrumentBrowser.vue`. Teclado USB: o Web MIDI pede `midiSysex` desde o Chromium 124, liberado só para as páginas do app (`isAppPage`); o SMK-25 espelha as notas em duas portas e `createPortDeduper` descarta a cópia. Pads (canal 10): modo Bateria (cada pad toca e grava a sua peça em faixa própria) ou Controles (atalhos), em `shared/retro/drumPads.js` + `useDrumPads.js` + `PadPanel.vue`; o teclado (`useChipSynth`) e a gravação de teclas ignoram o canal 10. IA: comandos `music_guide/list/read/write/open` em `electron/control/commands.js` (agente interno e MCP), formato em tempos e análise de vozes em `shared/retro/songAuthoring.js`; ganchos `openMusic`/`musicChanged` em `window.retroStudioContext`. Pads do SMK-25: fileira de cima 40-43, de baixo 36-39. Rascunho em `.retrostudio/drafts/music.json`. Testes: `smoke-ble-midi`, `smoke-chip-synth`, `smoke-song-export`, `smoke-music-project`, `smoke-instrument-formats`, `smoke-instrument-library`, `smoke-drum-pads`, `smoke-music-ai`. Guia: `docs/COMPOSITOR.md`.
