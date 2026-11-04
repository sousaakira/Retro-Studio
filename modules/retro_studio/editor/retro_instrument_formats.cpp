#include "retro_instrument_formats.h"

#include "core/templates/hash_set.h"

const char *RetroInstrumentFormats::IMPORT_FORMATS[5] = { ".tfi", ".dmp", ".fui", ".opni", ".wopn" };
const RetroInstrumentFormats::ExportFormat RetroInstrumentFormats::EXPORT_FORMATS[4] = {
	{ "tfi", "TFI (TFM Music Maker)" }, { "dmp", "DMP (DefleMask)" }, { "fui", "FUI (Furnace)" }, { "opni", "OPNI (OPN2 Bank Editor)" }
};

static const int FILE_ORDER[4] = { 0, 2, 1, 3 }; // posição no arquivo → índice S1..S4 (é a própria inversa)
static const int FURNACE_TO_REGISTER[8] = { 7, 6, 5, 0, 1, 2, 3, 4 };
static const char *PSG_WARNING = "Instrumento PSG: a macro de volume virou um envelope aproximado; arpejo e outras macros foram ignorados.";
static const char *MACRO_WARNING = "Macros do Furnace (volume, arpejo, operadores) não são importadas: só o patch FM.";

static int _dt_from_furnace(int p_value) {
	return FURNACE_TO_REGISTER[p_value & 7];
}

static int _dt_to_furnace(int p_value) {
	return (p_value & 7) >= 4 ? 7 - (p_value & 7) : (p_value & 7) + 3;
}

// clamp do JS: (value|0) entre 0 e max.
static int _clamp(int64_t p_value, int p_max) {
	return CLAMP(int(int32_t(p_value)), 0, p_max);
}

static bool _valid_utf8(const uint8_t *p_bytes, int p_length) {
	for (int i = 0; i < p_length;) {
		const uint8_t c = p_bytes[i];
		const int extra = c < 0x80 ? 0 : ((c & 0xe0) == 0xc0 ? 1 : ((c & 0xf0) == 0xe0 ? 2 : ((c & 0xf8) == 0xf0 ? 3 : -1)));
		if (extra < 0 || (extra == 1 && c < 0xc2) || i + extra >= p_length + (extra == 0 ? 1 : 0)) {
			return false;
		}
		for (int k = 1; k <= extra; k++) {
			if ((p_bytes[i + k] & 0xc0) != 0x80) {
				return false;
			}
		}
		i += extra + 1;
	}
	return true;
}

class _Reader {
	const Vector<uint8_t> &data;

	// O arquivo acabou antes do esperado: marca a falha e pula para o fim (os laços terminam).
	bool _need(int p_count) {
		if (at + p_count > data.size()) {
			failed = true;
			at = data.size();
			return false;
		}
		return true;
	}

public:
	int at = 0;
	bool failed = false;
	int length() const { return data.size(); }
	int u8() {
		if (!_need(1)) {
			return 0;
		}
		return data[at++];
	}
	int u16() {
		if (!_need(2)) {
			return 0;
		}
		const int value = data[at] | (data[at + 1] << 8);
		at += 2;
		return value;
	}
	int u16be() {
		if (!_need(2)) {
			return 0;
		}
		const int value = (data[at] << 8) | data[at + 1];
		at += 2;
		return value;
	}
	int32_t i32() {
		if (!_need(4)) {
			return 0;
		}
		const uint32_t value = uint32_t(data[at]) | (uint32_t(data[at + 1]) << 8) | (uint32_t(data[at + 2]) << 16) | (uint32_t(data[at + 3]) << 24);
		at += 4;
		return int32_t(value);
	}
	Vector<uint8_t> bytes(int p_count) {
		if (!_need(p_count)) {
			Vector<uint8_t> zeros;
			zeros.resize(MAX(p_count, 0));
			zeros.fill(0);
			return zeros;
		}
		Vector<uint8_t> result = data.slice(at, at + p_count);
		at += p_count;
		return result;
	}
	String ascii(int p_count) {
		if (!_need(p_count)) {
			return String();
		}
		String result;
		for (int i = 0; i < p_count; i++) {
			// NUL não entra numa String do Godot: vira ␀ (só se compara com assinaturas ASCII).
			result += data[at + i] ? char32_t(data[at + i]) : char32_t(0x2400);
		}
		at += p_count;
		return result;
	}
	// Nomes em UTF-8; arquivos antigos de tracker usam Latin-1.
	static String decode_name(const uint8_t *p_bytes, int p_length) {
		String text;
		if (_valid_utf8(p_bytes, p_length)) {
			text.append_utf8((const char *)p_bytes, p_length);
		} else {
			for (int i = 0; i < p_length; i++) {
				text += char32_t(p_bytes[i]);
			}
		}
		return text.strip_edges();
	}
	String text(int p_count) {
		if (!_need(p_count)) {
			return String();
		}
		int end = 0;
		while (end < p_count && data[at + end]) {
			end++;
		}
		const String result = decode_name(data.ptr() + at, end);
		at += p_count;
		return result;
	}
	String cstring() {
		const int start = at;
		while (at < data.size() && data[at]) {
			at++;
		}
		String value = decode_name(data.ptr() + start, at - start);
		if (at < data.size()) {
			at++;
		}
		return value.strip_edges();
	}

