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
- Por cena: até 4 mapas com animação e 32 grupos de ritmo. Sequências até 255 passos; intervalo de 1 a 255 quadros.
- Os padrões animados contam no limite de 4095 padrões do streaming e ocupam vagas da VRAM, que aparecem no relatório.
- Por enquanto só troca de padrões. Efeitos de cor usam o MDCicloCores e a MDCachoeira; efeitos procedurais ficam para depois.

## Testes

- `retro_studio/testes/teste_anim_cenario.c` com `anim_cenario_dados.py` roda o streaming e o runtime gerados no computador, com uma VRAM de mentira. A câmera para, anda nas duas direções, volta, salta e a cena recomeça. A cada quadro, o teste confere o desenho de cada célula da janela e se a animação mandou exatamente os padrões residentes que mudaram.
- `retro_studio/testes/anim_cenario/gerar_cenas.py` monta as cenas de teste: a fase 1 com plantas, tochas e máquina, e um mapa de 300 × 48 células com 3000 padrões, para forçar o reuso das vagas.
- O `testar_jogos.sh` compila essas cenas e roda o teste.
