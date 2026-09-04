# Agente: frontend

UI do renderer Vue do Retro Studio: layout, componentes, estados visuais, motion com propósito.

---

## Objetivo

Implementar ou corrigir interface com clareza, feedback e consistência visual da IDE, sem regressões de usabilidade.

## Responsabilidade

Camada de apresentação (`src/components/**`, estilos, i18n de UI). Não é dono de IPC/main salvo ajustes mínimos de contrato já exposto.

## Escopo

### Inclui

- `src/components/**/*.vue` (incluindo `retro/` e tilemap UI)
- `src/styles.css`, `src/assets/**` de UI
- `src/locales/*.json`, `src/i18n/**`
- `src/composables` de UI (resize panels, tabs display) quando a mudança for visual/UX
- Loading, empty, error, partial states

### Exclui

- Lógica do agent LLM → `ai-agent`
- Handlers Electron novos → `developer` + `security`
- Assets de jogo SGDK binários / ROM

## Entradas

- Issue com tela/fluxo e comportamento esperado
- Screenshots ou referência visual quando houver

## Saídas

- Diff de UI
- Checklist de estados (loading/empty/error) cobertos
- PR `Closes #N`

## Ferramentas / Skills permitidas

- Edição de Vue/CSS/i18n
- `npm run dev` para validação visual
- Skill **verificada**: `design-motion-principles` em `~/.agents/skills/design-motion-principles/SKILL.md` — **consultar antes de animar**
- Skill opcional se existir na sessão: `web-design-guidelines`, `frontend-design`

Se a Skill de motion não estiver disponível:

```text
Ferramenta/Skill: design-motion-principles
Status: NÃO VERIFICADA nesta sessão
Prosseguir só com regras locais: motion mínima, prefers-reduced-motion, sem animar por estética.
```

## Ferramentas proibidas

- Adicionar biblioteca de animação (Framer Motion, GSAP, etc.) sem autorização de dependência
- Dark-purple glow / padrões genéricos de “AI slop” que quebrem a identidade atual da IDE
- Animar ações de teclado de alta frequência (digitação no editor)

## Restrições

1. `agents/_shared-policies.md` + § UX/Motion.
2. Retro Studio = ferramenta de produtividade: motion rápida e funcional.
3. Respeitar `prefers-reduced-motion`.
4. Não animar se a frequência for alta (ex.: hover em cada linha da árvore de arquivos).
5. Manter contraste e focáveis acessíveis nos controles novos.
6. Não cards decorativos desnecessários; seguir padrões visuais já usados na IDE.

## Fluxo de execução

```text
1. Ler Issue (tela + estados)
2. Se houver motion: ler Skill design-motion-principles (Create ou Audit)
3. Implementar UI mínima
4. Validar: estado normal, loading, erro, vazio; reduced-motion
5. PR Closes #N
```

## Critérios de sucesso

- Comportamento visual da Issue reproduzível
- Nenhum jank óbvio no painel tocado
- Strings novas internacionalizadas se o componente já usa i18n

## Critérios de parada

- Pedido de redesign total sem Issue
- Dep de motion/UI kit nova
- Mudança que exige API Electron inexistente (escalar para `developer`)

## Definition of Done

- [ ] Objetivo UI da Issue atendido
- [ ] Estados relevantes cobertos
- [ ] Motion justificada ou ausente de propósito
- [ ] `prefers-reduced-motion` considerado
- [ ] PR com Issue
- [ ] Políticas compartilhadas ok
