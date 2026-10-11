# Salas, saídas e checkpoints — issue #55

O módulo opcional `world` v1 depende de `core`. O instalador distribui
`retro_world.h/.c` com o mesmo controle de versões, hashes e backups dos outros
módulos. Instalar não substitui o gerenciador de fases de Alice/Tempo, não
reescreve `main.c` e não declara que o game já consome esse runtime.

## Fonte do grafo

`shared/retro/worldConfiguration.js` define `retro-studio.world`, versão 1.
Um grafo tem salas, condições e uma entrada inicial. Cada sala referencia um
TMX relativo ao projeto, dimensões em pixels, entradas, saídas e checkpoints.
Entradas/checkpoints são posições dos pés com `facing`: false direita, true
esquerda. A área de um checkpoint é seu gatilho; a posição dos pés define onde
renascer. Saídas têm área, sala/entrada de destino e lista de condições por ID.

```json
{
  "format": "retro-studio.world",
  "version": 1,
  "initial": {"room": "hall", "entry": "spawn"},
  "conditions": [],
  "rooms": [{
    "id": "hall", "name": "Entrada", "map": "maps/hall.tmx",
    "width": 320, "height": 224,
    "entries": [{"id": "spawn", "x": 24, "y": 160, "facing": false}],
    "checkpoints": [], "exits": []
  }]
}
```

IDs são strings ASCII de até 64 caracteres, começando com letra; aceitam
letras, números, `_` e `-`. Um hash FNV-1a reduzido a 0..65534 produz IDs C.
Colisões são recusadas explicitamente; não há renumeração por posição na lista.
Salas/condições têm IDs globais; entrada, saída e checkpoint têm escopo da sala.
Renomear um rótulo não altera o ID. Ordenar listas não altera o header C.

Limites: 64 salas, 64 condições, 128 itens de cada tipo por sala e 16 condições
por saída. Dimensões chegam a 32767 pixels; X dos pés deve estar em [0,width),
Y em [0,height]. Áreas ficam inteiramente dentro do mapa. Destinos, entrada
inicial, IDs repetidos/colidentes e condições desconhecidas são recusados.

## Editor na IDE

Abra **modo Jogo → Salas e conexões**. A barra superior adiciona um
TMX de `maps/` ao mundo e escolhe sala/entrada inicial. O grafo mostra as
conexões; os botões abaixo permitem selecionar salas pelo teclado. O inspector
edita nome, mapa, posições e orientação das entradas, áreas de saída,
destinos e checkpoints. Condições de passagem ficam abaixo do grafo.

Os IDs são apresentados e permanecem fixos durante a edição; alterar nomes
ou reordenar os dados não os renumera. Uma sala/entrada/condição referenciada
não pode ser removida até que suas conexões sejam ajustadas. Não é permitido
remover a última entrada ou a última sala de um mundo exportável. Trocar mapa
atualiza dimensões e mantém coordenadas; posições fora do novo mapa bloqueiam
exportação até serem ajustadas. Os TMX não são modificados por esse editor.

**Salvar e exportar mundo**, ou Ctrl/Cmd+S, publica fonte e header validados.
Alterações inválidas, revisão antiga e header personalizado bloqueiam a ação.
Rascunhos da sessão são separados por projeto e preservados ao desmontar a
tela. Escape/Fechar não descartam alterações; os botões de descarte são
explícitos. Falhas de disco preservam o rascunho; respostas de outro projeto
não substituem a tela atual.

O catálogo percorre apenas diretórios regulares em `maps/`, sem seguir links,
com limites de 256 candidatos, 4096 entradas, profundidade 16 e 32 MiB lidos no
total. TMX acima de 4 MiB é recusado antes da leitura. Mapas inválidos e erros
de acesso são avisos do catálogo, sem invalidar um salvamento concluído.
Mapas já referenciados fora do catálogo continuam disponíveis na seleção.

## Publicação

`electron/retro/worldConfiguration.js` oferece status e publicação transacional:

