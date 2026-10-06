# Cenas programadas (cutscenes)

Editor visual de cenas no estilo dos eventos do RPG Maker. Você monta uma sequência de comandos (falas com retrato, escolhas, movimentos, câmera, sons, flags) e liga a cena a um gatilho no mapa. O jogo executa a cena sozinho.

O editor não gera código C do jogo. Ele salva arquivos JSON legíveis por pessoas e IAs, e um intérprete genérico (`cutscene_runner.c`), igual em todos os jogos do Retro Studio, executa essas cenas na ROM.

## Onde fica

Editor de mapas → barra lateral → **Cenas programadas** → **Editor de cenas**.

| Aba | Para quê |
|---|---|
| Roteiro | Lista de cenas, comandos da cena aberta (com ramos de escolha e condição) e propriedades do comando selecionado. |
| Prévia | Executa a cena sobre o mapa aberto, com caixa de diálogo, retratos e escolhas. Enter/Espaço confirma, ↑/↓ escolhe, S pula. |
| Vocabulário | `cutscenes/cutscene-config.json`: atores, animações, retratos, sons, músicas, habilidades, eventos e flags do jogo. |
| Runtime | Instala ou atualiza o intérprete no projeto e recompila os cabeçalhos C. |

## Fluxo

1. **Runtime**: em projetos antigos, clique em *Instalar runtime no projeto*. Projetos novos já recebem o runtime. Os arquivos copiados são `src/retrostudio/cutscene_runner.c/.h`, `tools/cutscene-compiler.mjs`, `tools/compile-cutscenes.mjs`, `docs/CUTSCENES.md`, `cutscenes/cutscene.schema.json` e `cutscenes/cutscene-config.json` (este último nunca é sobrescrito).
2. **Vocabulário**: cadastre os atores do jogo e diga qual objeto do mapa marca cada um (`mapObjectType`). Cadastre também retratos, sons e flags. O `value` de cada item é o valor C (número ou constante).
3. **Roteiro**: crie a cena e adicione comandos pela paleta. Comandos são inseridos após o selecionado; para inserir dentro de um ramo (↳), clique no ramo. Em *Mover*, *Posicionar* e *Câmera*, use **📍 Escolher no mapa** para clicar no destino.
4. **Salvar cena**: grava `cutscenes/<id>.cutscene.json`. Se não houver erros, também gera `src/cutscene_ids.h` e `src/cutscene_data.h`.
5. **Gatilho**: em *Gatilhos neste mapa*, adicione um gatilho. Ele vira um objeto `cutscene_trigger` no mapa. Ajuste a área e as propriedades no painel do objeto (cena, quando começa, só uma vez, flags) e salve o mapa.

Os caminhos da cena aparecem sobre o mapa: atores, setas de movimento numeradas e enquadramentos de câmera. Desligue em *Mostrar caminhos da cena no mapa*.

## Integração com o jogo

O runtime é C puro e não conhece SGDK. Cada jogo implementa um adaptador (`CutsceneHost`) com sprites, texto, câmera e som. O guia `docs/CUTSCENES.md`, copiado para o projeto, descreve o formato, o bytecode e a integração, e serve para uma IA fazer essa ligação. Exemplo completo: `src/cutscene_host.c` do projeto Alice.

O exportador de mapas de cada jogo precisa converter objetos `cutscene_trigger` em `CutsceneTrigger` usando os ids de `cutscene_ids.h`.

## Arquivos do Retro Studio

- `assets/toolkit/lib/cutscene/`: biblioteca distribuída aos jogos (runtime C, compilador, documentação, schema, manifesto).
- `electron/retro/cutsceneRuntime.js`: instalação, status e listagem de cenas (IPC `tilemap:cutscene-*`).
- `src/composables/useCutsceneAuthoring.js`: estado do editor, compilação ao salvar, sobreposição no mapa e seleção de posição.
- `src/components/retro/tilemap/TilemapCutsceneEditor.vue`: interface.
- `src/utils/retro/cutscenePreview.js`: simulador da prévia (espelho de `cutscene_runner.c`).

## Testes

```sh
node scripts/smoke-cutscene-runtime.mjs   # compilador + runtime C compilado e executado no host
node scripts/smoke-cutscene-editor.mjs    # composable, compilação ao salvar, prévia e renderização do componente
```

## Limitações atuais

- Os textos da interface estão em português, sem as chaves de i18n dos demais idiomas.
- A prévia desenha os atores com o visual do objeto do mapa e não reproduz física nem as animações do jogo.
- Não há criação de NPCs pela cena: os atores precisam existir no jogo (o adaptador decide quem é cada um).
