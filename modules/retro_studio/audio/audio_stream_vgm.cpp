#include "audio_stream_vgm.h"

#include "core/io/compression.h"
#include "core/io/file_access.h"
#include "core/object/class_db.h"

namespace RetroVgm {

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

uint32_t u32(const Vector<uint8_t> &p_data, int64_t p_offset) {
	if (p_offset < 0 || p_offset + 4 > p_data.size()) {
		return 0;
	}
	return uint32_t(p_data[p_offset]) | uint32_t(p_data[p_offset + 1]) << 8 | uint32_t(p_data[p_offset + 2]) << 16 | uint32_t(p_data[p_offset + 3]) << 24;
}

int u16(const Vector<uint8_t> &p_data, int64_t p_offset) {
	if (p_offset < 0 || p_offset + 2 > p_data.size()) {
		return 0;
	}
	return p_data[p_offset] | p_data[p_offset + 1] << 8;
}

// Tamanho total (com o próprio comando) dos comandos que só são pulados.
int skip_size(int p_command) {
	if (p_command >= 0x30 && p_command <= 0x3f) {
		return 2;
	}
	if (p_command == 0x4f || p_command == 0x50) {
		return 2;
	}
	if (p_command >= 0x40 && p_command <= 0x5f) {
		return 3;
	}
	if (p_command >= 0xa0 && p_command <= 0xbf) {
		return 3;
	}
	if (p_command >= 0xc0 && p_command <= 0xdf) {
		return 4;
	}
	if (p_command >= 0xe1) {
		return 5;
	}
	return 0;
}

int64_t command_length(const Vector<uint8_t> &p_data, int64_t p_index) {
	const int command = p_data[p_index];
	if (command == 0x52 || command == 0x53 || command == 0x61) {
		return 3;
	}
	if (command == 0x62 || command == 0x63 || (command >= 0x70 && command <= 0x8f)) {
		return 1;
	}
	if (command == 0x67) {
		return 7 + (u32(p_data, p_index + 3) & 0x7fffffff);
	}
	if (command == 0x68) {
		return 12;
	}
	if (command == 0xe0) {
		return 5;
	}
	if (command == 0x90 || command == 0x91 || command == 0x95) {
		return 5;
	}
	if (command == 0x92) {
		return 6;
	}
	if (command == 0x93) {
		return 11;
	}
	if (command == 0x94) {
		return 2;
	}
	return skip_size(command);
}

// Tags GD3: título, jogo e autor (em inglês, os primeiros de cada par).
void read_gd3(const Vector<uint8_t> &p_data, int64_t p_offset, Data &r_data) {
	if (!p_offset || p_offset + 12 > p_data.size() || p_data[p_offset] != 'G' || p_data[p_offset + 1] != 'd' || p_data[p_offset + 2] != '3') {
		return;
	}
	const int64_t end = MIN(int64_t(p_data.size()), p_offset + 12 + u32(p_data, p_offset + 8));
	int64_t index = p_offset + 12;
	String fields[7];
	for (int field = 0; field < 7; field++) {
		String text;
		while (index + 1 < end) {
			const int code = u16(p_data, index);
			index += 2;
			if (!code) {
				break;
			}
			text += String::chr(code);
		}
		fields[field] = text.strip_edges();
	}
	r_data.title = fields[0];
	r_data.game = fields[2];
	r_data.author = fields[6];
}

} // namespace

