# SGDK Autocomplete e Snippets

Autocomplete, hover e snippets SGDK no Monaco (sem LSP externo).

## Como usar

1. **Autocomplete** — digite prefixos (`VDP_`, `SPR_`, `JOY_`, `SYS_`, `DMA_`, `XGM_`, …) ou `Ctrl+Space`
2. **Snippets** — digite `sgdk:` + nome e aceite com Tab
3. **Hover** — passe o mouse sobre funções conhecidas

Lista completa de snippets: [`SNIPPETS_GUIDE.md`](./SNIPPETS_GUIDE.md)

### Snippets principais

| Snippet | Uso |
|---------|-----|
| `sgdk:main` | `main(bool hardReset)` + `SYS_doVBlankProcess` |
| `sgdk:game_loop` | Loop com paleta/sprites |
| `sgdk:sprite_init` / `sgdk:sprite_animation` | Sprites |
| `sgdk:input` | Joypad |
| `sgdk:vdp_palette` / `sgdk:vdp_text` / `sgdk:tilemap` | VDP |
| `sgdk:dma_operations` | DMA |
| `sgdk:music_system` | Áudio |
| `sgdk:collision` / `sgdk:physics` | Gameplay |

Há **26** snippets `sgdk:*` e ~**150+** completions de API em:

- `src/utils/retro/sgdkSnippets.js`
- `src/utils/retro/sgdkAutocomplete.js`

Registrados via `src/utils/retro/sgdkMonaco.js`.

## O que isto NÃO é

- **Não** há clangd/ccls/LSP C no Retro Studio hoje
- `electron/ai/autocomplete.js` é **FIM via LLM**, não o catálogo SGDK

## Manutenção

Ao adicionar APIs SGDK novas, atualize `sgdkAutocomplete.js` (e snippets se for um padrão de uso). Mantenha este doc alinhado a `SNIPPETS_GUIDE.md`.
