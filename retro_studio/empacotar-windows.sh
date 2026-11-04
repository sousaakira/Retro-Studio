#!/usr/bin/env bash
# Monta o pacote do Retro Studio para Windows: retro-studio-<data>-<commit>-windows-x86_64.zip
#   retro-studio.exe (e retro-studio.console.exe, que mostra a saída num terminal)
#   kit/sgdk     kit SGDK para Windows: as ferramentas do SGDK oficial para Windows (gcc 13.2, make, sh
#                do msys) com a biblioteca, os cabeçalhos e os .jar do SGDK 1.81, o mesmo do kit Linux;
#                a libmd.a é compilada de novo aqui com esse gcc
#   kit/jre      Java mínimo (jlink: java.base e java.desktop, o que o rescomp usa)
#   kit/blastem  BlastEm para Windows (traz a própria SDL2)
#   jogo_padrao/, teste_kit/, docs/, licencas/, instalar.ps1, Instalar.cmd, LEIA-ME.txt
# Roda no Windows (Git Bash do GitHub Actions), porque compila a libmd.a e confere o kit com as
# ferramentas .exe. Variáveis:
#   EDITOR_EXE, EDITOR_CONSOLE_EXE  o editor compilado para Windows (e o .console.exe)
#   KIT_LINUX     a pasta m68k-elf do kit Linux (inc, src, res, makefile.gen, common.mk, jars do SGDK 1.81)
#   SGDK_7Z       o sgdk211.7z do SGDK oficial (https://github.com/Stephane-D/SGDK/releases)
#   BLASTEM_ZIP   o blastem-win64-*.zip (https://www.retrodev.com/blastem/nightlies/)
#   JDK_ORIGEM    um JDK 17+ com jlink (o Temurin do runner)
# Uso: retro_studio/empacotar-windows.sh [pasta de saída]   (padrão: bin/)
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAIDA="$(mkdir -p "${1:-$RAIZ/bin}" && cd "${1:-$RAIZ/bin}" && pwd)"
# Na tag de uma versão (v1.0.0 no CI), o pacote leva o número dela; fora disso, a data e o commit.
if [ "${GITHUB_REF_TYPE:-}" = tag ] && [ -n "${GITHUB_REF_NAME:-}" ]; then
	NOME="retro-studio-${GITHUB_REF_NAME#v}-windows-x86_64"
else
	NOME="retro-studio-$(date +%Y.%m.%d)-$(git -C "$RAIZ" rev-parse --short HEAD)-windows-x86_64"
fi
for variavel in EDITOR_EXE KIT_LINUX SGDK_7Z BLASTEM_ZIP JDK_ORIGEM; do
	if [ -z "${!variavel:-}" ]; then
		echo "Falta a variável $variavel (veja o cabeçalho do script)." >&2
		exit 1
	fi
done

TEMPORARIO="$(mktemp -d)"
trap 'rm -rf -- "$TEMPORARIO"' EXIT
P="$TEMPORARIO/$NOME"
mkdir -p "$P/kit" "$P/docs" "$P/licencas"

echo "Editor…"
cp "$EDITOR_EXE" "$P/retro-studio.exe"
[ -n "${EDITOR_CONSOLE_EXE:-}" ] && [ -f "$EDITOR_CONSOLE_EXE" ] && cp "$EDITOR_CONSOLE_EXE" "$P/retro-studio.console.exe"
cp "$RAIZ/platform/windows/godot.ico" "$P/retro-studio.ico"

echo "Kit SGDK para Windows…"
KIT="$P/kit/sgdk"
7z x -y -o"$TEMPORARIO/sgdk" "$SGDK_7Z" >/dev/null
mkdir -p "$KIT/lib"
cp -r "$TEMPORARIO/sgdk/bin" "$KIT/bin"
cp "$TEMPORARIO/sgdk/lib/libgcc.a" "$KIT/lib/" # A libgcc tem de ser a do gcc que compila.
# Do SGDK 1.81 (o do kit Linux): a biblioteca, os cabeçalhos e os .jar, para o jogo sair igual.
for item in inc src res makefile.gen makelib.gen common.mk md.ld; do
	rm -rf -- "${KIT:?}/$item"
	cp -r "$KIT_LINUX/$item" "$KIT/$item"
