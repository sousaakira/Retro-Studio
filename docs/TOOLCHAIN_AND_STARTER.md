# Base técnica do projeto e projeto inicial jogável (#61)

Um projeto novo registra com quais versões foi feito, e a IDE oferece um
exemplo completo e redistribuível para começar. Projetos existentes não são
alterados: nada é registrado nem migrado sem um pedido explícito.

## Registro da base técnica

`retro-studio.toolchain.json`, na raiz do projeto, acompanha o jogo no controle
de versão:

```json
{ "format": "retro-studio.toolchain", "version": 1,
  "sdk": { "name": "sgdk", "version": "1.81" },
  "compiler": "m68k-elf-gcc 13.1.0",
  "runtime": { "modules": { "core": 1, "camera": 1, "audio": 1 } },
  "generators": { "map-outputs": 1, "cutscene-runtime": 3, "cutscene-bytecode": 2 },
  "ide": "0.9.0" }
```

- **SDK**: versão lida de `inc/genesis.h` do toolkit configurado.
- **Módulos de runtime**: os que estão instalados no projeto, na versão instalada.
- **Geradores**: protocolo de saída dos mapas e versões do runtime e do bytecode
  de cutscenes distribuídos pela IDE.
- Caminhos da máquina nunca são gravados.

Projetos novos são registrados na criação, quando o SGDK é encontrado. Em
projetos antigos, o registro é feito em modo Jogo → **Base técnica e
ferramentas…** → “Registrar base técnica”. Depois de instalar ou atualizar
módulos, “Atualizar registro” grava o novo estado.

## Diagnóstico: ambiente ou projeto

O mesmo painel compara o registro com esta máquina e com esta versão da IDE, em
duas listas separadas:

| Lista | Exemplos |
|-------|----------|
| **Ambiente (esta máquina)** | Toolkit não configurado; SGDK, compilador ou rescomp ausentes; `make`, Java ou Python não encontrados; SGDK de versão diferente da registrada. |
| **Projeto** | Base ainda não registrada; módulo de runtime com atualização disponível; projeto mais novo que a IDE; registro ilegível. |

Um SGDK de outra versão principal (por exemplo 2.x em um projeto registrado
para 1.81) é erro; outra versão menor é aviso. Módulo desatualizado é só uma
informação: a atualização é opcional e continua sendo feita pelo instalador de
runtime, com confirmação e backups.

Quando um build falha, a IDE classifica a saída e diz de quem é o problema:

- **Ambiente**: programa ausente (`make`, Java, Python, compilador), `rescomp.jar`
  ou `makefile.gen` não encontrados, módulo Python ausente, disco cheio, Java
  antigo demais.
- **Jogo**: erro de compilação em arquivo do projeto, símbolo indefinido ou
  duplicado, recurso recusado, ROM maior que o espaço, validação de um editor.
- **Indefinido**: a saída não permite dizer. Nada é atribuído por palpite.

Problemas de ambiente têm precedência: uma ferramenta ausente também causa
erros que parecem do jogo.

## Módulos escolhidos na criação

`retro:create-project` e `createProjectFromTemplate` aceitam uma lista de
módulos de runtime (a ferramenta `create_project` da IA e o diálogo de novo
projeto ainda não oferecem essa escolha e instalam todos). As dependências
entram junto, assim como os módulos que o próprio template exige; sem lista,
todos os módulos são instalados, como antes. Uma lista vazia ou inválida é
recusada antes de qualquer pasta ser criada, e uma criação que falha no meio
remove a pasta que ela mesma criou. Instalar um módulo não declara que o jogo o usa: o contrato do
projeto continua com `modules: []` até o jogo declarar.

## Projeto inicial jogável

Novo projeto → **SGDK · Projeto inicial jogável (plataforma)**. Um jogo mínimo
feito só com os módulos distribuídos:

| Elemento | Como é feito |
|----------|--------------|
| Personagem | Sprite e controlador de animação exportados do Charset Maker (parado, andando, pulando, caindo). |
| Sala e colisão | Dois mapas TMX com terreno e uma plataforma; física e colisão dos módulos `movement` e `collision`. |
| Transição | Grafo de salas: atravessar a borda troca de sala; checkpoint e retorno com START. |
| Câmera | Perfis exportados pelo editor de câmera. |
| Áudio | Música por sala e efeitos (pulo, checkpoint) do catálogo de áudio. |