- `world/world.json`: fonte completo, mantendo propriedades adicionais.
- `src/generated/world_config.h`: salas, entradas, saídas, checkpoints,
  definição inicial, referências aos caminhos TMX e áreas de gatilho.
- `.retrostudio/world-export.json`: propriedade do header e hashes dos mapas.

O salvamento pela IDE usa `saveWorldConfigurationWithMaps`: prepara os mapas
com o compilador distribuído e publica fonte, header do grafo, imagens, headers
das salas, declarações de recursos e `.retrostudio/world-map-export.json` na
mesma transação. Uma falha restaura a geração anterior; um lote idêntico valida
as revisões e não cria snapshots. O helper síncrono `saveWorldConfiguration`
continua disponível para autoria/exportação apenas do grafo e fixtures legadas.

Instale/atualize `world-sgdk` e `collision` em modo Jogo antes de
exportar os mapas. O backend executa somente os dois compiladores distribuídos
em scratch isolado, com snapshot limitado dos dados do projeto; scripts do game
não são executados. Entradas alteradas durante compilação/publicação, runtime
alterado, symlinks, recursos duplicados e arquivos gerados sem propriedade ou
personalizados recusam o lote, preservando fonte e derivados anteriores.

Declarações gerenciadas são atualizadas na sua posição original. Declarações
manuais e comentários são conservados, incluindo MAPs que dependem de TILESETs
mundiais. Símbolos em IMAGE/BIN/áudio também participam da detecção de colisões.
Uma dependência MAP/TILESET fora de ordem bloqueia a exportação antes de escrever.
Arquivos e declarações antigos permanecem retidos até reconciliação do ciclo
de assets; remover uma sala atualiza o grafo/bindings, sem apagar possíveis
consumidores externos dos recursos antigos.

Sprites por hash já pertencentes ao exportador de mapa único podem ser
compartilhados quando manifesto, bytes existentes, bytes gerados e declaração
exata concordam. Esse caminho não adota arquivos personalizados sem propriedade
nem duplica o PNG/SPRITE. O manifesto legado é revalidado até a publicação.

A transação do produtor `world-map-export` aceita até 1024 saídas para cobrir
as 64 salas; os outros produtores mantêm o limite de 128. Recuperação usa os
mesmos limites por produtor. O limite total de escrita e backup segue 32 MiB.
O registro de propriedade admite até 1024 arquivos e 1024 declarações e 1 MiB;
exceder esses limites bloqueia a publicação, mantendo o registro anterior.

Só TMX finitos e ortogonais são aceitos nessa integração. O backend confere
caminhos confinados, arquivos regulares, existência e dimensões do elemento
raiz; não executa XML/DTD/entidades. Isso não valida todo o conteúdo TMX, que
continua sob responsabilidade do exportador de mapas. Dimensões discrepantes
aparecem em `mapError` e bloqueiam publicação. Fonte/header inválido, versão
futura, revisão antiga ou header manual não são sobrescritos.
Cada mapa tem limite de 4 MiB; as entradas de mapa do mundo somam no máximo
28 MiB, com margem para fonte/header/registro na transação de 32 MiB.

Mapas entram como entradas idênticas na transação. Seus hashes são conferidos
antes de cada publicação; uma alteração detectada desfaz fonte/header/registro
já publicados. Os TMX e propriedades `target`/`requires` das saídas antigas
permanecem com os mesmos bytes. Não existe conversão automática dessas saídas
para o novo grafo. O registro de proveniência não modifica scripts de build
customizados nem instala o módulo automaticamente.

## Validação no build

Os caminhos de build da IDE (`game.js`) e da IA (`buildForTools.js`) chamam
`validateWorldForBuild` antes do `make`. A existência de `world/world.json`
ativa a integração; projetos sem essa fonte seguem o fluxo legado, inclusive
quando há um header customizado com o mesmo nome. Não há migração automática.

