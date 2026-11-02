#!/usr/bin/env bash
# Monta o pacote do Retro Studio para Linux: retro-studio-<data>-<commit>-linux-x86_64.tar.gz
#   bin/retro-studio  o editor compilado (sem símbolos de depuração)
#   kit/              Java mínimo (jre/) e make (bin/) para o build não depender do sistema; o kit
#                     SGDK/MarsDev (só o m68k-elf) e o BlastEm desta máquina, se houver
#   teste_kit/        projeto mínimo que o instalar.sh compila para conferir o kit
#   jogo_padrao/      o jogo de exemplo, como está no git
#   docs/, licencas/, instalar.sh, LEIA-ME.txt
# Uso: retro_studio/empacotar.sh [pasta de saída]   (padrão: bin/)
# O Java sai do jlink de um JDK 17 ou mais novo (JDK_ORIGEM, padrão: $JAVA_HOME ou o jlink do PATH);
# o Temurin traz as bibliotecas de imagem embutidas, então é o preferido (o do CI do GitHub).
# KIT_ORIGEM e EMULADOR_ORIGEM mudam de onde vêm o kit e o emulador. Sem eles, o pacote sai sem esses
# componentes e o instalador os baixa.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAIDA="$(mkdir -p "${1:-$RAIZ/bin}" && cd "${1:-$RAIZ/bin}" && pwd)"
KIT_ORIGEM="${KIT_ORIGEM:-$HOME/.retrostudio/toolkit/marsdev/mars}"
EMULADOR_ORIGEM="${EMULADOR_ORIGEM:-$HOME/.retrostudio/emulators/blastem}"
EDITOR="$RAIZ/bin/retro-studio"
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
# O índice das licenças vai também dentro de licencas/, a pasta que o instalar.sh copia.
cp "$RAIZ/retro_studio/pacote/LICENCAS.txt" "$P/licencas/LEIA-ME.txt"

echo "Jogo de exemplo e documentos…"
git -C "$RAIZ" archive HEAD retro_studio/jogo_padrao | tar -x -C "$TEMPORARIO"
mv "$TEMPORARIO/retro_studio/jogo_padrao" "$P/jogo_padrao"
cp "$RAIZ/retro_studio/docs/GUIA.md" "$P/docs/"
cp "$RAIZ/retro_studio/pacote/instalar.sh" "$RAIZ/retro_studio/pacote/LEIA-ME.txt" "$RAIZ/retro_studio/pacote/LICENCAS.txt" "$P/"
chmod +x "$P/instalar.sh"
cp -r "$RAIZ/retro_studio/pacote/teste_kit" "$P/teste_kit"

echo "Java mínimo (jlink)…"
JLINK="${JDK_ORIGEM:-${JAVA_HOME:-}}"
JLINK="${JLINK:+$JLINK/bin/}jlink"
if command -v "$JLINK" >/dev/null 2>&1; then
	# O rescomp usa java.desktop (ImageIO); apj, lz4w e sizebnd só o java.base (conferido com o jdeps).
	"$JLINK" --add-modules java.base,java.desktop --strip-debug --no-header-files --no-man-pages \
		--compress=2 --output "$P/kit/jre" 2>&1 | grep -v -i "deprecated" >&2 || true
	"$P/kit/jre/bin/java" -version 2>&1 | head -n1
	[ -d "$P/kit/jre/legal" ] && echo "As licenças do Java (OpenJDK, GPLv2 com a Classpath Exception) estão em kit/jre/legal." >"$P/licencas/java-LEIA-ME.txt"
else
	echo "Sem jlink (instale um JDK ou defina JDK_ORIGEM): o pacote sai sem Java e usa o do sistema." >&2
fi

echo "make…"
MAKE_ORIGEM="${MAKE_ORIGEM:-$(command -v make || true)}"
if [ -x "$MAKE_ORIGEM" ]; then
	mkdir -p "$P/kit/bin"
	cp "$MAKE_ORIGEM" "$P/kit/bin/make"
	strip "$P/kit/bin/make" 2>/dev/null || true
	echo "GNU make, licença GPL versão 3 ou posterior. Código-fonte: https://www.gnu.org/software/make/" >"$P/licencas/make-LEIA-ME.txt"
fi

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
	# old/ é o BlastEm oficial, que traz a própria SDL2: o editor usa quando faltam a SDL2 ou a GLEW no sistema.
	for item in blastem lib shaders images default.cfg rom.db menu.bin old; do
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
