# Controlador de personagens — issue #54

O módulo `character` v1 depende de `core` e é instalado em
`src/retro_runtime/retro_character.c/.h`. Não lê controles, altera física ou
cria sprites por conta própria. O jogo fornece condições e callbacks; os
controladores customizados existentes continuam disponíveis.

## Dados e integração

Inicialize `RetroCharacter` com zeros antes do primeiro `retroCharacterInit`.
Mantenha a definição e seus arrays imutáveis e vivos durante o uso.
Estados têm ID explícito, ID da animação, tempos em ticks de vídeo, poses,
eventos, loop e permissão de interrupção. Limites: 128 estados, 255 quadros por
estado, tempos 1..255, 512 transições e 2048 eventos no conjunto da definição.
IDs `0xFFFF` são reservados. A validação verifica referências e limites antes
de chamar o host; uma inicialização inválida preserva a instância anterior.

O header exportado pelo Charset Maker fornece os dados de animação para esse
módulo quando `retro_character.h` foi incluído **antes** do header do personagem:

```c
#include "retro_runtime/retro_character.h"
#include "ninja_animations.h" /* use o nome real do header exportado */

static RetroCharacter player = {0};
/* O jogo fornece callbacks de renderização e eventos. */
void initCharacter(const RetroCharacterHost *host) {
    retroCharacterInit(&player, &ninja_character_definition, NINJA_ANIM_IDLE, host);
}
```

Os nomes C seguem o prefixo do personagem exportado. As durações correspondem
às usadas pelo ResComp. Dimensões e apoio correspondem à célula comum do atlas,
que já alinha os recortes de espada/corpo; reaplicar os apoios dos recortes de
origem deslocaria o personagem. Dados gerados não instalam callbacks no sprite.
O guard opcional mantém os helpers SGDK e a geometria disponíveis para jogos
que não usam esse módulo. Mais de 128 animações mantém somente o caminho legado.

A aba **Comportamento** configura interrupção, transições e eventos do quadro
selecionado. Uma transição aponta para o ID persistente do movimento de destino;
renomear/reordenar movimentos não quebra essa referência. O exportador resolve
os IDs para os índices atuais. Remover um movimento limpa transições para ele.

Condições disponíveis: chão, movimento, pulo, ataque, parede, forma alternativa
e ferimento. O host monta as máscaras usando os macros exportados
`NINJA_CONDITION_GROUND`, `NINJA_CONDITION_MOVING` etc.; esses valores não são os
bits físicos do joystick e não são detectados automaticamente. Condições
customizadas usam o ID de predicado e o callback do jogo.

Eventos têm tipo e argumento/ID do jogo. Mover/arrastar quadros remapeia seus
eventos; remover quadro remove seus eventos; duplicar pose não duplica ataques
ou sons. Reaplicar uma grade menor remove eventos dos quadros que deixaram de
existir. Os dados são salvos na versão 6 do projeto de personagem, com backup
na migração de versões anteriores. Configuração inválida não substitui o arquivo
salvo nem é exportada; corrija os campos antes de trocar de projeto.

A definição C exportada inclui as transições/eventos configurados. Para
controladores customizados, reutilize os arrays numa definição própria ou
mantenha os callbacks anteriores. Não edite o header exportado, atualizado pelo
próximo export. A autoria e a prévia ainda não comprovam física/renderização em SGDK ou a
execução efetiva do evento de ataque no jogo.

## Transições e tempo

Depois de desenhar a pose atual, chame `retroCharacterTick` uma vez por quadro
de vídeo. O relógio avança primeiro; a seleção avalia a idade e o término já
atualizados. Uma animação de um quadro com duração 1 e uma transição por término
sai após exatamente um quadro desenhado. PAL/NTSC não têm conversão automática.

As condições são um bitfield de 32 bits: todos os bits de `requireAll` devem
estar presentes e nenhum bit de `requireNone` pode estar presente. O callback
`condition` permite predicados customizados (`RETRO_ID_NONE` os desativa).
`minimumTicks` é a idade mínima; `requireFinished` exige sequência concluída.
Uma animação não interrompível permanece até o fim. Uma animação em loop não
interrompível só pode sair por override explícito do jogo.

`from=RETRO_ID_NONE` aceita qualquer estado. Maior prioridade vence; empates
seguem a ordem do array. No máximo uma transição ocorre por Tick, evitando
cadeias instantâneas cíclicas. Transições para o próprio estado são ignoradas;
`retroCharacterSetState` permite reiniciar explicitamente o mesmo estado.

## Poses e eventos

`enter` informa os IDs anterior/novo. `pose` recebe estado, animação, quadro,
dimensões, apoio e flips. O adaptador do jogo aplica posição/câmera e controla
o frame SGDK: não deixe a animação automática do sprite competir com os timers
deste módulo. O módulo opcional `character-sprite` fornece esse adaptador;
o helper legado que instala callback SGDK continua disponível separadamente.

`event` é chamado na entrada de cada quadro, uma vez por passagem, incluindo
quadro zero e retorno de loop. Tipos padrão: som, ataque, projétil e transformação;
tipos adicionais podem ser tratados pelo host. O módulo não aplica dano, toca
áudio ou transforma sprites sozinho. Uma pose futura cancelada por uma
transição não emite seus eventos. O último quadro de uma sequência parada não
repete eventos. Callbacks devem agendar suas ações; chamadas recursivas de Init,
SetState ou Tick são recusadas enquanto o controlador estiver ocupado.

