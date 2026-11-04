#include "retro_song_authoring.h"

#include "core/io/json.h"
#include "core/templates/hash_set.h"

static const int STEPS[7] = { 9, 11, 0, 2, 4, 5, 7 }; // A..G

static String U8(const char *p_text) {
	return String::utf8(p_text);
}

static bool _is_number(const Variant &p_value) {
	return p_value.get_type() == Variant::INT || p_value.get_type() == Variant::FLOAT;
}

static bool _is_integer(const Variant &p_value) {
	if (!_is_number(p_value)) {
		return false;
	}
	const double value = p_value;
	return Math::is_finite(value) && value == Math::floor(value);
}

// Número inteiro vira int no JSON (sem ".0"); o resto fica como está.
static Variant _number(double p_value) {
	return p_value == Math::floor(p_value) && Math::abs(p_value) < 9007199254740992.0 ? Variant(int64_t(p_value)) : Variant(p_value);
}

static int _js_round(double p_value) {
	return int(Math::floor(p_value + 0.5));
}

int RetroSongAuthoring::parse_note(const Variant &p_value, String &r_error) {
	if (_is_integer(p_value) && double(p_value) >= 0 && double(p_value) <= 127) {
		return int(double(p_value));
	}
	const String bad = U8("Nota inválida: ") + JSON::stringify(p_value) + U8(" (use \"C4\", \"F#3\", \"Bb2\" ou 0..127).");
	if (p_value.get_type() != Variant::STRING) {
		r_error = bad;
		return -1;
	}
	const String text = String(p_value).strip_edges();
	int index = 0;
	if (text.is_empty()) {
		r_error = bad;
		return -1;
	}
	const char32_t letter = text[index++];
	const char32_t upper = letter >= 'a' && letter <= 'g' ? letter - 32 : letter;
	if (upper < 'A' || upper > 'G') {
		r_error = bad;
		return -1;
	}
	int accidental = 0;
	if (index < text.length() && (text[index] == '#' || text[index] == U'♯')) {
		accidental = 1;
		index++;
	} else if (index < text.length() && (text[index] == 'b' || text[index] == U'♭')) {
		accidental = -1;
		index++;
	}
	bool negative = false;
	if (index < text.length() && text[index] == '-') {
		negative = true;
		index++;
	}
	if (index != text.length() - 1 || text[index] < '0' || text[index] > '9') {
		r_error = bad;
		return -1;
	}
	const int octave = (negative ? -1 : 1) * int(text[index] - '0');
	const int note = (octave + 1) * 12 + STEPS[upper - 'A'] + accidental;
	if (note < 0 || note > 127) {
		r_error = U8("Nota fora do MIDI (0..127): ") + text;
		return -1;
	}
	return note;
}

