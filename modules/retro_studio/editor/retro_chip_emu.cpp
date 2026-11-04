#include "retro_chip_emu.h"

#include "core/math/math_funcs.h"

namespace {

struct Tables {
	float sin_table[1024];
	float gain[1024]; // Atenuação em passos de 0,09375 dB (64 passos = 6 dB) → ganho linear.
	float volume[16]; // PSG: 2 dB por passo; 15 = mudo.
	Tables() {
		for (int i = 0; i < 1024; i++) {
			sin_table[i] = Math::sin((i + 0.5) * Math::PI / 512);
			gain[i] = Math::pow(2.0, -i / 64.0);
		}
		for (int i = 0; i < 16; i++) {
			volume[i] = i == 15 ? 0 : Math::pow(10.0, -i / 10.0);
		}
	}
};
const Tables &tables() {
	static Tables instance;
	return instance;
}

// Fração da nota (bits 10..7 do F-number) para o key code.
const int FKT[16] = { 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3 };
const int DETUNE[4][32] = {
	{ 0 },
	{ 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 8, 8 },
	{ 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 16, 16, 16 },
	{ 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 22, 22, 22, 22 },
};
// Incrementos do envelope por taxa: 8 ciclos por linha (taxas < 48 usam as 4 primeiras).
const int EG_INC[17][8] = {
	{ 0, 1, 0, 1, 0, 1, 0, 1 }, { 0, 1, 0, 1, 1, 1, 0, 1 }, { 0, 1, 1, 1, 0, 1, 1, 1 }, { 0, 1, 1, 1, 1, 1, 1, 1 },
	{ 1, 1, 1, 1, 1, 1, 1, 1 }, { 1, 1, 1, 2, 1, 1, 1, 2 }, { 1, 2, 1, 2, 1, 2, 1, 2 }, { 1, 2, 2, 2, 1, 2, 2, 2 },
	{ 2, 2, 2, 2, 2, 2, 2, 2 }, { 2, 2, 2, 4, 2, 2, 2, 4 }, { 2, 4, 2, 4, 2, 4, 2, 4 }, { 2, 4, 4, 4, 2, 4, 4, 4 },
	{ 4, 4, 4, 4, 4, 4, 4, 4 }, { 4, 4, 4, 8, 4, 4, 4, 8 }, { 4, 8, 4, 8, 4, 8, 4, 8 }, { 4, 8, 8, 8, 4, 8, 8, 8 }, { 8, 8, 8, 8, 8, 8, 8, 8 },
};
const double LFO_HZ[8] = { 3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2 };
const double AMS_DB[4] = { 0, 1.4, 5.9, 11.8 };
const double PMS_CENTS[8] = { 0, 3.4, 6.7, 10, 14, 20, 40, 80 };
// Ordem dos operadores nos registradores: +0 S1, +4 S3, +8 S2, +C S4 (os arrays usam S1..S4).
const int SLOT[4] = { 0, 2, 1, 3 };
enum { OFF = 0,
	ATTACK = 1,
	DECAY = 2,
	SUSTAIN = 3,
	RELEASE = 4 };
const int CARRIERS[8][4] = { { 3, -1 }, { 3, -1 }, { 3, -1 }, { 3, -1 }, { 1, 3, -1 }, { 1, 2, 3, -1 }, { 1, 2, 3, -1 }, { 0, 1, 2, 3 } };

} // namespace

RetroYM2612::RetroYM2612(int p_clock) {
	clock = p_clock;
	sample_rate = p_clock / 144.0;
	reset();
}

void RetroYM2612::reset() {
	for (Channel &channel : channels) {
		channel = Channel();
	}
	lfo_on = false;
	lfo_rate = 0;
	lfo_phase = 0;
	dac_on = false;
	dac = 0;
	eg_timer = 0;
	eg_counter = 0;
	left = right = 0;
	for (int port = 0; port < 2; port++) {
		for (int channel = 0; channel < 3; channel++) {
			write(port, 0xb4 + channel, 0xc0);
		}
	}
}

