# Desfazer, recuperação e segurança da edição — issue #52

## Desfazer e refazer por documento

| Editor | O que entra no histórico | Como |
|---|---|---|
| Mapas | pintura, objetos, colisão, atributos (já existia) | Ctrl+Z / Ctrl+Y no editor |
| Personagens | recortes, quadros (ordem, duplicar, remover), tempos e FPS, caixas, âncoras, propriedades, comportamento e movimentos removidos | botões **Desfazer/Refazer** no cabeçalho; Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y |
| Áudio, Câmera, Progresso, Mundo, Física, Paletas, Diagnóstico | o documento de configuração inteiro | botões no rodapé; mesmas teclas |

Regras (`shared/retro/documentHistory.js`, `src/composables/useDocumentUndo.js`):

- O histórico é **do documento aberto**. Abrir outro personagem, recarregar do disco, trocar de
  projeto ou falhar ao abrir começa um histórico novo: nada do documento anterior pode ser
  “desfeito” por cima do novo.
- Só edições feitas no editor viram passos. O que muda no disco por fora (Git, outro
  programa, exportações) não entra no histórico; o editor só vê essas mudanças ao recarregar.
- Edições em sequência rápida (digitar, arrastar um controle) viram um passo; criar, remover
  ou reordenar um movimento ou quadro é sempre um passo próprio. No editor de personagens,
  mudar a seleção (e os ajustes da ferramenta de recorte que acompanham o movimento
  selecionado) não cria passo, e a seleção volta junto com o passo em que estava. Nos
  editores de configuração a seleção é da tela e não faz parte do histórico.
- O registro do que já foi exportado (nomes do PNG, do header e do recurso de um personagem;
  série e semente do Diagnóstico) não é desfeito: desfazer depois de exportar não tira do
  personagem a posse dos arquivos exportados.
- Aplicar um passo não cria outro passo, e salvar não mexe no histórico: desfazer e
  salvamento automático não se realimentam. No editor de personagens o estado desfeito é
  salvo como qualquer edição.
- Campos de texto mantêm o desfazer do próprio campo; o terminal e o editor de código, os seus.
- Até 100 passos por documento; o histórico não é guardado em disco.

## Salvamento, troca e fechamento

- **Personagens** salvam sozinhos 350 ms depois da última edição e mostram “Salvando…”,
  “Projeto salvo” ou “Falha ao salvar” no cabeçalho. Trocar de projeto ou fechar a janela
  espera o salvamento e é recusado se ele falhar.
- **Fechar a janela** por qualquer caminho (botão, Alt+F4, barra de tarefas) passa pela mesma
  verificação: o processo principal devolve o pedido ao editor, que salva ou recusa, e os
  rascunhos pendentes são gravados antes de fechar. Se a interface não responder em 8 s, a
  janela fecha mesmo assim (os rascunhos já gravados continuam no projeto).
- **Mapas e cenas** são salvos pelo usuário; trocar de projeto ou fechar verifica alterações
  pendentes (ver `WORKSPACE_LAYOUT.md`).
- **Editores de configuração** exportam por botão. Fechar com alterações pede “exportar ou
  descartar”; os que ficam no painel inferior impedem a troca de projeto até essa decisão.
- Salvar texto pela IDE (`fs:writeTextFile`) substitui o arquivo em um passo
  (`electron/retro/atomicText.js`): uma queda no meio da gravação deixa o conteúdo anterior
  inteiro, nunca um arquivo truncado. O que uma gravação simples faria continua valendo:
  arquivo somente leitura é recusado; links simbólicos (inclusive pendentes) e físicos
  continuam apontando para o mesmo arquivo; e quando não dá para criar o temporário ao lado
  (pasta somente leitura, arquivo preso por outro programa) a gravação é feita no lugar.

## Restauração depois de uma interrupção

Trabalho não salvo dos editores visuais fica em `.retrostudio/drafts/<editor>.json`, dentro do
projeto (`electron/retro/editorDrafts.js`):

```json
{ "version": 1, "editor": "palettes", "savedAt": "2026-10-10T13:57:43.000Z",
  "baseRevision": "<revisão do arquivo quando o rascunho foi feito>", "state": { "config": { } } }
```

