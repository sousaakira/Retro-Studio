#pragma once

// Editor de efeitos sonoros com o timbre do PSG (SN76489): onda quadrada ou ruído, frequência e volume
// presos aos registradores do chip e atualizados 60 vezes por segundo, como um driver faria. O efeito é
// gravado como WAV em som/ (o jogo toca pelo XGM, como os outros sons: jogo_som, som_pulo...) e os
// parâmetros num .sfx.json ao lado, para editar depois. Projeto → Ferramentas → Efeitos sonoros (PSG).

#include "core/variant/dictionary.h"
#include "scene/gui/control.h"
#include "scene/main/window.h"

class AudioStreamPlayer;
class HSlider;
class Label;
class LineEdit;
class OptionButton;

struct RetroSfx {
	enum Onda {
		ONDA_QUADRADA,
		ONDA_RUIDO, // Ruído branco.
		ONDA_RUIDO_PERIODICO, // Zumbido metálico.
	};
	int onda = ONDA_QUADRADA;
	float freq_inicio = 440; // Hz.
	float freq_fim = 440; // Desliza até ela ao longo do efeito.
	int duracao = 200; // ms.
	int ataque = 0; // ms subindo o volume.
	int decaimento = 150; // ms descendo no fim.
	float volume = 1.0; // 0 a 1.
	float arpejo = 1.0; // A frequência é multiplicada por ele depois de arpejo_ms (moeda: 1,5).
	int arpejo_ms = 0;
	float vibrato = 0; // Semitons.
	float vibrato_hz = 8;

	static const int TAXA = 14000; // Amostras por segundo (a do XGM, como os outros WAV do jogo).
	static const char *const PRESETS[];

	Dictionary to_dict() const;
	static RetroSfx from_dict(const Dictionary &p_dict);
	static RetroSfx preset(const String &p_name);
	static RetroSfx aleatorio();
	Vector<int16_t> render() const;
	static PackedByteArray wav(const Vector<int16_t> &p_samples); // WAV de 8 bits, mono.
	// Grava <pasta>/<nome>.wav e <nome>.sfx.json; devolve o caminho do WAV ou vazio.
	String save(const String &p_dir, const String &p_name, String &r_error) const;
};

class RetroSfxWave : public Control {
	GDCLASS(RetroSfxWave, Control);

protected:
	void _notification(int p_what);

public:
	Vector<int16_t> samples;
};

class RetroSfxEditor : public Window {
	GDCLASS(RetroSfxEditor, Window);

	RetroSfx sfx;
	OptionButton *onda = nullptr;
	Vector<HSlider *> sliders;
	Vector<Label *> values;
	RetroSfxWave *wave = nullptr;
	LineEdit *name = nullptr;
	OptionButton *existing = nullptr;
	Label *status = nullptr;
	AudioStreamPlayer *player = nullptr;
	bool updating = false;

	void _preset(const String &p_name);
	void _random();
	void _slider_changed(double p_value, int p_index);
	void _onda_changed(int p_index);
	void _sync_controls();
	void _update_wave();
	void _play();
	void _save();
	void _refresh_existing();
	void _open_existing(int p_index);

protected:
	static void _bind_methods() {}

public:
	void open();
	RetroSfxEditor();
};
