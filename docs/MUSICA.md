
## Seleção de faixa pelo mapa

No Retro Studio, abra a aba **Sala** do editor de mapas, seção **Música do cenário**, e escolha **Automática** ou uma música pelo nome. A escolha é gravada no TMX em `retroStudio.musicTrack` como o ID do catálogo. O exportador da Alice valida o ID e grava o índice em `forest_rooms.h`; `RoomDefinition.musicTrack` fornece a faixa quando `gameMusicSelectRoom` entra na sala. **Automática** usa `forest-clearing`, `forest-sanctuary` ou `forest-canopy` pelo nome do mapa. O Retro Studio lê primeiro o catálogo de Jogo → Áudio (`audio/audio.json`), depois o catálogo JSON do projeto e, quando nenhum existe, lista as entradas XGM de `res/resources.res`. Com a faixa escolhida, o ▶ toca o VGM dela (ver abaixo); se houver prévia OGG, WAV ou MP3, ela aparece também.

O catálogo de áudio do projeto (músicas, efeitos, música por sala do grafo de
salas e runtime) é separado deste seletor por mapa; ver AUDIO_RUNTIME.md.

## Ouvir os VGM na IDE (#103)

O Retro Studio toca os arquivos `.vgm` e `.vgz` do jogo nos mesmos chips emulados do compositor
(YM2612 + PSG), sem precisar de uma prévia renderizada. O som é parecido com o do console, o
bastante para reconhecer a música, mas não é idêntico ao hardware nem ao resultado do driver
XGM do SGDK, que converte o VGM no build.

- **Jogo → Áudio:** cada música com original em VGM tem o seu player (tocar, pausar, parar,
  posição e volume). "Tocar como sala" e "Tocar como cena" usam o VGM quando a música não tem prévia.
- **Editor de mapas:** aba **Sala** → **Música do cenário** mostra o player da faixa escolhida.
- **Explorador:** clicar num `.vgm` ou `.vgz` abre uma janelinha que já começa a tocar. Fechar
  a janela para a música.

O player volta para o ponto de loop do arquivo e mostra as tags GD3 (título, jogo, autor). Toca
os VGM do compositor e os de outros programas (Furnace, DefleMask, ripados de jogos), incluindo
os samples de bateria do DAC. Só uma música toca por vez na IDE.

Fica de fora da emulação: o SSG-EG, o modo especial do canal 3 e o "ladder effect" do DAC; por
isso algumas músicas comerciais soam um pouco diferentes. Código: `shared/retro/vgmPlayback.js`
(leitura), `src/audio/vgmPlayer.js` (player), `src/components/retro/VgmPlayer.vue` (barra) e
`VgmViewer.vue` (janela do explorador). Teste: `node scripts/smoke-vgm-player.mjs`.
