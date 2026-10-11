# Movimento compartilhado — issue #58

O módulo opcional `movement` depende de `core` e `collision`. O instalador
distribui `retro_movement.h/.c`; instalar não substitui o jogador de um game
customizado, nem declara automaticamente `character.physics` no contrato.

## Controlador C

`RetroMovementConfig` usa inteiros Q8 (256 unidades por pixel). Velocidades
são pixels/tick de vídeo; aceleração e gravidade, pixels/tick². Não são os
formatos fix16/fix32 do SGDK. Um tick corresponde a um frame de vídeo.
O preset original usa caminhada 1,5, aceleração/desaceleração 0,5, gravidade
0,25, pulo 5 para cima, queda máxima 7 e dash 4 pixels/tick. Não representa
recuperação da física de uma ROM antiga nem altera Alice/Tempo.

Parâmetros incluem aceleração no ar, limite de pulo após soltar o botão,
duração/cooldown e permissão de dash no ar, limite de escorregada, impulso e
tempo de bloqueio direcional do pulo de parede, coyote time, buffer de pulo
e snap de rampa. Velocidades/acelerações aceitam 0..32 pixels/tick, com
gravidade/pulo/queda positivos; timers têm limites explícitos no validador.

```c
#include "retro_runtime/retro_movement.h"
RetroMovement player = {0};
RetroMovementConfig physics;
RetroBody spawn = {48*256,160*256,{-8,-32,16,32},1};
retroMovementPreset(&physics);
retroMovementInit(&player,&spawn);
/* A cada frame, input.axis = -1/0/1; buttons recebe edges/held do host. */
RetroMovementInput input = {1,RETRO_MOVE_JUMP_PRESSED|RETRO_MOVE_JUMP_HELD};
RetroMovementResult result = retroMovementTick(
    &player,&physics,input,colliders,colliderCount,slopes,slopeCount);
```

O host fornece os edges, desenha o jogador e aplica animações/câmera. O módulo
usa caixas de corpo independentes da arte; não faz depenetração de spawn.
Retângulos usam sweep X seguido de Y. Quando há rampas, o deslocamento é
dividido em passos de até 1 pixel para o sampler não ignorar rampas estreitas.
O custo cresce com a quantidade de passos e colliders; não é streaming nem
uma promessa de orçamento de CPU. Não há heap, callbacks ou dependência SGDK.

Pulo aplica impulso sem gravidade no tick inicial. Soltar o botão limita a
subida antes de aplicar a gravidade. Buffer inclui o tick do edge; um pulo
armazenado é consumido no começo de um tick com apoio/coyote/parede válida.
Dash tem direção fixa e pausa gravidade; contato horizontal o cancela.
Cooldown inclui duração do dash e espera configurada. O pulo de parede
mantém o impulso horizontal durante o lock. Escorregar exige queda e comando
em direção à parede; `facing` vira para longe só durante a escorregada,
preservando `movementFacing`. DROP mantido ignora plataformas/rampas, mantém
apoio em sólidos e suprime pulo. Caixa local não é espelhada automaticamente.

`result.conditions` fornece GROUND=1, MOVING=2, JUMP=4 e WALL=16, compatíveis
com o controlador de animação #54. O host acrescenta ATTACK, ALTERNATE, HURT
e aplica `retroCharacterTick` na ordem de desenho/tick documentada nesse
módulo. Estado inválido, configuração inválida ou terreno recusado devolvem
`invalid` sem publicar alterações parciais no jogador.

## Fonte e exportação

`shared/retro/movementConfiguration.js` define formato
`retro-studio.movement`, versão 1, `timing: "video-ticks"` e perfis `ntsc`/`pal`.
Os dois presets iniciais têm valores idênticos por tick; isso implica tempos
em segundos diferentes a 60/50 Hz. Alterar um perfil não modifica o outro.
Escala automática por tempo real ainda não existe e é recusada pelo validador.
Valores de pixels têm precisão 1/256; timers/snap são inteiros, sem arredondar
silenciosamente dados autorais.

O serviço `electron/retro/movementConfiguration.js` fornece status/revisão e
salvamento transacional nos caminhos fixos:

- `physics/movement.json`: fonte com os dois perfis.
- `src/generated/movement_config.h`: structs C `retroProjectMovementNtsc/Pal`.
- `.retrostudio/movement-export.json`: hash de propriedade do header.

