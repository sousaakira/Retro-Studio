# Recursos compilados e orçamento — issue #51

Abra **Recursos → Orçamento de hardware**. A inspeção é somente leitura:
nunca compila, executa scripts ou altera imagens. O formulário **Editar plano
de hardware** modifica a configuração apenas ao clicar em **Salvar plano**.
Ele distingue a grade da imagem original dos números encontrados no ELF
ligado. Não é necessário instalar nm/readelf ou uma biblioteca nova.

## Arquivos e informações

- ELF: primeiro arquivo válido em `out/rom.out`, `out/rom.elf`, `build/rom.elf`.
  Somente ELF32 big endian executável para 68000, com tabelas/faixas válidas.
- ROM: tamanho, data e SHA-256 de `out/rom.bin`, quando disponível.
- RAM estática: seções alocadas no intervalo físico 0xFF0000–0xFFFFFF,
  incluindo dados inicializados e BSS. Os endereços estendidos do linker
  são normalizados ao barramento de 24 bits. Heap, stack, RAM do Z80 e
  buffers de execução não estão nessa contagem.
- Declarações atuais de `res/*.res`: símbolo, tipo e caminho de origem.
  A correspondência com os fontes usados naquele build permanece desconhecida;
  ELF e ROM podem ser de builds diferentes. O registro abaixo verifica hashes
  observados, sem comprovar a cadeia de dependências do compilador.
- PNG: dimensões/grade sem otimização, lendo somente os primeiros 24 bytes.
  Essa grade não representa tiles únicos nem reserva efetiva de VRAM.

O seletor **Leitor das estruturas → SGDK 1.81** deve ser usado apenas para
builds dessa versão. A escolha é uma hipótese explícita, não uma identificação
automática da ROM. Sem leitor informado ou sem ELF, os campos permanecem
desconhecidos. Outras versões/ABIs não são interpretadas automaticamente.

O leitor interpreta TILESET, PALETTE, IMAGE, SPRITE e MAP com o layout dos
headers SGDK 1.81. Valida ponteiros/tamanhos antes de ler. Para SPRITE, percorre
animações/quadros e confere os máximos declarados de tiles e peças de hardware.
Paletas mostram as palavras compiladas de CRAM; suas atribuições/conflitos em
execução não são inferidos. MAP usa blocos de 128 px; IMAGE usa tiles de 8 px.
O campo de compressão de MAP tem códigos distintos para metatiles/blocos/índices.

## Registro após build da IDE

Os builds pelo botão da IDE e pelo caminho de ferramentas registram hashes em
`.retro-studio/builds/latest.json` após sucesso. São observados Makefile,
configuração, `src`, `inc`, `res`, `tools`, `maps`, `charset` legado, `charsets`,
`scenes` e `cutscenes`, além da ROM localizada e primeiro ELF existente.
O relatório compara arquivos alterados, removidos e adicionados com esse registro.
Se o ELF válido selecionado pelo relatório ou sua ROM diferirem dos artefatos
registrados, a associação fica explicitamente não comprovada.

O registro é publicado com backup e revisão; não modifica a ROM, ELF ou fontes.
Falha do diagnóstico não transforma um build bem-sucedido em falha. Build falho
ou cancelado preserva o último registro. Build externo por terminal/Makefile não
cria registro automaticamente. Metadados estrangeiros/inválidos não são adotados.

Hashes iguais significam correspondência aos arquivos observados, sem autenticar
o autor do registro nem provar recompilação. Fontes que mudaram durante o build
e inventário parcial são sinalizados. Pastas personalizadas, dependências externas,
arquivos ocultos e argumentos do compilador não estão cobertos; `freshness` e a
atribuição dos fontes compilados permanecem desconhecidas. Versão do SDK não é
deduzida do registro. O limite é 4096 arquivos/256 MiB em entradas padrão; cada
arquivo tem limite de 64 MiB e o registro JSON de 1 MiB. Leituras de caminhos
inválidos, symlinks e inventários além dos limites ficam indisponíveis/incompletos.

