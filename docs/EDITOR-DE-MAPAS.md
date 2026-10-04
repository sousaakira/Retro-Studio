# Editor de mapas

## Abrir mapas recentes

O painel **Mapas recentes** na biblioteca lateral mantém os oito últimos arquivos TMX/JSON abertos. Clique no nome para reabrir sem navegar pelas pastas; use **×** para remover um item ou **Limpar** para apagar a lista. A lista fica salva localmente no Retro Studio e não altera os arquivos do projeto.

## Abrir exemplos de um kit

Depois de importar um kit, a seção **Mapas deste kit** mostra os mapas TMX/JSON encontrados na pasta do kit e nas subpastas. O arquivo JSON usado para descrever o kit não aparece na lista. Quando houver um TMX e um JSON com o mesmo nome, a lista mostra o TMX. Clique em um item para abri-lo diretamente no editor; a pasta e o nome continuam visíveis na barra de título.

Mapas abertos a partir de um kit também entram na lista de recentes.

## Plano de fundo

Na seção **Plano de fundo** da barra lateral, escolha um PNG/JPG do projeto. O editor exibe a imagem atrás das camadas BG/FG e permite ajustar o encaixe (**Preencher**, **Conter** ou **Esticar**) e a opacidade. A referência relativa da imagem e esses ajustes são salvos como propriedades TMX do Retro Studio; imagens não são incorporadas ao arquivo. Mantenha a imagem junto ao projeto para que o mapa continue portátil. Essa visualização é uma referência de autoria: cada jogo ainda precisa implementar o carregamento/renderização do plano de fundo no runtime.

## Criar objetos visuais e animados

O botão **Criar kit** / **Editar kit** abre um modal amplo com abas para identidade, terreno e peças, objetos e salvamento. Na aba **Objetos**, escolha uma categoria (cenário, itens, inimigos, interações ou marcadores), crie um modelo e selecione a imagem e o tile inicial visualmente. O painel mostra a prévia do recorte; dimensões, tipo e propriedades de gameplay são configurados separadamente para que dados como `item: health` sejam preservados.

Defina a largura e altura da região visual em tiles. Para animar, selecione quadros consecutivos na horizontal e configure a quantidade de quadros, velocidade e repetição. A prévia pode ser pausada; segue `prefers-reduced-motion`. Os kits antigos sem categoria ou asset visual continuam válidos e seus objetos aparecem como marcadores.

Na biblioteca lateral, os modelos aparecem agrupados por categoria e com miniaturas. Ao posicionar um modelo com visual, o canvas desenha o recorte e mantém os limites selecionáveis para edição. O TMX salva a referência visual como propriedade `retroStudio.visual`, separada das propriedades de gameplay.

O preview do editor não exporta sozinho sprites ou lógica para a ROM. O runtime do jogo precisa interpretar `retroStudio.visual`, carregar o tileset correspondente e reproduzir a animação; até isso ser implementado no runtime, essa funcionalidade serve à autoria e visualização do mapa no Retro Studio.
