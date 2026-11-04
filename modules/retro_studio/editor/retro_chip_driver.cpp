#include "retro_chip_driver.h"

#include "core/math/math_funcs.h"

// ---- instrumentos ----

static const char *OP_KEYS[11] = { "ar", "d1r", "d2r", "rr", "sl", "tl", "ks", "mul", "dt", "am", "ssg" };
static const int OP_LIMITS[11] = { 31, 31, 31, 15, 15, 127, 3, 15, 7, 1, 15 };
static const char *ENV_KEYS[5] = { "volume", "attack", "decay", "sustain", "release" };
static const int ENV_LIMITS[5] = { 15, 255, 255, 15, 255 };
// Deslocamento de cada operador (S1..S4) nos registradores 0x30..0x9F.
static const int OPERATOR_OFFSET[4] = { 0, 8, 4, 12 };
// Operadores que soam em cada algoritmo.
static const int FM_CARRIERS[8][4] = { { 3, -1 }, { 3, -1 }, { 3, -1 }, { 3, -1 }, { 1, 3, -1 }, { 1, 2, 3, -1 }, { 1, 2, 3, -1 }, { 0, 1, 2, 3 } };

static int *_op_field(RetroInstrument::Op &r_op, int p_index) {
	int *fields[11] = { &r_op.ar, &r_op.d1r, &r_op.d2r, &r_op.rr, &r_op.sl, &r_op.tl, &r_op.ks, &r_op.mul, &r_op.dt, &r_op.am, &r_op.ssg };
	return fields[p_index];
}

static int *_env_field(RetroInstrument::Envelope &r_env, int p_index) {
	int *fields[5] = { &r_env.volume, &r_env.attack, &r_env.decay, &r_env.sustain, &r_env.release };
	return fields[p_index];
}

Dictionary RetroInstrument::to_dictionary() const {
	Dictionary data;
	data["id"] = id;
	data["name"] = name;
	if (!category.is_empty()) {
		data["category"] = category;
	}
	data["kind"] = kind;
	if (kind == "fm") {
		data["alg"] = alg;
		data["fb"] = fb;
		data["ams"] = ams;
		data["pms"] = pms;
		Array list;
		for (int i = 0; i < 4; i++) {
			Dictionary op;
			RetroInstrument::Op copy = ops[i];
			for (int k = 0; k < 11; k++) {
				op[OP_KEYS[k]] = *_op_field(copy, k);
			}
			list.push_back(op);
		}
		data["ops"] = list;
		if (has_sweep) {
			Dictionary sweep;
			sweep["semitones"] = sweep_semitones;
			sweep["frames"] = sweep_frames;
			data["sweep"] = sweep;
		}
		for (const KeyValue<Variant, Variant> &entry : extra) {
			data[entry.key] = entry.value;
		}
		return data;
	}
	Dictionary env;
	RetroInstrument::Envelope copy = envelope;
	for (int k = 0; k < 5; k++) {
		env[ENV_KEYS[k]] = *_env_field(copy, k);
	}
	data["envelope"] = env;
	if (kind == "noise") {
		data["mode"] = mode;
		data["rate"] = rate;
	}
	for (const KeyValue<Variant, Variant> &entry : extra) {
		data[entry.key] = entry.value;
	}
	return data;
}

static bool _integer(const Variant &p_value, int p_max, int &r_out) {
	if (p_value.get_type() != Variant::INT && p_value.get_type() != Variant::FLOAT) {
		return false;
	}
	const double value = p_value;
	if (value != Math::floor(value) || value < 0 || value > p_max) {
		return false;
	}
	r_out = int(value);
	return true;
}

static bool _known_key(const String &p_key) {
	static const char *KEYS[13] = { "id", "name", "category", "kind", "alg", "fb", "ams", "pms", "ops", "sweep", "envelope", "mode", "rate" };
	for (const char *key : KEYS) {
		if (p_key == key) {
			return true;
		}
	}
	return false;
}

bool RetroChipInstruments::is_carrier(int p_alg, int p_operator) {
	for (int i = 0; i < 4 && FM_CARRIERS[CLAMP(p_alg, 0, 7)][i] >= 0; i++) {
		if (FM_CARRIERS[CLAMP(p_alg, 0, 7)][i] == p_operator) {
			return true;
		}
	}
	return false;
}

