#!/usr/bin/env bash
# Monta o pacote do Retro Studio para Linux: retro-studio-<data>-<commit>-linux-x86_64.tar.gz
#   bin/retro-studio  o editor compilado (bin/godot.linuxbsd.editor.x86_64, sem símbolos de depuração)
#   kit/              o kit SGDK/MarsDev (só o m68k-elf) e o BlastEm desta máquina
#   jogo_padrao/      o jogo de exemplo, como está no git
#   docs/, licencas/, instalar.sh, LEIA-ME.txt
# Uso: retro_studio/empacotar.sh [pasta de saída]   (padrão: bin/)
# KIT_ORIGEM e EMULADOR_ORIGEM mudam de onde vêm o kit e o emulador. Sem eles, o pacote sai sem esses
# componentes e o instalador os baixa.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAIDA="$(mkdir -p "${1:-$RAIZ/bin}" && cd "${1:-$RAIZ/bin}" && pwd)"
KIT_ORIGEM="${KIT_ORIGEM:-$HOME/.retrostudio/toolkit/marsdev/mars}"
EMULADOR_ORIGEM="${EMULADOR_ORIGEM:-$HOME/.retrostudio/emulators/blastem}"
EDITOR="$RAIZ/bin/godot.linuxbsd.editor.x86_64"
NOME="retro-studio-$(date +%Y.%m.%d)-$(git -C "$RAIZ" rev-parse --short HEAD)-linux-x86_64"

if [ ! -x "$EDITOR" ]; then
	echo "Compile o editor antes (scons): falta $EDITOR." >&2
	exit 1
fi
if [ -n "$(git -C "$RAIZ" status --porcelain -- retro_studio/jogo_padrao ':!retro_studio/jogo_padrao/**/*.uid')" ]; then
	echo "Aviso: retro_studio/jogo_padrao tem mudanças fora do git; o pacote leva a versão do último commit." >&2
fi

TEMPORARIO="$(mktemp -d)"
trap 'rm -r -- "$TEMPORARIO"' EXIT
P="$TEMPORARIO/$NOME"
mkdir -p "$P/bin" "$P/docs" "$P/licencas"

echo "Editor…"
strip -o "$P/bin/retro-studio" "$EDITOR"
cp "$RAIZ/main/app_icon.png" "$P/retro-studio.png"
cp "$RAIZ/LICENSE.txt" "$P/licencas/godot-LICENSE.txt"
cp "$RAIZ/COPYRIGHT.txt" "$P/licencas/godot-COPYRIGHT.txt"

echo "Jogo de exemplo e documentos…"
git -C "$RAIZ" archive HEAD retro_studio/jogo_padrao | tar -x -C "$TEMPORARIO"
mv "$TEMPORARIO/retro_studio/jogo_padrao" "$P/jogo_padrao"
cp "$RAIZ/retro_studio/docs/GUIA.md" "$P/docs/"
cp "$RAIZ/retro_studio/pacote/instalar.sh" "$RAIZ/retro_studio/pacote/LEIA-ME.txt" "$RAIZ/retro_studio/pacote/LICENCAS.txt" "$P/"
chmod +x "$P/instalar.sh"

if [ -f "$KIT_ORIGEM/m68k-elf/makefile.gen" ]; then
	echo "Kit SGDK/MarsDev…"
	mkdir -p "$P/kit/marsdev/mars"
	cp -a "$KIT_ORIGEM/m68k-elf" "$P/kit/marsdev/mars/"
	[ -f "$KIT_ORIGEM/marsdev/LICENSE" ] && cp "$KIT_ORIGEM/marsdev/LICENSE" "$P/licencas/marsdev-LICENSE.txt"
else
	echo "Sem o kit em $KIT_ORIGEM: o instalador vai baixá-lo." >&2
fi

if [ -x "$EMULADOR_ORIGEM/blastem" ]; then
	echo "BlastEm…"
	mkdir -p "$P/kit/blastem"
	# Só o emulador e o que ele lê; ficam de fora as ferramentas de depuração e os arquivos de uso.
	for item in blastem lib shaders images default.cfg rom.db menu.bin; do
		[ -e "$EMULADOR_ORIGEM/$item" ] && cp -a "$EMULADOR_ORIGEM/$item" "$P/kit/blastem/"
	done
	for licenca in COPYING SDL-LICENSE GLEW-LICENSE; do
		for pasta in "$EMULADOR_ORIGEM" "$EMULADOR_ORIGEM/old"; do
			if [ -f "$pasta/$licenca" ]; then
				cp "$pasta/$licenca" "$P/licencas/blastem-$licenca.txt"
				break
			fi
		done
	done
else
	echo "Sem o BlastEm em $EMULADOR_ORIGEM: o instalador vai baixá-lo." >&2
fi

echo "Compactando…"
tar -C "$TEMPORARIO" -czf "$SAIDA/$NOME.tar.gz" "$NOME"
echo "Pacote: $SAIDA/$NOME.tar.gz ($(du -h "$SAIDA/$NOME.tar.gz" | cut -f1))"