	explicit _Reader(const Vector<uint8_t> &p_data) :
			data(p_data) {}
};

// Nome que cabe no modelo (até 64 caracteres; vazio vira "Instrumento").
static String _clean_name(const String &p_name) {
	const String name = p_name.strip_edges().substr(0, 64).strip_edges();
	return name.is_empty() ? String("Instrumento") : name;
}

struct _FileOp {
	int64_t ar = 0, d1r = 0, d2r = 0, rr = 0, sl = 0, tl = 0, ks = 0, mul = 0, dt = 0, am = 0, ssg = 0;
};

static Dictionary _fm_instrument(const String &p_name, int64_t p_alg, int64_t p_fb, int64_t p_ams, int64_t p_pms, const _FileOp p_ops[4]) {
	Array ops;
	for (int i = 0; i < 4; i++) {
		ops.push_back(Dictionary());
	}
	for (int position = 0; position < 4; position++) {
		const _FileOp &op = p_ops[position];
		Dictionary entry;
		entry["ar"] = _clamp(op.ar, 31);
		entry["d1r"] = _clamp(op.d1r, 31);
		entry["d2r"] = _clamp(op.d2r, 31);
		entry["rr"] = _clamp(op.rr, 15);
		entry["sl"] = _clamp(op.sl, 15);
		entry["tl"] = _clamp(op.tl, 127);
		entry["ks"] = _clamp(op.ks, 3);
		entry["mul"] = _clamp(op.mul, 15);
		entry["dt"] = _clamp(op.dt, 7);
		entry["am"] = op.am ? 1 : 0;
		entry["ssg"] = _clamp(op.ssg, 15);
		ops[FILE_ORDER[position]] = entry;
	}
	Dictionary result;
	result["name"] = _clean_name(p_name);
	result["kind"] = "fm";
	result["alg"] = _clamp(p_alg, 7);
	result["fb"] = _clamp(p_fb, 7);
	result["ams"] = _clamp(p_ams, 3);
	result["pms"] = _clamp(p_pms, 7);
	result["ops"] = ops;
	return result;
}

// Registradores crus de um operador (OPNI/WOPN/FUI): DT/MUL, TL, RS/AR, AM/D1R, D2R, SL/RR, SSG-EG.
static _FileOp _raw_operator(const Vector<uint8_t> &p_raw, bool p_furnace_detune) {
	_FileOp op;
	const int dt_mul = p_raw[0], tl = p_raw[1], rs_ar = p_raw[2], am_dr = p_raw[3], d2r = p_raw[4], sl_rr = p_raw[5], ssg = p_raw[6];
	op.mul = dt_mul & 15;
	op.dt = p_furnace_detune ? _dt_from_furnace((dt_mul >> 4) & 7) : (dt_mul >> 4) & 7;
	op.tl = tl & 0x7f;
	op.ks = rs_ar >> 6;
	op.ar = rs_ar & 31;
	op.am = am_dr >> 7;
	op.d1r = am_dr & 31;
	op.d2r = d2r & 31;
	op.sl = sl_rr >> 4;
	op.rr = sl_rr & 15;
	op.ssg = ssg & 15;
	return op;
}