Fonte/header/registro são publicados juntos, com hashes de revisão. Fonte
futura/inválida, revisão antiga, arquivo sem propriedade ou customização
manual do header são recusados. Configuração é específica à raiz recebida;
`main.c` e configuração global da IDE não são reescritos. O host SGDK escolhe
explicitamente o perfil por `IS_PAL_SYSTEM` ou política própria do game.

## Editor e sala de testes

Abra **modo Jogo → Física e sala de testes**. A sala mantém terreno,
trajetória e métricas ao lado do inspector: deslocamento, pulo/queda, dash,
parede e tolerâncias. Escolha PAL ou NTSC para editar cada perfil separadamente.
“Salvar e exportar física” publica os três arquivos acima; não instala um
jogador nem troca o controlador de um projeto existente.

Depois de salvar, use **Gerar ROM da sala**, seguido de **Abrir no emulador**.
A geração usa o toolkit SGDK/MarsDev das preferências e somente fontes
distribuídas, em uma pasta temporária. O Makefile do game não é executado;
nenhum arquivo do projeto é alterado. Abrir usa o emulador já configurado na
IDE. O perfil da ROM é selecionado pelo sistema PAL/NTSC do emulador, sem
depender do perfil escolhido para visualizar no browser.

Há somente uma geração em andamento. Ajustes não salvos bloqueiam os botões;
revisão externa invalida a ROM antiga. A abertura exige um token da sessão
vinculado ao projeto/revisão e confere hash e caminho da ROM. O renderer não
envia um executável ou caminho de ROM para esse IPC. Retornos atrasados de
build/open são descartados na troca de projeto. A prévia pausa antes de abrir
o emulador, inclusive quando sua abertura falha. Os quatro resultados mais
recentes são mantidos durante a sessão; os anteriores e os receipts ao sair
da IDE são descartados. Isso não é exportação permanente dos artefatos.

A prévia executa o próprio `retro_movement.c`, compilado em WebAssembly e
distribuído com a IDE. Não usa uma segunda implementação JavaScript da física.
`shared/retro/movementRoom.json` define o piso, paredes, teto, plataforma e
rampa usados pelo wrapper C e pelo desenho SVG. As caixas usam pixels locais
ao apoio dos pés, sem depender das dimensões do charset.

Reprodução começa pausada. É possível avançar um tick, traçar um pulo completo
ou reproduzir a 60/50 Hz. Setas movem, Z/espaço/B pula, X/C faz dash e baixo
atravessa plataformas. Botões oferecem os mesmos comandos. Ao sair da janela
ou ocultá-la a reprodução pausa; com movimento reduzido, traçar e avançar
continuam disponíveis, sem reprodução contínua. Clicar em controles internos
limpa as teclas mantidas sem interromper a reprodução.

Altura é o maior deslocamento vertical desde o início do último pulo;
distância é o deslocamento horizontal assinado entre seus pontos de partida
e chegada. Altura, distância e duração congelam no pouso, e caminhada posterior
não muda a medição. Antes do primeiro pulo, distância é zero. Pulo de parede
inicia uma nova medição. A trajetória conserva até 512 posições na reprodução.

Falha de escrita mantém os ajustes. Rascunhos ficam separados por projeto na
memória da sessão e sobrevivem ao fechamento do componente; não são recuperação
durável após encerrar a IDE. Mudança externa de revisão impede exportar um
rascunho antigo até recarregar explicitamente os dados. Respostas atrasadas
de outro projeto não substituem o formulário atual.

## Compilar a prévia C

O bundle só precisa ser recompilado quando o controlador, sua sala ou receita
de compilação mudar. Usa Clang e wasm-ld já disponíveis; não baixa ferramentas:

```sh
node scripts/build-movement-lab.mjs --wasm-ld /usr/lib/llvm-15/bin/wasm-ld
```

Informe o caminho do linker instalado na sua máquina, ou omita o argumento
quando `wasm-ld` estiver no PATH. O teste compara hashes do binário, fontes,
gerador, receita e header efetivo. O módulo não aceita imports e usa memória
própria por instância; não carrega código ou assets do projeto do usuário.

## Verificações e próxima integração

`smoke-runtime-movement.mjs` compila o C real no host: aceleração, pulo/cut,
piso/teto, ambas as paredes, flip exclusivo da escorregada, dash/cooldown,
tolerâncias, plataformas/drop, DOWN em sólidos/canto, rampa estreita durante
dash rápido, validação e estado preservado. `--m68k-cc <compilador>` compila
o módulo para 68000.
O pulo completo do preset, em sala de referência sem obstáculos, tem altura
de 52,5 pixels, 41 ticks até retornar ao piso e deslocamento de 60 pixels
segurando direção. Esses números são assertions do C real e incluem sua
ordem de impulso/gravidade/aceleração; não são estimativas de uma ROM antiga.