- Editores: `audio`, `camera`, `progress`, `world`, `movement`, `palettes` e um arquivo por
  mapa (`map-<hash do caminho>`, o TMX em edição; só mapas `.tmx` já salvos dentro do projeto).
- Limite de 1 MiB por rascunho (4 MiB para mapas). A pasta cria o próprio `.gitignore`: os
  rascunhos são locais e não entram em commits.
- O rascunho é gravado enquanto se edita (cerca de meio segundo depois da última mudança;
  mapas a cada 3 s) e apagado ao exportar/salvar ou descartar.
- **Um rascunho nunca substitui um arquivo de autoria.** Ao reabrir o editor ele volta como
  alterações não salvas, com a data (“recuperadas de …”). Mapas mostram uma faixa com
  **Restaurar alterações** e **Descartar**; o arquivo do mapa só muda em Salvar.
- Se o arquivo de origem mudou depois do rascunho, o editor avisa e a exportação fica
  bloqueada até o usuário decidir (descartar, ou — em Paletas — “Manter minhas alterações e
  permitir exportar”).
- O mesmo editor aberto em dois lugares (diálogo e painel inferior): uma instância sem
  alterações não apaga o rascunho escrito pela outra.
- Em mapas, “Restaurar alterações” pede confirmação se já houver edições novas na tela;
  enquanto a faixa de recuperação está aberta, edições novas não são guardadas como rascunho.
- Rascunho ilegível é ignorado; a pasta de rascunhos não pode ser um link.
- Personagens não usam rascunho: o salvamento automático já grava o arquivo do personagem.

## Ações destrutivas

| Ação | Proteção |
|---|---|
| Remover movimento, quadro, caixa, sala, região, efeito, atribuição… | Desfazer no editor |
| Excluir arquivo ou pasta pela árvore; excluir mapa de um kit | Confirmação e envio para a **lixeira do sistema** (sem lixeira disponível, exclusão definitiva, como confirmado). A pasta do projeto não pode ser excluída pela IDE |
| Limpar derivados | Só quarentena restaurável (ver `ASSET_LIFECYCLE.md`) |
| Importar por cima de um arquivo | Não acontece: o existente é preservado |
| Descartar alterações de um editor | Botão explícito “Descartar…”; apaga também o rascunho |
| Fechar projeto/janela com trabalho pendente | Salvamento verificado ou recusa com aviso |

## Verificação

```sh
node scripts/smoke-document-history.mjs
node scripts/smoke-editor-drafts.mjs
node scripts/smoke-editor-recovery.mjs
E_PROJECTS=<pasta vazia> E_NAME=<projeto novo> scripts/inspect-electron.sh <home isolado> scripts/electron-undo-recovery.steps.mjs <saída>
```

Na IDE Electron real (instância isolada): no personagem do projeto inicial, FPS alterado,
quadro duplicado e movimento removido foram desfeitos um a um por botão e por Ctrl+Z, com o
arquivo acompanhando cada passo, e refeitos por Ctrl+Shift+Z e Ctrl+Y; parado por 4 s, o
arquivo não foi regravado. Uma cor de paleta editada e não exportada sobreviveu a uma recarga
abrupta da janela e voltou como “Alterações não exportadas de … foram recuperadas”;
“Descartar e recarregar” apagou o rascunho.

## Limites

- O histórico não sobrevive a fechar o editor ou a IDE (o rascunho, sim).
- Cenas (cutscenes), kits de mapa, controles (mapeamento de entrada) e o orçamento de
  hardware não têm rascunho durável nem desfazer próprio além do que já tinham; remoções
  nesses editores valem até salvar (cenas e kits pedem confirmação ao descartar).
- Mapa novo ainda sem arquivo e mapas `.json` não têm rascunho de recuperação.
- Um rascunho só é lido uma vez por projeto e sessão: outra janela da IDE no mesmo projeto
  não vê o rascunho mais novo desta.
- Sem lixeira no sistema a exclusão é definitiva e a IDE não avisa a diferença além do texto
  de confirmação.
- A recuperação de mapa foi verificada por teste da lógica, não pintando um mapa na IDE real.
- A lixeira depende do sistema; em Xvfb/servidores sem lixeira a exclusão é definitiva.
- Interrupção simulada por recarga da janela; queda de energia real não foi simulada (a
  gravação atômica e os rascunhos são testados por falhas injetadas).
