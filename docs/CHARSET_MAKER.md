# Charset Maker: personagens e recortes
Implementação relacionada à issue #39.

## Biblioteca
Abra Recursos → Charset Maker. A lista **Personagens do projeto** lê os projetos
em `charsets/`, fora de `res/`.

- **Novo personagem** começa sem animações usando a folha atual. Se não houver
  folha aberta, pede uma imagem. Para usar outra folha, abra-a primeiro.
- **Duplicar** copia animações, recortes, apoios e caixas, com um arquivo de
  edição e nomes de exportação independentes.
- Escolha um personagem na lista para abrir seu projeto.
- **Excluir** remove o personagem aberto. O arquivo vai para a lixeira; a folha
  de sprites e o que já foi exportado para o jogo continuam no projeto.
- A lista mostra só personagens cuja folha está dentro do projeto. Os que
  apontam para folhas de outra pasta ficam ocultos, com um aviso e o botão
  **Remover** para tirá-los do projeto.
- Abrir uma folha de fora do projeto copia a imagem para `charsets/` e
  trabalha nessa cópia. O menu **Recentes** lista só folhas do projeto aberto.
- Abrir uma folha conhecida restaura um dos projetos associados a ela.
  Se vários personagens usarem a mesma folha, escolha o desejado na biblioteca.
- Alterações são salvas automaticamente. Falha de salvamento impede a troca
  ou o fechamento solicitado pelo editor.
- A imagem original deve continuar no caminho salvo; um arquivo ausente é
  reportado sem apagar o projeto.

Cada personagem precisa de nome, símbolo SGDK e PNG exclusivos. A exportação
recusa conflitos com outros personagens e recursos existentes. Personagens
novos usam um identificador independente do caminho da folha.

## Ajuste da seleção pelo teclado
Com uma seleção na folha e o foco fora dos campos de texto (por exemplo, logo
depois de clicar numa animação da lista ou dentro da seleção):

- **Setas** movem a seleção 1 px; com **Shift**, 8 px.
- **Alt + setas** aumentam ou diminuem a largura e a altura da seleção.

Se a seleção é a faixa da animação escolhida na lista, a animação acompanha o
movimento na hora, e a prévia mostra o resultado. Ao redimensionar, a animação
só acompanha enquanto a faixa mantiver a mesma quantidade de quadros; para
mudar a quantidade, use **Aplicar recorte à faixa selecionada**. Animações de
quadros livres não acompanham: use **Substituir quadro**.

## Medir distâncias
Ligue **Medir** na barra acima da folha e arraste entre dois pontos: a caixa
rosa mostra a distância horizontal e a vertical em pixels, por exemplo o
espaço entre dois personagens da folha. Com **Shift**, a medida trava na
horizontal ou na vertical. A medida fica na tela até outra começar; **Esc**
ou o × a limpam. Os botões **→ Espaço X** e **→ Espaço Y** levam o valor
medido para o espaçamento do recorte (até 128 px). Enquanto Medir está
ligado, arrastar na folha não altera a seleção; desligue para voltar a
selecionar.

## Animar enquanto ajusta
Com **Animar ao ajustar** ligado (padrão, ao lado de *Flip na prévia*), a
animação continua tocando enquanto você move ou redimensiona a seleção com o
mouse ou com as setas. Quando a seleção é a faixa da animação escolhida, a
animação acompanha o ajuste na hora, então a prévia já mostra o recorte novo.
Ao redimensionar, ela só acompanha enquanto a quantidade de quadros for a
mesma. Desligado, o ajuste pelas setas e pelas alças pausa a prévia.

## Redimensionar e remover a seleção
A seleção tem alças nos quatro cantos e no meio de cada borda. Arraste uma
alça para mudar o tamanho sem refazer a seleção: por exemplo, puxe a borda
direita para dentro quando a faixa pegou 8 quadros e a animação só tem 7. Com
**Encaixar** ligado, a borda gruda nas linhas da grade e nas guias. Com o
ponteiro sobre a seleção, aparece uma lixeira pequena do lado de fora, acima
do canto superior direito (ao lado, quando a seleção está colada no topo da
folha). Ela remove a seleção; a animação já criada não é apagada.

## Guias de alinhamento
Na barra acima da folha:

- **Grade**: cobre a folha inteira. **Quadro** repete a caixa do recorte
  (largura, altura e espaços) pela folha toda, e é o padrão; também há linhas
  a cada 8, 16 ou 32 px. Com zoom alto (a partir de 6×) aparece ainda a grade
  de 1 px. No modo Quadros livres, a opção Quadro não desenha grade.