RetroInstrument RetroInstrument::from_dictionary(const Dictionary &p_data, String &r_error) {
	RetroInstrument instrument;
	r_error = String();
	for (const KeyValue<Variant, Variant> &entry : p_data) {
		if (!_known_key(entry.key)) {
			instrument.extra[entry.key] = entry.value;
		}
	}
	instrument.id = p_data.get("id", "");
	bool valid_id = !instrument.id.is_empty() && instrument.id.length() <= 48;
	for (int i = 0; valid_id && i < instrument.id.length(); i++) {
		const char32_t c = instrument.id[i];
		valid_id = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (c == '-' && i > 0);
	}
	if (!valid_id) {
		r_error = "Invalid instrument ID.";
		return instrument;
	}
	instrument.name = p_data.get("name", "");
	if (instrument.name.strip_edges().is_empty() || instrument.name.length() > 64) {
		r_error = "Invalid instrument name: " + instrument.id;
		return instrument;
	}
	instrument.category = p_data.get("category", "");
	instrument.kind = p_data.get("kind", "");
	if (instrument.kind == "fm") {
		const char *keys[4] = { "alg", "fb", "ams", "pms" };
		const int limits[4] = { 7, 7, 3, 7 };
		int *fields[4] = { &instrument.alg, &instrument.fb, &instrument.ams, &instrument.pms };
		for (int k = 0; k < 4; k++) {
			if (!_integer(p_data.get(keys[k], Variant()), limits[k], *fields[k])) {
				r_error = String("Invalid instrument ") + keys[k] + " (" + instrument.id + ").";
				return instrument;
			}
		}
		const Variant ops = p_data.get("ops", Variant());
		if (ops.get_type() != Variant::ARRAY || Array(ops).size() != 4) {
			r_error = "An FM instrument has 4 operators: " + instrument.id;
			return instrument;
		}
		for (int i = 0; i < 4; i++) {
			const Dictionary op = Array(ops)[i];
			for (int k = 0; k < 11; k++) {
				if (!_integer(op.get(OP_KEYS[k], Variant()), OP_LIMITS[k], *_op_field(instrument.ops[i], k))) {
					r_error = vformat("Invalid instrument S%d %s (%s).", i + 1, OP_KEYS[k], instrument.id);
					return instrument;
				}
			}
		}
		if (p_data.has("sweep")) {
			const Dictionary sweep = p_data["sweep"];
			const Variant semitones = sweep.get("semitones", Variant());
			if ((semitones.get_type() != Variant::INT && semitones.get_type() != Variant::FLOAT) || Math::abs(double(semitones)) > 48 ||
					!_integer(sweep.get("frames", Variant()), 120, instrument.sweep_frames)) {
				r_error = "Invalid instrument sweep: " + instrument.id;
				return instrument;
			}
			instrument.has_sweep = true;
			instrument.sweep_semitones = int(double(semitones));
		}
		return instrument;
	}
	if (instrument.kind != "psg" && instrument.kind != "noise") {
		r_error = "Unsupported instrument kind: " + instrument.kind;
		return instrument;
	}
	const Dictionary env = p_data.get("envelope", Dictionary());
	for (int k = 0; k < 5; k++) {
		if (!_integer(env.get(ENV_KEYS[k], Variant()), ENV_LIMITS[k], *_env_field(instrument.envelope, k))) {
			r_error = vformat("Invalid instrument envelope %s (%s).", ENV_KEYS[k], instrument.id);
			return instrument;
		}
	}
	if (instrument.kind == "noise") {
		instrument.mode = p_data.get("mode", "");
		if (instrument.mode != "white" && instrument.mode != "periodic") {
			r_error = "Invalid noise mode: " + instrument.id;
			return instrument;
		}
		if (!_integer(p_data.get("rate", Variant()), 3, instrument.rate)) {
			r_error = "Invalid instrument noise rate (" + instrument.id + ").";
		}
	}
	return instrument;
}

const char *RetroChipInstruments::CATEGORIES[7] = { "Teclas", "Baixos", "Leads", "Cordas e pads", "Metais e sopros", "Percussão", "PSG" };

static RetroInstrument::Op _op(int ar, int d1r, int d2r, int rr, int sl, int tl, int mul, int dt = 0, int ks = 0, int am = 0) {
	RetroInstrument::Op op;
	op.ar = ar;
	op.d1r = d1r;
	op.d2r = d2r;
	op.rr = rr;
	op.sl = sl;
	op.tl = tl;
	op.ks = ks;
	op.mul = mul;
	op.dt = dt;
	op.am = am;
	return op;
}