RetroSong RetroSongAuthoring::from_authoring(const Variant &p_input, String &r_error) {
	r_error = String();
	if (p_input.get_type() != Variant::DICTIONARY) {
		r_error = U8("A música deve ser um objeto.");
		return RetroSong();
	}
	const Dictionary input = p_input;
	auto value_or = [&](const char *p_key, const Variant &p_default) {
		const Variant value = input.get(p_key, Variant());
		return value.get_type() == Variant::NIL ? p_default : value;
	};
	const Variant beats_per_bar = value_or("beatsPerBar", 4);
	const Variant tracks_value = input.get("tracks", Variant());
	if (tracks_value.get_type() != Variant::ARRAY || Array(tracks_value).is_empty()) {
		r_error = U8("A música precisa de pelo menos uma faixa em \"tracks\".");
		return RetroSong();
	}
	int64_t last = 0;
	HashSet<String> used;
	Array tracks;
	const Array input_tracks = tracks_value;
	for (int index = 0; index < input_tracks.size(); index++) {
		const Variant track_value = input_tracks[index];
		const Dictionary track = track_value.get_type() == Variant::DICTIONARY ? Dictionary(track_value) : Dictionary();
		const String track_name = track.get("name", Variant()).get_type() == Variant::NIL ? String() : String(track.get("name", ""));
		const String where = U8("faixa ") + itos(index + 1) + (track_name.is_empty() ? String() : " (\"" + track_name + "\")");
		if (track_value.get_type() != Variant::DICTIONARY) {
			r_error = where + U8(": inválida.");
			return RetroSong();
		}
		String id = track.get("id", Variant()).get_type() == Variant::STRING && !String(track["id"]).is_empty() ? String(track["id"]) : "faixa-" + itos(index + 1);
		// Minúsculas; o que não for letra, número ou "-" vira um "-".
		String clean;
		bool run = false;
		const String lower = id.to_lower();
		for (int i = 0; i < lower.length(); i++) {
			const char32_t c = lower[i];
			if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
				clean += c;
				run = false;
			} else if (!run) {
				clean += '-';
				run = true;
			}
		}
		while (clean.begins_with("-")) {
			clean = clean.substr(1);
		}
		id = clean.substr(0, 32);
		if (id.is_empty()) {
			id = "faixa-" + itos(index + 1);
		}
		while (used.has(id)) {
			id = id.substr(0, 28) + "-" + itos(index + 1);
		}
		used.insert(id);
		const Variant notes_value = track.get("notes", Variant());
		if (notes_value.get_type() != Variant::ARRAY) {
			r_error = where + U8(": \"notes\" deve ser uma lista.");
			return RetroSong();
		}
		Array notes;
		const Array input_notes = notes_value;
		for (int position = 0; position < input_notes.size(); position++) {
			const String at = where + U8(", nota ") + itos(position + 1);
			if (input_notes[position].get_type() != Variant::DICTIONARY) {
				r_error = at + U8(": inválida.");
				return RetroSong();
			}
			const Dictionary note = input_notes[position];
			Variant t, d, n, v;
			if (note.has("at") || note.has("len") || note.has("note")) {
				const Variant start = note.get("at", Variant()), length = note.get("len", Variant());
				if (!_is_number(start) || double(start) < 0 || !Math::is_finite(double(start))) {
					r_error = at + U8(": \"at\" (em tempos, a partir de 0) é obrigatório.");
					return RetroSong();
				}
				if (!_is_number(length) || double(length) <= 0 || !Math::is_finite(double(length))) {
					r_error = at + U8(": \"len\" (duração em tempos, > 0) é obrigatório.");
					return RetroSong();
				}
				t = _js_round(double(start) * SONG_PPQ);
				d = MAX(1, _js_round(double(length) * SONG_PPQ));
				String problem;
				const int pitch = parse_note(note.get("note", Variant()), problem);
				if (!problem.is_empty()) {
					r_error = at + ": " + problem;
					return RetroSong();
				}
				n = pitch;
				v = note.get("vel", Variant()).get_type() == Variant::NIL ? Variant(100) : note["vel"];
			} else {
				t = note.get("t", Variant());
				d = note.get("d", Variant());
				n = note.get("n", Variant());
				v = note.get("v", Variant()).get_type() == Variant::NIL ? Variant(100) : note["v"];
			}
			if (!_is_integer(v) || double(v) < 1 || double(v) > 127) {
				r_error = at + U8(": \"vel\" deve ser inteiro de 1 a 127.");
				return RetroSong();
			}
			if (!_is_integer(t) || !_is_integer(d) || !_is_integer(n)) {
				r_error = at + U8(": posição, duração e nota precisam ser inteiras.");
				return RetroSong();
			}
			last = MAX(last, int64_t(double(t)) + int64_t(double(d)));
			Dictionary entry;
			entry["t"] = int64_t(double(t));
			entry["d"] = int64_t(double(d));
			entry["n"] = int64_t(double(n));
			entry["v"] = int64_t(double(v));
			notes.push_back(entry);
		}
		Dictionary entry;
		entry["id"] = id;
		const Variant raw_name = track.get("name", Variant());
		const bool empty_name = raw_name.get_type() == Variant::NIL || (raw_name.get_type() == Variant::STRING && String(raw_name).is_empty()) || (raw_name.get_type() == Variant::BOOL && !bool(raw_name));
		entry["name"] = (empty_name ? "Faixa " + itos(index + 1) : String(raw_name)).substr(0, 64);
		entry["instrument"] = track.get("instrument", Variant());
		entry["mute"] = track.get("mute", false).booleanize();
		entry["solo"] = track.get("solo", false).booleanize();
		entry["notes"] = notes;
		tracks.push_back(entry);
	}
	const double bar_ticks = double(beats_per_bar) * SONG_PPQ;
	const Variant bars = value_or("bars", int64_t(MAX(1.0, Math::ceil(double(last) / bar_ticks))));
	Variant loop;
	const Variant input_loop = input.get("loop", Variant());
	const bool has_loop_key = input.has("loop");
	if ((input_loop.get_type() == Variant::BOOL && bool(input_loop)) || !has_loop_key) {
		Dictionary range;
		range["start"] = 0;
		range["end"] = _number(double(bars) * bar_ticks);
		loop = range;
	} else if (input_loop.get_type() == Variant::DICTIONARY) {
		const Dictionary range_in = input_loop;
		const Variant start = range_in.get("start", Variant()).get_type() == Variant::NIL ? Variant(1) : range_in["start"];
		const Variant end = range_in.get("end", Variant()).get_type() == Variant::NIL ? bars : range_in["end"];
		if (!_is_integer(start) || !_is_integer(end) || double(start) < 1 || double(end) < double(start) || double(end) > double(bars)) {
			r_error = U8("Loop inválido: use {start, end} em compassos de 1 a ") + JSON::stringify(bars) + ".";
			return RetroSong();
		}
		Dictionary range;
		range["start"] = _number((double(start) - 1) * bar_ticks);
		range["end"] = _number(double(end) * bar_ticks);
		loop = range;
	}
	Dictionary song;
	song["format"] = "retro-studio.song";
	song["version"] = 1;
	song["id"] = value_or("id", "musica_1");
	song["name"] = value_or("name", U8("Nova música"));
	song["tempo"] = value_or("tempo", 120);
	song["beatsPerBar"] = beats_per_bar;
	song["bars"] = bars;
	song["loop"] = loop;
	song["fmChannels"] = value_or("fmChannels", 6);
	const Variant instruments = input.get("instruments", Variant());
	song["instruments"] = instruments.get_type() == Variant::ARRAY ? instruments : Variant(Array());
	song["tracks"] = tracks;
	// Instrumentos: da música (pelo ID) ou do banco.
	HashSet<String> known;
	for (const RetroInstrument &preset : RetroChipInstruments::presets()) {
		known.insert(preset.id);
	}
	if (instruments.get_type() == Variant::ARRAY) {
		for (const Variant &item : Array(instruments)) {
			if (item.get_type() == Variant::DICTIONARY) {
				known.insert(String(Dictionary(item).get("id", "")));
			}
		}
	}
	for (const Variant &value : tracks) {
		const Dictionary track = value;
		const Variant instrument = track["instrument"];
		if (instrument.get_type() != Variant::STRING || !known.has(instrument)) {
			r_error = U8("Instrumento desconhecido na faixa \"") + String(track["name"]) + "\": " + (instrument.get_type() == Variant::NIL ? String("undefined") : JSON::stringify(instrument)) + U8(". Veja a lista em music_guide.");
			return RetroSong();
		}
	}
	RetroSong result = RetroSong::from_dictionary(song, r_error);
	if (!r_error.is_empty()) {
		return RetroSong();
	}
	result.normalize();
	result = RetroSong::from_json(result.to_json(), r_error);
	return r_error.is_empty() ? result : RetroSong();
}