static Array _one(const Dictionary &p_instrument) {
	Array list;
	list.push_back(p_instrument);
	return list;
}

static Array _read_tfi(_Reader &r_input, const String &p_name, String &r_error) {
	if (r_input.length() != 42) {
		r_error = String::utf8("TFI tem 42 bytes; este tem ") + itos(r_input.length()) + ".";
		return Array();
	}
	const int alg = r_input.u8(), fb = r_input.u8();
	_FileOp ops[4];
	for (int i = 0; i < 4; i++) {
		_FileOp &op = ops[i];
		op.mul = r_input.u8();
		op.dt = _dt_from_furnace(r_input.u8());
		op.tl = r_input.u8();
		op.ks = r_input.u8();
		op.ar = r_input.u8();
		op.d1r = r_input.u8();
		op.d2r = r_input.u8();
		op.rr = r_input.u8();
		op.sl = r_input.u8();
		op.ssg = r_input.u8();
	}
	return _one(_fm_instrument(p_name, alg, fb, 0, 0, ops));
}

// Macro de volume do PSG (0..15, 15 = mais alto, um valor por quadro) → envelope aproximado.
static Dictionary _psg_from_volume_macro(const String &p_name, const Vector<int64_t> &p_values) {
	Dictionary envelope;
	if (p_values.is_empty()) {
		envelope["volume"] = 0;
		envelope["attack"] = 0;
		envelope["decay"] = 0;
		envelope["sustain"] = 0;
		envelope["release"] = 2;
	} else {
		Vector<int> levels;
		for (const int64_t value : p_values) {
			levels.push_back(15 - _clamp(value, 15));
		}
		int peak = 0;
		for (int i = 1; i < levels.size(); i++) {
			if (levels[i] < levels[peak]) {
				peak = i;
			}
		}
		const int volume = levels[peak], last = levels[levels.size() - 1];
		envelope["volume"] = volume;
		envelope["attack"] = MIN(255, peak);
		envelope["decay"] = MIN(255, levels.size() - 1 - peak);
		envelope["sustain"] = MAX(0, last - volume);
		envelope["release"] = 2;
	}
	Dictionary result;
	result["name"] = _clean_name(p_name);
	result["kind"] = "psg";
	result["envelope"] = envelope;
	return result;
}

static Array _read_dmp_psg(_Reader &r_input, const String &p_name, int p_version, int p_system, PackedStringArray &r_warnings, String &r_error) {
	if (p_system != 3 && p_system != 2) {
		r_error = String::utf8("DMP padrão de outro sistema.");
		return Array();
	}
	const int length = r_input.u8();
	Vector<int64_t> values;
	for (int i = 0; i < length; i++) {
		values.push_back(p_version > 5 ? int64_t(r_input.i32()) : int64_t(r_input.u8()));
	}
	r_warnings.push_back(String::utf8(PSG_WARNING));
	return _one(_psg_from_volume_macro(p_name, values));
}

