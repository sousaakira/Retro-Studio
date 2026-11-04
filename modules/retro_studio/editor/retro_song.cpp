#include "retro_song.h"


#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/math/math_funcs.h"
#include "core/templates/hash_set.h"
#include "core/os/os.h"

static constexpr const char *SONG_FORMAT = "retro-studio.song";
static constexpr const char *MUSIC_FOLDER = "music";
static constexpr const char *MUSIC_RECORD = ".retro-studio/music-export.json";
static constexpr int64_t SONG_SIZE_LIMIT = 4 * 1024 * 1024;

const RetroSongGrid SONG_GRIDS[6] = { { 48, "1/4" }, { 24, "1/8" }, { 16, "1/8 tercina" }, { 12, "1/16" }, { 8, "1/16 tercina" }, { 6, "1/32" } };

static const char *NOTE_NAMES[12] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };

String retro_note_name(int p_note) {
	return String(NOTE_NAMES[((p_note % 12) + 12) % 12]) + itos(int(Math::floor(p_note / 12.0)) - 1);
}

// Math.round do JS (metade para cima).
static int _js_round(double p_value) {
	return int(Math::floor(p_value + 0.5));
}

int retro_snap_tick(double p_tick, int p_grid) {
	return MAX(0, _js_round(p_tick / p_grid) * p_grid);
}

int retro_snap_length(double p_length, int p_grid) {
	return MAX(p_grid, _js_round(p_length / p_grid) * p_grid);
}

int RetroSong::tick_frame(double p_tick) const {
	return _js_round(p_tick * SONG_FPS * 60.0 / (tempo * SONG_PPQ));
}

const RetroInstrument *RetroSong::resolve_instrument(const String &p_id) const {
	for (const RetroInstrument &instrument : instruments) {
		if (instrument.id == p_id) {
			return &instrument;
		}
	}
	for (const RetroInstrument &instrument : RetroChipInstruments::presets()) {
		if (instrument.id == p_id) {
			return &instrument;
		}
	}
	return nullptr;
}

RetroSong RetroSong::create(const String &p_id, const String &p_name, const String &p_instrument) {
	RetroSong song;
	song.id = p_id;
	song.name = p_name;
	RetroSongTrack track;
	track.id = "faixa-1";
	track.name = "Faixa 1";
	track.instrument = p_instrument;
	song.tracks.push_back(track);
	return song;
}

Dictionary RetroSong::to_dictionary() const {
	Dictionary data;
	data["format"] = SONG_FORMAT;
	data["version"] = 1;
	data["id"] = id;
	data["name"] = name;
	data["tempo"] = tempo;
	data["beatsPerBar"] = beats_per_bar;
	data["bars"] = bars;
	if (has_loop) {
		Dictionary loop;
		loop["start"] = loop_start;
		loop["end"] = loop_end;
		data["loop"] = loop;
	} else {
		data["loop"] = Variant();
	}
	data["fmChannels"] = fm_channels;
	if (has_instruments || !instruments.is_empty()) {
		Array list;
		for (const RetroInstrument &instrument : instruments) {
			list.push_back(instrument.to_dictionary());
		}
		data["instruments"] = list;
	}
	Array list;
	for (const RetroSongTrack &track : tracks) {
		Dictionary entry;
		entry["id"] = track.id;
		entry["name"] = track.name;
		entry["instrument"] = track.instrument;
		entry["mute"] = track.mute;
		entry["solo"] = track.solo;
		Array notes;
		for (const RetroSongNote &note : track.notes) {
			Dictionary item;
			item["t"] = note.t;
			item["d"] = note.d;
			item["n"] = note.n;
			item["v"] = note.v;
			notes.push_back(item);
		}
		entry["notes"] = notes;
		list.push_back(entry);
	}
	data["tracks"] = list;
	return data;
}

String RetroSong::to_json(bool p_pretty) const {
	return JSON::stringify(to_dictionary(), p_pretty ? " " : "", false);
}

struct _NoteOrder {
	bool operator()(const RetroSongNote &p_a, const RetroSongNote &p_b) const {
		return p_a.t != p_b.t ? p_a.t < p_b.t : p_a.n < p_b.n;
	}
};