String parse(const Vector<uint8_t> &p_bytes, Data &r_data) {
	const Vector<uint8_t> &data = p_bytes;
	if (data.size() < 0x40 || data[0] != 'V' || data[1] != 'g' || data[2] != 'm' || data[3] != ' ') {
		return U("Não é um arquivo VGM.");
	}
	r_data = Data();
	r_data.bytes = data;
	const uint32_t version = u32(data, 8);
	r_data.start = version >= 0x150 && u32(data, 0x34) ? 0x34 + u32(data, 0x34) : 0x40;
	r_data.psg_clock = u32(data, 0x0c) & 0x3fffffff;
	r_data.ym_clock = (version >= 0x110 ? u32(data, 0x2c) : u32(data, 0x10)) & 0x3fffffff;
	if (!r_data.psg_clock) {
		r_data.psg_clock = RetroChips::PSG_CLOCK_NTSC;
	}
	if (!r_data.ym_clock) {
		r_data.ym_clock = RetroChips::YM2612_CLOCK_NTSC;
	}
	r_data.samples = u32(data, 0x18);
	const uint32_t loop_relative = u32(data, 0x1c);
	r_data.loop_offset = loop_relative ? 0x1c + loop_relative : -1;
	r_data.loop_samples = u32(data, 0x20);
	if (r_data.loop_offset >= 0 && (r_data.loop_offset < r_data.start || r_data.loop_offset >= data.size() || !r_data.loop_samples)) {
		r_data.loop_offset = -1;
	}
	if (u32(data, 0x14)) {
		read_gd3(data, 0x14 + u32(data, 0x14), r_data);
	}
	// Junta os blocos de PCM do YM2612 (tipo 0) e confere os comandos.
	int64_t index = r_data.start;
	while (index < data.size()) {
		const int command = data[index];
		if (command == 0x66) {
			break;
		}
		if (command == 0x67) {
			const int type = index + 2 < data.size() ? data[index + 2] : -1;
			const int64_t length = u32(data, index + 3) & 0x7fffffff;
			if (type == 0x00 && index + 7 + length <= data.size()) {
				r_data.blocks.push_back(Vector2i(r_data.pcm.size(), length));
				const int64_t at = r_data.pcm.size();
				r_data.pcm.resize(at + length);
				memcpy(r_data.pcm.ptrw() + at, data.ptr() + index + 7, length);
			}
			index += 7 + length;
			continue;
		}
		const int64_t length = command_length(data, index);
		if (!length) {
			return vformat(U("Comando de VGM desconhecido 0x%02x na posição 0x%x."), command, index);
		}
		index += length;
	}
	return String();
}

Cursor::Cursor(const Data *p_data, bool p_loop) {
	data = p_data;
	loop = p_loop && p_data->loop_offset >= 0;
	index = p_data->start;
}

void Cursor::finish() {
	if (loop) {
		index = data->loop_offset;
		loops++;
	} else {
		ended = true;
	}
}

// Esperas: os streams do DAC continuam escrevendo no intervalo.
template <typename F>
void Cursor::wait(int64_t p_samples, F &p_emit) {
	const int64_t end = time + p_samples;
	for (KeyValue<int, Stream> &E : streams) {
		Stream &s = E.value;
		if (!s.active || !s.frequency) {
			continue;
		}
		const double step = double(SAMPLE_RATE) / s.frequency;
		while (s.active && s.next < end) {
			if (s.next >= time) {
				Write write;
				write.port = s.port;
				write.address = s.address;
				write.value = s.position < data->pcm.size() ? data->pcm[s.position] : 0x80;
				p_emit(int64_t(s.next), write);
			}
			s.position += s.step;
			s.next += step;
			if (--s.remaining <= 0 || s.position >= data->pcm.size()) {
				if (s.repeat) {
					s.position = s.begin;
					s.remaining = s.length;
				} else {
					s.active = false;
				}
			}
		}
	}
	time = end;
}

void Cursor::stream(int p_command) {
	const Vector<uint8_t> &bytes = data->bytes;
	const int64_t at = index;
	const int id = bytes[at + 1];
	if (p_command == 0x94) {
		for (KeyValue<int, Stream> &E : streams) {
			if (id == 0xff || E.key == id) {
				E.value.active = false;
			}
		}
		return;
	}
	Stream &s = streams[id];
	if (p_command == 0x90) {
		s.chip = bytes[at + 2] & 0x7f;
		s.port = bytes[at + 3];
		s.address = bytes[at + 4];
	} else if (p_command == 0x91) {
		s.step = MAX(1, int(bytes[at + 3]));
	} else if (p_command == 0x92) {
		s.frequency = u32(bytes, at + 2);
	} else if (p_command == 0x93 || p_command == 0x95) {
		// Só o DAC do YM2612 (chip 2 da especificação); os outros chips não existem no Mega Drive.
		if (s.chip != 0x02) {
			return;
		}
		if (p_command == 0x93) {
			const uint32_t offset = u32(bytes, at + 2), length = u32(bytes, at + 7);
			const int mode = bytes[at + 6];
			if (offset != 0xffffffff) {
				s.position = offset;
			}
			const int kind = mode & 3;
			s.length = kind == 1 ? int64_t(length) : kind == 2 ? int64_t(Math::round(double(length) * s.frequency / 1000)) : MAX(int64_t(0), int64_t(data->pcm.size()) - s.position);
			s.repeat = mode & 0x80;
		} else {
			const int block = u16(bytes, at + 2);
			if (block >= data->blocks.size()) {
				return;
			}
			s.position = data->blocks[block].x;
			s.length = data->blocks[block].y;
			s.repeat = bytes[at + 4] & 1;
		}
		s.begin = s.position;
		s.remaining = MAX(int64_t(1), s.length);
		s.active = true;
		s.next = time;
	}
}

