// #89: os 8 pads do teclado MIDI (o M-Vave SMK-25 manda notas no canal 10). Modo Bateria: cada pad toca
// uma peça (instrumento + nota) e grava na faixa daquela peça. Modo Controles: cada pad é um atalho do
// compositor. O mouse nos pads da tela passa pelo mesmo caminho. Configuração por máquina (configurações
// do editor), como o localStorage do Retro Studio em Electron. Porte de drumPads.js, useDrumPads.js e
// PadPanel.vue.
#include "retro_music_editor.h"

#include "retro_map_ui.h"

#include "core/input/input_event.h"
#include "core/io/json.h"
#include "core/object/callable_mp.h"
#include "editor/settings/editor_settings.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/check_box.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/label.h"
#include "scene/gui/option_button.h"
#include "scene/gui/popup.h"
#include "scene/gui/spin_box.h"
#include "scene/scene_string_names.h"

static constexpr int PAD_COUNT = 8;
static constexpr int DRUM_CHANNEL = 9; // canal 10 do MIDI, contado do zero
static constexpr const char *PAD_SETTING = "retro_studio/music/pads";
// Pads numerados como no teclado (1 2 3 4 em cima, 5 6 7 8 embaixo); no SMK-25 a fileira de cima manda
// 40-43 e a de baixo 36-39, como nos controladores estilo MPC.
static const int DEFAULT_PAD_NOTES[8] = { 40, 41, 42, 43, 36, 37, 38, 39 };
static const int LEGACY_PAD_NOTES[8] = { 36, 37, 38, 39, 40, 41, 42, 43 };
static const char *DEFAULT_KIT[8][2] = { { "bumbo", "36" }, { "caixa", "60" }, { "chimbal", "60" }, { "chimbal-aberto", "60" }, { "tom", "50" }, { "tom", "43" }, { "prato", "60" }, { "palmas", "60" } };
static const char *PAD_ACTIONS[8] = { "Tocar / parar", "Gravar", "Metrônomo", "Loop", "Desfazer", "Refazer", "Faixa anterior", "Próxima faixa" };

static bool _pad_note(const Variant &p_value) {
	if (p_value.get_type() != Variant::INT && p_value.get_type() != Variant::FLOAT) {
		return false;
	}
	const double value = p_value;
	return value == Math::floor(value) && value >= 0 && value <= 127;
}

static bool _pad_instrument_id(const String &p_id) {
	if (p_id.is_empty() || p_id.length() > 48) {
		return false;
	}
	for (int i = 0; i < p_id.length(); i++) {
		const char32_t c = p_id[i];
		if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (i > 0 && c == '-'))) {
			return false;
		}
	}
	return true;
}

// Configuração salva → configuração válida (normalizePadSettings); o que estiver estragado volta ao padrão.
void RetroMusicEditorPlugin::_load_pads() {
	for (int i = 0; i < PAD_COUNT; i++) {
		pad_notes[i] = DEFAULT_PAD_NOTES[i];
		pad_kit[i].instrument = DEFAULT_KIT[i][0];
		pad_kit[i].note = String(DEFAULT_KIT[i][1]).to_int();
	}
	pad_controls = false;
	EditorSettings *settings = EditorSettings::get_singleton();
	if (!settings->has_setting(PAD_SETTING)) {
		return;
	}
	const Variant parsed = JSON::parse_string(settings->get_setting(PAD_SETTING));
	if (parsed.get_type() != Variant::DICTIONARY) {
		return;
	}
	const Dictionary value = parsed;
	pad_controls = String(value.get("mode", "")) == "controls";
	const Variant notes = value.get("notes", Variant());
	if (notes.get_type() == Variant::ARRAY && Array(notes).size() == PAD_COUNT) {
		HashSet<int> unique;
		bool valid = true, legacy = true;
		for (int i = 0; i < PAD_COUNT; i++) {
			valid = valid && _pad_note(Array(notes)[i]);
			if (valid) {
				unique.insert(int(Array(notes)[i]));
				legacy = legacy && int(Array(notes)[i]) == LEGACY_PAD_NOTES[i];
			}
		}
		// Configuração da versão 1 com a ordem antiga (36..43 em sequência, fileiras trocadas): vira a nova.
		if (valid && unique.size() == PAD_COUNT && !(int(value.get("version", 0)) != 2 && legacy)) {
			for (int i = 0; i < PAD_COUNT; i++) {
				pad_notes[i] = Array(notes)[i];
			}
		}
	}
	const Variant kit = value.get("kit", Variant());
	for (int i = 0; kit.get_type() == Variant::ARRAY && i < MIN(PAD_COUNT, Array(kit).size()); i++) {
		const Variant pad = Array(kit)[i];
		if (pad.get_type() != Variant::DICTIONARY) {
			continue;
		}
		const Dictionary entry = pad;
		const Variant instrument = entry.get("instrument", Variant());
		if (instrument.get_type() == Variant::STRING && _pad_instrument_id(instrument) && _pad_note(entry.get("note", Variant()))) {
			pad_kit[i].instrument = instrument;
			pad_kit[i].note = entry["note"];
		}
	}
}

