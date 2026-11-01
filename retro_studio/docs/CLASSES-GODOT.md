# Classes do Godot no Retro Studio

Levantamento de 01/11/2026, no ramo `retro-studio-cenas` (commit `739a2400f2`), para saber quais classes do Godot compiladas no editor o Retro Studio usa. Ele serve para decidir o perfil de build (veja `LIMPEZA.md`).

## Resultado

O executável tem **590 classes**:

| Grupo | Classes | O que significa |
|---|---|---|
| Usadas pelos projetos | 24 | Aparecem nas cenas e recursos do Sota, do jogo padrão e do modelo. |
| Usadas pelo código do editor ou do motor | 513 | Alguma parte ativa do editor, do motor ou do módulo `retro_studio` cita a classe. |
| Sem uso | 52 | Ninguém usa (mais a pseudoclasse `@GlobalScope`, que não conta). |

**Conclusão:** o espaço para tirar classes é pequeno. Só 52 classes, perto de 9%, não fazem falta, e quase todas são pequenas. As outras 513 são do editor por dentro: a interface, os temas, os temporizadores, as janelas e a renderização. Tirar uma delas exige mexer no código que a usa.

### Usadas pelos projetos (24)

Animation, AnimationLibrary, AnimationPlayer, Image, ImageTexture, Texture2D, TileSet, TileSetAtlasSource e os nodes e recursos do Retro Studio: MDAtor, MDCena, MDColisao, MDCorrenteza, MDFundo, MDInimigo, MDItem, MDJogador, MDMapa, MDPersonagem, MDPlataforma, MDPrioridade, MDRetorno, MDSaida, MDSprite e MDTexto.

### Sem uso (52)

- **Nodes (16):** BackBufferCopy, CanvasModulate, Marker2D, MeshInstance2D, MultiMeshInstance2D, Parallax2D, ParallaxBackground, ParallaxLayer, Path2D, PathFollow2D, ReferenceRect, RemoteTransform2D, ResourcePreloader, ShaderGlobalsOverride, StatusIndicator, VideoStreamPlayer.
- **Recursos (14):** AnimationNodeExtension, AudioEffectSpectrumAnalyzer, AudioStreamGenerator, BlitMaterial, DrawableTexture2D, PackedDataContainer, ScriptExtension, os cinco SkeletonModification2D (CCDIK, FABRIK, LookAt, StackHolder, TwoBoneIK), VideoStream, VideoStreamPlayback.
- **RefCounted (16):** AStar2D, AStar3D, AStarGrid2D, AudioEffectSpectrumAnalyzerInstance, AudioStreamGeneratorPlayback, EditorExportPlatformAppleEmbedded, EditorExportPlatformExtension, JavaClass, JavaObject, JavaScriptObject, MeshDataTool, PCKPacker, PackedDataContainerRef, RenderSceneBuffersExtension, ZIPPacker, ZIPReader.
- **Object (6):** JNISingleton, JavaClassWrapper, JavaScriptBridge, RenderDataExtension, RenderSceneDataExtension, ScriptLanguageExtension.

### Nodes 2D que o jogo não usa, mas o editor cita

Estes já estão fora do Criar Node, mas o código ativo os usa. Por isso não dá para desligá-los só pelo perfil de build:

| Classe | Quem usa |
|---|---|
| Camera2D | `scene/main/viewport.cpp` (a câmera de qualquer Viewport) e o depurador de cena. |
| Sprite2D | É a base do MDSprite e do MDFundo; também o editor de região de textura e o `retro_sgdk_export.cpp`. |
| TileMap (antigo) | O editor de TileSet e de TileMapLayer, e o `retro_colisao_inspector.cpp`. |
| PointLight2D, DirectionalLight2D, Light2D | `servers/rendering/renderer_viewport.cpp` e a vista 2D. Light2D e LightOccluder2D ficam por serem pais ou vizinhos de arquivo delas. |
| CPUParticles2D, GPUParticles2D | A vista 2D e o Inspetor (conversões entre os dois). |
| AnimatedSprite2D | As trilhas do AnimationPlayer e o `retro_animation_editor.cpp`. |
| AudioStreamPlayer2D, AudioListener2D | As trilhas de áudio, o painel da cena e o Viewport. |
| Line2D | `scene/gui/graph_edit.cpp` (as ligações dos editores de grafo). |
| Polygon2D, Skeleton2D, Bone2D | A vista 2D (menu de ossos, já escondido) e as modificações de esqueleto. |
| CanvasGroup | `scene/main/canvas_item.cpp` e a renderização 2D. |
| VisibleOnScreenNotifier2D e Enabler2D | `scene/resources/world_2d.h`. |

Outras usadas por todo o editor: Timer (71 arquivos), Theme (78), StyleBoxFlat (28), Curve (26), Gradient (20), ShaderMaterial (30), SubViewport (16), AnimationTree (16), CanvasLayer (10) e HTTPRequest (a verificação de atualização do gerenciador de projetos, a biblioteca de assets e os modelos de exportação).

## Como foi feito

Os dois scripts estão em `retro_studio/ferramentas/`:

1. `classes_uso.py <repo> <doctool> <saida.json> <projetos>…` (uns 10 minutos):
   - **classes:** a lista vem do próprio executável (`--headless --doctool <pasta>`), com a herança de cada uma;
   - **código:** entram os fontes que compilam (`core`, `scene`, `servers`, `editor`, `main`, `drivers`, `platform/linuxbsd` e os módulos ligados em `modules_enabled.gen.h`), sem testes, `thirdparty`, documentação e comentários;
   - **o que não conta como uso:** os arquivos da própria classe (onde está o `GDCLASS`), os `register_*types.cpp` e os arquivos dos editores tirados com `#ifndef RETRO_STUDIO` no `register_editor_types.cpp`;
   - **projetos:** os `type="…"` dos `.tscn` e `.tres`.
2. `classes_resumo.py <classes_uso.json> <repo> <saida.json>`:
   - também não contam as tabelas de nomes do conversor do Godot 3 para o 4 (`editor/project_upgrade/`) e de compatibilidade do GDExtension;
   - uma citação só conta se vier de um arquivo cujas classes não estejam todas sem uso; repete até parar de mudar;
   - a classe declarada no mesmo arquivo que uma usada fica, e o pai de uma classe usada também fica.

**Limites:**
- **O erro é para o lado seguro:** uma citação num código que nunca roda conta como uso. Por exemplo, a biblioteca de assets está escondida, mas o código dela compila e cita HTTPRequest.
- **A segunda camada fica de fora:** classes citadas só por partes do editor que o Retro Studio já escondeu (biblioteca de assets, editores do AnimationTree, exportação) poderiam sair também. Isso exigiria tirar ou desligar esse código antes, com teste de cada tela.
- **Nomes montados em tempo de execução escapam:** quem chama `ClassDB::instantiate` com um nome montado em tempo de execução não é visto. É raro no editor.

## Recomendação

- **Desligar as 52 sem uso** pelo perfil de build é seguro pelo levantamento, mas ganha pouco: são classes pequenas, e o executável deve encolher pouco (não medido). Cada tentativa recompila o editor inteiro (perto de uma hora). Só vale junto com outra recompilação completa.
- **As 513 usadas pelo código** ficam. Tirá-las exigiria remover partes do editor (a biblioteca de assets, os editores do AnimationTree, a exportação), o que dá mais trabalho e risco do que ganho.