template <typename F>
void Cursor::run(int64_t p_until, F p_emit) {
	const Vector<uint8_t> &bytes = data->bytes;
	while (!ended && time < p_until) {
		if (index >= bytes.size()) {
			finish();
			continue;
		}
		const int command = bytes[index];
		if ((command == 0x52 || command == 0x53) && index + 2 < bytes.size()) {
			Write write;
			write.port = command - 0x52;
			write.address = bytes[index + 1];
			write.value = bytes[index + 2];
			p_emit(time, write);
			index += 3;
		} else if (command == 0x50 && index + 1 < bytes.size()) {
			Write write;
			write.chip = 1;
			write.value = bytes[index + 1];
			p_emit(time, write);
			index += 2;
		} else if (command == 0x61) {
			wait(u16(bytes, index + 1), p_emit);
			index += 3;
		} else if (command == 0x62) {
			wait(735, p_emit);
			index++;
		} else if (command == 0x63) {
			wait(882, p_emit);
			index++;
		} else if (command >= 0x70 && command <= 0x7f) {
			wait((command & 15) + 1, p_emit);
			index++;
		} else if (command >= 0x80 && command <= 0x8f) {
			Write write;
			write.address = 0x2a;
			write.value = pcm_position < data->pcm.size() ? data->pcm[pcm_position] : 0x80;
			p_emit(time, write);
			pcm_position++;
			index++;
			if (command & 15) {
				wait(command & 15, p_emit);
			}
		} else if (command == 0xe0) {
			pcm_position = u32(bytes, index + 1);
			index += 5;
		} else if (command >= 0x90 && command <= 0x95) {
			stream(command);
			index += command_length(bytes, index);
		} else if (command == 0x66) {
			finish();
		} else {
			const int64_t length = command_length(bytes, index);
			index += length ? length : 1;
		}
	}
}

} // namespace RetroVgm

// ---- AudioStreamVGM ----

void AudioStreamVGM::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_loop", "loop"), &AudioStreamVGM::set_loop);
	ClassDB::bind_method(D_METHOD("get_loop"), &AudioStreamVGM::get_loop);
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "loop"), "set_loop", "get_loop");
}

Ref<AudioStreamPlayback> AudioStreamVGM::instantiate_playback() {
	Ref<AudioStreamPlaybackVGM> playback;
	playback.instantiate();
	playback->stream = Ref<AudioStreamVGM>(this);
	return playback;
}

String AudioStreamVGM::get_stream_name() const {
	if (!vgm.title.is_empty()) {
		return vgm.game.is_empty() ? vgm.title : vgm.title + " (" + vgm.game + ")";
	}
	return get_path().get_file();
}

double AudioStreamVGM::get_length() const {
	return double(vgm.samples) / RetroVgm::SAMPLE_RATE;
}

// ---- AudioStreamPlaybackVGM ----

// Mistura aproximada do Mega Drive: PSG um pouco abaixo de um canal FM.
static const float FM_GAIN = 0.22f, PSG_GAIN = 0.2f;

void AudioStreamPlaybackVGM::_apply(const RetroVgm::Write &p_write) {
	if (p_write.chip == 0) {
		fm.write(p_write.port, p_write.address, p_write.value);
	} else {
		psg.write(p_write.value);
	}
}

void AudioStreamPlaybackVGM::start(double p_from_pos) {
	const RetroVgm::Data &data = stream->get_data();
	fm = RetroChips::Ym2612(data.ym_clock);
	psg = RetroChips::Sn76489(data.psg_clock);
	cursor = RetroVgm::Cursor(&data, stream->get_loop());
	queue.clear();
	queue_head = 0;
	fm_position = 0;
	previous[0] = previous[1] = current[0] = current[1] = 0;
	frame = int64_t(MAX(0.0, p_from_pos) * RetroVgm::SAMPLE_RATE);
	if (frame > 0) {
		// Começar no meio: os últimos valores dos registradores (sem key on e sem o DAC) e do PSG.
		HashMap<int, RetroVgm::Write> registers;
		Vector<RetroVgm::Write> psg_writes;
		cursor.run(frame, [&](int64_t, const RetroVgm::Write &p_write) {
			if (p_write.chip == 1) {
				psg_writes.push_back(p_write);
			} else if (p_write.address != 0x28 && p_write.address != 0x2a) {
				registers[p_write.port << 8 | p_write.address] = p_write;
			}
		});
		for (const KeyValue<int, RetroVgm::Write> &E : registers) {
			_apply(E.value);
		}
		for (const RetroVgm::Write &write : psg_writes) {
			_apply(write);
		}
		frame = cursor.time;
	}
	active = true;
	begin_resample();
}