static Array _read_dmp(_Reader &r_input, const String &p_name, PackedStringArray &r_warnings, String &r_error) {
	const int version = r_input.u8();
	if (version > 11) {
		r_error = String::utf8("DMP versão ") + itos(version) + String::utf8(" não suportada.");
		return Array();
	}
	int system = 2;
	// 2 = Genesis, 3 = SMS (PSG), 9 = Neo Geo: o FM do YM2610 é o mesmo OPN de 4 operadores do YM2612.
	if (version >= 11) {
		system = r_input.u8();
		if (system != 2 && system != 3 && system != 9) {
			r_error = system == 8 ? String::utf8("Este DMP é do YM2151 (arcade), um chip FM diferente do YM2612.") : String::utf8("Este DMP é de outro sistema (código ") + itos(system) + String::utf8("), não do Mega Drive.");
			return Array();
		}
	}
	const int mode = version > 1 ? r_input.u8() : 1;
	if (!mode) {
		return _read_dmp_psg(r_input, p_name, version, system, r_warnings, r_error);
	}
	if (system != 2 && system != 9) {
		r_error = String::utf8("DMP FM de outro sistema.");
		return Array();
	}
	if (version < 10) {
		int count;
		if (r_input.length() == 51 || r_input.length() == 49) {
			r_input.u8();
			count = 4;
		} else {
			count = r_input.u8() ? 4 : 2;
		}
		if (count != 4) {
			r_error = String::utf8("DMP de FM com 2 operadores (OPL) não é do YM2612.");
			return Array();
		}
	}
	const int pms = version > 1 ? r_input.u8() : 0;
	const int fb = r_input.u8(), alg = r_input.u8(), ams = r_input.u8();
	_FileOp ops[4];
	for (int i = 0; i < 4; i++) {
		_FileOp &op = ops[i];
		op.mul = r_input.u8();
		op.tl = r_input.u8();
		op.ar = r_input.u8();
		op.d1r = r_input.u8();
		op.sl = r_input.u8();
		op.rr = r_input.u8();
		op.am = r_input.u8();
		op.ks = r_input.u8();
		op.dt = _dt_from_furnace(r_input.u8() & 15);
		op.d2r = r_input.u8();
		op.ssg = r_input.u8();
	}
	return _one(_fm_instrument(p_name, alg, fb, ams, pms, ops));
}

// FUI de SN76489 (tipo 0): a macro de volume (recurso MA, código 0) vira o envelope.
static Array _read_fui_psg(_Reader &r_input, const String &p_name, PackedStringArray &r_warnings, String &r_error) {
	String title = p_name;
	Vector<int64_t> volume;
	while (r_input.at + 4 <= r_input.length()) {
		const String code = r_input.ascii(2);
		if (code == "EN") {
			break;
		}
		const int size = r_input.u16(), end = r_input.at + size;
		if (end > r_input.length()) {
			r_error = String::utf8("Instrumento do Furnace incompleto.");
			return Array();
		}
		if (code == "NA") {
			const String value = r_input.cstring();
			title = value.is_empty() ? p_name : value;
		} else if (code == "MA") {
			const int header = r_input.u16();
			while (r_input.at < end) {
				const int start = r_input.at, macro = r_input.u8();
				if (macro == 255) {
					break;
				}
				const int length = r_input.u8();
				r_input.u8();
				r_input.u8();
				r_input.u8();
				static const int WORD_SIZES[4] = { 1, 1, 2, 4 };
				const int flags = r_input.u8(), word_size = WORD_SIZES[flags >> 6];
				const bool is_signed = (flags >> 6) != 0;
				r_input.at = start + header;
				Vector<int64_t> values;
				for (int i = 0; i < length; i++) {
					const Vector<uint8_t> bytes = r_input.bytes(word_size);
					int64_t value = 0;
					for (int shift = 0; shift < word_size; shift++) {
						value += int64_t(bytes[shift]) << (8 * shift);
					}
					if (is_signed && value >= (int64_t(1) << (8 * word_size - 1))) {
						value -= int64_t(1) << (8 * word_size);
					}
					values.push_back(value);
				}
				// Só a macro de volume em sequência normal (ADSR/LFO do Furnace não têm equivalente direto).
				if (macro == 0 && ((flags >> 1) & 3) == 0) {
					volume = values;
				}
			}
		}
		r_input.at = end;
	}
	r_warnings.push_back(String::utf8(PSG_WARNING));
	return _one(_psg_from_volume_macro(title, volume));
}

struct _OpniRecord {
	String name;
	int fb_alg = 0;
	int lfo = 0;
	_FileOp ops[4];
};

static _OpniRecord _read_opni_record(_Reader &r_input, int p_version) {
	_OpniRecord record;
	record.name = r_input.text(32);
	r_input.bytes(3); // nota MIDI de deslocamento e tecla de percussão
	record.fb_alg = r_input.u8();
	record.lfo = r_input.u8();
	for (int i = 0; i < 4; i++) {
		record.ops[i] = _raw_operator(r_input.bytes(7), false);
	}
	if (p_version >= 2) {
		r_input.bytes(4); // atrasos de key-on/key-off do OPN2 Bank Editor
	}
	return record;
}