Dictionary RetroSongAuthoring::to_authoring(const RetroSong &p_song) {
	auto beat = [](int p_tick) { return _number(Math::round(double(p_tick) / SONG_PPQ * 1000) / 1000); };
	const double bar_ticks = p_song.beats_per_bar * SONG_PPQ;
	Dictionary result;
	result["id"] = p_song.id;
	result["name"] = p_song.name;
	result["tempo"] = p_song.tempo;
	result["beatsPerBar"] = p_song.beats_per_bar;
	result["bars"] = p_song.bars;
	if (p_song.has_loop) {
		Dictionary loop;
		loop["start"] = _number(p_song.loop_start / bar_ticks + 1);
		loop["end"] = _number(p_song.loop_end / bar_ticks);
		result["loop"] = loop;
	} else {
		result["loop"] = false;
	}
	result["fmChannels"] = p_song.fm_channels;
	Array instruments;
	for (const RetroInstrument &instrument : p_song.instruments) {
		instruments.push_back(instrument.to_dictionary());
	}
	result["instruments"] = instruments;
	Array tracks;
	for (const RetroSongTrack &track : p_song.tracks) {
		Dictionary entry;
		entry["id"] = track.id;
		entry["name"] = track.name;
		entry["instrument"] = track.instrument;
		entry["mute"] = track.mute;
		entry["solo"] = track.solo;
		Array notes;
		for (const RetroSongNote &note : track.notes) {
			Dictionary item;
			item["at"] = beat(note.t);
			item["len"] = beat(note.d);
			item["note"] = retro_note_name(note.n);
			item["vel"] = note.v;
			notes.push_back(item);
		}
		entry["notes"] = notes;
		tracks.push_back(entry);
	}
	result["tracks"] = tracks;
	return result;
}