A arte, a música e os efeitos são gerados por programa
(`scripts/build-starter-template.mjs`), sem material de terceiros nem de outros
jogos, e podem ser redistribuídos. O código do exemplo não tem nomes nem lógica
de Alice ou Tempo.

### Como o template funciona

`assets/toolkit/examples/sgdk-starter/` guarda só fontes de autoria: mapas,
imagens, sons, configurações JSON, `src/main.c` e o README. Headers gerados e
registros de exportação não ficam no template. Na criação a IDE:

1. copia o skeleton SGDK e, por cima, o projeto inicial (`template.json`);
2. instala os módulos de runtime e o runtime de cutscenes;
3. exporta personagem, salas e mapas, câmera e áudio pelos mesmos serviços dos
   editores;
4. registra a base técnica.

Cada exportação é independente. Sem Python na máquina, por exemplo, só “salas e
mapas” fica pendente: o projeto é criado, o diálogo de novo projeto avisa o que
faltou e basta abrir “Salas e conexões” e salvar quando o Python estiver
instalado.

### Build limpo

Pela IDE, **Build** ou **Run**. Pelo terminal, na pasta do projeto:

```sh
make clean
make release GDK=<pasta do SGDK 1.81>
```

Requisitos: `make`, Java (rescomp), Python 3 com Pillow (mapas) e Node (cenas).
A ROM sai em `out/rom.bin`.

## Atualização e projetos antigos

- Abrir um projeto antigo não grava nada. Sem registro, o painel mostra só uma
  informação e o diagnóstico do ambiente.
- Uma IDE mais nova distribui módulos mais novos: o projeto continua
  compilando com os instalados, e o painel informa que há atualização.
- Uma IDE mais antiga que o projeto aparece como aviso no painel (as
  exportações não consultam o registro).
- Um registro ilegível é preservado e relatado; nunca é substituído em silêncio.

## Correção de integração feita nesta entrega

A exportação dos mapas do mundo tratava qualquer `.json` ou `.res` do projeto
como entrada. Salvar câmera, áudio, progresso, física, controles, diagnóstico
ou o registro da base técnica depois dos mapas fazia o build acusar “os mapas
mudaram”; o mesmo acontecia quando a IDE regravava `retro-studio.json` ao abrir
o projeto (lista de assets). Esses arquivos saíram da assinatura, e de
`retro-studio.json` contam só os campos que o exportador lê (`mapExport` e
`retroStudio`). Além disso, salas com gatilhos de cutscene eram sempre
recusadas na exportação do mundo, porque a cópia de trabalho não levava o
registro do adaptador de cutscenes; agora leva.

## Limites conhecidos

- Só o SGDK é detectado e registrado; projetos de outros SDKs não recebem registro.
- A detecção executa `make`, Java e Python de forma síncrona, com limite de 5 s
  cada; uma ferramenta travada segura a IDE por esse tempo.
- Os módulos são comparados com o último registro: depois de atualizar um
  módulo, use “Atualizar registro”.
- O teste do template compara os PNG byte a byte com o gerador; outra versão do
  Pillow pode exigir regenerar o template.
- A classificação de falhas usa padrões da saída do build; mensagens que não
  casam ficam como indefinidas.
- O projeto inicial não usa progresso em SRAM nem cutscenes (os módulos ficam
  instalados e disponíveis).
- Não comprovado em hardware real.

## Verificações

```sh
node scripts/smoke-toolchain.mjs [--toolkit <pasta do toolkit>]
node scripts/smoke-toolchain-panel.mjs
node scripts/smoke-starter-project.mjs [--toolkit <pasta> --sgdk <raiz-do-SGDK> [--keep-rom <arquivo>]]
node scripts/smoke-new-project-runtime.mjs
```

`smoke-starter-project` confere que o template é exatamente o que o gerador
escreve, que não guarda arquivos gerados, que a criação passa em todos os gates
de build e, com `--sgdk`, faz o build limpo. No emulador:
`scripts/capture-rom.sh <rom> <saída> <emulador> assets/toolkit/fixtures/starter-game.steps.sh`.