void RetroYM2612::write(int p_port, int p_address, int p_data) {
	const int port = p_port & 1, address = p_address & 0xff, data = p_data & 0xff;
	if (port == 0 && address < 0x30) {
		if (address == 0x22) {
			lfo_on = data & 8;
			lfo_rate = data & 7;
			if (!lfo_on) {
				lfo_phase = 0;
			}
		} else if (address == 0x28) {
			const int low = data & 7;
			if ((low & 3) == 3) {
				return;
			}
			Channel &channel = channels[(low & 3) + (low & 4 ? 3 : 0)];
			// Bits 4..7 ligam S1, S2, S3, S4.
			for (int slot = 0; slot < 4; slot++) {
				if (data & (0x10 << slot)) {
					_key_on(channel.ops[slot]);
				} else {
					_key_off(channel.ops[slot]);
				}
			}
		} else if (address == 0x2a) {
			dac = data;
		} else if (address == 0x2b) {
			dac_on = data & 0x80;
		}
		return;
	}
	const int index = address & 3;
	if (index == 3 || address < 0x30) {
		return;
	}
	Channel &channel = channels[index + port * 3];
	if (address < 0xa0) {
		Operator &op = channel.ops[SLOT[(address >> 2) & 3]];
		switch (address & 0xf0) {
			case 0x30:
				op.dt = (data >> 4) & 7;
				op.mul = data & 15;
				break;
			case 0x40:
				op.tl = data & 0x7f;
				break;
			case 0x50:
				op.ks = data >> 6;
				op.ar = data & 31;
				break;
			case 0x60:
				op.am = data >> 7;
				op.d1r = data & 31;
				break;
			case 0x70:
				op.d2r = data & 31;
				break;
			case 0x80:
				op.sl = data >> 4;
				op.rr = data & 15;
				break;
			case 0x90:
				op.ssg = data & 15;
				break;
		}
		_update_channel(channel);
		return;
	}
	switch (address & 0xfc) {
		case 0xa4:
			channel.latch = data & 0x3f;
			break;
		case 0xa0:
			channel.fnum = ((channel.latch & 7) << 8) | data;
			channel.block = (channel.latch >> 3) & 7;
			_update_channel(channel);
			break;
		case 0xb0:
			channel.fb = (data >> 3) & 7;
			channel.alg = data & 7;
			break;
		case 0xb4:
			channel.left = data & 0x80;
			channel.right = data & 0x40;
			channel.ams = (data >> 4) & 3;
			channel.pms = data & 7;
			break;
	}
}

void RetroYM2612::_update_channel(Channel &r_channel) {
	r_channel.kc = (r_channel.block << 2) | FKT[r_channel.fnum >> 7];
	const int base = (r_channel.fnum << r_channel.block) >> 1;
	for (Operator &op : r_channel.ops) {
		const int detune = DETUNE[op.dt & 3][r_channel.kc];
		const int fc = (base + (op.dt & 4 ? -detune : detune)) & 0x1ffff;
		op.inc = op.mul ? fc * op.mul : fc >> 1;
		op.ksr = r_channel.kc >> (3 - op.ks);
	}
}

void RetroYM2612::_key_on(Operator &r_op) {
	if (r_op.state != OFF && r_op.state != RELEASE) {
		return;
	}
	r_op.phase = 0;
	r_op.state = ATTACK;
	if (_rate(r_op, r_op.ar) >= 62) {
		r_op.att = 0;
		r_op.state = DECAY;
	}
}

void RetroYM2612::_key_off(Operator &r_op) {
	if (r_op.state != OFF) {
		r_op.state = RELEASE;
	}
}

int RetroYM2612::_rate(const Operator &p_op, int p_value) const {
	return p_value ? MIN(63, p_value * 2 + p_op.ksr) : 0;
}

void RetroYM2612::_envelope(Operator &r_op) {
	int rate;
	switch (r_op.state) {
		case ATTACK:
			rate = _rate(r_op, r_op.ar);
			break;
		case DECAY:
			rate = _rate(r_op, r_op.d1r);
			break;
		case SUSTAIN:
			rate = _rate(r_op, r_op.d2r);
			break;
		case RELEASE:
			rate = MIN(63, r_op.rr * 4 + 2 + r_op.ksr);
			break;
		default:
			return;
	}
	if (rate < 2) {
		return;
	}
	const int shift = rate < 48 ? 11 - (rate >> 2) : 0;
	if (eg_counter & ((1 << shift) - 1)) {
		return;
	}
	const int increment = EG_INC[rate < 48 ? rate & 3 : MIN(16, rate - 44)][(eg_counter >> shift) & 7];
	if (r_op.state == ATTACK) {
		if (rate >= 62) {
			r_op.att = 0;
		} else {
			r_op.att += (~r_op.att * increment) >> 4;
		}
		if (r_op.att <= 0) {
			r_op.att = 0;
			r_op.state = DECAY;
		}
		return;
	}
	r_op.att += increment;
	if (r_op.state == DECAY) {
		const int level = r_op.sl == 15 ? 1023 : r_op.sl << 5;
		if (r_op.att >= level) {
			r_op.att = level;
			r_op.state = SUSTAIN;
		}
	}
	if (r_op.att >= 1023) {
		r_op.att = 1023;
		if (r_op.state == RELEASE) {
			r_op.state = OFF;
		}
	}
}

