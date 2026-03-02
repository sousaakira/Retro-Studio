# Retro Studio Plugin System API

Retro Studio possui um sistema de plugins integrado que permite à comunidade estender funcionalidades, criar importadores customizados de assets, formatadores de código e muito mais, usando NodeJS padrão.

## Onde Instalar
Os plugins devem ser colocados na pasta de configuração do usuário:
- **Linux:** `~/.config/retro-studio/plugins/<nome-do-plugin>/`
- **Windows:** `%APPDATA%\\retro-studio\\plugins\\<nome-do-plugin>\\`

## Estrutura do Plugin
Um plugin consiste em uma pasta contendo um script Node (`index.js`). O módulo deve providenciar um export default (usando ES Modules ou CommonJS sintaxe convertida) e conter os métodos básicos API do Backend.

### Exemplo de `index.js`
```javascript
export default {
  // Hook de inicialização chamado pelo Main Process na inicialização do Editor
  init({ ipcMain, pluginsDir, broadcastEvent }) {
    this.broadcastEvent = broadcastEvent;
    console.log('[MeuPlugin] Inicializado na pasta:', pluginsDir);
  },

  // Recebe requisições ativadas diretamente pelo Frontend do app
  async execute(action, payload) {
    if (action === 'sayHello') {
      return { success: true, message: \`Olá, \${payload.name}!\` };
    }
    
    // É recomendado lidar pacificamente com comandos não reconhecidos.
    throw new Error('Ação não suportada pelo MeuPlugin');
  }
}
```

## Consumindo via Frontend (App.vue / Console Customizado)
A interface e as extensions do app interagem com os nodes de plugins usando o preload (ponte ipcRenderer), exposta em `window.retroStudio.plugins`.

### 1. Chamando um Action no Backend (RPC):
```javascript
window.retroStudio.plugins.execute('meu-plugin', 'sayHello', { name: 'Comunidade' })
  .then(res => console.log(res.message))
  .catch(err => console.error(err));
```

### 2. Ouvindo Eventos Globais:
O sistema base agora reporta acontecimentos do editor para os painéis abertos. Você pode escutar através do método `on`:
```javascript
window.retroStudio.plugins.on('fileOpened', (path) => {
  console.log('O usuário abriu o arquivo:', path);
});

window.retroStudio.plugins.on('appReady', () => {
  console.log('A UI Base terminou de renderizar!');
});
```

### 3. Emitindo Eventos Pessoais:
Um script no renderer pode enviar avisos em formato de evento customizado para o restante do painel processar. (Esses eventos trafegam pelo Main e enviam pra todos).
```javascript
window.retroStudio.plugins.emit('compileStarted', { time: Date.now() });
```

> **Nota:** Este sistema continuará a ser expandido para injetar botões flexivelmente no Command Palette e Menu de Contexto do File Explorer em updates futuros.