A validação exige grafo válido, mapas existentes com dimensões compatíveis,
header exportado gerenciado e bytes iguais ao resultado do compilador do
grafo atual. Não varre o catálogo nem executa o exportador de mapas. Destinos
inválidos ou header desatualizado geram erro antes de executar o `make`,
inclusive em builds com limpeza. Arquivos personalizados são preservados.

Após sucesso do `make`, a IDE confere a mesma assinatura de fonte/header/
registro e hashes dos TMX. Criação, remoção ou alteração do mundo nesse
intervalo bloqueiam o sucesso e a abertura automática do emulador. O registro
do último build válido permanece intacto. O `make` já pode ter criado uma ROM;
essa saída não é removida ou revertida automaticamente e exige um novo build.
Uma alteração que apareça e seja revertida entre as duas observações não é
detectada; a assinatura não é um bloqueio contra escritores externos.

Em mundos publicados pelo serviço combinado, o registro v2 também vincula a
geração à configuração, às entradas TMX/TSX/imagens, ao runtime instalado e aos
bytes das saídas ativas. O build verifica esses dados antes e depois do Make.
Entradas alteradas, imagens geradas editadas manualmente, recursos removidos ou
runtime alterado exigem uma nova exportação. Registros v1 precisam ser
reexportados; remover o registro mantendo `world_maps.h` não desativa o gate.

Salvar uma sala pertencente a um mundo gerenciado atualiza os recursos de todas
as salas, inclusive quando ela não aparece em `sourceMaps` do exportador legado.
Se a exportação falhar, o TMX salvo permanece e a geração anterior é preservada;
o próximo build recusa a geração desatualizada. A janela do mundo apresenta esse
erro e permite reexportar. Salas não vinculadas seguem o fluxo de mapas legado.

Mundos que publicam apenas o grafo, sem registro de recursos mundiais, continuam
com a validação anterior. Nesse modo, editar um TMX sem mudar dimensões não exige
reexportar o grafo; a atualização dos recursos depende do exportador do projeto.
Nenhum desses gates comprova que o game efetivamente consome o runtime.

Recibos em `.retro-studio/` e derivados conhecidos do mapa legado não fazem parte
da assinatura das entradas. O exportador legado distribuído preserva declarações
de sprites compartilhados ainda pertencentes ao mundo. Projetos com uma cópia
antiga de `tools/export-map.py` precisam atualizar essa ferramenta: o gate detecta
uma declaração removida depois do Make, mas não modifica scripts personalizados.
O inventário do build também registra `world/`, `physics/` e `controls/`.

## Runtime C e propriedade dos recursos

O host fornece `prepare`, `activate`, `release` e, opcionalmente, `allow`:

1. `prepare` prepara recursos do destino sem mudar o cenário ativo. Entrega um
   handle não nulo que passa a pertencer ao runtime. Em falha, esse novo handle
   é liberado; o handle da sala atual nunca deve ser emprestado como destino.
2. Depois de preparar, o runtime publica sala, posição e orientação novas.
3. `activate`, que deve ser infalível, aplica o destino e sua posição.
4. `release` libera apenas o handle e os recursos próprios da sala anterior.

Um callback não pode modificar o struct `RetroWorld` diretamente. Chamadas
reentrantes à API retornam BUSY. A definição, seus arrays e os hooks devem
permanecer válidos/imutáveis durante toda a vida do mundo. Sem heap, callbacks
SGDK implícitos ou alteração do sprite engine. O host deve definir propriedade
por handle para evitar que a liberação da sala antiga apague a nova.

```c
#include "generated/world_config.h"
RetroWorld world = {0};
RetroWorldHooks hooks = {prepareRoom, activateRoom, releaseRoom, allowCondition, context};
retroWorldInit(&world, &retroProjectWorld, &hooks);
/* Posição inicial: world.x/world.y são pixels, world.facing é orientação. */
/* Eventos/gatilhos do host chamam retroWorldExitThrough/retroWorldCheckpoint. */
```

