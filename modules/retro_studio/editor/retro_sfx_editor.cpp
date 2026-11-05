#include "retro_sfx_editor.h"

#include "core/config/project_settings.h"
#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/math/random_number_generator.h"
#include "core/object/callable_mp.h"
#include "editor/editor_node.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/gui/editor_toaster.h"
#include "editor/themes/editor_scale.h"
#include "scene/audio/audio_stream_player.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/flow_container.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/label.h"
#include "scene/gui/line_edit.h"
#include "scene/gui/option_button.h"
#include "scene/gui/panel_container.h"
#include "scene/gui/separator.h"
#include "scene/gui/slider.h"
#include "scene/resources/audio_stream_wav.h"

namespace {
String U(const char *p_text) {
	return String::utf8(p_text);
}

const double PSG_CLOCK = 3579545.0; // NTSC.

// Os parâmetros com controle deslizante, na ordem da tela.
struct SliderInfo {
	const char *label;
	double min, max, step;
	const char *suffix;
};
const SliderInfo SLIDERS[] = {
	{ "Frequência no começo", 60, 4000, 1, "Hz" },
	{ "Frequência no fim", 60, 4000, 1, "Hz" },
	{ "Duração", 20, 2000, 10, "ms" },
	{ "Ataque", 0, 1000, 10, "ms" },
	{ "Decaimento", 0, 2000, 10, "ms" },
	{ "Volume", 0, 100, 1, "%" },
	{ "Arpejo (multiplica a frequência)", 0.5, 2.5, 0.01, "×" },
	{ "Arpejo depois de", 0, 1000, 10, "ms" },
	{ "Vibrato", 0, 12, 0.1, "semitons" },
	{ "Velocidade do vibrato", 1, 40, 0.5, "Hz" },
};
const int SLIDER_COUNT = sizeof(SLIDERS) / sizeof(SLIDERS[0]);

double get_param(const RetroSfx &p_sfx, int p_index) {
	switch (p_index) {
		case 0:
			return p_sfx.freq_inicio;
		case 1:
			return p_sfx.freq_fim;
		case 2:
			return p_sfx.duracao;
		case 3:
			return p_sfx.ataque;
		case 4:
			return p_sfx.decaimento;
		case 5:
			return p_sfx.volume * 100;
		case 6:
			return p_sfx.arpejo;
		case 7:
			return p_sfx.arpejo_ms;
		case 8:
			return p_sfx.vibrato;
		default:
			return p_sfx.vibrato_hz;
	}
}

void set_param(RetroSfx &r_sfx, int p_index, double p_value) {
	switch (p_index) {
		case 0:
			r_sfx.freq_inicio = p_value;
			break;
		case 1:
			r_sfx.freq_fim = p_value;
			break;
		case 2:
			r_sfx.duracao = int(p_value);
			break;
		case 3:
			r_sfx.ataque = int(p_value);
			break;
		case 4:
			r_sfx.decaimento = int(p_value);
			break;
		case 5:
			r_sfx.volume = p_value / 100.0;
			break;
		case 6:
			r_sfx.arpejo = p_value;
			break;
		case 7:
			r_sfx.arpejo_ms = int(p_value);
			break;
		case 8:
			r_sfx.vibrato = p_value;
			break;
		default:
			r_sfx.vibrato_hz = p_value;
			break;
	}
}
} // namespace

// ---- RetroSfx ----

const char *const RetroSfx::PRESETS[] = { "Pulo", "Moeda", "Dano", "Explosão", "Tiro", "Power-up", "Clique", "Passo", nullptr };

Dictionary RetroSfx::to_dict() const {
	Dictionary d;
	d["formato"] = "retro-studio.sfx";
	d["versao"] = 1;
	d["onda"] = onda == ONDA_QUADRADA ? "quadrada" : onda == ONDA_RUIDO ? "ruido" : "ruido_periodico";
	d["freq_inicio"] = freq_inicio;
	d["freq_fim"] = freq_fim;
	d["duracao"] = duracao;
	d["ataque"] = ataque;
	d["decaimento"] = decaimento;
	d["volume"] = volume;
	d["arpejo"] = arpejo;
	d["arpejo_ms"] = arpejo_ms;
	d["vibrato"] = vibrato;
	d["vibrato_hz"] = vibrato_hz;
	return d;
}

