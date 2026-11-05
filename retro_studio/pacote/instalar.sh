#!/usr/bin/env bash
# Instala o Retro Studio para o usuário atual, sem sudo:
#   editor, Java (só o que o SGDK usa), make e jogo de exemplo em ~/.local/share/retro-studio
#   (comando em ~/.local/bin e atalho no menu);
#   kit SGDK/MarsDev em ~/.retrostudio/toolkit/marsdev/mars e BlastEm em ~/.retrostudio/emulators/blastem,
#   os caminhos que o editor usa por padrão.
# O que já estiver instalado em ~/.retrostudio e funcionando é mantido; o que estiver quebrado (um
# download interrompido, por exemplo) é guardado de lado com outro nome e instalado de novo. O que
# não vier no pacote nem existir na máquina é baixado do servidor do Retro Studio.
# No fim, um projeto mínimo é compilado para conferir que o kit funciona.
#
# Uso: ./instalar.sh               instala (ou atualiza) e confere
#      ./instalar.sh --reparar     confere e conserta o que faltar (o botão Reparar do editor usa este modo)
#      ./instalar.sh --verificar   só confere e diz o que falta, sem mudar nada
#      ./instalar.sh --desinstalar remove o editor (o kit, o emulador e os projetos ficam)
# Variáveis: RETRO_STUDIO_DESTINO (pasta do editor), RETRO_STUDIO_SEM_PERGUNTAS=1 (não pergunta nada).
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTINO="${RETRO_STUDIO_DESTINO:-$HOME/.local/share/retro-studio}"
KIT="$HOME/.retrostudio/toolkit/marsdev/mars"
EMULADOR="$HOME/.retrostudio/emulators/blastem"
PACOTES="${RETRO_STUDIO_PACOTES:-https://api.retrostudio.dev/packages}"
MODO=instalar
case "${1:-}" in
	"") ;;
	--reparar) MODO=reparar ;;
	--verificar) MODO=verificar ;;
	--desinstalar) MODO=desinstalar ;;
	-h | --help)
		sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*)
		echo "Opção desconhecida: $1 (use --help)." >&2
		exit 2
		;;
esac

PROBLEMAS=()       # o que ficou sem resolver (mostrado no fim)
PACOTES_SISTEMA=() # pacotes do sistema que resolveriam algo (nomes do gerenciador desta distro)

problema() { PROBLEMAS+=("$1"); echo "  ✗ $1"; }
ok() { echo "  ✓ $1"; }
aviso() { echo "  ! $1"; }
data() { date +%Y%m%d-%H%M%S; }

# ---------------------------------------------------------------------------------------------------
# Gerenciador de pacotes da distribuição e o nome de cada dependência nele.
GERENCIADOR=""
for candidato in apt-get dnf zypper pacman; do
	if command -v "$candidato" >/dev/null 2>&1; then
		GERENCIADOR="$candidato"
		break
	fi
done
nome_do_pacote() {
	# nome_do_pacote <java|make|sdl2|glew|curl|unzip>
	case "$GERENCIADOR:$1" in
		apt-get:java) echo default-jre-headless ;;
		apt-get:sdl2) echo libsdl2-2.0-0 ;;
		apt-get:glew) echo libglew2.2 ;;
		dnf:java | zypper:java) echo java-21-openjdk-headless ;;
		dnf:sdl2) echo SDL2 ;;
		dnf:glew) echo glew ;;
		zypper:sdl2) echo libSDL2-2_0-0 ;;
		zypper:glew) echo libGLEW2_2 ;;
		pacman:java) echo jre-openjdk-headless ;;
		pacman:sdl2) echo sdl2 ;;
		pacman:glew) echo glew ;;
		*) echo "$1" ;;
	esac
}
pedir_pacote() {
	local nome existente
	nome="$(nome_do_pacote "$1")"
	for existente in "${PACOTES_SISTEMA[@]}"; do
		[ "$existente" = "$nome" ] && return
	done
	PACOTES_SISTEMA+=("$nome")
}
comando_de_instalacao() {
	case "$GERENCIADOR" in
		apt-get) echo "sudo apt install $*" ;;
		dnf) echo "sudo dnf install $*" ;;
		zypper) echo "sudo zypper install $*" ;;
		pacman) echo "sudo pacman -S $*" ;;
		*) echo "(instale pelo gerenciador de pacotes da sua distribuição) $*" ;;
	esac
}