void AudioStreamPlaybackVGM::stop() {
	active = false;
}

void AudioStreamPlaybackVGM::seek(double p_time) {
	if (active) {
		start(p_time);
	}
}

double AudioStreamPlaybackVGM::get_playback_position() const {
	const RetroVgm::Data &data = stream->get_data();
	double seconds = double(frame) / RetroVgm::SAMPLE_RATE;
	// Depois de dar a volta, a posição conta dentro do trecho que repete.
	if (cursor.loops > 0 && data.loop_samples > 0) {
		const double intro = double(data.samples - data.loop_samples) / RetroVgm::SAMPLE_RATE;
		const double loop = double(data.loop_samples) / RetroVgm::SAMPLE_RATE;
		seconds = intro + Math::fmod(seconds - intro, loop);
	}
	return seconds;
}

int AudioStreamPlaybackVGM::_mix_internal(AudioFrame *p_buffer, int p_frames) {
	if (!active) {
		for (int i = 0; i < p_frames; i++) {
			p_buffer[i] = AudioFrame(0, 0);
		}
		return 0;
	}
	cursor.run(frame + p_frames, [&](int64_t p_time, const RetroVgm::Write &p_write) {
		Timed timed;
		timed.time = p_time;
		timed.write = p_write;
		queue.push_back(timed);
	});
	const double ratio = fm.sample_rate / RetroVgm::SAMPLE_RATE;
	for (int i = 0; i < p_frames; i++, frame++) {
		while (queue_head < queue.size() && queue[queue_head].time <= frame) {
			_apply(queue[queue_head++].write);
		}
		fm_position += ratio;
		while (fm_position >= 1) {
			fm_position -= 1;
			previous[0] = current[0];
			previous[1] = current[1];
			fm.step();
			current[0] = fm.left;
			current[1] = fm.right;
		}
		const float t = fm_position, mono = psg.sample(RetroVgm::SAMPLE_RATE) * PSG_GAIN;
		p_buffer[i] = AudioFrame((previous[0] + (current[0] - previous[0]) * t) * FM_GAIN + mono, (previous[1] + (current[1] - previous[1]) * t) * FM_GAIN + mono);
	}
	// A fila só cresce dentro de uma espera longa; o que já foi aplicado sai.
	if (queue_head > 0 && queue_head == queue.size()) {
		queue.clear();
		queue_head = 0;
	} else if (queue_head > 4096) {
		queue = queue.slice(queue_head);
		queue_head = 0;
	}
	if (cursor.ended && queue_head >= queue.size()) {
		active = false;
	}
	return p_frames;
}

// ---- Carregador ----

Ref<Resource> ResourceFormatLoaderVGM::load(const String &p_path, const String &p_original_path, Error *r_error, bool p_use_sub_threads, float *r_progress, CacheMode p_cache_mode) {
	if (r_error) {
		*r_error = ERR_FILE_CORRUPT;
	}
	Vector<uint8_t> bytes = FileAccess::get_file_as_bytes(p_path);
	if (bytes.size() > 2 && bytes[0] == 0x1f && bytes[1] == 0x8b) {
		// .vgz: o mesmo VGM compactado com gzip.
		Vector<uint8_t> unpacked;
		if (Compression::decompress_dynamic(&unpacked, -1, bytes.ptr(), bytes.size(), Compression::MODE_GZIP) != 0) { // 0 é o Z_OK do zlib.
			ERR_FAIL_V_MSG(Ref<Resource>(), String::utf8("Não foi possível descompactar ") + p_path + ".");
		}
		bytes = unpacked;
	}
	RetroVgm::Data data;
	const String problem = RetroVgm::parse(bytes, data);
	ERR_FAIL_COND_V_MSG(!problem.is_empty(), Ref<Resource>(), p_path + ": " + problem);
	Ref<AudioStreamVGM> stream;
	stream.instantiate();
	stream->set_data(data);
	if (r_error) {
		*r_error = OK;
	}
	return stream;
}

void ResourceFormatLoaderVGM::get_recognized_extensions(List<String> *p_extensions) const {
	p_extensions->push_back("vgm");
	p_extensions->push_back("vgz");
}

bool ResourceFormatLoaderVGM::handles_type(const String &p_type) const {
	return p_type == "AudioStreamVGM" || ClassDB::is_parent_class("AudioStreamVGM", p_type);
}

String ResourceFormatLoaderVGM::get_resource_type(const String &p_path) const {
	const String extension = p_path.get_extension().to_lower();
	return extension == "vgm" || extension == "vgz" ? "AudioStreamVGM" : "";
}