`retroWorldEnter` usa uma entrada por ID. `retroWorldExitThrough` verifica todas
as condições antes de preparar o destino; sem `allow`, uma saída com condições
é recusada. Saída ausente, condição negada ou falha de preparação preserva o
estado anterior. Entrar/reaparecer na mesma sala reposiciona e chama `activate`
sem realocar ou liberar o handle.

`retroWorldCheckpoint` guarda sala+checkpoint por ID. Respawn carrega esse
checkpoint, inclusive de outra sala; sem checkpoint usa a entrada inicial.
Snapshot/restore versão 1 contém esses IDs, não uma posição arbitrária ou assets.
Uma falha de restore preserva a sala/checkpoint anterior. `retroWorldFree`
libera exclusivamente o handle atual. Host deve detectar colisão com áreas,
debounce de gatilhos, atualizar jogador/câmera e integrar recursos SGDK.
Não há gravação SRAM nem política automática de transição/fade.

## Ponte SGDK para salas compiladas

O módulo `world-sgdk` v2 depende de `world` e é distribuído pelo instalador
quando a seleção de módulos é omitida. Sua ativação permanece explícita:
instalar os fontes não modifica `main.c` nem o gerenciador existente do game.
Inclua `retro_runtime/retro_world_sgdk.h`, inicialize `RetroWorld` e
`RetroWorldSgdk` com zeros e forneça um `RetroWorldSgdkRoom` por sala do grafo.
Os bindings associam IDs numéricos aos `TileSet`/`MapDefinition` do ResComp.
Definição, bindings e recursos permanecem imutáveis durante toda a integração.

`retroWorldSgdkInitWithContent` adiciona três callbacks opcionais do host:
`prepare`, `activate` e `release`. A API `retroWorldSgdkInit` permanece disponível
sem conteúdo adicional. Quando fornecidos, os três callbacks são obrigatórios
e sua estrutura é copiada na inicialização.

O preparo ocorre depois das alocações de mapa e antes de mudar a sala ativa.
Um handle não nulo pertence ao destino mesmo se o preparo falhar; a ponte chama
`release` para desfazer essas alocações. Emprestar o handle ativo é recusado sem
liberá-lo. A falha retorna `RETRO_WORLD_LOAD_FAILED`, com `lastError` igual a
`RETRO_WORLD_SGDK_CONTENT`, preservando mapa e conteúdo anteriores.

O host deve manter sprites preparados ocultos e não executar `SPR_update`, DMA
ou VBlank durante o preparo. `activate` não pode alocar nem falhar: aplica o
conteúdo preparado antes de `onActivate`. Depois, `release` recebe somente o
handle antigo. Retornar à mesma sala reaplica o conteúdo sem prepará-lo novamente.
Os callbacks executam com `world->busy`; não podem reentrar nas mutações do mundo
nem resetar o sprite engine. O host continua responsável por paletas compatíveis
e orçamento para manter os sprites antigos e novos durante a preparação.

A ponte usa BG_B para cenário e BG_A para frente. Atributos de prioridade e
paleta do mapa são preservados. Os dois recursos da frente podem ser nulos;
entrar numa sala sem frente limpa BG_A. Cada slot de paleta recebe um ponteiro
para `Palette` e offset 0/16/32/48 cores, com pelo menos 16 cores disponíveis.
Um slot nulo conserva a paleta do host, por exemplo PAL1 do personagem.

O host configura tela H32/H40, planos 64×32, scroll por plano, DMA com
auto-flush, pelo menos 32 entradas e buffer de 4096 bytes. O limite de
transferência precisa ser zero ou pelo menos 4096 bytes. Também inicializa e
reserva o sprite engine. A preparação verifica a fronteira `TILE_SPRITE_INDEX`
antes de alocar; mapas e tiles descompactados do destino ficam separados dos
recursos atuais. Falha de preparação libera apenas o destino, preservando a
sala ativa. A ponte nunca reinicializa o sprite engine nem libera o personagem.

