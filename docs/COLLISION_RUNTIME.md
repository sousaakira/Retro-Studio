# Colisão reutilizável — base da issue #49

Módulo collision v1 depende de core. São funções C99 sem alocação; instalar
não altera controladores ou física de Alice/Tempo. Cada jogo precisa consumir
explicitamente o módulo.

## Caixas e unidades
RetroBody.x/y são a origem do corpo em Q8 (256 unidades por pixel).
RetroBody.box é uma caixa local em pixels, separada do tamanho da imagem.
Por exemplo, com apoio nos pés, a caixa pode ter x=-8, y=-40, width=16, height=40.
Corpo, ataque e hurtbox podem ser descritos como caixas locais distintas;
retroMirrorRect espelha x como -x-width em torno da origem, mantendo y.

RetroCollider.box usa coordenadas mundiais em pixels. group e body.mask são
bits de seleção; a colisão exige interseção não nula. Dimensões devem ser
positivas. Origens de corpo ficam no domínio [-32768,32767] pixels; deslocamentos
são limitados a esse domínio e entradas inválidas retornam invalid=1 sem mover.

## Movimento
retroMoveBody varre primeiro X e depois Y, limitando cada eixo ao obstáculo mais
próximo. Detecta paredes dos dois lados, piso e teto mesmo quando o deslocamento
do eixo ultrapassa a espessura do obstáculo. Retorna deslocamentos aplicados e
bits de contatos. A varredura sequencial não é uma solução de tempo de impacto
diagonal; trajetórias diagonais seguem a política X-depois-Y.

Plataformas atravessáveis bloqueiam somente movimento para baixo iniciado acima
da superfície. dropPlatforms ignora essas plataformas sem ignorar sólidos.
Contatos não são persistidos: para detectar piso em repouso, use uma pequena
sondagem vertical ou mantenha o contato no controlador do game.

Ainda não resolve spawns dentro de sólidos ou plataformas móveis. Rampas de
piso estão disponíveis pela API opcional descrita abaixo.
Combate/dano têm o núcleo descrito abaixo. Não fecha #49: integração completa
do mundo e visualização na ROM prosseguem nas próximas etapas.

## Verificação
smoke-runtime-collision compila no host e verifica paredes simétricas,
piso/teto, plataforma/drop, máscara, espelhamento e extremos numéricos.
Também compilou para 68000 com o GCC MarsDev instalado.

## Combate
retro_combat.h fornece janela de ataque [start,end), máscara de grupos e dano
com vida saturando em zero. Execute Apply antes de Tick; a idade e a duração de
invulnerabilidade são quadros de vídeo PAL/NTSC. O callback recebe resultado,
dano solicitado (pode exceder a vida efetivamente removida) e impulso Q8 para
o controlador aplicar a reação desejada.

A instância de ataque guarda 32 bits de vítimas: o host atribui slots estáveis
0–31 durante o encontro; não reutilize o slot no mesmo ataque. Cada vítima recebe
no máximo um acerto nessa instância, mesmo após vencer sua invulnerabilidade.
Begin reinicia janela/histórico. Tentativas sem contato, grupo compatível, vida
ou durante invulnerabilidade não marcam o slot. Corpo, hitbox e hurtbox seguem
caixas separadas; o host transforma as caixas locais para coordenadas mundiais.

Esse núcleo não adiciona efeitos de som, projéteis, animações ou dano ao jogo
sozinho. Dados do Charset Maker têm integração opcional descrita abaixo;
diagnóstico na ROM e integração completa do mundo ainda pendentes.
smoke-runtime-combat verifica janelas, bit 31/slot inválido, dano repetido,
invulnerabilidade, morte, callbacks e limites; host e compilação 68000 passaram.

## Geometria exportada pelo Charset Maker

Inclua `retro_collision.h` antes do header exportado. Além dos macros e da
tabela legada de ataque, ele fornece `<prefixo>_body_box` (`RetroRect` local)
e `<prefixo>_attack_geometry` (`RetroFrameBox` por índice de animação), além de
`<prefixo>_hurt_box` (`RetroRect` local para receber dano).
Se o header de colisão não estiver incluído, esses dados opcionais são omitidos
e o consumo legado continua disponível. Reexporte para receber os dados novos.

