# Editor de mapas

## Kits recentes e mapas do kit

O painel **Kits recentes** mantém os oito últimos kits usados. Clique em um kit para carregá-lo com seus tilesets, peças e objetos; use **×** para removê-lo da lista ou **Limpar** para apagar o histórico local. A lista fica salva no Retro Studio e não altera os arquivos do projeto.

## Abrir exemplos de um kit

Cada kit possui a pasta `maps/` para os mapas criados com ele. O editor cria essa pasta quando o kit é carregado ou salvo; ao usar **Salvar como** com um kit ativo, ela é o destino inicial. A seção **Mapas deste kit** lista os TMX/JSON encontrados no kit, incluindo essa pasta. O arquivo JSON do kit não aparece como mapa. Quando houver um TMX e um JSON com o mesmo nome, a lista mostra o TMX. Clique em um mapa para abri-lo com o kit associado.

Mapas abertos a partir de um kit também entram na lista de recentes.

## Plano de fundo

Na seção **Plano de fundo** da barra lateral, escolha um PNG/JPG do projeto. O editor exibe a imagem atrás das camadas BG/FG e permite ajustar o encaixe (**Preencher**, **Conter** ou **Esticar**) e a opacidade. A referência relativa da imagem e esses ajustes são salvos como propriedades TMX do Retro Studio; imagens não são incorporadas ao arquivo. Mantenha a imagem junto ao projeto para que o mapa continue portátil. Essa visualização é uma referência de autoria: cada jogo ainda precisa implementar o carregamento/renderização do plano de fundo no runtime.

### Camadas de parallax

No painel Plano de fundo, use **Camada** para adicionar até oito imagens de parallax. Ajuste as velocidades horizontal e vertical (0 = fixa; 1 = acompanha a câmera como o mapa), opacidade e ordem de desenho. O canvas repete as imagens panorâmicas e atualiza a prévia quando a área de trabalho é rolada. As camadas são salvas na propriedade `retroStudio.parallaxLayers` do TMX, com caminhos relativos, fatores de velocidade e opacidade. Isso preserva os dados para o exportador/runtime de cada jogo; gravar o TMX, por si só, não adiciona renderização de parallax a uma ROM.

As áreas da sidebar podem ser recolhidas para reduzir a rolagem. A biblioteca, plano de fundo/parallax, tilesets, paleta, dimensões e stamps ficam em seções separadas; a paleta começa aberta durante a edição.

## Criar objetos visuais e animados

O botão **Criar kit** / **Editar kit** abre um modal amplo com abas para identidade, terreno e peças, objetos e salvamento. Na aba **Objetos**, escolha uma categoria (cenário, itens, inimigos, interações ou marcadores), crie um modelo e selecione a imagem e o tile inicial visualmente. O painel mostra a prévia do recorte; dimensões, tipo e propriedades de gameplay são configurados separadamente para que dados como `item: health` sejam preservados.

Defina a largura e altura da região visual em tiles. Para animar, selecione quadros consecutivos na horizontal e configure a quantidade de quadros, velocidade e repetição. A prévia pode ser pausada; segue `prefers-reduced-motion`. Os kits antigos sem categoria ou asset visual continuam válidos e seus objetos aparecem como marcadores.

Na biblioteca lateral, os modelos aparecem agrupados por categoria e com miniaturas. Ao posicionar um modelo com visual, o canvas desenha o recorte e mantém os limites selecionáveis para edição. O TMX salva a referência visual como propriedade `retroStudio.visual`, separada das propriedades de gameplay.

O preview do editor não exporta sozinho sprites ou lógica para a ROM. O runtime do jogo precisa interpretar `retroStudio.visual`, carregar o tileset correspondente e reproduzir a animação; até isso ser implementado no runtime, essa funcionalidade serve à autoria e visualização do mapa no Retro Studio.
