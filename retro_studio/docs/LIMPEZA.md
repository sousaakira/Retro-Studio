# Limpeza do Retro Studio em cenas

O que ainda vem do Godot e o Mega Drive não usa. A lista foi levantada em 01/11/2026, no ramo `retro-studio-cenas`. Cada item diz o que fazer:
- **Remover:** tirar do editor.
- **Esconder:** deixar no código, mas fora da vista (a parte interna do Godot depende dele).
- **Manter:** o Retro Studio usa.

## Já feito

- **Módulos desligados no build** (`retro_studio.py`): 3D, física 2D e 3D, navegação, XR, Vulkan/D3D12/Metal, GDScript, C#, rede e multijogador, vídeo (Theora), compressão de texturas de GPU, importadores 3D (glTF, FBX), CSG, GridMap, ruído, shaders visuais, BMP, JPG, TGA, MP3 e OGG.
  - Sobraram só: freetype e text_server_adv (fontes do editor), svg (ícones), webp (texturas importadas), regex, zip, mbedtls e o `retro_studio`.
- **Criar Node:** mostra só os nodes MD, mais Node, Node2D e AnimationPlayer.
- **Cena nova:** a raiz já é uma MDCena; o botão de interface (Control) sumiu.
- **Telas tiradas:** Game, Asset Store, editor de shaders e de materiais, editores de partículas e de luzes 2D, menu Depurar, barra de rodar do Godot e exportação do Godot (e o template Android).
- **Painéis tirados:** Depurador e barramentos de áudio.
- **Scripts:** anexar script está desligado (a lógica vai em C).

### Passo 1, feito em 01/11/2026

Tudo foi escondido, e nada foi apagado: os valores continuam no `project.godot` e no código.
- **Diálogo "Novo Recurso"** (Sistema de Arquivos e Inspetor): só TileSet, Animation, AnimationLibrary e AtlasTexture. O seletor de cada propriedade (ex.: "Novo TileSet" no MDMapa) continua com a lista dele.
- **Aba Signals:** escondida. A aba Groups fica.
- **Seletor de renderizador** da barra de título: escondido.
- **Configurações do Projeto:**
  - abas Input Map, Localização, Plugins e GDExtension escondidas; em Globais, Autoload e Shader Globals também;
  - na aba Geral, escondidas as seções rendering, audio, gui, input, input_devices, internationalization, physics, navigation, xr, debug, network, threading, memory, compression, layer_names, accessibility e shader_globals;
  - ficam Application (nome, cena principal), Display (tamanho 320×224), Editor, Filesystem e Animation.
- **Menu Ajuda:** "Guia do Retro Studio" (abre o GUIA) no lugar da documentação, do fórum, da comunidade, dos relatos e da doação do Godot. Ficam Buscar na Ajuda (F1), Copiar informações do sistema e Sobre.

Conferido: o Sota compila pelo editor novo, e o `project.godot` mantém a cena principal, o tamanho da tela e o filtro de textura.

### Passo 2, feito em 01/11/2026

Saíram 28 editores de tipos que o jogo não usa (os `add_by_type` em `editor/register_editor_types.cpp`, agora com `#ifndef RETRO_STUDIO`): AnimationTree, AudioStreamRandomizer, BitMap, Control, Curve, DebugAdapterServer, EditorScript, Font, Gradient, GradientTexture2D, InputEvent, MarginContainer, ResourcePreloader, SpriteFrames, StyleBox, SubViewportPreview, Texture3D, TextureLayered, Theme, ToolButton, VirtualJoystick, Camera2D, Line2D, Path2D, Polygon2D, Skeleton2D, Sprite2D e ParallaxBackground.

- **Antes:** conferido que nem o módulo `retro_studio` nem os editores que ficam (TileSet, TileMap, AnimationPlayer, a vista 2D) usam essas classes.
- **Depois:**
  - o editor abre sem erros novos e o executável caiu de 121,2 MB para 118,9 MB;
  - o Sota e o jogo padrão compilam;
  - a MDColisao abre o painel TileMap;
  - o AnimationPlayer do `fim.tscn` mostra as trilhas no painel Animation;
  - um MDSprite selecionado mostra as propriedades e as alças de mover.

### Passo 3, feito em 01/11/2026

Também só escondido, nada apagado:
- **Configurações do Editor:** saíram as seções Asset Store, Depurador, Exportação, Rede, Rodar e Controle de Versão; em Editores, 3D, Gizmos 3D, GridMap, editor de shaders, editores visuais, mapeador de ossos e barramentos de áudio.
  - Ficam Interface, Sistema de Arquivos, Editor de Texto (cores do código C), Editores 2D, Panning, Tiles Editor, Polygon Editor (as colisões do TileSet), Animation, Input, Gerenciador de Projetos e Retro Studio.
  - O `SectionedInspector` agora aceita esconder uma subseção (`editors/3d`), além da seção inteira.
