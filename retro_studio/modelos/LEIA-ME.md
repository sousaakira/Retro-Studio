# Modelos de jogo

Projetos prontos que o gerenciador de projetos copia em "Novo projeto" → Modelo. O de plataforma é o
`retro_studio/jogo_padrao`. Estes são gerados por `retro_studio/tools/criar_modelos.py`; para mudar um
modelo, mude o script e rode de novo.

- `visto_de_cima/`: MDJogador no modo visto de cima, mapa com paredes, moedas e inimigos.
- `nave/`: nave com código C (MDAtor), tiros e inimigos criados pelo código, estrelas rolando.
- `briga_de_rua/`: dois jogadores (controles 1 e 2) com o mesmo código, capangas que perseguem.

Cada pasta tem um `modelo.cfg` com a cena principal e a descrição mostrada no gerenciador.