Dados de tiles sem compressão têm custo conhecido em ROM (`numTile × 32`).
Para dados comprimidos, esse campo fica desconhecido. Payloads e paletas podem
ser compartilhados; custos por recurso não são somados como propriedade exclusiva
da ROM. Recursos não ligados, não suportados ou inconsistentes têm diagnóstico.

## Plano opcional por projeto

A chave `hardwareBudget` é opcional em `retro-studio.json`. Sua presença
não altera o VDP nem o runtime. Ela descreve o plano do desenvolvedor, que deve
corresponder ao código do host. Projetos existentes não são migrados.

O formulário permite escolher H32/H40, leitor de estruturas, dimensões dos
planos, área de tiles, reservas e consumidores simultâneos. O salvamento
preserva outras configurações do projeto e usa a publicação transacional com
backup. Alterações externas ao arquivo bloqueiam o salvamento até recarregar.
Rascunhos ficam separados durante a troca de projetos com a janela aberta;
fechar a janela pede confirmação quando há alterações não salvas e é bloqueado
durante o salvamento. Rascunhos não são recuperação durável após fechar o
workspace ou a aplicação; esse fluxo pertence à issue #52. JSON ou orçamento
com estrutura inválida são apresentados sem edição, preservando o arquivo
para correção. Não há escrita automática ao abrir a janela.

```json
{
  "hardwareBudget": {
    "resourceAbi": "sgdk-1.81",
    "videoMode": "H40",
    "planes": { "width": 64, "height": 32 },
    "tileArena": { "start": 512, "bytes": 45568 },
    "reservations": [
      { "id": "system", "start": 0, "bytes": 512 },
      { "id": "font", "start": 46080, "bytes": 3072 },
      { "id": "planeB", "start": 49152, "bytes": 4096 },
      { "id": "window", "start": 53248, "bytes": 4096 },
      { "id": "planeA", "start": 57344, "bytes": 4096 },
      { "id": "hscroll", "start": 61440, "bytes": 1024 },
      { "id": "spriteTable", "start": 62464, "bytes": 640 }
    ],
    "consumers": [
      { "resourceId": "GAME_MAP_TILES", "mode": "tiles-resident", "instances": 1 },
      { "resourceId": "GAME_MAP_FG_TILES", "mode": "tiles-resident", "instances": 1 },
      { "resourceId": "NINJA", "mode": "sprite-stream", "instances": 1 }
    ]
  }
}
```

Os endereços do exemplo correspondem ao planejamento de um layout padrão SGDK
com planos 64×32 e font de 96 tiles. Confirme os endereços/tamanho de window,
scroll e tabela de sprites definidos pelo host antes de utilizar o plano.
Trocar H40/H32 no JSON não muda os registradores: apenas muda os limites
informados. Planos 32/64/128 são aceitos até 4096 células por plano.

Um consumidor `sprite-stream` reserva `maxNumTile × instâncias simultâneas`;
todos os quadros reutilizam essa área. `maxNumSprite` é o máximo de peças VDP
por instância, distinto da quantidade de personagens lógicos. Um consumidor
`tiles-resident` usa `numTile × instâncias`. Origem e símbolo aparecem em cada
linha. Recursos desconhecidos mantêm o total desconhecido, sem substituir por zero.

O relatório aponta reservas sobrepostas, sobreposição da área de tiles,
tiles acima da área declarada, total acima de 64 KiB e limite da tabela
de sprites. Esses avisos sugerem reduzir tiles únicos, instâncias ou peças
por quadro, ou corrigir o layout. Não representar versões alternativas de um
mesmo buffer como consumidores simultâneos: no skeleton, FG e overlay de colisão
compartilham espaço; planeje o maior deles, em vez de somar os dois.

O gráfico mostra **reservas declaradas**, não ocupação medida. Áreas vazias não
significam memória livre. DMA por frame, sprites/pixels por linha, palette
assignment, stack/heap e layout em execução precisam da telemetria #56.
Prova de dependências/fontes usados pelo compilador, inspeção visual da janela e
métricas efetivas em execução ainda são trabalhos pendentes; não considerar a
issue #51 concluída.