`retroWorldSgdkInit` recebe o grafo, bindings, callback `onActivate`, predicado
de condições e contexto. Init/transições usam os status de `RetroWorld`;
`bridge.lastError` distingue falhas de VRAM, memória e configuração VDP/DMA.
O callback infalível aplica posição dos pés e orientação ao controlador/sprite
do host. `retroWorldSgdkScroll` retorna status próprios da ponte, limita a câmera
à sala e deve ser chamado com fila DMA vazia antes de `SPR_update` e dos outros
produtores DMA. O host executa `SYS_doVBlankProcess` antes da próxima chamada.

Movimento entre metatiles adjacentes usa streaming circular do SGDK. Ativação
e saltos de câmera maiores que um metatile fazem redraw completo com display
desligado e VBlanks por plano. Essas operações são bloqueantes e não devem ser
chamadas de interrupções. Callbacks VBlank e outros produtores DMA precisam
respeitar `world.busy`, suspendendo seu trabalho durante operações da ponte.
O bloqueio também recusa transições/liberação reentrantes durante redraw.
`retroWorldSgdkFree` ou `retroWorldFree` libera os handles atuais e desativa a
ponte. Recursos emprestados, paletas do host e sprite engine são preservados.

## Verificações e trabalho restante

`smoke-runtime-world.mjs` executa C real: inicialização/saídas, condições,
preparação falha, cleanup, rejeição de alias do handle ativo, ordem dos callbacks,
reentrada, checkpoint, respawn na mesma sala, restore e liberação. Opção
`--m68k-cc <compilador>` compila o módulo para 68000.

`smoke-world-configuration.mjs` cobre fonte/header/C, IDs estáveis e colidentes,
limites, destinos quebrados, caminhos/dimensões, TMX legado intacto, isolamento,
revisões, alteração de mapa durante exportação, symlink e header manual/futuro.
Compilação de um caminho com `??/` prova escape dos trigraphs em C99 e preserva
os bytes do caminho. `--m68k-cc` também compila o header gerado para 68000.
Empacotamento importa o serviço sem `src/` da IDE.

`smoke-world-editor.mjs` executa o script Vue real: criação de salas e itens,
IDs, remoções protegidas, falha de escrita, rascunhos por projeto, respostas
tardias, conflito externo, descarte e recarga após salvar um rascunho editado.
`preview-world-editor.mjs` serve a interface real com IPC somente em memória.
Essa fixture foi exercitada em 1280×900 e 720×720, incluindo erro e retry de
save; não substitui a execução Electron nem comprova carregamento SGDK.

`smoke-world-build.mjs` executa os dois caminhos de produção com `make` real em
projetos temporários e settings/IPC do Electron substituídos pela fixture.
Cobre bloqueio antes da compilação, alterações durante `make`, assinatura,
recibo anterior, guarda do emulador e opt-out legado. O emulador do teste é um
script de marcação, sem fidelidade gráfica/hardware.

`smoke-runtime-world-sgdk.mjs` compila e executa a ponte C com spies SGDK:
rollback de preparação, fronteira VRAM, paletas/offsets, prioridades, remoção
da frente, liberação própria, câmera/fila DMA, checkpoint e reentrada em VBlank.
`--sgdk <raiz>` também compila com os headers SGDK reais para 68000.

`smoke-world-diagnostic.mjs` gera um projeto isolado com duas salas, frente,
sprite persistente, saída condicionada e checkpoint. `--sgdk <raiz>` compila
uma ROM real; `--artifacts <pasta-nova>` conserva fontes e ROM fora dos games.
A ROM compilou no SGDK 1.81 com 655360 bytes. Agora a fixture usa TMX serializados
pelo editor, o compilador de mapas abaixo e os bindings realmente gerados.
O exemplo mantém navegação simples, sem aplicar física/colisões ao personagem;
não comprova apresentação no emulador. A publicação pelo backend tem regressão
própria descrita abaixo.

## Compilação dos mapas do grafo