void RetroSong::normalize() {
	const int total = length();
	if (has_loop) {
		loop_start = MIN(loop_start, total - 1);
		loop_end = MIN(MAX(loop_end, loop_start + 1), total);
	}
	for (RetroSongTrack &track : tracks) {
		Vector<RetroSongNote> kept;
		for (RetroSongNote note : track.notes) {
			if (note.t < total) {
				note.d = MIN(note.d, total - note.t);
				kept.push_back(note);
			}
		}
		// Ordem estável (como o sort do JS).
		Vector<RetroSongNote> sorted = kept;
		for (int i = 1; i < sorted.size(); i++) {
			RetroSongNote item = sorted[i];
			int j = i - 1;
			while (j >= 0 && _NoteOrder()(item, sorted[j])) {
				sorted.write[j + 1] = sorted[j];
				j--;
			}
			sorted.write[j + 1] = item;
		}
		track.notes = sorted;
	}
}

// ---- validação (validateSong) ----

static bool _is_int(const Variant &p_value) {
	if (p_value.get_type() == Variant::INT) {
		return true;
	}
	if (p_value.get_type() != Variant::FLOAT) {
		return false;
	}
	const double value = p_value;
	return Math::is_finite(value) && value == Math::floor(value);
}

static bool _int(const Variant &p_value, int p_min, int p_max, const char *p_label, int &r_out, String &r_error) {
	if (!_is_int(p_value) || int64_t(p_value) < p_min || int64_t(p_value) > p_max) {
		r_error = String::utf8("Música inválida: ") + String::utf8(p_label) + ".";
		return false;
	}
	r_out = int(int64_t(p_value));
	return true;
}

static bool _id_chars(const String &p_id, int p_max, bool p_letter_first, bool p_dash, bool p_underscore) {
	if (p_id.is_empty() || p_id.length() > p_max) {
		return false;
	}
	for (int i = 0; i < p_id.length(); i++) {
		const char32_t c = p_id[i];
		const bool letter = c >= 'a' && c <= 'z', digit = c >= '0' && c <= '9';
		if (i == 0 && (p_letter_first ? !letter : !(letter || digit))) {
			return false;
		}
		if (!(letter || digit || (p_dash && c == '-') || (p_underscore && c == '_'))) {
			return false;
		}
	}
	return true;
}

bool RetroSongFiles::valid_id(const String &p_id) {
	return _id_chars(p_id, 32, true, false, true);
}