Dictionary RetroSongAuthoring::analyze(const RetroSong &p_song) {
	struct Event {
		int tick;
		int delta;
		int resource; // 0 fm, 1 psg, 2 ruído
	};
	PackedStringArray warnings;
	const int fm_limit = p_song.fm_channels == 5 ? 5 : 6;
	Vector<Event> events;
	PackedStringArray missing;
	int psg_low = 0;
	for (const RetroSongTrack &track : p_song.tracks) {
		const RetroInstrument *instrument = p_song.resolve_instrument(track.instrument);
		if (!instrument) {
			if (!missing.has(track.instrument)) {
				missing.push_back(track.instrument);
			}
			continue;
		}
		const int resource = instrument->kind == "fm" ? 0 : (instrument->kind == "psg" ? 1 : 2);
		for (const RetroSongNote &note : track.notes) {
			events.push_back({ note.t, 1, resource });
			events.push_back({ note.t + note.d, -1, resource });
			if (instrument->kind == "noise" && instrument->rate == 3) {
				events.push_back({ note.t, 1, 1 });
				events.push_back({ note.t + note.d, -1, 1 });
			}
			if (resource == 1 && note.n < 45) {
				psg_low++;
			}
		}
	}
	// Ordem estável por tempo e depois soltura antes de ataque (como o sort do JS).
	for (int i = 1; i < events.size(); i++) {
		const Event item = events[i];
		int j = i - 1;
		while (j >= 0 && (events[j].tick > item.tick || (events[j].tick == item.tick && events[j].delta > item.delta))) {
			events.write[j + 1] = events[j];
			j--;
		}
		events.write[j + 1] = item;
	}
	int now[3] = {}, peak[3] = {}, over[3] = {};
	const int limit[3] = { fm_limit, 3, 1 };
	for (const Event &event : events) {
		now[event.resource] += event.delta;
		peak[event.resource] = MAX(peak[event.resource], now[event.resource]);
		if (event.delta > 0 && now[event.resource] > limit[event.resource]) {
			over[event.resource]++;
		}
	}
	if (!missing.is_empty()) {
		warnings.push_back(U8("Instrumentos que não existem: ") + String(", ").join(missing) + ".");
	}
	if (over[0]) {
		warnings.push_back(itos(over[0]) + U8(" nota(s) FM começam com mais de ") + itos(fm_limit) + U8(" vozes FM soando: a mais antiga é cortada."));
	}
	if (over[1]) {
		warnings.push_back(itos(over[1]) + U8(" nota(s) de PSG começam com mais de 3 vozes de onda quadrada: a mais antiga é cortada."));
	}
	if (over[2]) {
		warnings.push_back(itos(over[2]) + U8(" toque(s) de ruído se sobrepõem: o PSG tem um canal de ruído só, o novo corta o anterior (normal em bateria)."));
	}
	if (psg_low) {
		warnings.push_back(itos(psg_low) + U8(" nota(s) de PSG abaixo de A2 (~110 Hz): o PSG não chega lá e toca uma oitava acima."));
	}
	const double bar_ticks = p_song.beats_per_bar * SONG_PPQ;
	Dictionary result;
	result["seconds"] = _number(Math::round(p_song.tick_seconds(p_song.length()) * 100) / 100);
	result["bars"] = p_song.bars;
	result["tempo"] = p_song.tempo;
	if (p_song.has_loop) {
		Dictionary loop;
		loop["startBar"] = _number(p_song.loop_start / bar_ticks + 1);
		loop["endBar"] = _number(p_song.loop_end / bar_ticks);
		result["loop"] = loop;
	} else {
		result["loop"] = Variant();
	}
	Array tracks;
	for (const RetroSongTrack &track : p_song.tracks) {
		Dictionary entry;
		entry["id"] = track.id;
		entry["name"] = track.name;
		entry["instrument"] = track.instrument;
		entry["notes"] = track.notes.size();
		tracks.push_back(entry);
	}
	result["tracks"] = tracks;
	Dictionary voices;
	const char *names[3] = { "fm", "psg", "noise" };
	for (int i = 0; i < 3; i++) {
		Dictionary voice;
		voice["peak"] = peak[i];
		voice["limit"] = limit[i];
		voices[names[i]] = voice;
	}
	result["voices"] = voices;
	result["warnings"] = warnings;
	return result;
}

