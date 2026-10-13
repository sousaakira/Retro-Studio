# Editor de mapas

## Barra lateral

A barra lateral é dividida em cinco abas, uma por tarefa. A aba aberta fica guardada entre sessões.

| Aba | O que tem |
|---|---|
| **Mapas** | Abrir e criar mapa, importar kit, mapas do kit aberto, kits recentes e o editor de kit. |
| **Camadas** | Frente (FG), Cenário (BG) e Fundo visual, da frente para o fundo, com posição em pixels; inserir imagem do kit numa camada; opções do fundo e parallax. |
| **Tiles** | Tilesets, paleta de tiles, pincéis do kit e stamps. |
| **Objetos** | Propriedades do objeto selecionado (no topo), modelos de objeto e colisões precisas. Selecionar um objeto no mapa abre esta aba. |
| **Sala** | Dimensões do mapa, música, cenas programadas e estimativa de VRAM. |

As abas aceitam as setas ← → do teclado. O contador em **Objetos** é o número de objetos do mapa; o **!** em **Sala** avisa que a estimativa de VRAM passou do limite.

## Kits recentes e mapas do kit

O painel **Kits recentes** mantém os oito últimos kits usados. Clique em um kit para carregá-lo com seus tilesets, peças e objetos; use **×** para removê-lo da lista ou **Limpar** para apagar o histórico local. A lista fica salva no Retro Studio e não altera os arquivos do projeto.

## Abrir exemplos de um kit

Cada kit possui a pasta `maps/` para os mapas criados com ele. O editor cria essa pasta quando o kit é carregado ou salvo; ao usar **Salvar como** com um kit ativo, ela é o destino inicial. A seção **Mapas deste kit** lista os TMX/JSON encontrados no kit, incluindo essa pasta. O arquivo JSON do kit não aparece como mapa. Quando houver um TMX e um JSON com o mesmo nome, a lista mostra o TMX. Clique em um mapa para abri-lo com o kit associado.

Mapas abertos a partir de um kit também entram na lista de recentes.

## Plano de fundo

Na aba **Camadas**, seção **Fundo e parallax**, escolha um PNG/JPG do projeto. O editor exibe a imagem atrás das camadas BG/FG e permite ajustar o encaixe (**Preencher**, **Conter**, **Esticar** ou repetir nos dois eixos / em um eixo) e a opacidade. A referência relativa da imagem e esses ajustes são salvos como propriedades TMX do Retro Studio; imagens não são incorporadas ao arquivo. Mantenha a imagem junto ao projeto para que o mapa continue portátil. Essa visualização é uma referência de autoria: cada jogo ainda precisa implementar o carregamento/renderização do plano de fundo no runtime.

### Posição das camadas

Na aba **Camadas**, cada camada (Fundo visual, Cenário/BG e Frente/FG) tem campos **X/Y** em pixels e setas que movem 1 px (Shift: 8 px).

- **Fundo visual:** aplica na hora. O deslocamento é salvo nas propriedades `retroStudio.backgroundOffsetX` e `retroStudio.backgroundOffsetY` do TMX (ausentes quando o fundo está no lugar padrão). O exportador do projeto modelo já as aplica; jogos com exportador próprio precisam ler essas propriedades. Num fundo que preenche exatamente o mapa, deslocar deixa uma faixa vazia na borda oposta.
- **Cenário e Frente:** ajuste os valores e clique em **Aplicar**. Múltiplos de 8 px movem os tiles e seus atributos. Outros valores redesenham a camada deslocada e a recortam em tiles novos, num tileset gerado em `res/generated/` (até 15 cores); o tileset anterior continua na lista do mapa. Nenhum exportador precisa mudar, porque o resultado são tiles comuns.
- As colisões e os objetos não se movem. A posição é recusada se cortar parte da camada na borda do mapa.

### Camadas de parallax

Na mesma seção, use **Importar** ou **Selecionar projeto** para adicionar até oito imagens de parallax. Ajuste as velocidades horizontal e vertical (0 = fixa; 1 = acompanha a câmera como o mapa), o modo de encaixe/repetição, opacidade e ordem de desenho. O canvas atualiza a prévia quando a área de trabalho é rolada. As camadas são salvas na propriedade `retroStudio.parallaxLayers` do TMX, com caminhos relativos, modos, fatores de velocidade e opacidade. Nas salas do mundo (Runtime → Mundo) o exportador da IDE leva essas camadas para o jogo com o runtime de cenário; a seção mostra como elas cabem nos dois planos do console e o que não cabe. Limites, velocidades e orçamento de VRAM/DMA: `docs/SCENERY_RUNTIME.md`. O mapa inicial avulso e jogos com exportador próprio não desenham panoramas sozinhos.