// Operadores que soam se somam e o canal satura em ±1: com 2, 3 ou 4 deles o banco desce o TL (6, 9 e
// 12 dB) para os presets terem o mesmo volume percebido.
static RetroInstrument _fm(const char *id, const char *name, const char *category, int alg, int fb, const RetroInstrument::Op (&ops)[4], int sweep_semitones = 0, int sweep_frames = 0) {
	static const int CARRIER_TRIM[5] = { 0, 0, 8, 12, 16 };
	RetroInstrument instrument;
	instrument.id = id;
	instrument.name = String::utf8(name);
	instrument.category = String::utf8(category);
	instrument.kind = "fm";
	instrument.alg = alg;
	instrument.fb = fb;
	int audible = 0;
	bool is_audible[4] = {};
	for (int c = 0; c < 4 && FM_CARRIERS[alg][c] >= 0; c++) {
		if (ops[FM_CARRIERS[alg][c]].tl < 127) {
			is_audible[FM_CARRIERS[alg][c]] = true;
			audible++;
		}
	}
	for (int i = 0; i < 4; i++) {
		instrument.ops[i] = ops[i];
		if (is_audible[i]) {
			instrument.ops[i].tl = MIN(127, ops[i].tl + CARRIER_TRIM[audible]);
		}
	}
	if (sweep_frames) {
		instrument.has_sweep = true;
		instrument.sweep_semitones = sweep_semitones;
		instrument.sweep_frames = sweep_frames;
	}
	return instrument;
}

static RetroInstrument _psg(const char *id, const char *name, const char *category, const char *kind, const char *mode, int rate, int volume, int attack, int decay, int sustain, int release) {
	RetroInstrument instrument;
	instrument.id = id;
	instrument.name = String::utf8(name);
	instrument.category = String::utf8(category);
	instrument.kind = kind;
	instrument.mode = mode;
	instrument.rate = rate;
	instrument.envelope.volume = volume;
	instrument.envelope.attack = attack;
	instrument.envelope.decay = decay;
	instrument.envelope.sustain = sustain;
	instrument.envelope.release = release;
	return instrument;
}