void RetroMusicEditorPlugin::_save_pads() {
	Dictionary value;
	value["version"] = 2;
	value["mode"] = pad_controls ? "controls" : "drums";
	Array notes, kit;
	for (int i = 0; i < PAD_COUNT; i++) {
		notes.push_back(pad_notes[i]);
		Dictionary entry;
		entry["instrument"] = pad_kit[i].instrument;
		entry["note"] = pad_kit[i].note;
		kit.push_back(entry);
	}
	value["notes"] = notes;
	value["kit"] = kit;
	EditorSettings::get_singleton()->set_setting(PAD_SETTING, JSON::stringify(value, "", false));
	EditorSettings::get_singleton()->save();
}

void RetroMusicEditorPlugin::_build_pads(Control *p_parent) {
	VBoxContainer *panel = memnew(VBoxContainer);
	p_parent->add_child(panel);
	HBoxContainer *head = memnew(HBoxContainer);
	panel->add_child(head);
	Label *title = memnew(Label);
	title->set_text("Pads");
	title->set_theme_type_variation(SNAME("HeaderSmall"));
	head->add_child(title);
	pad_drums_button = memnew(Button);
	pad_drums_button->set_text("Bateria");
	pad_drums_button->set_toggle_mode(true);
	pad_drums_button->set_focus_mode(Control::FOCUS_NONE);
	pad_drums_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_pad_mode).bind(false));
	head->add_child(pad_drums_button);
	pad_controls_button = memnew(Button);
	pad_controls_button->set_text("Controles");
	pad_controls_button->set_toggle_mode(true);
	pad_controls_button->set_focus_mode(Control::FOCUS_NONE);
	pad_controls_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_pad_mode).bind(true));
	head->add_child(pad_controls_button);
	Button *configure = memnew(Button);
	configure->set_text("Configurar");
	configure->set_tooltip_text(U("Instrumento e nota de cada pad"));
	configure->set_focus_mode(Control::FOCUS_NONE);
	configure->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_pad_configure));
	head->add_child(configure);
	GridContainer *pad_grid = memnew(GridContainer);
	pad_grid->set_columns(4);
	panel->add_child(pad_grid);
	for (int i = 0; i < PAD_COUNT; i++) {
		pad_buttons[i] = memnew(Button);
		pad_buttons[i]->set_custom_minimum_size(Size2(64, 30) * EDSCALE);
		pad_buttons[i]->set_clip_text(true);
		pad_buttons[i]->set_focus_mode(Control::FOCUS_NONE);
		pad_buttons[i]->set_action_mode(BaseButton::ACTION_MODE_BUTTON_PRESS);
		pad_buttons[i]->connect("button_down", callable_mp(this, &RetroMusicEditorPlugin::_pad_down).bind(i));
		pad_buttons[i]->connect("button_up", callable_mp(this, &RetroMusicEditorPlugin::_pad_up).bind(i));
		pad_grid->add_child(pad_buttons[i]);
	}
	HBoxContainer *learn_row = memnew(HBoxContainer);
	panel->add_child(learn_row);
	pad_learn_label = memnew(Label);
	learn_row->add_child(pad_learn_label);
	pad_learn_cancel = memnew(Button);
	pad_learn_cancel->set_text("Cancelar");
	pad_learn_cancel->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_pad_learn_cancel));
	learn_row->add_child(pad_learn_cancel);

	pad_config = memnew(PopupPanel);
	pad_config_box = memnew(VBoxContainer);
	pad_config->add_child(pad_config_box);
	panel->add_child(pad_config);
	_update_pads();
}