static Dictionary _opni_instrument(const _OpniRecord &p_record, const String &p_fallback) {
	return _fm_instrument(p_record.name.is_empty() ? p_fallback : p_record.name, p_record.fb_alg & 7, (p_record.fb_alg >> 3) & 7, (p_record.lfo >> 4) & 3, p_record.lfo & 7, p_record.ops);
}

static int _wopn_version(_Reader &r_input) {
	const int at = r_input.at, version = r_input.u16();
	if (version >= 2 && version <= 15) {
		return version;
	}
	r_input.at = at;
	return 1;
}

static Array _read_opni(_Reader &r_input, const String &p_name, String &r_error) {
	const String magic = r_input.text(11);
	if (magic != "WOPN2-INST" && magic != "WOPN2-IN2T") {
		r_error = String::utf8("Não é um arquivo OPNI.");
		return Array();
	}
	const int version = _wopn_version(r_input);
	r_input.u8(); // percussão
	return _one(_opni_instrument(_read_opni_record(r_input, version), p_name));
}

static Array _read_wopn(_Reader &r_input, const String &p_name, PackedStringArray &r_warnings, String &r_error) {
	const String magic = r_input.text(11);
	if (magic != "WOPN2-BANK" && magic != "WOPN2-B2NK") {
		r_error = String::utf8("Não é um banco WOPN.");
		return Array();
	}
	const int version = _wopn_version(r_input), melodic = r_input.u16be(), percussion = r_input.u16be();
	r_input.u8(); // LFO global do banco
	if (melodic + percussion > 64) {
		r_error = String::utf8("Banco WOPN com bancos demais.");
		return Array();
	}
	if (version >= 2) {
		r_input.bytes(34 * (melodic + percussion));
	}
	Array instruments;
	for (int bank = 0; bank < melodic + percussion; bank++) {
		for (int patch = 0; patch < 128; patch++) {
			const _OpniRecord record = _read_opni_record(r_input, version);
			// Patch vazio (tudo zero) fica de fora, como no Furnace.
			bool empty = record.name.is_empty() && !record.fb_alg && !record.lfo;
			for (int i = 0; empty && i < 4; i++) {
				const _FileOp &op = record.ops[i];
				empty = !op.mul && !op.dt && !op.tl && !op.ar && !op.d1r && !op.d2r && !op.sl && !op.rr && !op.ks && !op.am && !op.ssg;
			}
			if (empty) {
				continue;
			}
			instruments.push_back(_opni_instrument(record, (p_name.is_empty() ? String("WOPN") : p_name) + " " + (bank < melodic ? String() : String::utf8("percussão ")) + itos(patch + 1)));
		}
	}
	if (instruments.is_empty()) {
		r_warnings.push_back(String::utf8("O banco não tem instrumentos."));
	}
	return instruments;
}