RetroSong RetroSong::from_dictionary(const Variant &p_data, String &r_error) {
	RetroSong song;
	r_error = String();
	if (p_data.get_type() != Variant::DICTIONARY) {
		r_error = String::utf8("Arquivo de música não suportado.");
		return song;
	}
	const Dictionary data = p_data;
	if (String(data.get("format", "")) != SONG_FORMAT || !_is_int(data.get("version", Variant())) || int(data["version"]) != 1) {
		r_error = String::utf8("Arquivo de música não suportado.");
		return song;
	}
	if (data.get("id", Variant()).get_type() != Variant::STRING || !RetroSongFiles::valid_id(data["id"])) {
		r_error = String::utf8("ID da música inválido (letras minúsculas, números e _; começa com letra).");
		return song;
	}
	song.id = data["id"];
	if (song.id == "count") {
		r_error = String::utf8("O ID “count” é reservado pelo cabeçalho gerado.");
		return song;
	}
	if (data.get("name", Variant()).get_type() != Variant::STRING || String(data["name"]).strip_edges().is_empty() || String(data["name"]).length() > 128) {
		r_error = String::utf8("Nome da música inválido.");
		return song;
	}
	song.name = data["name"];
	if (!_int(data.get("tempo", Variant()), SONG_TEMPO_MIN, SONG_TEMPO_MAX, "tempo", song.tempo, r_error) ||
			!_int(data.get("beatsPerBar", Variant()), 1, 12, "tempos por compasso", song.beats_per_bar, r_error) ||
			!_int(data.get("bars", Variant()), 1, SONG_MAX_BARS, "duração", song.bars, r_error)) {
		return song;
	}
	const Variant fm = data.get("fmChannels", Variant());
	if (!_is_int(fm) || (int(fm) != 6 && int(fm) != 5)) {
		r_error = String::utf8("Número de canais FM da música inválido.");
		return song;
	}
	song.fm_channels = fm;
	const int total = song.length();
	const Variant loop = data.get("loop", Variant());
	if (loop.get_type() == Variant::NIL) {
		song.has_loop = false;
	} else {
		if (loop.get_type() != Variant::DICTIONARY) {
			r_error = String::utf8("Loop da música inválido.");
			return song;
		}
		const Dictionary range = loop;
		if (!_int(range.get("start", Variant()), 0, total - 1, "início do loop", song.loop_start, r_error) ||
				!_int(range.get("end", Variant()), song.loop_start + 1, total, "fim do loop", song.loop_end, r_error)) {
			return song;
		}
	}
	song.has_instruments = data.has("instruments");
	if (song.has_instruments) {
		const Variant list = data["instruments"];
		if (list.get_type() != Variant::ARRAY || Array(list).size() > SONG_MAX_INSTRUMENTS) {
			r_error = String::utf8("Lista de instrumentos da música inválida.");
			return song;
		}
		HashSet<String> seen;
		for (const RetroInstrument &preset : RetroChipInstruments::presets()) {
			seen.insert(preset.id);
		}
		for (const Variant &item : Array(list)) {
			if (item.get_type() != Variant::DICTIONARY) {
				r_error = String::utf8("Instrumento inválido na música.");
				return song;
			}
			RetroInstrument instrument = RetroInstrument::from_dictionary(item, r_error);
			if (!r_error.is_empty()) {
				return song;
			}
			if (seen.has(instrument.id)) {
				r_error = String::utf8("ID de instrumento repetido (ou igual a um do banco): ") + instrument.id;
				return song;
			}
			seen.insert(instrument.id);
			song.instruments.push_back(instrument);
		}
	}
	const Variant tracks = data.get("tracks", Variant());
	if (tracks.get_type() != Variant::ARRAY || Array(tracks).is_empty() || Array(tracks).size() > SONG_MAX_TRACKS) {
		r_error = String::utf8("Lista de faixas da música inválida.");
		return song;
	}
	HashSet<String> ids;
	for (const Variant &item : Array(tracks)) {
		if (item.get_type() != Variant::DICTIONARY) {
			r_error = String::utf8("Faixa inválida.");
			return song;
		}
		const Dictionary entry = item;
		RetroSongTrack track;
		if (entry.get("id", Variant()).get_type() != Variant::STRING || !_id_chars(entry["id"], 32, false, true, false) || ids.has(entry["id"])) {
			r_error = String::utf8("ID de faixa inválido ou repetido.");
			return song;
		}
		track.id = entry["id"];
		ids.insert(track.id);
		if (entry.get("name", Variant()).get_type() != Variant::STRING || String(entry["name"]).strip_edges().is_empty() || String(entry["name"]).length() > 64) {
			r_error = String::utf8("Nome de faixa inválido: ") + track.id;
			return song;
		}
		track.name = entry["name"];
		if (entry.get("instrument", Variant()).get_type() != Variant::STRING || !_id_chars(entry["instrument"], 48, false, true, false)) {
			r_error = String::utf8("Instrumento de faixa inválido: ") + track.id;
			return song;
		}
		track.instrument = entry["instrument"];
		if (entry.get("mute", Variant()).get_type() != Variant::BOOL || entry.get("solo", Variant()).get_type() != Variant::BOOL) {
			r_error = String::utf8("Mudo/solo inválido na faixa: ") + track.id;
			return song;
		}
		track.mute = entry["mute"];
		track.solo = entry["solo"];
		const Variant notes = entry.get("notes", Variant());
		if (notes.get_type() != Variant::ARRAY || Array(notes).size() > SONG_MAX_NOTES) {
			r_error = String::utf8("Notas demais na faixa: ") + track.id;
			return song;
		}
		for (const Variant &value : Array(notes)) {
			if (value.get_type() != Variant::DICTIONARY) {
				r_error = String::utf8("Nota inválida na faixa: ") + track.id;
				return song;
			}
			const Dictionary note_data = value;
			RetroSongNote note;
			if (!_int(note_data.get("t", Variant()), 0, total - 1, "início da nota", note.t, r_error) ||
					!_int(note_data.get("d", Variant()), 1, total, "duração da nota", note.d, r_error) ||
					!_int(note_data.get("n", Variant()), 0, 127, "altura da nota", note.n, r_error) ||
					!_int(note_data.get("v", Variant()), 1, 127, "velocity da nota", note.v, r_error)) {
				return song;
			}
			track.notes.push_back(note);
		}
		song.tracks.push_back(track);
	}
	return song;
}

