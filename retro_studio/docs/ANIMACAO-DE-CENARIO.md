# Animação de cenário (MDAnimacaoCenario)

Plantas que balançam, tochas e máquinas animadas trocando os tiles do mapa, sem sprites. O node cuida da integração com o streaming do mapa e mostra no build quanto cada animação custa.

## Como usar

1. **Desenhe a tira.** Faça um PNG com os quadros lado a lado, cada um do tamanho da área (múltiplos de 8 px). Use só as cores da paleta do mapa (pixel transparente = cor 0). Em geral, o primeiro quadro é o desenho que já está no mapa.
2. **Ponha o node.** Na cena, crie um **MDAnimacaoCenario** e preencha:
   - `mapa`: o MDMapa animado (vazio = o mapa irmão de cima que tem tiles embaixo da área);
   - `quadros`: a tira (a altura da área acompanha a da tira);
   - `tamanho`: o tamanho de um quadro;
   - `intervalo`: quadros de vídeo por passo (60 por segundo);
   - `sequencia`: os quadros de cada passo. Por exemplo, `0, 1, 0, 2` balança para os dois lados. Vazia, toca 0, 1, 2… em ordem.
   - `fase`: quadros de adianto no começo.
3. **Posicione.** Arraste a área verde sobre o mapa. A posição fica na grade de 8 px.
4. **Repita.** Para pôr a mesma planta em vários lugares, duplique o node (Ctrl+D). Nodes com a mesma tira e o mesmo ritmo (intervalo, sequência e fase) dividem os padrões e trocam juntos.
5. **Veja a prévia.** Ligue o **Animar** na barra da vista 2D: a animação roda no editor no ritmo do jogo.

As propriedades são as do Inspetor, então desfazer (Ctrl+Z), refazer e salvar funcionam como em qualquer node.

## O que o jogo faz

- O mapa da animação vai para o **streaming**. As células da área ganham padrões próprios, e os padrões animados ficam no fim da tabela do mapa.
- Quando a câmera traz um padrão animado para a janela, ele chega à VRAM **já no quadro atual** (o gancho fica no `stream_garantir`).
- Quando o quadro muda, só vão para a VRAM os padrões cujo dono da vaga ainda é o animado. Vagas seguidas viram **um DMA só**, direto da ROM, e o dado continua válido até o DMA rodar no vblank. Rolar a câmera não reenvia nada.
- **O resto do mapa não muda.** A paleta, a prioridade (MDPrioridade) e as células que ficam iguais em todos os quadros continuam como cenário comum.
- **Nada é descartado.** Com a fila do DMA cheia, a fila é esvaziada antes (para a ordem dos envios não mudar) e o envio vai na hora; o contador `anim_cenario_fila_cheia` registra.
- A animação usa o relógio da cena: ela para com a pausa e não muda a velocidade do jogo.
- A troca de cena e a volta recomeçam a animação pela `fase`.

## Ativação: proximidade, contato e código

Por padrão o node anima o tempo todo (**Sempre**). Em `ativacao` dá para escolher:

| Modo | Quando anima |
|---|---|
| **Sempre** | O tempo todo, no ritmo (`intervalo`, `sequencia`, `fase`). É o modo das cenas antigas. |
| **Proximidade** | Com um ator a até `distancia_ativacao` px do sensor (a distância é medida do corpo do ator). |
| **Contato** | Quando o corpo de um ator toca o sensor. Vale também passando rápido: um dash que atravessa a área entre dois quadros ativa, porque o caminho entre a posição anterior e a atual é seguido. |
| **Por código** | Em repouso até o código C mandar. |

### Propriedades (aparecem conforme o modo)

- `area_ativacao`: o sensor, relativo ao node (laranja na vista 2D, com alças para mover e redimensionar). Ele começa igual à área animada e a acompanha enquanto for igual. Só sente: não bloqueia nem fere.
- `alvos`:
  - **Jogador**: o MDJogador e os MDAtor do grupo `jogador` (no Sota, o Henzo);
  - **Inimigos**: os MDInimigo e os MDAtor do grupo `inimigo`;
  - **Grupo personalizado**: os MDAtor do grupo em `grupo_ativador` (aba Grupos).

  Tiros, efeitos e itens que não estão nesses grupos não ativam. Sem MDJogador e sem nenhum ator no grupo `jogador`, o sensor de jogador usa o ator que a câmera segue, e o build avisa.
