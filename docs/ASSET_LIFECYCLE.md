# Recursos e derivados — issue #42
Mapas completos importados geram atlas PNG em res/generated/raster-<SHA-256>.png.
O SHA representa os bytes do atlas codificado; o backend verifica essa identidade.
Reinserir conteúdo idêntico reaproveita arquivo e tileset sem regravar o PNG.
Arquivos com timestamps já existentes permanecem: não são apagados automaticamente.
Originais/charsets não mudam de nome nem são quantizados por esta etapa.

Recursos → Uso dos recursos mostra referências em mapas, kits, charsets, .res e
símbolos de recursos usados em C/assembly. Inventário de assets e manifestos de saída
não contam como uso no jogo. Duplicatas indicam conteúdo de arquivo igual, não
equivalência visual entre PNGs com codificação diferente.
Pastas generated sugerem localização de derivados, não prova de propriedade.

Scanner ignora diretórios de build e dependências, não segue symlinks e limita
20.000 entradas, profundidade 64, texto por arquivo 1 MiB, texto total 32 MiB,
hash por arquivo 32 MiB e hashes totais 128 MiB.
Scripts/builds podem construir referências dinamicamente; arquivos omitidos são
informados. Sem referência conhecida significa uso não verificado, não descartável.
A leitura não concede autoridade de exclusão automática. Novos atlas raster
recebem registro de propriedade no ledger .retrostudio/generated-assets.json.
Imagens preexistentes não são adotadas; charsets/originais ficam fora desse ledger.

A escrita de assets limita o buffer a 32 MiB, rejeita caminhos fora do projeto,
symlinks de destino e arquivos especiais; usa arquivo temporário e rename.
Atlas + ledger são publicados em transação. Charset Maker também publica
PNG, resources.res, header, projeto e inventário conjuntamente. Ver EXPORT_TRANSACTIONS.md.

O relatório limita a análise a 100.000 ligações de referência e mostra no máximo oito caminhos de duplicatas por recurso, mantendo a contagem total. Ao atingir limites, não conclui ausência de uso.

## Quarentena manual
Recursos → Uso dos recursos permite selecionar até 20 atlas raster registrados,
com hash/tamanho conferidos e sem referências conhecidas, até 24 MiB por lote.
Confirmação nativa lista os caminhos; quando scripts/arquivos omitidos existem,
informa que referências dinâmicas podem escapar da análise. Não existe limpeza
automática nem exclusão definitiva.

A ação preserva os bytes em .retrostudio/asset-trash/<id>/files/, remove
os originais do local de exportação e ajusta ledger/inventário na mesma transação.
Manifest registra propriedade e metadados necessários à restauração. Em falha,
rollback restaura as saídas anteriores; recuperação de interrupções está no painel.

Restaurar reintroduz os arquivos e mescla o inventário com a configuração atual,
preservando edições recentes. Destinos existentes, IDs conflitantes, bytes alterados
ou ledger inválido impedem a operação. Os arquivos de quarentena continuam
preservados depois de restaurados; retenção/limpeza permanente ainda pendentes.

Esta etapa só registra atlas raster novos. Expandir ownership para outras
famílias de derivados e registrar proveniência completa continua pendente em #42.

## Catálogo: papel, dono, origem e destino na limpeza (2026-10-10)

Recursos → Uso dos recursos mostra, para cada arquivo de recurso do projeto:

| Campo | Valores | De onde vem |
|---|---|---|
| Papel (`role`) | `original`, `charset-source` (folha de personagem), `charset-output` (saída de personagem), `derived`, `generated-unknown` (em pasta `generated/`, sem dono) | registros do projeto, nunca do nome do arquivo |
| Dono (`owner`) | `raster-import`, `character-export`, `world-map-export`, `map-export` ou nenhum | ledger `.retrostudio/generated-assets.json`, `.retrostudio/world-map-export.json`, `res/generated/map-manifest.json`, `charsets/*.charset.json` |
| Origem (`origin`) | importado de um arquivo (nome e data), gerado por um produtor, folha/saída de um projeto de personagem | `.retrostudio/asset-origins.json` e os registros acima |
| Uso (`references`) | mapas, kits, personagens, `.res`, símbolos em C/assembly e literais em scripts | leitura do projeto (limites descritos acima) |
| Limpeza (`disposal`) | `never`, `in-use`, `unknown-owner`, `manual-review`, `candidate` | regras abaixo |

Regras de limpeza:

- Originais, folhas e saídas de personagem são `never`: a quarentena recusa esses arquivos
  mesmo que alguém os envie pela IPC.
- `candidate` só existe para derivado registrado no ledger, com conteúdo conferido, sem
  referência conhecida **e** em projeto onde a leitura entende todos os arquivos. A leitura
  entende `.json`, `.tmx`, `.tsx`, `.res`, `.c`, `.h`, `.s`, `.asm`, os próprios recursos e
  documentação (`.md`). Qualquer outro arquivo — script, makefile sob qualquer nome, `.inc`,
  `.cpp`, lista de texto, binário desconhecido — entra em “não analisados”: o que ele cita
  conta como uso e a simples presença dele muda o estado para `manual-review`. Como todo
  projeto SGDK tem Makefile, na prática a limpeza é sempre revisada por uma pessoa.
- Só as pastas de ferramenta na raiz (`.git`, `.retrostudio`, `out`, `build`,
  `node_modules`) ficam fora da leitura; pastas com esses nomes dentro do projeto são lidas.
- Um registro de exportação só dá dono a um arquivo que aquele produtor pode gerar (pelo
  padrão do nome) e cujo conteúdo ainda confere com o hash registrado.