- **"Novo Script…":** fora do menu "Criar Novo" e dos menus de clique direito do Sistema de Arquivos, e do menu Arquivo do editor de código (com os atalhos). O código C nasce por "Arquivo de Texto…" ou por "Criar código do ator".
- **Projeto → Ferramentas:** saiu "Configuração de compilação do motor". Ficam o explorador de recursos órfãos e "Atualizar projeto".
- **Gerenciador de projetos:** a escolha de renderizador já estava escondida.

Conferido:
- o editor abre só com o erro antigo (`p_which = 0`);
- as Configurações do Editor mostram as seções certas, inclusive no modo avançado;
- o "Criar Novo" do Sistema de Arquivos mostra Pasta, Cena, Recurso e Arquivo de Texto;
- o Sota e o jogo padrão compilam.

### Passo 4, feito em 01/11/2026

- **Menus** (só escondidos):
  - Cena: "Exportar como…" (só tinha a exportação de MeshLibrary, do 3D). O submenu continua existindo, fora da vista, para quem chama `get_export_as_menu`.
  - Projeto: Controle de Versão, Empacotar como ZIP e Abrir pasta de dados do usuário. O menu ficou: Configurações do Projeto, Buscar nos Arquivos, Ferramentas, Recarregar e Voltar à lista.
  - Editor: Gerenciar recursos do editor (perfis) e Configurar importador FBX.
- **Painel Import das imagens:** some tudo de compressão de GPU, mipmaps, normal map, HDR, canais e limite de tamanho, e o botão Preset (o preset "3D" ligaria a compressão de GPU e mudaria as cores que o editor conta). Fica só "Importar como" e "Reimportar". Os valores continuam no `.import` (`compress/mode=0`, sem perdas).
- **Inspetor dos nodes MD:** já escondia as propriedades do CanvasItem e do Node que o build não lê (`RetroMD::hide_unsupported`); nada a fazer.

Conferido na tela de teste:
- os menus Cena, Projeto (com Ferramentas), Editor e Ajuda mostram só o que ficou, inclusive os itens dos passos 1 e 3;
- o painel Import de um PNG mostra só "Importar como";
- o editor abre só com o erro antigo, e o Sota e o jogo padrão compilam.

Dica para testar na tela virtual: os menus da barra só abrem se o mouse passar por cima antes do clique.

## Ainda presente

### Editores de tipos que o jogo não usa (remover)

Ficam no `editor/register_editor_types.cpp`. Só abrem ao editar um recurso desses, mas pesam no editor e aparecem em menus.

| Editor | Por que não serve |
|---|---|
| AnimationTreeEditorPlugin | O build só lê o AnimationPlayer. |
| SpriteFramesEditorPlugin (AnimatedSprite2D) | As animações ficam no gestor de animações (MDPersonagem). |
| ThemeEditorPlugin, StyleBoxEditorPlugin, FontEditorPlugin | Temas de interface do Godot; o jogo usa a fonte do SGDK. |
| ControlEditorPlugin, MarginContainerEditorPlugin, ToolButtonEditorPlugin, VirtualJoystickEditorPlugin | Interface (Control) não vira código do SGDK. |
| Skeleton2DEditorPlugin, Polygon2DEditorPlugin, Line2DEditorPlugin, Path2DEditorPlugin, Camera2DEditorPlugin, ParallaxBackgroundEditorPlugin | Nodes 2D do Godot sem equivalente no Mega Drive (a câmera é a MDCamera, o parallax é a rolagem do MDFundo). |
| Sprite2DEditorPlugin | Converte sprite em polígono ou malha (para física e luz). |
| GradientEditorPlugin, GradientTexture2DEditorPlugin, CurveEditorPlugin | Recursos de renderização do Godot. |
| Texture3DEditorPlugin, TextureLayeredEditorPlugin, BitMapEditorPlugin | Texturas 3D e em camadas, máscara de bits. |
| AudioStreamRandomizerEditorPlugin | O som do console é XGM e WAV. |
| ResourcePreloaderEditorPlugin, SubViewportPreviewEditorPlugin, InputEventEditorPlugin | Coisas de jogos que rodam no Godot. |
| DebugAdapterServer, EditorScriptPlugin | Depuração e scripts de GDScript (desligado). |

