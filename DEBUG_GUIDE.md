# 🐛 Guia de Debugging - Monarco IDE

## 1. **Console do Electron (Main Process)**

### Visualizar Logs
```bash
# Modo desenvolvimento (com DevTools automático)
npm run dev

# Modo produção com logs
ELECTRON_ENABLE_LOGGING=1 ./Monarco-0.1.0-x86_64.AppImage
```

### Usar função `log()` no `electron/main.js`

A função `log()` foi adicionada com 3 níveis:

```javascript
// Nível: error (sempre visível)
log('error', 'workspace', 'Erro ao carregar workspace', { path, error })

// Nível: info (desenvolvimento e produção)
log('info', 'ipc', 'Arquivo lido com sucesso', { size: 1024 })

// Nível: verbose (apenas desenvolvimento)
log('verbose', 'fs', 'Operação de leitura iniciada', { file })
```

**Níveis de DEBUG**:
- `error` - Erros críticos (sempre mostrado)
- `info` - Informações normais
- `verbose` - Logs detalhados (apenas dev)

**Modificar nível globalmente**:
```javascript
// Em electron/main.js
DEBUG.level = 'verbose'  // Mostrar tudo
DEBUG.level = 'info'     // Apenas info + error
DEBUG.level = 'error'    // Apenas erros
```

---

## 2. **DevTools do Renderer (Processo de Renderização)**

### Acessar via Atalhos
```
Ctrl+Shift+I  → Abre DevTools
F12           → Abre DevTools
Ctrl+Shift+C  → Inspecionar elemento
```

### Logs no Console do Renderer
No `src/main.js` ou qualquer `.vue`:

```javascript
// Simples
console.log('Valor:', dados)

// Info
console.info('ℹ️ Workspace carregado:', workspacePath)

// Warn
console.warn('⚠️ Atenção: timeout na requisição')

// Error
console.error('❌ Erro crítico:', error)

// Group (organizar logs)
console.group('Operação de arquivo')
console.log('Arquivo:', filename)
console.log('Tamanho:', size)
console.groupEnd()

// Table (visualizar dados estruturados)
console.table(files.map(f => ({ name: f.name, size: f.size })))
```

---

## 3. **Debugar IPC (Comunicação Electron ↔ Renderer)**

### No Main Process (electron/main.js)
```javascript
ipcMain.handle('workspace:select', async () => {
  log('info', 'ipc:workspace:select', 'Solicitação recebida')
  try {
    const res = await dialog.showOpenDialog({...})
    log('info', 'ipc:workspace:select', 'Workspace selecionado', { path: res.filePaths[0] })
    return res.filePaths[0]
  } catch (e) {
    log('error', 'ipc:workspace:select', 'Erro', { error: e.message })
    throw e
  }
})
```

### No Renderer (src/App.vue ou qualquer Vue)
```javascript
import { ipcRenderer } from 'electron'

async function selectWorkspace() {
  console.log('📤 Enviando: workspace:select')
  const result = await ipcRenderer.invoke('workspace:select')
  console.log('📥 Recebido:', result)
}
```

---

## 4. **Debugar Monaco Editor**

### Verificar Estado no Console
```javascript
// No DevTools do renderer
console.log(window.monaco)  // Verificar se Monaco está carregado
console.log(window.MonacoEnvironment)  // Verificar configuração

// Acessar instância do editor
const editors = window.monaco?.editor?.getEditors?.()
console.table(editors)

// Verificar worker paths
console.log('Worker paths:', window.MonacoEnvironment)
```

### Logs do Monaco
```javascript
// Adicionar ao src/main.js antes de usar Monaco
if (window.monaco) {
  console.log('✓ Monaco carregado')
  console.log('Versão:', window.monaco.editor?.VERSION)
} else {
  console.warn('✗ Monaco NÃO carregado')
}
```

---

## 5. **Debugar IA/Chat**

### Ver requisições da IA
```javascript
// No electron/main.js, adicionar logs no AIAgent
log('info', 'ai:request', 'Enviando para IA', { model: 'Qwen/...', tokens: maxTokens })

// Ver resposta
log('info', 'ai:response', 'Resposta recebida', { tokens: response.usage?.total_tokens })
```