- Saída de exportação de mapas tem dono, mas é refeita pela própria exportação e não entra na
  quarentena (`unknown-owner` para a limpeza).
- A limpeza continua manual: seleção → prévia nativa com caminhos, tamanhos e total →
  quarentena restaurável. Não há exclusão definitiva.

## Importação sem sobrescrita e sem acúmulo

Vale para “Importar” (arquivo escolhido), arrastar/colar imagens, fundo de mapa e mapa em
imagem de kit (a busca por conteúdo igual olha a pasta de recursos, sem subpastas, e arquivos
da mesma extensão):

- conteúdo idêntico já presente na pasta de recursos é reaproveitado; nada é copiado;
- nome livre: o arquivo entra com o próprio nome;
- nome ocupado por outro conteúdo: o arquivo existente é preservado e o novo entra como
  `<nome>-<8 dígitos do SHA-256>.<ext>`. O nome vem do conteúdo, então importar de novo cai
  no mesmo arquivo;
- mapa em imagem de kit usa `map-kit-<nome>-<12 dígitos do SHA-256>.png` (antes o nome levava
  data e número aleatório, e cada reimportação criava outro arquivo);
- a linha em `resources.res` é acrescentada uma única vez (um arquivo já declarado, inclusive
  como `"./nome.png"`, não ganha outra linha) e o final de linha do arquivo é preservado. Em
  “Importar”, símbolo já usado por outro arquivo recebe sufixo do hash; em arrastar/colar, o
  registro é recusado com aviso em vez de trocar a linha do outro arquivo;
- nomes com aspas ou com `< > : | ? *` são recusados; a pasta de recursos não pode ser a raiz
  do projeto nem uma pasta oculta (`.git`, `.retrostudio`…);
- arrastar um arquivo para a árvore de arquivos não substitui um arquivo de mesmo nome com
  outro conteúdo (a exportação de kit continua reescrevendo a própria pasta `kit-assets-*`);
- pacotes da loja são extraídos à parte e mesclados arquivo a arquivo: o que já existe com
  outro conteúdo é preservado e listado para o usuário;
- reimportar a mesma imagem em um kit reaproveita a entrada do catálogo do kit.

Arrastar imagens do sistema (`.png`, `.gif`, `.jpg`, `.jpeg`, `.bmp`) para qualquer parte da
janela, com um projeto aberto, importa pelo mesmo caminho de “Importar”: a imagem vai para a
pasta de recursos, ganha uma linha `IMAGE` em `resources.res` e entra na lista de Recursos, com
as mesmas regras acima (conteúdo igual é reaproveitado; nome ocupado por outro conteúdo recebe
sufixo). Ficam de fora a árvore de arquivos (soltar ali copia o arquivo para a pasta escolhida,
sem registrar) e as janelas abertas por cima; arquivos que não são imagem são ignorados com aviso.

“Importar” publica arquivo, `resources.res` e registro de origem em uma transação
(`electron/retro/assetImport.js`). Limite: 30 MiB por arquivo.

### `.retrostudio/asset-origins.json`

```json
{ "version": 1, "assets": [
  { "path": "res/heroi.png", "hash": "<sha-256>", "size": 1234,
    "sourceName": "heroi.png", "importedAt": "2026-10-10T12:00:00.000Z" } ] }
```

Só o nome do arquivo de origem é guardado: o caminho absoluto da máquina que importou não
serviria em outra máquina e exporia o nome do usuário. Se o arquivo for editado depois, o
catálogo mostra “alterado depois da importação”. Um registro inválido é informado e não é
reescrito; importações ficam recusadas até ele ser corrigido ou removido.

## Portabilidade entre máquinas

- Projetos de personagem (`*.charset.json`) guardam a folha como caminho relativo à raiz do
  projeto (`shared/retro/portablePath.js`). Projetos antigos, com caminho absoluto, continuam
  abrindo e passam ao formato relativo no próximo salvamento. Um projeto antigo copiado para
  outra máquina é reconhecido pelo final do caminho (`…/res/heroi.png` → `res/heroi.png`
  neste projeto), desde que a folha esteja em uma pasta do projeto.
- Mapas já guardavam fundo, paralaxe e tilesets relativos ao arquivo do mapa.
- O catálogo lista “Caminhos que não funcionam em outra máquina”: caminhos absolutos e
  relativos que saem do projeto (`../../fora/fundo.png`) em `.json`, `.tmx`, `.tsx`, `.res`,
  no inventário de `retro-studio.json` e folhas de personagem fora do projeto. Fundo e
  paralaxe de mapa escolhidos fora do projeto aparecem aqui.

## Limites desta etapa

- Folha de personagem fora do projeto não fica portátil sozinha: a IDE aponta, mas não copia o
  arquivo para dentro do projeto.
- Arquivos importados antes desta versão não têm registro de origem (aparecem como
  “Original”, sem origem).
- Arquivos com timestamp no nome criados por versões anteriores permanecem; nada os remove.
- Substituir um mapa em imagem do kit deixa o arquivo anterior no projeto (é um original).
- Quarentena continua restrita a atlas raster do ledger; retenção/exclusão definitiva da
  quarentena não existe.
- Substituir a imagem de um mapa do kit deixa a cópia anterior na pasta exportada do kit.
- Os handlers de importação não conferem se o projeto recebido é o workspace aberto (a
  quarentena confere); cada importação deixa uma cópia em `.retrostudio/export-transactions/`,
  sem retenção automática.
- Em macOS (sistema de arquivos que não diferencia caixa) um caminho com caixa diferente da
  raiz continua sendo guardado como absoluto.
- Verificado por testes de serviço e pela tela em fixture com Chrome headless; a IDE Electron
  real e o diálogo nativo de confirmação não foram exercitados.