const Vector<RetroInstrument> &RetroChipInstruments::presets() {
	static Vector<RetroInstrument> list;
	if (!list.is_empty()) {
		return list;
	}
	typedef RetroInstrument::Op O;
	list.push_back(_fm("piano-eletrico", "Piano elétrico", "Teclas", 4, 3, { _op(31, 18, 0, 6, 15, 45, 14, 3, 1), _op(31, 8, 2, 6, 4, 8, 1, 0, 1), _op(31, 6, 0, 6, 3, 30, 1, 7, 1), _op(31, 5, 2, 6, 3, 4, 1, 3, 1) }));
	list.push_back(_fm("piano-brilhante", "Piano brilhante", "Teclas", 2, 4, { _op(31, 14, 3, 7, 8, 36, 3, 3, 2), _op(31, 12, 2, 7, 6, 30, 1, 0, 1), _op(31, 10, 2, 7, 5, 26, 1, 7, 1), _op(31, 6, 3, 7, 4, 2, 1, 0, 1) }));
	list.push_back(_fm("orgao", "Órgão", "Teclas", 7, 0, { _op(31, 0, 0, 9, 0, 0, 1), _op(31, 0, 0, 9, 0, 4, 2), _op(31, 0, 0, 9, 0, 10, 4), _op(31, 0, 0, 9, 0, 4, 0) }));
	list.push_back(_fm("sino", "Sino", "Teclas", 4, 0, { _op(31, 6, 3, 5, 6, 30, 7), _op(31, 4, 2, 4, 4, 6, 2), _op(31, 8, 4, 5, 8, 36, 13), _op(31, 3, 2, 4, 3, 10, 1) }));
	list.push_back(_fm("marimba", "Marimba", "Teclas", 4, 0, { _op(31, 20, 0, 10, 15, 34, 4), _op(31, 12, 6, 9, 15, 6, 1), _op(31, 24, 0, 10, 15, 40, 10), _op(31, 11, 6, 9, 15, 10, 1) }));
	list.push_back(_fm("baixo-sintetico", "Baixo sintético", "Baixos", 0, 5, { _op(31, 14, 4, 10, 6, 30, 1, 3), _op(31, 12, 4, 10, 5, 36, 0), _op(31, 10, 2, 10, 4, 28, 1, 7), _op(31, 4, 2, 10, 2, 2, 1) }));
	list.push_back(_fm("baixo-slap", "Baixo slap", "Baixos", 4, 6, { _op(31, 20, 0, 12, 15, 24, 2), _op(31, 10, 3, 10, 3, 6, 1), _op(31, 16, 0, 12, 8, 34, 1, 3), _op(31, 8, 3, 10, 2, 4, 1) }));
	list.push_back(_fm("baixo-redondo", "Baixo redondo", "Baixos", 4, 2, { _op(31, 12, 2, 9, 6, 34, 0), _op(31, 6, 2, 9, 2, 4, 0), _op(31, 10, 2, 9, 5, 40, 1), _op(31, 6, 2, 9, 2, 8, 0, 3) }));
	list.push_back(_fm("lead-quadrado", "Lead quadrado", "Leads", 4, 0, { _op(31, 0, 0, 8, 0, 28, 2), _op(31, 0, 0, 8, 0, 4, 1), _op(31, 0, 0, 8, 0, 34, 2, 3), _op(31, 0, 0, 8, 0, 8, 1, 7) }));
	list.push_back(_fm("lead-serra", "Lead serra", "Leads", 7, 6, { _op(31, 0, 0, 8, 0, 0, 1), _op(31, 0, 0, 8, 0, 127, 1), _op(31, 0, 0, 8, 0, 12, 0), _op(31, 0, 0, 8, 0, 127, 1) }));
	list.push_back(_fm("lead-agudo", "Lead agudo", "Leads", 3, 5, { _op(31, 4, 0, 8, 2, 26, 2), _op(31, 4, 0, 8, 2, 30, 1, 3), _op(31, 4, 0, 8, 2, 36, 3), _op(31, 2, 0, 8, 1, 4, 1) }));
	list.push_back(_fm("guitarra-distorcida", "Guitarra distorcida", "Leads", 0, 7, { _op(31, 2, 0, 8, 1, 22, 3), _op(31, 4, 0, 8, 2, 18, 1), _op(31, 4, 0, 8, 2, 14, 1, 3), _op(31, 3, 2, 8, 2, 4, 1) }));
	list.push_back(_fm("cordas", "Cordas", "Cordas e pads", 4, 4, { _op(12, 2, 0, 5, 1, 38, 1, 3), _op(13, 1, 0, 5, 1, 4, 1, 3), _op(12, 2, 0, 5, 1, 40, 2, 7), _op(13, 1, 0, 5, 1, 6, 1, 7) }));
	list.push_back(_fm("pad-sintetico", "Pad sintético", "Cordas e pads", 5, 3, { _op(10, 2, 0, 4, 2, 30, 1), _op(9, 1, 0, 4, 1, 2, 1, 3), _op(9, 1, 0, 4, 1, 8, 2, 7), _op(9, 1, 0, 4, 1, 4, 1) }));
	list.push_back(_fm("metais", "Metais", "Metais e sopros", 4, 5, { _op(18, 4, 0, 7, 2, 26, 1), _op(22, 3, 0, 7, 2, 6, 1), _op(18, 4, 0, 7, 2, 30, 1, 2), _op(22, 3, 0, 7, 2, 8, 1, 6) }));
	list.push_back(_fm("flauta", "Flauta", "Metais e sopros", 4, 0, { _op(20, 2, 0, 7, 1, 50, 1), _op(22, 2, 0, 7, 1, 0, 1), _op(20, 2, 0, 7, 1, 60, 2), _op(22, 2, 0, 7, 1, 16, 2, 3) }));
	list.push_back(_fm("bumbo", "Bumbo FM", "Percussão", 4, 0, { _op(31, 24, 0, 15, 15, 22, 0), _op(31, 14, 10, 15, 15, 0, 0), _op(31, 26, 0, 15, 15, 40, 1), _op(31, 16, 12, 15, 15, 10, 0) }, 24, 6));
	list.push_back(_fm("tom", "Tom FM", "Percussão", 4, 2, { _op(31, 20, 0, 15, 15, 26, 1), _op(31, 12, 8, 13, 15, 4, 1), _op(31, 22, 0, 15, 15, 36, 2), _op(31, 14, 8, 13, 15, 10, 1) }, 12, 10));
	list.push_back(_psg("caixa", "Caixa (ruído)", "Percussão", "noise", "white", 1, 0, 0, 10, 15, 2));
	list.push_back(_psg("chimbal", "Chimbal (ruído)", "Percussão", "noise", "white", 0, 2, 0, 3, 15, 1));
	list.push_back(_psg("chimbal-aberto", "Chimbal aberto (ruído)", "Percussão", "noise", "white", 0, 3, 0, 18, 15, 6));
	list.push_back(_psg("prato", "Prato (ruído)", "Percussão", "noise", "white", 0, 1, 0, 60, 15, 20));
	list.push_back(_psg("palmas", "Palmas (ruído)", "Percussão", "noise", "white", 1, 1, 1, 7, 15, 2));
	list.push_back(_psg("psg-quadrada", "Quadrada PSG", "PSG", "psg", "", 0, 2, 0, 0, 0, 4));
	list.push_back(_psg("psg-pluck", "Pluck PSG", "PSG", "psg", "", 0, 0, 0, 16, 12, 6));
	list.push_back(_psg("psg-suave", "Quadrada suave", "PSG", "psg", "", 0, 4, 6, 20, 3, 14));
	list.push_back(_psg("psg-ruido-tonal", "Ruído tonal", "PSG", "noise", "periodic", 3, 2, 0, 0, 0, 4));
	(void)sizeof(O);
	return list;
}