RetroSfx RetroSfx::from_dict(const Dictionary &p_dict) {
	RetroSfx s;
	const String o = p_dict.get("onda", "quadrada");
	s.onda = o == "ruido" ? ONDA_RUIDO : o == "ruido_periodico" ? ONDA_RUIDO_PERIODICO : ONDA_QUADRADA;
	s.freq_inicio = CLAMP(double(p_dict.get("freq_inicio", 440)), 30.0, 8000.0);
	s.freq_fim = CLAMP(double(p_dict.get("freq_fim", s.freq_inicio)), 30.0, 8000.0);
	s.duracao = CLAMP(int(p_dict.get("duracao", 200)), 10, 5000);
	s.ataque = CLAMP(int(p_dict.get("ataque", 0)), 0, 5000);
	s.decaimento = CLAMP(int(p_dict.get("decaimento", 150)), 0, 5000);
	s.volume = CLAMP(double(p_dict.get("volume", 1.0)), 0.0, 1.0);
	s.arpejo = CLAMP(double(p_dict.get("arpejo", 1.0)), 0.25, 4.0);
	s.arpejo_ms = CLAMP(int(p_dict.get("arpejo_ms", 0)), 0, 5000);
	s.vibrato = CLAMP(double(p_dict.get("vibrato", 0.0)), 0.0, 24.0);
	s.vibrato_hz = CLAMP(double(p_dict.get("vibrato_hz", 8.0)), 0.5, 60.0);
	return s;
}

RetroSfx RetroSfx::preset(const String &p_name) {
	RetroSfx s;
	if (p_name == "Pulo") {
		s.freq_inicio = 180;
		s.freq_fim = 620;
		s.duracao = 180;
		s.decaimento = 120;
	} else if (p_name == "Moeda") {
		s.freq_inicio = s.freq_fim = 988; // Si, depois Mi (×1,335).
		s.arpejo = 1.335;
		s.arpejo_ms = 70;
		s.duracao = 300;
		s.decaimento = 220;
	} else if (p_name == "Dano") {
		s.freq_inicio = 320;
		s.freq_fim = 90;
		s.duracao = 260;
		s.decaimento = 160;
		s.vibrato = 3;
		s.vibrato_hz = 22;
	} else if (p_name == U("Explosão")) {
		s.onda = ONDA_RUIDO;
		s.freq_inicio = 1400;
		s.freq_fim = 160;
		s.duracao = 700;
		s.decaimento = 600;
	} else if (p_name == "Tiro") {
		s.onda = ONDA_RUIDO;
		s.freq_inicio = 3200;
		s.freq_fim = 900;
		s.duracao = 160;
		s.decaimento = 150;
	} else if (p_name == "Power-up") {
		s.freq_inicio = 300;
		s.freq_fim = 1300;
		s.duracao = 550;
		s.decaimento = 200;
		s.vibrato = 1;
		s.vibrato_hz = 12;
	} else if (p_name == "Clique") {
		s.freq_inicio = s.freq_fim = 1600;
		s.duracao = 40;
		s.decaimento = 30;
		s.volume = 0.8;
	} else if (p_name == "Passo") {
		s.onda = ONDA_RUIDO_PERIODICO;
		s.freq_inicio = s.freq_fim = 700;
		s.duracao = 60;
		s.decaimento = 50;
		s.volume = 0.7;
	}
	return s;
}

