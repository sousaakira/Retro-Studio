# Contrato de projeto e capacidades — issue #41

A autoria continua usando TMX, kits v1, charsets v4 e cutscenes v1.
Nenhum documento existente é convertido apenas por ser aberto.
A declaração opcional `retroStudio` em `retro-studio.json` descreve
a integração do jogo, não as ferramentas presentes na IDE.

## Declaração v1
```json
{
  "retroStudio": {
    "contractVersion": 1,
    "target": { "platform": "megadrive", "sdk": "sgdk", "videoMode": "H40", "region": "ntsc" },
    "adapter": {
      "id": "my-game",
      "version": 1,
      "capabilities": ["map.bg", "map.fg", "map.collision"]
    },
    "modules": []
  }
}
```

O skeleton declara somente as funcionalidades integradas em seu executável.
Ter cutscene_runner.c instalado não declara execução de cutscenes.
Projetos legados sem declaração são **não verificados**, nunca automaticamente
considerados sem suporte ou migrados para o skeleton. Seus exportadores continuam.

`validateProjectContract` valida versão, alvo, adaptador e capacidades.
`assessRuntimeSupport` distingue suportado, não suportado e não verificado.
Versões futuras/inválidas produzem diagnóstico, sem serem tratadas como v1.
As opções de autoria continuam disponíveis; o mapa mostra o suporte antes de salvar/exportar.

## Formatos e unidades
| Domínio | Fonte | Unidades |
|---|---|---|
| Mapa | TMX + extensões Retro Studio v1 | posição em pixels, células 8×8 |
| Kit/objetos | kit JSON v1 | regiões visuais em tiles, gameplay separado |
| Personagem | charset JSON v4 | recortes e pés em pixels; duração em ticks de vídeo |
| Cutscene | retro-studio.cutscene v1 | posições em pixels; espera em ticks de vídeo |
| Cena | scene JSON v1 (legado sem version é lido como legado) | posição em pixels |
| Áudio | retro-studio.audio v1 (`audio/audio.json`, ver AUDIO_RUNTIME.md); catálogo de IDs do jogo no fluxo por mapa | referência estável |
| Sala | retro-studio.world v1 (`world/world.json`, ver WORLD_RUNTIME.md); dados do adaptador em jogos antigos | posição em pixels, destinos por ID |
| Câmera | retro-studio.camera v1 (`camera/camera.json`, ver CAMERA_RUNTIME.md) | pixels; velocidades por tick de vídeo |
| Progresso | retro-studio.progress v1 (`progress/progress.json`, ver PROGRESS_RUNTIME.md) | flags por bit, campos em bytes, IDs estáveis |
| Diagnóstico | retro-studio.debug v1 (`debug/debug.json`, ver DEBUG_RUNTIME.md) | — |

Salas, câmera, progresso, áudio e diagnóstico têm validador, exportação transacional e módulo de runtime opcional. Ter a fonte ou o módulo instalado não declara que o jogo os usa: o contrato do projeto continua valendo só para o que o adaptador declara.

Pontos de extensão em C (como escrever um adaptador próprio para áudio, save, salas, personagem e cenas) estão em MODULAR_RUNTIME.md, seção “Escrevendo um adaptador próprio”, com um exemplo que compila sem SGDK.
IDs são strings ASCII estáveis de até 128 caracteres, começando em letra/número;
não podem ser reatribuídos após renomear uma entrada. Os catálogos
legados mantêm suas próprias regras. `validateCatalogReferences` identifica
IDs inválidos/duplicados e referências ausentes em catálogos normalizados.

## Capacidades
Mapa: map.bg, map.fg, map.background, map.priority, map.collision, map.parallax.
Objetos: object.visual, object.animation.
Personagem: player.spawn, character.animation, character.physics, combat.boxes.
Mundo: room.transition, camera.control.
Som/narrativa: audio.music, audio.sound, cutscene.trigger.

Estas são capacidades da integração **na ROM**. A prévia não comprova nenhuma delas.
map.collision indica que o adaptador exporta/consome dados de colisão;
não implica que possui física de personagem.
O espelhamento de caixas e posição visual usa o apoio dos pés do charset;
o tempo PAL/NTSC precisa seguir a política do controlador, explicitamente.

## Migração e extensões
`declareProjectContract` cria uma cópia validada de um projeto sem declaração.
O operador/adaptador deve selecionar suas capacidades: não inferir pelo nome do jogo.
O helper Node declareRuntimeForProject grava backup exclusivo do JSON original, valida alterações concorrentes e publica a declaração por renomeação. Ele só é executado explicitamente; abrir o jogo não o chama.
Atualização entre versões requer migração específica, nunca descartar campos desconhecidos.
A implementação C continua no jogo; callbacks/adaptadores podem fornecer qualquer
capacidade conhecida sem adotar os módulos genéricos do Retro Studio.
Projetos sem runtime Retro Studio podem usar o editor, seus Makefiles e exportadores normalmente.

O skeleton inicial exporta coordenadas de spawn, mas ainda não cria um jogador; por isso não declara player.spawn. Essa capacidade requer um consumidor no jogo. Colisões por retângulos também entram no diagnóstico. IDs de módulos precisam ser únicos; a validação JS impõe essa regra além do JSON Schema.

Implementação compartilhada canônica: shared/retro/projectContract.js;
src/utils/retro/projectContract.js reexporta a API para compatibilidade.
O pacote Electron inclui shared/**/* para uso fora do desenvolvimento.