void RetroMusicEditorPlugin::_update_pads() {
	if (!pad_buttons[0]) {
		return;
	}
	pad_drums_button->set_pressed_no_signal(!pad_controls);
	pad_controls_button->set_pressed_no_signal(pad_controls);
	for (int i = 0; i < PAD_COUNT; i++) {
		String label;
		if (pad_controls) {
			label = U(PAD_ACTIONS[i]);
		} else {
			const RetroInstrument *instrument = _instrument(pad_kit[i].instrument);
			label = instrument ? instrument->name.replace(U(" (ruído)"), "") : pad_kit[i].instrument;
		}
		pad_buttons[i]->set_text(itos(i + 1) + " " + label);
		pad_buttons[i]->set_tooltip_text(U("Pad ") + itos(i + 1) + ": " + label + (pad_controls ? String() : " (" + retro_note_name(pad_kit[i].note) + ")") + U(" · nota MIDI ") + itos(pad_notes[i]));
		const bool lit = pad_lit.has(i), learning = pad_learning == i;
		pad_buttons[i]->set_modulate(lit ? Color(0.6, 1.0, 0.85).lerp(Color(0.3, 1.0, 0.7), pad_lit[i] / 127.0f) : (learning ? Color(1, 0.85, 0.4) : Color(1, 1, 1)));
	}
	pad_learn_label->set_text(pad_learning >= 0 ? U("Bata no pad ") + itos(pad_learning + 1) + U(" do teclado…") : String());
	pad_learn_label->get_parent()->call("set_visible", pad_learning >= 0);
}

void RetroMusicEditorPlugin::_fill_pad_config() {
	while (pad_config_box->get_child_count() > 0) {
		Node *child = pad_config_box->get_child(0);
		pad_config_box->remove_child(child);
		child->queue_free();
	}
	if (!pad_controls) {
		GridContainer *config_grid = memnew(GridContainer);
		config_grid->set_columns(3);
		pad_config_box->add_child(config_grid);
		// Percussão primeiro; depois o resto do banco e os instrumentos da música.
		Vector<const RetroInstrument *> options;
		for (const RetroInstrument &preset : RetroChipInstruments::presets()) {
			if (preset.category == U("Percussão")) {
				options.push_back(&preset);
			}
		}
		for (const RetroInstrument &preset : RetroChipInstruments::presets()) {
			if (preset.category != U("Percussão")) {
				options.push_back(&preset);
			}
		}
		for (const RetroInstrument &own : song.instruments) {
			options.push_back(&own);
		}
		for (int i = 0; i < PAD_COUNT; i++) {
			Label *number = memnew(Label);
			number->set_text(itos(i + 1));
			config_grid->add_child(number);
			OptionButton *select = memnew(OptionButton);
			select->set_tooltip_text(U("Instrumento do pad ") + itos(i + 1));
			for (const RetroInstrument *option : options) {
				select->add_item(option->name);
				select->set_item_metadata(select->get_item_count() - 1, option->id);
				if (option->id == pad_kit[i].instrument) {
					select->select(select->get_item_count() - 1);
				}
			}
			select->connect(SceneStringName(item_selected), callable_mp(this, &RetroMusicEditorPlugin::_pad_instrument_selected).bind(i, select));
			config_grid->add_child(select);
			SpinBox *note = memnew(SpinBox);
			note->set_max(127);
			note->set_value(pad_kit[i].note);
			note->set_tooltip_text(U("Nota do pad ") + itos(i + 1));
			note->connect(SceneStringName(value_changed), callable_mp(this, &RetroMusicEditorPlugin::_pad_note_changed).bind(i));
			config_grid->add_child(note);
		}
		Label *help = memnew(Label);
		help->set_text(U("O ruído do PSG é um só: caixa, chimbal, prato e palmas cortam um ao outro, como no Mega Drive. Bumbo e toms são FM."));
		help->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		help->set_custom_minimum_size(Size2(320, 0) * EDSCALE);
		help->set_modulate(Color(1, 1, 1, 0.6));
		pad_config_box->add_child(help);
	} else {
		String list;
		for (int i = 0; i < PAD_COUNT; i++) {
			list += (i ? U(" · ") : String()) + itos(i + 1) + " " + U(PAD_ACTIONS[i]);
		}
		Label *help = memnew(Label);
		help->set_text(U("Atalhos: ") + list + ".");
		help->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		help->set_custom_minimum_size(Size2(320, 0) * EDSCALE);
		pad_config_box->add_child(help);
	}
	HBoxContainer *tools = memnew(HBoxContainer);
	pad_config_box->add_child(tools);
	Button *learn = memnew(Button);
	learn->set_text("Aprender pads");
	learn->set_tooltip_text(U("Toque os pads em ordem, do 1 ao 8"));
	learn->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_pad_learn));
	tools->add_child(learn);
	Button *reset = memnew(Button);
	reset->set_text(U("Restaurar padrão"));
	reset->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_pad_reset));
	tools->add_child(reset);
}