# ---------------------------------------------------------------------------------------------------
# Download e descompactação sem depender de um programa só: curl, wget ou o Python do sistema; unzip,
# Python ou bsdtar. O arquivo vai para uma pasta temporária, é conferido e só então entra no lugar.
baixar_arquivo() {
	# baixar_arquivo <url> <destino>
	local url="$1" saida="$2" tentativa
	for tentativa in 1 2 3; do
		if command -v curl >/dev/null 2>&1; then
			if [ -t 2 ]; then
				curl -fL --connect-timeout 20 --progress-bar -o "$saida" "$url" && return 0
			else
				curl -fsSL --connect-timeout 20 -o "$saida" "$url" && return 0
			fi
		elif command -v wget >/dev/null 2>&1; then
			if [ -t 2 ]; then
				wget -q --show-progress --timeout=20 -O "$saida" "$url" && return 0
			else
				wget -q --timeout=20 -O "$saida" "$url" && return 0
			fi
		elif command -v python3 >/dev/null 2>&1; then
			# Com nome de programa próprio: o servidor recusa (403) o "Python-urllib" padrão.
			python3 -I - "$url" "$saida" <<'PY' && return 0
import shutil, sys, urllib.request
pedido = urllib.request.Request(sys.argv[1], headers={"User-Agent": "retro-studio-instalar/1.0"})
try:
    with urllib.request.urlopen(pedido, timeout=60) as resposta, open(sys.argv[2], "wb") as arquivo:
        shutil.copyfileobj(resposta, arquivo, 1 << 20)
except Exception as erro:
    print(f"  {erro}", file=sys.stderr)
    sys.exit(1)
PY
		else
			echo "  Não há curl, wget nem python3 para baixar." >&2
			pedir_pacote curl
			return 1
		fi
		echo "  Falhou (tentativa $tentativa de 3)." >&2
		[ "$tentativa" -lt 3 ] && sleep $((tentativa * 3))
	done
	return 1
}
descompactar() {
	# descompactar <arquivo.zip> <pasta>
	local zip="$1" pasta="$2"
	mkdir -p "$pasta"
	if command -v unzip >/dev/null 2>&1; then
		unzip -tq "$zip" >/dev/null && unzip -q -o "$zip" -d "$pasta"
	elif command -v python3 >/dev/null 2>&1; then
		python3 -I - "$zip" "$pasta" <<'PY'
import os, stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    if z.testzip() is not None:
        sys.exit(1)
    for info in z.infolist():
        caminho = z.extract(info, sys.argv[2])
        modo = info.external_attr >> 16
        if modo and not stat.S_ISLNK(modo):
            os.chmod(caminho, stat.S_IMODE(modo))
PY
	elif command -v bsdtar >/dev/null 2>&1; then
		bsdtar -xf "$zip" -C "$pasta"
	else
		echo "  Não há unzip nem python3 para descompactar." >&2
		pedir_pacote unzip
		return 1
	fi
}
baixar_do_servidor() {
	# baixar_do_servidor <pacote.zip> <pasta temporária> <arquivo que precisa existir, relativo à pasta>
	local pacote="$1" pasta="$2" esperado="$3"
	echo "  Baixando $pacote de $PACOTES…"
	if ! baixar_arquivo "$PACOTES/$pacote" "$pasta/$pacote"; then
		problema "Não foi possível baixar $pacote (sem internet, ou o servidor está fora do ar). Tente de novo com ./instalar.sh --reparar ou com o botão Reparar do editor."
		return 1
	fi
	if ! descompactar "$pasta/$pacote" "$pasta/conteudo" || [ ! -e "$pasta/conteudo/$esperado" ]; then
		problema "O arquivo $pacote veio incompleto ou corrompido. Tente de novo com ./instalar.sh --reparar."
		return 1
	fi
	rm -f -- "$pasta/$pacote"
}
guardar_de_lado() {
	# Nunca apaga o que o usuário tinha: renomeia para <pasta>.antigo-<data>.
	if [ -e "$1" ] || [ -L "$1" ]; then
		local antigo
		antigo="$1.antigo-$(data)"
		mv "$1" "$antigo"
		aviso "A versão anterior ficou guardada em $antigo (pode apagar se tudo funcionar)."
	fi
}
espaco_livre_mb() {
	local pasta="$1"
	while [ ! -d "$pasta" ]; do pasta="$(dirname "$pasta")"; done
	df -Pm "$pasta" | awk 'NR == 2 { print $4 }'
}

