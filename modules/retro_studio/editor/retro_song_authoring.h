#pragma once

#include "retro_song.h"

// #89: música para IA (porte de shared/retro/songAuthoring.js). Formato de autoria em tempos (beats) e
// nomes de nota ("C#4"), convertido para o formato do compositor (ticks, 48 por semínima), e uma análise
// do que o Mega Drive vai conseguir tocar: polifonia por chip, notas graves demais para o PSG,
// instrumentos faltando.
namespace RetroSongAuthoring {
// "C4" = 60 (C4 é o dó central), "F#3", "Bb2"; número MIDI também vale. -1 + r_error se inválida.
int parse_note(const Variant &p_value, String &r_error);
// Autoria → música validada. Notas em tempos {at, len, note, vel} ou já em ticks {t, d, n, v}.
RetroSong from_authoring(const Variant &p_input, String &r_error);
// Música → autoria em tempos (o que a IA lê para editar).
Dictionary to_authoring(const RetroSong &p_song);
// Picos de vozes por chip, avisos e números da música.
Dictionary analyze(const RetroSong &p_song);
// Guia de composição (formato, limites do chip, dicas, exemplo e a lista de instrumentos).
Dictionary guide();
} // namespace RetroSongAuthoring
