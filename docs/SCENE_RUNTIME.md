# Cenas de sprites SGDK — issue #48

A API exportScene gera src/generated/scene_<nome>.c e .h, com funções
init/tick/position/free. O workspace ativo determina o destino. C bruto,
recursos ausentes, tipos não suportados e saídas personalizadas são recusados.

## Preflight opcional de recursos — scene v2

`retroSceneValidatePalettes(definitions, count, palettes)` compara cada sprite
com a paleta que o host pretende instalar no slot indicado. Não lê CRAM nem faz
DMA/alocação: compara índices 1–15 com máscara de cor `0xEEE`, ignorando índice
zero transparente e bits não usados pelo VDP. Slots ausentes, paletas curtas ou
cores diferentes retornam `RETRO_SCENE_PALETTE`. A comparação é conservadora:
também exige igualdade em cores opacas não usadas. Não remapeia os pixels.

`retroSceneMeasureResources` soma `maxNumTile` e `maxNumSprite` por instância,
inclusive quando vários objetos usam o mesmo recurso. Retorna valores `u32` e
preserva o resultado anterior em entrada inválida. Cenas vazias aceitam ponteiros
nulos e têm orçamento zero. Ambas as funções validam definições, limite de 80
objetos e IDs únicos antes de examinar recursos.

O host adiciona os sprites persistentes e, nas transições, cena ativa + destino.
Esses máximos não garantem blocos contíguos de VRAM, capacidade por scanline nem
custo de DMA. A alocação efetiva ainda pode falhar e deve ter rollback. `Init`
mantém seu comportamento anterior; os checks são explícitos para preservar
hosts com efeitos de paleta próprios.

## Fonte de cena

~~~json
{
  "name": "room",
  "nodes": [
    {
      "id": "lamp-left",
      "type": "sprite",
      "resourceId": "OBJECT_LAMP",
      "x": 80,
      "y": 96,
      "supportX": 8,
      "supportY": 16,
      "animation": 0,
      "palette": 1,
      "priority": false,
      "hFlip": false,
      "vFlip": false,
      "loop": true,
      "durations": [3, 1]
    }
  ]
}
~~~

- resourceId precisa ser uma declaração SPRITE em res/resources.res; o ResComp
  gera a definição. O exportador ainda não converte imagens de objetos do kit.
- IDs numéricos: 0 a 65534. IDs de texto recebem hash estável de 16 bits,
  independente da ordem. Colisões são recusadas; atribua outro ID. Correspondência
  registrada em .retrostudio/scene-exports/<nome>.json.
- x/y: pixels inteiros do apoio no mundo (-32768 a 32767). supportX/Y: distância
  da esquerda/topo da célula original; o apoio é espelhado com a arte.
- Durações opcionais: ticks de vídeo (1 a 65535), uma por quadro da animação.
  Sem override, usam os timers compilados (zero equivale a um tick).
  NTSC/PAL seguem a frequência do loop. Começa no quadro zero.
- Runtime valida animação, apoio dentro da célula, durações e IDs antes de alocar.
  Até 80 objetos lógicos: metasprites podem consumir vários sprites de hardware,
  e VRAM/alocação podem limitar a quantidade efetiva.
- Paleta/prioridade/flips são atributos; o host administra o conteúdo da CRAM.
  O módulo não sobrescreve tiles de BG. Prioridade VDP não é ordenação arbitrária
  entre sprites.

## Loop do jogo

Instale/atualize o módulo scene em modo Jogo. Projetos novos recebem
a biblioteca; instalar não modifica código de gameplay de um jogo existente.

~~~c
#include <genesis.h>
#include "generated/scene_room.h"
#include "../res/resources.h"

/* Host: SPR_init e carregar as paletas antes. */
if (scene_room_init() != RETRO_SCENE_OK) {
    /* Reportar erro de dados/alocação; não fica alocação parcial. */
}
while (running) {
    scene_room_position(cameraX, cameraY);
    SPR_update();
    SYS_doVBlankProcess();
    scene_room_tick();
}
scene_room_free();
~~~

O host chama SPR_update uma vez para todos os sprites. O módulo não chama
SPR_reset nem libera sprites externos. retroSceneFind(&scene_room, id) retorna
o objeto para alterar x/y. Cena/armazenamento começam zerados; liberar antes
de reinicializar. Não implementa gameplay.

O callback de troca de quadro zera o timer automático após o SGDK carregar
o novo frame. Mantemos o adiamento de upload por DMA habilitado: sob saturação,
o quadro visível pode atrasar em relação ao relógio lógico. Duração visual
exata depende do diagnóstico/orçamento DMA da issue #51.

## Publicação, verificação e pendências

C/header/registro usam transação, revisões e reuso de bytes. Recursos/runtime
são conferidos no mesmo lock. Arquivos personalizados ou sem propriedade
registrada são preservados.