RetroSfx RetroSfx::aleatorio() {
	Ref<RandomNumberGenerator> rng;
	rng.instantiate();
	rng->randomize();
	RetroSfx s;
	const float roll = rng->randf();
	s.onda = roll < 0.65 ? ONDA_QUADRADA : roll < 0.9 ? ONDA_RUIDO : ONDA_RUIDO_PERIODICO;
	s.freq_inicio = rng->randf_range(100, 2500);
	s.freq_fim = rng->randf() < 0.3 ? s.freq_inicio : rng->randf_range(80, 3000);
	s.duracao = rng->randi_range(60, 700);
	s.ataque = rng->randf() < 0.8 ? 0 : rng->randi_range(0, s.duracao / 3);
	s.decaimento = rng->randi_range(s.duracao / 4, s.duracao);
	if (rng->randf() < 0.3) {
		s.arpejo = rng->randf_range(0.6, 2.0);
		s.arpejo_ms = rng->randi_range(20, s.duracao / 2);
	}
	if (rng->randf() < 0.3) {
		s.vibrato = rng->randf_range(0.5, 4);
		s.vibrato_hz = rng->randf_range(4, 30);
	}
	return s;
}

Vector<int16_t> RetroSfx::render() const {
	const int frames = MAX(1, duracao * 60 / 1000);
	const int per_frame = TAXA / 60;
	Vector<int16_t> out;
	out.resize(frames * per_frame);
	double phase = 0, noise_step = 0;
	uint16_t lfsr = 0x4000;
	int written = 0;
	for (int f = 0; f < frames; f++) {
		const double t_ms = f * 1000.0 / 60.0;
		const double u = frames > 1 ? double(f) / (frames - 1) : 0;
		double freq = freq_inicio * Math::pow(double(freq_fim) / freq_inicio, u);
		if (arpejo_ms > 0 && t_ms >= arpejo_ms) {
			freq *= arpejo;
		}
		if (vibrato > 0) {
			freq *= Math::pow(2.0, vibrato * Math::sin(Math::TAU * vibrato_hz * t_ms / 1000.0) / 12.0);
		}
		// Registrador de tom do SN76489 (10 bits) e volume em 16 degraus de 2 dB, uma vez por quadro.
		const int n = CLAMP(int(Math::round(PSG_CLOCK / (32.0 * freq))), 1, 1023);
		const double real = PSG_CLOCK / (32.0 * n);
		double amp = volume;
		if (ataque > 0 && t_ms < ataque) {
			amp *= t_ms / ataque;
		}
		const double left = duracao - t_ms;
		if (decaimento > 0 && left < decaimento) {
			amp *= MAX(0.0, left / decaimento);
		}
		const int att = amp <= 0.001 ? 15 : CLAMP(int(Math::round(-10.0 * Math::log(amp) / Math::log(10.0))), 0, 15);
		const double level = att >= 15 ? 0 : Math::pow(10.0, -att * 2.0 / 20.0);
		for (int s = 0; s < per_frame; s++) {
			double wave;
			if (onda == ONDA_QUADRADA) {
				phase += real / TAXA;
				phase -= Math::floor(phase);
				wave = phase < 0.5 ? 1 : -1;
			} else {
				noise_step += real * 2 / TAXA;
				while (noise_step >= 1) {
					noise_step -= 1;
					const uint16_t feedback = onda == ONDA_RUIDO ? ((lfsr ^ (lfsr >> 3)) & 1) : (lfsr & 1);
					lfsr = (lfsr >> 1) | (feedback << 14);
				}
				wave = (lfsr & 1) ? 1 : -1;
			}
			out.write[written++] = int16_t(CLAMP(wave * level * 0.7 * 32767, -32767.0, 32767.0));
		}
	}
	return out;
}