# ---------------------------------------------------------------------------------------------------
# Conferências de cada parte.
kit_funciona() {
	[ -f "$KIT/m68k-elf/makefile.gen" ] && [ -f "$KIT/m68k-elf/bin/rescomp.jar" ] &&
		"$KIT/m68k-elf/bin/m68k-elf-gcc" --version >/dev/null 2>&1
}
bibliotecas_faltando() {
	# Lista as bibliotecas que o executável não acha (vazio se nenhuma).
	command -v ldd >/dev/null 2>&1 || return 0
	ldd "$1" 2>/dev/null | awk '/not found/ { print $1 }'
}
# Pasta do editor que está em uso: a instalada (DESTINO) ou, para --reparar/--verificar rodados da
# pasta do pacote sem instalar, a do próprio pacote (lá o executável fica em bin/).
APP="$DESTINO"
EXECUTAVEL="$DESTINO/retro-studio"
if [ "$MODO" != instalar ] && [ -x "$AQUI/bin/retro-studio" ] && [ ! "$AQUI" -ef "$DESTINO" ]; then
	APP="$AQUI"
	EXECUTAVEL="$AQUI/bin/retro-studio"
fi
# O editor procura o Java e o make primeiro na pasta kit dele (APP/kit) e depois no sistema.
java_do_retro_studio() { [ -x "$APP/kit/jre/bin/java" ] && "$APP/kit/jre/bin/java" -version >/dev/null 2>&1; }
make_do_retro_studio() { [ -x "$APP/kit/bin/make" ] && "$APP/kit/bin/make" --version >/dev/null 2>&1; }
ligar_java_no_kit() {
	# O Makefile dos projetos põe a pasta bin do kit na frente do PATH: com o java ali, o make também
	# funciona num terminal, fora do editor. Um java de verdade que já esteja lá não é trocado.
	local alvo="$KIT/m68k-elf/bin/java"
	[ "$APP" = "$DESTINO" ] && java_do_retro_studio && [ -d "$KIT/m68k-elf/bin" ] || return 0
	if [ -L "$alvo" ] || [ ! -e "$alvo" ]; then
		ln -sfn "$DESTINO/kit/jre/bin/java" "$alvo"
	fi
}

# ---------------------------------------------------------------------------------------------------
if [ "$MODO" = desinstalar ]; then
	echo "Removendo o editor de $DESTINO…"
	rm -rf -- "$DESTINO/retro-studio" "$DESTINO/kit" "$DESTINO/docs" "$DESTINO/licencas" "$DESTINO/retro-studio.png" \
		"$DESTINO/teste_kit"
	[ -L "$HOME/.local/bin/retro-studio" ] && rm -f -- "$HOME/.local/bin/retro-studio"
	rm -f -- "$HOME/.local/share/applications/retro-studio.desktop"
	[ -L "$KIT/m68k-elf/bin/java" ] && rm -f -- "$KIT/m68k-elf/bin/java"
	echo "Pronto. Ficaram: o jogo de exemplo ($DESTINO/jogo_padrao), este instalador, o kit"
	echo "(~/.retrostudio/toolkit), o emulador (~/.retrostudio/emulators) e as configurações (~/.config/retro-studio)."
	exit 0
fi

echo "== Sistema =="
if [ "$(uname -m)" != "x86_64" ]; then
	problema "Este pacote é para PC x86_64 (64 bits, Intel ou AMD); esta máquina é $(uname -m)."
	echo
	echo "O Retro Studio não pode ser instalado aqui."
	exit 1
fi
glibc="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{ print $2 }')"
if [ -n "$glibc" ] && [ "$(printf '%s\n2.35\n' "$glibc" | sort -V | head -n1)" != "2.35" ]; then
	problema "O editor precisa da glibc 2.35 ou mais nova (Ubuntu 22.04, Debian 12, Fedora 36 ou mais novos); esta máquina tem a $glibc."
	echo
	echo "Atualize o sistema para instalar o Retro Studio."
	exit 1
