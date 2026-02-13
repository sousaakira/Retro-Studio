# Monarco - Checklist do MVP

Use este arquivo como checklist "vivo". Marque os itens com `[x]` conforme forem entregues.

## 0) Base do Projeto
- [x] Electron + Vite + Vue 3 rodando (`yarn dev`)
- [x] Monaco integrado (JS/Go highlight)
- [x] Preload funcionando (`window.monarco` ok)
- [x] IPC restrito ao workspace (não lê/escreve fora da pasta)

## 1) Workspace & Explorer
- [x] Open folder (selecionar pasta)
- [x] Listar árvore de arquivos/pastas
- [ ] Refresh do explorer (botão)
- [ ] Expand/Collapse por pasta (UI)
- [ ] Persistir último workspace (reabrir ao iniciar)
- [ ] Watcher de mudanças no FS (opcional; pode ser pós-MVP)

## 2) Arquivos (CRUD básico)
- [x] Abrir arquivo ao clicar
- [x] Editar conteúdo
- [x] Salvar (botão + `Ctrl+S`)
- [x] Save All
- [x] Fechar aba com arquivo modificado (confirm: salvar/descartar/cancelar)
- [x] Criar novo arquivo
- [x] Criar nova pasta
- [x] Renomear arquivo/pasta
- [x] Deletar arquivo/pasta (com confirmação)

## 3) Tabs & Navegação
- [x] Abas básicas
- [x] Indicador "dirty"
- [ ] `Ctrl+W` fechar aba
- [ ] Reabrir último arquivo (opcional)
- [ ] Reordenar abas (drag & drop) (pós-MVP)

## 4) Busca
- [x] `Ctrl+F` (find in file) via Monaco
- [ ] `Ctrl+Shift+F` (find in workspace) (busca simples + resultados clicáveis)
- [ ] Replace in file/workspace (pós-MVP)

## 5) UX mínima (VS Code-like)
- [x] Status bar (arquivo, linguagem, linha/coluna)
- [x] Breadcrumb/path do arquivo ativo (opcional)
- [x] Tema/ajustes básicos do editor (font size, word wrap, tab size) com persistência

## 6) Segurança/Qualidade
- [ ] CSP no renderer (reduzir warning do Electron no dev/build)
- [ ] Tratamento de erros consistente (toast/area fixa; sem stack pro usuário)
- [ ] Ignorar pastas pesadas: `node_modules`, `.git`, `dist` (MVP recomendado)

## 7) Build/Distribuição
- [ ] Setup de empacotamento (electron-builder ou forge)
- [ ] Build Linux (AppImage/deb)
- [ ] Versionamento e update strategy (pós-MVP)

## Primeiro lote sugerido (para iniciar)
1. Refresh do explorer + ignore `node_modules/.git/dist`
2. Fechar aba com dirty (confirm dialog) + Save All
3. `Ctrl+F` (find in file)
