# Retro Studio - Visual Editor (Godot-style)

## Visão Geral

O Retro Studio agora inclui um editor visual estilo Godot para desenvolvimento de jogos Mega Drive/Genesis. Este editor permite criar cenas visualmente, similar ao Godot Engine, mas focado nas especificidades do hardware Mega Drive.

## Funcionalidades Implementadas

### ✅ Sistema de Cenas (Scene Graph)
- Criação e gerenciamento de nós (nodes) na cena
- Hierarquia de cenas similar ao Godot
- Suporte para diferentes tipos de nós: sprites, tiles, entities, backgrounds, etc.

### ✅ Viewport/Canvas
- Visualização da área de jogo (320x224 pixels - resolução Mega Drive)
- Ferramentas de edição:
  - **Select Tool (Q)**: Selecionar nós
  - **Move Tool (W)**: Mover viewport
  - **Sprite Tool (S)**: Adicionar sprites
  - **Tile Tool (T)**: Adicionar tiles
- Zoom in/out com mouse wheel
- Grid com snap (8x8, 16x16, etc)
- Visualização de área de jogo com borda

### ✅ Inspector Panel
- Edição de propriedades dos nós selecionados
- Propriedades por tipo:
  - **Transform**: Posição (X, Y), Tamanho (Width, Height)
  - **Sprite**: Recurso de sprite, paleta, prioridade
  - **Tile**: Índice do tile, tilemap
  - **Custom Properties**: Propriedades personalizadas

### ✅ Scene Hierarchy
- Árvore de nós da cena
- Seleção de nós
- Adicionar/remover nós
- Expansão/colapso de nós

### ✅ Resources Panel
- Gerenciamento de recursos:
  - **Sprites**: Imagens para sprites
  - **Tiles**: Tiles 8x8
  - **Tilemaps**: Mapas de tiles
  - **Palettes**: Paletas de cores (16 cores por paleta - Mega Drive)
  - **Sounds**: Sons e música
- Visualização de recursos
- Adicionar novos recursos

## Como Usar

### Alternar entre Modo Código e Visual

1. **Modo Visual**: Clique no botão "Visual" na toolbar ou pressione `Ctrl+Tab`
2. **Modo Código**: Clique no botão "Code" na toolbar

### Criar uma Cena

1. Entre no modo Visual
2. Use as ferramentas na toolbar do viewport:
   - **Sprite Tool (S)**: Clique no viewport para adicionar um sprite
   - **Tile Tool (T)**: Clique no viewport para adicionar um tile
3. Selecione o nó criado para editar suas propriedades no Inspector

### Editar Propriedades

1. Selecione um nó no viewport ou na hierarquia
2. Edite as propriedades no painel Inspector à direita
3. As mudanças são aplicadas em tempo real

### Adicionar Recursos

1. No painel Resources (esquerda), clique no botão "+"
2. Selecione o tipo de recurso (Sprite, Tile, Tilemap, Palette, Sound)
3. Digite o nome do recurso
4. O recurso será adicionado e poderá ser usado nos nós

### Salvar Cena

- Pressione `Ctrl+S` ou clique no botão de salvar
- A cena será salva como arquivo JSON em `scenes/` do projeto

### Exportar para Código

- Ao executar o jogo (F5), a cena é automaticamente exportada para código C
- O código gerado é salvo em `src/scene_[nome].c`

## Atalhos de Teclado

- **Q**: Select Tool
- **W**: Move Tool
- **S**: Sprite Tool
- **T**: Tile Tool
- **Ctrl+S**: Salvar cena
- **F5**: Executar jogo
- **Ctrl+Tab**: Alternar entre modo código/visual
- **Delete/Backspace**: Remover nó selecionado

## Estrutura de Dados

### Cena (Scene)
```json
{
  "name": "Main Scene",
  "nodes": [
    {
      "id": "node_123",
      "type": "sprite",
      "name": "Player",
      "x": 160,
      "y": 112,
      "width": 16,
      "height": 16,
      "properties": {
        "spriteId": "sprite_1",
        "paletteId": "0",
        "priority": 0
      }
    }
  ],
  "resources": {
    "sprites": [...],
    "tiles": [...],
    "palettes": [...]
  }
}
```

## Próximos Passos

### 🚧 Em Desenvolvimento
- Editor de tiles/sprites visual
- Preview/emulação integrada
- Sistema completo de paletas Mega Drive
- Exportação mais completa para código SGDK
- Suporte para animações
- Sistema de física básico
- Editor de tilemaps

### 💡 Ideias Futuras
- Sistema de scripts visual (similar ao GDScript)
- Editor de animações
- Sistema de partículas
- Editor de sons integrado
- Suporte para múltiplas cenas
- Sistema de prefabs/instâncias

## Contribuindo

Este é um projeto em desenvolvimento ativo. Contribuições são bem-vindas!

## Licença

Mesma licença do projeto principal.
