# 🎮 SGDK Autocomplete e Snippets - Guia Rápido

## ✨ O que foi adicionado?

O Retro Studio agora tem **autocomplete, sugestões de código e snippets** para **SGDK**! Tudo baseado nas funções reais do SGDK para Mega Drive.

---

## 📚 Como Usar

### 1️⃣ **Autocomplete de Funções**
Comece a digitar uma função SGDK e veja as sugestões aparecer:

```c
VDP_  // Mostra todas as funções VDP
SPR_  // Mostra todas as funções de sprite
JOY_  // Mostra funções de input
MEM_  // Mostra funções de memória
```

**Tecla de atalho:** `Ctrl+Space` para forçar autocomplete

### 2️⃣ **Tipos de Dados**
Ao digitar tipos, veja todas as opções:

```c
u16 score;    // Unsigned 16-bit
s32 position; // Signed 32-bit
fix16 velocity; // Fixed-point
```

### 3️⃣ **Constantes**
Autocomplete também funciona para constantes:

```c
VDP_PLANE_A   // Plano A
BUTTON_A      // Botão A do controle
BUTTON_START  // Botão Start
```

### 4️⃣ **Snippets de Código** (O MELHOR!)
Digite `sgdk:` e depois o nome do snippet:

#### 🔧 Snippets Disponíveis:

| Snippet | O que faz |
|---------|-----------|
| `sgdk:main` | Cria template de main() completo |
| `sgdk:sprite_init` | Inicializa sprite na tela |
| `sgdk:input` | Lê entrada do controle (todos os botões) |
| `sgdk:vdp_palette` | Define paleta de cores |
| `sgdk:vdp_text` | Desenha texto na tela |
| `sgdk:memory_alloc` | Aloca e libera memória |
| `sgdk:fixed_point` | Operações com ponto fixo |
| `sgdk:debug_print` | Imprime valores para debug |
| `sgdk:sound_play` | Reproduz som/música |
| `sgdk:tilemap` | Carrega mapa de tiles |

**Exemplo:**
```
Digite: sgdk:main
Pressione: TAB
Resultado: Template completo de main() aparece!
```

---

## 🎯 Funções Disponíveis no Autocomplete

### 📺 Funções VDP (Gráficos)
- `VDP_setScreenPalette()` - Define paleta
- `VDP_loadTileSet()` - Carrega tiles
- `VDP_setTileMapEx()` - Define mapa de tiles
- `VDP_waitVSync()` - Aguarda sincronização

### 🎨 Funções de Sprite
- `SPR_addSprite()` - Adiciona sprite
- `SPR_setPosition()` - Move sprite
- `SPR_setAnim()` - Muda animação
- `SPR_update()` - Atualiza sprites

### 🕹️ Funções de Input
- `JOY_readJoypad()` - Lê controle

### 🔊 Funções de Som
- `SND_play()` - Reproduz som
- `PSG_setVolume()` - Controla volume

### 💾 Funções de Memória
- `MEM_alloc()` - Aloca memória
- `MEM_free()` - Libera memória

### 🔢 Funções Matemáticas
- `fix16ToInt()` - Converte fixed-point
- `intToFix16()` - Converte para fixed-point

---

## 📌 Tipos de Dados Disponíveis

```c
u8   // 0 a 255
u16  // 0 a 65535
u32  // 0 a 4294967295
s8   // -128 a 127
s16  // -32768 a 32767
s32  // Signed long
fix16 // Ponto fixo 16-bit
fix32 // Ponto fixo 32-bit
```

---

## 🎮 Constantes de Botões

```c
BUTTON_UP      // D-Pad para cima
BUTTON_DOWN    // D-Pad para baixo
BUTTON_LEFT    // D-Pad para esquerda
BUTTON_RIGHT   // D-Pad para direita
BUTTON_A       // Botão A
BUTTON_B       // Botão B
BUTTON_C       // Botão C
BUTTON_START   // Botão Start
```

---

## 🎬 Constantes de Planos

```c
VDP_PLANE_A      // Plano A (background)
VDP_PLANE_B      // Plano B (background)
VDP_PLANE_WINDOW // Janela
VDP_PLANE_SPRITE // Layer de sprites
```

---

## 💡 Dicas Práticas

### ✅ Bom
```c
// Seu código já aparece com autocomplete!
VDP_loadTileSet(&tiles, 0, COMPRESSION_NONE);
SPR_addSprite(&sprDef, 160, 120, NULL);
```

### ✅ Com Snippets
```c
// Digite: sgdk:main e pressione TAB
// Aparece um template completo!
int main() {
    SYS_init();
    // ...seu código aqui...
    return 0;
}
```

### ✅ Signature Help
```c
// Ao digitar JOY_readJoypad(
// Aparece a documentação da função!
u16 input = JOY_readJoypad(JOY_1);
```

---

## 🚀 Atalhos Úteis

| Atalho | Função |
|--------|--------|
| `Ctrl+Space` | Força autocomplete |
| `Ctrl+K Ctrl+I` | Mostra informações |
| `F12` | Ir para definição |
| `Ctrl+/` | Comentar linha |
| `F5` | Compilar e rodar |

---

## 🎓 Exemplo Completo

Digite `sgdk:main` + TAB:

```c
int main() {
    SYS_init();
    
    // Seu código aqui
    
    while (1) {
        VDP_waitVSync();
    }
    
    return 0;
}
```

Depois complemente com mais snippets e código!

---

## 📋 Próximas Melhorias

- [x] Mais funções de SGDK
- [x] Mais tipos de dados
- [x] Mais snippets
- [x] Documentação em hover
- [x] Integração com LSP (Language Server Protocol)

---

**Divirta-se desenvolvendo para Mega Drive! 🎮**
