#pragma once

// Cenas → SGDK: antes do make, a cena principal (uma MDCena) e as cenas que ela alcança (saídas e
// START) viram res/cenas_gerado.res, um src/gerado/cena_<nome>.c por cena e src/gerado/jogo.c (o main,
// a troca de cenas, as vidas e o som). Os arquivos gerados começam com GENERATED_MARK; um
// arquivo com o mesmo nome sem essa marca é do programador e nunca é sobrescrito.

#include "core/string/ustring.h"
#include "core/variant/variant.h"

namespace RetroSgdkExport {

static const char *GENERATED_MARK = "// Gerado pelo Retro Studio";

struct Result {
	bool skipped = false; // O projeto não usa cenas (não há cena principal com MDCena).
	PackedStringArray errors;
	PackedStringArray warnings;
	PackedStringArray written;
	PackedStringArray info; // Uso de VRAM e de sprites por cena.
};

Result export_main_scene(const String &p_project_dir);

// PNG indexado de 4 bits (o formato que o rescomp converte sem requantizar): um índice de 0 a 15 por
// pixel e a paleta; a cor 0 é a transparência.
Vector<uint8_t> indexed_png(int p_width, int p_height, const Vector<uint8_t> &p_indices, const Vector<Color> &p_palette);

} // namespace RetroSgdkExport