**Manter:** CanvasItem (a vista 2D), TileMap, TileSet, AnimationPlayer e as trilhas, PackedScene, Texture (prévia de imagens), AudioStream (prévia de VGM e WAV), Script (editor de código C) e ScenePaint2D (pintura na cena).

### Nós e recursos compilados que o build ignora (esconder ou remover do build)

Os nodes já estão fora do Criar Node, mas continuam no editor:
- **Node2D:** AnimatedSprite2D, AudioListener2D, AudioStreamPlayer2D, BackBufferCopy, Bone2D, CPUParticles2D, GPUParticles2D, Camera2D, CanvasGroup, CanvasModulate, Light2D, DirectionalLight2D, PointLight2D, LightOccluder2D, Line2D, Marker2D, MeshInstance2D, MultiMeshInstance2D, Parallax2D, ParallaxLayer, Path2D, PathFollow2D, Polygon2D, RemoteTransform2D, Skeleton2D, TileMap (antigo), VisibleOnScreenEnabler2D, VisibleOnScreenNotifier2D.
- **Outros:** AnimationTree, CanvasLayer, ParallaxBackground, HTTPRequest, Timer, ResourcePreloader, ShaderGlobalsOverride, SubViewport, VideoStreamPlayer, StatusIndicator.
- **Recursos (198 tipos):** materiais, shaders, Environment, Compositor, malhas, efeitos de áudio, nós de AnimationTree, temas, StyleBox, Gradient, Curve, texturas 3D…

O que fazer:
- **Esconder no diálogo "Novo Recurso"** (no Inspetor, ao criar um recurso). Hoje ele lista os 198 tipos. Deixaria só: TileSet, Animation, AnimationLibrary, MDPersonagem, AudioStreamVGM, AudioStreamWAV, AtlasTexture e ImageTexture.
- **Opcional: perfil de build** (`build_profile` do SCons) para tirar as classes do executável e deixá-lo menor. Tem risco: o editor do Godot usa várias delas por dentro (os Control da própria interface não podem sair). Testar uma por uma.

### Telas, painéis e menus (esconder)

| Onde | O que | Por quê |
|---|---|---|
| Painel ao lado do Inspetor | Aba **Signals** | Sinais ligam funções de GDScript; não há script. A aba **Groups** fica (os grupos viram `GRUPO_` dos atores). |
| Barra de título | Seletor de renderizador (Compatibility/Forward+) | O editor desenha só com OpenGL; o jogo não usa renderizador. |
| Projeto → Configurações do Projeto | Seções Rendering, Physics, Navigation, XR, Audio (barramentos), Input Map, Autoload, Globals de shader, Localização, Plugins, GDExtension | Nada disso vai para a ROM. Ficam: Application (cena principal, nome), Display (tamanho da janela de prévia) e Retro Studio. |
| Editor → Configurações do Editor | Seções 3D, editor de shaders, Network/Debug, Version Control, exportação | Não se aplicam. |
| Projeto → Ferramentas | Orphan Resource Explorer, Upgrade Mesh Surfaces, configuração de compilação do motor | Ferramentas de jogos Godot e 3D. Ficam as do Retro Studio. |
| Projeto | Version Control, Pack Project as ZIP, "Recarregar projeto atual" | Avaliar: o controle de versão do Godot não é o git do Retro Studio. |
| Editor | Gerenciar recursos do editor (perfis), Abrir pasta de dados do editor | Avaliar. |
| Ajuda | Links da documentação, Q&A, fórum e doação do Godot | Trocar por links do Retro Studio e pelo GUIA. |
| Gerenciador de projetos | Escolha de renderizador e abas de modelos/Asset Library | O projeto novo já vem pronto para o Mega Drive. |

### Arquivos e formatos (avaliar)

- **Sistema de arquivos:** ainda mostra e oferece criar `.gd`, `.gdshader`, `.tres` de tema e materiais. Esconder do menu "Criar Novo" o que não serve.
- **Importação de imagens:** as opções de compressão de GPU, mipmaps e normal map não se aplicam (o rescomp lê o PNG). O painel Importar pode mostrar só o que importa.
- **Cache:** `.godot/` e os `.import`/`.uid` são do editor; ficam fora do git do jogo (já estão no `.gitignore` do modelo).

## Ordem sugerida

1. **Primeiro, o que confunde quem usa:**
   - diálogo Novo Recurso enxuto;
   - aba Signals;
   - seções das Configurações do Projeto;
   - menu Ajuda;
   - seletor de renderizador.
2. **Depois, os editores de tipos não usados** (a tabela acima). Basta tirar os `add_by_type` com `#ifndef RETRO_STUDIO`, como já foi feito com shaders e partículas.
3. **Por último, e com testes:** o perfil de build para tirar as classes do executável.