static Dictionary _note(double p_at, double p_len, const char *p_note, int p_vel = 0) {
	Dictionary note;
	note["at"] = _number(p_at);
	note["len"] = _number(p_len);
	note["note"] = p_note;
	if (p_vel) {
		note["vel"] = p_vel;
	}
	return note;
}

Dictionary RetroSongAuthoring::guide() {
	Dictionary guide;
	guide["formato"] = U8("Música em tempos: { id, name, tempo (BPM 30-300), beatsPerBar (padrão 4), bars (opcional), loop (true = música toda, false, ou {start, end} em compassos a partir de 1), fmChannels (6, ou 5 para deixar o FM 6 para efeitos PCM), instruments (opcional: instrumentos próprios), tracks: [{ name, instrument (ID), notes: [{ at, len, note, vel }] }] }.");
	guide["notas"] = U8("at = início em tempos (semínimas) a partir de 0; len = duração em tempos (0.5 = colcheia, 0.25 = semicolcheia); note = \"C4\" (dó central = 60), \"F#3\", \"Bb2\" ou 0..127; vel = 1..127 (padrão 100).");
	guide["chip"] = U8("YM2612: até 6 notas FM ao mesmo tempo (5 com fmChannels 5). PSG: 3 notas de onda quadrada (só de A2 para cima) e 1 de ruído. Acima do limite, a nota mais antiga é cortada. Cada faixa usa um instrumento; acordes numa faixa FM gastam uma voz FM por nota.");
	guide["bateria"] = U8("Use uma faixa por peça: bumbo (FM, notas graves ~C2-C3), tom (FM), caixa/chimbal/chimbal-aberto/prato/palmas (ruído do PSG; a altura da nota quase não importa; um ruído por vez).");
	guide["dicas"] = U8("Baixos soam bem entre E1 e E3; leads entre C4 e C6; acordes de cordas/pad com 3 notas. Deixe o ruído para a bateria. Confira music_write.analysis.warnings e ajuste.");
	Dictionary example;
	example["id"] = "tema_exemplo";
	example["name"] = "Tema de exemplo";
	example["tempo"] = 120;
	example["loop"] = true;
	Array tracks;
	auto track = [&](const char *p_name, const char *p_instrument, const Array &p_notes) {
		Dictionary entry;
		entry["name"] = p_name;
		entry["instrument"] = p_instrument;
		entry["notes"] = p_notes;
		tracks.push_back(entry);
	};
	Array bass, melody, kick;
	bass.push_back(_note(0, 0.5, "A1"));
	bass.push_back(_note(0.5, 0.5, "A2"));
	melody.push_back(_note(0, 1, "E5", 110));
	kick.push_back(_note(0, 0.25, "C2"));
	track("Baixo", "baixo-slap", bass);
	track("Melodia", "lead-quadrado", melody);
	track("Bumbo", "bumbo", kick);
	example["tracks"] = tracks;
	guide["exemplo"] = example;
	Dictionary limits;
	limits["faixas"] = SONG_MAX_TRACKS;
	limits["compassos"] = SONG_MAX_BARS;
	limits["instrumentosProprios"] = SONG_MAX_INSTRUMENTS;
	guide["limites"] = limits;
	Array categories;
	for (const char *category : RetroChipInstruments::CATEGORIES) {
		categories.push_back(U8(category));
	}
	guide["categorias"] = categories;
	Array instruments;
	for (const RetroInstrument &preset : RetroChipInstruments::presets()) {
		Dictionary item;
		item["id"] = preset.id;
		item["name"] = preset.name;
		item["kind"] = preset.kind;
		item["category"] = preset.category;
		instruments.push_back(item);
	}
	guide["instrumentos"] = instruments;
	return guide;
}
