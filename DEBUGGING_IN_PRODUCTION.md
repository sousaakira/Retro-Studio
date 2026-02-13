# 🐛 Debugging em Produção (AppImage)

## O Problema

Quando você abre `dist/index.html` direto no navegador com `file://`, há erro CORS:
```
Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at file:///assets/...
```

Isso **não acontece no Electron** porque:
1. O Electron carrega via `loadFile()` que não tem restrições CORS
2. **DevTools agora abre automaticamente** para você debugar

## Como Funciona Agora

### Em Produção (AppImage)

```bash
cd dist-electron
./Monarco-0.1.0-x86_64.AppImage
```

O que você verá:

1. **Janela abre + DevTools aparece** automaticamente
2. **Console mostra logs em tempo real**:
   ```
   [2025-12-31T00:00:00.000Z] [INFO] [electron:createWindow] 🪟 Criando nova janela
   📄 [index.html] Página HTML carregada
   📝 [index.html] Script type=module foi declarado
   🚀 [Vue] Iniciando aplicação Monarco
   ✅ [App.vue] onMounted INICIADO - Vue renderizado com sucesso!
   ```

3. **DevTools fecha automaticamente** 1 segundo após Vue montar
   - Dá tempo para ver os logs iniciais
   - Não atrapalha a interface

4. **Interface renderizada e pronta**

### Em Desenvolvimento (`npm run dev`)

DevTools já abre automaticamente como antes, sem mudanças.

## Debug Manual

Se quiser manter DevTools aberto:

**Opção 1**: Comentar o `closeDevTools()` em `electron/main.js`

**Opção 2**: Pressionar `F12` a qualquer momento para abrir/fechar DevTools

**Opção 3**: Usar `CTRL+SHIFT+I` para abrir em modo acoplado

## Logs Disponíveis

### Main Process Logs
```
[electron:createWindow] - Criação da janela
[electron:renderer] - Carregamento HTML
[electron:devtools] - Status do DevTools
[ipc:*] - Handlers IPC (workspace, files, git, etc)
```

### Renderer Console Logs
```
[index.html] - Carregamento do HTML
[Vue] - Inicialização Vue
[App.vue] - onMounted e lifecycle
[Monaco] - Workers e configuração
```

## Troubleshooting

### Tela preta mas console OK?
- Procure por erros em `src/styles.css`
- Verifique se há componente invisível
- Procure erro `[Global Error]` no console

### Vue não renderiza?
- Procure por erro `[Unhandled Promise Rejection]`
- Verifique erro em componentes (`App.vue`, `FileTree.vue`, etc)
- Console mostrará stack trace completo

### DevTools não fecha?
- Vue.onMounted pode ter falhado silenciosamente
- Feche manualmente com F12 ou deixe aberto para debug
- Verifique erro `❌ [CRITICAL] Nenhum componente Vue foi renderizado!`

## Próximos Passos

Rode o build:
```bash
npm run build
npm run build:linux
```

E teste:
```bash
./test-appimage.sh
```

Você verá todo o fluxo de debug em tempo real! 🎯
