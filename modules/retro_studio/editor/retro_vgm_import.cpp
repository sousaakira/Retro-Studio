#include "retro_vgm_import.h"

#include "retro_instrument_formats.h"

#include "core/math/math_funcs.h"
#include "core/templates/hash_map.h"
#include "core/templates/hash_set.h"
#include "core/templates/sort_array.h"

namespace {

const int OPERATOR_OFFSET[4] = { 0, 8, 4, 12 }; // S1..S4 nos registradores.
const int FRAME = 735; // Amostras por quadro de 60 Hz.
const int NOISE = 9; // Canais: 0–5 FM, 6–8 tons do PSG, 9 ruído.
const char *CHANNEL_NAMES[10] = { "FM1", "FM2", "FM3", "FM4", "FM5", "FM6", "PSG1", "PSG2", "PSG3", "Ruído" };
// Mudança de altura que vira nota nova (vibrato e glissando finos ficam na mesma nota).
const double SPLIT_SEMITONES = 0.75;

String U(const char *p_text) {
	return String::utf8(p_text);
}

struct RawNote {
	int channel = 0;
	double start = 0; // Amostras.
	double end = -1;
	double pitch = 60;
	String key; // Timbre: canal + registradores (FM), canal (tons) ou modo do ruído.
	RetroInstrument patch;
	int level = 0; // FM: TL do 1º operador de saída; PSG: atenuação (0–15). Maior = mais baixo.
	bool split = false; // Começou por mudança de altura (vibrato, arpejo), não por key on.
};

double fm_note(int p_block, int p_fnum, double p_clock) {
	if (p_fnum <= 0) {
		return -1;
	}
	const double frequency = p_fnum * Math::pow(2.0, p_block) * (p_clock / 144.0) / Math::pow(2.0, 21.0);
	return 69 + 12 * Math::log(frequency / 440.0) / Math::log(2.0);
}

double psg_note(int p_period, double p_clock) {
	if (p_period <= 0) {
		return -1;
	}
	return 69 + 12 * Math::log(p_clock / (32.0 * p_period) / 440.0) / Math::log(2.0);
}

class Reader {
	uint8_t fm[2][256] = {};
	bool fm_key[6] = {};
	bool fm_retrigger[6] = {};
	bool dac = false;
	int psg_period[3] = {};
	int psg_att[4] = { 15, 15, 15, 15 };
	bool psg_retrigger[4] = {};
	int noise_control = 0;
	int latch_channel = 0;
	bool latch_volume = false;
	int active[10] = { -1, -1, -1, -1, -1, -1, -1, -1, -1, -1 };
	double fm_clock = YM2612_CLOCK_NTSC;
	double psg_clock = PSG_CLOCK_NTSC;

	RetroInstrument _fm_patch(int p_channel, String &r_key, int &r_level) const {
		const int port = p_channel >= 3 ? 1 : 0, slot = p_channel % 3;
		const uint8_t *r = fm[port];
		RetroInstrument patch;
		patch.kind = "fm";
		patch.alg = r[0xb0 + slot] & 7;
		patch.fb = (r[0xb0 + slot] >> 3) & 7;
		patch.ams = (r[0xb4 + slot] >> 4) & 3;
		patch.pms = r[0xb4 + slot] & 7;
		int first_carrier = -1;
		for (int i = 0; i < 4; i++) {
			const int base = OPERATOR_OFFSET[i] + slot;
			RetroInstrument::Op &op = patch.ops[i];
			op.dt = (r[0x30 + base] >> 4) & 7;
			op.mul = r[0x30 + base] & 15;
			op.tl = r[0x40 + base] & 127;
			op.ks = r[0x50 + base] >> 6;
			op.ar = r[0x50 + base] & 31;
			op.am = r[0x60 + base] >> 7;
			op.d1r = r[0x60 + base] & 31;
			op.d2r = r[0x70 + base] & 31;
			op.sl = r[0x80 + base] >> 4;
			op.rr = r[0x80 + base] & 15;
			op.ssg = r[0x90 + base] & 15;
			if (first_carrier < 0 && RetroChipInstruments::is_carrier(patch.alg, i)) {
				first_carrier = i;
			}
		}
		r_level = first_carrier >= 0 ? patch.ops[first_carrier].tl : 0;
		// O volume (TL dos operadores de saída) fica fora do timbre: vira a velocity de cada nota. Os
		// outros operadores de saída entram em relação ao primeiro, para o equilíbrio entre eles ficar.
		r_key = "fm" + itos(p_channel) + ":" + itos(patch.alg) + "," + itos(patch.fb) + "," + itos(patch.ams) + "," + itos(patch.pms);
		for (int i = 0; i < 4; i++) {
			const RetroInstrument::Op &op = patch.ops[i];
			const int tl = RetroChipInstruments::is_carrier(patch.alg, i) ? op.tl - r_level : op.tl;
			r_key += vformat("|%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d", op.ar, op.d1r, op.d2r, op.rr, op.sl, tl, op.ks, op.mul, op.dt, op.am, op.ssg);
		}
		return patch;
	}

