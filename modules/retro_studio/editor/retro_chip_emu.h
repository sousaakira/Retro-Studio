#pragma once

#include "core/typedefs.h"

#include <cstdint>

// #89: chips de som do Mega Drive emulados por registradores, porte de shared/retro/ym2612.js e
// sn76489.js do Retro Studio atual (a mesma emulação que o compositor usa para ouvir o que vai para
// o VGM). Fiel no que importa para compor: 6 canais FM, 8 algoritmos, feedback, envelope com as taxas
// do chip, detune, multiplicador, key scaling, LFO (AM/PM), pan e DAC do canal 6. Fora: SSG-EG, modo
// especial do canal 3, timers e o "ladder effect".

static constexpr int YM2612_CLOCK_NTSC = 7670453;
static constexpr int YM2612_CLOCK_PAL = 7600489;
static constexpr int PSG_CLOCK_NTSC = 3579545;
static constexpr int PSG_CLOCK_PAL = 3546893;

class RetroYM2612 {
public:
	struct Operator {
		int dt = 0, mul = 1, tl = 0, ks = 0, ar = 0, am = 0, d1r = 0, d2r = 0, sl = 0, rr = 0, ssg = 0;
		uint32_t phase = 0;
		int inc = 0;
		int att = 1023;
		int state = 0;
		float out = 0;
		int ksr = 0;
	};
	struct Channel {
		Operator ops[4];
		int fnum = 0, block = 0, latch = 0, kc = 0, alg = 0, fb = 0, ams = 0, pms = 0;
		bool left = true, right = true;
		float fb0 = 0, fb1 = 0, out = 0;
	};

private:
	Channel channels[6];
	bool lfo_on = false;
	int lfo_rate = 0;
	double lfo_phase = 0;
	bool dac_on = false;
	int dac = 0;
	int eg_timer = 0;
	int eg_counter = 0;

	void _update_channel(Channel &r_channel);
	void _key_on(Operator &r_op);
	void _key_off(Operator &r_op);
	int _rate(const Operator &p_op, int p_value) const;
	void _envelope(Operator &r_op);
	float _operator(Operator &r_op, float p_modulation, int p_am, double p_pm);
	float _algorithm(Channel &r_channel, int p_am, double p_pm);

public:
	int clock = YM2612_CLOCK_NTSC;
	double sample_rate = YM2612_CLOCK_NTSC / 144.0;
	float left = 0, right = 0;

	void reset();
	void write(int p_port, int p_address, int p_data);
	// Um passo do chip (clock/144 Hz); a saída fica em left/right (cerca de ±1 por canal).
	void step();
	// Canais com algum operador que soa ainda ativo (bit por canal).
	uint8_t active_channels() const;

	RetroYM2612(int p_clock = YM2612_CLOCK_NTSC);
};

// PSG do Mega Drive (SN76489 dentro do VDP): 3 canais de onda quadrada e 1 de ruído, volume em 16
// passos de 2 dB, ruído com LFSR de 16 bits (taps 0 e 3, como no VDP da Sega).
class RetroSN76489 {
	int period[4] = { 0x3ff, 0x3ff, 0x3ff, 0x10 };
	int volume[4] = { 15, 15, 15, 15 };
	double counter[4] = {};
	int output[4] = { 1, 1, 1, 1 };
	int noise = 0;
	int lfsr = 0x8000;
	int latch = 0;
	void _set_noise(int p_data);

public:
	int clock = PSG_CLOCK_NTSC;
	void reset();
	// Um byte como o 68000/Z80 escreve na porta do PSG.
	void write(int p_byte);
	// Avança o chip por 1/sample_rate s; devolve a saída mono (cerca de 0..1 por canal).
	float sample(double p_sample_rate);
	RetroSN76489(int p_clock = PSG_CLOCK_NTSC);
};