// Formato antigo do Furnace (versão < 127, papers/oldIns.md): bloco INST com o instrumento inteiro.
static Array _read_old_fui(_Reader &r_input, const String &p_name, PackedStringArray &r_warnings, String &r_error) {
	if (r_input.ascii(12) != "nace instr.-") {
		r_error = String::utf8("Não é um instrumento do Furnace (.fui).");
		return Array();
	}
	r_input.u16();
	r_input.u16();
	const int pointer = r_input.u16() | (r_input.u16() << 16);
	r_input.at = pointer;
	if (r_input.ascii(4) != "INST") {
		r_error = String::utf8("Instrumento do Furnace (formato antigo) sem o bloco INST.");
		return Array();
	}
	r_input.u16();
	r_input.u16(); // tamanho do bloco
	const int version = r_input.u16(), type = r_input.u8();
	r_input.u8();
	if (type != 1 && type != 0) {
		r_error = String::utf8("Este instrumento do Furnace não é do Mega Drive (tipo ") + itos(type) + ").";
		return Array();
	}
	String title = r_input.cstring();
	if (title.is_empty()) {
		title = p_name;
	}
	// O instrumento inteiro vem gravado: FM sempre, mesmo num instrumento de PSG.
	const int alg = r_input.u8(), fb = r_input.u8(), pms = r_input.u8(), ams = r_input.u8();
	r_input.bytes(4); // nº de operadores (sempre 4 no OPN), preset OPLL, reservado
	_FileOp ops[4];
	for (int i = 0; i < 4; i++) {
		const Vector<uint8_t> raw = r_input.bytes(32);
		_FileOp &op = ops[i];
		op.am = raw[0];
		op.ar = raw[1];
		op.d1r = raw[2];
		op.mul = raw[3];
		op.rr = raw[4];
		op.sl = raw[5];
		op.tl = raw[6];
		op.ks = raw[8];
		op.dt = _dt_from_furnace(raw[9]);
		op.d2r = raw[10];
		op.ssg = raw[11];
	}
	if (type == 0) {
		// SN76489: pula Game Boy (4), C64 (24) e Amiga (16); macros: tamanhos, loops, 4 bytes, volume (int32).
		r_input.bytes(4 + 24 + 16);
		const int count = version >= 17 ? 8 : 4, volume_length = r_input.i32();
		r_input.bytes((count - 1) * 4 + count * 4 + 4);
		Vector<int64_t> values;
		for (int i = 0; i < MIN(MAX(volume_length, 0), 256); i++) {
			values.push_back(r_input.i32());
		}
		r_warnings.push_back(String::utf8(PSG_WARNING));
		return _one(_psg_from_volume_macro(title, values));
	}
	r_warnings.push_back(String::utf8(MACRO_WARNING));
	return _one(_fm_instrument(title, alg, fb, ams, pms, ops));
}

static Array _read_fui(_Reader &r_input, const String &p_name, PackedStringArray &r_warnings, String &r_error) {
	const String magic = r_input.ascii(4);
	if (magic == "-Fur") {
		return _read_old_fui(r_input, p_name, r_warnings, r_error);
	}
	if (magic != "FINS") {
		r_error = String::utf8("Não é um instrumento do Furnace (.fui).");
		return Array();
	}
	const int version = r_input.u16(), type = r_input.u16();
	if (type == 0) {
		return _read_fui_psg(r_input, p_name, r_warnings, r_error);
	}
	if (type != 1) {
		r_error = String::utf8("Este instrumento do Furnace não é do Mega Drive (tipo ") + itos(type) + ").";
		return Array();
	}
	String title = p_name;
	bool has_fm = false;
	int alg = 0, fb = 0, ams = 0, pms = 0;
	_FileOp ops[4];
	while (r_input.at + 4 <= r_input.length()) {
		const String code = r_input.ascii(2);
		if (code == "EN") {
			break;
		}
		const int size = r_input.u16(), end = r_input.at + size;
		if (end > r_input.length()) {
			r_error = String::utf8("Instrumento do Furnace incompleto.");
			return Array();
		}
		if (code == "NA") {
			const String value = r_input.cstring();
			title = value.is_empty() ? p_name : value;
		} else if (code == "FM") {
			const int flags = r_input.u8(), count = flags & 15;
			const int alg_fb = r_input.u8(), lfo = r_input.u8();
			r_input.u8();
			if (version >= 224) {
				r_input.u8();
			}
			if (count != 4) {
				r_error = String::utf8("Instrumento FM do Furnace com ") + itos(count) + String::utf8(" operadores; o YM2612 usa 4.");
				return Array();
			}
			for (int i = 0; i < 4; i++) {
				ops[i] = _raw_operator(r_input.bytes(7), true);
				r_input.u8();
			}
			alg = (alg_fb >> 4) & 7;
			fb = alg_fb & 7;
			ams = (lfo >> 3) & 3;
			pms = lfo & 7;
			has_fm = true;
		}
		r_input.at = end;
	}
	if (!has_fm) {
		r_error = String::utf8("O instrumento do Furnace não tem dados FM.");
		return Array();
	}
	r_warnings.push_back(String::utf8(MACRO_WARNING));
	return _one(_fm_instrument(title, alg, fb, ams, pms, ops));
}

