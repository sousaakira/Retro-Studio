# Projeto inicial jogável

Um jogo de plataforma mínimo para Mega Drive feito só com os módulos de runtime
do Retro Studio. Serve de ponto de partida: troque a arte, os mapas e os sons
pelos seus e continue a partir de `src/main.c`.

## O que tem

| Elemento | Onde editar |
|----------|-------------|
| Personagem, animações (parado, andando, pulando, caindo) e evento de passo | Charset Maker (`charsets/hero.charset.json`) |
| Duas salas com terreno e colisão | Editor de mapas (`maps/hall.tmx`, `maps/cave.tmx`) |
| Ligação entre as salas e checkpoint | Recursos → Runtime → Salas e conexões |
| Câmera | Recursos → Runtime → Câmera |
| Música por sala e efeitos | Recursos → Runtime → Áudio |
| Lógica do jogo | `src/main.c` |

Controles: esquerda/direita andam, B ou C pulam, START volta ao checkpoint.

## Build limpo

Pela IDE: **Build** ou **Run**. Pelo terminal, na pasta do projeto:

```sh
make clean
make release GDK=<pasta do SGDK 1.81>
```

A ROM sai em `out/rom.bin`. O build precisa de `make`, Java (rescomp), Python 3
com Pillow (mapas) e Node (cenas). Em Recursos → Runtime → **Base técnica e
ferramentas** a IDE mostra o que falta nesta máquina e separa problemas do
ambiente de problemas do projeto.

## De onde vêm os arquivos

- `src/generated/`, `res/generated/` e `res/audio_resources.res` são gerados pelos
  editores; não edite à mão. Se um deles faltar, abra o editor correspondente e
  use “Salvar e exportar”.
- `src/retro_runtime/` e `src/retrostudio/` são os módulos instalados pela IDE.
- `retro-studio.toolchain.json` registra com quais versões o projeto foi criado.

## Licença dos recursos

A arte, a música e os efeitos deste exemplo foram gerados por programa para o
Retro Studio e podem ser usados e redistribuídos livremente, inclusive em jogos
comerciais.