void RetroChipInstruments::fm_patch_writes(int p_channel, const RetroInstrument &p_instrument, Vector<RetroChipWrite> &r_writes) {
	const uint8_t port = p_channel >= 3 ? 1 : 0, slot = p_channel % 3;
	auto write = [&](int p_address, int p_data) {
		RetroChipWrite entry;
		entry.port = port;
		entry.address = p_address;
		entry.data = p_data;
		r_writes.push_back(entry);
	};
	for (int index = 0; index < 4; index++) {
		const RetroInstrument::Op &op = p_instrument.ops[index];
		const int base = OPERATOR_OFFSET[index] + slot;
		write(0x30 + base, (op.dt << 4) | op.mul);
		write(0x40 + base, op.tl);
		write(0x50 + base, (op.ks << 6) | op.ar);
		write(0x60 + base, (op.am << 7) | op.d1r);
		write(0x70 + base, op.d2r);
		write(0x80 + base, (op.sl << 4) | op.rr);
		write(0x90 + base, op.ssg);
	}
	write(0xb0 + slot, (p_instrument.fb << 3) | p_instrument.alg);
	write(0xb4 + slot, 0xc0 | (p_instrument.ams << 4) | p_instrument.pms);
}

void RetroChipInstruments::fm_level_writes(int p_channel, const RetroInstrument &p_instrument, int p_extra, Vector<RetroChipWrite> &r_writes) {
	const uint8_t port = p_channel >= 3 ? 1 : 0, slot = p_channel % 3;
	for (int c = 0; c < 4 && FM_CARRIERS[p_instrument.alg][c] >= 0; c++) {
		const int index = FM_CARRIERS[p_instrument.alg][c];
		RetroChipWrite entry;
		entry.port = port;
		entry.address = 0x40 + OPERATOR_OFFSET[index] + slot;
		entry.data = MIN(127, p_instrument.ops[index].tl + p_extra);
		r_writes.push_back(entry);
	}
}

// Velocity MIDI → passos de TL (0,75 dB), com curva suave: 64 ≈ −4,5 dB.
int RetroChipInstruments::velocity_attenuation(int p_velocity) {
	return p_velocity >= 127 ? 0 : MIN(48, int(Math::round(-20 * (Math::log(MAX(1, p_velocity) / 127.0) / Math::log(10.0)))));
}

static double _frequency(double p_note) {
	return 440 * Math::pow(2.0, (p_note - 69) / 12.0);
}