- **Encaixar**: ao arrastar, a seleção gruda nas linhas da grade, e uma seleção
  nova já nasce com células inteiras. As setas do teclado continuam movendo
  1 px, para o ajuste fino.
- **Alinhar à seleção**: faz a grade começar no canto da seleção atual, para
  folhas com margem. Sem seleção, o botão volta a grade para o canto da folha.
- **Apoio**: em cada quadro da seleção, uma linha rosa na altura dos pés
  (Apoio Y) e uma linha azul no eixo do ponto de apoio (Apoio X).

- **Réguas**: réguas em pixels no topo e à esquerda da folha. Arraste a partir
  de uma régua para criar uma guia horizontal ou vertical, como no Photoshop,
  e arraste a guia para movê-la. Para remover: arraste a guia para fora da
  folha, dê dois cliques nela, clique com o botão direito ou use **Limpar
  guias**. Com a guia em foco, as setas movem 1 px e Delete a remove. As guias
  ficam guardadas por folha, na máquina, e a seleção encaixa nelas.

As guias são só de visualização: não entram no PNG nem no projeto do
personagem. A preferência fica guardada na máquina.

## Animações com tamanhos diferentes
1. Selecione a faixa na folha.
2. Defina largura, altura e espaçamentos do recorte.
3. Em **Apoio X/Y**, indique a posição dos pés dentro de cada quadro.
4. Clique **Adicionar faixa** para criar, ou **Aplicar recorte à faixa
   selecionada** para atualizar uma animação existente.

As mudanças no formulário não redimensionam automaticamente as outras faixas.
Ao selecionar uma faixa, o formulário mostra as configurações próprias dela.
Use o mesmo ponto do corpo como apoio em todas as animações.

Exemplo: parado em 32×48, pés em (16,48); ataque em 80×48, corpo na esquerda
e espada à direita, pés em (16,48). As duas animações serão exportadas em
células de 80×48, alinhadas pelos pés. A prévia usa a mesma célula e os mesmos
deslocamentos da exportação. Pixels não são escalados.

As dimensões finais são arredondadas para múltiplos de 8. O editor bloqueia
células além de 248 px por eixo e atlas grandes demais para a exportação.
O total de tiles mostrado é o tamanho da célula completa, não a alocação
definitiva de VRAM: o ResComp pode otimizar áreas transparentes. O jogo deve
reservar VRAM conforme o SpriteDefinition compilado e a cena.

## Corpo e espada
- **Colisão do corpo** é um retângulo separado do tamanho da imagem.
- Cada animação pode ter uma **área de ataque**, ativa entre dois índices
  de quadro (inclusivos, começando em 0).
- X/Y das caixas são relativos ao apoio dos pés; Y negativo fica acima.
- Verde na prévia: corpo. Laranja: ataque quando o quadro está ativo.
- O ponto de apoio e as caixas são apenas guias: não entram no PNG.

## Exportação e integração
A exportação gera:
- PNG indexado em `res/`, com transparência;
- declaração SPRITE em `res/resources.res`;
- `src/<personagem>_animations.h`, com índices, geometria e tabela de ataques.

O cabeçalho inclui FRAME_WIDTH/HEIGHT, ANCHOR_X/Y, BODY_X/Y/WIDTH/HEIGHT e
a tabela `<personagem>_attack_boxes`. Cada linha corresponde a uma animação:
`enabled, x, y, width, height, firstFrame, lastFrame`.

O jogo deve usar esses metadados em sua lógica. Exportar uma caixa não instala
automaticamente colisão, combate ou dano em jogos existentes. Jogos com
tamanho de quadro fixo no código precisam passar a usar as dimensões exportadas.

Posição visual a partir dos pés:
- Sem flip: (feetX - ANCHOR_X, feetY - ANCHOR_Y).
- Com flip horizontal: (feetX - (FRAME_WIDTH - ANCHOR_X), feetY - ANCHOR_Y).
- Para espelhar uma caixa relativa aos pés: x = -x - width.

O helper de animação instala um callback que para o timer no último quadro
das sequências sem loop. Se o jogo já usa callback de troca de quadro,
chame `<personagem>_on_frame_changed(sprite)` dentro dele em vez de substituir
seu callback. Não altere dados de Animation compilados em ROM.

## Compatibilidade
Projetos anteriores continuam no mesmo caminho. Antes de salvar a versão 4,
o editor preserva o JSON original em `<arquivo>.charset.json.v1.bak` ou `.v2.bak` / `.v3.bak`, conforme a versão anterior.
Projetos legados encontrados em `res/charsets/` são mantidos no local antigo
e também salvos em `charsets/`.