	double _pitch(int p_channel) const {
		if (p_channel < 6) {
			const int port = p_channel >= 3 ? 1 : 0, slot = p_channel % 3;
			const int high = fm[port][0xa4 + slot];
			return fm_note((high >> 3) & 7, ((high & 7) << 8) | fm[port][0xa0 + slot], fm_clock);
		}
		if (p_channel < NOISE) {
			return psg_note(psg_period[p_channel - 6], psg_clock);
		}
		// Ruído: na taxa 3 segue o período do tom 3; nas outras a altura não muda o som.
		return (noise_control & 3) == 3 ? psg_note(psg_period[2], psg_clock) : 60;
	}

	void _start(int p_channel, double p_time) {
		const double pitch = _pitch(p_channel);
		if (pitch < 0) {
			return;
		}
		RawNote note;
		note.channel = p_channel;
		note.start = p_time;
		note.pitch = pitch;
		if (p_channel < 6) {
			note.patch = _fm_patch(p_channel, note.key, note.level);
		} else if (p_channel < NOISE) {
			note.patch.kind = "psg";
			note.key = "psg" + itos(p_channel);
			note.level = psg_att[p_channel - 6];
		} else {
			note.patch.kind = "noise";
			note.patch.mode = (noise_control & 4) ? "white" : "periodic";
			note.patch.rate = noise_control & 3;
			note.key = "noise:" + itos(noise_control & 7);
			note.level = psg_att[3];
		}
		active[p_channel] = notes.size();
		notes.push_back(note);
	}

	void _end(int p_channel, double p_time) {
		if (active[p_channel] >= 0) {
			notes.write[active[p_channel]].end = p_time;
			active[p_channel] = -1;
		}
	}

	// Depois de todas as escritas de um mesmo instante (o período do PSG chega em dois bytes, a altura
	// do FM às vezes depois do key on), decide o que começa, acaba ou muda em cada canal.
	void _settle(double p_time) {
		for (int channel = 0; channel < 10; channel++) {
			bool sounding, retrigger;
			if (channel < 6) {
				sounding = fm_key[channel] && !(channel == 5 && dac);
				retrigger = fm_retrigger[channel];
				fm_retrigger[channel] = false;
			} else {
				const int index = channel - 6;
				sounding = psg_att[index] < 15;
				retrigger = psg_retrigger[index];
				psg_retrigger[index] = false;
			}
			bool split = false;
			if (active[channel] >= 0) {
				const double pitch = _pitch(channel);
				split = sounding && !retrigger && pitch >= 0 && Math::abs(pitch - notes[active[channel]].pitch) >= SPLIT_SEMITONES;
				if (!sounding || retrigger || split) {
					_end(channel, p_time);
				}
			}
			if (sounding && active[channel] < 0) {
				_start(channel, p_time);
				if (split && active[channel] >= 0) {
					notes.write[active[channel]].split = true;
				}
			}
		}
	}

	void _write(const RetroChipWrite &p_write) {
		if (p_write.chip == 0) {
			const int port = p_write.port & 1, address = p_write.address, data = p_write.data;
			if (port == 0 && address == 0x28) {
				const int bits = data & 7;
				if ((bits & 3) == 3) {
					return;
				}
				const int channel = (bits & 3) + (bits & 4 ? 3 : 0);
				const bool on = (data & 0xf0) != 0;
				// Desligar e ligar no mesmo instante é uma nota nova.
				if (on && !fm_key[channel] && fm_retrigger_pending[channel]) {
					fm_retrigger[channel] = true;
				}
				if (!on && fm_key[channel]) {
					fm_retrigger_pending[channel] = true;
				}
				if (on && fm_key[channel]) {
					fm_retrigger[channel] = true; // Key on de novo sem soltar.
				}
				fm_key[channel] = on;
				return;
			}
			if (port == 0 && address == 0x2b) {
				dac = (data & 0x80) != 0;
				return;
			}
			if (port == 0 && address == 0x2a) {
				dac_used = dac_used || dac;
				return;
			}
			if (port == 0 && address == 0x27 && (data & 0xc0)) {
				special_mode = true;
			}
			fm[port][address] = data;
			return;
		}
		const int byte = p_write.data;
		if (byte & 0x80) {
			latch_channel = (byte >> 5) & 3;
			latch_volume = (byte >> 4) & 1;
			const int low = byte & 15;
			if (latch_volume) {
				_psg_volume(latch_channel, low);
			} else if (latch_channel < 3) {
				psg_period[latch_channel] = (psg_period[latch_channel] & 0x3f0) | low;
			} else {
				noise_control = low;
				psg_retrigger[3] = true; // Escrever no controle do ruído reinicia o ruído (bateria).
			}
		} else if (latch_volume) {
			_psg_volume(latch_channel, byte & 15);
		} else if (latch_channel < 3) {
			psg_period[latch_channel] = (psg_period[latch_channel] & 15) | ((byte & 0x3f) << 4);
		}
	}

