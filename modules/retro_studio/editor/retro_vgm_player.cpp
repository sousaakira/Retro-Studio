#include "retro_vgm_player.h"

#include "retro_map_ui.h"

#include "core/io/file_access.h"
#include "core/object/callable_mp.h"
#include "editor/settings/editor_settings.h"
#include "editor/themes/editor_scale.h"
#include "scene/audio/audio_stream_player.h"
#include "scene/gui/button.h"
#include "scene/gui/label.h"
#include "scene/gui/slider.h"
#include "scene/scene_string_names.h"

static constexpr double LOOKAHEAD = 0.3;
static constexpr double START_DELAY = 0.08;
static constexpr const char *VOLUME_SETTING = "retro_studio/music/vgm_volume";

void RetroVgmPlayer::_bind_methods() {
	ADD_SIGNAL(MethodInfo("changed"));
}

RetroVgmPlayer::RetroVgmPlayer() {
	singleton = this;
	engine.instantiate();
	engine->setup(1);
	EditorSettings *settings = EditorSettings::get_singleton();
	if (settings && settings->has_setting(VOLUME_SETTING)) {
		volume = CLAMP(float(settings->get_setting(VOLUME_SETTING)), 0.0f, 1.0f);
	}
	engine->volume = volume;
	player = memnew(AudioStreamPlayer);
	Ref<RetroChipStream> stream;
	stream.instantiate();
	stream->engine = engine;
	player->set_stream(stream);
	add_child(player);
}

RetroVgmPlayer::~RetroVgmPlayer() {
	if (singleton == this) {
		singleton = nullptr;
	}
}

void RetroVgmPlayer::_changed() {
	emit_signal(SNAME("changed"));
}

bool RetroVgmPlayer::play(const String &p_key, const String &p_name, const String &p_path) {
	stop();
	key = p_key;
	name = p_name;
	status = "error";
	Vector<uint8_t> bytes = FileAccess::get_file_as_bytes(p_path);
	if (bytes.size() > 16 * 1024 * 1024) {
		error = String::utf8("VGM maior que 16 MB.");
		_changed();
		return false;
	}
	String problem;
	if (RetroVgmFile::is_gzip(bytes)) {
		bytes = RetroVgmFile::gunzip(bytes, problem);
	}
	if (problem.is_empty()) {
		vgm = RetroVgmFile::parse(bytes, problem);
	}
	if (problem.is_empty() && !vgm.samples) {
		problem = String::utf8("O VGM não tem duração (arquivo vazio ou incompleto).");
	}
	if (!problem.is_empty()) {
		error = problem.is_empty() ? String::utf8("Não foi possível ler o VGM.") : problem;
		has_vgm = false;
		_changed();
		return false;
	}
	has_vgm = true;
	error = String();
	tags = vgm.tags;
	duration = vgm.seconds;
	loop_start = vgm.loop_offset >= 0 ? double(vgm.samples - vgm.loop_samples) / VGM_SAMPLE_RATE : 0;
	if (!player->is_playing()) {
		player->play();
	}
	player->set_stream_paused(false);
	_start_at(0);
	return true;
}

// Começa a tocar da amostra pedida (0 = início), com o estado dos chips daquele ponto.
void RetroVgmPlayer::_start_at(int64_t p_sample) {
	engine->clear(0);
	if (p_sample > 0) {
		const Vector<RetroChipWrite> writes = retro_vgm_state_at(vgm, p_sample, cursor);
		engine->push(0, writes);
	} else {
		cursor = RetroVgmCursor(&vgm);
	}
	origin_time = engine->get_time() + START_DELAY;
	origin_sample = cursor.time;
	scheduled_until = cursor.time;
	status = "playing";
	position = double(p_sample) / VGM_SAMPLE_RATE;
	set_process(true);
	_schedule();
	_changed();
}

void RetroVgmPlayer::_schedule() {
	if (!has_vgm || status != "playing") {
		return;
	}
	const double now = engine->get_time();
	const int64_t target = origin_sample + int64_t(Math::ceil((now + LOOKAHEAD - origin_time) * VGM_SAMPLE_RATE));
	if (target > scheduled_until) {
		Vector<RetroVgmWrite> writes;
		cursor.run(target, writes);
		scheduled_until = target;
		// Escritas do mesmo instante vão juntas.
		Vector<RetroChipWrite> batch;
		double batch_sample = -1;
		for (const RetroVgmWrite &item : writes) {
			if (item.sample != batch_sample && !batch.is_empty()) {
				engine->push(0, batch, origin_time + (batch_sample - origin_sample) / VGM_SAMPLE_RATE);
				batch.clear();
			}
			batch_sample = item.sample;
			batch.push_back(item.write);
		}
		if (!batch.is_empty()) {
			engine->push(0, batch, origin_time + (batch_sample - origin_sample) / VGM_SAMPLE_RATE);
		}
	}
	if (cursor.ended && now > origin_time + double(cursor.time - origin_sample) / VGM_SAMPLE_RATE + 0.2) {
		stop();
	}
}