Array RetroInstrumentFormats::import_file(const String &p_file_name, const Vector<uint8_t> &p_bytes, PackedStringArray &r_warnings, String &r_error) {
	r_error = String();
	const String base = p_file_name.replace("\\", "/").get_file();
	const int dot = base.rfind(".");
	const String name = (dot > 0 ? base.substr(0, dot) : (dot == 0 ? String() : base)).substr(0, 64);
	const String extension = dot >= 0 ? base.substr(dot).to_lower() : String();
	String head;
	for (int i = 0; i < MIN(10, p_bytes.size()); i++) {
		head += p_bytes[i] ? char32_t(p_bytes[i]) : char32_t(0x2400);
	}
	_Reader input(p_bytes);
	Array result;
	bool known = true;
	if (head == "WOPN2-INST" || head == "WOPN2-IN2T") {
		result = _read_opni(input, name, r_error);
	} else if (head == "WOPN2-BANK" || head == "WOPN2-B2NK") {
		result = _read_wopn(input, name, r_warnings, r_error);
	} else if (head.begins_with("FINS") || head.begins_with("-Fur") || extension == ".fui") {
		result = _read_fui(input, name, r_warnings, r_error);
	} else if (extension == ".tfi") {
		result = _read_tfi(input, name, r_error);
	} else if (extension == ".dmp") {
		result = _read_dmp(input, name, r_warnings, r_error);
	} else {
		known = false;
	}
	if (known) {
		if (input.failed && r_error.is_empty()) {
			r_error = String::utf8("Arquivo de instrumento incompleto.");
		}
		if (!r_error.is_empty()) {
			r_warnings.clear();
			return Array();
		}
		return result;
	}
	r_error = String::utf8("Formato de instrumento não reconhecido. Use .tfi, .dmp, .fui, .opni, .wopn.");
	return Array();
}

Vector<uint8_t> RetroInstrumentFormats::export_instrument(const RetroInstrument &p_instrument, const String &p_format, String &r_error) {
	Vector<uint8_t> out;
	if (p_instrument.kind != "fm") {
		r_error = String::utf8("Só instrumentos FM são exportados para formatos de tracker.");
		return out;
	}
	const RetroInstrument::Op *ops[4];
	for (int i = 0; i < 4; i++) {
		ops[i] = &p_instrument.ops[FILE_ORDER[i]];
	}
	auto push_text = [&](const char *p_text) {
		for (const char *c = p_text; *c; c++) {
			out.push_back(uint8_t(*c));
		}
	};
	const RetroInstrument &in = p_instrument;
	if (p_format == "tfi") {
		out.push_back(in.alg);
		out.push_back(in.fb);
		for (const RetroInstrument::Op *op : ops) {
			for (const int value : { op->mul, _dt_to_furnace(op->dt), op->tl, op->ks, op->ar, op->d1r, op->d2r, op->rr, op->sl, op->ssg }) {
				out.push_back(value);
			}
		}
	} else if (p_format == "dmp") {
		for (const int value : { 11, 2, 1, in.pms, in.fb, in.alg, in.ams }) {
			out.push_back(value);
		}
		for (const RetroInstrument::Op *op : ops) {
			for (const int value : { op->mul, op->tl, op->ar, op->d1r, op->sl, op->rr, op->am, op->ks, _dt_to_furnace(op->dt), op->d2r, op->ssg }) {
				out.push_back(value);
			}
		}
	} else if (p_format == "opni") {
		push_text("WOPN2-INST");
		for (const int value : { 0, 2, 0, 0 }) {
			out.push_back(value);
		}
		// Até 31 bytes sem partir um caractere UTF-8 no meio.
		String text = in.name;
		CharString title = text.utf8();
		while (title.length() > 31) {
			text = text.substr(0, text.length() - 1);
			title = text.utf8();
		}
		for (int i = 0; i < title.length(); i++) {
			out.push_back(uint8_t(title[i]));
		}
		for (int i = title.length(); i < 32; i++) {
			out.push_back(0);
		}
		for (const int value : { 0, 0, 0, (in.fb << 3) | in.alg, (in.ams << 4) | in.pms }) {
			out.push_back(value);
		}
		for (const RetroInstrument::Op *op : ops) {
			for (const int value : { (op->dt << 4) | op->mul, op->tl, (op->ks << 6) | op->ar, (op->am << 7) | op->d1r, op->d2r, (op->sl << 4) | op->rr, op->ssg }) {
				out.push_back(value);
			}
		}
		for (int i = 0; i < 4; i++) {
			out.push_back(0);
		}
	} else if (p_format == "fui") {
		Vector<uint8_t> title;
		const CharString name = in.name.substr(0, 64).utf8();
		for (int i = 0; i < name.length(); i++) {
			title.push_back(uint8_t(name[i]));
		}
		title.push_back(0);
		Vector<uint8_t> fm;
		for (const int value : { 0xf4, (in.alg << 4) | in.fb, (in.ams << 3) | in.pms, 0, 0 }) {
			fm.push_back(value);
		}
		for (const RetroInstrument::Op *op : ops) {
			for (const int value : { (_dt_to_furnace(op->dt) << 4) | op->mul, op->tl, (op->ks << 6) | op->ar, (op->am << 7) | op->d1r, op->d2r, (op->sl << 4) | op->rr, op->ssg, 0 }) {
				fm.push_back(value);
			}
		}
		auto feature = [&](const char *p_code, const Vector<uint8_t> &p_data) {
			out.push_back(p_code[0]);
			out.push_back(p_code[1]);
			out.push_back(p_data.size() & 0xff);
			out.push_back((p_data.size() >> 8) & 0xff);
			out.append_array(p_data);
		};
		push_text("FINS");
		for (const int value : { 224, 0, 1, 0 }) {
			out.push_back(value);
		}
		feature("NA", title);
		feature("FM", fm);
		push_text("EN");
	} else {
		r_error = String::utf8("Formato de exportação desconhecido: ") + p_format;
	}
	return out;
}