	void _psg_volume(int p_channel, int p_att) {
		if (psg_att[p_channel] < 15 && p_att == 15) {
			psg_retrigger_pending[p_channel] = true;
		} else if (psg_att[p_channel] == 15 && p_att < 15 && psg_retrigger_pending[p_channel]) {
			psg_retrigger[p_channel] = true; // Calou e voltou no mesmo instante.
		}
		psg_att[p_channel] = p_att;
	}

	bool fm_retrigger_pending[6] = {};
	bool psg_retrigger_pending[4] = {};

public:
	Vector<RawNote> notes;
	bool dac_used = false;
	bool special_mode = false;

	void read(const RetroVgmFile &p_vgm, double &r_end) {
		if (p_vgm.ym_clock) {
			fm_clock = p_vgm.ym_clock & 0x3fffffff;
		}
		if (p_vgm.psg_clock) {
			psg_clock = p_vgm.psg_clock & 0x3fffffff;
		}
		RetroVgmCursor cursor(&p_vgm, false);
		Vector<RetroVgmWrite> writes;
		cursor.run(int64_t(p_vgm.samples) + 1, writes);
		double instant = -1;
		for (const RetroVgmWrite &write : writes) {
			if (write.sample != instant) {
				if (instant >= 0) {
					_settle(instant);
					for (int i = 0; i < 6; i++) {
						fm_retrigger_pending[i] = false;
					}
					for (int i = 0; i < 4; i++) {
						psg_retrigger_pending[i] = false;
					}
				}
				instant = write.sample;
			}
			_write(write.write);
		}
		if (instant >= 0) {
			_settle(instant);
		}
		r_end = MAX(double(p_vgm.samples), instant);
		for (int channel = 0; channel < 10; channel++) {
			_end(channel, r_end);
		}
	}
};

// Linha da música em quadros (pode ser fracionária: os trackers alternam linhas de 7 e 8 quadros, e
// drivers fora de 60 Hz caem entre quadros, com erro que se acumula). 1) A maior linha em que quase
// todas (90%) as distâncias entre começos de nota vizinhos são múltiplos dela (as distâncias não
// acumulam erro). 2) Numera as linhas de cada nota e ajusta a linha exata e a origem por mínimos
// quadrados. Aceita se 85% das notas ficam a menos de meio quadro da grade. Só os key on contam.
double estimate_row(const Vector<RawNote> &p_notes, double &r_origin) {
	Vector<double> onsets;
	HashSet<int64_t> seen;
	for (const RawNote &note : p_notes) {
		if (note.split) {
			continue;
		}
		const int64_t key = int64_t(Math::round(note.start / FRAME * 100)); // Centésimos de quadro.
		if (!seen.has(key)) {
			seen.insert(key);
			onsets.push_back(note.start / FRAME);
		}
	}
	r_origin = 0;
	if (onsets.size() < 8) {
		return 0;
	}
	onsets.sort();
	const double tolerance = 0.55;
	Vector<double> deltas;
	for (int i = 1; i < onsets.size(); i++) {
		if (onsets[i] - onsets[i - 1] > 0.3) {
			deltas.push_back(onsets[i] - onsets[i - 1]);
		}
	}
	if (deltas.size() < 4) {
		return 0;
	}
	double coarse = 0;
	for (int step = 48 * 20; step >= 2 * 20; step--) {
		const double row = step / 20.0;
		int ok = 0;
		for (double delta : deltas) {
			const double rows = Math::round(delta / row);
			if (rows >= 1 && Math::abs(delta - rows * row) <= tolerance) {
				ok++;
			}
		}
		if (ok >= deltas.size() * 0.9) {
			coarse = row;
			break;
		}
	}
	if (coarse <= 0) {
		return 0;
	}
	Vector<double> index;
	index.push_back(0);
	for (int i = 1; i < onsets.size(); i++) {
		index.push_back(index[i - 1] + Math::round((onsets[i] - onsets[i - 1]) / coarse));
	}
	double sk = 0, st = 0, skk = 0, skt = 0;
	const int n = onsets.size();
	for (int i = 0; i < n; i++) {
		sk += index[i];
		st += onsets[i];
		skk += index[i] * index[i];
		skt += index[i] * onsets[i];
	}
	const double denominator = n * skk - sk * sk;
	if (denominator <= 0) {
		return 0;
	}
	const double row = (n * skt - sk * st) / denominator;
	const double origin = (st - row * sk) / n;
	if (row < 1.5) {
		return 0;
	}
	int near = 0;
	for (int i = 0; i < n; i++) {
		if (Math::abs(onsets[i] - (origin + row * index[i])) <= tolerance) {
			near++;
		}
	}
	if (near < n * 0.85) {
		return 0;
	}
	// Origem levada para antes da primeira nota (a grade continua para trás, e o tick 0 é uma linha).
	r_origin = origin - Math::floor(origin / row) * row;
	return row;
}

} // namespace

