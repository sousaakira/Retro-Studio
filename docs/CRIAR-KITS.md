
Kits podem incluir um catálogo `visualAssets` com recortes nomeados e separados por categoria. Na aba **Objetos**, escolha **Assets do kit** para ver somente as opções daquela categoria; assets animados têm filtro próprio e já preenchem região, quadros e FPS. Para cadastrar outro sprite ou ciclo, abra **Grade completa**, escolha a tileset/região, ajuste tamanho e animação, informe nome e categoria e use **Salvar recorte no catálogo**. Ao salvar/compartilhar o kit, as imagens referenciadas são copiadas para uma subpasta junto ao JSON, mantendo o kit portátil. O exportador do jogo gera em `res` os recursos que a ROM utiliza; a imagem de prévia do editor fica nos arquivos do kit.

### Editar uma animação na folha de sprites

Na aba **Objetos**, selecione o modelo e abra **Folha de sprites** em Aparência. A folha é exibida como uma imagem contínua, sem espaços entre tiles. Escolha o tamanho do quadro em pixels (por exemplo, 64×48 para Alice), clique na primeira pose da linha e ajuste a quantidade de quadros. A sequência atual continua sendo horizontal e limitada a 16 quadros.

Use **Desenhar recorte** para arrastar um retângulo sobre a imagem, ajustado a 8 pixels. As setas movem a seleção por quadro; Shift + seta ajusta um tile. O zoom vai de 1× a 4× e a área da folha pode ser redimensionada verticalmente. A faixa de miniaturas permite examinar cada quadro; a prévia maior tem reprodução manual, FPS e repetição. A reprodução fica parada ao abrir ou mudar a seleção.

Para reutilizar a sequência, informe um nome e use **Salvar recorte no catálogo**. Para gravar a aparência do modelo, use **Atualizar modelo** (ou adicionar o novo modelo) e depois salve o kit.
