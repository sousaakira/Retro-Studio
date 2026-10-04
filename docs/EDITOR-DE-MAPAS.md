# Editor de mapas

## Abrir mapas recentes

O painel **Mapas recentes** na biblioteca lateral mantém os oito últimos arquivos TMX/JSON abertos. Clique no nome para reabrir sem navegar pelas pastas; use **×** para remover um item ou **Limpar** para apagar a lista. A lista fica salva localmente no Retro Studio e não altera os arquivos do projeto.

## Abrir exemplos de um kit

Depois de importar um kit, a seção **Mapas deste kit** mostra os mapas TMX/JSON encontrados na pasta do kit e nas subpastas. O arquivo JSON usado para descrever o kit não aparece na lista. Quando houver um TMX e um JSON com o mesmo nome, a lista mostra o TMX. Clique em um item para abri-lo diretamente no editor; a pasta e o nome continuam visíveis na barra de título.

Mapas abertos a partir de um kit também entram na lista de recentes.

## Plano de fundo

Na seção **Plano de fundo** da barra lateral, escolha um PNG/JPG do projeto. O editor exibe a imagem atrás das camadas BG/FG e permite ajustar o encaixe (**Preencher**, **Conter** ou **Esticar**) e a opacidade. A referência relativa da imagem e esses ajustes são salvos como propriedades TMX do Retro Studio; imagens não são incorporadas ao arquivo. Mantenha a imagem junto ao projeto para que o mapa continue portátil. Essa visualização é uma referência de autoria: cada jogo ainda precisa implementar o carregamento/renderização do plano de fundo no runtime.
