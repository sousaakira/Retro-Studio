# Refatoração de Gerenciamento de Assets - COMPLETA

## Resumo da Refatoração

A refatoração migrou completamente o gerenciamento de sprites/resources do `localStorage` para um arquivo de configuração baseado em arquivo (`retro-studio.json`).

## Mudanças Principais

### 1. Backend (background.js)

#### Novas Funções:
- `getProjectConfig(projectPath)`: Lê ou cria retro-studio.json com configurações do projeto
- `getResourcePath(projectPath)`: Retorna caminho dinâmico da pasta de recursos

#### Novos IPC Handlers:
- `get-project-config`: Obtém configuração do projeto
- `save-project-config`: Salva configuração do projeto em retro-studio.json
- `add-asset-to-config`: Adiciona asset à lista de configuração
- `remove-asset-from-config`: Remove asset da lista de configuração

#### Handlers Refatorados:
- `req-projec`: Agora retorna `{ estrutura, config }` ao invés de apenas `estrutura`
- `copy-asset-to-project`: Usa `getResourcePath()` dinâmico
- `register-asset-resource`: Usa `getResourcePath()` dinâmico
- `get-res-files`: Usa `getResourcePath()` dinâmico
- `rename-asset-file`: Usa `getResourcePath()` dinâmico

### 2. Frontend (AssetsManager.vue)

#### Funções Refatoradas:
- `saveAssets()`: Migrou de `localStorage.setItem()` para IPC `save-project-config`
- `loadAssets()`: Migrou de `localStorage.getItem()` para IPC `get-project-config`

#### Listeners Atualizados:
- `onMounted()`: Agora também escuta para atualizações de `project-config`
- Handler de `read-files` preservado para compatibilidade

### 3. Segurança (preload.js)

#### Novos Canais Adicionados:
- `add-asset-to-config`
- `add-asset-result`
- `remove-asset-from-config`
- `remove-asset-result`

## Estrutura do retro-studio.json

```json
{
  "name": "mdteste",
  "template": "md-skeleton",
  "createdAt": "2025-12-19T21:33:25.675Z",
  "resourcePath": "res",
  "assets": [
    {
      "id": "unique-id",
      "name": "sprite.png",
      "type": "sprite",
      "size": 12345,
      "path": "res/sprite.png",
      "metadata": {
        "width": 32,
        "height": 32
      },
      "description": "Descrição do asset",
      "tags": ["tag1", "tag2"],
      "updatedAt": "2025-12-19T21:33:25.675Z"
    }
  ]
}
```

## Fluxo de Operações

### Importar Asset:
1. Usuário seleciona arquivo(s) na janela de importação
2. `confirmImport()` processa os arquivos
3. Asset é copiado para `resourcePath` via `copy-asset-to-project`
4. `saveAssets()` é chamado (envia config via IPC)
5. Config é salva em `retro-studio.json`

### Editar Asset:
1. Usuário clica em editar
2. Metadados são alterados no modal
3. `saveAssetMetadata()` atualiza o asset localmente
4. Se nome mudou, `rename-asset-file` é chamado
5. `saveAssets()` persiste a config

### Deletar Asset:
1. Usuário confirma deleção
2. Asset é removido do array `assets.value`
3. `saveAssets()` persiste a mudança

## Benefícios

✅ **Persistência**: Assets agora persistem por projeto, não globalmente  
✅ **Configurabilidade**: Campo `resourcePath` permite estruturas customizadas  
✅ **Rastreabilidade**: Todos os assets estão em arquivo legível  
✅ **Versionamento**: Arquivo JSON pode ser versionado em git  
✅ **Segurança**: Sem dependência de localStorage inseguro  
✅ **Escalabilidade**: Suporta adicionar novos campos à config futuramente  

## Testes Realizados

- ✅ Compilação sem erros
- ⏳ Teste manual: Importar assets
- ⏳ Teste manual: Editar metadados
- ⏳ Teste manual: Renomear assets
- ⏳ Teste manual: Deletar assets
- ⏳ Verificar persistência em retro-studio.json

## Compatibilidade

- ✅ Funciona com estruturas existentes (fallback para 'res' se resourcePath não definido)
- ✅ localStorage ainda é usado localmente para manter estado UI temporário
- ✅ FileExplorer.vue e MenuComponent.vue sincronizam config com localStorage para compatibilidade