A exportação dos visuais do kit/TMX está integrada ao skeleton (ver abaixo).
Inspeção em emulador continua pendente. A prévia normal de prioridade tem teste de pixels em software; ainda falta confirmação visual no browser.

~~~sh
node scripts/smoke-runtime-scene.mjs
node scripts/smoke-scene-export.mjs
node scripts/smoke-scene-export.mjs --sgdk /caminho/sgdk
~~~

A variante SGDK cria arte original e uma ROM temporária, sem ler ROMs originais
ou alterar jogos do usuário. Compilar comprova C/recursos/link; não comprova
o resultado visual da ROM em execução.

## Objetos do kit no skeleton SGDK

O exportador de mapas do skeleton agora transforma retroStudio.visual do TMX
em sprites separados. Usa gid/width/height/frames/fps, escala de exibição,
anchor, spriteOffsetX/Y, priority e flipH/V. O jogador em player_spawn é só uma
prévia: não vira tile de cenário nem objeto automático. Os mesmos arquivos
originais do kit permanecem intactos.

Cada recurso recebe PNG indexado com transparência no índice zero, ID derivado
do conteúdo/geometria e declaração SPRITE. Objetos compartilham PAL1: até 15
cores opacas no conjunto, sem quantização automática. Até 80 instâncias/48
recursos, quadros até 128 × 128 px, 1–16 quadros e 1–12 FPS. Escalas/anchors que
gerem meio pixel são recusados com diagnóstico, pois o VDP posiciona em pixels.
Quadros totalmente vazios e alpha parcial também geram diagnóstico explícito.
videoRate em mapExport pode ser 50 ou 60; o padrão é 60 ticks por segundo.
Normalização automática da região continua pendente da integração de animação.

O skeleton reserva sprites antes de carregar o cenário, somando maxNumTile
por instância dos recursos compilados. Faz a verificação BG/FG/reserva antes
de carregar os tiles. Falha de alocação informa erro; isso não substitui análise
dos limites por linha ou DMA.

A IDE publica PNGs, C/header, recursos e manifest juntos. Derivados antigos só
são removidos quando a propriedade/hash confere e não há consumidor identificado.
Outras declarações .res, referências C/cenas, scripts desconhecidos ou inspeção
incompleta preservam imagem/declaracão/registro. Fontes de consumidores são
checadas sob o lock durante publicação. Alteração manual de um PNG gerado aborta
a exportação para preservá-lo. O build direto via Makefile ainda precisa da
integração transacional da issue #46; não usar esse caminho como prova de limpeza
ou proteção equivalente à IDE.

Verificação integrada:

~~~sh
node scripts/smoke-map-objects.mjs
node scripts/smoke-map-objects.mjs --sgdk /caminho/sgdk
~~~

O teste usa o serializador TMX real, recortes/escala/apoio/flip/tempos, prévia de
spawn excluída, reuso, retenção de imagens compartilhadas e limpeza de derivados
sem uso. A variante SGDK compila a ROM do skeleton com sprites via ResComp.
A inspeção em execução ainda falta nas issues #44/#48/#57. A prévia implementa
composição normal, sem simular saturação de sprites, DMA ou shadow/highlight. Exportadores Alice/Tempo existentes não são alterados.


## Prioridade na prévia (issues #48/#57)
A prévia do editor considera BG baixo, sprites baixos, BG alto por célula,
FG alto e sprites altos. Entre sprites, o primeiro ID na tabela vence para
cada pixel opaco, antes de comparar sua prioridade com os planos. Assim,
um sprite baixo na frente de um sprite alto pode ocultar este último,
mesmo quando o primeiro fica atrás do FG. Transparência deixa passar os
pixels abaixo. Referência primária: [compositor normal e seleção SAT do
BlastEm](https://github.com/libretro/blastem/blob/master/vdp.c).

As imagens originais permanecem intactas. A composição usa uma superfície
temporária por sprite sobreposto, reutilizada em cada passagem, em vez de
duplicar canvases do mapa inteiro. Regiões temporárias acima de 4096 px por
eixo/16 milhões de pixels não são alocadas e mantêm o marcador de autoria.
A quantidade de sprites por linha, atraso DMA, paletas/ciclos/fades e
shadow/highlight não são emulados nessa prévia. A opacidade ajustável de FG
continua sendo ajuda de edição; não representa mistura alpha do VDP.
O player_spawn continua uma prévia de marcador, não um jogador criado no ROM.

Verificação: node scripts/smoke-map-composition.mjs exerce 128 casos de
pixel, sobreposição SAT de prioridades diferentes, crop, posição, escala,
flips, alocação limitada e restauração do contexto. A fixture Canvas2D é
software; não comprova renderização do navegador nem inspeção em emulador.
