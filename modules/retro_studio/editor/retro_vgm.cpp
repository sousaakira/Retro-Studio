#include "retro_vgm.h"

#include "core/io/compression.h"

static const char *GD3_FIELDS[11] = { "title", "titleJapanese", "game", "gameJapanese", "system", "systemJapanese", "author", "authorJapanese", "date", "ripper", "notes" };

static uint32_t _u32(const Vector<uint8_t> &p_data, int64_t p_offset) {
	if (p_offset < 0 || p_offset + 4 > p_data.size()) {
		// O JS lê undefined (vira 0) fora do arquivo.
		uint32_t value = 0;
		for (int i = 0; i < 4; i++) {
			if (p_offset + i >= 0 && p_offset + i < p_data.size()) {
				value |= uint32_t(p_data[p_offset + i]) << (8 * i);
			}
		}
		return value;
	}
	return uint32_t(p_data[p_offset]) | (uint32_t(p_data[p_offset + 1]) << 8) | (uint32_t(p_data[p_offset + 2]) << 16) | (uint32_t(p_data[p_offset + 3]) << 24);
}

static int _u16(const Vector<uint8_t> &p_data, int64_t p_offset) {
	const int a = p_offset < p_data.size() ? p_data[p_offset] : 0, b = p_offset + 1 < p_data.size() ? p_data[p_offset + 1] : 0;
	return a | (b << 8);
}

static int _byte(const Vector<uint8_t> &p_data, int64_t p_offset) {
	return p_offset >= 0 && p_offset < p_data.size() ? p_data[p_offset] : 0;
}