float RetroYM2612::_operator(Operator &r_op, float p_modulation, int p_am, double p_pm) {
	const int attenuation = r_op.att + (r_op.tl << 3) + (r_op.am ? p_am : 0);
	const uint32_t phase = r_op.phase;
	r_op.phase = (phase + (p_pm == 1.0 ? r_op.inc : int(Math::round(r_op.inc * p_pm)))) & 0xfffff;
	if (attenuation >= 1024) {
		return r_op.out = 0;
	}
	return r_op.out = tables().sin_table[((phase >> 10) + int(p_modulation * 4096)) & 1023] * tables().gain[attenuation];
}

float RetroYM2612::_algorithm(Channel &r_channel, int p_am, double p_pm) {
	Operator &s1 = r_channel.ops[0], &s2 = r_channel.ops[1], &s3 = r_channel.ops[2], &s4 = r_channel.ops[3];
	// Feedback do S1: média das duas últimas saídas, 2^(fb+3) passos de fase por unidade.
	const float feedback = r_channel.fb ? (r_channel.fb0 + r_channel.fb1) * Math::pow(2.0, r_channel.fb - 9.0) : 0;
	r_channel.fb1 = r_channel.fb0;
	const float o1 = r_channel.fb0 = _operator(s1, feedback, p_am, p_pm);
	float o2, o3, o4;
	switch (r_channel.alg) {
		case 0:
			o2 = _operator(s2, o1, p_am, p_pm);
			o3 = _operator(s3, o2, p_am, p_pm);
			return _operator(s4, o3, p_am, p_pm);
		case 1:
			o2 = _operator(s2, 0, p_am, p_pm);
			o3 = _operator(s3, o1 + o2, p_am, p_pm);
			return _operator(s4, o3, p_am, p_pm);
		case 2:
			o2 = _operator(s2, 0, p_am, p_pm);
			o3 = _operator(s3, o2, p_am, p_pm);
			return _operator(s4, o1 + o3, p_am, p_pm);
		case 3:
			o2 = _operator(s2, o1, p_am, p_pm);
			o3 = _operator(s3, 0, p_am, p_pm);
			return _operator(s4, o2 + o3, p_am, p_pm);
		case 4:
			o2 = _operator(s2, o1, p_am, p_pm);
			o3 = _operator(s3, 0, p_am, p_pm);
			o4 = _operator(s4, o3, p_am, p_pm);
			return o2 + o4;
		case 5:
			o2 = _operator(s2, o1, p_am, p_pm);
			o3 = _operator(s3, o1, p_am, p_pm);
			o4 = _operator(s4, o1, p_am, p_pm);
			return o2 + o3 + o4;
		case 6:
			o2 = _operator(s2, o1, p_am, p_pm);
			o3 = _operator(s3, 0, p_am, p_pm);
			o4 = _operator(s4, 0, p_am, p_pm);
			return o2 + o3 + o4;
		default:
			o2 = _operator(s2, 0, p_am, p_pm);
			o3 = _operator(s3, 0, p_am, p_pm);
			o4 = _operator(s4, 0, p_am, p_pm);
			return o1 + o2 + o3 + o4;
	}
}