- `exigir_movimento` e `velocidade_minima` (px/s): só atores andando sustentam a ativação. Vale o movimento no mundo; a câmera rolando não conta. Um ator parado dentro do sensor deixa de sustentar.
- `ciclos_apos_sair`: quando a ativação acaba, a animação termina o ciclo atual e roda mais estes ciclos (0 = só termina o atual).
- `quadro_repouso`: o quadro mostrado parado.

A `fase` só vale no modo Sempre: com gatilho, cada ativação começa do primeiro passo.

### Regras

- Ativar uma instância em repouso começa a sequência do primeiro passo. Ficar no sensor repete os ciclos, sem reiniciar a cada quadro.
- **Fim da ativação:** a animação termina o ciclo atual, roda `ciclos_apos_sair` ciclos e mostra `quadro_repouso`. Em repouso, nada é enviado para a VRAM.
- **Voltar durante o balanço:** cancela a parada sem reiniciar (o passo continua).
- **Vários atores:** basta um cumprir as regras para a ativação continuar.
- **Teleportes:** nascer, voltar depois de morrer e saltos de mais de 32 px num quadro não traçam caminho. Aparecer dentro do sensor vale como contato.
- **Pausa, troca de cena e volta:** na pausa, a animação e os tempos congelam. Ao trocar de cena e voltar, as instâncias recomeçam em repouso.
- **Fora da tela:** a instância segue o tempo normalmente. Quando entra na janela da câmera, o padrão chega no quadro atual, inclusive em repouso.

### Estado independente e custo

Cada node com gatilho tem o seu estado **e os seus padrões na VRAM**: duas moitas com a mesma tira podem mostrar quadros diferentes, e encostar numa não mexe na outra. O compartilhamento fica assim:

- **Quadros na ROM:** iguais (a mesma tira, na mesma ordem de vagas) ficam num arquivo só. O build mostra quantos bytes foram divididos.
- **Células paradas:** as que são iguais em todos os quadros (a base da moita, por exemplo) viram cenário comum e dividem os padrões com o mapa.
- **Modo Sempre:** continua dividindo os padrões entre nodes com o mesmo ritmo.

O custo na VRAM é o de padrões próprios por instância. Como moitas longe umas das outras nunca estão na mesma janela da câmera, elas dividem as vagas do streaming. No Egito do Sota, as 12 moitas com contato usam 209 padrões animados em 144 vagas, e a VRAM da cena ficou em 1402/1424 tiles.

O relatório do build mostra:

- as instâncias de cada modo, as células, os padrões, as vagas e os bytes de VRAM;
- os bytes de quadros na ROM, com os divididos à parte;
- o pico estimado de bytes e DMAs num quadro, na pior janela da câmera, com todas as instâncias com gatilho trocando juntas.

### Código C

Cada node com gatilho ganha um número em `gerado/cena_<cena>.h`, `ANIM_CENARIO_<NOME>`. Exemplo, em `src/<cena>.c`:

```c
#include "gerado/cena_egito.h"

void egito_atualizar(void) {
	// Uma explosão perto do arbusto: balança 3 ciclos.
	if (explodiu) {
		anim_cenario_ativar(ANIM_CENARIO_MOITA04, 3);
	}
	// Máquina ligada enquanto a alavanca estiver puxada.
	anim_cenario_sustentar(ANIM_CENARIO_MAQUINA, alavanca_puxada);
	if (anim_cenario_tem_ator(ANIM_CENARIO_MOITA01)) {
		// Alguém está mexendo na moita: um inimigo escondido pode pular.
	}
}
```

| Função | O que faz |
|---|---|
| `anim_cenario_ativar(id, ciclos)` | Anima `ciclos` ciclos completos; em repouso, o ciclo que começa conta como o primeiro. |
| `anim_cenario_sustentar(id, TRUE/FALSE)` | Como um ator no sensor, até soltar. |
| `anim_cenario_parar(id)` | Parada suave: solta o código e termina o ciclo atual. |
| `anim_cenario_parar_agora(id)` | Repouso na hora (`quadro_repouso`). |
| `anim_cenario_sensor(id, TRUE/FALSE)` | Liga ou desliga o sensor (desligado, só o código ativa). |
| `anim_cenario_animando(id)` | Está animando? |
| `anim_cenario_tem_ator(id)` | Havia ator válido no sensor no último quadro? |

**Código e sensores juntos:**

- A ativação dura enquanto houver um ator válido no sensor **ou** um pedido do código (ciclos pedidos ou sustentar).
- `anim_cenario_parar` solta o código, mas um ator no sensor continua animando.
- `anim_cenario_parar_agora` põe em repouso na hora; se ainda houver ator válido no sensor, a animação volta no quadro seguinte. Para parar de vez, desligue o sensor antes (`anim_cenario_sensor(id, FALSE)`).
- Os pedidos valem a partir do próximo quadro da animação (o `parar_agora` vale na hora).

