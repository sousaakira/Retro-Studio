# Jogo gerado: jogar sem escrever código (#70)

No modo **Jogo**, o cartão **Jogador e início** liga o que você criou na IDE — o mapa, o
personagem, as salas — em um jogo que roda. A IDE gera o código; você decide se programa por
cima.

## Passo a passo

1. **Mapa:** crie o mapa no modo Mapas e pinte a colisão (o chão).
2. **Onde o jogo começa:** no editor de mapas, desenhe o ponto **Spawn** onde o personagem
   deve aparecer. Em modo Jogo → **Salas e conexões**, adicione uma sala com esse mapa (a
   entrada já nasce no Spawn do mapa), marque-a como inicial e use “Salvar e exportar”.
   Se a sala já existia, ou se você mover o Spawn depois, o cartão **Jogador e início** avisa
   que os dois divergem e oferece **Usar o Spawn do mapa**; em Salas e conexões, cada entrada
   tem o mesmo botão. O Spawn é lido como os pés do personagem: centro da base do retângulo.
   Um Spawn desenhado até 16 px dentro do chão começa em cima dele.
3. **Personagem:** crie no modo Personagens e clique em **Exportar**. Só a animação de
   “parado” é obrigatória.
4. **Jogador e início:** escolha o personagem e a animação de cada situação (parado, andando,
   pulando, caindo; as que faltarem usam a de parado) e clique em **Exportar**.
5. **Construir** e **Jogar**.

Controles do jogo gerado: esquerda/direita andam, **B** ou **C** pulam, baixo desce de
plataformas atravessáveis, **START** volta ao último checkpoint (ou à entrada da sala). Quem cai
para fora da sala volta para lá também.

## O que a IDE escreve

Só os arquivos abaixo, refeitos a cada exportação, mais `game/game.json` (as suas escolhas):

| Arquivo | Assunto |
|---|---|
| `src/game/game.h` | O que o seu código pode chamar: `gameInit`, `gameUpdate`, `gameEndFrame` e consultas (`gamePlayerX`, `gameCameraX`, `gameRoomId`, `gameButtonsPressed`…). |
| `src/game/game.c` | A ordem das coisas a cada quadro. |
| `src/game/game_world.c` | Salas, saídas e checkpoints. |
| `src/game/game_player.c` | Física, animação e sprite do jogador. |
| `src/game/game_camera.c` | Câmera: usa a do editor de Câmera se ela foi exportada; senão acompanha o jogador. |
| `src/game/game_audio.c` | Música da sala, se o Áudio foi exportado; senão não faz nada. |
| `src/game/game_config.h` | Os nomes escolhidos: sprite, animações, caixa de colisão. |
| `src/game/game_internal.h` | Ligações entre esses arquivos. |

A física vem de “Física e sala de testes” quando exportada; senão, dos valores padrão.

## O seu código

`src/main.c` é seu. A IDE só o troca **uma vez**, e só se ele ainda for exatamente o do modelo
básico (sem nenhuma alteração sua), por este:

```c
#include <genesis.h>
#include "game/game.h"

int main(bool hardReset) {
    (void)hardReset;

    gameInit();
    /* Seu código de início aqui (carregar HUD, criar inimigos...). */

    while (TRUE) {
        gameUpdate();
        /* Seu código de cada quadro aqui (inimigos, itens, regras do jogo...). */

        gameEndFrame();
    }
    return 0;
}
```

Se o seu `main.c` já tem código próprio, a IDE não mexe nele e mostra as linhas a acrescentar.

Quer mudar o comportamento de um arquivo gerado? Edite-o: a IDE percebe, preserva o seu arquivo,
avisa no cartão (“Alterado fora da IDE”) e **para de atualizá-lo**; o build continua
funcionando. Para voltar ao gerado, use “Gerar por cima” no cartão (as suas alterações naquele
arquivo são descartadas).

## Quando o build é recusado

Só para projetos que usam o jogo gerado (têm `game/game.json`):

- o jogador ou o personagem mudou depois da última exportação → exporte de novo no cartão;
- o personagem escolhido não foi exportado, mudou de nome ou perdeu uma animação escolhida;
- não há sala inicial exportada;
- faltam módulos de apoio (instale no fim do modo Jogo).

Avisos que não impedem o build: o ponto de entrada da sala inicial não tem chão embaixo (o
jogador começaria caindo); o Spawn desenhado no mapa está em outro lugar que não a entrada.

Projetos sem `game/game.json` — incluindo jogos com código próprio — não mudam em nada.

## Limites desta versão

- Um jogador, de plataforma (andar e pular). Outros gêneros e um segundo jogador ficam por
  conta do seu código.
- Saídas com condição (porta trancada) nunca abrem sozinhas: nenhuma condição é considerada
  satisfeita.
- Objetos visuais do mapa, inimigos, HUD, efeitos sonoros e o diagnóstico em jogo não são
  ligados pelo código gerado.
- A caixa de colisão vem do Charset Maker quando cabe no quadro do personagem; senão é metade
  da largura e quase toda a altura do quadro.

## Verificação

`node scripts/smoke-game-host.mjs` (com `--sgdk <GDK>` também compila uma ROM com o código
gerado). O teste cobre: projeto que não optou, rascunho incompleto, arquivos gerados, trava do
build, alteração feita pelo programador, “Gerar por cima”, `main.c` do autor preservado e
`main.c` do modelo trocado uma única vez.