void RetroMusicEditorPlugin::_pad_configure() {
	_fill_pad_config();
	pad_config->reset_size();
	pad_config->popup_centered();
}

void RetroMusicEditorPlugin::_pad_mode(bool p_controls) {
	pad_controls = p_controls;
	pad_lit.clear();
	_save_pads();
	_update_pads();
}

void RetroMusicEditorPlugin::_pad_instrument_selected(int p_item, int p_pad, Object *p_select) {
	OptionButton *select = Object::cast_to<OptionButton>(p_select);
	if (select) {
		pad_kit[p_pad].instrument = select->get_item_metadata(p_item);
		_save_pads();
		_update_pads();
	}
}

void RetroMusicEditorPlugin::_pad_note_changed(double p_value, int p_pad) {
	pad_kit[p_pad].note = CLAMP(int(Math::round(p_value)), 0, 127);
	_save_pads();
	_update_pads();
}

void RetroMusicEditorPlugin::_pad_learn() {
	pad_learning = 0;
	pad_config->hide();
	_update_pads();
}

void RetroMusicEditorPlugin::_pad_learn_cancel() {
	pad_learning = -1;
	_update_pads();
}

void RetroMusicEditorPlugin::_pad_reset() {
	for (int i = 0; i < PAD_COUNT; i++) {
		pad_notes[i] = DEFAULT_PAD_NOTES[i];
		pad_kit[i].instrument = DEFAULT_KIT[i][0];
		pad_kit[i].note = String(DEFAULT_KIT[i][1]).to_int();
	}
	pad_learning = -1;
	_save_pads();
	_fill_pad_config();
	_update_pads();
}

bool RetroMusicEditorPlugin::_pad_midi(const Ref<InputEventMIDI> &p_event) {
	if (p_event->get_channel() != DRUM_CHANNEL) {
		return false;
	}
	const MIDIMessage kind = p_event->get_message();
	if (kind != MIDIMessage::NOTE_ON && kind != MIDIMessage::NOTE_OFF) {
		return false;
	}
	const bool on = kind == MIDIMessage::NOTE_ON && p_event->get_velocity() > 0;
	const int note = p_event->get_pitch();
	if (pad_learning >= 0) {
		// Aprender: os próximos toques definem a nota de cada pad, na ordem 1..8.
		if (on) {
			bool used = false;
			for (int i = 0; i < pad_learning; i++) {
				used = used || pad_notes[i] == note;
			}
			if (!used) {
				pad_notes[pad_learning] = note;
				pad_learning = pad_learning + 1 < PAD_COUNT ? pad_learning + 1 : -1;
				if (pad_learning < 0) {
					HashSet<int> unique;
					for (int value : pad_notes) {
						unique.insert(value);
					}
					if (unique.size() != PAD_COUNT) {
						for (int i = 0; i < PAD_COUNT; i++) {
							pad_notes[i] = DEFAULT_PAD_NOTES[i];
						}
					}
					_save_pads();
				}
				_update_pads();
			}
		}
		return true;
	}
	for (int i = 0; i < PAD_COUNT; i++) {
		if (pad_notes[i] == note) {
			_pad_hit(i, on ? p_event->get_velocity() : 0);
			break;
		}
	}
	// O teclado (useChipSynth) e a gravação de teclas ignoram o canal 10.
	return true;
}