fi
ok "Linux x86_64, glibc ${glibc:-?}${GERENCIADOR:+, pacotes pelo $GERENCIADOR}."
if [ "$MODO" != verificar ]; then
	livre="$(espaco_livre_mb "$HOME/.retrostudio")"
	if [ -n "$livre" ] && [ "$livre" -lt 1200 ]; then
		aviso "Só $livre MB livres; o kit e o emulador ocupam uns 300 MB, e o download precisa de mais uns 200 MB."
	fi
fi

# ---------------------------------------------------------------------------------------------------
echo "== Editor =="
if [ "$MODO" = instalar ]; then
	if [ ! -x "$AQUI/bin/retro-studio" ]; then
		echo "Rode o instalar.sh da pasta do pacote descompactado (falta $AQUI/bin/retro-studio)." >&2
		echo "Para conferir ou consertar uma instalação, use: $DESTINO/instalar.sh --reparar" >&2
		exit 1
	fi
	mkdir -p "$DESTINO" "$HOME/.local/bin" "$HOME/.local/share/applications"
	# Copia com outro nome e troca: um editor aberto continua rodando a versão antiga sem quebrar.
	cp "$AQUI/bin/retro-studio" "$DESTINO/retro-studio.novo" && chmod +x "$DESTINO/retro-studio.novo" &&
		mv -f "$DESTINO/retro-studio.novo" "$DESTINO/retro-studio"
	cp "$AQUI/retro-studio.png" "$DESTINO/retro-studio.png"
	rm -rf -- "$DESTINO/docs" "$DESTINO/licencas" "$DESTINO/teste_kit" "$DESTINO/modelos"
	cp -r "$AQUI/docs" "$AQUI/licencas" "$AQUI/teste_kit" "$DESTINO/"
	# Modelos do "Novo projeto" (pacotes a partir da 1.0.3).
	[ -d "$AQUI/modelos" ] && cp -r "$AQUI/modelos" "$DESTINO/"
	# O próprio instalador fica junto do editor, para o botão Reparar e para desinstalar.
	[ "$AQUI/instalar.sh" -ef "$DESTINO/instalar.sh" ] || cp "$AQUI/instalar.sh" "$DESTINO/instalar.sh"
	chmod +x "$DESTINO/instalar.sh"
	# Java e make do pacote: substituem os da instalação anterior.
	if [ -d "$AQUI/kit/jre" ] || [ -d "$AQUI/kit/bin" ]; then
		rm -rf -- "$DESTINO/kit"
		mkdir -p "$DESTINO/kit"
		[ -d "$AQUI/kit/jre" ] && cp -a "$AQUI/kit/jre" "$DESTINO/kit/"
		[ -d "$AQUI/kit/bin" ] && cp -a "$AQUI/kit/bin" "$DESTINO/kit/"
	fi
	# O jogo de exemplo é uma cópia para estudar; uma cópia já instalada (talvez editada) não é trocada.
	if [ -e "$DESTINO/jogo_padrao" ]; then
		ok "Jogo de exemplo mantido em $DESTINO/jogo_padrao."
	else
		cp -r "$AQUI/jogo_padrao" "$DESTINO/jogo_padrao"
	fi
	ln -sfn "$DESTINO/retro-studio" "$HOME/.local/bin/retro-studio"
	cat >"$HOME/.local/share/applications/retro-studio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Retro Studio
Comment=Jogos de Mega Drive em cenas
Exec="$DESTINO/retro-studio" --project-manager
Icon=$DESTINO/retro-studio.png
StartupWMClass=retro-studio
Categories=Development;Game;
Terminal=false
EOF
	command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$HOME/.local/share/applications" 2>/dev/null
fi
if [ -x "$EXECUTAVEL" ]; then
	faltando="$(bibliotecas_faltando "$EXECUTAVEL")"
	if [ -n "$faltando" ]; then
		problema "O editor não acha estas bibliotecas do sistema: $(echo $faltando)."
	elif [ "$APP" = "$DESTINO" ]; then
		ok "Editor em $DESTINO (comando retro-studio e atalho no menu)."
	else
		ok "Editor do pacote em $AQUI (não instalado; para instalar, rode ./instalar.sh sem opções)."
	fi
	case ":$PATH:" in
		*":$HOME/.local/bin:"*) ;;
		*) aviso "A pasta ~/.local/bin não está no PATH deste terminal: abra pelo menu de aplicativos, ou saia e entre de novo na sessão para o comando retro-studio funcionar." ;;
	esac
