# Guia do Retro Studio

O Retro Studio monta jogos de Mega Drive em cenas. Cada cena (`.tscn`) é feita com nodes próprios (MDCena, MDMapa, MDJogador…). Ao compilar, o editor converte as cenas em código C e recursos do SGDK, e o SGDK gera a ROM. Nada do editor vai para o jogo: o que aparece no editor é o que o console consegue fazer.

## Instalar

O pacote `retro-studio-…-linux-x86_64.tar.gz` traz o editor, um Java mínimo e o `make` (o build não depende dos do sistema), o jogo de exemplo e, quando montado com eles, o kit SGDK/MarsDev e o BlastEm. Descompacte e rode `./instalar.sh`; não precisa de sudo. O instalador mantém o que já estiver funcionando em `~/.retrostudio`, guarda de lado (com outro nome) o que estiver quebrado, baixa o que faltar (com curl, wget ou o Python do sistema) e, no fim, compila uma ROM de teste para conferir o kit. Depois, abra com `retro-studio --project-manager` ou pelo menu de aplicativos.

Precisa de um PC x86_64 com glibc 2.35 ou mais nova (Ubuntu 22.04, Debian 12, Fedora 36 ou mais novos). O instalador também aceita `--reparar` (confere e conserta), `--verificar` (só confere) e `--desinstalar` (remove o editor; kit, emulador e projetos ficam); ele fica instalado em `~/.local/share/retro-studio/instalar.sh`.

**Windows (10 ou 11, 64 bits):** o pacote `retro-studio-…-windows-x86_64.zip` traz tudo, sem download: editor, kit SGDK para Windows (as ferramentas do SGDK oficial, com gcc 13.2, e a biblioteca e os cabeçalhos do SGDK 1.81, os mesmos do Linux), Java mínimo, BlastEm e jogo de exemplo. Descompacte e clique duas vezes em `Instalar.cmd`; não precisa de administrador. O editor vai para `%LOCALAPPDATA%\Programs\RetroStudio` (atalhos no menu Iniciar e na área de trabalho, e entrada em Aplicativos instalados para desinstalar), o kit para `%USERPROFILE%\.retrostudio\toolkit\sgdk` (ou `C:\RetroStudio\toolkit\sgdk`, quando o nome da pasta do usuário tem espaço ou acento, que o make do SGDK não aceita) e o BlastEm para `%USERPROFILE%\.retrostudio\emulators\blastem`. As opções são as mesmas: `Instalar.cmd -Reparar`, `-Verificar` e `-Desinstalar`. As configurações ficam em `%APPDATA%\RetroStudio`, separadas das de um Godot instalado. Um projeto criado no Linux abre no Windows: no primeiro build, o `export PATH` do Makefile passa a valer só no Linux. A tela e as teclas do emulador pela IA (`emulator_screenshot`, `emulator_press`) ainda são só do Linux.

**Ambiente:** ao abrir, o editor confere o kit, o Java, o `make` e o emulador. Se faltar algo, uma faixa no topo do painel SGDK diz o quê, com os botões **Reparar** (roda o `instalar.sh --reparar` e mostra a saída ali; pacotes do sistema, se precisar, pedem a senha numa janela) e **Conferir de novo**. Compilar ou rodar sem o que falta também leva a essa faixa. O BlastEm baixado traz duas versões: a principal usa a SDL2 e a GLEW do sistema; quando elas faltam, o editor abre a oficial, em `old/`, que traz as próprias bibliotecas.

Para gerar o pacote a partir do código: compile o editor (`scons`) e rode `retro_studio/empacotar.sh`.

## Antes de começar

O editor precisa do kit do SGDK (MarsDev) e de um emulador:

| O quê | Onde fica por padrão | Onde mudar |
|-------|----------------------|------------|
| SGDK 1.81 (MarsDev) | `~/.retrostudio/toolkit/marsdev/mars/m68k-elf` | Configurações do Editor → Retro Studio → Sgdk → Gdk Path |
| BlastEm | `~/.retrostudio/emulators/blastem/blastem` | Configurações do Editor → Retro Studio → Emulator → Path |

## Criar um jogo

1. No gerenciador de projetos, **Criar**. O projeto novo já vem pronto para o Mega Drive: `Makefile` do SGDK, tela de 320×224 sem suavização dos pixels, `.gitignore` do que o build gera, as pastas `res/` (imagens e sons) e `src/` (código C) e uma cena inicial (`main.tscn`) com um texto.
2. Abra o projeto. A cena principal aparece sozinha.
3. **Compilar ROM** (F6) gera `out/rom.bin`; **Rodar no emulador** (F5) compila e abre no BlastEm.

Enquanto o build roda, o botão usado gira e, ao lado, aparecem a etapa ("Salvando e gerando as cenas…", "Compilando henzo.c", "Recursos: cenas_gerado.res", "Ligando a ROM…") e uma barra de progresso. Clicar de novo no botão que está girando para o build. No fim, a barra mostra "ROM pronta" ou quantos erros houve, por alguns segundos.

O build recompila os arquivos `.c` quando um cabeçalho que eles incluem muda (o `makefile.gen` do SGDK não faz isso sozinho; o Retro Studio passa ao make o `out/retro_dependencias.mk`).

O painel **SGDK**, embaixo, mostra a saída do build. Um erro do gcc vira um link que abre o arquivo na linha. Função ou variável que não existe (erro do linker, "undefined reference") também conta como erro e leva à linha da chamada. Depois de "ROM pronta", aparece o uso de VRAM de cada cena.

**Barras laterais:** os dois botões no canto direito da barra de título (ou **Alt+1** e **Alt+2**) mostram e escondem as docks da esquerda (cena, arquivos) e da direita (Inspetor, Console, IA), para dar espaço ao código ou ao mapa. O editor lembra a escolha em cada projeto. O modo sem distrações (Ctrl+Shift+F11) continua escondendo todas.

### Versões para teste

Uma versão é uma ROM numerada para enviar a quem testa, com o registro do que mudou. O botão da caixa, ao lado do Rodar, ou **F7** abre a janela (Ctrl+Shift+B também abre, fora do editor de código). À esquerda ficam as versões já geradas, com **Mostrar na pasta** e **Copiar notas**, que copia o texto para mandar a quem testa. À direita fica a próxima versão:
- **Versão:** três números, como `0.3.0`, ou `0.3.0-beta` para uma prévia. A janela sugere a próxima.
- **Título no cabeçalho da ROM** (opcional, até 48 caracteres, sem acento): aparece em emuladores e flashcarts no lugar de "SAMPLE PROGRAM".
- **O que mudou:** uma mudança por linha, do ponto de vista de quem joga. A partir da segunda versão, a janela já preenche com os commits desde a anterior (sem os merges); revise antes de gerar.
- **Observações para quem testa** (opcional).

**Gerar versão** grava `src/gerado/versao.h`, faz um build limpo de release (`make clean release`) e copia a ROM para `releases/<versão>/<jogo>-<versão>.bin`. Na cópia, a revisão vai para o serial do cabeçalho (`GM 00000000-RR`, com RR igual ao número da versão) e o checksum é corrigido; o código do jogo não muda. Também grava `LEIA-ME.txt` na pasta da versão e o registro em `releases/releases.json` e `releases/CHANGELOG.md`: o que mudou, a ROM (tamanho, SHA-256, serial, checksum), o commit, os commits desde a anterior e os arquivos adicionados, alterados e removidos, agrupados por área (cenas, código, personagens, sons, imagens…). As ROMs ficam fora do git (`releases/.gitignore`). Se o build falhar, nada é registrado. **Só compilar** faz o build normal. O formato é o mesmo do Retro Studio em Electron.

Para mostrar a versão no jogo:

```c
#include "gerado/versao.h"
/* GAME_VERSION "0.3.0", GAME_VERSION_MAJOR/MINOR/PATCH, GAME_RELEASE_NUMBER,
   GAME_BUILD_DATE "2026-10-31", GAME_COMMIT "abc1234" */
VDP_drawText("v" GAME_VERSION, 30, 27);
```

O arquivo só existe depois da primeira versão; os builds normais usam o da última versão gerada.

O `retro_studio/jogo_padrao` é um jogo completo para estudar: título → fase 1 → fase 2 → fim, com mapa, inimigos, moedas, plataformas, ponto de retorno, música, efeitos e uma cena animada.

### Controle de versão (Git)