void RetroVgmPlayer::_notification(int p_what) {
	if (p_what != NOTIFICATION_PROCESS || status != "playing" || !has_vgm) {
		return;
	}
	_schedule();
	if (status != "playing") {
		return;
	}
	// Posição mostrada: dentro da música, voltando para o início do loop a cada volta.
	const double sample = origin_sample + MAX(0.0, engine->get_time() - origin_time) * VGM_SAMPLE_RATE;
	const double total = vgm.samples, loop_begin = vgm.loop_offset >= 0 ? double(vgm.samples - vgm.loop_samples) : 0;
	const double inside = sample < total || vgm.loop_offset < 0 ? MIN(sample, total) : loop_begin + Math::fmod(sample - total, double(vgm.loop_samples));
	position = inside / VGM_SAMPLE_RATE;
	looped = sample >= total && vgm.loop_offset >= 0;
	_changed();
}

void RetroVgmPlayer::pause() {
	if (status != "playing") {
		return;
	}
	status = "paused";
	player->set_stream_paused(true); // O relógio do áudio para junto.
	set_process(false);
	_changed();
}

void RetroVgmPlayer::resume() {
	if (status != "paused") {
		return;
	}
	player->set_stream_paused(false);
	status = "playing";
	set_process(true);
	_changed();
}

// Vai para o ponto (segundos dentro da música) e continua tocando.
void RetroVgmPlayer::seek(double p_seconds) {
	if (!has_vgm || (status != "playing" && status != "paused")) {
		return;
	}
	player->set_stream_paused(false);
	_start_at(CLAMP(int64_t(Math::round(p_seconds * VGM_SAMPLE_RATE)), int64_t(0), int64_t(vgm.samples) - 1));
}

void RetroVgmPlayer::stop() {
	set_process(false);
	engine->clear(0);
	player->set_stream_paused(false);
	has_vgm = false;
	vgm = RetroVgmFile();
	cursor = RetroVgmCursor();
	status = "idle";
	key = String();
	name = String();
	tags = Dictionary();
	error = String();
	position = 0;
	duration = 0;
	loop_start = 0;
	looped = false;
	_changed();
}

// Para só se quem toca for a origem informada (uma tela fechando não cala a música de outra).
void RetroVgmPlayer::stop_if(const String &p_key) {
	if (key == p_key) {
		stop();
	}
}

void RetroVgmPlayer::set_volume(float p_volume) {
	volume = CLAMP(p_volume, 0.0f, 1.0f);
	engine->volume = volume;
	EditorSettings::get_singleton()->set_setting(VOLUME_SETTING, volume);
	_changed();
}

// ---- barra ----

RetroVgmBar::RetroVgmBar() {
	HBoxContainer *row = memnew(HBoxContainer);
	add_child(row);
	play_button = memnew(Button);
	play_button->set_custom_minimum_size(Size2(34, 0) * EDSCALE);
	play_button->connect(SceneStringName(pressed), callable_mp(this, &RetroVgmBar::_play));
	row->add_child(play_button);
	stop_button = memnew(Button);
	stop_button->set_text(U("■"));
	stop_button->set_tooltip_text("Parar");
	stop_button->connect(SceneStringName(pressed), callable_mp(this, &RetroVgmBar::_stop));
	row->add_child(stop_button);
	position_slider = memnew(HSlider);
	position_slider->set_step(0.1);
	position_slider->set_h_size_flags(SIZE_EXPAND_FILL);
	position_slider->set_v_size_flags(SIZE_SHRINK_CENTER);
	position_slider->set_custom_minimum_size(Size2(120, 0) * EDSCALE);
	position_slider->connect("drag_started", callable_mp(this, &RetroVgmBar::_drag_started));
	position_slider->connect("drag_ended", callable_mp(this, &RetroVgmBar::_drag_ended));
	row->add_child(position_slider);
	time_label = memnew(Label);
	row->add_child(time_label);
	volume_slider = memnew(HSlider);
	volume_slider->set_max(1);
	volume_slider->set_step(0.05);
	volume_slider->set_tooltip_text("Volume");
	volume_slider->set_custom_minimum_size(Size2(70, 0) * EDSCALE);
	volume_slider->set_v_size_flags(SIZE_SHRINK_CENTER);
	volume_slider->connect(SceneStringName(value_changed), callable_mp(this, &RetroVgmBar::_volume));
	row->add_child(volume_slider);
	details = memnew(Label);
	details->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	details->set_custom_minimum_size(Size2(260, 0) * EDSCALE); // Com largura, a altura do texto quebrado fica certa.
	details->set_modulate(Color(1, 1, 1, 0.6));
	add_child(details);
}

