# Retro Studio

<p align="center">
  <img src="main/app_icon.png" alt="Retro Studio" width="128" />
</p>

**Editor de jogos de Mega Drive (Genesis).** O jogo é montado em cenas, com nodes próprios para o console (MDCena, MDMapa, MDJogador, MDColisao…). Ao compilar, o editor converte as cenas em código C e recursos do SGDK, e o SGDK gera a ROM. O que aparece no editor é o que o console consegue fazer.

## Baixar

Os pacotes ficam nas [Releases](https://github.com/sousaakira/Retro-Studio/releases/latest):

| Sistema | Pacote | Como instalar |
|---------|--------|---------------|
| Linux x86_64 (glibc 2.35+: Ubuntu 22.04, Debian 12, Fedora 36 ou mais novos) | `retro-studio-<versão>-linux-x86_64.tar.gz` | Descompacte e rode `./instalar.sh` (sem sudo). Ele baixa o kit SGDK e o BlastEm e, no fim, compila uma ROM de teste. |
| Windows 10/11, 64 bits | `retro-studio-<versão>-windows-x86_64.zip` | Descompacte e clique duas vezes em `Instalar.cmd` (sem administrador). O kit e o BlastEm vêm no pacote. |

**Arch Linux:** o pacote `retro-studio-bin` (kit e BlastEm incluídos, em `/opt/retro-studio`) ainda não está no AUR; dá para instalar direto do repositório:

```bash
git clone --depth 1 https://github.com/sousaakira/Retro-Studio
cd Retro-Studio/retro_studio/pacote/aur && makepkg -si
```

O Java e o `make` usados no build vêm junto; não é preciso instalar nada do sistema. Se algo faltar depois, a faixa no topo do painel SGDK tem o botão **Reparar**.

## O que tem

- **Cenas do Mega Drive:** mapas nos planos A e B, colisão, prioridade, jogador, inimigos, itens, plataformas, câmera, saídas entre cenas, letreiros com acentos, músicas (XGM) e efeitos (WAV).
- **Editor de mapas** em janela própria, com paleta de tiles, camadas e consertos de um clique para imagens fora do formato do console.
- **Build e emulador:** Compilar ROM (F6), Rodar no BlastEm (F5), erros do gcc com link para a linha e uso de VRAM por cena.
- **Versões para teste:** ROMs numeradas com o registro do que mudou.
- **IA:** painel com agentes (ACP) e notas na cena para pedir mudanças.

O guia completo está em [`retro_studio/docs/GUIA.md`](retro_studio/docs/GUIA.md).

## Compilar a partir do código

Precisa de Python 3 com SCons, um compilador C++ (gcc ou clang) e as bibliotecas de desenvolvimento do X11/Wayland e do OpenGL (as mesmas de compilar o Godot):

```bash
scons -j$(nproc)                 # gera bin/retro-studio
retro_studio/empacotar.sh        # monta o pacote em bin/
```

O CI (`.github/workflows/retro-studio.yml`) compila Linux e Windows a cada envio para a `main` e publica a Release quando recebe uma tag `v*`.

## Retro Studio em Electron

A versão anterior, feita em Electron e Vue (até a v0.16.0), continua na branch [`electron`](https://github.com/sousaakira/Retro-Studio/tree/electron). Os projetos dela usam mapas TMX e não abrem direto nesta versão.

## Licença

Software livre, sob a licença MIT. O Retro Studio é baseado no [Godot Engine](https://godotengine.org) (© 2014-presente, contribuidores do Godot Engine; © 2007-2014, Juan Linietsky e Ariel Manzur), também MIT; veja [`LICENSE.txt`](LICENSE.txt) e [`COPYRIGHT.txt`](COPYRIGHT.txt). As licenças do SGDK, do BlastEm, do Java e das demais ferramentas vão na pasta `licencas/` do pacote.