`smoke-movement-configuration.mjs` verifica perfis/precisão, fonte/header,
revisões/conflitos, isolamento entre projetos e header efetivo consumido pelo
controlador C. `--sgdk <raiz>` gera uma ROM temporária com o mesmo controlador
e seleção PAL/NTSC. Essa ROM verifica a cadeia de compilação, com HUD de estado;
ainda não desenha jogador/terreno nem comprova controles no emulador.

`smoke-movement-lab.mjs` compara 600 ticks entre C nativo e o bundle WASM,
com perfis PAL/NTSC e as mesmas entradas/colisores. Assertions independentes
verificam altura/duração e congelamento das métricas. `smoke-movement-editor.mjs`
executa script/lifecycle Vue com o WASM real: movimento reduzido, callback
obsoleto, falha de save, respostas tardias, isolamento e conflitos de rascunho.

`node scripts/preview-movement-lab.mjs` abre uma fixture local em
`http://127.0.0.1:5178`, com componente e WASM reais, mas IPC somente em memória.
Inspeção no navegador verificou layout 1280×900 e 720×720, foco interno durante
reprodução, pausa ao perder a janela e retenção/retry após falha simulada de
escrita. Não equivale à execução do IPC na janela Electron ou da ROM no emulador.

## Sala SGDK com os mesmos dados

`assets/toolkit/fixtures/runtime-movement-sgdk.c` desenha a sala canônica,
corpo, contatos e trajetória limitada a 512 posições. O HUD mostra altura,
distância, duração do pulo, velocidades e perfil PAL/NTSC. Usa o wrapper
`movement-lab.c` sem alterar sua lógica, incluindo as métricas que a prévia lê.
Não usa assets dos games nem substitui seus jogadores.

```sh
node scripts/smoke-movement-diagnostic.mjs \
  --sgdk /caminho/do/m68k-elf \
  --configuration /caminho/do/projeto/physics/movement.json \
  --artifacts /tmp/minha-sala-de-fisica
```

`--configuration` é opcional e lê o fonte salvo pelo editor; só publica suas
cópias no projeto temporário. A pasta de artefatos deve ser nova. O comando
mantém ROM, fonte da sala, header do terreno, wrapper e perfis/header efetivos.
Sem `--sgdk`, executa somente as verificações nativas. B pula, C faz dash,
baixo atravessa plataformas e Start reinicia com o perfil do sistema.

A fixture reserva BG_A e 920 tiles para o canvas, BG_B para cinco linhas de
HUD e cerca de 32 KiB estáticos para canvas/trajetória/estado. Não inicializa
o sprite engine. As fontes DMA permanecem intactas até o VBlank; lotes têm
até 64 tiles. Reset pode exigir vários VBlanks para limpar a sala. Caminhada
e pulo de referência cabem em um lote nos testes; custo para configurações
extremas e cadência efetiva de 50/60 Hz ainda precisam de medição no emulador.
Esse canvas de diagnóstico não é o renderer de mapas ou streaming do game.

Host verifica métricas, PAL/NTSC, paredes/flip dos dois lados, dash/drop/rampa,
reset por edge, trajetória limitada, pixels e estabilidade DMA. O mesmo fonte
compilou para 68000 com warnings como erros e gerou ROM SGDK 1.81 de 655360
bytes. Uma configuração alternativa foi exportada intacta e mudou o hash da
ROM. A tentativa de inspeção desktop parou em `command not found: orca-ide`;
nenhuma execução visual no emulador foi comprovada.

`smoke-movement-diagnostic-service` verifica confinamento, revisão, token,
hash, build concorrente/obsoleto, falhas e limpeza. `--sgdk <raiz>` executa o
serviço real e gerou ROM de 655360 bytes com a raiz MarsDev configurada na IDE.
Empacotamento testa geração com backend simulado em pacote sem `src/scripts`.
O browser verificou os botões e falha/retry de abertura com IPC em memória;
isso não comprova a janela Electron completa ou lançamento real do emulador.

Faltam ligação efetiva com o personagem/animações no game e verificação no
emulador para concluir #58.
Não declarar a issue concluída pela existência do módulo ou dos testes.