PackedByteArray RetroSfx::wav(const Vector<int16_t> &p_samples) {
	PackedByteArray b;
	const uint32_t data_size = p_samples.size();
	auto u32 = [&](uint32_t v) {
		for (int i = 0; i < 4; i++) {
			b.push_back((v >> (8 * i)) & 0xFF);
		}
	};
	auto u16 = [&](uint16_t v) {
		b.push_back(v & 0xFF);
		b.push_back(v >> 8);
	};
	auto tag = [&](const char *t) {
		for (int i = 0; i < 4; i++) {
			b.push_back(t[i]);
		}
	};
	tag("RIFF");
	u32(36 + data_size + (data_size & 1));
	tag("WAVE");
	tag("fmt ");
	u32(16);
	u16(1); // PCM.
	u16(1); // Mono.
	u32(TAXA);
	u32(TAXA); // 1 byte por amostra.
	u16(1);
	u16(8); // 8 bits sem sinal, como o rescomp espera para o XGM.
	tag("data");
	u32(data_size);
	for (int16_t v : p_samples) {
		b.push_back(uint8_t((v >> 8) + 128));
	}
	if (data_size & 1) {
		b.push_back(128);
	}
	return b;
}

String RetroSfx::save(const String &p_dir, const String &p_name, String &r_error) const {
	String name = p_name.strip_edges().to_lower().replace(" ", "_");
	if (name.is_empty() || !name.is_valid_filename()) {
		r_error = U("Dê um nome ao efeito (letras, números e _).");
		return String();
	}
	DirAccess::make_dir_recursive_absolute(p_dir);
	const String wav_path = p_dir.path_join(name + ".wav");
	const Ref<FileAccess> f = FileAccess::open(wav_path, FileAccess::WRITE);
	if (f.is_null()) {
		r_error = U("Não foi possível gravar ") + wav_path;
		return String();
	}
	const PackedByteArray bytes = wav(render());
	f->store_buffer(bytes.ptr(), bytes.size());
	const Ref<FileAccess> j = FileAccess::open(p_dir.path_join(name + ".sfx.json"), FileAccess::WRITE);
	if (j.is_valid()) {
		j->store_string(JSON::stringify(to_dict(), "\t") + "\n");
	}
	return wav_path;
}

// ---- RetroSfxWave ----

void RetroSfxWave::_notification(int p_what) {
	if (p_what != NOTIFICATION_DRAW) {
		return;
	}
	const Size2 size = get_size();
	draw_rect(Rect2(Vector2(), size), Color(0.08, 0.09, 0.12));
	draw_line(Vector2(0, size.y / 2), Vector2(size.x, size.y / 2), Color(1, 1, 1, 0.15));
	if (samples.is_empty()) {
		return;
	}
	// Envelope: o maior valor de cada coluna, para ver o volume ao longo do efeito.
	const int columns = MAX(1, int(size.x));
	for (int x = 0; x < columns; x++) {
		const int from = int64_t(samples.size()) * x / columns, to = MAX(from + 1, int(int64_t(samples.size()) * (x + 1) / columns));
		int peak = 0;
		for (int i = from; i < to && i < samples.size(); i++) {
			peak = MAX(peak, Math::abs(int(samples[i])));
		}
		const float h = float(peak) / 32767.0f * size.y / 2;
		draw_line(Vector2(x, size.y / 2 - h), Vector2(x, size.y / 2 + h), Color(0.45, 0.8, 1));
	}
}

// ---- RetroSfxEditor ----

void RetroSfxEditor::_sync_controls() {
	updating = true;
	onda->select(sfx.onda);
	for (int i = 0; i < sliders.size(); i++) {
		sliders[i]->set_value(get_param(sfx, i));
		values[i]->set_text(vformat("%s %s", String::num(get_param(sfx, i), SLIDERS[i].step < 1 ? 2 : 0), U(SLIDERS[i].suffix)));
	}
	updating = false;
	_update_wave();
}

void RetroSfxEditor::_update_wave() {
	wave->samples = sfx.render();
	wave->queue_redraw();
}

void RetroSfxEditor::_preset(const String &p_name) {
	sfx = RetroSfx::preset(p_name);
	if (name->get_text().strip_edges().is_empty() || name->has_meta("automatico")) {
		name->set_text(p_name.to_lower().replace(U("ã"), "a").replace("-", "_"));
		name->set_meta("automatico", true);
	}
	_sync_controls();
	_play();
}

void RetroSfxEditor::_random() {
	sfx = RetroSfx::aleatorio();
	_sync_controls();
	_play();
}

