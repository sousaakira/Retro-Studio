#include "retro_chips.h"

#include "core/math/math_funcs.h"
#include "core/typedefs.h"

namespace RetroChips {

namespace {

enum EnvelopeState {
	OFF,
	ATTACK,
	DECAY,
	SUSTAIN,
	RELEASE,
};

struct Tables {
	float sine[1024];
	float gain[1024]; // Atenuação em passos de 0,09375 dB (64 passos = 6 dB) → ganho linear.
	float psg_volume[16]; // 16 passos de 2 dB; o 15 é mudo.
	Tables() {
		for (int i = 0; i < 1024; i++) {
			sine[i] = Math::sin((i + 0.5) * Math::PI / 512);
			gain[i] = Math::pow(2.0, -i / 64.0);
		}
		for (int i = 0; i < 16; i++) {
			psg_volume[i] = i == 15 ? 0 : Math::pow(10.0, -i / 10.0);
		}
	}
};

const Tables &tables() {
	static Tables t;
	return t;
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
	{ 4, 4, 4, 4, 4, 4, 4, 4 }, { 4, 4, 4, 8, 4, 4, 4, 8 }, { 4, 8, 4, 8, 4, 8, 4, 8 }, { 4, 8, 8, 8, 4, 8, 8, 8 },
	{ 8, 8, 8, 8, 8, 8, 8, 8 },
};
const double LFO_HZ[8] = { 3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2 };
const double AMS_DB[4] = { 0, 1.4, 5.9, 11.8 };
const double PMS_CENTS[8] = { 0, 3.4, 6.7, 10, 14, 20, 40, 80 };
// Ordem dos operadores nos registradores: +0 S1, +4 S3, +8 S2, +C S4 (os arrays usam S1..S4).
const int SLOT[4] = { 0, 2, 1, 3 };

} // namespace

// ---- YM2612 ----

Ym2612::Ym2612(double p_clock) {
	clock = p_clock;
	sample_rate = p_clock / 144;
	reset();
}

void Ym2612::reset() {
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

void Ym2612::write(int p_port, int p_address, int p_data) {
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
					key_on(channel.ops[slot]);
				} else {
					key_off(channel.ops[slot]);
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
		update_channel(channel);
		return;
	}
	switch (address & 0xfc) {
		case 0xa4:
			channel.latch = data & 0x3f;
			break;
		case 0xa0:
			channel.fnum = ((channel.latch & 7) << 8) | data;
			channel.block = (channel.latch >> 3) & 7;
			update_channel(channel);
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

void Ym2612::update_channel(Channel &p_channel) {
	p_channel.kc = (p_channel.block << 2) | FKT[p_channel.fnum >> 7];
	const int base = (p_channel.fnum << p_channel.block) >> 1;
	for (Operator &op : p_channel.ops) {
		const int detune = DETUNE[op.dt & 3][p_channel.kc];
		const int fc = (base + (op.dt & 4 ? -detune : detune)) & 0x1ffff;
		op.inc = op.mul ? fc * op.mul : fc >> 1;
		op.ksr = p_channel.kc >> (3 - op.ks);
	}
}

void Ym2612::key_on(Operator &p_op) {
	if (p_op.state != OFF && p_op.state != RELEASE) {
		return;
	}
	p_op.phase = 0;
	p_op.state = ATTACK;
	if (rate(p_op, p_op.ar) >= 62) {
		p_op.att = 0;
		p_op.state = DECAY;
	}
}

void Ym2612::key_off(Operator &p_op) {
	if (p_op.state != OFF) {
		p_op.state = RELEASE;
	}
}

int Ym2612::rate(const Operator &p_op, int p_value) {
	return p_value ? MIN(63, p_value * 2 + p_op.ksr) : 0;
}

void Ym2612::envelope(Operator &p_op) {
	int r;
	switch (p_op.state) {
		case ATTACK:
			r = rate(p_op, p_op.ar);
			break;
		case DECAY:
			r = rate(p_op, p_op.d1r);
			break;
		case SUSTAIN:
			r = rate(p_op, p_op.d2r);
			break;
		case RELEASE:
			r = MIN(63, p_op.rr * 4 + 2 + p_op.ksr);
			break;
		default:
			return;
	}
	if (r < 2) {
		return;
	}
	const int shift = r < 48 ? 11 - (r >> 2) : 0;
	if (eg_counter & ((1 << shift) - 1)) {
		return;
	}
	const int increment = EG_INC[r < 48 ? r & 3 : MIN(16, r - 44)][(eg_counter >> shift) & 7];
	if (p_op.state == ATTACK) {
		if (r >= 62) {
			p_op.att = 0;
		} else {
			p_op.att += (~p_op.att * increment) >> 4;
		}
		if (p_op.att <= 0) {
			p_op.att = 0;
			p_op.state = DECAY;
		}
		return;
	}
	p_op.att += increment;
	if (p_op.state == DECAY) {
		const int level = p_op.sl == 15 ? 1023 : p_op.sl << 5;
		if (p_op.att >= level) {
			p_op.att = level;
			p_op.state = SUSTAIN;
		}
	}
	if (p_op.att >= 1023) {
		p_op.att = 1023;
		if (p_op.state == RELEASE) {
			p_op.state = OFF;
		}
	}
}

float Ym2612::run_operator(Operator &p_op, float p_modulation, int p_am, double p_pm) {
	const int attenuation = p_op.att + (p_op.tl << 3) + (p_op.am ? p_am : 0);
	const int phase = p_op.phase;
	p_op.phase = (phase + (p_pm == 1 ? p_op.inc : int(Math::round(p_op.inc * p_pm)))) & 0xfffff;
	if (attenuation >= 1024) {
		return p_op.out = 0;
	}
	return p_op.out = tables().sine[((phase >> 10) + int(p_modulation * 4096)) & 1023] * tables().gain[attenuation];
}

void Ym2612::step() {
	if (++eg_timer >= 3) {
		eg_timer = 0;
		eg_counter = (eg_counter + 1) & 0xfff;
		for (Channel &channel : channels) {
			for (Operator &op : channel.ops) {
				envelope(op);
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
			const double pm = channel.pms && lfo_on ? Math::pow(2.0, lfo_signed * PMS_CENTS[channel.pms] / 1200) : 1;
			out = algorithm(channel, am, pm);
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

float Ym2612::algorithm(Channel &p_channel, int p_am, double p_pm) {
	Operator *s = p_channel.ops;
	// Feedback do S1: média das duas últimas saídas, 2^(fb+3) passos de fase por unidade.
	const float feedback = p_channel.fb ? (p_channel.fb0 + p_channel.fb1) * Math::pow(2.0f, float(p_channel.fb - 9)) : 0;
	p_channel.fb1 = p_channel.fb0;
	const float o1 = p_channel.fb0 = run_operator(s[0], feedback, p_am, p_pm);
	float o2, o3, o4;
	switch (p_channel.alg) {
		case 0:
			o2 = run_operator(s[1], o1, p_am, p_pm);
			o3 = run_operator(s[2], o2, p_am, p_pm);
			return run_operator(s[3], o3, p_am, p_pm);
		case 1:
			o2 = run_operator(s[1], 0, p_am, p_pm);
			o3 = run_operator(s[2], o1 + o2, p_am, p_pm);
			return run_operator(s[3], o3, p_am, p_pm);
		case 2:
			o2 = run_operator(s[1], 0, p_am, p_pm);
			o3 = run_operator(s[2], o2, p_am, p_pm);
			return run_operator(s[3], o1 + o3, p_am, p_pm);
		case 3:
			o2 = run_operator(s[1], o1, p_am, p_pm);
			o3 = run_operator(s[2], 0, p_am, p_pm);
			return run_operator(s[3], o2 + o3, p_am, p_pm);
		case 4:
			o2 = run_operator(s[1], o1, p_am, p_pm);
			o3 = run_operator(s[2], 0, p_am, p_pm);
			o4 = run_operator(s[3], o3, p_am, p_pm);
			return o2 + o4;
		case 5:
			o2 = run_operator(s[1], o1, p_am, p_pm);
			o3 = run_operator(s[2], o1, p_am, p_pm);
			o4 = run_operator(s[3], o1, p_am, p_pm);
			return o2 + o3 + o4;
		case 6:
			o2 = run_operator(s[1], o1, p_am, p_pm);
			o3 = run_operator(s[2], 0, p_am, p_pm);
			o4 = run_operator(s[3], 0, p_am, p_pm);
			return o2 + o3 + o4;
		default:
			return o1 + run_operator(s[1], 0, p_am, p_pm) + run_operator(s[2], 0, p_am, p_pm) + run_operator(s[3], 0, p_am, p_pm);
	}
}

// ---- SN76489 ----

Sn76489::Sn76489(double p_clock) {
	clock = p_clock;
	reset();
}

void Sn76489::reset() {
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

void Sn76489::write(int p_byte) {
	const int byte = p_byte & 0xff;
	if (byte & 0x80) {
		latch = (byte >> 4) & 7;
		const int channel = latch >> 1, data = byte & 15;
		if (latch & 1) {
			volume[channel] = data;
		} else if (channel == 3) {
			set_noise(data);
		} else {
			period[channel] = (period[channel] & 0x3f0) | data;
		}
		return;
	}
	const int channel = latch >> 1;
	if (latch & 1) {
		volume[channel] = byte & 15;
	} else if (channel == 3) {
		set_noise(byte & 7);
	} else {
		period[channel] = (period[channel] & 15) | ((byte & 0x3f) << 4);
	}
}

void Sn76489::set_noise(int p_data) {
	noise = p_data & 7;
	lfsr = 0x8000;
	const int r = p_data & 3;
	period[3] = r == 3 ? 0 : 0x10 << r;
}

float Sn76489::sample(double p_sample_rate) {
	const double ticks = clock / 16 / p_sample_rate;
	float mix = 0;
	for (int channel = 0; channel < 4; channel++) {
		const int p = channel == 3 ? MAX(1, period[3] ? period[3] : period[2]) : period[channel];
		// Período 0 ou 1 deixa a saída parada em 1 (era assim que se tocava PCM no PSG).
		if (channel < 3 && p <= 1) {
			mix += tables().psg_volume[volume[channel]];
			continue;
		}
		double high = 0, remaining = ticks, c = counter[channel] > 0 ? counter[channel] : p;
		while (remaining > 0) {
			const double run = MIN(remaining, c);
			if (output[channel] > 0) {
				high += run;
			}
			c -= run;
			remaining -= run;
			if (c > 0) {
				continue;
			}
			c = p;
			output[channel] = -output[channel];
			// O LFSR anda na subida do divisor de ruído (taps 0 e 3, como no VDP da Sega).
			if (channel == 3 && output[3] > 0) {
				const int bit = noise & 4 ? (lfsr ^ (lfsr >> 3)) & 1 : lfsr & 1;
				lfsr = (lfsr >> 1) | (bit << 15);
			}
		}
		counter[channel] = c;
		// Fração do tempo em nível alto: suaviza notas agudas sem custo de filtro.
		const double level = channel < 3 ? high / ticks : (lfsr & 1);
		mix += tables().psg_volume[volume[channel]] * float(level * 2 - 1);
	}
	return mix;
}

} // namespace RetroChips