else
	problema "O editor não está instalado em $DESTINO: rode o ./instalar.sh da pasta do pacote."
fi

# ---------------------------------------------------------------------------------------------------
echo "== Java e make =="
# O rescomp do SGDK é um programa Java; o pacote traz um Java só com o necessário.
if java_do_retro_studio; then
	ok "Java do Retro Studio ($("$APP/kit/jre/bin/java" -version 2>&1 | head -n1))."
elif command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1; then
	ok "Java do sistema ($(java -version 2>&1 | head -n1))."
else
	problema "Falta o Java (o SGDK usa para converter imagens e sons)."
	pedir_pacote java
fi
if make_do_retro_studio; then
	ok "make do Retro Studio."
elif command -v make >/dev/null 2>&1; then
	ok "make do sistema."
else
	problema "Falta o make (roda a compilação do SGDK)."
	pedir_pacote make
fi

# ---------------------------------------------------------------------------------------------------
echo "== Kit SGDK/MarsDev =="
if kit_funciona; then
	ok "Kit em $KIT."
elif [ "$MODO" = verificar ]; then
	problema "O kit em $KIT está faltando ou incompleto."
else
	[ -e "$KIT/m68k-elf" ] && aviso "O kit em $KIT/m68k-elf está incompleto ou não roda; vou instalar de novo."
	temporario="$(mktemp -d)"
	if [ -d "$AQUI/kit/marsdev/mars/m68k-elf" ]; then
		mkdir -p "$temporario/conteudo" && cp -a "$AQUI/kit/marsdev/mars/m68k-elf" "$temporario/conteudo/"
	else
		baixar_do_servidor marsdev-linux-x64.zip "$temporario" "m68k-elf/makefile.gen"
	fi
	if [ -d "$temporario/conteudo/m68k-elf" ]; then
		guardar_de_lado "$KIT/m68k-elf"
		mkdir -p "$KIT"
		mv "$temporario/conteudo/m68k-elf" "$KIT/m68k-elf"
		[ -e "$KIT/marsdev" ] || [ ! -d "$temporario/conteudo/marsdev" ] || mv "$temporario/conteudo/marsdev" "$KIT/marsdev"
		if kit_funciona; then
			ok "Kit instalado em $KIT."
		else
			problema "O kit em $KIT não roda nesta máquina (m68k-elf-gcc --version falhou)."
		fi
	fi
	rm -rf -- "$temporario"
fi
[ "$MODO" != verificar ] && ligar_java_no_kit

# ---------------------------------------------------------------------------------------------------
echo "== Emulador BlastEm =="
if [ ! -x "$EMULADOR/blastem" ] && [ "$MODO" != verificar ]; then
	temporario="$(mktemp -d)"
	if [ -x "$AQUI/kit/blastem/blastem" ]; then
		mkdir -p "$temporario/conteudo" && cp -a "$AQUI/kit/blastem/." "$temporario/conteudo/"
	else
		baixar_do_servidor blastem-linux-x64.zip "$temporario" "blastem"
	fi
	if [ -x "$temporario/conteudo/blastem" ]; then
		guardar_de_lado "$EMULADOR"
		mkdir -p "$(dirname "$EMULADOR")"
		mv "$temporario/conteudo" "$EMULADOR"
	fi
	rm -rf -- "$temporario"
fi
if [ -x "$EMULADOR/blastem" ]; then
	faltando="$(bibliotecas_faltando "$EMULADOR/blastem")"
	if [ -z "$faltando" ]; then
		ok "BlastEm em $EMULADOR."
	elif [ -x "$EMULADOR/old/blastem" ] && [ -z "$(bibliotecas_faltando "$EMULADOR/old/blastem")" ]; then
		# A versão principal usa a SDL2 e a GLEW do sistema; a oficial em old/ traz as dela.
		ok "BlastEm em $EMULADOR (o editor usa a versão em old/, que traz as próprias bibliotecas; a principal precisaria de: $(echo $faltando))."
	else
		problema "O BlastEm não acha estas bibliotecas do sistema: $(echo $faltando)."
		grep -q libSDL2 <<<"$faltando" && pedir_pacote sdl2
		grep -q libGLEW <<<"$faltando" && pedir_pacote glew
	fi