void RetroVgmBar::set_file(const String &p_key, const String &p_label, const String &p_path) {
	key = p_key;
	label = p_label;
	path = p_path;
	_update();
}

bool RetroVgmBar::_mine() const {
	return RetroVgmPlayer::singleton && !key.is_empty() && RetroVgmPlayer::singleton->key == key;
}

void RetroVgmBar::_notification(int p_what) {
	if (p_what == NOTIFICATION_ENTER_TREE && RetroVgmPlayer::singleton) {
		RetroVgmPlayer::singleton->connect("changed", callable_mp(this, &RetroVgmBar::_update));
		_update();
	} else if (p_what == NOTIFICATION_EXIT_TREE && RetroVgmPlayer::singleton) {
		RetroVgmPlayer::singleton->disconnect("changed", callable_mp(this, &RetroVgmBar::_update));
		if (stop_on_exit) {
			RetroVgmPlayer::singleton->stop_if(key);
		}
	}
}

void RetroVgmBar::_play() {
	RetroVgmPlayer *vgm = RetroVgmPlayer::singleton;
	if (!vgm) {
		return;
	}
	const String status = _mine() ? vgm->status : String("idle");
	if (status == "playing") {
		vgm->pause();
	} else if (status == "paused") {
		vgm->resume();
	} else {
		vgm->play(key, label, path);
	}
}

void RetroVgmBar::_stop() {
	if (_mine()) {
		RetroVgmPlayer::singleton->stop();
	}
}

void RetroVgmBar::_drag_started() {
	dragging = true;
}

void RetroVgmBar::_drag_ended(bool p_changed) {
	dragging = false;
	if (p_changed) {
		_seek(position_slider->get_value());
	}
}

void RetroVgmBar::_seek(double p_value) {
	if (_mine() && !updating) {
		RetroVgmPlayer::singleton->seek(position_slider->get_value());
	}
}

void RetroVgmBar::_volume(double p_value) {
	if (RetroVgmPlayer::singleton && !updating) {
		RetroVgmPlayer::singleton->set_volume(p_value);
	}
}

void RetroVgmBar::_update() {
	RetroVgmPlayer *vgm = RetroVgmPlayer::singleton;
	if (!vgm || !play_button) {
		return;
	}
	updating = true;
	const bool mine = _mine();
	const String status = mine ? vgm->status : String("idle");
	play_button->set_text(status == "playing" ? U("❚❚") : U("▶"));
	play_button->set_tooltip_text(status == "playing" ? String("Pausar") : String("Tocar o VGM"));
	play_button->set_disabled(path.is_empty());
	stop_button->set_disabled(!mine || status == "idle");
	position_slider->set_max(mine ? MAX(vgm->duration, 0.1) : 0.1);
	if (!dragging) {
		position_slider->set_value_no_signal(mine ? vgm->position : 0);
	}
	position_slider->set_editable(mine && (status == "playing" || status == "paused"));
	time_label->set_text((mine ? retro_format_seconds(vgm->position) : String("0:00")) + " / " + (mine && vgm->duration ? retro_format_seconds(vgm->duration) : U("–:––")));
	volume_slider->set_value_no_signal(vgm->volume);
	String text;
	if (mine && status == "error") {
		text = vgm->error;
	} else if (mine) {
		PackedStringArray parts;
		for (const char *field : { "title", "game", "author" }) {
			const String value = vgm->tags.get(field, "");
			if (!value.is_empty()) {
				parts.push_back(value);
			}
		}
		text = U(" · ").join(parts);
		if (vgm->duration && (vgm->loop_start || vgm->looped)) {
			text += (text.is_empty() ? String() : U(" · ")) + U("loop a partir de ") + retro_format_seconds(vgm->loop_start) + (vgm->looped ? U(" (repetindo)") : String());
		}
	}
	details->set_text(text);
	details->add_theme_color_override(SceneStringName(font_color), mine && status == "error" ? Color(1, 0.55, 0.5) : Color(1, 1, 1));
	details->set_visible(!text.is_empty());
	updating = false;
}