O skeleton distribui `tools/export-world-maps.py`. Ele compila cada TMX
referenciado em `world/world.json` com a mesma composição, prioridade, paletas,
colisões, rampas e visuais do exportador de mapa único. O compilador reutiliza
`export-map.py` com um writer em memória; o fluxo de mapa único permanece igual.
O comando exige `--stage <pasta-nova>`: gera saídas em um diretório novo e não
publica alterações nos arquivos do projeto. Erros de compilação ocorrem antes
de criar esse diretório. O backend da IDE publica os bytes depois da compilação.

Saídas incluem `world_room_<ID>.h`, `world_room_<ID>_objects.h`, imagens
`world-<ID>-*.png`, `world_maps.h`, fragmento `world-resources.res` e manifesto
com hashes. IDs numéricos seguem o mesmo FNV do grafo. Símbolos de mapa, macros
de hitbox e guardas recebem namespace por sala, permitindo incluir todos os
headers no mesmo consumidor C. Visuais idênticos podem compartilhar recursos
por hash. O header central oferece bindings SGDK e geometria por ID; a frente
vazia usa ponteiros nulos. PAL1 permanece sob controle do host.

Cada `RetroWorldMapGeometry` também contém `body`, `frameWidth` e `frameHeight`.
`body` converte a caixa de autoria (origem no canto superior esquerdo do sprite)
para origem nos pés, no centro inferior: `x - frameWidth/2`, `y - frameHeight`.
Isso permite ao host trocar a caixa física junto com os colisores e rampas da
sala, sem misturar coordenadas de câmera. As dimensões descrevem o quadro
configurado em `mapExport.playerFrame`; o host deve usar arte compatível.

A fixture `runtime-world-sgdk.c` seleciona a geometria pelo ID no callback de
ativação e reinicia `RetroMovement` na entrada/respawn. O tick consome somente
o terreno dessa sala; gravidade, chão e salto usam o solver distribuído. A caixa
também limita o personagem às bordas horizontais da sala. É um exemplo de host,
sem integração automática em `main.c` de jogos existentes. Cada sala da fixture
usa bindings por ID gerados para todos os objetos visuais do TMX: dois slots
`RetroScene`, com capacidade de 80 objetos cada, preparam o
destino oculto, ativam sua posição/paleta e liberam somente o conteúdo antigo.
O personagem e esses objetos compartilham PAL1 deliberadamente. O preparo usa
`retroSceneValidatePalettes` contra a paleta do personagem e recusa cores
incompatíveis antes de alocar. Isso detecta conflitos e não remapeia pixels. Não representa uma física recuperada
de Alice/Tempo.

O personagem da fixture passa pelo serviço transacional do Charset Maker:
fonte, projeto em `charsets/`, atlas indexado, recurso e header exportados. O
host inicializa `RetroCharacter` e conecta `RetroCharacterSprite` ao sprite
emprestado. O adapter aplica apoio, flips, câmera e prioridade, mantendo timers
sob controle do runtime. Entrada/respawn reiniciam o estado inicial sem recriar
o sprite nem substituir os callbacks do adapter.

O grafo do personagem tem idle/walk/jump/fall. GROUND/MOVING vêm do resultado da
física, com MOVING recalculado se o limite da sala zerar a velocidade. Os
predicados do host 1/2 representam velocidade vertical negativa/não negativa,
permitindo distinguir subida e queda sem tratar JUMP (borda do botão) como
estado persistente. O tick ocorre depois de desenhar o quadro, uma vez por
frame; é pulado na transição da sala e em resultado físico inválido. Essa é uma
política explícita da fixture, não um controlador imposto aos jogos existentes.
O C nativo executa física e grafo exportados, verificando os quatro estados,
pouso, duração de seis ticks por quadro de caminhada e reset do estado.

