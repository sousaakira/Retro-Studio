# Guia do Retro Studio

O Retro Studio monta jogos de Mega Drive em cenas, no editor do Godot. Cada cena (`.tscn`) é feita com nodes próprios (MDCena, MDMapa, MDJogador…). Ao compilar, o editor converte as cenas em código C e recursos do SGDK, e o SGDK gera a ROM. Nada do motor do Godot vai para o jogo: o que aparece no editor é o que o console consegue fazer.

## Instalar

O pacote `retro-studio-…-linux-x86_64.tar.gz` traz o editor, o kit SGDK/MarsDev, o BlastEm e o jogo de exemplo. Descompacte e rode `./instalar.sh`; não precisa de sudo. O instalador mantém o que já estiver em `~/.retrostudio` e baixa o que faltar. O build precisa de `make` e Java no sistema; se faltarem, o instalador mostra o comando. Depois, abra com `retro-studio --project-manager` ou pelo menu de aplicativos.

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

## Cenas

A raiz de cada cena é uma **MDCena**. O jogo começa na cena principal do projeto (Projeto → Configurações → Application → Run → Main Scene) e passa para as outras por uma **MDSaida**, pelo START ou pelo fim de uma animação. Só vão para a ROM as cenas que a principal alcança.

Na troca de cena, a tela escurece, tudo é desmontado e a cena nova entra clareando. Voltar à cena principal começa um jogo novo: zera vidas e pontos.

### MDCena

| Propriedade | O que faz |
|-------------|-----------|
| `musica` | VGM ou XGM tocado em repetição; vazio é silêncio. A mesma música continua tocando de uma cena para outra. |
| `start_vai_para` | Cena aberta ao apertar START (telas de título). |
| `ao_fim_da_animacao` | Cena aberta quando a animação do AnimationPlayer termina (cutscenes). |

## Nodes

As imagens são **PNG indexados de até 16 cores** (a cor 0 é a transparência), com lados múltiplos de 8. Um PNG qualquer vira um assim com o botão direito no Sistema de Arquivos → **Converter para o Mega Drive**. A cópia sai como `nome_md.png`, e o original não é alterado.

Cada node avisa no próprio ícone (triângulo amarelo) quando algo não vai funcionar no console. O Inspetor mostra só as propriedades que o jogo usa.

