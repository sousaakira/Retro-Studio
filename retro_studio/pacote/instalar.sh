#!/usr/bin/env bash
# Instala o Retro Studio para o usuário atual, sem sudo:
#   editor e jogo de exemplo em ~/.local/share/retro-studio (atalho em ~/.local/bin e no menu);
#   kit SGDK/MarsDev em ~/.retrostudio/toolkit/marsdev/mars e BlastEm em ~/.retrostudio/emulators/blastem,
#   os caminhos que o editor usa por padrão.
# O que já estiver instalado em ~/.retrostudio é mantido. O que não vier no pacote nem existir na
# máquina é baixado do servidor do Retro Studio.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTINO="${RETRO_STUDIO_DESTINO:-$HOME/.local/share/retro-studio}"
KIT="$HOME/.retrostudio/toolkit/marsdev/mars"
EMULADOR="$HOME/.retrostudio/emulators/blastem"
PACOTES="https://api.retrostudio.dev/packages"

baixar() {
	# baixar <pacote.zip> <pasta>: baixa do servidor e descompacta na pasta.
	local pacote="$1" pasta="$2" temporario
	for programa in curl unzip; do
		if ! command -v "$programa" >/dev/null; then
			echo "Para baixar $pacote é preciso o programa $programa (sudo apt install $programa)." >&2
			return 1
		fi
	done
	temporario="$(mktemp -d)"
	echo "Baixando $pacote…"
	curl -fL --progress-bar -o "$temporario/$pacote" "$PACOTES/$pacote"
	mkdir -p "$pasta"
	unzip -q -o "$temporario/$pacote" -d "$pasta"
	rm -r -- "$temporario"
}

echo "== Editor =="
mkdir -p "$DESTINO" "$HOME/.local/bin" "$HOME/.local/share/applications"
cp "$AQUI/bin/retro-studio" "$DESTINO/retro-studio"
chmod +x "$DESTINO/retro-studio"
cp "$AQUI/retro-studio.png" "$DESTINO/retro-studio.png"
rm -rf -- "$DESTINO/docs" "$DESTINO/licencas"
cp -r "$AQUI/docs" "$AQUI/licencas" "$DESTINO/"
# O jogo de exemplo é uma cópia para estudar; uma cópia já instalada (talvez editada) não é trocada.
if [ -e "$DESTINO/jogo_padrao" ]; then
	echo "Jogo de exemplo mantido em $DESTINO/jogo_padrao."
else
	cp -r "$AQUI/jogo_padrao" "$DESTINO/jogo_padrao"
fi
ln -sf "$DESTINO/retro-studio" "$HOME/.local/bin/retro-studio"
cat > "$HOME/.local/share/applications/retro-studio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Retro Studio
Comment=Jogos de Mega Drive em cenas
Exec=$DESTINO/retro-studio --project-manager
Icon=$DESTINO/retro-studio.png
StartupWMClass=retro-studio
Categories=Development;Game;
Terminal=false
EOF
echo "Editor em $DESTINO (comando retro-studio e atalho no menu)."

echo "== Kit SGDK/MarsDev =="
if [ -f "$KIT/m68k-elf/makefile.gen" ]; then
	echo "Já instalado em $KIT; mantido."
elif [ -d "$AQUI/kit/marsdev/mars/m68k-elf" ]; then
	mkdir -p "$KIT"
	cp -a "$AQUI/kit/marsdev/mars/m68k-elf" "$KIT/"
	echo "Instalado em $KIT."
else
	baixar marsdev-linux-x64.zip "$KIT"
fi

echo "== Emulador BlastEm =="
if [ -x "$EMULADOR/blastem" ]; then
	echo "Já instalado em $EMULADOR; mantido."
elif [ -x "$AQUI/kit/blastem/blastem" ]; then
	mkdir -p "$EMULADOR"
	cp -a "$AQUI/kit/blastem/." "$EMULADOR/"
	echo "Instalado em $EMULADOR."
else
	baixar blastem-linux-x64.zip "$EMULADOR"
fi

# O build do SGDK chama o make e o rescomp, que é um programa Java.
faltando=()
command -v make >/dev/null || faltando+=(make)
command -v java >/dev/null || faltando+=(default-jre)
echo
if [ ${#faltando[@]} -gt 0 ]; then
	echo "Falta instalar no sistema: ${faltando[*]}"
	echo "    sudo apt install ${faltando[*]}"
	echo
fi
echo "Pronto. Abra com: retro-studio --project-manager"
echo "O jogo de exemplo está em $DESTINO/jogo_padrao (Importar no gerenciador de projetos)."