## Limites e verificação

Cada ELF/ROM tem limite de 64 MiB; no máximo 2048 seções e 100 mil símbolos.
Leituras indiretas de estruturas têm limite de 100 mil operações/32 MiB.
São aceitos até 128 arquivos .res, 4 MiB de declarações no total, 512
declarações, 256 animações/8192 quadros por recurso, 128 reservas/consumidores.
Arquivos/pointers inválidos e caminhos fora do projeto não são executados/lidos.

```bash
node scripts/smoke-compiled-resources.mjs
node scripts/smoke-hardware-dialog.mjs
node scripts/smoke-hardware-budget-editor.mjs
node scripts/smoke-build-snapshot.mjs
node scripts/smoke-compiled-resources.mjs --sgdk /caminho/do/m68k-elf
```

O teste sintético verifica limites, entradas malformadas, confinamento, RAM
estendida, dados compilados versus grade, orçamento por instância e campos
desconhecidos. O teste SGDK opcional cria arte original em pasta temporária,
compila com ResComp e lê o ELF real: ROM de 655360 B, RAM estática de 2846 B,
sprite com dois quadros e reserva de quatro tiles no SDK local 1.81.
Isso não comprova apresentação visual da janela nem consumo durante execução.

O teste hardware-dialog compila o script real do componente em uma fixture Vue
com host/template mínimo. Verifica troca de projeto, reset do leitor escolhido,
respostas tardias e fechamento antes de remover o dialog. Não comprova foco
nativo ou layout visual do navegador.

O teste hardware-budget-editor verifica o script real do formulário: rascunhos
por projeto, conflito externo, falha de disco, respostas tardias e confirmação
de fechamento. O teste de recursos também verifica preservação das demais
configurações, revisões, saves sem mudanças, arquivo ausente, JSON inválido e
symlinks. Esses testes não comprovam apresentação visual no Electron.

O teste de registros verifica hashes, mudanças de fontes e ROM, diferenças
durante o build, autoria em charsets/scenes, confinamento e metadados inválidos.
Em Linux/macOS executa o caminho de build para ferramentas com make real em
fixture própria; sucesso registra e falha preserva o registro anterior. O teste
SGDK opcional associa a ROM e ELF reais exibidos aos hashes registrados. O botão
da IDE foi verificado por integração estática/build, sem acionamento visual.

## Ações sugeridas e recursos de som (#51)

O relatório lista **ações sugeridas** a partir de dados lidos da ROM compilada,
cada uma com o símbolo e o arquivo de origem do recurso. Estimativas de autoria
nunca geram sugestão.

| Sugestão | Quando aparece |
|----------|----------------|
| Tiles sem compressão | `TILESET` ou `IMAGE` com 128 tiles ou mais e compressão 0. |
| Muitos tiles únicos | `IMAGE` com 1200 tiles ou mais. |
| Muitas peças de hardware | `SPRITE` cujo maior quadro usa 8 ou mais sprites de hardware. |
| Quadro grande | `SPRITE` cujo maior quadro usa 96 ou mais tiles por instância. |
| Som grande | `XGM` ou `WAV` com 256 KiB ou mais. |
| RAM estática alta | Mais de 48 KiB dos 64 KiB do console. |
| ROM acima de 4 MiB | Exige mapeador de bancos. |

Recursos `XGM` e `WAV` passam a aparecer como compilados, com o custo em ROM. O
rescomp não grava o tamanho desses símbolos, então o valor é a distância até o
próximo símbolo global da seção: um **limite superior**, mostrado como “até N
bytes”. O relatório de áudio (AUDIO_RUNTIME.md) estima o mesmo custo pela
duração do original.

Medições em execução (CPU por quadro, fila de DMA, sprites em uso) não fazem
parte deste relatório: vêm do diagnóstico em jogo (DEBUG_RUNTIME.md).
Inspeção visual: `node scripts/preview-runtime-panels.mjs --hardware-report
<relatório.json>` e `?panel=hardware`.