void RetroSfxEditor::_slider_changed(double p_value, int p_index) {
	if (updating) {
		return;
	}
	set_param(sfx, p_index, p_value);
	values[p_index]->set_text(vformat("%s %s", String::num(p_value, SLIDERS[p_index].step < 1 ? 2 : 0), U(SLIDERS[p_index].suffix)));
	_update_wave();
}

void RetroSfxEditor::_onda_changed(int p_index) {
	if (updating) {
		return;
	}
	sfx.onda = p_index;
	_update_wave();
	_play();
}

void RetroSfxEditor::_play() {
	Ref<AudioStreamWAV> stream;
	stream.instantiate();
	stream->set_format(AudioStreamWAV::FORMAT_16_BITS);
	stream->set_mix_rate(RetroSfx::TAXA);
	stream->set_stereo(false);
	const Vector<int16_t> samples = sfx.render();
	PackedByteArray data;
	data.resize(samples.size() * 2);
	memcpy(data.ptrw(), samples.ptr(), data.size());
	stream->set_data(data);
	player->stop();
	player->set_stream(stream);
	player->play();
}

void RetroSfxEditor::_save() {
	String error;
	const String dir = ProjectSettings::get_singleton()->get_resource_path().path_join("som");
	const String path = sfx.save(dir, name->get_text(), error);
	if (path.is_empty()) {
		status->set_text(error);
		return;
	}
	const String res = "res://som/" + path.get_file();
	status->set_text(vformat(U("Gravado %s. Use-o nos campos de som (som_pulo, som do MDItem...) ou com jogo_som(SOM_%s) no código."), res, path.get_file().get_basename().to_upper()));
	name->remove_meta("automatico");
	EditorFileSystem::get_singleton()->update_file(res);
	EditorFileSystem::get_singleton()->scan_changes();
	_refresh_existing();
}

void RetroSfxEditor::_refresh_existing() {
	existing->clear();
	existing->add_item(U("Abrir efeito salvo…"));
	const String dir = ProjectSettings::get_singleton()->get_resource_path().path_join("som");
	const Ref<DirAccess> d = DirAccess::open(dir);
	if (d.is_null()) {
		return;
	}
	PackedStringArray files;
	for (const String &file : d->get_files()) {
		if (file.ends_with(".sfx.json")) {
			files.push_back(file);
		}
	}
	files.sort();
	for (const String &file : files) {
		existing->add_item(file.trim_suffix(".sfx.json"));
	}
}

void RetroSfxEditor::_open_existing(int p_index) {
	if (p_index <= 0) {
		return;
	}
	const String file_name = existing->get_item_text(p_index);
	const String path = ProjectSettings::get_singleton()->get_resource_path().path_join("som").path_join(file_name + ".sfx.json");
	const Variant parsed = JSON::parse_string(FileAccess::get_file_as_string(path));
	if (parsed.get_type() != Variant::DICTIONARY) {
		status->set_text(U("Não deu para ler ") + path.get_file());
		return;
	}
	sfx = RetroSfx::from_dict(parsed);
	name->set_text(file_name);
	name->remove_meta("automatico");
	existing->select(0);
	_sync_controls();
	_play();
}

void RetroSfxEditor::open() {
	_refresh_existing();
	_sync_controls();
	popup_centered(Size2(760, 640) * EDSCALE);
}