### Estimativa de VRAM

A sidebar mostra uma estimativa orientativa para Mega Drive: conta cada imagem de tileset/fundo/parallax uma vez em blocos de 8×8 pixels e reserva 8 KB para planos de tilemap. Repetir uma imagem na tela não multiplica a contagem da imagem fonte. O cálculo não consegue conhecer sprites, paletas ou reservas específicas do runtime; confirme a compilação do projeto antes de considerar o uso exato de VRAM.

Dentro de cada aba, as seções podem ser recolhidas para reduzir a rolagem; a paleta de tiles começa aberta durante a edição.

## Criar objetos visuais e animados

O botão **Criar kit** / **Editar kit** abre um modal amplo com abas para identidade, terreno e peças, objetos e salvamento. Na aba **Objetos**, escolha uma categoria (cenário, itens, inimigos, interações ou marcadores), crie um modelo e selecione a imagem e o tile inicial visualmente. O painel mostra a prévia do recorte; dimensões, tipo e propriedades de gameplay são configurados separadamente para que dados como `item: health` sejam preservados.

Defina a largura e altura da região visual em tiles. Para animar, selecione quadros consecutivos na horizontal e configure a quantidade de quadros, velocidade e repetição. A prévia pode ser pausada; segue `prefers-reduced-motion`. Os kits antigos sem categoria ou asset visual continuam válidos e seus objetos aparecem como marcadores.

Na biblioteca lateral, os modelos aparecem agrupados por categoria e com miniaturas. Ao posicionar um modelo com visual, o canvas desenha o recorte e mantém os limites selecionáveis para edição. O TMX salva a referência visual como propriedade `retroStudio.visual`, separada das propriedades de gameplay.

O preview do editor não exporta sozinho sprites ou lógica para a ROM. O runtime do jogo precisa interpretar `retroStudio.visual`, carregar o tileset correspondente e reproduzir a animação; até isso ser implementado no runtime, essa funcionalidade serve à autoria e visualização do mapa no Retro Studio.

### Saídas e pontos de teleporte

Ao selecionar um objeto `room_exit`, o inspetor mostra os campos de destino, coordenadas de entrada em pixels, modo de ativação e direção para a qual o personagem olha ao chegar. No modo **Área retangular**, ajuste X, Y, largura e altura do próprio objeto; o retângulo também aparece sobre o mapa para facilitar o posicionamento. No modo **Borda da tela**, escolha esquerda ou direita: a saída dispara quando o personagem chega àquela extremidade, e Y/altura limitam a faixa vertical que ativa a passagem. `transition=teleport` continua exigindo o comando de interação definido pelo jogo; a opção Borda controla onde o gatilho é detectado. O editor grava essas configurações como propriedades TMX; cada jogo deve exportá-las e implementá-las no runtime.

### Falhas de exportação ao salvar

O TMX é salvo antes de executar o exportador configurado. Se a exportação falhar, o editor mostra o motivo informado pelo processo e mantém um aviso acima do mapa, com o caminho do arquivo salvo e **Detalhes da exportação** expansíveis e copiáveis (últimos 16.000 caracteres por saída). O aviso pode ser fechado e desaparece após uma exportação bem-sucedida. A falha não significa que o mapa foi perdido: corrija o problema indicado e salve novamente para atualizar os recursos do jogo.

## Música por cenário

Na seção **Música do cenário** da sidebar, escolha uma faixa do catálogo do projeto. O catálogo pode ser `audio/soundtrack/catalog.json`, `tools/soundtrack-catalog.json` ou as declarações `XGM` em `res/resources.res`. **Automática** mantém a seleção padrão do jogo. A escolha fica na propriedade TMX `retroStudio.musicTrack`; salve o mapa para o exportador gerar os metadados da sala. O valor é o ID estável da faixa, não seu título visível. IDs não reconhecidos são informados pelo exportador. A ROM precisa mapear a faixa compilada para sua troca de cena/sala.

O seletor carrega a prévia correspondente automaticamente. O player de áudio nativo permite tocar, pausar, buscar na faixa e ajustar o volume antes de salvar o mapa. As prévias OGG/WAV/MP3 são servidas pelo Retro Studio somente quando pertencem ao workspace aberto; o arquivo é limitado a 16 MB.