void RetroMusicEditorPlugin::_pad_down(int p_index) {
	_pad_hit(p_index, 100);
}

void RetroMusicEditorPlugin::_pad_up(int p_index) {
	_pad_hit(p_index, 0);
}

// Faixa da peça de bateria: a primeira com aquele instrumento, ou uma nova com o nome dele.
int RetroMusicEditorPlugin::_drum_track(const String &p_instrument) {
	for (int i = 0; i < song.tracks.size(); i++) {
		if (song.tracks[i].instrument == p_instrument) {
			return i;
		}
	}
	if (song.tracks.size() >= SONG_MAX_TRACKS) {
		return -1;
	}
	auto taken = [&](const String &p_id) {
		for (const RetroSongTrack &track : song.tracks) {
			if (track.id == p_id) {
				return true;
			}
		}
		return false;
	};
	String id = "bateria-" + p_instrument.substr(0, 22);
	int index = 2;
	while (taken(id)) {
		id = "bateria-" + p_instrument.substr(0, 20) + "-" + itos(index++);
	}
	RetroSongTrack track;
	track.id = id;
	const RetroInstrument *instrument = _instrument(p_instrument);
	track.name = (instrument ? instrument->name : p_instrument).substr(0, 64);
	track.instrument = p_instrument;
	song.tracks.push_back(track);
	_rebuild_tracks();
	return song.tracks.size() - 1;
}

// Toque de um pad (MIDI ou mouse). velocity 0 = soltou.
void RetroMusicEditorPlugin::_pad_hit(int p_index, int p_velocity) {
	if (p_index < 0 || p_index >= PAD_COUNT) {
		return;
	}
	const bool on = p_velocity > 0;
	if (on) {
		pad_lit[p_index] = p_velocity;
	} else {
		pad_lit.erase(p_index);
	}
	_update_pads();
	if (pad_controls) {
		if (!on) {
			return;
		}
		switch (p_index) {
			case 0:
				_toggle();
				break;
			case 1:
				_record();
				break;
			case 2:
				metronome_check->set_pressed(!metronome_check->is_pressed());
				break;
			case 3:
				loop_check->set_pressed(!song.has_loop);
				break;
			case 4:
				_undo();
				break;
			case 5:
				_redo();
				break;
			case 6:
				_select_track(MAX(0, selected - 1));
				break;
			case 7:
				_select_track(MIN(song.tracks.size() - 1, selected + 1));
				break;
		}
		return;
	}
	const PadKit &pad = pad_kit[p_index];
	const String owner = "pad:" + itos(p_index);
	const RetroInstrument *instrument = _instrument(pad.instrument);
	if (on && instrument) {
		_start_sound();
		if (pad_playing.has(p_index)) {
			driver.note_off(pad_playing[p_index], owner);
		}
		pad_playing[p_index] = pad.note;
		driver.note_on(*instrument, pad.note, p_velocity, owner);
		_flush();
	} else if (!on && pad_playing.has(p_index)) {
		driver.note_off(pad_playing[p_index], owner);
		pad_playing.erase(p_index);
		_flush();
	}
	// Gravação: cada peça vai para a sua faixa.
	if (!recording || !is_playing) {
		return;
	}
	if (on) {
		PadPending hit;
		hit.t = _current_tick();
		hit.v = p_velocity;
		hit.n = pad.note;
		hit.track = _drum_track(pad.instrument);
		pad_pending[p_index] = hit;
		return;
	}
	if (!pad_pending.has(p_index)) {
		return;
	}
	const PadPending held = pad_pending[p_index];
	pad_pending.erase(p_index);
	const double now = _current_tick();
	_commit(held.n, held.v, held.t, now >= held.t ? now : song_player.to, held.track);
}