RetroSong RetroSong::from_json(const String &p_text, String &r_error) {
	Ref<JSON> json;
	json.instantiate();
	if (json->parse(p_text) != OK) {
		r_error = String::utf8("JSON inválido: ") + json->get_error_message();
		return RetroSong();
	}
	return from_dictionary(json->get_data(), r_error);
}

// ---- linha do tempo (songTimeline) ----

struct _TimelineEvent {
	int frame = 0;
	int kind = 0; // 0 = soltar, 1 = atacar.
	const RetroInstrument *instrument = nullptr;
	int note = 0;
	int velocity = 0;
	int owner = 0;
};

RetroSongTimeline RetroSongTimeline::build(const RetroSong &p_song, int p_from, int p_to, bool p_audition, bool p_use_loop) {
	RetroSongTimeline result;
	const int to = p_to < 0 ? p_song.length() : p_to;
	RetroChipDriver driver(p_song.fm_channels);
	bool soloing = false;
	if (p_audition) {
		for (const RetroSongTrack &track : p_song.tracks) {
			soloing = soloing || track.solo;
		}
	}
	const int base = p_song.tick_frame(p_from), end = p_song.tick_frame(to) - base;
	result.end = end;
	if (p_use_loop && p_song.has_loop && p_song.loop_start >= p_from && p_song.loop_start < to) {
		result.loop_frame = p_song.tick_frame(p_song.loop_start) - base;
	}
	Vector<_TimelineEvent> events;
	for (int index = 0; index < p_song.tracks.size(); index++) {
		const RetroSongTrack &track = p_song.tracks[index];
		if (p_audition && (track.mute || (soloing && !track.solo))) {
			continue;
		}
		const RetroInstrument *instrument = p_song.resolve_instrument(track.instrument);
		if (!instrument) {
			if (!result.missing.has(track.instrument)) {
				result.missing.push_back(track.instrument);
			}
			continue;
		}
		for (const RetroSongNote &note : track.notes) {
			if (note.t < p_from || note.t >= to) {
				continue;
			}
			const int on = p_song.tick_frame(note.t) - base;
			// Pelo menos um quadro de nota; e solta antes do fim do trecho.
			const int off = MIN(end, MAX(on + 1, p_song.tick_frame(note.t + note.d) - base));
			if (on >= end) {
				continue;
			}
			_TimelineEvent attack;
			attack.frame = on;
			attack.kind = 1;
			attack.instrument = instrument;
			attack.note = note.n;
			attack.velocity = note.v;
			attack.owner = index;
			events.push_back(attack);
			_TimelineEvent release;
			release.frame = off;
			release.note = note.n;
			release.owner = index;
			events.push_back(release);
		}
	}
	// No mesmo quadro: solturas antes de ataques, para a nota repetida reatacar (ordem estável).
	{
		Vector<_TimelineEvent> sorted;
		sorted.resize(events.size());
		// Merge sort estável.
		for (int width = 1; width < events.size(); width *= 2) {
			for (int left = 0; left < events.size(); left += 2 * width) {
				const int middle = MIN(left + width, events.size()), right = MIN(left + 2 * width, events.size());
				int a = left, b = middle, k = left;
				while (a < middle && b < right) {
					const _TimelineEvent &x = events[a], &y = events[b];
					const bool take_b = y.frame < x.frame || (y.frame == x.frame && y.kind < x.kind);
					sorted.write[k++] = take_b ? events[b++] : events[a++];
				}
				while (a < middle) {
					sorted.write[k++] = events[a++];
				}
				while (b < right) {
					sorted.write[k++] = events[b++];
				}
			}
			SWAP(events, sorted);
		}
	}
	Frame first;
	first.writes = driver.take();
	result.frames.push_back(first);
	int cursor = 0;
	for (int frame = 0; frame <= end; frame++) {
		if (frame == result.loop_frame && frame > 0) {
			driver.all_notes_off();
			driver.invalidate();
		}
		if (frame > 0) {
			driver.tick();
		}
		while (cursor < events.size() && events[cursor].frame == frame) {
			const _TimelineEvent &event = events[cursor++];
			if (event.kind) {
				driver.note_on(*event.instrument, event.note, event.velocity, itos(event.owner));
			} else {
				driver.note_off(event.note, itos(event.owner));
			}
		}
		if (frame == end) {
			driver.all_notes_off();
		}
		const Vector<RetroChipWrite> writes = driver.take();
		if (frame == 0) {
			result.frames.write[0].writes.append_array(writes);
		} else if (!writes.is_empty() || frame == result.loop_frame) {
			Frame item;
			item.frame = frame;
			item.writes = writes;
			result.frames.push_back(item);
		}
	}
	return result;
}