| Node | Para quê | Principais propriedades |
|------|----------|-------------------------|
| **MDFundo** | Imagem num dos planos de fundo (BG B atrás, BG A na frente). | `plano`, `paleta`, `rolagem` (parallax: % do movimento da câmera; com imagem de 512 px de largura, o fundo emenda ao rolar) |
| **MDMapa** | Mapa pintado com o editor de TileMap. Vira um MAP do SGDK e rola com a câmera. O TileSet precisa de uma só imagem. | `plano`, `paleta`, `solido` (todo tile pintado bloqueia) |
| **MDAtor** | Sprite que faz o que o seu código C mandar, como um CharacterBody2D com GDScript (veja "Atores e código"). Sem comportamento próprio: andar, pular, atacar e morrer ficam no código. | `codigo`, `camera_segue`, `vida`, `personagem`, `animacao`, `paleta`; grupos na aba Grupos |
| **MDSprite** | Objeto animado: um personagem do gestor de animações (veja abaixo) ou uma folha simples, em que cada linha (`vframes`) é uma animação e cada coluna (`hframes`), um quadro. | `personagem`, `animacao`, `paleta`, `prioridade`, `caixa_colisao` |
| **MDJogador** | O sprite do controle 1. A câmera o segue. Com folha simples, a linha 0 é parado e a 1, andando; com personagem, as animações de cada estado (veja "Personagens e animações"). | `modo` (plataforma ou visto de cima), `velocidade`, `forca_pulo`, `gravidade`, `vidas` (0 = infinitas), `energia` (golpes por vida; 0 = um toque tira a vida), `invencivel` (quadros piscando depois de um golpe), `som_pulo`, `som_morte`, `som_ataque`, `som_dano`; grupo Controles: `botoes_pulo`, `botoes_ataque`, `botoes_correr`, `velocidade_correndo`, `pausa_start` |
| **MDInimigo** | Patrulha da posição até `distancia` px à direita. Encostar custa uma vida (ou energia, se o jogador tiver); cair em cima ou o golpe do jogador acerta, se `pisavel`/com ataque. Com `vida` maior que 1, cada acerto o deixa piscando; no último, toca a `anim_derrota` (personagem) e some. | `distancia`, `velocidade`, `vira_na_borda`, `pisavel`, `vida`, `anim_derrota`, `pontos`, `som_derrota` |
| **MDItem** | Some ao encostar e soma pontos (moeda, fruta…). | `pontos`, `som` |
| **MDPlataforma** | Vai e volta em linha reta. É atravessável por baixo, sólida por cima, e leva quem está em cima. | `deslocamento`, `velocidade` |
| **MDSaida** | Área que leva a outra cena. | `tamanho`, `destino` |
| **MDRetorno** | Ponto de retorno: depois de passar por ele, morrer traz o jogador de volta ali. | `tamanho`, `som` |
| **MDColisao** | Camada de colisão na grade de 8×8. O dado personalizado `tipo` de cada tile do TileSet diz o que ele é: `solido`, `atravessavel` (segura só por cima; ↓ desce), `espinho` (custa uma vida) ou `agua` (anda e cai devagar, dá para nadar). Uma MDColisao nova já vem com um tile de cada tipo. Aparece meio transparente no editor e não é desenhada no jogo. | dado `tipo` no TileSet |
| **MDCamera** | Como a câmera segue o jogador (uma por cena). Sem ela, a câmera fica centrada no jogador. A posição só serve de referência no editor: o retângulo laranja é a tela, com a folga no meio. | `folga`, `suavidade`, `a_frente` |
| **MDZonaCamera** | Enquanto o jogador está dentro da área, a câmera não sai dela (uma sala, a luta com um chefe). Menor que a tela, a câmera fica centrada nela. | `tamanho` |
| **MDTexto** | Texto com a fonte do SGDK (8×8, só ASCII, sem acentos). Com `valor`, mostra logo depois do texto os pontos, as vidas ou a energia (veja HUD abaixo). | `texto`, `piscar`, `valor`, `digitos`, `simbolo` |
| **AnimationPlayer** | Anima a cena (cutscenes). Vão para o jogo, da animação marcada em Autoplay, as trilhas de MDSprites comuns: `position`, `visible`, `flip_h` (espelha dentro da célula, como no editor) e, para trocar o desenho, `frame` (folha simples) ou `animacao` (personagem: o nome da animação; as animações usadas pelas trilhas também vão para a ROM). | — |

Node e Node2D servem para agrupar: a posição dos filhos soma a dos pais.

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

### Jogo de plataforma e jogo visto de cima

No modo **plataforma**, o jogador anda com ← →, pula com A, B ou C (soltar cedo dá um pulo mais baixo), colide com os tiles sólidos e perde uma vida ao cair do mapa. Com uma animação de ataque escolhida (`anim_ataque`), o **B ataca** e o pulo fica no A e no C. No modo **visto de cima**, anda nas 4 direções, sem gravidade nem pulo.

Vidas e pontos ficam no topo da tela (plano window). Sem vidas, aparece GAME OVER e o jogo volta à cena principal.

## Mapas grandes (streaming)

Se os fundos e mapas da cena não cabem na VRAM, o build passa os mapas para streaming sozinho: só os tiles da janela em volta da câmera (42×30 células) ficam carregados, e o que entra e sai da janela é trocado enquanto a câmera anda. O build calcula o pior caso de tiles numa janela e só aceita a cena se ele couber; o relatório do build mostra "com streaming". O exemplo do Sota (Ibirapuera inteira, 4528×544) roda assim.

## Som