done
cp "$KIT_LINUX"/bin/*.jar "$KIT/bin/"
# O common.mk do 1.81 chama o plugin do LTO pelo nome antigo; o gcc do SGDK 2.11 traz liblto_plugin.dll.
if [ -f "$KIT/bin/liblto_plugin.dll" ]; then
	sed -i 's/liblto_plugin-0\.dll/liblto_plugin.dll/' "$KIT/common.mk"
fi
cp "$TEMPORARIO/sgdk/license.txt" "$P/licencas/sgdk-license.txt"
[ -f "$TEMPORARIO/sgdk/COPYING.RUNTIME" ] && cp "$TEMPORARIO/sgdk/COPYING.RUNTIME" "$P/licencas/gcc-COPYING.RUNTIME.txt"

echo "Java mínimo (jlink)…"
"$JDK_ORIGEM/bin/jlink" --add-modules java.base,java.desktop --strip-debug --no-header-files --no-man-pages \
	--compress=2 --output "$P/kit/jre" 2>&1 | grep -v -i deprecated || true
"$P/kit/jre/bin/java.exe" -version 2>&1 | head -n1

echo "Biblioteca do SGDK (libmd.a) com o gcc do kit…"
GDK_WIN="$(cygpath -m "$KIT")"
(
	cd "$KIT"
	export GDK="$GDK_WIN" PATH="$KIT/bin:$P/kit/jre/bin:$PATH"
	rm -f lib/libmd.a lib/libmd_debug.a
	# Os dois alvos usam a mesma pasta de objetos: limpa entre um e outro.
	./bin/make.exe -f makelib.gen cleanobj >/dev/null 2>&1 || true
	./bin/make.exe -f makelib.gen release
	./bin/make.exe -f makelib.gen cleanobj >/dev/null 2>&1 || true
	./bin/make.exe -f makelib.gen debug || echo "Aviso: a libmd_debug.a não compilou (o build normal não usa)." >&2
	./bin/make.exe -f makelib.gen cleanobj >/dev/null 2>&1 || true
)
test -s "$KIT/lib/libmd.a"
GCC_VERSAO="$("$KIT/bin/gcc.exe" -dumpversion)"
printf 'SGDK 1.81 (biblioteca e cabeçalhos) com gcc %s e ferramentas do SGDK 2.11 para Windows\nmontado em %s, commit %s\n' \
	"$GCC_VERSAO" "$(date +%Y-%m-%d)" "$(git -C "$RAIZ" rev-parse --short HEAD)" >"$KIT/retro-studio-kit.txt"

echo "Conferência do kit: compilando o teste_kit…"
cp -r "$RAIZ/retro_studio/pacote/teste_kit" "$TEMPORARIO/teste"
(
	export GDK="$GDK_WIN" PATH="$KIT/bin:$P/kit/jre/bin:$PATH"
	"$KIT/bin/make.exe" -C "$(cygpath -m "$TEMPORARIO/teste")"
)
test -s "$TEMPORARIO/teste/out/rom.bin"

echo "BlastEm…"
7z x -y -o"$TEMPORARIO/blastem" "$BLASTEM_ZIP" >/dev/null
mv "$TEMPORARIO"/blastem/blastem-win64-* "$P/kit/blastem"
for licenca in COPYING SDL-LICENSE GLEW-LICENSE; do
	[ -f "$P/kit/blastem/$licenca.txt" ] && cp "$P/kit/blastem/$licenca.txt" "$P/licencas/blastem-$licenca.txt"
done

echo "Jogo de exemplo, documentos e instalador…"
git -C "$RAIZ" archive HEAD retro_studio/jogo_padrao | tar -x -C "$TEMPORARIO"
mv "$TEMPORARIO/retro_studio/jogo_padrao" "$P/jogo_padrao"
cp -r "$RAIZ/retro_studio/pacote/teste_kit" "$P/teste_kit"
cp "$RAIZ/retro_studio/docs/GUIA.md" "$P/docs/"
cp "$RAIZ/LICENSE.txt" "$P/licencas/godot-LICENSE.txt"
cp "$RAIZ/COPYRIGHT.txt" "$P/licencas/godot-COPYRIGHT.txt"
cp "$RAIZ/retro_studio/pacote/LICENCAS.txt" "$P/licencas/LEIA-ME.txt"
cp "$RAIZ/retro_studio/pacote/LICENCAS.txt" "$P/"
echo "As licenças do Java (OpenJDK, GPLv2 com a Classpath Exception) estão em kit/jre/legal." >"$P/licencas/java-LEIA-ME.txt"
cp "$RAIZ/retro_studio/pacote/windows/instalar.ps1" "$RAIZ/retro_studio/pacote/windows/Instalar.cmd" \
	"$RAIZ/retro_studio/pacote/windows/LEIA-ME.txt" "$P/"

echo "Compactando…"
rm -f "$SAIDA/$NOME.zip"
(cd "$TEMPORARIO" && 7z a -tzip -mx=7 "$SAIDA/$NOME.zip" "$NOME" >/dev/null)
echo "Pacote: $SAIDA/$NOME.zip ($(du -h "$SAIDA/$NOME.zip" | cut -f1))"