// ---- VGM ----

static void _u32(Vector<uint8_t> &r_bytes, int p_at, uint32_t p_value) {
	for (int i = 0; i < 4; i++) {
		r_bytes.write[p_at + i] = (p_value >> (8 * i)) & 0xff;
	}
}

static void _append_u32(Vector<uint8_t> &r_bytes, uint32_t p_value) {
	for (int i = 0; i < 4; i++) {
		r_bytes.push_back((p_value >> (8 * i)) & 0xff);
	}
}

// 11 textos UTF-16LE: título, título (japonês), jogo, jogo (jp), sistema, sistema (jp), autor, autor (jp),
// data, quem converteu, notas.
static Vector<uint8_t> _gd3(const String &p_title, const String &p_author) {
	const String fields[11] = { p_title, "", "", "", "Sega Mega Drive / Genesis", "", p_author, "", "", "Retro Studio", "" };
	Vector<uint8_t> text;
	for (const String &field : fields) {
		const Char16String value = field.substr(0, 256).utf16();
		for (int i = 0; i < value.length(); i++) {
			text.push_back(value[i] & 0xff);
			text.push_back(value[i] >> 8);
		}
		text.push_back(0);
		text.push_back(0);
	}
	Vector<uint8_t> result;
	result.push_back('G');
	result.push_back('d');
	result.push_back('3');
	result.push_back(' ');
	_append_u32(result, 0x100);
	_append_u32(result, text.size());
	result.append_array(text);
	return result;
}

Vector<uint8_t> retro_write_vgm(const RetroSongTimeline &p_timeline, const String &p_title, const String &p_author) {
	static constexpr int FRAME = 735, HEADER = 0x40;
	Vector<uint8_t> body;
	int position = 0;
	int64_t loop_offset = -1;
	auto wait = [&](int p_frames) {
		int64_t samples = int64_t(p_frames) * FRAME;
		while (samples > 0) {
			if (samples == FRAME) {
				body.push_back(0x62);
				samples = 0;
			} else {
				const int chunk = int(MIN(samples, int64_t(0xffff)));
				body.push_back(0x61);
				body.push_back(chunk & 0xff);
				body.push_back(chunk >> 8);
				samples -= chunk;
			}
		}
	};
	for (const RetroSongTimeline::Frame &frame : p_timeline.frames) {
		if (frame.frame > position) {
			wait(frame.frame - position);
			position = frame.frame;
		}
		if (frame.frame == p_timeline.loop_frame) {
			loop_offset = HEADER + body.size();
		}
		for (const RetroChipWrite &write : frame.writes) {
			if (write.chip == 0) {
				body.push_back(write.port ? 0x53 : 0x52);
				body.push_back(write.address);
				body.push_back(write.data);
			} else {
				body.push_back(0x50);
				body.push_back(write.data);
			}
		}
	}
	if (p_timeline.loop_frame == 0 && loop_offset < 0) {
		loop_offset = HEADER;
	}
	if (p_timeline.end > position) {
		wait(p_timeline.end - position);
	}
	body.push_back(0x66);
	const Vector<uint8_t> tag = _gd3(p_title, p_author);
	const int size = HEADER + body.size() + tag.size();
	Vector<uint8_t> header;
	header.resize(HEADER);
	memset(header.ptrw(), 0, HEADER);
	header.write[0] = 'V';
	header.write[1] = 'g';
	header.write[2] = 'm';
	header.write[3] = ' ';
	_u32(header, 0x04, size - 4);
	_u32(header, 0x08, 0x150);
	_u32(header, 0x0c, PSG_CLOCK_NTSC);
	_u32(header, 0x14, HEADER + body.size() - 0x14);
	_u32(header, 0x18, uint32_t(p_timeline.end) * FRAME);
	if (loop_offset >= 0 && p_timeline.loop_frame >= 0) {
		_u32(header, 0x1c, uint32_t(loop_offset - 0x1c));
		_u32(header, 0x20, uint32_t(p_timeline.end - p_timeline.loop_frame) * FRAME);
	}
	_u32(header, 0x24, 60);
	header.write[0x28] = 0x09; // taps do ruído do PSG do Mega Drive
	header.write[0x29] = 0x00;
	header.write[0x2a] = 16; // LFSR de 16 bits
	_u32(header, 0x2c, YM2612_CLOCK_NTSC);
	_u32(header, 0x34, HEADER - 0x34);
	header.append_array(body);
	header.append_array(tag);
	return header;
}