String RetroInstrumentFormats::instrument_id_for(const String &p_name, const PackedStringArray &p_taken) {
	HashSet<String> used;
	for (const RetroInstrument &preset : RetroChipInstruments::presets()) {
		used.insert(preset.id);
	}
	for (const String &id : p_taken) {
		used.insert(id);
	}
	// NFD sem acentos, minúsculas, o resto vira "-".
	const String source = p_name.is_empty() ? String("instrumento") : p_name;
	static const char32_t *FROM = U"àáâãäåèéêëìíîïòóôõöùúûüçñýÿÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑÝ";
	static const char *TO = "aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY";
	String plain;
	for (int i = 0; i < source.length(); i++) {
		char32_t c = source[i];
		for (int k = 0; FROM[k]; k++) {
			if (FROM[k] == c) {
				c = TO[k];
				break;
			}
		}
		plain += c;
	}
	plain = plain.to_lower();
	String slug;
	bool dash = false;
	for (int i = 0; i < plain.length(); i++) {
		const char32_t c = plain[i];
		if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			slug += c;
			dash = false;
		} else if (!dash) {
			slug += '-';
			dash = true;
		}
	}
	while (slug.begins_with("-")) {
		slug = slug.substr(1);
	}
	while (slug.ends_with("-")) {
		slug = slug.substr(0, slug.length() - 1);
	}
	String base = ("meu-" + slug).substr(0, 40);
	while (base.ends_with("-")) {
		base = base.substr(0, base.length() - 1);
	}
	if (base.is_empty()) {
		base = "meu-instrumento";
	}
	String id = base;
	int index = 2;
	while (used.has(id)) {
		id = base + "-" + itos(index++);
	}
	return id;
}

RetroInstrument RetroInstrumentFormats::song_instrument(const Dictionary &p_source, const PackedStringArray &p_taken, String &r_error, const String &p_category) {
	Dictionary data = p_source.duplicate(true);
	data.erase("id");
	data.erase("category");
	const String name = p_source.get("name", "");
	data["id"] = instrument_id_for(name, p_taken);
	const String clean = name.substr(0, 64);
	data["name"] = clean.is_empty() ? String("Instrumento") : clean;
	data["category"] = p_category;
	return RetroInstrument::from_dictionary(data, r_error);
}