bool RetroVgmImport::import(const RetroVgmFile &p_vgm, const String &p_id, const String &p_name, Result &r_result, String &r_error) {
	Reader reader;
	double end_sample = 0;
	reader.read(p_vgm, end_sample);
	Vector<RawNote> notes;
	for (const RawNote &note : reader.notes) {
		if (note.end - note.start >= FRAME * 0.5) { // Menos de meio quadro não soa no driver.
			notes.push_back(note);
		}
	}
	if (notes.is_empty()) {
		r_error = U("Nenhuma nota do YM2612 ou do PSG neste VGM (só o DAC ou outros chips?).");
		return false;
	}

	// Tempo: a linha estimada vira uma semicolcheia (12 ticks), com o BPM entre 60 e 200. Começo e fim
	// das notas encaixam em quartos de linha (o que caiu entre quadros volta para a linha).
	double origin = 0;
	const double row = estimate_row(notes, origin);
	RetroSong song = RetroSong::create(p_id, p_name, String());
	song.tracks.clear();
	double ticks_per_frame;
	int snap = 1;
	if (row > 0) {
		double rows_per_beat = 4;
		double bpm = 3600.0 / (rows_per_beat * row);
		while (bpm > 200 && rows_per_beat < 16) {
			rows_per_beat *= 2;
			bpm /= 2;
		}
		while (bpm < 60 && rows_per_beat > 1) {
			rows_per_beat /= 2;
			bpm *= 2;
		}
		song.tempo = CLAMP(int(Math::round(bpm)), SONG_TEMPO_MIN, SONG_TEMPO_MAX);
		ticks_per_frame = SONG_PPQ / rows_per_beat / row;
		snap = MAX(1, int(Math::round(SONG_PPQ / rows_per_beat / 4)));
	} else {
		song.tempo = 120;
		ticks_per_frame = song.tempo * SONG_PPQ / 60.0 / SONG_FPS;
		r_result.warnings.push_back(U("As notas não seguem uma grade de quadros clara: o tempo ficou em 120 BPM e as notas podem não cair nas linhas do piano roll."));
	}
	r_result.frames_per_row = row;
	const auto tick_of = [&](double p_sample) {
		const double tick = MAX(0.0, (p_sample / FRAME - origin) * ticks_per_frame);
		return int(Math::round(tick / snap)) * snap;
	};

	// Timbres: o volume de referência é o mais alto em que o timbre aparece; o resto vira velocity.
	struct Group {
		String key;
		int channel = 0;
		int base_level = 999;
		int notes = 0;
		RetroInstrument patch;
		int track = -1;
	};
	Vector<Group> groups;
	HashMap<String, int> group_of;
	for (const RawNote &note : notes) {
		if (!group_of.has(note.key)) {
			group_of[note.key] = groups.size();
			Group group;
			group.key = note.key;
			group.channel = note.channel;
			group.patch = note.patch;
			groups.push_back(group);
		}
		Group &group = groups.write[group_of[note.key]];
		group.notes++;
		if (note.level < group.base_level) {
			group.base_level = note.level;
			group.patch = note.patch; // O patch com os TL do volume de referência.
		}
	}
	// Limites da música: ficam os timbres com mais notas.
	Vector<int> order;
	for (int i = 0; i < groups.size(); i++) {
		order.push_back(i);
	}
	const int limit = MIN(SONG_MAX_TRACKS, SONG_MAX_INSTRUMENTS);
	if (order.size() > limit) {
		struct ByNotes {
			const Vector<Group> *groups;
			bool operator()(int a, int b) const { return (*groups)[a].notes > (*groups)[b].notes; }
		};
		SortArray<int, ByNotes> sorter;
		sorter.compare.groups = &groups;
		sorter.sort(order.ptrw(), order.size());
		r_result.warnings.push_back(vformat(U("O VGM tem %d timbres; ficaram os %d com mais notas (a música aceita %d faixas)."), order.size(), limit, limit));
		order.resize(limit);
	}
	order.sort(); // De volta à ordem de aparição.
	int per_channel[10] = {};
	PackedStringArray taken;
	for (int index : order) {
		Group &group = groups.write[index];
		RetroInstrument patch = group.patch;
		const int count = ++per_channel[group.channel];
		const String channel_name = U(CHANNEL_NAMES[group.channel]);
		if (patch.kind == "fm") {
			patch.name = "VGM " + channel_name + (count > 1 ? " " + itos(count) : String());
		} else if (patch.kind == "psg") {
			patch.name = "VGM " + channel_name;
			patch.envelope.volume = CLAMP(group.base_level, 0, 15);
		} else {
			patch.name = U("VGM ruído ") + (patch.mode == "white" ? U("branco") : U("periódico")) + " " + itos(patch.rate);
			patch.envelope.volume = CLAMP(group.base_level, 0, 15);
		}
		String error;
		const RetroInstrument instrument = RetroInstrumentFormats::song_instrument(patch.to_dictionary(), taken, error, U("Do VGM"));
		if (!error.is_empty()) {
			r_result.warnings.push_back(patch.name + ": " + error);
			continue;
		}
		taken.push_back(instrument.id);
		song.instruments.push_back(instrument);
		RetroSongTrack track;
		track.id = "faixa-" + itos(song.tracks.size() + 1);
		track.name = channel_name + (count > 1 ? U(" · ") + itos(count) : String());
		track.instrument = instrument.id;
		group.track = song.tracks.size();
		song.tracks.push_back(track);
	}

	int last_tick = 0;
	int kept = 0;
	for (const RawNote &note : notes) {
		const Group &group = groups[group_of[note.key]];
		if (group.track < 0) {
			continue;
		}
		if (kept >= SONG_MAX_NOTES) {
			r_result.warnings.push_back(vformat(U("A música aceita até %d notas; o resto ficou de fora."), SONG_MAX_NOTES));
			break;
		}
		RetroSongNote out;
		out.t = tick_of(note.start);
		out.d = MAX(snap, tick_of(note.end) - out.t);
		out.n = CLAMP(int(Math::round(note.pitch)), 0, 127);
		const int extra = note.level - group.base_level;
		if (note.patch.kind == "fm") {
			out.v = CLAMP(int(Math::round(127 * Math::pow(10.0, -extra / 20.0))), 1, 127);
		} else {
			out.v = CLAMP(int(Math::round(127 - MIN(extra, 4) * 127 / 4.0)), 1, 127);
		}
		song.tracks.write[group.track].notes.push_back(out);
		last_tick = MAX(last_tick, out.t + out.d);
		kept++;
	}

	const int bar = song.beats_per_bar * SONG_PPQ;
	const int end_tick = MAX(last_tick, tick_of(end_sample));
	song.bars = CLAMP((end_tick + bar - 1) / bar, 1, SONG_MAX_BARS);
	if (end_tick > song.length()) {
		r_result.warnings.push_back(vformat(U("A música passa de %d compassos; o fim ficou de fora."), SONG_MAX_BARS));
	}
	if (p_vgm.loop_offset >= 0 && p_vgm.loop_samples > 0 && p_vgm.loop_samples <= p_vgm.samples) {
		song.has_loop = true;
		song.loop_start = tick_of(double(p_vgm.samples - p_vgm.loop_samples));
		song.loop_end = MIN(end_tick, song.length());
	} else {
		song.has_loop = false;
	}
	song.normalize();
	if (reader.dac_used) {
		r_result.warnings.push_back(U("A bateria em PCM (DAC do FM6) não vira notas e ficou de fora."));
	}
	if (reader.special_mode) {
		r_result.warnings.push_back(U("O FM3 usa o modo especial (uma altura por operador); ele entrou com a altura do canal."));
	}
	r_result.song = song;
	r_result.notes = kept;
	return true;
}