else
	problema "O emulador não está em $EMULADOR."
fi

# ---------------------------------------------------------------------------------------------------
# Pacotes do sistema que ainda faltam: com permissão, instala (no terminal, pelo sudo; chamado pelo
# editor, pela janela de senha do sistema, o pkexec). Depois confere tudo de novo, uma vez só.
if [ ${#PACOTES_SISTEMA[@]} -gt 0 ] && [ "$MODO" != verificar ] && [ -n "$GERENCIADOR" ] && [ -z "${RETRO_STUDIO_SEM_PERGUNTAS:-}" ]; then
	echo
	echo "== Pacotes do sistema =="
	echo "Faltam: ${PACOTES_SISTEMA[*]}"
	elevar=""
	if [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
		read -r -p "Instalar agora com sudo (pede a sua senha)? [S/n] " resposta
		case "${resposta:-s}" in [sSyY]*) elevar=sudo ;; esac
	elif [ ! -t 0 ] && command -v pkexec >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
		echo "Pedindo a senha do sistema para instalar…"
		elevar=pkexec
	fi
	if [ -n "$elevar" ]; then
		case "$GERENCIADOR" in
			apt-get) "$elevar" env DEBIAN_FRONTEND=noninteractive apt-get install -y "${PACOTES_SISTEMA[@]}" ;;
			dnf) "$elevar" dnf install -y "${PACOTES_SISTEMA[@]}" ;;
			zypper) "$elevar" zypper --non-interactive install "${PACOTES_SISTEMA[@]}" ;;
			pacman) "$elevar" pacman -S --needed --noconfirm "${PACOTES_SISTEMA[@]}" ;;
		esac
		if [ $? -eq 0 ]; then
			echo "Pacotes instalados. Conferindo de novo…"
			echo
			RETRO_STUDIO_SEM_PERGUNTAS=1 exec "$AQUI/instalar.sh" --reparar
		fi
		echo "A instalação dos pacotes não terminou."
	fi
fi

# ---------------------------------------------------------------------------------------------------
# Conferência final: compila um projeto mínimo com o kit, o Java e o make que o editor vai usar.
if [ ${#PROBLEMAS[@]} -eq 0 ] && [ "$MODO" != verificar ] && [ -d "$APP/teste_kit" ]; then
	echo "== Conferência: compilando um projeto de teste =="
	teste="$(mktemp -d)"
	cp -r "$APP/teste_kit/." "$teste/"
	caminho="$KIT/m68k-elf/bin"
	java_do_retro_studio && caminho="$caminho:$APP/kit/jre/bin"
	programa_make=make
	make_do_retro_studio && programa_make="$APP/kit/bin/make"
	if PATH="$caminho:$PATH" GDK="$KIT/m68k-elf" "$programa_make" -C "$teste" >"$teste.log" 2>&1 && [ -s "$teste/out/rom.bin" ]; then
		ok "O kit compilou uma ROM de teste."
		rm -rf -- "$teste" "$teste.log"
	else
		problema "A compilação de teste falhou; o log está em $teste.log (últimas linhas abaixo)."
		tail -n 8 "$teste.log" | sed 's/^/      /'
		rm -rf -- "$teste"
	fi
fi

# ---------------------------------------------------------------------------------------------------
echo
if [ ${#PROBLEMAS[@]} -eq 0 ]; then
	echo "Tudo pronto."
	if [ "$MODO" = instalar ]; then
		echo "Abra pelo menu de aplicativos (Retro Studio) ou com: retro-studio --project-manager"
		echo "O jogo de exemplo está em $DESTINO/jogo_padrao (botão Importar do gerenciador de projetos)."
	fi
	exit 0
fi
echo "Ficou faltando:"
for item in "${PROBLEMAS[@]}"; do echo "  - $item"; done
if [ ${#PACOTES_SISTEMA[@]} -gt 0 ]; then
	echo
	echo "Para resolver, rode num terminal:"
	echo "    $(comando_de_instalacao "${PACOTES_SISTEMA[@]}")"
	echo "e depois: $DESTINO/instalar.sh --reparar (ou o botão Reparar do editor)."
fi
exit 1
