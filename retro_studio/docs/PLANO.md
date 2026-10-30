# Retro Studio em cenas — plano

Atualizado em 30/10/2026.

## Rumo

O Retro Studio é o editor do Godot 4.7.2 transformado num editor de jogos de Mega Drive. O jogo é feito em cenas `.tscn` com nodes próprios (MDCena, MDMapa, MDJogador…), e o build converte as cenas em código e recursos do SGDK. Nada do motor do Godot roda no console. Por isso, a regra para decidir o que fica é uma só:

> **Fica o que ajuda a montar uma cena que vira código do SGDK. Sai o que só faz sentido para um jogo que roda no Godot.**

Consequências:

- Um node, propriedade ou painel que o gerador não traduz para o SGDK engana quem usa: parece funcionar no editor e some na ROM. Ele é escondido ou removido.
- Toda limitação do console aparece no editor, de preferência como aviso no node, antes do build: 80 sprites, 4 paletas de 16 cores, VRAM, tiles de 8×8.
- O código C é gerado e nunca sobrescreve o que o programador escreveu à mão (marca `// Gerado pelo Retro Studio`).

## Já feito

| Área | O que existe |
|------|--------------|
| Build | Perfil `retro_studio.py`: sem 3D, física, navegação, XR, Vulkan e 37 módulos. Sem as telas Game e Asset Store, a barra de execução, a exportação de jogos Godot, shaders e partículas. |
| SGDK | Compilar ROM (F6), Rodar no emulador (F5), painel SGDK com erros clicáveis e uso de VRAM por cena. |
| Nodes | MDCena (música, START), MDFundo, MDMapa (TileMap → MAP, colisão), MDSprite, MDJogador (pulo, vidas, sons), MDInimigo (patrulha, pisão), MDItem (pontos), MDSaida, MDTexto (piscar). |
| Jogo | Várias cenas com fade, vidas e pontos globais, GAME OVER, HUD no plano window, música XGM e efeitos PCM. |
| Jogo padrão | `retro_studio/jogo_padrao`: título → fase 1 → fase 2 → fim. |

## O que vamos descartar

Já descartado: 3D, física 2D/3D, navegação, XR, Vulkan/D3D12/Metal, Asset Store, tela Game, barra de execução, exportação para outras plataformas, shaders, partículas e materiais.

A descartar:

| O quê | Por quê |
|-------|---------|
| Nodes do Godot na janela "Criar Node" (Control, Camera2D, Light2D, Polygon2D, Timer, AudioStreamPlayer…) | O gerador não os traduz; eles somem na ROM. Continuam no motor porque a própria interface do editor é feita de Controls. |
| Botão "Interface de Usuário" e o "Cena 2D" genérico do painel Cena | Viram "Cena do Mega Drive", que cria uma MDCena. |
| Propriedades herdadas que o console ignora nos nodes MD: modulate, material, z-index, filtro e repetição de textura, offset, region, light mask, visibility layers, rotação e escala | Mexer nelas não muda nada no jogo. |
| Painéis Depurador, Áudio (barramentos), Monitor, Profiler e Árvore Remota | São do jogo rodando no Godot, que não existe aqui. |
| Módulos de imagem JPG, TGA e BMP | O rescomp do SGDK só aceita PNG indexado. O WebP fica: é o formato em que o editor guarda as texturas importadas. |
| Módulos de áudio MP3, OGG e Vorbis | O som do console é VGM/XGM e WAV convertido para PCM. |
| Asset Store, Rodar e Doar no gerenciador de projetos | Não há nada do Mega Drive na Asset Store, e o jogo roda no emulador. |
| GDScript | Script não roda no console. A lógica própria vai ser em C (ver "Código C por node"). Sai depois que o código C existir, para não deixar um buraco. |
| Editor de temas | Tema de interface do Godot não vira nada no Mega Drive. |

Fica do Godot: editor de cenas 2D, editor de TileMap/TileSet, Inspetor, Sistema de Arquivos, instância de cenas (pré-moldados), desfazer/refazer, editor de texto (para C), e AnimationPlayer e Path2D, que vão ganhar tradução para o SGDK (ver Fase C).

## O que vamos criar

### Fase A — editor focado

