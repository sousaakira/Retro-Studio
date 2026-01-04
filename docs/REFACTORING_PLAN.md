# Plano de Refatoração - Retro Studio

## Análise da Situação Atual

### ✅ O que está BOM e deve ser MANTIDO:

1. **Sistema de Build/Compilação** (`background.js`)
   - IPC handlers funcionais
   - Sistema de execução de jogos
   - Leitura/escrita de arquivos
   - ✅ MANTER

2. **CodeEditor (Monaco Editor)**
   - Editor de código funcional
   - Integração com sistema de arquivos
   - ✅ MANTER e INTEGRAR melhor

3. **Sistema de Arquivos/Projetos**
   - MenuComponent (tree view)
   - ProjectSetings
   - Sistema de abas (TabsComponet)
   - ✅ MANTER mas REFATORAR para integrar

4. **Componentes Novos (Estilo Godot)**
   - VisualEditor, SceneViewport, etc.
   - ✅ MANTER e EXPANDIR

### ❌ O que está PROBLEMÁTICO:

1. **Mistura de Frameworks**
   - Vuetify (antigo) + Componentes customizados (novos)
   - Interface inconsistente
   - ❌ RESOLVER: Escolher uma abordagem unificada

2. **App.vue Desorganizado**
   - Mistura código antigo e novo
   - Estrutura Vuetify não aproveitada
   - ❌ REFATORAR completamente

3. **Componentes Duplicados/Não Usados**
   - `CodeEditor copy.vue` (duplicado)
   - `HelloWorld.vue` (não usado)
   - ❌ REMOVER

4. **Sistema de Tabs Não Integrado**
   - Tabs não funcionam com editor visual
   - ❌ INTEGRAR ou REMOVER

## Recomendação: Refatoração Híbrida

### Abordagem Proposta:

**NÃO recriar tudo do zero**, mas fazer uma **refatoração inteligente**:

1. **Manter a base sólida** (build, IPC, file system)
2. **Unificar a interface** em estilo Godot puro
3. **Integrar sistemas** antigos com novos
4. **Remover código morto**

## Plano de Ação

### Fase 1: Limpeza e Organização (1-2 horas)
- [ ] Remover componentes não usados
- [ ] Remover Vuetify (ou manter apenas se necessário)
- [ ] Limpar App.vue
- [ ] Organizar estrutura de pastas

### Fase 2: Interface Unificada (2-3 horas)
- [ ] Criar novo App.vue estilo Godot puro
- [ ] Integrar MenuComponent no sistema visual
- [ ] Unificar sistema de tabs com editor visual
- [ ] Criar layout consistente

### Fase 3: Integração (1-2 horas)
- [ ] Integrar CodeEditor no VisualEditor
- [ ] Melhorar sistema de arquivos
- [ ] Unificar modais

### Fase 4: Melhorias (contínuo)
- [ ] Melhorar UX
- [ ] Adicionar funcionalidades faltantes
- [ ] Otimizações

## Estrutura Proposta

```
App.vue (novo, limpo)
├── MainLayout (estilo Godot)
│   ├── TopBar (menu, tabs, play button)
│   ├── LeftPanel (File Explorer + Resources)
│   ├── CenterPanel (VisualEditor ou CodeEditor)
│   └── RightPanel (Hierarchy + Inspector)
└── Modals (Project, Settings, etc.)
```

## Vantagens desta Abordagem

✅ **Preserva o que funciona** (build, IPC, file system)
✅ **Unifica a interface** (estilo Godot consistente)
✅ **Menos trabalho** que recriar tudo
✅ **Menos bugs** (mantém código testado)
✅ **Progressivo** (pode fazer em fases)

## Desvantagens de Recriar Tudo

❌ **Muito trabalho** (semanas de desenvolvimento)
❌ **Perde funcionalidades** que já funcionam
❌ **Risco de bugs** em código novo
❌ **Tempo perdido** refazendo o que já existe

## Conclusão

**Recomendação: REFATORAÇÃO HÍBRIDA**

- Manter o que funciona
- Unificar a interface
- Integrar sistemas
- Remover código morto

Isso dará um resultado melhor em menos tempo!

