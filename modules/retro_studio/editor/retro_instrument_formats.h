#pragma once

#include "retro_chip_driver.h"

#include "core/string/ustring.h"
#include "core/variant/array.h"
#include "core/variant/dictionary.h"

// #89: importar e exportar instrumentos do YM2612 nos formatos dos trackers (porte de
// shared/retro/instrumentFormats.js; referência: carregadores do Furnace, src/engine/fileOpsIns.cpp).
// Todos guardam os operadores na ordem dos registradores (S1, S3, S2, S4); o modelo usa S1..S4.
// Detune: TFI, DMP e FUI usam a escala do Furnace (3 = sem detune); OPNI/WOPN guardam o registrador.
namespace RetroInstrumentFormats {
extern const char *IMPORT_FORMATS[5]; // .tfi .dmp .fui .opni .wopn
struct ExportFormat {
	const char *id;
	const char *label;
};
extern const ExportFormat EXPORT_FORMATS[4];

// Instrumentos sem ID (o editor dá IDs livres na música) e avisos. r_error vazio = ok.
Array import_file(const String &p_file_name, const Vector<uint8_t> &p_bytes, PackedStringArray &r_warnings, String &r_error);
// Só FM. p_format: tfi, dmp, fui, opni.
Vector<uint8_t> export_instrument(const RetroInstrument &p_instrument, const String &p_format, String &r_error);
// ID livre para um instrumento da música, a partir do nome.
String instrument_id_for(const String &p_name, const PackedStringArray &p_taken);
// Instrumento importado/copiado → instrumento da música (ID livre, validado).
RetroInstrument song_instrument(const Dictionary &p_source, const PackedStringArray &p_taken, String &r_error, const String &p_category = String::utf8("Da música"));
} // namespace RetroInstrumentFormats
