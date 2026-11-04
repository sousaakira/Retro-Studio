#pragma once

#include "retro_song.h"
#include "retro_vgm.h"

#include "core/string/ustring.h"
#include "core/variant/array.h"

// VGM → música do compositor, para editar (não só ouvir). Lê as escritas de registrador do YM2612 e do
// SN76489 e reconstrói as notas: key on/off e F-number no FM, volume e período no PSG. Cada timbre do
// FM (os registradores do canal na hora da nota, sem o volume dos operadores de saída) vira um
// instrumento da música e as diferenças de volume viram a velocity. Uma faixa por canal e timbre.
// O tempo sai da grade das notas (muitos drivers andam em linhas de N quadros); sem grade clara, 120 BPM.
// Fora: o DAC (bateria em PCM no FM 6), o modo especial do canal 3, vibrato e glissando finos (a nota
// fica com a altura do começo; mudanças de mais de meio tom viram notas novas) e o volume ao longo da
// nota no PSG.
namespace RetroVgmImport {

struct Result {
	RetroSong song;
	PackedStringArray warnings;
	int notes = 0;
	double frames_per_row = 0; // Linha estimada (quadros de 60 Hz, pode ser fracionária); 0 = sem grade clara.
};

bool import(const RetroVgmFile &p_vgm, const String &p_id, const String &p_name, Result &r_result, String &r_error);

} // namespace RetroVgmImport