Na versão 4, `frameWidth/frameHeight` descrevem a célula final de exportação;
`cropWidth/cropHeight` guardam o formulário de recorte. Cada animação mantém
suas próprias dimensões, apoio e área de ataque. Recortes inválidos ou fora
da imagem impedem a abertura, em vez de serem descartados durante o salvamento.


## Grids próprios e ataques de espada
O recorte de origem aceita medidas exatas de 1 a 248 px, sem exigir múltiplos
de 8. A exigência de múltiplos de 8 é aplicada somente à célula final do atlas.

- **Grid regular:** define largura, altura, Espaço X/Y e a origem da seleção.
  Cada animação pode usar um grid diferente. Os campos Origem X/Y e Seleção
  L/A permitem corrigir a região numericamente.
- **Quadros livres:** recorta cada pose separadamente, inclusive com tamanhos
  diferentes dentro da mesma animação. Use Nova animação, dê um nome, selecione
  a primeira pose e clique Criar animação com este quadro. Para as próximas,
  limpe a seleção, recorte a pose e clique Adicionar quadro à animação.
- A lista permite escolher, substituir, remover e reordenar os quadros livres.
  Remover o último quadro é bloqueado; remova a animação inteira quando necessário.
- Para completar uma faixa regular com poses irregulares, selecione-a,
  mude para Quadros livres e adicione um quadro. Os quadros existentes são
  convertidos sem mudar seus recortes nem sua ordem.
- **Marcar apoio dos pés na prévia:** ative e clique no mesmo ponto dos pés.
  Nos quadros livres, cada quadro guarda seu apoio; no grid, o apoio é da faixa.
  Também é possível informar Apoio X/Y numericamente e aplicar o recorte.

Para uma sequência com oito poses de espada, os oito retângulos de origem
podem ter larguras, alturas e posições diferentes. O atlas reúne todos em
células comuns alinhadas pelos pés, mantendo o tamanho original dos pixels.
Os projetos guardam a lista `frames` para recortes livres; os grids antigos
continuam usando `region`, dimensões e espaçamentos.

Verificação de geometria: `node scripts/smoke-charset-frames.mjs`.

## Sequência visual de animação
O painel sob a folha reúne prévia e sequência de miniaturas. Ele permanece
visível durante a edição dos recortes.
- Clique numa miniatura para escolher um quadro.
- Arraste miniaturas para reordenar, ou use os botões de mover.
- Duplique/remova quadros sem precisar voltar à imagem original.
- Renomeie, duplique e mova animações no painel de animações. A ordem
  determina os índices C; use os nomes definidos no cabeçalho no jogo.
- As edições de quadros de um grid convertem a faixa para recortes explícitos,
  preservando os retângulos, a ordem e os apoios originais.
- O flip só altera a visualização; não espelha o PNG exportado.

### Tempo por quadro no Mega Drive
O campo Tempo usa ticks de vídeo inteiros de 1 a 255, como os timers do SGDK.
A preparação de um golpe pode usar 12 ticks; o corte, 3 ticks.
O FPS define o tempo padrão: arredonda-se 60/FPS para um número inteiro
de ticks. Por exemplo, FPS 8 gera 8 ticks, equivalentes a 7,5 poses/s em NTSC.
Um tempo individual substitui o padrão apenas naquele quadro; Usar FPS
remove essa substituição.

A opção NTSC/PAL altera a taxa da prévia entre 60 e 50 Hz, sem alterar os
timers exportados. 12 ticks duram 0,2 s em NTSC ou 0,24 s em PAL.
Os mesmos tempos são gravados nas listas de timers em resources.res.
Um jogo com controlador próprio de animação deve consumir esses tempos;
um controlador que usa somente FPS não reproduzirá as pausas individuais.

### Recursos do console
O rodapé mostra tiles e bytes da célula comum antes da otimização do ResComp,
considerando tiles 8×8 em 4bpp (32 bytes por tile). Não é a quantidade
definitiva alocada em VRAM. A paleta exportada continua indexada, com até
15 cores opacas e índice de transparência.
A versão 4 do projeto guarda durationTicks em cada quadro personalizado.
Projetos anteriores recebem backup antes da atualização.


## Organização da interface
A lista de movimentos fica no painel esquerdo, com busca, criação, duplicação
e ordenação. Ela tem rolagem própria e permanece disponível ao editar o grid.
A folha e a sequência de miniaturas ficam no centro, com prévia sempre visível.
O painel direito tem abas Recorte, Corpo, Ataque e Exportar.
Selecionar um movimento mostra seus controles de recorte e volta ao início
do painel, sem precisar procurar o grid abaixo dos controles de colisão.
Em janelas estreitas, o painel de propriedades vai para a faixa inferior;
a lista e a folha continuam em áreas independentes.