void RetroYM2612::step() {
	if (++eg_timer >= 3) {
		eg_timer = 0;
		eg_counter = (eg_counter + 1) & 0xfff;
		for (Channel &channel : channels) {
			for (Operator &op : channel.ops) {
				_envelope(op);
			}
		}
	}
	double lfo = 0, lfo_signed = 0;
	if (lfo_on) {
		lfo_phase = Math::fmod(lfo_phase + LFO_HZ[lfo_rate] / sample_rate, 1.0);
		lfo = lfo_phase < 0.5 ? lfo_phase * 2 : 2 - lfo_phase * 2;
		lfo_signed = Math::sin(lfo_phase * 2 * Math::PI);
	}
	float l = 0, r = 0;
	for (int index = 0; index < 6; index++) {
		Channel &channel = channels[index];
		float out;
		if (index == 5 && dac_on) {
			out = (dac - 128) / 128.0f;
		} else {
			const int am = channel.ams ? int(Math::round(lfo * AMS_DB[channel.ams] / 0.09375)) : 0;
			const double pm = channel.pms && lfo_on ? Math::pow(2.0, lfo_signed * PMS_CENTS[channel.pms] / 1200.0) : 1.0;
			out = _algorithm(channel, am, pm);
		}
		channel.out = out = CLAMP(out, -1.0f, 1.0f);
		if (channel.left) {
			l += out;
		}
		if (channel.right) {
			r += out;
		}
	}
	left = l;
	right = r;
}

uint8_t RetroYM2612::active_channels() const {
	uint8_t mask = 0;
	for (int index = 0; index < 6; index++) {
		const Channel &channel = channels[index];
		for (int c = 0; c < 4 && CARRIERS[channel.alg][c] >= 0; c++) {
			if (channel.ops[CARRIERS[channel.alg][c]].state != OFF) {
				mask |= 1 << index;
			}
		}
	}
	return mask;
}

// ---- PSG ----

RetroSN76489::RetroSN76489(int p_clock) {
	clock = p_clock;
	reset();
}

void RetroSN76489::reset() {
	for (int i = 0; i < 4; i++) {
		period[i] = i == 3 ? 0x10 : 0x3ff;
		volume[i] = 15;
		counter[i] = 0;
		output[i] = 1;
	}
	noise = 0;
	lfsr = 0x8000;
	latch = 0;
}

void RetroSN76489::write(int p_byte) {
	const int byte = p_byte & 0xff;
	if (byte & 0x80) {
		latch = (byte >> 4) & 7;
		const int channel = latch >> 1, data = byte & 15;
		if (latch & 1) {
			volume[channel] = data;
		} else if (channel == 3) {
			_set_noise(data);
		} else {
			period[channel] = (period[channel] & 0x3f0) | data;
		}
		return;
	}
	const int channel = latch >> 1;
	if (latch & 1) {
		volume[channel] = byte & 15;
	} else if (channel == 3) {
		_set_noise(byte & 7);
	} else {
		period[channel] = (period[channel] & 15) | ((byte & 0x3f) << 4);
	}
}

void RetroSN76489::_set_noise(int p_data) {
	noise = p_data & 7;
	lfsr = 0x8000;
	const int rate = p_data & 3;
	period[3] = rate == 3 ? 0 : 0x10 << rate;
}

float RetroSN76489::sample(double p_sample_rate) {
	const double ticks = clock / 16.0 / p_sample_rate;
	float mix = 0;
	for (int channel = 0; channel < 4; channel++) {
		const int channel_period = channel == 3 ? MAX(1, period[3] ? period[3] : period[2]) : period[channel];
		// Período 0 ou 1 deixa a saída parada em 1 (era assim que se tocava PCM no PSG).
		if (channel < 3 && channel_period <= 1) {
			mix += tables().volume[volume[channel]];
			continue;
		}
		double high = 0, remaining = ticks;
		double count = counter[channel] > 0 ? counter[channel] : channel_period;
		while (remaining > 0) {
			const double run = MIN(remaining, count);
			if (output[channel] > 0) {
				high += run;
			}
			count -= run;
			remaining -= run;
			if (count > 0) {
				continue;
			}
			count = channel_period;
			output[channel] = -output[channel];
			// O LFSR anda na subida do divisor de ruído.
			if (channel == 3 && output[3] > 0) {
				const int bit = noise & 4 ? (lfsr ^ (lfsr >> 3)) & 1 : lfsr & 1;
				lfsr = (lfsr >> 1) | (bit << 15);
			}
		}
		counter[channel] = count;
		// Fração do tempo em nível alto: suaviza notas agudas sem custo de filtro.
		const double level = channel < 3 ? high / ticks : (lfsr & 1);
		mix += tables().volume[volume[channel]] * (level * 2 - 1);
	}
	return mix;
}