- **Música:** arquivos `.vgm` ou `.vgz` (YM2612 + PSG). O rescomp converte para XGM. Ao clicar no arquivo, o Inspetor mostra a forma de onda e toca a música nos chips emulados, como ela vai soar no console.
- **Efeitos:** arquivos `.wav`, tocados pelo driver XGM no canal de PCM. O Inspetor também toca o WAV. Além dos sons dos nodes (pulo, golpe, dano, moeda…), um quadro de animação pode tocar um efeito (veja **Som no quadro** no gestor de animações).

## Atores e código

O MDJogador e o MDInimigo já vêm com o comportamento pronto. Para um personagem com mecânica própria (dash, pulo na parede, combos, inimigos que atacam de longe), use um **MDAtor**: como no Godot, o node dá o desenho, o corpo e as animações, e o que ele faz fica num código preso a ele. O Mega Drive não roda GDScript, então o código é C, compilado junto com o jogo.

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
- `v[0]` a `v[7]`, variáveis livres. Um `#define ESTADO v[0]` deixa o código legível.

**Funções** (todas em `src/gerado/ator.h`):

| Para quê | Funções |
|---|---|
| Controle 1 | `botao(BOTAO_…)` (segurando), `apertou(…)` e `soltou(…)` (só no quadro em que mudou); os botões podem ser somados: `BOTAO_A \| BOTAO_C` |
| Movimento | `mover_e_colidir(eu)`, `aplicar_gravidade(eu, gravidade, maxima)`, `virar(eu, direcao)` |
| Colisão | `celula_em(x, y)` (`CELULA_SOLIDA`, `CELULA_ATRAVESSAVEL`, `CELULA_ESPINHO`, `CELULA_AGUA`), `area_solida(x, y, l, a)`, `celulas_no_corpo(eu)`, `corpo_esquerda`, `corpo_topo`, `centro_x`, `centro_y` |
| Animação | `tocar_animacao(eu, ANIM_…)` (continua se já está tocando), `reiniciar_animacao`, `animacao_acabou`, `quadro_animacao`; os sons dos quadros do gestor de animações tocam sozinhos |
| Outros atores | `proximo_ator(anterior, GRUPO_…)` para percorrer um grupo, `primeiro_ator`, `tocando(a, b)`, `ator_na_area(eu, x, y, l, a, GRUPO_…, anterior)` (a área de um golpe, relativa aos pés e espelhada pela direção), `ferir(alvo, dano, invencivel)`, `distancia_x`, `distancia_y`, `criar_ator`, `remover_ator(eu)` |
| Tela e som | `ator_camera` (quem a câmera segue), `na_tela(eu)`, `tela_x()`, `tela_y()`, `tocar_som(SOM_…)`; as variáveis `vidas` e `pontos` do jogo |

**Grupos:** os grupos do node, na aba **Grupos** ao lado do Inspetor, viram `GRUPO_<NOME>`. Por exemplo, um golpe acerta quem está no grupo "inimigo":

```c
for (Ator *alvo = NULL; (alvo = ator_na_area(eu, 4, -30, 32, 20, GRUPO_INIMIGO, alvo));) {
	ferir(alvo, 1, 30);
}
```

**Animações:** vão para a ROM só a animação inicial e as que o código cita (`ANIM_<NOME>`, com o nome em maiúsculas e `_` no lugar de espaços e hifens). Num personagem com dezenas de animações, a ROM leva só as usadas.

Com `camera_segue`, a câmera (e a MDCamera, se houver) segue o ator, e as MDSaida levam a outra cena quando ele entra nelas. Sem `codigo`, o ator fica parado tocando a animação inicial. Os arquivos `src/gerado/ator.c`, `ator.h`, `atores.h` e `codigo_<nome>.h` são refeitos no build; não os edite.

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

A lista de compilação do clangd fica em `.godot/clangd`, fora do projeto. O caminho do clangd está em Configurações do editor → `retro_studio/clangd/path`.

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
- Chips de contexto (Arquivo aberto, erros do Build, Tilemap da cena com mapa, ROM), incluindo o que ainda não foi salvo.
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
| `ide_screenshot` | Captura da vista da cena ou da janela do editor |

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
