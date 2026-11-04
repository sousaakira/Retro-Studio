#pragma once

#include "retro_chip_driver.h"

#include "core/string/ustring.h"
#include "core/templates/vector.h"
#include "core/variant/array.h"
#include "core/variant/dictionary.h"

// #89: música do compositor (porte de shared/retro/song.js): music/<id>.song.json. Faixas = instrumento +
// notas; o driver distribui as notas pelos canais do chip ao tocar e ao exportar. Tempo em ticks (48 por
// semínima); o som anda em quadros de 60 Hz, como os drivers do Mega Drive e o XGM. instruments:
// instrumentos próprios da música (importados ou copiados do banco e editados); as faixas citam pelo ID.
static constexpr int SONG_PPQ = 48;
static constexpr int SONG_FPS = 60;
static constexpr int SONG_MAX_INSTRUMENTS = 64;
static constexpr int SONG_MAX_TRACKS = 32;
static constexpr int SONG_MAX_NOTES = 20000;
static constexpr int SONG_MAX_BARS = 512;
static constexpr int SONG_TEMPO_MIN = 30;
static constexpr int SONG_TEMPO_MAX = 300;

struct RetroSongGrid {
	int ticks;
	const char *label;
};
// Grades em ticks: 1/4, 1/8, 1/16, 1/32 e as tercinas de 1/8 e 1/16.
extern const RetroSongGrid SONG_GRIDS[6];

String retro_note_name(int p_note);

struct RetroSongNote {
	int t = 0, d = 1, n = 60, v = 100;
};

struct RetroSongTrack {
	String id;
	String name;
	String instrument;
	bool mute = false;
	bool solo = false;
	Vector<RetroSongNote> notes;
};

struct RetroSong {
	String id = "musica_1";
	String name = String::utf8("Nova música");
	int tempo = 120;
	int beats_per_bar = 4;
	int bars = 16;
	bool has_loop = true;
	int loop_start = 0;
	int loop_end = 16 * 4 * SONG_PPQ;
	int fm_channels = 6;
	bool has_instruments = true; // A chave "instruments" existe no arquivo.
	Vector<RetroInstrument> instruments;
	Vector<RetroSongTrack> tracks;

	int length() const { return bars * beats_per_bar * SONG_PPQ; }
	// Tick → quadro de 60 Hz (arredondado: o XGM toca em quadros).
	int tick_frame(double p_tick) const;
	double tick_seconds(double p_tick) const { return p_tick * 60.0 / (tempo * SONG_PPQ); }
	double seconds_tick(double p_seconds) const { return p_seconds * tempo * SONG_PPQ / 60.0; }
	const RetroInstrument *resolve_instrument(const String &p_id) const;

	Dictionary to_dictionary() const;
	String to_json(bool p_pretty = false) const; // Bonito = JSON.stringify(song, null, 1).
	// Sem notas fora da música (depois de encurtar), notas em ordem.
	void normalize();

	static RetroSong create(const String &p_id, const String &p_name, const String &p_instrument);
	// Validado como validateSong; r_error vazio = ok.
	static RetroSong from_dictionary(const Variant &p_data, String &r_error);
	static RetroSong from_json(const String &p_text, String &r_error);
};

// Ajusta à grade (ticks): início arredonda, duração no mínimo uma divisão.
int retro_snap_tick(double p_tick, int p_grid);
int retro_snap_length(double p_length, int p_grid);

// #89: música → escritas de registrador por quadro (porte de songTimeline.js). A mesma linha do tempo
// toca no editor e vira o VGM: o que se ouve é o que vai para a ROM.
struct RetroSongTimeline {
	struct Frame {
		int frame = 0;
		Vector<RetroChipWrite> writes;
	};
	Vector<Frame> frames;
	int end = 0;
	int loop_frame = -1; // -1 = sem loop.
	Vector<String> missing;

	// p_to < 0 = a música toda. p_audition respeita mudo/solo (só no editor). p_use_loop: no início do
	// loop o chip é zerado e no fim todas as notas param, para o VGM voltar ao loop sempre no mesmo estado.
	static RetroSongTimeline build(const RetroSong &p_song, int p_from = 0, int p_to = -1, bool p_audition = false, bool p_use_loop = true);
};

// #89: linha do tempo → VGM 1.50 (YM2612 + SN76489), o formato que o rescomp do SGDK converte para XGM
// (porte de shared/retro/vgm.js). Um quadro = 735 amostras (44100/60). Com loop, o offset aponta para o
// quadro de início do loop e o tocador volta para lá no fim.
Vector<uint8_t> retro_write_vgm(const RetroSongTimeline &p_timeline, const String &p_title, const String &p_author = String());

struct RetroSongExport {
	bool exported = false;
	String vgm_path;
	int bytes = 0;
	double seconds = 0;
	bool loop = false;
};

// Arquivos das músicas no projeto (porte de electron/retro/musicProject.js, sem a exportação).
namespace RetroSongFiles {
String source_path(const String &p_root, const String &p_id);
String vgm_path(const String &p_id); // Relativo ao projeto.
bool valid_id(const String &p_id);
String file_hash(const String &p_path); // "" = não existe.
// [{id, name, exported} | {id, name, error}]
Array list(const String &p_root);
Error load(const String &p_root, const String &p_id, RetroSong &r_song, String &r_revision, String &r_error);
// p_revision: hash da fonte quando foi aberta ("" = música nova). Grava a música normalizada.
// p_export: também grava som/<id>.vgm (nunca sobrescreve VGM que não foi gerado pelo compositor)
// na pasta som/ do projeto.
Error save(const String &p_root, const RetroSong &p_song, const String &p_revision, String &r_new_revision, String &r_error, bool p_export = false, RetroSongExport *r_export = nullptr);
Error write_atomic(const String &p_path, const Vector<uint8_t> &p_bytes);
} // namespace RetroSongFiles