RetroSfxEditor::RetroSfxEditor() {
	set_title(U("Efeitos sonoros (PSG)"));
	set_min_size(Size2(640, 560) * EDSCALE);
	set_exclusive(false);
	set_transient(true);
	hide();
	connect("close_requested", callable_mp((Window *)this, &Window::hide));

	PanelContainer *background = memnew(PanelContainer);
	background->set_anchors_and_offsets_preset(Control::PRESET_FULL_RECT);
	background->set_theme_type_variation("BackgroundPanel");
	add_child(background);
	VBoxContainer *main = memnew(VBoxContainer);
	background->add_child(main);

	Label *intro = memnew(Label);
	intro->set_text(U("Efeito com o som do chip PSG (onda quadrada ou ruído, 60 atualizações por segundo). Ele é gravado como WAV em som/ e o jogo o toca como os outros sons."));
	intro->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	intro->set_custom_minimum_size(Size2(600, 0) * EDSCALE);
	main->add_child(intro);

	HFlowContainer *presets = memnew(HFlowContainer);
	main->add_child(presets);
	for (int i = 0; RetroSfx::PRESETS[i]; i++) {
		Button *b = memnew(Button);
		b->set_text(U(RetroSfx::PRESETS[i]));
		b->connect(SceneStringName(pressed), callable_mp(this, &RetroSfxEditor::_preset).bind(U(RetroSfx::PRESETS[i])));
		presets->add_child(b);
	}
	Button *random = memnew(Button);
	random->set_text(U("Aleatório"));
	random->connect(SceneStringName(pressed), callable_mp(this, &RetroSfxEditor::_random));
	presets->add_child(random);

	GridContainer *grid = memnew(GridContainer);
	grid->set_columns(3);
	main->add_child(grid);
	Label *onda_label = memnew(Label);
	onda_label->set_text(U("Onda"));
	grid->add_child(onda_label);
	onda = memnew(OptionButton);
	onda->add_item(U("Quadrada (tom)"));
	onda->add_item(U("Ruído"));
	onda->add_item(U("Ruído periódico (metálico)"));
	onda->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	onda->connect(SceneStringName(item_selected), callable_mp(this, &RetroSfxEditor::_onda_changed));
	grid->add_child(onda);
	grid->add_child(memnew(Control));
	for (int i = 0; i < SLIDER_COUNT; i++) {
		Label *label = memnew(Label);
		label->set_text(U(SLIDERS[i].label));
		grid->add_child(label);
		HSlider *slider = memnew(HSlider);
		slider->set_min(SLIDERS[i].min);
		slider->set_max(SLIDERS[i].max);
		slider->set_step(SLIDERS[i].step);
		slider->set_h_size_flags(Control::SIZE_EXPAND_FILL);
		slider->set_custom_minimum_size(Size2(260, 0) * EDSCALE);
		slider->connect(SceneStringName(value_changed), callable_mp(this, &RetroSfxEditor::_slider_changed).bind(i));
		grid->add_child(slider);
		sliders.push_back(slider);
		Label *value = memnew(Label);
		value->set_custom_minimum_size(Size2(110, 0) * EDSCALE);
		grid->add_child(value);
		values.push_back(value);
	}

	wave = memnew(RetroSfxWave);
	wave->set_custom_minimum_size(Size2(0, 90) * EDSCALE);
	wave->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	main->add_child(wave);

	HBoxContainer *bottom = memnew(HBoxContainer);
	main->add_child(bottom);
	Button *play = memnew(Button);
	play->set_text(U("▶ Tocar"));
	play->connect(SceneStringName(pressed), callable_mp(this, &RetroSfxEditor::_play));
	bottom->add_child(play);
	bottom->add_child(memnew(VSeparator));
	Label *name_label = memnew(Label);
	name_label->set_text(U("Nome"));
	bottom->add_child(name_label);
	name = memnew(LineEdit);
	name->set_placeholder(U("pulo"));
	name->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	bottom->add_child(name);
	Button *save = memnew(Button);
	save->set_text(U("Salvar em som/"));
	save->connect(SceneStringName(pressed), callable_mp(this, &RetroSfxEditor::_save));
	bottom->add_child(save);
	existing = memnew(OptionButton);
	existing->connect(SceneStringName(item_selected), callable_mp(this, &RetroSfxEditor::_open_existing));
	bottom->add_child(existing);

	status = memnew(Label);
	status->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	status->set_custom_minimum_size(Size2(600, 0) * EDSCALE);
	main->add_child(status);

	player = memnew(AudioStreamPlayer);
	add_child(player);
	sfx = RetroSfx::preset("Pulo");
}
