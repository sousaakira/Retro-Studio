#pragma once

// Chips de som do Mega Drive emulados para ouvir no editor: YM2612 (FM) e SN76489 (PSG). Porte do
// Retro Studio em Electron (shared/retro/ym2612.js e sn76489.js), com o mesmo comportamento.
// YM2612: 6 canais, 8 algoritmos, feedback, envelope ADSR com as taxas do chip, detune,
// multiplicador, key scaling, LFO (AM/PM), pan e DAC do canal 6. Fora: SSG-EG, modo especial do
// canal 3, timers e o "ladder effect" do DAC.

#include <cstdint>

namespace RetroChips {

static const double YM2612_CLOCK_NTSC = 7670453;
static const double PSG_CLOCK_NTSC = 3579545;

class Ym2612 {
public:
	struct Operator {
		int dt = 0, mul = 1, tl = 0, ks = 0, ar = 0, am = 0, d1r = 0, d2r = 0, sl = 0, rr = 0, ssg = 0;
		int phase = 0, inc = 0, att = 1023, state = 0, ksr = 0;
		float out = 0;
	};
	struct Channel {
		Operator ops[4];
		int fnum = 0, block = 0, latch = 0, kc = 0, alg = 0, fb = 0, ams = 0, pms = 0;
		bool left = true, right = true;
		float fb0 = 0, fb1 = 0, out = 0;
	};

	double clock = YM2612_CLOCK_NTSC;
	double sample_rate = YM2612_CLOCK_NTSC / 144; // Um passo do chip.
	float left = 0, right = 0; // Saída do último passo (cerca de ±1 por canal).

	void reset();
	void write(int p_port, int p_address, int p_data);
	// Um passo do chip (clock/144 Hz).
	void step();

	explicit Ym2612(double p_clock = YM2612_CLOCK_NTSC);

private:
	Channel channels[6];
	bool lfo_on = false, dac_on = false;
	int lfo_rate = 0, dac = 0, eg_timer = 0, eg_counter = 0;
	double lfo_phase = 0;

	void update_channel(Channel &p_channel);
	void key_on(Operator &p_op);
	static void key_off(Operator &p_op);
	static int rate(const Operator &p_op, int p_value);
	void envelope(Operator &p_op);
	static float run_operator(Operator &p_op, float p_modulation, int p_am, double p_pm);
	float algorithm(Channel &p_channel, int p_am, double p_pm);
};

class Sn76489 {
public:
	double clock = PSG_CLOCK_NTSC;

	void reset();
	// Um byte como o 68000/Z80 escreve na porta do PSG.
	void write(int p_byte);
	// Avança o chip por 1/sample_rate s e devolve a saída mono (cerca de 0..1 por canal).
	float sample(double p_sample_rate);

	explicit Sn76489(double p_clock = PSG_CLOCK_NTSC);

private:
	int period[4], volume[4], output[4], noise = 0, lfsr = 0x8000, latch = 0;
	double counter[4];

	void set_noise(int p_data);
};

} // namespace RetroChips