// ---- arquivos ----

String RetroSongFiles::source_path(const String &p_root, const String &p_id) {
	return p_root.path_join(MUSIC_FOLDER).path_join(p_id + ".song.json");
}

String RetroSongFiles::vgm_path(const String &p_id) {
	// Na pasta som/ do projeto, de onde a Música da MDCena escolhe (o build converte o VGM para XGM).
	return "som/" + p_id + ".vgm";
}

String RetroSongFiles::file_hash(const String &p_path) {
	if (!FileAccess::exists(p_path)) {
		return String();
	}
	return FileAccess::get_sha256(p_path);
}

Error RetroSongFiles::write_atomic(const String &p_path, const Vector<uint8_t> &p_bytes) {
	DirAccess::make_dir_recursive_absolute(p_path.get_base_dir());
	const String temp = p_path + ".tmp-" + itos(OS::get_singleton()->get_process_id());
	{
		Ref<FileAccess> file = FileAccess::open(temp, FileAccess::WRITE);
		if (file.is_null()) {
			return ERR_FILE_CANT_WRITE;
		}
		file->store_buffer(p_bytes.ptr(), p_bytes.size());
	}
	if (DirAccess::rename_absolute(temp, p_path) != OK) {
		DirAccess::remove_absolute(temp);
		return ERR_FILE_CANT_WRITE;
	}
	return OK;
}

static Dictionary _export_record(const String &p_root) {
	const String path = p_root.path_join(MUSIC_RECORD);
	if (!FileAccess::exists(path)) {
		return Dictionary();
	}
	const Variant data = JSON::parse_string(FileAccess::get_file_as_string(path));
	if (data.get_type() != Variant::DICTIONARY || Dictionary(data).get("files", Variant()).get_type() != Variant::DICTIONARY) {
		return Dictionary();
	}
	return Dictionary(data)["files"];
}

static Error _read_song(const String &p_root, const String &p_id, RetroSong &r_song, String &r_hash, String &r_error) {
	if (!RetroSongFiles::valid_id(p_id)) {
		r_error = String::utf8("ID de música inválido.");
		return ERR_INVALID_PARAMETER;
	}
	const String path = RetroSongFiles::source_path(p_root, p_id);
	if (!FileAccess::exists(path)) {
		r_error = String::utf8("Música não encontrada: music/") + p_id + ".song.json";
		return ERR_FILE_NOT_FOUND;
	}
	Ref<FileAccess> file = FileAccess::open(path, FileAccess::READ);
	if (file.is_null()) {
		r_error = String::utf8("Não foi possível ler music/") + p_id + ".song.json";
		return ERR_FILE_CANT_READ;
	}
	if (file->get_length() > SONG_SIZE_LIMIT) {
		r_error = String::utf8("Música maior que 4 MiB: music/") + p_id + ".song.json";
		return ERR_FILE_CORRUPT;
	}
	const String text = file->get_as_utf8_string();
	file.unref();
	r_song = RetroSong::from_json(text, r_error);
	if (!r_error.is_empty()) {
		return ERR_FILE_CORRUPT;
	}
	r_hash = RetroSongFiles::file_hash(path);
	return OK;
}

Array RetroSongFiles::list(const String &p_root) {
	Array result;
	Ref<DirAccess> dir = DirAccess::open(p_root.path_join(MUSIC_FOLDER));
	if (dir.is_null()) {
		return result;
	}
	PackedStringArray ids;
	for (const String &file : dir->get_files()) {
		if (file.ends_with(".song.json") && valid_id(file.trim_suffix(".song.json"))) {
			ids.push_back(file.trim_suffix(".song.json"));
		}
	}
	ids.sort();
	const Dictionary record = _export_record(p_root);
	for (const String &id : ids) {
		Dictionary entry;
		entry["id"] = id;
		RetroSong song;
		String hash, error;
		if (_read_song(p_root, id, song, hash, error) != OK) {
			entry["name"] = id;
			entry["error"] = error;
		} else {
			entry["name"] = song.name;
			const String vgm = file_hash(p_root.path_join(vgm_path(id)));
			entry["exported"] = !vgm.is_empty() && String(record.get(vgm_path(id), "")) == vgm;
		}
		result.push_back(entry);
	}
	return result;
}