// F-number e bloco com o F-number entre ~650 e 1300 (faixa usada pelos drivers do Mega Drive).
void RetroChipInstruments::fm_pitch(double p_note, int &r_block, int &r_fnum, int p_clock) {
	const double value = _frequency(p_note) * Math::pow(2.0, 21.0) / (p_clock / 144.0);
	for (int block = 0; block < 8; block++) {
		const int fnum = int(Math::round(value / Math::pow(2.0, block)));
		if (fnum < 1300) {
			r_block = block;
			r_fnum = fnum;
			return;
		}
	}
	r_block = 7;
	r_fnum = MIN(2047, int(Math::round(value / 128)));
}

// Período do tom do PSG (10 bits); abaixo de ~109 Hz o PSG não chega, sobe uma oitava.
int RetroChipInstruments::psg_period(double p_note, int p_clock) {
	int period = int(Math::round(p_clock / (32 * _frequency(p_note))));
	while (period > 1023) {
		period = int(Math::round(period / 2.0));
	}
	return MAX(1, period);
}

// ---- driver ----

RetroChipDriver::RetroChipDriver(int p_fm_channels, int p_fm_clock, int p_psg_clock) {
	fm_clock = p_fm_clock;
	psg_clock = p_psg_clock;
	fm.resize(p_fm_channels == 5 ? 5 : 6);
	for (int i = 0; i < fm.size(); i++) {
		fm.write[i].channel = i;
	}
	for (int i = 0; i < 3; i++) {
		tones[i].channel = i;
	}
	// Estado inicial explícito (o VGM começa de um chip recém-ligado): LFO e DAC desligados, canal 3
	// normal, todos os canais em silêncio.
	_fm(0, 0x22, 0);
	_fm(0, 0x27, 0);
	_fm(0, 0x2b, 0);
	for (int channel = 0; channel < 6; channel++) {
		_fm(0, 0x28, _key_code(channel));
	}
	for (int channel = 0; channel < 4; channel++) {
		_psg(0x90 | (channel << 5) | 15);
	}
}

void RetroChipDriver::_fm(int p_port, int p_address, int p_data) {
	RetroChipWrite write;
	write.chip = 0;
	write.port = p_port;
	write.address = p_address;
	write.data = p_data;
	writes.push_back(write);
}

void RetroChipDriver::_psg(int p_byte) {
	RetroChipWrite write;
	write.chip = 1;
	write.data = p_byte;
	writes.push_back(write);
}

void RetroChipDriver::_set_fm_pitch(Voice &r_voice) {
	int block, fnum;
	RetroChipInstruments::fm_pitch(r_voice.note + bend + r_voice.sweep, block, fnum, fm_clock);
	const int port = r_voice.channel >= 3 ? 1 : 0, slot = r_voice.channel % 3;
	_fm(port, 0xa4 + slot, (block << 3) | (fnum >> 8));
	_fm(port, 0xa0 + slot, fnum & 0xff);
}

// Livre com o mesmo patch evita recarregar; senão a que soltou (ou começou) há mais tempo.
int RetroChipDriver::_pick(const Vector<int> &p_candidates, const Voice *p_voices, const String &p_instrument) const {
	Vector<int> pool;
	for (int index : p_candidates) {
		if (!p_voices[index].held) {
			pool.push_back(index);
		}
	}
	if (pool.is_empty()) {
		pool = p_candidates;
	}
	for (int index : pool) {
		if (!p_instrument.is_empty() && p_voices[index].loaded == p_instrument) {
			return index;
		}
	}
	int best = pool[0];
	for (int index : pool) {
		if (p_voices[index].since < p_voices[best].since) {
			best = index;
		}
	}
	return best;
}

int RetroChipDriver::_vibrato_depth() const {
	return MIN(7, int(Math::round(vibrato * 7)));
}

void RetroChipDriver::_fm_note_on(const RetroInstrument &p_instrument, int p_note, int p_velocity, const String &p_owner) {
	Vector<int> all;
	for (int i = 0; i < fm.size(); i++) {
		all.push_back(i);
	}
	Voice &voice = fm.write[_pick(all, fm.ptr(), p_instrument.id)];
	const int port = voice.channel >= 3 ? 1 : 0;
	_fm(0, 0x28, _key_code(voice.channel));
	if (voice.loaded != p_instrument.id) {
		RetroChipInstruments::fm_patch_writes(voice.channel, p_instrument, writes);
		voice.loaded = p_instrument.id;
	}
	RetroChipInstruments::fm_level_writes(voice.channel, p_instrument, RetroChipInstruments::velocity_attenuation(p_velocity), writes);
	_fm(port, 0xb4 + voice.channel % 3, 0xc0 | (p_instrument.ams << 4) | (vibrato > 0 ? _vibrato_depth() : p_instrument.pms));
	voice.note = p_note;
	voice.owner = p_owner;
	voice.instrument = p_instrument;
	voice.has_instrument = true;
	voice.held = true;
	voice.since = ++clock_counter;
	voice.sweep = p_instrument.has_sweep ? p_instrument.sweep_semitones : 0;
	voice.sweep_left = p_instrument.has_sweep ? p_instrument.sweep_frames : 0;
	_set_fm_pitch(voice);
	_fm(0, 0x28, 0xf0 | _key_code(voice.channel));
}