### Prévia no editor

Com o **Animar** ligado, as instâncias com gatilho ficam em repouso. Os botões do Inspetor simulam a ativação: **Encostar** (um quadro de ativação, como um ator passando), **Segurar** (como um ator parado no sensor, até soltar) e **Repouso**. A simulação não muda nem salva nada na cena.

### Cenas antigas

As cenas sem as propriedades novas abrem no modo Sempre, com o mesmo comportamento de antes. O sensor fica igual à área, com 2 ciclos depois e repouso no quadro 0.

## Custo no build

O console do build mostra, para cada mapa com animação:

- grupos (ritmos), células, padrões animados, vagas e bytes de VRAM, e bytes de quadros na ROM;
- para cada grupo, os bytes e DMAs de uma troca na **pior janela da câmera** (41 × 29 células);
- o **pico estimado**: os grupos que trocam no mesmo quadro de vídeo, somados;
- uma **sugestão de fase**, quando fases diferentes baixam o pico (a fase não é mudada sozinha).

Acima de 3 KB num quadro, o build avisa: o vblank leva uns 7 KB, divididos com o streaming e os sprites.

É uma estimativa. Para medir na ROM, os contadores ficam na RAM e podem ser lidos pelo depurador:

| Contador | O que é |
|---|---|
| `anim_cenario_bytes`, `anim_cenario_envios` | bytes e DMAs da animação neste quadro |
| `anim_cenario_pico_bytes`, `anim_cenario_pico_envios` | os maiores desde o começo da cena |
| `anim_cenario_total_bytes`, `anim_cenario_total_envios` | os totais desde o começo da cena |
| `anim_cenario_fila_cheia` | vezes em que a fila do DMA estava cheia |

## ROM de diagnóstico

Para comparar o desempenho com e sem animação nas mesmas condições, gere a ROM com as animações paradas no primeiro quadro, sem mexer na cena:

```sh
retro-studio --headless --editor --path <projeto> -- --retro-build --retro-sem-animacoes
```

Ou ligue `retro_studio/build/sem_animacoes` nas configurações do projeto. O build avisa "DESLIGADA nesta ROM".

## Erros e limites

- As cores da tira precisam estar na PAL do mapa. O erro lista as cores que faltam e em que quadro.
- A tira precisa ter a altura da área e uma largura múltipla da largura dela, com pelo menos 2 quadros.
- A área precisa estar na grade de 8 px e dentro do mapa.
- Duas animações não podem dividir uma célula: o erro diz quais áreas se cruzam e em que célula.
- Por cena: até 4 mapas com animação e 64 grupos (cada node com gatilho é um grupo; os do modo Sempre com o mesmo ritmo dividem um). Sequências até 255 passos; intervalo de 1 a 255 quadros. Até 32 atores e os corpos do jogo gerado (jogador e até 15 inimigos) nos sensores.
- O grupo personalizado precisa existir em algum MDAtor do jogo; senão o build para com a explicação.
- Os padrões animados contam no limite de 4095 padrões do streaming e ocupam vagas da VRAM, que aparecem no relatório.
- Por enquanto só troca de padrões. Efeitos de cor usam o MDCicloCores e a MDCachoeira; efeitos procedurais ficam para depois.

## Testes

- `retro_studio/testes/teste_anim_cenario.c` com `anim_cenario_dados.py` roda o streaming e o runtime gerados no computador, com uma VRAM de mentira. A câmera para, anda nas duas direções, volta, salta e a cena recomeça. A cada quadro, o teste confere o desenho de cada célula da janela e se a animação mandou exatamente os padrões residentes que mudaram.
- `retro_studio/testes/anim_cenario/gerar_cenas.py` monta as cenas de teste: a fase 1 com plantas, tochas e máquina, e um mapa de 300 × 48 células com 3000 padrões, para forçar o reuso das vagas.
- `retro_studio/testes/teste_anim_gatilho.c` testa os gatilhos contra um modelo escrito à parte: entrada, permanência, saída e volta, os dois lados, ator parado, velocidade acima e abaixo do limite, vários atores, filtros (jogador, inimigos, grupo, projétil), dash, teleporte, a API do código, pausa, reinício e fila do DMA cheia.
- `retro-studio --headless --editor --path <projeto> -- --retro-teste-mcp` testa as conversões do `node_set` (listas de inteiros para `sequencia`, opções pelo nome) e a ida e volta das propriedades numa cena salva.
- O `testar_jogos.sh` compila essas cenas e roda os testes.