## Evidência e limites

`smoke-character-runtime.mjs` compila e executa o C real e também um header real
do Charset Maker com recortes de tamanhos diferentes. Cobre prioridade,
condições, duração exata, sequência, loops, eventos, apoio, validação e reentrada.
`--m68k-cc <compilador>` verifica a compilação para 68000. O módulo também entra
no build SGDK do skeleton pela instalação modular. Isso não comprova física,
renderização visual, áudio nem integração com personagens de Alice/Tempo.

## Prévia de comportamento

Na aba Comportamento, use **Reiniciar**, **1 tick** ou **Simular**. A simulação
começa no movimento selecionado, com relógio independente da timeline de
autoria. Configure as condições e os IDs de predicados na seção da simulação.
A seleção, os tempos dos quadros e o projeto salvo não são alterados.

O canvas mostra o estado/quadro atual, alinhado pelo apoio comum. O log guarda
os últimos 32 eventos, com tick, movimento, tipo e argumento. Ele não toca
sons, cria projéteis nem executa código do jogo. Condições e predicados são
entradas manuais; a física não é simulada nesta prévia.

Editar os movimentos/configuração, trocar a seleção ou a aba reinicia a
simulação. Esconder o editor, sair do projeto ou desmontar pausa o timer.
Callbacks antigos são invalidados, e preferência de movimento reduzido
desativa reprodução automática; o avanço de um tick continua disponível.

`smoke-character-preview` compara 80 ticks/eventos do simulador JS com o C
real compilado a partir do header exportado. Exercita também reentrada de
predicado, leitura sem alterações e métodos de timer do SFC em host VM.
Esses testes não substituem a inspeção visual/foco em Electron.

## Sprite SGDK, câmera e ciclo de vida

O módulo `character-sprite` v1 depende de `character`. Inclua seu header antes
do header exportado; ele inclui `genesis.h` antes dos tipos do controlador.
O jogo continua responsável por `SPR_init`, alocação, paletas, VRAM,
`SPR_update` e liberação. O adaptador usa um registro limitado a 80 vínculos
e preserva `Sprite.data`.

```c
#include "retro_runtime/retro_character_sprite.h"
#include "ninja_animations.h"

static RetroCharacter player = {0};
static RetroCharacterSprite visual = {0};

u8 bindCharacter(Sprite *sprite, const RetroCharacterHost *host) {
    if (!retroCharacterInit(&player, &ninja_character_definition,
                            NINJA_ANIM_IDLE, host)) return 0;
    return retroCharacterSpriteAttach(&visual, &player, sprite);
}
/* A cada quadro, após atualizar física e câmera: */
void drawCharacter(s16 feetX, s16 feetY, s16 cameraX, s16 cameraY, u8 left) {
    retroCharacterSpriteFacing(&visual, left, 0);
    retroCharacterSpritePosition(&visual, feetX, feetY, cameraX, cameraY);
}
/* SPR_update(); SYS_doVBlankProcess(); retroCharacterTick(&player, flags); */
```

Attach valida os IDs, contagens de quadros e dimensões contra o recurso SGDK
antes de alterar callbacks. Aplica a pose atual sem repetir eventos de entrada.
Feet/câmera usam pixels inteiros; o jogo converte sua posição de ponto fixo.
O apoio é espelhado conforme facing XOR flip autoral. Priority pode ser alterada
por `retroCharacterSpritePriority`. Poses fora da tela são ocultadas antes de
converter a posição para coordenadas do VDP.

Os callbacks do host original recebem seu contexto original. O callback SGDK
anterior também é chamado, mas o timer do sprite fica em zero para que somente
o controlador avance a animação. Durante callbacks, detach é recusado; agende
trocas/liberações para depois da chamada. Não substitua o recurso, reinicialize
o controlador ou use `SPR_reset` enquanto o vínculo estiver ativo.

Confira o retorno de `retroCharacterSpriteDetach` antes de liberar sprite,
controlador ou adaptador. Ele restaura o host e o callback SGDK quando ainda
pertencem ao vínculo, retomando o timer do quadro SGDK atual. Um host novo,
com contexto próprio e sem wrappers do adaptador, é preservado. Se apenas parte
do host foi substituída, detach retorna zero **sem alterar nada**: o jogo deve
substituir o host inteiro por um host independente ou restabelecer os wrappers
antes de tentar novamente. Pode copiar `visual.originalHost`, ajustar seus
callbacks/contexto e atribuir esse host inteiro a `player.host`. O adaptador
nunca libera os objetos emprestados nem restaura posição/facing/prioridade.

Eventos seguem o relógio lógico. Uma transferência DMA adiada pode atrasar a
pose visível; não há promessa de sincronização de ataque com o frame efetivo
na tela. `smoke-character-sprite.mjs` testa timers, callbacks, apoio, flips,
câmera, clipping, validação e detach parcial no host. A opção
`--sgdk <raiz-do-SGDK>` compila contra headers reais de SGDK 1.81 e gera uma
ROM temporária com header do Charset Maker, ResComp e adaptador. Não executa
emulador nem modifica personagens dos projetos Alice/Tempo.

Para consumir corpo, área de dano e ataque autorados, inclua também `retro_collision.h`
antes do header do personagem. Ver COLLISION_RUNTIME.md: caixas locais nos
pés, conversão Q8, flips e janela inclusiva de frames. Isso não aplica dano
automaticamente nem faz a caixa física acompanhar o tamanho da imagem.