`retroWorldRect` transforma uma caixa local relativa aos pés em pixels mundiais,
com origem Q8 e flips independentes nos dois eixos. A origem fracionária é
arredondada para baixo, incluindo valores negativos. Não subtraia a câmera:
as colisões ocorrem no mundo. Resultados cuja origem não cabe em s16 são
recusados sem alterar a saída. Dimensões positivas são obrigatórias.

`retroFrameWorldRect` transforma somente quando a caixa está habilitada e o
frame está entre `firstFrame` e `lastFrame`, **inclusive**. Use o índice de
animação do estado atual, não o ID do estado, para escolher a linha. A janela
é de frames autorais; `RetroAttackState.start/end` é de ticks de vídeo e tem
fim exclusivo. São controles distintos. Um frame longo mantém a caixa ativa
durante toda sua duração; o histórico de vítimas do combate evita hits repetidos.

```c
const RetroCharacterState *state = &player.definition->states[player.stateIndex];
const RetroCharacterPose *pose = &state->poses[player.animation.frame];
RetroRect attackWorld;
u8 hitboxActive = retroFrameWorldRect(
    &ninja_attack_geometry[state->animationId], player.animation.frame,
    body.x, body.y, facingLeft ^ pose->flipH, pose->flipV, &attackWorld);
/* Só chame retroAttackApply quando hitboxActive != 0. */
```

O corpo de movimento usa a caixa **local**: atribua `ninja_body_box` a
`RetroBody.box` (ou uma cópia espelhada por `retroMirrorRect`). Não atribua
uma caixa mundial ao corpo, pois sua origem seria aplicada duas vezes.
O host decide se a caixa acompanha flips autorais ou somente a direção do
personagem; cambalhotas visuais não precisam inverter o corpo físico.
Na aba Corpo, a área que recebe dano acompanha o corpo por padrão. Ative
**Usar uma caixa independente do corpo** para ajustar posição/dimensões;
**Copiar caixa do corpo** inicia essa caixa com os valores atuais do corpo.
O retângulo independente aparece roxo tracejado na prévia de autoria.
Ao desativar, os valores independentes permanecem guardados, mas o exportador
usa o corpo atual como hurtbox. O host transforma `ninja_hurt_box` com
`retroWorldRect` para fornecer a caixa mundial a `retroAttackApply`.
O arquivo de personagem é salvo na versão 6; fontes anteriores ganham backup
antes da migração e usam o corpo como hurtbox. O exportador transacional aceita
versões 4/5/6. Nenhum projeto de game existente é migrado apenas ao instalar a IDE.

`smoke-character-geometry` compila o header realmente gerado e executa
controlador, colisão e combate: corpo de 16 px com arte de 80 px, janela por
frame, flips, Q8 negativo, alias e limites. Também compila o caminho legado e
testa os métodos reais de save/restore do editor, v6 e backup de fonte v5.
A opção `--m68k-cc <compilador>` verifica o helper para 68000. A fixture
`smoke-character-sprite --sgdk` também consome os dados em uma ROM temporária;
nenhum desses testes comprova apresentação visual ou colisão em hardware.

## Rampas de piso

`retro_slopes.h/.c` faz parte do módulo collision e preserva `retroMoveBody`.
`RetroSlope.bounds` usa pixels mundiais, grupo por máscara, largura/altura
positivas. `leftHeight/rightHeight` são alturas relativas a `bounds.y`, entre
zero e `bounds.height`; Y cresce para baixo. Uma subida para a direita tem
`leftHeight > rightHeight`. `retroSlopeSurface` interpola em Q8 no intervalo
horizontal `[left,right)`, com divisão inteira truncada para zero. Falhas não
alteram a saída. Os cálculos usam 32 bits, sem alocação ou divisão de 64 bits.

```c
RetroSlope ramp = {{100, 120, 32, 16}, 1, 16, 0};
RetroMoveResult motion = retroMoveBodySlopes(
    &body, velocityX, velocityY, solids, solidCount,
    &ramp, 1, 2, wasGrounded, dropPlatforms);
```