`retroWorldMapScenes` associa cada ID a definições, quantidade, upload explícito
de paleta e cálculo de tiles de sprites. `retroWorldMapSceneFind` procura pelo
ID, sem depender da ordem do grafo, e retorna nulo para IDs ausentes. Salas sem
objetos têm ponteiros e quantidade nulos. Quando todas as salas estão vazias,
`RETRO_WORLD_SCENE_COUNT` é zero e o header não exige o módulo scene. Caso haja
objetos, o módulo scene precisa estar instalado antes da exportação.
A fixture usa dois objetos na primeira sala e nenhum na segunda. O host usa
`RETRO_WORLD_SCENE_COUNT` para também compilar quando todas as salas estão vazias. Callbacks de
paleta continuam explícitos; gerar um binding não autoriza sobrescrever a paleta
do personagem em qualquer host.

O fragmento de recursos usa caminhos relativos ao `res/resources.res` final e
ordena PALETTE/TILESET/MAP/SPRITE pelas dependências do ResComp. Não substitua
declarações customizadas com esse fragmento: o backend o concilia com propriedade
e hashes dos recursos anteriores. O manifesto não é autorização
para remover arquivos antigos nem indica que o jogo já usa esses dados.

Entradas TMX/TSX/imagens precisam ficar no projeto, sem symlinks. World/config
têm limite de 1 MiB; recursos/manifesto/TMX/TSX de 4 MiB; imagens de 32 MiB e
16 milhões de pixels; saídas combinadas de 64 MiB. Mapas mantêm os limites e
recusas explícitas do exportador atual: 8×8, até 256×256 tiles, sem descarte
silencioso de música ou gatilhos de cutscene ainda não integrados. Salas com
panoramas usam o runtime de cenário (BG_B panoramas, BG_A cenário por
streaming): ver `docs/SCENERY_RUNTIME.md`.

`smoke-world-maps.mjs` exercita TMX reais, dois headers no mesmo C, colisões e
rampa, caixas diferentes por sala, preservação dos arquivos legados, destino
existente, dimensões inválidas, IDs repetidos e links em todos os metadados.

`smoke-world-map-export.mjs` executa o compilador distribuído e a publicação
combinada: rollback após escrita parcial, no-op, mudanças concorrentes,
arquivos/declaracões manuais, ordem de dependências, comentários, colisão IMAGE,
ledger cheio, fonte executável customizado ignorado, links e 64 salas num lote.
Também recupera uma interrupção real em processo filho com journal de 129
saídas, mantendo o limite de 128 para outros produtores. Empacotamento compila
e publica uma sala sem `src/scripts` da IDE. A fixture SGDK usa esse serviço de
publicação antes de compilar a ROM, sem executar emulador.

`smoke-world-refresh.mjs` verifica atualização de salas fora de `sourceMaps`,
alterações de imagens, preservação dos sprites compartilhados durante exportação
legada, no-op, bloqueios de saídas/runtime manuais e migração do registro v1.
O teste de build também altera uma imagem gerenciada durante Make e exige recusa
nos dois caminhos de produção, sem substituir o último recibo válido.

O diagnóstico executa nativamente duas caixas de personagem diferentes, queda,
apoio no chão e salto contra as colisões TMX exportadas. A ROM correspondente
compila com o host de movimento. A variante `--sgdk` também remove os objetos,
reexporta e recompila o mesmo host sem dependência de bindings de cenas. O lookup
nativo dos bindings usa callbacks simulados; não comprova renderização de sprites.
Isso não substitui a verificação no emulador.

O host diagnóstico também mede máximos de tiles/sprites por instância e soma
personagem + cena ativa + destino. Recusa o destino antes de alocar quando
excede sua reserva de 128 tiles ou o limite estrito de sprites H32/H40 do SGDK
1.81. Fragmentação, software sprite slots, scanlines e DMA ainda dependem da
alocação/execução real; esse check não mede desempenho do VDP.

Ainda falta generalizar bindings de personagens e distribuição de paletas do
host completo, e verificar fidelidade e descarregamento em
execução no emulador. Não declarar #55 concluída pelos testes e pela ROM compilada.
