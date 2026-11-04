#pragma once

#include "retro_chip_emu.h"

#include "core/string/ustring.h"
#include "core/templates/vector.h"
#include "core/variant/array.h"
#include "core/variant/dictionary.h"
#include "core/variant/variant.h"

// #89: instrumentos do compositor (porte de shared/retro/chipInstruments.js). FM = patch de 4
// operadores do YM2612 (S1..S4, valores dos registradores); PSG = onda quadrada ou ruído com envelope
// por quadro (60 Hz). Os mesmos números viram escritas de registrador no editor e no VGM.
struct RetroInstrument {
	struct Op {
		int ar = 0, d1r = 0, d2r = 0, rr = 0, sl = 0, tl = 0, ks = 0, mul = 0, dt = 0, am = 0, ssg = 0;
	};
	struct Envelope {
		int volume = 0, attack = 0, decay = 0, sustain = 0, release = 0;
	};
	String id;
	String name;
	String category;
	String kind; // fm, psg, noise
	int alg = 0, fb = 0, ams = 0, pms = 0;
	Op ops[4];
	bool has_sweep = false;
	int sweep_semitones = 0, sweep_frames = 0;
	Envelope envelope;
	String mode; // noise: white, periodic
	int rate = 0;
	// Campos que o validador do JS deixa passar (ex.: "source", a origem de um instrumento importado).
	Dictionary extra;

	Dictionary to_dictionary() const;
	// Instrumento do JSON (validado como validateInstrument); r_error vazio = ok.
	static RetroInstrument from_dictionary(const Dictionary &p_data, String &r_error);
};

struct RetroChipWrite {
	uint8_t chip = 0; // 0 = FM [porta, endereço, dado]; 1 = PSG [byte].
	uint8_t port = 0;
	uint8_t address = 0;
	uint8_t data = 0;
};

namespace RetroChipInstruments {
extern const char *CATEGORIES[7];
const Vector<RetroInstrument> &presets();
void fm_patch_writes(int p_channel, const RetroInstrument &p_instrument, Vector<RetroChipWrite> &r_writes);
void fm_level_writes(int p_channel, const RetroInstrument &p_instrument, int p_extra, Vector<RetroChipWrite> &r_writes);
int velocity_attenuation(int p_velocity);
bool is_carrier(int p_alg, int p_operator); // O operador soa (é saída) no algoritmo.
void fm_pitch(double p_note, int &r_block, int &r_fnum, int p_clock = YM2612_CLOCK_NTSC);
int psg_period(double p_note, int p_clock = PSG_CLOCK_NTSC);
} // namespace RetroChipInstruments

// #89: driver de notas → registradores (porte de shared/retro/chipDriver.js): distribui vozes (6 FM,
// 3 tons, 1 ruído), carrega patches, aplica velocity, pitch bend, vibrato e os envelopes do PSG a cada
// quadro (60 Hz). As escritas acumulam até take().
class RetroChipDriver {
	struct Voice {
		int channel = 0;
		String loaded; // Patch carregado (FM).
		int note = -1; // -1 = nenhuma.
		String owner;
		bool has_instrument = false;
		RetroInstrument instrument;
		bool held = false;
		int since = 0;
		double sweep = 0;
		int sweep_left = 0;
		// Envelope do PSG.
		bool env = false;
		String stage;
		int frame = 0;
		double level = 15;
		double from = 15;
		int extra = 0;
	};
	Vector<RetroChipWrite> writes;
	int clock_counter = 0;
	double bend = 0;
	double vibrato = 0;
	int fm_clock = YM2612_CLOCK_NTSC;
	int psg_clock = PSG_CLOCK_NTSC;
	Vector<Voice> fm;
	Voice tones[3];
	Voice noise;

	void _fm(int p_port, int p_address, int p_data);
	void _psg(int p_byte);
	static int _key_code(int p_channel) { return (p_channel % 3) | (p_channel >= 3 ? 4 : 0); }
	void _set_fm_pitch(Voice &r_voice);
	int _pick(const Vector<int> &p_candidates, const Voice *p_voices, const String &p_instrument) const;
	int _vibrato_depth() const;
	void _fm_note_on(const RetroInstrument &p_instrument, int p_note, int p_velocity, const String &p_owner);
	void _start_envelope(Voice &r_voice, const RetroInstrument &p_instrument, int p_velocity);
	void _psg_note_on(const RetroInstrument &p_instrument, int p_note, int p_velocity, const String &p_owner);
	void _set_tone(int p_channel, int p_note);
	void _apply_envelope(Voice &r_voice, int p_channel);
	void _step_envelope(Voice &r_voice);
	void _release(Voice &r_voice);

public:
	void note_on(const RetroInstrument &p_instrument, int p_note, int p_velocity = 100, const String &p_owner = String());
	void note_off(int p_note, const String &p_owner = String());
	void pitch_bend(double p_semitones);
	void modulation(double p_amount);
	void tick();
	void all_notes_off();
	void invalidate(const String &p_id = String());
	Vector<RetroChipWrite> take();
	bool tone_held(int p_channel) const { return tones[CLAMP(p_channel, 0, 2)].held; }
	bool noise_held() const { return noise.held; }

	// p_fm_channels 5 deixa o FM 6 livre (o XGM usa o DAC dele para os efeitos PCM).
	RetroChipDriver(int p_fm_channels = 6, int p_fm_clock = YM2612_CLOCK_NTSC, int p_psg_clock = PSG_CLOCK_NTSC);
};
