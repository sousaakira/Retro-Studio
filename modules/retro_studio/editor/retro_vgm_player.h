#pragma once

#include "retro_chip_stream.h"
#include "retro_vgm.h"

#include "scene/gui/box_container.h"
#include "scene/main/node.h"

class AudioStreamPlayer;
class Button;
class HSlider;
class Label;

// #103: player de VGM da IDE (porte de src/audio/vgmPlayer.js) — um só para todas as telas (tocar outra
// música para a anterior). Os comandos do arquivo viram escritas agendadas no relógio do áudio e tocam
// no mesmo YM2612 + PSG emulados do compositor, num par de chips próprio.
class RetroVgmPlayer : public Node {
	GDCLASS(RetroVgmPlayer, Node)

	AudioStreamPlayer *player = nullptr;
	Ref<RetroChipEngine> engine;
	RetroVgmFile vgm;
	RetroVgmCursor cursor;
	bool has_vgm = false;
	double origin_time = 0; // A amostra origin_sample toca em origin_time (relógio do áudio).
	int64_t origin_sample = 0;
	int64_t scheduled_until = 0;

	void _start_at(int64_t p_sample);
	void _schedule();
	void _changed();

protected:
	void _notification(int p_what);
	static void _bind_methods();

public:
	inline static RetroVgmPlayer *singleton = nullptr;

	String status = "idle"; // idle, playing, paused, error
	String key; // Quem está tocando (caminho do arquivo); as telas comparam com o seu.
	String name;
	Dictionary tags;
	String error;
	double position = 0;
	double duration = 0;
	double loop_start = 0;
	bool looped = false;
	float volume = 0.8;

	// p_path: arquivo .vgm/.vgz no disco.
	bool play(const String &p_key, const String &p_name, const String &p_path);
	void pause();
	void resume();
	void seek(double p_seconds);
	void stop();
	void stop_if(const String &p_key);
	void set_volume(float p_volume);

	RetroVgmPlayer();
	~RetroVgmPlayer();
};

// Barra do player para um arquivo do projeto (porte de VgmPlayer.vue). O som é o dos chips emulados do
// compositor: parecido com o Mega Drive, bom para reconhecer a música (não é idêntico ao console).
class RetroVgmBar : public VBoxContainer {
	GDCLASS(RetroVgmBar, VBoxContainer)

	Button *play_button = nullptr;
	Button *stop_button = nullptr;
	HSlider *position_slider = nullptr;
	Label *time_label = nullptr;
	HSlider *volume_slider = nullptr;
	Label *details = nullptr;
	bool updating = false;
	bool dragging = false;

	void _drag_started();
	void _drag_ended(bool p_changed);

	bool _mine() const;
	void _play();
	void _stop();
	void _seek(double p_value);
	void _volume(double p_value);
	void _update();

protected:
	void _notification(int p_what);

public:
	String key;
	String label;
	String path; // Arquivo no disco.
	bool stop_on_exit = true;

	void set_file(const String &p_key, const String &p_label, const String &p_path);
	RetroVgmBar();
};
