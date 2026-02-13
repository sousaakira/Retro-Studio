# 📦 Guia de Build - Monarco

## Desenvolvimento

Para iniciar em desenvolvimento com hot-reload:

```bash
npm run dev
```

Isso inicia:
- **Vite** na porta 5175 com hot-reload
- **Electron** conectado automaticamente

## Build para Produção

### Build Web (Vite)

Gera os arquivos HTML/CSS/JS otimizados em `dist/`:

```bash
npm run build
```

### Build Electron (Executável)

Gera o executável desktop para sua plataforma:

```bash
npm run build:electron
```

### Build por Plataforma

**Windows** (NSIS Installer + Portable):
```bash
npm run build:windows
```

**Linux** (AppImage + .deb):
```bash
npm run build:linux
```

**macOS** (DMG + ZIP):
```bash
npm run build:macos
```

**Todas as Plataformas** (macOS, Windows, Linux):
```bash
npm run build:all
```

## Arquivos de Saída

Após o build, os executáveis estarão em: `dist-electron/`

Exemplos:
- Windows: `Monarco-0.1.0-x64.exe` (installer)
- Windows Portable: `Monarco-0.1.0-x64.exe` (standalone)
- Linux: `Monarco-0.1.0-x64.AppImage`
- Linux: `monarco-0.1.0-amd64.deb`
- macOS: `Monarco-0.1.0.dmg`

## Configuração

A configuração do Electron Builder está em `package.json` na seção `"build"`:

- **appId**: Identificador único da aplicação
- **productName**: Nome exibido (Monarco)
- **directories**: Caminho dos recursos e saída
- **files**: Arquivos a incluir no pacote
- **win/linux/mac**: Configurações por plataforma
- **icon**: Ícone em `assets/icons/icon.png`

## Ícone

O ícone foi gerado em múltiplos tamanhos:
- `assets/icons/icon.svg` - Vetorial original
- `assets/icons/icon.png` - 512×512 (principal)
- `assets/icons/icon-256.png` - 256×256
- `assets/icons/icon-128.png` - 128×128
- `assets/icons/icon-64.png` - 64×64

Ele aparecerá:
- ✅ Na barra de tarefas (Windows/Linux)
- ✅ No Dock (macOS)
- ✅ Atalhos de desktop
- ✅ Menu iniciar (Windows)

## Troubleshooting

### "Cannot find module..."
Execute: `npm install`

### Build falha
Certifique-se que `npm run build` (Vite) funciona primeiro:
```bash
npm run build
```

### Arquivo muito grande
Os builds podem ser ~150-200MB dependendo da plataforma. Isso é normal para Electron apps.

### Windows SmartScreen Warning
Aplicações não assinadas podem exibir avisos. Para produção, considere assinar o executável.

## Próximas Etapas

1. ✅ Testar em cada plataforma
2. ✅ Configurar atualizações automáticas (electron-updater)
3. ✅ Assinatura de código para distribuição
4. ✅ CI/CD para builds automáticos
