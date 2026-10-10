
## Seleção de faixa pelo mapa

No Retro Studio, abra a seção **Música do cenário** e escolha **Automática** ou uma música pelo nome. A escolha é gravada no TMX em `retroStudio.musicTrack` como o ID do catálogo. O exportador da Alice valida o ID e grava o índice em `forest_rooms.h`; `RoomDefinition.musicTrack` fornece a faixa quando `gameMusicSelectRoom` entra na sala. **Automática** usa `forest-clearing`, `forest-sanctuary` ou `forest-canopy` pelo nome do mapa. O Retro Studio lê o catálogo JSON do projeto ou, quando não existe, lista as entradas XGM de `res/resources.res`.

O catálogo de áudio do projeto (músicas, efeitos, música por sala do grafo de
salas e runtime) é separado deste seletor por mapa; ver AUDIO_RUNTIME.md.