O editor tem um painel de Git que usa o `git` instalado no computador (no Windows, instale o [Git for Windows](https://git-scm.com/download/win)). Em um projeto que já é um repositório, ele aparece sozinho: a aba **Commit** fica na dock da direita e a aba **Controle de Versão**, embaixo. Para ligar o Git em um projeto que ainda não tem, use **Projeto → Controle de Versão → Configurações de Controle de Versão…** e ative **Conectar ao VCS**: o editor cria o repositório (ramo `main`). Desligar no mesmo lugar fica gravado no projeto.

- **Commit:** os arquivos alterados aparecem em **Alterações não Preparadas**. Clique em um para ver o diff embaixo; clique duas vezes (ou use a seta) para passá-lo para **Alterações Preparadas**. Escreva a mensagem e clique em **Criar Commit** (Ctrl+Enter prepara tudo se nada estiver preparado). **Corrigir** refaz o último commit. O X ao lado de um arquivo descarta as alterações dele.
- **Histórico:** a **Lista de Commit** mostra os últimos commits; clique em um para ver o que ele mudou.
- **Ramos e remotos:** no pé da aba **Commit** ficam o ramo atual (trocar ou criar) e o remoto, com **Buscar**, **Puxar** (↓) e **Enviar** (↑). O botão ⋮ cria e remove ramos e remotos e tem o envio forçado (com `--force-with-lease`: não apaga commits do remoto que você ainda não puxou). Enviar já liga o ramo ao remoto; apagar um ramo com commits que não estão em outro é recusado.
- **Login:** o push e o pull usam o login que o Git do computador já tem (gerenciador de credenciais, agente SSH). Se o remoto pedir usuário e senha (ou token), preencha nas configurações de controle de versão; valem só até fechar o editor e nunca são gravados. Chave SSH com senha precisa estar no agente SSH.

Os erros mais comuns (remoto à frente, falta de nome e e-mail no Git, login recusado, conflitos) vêm com uma explicação em português antes da mensagem do Git.

## Cenas

A raiz de cada cena é uma **MDCena**. O jogo começa na cena principal do projeto (Projeto → Configurações → Application → Run → Main Scene) e passa para as outras por uma **MDSaida**, pelo START ou pelo fim de uma animação. Todas as cenas do projeto com uma MDCena na raiz vão para a ROM; trocar a cena principal (botão direito no `.tscn` → Set as Main Scene) serve para testar uma fase direto.

Na troca de cena, a tela escurece, tudo é desmontado e a cena nova entra clareando. Voltar à cena principal começa um jogo novo: zera vidas e pontos.

### MDCena

| Propriedade | O que faz |
|-------------|-----------|
| `musica` | VGM ou XGM tocado em repetição; vazio é silêncio. A mesma música continua tocando de uma cena para outra. |
| `start_vai_para` | Cena aberta ao apertar START (telas de título). |
| `ao_fim_da_animacao` | Cena aberta quando a animação do AnimationPlayer termina (cutscenes). |
| `salvar_ao_entrar` | Ponto de salvamento: entrar na cena grava o progresso na SRAM do cartucho (no slot `jogo_slot`). |
| `luz_e_sombra` | Liga o modo luz e sombra (highlight/shadow) do VDP: os planos com prioridade baixa ficam na sombra (metade do brilho) e o que tem prioridade (MDPrioridade, sprites com `prioridade`) fica normal. Nos sprites da PAL3, a cor 14 clareia e a cor 15 escurece o que está atrás (lanternas, sombras). |

### Salvar o progresso e senhas

O jogo guarda o progresso na SRAM do cartucho (o cabeçalho do SGDK já declara 64 KB; o BlastEm grava em `save.sram`). Cada um dos 3 slots guarda a cena, as vidas, os pontos e as 16 variáveis `jogo_var`, com uma soma que recusa um slot estragado. Marque `salvar_ao_entrar` nas cenas que são pontos de salvamento; o **Continuar** do MDMenu carrega o slot. No código C (cena ou ator), use:

```c
jogo_var[0] = 1;             /* variáveis do jogo: chaves, fases abertas... (zeram no jogo novo) */
jogo_salvar(jogo_slot);      /* grava agora; jogo_slot começa em 0 */
if (jogo_tem_save(0)) {      /* há progresso no slot 0? */
    jogo_carregar(0);        /* volta à cena salva com vidas, pontos e variáveis */
}
jogo_apagar_save(0);

char senha[JOGO_SENHA_LETRAS + 1];
jogo_senha(senha);           /* 8 letras: cena, vidas e pontos (arredondados para dezenas) */
jogo_usar_senha("EWZSRXQ5"); /* FALSE se a senha não confere */
```

A senha usa as letras `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem I, O, 0 e 1, que se confundem) e serve para quem joga num cartucho sem bateria. Ela guarda as vidas até 15, as 64 primeiras cenas e não guarda as `jogo_var`. Trocar uma letra quase sempre a invalida. Com ROM maior que 2 MB, a SRAM (que começa em 0x200000) precisa de um mapeador: mantenha o jogo em até 2 MB para usar o save.

## Nodes

As imagens são **PNG indexados de até 16 cores** (a cor 0 é a transparência), com lados múltiplos de 8. Um PNG qualquer vira um assim com o botão direito no Sistema de Arquivos → **Converter para o Mega Drive**. A cópia sai como `nome_md.png`, e o original não é alterado.

Cada node avisa no próprio ícone (triângulo amarelo) quando algo não vai funcionar no console. O Inspetor mostra só as propriedades que o jogo usa. Passe o mouse em cima de uma propriedade para ver para que ela serve; a descrição de cada node aparece também no diálogo de criar node e na ajuda (F1). Ao selecionar uma MDColisao (ou abrir um TileSet de colisão), o Inspetor mostra os tipos de colisão com o desenho e o efeito de cada um.

| Node | Para quê | Principais propriedades |
|------|----------|-------------------------|
| **MDFundo** | Imagem num dos planos de fundo (BG B atrás, BG A na frente). | `plano`, `paleta`, `rolagem` (parallax: % do movimento da câmera; com imagem de 512 px de largura, o fundo emenda ao rolar) |
| **MDMapa** | Mapa pintado com o editor de TileMap. Vira um MAP do SGDK e rola com a câmera. O TileSet precisa de uma só imagem. | `plano`, `paleta`, `solido` (todo tile pintado bloqueia) |
| **MDAtor** | Sprite que faz o que o seu código C mandar, como um CharacterBody2D com GDScript (veja "Atores e código"). Sem comportamento próprio: andar, pular, atacar e morrer ficam no código. | `codigo`, `camera_segue`, `vida`, `fixo_na_tela`, `respeita_limite` (as células de limite são paredes para ele), `dano_do_cenario` (dano e morte da MDColisao agem nele; ligado por padrão), `dorme_longe` (longe da tela, mais de 32 px fora, o ator fica sem sprite e sem rodar o código; a VRAM só conta os que cabem perto da tela ao mesmo tempo: inimigos espalhados pela fase), `vram_da_fonte` (os tiles vão para o lugar da fonte, 96 tiles, sem gastar a VRAM dos sprites: créditos e avisos que aparecem enquanto não há texto na tela), `personagem`, `animacao`, `paleta`; grupos na aba Grupos |
| **MDSprite** | Objeto animado: um personagem do gestor de animações (veja abaixo) ou uma folha simples, em que cada linha (`vframes`) é uma animação e cada coluna (`hframes`), um quadro. | `personagem`, `animacao`, `paleta`, `prioridade`, `caixa_colisao`, `paleta_de` (PNG indexado cuja paleta, na ordem, o personagem usa: jogador, inimigos e HUD dividindo a mesma PAL; cada cor vai para a mais próxima) |
| **MDJogador** | O sprite do controle 1. A câmera o segue. Com folha simples, a linha 0 é parado e a 1, andando; com personagem, as animações de cada estado (veja "Personagens e animações"). | `modo` (plataforma ou visto de cima), `velocidade`, `forca_pulo`, `gravidade`, `vidas` (0 = infinitas), `energia` (golpes por vida; 0 = um toque tira a vida), `invencivel` (quadros piscando depois de um golpe), `som_pulo`, `som_morte`, `som_ataque`, `som_dano`; grupo Controles: `controle` (1 ou 2), `botoes_pulo`, `botoes_ataque`, `botoes_correr` (A, B, C e, no controle de 6 botões, X, Y e Z), `velocidade_correndo`, `pausa_start`, `flash_dano` (a tela pisca em branco quando o jogador leva um golpe). A cena tem um MDJogador; para dois jogadores ao mesmo tempo, use MDAtores com `botao_de(1, …)` e `botao_de(2, …)` |
| **MDInimigo** | Patrulha da posição até `distancia` px à direita. Encostar custa uma vida (ou energia, se o jogador tiver); cair em cima ou o golpe do jogador acerta, se `pisavel`/com ataque. Com `vida` maior que 1, cada acerto o deixa piscando; no último, toca a `anim_derrota` (personagem) e some. | `distancia`, `velocidade`, `vira_na_borda`, `pisavel`, `vida`, `anim_derrota`, `pontos`, `som_derrota` |
| **MDItem** | Some ao encostar e soma pontos (moeda, fruta…). | `pontos`, `som` |
| **MDPlataforma** | Vai e volta em linha reta. É atravessável por baixo, sólida por cima, e leva quem está em cima. | `deslocamento`, `velocidade` |
| **MDTrajeto** | Caminho desenhado com as ferramentas de curva (barra do editor 2D, como um Path2D), filho de uma MDPlataforma ou de um MDInimigo: o pai passa a seguir a linha na velocidade dele, indo e voltando ou, com `ciclo`, dando a volta. O primeiro ponto fica onde o pai está. O inimigo no trajeto voa (sem gravidade nem paredes) e olha para o lado em que anda. | `curve`, `ciclo` |
| **MDCicloCores** | Gira um trecho de uma paleta a cada `intervalo` quadros: água correndo, lava, cachoeira, brilho (pinte a arte com essas cores em sequência). Até 8 por cena. | `paleta`, `primeira`, `quantidade`, `intervalo`, `para_tras` |
| **MDSaida** | Área que leva a outra cena. | `tamanho`, `destino` |
| **MDRetorno** | Ponto de retorno: depois de passar por ele, morrer traz o jogador de volta ali. | `tamanho`, `som` |
| **MDColisao** | Camada de colisão na grade de 8×8, pintada como um mapa. Já vem com um tile desenhado para cada tipo pronto (veja "Tipos de colisão"). Aparece meio transparente no editor e não é desenhada no jogo. | dado `tipo` no TileSet |
| **MDPrioridade** | Pintada por cima de um mapa como a MDColisao: as células marcadas do plano escolhido passam na frente dos sprites sem `prioridade` (a copa de uma árvore cobrindo o jogador). Vale para mapas carregados aos poucos (streaming). Aparece amarelada no editor e não é desenhada no jogo. | `plano` |
| **MDCorrenteza** | Água que corre ou ondula. Só a altura da área conta: as linhas inteiras da tela nessa faixa rolam à parte. **Correnteza**: andam sem parar na `velocidade` e `direcao`, repetindo a cada `periodo` pixels (a arte da água precisa se repetir nesse período); num mapa com streaming, essas linhas carregam colunas a mais. **Ondulação**: faixas de 4 linhas balançam em compasso para lados opostos (lagoa parada). | `tamanho`, `plano`, `modo`, `velocidade`, `direcao`, `periodo`, `amplitude`, `passos_por_segundo` |
| **MDCamera** | Como a câmera segue o jogador (uma por cena). Sem ela, a câmera fica centrada no jogador. A posição só serve de referência no editor: o retângulo laranja é a tela, com a folga no meio. | `folga`, `suavidade`, `a_frente` |
| **MDZonaCamera** | Enquanto o jogador está dentro da área, a câmera não sai dela (uma sala, a luta com um chefe). Menor que a tela, a câmera fica centrada nela. | `tamanho` |
| **MDTexto** | Texto com a fonte do SGDK (8×8, só ASCII, sem acentos). Com `valor`, mostra logo depois do texto os pontos, as vidas ou a energia (veja HUD abaixo). | `texto`, `piscar`, `valor`, `digitos`, `simbolo` |
| **MDLetreiro** | Texto por cima do jogo, com acentos, que pode sumir sozinho (créditos da música, nome da fase, avisos). Vira um sprite fixo na tela no build (veja Letreiros abaixo). | `texto`, `cor`, `borda`, `alinhamento`, `duracao`, `paleta`, `vram_da_fonte` |
| **MDDialogo** | Caixa de diálogo com falas letra por letra, acentos, retrato e escolha (veja "Caixas de diálogo" abaixo). | `falas`, `ativar`, `opcoes`, `variavel`, `proximo`, `retrato` |
| **MDMenu** | Menu pronto de título (Começar, Continuar, Senha, Opções) ou de pausa (START: Continuar, Opções, Salvar, Sair). | `tipo`, `comecar_vai_para`, `slots`, `mostrar_*`, textos, sons |
| **MDNota** | Nota para a IA: uma área da cena com um pedido, um problema ou uma informação. Só existe no editor; não vai para o jogo (veja "Notas para a IA"). | `tamanho`, `tipo`, `texto`, `situacao`, `resposta` |
| **AnimationPlayer** | Anima a cena (cutscenes). Vão para o jogo, da animação marcada em Autoplay, as trilhas de MDSprites comuns: `position`, `visible`, `flip_h` (espelha dentro da célula, como no editor) e, para trocar o desenho, `frame` (folha simples) ou `animacao` (personagem: o nome da animação; as animações usadas pelas trilhas também vão para a ROM). | — |

Node e Node2D servem para agrupar: a posição dos filhos soma a dos pais.

### Caixas de diálogo (MDDialogo)

Um MDDialogo mostra falas numa caixa, letra por letra, com os acentos do português. Cada item de `falas` é uma página; o texto quebra sozinho nas palavras e, se não couber, continua numa página nova. Com a caixa aberta, a cena fica parada; A, B, C ou START completam a página e passam para a próxima.

| Propriedade | O que faz |
|-------------|-----------|
| `falas` | As páginas (pode quebrar linha com Enter). |
| `ativar` | **Ao iniciar a cena**, **Ao tocar a área** (o jogador entra no retângulo), **Apertar para cima na área** (conversar com alguém) ou **Pelo código**. |
| `tamanho`, `uma_vez` | A área (em px, a partir da posição do node) e se ela abre o diálogo só uma vez por visita à cena. |
| `opcoes` | Escolha depois da última página (cima e baixo escolhem). A escolha vai para `dialogo_escolha` (0 = primeira) e, com `variavel` de 0 a 15, para `jogo_var[variavel]` (1 = primeira opção), que o save guarda. |
| `proximo` | Outro MDDialogo aberto em seguida (conversa entre dois personagens, cada um com o seu retrato). |
| `velocidade` | Quadros por letra (0 = a página aparece inteira). |
| `retrato` | PNG de até 16 cores, com lados múltiplos de 8, até 128 px de largura e (linhas − 2) × 8 de altura; fica à esquerda do texto. |
| `paleta_retrato` | Paleta que recebe as cores do retrato enquanto a caixa está aberta (o que usa essa paleta muda de cor nesse tempo e volta depois). |
| `linhas`, `cor_fundo`, `cor_borda`, `cor_texto` | Altura da caixa em tiles (com a moldura; o texto usa uma linha sim, outra não) e as cores. A cena usa a maior altura e as cores do primeiro MDDialogo. |

A caixa fica no plano window: embaixo da tela ou, quando os textos fixos da cena (o HUD) já estão no window, logo abaixo deles. Enquanto ela está aberta, as cores 13, 14 e 15 da PAL0 viram as cores da caixa. As letras usadas viram tiles próprios (contados na VRAM da cena). No código C:

```c
#include "gerado/cena_fase1.h"   /* traz DIALOGO_<NOME> e dialogo.h */
dialogo_abrir(DIALOGO_VELHO);
if (!dialogo_aberto() && dialogo_escolha == 1) { /* escolheu a segunda opção */ }
```

### Menus prontos (MDMenu)

O MDMenu monta os menus que todo jogo tem, com cursor, sons e acentos. Cima e baixo escolhem; A, C ou START confirmam; B volta.

- **Tela de título** (`tipo` Tela de título): os itens aparecem a partir da posição do node, no plano dos textos. **Começar** vai para `comecar_vai_para` com um jogo novo; **Continuar** só aparece quando há progresso salvo e carrega o slot; **Senha** (com `mostrar_senha`) abre a tela da senha (cima e baixo trocam a letra, os lados mudam de letra); **Opções** abre as opções. Com `slots` 2 ou 3, Começar e Continuar perguntam o slot (VAZIO ou SALVO). Com MDMenu, o `start_vai_para` da cena é ignorado.
- **Pausa** (`tipo` Pausa): em qualquer cena, START abre uma caixa no topo com **Continuar**, **Opções**, **Salvar** (grava no slot atual) e **Sair para o título**; a cena e a música param até fechar. Ela substitui a faixa PAUSA do `pausa_start`.
- **Opções**: Música e Efeitos (ligado/desligado), Controles (normal, A e C trocados, A e B trocados) e, no título, Apagar progresso (pede confirmação). Ficam guardadas na SRAM e valem desde que o jogo liga.

Os rótulos dos itens mudam no grupo Textos; `som_cursor` e `som_escolha` são WAV opcionais. A pausa usa as cores 13, 14 e 15 da PAL0 enquanto está aberta (`cor_fundo`, `cor_borda`, `cor_texto`). O jogador gerado e os atores leem o controle por `jogo_ler(JOY_1)`, que aplica a troca de botões; use a mesma função no seu código C.

### Efeitos de paleta no código

`jogo_flash(RGB24_TO_VDPCOLOR(0xFFFFFF), 4)` pinta todas as cores (menos a 0 de cada paleta) de uma cor por alguns quadros e volta às de antes: impacto, explosão, relâmpago. `jogo_ciclos(lista, n)` troca os ciclos de cores da cena (`NULL, 0` para). As escritas vão para a fila do DMA, no vblank.

### Tipos de colisão

Cada tile da MDColisao tem o dado personalizado `tipo`. Os tipos prontos já fazem o efeito sem programar nada:

| Tipo | Desenho | O que faz |
|---|---|---|
| `solido` | bloco vermelho | Bloqueia. |
| `atravessavel` | prancha verde | Segura só por cima; ↓ desce (no MDAtor, `eu->descendo`). |
| `dano` (ou `espinho`) | espinhos rosa | Tira 1 de vida e deixa piscando. |
| `agua` | ondas azuis | Anda e cai pela metade (no MDAtor, `eu->na_agua`). |
| `morte` | X branco no preto | Abismo, lava: tira a vida inteira na hora. |
| `escada` | degraus | Só marca: o código decide (`eu->na_escada`). |
| `gelo` | azul-claro | Só marca: o código decide (`eu->no_gelo`, pisando nele). |
| `limite` | listras amarelas | Parede invisível só para os inimigos: o MDInimigo vira, e o MDAtor com `respeita_limite` para. |
| qualquer outro nome | o seu | Vira `CELULA_<NOME>` (até 7 nomes próprios no jogo); não bloqueia, e o código decide o efeito com `celula_em` ou `celulas_no_corpo`. |

**No MDJogador**, dano, morte, água e atravessável já funcionam. **No MDAtor**, com `dano_do_cenario` ligado (o padrão), dano chama `ferir(eu, 1, 60)` e morte zera `eu->vida`. Para outra reação, escreva no código do ator `<nome>_cenario(Ator *eu, u8 tipo)`; ela é chamada a cada quadro em que o corpo toca dano ou morte (`tipo` = `CELULA_DANO` ou `CELULA_MORTE`). No Sota, por exemplo, o dano usa a mesma reação dos golpes dos ninjas:

```c
void henzo_cenario(Ator *eu, u8 tipo) {
	if (tipo == CELULA_MORTE) {
		eu->vida = 0;
	} else {
		henzo_receber_golpe(eu, 1, -eu->direcao);
	}
}
```

Uma MDColisao nova já vem com todos os tipos. Numa cena antiga, com um TileSet de menos tipos, use **Projeto → Ferramentas → Atualizar tipos da colisão**. Ela troca o TileSet pelo novo, mantém o tipo de cada célula pintada, e depois é só salvar a cena.

### Controles

No grupo **Controles** do MDJogador:

- `botoes_pulo` e `botoes_ataque`: marque A, B e/ou C. Sem nenhum marcado, vale o automático: o ataque no B e o pulo no A e no C (com ataque) ou nos três (sem ataque). O node avisa se o mesmo botão pula e ataca.
- `botoes_correr`: segurar o botão anda em `velocidade_correndo` em vez de `velocidade` (também no modo visto de cima). Sem botão marcado, não corre.
- `pausa_start`: START pausa o jogo e a música; uma faixa "PAUSA" aparece logo abaixo dos textos fixos (ou na primeira linha, sem eles). Não use junto com `start_vai_para` da cena.

### Câmera

A câmera só rola em cena com mapa e MDJogador. Sem MDCamera, fica centrada no jogador e presa às bordas do mundo. Com uma MDCamera na cena:

- `folga`: área no meio da tela (largura × altura) em que o jogador anda sem a câmera rolar; ela só anda quando ele sai dessa área. 0×0 = sempre centrada.
- `suavidade`: 0 acompanha na hora; de 1 a 5, a câmera anda uma fração da distância por quadro (1/2, 1/4… 1/32), chegando devagar.
- `a_frente`: pixels a mais na direção em que o jogador andou por último, para ver o que vem pela frente. A mudança de lado é gradual.

As **MDZonaCamera** prendem a câmera na área enquanto o meio do jogador está dentro; vale a primeira zona da lista da cena. Ao sair, a câmera volta a usar o mundo inteiro (com suavidade, a passagem é gradual). No começo da cena e quando o jogador volta depois de perder uma vida, a câmera vai direto para ele.

### HUD

Sem nada configurado, uma cena com jogador mostra no topo a energia (esquerda), os pontos (meio) e as vidas (direita), só o que o jogo usa. Para montar o seu, ponha MDTexto na cena e escolha o `valor`: o número aparece logo depois do `texto`, que serve de rótulo (ex.: `PTS ` + Pontos, ou `HENZO x` + Vidas). Com um MDTexto mostrando valor, a cena troca o HUD automático pelos seus textos.

- **Pontos**, **Vidas** e **Energia (número)**: `digitos` fixa a quantidade de algarismos, com zeros à esquerda; 0 = automático (6 nos pontos; nas vidas e na energia, os do valor inicial).
- **Energia (barra)**: um `simbolo` por golpe que o jogador ainda aguenta (ex.: `=` ou `#`).
- A energia só existe em cena com MDJogador com `energia`; sem ela, o build avisa e o valor fica de fora. Pontos e vidas também funcionam em cenas sem jogador, como a tela final com os pontos.
- No editor, o valor aparece em amarelo com um exemplo. Com mapa no BG A, os textos vão para o plano window, que fica fixo no topo e cobre o mapa até a linha do texto mais baixo.

### Letreiros (texto por cima do jogo)

O **MDLetreiro** escreve um texto que passa por cima do cenário sem apagá-lo, como os créditos da música que aparecem por alguns segundos ao entrar na fase. Ponha o node na cena, escreva o `texto` (cada linha do campo é uma linha na tela) e posicione: a posição é o canto de cima à esquerda, em pixels da **tela** (não do mundo; a câmera não o move). O editor mostra o letreiro exatamente como sai no jogo.

- **Fonte**: a do SGDK (8×8), mais as letras acentuadas do português: á à â ã é ê í ó ô õ ú ü ç e as maiúsculas (e ñ). Caracteres que a fonte não tem saem como `?` e o build avisa.
- `borda`: **Sombra** (1 px para a direita e para baixo, como nos créditos do Sota), **Contorno** ou nenhuma; `cor` e `cor_da_borda` escolhem as cores.
- `duracao`: segundos na tela depois que a cena começa; 0 = fica sempre.
- `paleta`: se essa paleta já carrega as cores de outro desenho (o Henzo, um mapa), o letreiro usa as cores mais próximas dela e não briga com ele; o build avisa se alguma ficou longe. Se a paleta está livre, o letreiro a ocupa com as cores dele.
- `vram_da_fonte` (ligado): os tiles ocupam o lugar da fonte do SGDK (96 tiles) e não gastam a VRAM dos sprites. Cabem umas 4 linhas de 24 caracteres; com mais, desligue (aí conta na VRAM dos sprites). Enquanto o letreiro aparece, um MDTexto da cena sairia embaralhado; o build avisa.
- Um sprite vai até 248×248 px: até 31 caracteres por linha.

Para trocar uma imagem de texto feita à mão (um MDAtor com `vram_da_fonte`, como o `creditos.png`) por um letreiro, apague o ator e ponha um MDLetreiro na mesma posição com o mesmo texto; o código que o fazia sumir não é mais necessário.

## Personagens e animações

Um **personagem** (`.charset.json`, o mesmo formato do Retro Studio em Electron) junta uma ou mais folhas e as animações do personagem, de um inimigo ou de um item. Os quadros não precisam ter o mesmo tamanho nem o mesmo espaçamento: cada animação é uma **faixa em grade** (região da folha, tamanho do quadro e espaços próprios) ou uma lista de **quadros livres**, cada um com seu recorte. No jogo, todos os quadros ficam numa célula comum, alinhados pelos **pés**.

Para usar, arraste o `.charset.json` para a propriedade `personagem` de um MDSprite, MDInimigo ou MDItem e escolha a `animacao`. A **posição do node é a dos pés**: acrescentar ou mudar animações não mexe em onde o personagem pisa. No MDJogador, escolha também as animações de parado, andando, pulando e caindo, e, se quiser:

- `anim_ataque`: o botão de ataque (B, se não escolher outro) toca essa animação até o fim. Nos quadros marcados no gestor, a caixa de ataque (espelhada quando o jogador olha para a esquerda) derrota os inimigos que tocar, com pontos e som. Sem caixa de ataque desenhada, o node avisa.
- `anim_morte`: ao perder uma vida, essa animação toca com o jogador parado antes de ele voltar.
- `energia` (com `anim_dano`, opcional): cada golpe de inimigo ou espinho tira 1 de energia, toca a animação de dano, empurra o jogador para trás e o deixa piscando, invencível, por `invencivel` quadros. Sem energia, perde a vida (e volta com a energia cheia). A energia aparece no canto esquerdo do HUD (ou onde um MDTexto com `valor` mandar); cair do mapa tira a vida direto.

O tempo de cada quadro é o do gestor de animações (o SGDK 1.81 só guarda um tempo por sprite; o código gerado acerta o tempo a cada troca de quadro). Só as animações usadas vão para a ROM: a escolhida, as do jogador e as que as trilhas `animacao` do AnimationPlayer da cena usam.

### Criar um personagem

Clique com o botão direito numa folha (PNG) no Sistema de Arquivos → **Novo personagem com esta folha**. O `nome.charset.json` é criado ao lado da folha e abre no gestor de animações, ainda sem animações.

Na folha, selecione o que vai virar animação:

- **Clique num desenho:** seleciona o desenho inteiro, justo nas bordas (partes separadas por até 2 pixels contam como um desenho só).
- **Arraste no vazio** (ou com Shift, sobre os recortes): seleciona uma área.

Com a seleção, escolha uma ação:

- **Adicionar quadro:** a seleção entra como quadro novo, depois do quadro em edição. Sem animação escolhida, cria uma.
- **Substituir quadro:** troca o recorte do quadro em edição pela seleção.
- **Separar desenhos:** cria uma animação com cada desenho da seleção num quadro, na ordem de leitura. Serve para folhas em que cada quadro tem tamanho e espaçamento diferentes. Os quadros de uma linha ficam com a mesma altura, então a base fica onde o artista desenhou.
- **Criar faixa em grade:** divide a seleção em quadros do tamanho e do espaçamento escolhidos. A grade aparece em laranja sobre a seleção antes de criar.

Nos quadros criados, os pés começam na base do recorte, no meio dos pixels mais baixos do desenho. Ajuste depois com um clique na prévia.

O **+** ao lado de "Folha" adiciona outra folha do projeto ao personagem; o seletor troca a folha mostrada.

### Gestor de animações

Dois cliques num `.charset.json` no Sistema de Arquivos abrem a tela **Animações** (no topo, ao lado de 2D e Script):

- **À esquerda**, as animações: **Nova** (começa com o quadro em edição), **Duplicar** e **Remover**.
- **No centro**, a folha, com os recortes da animação numerados e a cruz dos pés. Arrastar um recorte o move; o canto amarelo redimensiona. A roda do mouse dá zoom, e arrastar no vazio (ou com o botão do meio) move a vista. Embaixo ficam os quadros, com o tempo de cada um, e os botões para reordenar, duplicar e remover.
- **À direita**, a prévia, tocando no tempo do console (60 quadros por segundo). Verde é a caixa do corpo e vermelho, a de ataque.
  - **Clique marca:** os pés do quadro (um clique), a caixa do corpo ou a caixa de ataque (arraste para desenhar). A caixa de ataque nova vale no quadro em edição; os campos mudam os quadros.
  - **Referência:** com a prévia pausada, um quadro aparece por baixo para alinhar: o anterior, o seguinte, o primeiro da animação ou o primeiro de outra animação (bom para os pés da corrida baterem com os do parado).
  - **Ajuste fino:** os botões ◀ ▲ ▼ ▶ ao lado da prévia movem o desenho do quadro em edição 1 pixel; com Shift, 8. O deslocamento atual aparece ao lado dos botões.

**Teclado:** as setas agem na área clicada por último, que fica com a borda destacada (menos quando você está digitando num campo):

| Área | Setas | Shift+setas | Esc |
|------|-------|-------------|-----|
| Folha, com seleção | movem a seleção 1 pixel | mudam o tamanho (→ ↓ aumentam, ← ↑ diminuem) | limpa a seleção |
| Folha, sem seleção | movem o recorte do quadro em edição | mudam o tamanho do recorte | — |
| Prévia | ajuste fino do quadro (1 pixel) | ajuste fino de 8 em 8 | — |

**Desfazer:** o gestor tem o próprio histórico, separado do da cena. **Ctrl+Z** desfaz e **Ctrl+Shift+Z** ou **Ctrl+Y** refaz; os botões Desfazer e Refazer do topo fazem o mesmo, e o tooltip diz o que vai ser desfeito. Entram no histórico as mudanças no personagem e as seleções na folha (pelo mouse, pelo teclado e o Esc). Cada passo é uma mudança; só viram um passo as mudanças iguais seguidas em menos de um segundo (uma tecla segurada, por exemplo). Desfazer volta para a animação e o quadro em que a mudança foi feita. Trocar de personagem começa um histórico novo.
- **Os campos** da animação são nome, velocidade (fps) e repetir. Os do quadro são tempo, pés, ajuste fino, recorte e som. Há ainda o corpo do personagem e a caixa de ataque, com os quadros em que ela vale.

**Som no quadro (evento):** o campo **Som** do quadro escolhe um `.wav` do projeto, tocado quando o quadro entra: o passo no quadro em que o pé toca o chão, o golpe no quadro da espada. O botão ao lado toca o som, e a prévia toca os sons enquanto anima. Na linha do tempo, o quadro com som ganha um ♪. No jogo, o som toca em todo sprite que usa o personagem, inclusive num inimigo fora da tela; use em animações do jogador ou em golpes, e não nos passos de todos os inimigos.

Numa faixa em grade, os pés valem para a faixa toda. Mexer no recorte, no tempo, no ajuste fino ou no som de um quadro passa a animação para quadros livres, mantendo os recortes.

As mudanças aparecem na hora nos nodes que usam o personagem. Tudo tem Ctrl+Z. **Salvar** (ou Ctrl+S) grava o `.charset.json`; os campos que o editor não conhece ficam como estavam. Renomear uma animação exige escolhê-la de novo nos nodes que usavam o nome antigo.

### Animação na cena

Na barra da vista 2D, ao lado de **View**, ficam dois botões (numa janela estreita, eles descem para uma segunda linha):

- **Animar:** os sprites com personagem tocam a animação deles no cenário, com o tempo de cada quadro igual ao do jogo; uma animação sem repetição para no último quadro e recomeça depois de um instante. Também vale durante o play do AnimationPlayer (cutscenes): cada sprite toca a animação que a trilha `animacao` escolhe. É só prévia: a cena não muda. Clique de novo para pausar.
- **Ajustar:** com um sprite selecionado, a animação é ajustada ali mesmo, no meio do cenário. Ao lado do botão aparecem a animação, os botões ◀ e ▶, um botão para cada quadro e o **Tempo** do quadro.
  - **Clicar num quadro**, em **◀ ▶** ou apertar **← e →** troca o quadro (a prévia pausa nele).
  - **Arrastar o desenho** move o quadro: é o ajuste fino do gestor de animações.
  - **Arrastar as bordas** muda a caixa verde (corpo) e a vermelha (ataque, só nos quadros em que vale). Com **Shift**, arrastar dentro da caixa a move inteira.
  - O campo **Tempo** (setinhas, roda do mouse ou digitando) ou **+ e −** mudam o tempo do quadro, em 1/60 s.
  - **Esc** ou o botão direito cancelam o arrasto.
  - A cruz azul marca os pés. O sprite precisa estar sem espelhar (flip), sem girar e sem escala.

O ajuste grava o personagem (`.charset.json`) na hora, com **Ctrl+Z**, e vale para todas as cenas que usam o personagem, como no gestor de animações. A cena não fica marcada como alterada.

### Jogo de plataforma e jogo visto de cima

No modo **plataforma**, o jogador anda com ← →, pula com A, B ou C (soltar cedo dá um pulo mais baixo), colide com os tiles sólidos e perde uma vida ao cair do mapa. Com uma animação de ataque escolhida (`anim_ataque`), o **B ataca** e o pulo fica no A e no C. No modo **visto de cima**, anda nas 4 direções, sem gravidade nem pulo.

Vidas e pontos ficam no topo da tela (plano window). Sem vidas, aparece GAME OVER e o jogo volta à cena principal.

## Importar um cenário pronto (Aseprite)

Um cenário desenhado inteiro no Aseprite, ou em outro editor, entra direto como mapa. Exporte cada camada (fundo, frente) como um PNG do tamanho da fase, ponha os PNGs no projeto (por exemplo em `res/fase2/`) e abra a cena onde o mapa vai entrar. Depois, para cada PNG:

1. Botão direito no PNG no Sistema de Arquivos → **Importar como mapa**.
2. Escolha o **Mapa** de destino:
   - um MDMapa que já existe;
   - um **Novo MDMapa no plano B** (fundo, atrás; paleta 0);
   - um **Novo MDMapa no plano A** (frente; paleta 2).

   O padrão já vem certo: o mapa que veio deste PNG (para reimportar), senão o mapa selecionado se estiver vazio, senão um novo (no plano A, se já há um mapa no plano B).
3. **Importar.**

O editor corta a imagem em tiles de 8×8 e guarda só os diferentes:
- os vazios (transparentes) ficam sem tile;
- as cores vão para a grade do console;
- os tiles vão para `<nome>_tiles.png`, ao lado do PNG;
- o TileSet vai para `tilesets/<nome>.tres`;
- o mapa recebe o desenho a partir do canto (0, 0).

Os tiles são sempre de **8×8**, como no console: no TileSet, o Tile Size aparece fixo, e um TileSet antigo com outro tamanho volta para 8×8 quando a cena abre. Para a fase ficar maior ou menor, mude o tamanho do PNG ou mova o desenho.

Cada mapa tem **uma paleta**: até 15 cores mais a transparência. Se a camada tiver mais cores, elas são reduzidas e o aviso diz quantas havia; divida o desenho em mais camadas para ter mais cores. Mapas novos saem com `solido` desligado, porque a colisão é pintada na MDColisao, por cima.

**Parallax e camada da frente:** o Mega Drive tem só dois planos que rolam (A e B). No Inspetor do MDMapa:
- **`rolagem`** e **`rolagem_vertical`** (em %) fazem o mapa andar uma fração da câmera. Por exemplo, o fundo no plano B com 50% anda na metade da velocidade e parece longe. O mapa só precisa ser largo o bastante para a parte que aparece.
- **Um segundo MDMapa no mesmo plano** é desenhado **por cima** do primeiro: onde ele tem pixel, vale o dele. Os dois viram um plano só, e as cores dos dois vão juntas para uma paleta (até 15; se passar, o build reduz e avisa). É assim que a camada da frente do Aseprite (cactos, palmeiras) entra junto com o chão no plano A.
- **`na_frente`** faz as células pintadas daquele mapa passarem **na frente dos sprites** (o bit de prioridade do console). Num segundo mapa, só as células dele.

Cuidado com a VRAM: o fundo, o plano da frente e os sprites dividem 1424 tiles. Uma faixa da frente cheia de detalhe pela largura toda pode não caber; o build diz quanto cada mapa usa ("vagas fixas").

**Nuvens em faixas:** cada MDCorrenteza (modo Correnteza) move as linhas inteiras da tela numa faixa de altura. Para nuvens em ritmos diferentes, ponha uma MDCorrenteza por faixa:
- **`velocidade`:** o quanto a faixa desliza sozinha, mesmo com a câmera parada (0 = não desliza).
- **`rolagem_propria` + `rolagem`:** um parallax só daquela faixa. Por exemplo, as nuvens altas a 15% e as baixas a 30%: quando o jogador anda, as de baixo passam mais rápido.
- **O desenho da faixa precisa se repetir exatamente a cada `periodo` px.** Use até 184 px (a tela e a volta precisam caber nas 64 colunas do plano) e deixe uma folga entre as faixas: uma nuvem que cruza a divisa é cortada quando as faixas andam diferente.
- **A faixa move tudo o que estiver naquelas linhas do plano.** Ponha as nuvens num céu vazio, em geral no fundo (plano B).

Num plano com parallax, a faixa acompanha a posição do plano, e não a da câmera.

**Mover o desenho:** ao selecionar um MDMapa, uma MDColisao ou uma MDPrioridade, o Inspetor mostra no topo a **Posição do desenho**, ou seja, onde o desenho começa e quanto ocupa:
- **← ↑ ↓ →** movem 8 px (1 tile); com **Shift**, 64 px;
- **Encostar no topo** e **Encostar à esquerda** tiram o espaço vazio de cima ou da esquerda;
- com **Mover todos os mapas da cena juntos** ligado (o padrão), fundo, frente, colisão e prioridade andam juntos e continuam alinhados;
- desligado, só o mapa selecionado anda. Serve, por exemplo, para acertar a colisão sob o desenho.

O node continua em (0, 0), porque o jogo exige; o que anda são as células. Tudo tem Ctrl+Z, e o desenho não pode passar para antes do canto (0, 0). Se o PNG tem desenho até a primeira linha, não há como subir: a fase usa essa altura toda, e no jogo a câmera sobe e desce com o jogador. O retângulo roxo no canto do editor é só a tela de referência.

**Reimportar:** quando o desenho mudar, exporte o PNG de novo com o mesmo nome e importe outra vez no mesmo mapa. Os tiles e o TileSet são atualizados, o desenho volta para a posição em que você o deixou, e a colisão, os inimigos e os outros nodes da cena não mudam. A importação tem **Ctrl+Z**.

Uma fase grande passa sozinha para o streaming (veja abaixo). Por exemplo, as camadas de fundo e de frente da fase 1B do Sota (4848×544) ficam com 619 e 827 padrões e usam 72% da VRAM.

### Editor de mapas (janela)

O botão **Editor de mapas** da barra da vista 2D abre uma janela própria, que pode ir para outro monitor. À esquerda fica a paleta de tiles, no meio o mapa e à direita as camadas da cena (MDMapa, MDColisao e MDPrioridade), com olho e cadeado que só valem nesta janela. A janela pinta direto nos nodes da cena, com o mesmo Ctrl+Z.

| Ferramenta | Tecla | O que faz |
|------------|-------|-----------|
| Lápis | P | Pinta o pincel. Na paleta, clique num tile ou arraste um retângulo para pintar vários de uma vez. |
| Borracha | E | Apaga tiles da camada ativa. |
| Retângulo | R | Arraste um retângulo no mapa: ele se enche com o pincel, repetido (um bloco 2×2 vira uma parede de blocos). |
| Balde | B | Troca a mancha de tiles iguais em que você clicar (vizinhos pelos lados) pelo pincel. Fica dentro do mundo da cena: a área usada pelos mapas e a primeira tela. |
| Seleção | S | Arraste uma área. **Ctrl+C** a copia como **carimbo**, **Ctrl+X** a recorta (para mover: recorte e clique no lugar novo), **Delete** apaga e **Esc** desfaz a seleção. |
| Terreno | T | Pinta o terreno escolhido na lista ao lado: as bordas, os cantos de fora e os cantos de dentro se encaixam sozinhos enquanto você pinta. **Shift** + arrastar apaga o terreno e acerta as bordas em volta. |

- **Espelhar:** **X** (ou ↔) espelha o pincel na horizontal e **Y** (ou ↕) na vertical, inclusive um carimbo inteiro. O Mega Drive espelha tiles sem gastar VRAM, então um tile espelhado conta como o mesmo no relatório.
- **Criar terreno (autotile):** na paleta, arraste um bloco de **3×3** tiles desenhado como uma ilha (os 4 cantos, os 4 lados e o meio) ou de **5×3** (o 3×3 e, à direita, um 2×2 com um buraco no meio: os cantos de dentro) e clique em **Criar terreno**. O terreno fica no TileSet (os bits de terreno do Godot) e vale para todos os mapas que usam esse TileSet; é só pintar com a ferramenta Terreno. Terrenos montados à mão no editor de TileSet do Godot também funcionam: o tile escolhido é o de bits mais parecidos com a vizinhança.
- **Pegar um tile:** o clique direito pega o tile do mapa, com o espelho que ele tem.
- **Navegar:** a roda dá zoom, o botão do meio arrasta, Ctrl+roda rola na vertical e Shift+roda na horizontal. **G** liga e desliga a grade, e **Ctrl+S** salva a cena.

Tiles girados 90° (o Transpor do painel TileMap do 2D) saem sem o giro, porque o console só espelha.

### Ver os números dos tiles

O botão **#** da barra da vista 2D (ao lado de Animar e Ajustar) escreve em cada célula o número do tile no TileSet: a partir de 0, linha por linha da imagem dos tiles (linha × colunas + coluna). Assim dá para ver na tela como os tiles do mapa estão ordenados. Tiles espelhados aparecem em amarelo. Com um mapa (ou a colisão, a prioridade) selecionado, só ele ganha números; sem seleção de mapa, todos os MDMapa visíveis. Os números só aparecem com zoom suficiente para ler; antes disso, um aviso pede para aproximar.

## Mapas grandes (streaming)

Se os fundos e mapas da cena não cabem na VRAM, o build passa os mapas para streaming sozinho. Só os tiles do que a tela mostra (41×29 células) ficam carregados.

Para não pesar no 68000, o build faz como o Sota em Electron e aloca a VRAM de antemão. Cada padrão de 8×8 ganha uma vaga fixa, escolhida para que dois padrões que podem aparecer juntos na tela nunca dividam a vaga. Assim, as palavras do plano vão prontas na ROM. Quando a câmera anda, a coluna ou a linha nova é um DMA direto da ROM, feito no vblank, e o jogo só confere quais padrões precisam ser enviados. Correr e cair num poço fundo ficam sem lentidão.

O relatório do build mostra quantas vagas cada mapa usa ("com streaming", "vagas fixas"). Os mapas com streaming ficam no começo da VRAM, antes das imagens. O exemplo do Sota (Ibirapuera inteira, 4528×544) roda assim.

## Som

- **Música:** arquivos `.vgm` ou `.vgz` (YM2612 + PSG). O rescomp converte para XGM. Ao clicar no arquivo, o Inspetor mostra a forma de onda e toca a música nos chips emulados, como ela vai soar no console.
- **Efeitos:** arquivos `.wav`, tocados pelo driver XGM no canal de PCM. O Inspetor também toca o WAV. Além dos sons dos nodes (pulo, golpe, dano, moeda…), um quadro de animação pode tocar um efeito (veja **Som no quadro** no gestor de animações).

### Compor uma música (tela Música)

A tela **Música**, na barra de cima, abre o compositor para o YM2612 (6 canais FM) e o PSG (3 tons e ruído), com o som dos chips emulados enquanto você compõe. Ele abre numa janela própria, que pode ir para outro monitor e continua tocando enquanto você volta para o 2D; fechar a janela para o som. **Encaixar na tela** (no topo do compositor) o põe dentro da tela Música, e **Janela separada** o devolve para a janela; o editor lembra a escolha em cada projeto.

- **Faixas e piano roll:** cada faixa tem um instrumento. Clique no piano roll para pôr uma nota e arraste para mudar a duração. Com notas selecionadas:

  | Tecla | O que faz |
  |---|---|
  | ↑ e ↓ | mudam a altura (com Shift, uma oitava) |
  | ← e → | andam pela grade |
  | Ctrl+D | duplica |
  | Delete | apaga |
  | Ctrl+A | seleciona tudo |

  **Mudo** e **solo** valem só para ouvir no editor.
- **Tocar e gravar:** Espaço toca e para. **Gravar** grava o que você toca num teclado MIDI ou no teclado do computador, como nos trackers: Z…M a partir do C3 e Q…I a partir do C4. A gravação pode ser quantizada pela grade, com metrônomo e loop de um trecho.
- **Teclado MIDI:** **Conectar teclado** usa um teclado USB (ALSA) ou Bluetooth (BLE-MIDI, pelo próprio Retro Studio, sem precisar de plugin do BlueZ).
- **Pads:** no modo **Bateria**, cada pad toca e grava a sua peça numa faixa própria. No modo **Controles**, os pads viram atalhos.
- **Instrumentos:** a lista vem com instrumentos prontos (teclas, baixos, cordas, metais, leads…). **Importar…** lê arquivos TFI, DMP, FUI, OPNI e WOPN. **Da internet…** busca na biblioteca de instrumentos do Furnace ou num link https. **Editar cópia** abre os operadores do FM.
- **Ouvir um VGM:** **Abrir VGM…** toca um arquivo `.vgm` ou `.vgz`, do projeto ou de qualquer pasta, nos chips emulados.
- **Importar um VGM para editar:** **Importar VGM…** (ou **Editar como música**, no player) transforma um `.vgm` ou `.vgz` em música do compositor.
  - **Faixas:** uma por canal e timbre.
  - **Instrumentos:** cada timbre do FM vira um instrumento da música, editável, e o volume de cada nota vira a velocity.
  - **Tempo:** sai da grade das notas, inclusive trackers que alternam linhas de 7 e 8 quadros. As notas caem nas linhas do piano roll.
  - **O que fica de fora:** a bateria em PCM (DAC do FM6), o vibrato e os glissandos finos (a nota fica com a altura do começo) e o volume ao longo da nota no PSG. A mensagem avisa o que não entrou.
  - A música importada ainda não está salva: confira e clique em **Salvar**.
- **Salvar e exportar:** a música fica em `music/<id>.song.json`. **Exportar** grava `som/<id>.vgm` (um VGM que não foi gerado pelo compositor nunca é sobrescrito). Para tocar no jogo, escolha esse arquivo em **Música**, no Inspetor da MDCena. Enquanto você edita, um rascunho fica em `.retro-studio/drafts/music.json` e volta se o editor fechar sem salvar.

O formato das músicas é o mesmo do Retro Studio em Electron: copie a pasta `music/` de um projeto antigo para continuar uma música.

## Atores e código

O MDJogador e o MDInimigo já vêm com o comportamento pronto. Para um personagem com mecânica própria (dash, pulo na parede, combos, inimigos que atacam de longe), use um **MDAtor**: o node dá o desenho, o corpo e as animações, e o que ele faz fica num código preso a ele. O Mega Drive não roda GDScript, então o código é C, compilado junto com o jogo.

Com o MDAtor selecionado, **Projeto → Ferramentas → Criar código do ator** cria `src/<nome>.c` com um movimento de plataforma pronto, liga o arquivo ao node (`codigo`) e o abre. Vários atores podem usar o mesmo código, como os inimigos de um tipo.

```c
#include "gerado/codigo_henzo.h" // A API e as animações do personagem (ANIM_...).

void henzo_pronto(Ator *eu) {        // Como _ready(): quando o ator aparece.
	tocar_animacao(eu, ANIM_N_IDLE);
}

void henzo_quadro(Ator *eu) {        // Como _physics_process(): a cada quadro.
	aplicar_gravidade(eu, 56, PX(8));
	if (eu->no_chao && apertou(BOTAO_C)) {
		eu->vy = -PX(5);
	}
	eu->vx = botao(BOTAO_DIREITA) ? PX(4) : botao(BOTAO_ESQUERDA) ? -PX(4) : 0;
	virar(eu, eu->vx);
	mover_e_colidir(eu);             // Como move_and_slide().
}
```

As posições e as velocidades estão em 1/256 de pixel: `PX(4)` são 4 pixels, e `PIXELS(eu->x)` volta para pixels. A posição do ator é a dos pés, e y cresce para baixo.

**O ator** (`Ator *eu`) tem:
- `x`, `y`, `vx`, `vy`;
- `direcao` (1 ou -1; o desenho espelha em volta dos pés);
- `no_chao`, `no_teto` e `parede` (-1, 0 ou 1), atualizados por `mover_e_colidir`;
- `descendo`, para atravessar as plataformas atravessáveis;
- `corpo_x/y/l/a` (a caixa do corpo, que dá para mudar, como ao agachar);
- `vida`, `invencivel` (quadros piscando), `grupos`, `visivel`;
- `desenho_dy`, que desloca só o desenho na vertical (a mão encostando na quina da parede), sem mexer na física;
- `v[0]` a `v[7]`, variáveis livres. Um `#define ESTADO v[0]` deixa o código legível.

**Funções** (todas em `src/gerado/ator.h`):

| Para quê | Funções |
|---|---|
| Controles | `botao(BOTAO_…)` (segurando), `apertou(…)` e `soltou(…)` (só no quadro em que mudou) leem o controle 1; os botões podem ser somados: `BOTAO_A \| BOTAO_C`. Para dois jogadores, `botao_de(2, …)`, `apertou_de(2, …)` e `soltou_de(2, …)` leem o controle 2 (ou o 1). Com o controle de 6 botões, valem também `BOTAO_X`, `BOTAO_Y`, `BOTAO_Z` e `BOTAO_MODE`; `jogo_seis_botoes(JOY_1)` diz se o controle ligado tem 6 botões. |
| Movimento | `mover_e_colidir(eu)`, `aplicar_gravidade(eu, gravidade, maxima)`, `virar(eu, direcao)` |
| Colisão | `celula_em(x, y)` (`CELULA_SOLIDA`, `CELULA_ATRAVESSAVEL`, `CELULA_ESPINHO`, `CELULA_AGUA`), `area_solida(x, y, l, a)`, `celulas_no_corpo(eu)`, `corpo_esquerda`, `corpo_topo`, `centro_x`, `centro_y` |
| Animação | `tocar_animacao(eu, ANIM_…)` (continua se já está tocando), `reiniciar_animacao`, `animacao_acabou`, `quadro_animacao`, `mostrar_quadro(eu, animacao, quadro)` (parado, para barras e contadores); os sons dos quadros do gestor de animações tocam sozinhos |
| Outros atores | `proximo_ator(anterior, GRUPO_…)` para percorrer um grupo, `primeiro_ator`, `tocando(a, b)`, `ator_na_area(eu, x, y, l, a, GRUPO_…, anterior)` (a área de um golpe, relativa aos pés e espelhada pela direção), `ferir(alvo, dano, invencivel)`, `distancia_x`, `distancia_y`, `criar_ator`, `remover_ator(eu)` |
| Impacto | `parar_jogo(quadros)` (hit-stop: atores e animações congelam), `tremer_tela(quadros, amplitude)` (planos e sprites); pedidos juntos valem pelo maior |
| Tela e som | `ator_camera` (quem a câmera segue), `camera_pelo_codigo(TRUE)` + `posicionar_camera(x, y)` (a câmera vai aonde o código mandar, presa ao mundo), `mundo_largura()`, `mundo_altura()`, `na_tela(eu)`, `tela_x()`, `tela_y()`, `tocar_som(SOM_…)`; as variáveis `vidas` e `pontos` do jogo |

**Grupos:** os grupos do node, na aba **Grupos** ao lado do Inspetor, viram `GRUPO_<NOME>`. Por exemplo, um golpe acerta quem está no grupo "inimigo":

```c
for (Ator *alvo = NULL; (alvo = ator_na_area(eu, 4, -30, 32, 20, GRUPO_INIMIGO, alvo));) {
	ferir(alvo, 1, 30);
}
```

**Atores criados pelo código** (tiros, poeira, faíscas): faça uma cena só com um MDAtor na raiz, por exemplo `kunai.tscn`, com o desenho e o código dela. Cite `TIPO_KUNAI` no código de quem atira:

```c
Ator *kunai = criar_ator(&TIPO_KUNAI, eu->x + eu->direcao * PX(8), eu->y - PX(28));
if (kunai) {
	kunai->direcao = eu->direcao;
	tocar_som(SOM_THROW);
}
```

O build procura no projeto a cena com o nome citado (`TIPO_<NOME>` ↔ `<nome>.tscn`) e reserva VRAM para ela nas cenas com atores. Do mesmo jeito, `SOM_<NOME>` traz para o jogo o `.wav` com esse nome, mesmo sem nenhum node usando o som. Os efeitos tocam nos canais 2 a 4 do XGM, o primeiro livre.

**HUD em sprites:** um MDAtor com `fixo_na_tela` fica na posição da tela, sem rolar com a câmera. Com uma folha de quadros (uma barra de vida com um quadro por ponto), o código mostra o quadro do valor:

```c
extern s16 henzo_vida; // Variável do código do Henzo.
void hud_vida_quadro(Ator *eu) {
	mostrar_quadro(eu, 0, henzo_vida);
}
```

**Animações:** vão para a ROM só a animação inicial e as que o código cita (`ANIM_<NOME>`, com o nome em maiúsculas e `_` no lugar de espaços e hifens). Num personagem com dezenas de animações, a ROM leva só as usadas.

Com `camera_segue`, a câmera (e a MDCamera, se houver) segue o ator, e as MDSaida levam a outra cena quando ele entra nelas. Sem `codigo`, o ator fica parado tocando a animação inicial. Os arquivos `src/gerado/ator.c`, `ator.h`, `atores.h` e `codigo_<nome>.h` são refeitos no build; não os edite. Um código de ator que nenhum MDAtor usa (por exemplo, o de um inimigo que ainda não está em nenhuma fase) continua compilando: ganha o `codigo_<nome>.h` com os `ANIM_` que cita, e o build avisa que ele não entra no jogo.

## Código C da cena

Para o que os nodes prontos não fazem, cada cena aceita código C. Com a cena aberta, use **Projeto → Ferramentas → Criar código C da cena**. Isso cria `src/<cena>.c`:

```c
#include "gerado/cena_fase1.h"

// Uma vez, com a cena montada, antes de clarear a tela.
void fase1_iniciar(void) {
}

// Todo quadro, depois do jogo gerado e antes de os sprites irem para a tela.
void fase1_atualizar(void) {
}
```

O cabeçalho `gerado/cena_<cena>.h`, refeito a cada build, dá os sprites pelo nome do node (por exemplo `fase1_heroi`). Pelo `jogo.h`, dá também `vidas`, `pontos`, `jogo_trocar_cena(CENA_...)`, `jogo_som(SOM_...)` e `jogo_musica(...)`. Qualquer função do SGDK pode ser usada. Sem o arquivo, a cena funciona do mesmo jeito.

**Editor de código:** os `.c` e `.h` têm realce de C (tipos e funções do SGDK), e os `.s` e `.res` também têm realce próprio. Com o **clangd** instalado (`sudo apt install clangd`), o editor ganha:
- **autocompletar** com as funções do projeto e do SGDK. A lista aparece depois de duas letras ou com Ctrl+Espaço;
- **Ctrl+clique** num nome para ir à declaração. Se a declaração estiver no SGDK, o editor só mostra o arquivo e a linha;
- **erros e avisos enquanto se digita:** a linha fica vermelha ou amarela, e a barra de baixo mostra a mensagem.

A lista de compilação do clangd fica em `.retro-studio/clangd`, fora do projeto. O caminho do clangd está em Configurações do editor → `retro_studio/clangd/path`.

Os arquivos em `src/gerado/`, `res/gerado/` e `res/cenas_gerado.res` são refeitos a cada build; não edite. Um arquivo com o mesmo nome escrito à mão (sem a marca `// Gerado pelo Retro Studio`) nunca é sobrescrito.

## Painel Console

Fica à direita, embaixo do Inspetor, e acompanha a cena aberta enquanto você edita:

- **VRAM:** tiles de fundos e mapas mais os de sprites, contra os 1424 livres, e o número de sprites (de 80). Os sprites ficam só com o que precisam (o maior quadro de cada um, sem o vazio em volta); o resto é dos fundos e mapas.
- **Paletas:** as 4 paletas (PAL0 a PAL3), com as cores como o console mostra (3 bits por canal), a imagem que define cada uma e quem a usa. Um aviso aparece quando duas imagens diferentes disputam a mesma paleta. Quem define a paleta é o primeiro node da cena que a usa.

## IA (agentes pelo MCP)

O editor tem um servidor MCP: um agente de IA (Claude Code, Codex, OpenCode ou outro que fale MCP) usa o Retro Studio como uma pessoa usa. Ele lê o projeto e as cenas, cria e altera nodes, grava o código C, compila, roda no emulador e olha a tela.

**Painel IA:** a aba **IA**, ao lado do Inspetor (Ctrl+L abre e põe o foco na pergunta), conversa com o agente sem sair do editor. É o mesmo painel do Retro Studio em Electron:

- Agentes: OpenCode, Codex ou Claude, escolhidos no cabeçalho. O cabeçalho também tem o estado, nova sessão, detalhes, recarregar, cancelar o turno, configurações e fechar.
- Avisos guiados quando falta instalar o adaptador ou fazer o login, e uma tela inicial com o passo a passo.
- Mensagens com Markdown, o raciocínio do agente, as ferramentas usadas, diferenças de arquivos, o plano e os erros de build clicáveis (abrem o arquivo na linha).
- Permissões em fila, com "permitir/negar sempre" lembrado na sessão; revisão do que o agente grava em arquivos (Aceitar ou Rejeitar).
- Chips de contexto (Arquivo aberto, erros do Build, Tilemap da cena com mapa ou notas — com as notas em aberto —, ROM), incluindo o que ainda não foi salvo.
- Imagens: anexar ou colar com Ctrl+V.
- Histórico de sessões (retomar uma conversa antiga), modo e modelo do agente.
- Atalhos `/build`, `/play` e `/stop` no campo da mensagem.
- **Ctrl+K no código C:** com um trecho selecionado (ou a linha do cursor), abre "Editar com IA"; a instrução e o trecho vão para o agente, e o editor mostra a mudança assim que ele grava. Comentar linhas passou para Ctrl+/.

O agente recebe as ferramentas do Retro Studio pelo servidor MCP do editor (veja abaixo); não precisa de nada além do adaptador e do login:

| Agente | Adaptador | Login |
|--------|-----------|-------|
| Claude | `npm install -g @agentclientprotocol/claude-agent-acp` | `claude`, depois `/login` |
| Codex | `npm install -g @agentclientprotocol/codex-acp` | `codex login` |
| OpenCode | já vem no `opencode` (`opencode acp`) | `opencode auth login` |

Aberto pelo menu do sistema, o editor lê o `PATH` do seu shell de login para achar esses comandos (asdf, nvm, npm global). O comando de cada agente pode ser trocado em Configurações do Editor → Retro Studio → Ia.

**Conectar um agente de fora (terminal):** com o editor aberto, vá em **Projeto → Ferramentas → Conectar agente de IA…**. A janela mostra a URL e o comando de cada agente, com botão de copiar. Rode o comando uma vez no terminal; a URL continua a mesma nas próximas aberturas. Exemplos:

- Claude Code: `claude mcp add --transport http retro-studio <url>`
- Codex: `codex mcp add retro-studio --url <url>`
- OpenCode: em `opencode.json`, `"mcp": { "retro-studio": { "type": "remote", "url": "<url>" } }`

Depois, abra o agente na pasta do projeto e peça o que quiser ("leia o guia do Retro Studio e coloque três moedas antes do primeiro buraco"). O agente precisa do editor aberto com o projeto.

**Ferramentas do agente:**

| Ferramenta | O que faz |
|------------|-----------|
| `guide` | Este guia |
| `project_info`, `project_tree`, `ide_state` | Projeto, arquivos e estado do editor (cena em edição, seleção, build rodando) |
| `scene_read` | Árvore de nodes com tipo, posição, propriedades e avisos (a cena aberta, como está no editor) |
| `scene_open`, `scene_new`, `scene_save` | Abrir, criar (com MDCena na raiz) e salvar cenas |
| `node_add`, `node_set`, `node_remove` | Criar, alterar e remover nodes da cena em edição |
| `file_read`, `file_write` | Ler e gravar arquivos de texto do projeto (código C, .res, .charset.json) |
| `character_read` | Animações de um personagem, com tempos, repetição e caixa de ataque |
| `sheet_find_drawings` | Desenhos de uma folha (ou de uma região dela), prontos para virar quadros |
| `character_create`, `character_edit` | Criar personagem a partir de uma folha; criar, mudar ou remover animações (quadros, região com os desenhos, grade, tempos, sons por quadro, repetição, ataque) e a caixa do corpo. O gestor de animações aberto e os nodes se atualizam na hora |
| `map_read`, `map_paint` | Ler e pintar (ou apagar) células de uma MDMapa ou MDColisao, com desfazer |
| `emulator_screenshot`, `emulator_press` | Ver a tela do jogo rodando e apertar botões do controle (up, down, left, right, a, b, c, start). Precisa de X11 com `xdotool` e o `import` do ImageMagick |
| `file_write` num `src/<ator>.c` | O código de um MDAtor (veja "Atores e código"); o node aponta para ele em `codigo` |
| `build_run`, `build_errors` | Compilar (e rodar) e o relatório: problemas, uso de VRAM por cena, fim do log |
| `release_list`, `release_read`, `release_create` | Versões para teste: a lista (com a próxima sugerida), tudo de uma versão e gerar uma (só quando o usuário pedir) |
| `music_guide`, `music_list`, `music_read`, `music_write`, `music_open` | Compor músicas: o formato (tempos e nomes de nota, limites dos chips, instrumentos), a lista, ler, criar ou mudar (com a análise de vozes; `exportToGame` também grava `som/<id>.vgm`) e abrir na tela Música para o usuário ouvir |
| `notes_list`, `note_image`, `note_update` | Notas para a IA: listar (de uma cena ou de todas, com o que cada área toca), ver a imagem da área e responder (situação e resposta) |
| `ide_screenshot` | Captura da vista da cena ou da janela do editor |

**Notas para a IA:** para mostrar ao agente onde mexer, marque a área na cena. O botão **Nota** da barra da vista 2D (ao lado do **#**) cria uma MDNota no meio da tela, já selecionada: arraste as bordas para cobrir a área, escolha o `tipo` (tarefa, problema ou informação) e escreva no `texto` o que ele deve fazer ou saber ali ("as nuvens desta faixa andam rápido demais", "ponha três moedas aqui"). A cor da área mostra o tipo; resolvidas ficam verdes.

O agente recebe as notas em aberto da cena pelo chip Tilemap do painel IA e as lê com `notes_list`, que diz também o que a área toca (sprites, saídas, células dos mapas). Ao trabalhar, ele marca a nota como "em andamento", e ao terminar como "resolvida", com a `resposta` escrita; o seu texto não muda. As notas ficam na cena (`.tscn`), entram no desfazer como qualquer node e não vão para a ROM: o build ignora a MDNota e os filhos dela. Apague a nota quando não precisar mais dela.

Para o agente: leia as notas com `notes_list` ao começar um pedido sobre uma cena, use `note_image` para ver a área (com a cena aberta), faça o que a nota pede e responda com `note_update` (`situacao` e `resposta`). Depois salve a cena com `scene_save`.

**Segurança e desfazer:**
- O servidor só aceita conexões deste computador (127.0.0.1), e a URL leva um token guardado em `~/.retrostudio/ia/token`, que só o seu usuário lê.
- Pedidos vindos de páginas web são recusados.
- As mudanças da IA nos nodes entram no histórico da cena ("IA: criar…", "IA: alterar…") e saem com Ctrl+Z ou pelo painel History; só vão para o disco com `scene_save` ou ao compilar.
- Arquivos só são lidos e gravados dentro do projeto.
- A porta (padrão 7650) e o servidor ficam em Configurações do Editor → Retro Studio → Ia.

## Limites do console

| Limite | Valor |
|--------|-------|
| Tela | 320×224 (40×28 tiles) |
| Paletas | 4, de 16 cores cada (a cor 0 é transparente) |
| Cores | 512 possíveis (8 níveis por canal) |
| Sprites na cena | 80 |
| VRAM para fundos, mapas e sprites | 1424 tiles de 8×8 (repetidos e espelhados contam uma vez) |
| Planos | 64×32 tiles (512×256 px), dando a volta |

Passar de um limite gera erro no build, com o motivo.
