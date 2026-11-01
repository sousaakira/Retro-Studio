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

**Correção depois do passo 2:** arrastar a alça da caixa de um MDAtor (redimensionar) fechava o editor. O redimensionamento perguntava pelo modo de âncoras ao `ControlEditorToolbar`, que só existe com o editor de Control, tirado no passo 2. Agora a pergunta aceita a barra ausente. E os nodes MD não mostram mais as alças de redimensionar: elas mudavam a escala, e o Mega Drive não escala sprites. Antes de tirar outro editor, procurar quem usa o `get_singleton()` dele.

Dica para testar na tela virtual: os menus da barra só abrem se o mouse passar por cima antes do clique.

### Passo 5, feito em 01/11/2026

- **Barra da vista 2D:** escondidas as ferramentas Girar (E), Escala (R) e Pivô e o menu de Esqueleto (ossos 2D). O Mega Drive não gira nem escala sprites (o build recusa) e não tem ossos. Os botões continuam existindo, sem atalho, porque o editor os usa por dentro. De quebra, a barra cabe numa linha só, e o "Criar ossos" deixou de disputar o Ctrl+Shift+B com as Versões para teste.
- **Chaves do AnimationPlayer pela vista 2D:** as máscaras de rotação e de escala saíram, e a de rotação, que vinha ligada, foi desligada. A chave inserida grava só a posição.

Conferido: a barra sem os botões, a barra de chaves no `fim.tscn` só com posição, a cena sem mudanças, o editor sem erros novos, e o Sota e o jogo padrão compilam.

### Passo 6, feito em 01/11/2026: o nome

O nome "Godot" saiu do que aparece para quem usa:
- **Mensagens do editor e do gerenciador de projetos** (43 linhas): "About Retro Studio…", "Files have been modified outside Retro Studio", os avisos de versão do projeto, os títulos de janela etc. O conversor de projetos antigos fala em "formato 3.x para o 4.x".
- **Logos:** `Godot.svg`, `GodotMonochrome.svg`, `GodotFile.svg` e `Logo.svg` (menu Ajuda, lista de projetos, janela Sobre) passaram a ter o desenho do Retro Studio. Os nomes dos arquivos continuam, porque o código os procura por esse nome.
- **Janela no Linux:** classe `retro-studio` (X11) e app id `retro-studio` (Wayland), o mesmo nome do atalho; o `instalar.sh` grava `StartupWMClass=retro-studio`, para a barra de tarefas mostrar o ícone certo.
- **Site** (`version.py`): o repositório do Retro Studio no GitHub, no lugar de godotengine.org.
- **Janela Sobre:** "About Retro Studio", com "Based on the Godot Engine". As abas de autores e doadores do Godot ficaram escondidas, porque os títulos ("Project Founders", "Lead Developer") pareceriam do Retro Studio.

**Ficou de propósito:**
- **O copyright e a licença MIT do Godot,** no cabeçalho e nas abas de licença do Sobre. A licença exige que fiquem.
- **"Godot 2" nos avisos de tema do editor de código:** é o nome de um tema de cores que já existe nas configurações.
- **Nomes internos:** o `short_name` (pastas de configuração), as classes e os arquivos do código. (O `project.godot` e a pasta `.godot/` mudaram depois: veja o passo 7.) Trocar quebraria os projetos e as configurações.
- **A ajuda das classes (F1):** é o texto da documentação do Godot, com milhares de menções.

### Passo 7, feito em 01/11/2026: arquivo do projeto e pasta do editor

- **Arquivo do projeto:** `projeto.retro`, no lugar do `project.godot`. **Pasta do editor:** `.retro-studio/`, no lugar da `.godot/`.
- Os nomes ficam em constantes do `ProjectSettings` (`PROJECT_FILE_NAME`, `PROJECT_DATA_DIR_NAME_SUFFIX`); o código usa as constantes.
- **Projeto antigo:** ao abrir, o `project.godot` é renomeado para `projeto.retro` e a `.godot/` para `.retro-studio/` (`ProjectSettings::migrate_project_files`). As abas abertas e as configurações do editor vêm junto; as imagens são reimportadas uma vez, porque os `.import` apontavam para a pasta antiga. O gerenciador de projetos reconhece os dois nomes (lista, importar, escanear, ZIP).
- Projeto novo: `projeto.retro` e `.gitignore` com `.retro-studio/`. O modelo `jogo_padrao` foi renomeado.

Conferido numa cópia do Sota com os nomes antigos: a migração renomeou os dois, as imagens foram reimportadas, o build terminou em "ROM pronta" e a ROM ficou idêntica byte a byte à de antes da migração.

## Ainda presente

### Perfil de build (opcional, não recomendado agora)

O levantamento das classes está em `CLASSES-GODOT.md`: das 590 classes do executável, 24 são usadas pelos projetos, 513 pelo código do editor ou do motor e só 52 não têm uso.

O `build_profile` do SCons (um JSON com `disabled_classes`) deixa classes fora do executável. Nesta versão do Godot, ele marca a classe como desligada (`is_class_enabled<Classe>` falso), e ela deixa de ser registrada; o código continua compilado onde alguém o usa. Por isso:
- **Ganho pequeno:** o executável encolhe pouco, porque o editor ainda referencia a maior parte dessas classes.
- **Risco alto:** o editor cria várias delas por dentro (os Control da própria interface, temas, StyleBox, Curve, Gradient…). Uma classe desligada que o editor procura pelo nome quebra a tela que a usa.
- **Custo:** o arquivo gerado entra no núcleo, e cada tentativa recompila o editor inteiro.

O que o usuário via já está escondido (passos 1 a 5). Se um dia valer a pena, começar só pelos nodes 2D que ninguém cria (luzes 2D, partículas, Line2D, Path2D, Skeleton2D, Parallax), uma classe por vez, abrindo o editor e as telas depois de cada uma.

### Arquivos e formatos

- `.gdshader` e `.tres` de tema e de material só aparecem no Sistema de Arquivos se existirem no projeto; os projetos do Retro Studio não têm. Nada a fazer por enquanto.
- **Cache:** `.retro-studio/` e os `.import`/`.uid` são do editor e ficam fora do git do jogo (já estão no `.gitignore` do modelo).