1. ✅ **"Criar Node" só com nodes do Mega Drive**, mais Node e Node2D para agrupar.
2. ✅ **Painel Cena:** "Cena do Mega Drive" no lugar de "Cena 2D" e "Interface de Usuário".
3. ✅ **Inspetor limpo:** os nodes MD escondem as propriedades herdadas que o console ignora.
4. ✅ **Painéis sem uso fora:** Depurador (com Monitor, Profiler e Árvore Remota), Áudio e o menu Depurar. O editor de temas só aparece ao abrir um recurso Theme e fica para depois.
5. ✅ **Novo projeto do Mega Drive** no gerenciador de projetos: cria `Makefile`, `project.godot` (320×224, sem filtro de textura, renderizador Compatibilidade), `.gitignore` com o que o SGDK gera, `res/`, `src/` e uma MDCena inicial que já compila.
6. ✅ **Build menor:** sem os módulos JPG, TGA, BMP, MP3, OGG e Vorbis (o WebP voltou: sem ele, as texturas já importadas não abrem).
7. ✅ **Gerenciador de projetos:** sem a aba Asset Store e os botões Rodar e Doar.
8. ✅ **Abrir a cena principal** ao abrir um projeto pela primeira vez.

### Fase B — ferramentas do Mega Drive

9. ✅ **Painel Paletas** (painel Console): as 4 paletas da cena aberta, as 16 cores de cada uma e quais nodes usam cada paleta; aviso quando dois recursos disputam a mesma.
10. ✅ **VRAM ao vivo** no painel Console: barras de tiles de fundos e mapas, de tiles de sprites e de número de sprites da cena aberta, contadas como o rescomp e o build contam.
11. ✅ **Converter imagem para o console:** "Converter para o Mega Drive" no menu do Sistema de Arquivos grava `nome_md.png`: lados múltiplos de 8, cores na grade do console e no máximo 15 cores (corte na mediana) mais a transparência. Falta: pontilhado opcional para degradês.
12. ✅ **Ouvir no editor:** `.vgm`/`.vgz` abrem como AudioStreamVGM e tocam no Inspetor (forma de onda, tocar/parar, loop) nos chips emulados YM2612 + SN76489, portados do Retro Studio em Electron; o sinal é idêntico ao do original. O WAV toca pelo importador do Godot.

### Fase C — recursos de jogo

13. ✅ **Código C da cena:** `src/<cena>.c` com `<cena>_iniciar()` e `<cena>_atualizar()`, chamadas pelo código gerado (símbolos fracos: sem o arquivo, nada muda); `gerado/cena_<cena>.h` dá os sprites pelo nome do node. Projeto → Ferramentas → "Criar código C da cena" cria o modelo. Exemplo: `src/titulo.c` no jogo padrão.
14. ✅ **Plataformas que se movem:** MDPlataforma vai e volta em linha reta (deslocamento e velocidade), atravessável por baixo, sólida por cima, e carrega o jogador. Jogo padrão: uma sobre o buraco da fase 1 e um elevador na fase 2. Falta: trajeto por Path2D.
15. ✅ **Ponto de retorno:** MDRetorno (área com bandeira no editor, som opcional); depois de passar por ele, morrer traz o jogador de volta ali até sair da cena.
16. ✅ **Fundo com parallax:** `rolagem` do MDFundo (% da câmera); com uma imagem de 512 px (a largura do plano) o fundo emenda ao rolar. Jogo padrão: fundo de 512 px a 25% nas fases.
17. **Jogo visto de cima:** MDJogador em modo de 4 direções, sem gravidade.
18. **Cenas animadas** com o AnimationPlayer (cutscenes simples).

### Fase D — acabamento

19. Nome, ícone e tela inicial do Retro Studio no lugar dos do Godot.
20. Guia de uso em `retro_studio/docs/`: criar projeto, cada node e suas limitações.
21. Pacote para instalar (o editor mais o kit SGDK/MarsDev e o BlastEm).

## Estratégia

- **Ordem:** A → B → C → D. O editor focado vem primeiro porque todo o resto é construído e testado em cima dele. Na fase C, cada recurso nasce junto com um uso no jogo padrão.
- **Cortes protegidos:** o código do Godot que sai fica atrás de `#ifdef RETRO_STUDIO` (ou das macros `_3D_DISABLED` e afins). Assim dá para comparar com o Godot puro e acompanhar versões novas dele.
- **Teste de cada passo:** compilar o editor, abrir o jogo padrão numa cópia temporária, compilar a ROM pelo editor (F6) e jogar no BlastEm. Nada é dado como pronto só porque compilou.
- **Commits:** locais, um por passo, em pt-BR; sem push.
- **Fora de escopo por enquanto:** projetos existentes em Electron (Sota, Alice e Tempo seguem lá) e outros consoles.
