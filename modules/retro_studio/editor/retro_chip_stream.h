#pragma once

#include "retro_chip_driver.h"
#include "retro_chip_emu.h"

#include "core/os/mutex.h"
#include "core/templates/list.h"
#include "servers/audio/audio_stream.h"

// #89: o "AudioWorklet" do compositor (porte de src/audio/chipWorklet.js): YM2612 + PSG emulados
// recebendo escritas de registrador. Dois pares de chips: 0 toca a música (escritas agendadas no
// relógio do áudio, precisas à amostra) e 1 toca o teclado ao vivo, para gravar por cima sem as vozes
// disputarem canais. O FM roda na taxa nativa (clock/144 ≈ 53 kHz) e é reamostrado (interpolação linear).
class RetroChipEngine : public RefCounted {
	GDCLASS(RetroChipEngine, RefCounted)

	struct Batch {
		int64_t frame = -1; // -1 = já.
		Vector<RetroChipWrite> writes;
	};
	struct Chips {
		RetroYM2612 fm;
		RetroSN76489 psg;
		double position = 0;
		float previous[2] = {};
		float current[2] = {};
		List<Batch> queue;
	};
	Chips chips[2];
	int count = 2;
	Mutex mutex;
	int64_t frames_mixed = 0;
	double mix_rate = 44100;
	uint8_t active[2] = {};
	struct Click {
		int64_t frame = 0;
		float frequency = 0;
		float amplitude = 0;
	};
	Vector<Click> clicks;

	static void _apply(Chips &r_chips, const Vector<RetroChipWrite> &p_writes);

public:
	float volume = 0.8;

	// p_chips 1: um par só (player de VGM).
	void setup(int p_chips);
	// Escritas no par p_chip, já (p_at < 0) ou no instante p_at (segundos do relógio do áudio).
	void push(int p_chip, const Vector<RetroChipWrite> &p_writes, double p_at = -1);
	void clear(int p_chip);
	// Batida do metrônomo no instante p_at (senoide curta; a do compasso é mais aguda e forte).
	void click(double p_at, bool p_accent);
	double get_time() const; // Relógio do áudio (segundos misturados).
	uint8_t get_active(int p_chip) const { return active[CLAMP(p_chip, 0, 1)]; }
	void mix(AudioFrame *p_buffer, int p_frames, double p_mix_rate);
};

class RetroChipPlayback : public AudioStreamPlayback {
	GDCLASS(RetroChipPlayback, AudioStreamPlayback)

public:
	Ref<RetroChipEngine> engine;
	bool active = false;

	virtual void start(double p_from_pos = 0.0) override { active = true; }
	virtual void stop() override { active = false; }
	virtual bool is_playing() const override { return active; }
	virtual int get_loop_count() const override { return 0; }
	virtual double get_playback_position() const override { return engine.is_valid() ? engine->get_time() : 0.0; }
	virtual void seek(double p_time) override {}
	virtual int mix(AudioFrame *p_buffer, float p_rate_scale, int p_frames) override;
};

class RetroChipStream : public AudioStream {
	GDCLASS(RetroChipStream, AudioStream)

public:
	Ref<RetroChipEngine> engine;
	virtual Ref<AudioStreamPlayback> instantiate_playback() override;
	virtual String get_stream_name() const override { return "RetroChipStream"; }
	virtual double get_length() const override { return 0; }
	virtual bool is_monophonic() const override { return true; }
};
