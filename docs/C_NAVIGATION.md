# Navegação C / Go to Definition (clangd)

O Retro Studio usa **clangd** (LSP) para Go to Definition real em projetos SGDK/C.

## Requisitos

1. **clangd instalado** no sistema (ou caminho configurado em Settings → Retro)
2. **Toolkit SGDK/MarsDev** configurado (`toolkitPath`) para achar `genesis.h`
3. Projeto Retro aberto (workspace com `src/`)

### Instalar clangd

```bash
# Debian / Ubuntu / Pop!_OS
sudo apt install clangd

# Fedora
sudo dnf install clang-tools-extra

# macOS (Homebrew)
brew install llvm
# e adicione o bin ao PATH, ou configure o caminho em Settings
```

Settings → Retro → **Go to Definition (clangd)** mostra se o binário foi encontrado.

## Uso

- `F12` ou menu de contexto → **Go to Definition**
- Funciona em símbolos do projeto (`screens_init`, structs em `.h`) e headers SGDK (`VDP_drawText`, etc.)
- Também resolve `#include "screens.h"` / `#include <genesis.h>` quando o clangd está ativo

## Como funciona

1. Ao abrir um `.c`/`.h`, a IDE gera:
   - `{projeto}/.retrostudio/compile_commands.json`
   - `{projeto}/compile_flags.txt` (só se não houver um custom do usuário; marcado com `# generated-by-retro-studio`)
2. O processo main sobe **um clangd por workspace**
3. O Monaco consulta `textDocument/definition` e abre a aba com `openFileAt`

## Sem clangd

Se clangd não estiver no PATH, a IDE cai no fallback antigo (regex só em `src/` para funções com corpo e `#define`) — limitado.

## Limitações

- Não inclui ainda: Find References, Rename, diagnostics no editor
- clangd **não** é empacotado no AppImage (dependência do sistema)
- Cross-compiler m68k não é necessário para indexação básica; usamos flags host (`-xc -std=c11`) + `-I` do GDK

## Ver também

- [SGDK_AUTOCOMPLETE.md](./SGDK_AUTOCOMPLETE.md) — snippets/completions Monaco (independente do clangd)