### Verificar endpoint
```bash
# Terminal
# curl -X POST http://192.168.1.18:8000/v1/chat/completions \
curl -X POST https://ia.auth.com.br/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-Coder-7B-Instruct-AWQ",
    "messages": [{"role": "user", "content": "test"}],
    "temperature": 0.2,
    "max_tokens": 100
  }'
```

---

## 6. **Debugar Performance**

### Performance marks
```javascript
// No renderer (src/App.vue)
performance.mark('workspace-load-start')
// ... código ...
performance.mark('workspace-load-end')
performance.measure('workspace-load', 'workspace-load-start', 'workspace-load-end')

console.table(performance.getEntriesByType('measure'))
```

### Monitorar recursos
```javascript
// DevTools Console
performance.memory  // Heap, limite, etc
console.table([performance.memory])
```

---

## 7. **Debugar Network (Requisições)**

### No DevTools
1. Abra DevTools (F12)
2. Vá para aba **Network**
3. Faça uma ação que gera requisição
4. Veja detalhes de cada requisição

### Interceptar Requisições via Fetch
```javascript
// Adicionar ao src/main.js
const originalFetch = window.fetch
window.fetch = function(...args) {
  console.log('📡 Fetch:', args[0])
  return originalFetch.apply(this, args)
    .then(res => {
      console.log('✓ Resposta:', res.status)
      return res
    })
    .catch(err => {
      console.error('✗ Erro Fetch:', err)
      throw err
    })
}
```

---

## 8. **Debugar Terminal PTY**

### Logs de Terminal
```javascript
// No electron/main.js
log('info', 'pty', 'Terminal criado', { id, shell: process.env.SHELL })
log('info', 'pty', 'Comando executado', { cmd, pid })
```

---

## 9. **Exportar Logs para Arquivo**

### Salvar no arquivo de configuração
```javascript
// electron/main.js
const logFile = path.join(getConfigDir(), 'monarco.log')

const log = (level, context, message, data = null) => {
  // ... código anterior ...
  
  if (DEBUG.file) {
    const line = `${output}\n`
    fs.appendFile(logFile, line).catch(() => {})
  }
}
```

### Visualizar logs
```bash
# Linux/Mac
tail -f ~/.monarco/monarco.log

# Windows
Get-Content $env:USERPROFILE\.monarco\monarco.log -Tail 20
```

---

## 10. **DevTools Avançado**

### Breakpoints no DevTools
1. DevTools → Sources
2. Clique no número da linha
3. Código pausa naquele ponto
4. Inspecione variáveis no Console

### Watch Expressions
1. DevTools → Sources
2. Painel direito → Watch
3. Adicione expressões para monitorar

### Local Storage
```javascript
// Console
localStorage.setItem('debug', 'true')
localStorage.getItem('debug')
localStorage.clear()  // Limpar tudo
```

---

## 11. **Checklist de Debugging**

- [ ] Verificar console com `Ctrl+Shift+I`
- [ ] Usar função `log()` no main process
- [ ] Usar `console.log()` no renderer
- [ ] Monitorar aba Network para requisições
- [ ] Verificar Local Storage se necessário
- [ ] Usar Breakpoints no DevTools
- [ ] Testar com `DEBUG.level = 'verbose'`
- [ ] Verificar arquivo de logs em `~/.monarco/monarco.log`

---

## 12. **Dicas Rápidas**

| Problema | Solução |
|----------|---------|
| DevTools não aparece | Use `F12` ou `Ctrl+Shift+I` no AppImage |
| Logs não aparecem | Verificar `DEBUG.level` e `isDev` |
| IPC não funciona | Verificar console do main AND renderer |
| Tela preta | Verificar console (app pode estar com erro) |
| Editor não renderiza | Verificar se Monaco está em `window.monaco` |
| IA não responde | Verificar endpoint em settings (`~/.monarco/settings.json`) |

---

**Atalhos importantes:**
```
F12           → DevTools
Ctrl+Shift+I  → DevTools
Ctrl+Shift+C  → Inspecionar elemento
Ctrl+J        → Console
Ctrl+Shift+E  → Sources
```