Error RetroSongFiles::load(const String &p_root, const String &p_id, RetroSong &r_song, String &r_revision, String &r_error) {
	return _read_song(p_root, p_id, r_song, r_revision, r_error);
}

Error RetroSongFiles::save(const String &p_root, const RetroSong &p_song, const String &p_revision, String &r_new_revision, String &r_error, bool p_export, RetroSongExport *r_export) {
	// Valida, normaliza e valida de novo (como saveSong).
	RetroSong clean = RetroSong::from_json(p_song.to_json(), r_error);
	if (!r_error.is_empty()) {
		return ERR_INVALID_DATA;
	}
	clean.normalize();
	clean = RetroSong::from_json(clean.to_json(), r_error);
	if (!r_error.is_empty()) {
		return ERR_INVALID_DATA;
	}
	const String path = source_path(p_root, clean.id), current = file_hash(path);
	if (current != p_revision) {
		r_error = current.is_empty() ? String::utf8("A música foi apagada fora do editor.") : (p_revision.is_empty() ? String::utf8("Já existe uma música com o ID “") + clean.id + String::utf8("”. Escolha outro ID.") : String::utf8("A música mudou no disco depois de aberta. Recarregue antes de salvar."));
		return ERR_ALREADY_EXISTS;
	}
	const CharString text = (clean.to_json(true) + "\n").utf8();
	if (text.length() > SONG_SIZE_LIMIT) {
		r_error = String::utf8("Música maior que 4 MiB.");
		return ERR_OUT_OF_MEMORY;
	}
	Vector<uint8_t> bytes;
	bytes.resize(text.length());
	memcpy(bytes.ptrw(), text.get_data(), text.length());
	Vector<uint8_t> vgm;
	RetroSongTimeline timeline;
	Dictionary record_files;
	const String target = vgm_path(clean.id);
	if (p_export) {
		timeline = RetroSongTimeline::build(clean);
		if (!timeline.missing.is_empty()) {
			r_error = String::utf8("Instrumento não encontrado: ") + String(", ").join(timeline.missing);
			return ERR_INVALID_DATA;
		}
		vgm = retro_write_vgm(timeline, clean.name);
		record_files = _export_record(p_root).duplicate();
		const String existing = file_hash(p_root.path_join(target));
		if (!existing.is_empty() && String(record_files.get(target, "")) != existing) {
			r_error = target + String::utf8(" já existe e não foi gerado pelo compositor; nada foi sobrescrito.");
			return ERR_ALREADY_EXISTS;
		}
	}
	if (write_atomic(path, bytes) != OK) {
		r_error = String::utf8("Não foi possível gravar ") + path;
		return ERR_FILE_CANT_WRITE;
	}
	r_new_revision = file_hash(path);
	if (!p_export) {
		return OK;
	}
	if (write_atomic(p_root.path_join(target), vgm) != OK) {
		r_error = String::utf8("Não foi possível gravar ") + target;
		return ERR_FILE_CANT_WRITE;
	}
	record_files[target] = file_hash(p_root.path_join(target));
	Dictionary record;
	record["version"] = 1;
	record["files"] = record_files;
	const CharString record_text = (JSON::stringify(record, "  ", false) + "\n").utf8();
	Vector<uint8_t> record_bytes;
	record_bytes.resize(record_text.length());
	memcpy(record_bytes.ptrw(), record_text.get_data(), record_text.length());
	if (write_atomic(p_root.path_join(MUSIC_RECORD), record_bytes) != OK) {
		r_error = String::utf8("Não foi possível gravar ") + MUSIC_RECORD;
		return ERR_FILE_CANT_WRITE;
	}
	if (r_export) {
		r_export->exported = true;
		r_export->vgm_path = target;
		r_export->bytes = vgm.size();
		r_export->seconds = timeline.end / 60.0;
		r_export->loop = timeline.loop_frame >= 0;
	}
	return OK;
}
