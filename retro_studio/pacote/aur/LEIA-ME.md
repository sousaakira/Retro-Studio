# Pacote do Arch Linux (AUR): retro-studio-bin

Este pacote instala o Retro Studio em `/opt/retro-studio` usando o pacote Linux da Release do GitHub (editor, Java mínimo e `make`). Ele também acrescenta o kit SGDK/MarsDev e o BlastEm do servidor do Retro Studio (`api.retrostudio.dev/packages`). O comando `retro-studio` vai para `/usr/bin`, e o atalho vai para o menu de aplicativos.

O editor procura o kit e o emulador em `/opt/retro-studio/kit` quando não há outros em `~/.retrostudio`. O que estiver configurado em Configurações do Editor → Retro Studio continua valendo. O pacote não leva o `instalar.sh`: no lugar do botão **Reparar**, o painel SGDK diz para reinstalar o pacote.

## Instalar

Enquanto o pacote não está no AUR, ele pode ser instalado direto do repositório:

```bash
git clone --depth 1 https://github.com/sousaakira/Retro-Studio
cd Retro-Studio/retro_studio/pacote/aur
makepkg -si
```

Depois de publicado no AUR, a instalação fica assim: `yay -S retro-studio-bin` (ou `paru -S retro-studio-bin`).

## Lançar uma versão nova

1. Publique a Release no GitHub. Para isso, mude `retro_studio_version` no `version.py`, escreva `retro_studio/notas-de-versao/v<versão>.md`, faça o commit, crie a tag `v<versão>` e envie. O CI monta os pacotes e cria a Release.
2. Rode `retro_studio/pacote/aur/atualizar.sh <versão>`. Ele baixa o pacote da Release e os zips do kit e do BlastEm, grava os sha256 no `PKGBUILD` e gera o `.SRCINFO`. Não precisa do `makepkg`. Para mudar só o pacote sem versão nova do Retro Studio, use `atualizar.sh <versão> 2`, que sobe o `pkgrel`.
3. Faça o commit do `PKGBUILD` e do `.SRCINFO` no repositório.
4. Envie para o AUR (veja abaixo).

Atenção: os zips do servidor não têm a versão no nome (`marsdev-linux-x64.zip`, `blastem-linux-x64.zip`). Se um deles for trocado no servidor, o sha256 deixa de bater e o pacote não instala até alguém rodar o `atualizar.sh` de novo. O ideal é publicar os próximos com a versão no nome e apontar o `PKGBUILD` para eles.

## Publicar no AUR

As inscrições novas do AUR estavam fechadas em 04/11/2026. Quando reabrirem:

1. Crie a conta em https://aur.archlinux.org/register e cadastre no perfil uma chave SSH pública (por exemplo, `ssh-keygen -t ed25519 -f ~/.ssh/aur`).
2. Ponha no `~/.ssh/config`:
   ```
   Host aur.archlinux.org
     User aur
     IdentityFile ~/.ssh/aur
   ```
3. Na primeira vez (o primeiro push cria o pacote):
   ```bash
   git clone ssh://aur@aur.archlinux.org/retro-studio-bin.git ~/aur/retro-studio-bin
   ```
4. A cada versão:
   ```bash
   cd ~/aur/retro-studio-bin
   cp <repositório>/retro_studio/pacote/aur/{PKGBUILD,.SRCINFO,retro-studio.desktop} .
   git add PKGBUILD .SRCINFO retro-studio.desktop
   git commit -m "retro-studio-bin <versão>-<pkgrel>"
   git push
   ```

O repositório do AUR só aceita arquivos na raiz e exige o `.SRCINFO` em todo commit.