// Tamanho total (com o próprio comando) dos comandos que só são pulados.
static int _skip_size(int p_command) {
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

static int64_t _command_length(const Vector<uint8_t> &p_data, int64_t p_index) {
	const int command = _byte(p_data, p_index);
	if (command == 0x52 || command == 0x53 || command == 0x61) {
		return 3;
	}
	if (command == 0x62 || command == 0x63 || (command >= 0x70 && command <= 0x8f)) {
		return 1;
	}
	if (command == 0x67) {
		return 7 + (_u32(p_data, p_index + 3) & 0x7fffffff);
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
	return _skip_size(command);
}

static Dictionary _read_gd3(const Vector<uint8_t> &p_data, int64_t p_offset) {
	Dictionary result;
	if (!p_offset || p_offset + 12 > p_data.size()) {
		return result;
	}
	if (p_data[p_offset] != 'G' || p_data[p_offset + 1] != 'd' || p_data[p_offset + 2] != '3' || p_data[p_offset + 3] != ' ') {
		return result;
	}
	const int64_t end = MIN(int64_t(p_data.size()), p_offset + 12 + int64_t(_u32(p_data, p_offset + 8)));
	int64_t index = p_offset + 12;
	for (const char *field : GD3_FIELDS) {
		Char16String text;
		while (index + 1 < end) {
			const int code = _u16(p_data, index);
			index += 2;
			if (!code) {
				break;
			}
			text += char16_t(code);
		}
		String value;
		value.append_utf16(text.get_data(), text.length());
		result[field] = value.strip_edges();
	}
	return result;
}

Vector<uint8_t> RetroVgmFile::gunzip(const Vector<uint8_t> &p_bytes, String &r_error) {
	Vector<uint8_t> out;
	if (Compression::decompress_dynamic(&out, 64 * 1024 * 1024, p_bytes.ptr(), p_bytes.size(), Compression::MODE_GZIP) != OK) {
		r_error = String::utf8("Não foi possível descompactar o VGZ.");
		return Vector<uint8_t>();
	}
	return out;
}

RetroVgmFile RetroVgmFile::parse(const Vector<uint8_t> &p_bytes, String &r_error) {
	RetroVgmFile vgm;
	r_error = String();
	const Vector<uint8_t> &data = p_bytes;
	if (is_gzip(data)) {
		r_error = String::utf8("VGM compactado (.vgz): descompacte antes de ler.");
		return vgm;
	}
	if (data.size() < 0x40 || data[0] != 'V' || data[1] != 'g' || data[2] != 'm' || data[3] != ' ') {
		r_error = String::utf8("Não é um arquivo VGM.");
		return vgm;
	}
	vgm.data = data;
	vgm.version = _u32(data, 8);
	vgm.start = vgm.version >= 0x150 && _u32(data, 0x34) ? 0x34 + int(_u32(data, 0x34)) : 0x40;
	const uint32_t loop_relative = _u32(data, 0x1c);
	vgm.psg_clock = _u32(data, 0x0c) & 0x3fffffff;
	vgm.ym_clock = (vgm.version >= 0x110 ? _u32(data, 0x2c) : _u32(data, 0x10)) & 0x3fffffff;
	vgm.samples = _u32(data, 0x18);
	vgm.loop_offset = loop_relative ? 0x1c + int(loop_relative) : -1;
	vgm.loop_samples = _u32(data, 0x20);
	vgm.tags = _read_gd3(data, _u32(data, 0x14) ? 0x14 + int64_t(_u32(data, 0x14)) : 0);
	if (vgm.loop_offset >= 0 && (vgm.loop_offset < vgm.start || vgm.loop_offset >= data.size() || !vgm.loop_samples)) {
		vgm.loop_offset = -1;
	}
	// Primeira passada: junta os blocos de PCM do YM2612 (tipo 0) e confere os comandos.
	int64_t index = vgm.start;
	while (index < data.size()) {
		const int command = data[index];
		if (command == 0x66) {
			break;
		}
		if (command == 0x67) {
			const int type = _byte(data, index + 2);
			const int64_t length = _u32(data, index + 3) & 0x7fffffff;
			if (type == 0x00) {
				Block block;
				block.offset = vgm.pcm.size();
				block.length = int(length);
				vgm.blocks.push_back(block);
				const int64_t from = MIN(index + 7, int64_t(data.size())), to = MIN(index + 7 + length, int64_t(data.size()));
				vgm.pcm.append_array(data.slice(from, to));
				// Bloco cortado pelo fim do arquivo: o resto fica zerado (Uint8Array do tamanho declarado).
				const int64_t declared = block.offset + length;
				if (vgm.pcm.size() < declared) {
					const int64_t old = vgm.pcm.size();
					vgm.pcm.resize(declared);
					memset(vgm.pcm.ptrw() + old, 0, declared - old);
				}
			}
			index += 7 + length;
			continue;
		}
		const int64_t length = _command_length(data, index);
		if (!length) {
			r_error = vformat(String::utf8("Comando de VGM desconhecido 0x%02x na posição 0x%x."), command, index);
			return RetroVgmFile();
		}
		index += length;
	}
	vgm.seconds = double(vgm.samples) / VGM_SAMPLE_RATE;
	vgm.loop_seconds = vgm.loop_offset >= 0 ? double(vgm.loop_samples) / VGM_SAMPLE_RATE : 0;
	return vgm;
}

RetroVgmCursor::RetroVgmCursor(const RetroVgmFile *p_vgm, bool p_loop) {
	vgm = p_vgm;
	loop = p_loop && p_vgm && p_vgm->loop_offset >= 0;
	index = p_vgm ? p_vgm->start : 0;
}

void RetroVgmCursor::_emit(Vector<RetroVgmWrite> &r_out, double p_sample, const RetroChipWrite &p_write) const {
	RetroVgmWrite item;
	item.sample = p_sample; // Streams caem entre amostras.
	item.write = p_write;
	r_out.push_back(item);
}

static RetroChipWrite _fm(int p_port, int p_register, int p_value) {
	RetroChipWrite write;
	write.chip = 0;
	write.port = p_port;
	write.address = p_register;
	write.data = p_value;
	return write;
}

void RetroVgmCursor::run(int64_t p_until, Vector<RetroVgmWrite> &r_out) {
	const Vector<uint8_t> &data = vgm->data;
	while (!ended && time < p_until) {
		if (index >= data.size()) {
			_finish();
			continue;
		}
		const int command = data[index];
		if (command == 0x52 || command == 0x53) {
			_emit(r_out, time, _fm(command - 0x52, _byte(data, index + 1), _byte(data, index + 2)));
			index += 3;
		} else if (command == 0x50) {
			RetroChipWrite write;
			write.chip = 1;
			write.data = _byte(data, index + 1);
			_emit(r_out, time, write);
			index += 2;
		} else if (command == 0x61) {
			_wait(_u16(data, index + 1), r_out);
			index += 3;
		} else if (command == 0x62) {
			_wait(735, r_out);
			index++;
		} else if (command == 0x63) {
			_wait(882, r_out);
			index++;
		} else if (command >= 0x70 && command <= 0x7f) {
			_wait((command & 15) + 1, r_out);
			index++;
		} else if (command >= 0x80 && command <= 0x8f) {
			_emit(r_out, time, _fm(0, 0x2a, pcm_position >= 0 && pcm_position < vgm->pcm.size() ? vgm->pcm[pcm_position] : 0x80));
			pcm_position++;
			index++;
			if (command & 15) {
				_wait(command & 15, r_out);
			}
		} else if (command == 0xe0) {
			pcm_position = _u32(data, index + 1);
			index += 5;
		} else if (command >= 0x90 && command <= 0x95) {
			_stream(command);
			index += _command_length(data, index);
		} else if (command == 0x66) {
			_finish();
		} else {
			const int64_t length = _command_length(data, index);
			index += length ? length : 1;
		}
	}
}

void RetroVgmCursor::_finish() {
	if (loop) {
		index = vgm->loop_offset;
		loops++;
	} else {
		ended = true;
	}
}

// Esperas: os streams do DAC continuam escrevendo no intervalo.
void RetroVgmCursor::_wait(int p_samples, Vector<RetroVgmWrite> &r_out) {
	const int64_t end = time + p_samples;
	for (const int id : stream_order) {
		Stream &stream = streams[id];
		if (!stream.active || !stream.frequency) {
			continue;
		}
		const double step = double(VGM_SAMPLE_RATE) / stream.frequency;
		while (stream.active && stream.next < end) {
			if (stream.next >= time) {
				_emit(r_out, stream.next, _fm(stream.port, stream.reg, stream.position >= 0 && stream.position < vgm->pcm.size() ? vgm->pcm[stream.position] : 0x80));
			}
			stream.position += stream.step;
			stream.next += step;
			if (--stream.remaining <= 0 || stream.position >= vgm->pcm.size()) {
				if (stream.repeat) {
					stream.position = stream.begin;
					stream.remaining = stream.length;
				} else {
					stream.active = false;
				}
			}
		}
	}
	time = end;
}

void RetroVgmCursor::_stream(int p_command) {
	const Vector<uint8_t> &data = vgm->data;
	const int64_t at = index;
	const int id = _byte(data, at + 1);
	if (p_command == 0x94) {
		for (const int key : stream_order) {
			if (id == 0xff || key == id) {
				streams[key].active = false;
			}
		}
		return;
	}
	if (!streams.has(id)) {
		streams[id] = Stream();
		stream_order.push_back(id);
	}
	Stream &stream = streams[id];
	if (p_command == 0x90) {
		stream.chip = _byte(data, at + 2) & 0x7f;
		stream.port = _byte(data, at + 3);
		stream.reg = _byte(data, at + 4);
	} else if (p_command == 0x91) {
		stream.step = MAX(1, _byte(data, at + 3));
	} else if (p_command == 0x92) {
		stream.frequency = _u32(data, at + 2);
	} else if (p_command == 0x93 || p_command == 0x95) {
		// Só o DAC do YM2612 (chip 2 da especificação); os outros chips não existem no Mega Drive.
		if (stream.chip != 0x02) {
			return;
		}
		if (p_command == 0x93) {
			const uint32_t offset = _u32(data, at + 2);
			const int mode = _byte(data, at + 6);
			const uint32_t length = _u32(data, at + 7);
			if (offset != 0xffffffff) {
				stream.position = offset;
			}
			const int kind = mode & 3;
			stream.length = kind == 1 ? int64_t(length) : (kind == 2 ? int64_t(Math::round(double(length) * stream.frequency / 1000)) : MAX(int64_t(0), int64_t(vgm->pcm.size()) - stream.position));
			stream.repeat = (mode & 0x80) != 0;
		} else {
			const int block = _u16(data, at + 2);
			if (block >= vgm->blocks.size()) {
				return;
			}
			stream.position = vgm->blocks[block].offset;
			stream.length = vgm->blocks[block].length;
			stream.repeat = (_byte(data, at + 4) & 1) != 0;
		}
		stream.begin = stream.position;
		stream.remaining = MAX(int64_t(1), stream.length);
		stream.active = true;
		stream.next = time;
	}
}

Vector<RetroChipWrite> retro_vgm_state_at(const RetroVgmFile &p_vgm, int64_t p_sample, RetroVgmCursor &r_cursor, bool p_loop) {
	r_cursor = RetroVgmCursor(&p_vgm, p_loop);
	// Valores do PSG ao ligar: tons em 0x3FF, ruído 0 e volumes no mínimo (15 = mudo).
	HashMap<int, RetroChipWrite> fm;
	Vector<int> fm_order;
	int psg[8] = { 0x3ff, 15, 0x3ff, 15, 0x3ff, 15, 0, 15 };
	int latched = 0;
	Vector<RetroVgmWrite> writes;
	r_cursor.run(p_sample, writes);
	for (const RetroVgmWrite &item : writes) {
		const RetroChipWrite &write = item.write;
		if (write.chip == 0) {
			if (write.address != 0x28 && write.address != 0x2a) {
				const int key = (write.port << 8) | write.address;
				if (!fm.has(key)) {
					fm_order.push_back(key);
				}
				fm[key] = write;
			}
			continue;
		}
		const int byte = write.data;
		if (byte & 0x80) {
			latched = (byte >> 4) & 7;
			psg[latched] = latched < 6 && !(latched & 1) ? (psg[latched] & 0x3f0) | (byte & 15) : byte & 15;
		} else if (latched < 6 && !(latched & 1)) {
			psg[latched] = (psg[latched] & 15) | ((byte & 0x3f) << 4);
		} else {
			psg[latched] = byte & 15;
		}
	}
	Vector<RetroChipWrite> result;
	for (const int key : fm_order) {
		result.push_back(fm[key]);
	}
	for (int channel = 0; channel < 7; channel++) {
		if ((channel & 3) != 3) {
			result.push_back(_fm(0, 0x28, channel));
		}
	}
	for (int reg = 0; reg < 8; reg++) {
		const int value = psg[reg];
		RetroChipWrite latch;
		latch.chip = 1;
		latch.data = 0x80 | (reg << 4) | (value & 15);
		result.push_back(latch);
		if (reg < 6 && !(reg & 1)) {
			RetroChipWrite high;
			high.chip = 1;
			high.data = (value >> 4) & 0x3f;
			result.push_back(high);
		}
	}
	return result;
}

String retro_format_seconds(double p_seconds) {
	const int value = MAX(0, int(Math::floor(p_seconds)));
	return itos(value / 60) + ":" + String::num_int64(value % 60).pad_zeros(2);
}