O movimento mantém a política X-depois-Y dos sólidos/plataformas e então
amostra a superfície no centro horizontal da caixa do corpo. A queda pousa
somente ao cruzar a superfície de cima para baixo. `wasGrounded` permite
acompanhar subidas e descer até `snap` pixels, desde que os pés estavam na
superfície anterior dessa rampa (ou na altura de sua extremidade ao entrar).
Estar apoiado num piso mais baixo não permite subir até uma rampa elevada.
A correção respeita pisos e tetos
sólidos. Ao iniciar um pulo, passe `wasGrounded=0`; deslocamento Y negativo
também desativa seguimento. `dropPlatforms` ignora rampas junto das plataformas.
Entre superfícies elegíveis sobrepostas, a mais alta vence, sem depender da ordem.
Se um teto impede a subida necessária, o passo inteiro é recusado sem mover
o corpo; contatos de piso, teto e direção lateral bloqueada permitem ao host
reagir. Não há deslizamento parcial horizontal nesse caso.

O host mantém o contato do quadro anterior e aplica a reação à velocidade.
Não declare grounded para um spawn dentro de geometria. Uma descida maior
que snap fica no ar; snap zero ainda permite seguir subidas e piso nivelado.
Rampas são superfícies de piso, sem faces laterais/teto; adicione sólidos
separados quando precisar dessas faces. Dados inválidos ou uma posição final
fora do domínio Q8 recusam o movimento inteiro e preservam o corpo.

Um passo horizontal que atravessa toda a largura da rampa termina sem ponto
para amostrar. Divida esse movimento no host; esta API não implementa sweep
diagonal contra triângulos. Rampas arbitrárias, curvas, móveis e depenetração
de spawns não são cobertas. A autoria/exportação está descrita abaixo;
o overlay completo de contatos na ROM continua pendente em #49.

`smoke-runtime-slopes` executa pouso em alta velocidade vertical, subida,
descida/snap, pulo/drop, grupos, teto/piso, ordem, extremos e interpolação com
referência 64 bits no host. Cobre também entrada pela extremidade e recusa de
teletransporte para uma rampa elevada sem apoio prévio.
`--m68k-cc <compilador>` verifica o módulo para 68000.

## Terreno do editor de mapas

Em **Colisão precisa**, adicione sólidos, recortes sem colisão, plataformas
atravessáveis ou rampas de piso. Posição e dimensões mantêm passo de 1 pixel,
inclusive ao salvar/reabrir TMX e arrastar. A rampa padrão mede 32×16 px e sobe
para a direita; ajuste alturas esquerda/direita na seleção. Reduzir a altura
limita os dois endpoints na mesma operação de undo. Plataformas aparecem em
azul; rampas mostram a superfície em amarelo. Objetos positivos têm um grupo
de colisão de 1 a 65535, interpretado como máscara, não como índice de grupo.

Novos skeletons declaram `mapExport.runtimeGeometry=true`. O exportador Python
gera dados opcionais no `map_data.h`: `GAME_MAP_COLLIDER_COUNT`,
`gameMapColliders`, `GAME_MAP_SLOPE_COUNT`, `gameMapSlopes`. Inclua
`retro_slopes.h` **antes** do header do mapa para obter ambos os arrays. Arrays
vazios têm um sentinela; use as contagens e não sizeof para iterar. O jogo
consome esses dados explicitamente; instalar/exportar não cria jogador nem
substitui controladores customizados.

```c
#include "retro_runtime/retro_slopes.h"
#include "generated/map_data.h"
/* Corpo/velocidades em Q8; caixas/terreno exportados em pixels mundiais. */
RetroMoveResult motion = retroMoveBodySlopes(
    &body, velocityX, velocityY,
    gameMapColliders, GAME_MAP_COLLIDER_COUNT,
    gameMapSlopes, GAME_MAP_SLOPE_COUNT, 2, wasGrounded, dropPlatforms);
```

