#pragma once

#include "retro_chip_driver.h"

#include "core/templates/hash_map.h"
#include "core/variant/dictionary.h"

// #103: leitura de VGM para tocar na IDE (porte de shared/retro/vgmPlayback.js) — arquivos do compositor
// e de outros programas (Furnace, DefleMask, ripados de jogos). YM2612 + SN76489, samples do DAC (bloco
// 0x67, 0x80–0x8F, 0xE0) e streams do DAC (0x90–0x95). Comandos de outros chips são pulados.
static constexpr int VGM_SAMPLE_RATE = 44100;

struct RetroVgmFile {
	struct Block {
		int offset = 0;
		int length = 0;
	};
	Vector<uint8_t> data;
	uint32_t version = 0;
	int start = 0x40;
	uint32_t psg_clock = 0;
	uint32_t ym_clock = 0;
	uint32_t samples = 0;
	int loop_offset = -1; // -1 = sem loop.
	uint32_t loop_samples = 0;
	Dictionary tags; // title, game, author…
	Vector<uint8_t> pcm;
	Vector<Block> blocks;
	double seconds = 0;
	double loop_seconds = 0;

	static bool is_gzip(const Vector<uint8_t> &p_bytes) { return p_bytes.size() > 2 && p_bytes[0] == 0x1f && p_bytes[1] == 0x8b; }
	// VGZ → VGM. r_error vazio = ok.
	static Vector<uint8_t> gunzip(const Vector<uint8_t> &p_bytes, String &r_error);
	// Cabeçalho, tags GD3 e samples do DAC. Erro em arquivo que não é VGM e em comando desconhecido.
	static RetroVgmFile parse(const Vector<uint8_t> &p_bytes, String &r_error);
};

struct RetroVgmWrite {
	double sample = 0; // 44100 por segundo, contando as voltas do loop (streams caem entre amostras).
	RetroChipWrite write;
};

// Percorre os comandos no tempo. run(até) acrescenta as escritas até a amostra pedida. Sem loop, `ended`.
class RetroVgmCursor {
	struct Stream {
		int chip = 0, port = 0, reg = 0x2a, step = 1;
		uint32_t frequency = 0;
		int64_t position = 0, begin = 0, length = 0, remaining = 0;
		bool repeat = false, active = false;
		double next = 0;
	};
	const RetroVgmFile *vgm = nullptr;
	HashMap<int, Stream> streams;
	Vector<int> stream_order; // Ordem de criação (como o Map do JS).

	void _emit(Vector<RetroVgmWrite> &r_out, double p_sample, const RetroChipWrite &p_write) const;
	void _wait(int p_samples, Vector<RetroVgmWrite> &r_out);
	void _stream(int p_command);
	void _finish();

public:
	bool loop = true;
	int index = 0;
	int64_t time = 0;
	int64_t pcm_position = 0;
	bool ended = false;
	int loops = 0;

	void run(int64_t p_until, Vector<RetroVgmWrite> &r_out);
	RetroVgmCursor(const RetroVgmFile *p_vgm = nullptr, bool p_loop = true);
};

// Estado dos chips num ponto da música, para começar a tocar dali: os últimos valores dos registradores
// do FM (sem key on e sem o DAC) e do PSG, como escritas.
Vector<RetroChipWrite> retro_vgm_state_at(const RetroVgmFile &p_vgm, int64_t p_sample, RetroVgmCursor &r_cursor, bool p_loop = true);
String retro_format_seconds(double p_seconds); // m:ss
