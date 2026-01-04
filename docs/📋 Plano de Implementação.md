Perfeito! Entendi a estratégia. Vou criar um plano para implementar a **detecção automática de assets ao abrir projeto**:

## 📋 Plano de Implementação

### 1️⃣ **Detecção Completa ao Abrir Projeto**
- Quando projeto é aberto → scan completo da pasta `resourcePath`
- **Sempre** verifica se há novos arquivos (pode ter sido adicionado manualmente)
- Compara com o que já está em `retro-studio.json`

### 2️⃣ **Criar Metadados Automaticamente**
Para cada arquivo detectado:
- `name`: nome do arquivo
- `size`: tamanho em bytes
- `type`: detectado por extensão (com fallback para `'sprite'` para imagens)
- `path`: caminho relativo ao projeto
- Timestamps: `createdAt`, `updatedAt`

### 3️⃣ **Estratégia de Detecção por Tipo**
```
.pal, .act     → 'palette' ✅ (detecta automaticamente)
.png, .jpg...  → 'sprite' ❓ (usuário escolhe: sprite/tile/tilemap)
.json          → 'tilemap' ✅
.wav, .mp3...  → 'sound' ✅
```

### 4️⃣ **Fluxo de Detecção**
1. Backend verifica arquivos na pasta
2. Identifica automaticamente: **paletas e sons**
3. Para **imagens não identificadas** → abre dialog no frontend
4. Usuário escolhe: "Sprite" / "Tile" / "Tilemap"
5. Asset é adicionado à config com tipo correto

---

## 🔧 O Que Preciso Implementar

### **Backend (background.js)**
- [x] Nova função `scanResourcesFolder()` - escaneia pasta e detecta tipos
- [x] Nova função `detectAssetType()` - identifica tipo pela extensão
- [x] Novo handler `scan-resources` - chamado ao abrir projeto

### **Frontend (AssetsManager.vue)**
- [x] Dialog para usuário escolher tipo de imagem
- [x] Handler para `scan-resources-result`
- [x] Adicionar assets detectados à lista

### **Segurança (preload.js)**
- [x] Adicionar canais: `scan-resources`, `scan-resources-result`

---

## ✅ Está tudo certo? Posso começar a implementar?