Colisões sólidas da grade usam grupo 1. Retângulos sólidos/recortes/plataformas
aplicam-se em ordem ao campo efetivo de pixels, com seus grupos. Regiões
contíguas iguais são compactadas. Direcionais mantêm apenas faces expostas;
dividir uma plataforma conectada não cria um piso interno invisível. Interfaces
entre grupos distintos mantêm faces para corpos com máscaras diferentes.
Regiões originalmente TOP-only viram plataformas; regiões com todas as faces
viram sólidos. Outras combinações usam `RETRO_COLLIDER_DIRECTIONAL | faces`.
TOP=1, BOTTOM=2,
LEFT=4, RIGHT=8 seguem o TMX; contatos do movimento usam constantes próprias.
Drop ignora somente kind `RETRO_COLLIDER_PLATFORM`. Uma face TOP exposta de
região originalmente multidirecional mantém kind directional e não ganha
permissão de atravessar ao ser dividida. Escada/água/dano/custom continuam no array
legado para o host tratar; não são convertidos em bloqueadores sólidos.

Rampas são objetos de superfície separados, com grupo e alturas nos extremos.
Um recorte plano sobreposto a seus bounds é rejeitado antes da publicação,
pois recortes parciais de heightfields ainda não têm representação. Edite ou
remova a rampa. O overlay gerado mostra sua linha de piso; o helper legado
`gameMapCollisionAt` continua destinado à grade/retângulos planos, sem avaliar
rampas. Jogos que usam somente esse helper precisam adotar a API nova para
consumir rampas. Não declarar compatibilidade automática com física antiga.

Sem runtimeGeometry, exportação antiga permanece disponível; tentar exportar
plataforma/rampa nova produz diagnóstico em vez de ignorar o objeto. Projetos
existentes precisam atualizar explicitamente exportador/runtime/configuração.
Geometria tem limite de 4096 caixas planas derivadas, 4096 rampas e 4096
retângulos de autoria, com mapa de até 256×256 tiles; entradas
inválidas não substituem os derivados publicados pela exportação transacional.

`smoke-map-terrain` executa criador/redimensionamento, serializer TMX,
exportador Python real e runtime C: precisão, recortes, grupos, faces,
plataforma/drop, pouso em rampa e preservação após falha. `--sgdk <raiz>` gera
ROM temporária com consumidor da geometria, comprovando compilação/ResComp;
não executa emulador nem comprova fidelidade visual.

## ROM de diagnóstico de colisões

`assets/toolkit/fixtures/runtime-collision-sgdk.c` usa os módulos reais de colisão,
rampa e combate em uma sala original: piso, paredes dos dois lados, teto,
plataforma atravessável, rampa e alvo. É um exemplo isolado de movimento, ainda
sem o controlador compartilhado da issue #58 e sem modificar Alice/Tempo.

Controles: direcional move; B pula; C segurado passa de 2 para 12 px/tick;
baixo atravessa plataforma/rampa; A ataca; Start reinicia. Ataque tem janela
de seis ticks e aplica dano apenas uma vez por instância ao alvo, respeitando
invulnerabilidade. Corpo é verde, hurtbox roxa, ataque laranja e contatos
brancos. O alvo pisca durante invulnerabilidade; o HUD mostra dano/derrota,
vida e velocidade vertical. As caixas têm coordenadas em pixels e mirroring
independente da arte. A linha da rampa usa o mesmo sampler Q8 da colisão.

O desenho não usa sprites nem imagens externas: reserva BG_A, 920 tiles
(29.440 bytes) e o mesmo tamanho de buffer estático em RAM; BG_B contém o HUD.
Atualiza somente tiles sujos, em lotes de até 64 DMA_QUEUE (2.048 bytes),
preservando o buffer até VBlank. Lotes adicionais podem ocupar mais de um
frame de vídeo. Não representa orçamento, performance ou pipeline visual
de um game completo. Existe uma guarda contra sobreposição dos tiles da fonte.

```sh
node scripts/smoke-collision-diagnostic.mjs
node scripts/smoke-collision-diagnostic.mjs --sgdk /caminho/do/SGDK \
  --artifacts /tmp/retro-collision-diagnostic-novo
```

Sem SGDK, o teste inclui o fonte real num host C com APIs VDP simuladas:
paredes nos dois sentidos, movimento rápido, teto, piso, pulo, plataforma/drop,
rampa, combate, espelhamento, limpeza de desenhos antigos, clipping e DMA
com buffer estável. Com SGDK, também compila para 68000 com warnings como
erros e gera uma ROM. `--artifacts` exige uma pasta nova, preserva ROM/fonte
fora dos jogos e recusa sobrescrever uma pasta existente. Compilação e mock
não comprovam a apresentação ou controles reais no emulador/hardware.
