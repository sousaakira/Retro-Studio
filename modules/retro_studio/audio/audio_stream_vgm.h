#pragma once

// VGM no editor: AudioStreamVGM toca o arquivo nos chips emulados (YM2612 + SN76489), e o
// carregador abre .vgm e .vgz como recurso de áudio. Assim o Sistema de Arquivos e o Inspetor tocam
// a música como ela vai soar no console. Porte do Retro Studio em Electron (shared/retro/vgmPlayback.js).
// Lê YM2612 + SN76489, samples do DAC (bloco 0x67, 0x80–0x8F, 0xE0) e streams do DAC (0x90–0x95);
// comandos de outros chips são pulados.

#include "retro_chips.h"

#include "core/io/resource_loader.h"
#include "core/templates/hash_map.h"
#include "servers/audio/audio_stream.h"

namespace RetroVgm {

static const int SAMPLE_RATE = 44100; // Unidade de tempo do VGM.

struct Write {
	int chip = 0; // 0 = YM2612 (porta, registrador, valor), 1 = PSG (valor).
	int port = 0, address = 0, value = 0;
};

struct Data {
	Vector<uint8_t> bytes;
	int64_t start = 0x40;
	double psg_clock = RetroChips::PSG_CLOCK_NTSC;
	double ym_clock = RetroChips::YM2612_CLOCK_NTSC;
	int64_t samples = 0;
	int64_t loop_offset = -1;
	int64_t loop_samples = 0;
	Vector<uint8_t> pcm; // Blocos de PCM do YM2612, juntos.
	Vector<Vector2i> blocks; // Início e tamanho de cada bloco em pcm.
	String title, game, author;
};

// Lê cabeçalho, tags GD3 e samples do DAC. Em arquivo que não serve, devolve o motivo.
String parse(const Vector<uint8_t> &p_bytes, Data &r_data);

// Percorre os comandos no tempo (44100 amostras por segundo, contando as voltas do loop).
class Cursor {
	struct Stream {
		int chip = 0, port = 0, address = 0x2a, step = 1;
		int64_t frequency = 0, position = 0, begin = 0, length = 0, remaining = 0;
		bool repeat = false, active = false;
		double next = 0;
	};

	const Data *data = nullptr;
	bool loop = false;
	int64_t index = 0, pcm_position = 0;
	HashMap<int, Stream> streams;

	template <typename F>
	void wait(int64_t p_samples, F &p_emit);
	void stream(int p_command);
	void finish();

public:
	int64_t time = 0;
	bool ended = false;
	int loops = 0;

	// Chama p_emit(tempo, escrita) até a amostra pedida.
	template <typename F>
	void run(int64_t p_until, F p_emit);

	Cursor() {}
	Cursor(const Data *p_data, bool p_loop);
};

} // namespace RetroVgm

class AudioStreamVGM : public AudioStream {
	GDCLASS(AudioStreamVGM, AudioStream);

	RetroVgm::Data vgm;
	bool loop = true;

protected:
	static void _bind_methods();

public:
	void set_data(const RetroVgm::Data &p_data) { vgm = p_data; }
	const RetroVgm::Data &get_data() const { return vgm; }
	void set_loop(bool p_loop) { loop = p_loop; }
	bool get_loop() const { return loop; }

	virtual Ref<AudioStreamPlayback> instantiate_playback() override;
	virtual String get_stream_name() const override;
	virtual double get_length() const override;
	virtual bool has_loop() const override { return loop && vgm.loop_offset >= 0; }
	virtual bool is_monophonic() const override { return true; }
};

class AudioStreamPlaybackVGM : public AudioStreamPlaybackResampled {
	GDCLASS(AudioStreamPlaybackVGM, AudioStreamPlaybackResampled);
	friend class AudioStreamVGM;

	struct Timed {
		int64_t time = 0;
		RetroVgm::Write write;
	};

	Ref<AudioStreamVGM> stream;
	RetroChips::Ym2612 fm;
	RetroChips::Sn76489 psg;
	RetroVgm::Cursor cursor;
	Vector<Timed> queue;
	int queue_head = 0;
	int64_t frame = 0;
	double fm_position = 0;
	float previous[2] = {}, current[2] = {};
	bool active = false;

	void _apply(const RetroVgm::Write &p_write);

protected:
	static void _bind_methods() {}
	virtual int _mix_internal(AudioFrame *p_buffer, int p_frames) override;
	virtual float get_stream_sampling_rate() override { return RetroVgm::SAMPLE_RATE; }

public:
	virtual void start(double p_from_pos = 0.0) override;
	virtual void stop() override;
	virtual bool is_playing() const override { return active; }
	virtual int get_loop_count() const override { return cursor.loops; }
	virtual double get_playback_position() const override;
	virtual void seek(double p_time) override;
};

class ResourceFormatLoaderVGM : public ResourceFormatLoader {
	GDSOFTCLASS(ResourceFormatLoaderVGM, ResourceFormatLoader);

public:
	virtual Ref<Resource> load(const String &p_path, const String &p_original_path = "", Error *r_error = nullptr, bool p_use_sub_threads = false, float *r_progress = nullptr, CacheMode p_cache_mode = CACHE_MODE_REUSE) override;
	virtual void get_recognized_extensions(List<String> *p_extensions) const override;
	virtual bool handles_type(const String &p_type) const override;
	virtual String get_resource_type(const String &p_path) const override;
};
