# Câmera: editor e controlador (#59)

Enquadramento para jogos de plataforma configurado na IDE e consumido por um
controlador C opcional. Nada é ativado sozinho: projetos sem `camera/camera.json`
continuam exatamente como estavam, e o jogo decide quando chamar o controlador.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `camera/camera.json` | Fonte editada na IDE (perfis e regiões). |
| `src/generated/camera_config.h` | Header gerado; não editar à mão. |
| `.retrostudio/camera-export.json` | Registro de propriedade do header (hash). |
| `src/retro_runtime/retro_camera.{h,c}` | Módulo `camera` v1 (depende de `core`). |

Salvar publica fonte, header e registro na mesma transação (#46). Um header
alterado à mão ou sem registro é preservado e bloqueia a exportação e o build
até ser revisado. O build pela IDE e pelas ferramentas recusa uma câmera com
header desatualizado ou regiões que não cabem mais nas salas do mundo.

## Unidades e política temporal

- Tamanhos e deslocamentos em pixels inteiros.
- Velocidades em pixels por tick de vídeo, com precisão de 1/256 (Q8).
- Um tick por quadro de vídeo. PAL e NTSC têm perfis separados e explícitos;
  não existe escala automática entre 50 e 60 Hz. O jogo escolhe o perfil
  (`IS_PAL_SYSTEM ? &retroProjectCameraPal : &retroProjectCameraNtsc`).

A prévia do editor usa os mesmos inteiros Q8 e a mesma ordem de operações do
controlador C, sobre as regiões na ordem exportada.

## Perfil (`RetroCameraConfig`)

| Campo | Faixa | Efeito |
|-------|-------|--------|
| `maxSpeedX`, `maxSpeedY` | 1/256 a 32 px/tick | Limite do acompanhamento por eixo. |
| `smoothingX`, `smoothingY` | 0 a 6 | Suavização: a cada tick percorre 1/2ⁿ da distância restante (0 = sem suavização). |
| `followX`, `followY` | ligado/desligado | Acompanhar o alvo no eixo. |
| `deadZoneWidth`, `deadZoneHeight` | 0 a 320 / 0 a 240 px | Zona de tolerância: a câmera só anda quando o foco sai dela. |
| `focusX`, `focusY` | ±160 / ±120 px | Posição do centro da zona em relação ao centro da tela. |
| `lookAheadX` | 0 a 160 px | Olhar à frente na direção informada pelo jogo. |
| `lookAheadSpeed` | 0 a 32 px/tick | Velocidade com que o olhar à frente muda de lado. |
| `scriptReturnSpeed` | 0 a 32 px/tick | Retorno ao jogador depois de uma cena; 0 corta. |

Velocidades acima de 16 px/tick fazem a ponte `world-sgdk` cair no redesenho
bloqueante (salto maior que um metatile); prefira até 16.

## Regiões (`RetroCameraRegion`)

Regiões pertencem a uma sala do grafo de salas (#55) e usam os pixels dela.

- **Área**: enquanto o alvo está dentro, a região fica ativa.
- **Limites**: retângulo ao qual a câmera fica confinada. Precisa ter pelo menos
  o tamanho da tela (320 × 224), ou o da sala quando ela é menor.
- **Prioridade** (0 a 255): a maior vence. Duas regiões com a mesma prioridade
  não podem se sobrepor; o editor e a exportação recusam o empate.
- **Arena travada**: depois de ativada, a região continua valendo mesmo que o
  alvo saia da área, até o jogo chamar `retroCameraUnlock`. Depois de liberada,
  ela só trava de novo quando o alvo sair e voltar a entrar.
- **Transição** (px/tick): velocidade usada ao entrar ou sair da região; 0 corta.
  Durante a transição a suavização não se aplica.

No máximo 32 regiões por sala e 64 salas. As linhas são exportadas em ordem de
ID; os IDs numéricos seguem o mesmo hash estável do mundo.

## Integração no jogo

```c
#include "generated/camera_config.h"
static RetroCamera camera;

/* uma vez */
retroCameraInit(&camera, VDP_getScreenWidth(), VDP_getScreenHeight());

/* ao entrar em uma sala (por exemplo no onActivate da ponte world-sgdk) */
retroCameraEnterRoom(&camera, config, room->width, room->height,
                     regions, regionCount, feetX, feetY, direction);

/* a cada quadro, depois de mover o jogador */
RetroCameraResult r = retroCameraTick(&camera, config, feetX, feetY, direction);
if (!r.invalid) retroWorldSgdkScroll(&bridge, r.x, r.y);
```

`feetX`/`feetY` são Q8 (`RetroFixed`), como o corpo do módulo `movement`.
`direction` é -1 (esquerda), 1 (direita) ou 0 (mantém o olhar atual).
`retroProjectCameraRooms` associa o ID numérico da sala às suas regiões.
`retroCameraBounds` devolve os limites em vigor, útil para manter o jogador
dentro de uma arena travada. Entradas inválidas não alteram a instância.

O módulo não aloca memória, não usa callbacks e não depende do SGDK. Ele não
substitui câmeras customizadas: quem não chama as funções não é afetado.

## Cutscenes

A câmera tem um dono por eixo. `retroCameraScriptSet` entrega eixos a uma cena;
eixos entregues deixam de seguir o jogador e ficam na posição pedida (limitada
à sala; regiões não confinam cenas). `retroCameraScriptRelease` devolve o
controle e a câmera volta ao enquadramento do jogador em `scriptReturnSpeed`.

Para o runner de cutscenes distribuído, basta ligar o host:

```c
host.context     = &camera;
host.cameraGet   = retroCameraCutsceneGet;
host.cameraSet   = retroCameraCutsceneSet;
host.cameraClamp = retroCameraCutsceneClamp;
```

O runner controla apenas o eixo X; o Y continua seguindo o jogador. Voltar para
`follow` devolve só o X: um Y entregue pelo jogo com `retroCameraScriptSet`
continua com a cena até `retroCameraScriptRelease`. O jogo
continua chamando `retroCameraTick` todo quadro: enquanto a cena é dona do
eixo, o tick não o move, então não há disputa nem salto no retorno.

## Editor

modo Jogo → **Câmera…**

- Perfis NTSC e PAL independentes, com restauração do preset.
- Regiões por sala do mundo, com área, limites, prioridade, arena e transição.
- Prévia com a sala, as regiões, o quadro da tela, a zona de tolerância, o
  ponto de foco e o alvo. Arraste o alvo, use as setas ou reproduza o percurso.
  Botões simulam liberar a arena e uma cena assumindo e devolvendo a câmera.
- “Dados exportados” mostra o header que será gravado.
- Rascunhos são separados por projeto; mudanças externas e header personalizado
  bloqueiam a exportação sem descartar o rascunho.

Sem grafo de salas, os perfis podem ser ajustados em uma sala de exemplo, mas
regiões exigem salas cadastradas em “Salas e conexões”.

Regiões de salas removidas ou renomeadas no mundo aparecem como órfãs, com um
botão para removê-las; enquanto existirem, a exportação e o build ficam
bloqueados com a mensagem correspondente.

## Compatibilidade e migração

- Projetos existentes: nenhuma mudança. Não há migração automática.
- Jogos com câmera própria podem adotar só o header de perfis, só o módulo, ou
  nada. A ponte `world-sgdk` continua aceitando qualquer posição de câmera.
- Mudar o tamanho de uma sala no mundo pode invalidar regiões; o editor e o
  build avisam e nada é reescrito sozinho.

## Limites conhecidos

- O olhar à frente é horizontal; não há olhar vertical.
- Regiões são retângulos alinhados aos eixos.
- Uma transição persegue o alvo em velocidade constante; se o jogador for mais
  rápido que ela, a transição só termina quando ele desacelerar.
- A cena do runner distribuído controla apenas X.
- A tela considerada na validação é 320 × 224; em H32 os limites sobram.

## Verificações

```sh
node scripts/smoke-runtime-camera.mjs [--m68k-cc <m68k-elf-gcc>]
node scripts/smoke-camera-configuration.mjs [--sgdk <raiz-do-SGDK> [--keep-rom <arquivo>]]
node scripts/smoke-camera-preview.mjs
node scripts/smoke-camera-editor.mjs
```

- `runtime-camera`: limites, zona de tolerância, enquadramento, eixos, limite de
  velocidade, suavização, olhar à frente, prioridade, transições, arena,
  controle por cena, runner real de cutscenes e entradas recusadas.
- `camera-configuration`: validação, vínculo com o mundo, transação, gate de
  build, conflitos e header → controlador C; com `--sgdk`, ROM diagnóstica.
- `camera-preview`: 6000 ticks comparando a prévia com o C nativo a partir do
  header exportado.
- `camera-editor`: script real do componente Vue em host mínimo.

Inspeção visual do editor: `node scripts/preview-camera-editor.mjs` sobe uma
fixture em memória e `node scripts/inspect-fixture.mjs <url> <passos.mjs> <saída>`
dirige o Chrome headless local e salva capturas.

ROM no emulador: `scripts/capture-rom.sh <rom> <saída> <emulador>
assets/toolkit/fixtures/camera-diagnostic.steps.sh` executa a ROM diagnóstica
sob Xvfb, envia as teclas do roteiro e salva capturas reais. Use somente ROMs
diagnósticas temporárias.
