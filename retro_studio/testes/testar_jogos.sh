#!/usr/bin/env bash
# Testes dos geradores com o editor de verdade: cada projeto (o jogo padrão e os modelos) é copiado para
# uma pasta temporária, gerado e compilado pela linha de comando do editor (--retro-build) e precisa
# terminar com a ROM pronta. O jogo padrão também sai em build de depuração, e o save e a senha do
# jogo.c gerado passam por um teste em C no computador (gcc).
# Uso: retro_studio/testes/testar_jogos.sh <editor> <projeto>...
#   ex.: testar_jogos.sh ~/.local/share/retro-studio/retro-studio ~/.local/share/retro-studio/jogo_padrao ~/.local/share/retro-studio/modelos/*/
set -uo pipefail

EDITOR="$1"
shift
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP="$(mktemp -d)"
falhas=0

compilar() { # pasta, nome, argumentos extras
	local pasta="$1" nome="$2"
	shift 2
	if "$EDITOR" --headless --editor --path "$pasta" -- --retro-build "$@" >"$TEMP/$nome.log" 2>&1 && grep -q "RETRO-CLI: OK" "$TEMP/$nome.log" && test -s "$pasta/out/rom.bin"; then
		echo "ok: $nome ($(stat -c %s "$pasta/out/rom.bin") bytes)"
	else
		echo "FALHOU: $nome"
		grep -E "Erro|error|Aviso|RETRO-CLI" "$TEMP/$nome.log" | head -30
		tail -20 "$TEMP/$nome.log"
		falhas=$((falhas + 1))
	fi
}

for origem in "$@"; do
	origem="${origem%/}"
	nome="$(basename "$origem")"
	destino="$TEMP/$nome"
	cp -r "$origem" "$destino"
	rm -rf "$destino/out" "$destino/.retro-studio" "$destino/.godot" "$destino/src/gerado" "$destino/res/gerado"
	if [ ! -f "$destino/projeto.retro" ]; then
		# Modelo: o gerenciador de projetos cria o projeto.retro com a cena principal do modelo.cfg.
		principal="$(sed -n 's/^principal=//p' "$destino/modelo.cfg")"
		cat >"$destino/projeto.retro" <<FIM
config_version=5

[application]

config/name="$nome"
run/main_scene="$principal"
config/features=PackedStringArray("4.7")

[display]

window/size/viewport_width=320
window/size/viewport_height=224

[rendering]

textures/canvas_textures/default_texture_filter=0
FIM
	fi
	compilar "$destino" "$nome"
	if [ "$nome" = jogo_padrao ]; then
		compilar "$destino" "$nome-depuracao" --retro-depuracao
		# Conversões do node_set (MCP) e ida e volta das propriedades por uma cena salva.
		if "$EDITOR" --headless --editor --path "$destino" -- --retro-teste-mcp >"$TEMP/teste_mcp.log" 2>&1 && grep -q "RETRO-CLI: OK" "$TEMP/teste_mcp.log"; then
			echo "ok: conversões do MCP ($(grep -c '^ok:' "$TEMP/teste_mcp.log") casos)"
		else
			echo "FALHOU: conversões do MCP"
			grep -E '^(FALHOU|  )' "$TEMP/teste_mcp.log"
			falhas=$((falhas + 1))
		fi
		# Save e senha: as funções do jogo.c gerado, compiladas no computador com uma SRAM de mentira.
		if command -v gcc >/dev/null; then
			awk '/\/\/ ---- Progresso salvo/{p=1} /^\/\/ ---- Opções/{p=0} p' "$destino/src/gerado/jogo.c" >"$TEMP/save_part.c"
			if gcc -std=c99 -w -I"$TEMP" -o "$TEMP/teste_save" "$AQUI/teste_save.c" && "$TEMP/teste_save"; then
				echo "ok: save e senha"
			else
				echo "FALHOU: save e senha"
				falhas=$((falhas + 1))
			fi
		fi
		# Animação de cenário (MDAnimacaoCenario): as cenas de teste por cima do jogo padrão, a ROM normal e a de
		# diagnóstico, e o streaming e o runtime gerados rodando no computador (teste_anim_cenario.c).
		if command -v gcc >/dev/null && python3 -c 'import PIL' 2>/dev/null; then
			anim="$TEMP/anim_cenario"
			cp -r "$destino" "$anim"
			rm -rf "$anim/out" "$anim/.godot" "$anim/src/gerado" "$anim/res/gerado"
			python3 "$AQUI/anim_cenario/gerar_cenas.py" "$anim" >/dev/null
			compilar "$anim" "anim_cenario-sem-animacoes" --retro-sem-animacoes
			compilar "$anim" "anim_cenario"
			for cena in animacoes reuso; do
				if python3 "$AQUI/anim_cenario_dados.py" "$anim" "$cena" "$TEMP/anim_$cena" >/dev/null &&
					gcc -std=c99 -O1 -w -I"$TEMP/anim_$cena" -o "$TEMP/anim_$cena/teste" "$AQUI/teste_anim_cenario.c" &&
					"$TEMP/anim_$cena/teste" >"$TEMP/anim_$cena.log"; then
					echo "ok: animação de cenário ($cena): $(tail -2 "$TEMP/anim_$cena.log" | head -1)"
				else
					echo "FALHOU: animação de cenário ($cena)"
					tail -15 "$TEMP/anim_$cena.log"
					falhas=$((falhas + 1))
				fi
			done
			# Gatilhos (proximidade, contato, código): o runtime gerado contra um modelo, com corpos de mentira.
			if gcc -std=c99 -O1 -w -I"$TEMP/anim_animacoes" -o "$TEMP/anim_gatilho" "$AQUI/teste_anim_gatilho.c" && "$TEMP/anim_gatilho" >"$TEMP/anim_gatilho.log"; then
				echo "ok: gatilhos da animação de cenário ($(tail -2 "$TEMP/anim_gatilho.log" | head -1))"
			else
				echo "FALHOU: gatilhos da animação de cenário"
				tail -25 "$TEMP/anim_gatilho.log"
				falhas=$((falhas + 1))
			fi
		else
			echo "pulado: animação de cenário (precisa de gcc e do Pillow do Python)"
		fi
	fi
done

rm -rf "$TEMP"
if [ "$falhas" -gt 0 ]; then
	echo "$falhas teste(s) falharam."
	exit 1
fi
echo "Todos os testes passaram."