void RetroChipDriver::_start_envelope(Voice &r_voice, const RetroInstrument &p_instrument, int p_velocity) {
	r_voice.env = true;
	r_voice.stage = p_instrument.envelope.attack ? "attack" : "decay";
	r_voice.frame = 0;
	r_voice.level = p_instrument.envelope.attack ? 15 : p_instrument.envelope.volume;
	r_voice.extra = int(Math::round((127 - p_velocity) / 127.0 * 4));
}

void RetroChipDriver::_psg_note_on(const RetroInstrument &p_instrument, int p_note, int p_velocity, const String &p_owner) {
	// Ruído tonal usa o período do canal 3: o canal fica reservado (mudo) enquanto soa.
	const bool tonal = p_instrument.kind == "noise" && p_instrument.rate == 3;
	if (p_instrument.kind == "noise") {
		noise.note = p_note;
		noise.owner = p_owner;
		noise.instrument = p_instrument;
		noise.has_instrument = true;
		noise.held = true;
		noise.since = ++clock_counter;
		_start_envelope(noise, p_instrument, p_velocity);
		if (tonal) {
			Voice &third = tones[2];
			third.note = p_note;
			third.owner = p_owner;
			third.has_instrument = false;
			third.held = true;
			third.since = clock_counter;
			third.env = false;
			_psg(0xdf);
			_set_tone(2, p_note);
		}
		_psg(0xe0 | (p_instrument.mode == "white" ? 4 : 0) | p_instrument.rate);
		_apply_envelope(noise, 3);
		return;
	}
	Vector<int> candidates;
	const bool reserved = noise.held && noise.has_instrument && noise.instrument.rate == 3;
	for (int i = 0; i < 3; i++) {
		if (!(i == 2 && reserved)) {
			candidates.push_back(i);
		}
	}
	Voice &voice = tones[_pick(candidates, tones, String())];
	voice.note = p_note;
	voice.owner = p_owner;
	voice.instrument = p_instrument;
	voice.has_instrument = true;
	voice.held = true;
	voice.since = ++clock_counter;
	_start_envelope(voice, p_instrument, p_velocity);
	_set_tone(voice.channel, p_note);
	_apply_envelope(voice, voice.channel);
}

void RetroChipDriver::_set_tone(int p_channel, int p_note) {
	const int period = RetroChipInstruments::psg_period(p_note + bend, psg_clock);
	_psg(0x80 | (p_channel << 5) | (period & 15));
	_psg((period >> 4) & 0x3f);
}

void RetroChipDriver::_apply_envelope(Voice &r_voice, int p_channel) {
	const int level = r_voice.env ? MIN(15, int(Math::round(r_voice.level)) + (r_voice.level < 15 ? r_voice.extra : 0)) : 15;
	_psg(0x90 | (p_channel << 5) | level);
}

void RetroChipDriver::_step_envelope(Voice &r_voice) {
	if (!r_voice.env || !r_voice.has_instrument) {
		return;
	}
	const RetroInstrument::Envelope &shape = r_voice.instrument.envelope;
	const double target = MIN(15, shape.volume + shape.sustain);
	r_voice.frame++;
	if (r_voice.stage == "attack") {
		r_voice.level = 15 - (15 - shape.volume) * MIN(1.0, double(r_voice.frame) / shape.attack);
		if (r_voice.frame >= shape.attack) {
			r_voice.stage = "decay";
			r_voice.frame = 0;
		}
	} else if (r_voice.stage == "decay") {
		r_voice.level = shape.decay ? shape.volume + (target - shape.volume) * MIN(1.0, double(r_voice.frame) / shape.decay) : target;
		if (r_voice.frame >= shape.decay) {
			r_voice.stage = "sustain";
		}
	} else if (r_voice.stage == "release") {
		r_voice.level = shape.release ? r_voice.from + (15 - r_voice.from) * MIN(1.0, double(r_voice.frame) / shape.release) : 15;
		if (r_voice.level >= 15) {
			r_voice.level = 15;
			r_voice.env = false;
		}
	}
}

