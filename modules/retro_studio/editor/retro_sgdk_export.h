#pragma once

// Cena → SGDK: antes do make, a cena principal (uma MDCena) vira res/cenas_gerado.res e
// src/gerado/cenas.c (com o main do jogo). Os arquivos gerados começam com GENERATED_MARK; um
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
};

Result export_main_scene(const String &p_project_dir);

} // namespace RetroSgdkExport
