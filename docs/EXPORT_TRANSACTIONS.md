# Publicação de derivados — issues #42 / #46

`publishProjectOutputs` publica até 128 arquivos e 32 MiB de saídas por transação.
Antes de publicar, preserva snapshots dos bytes antigos e novos em
`.retrostudio/export-transactions/<id>/`, com journal e hashes SHA-256.
Backups também são limitados a 32 MiB. Arquivos idênticos mantêm o mtime.
Caminhos relativos não podem usar symlinks, arquivos especiais ou sair do projeto.

Um lock exclusivo serializa os escritores que usam esta API. O build deve
aguardar seu resultado: renames de vários arquivos não constituem uma operação
atômica única do filesystem. Escritores externos não respeitam esse lock.
Se algum passo falhar, as saídas já publicadas são restauradas; alterações
externas detectadas são preservadas, mantendo lock e snapshots para recuperação.

O lock deixado por interrupção ou conflito bloqueia futuras transações.
Recursos → Uso dos recursos mostra a pendência e permite recuperação explícita
com confirmação nativa. Valida hashes, snapshots e processo proprietário; não
restaura enquanto o exportador está ativo. Conflitos externos impedem a operação,
preservando arquivos. Não apagar o lock ou snapshots automaticamente. Charset Maker já publica cinco saídas conjuntamente: PNG, resources.res,
header de animações, projeto v4 e inventário. Confere revisões antes de escrever.
Autosaves são suspensos durante exportação; saves anteriores são drenados.
Ainda falta integrar exports de mapas e cutscenes e coordenar builds pelo mesmo protocolo.

Novos atlas raster são publicados junto ao ledger
`.retrostudio/generated-assets.json`. Registro inclui caminho, hash, tamanho,
produtor e data da criação. Imagem existente, mesmo com nome/hash correspondente,
não é adotada como propriedade da IDE. Um registro cujo arquivo desapareceu
exige recuperação; não se recria silenciosamente.
Originais e charsets não são registrados nesse ledger.

Snapshots ficam preservados; política de retenção e quarentena ainda pendente.
Esta fundação não concede autoridade para excluir imagens e não conclui #46.

Recuperações usam claims imutáveis por tentativa. Claims de processos encerrados
não bloqueiam retomada; claims de processos vivos impedem tentativas concorrentes.
Claims órfãos permanecem como diagnóstico, sujeitos à política de retenção futura.

Skeletons novos declaram mapExport.outputProtocol=retro-studio-map-outputs-v1.
O exportador escreve em staging via RETROSTUDIO_EXPORT_STAGE; a IDE publica apenas
as sete saídas conhecidas após geração bem-sucedida e checagem das revisões.
Falha no script preserva saídas anteriores. Scripts antigos sem declaração
continuam no fluxo existente: a IDE não presume que suportam staging.
Invocar tools/export-map.py diretamente pelo Makefile ainda usa escrita direta;
coordenação de builds e integração desse caminho continuam pendentes em #46.

Antes de publicar o lock, grava journal preparing e metadados completos.
Queda durante snapshots recupera sem tocar outputs, pois publicação só começa
após prepared. Testes cobrem encerramento do processo nessa janela.
Não constitui garantia contra perda de energia do dispositivo de armazenamento.

Lotes integralmente idênticos conferem revisões sob o mesmo lock de escrita;
retornam transactionId/journalPath nulos, sem snapshots; metadata provisória é removida após liberar o lock. Lotes
com qualquer alteração continuam no fluxo completo com lock e rollback.

Mapas com outputProtocol v1 conferem script, configuração e sourceMaps antes/depois
do Python. inputPaths declara diretórios/arquivos adicionais; skeleton usa maps,
res e charsets. Mudança de hash/listagem aborta publicação, preservando derivados
anteriores. Limites: 64 entradas declaradas, 8192 itens, profundidade 32,
32 MiB por arquivo e 128 MiB total; symlinks/special/escapes são recusados.
Outputs fixos usam revisões próprias e não entram no snapshot de fontes.
Custom scripts precisam declarar suas entradas; não é descoberta automática de
dependências. A configuração lida pela IDE é conferida antes de preparar staging.
O guard cobre mudanças entre preparação e verificação final, sem prometer snapshot
atômico de arquivos alterados por ferramentas externas que não usam o lock da IDE.

## Estado das exportações (#46)

Recursos → Runtime → **Estado das exportações…** mostra, em uma só tela e sem
alterar nada, cada exportação gerenciada do projeto:

| Estado | Significado |
|--------|-------------|
| Exportado e em dia | A fonte salva gera exatamente os arquivos que estão no projeto. |
| Desatualizado | A fonte (ou algo de que ela depende, como um mapa) mudou depois da última exportação. |
| Salvo, não exportado | Existe a fonte, mas os arquivos gerados ainda não. |
| Alterado fora da IDE | Um arquivo gerado foi editado à mão; ele é preservado e nada o sobrescreve. |
| Falhou | A fonte não pôde ser lida ou validada (JSON inválido, arquivo original ausente...). |
| Não usado | O projeto não tem essa fonte; nada é exigido. |

Exportações cobertas: salas e mapas do mundo, controles, física, câmera, áudio,
progresso, cenas (cutscenes), gatilhos e flags de cutscene, e diagnóstico. As
que têm conferência antes do build (mundo, câmera, áudio, progresso, gatilhos e
diagnóstico) aparecem como “bloqueia o build” quando não estão em dia; controles,
física e cenas só avisam, porque o build não as confere.

Salvar pelo editor e compilar usam o mesmo caminho: os editores publicam os
arquivos pela transação descrita acima, e o build (pela IDE ou por `make`) lê
esses mesmos arquivos; o Makefile do skeleton só regenera mapa único e cenas
com os compiladores distribuídos, os mesmos que a IDE usa.

Limites: a tela não inclui o mapa único exportado por `tools/export-map.py`
(o editor de mapas informa o resultado ao salvar) nem recursos de personagens,
que são publicados na hora pelo Charset Maker. `node scripts/smoke-export-overview.mjs`
cobre todos os estados em um projeto real.
