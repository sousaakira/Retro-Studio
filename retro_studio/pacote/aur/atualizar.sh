#!/usr/bin/env bash
# Atualiza o PKGBUILD e o .SRCINFO do retro-studio-bin para uma versão já publicada no GitHub:
# baixa o pacote Linux da Release e os zips do kit e do BlastEm, calcula os sha256 e grava os dois
# arquivos. Não precisa do makepkg (o .SRCINFO sai daqui, no formato do makepkg --printsrcinfo).
# Uso: retro_studio/pacote/aur/atualizar.sh 1.0.1 [pkgrel]
#   TARBALL=caminho/retro-studio-1.0.1-linux-x86_64.tar.gz  usa um pacote local (teste antes da Release)
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSAO="${1:?Uso: $0 <versão> [pkgrel]}"
VERSAO="${VERSAO#v}"
PKGREL="${2:-1}"
TEMPORARIO="$(mktemp -d)"
trap 'rm -rf -- "$TEMPORARIO"' EXIT

baixar() { # baixar <url> <arquivo>
	curl -fsSL --retry 3 -A "retro-studio-aur/1.0" -o "$2" "$1"
}
soma() { sha256sum "$1" | cut -c1-64; }

TAR="retro-studio-${VERSAO}-linux-x86_64.tar.gz"
if [ -n "${TARBALL:-}" ]; then
	cp "$TARBALL" "$TEMPORARIO/$TAR"
else
	baixar "https://github.com/sousaakira/Retro-Studio/releases/download/v${VERSAO}/$TAR" "$TEMPORARIO/$TAR"
fi
baixar https://api.retrostudio.dev/packages/marsdev-linux-x64.zip "$TEMPORARIO/marsdev.zip"
baixar https://api.retrostudio.dev/packages/blastem-linux-x64.zip "$TEMPORARIO/blastem.zip"
tar -tzf "$TEMPORARIO/$TAR" "retro-studio-${VERSAO}-linux-x86_64/bin/retro-studio" >/dev/null

S_TAR="$(soma "$TEMPORARIO/$TAR")"
S_KIT="$(soma "$TEMPORARIO/marsdev.zip")"
S_EMU="$(soma "$TEMPORARIO/blastem.zip")"
S_DESKTOP="$(soma "$AQUI/retro-studio.desktop")"

python3 - "$AQUI/PKGBUILD" "$VERSAO" "$PKGREL" "$S_TAR" "$S_KIT" "$S_EMU" "$S_DESKTOP" <<'EOF'
import re, sys
caminho, versao, pkgrel, *somas = sys.argv[1:]
texto = open(caminho, encoding="utf-8").read()
texto = re.sub(r"^pkgver=.*$", f"pkgver={versao}", texto, count=1, flags=re.M)
texto = re.sub(r"^pkgrel=.*$", f"pkgrel={pkgrel}", texto, count=1, flags=re.M)
bloco = "sha256sums=(" + "\n\t".join(f"'{s}'" for s in somas) + ")"
texto, n = re.subn(r"^sha256sums=\([^)]*\)", bloco, texto, count=1, flags=re.M)
assert n == 1, "sha256sums não encontrado no PKGBUILD"
open(caminho, "w", encoding="utf-8").write(texto)
EOF

# .SRCINFO a partir do PKGBUILD (as mesmas chaves e a mesma ordem do makepkg --printsrcinfo).
(
	# shellcheck disable=SC1091
	source "$AQUI/PKGBUILD"
	echo "pkgbase = $pkgname"
	printf '\tpkgdesc = %s\n\tpkgver = %s\n\tpkgrel = %s\n\turl = %s\n' "$pkgdesc" "$pkgver" "$pkgrel" "$url"
	for a in "${arch[@]}"; do printf '\tarch = %s\n' "$a"; done
	for l in "${license[@]}"; do printf '\tlicense = %s\n' "$l"; done
	for d in "${depends[@]}"; do printf '\tdepends = %s\n' "$d"; done
	for d in "${optdepends[@]}"; do printf '\toptdepends = %s\n' "$d"; done
	for p in "${provides[@]}"; do printf '\tprovides = %s\n' "$p"; done
	for c in "${conflicts[@]}"; do printf '\tconflicts = %s\n' "$c"; done
	for n in "${noextract[@]}"; do printf '\tnoextract = %s\n' "$n"; done
	for o in "${options[@]}"; do printf '\toptions = %s\n' "$o"; done
	for s in "${source[@]}"; do printf '\tsource = %s\n' "$s"; done
	for s in "${sha256sums[@]}"; do printf '\tsha256sums = %s\n' "$s"; done
	printf '\npkgname = %s\n' "$pkgname"
) >"$AQUI/.SRCINFO"

echo "PKGBUILD e .SRCINFO atualizados para ${VERSAO}-${PKGREL}."