void RetroChipDriver::_release(Voice &r_voice) {
	if (r_voice.env) {
		r_voice.stage = "release";
		r_voice.frame = 0;
		r_voice.from = r_voice.level;
	}
}

void RetroChipDriver::note_on(const RetroInstrument &p_instrument, int p_note, int p_velocity, const String &p_owner) {
	if (p_instrument.kind == "fm") {
		_fm_note_on(p_instrument, p_note, p_velocity, p_owner);
	} else {
		_psg_note_on(p_instrument, p_note, p_velocity, p_owner);
	}
}

void RetroChipDriver::note_off(int p_note, const String &p_owner) {
	auto mine = [&](const Voice &p_voice) { return p_voice.held && p_voice.note == p_note && p_voice.owner == p_owner; };
	for (Voice &voice : fm) {
		if (mine(voice)) {
			voice.held = false;
			voice.since = ++clock_counter;
			_fm(0, 0x28, _key_code(voice.channel));
		}
	}
	for (Voice &voice : tones) {
		if (mine(voice)) {
			voice.held = false;
			voice.since = ++clock_counter;
			_release(voice);
		}
	}
	if (mine(noise)) {
		noise.held = false;
		noise.since = ++clock_counter;
		_release(noise);
		if (tones[2].held && !tones[2].has_instrument && tones[2].note == p_note && tones[2].owner == p_owner) {
			tones[2].held = false;
		}
	}
}

void RetroChipDriver::pitch_bend(double p_semitones) {
	bend = p_semitones;
	for (Voice &voice : fm) {
		if (voice.note >= 0) {
			_set_fm_pitch(voice);
		}
	}
	for (Voice &voice : tones) {
		if (voice.note >= 0 && (voice.has_instrument || voice.held)) {
			_set_tone(voice.channel, voice.note);
		}
	}
}

void RetroChipDriver::modulation(double p_amount) {
	const bool before = vibrato > 0;
	vibrato = CLAMP(p_amount, 0.0, 1.0);
	if ((vibrato > 0) != before) {
		_fm(0, 0x22, vibrato > 0 ? 0x08 | 4 : 0);
	}
	for (Voice &voice : fm) {
		if (voice.has_instrument) {
			_fm(voice.channel >= 3 ? 1 : 0, 0xb4 + voice.channel % 3, 0xc0 | (voice.instrument.ams << 4) | (vibrato > 0 ? _vibrato_depth() : voice.instrument.pms));
		}
	}
}

void RetroChipDriver::tick() {
	for (Voice &voice : fm) {
		if (voice.sweep_left > 0) {
			voice.sweep_left--;
			voice.sweep = voice.sweep_left ? voice.sweep * voice.sweep_left / (voice.sweep_left + 1) : 0;
			_set_fm_pitch(voice);
		}
	}
	for (Voice &voice : tones) {
		if (voice.env) {
			_step_envelope(voice);
			_apply_envelope(voice, voice.channel);
		}
	}
	if (noise.env) {
		_step_envelope(noise);
		_apply_envelope(noise, 3);
	}
}

void RetroChipDriver::all_notes_off() {
	for (Voice &voice : fm) {
		voice.held = false;
		voice.note = -1;
		_fm(0, 0x28, _key_code(voice.channel));
	}
	for (Voice *voice : { &tones[0], &tones[1], &tones[2], &noise }) {
		voice->held = false;
		voice->note = -1;
		voice->env = false;
	}
	for (int channel = 0; channel < 4; channel++) {
		_psg(0x90 | (channel << 5) | 15);
	}
}

void RetroChipDriver::invalidate(const String &p_id) {
	for (Voice &voice : fm) {
		if (p_id.is_empty() || voice.loaded == p_id) {
			voice.loaded = String();
		}
	}
}

Vector<RetroChipWrite> RetroChipDriver::take() {
	Vector<RetroChipWrite> out = writes;
	writes.clear();
	return out;
}
