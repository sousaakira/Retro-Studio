#include "retro_music_editor.h"
#include "servers/display/display_server.h"
#include "scene/main/window.h"

#include "retro_instrument_browser.h"
#include "retro_instrument_editor.h"
#include "retro_instrument_formats.h"
#include "retro_map_ui.h"
#include "retro_vgm_player.h"

#include "core/config/project_settings.h"
#include "core/input/input_event.h"
#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/templates/hash_set.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "core/os/time.h"
#include "editor/editor_interface.h"
#include "editor/editor_main_screen.h"
#include "editor/editor_node.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/editor_string_names.h"
#include "editor/gui/editor_file_dialog.h"
#include "editor/settings/editor_settings.h"
#include "scene/audio/audio_stream_player.h"
#include "scene/gui/check_box.h"
#include "scene/gui/color_rect.h"
#include "scene/gui/dialogs.h"
#include "scene/gui/flow_container.h"
#include "scene/gui/item_list.h"
#include "scene/gui/panel_container.h"
#include "scene/gui/scroll_container.h"
#include "scene/gui/spin_box.h"
#include "scene/gui/split_container.h"
#include "scene/gui/line_edit.h"
#include "scene/gui/text_edit.h"
#include "scene/gui/option_button.h"
#include "scene/gui/separator.h"
#include "scene/gui/slider.h"
#include "scene/main/viewport.h"
#include "scene/resources/font.h"
#include "scene/resources/style_box_flat.h"
#include "servers/audio/audio_server.h"
#include "scene/scene_string_names.h"

static constexpr const char *META = "retro_music";
static constexpr double BEND_RANGE = 2;

// ---- teclado na tela ----

void RetroPianoKeys::_bind_methods() {
	ADD_SIGNAL(MethodInfo("key_pressed", PropertyInfo(Variant::INT, "note"), PropertyInfo(Variant::INT, "velocity")));
	ADD_SIGNAL(MethodInfo("key_released", PropertyInfo(Variant::INT, "note")));
}

bool RetroPianoKeys::_is_black(int p_note) const {
	const int n = ((p_note % 12) + 12) % 12;
	return n == 1 || n == 3 || n == 6 || n == 8 || n == 10;
}

int RetroPianoKeys::_note_at(const Vector2 &p_position) const {
	int whites = 0;
	for (int i = 0; i < count; i++) {
		whites += !_is_black(first_note + i);
	}
	const float width = get_size().x / MAX(1, whites);
	// Pretas primeiro (ficam por cima, na metade de cima).
	if (p_position.y < get_size().y * 0.6) {
		int white = 0;
		for (int i = 0; i < count; i++) {
			const int note = first_note + i;
			if (_is_black(note)) {
				const float x = white * width - width * 0.31;
				if (p_position.x >= x && p_position.x < x + width * 0.62) {
					return note;
				}
			} else {
				white++;
			}
		}
	}
	int white = int(p_position.x / width);
	for (int i = 0; i < count; i++) {
		const int note = first_note + i;
		if (!_is_black(note)) {
			if (white-- == 0) {
				return note;
			}
		}
	}
	return -1;
}

void RetroPianoKeys::gui_input(const Ref<InputEvent> &p_event) {
	const Ref<InputEventMouseButton> button = p_event;
	if (button.is_valid() && button->get_button_index() == MouseButton::LEFT) {
		if (button->is_pressed()) {
			pressed_note = _note_at(button->get_position());
			if (pressed_note >= 0) {
				emit_signal(SNAME("key_pressed"), pressed_note, 100);
			}
		} else if (pressed_note >= 0) {
			emit_signal(SNAME("key_released"), pressed_note);
			pressed_note = -1;
		}
		accept_event();
		return;
	}
	const Ref<InputEventMouseMotion> motion = p_event;
	if (motion.is_valid() && pressed_note >= 0) {
		const int note = _note_at(motion->get_position());
		if (note >= 0 && note != pressed_note) {
			emit_signal(SNAME("key_released"), pressed_note);
			pressed_note = note;
			emit_signal(SNAME("key_pressed"), pressed_note, 100);
		}
	}
}

void RetroPianoKeys::_notification(int p_what) {
	if (p_what == NOTIFICATION_MOUSE_EXIT && pressed_note >= 0) {
		emit_signal(SNAME("key_released"), pressed_note);
		pressed_note = -1;
	}
	if (p_what != NOTIFICATION_DRAW) {
		return;
	}
	int whites = 0;
	for (int i = 0; i < count; i++) {
		whites += !_is_black(first_note + i);
	}
	const float width = get_size().x / MAX(1, whites), height = get_size().y;
	const Color accent(0.36, 0.62, 1.0);
	const Ref<Font> font = get_theme_font(SceneStringName(font), SNAME("Label"));
	int white = 0;
	for (int i = 0; i < count; i++) {
		const int note = first_note + i;
		if (_is_black(note)) {
			continue;
		}
		const Rect2 rect(white * width, 0, width - 1, height);
		const bool down = lit.has(note);
		draw_rect(rect, down ? Color(0.75, 0.85, 1.0).lerp(accent, lit[note] / 127.0f) : Color(0.94, 0.94, 0.92));
		if (note % 12 == 0) {
			draw_string(font, Vector2(rect.position.x + 3, height - 6), retro_note_name(note), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(0.3, 0.3, 0.35));
		}
		white++;
	}
	white = 0;
	for (int i = 0; i < count; i++) {
		const int note = first_note + i;
		if (!_is_black(note)) {
			white++;
			continue;
		}
		const Rect2 rect(white * width - width * 0.31, 0, width * 0.62, height * 0.6);
		draw_rect(rect, lit.has(note) ? accent : Color(0.12, 0.12, 0.14));
	}
}


// ---- tela Música ----

static constexpr double LOOKAHEAD = 0.25;
static constexpr double START_DELAY = 0.08;
static constexpr int HISTORY_LIMIT = 100;
static const uint32_t TRACK_SWATCHES[8] = { 0x5bbda5ff, 0x5b8fbdff, 0xbd9a5bff, 0xbd5b7aff, 0x8f5bbdff, 0x7abd5bff, 0xbd765bff, 0x5bb3bdff };

// Botões sem foco: o Espaço toca/para a música em vez de apertar o último botão clicado.
template <typename T>
static T *_nofocus(T *p_control) {
	p_control->set_focus_mode(Control::FOCUS_NONE);
	return p_control;
}

static Label *_label(Control *p_parent, const String &p_text) {
	Label *label = memnew(Label);
	label->set_text(p_text);
	p_parent->add_child(label);
	return label;
}

static SpinBox *_spin(Control *p_parent, int p_min, int p_max) {
	SpinBox *spin = memnew(SpinBox);
	spin->set_min(p_min);
	spin->set_max(p_max);
	spin->set_step(1);
	spin->set_select_all_on_focus(true);
	spin->set_custom_minimum_size(Size2(p_max >= 100 ? 92 : 60, 0) * EDSCALE);
	p_parent->add_child(spin);
	return spin;
}

static String _format_saved_at(const String &p_iso) {
	if (p_iso.length() < 19) {
		return String::utf8("sessão anterior");
	}
	const int64_t seconds = Time::get_singleton()->get_unix_time_from_datetime_string(p_iso.substr(0, 19)) + int64_t(Time::get_singleton()->get_time_zone_from_system().get("bias", 0)) * 60;
	const Dictionary date = Time::get_singleton()->get_datetime_dict_from_unix_time(seconds);
	return vformat("%02d/%02d/%04d %02d:%02d:%02d", int(date["day"]), int(date["month"]), int(date["year"]), int(date["hour"]), int(date["minute"]), int(date["second"]));
}



const Ref<Texture2D> RetroMusicEditorPlugin::get_plugin_icon() const {
	return EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("AudioStreamPlayer"), EditorStringName(EditorIcons));
}

RetroMusicEditorPlugin::RetroMusicEditorPlugin() {
	singleton = this;
	engine.instantiate();
	engine->setup(2);
	instrument_id = EditorSettings::get_singleton()->get_project_metadata(META, "instrument", RetroChipInstruments::presets()[0].id);
	if (!_instrument(instrument_id)) {
		instrument_id = RetroChipInstruments::presets()[0].id;
	}
	octave = CLAMP(int(EditorSettings::get_singleton()->get_project_metadata(META, "octave", 0)), -3, 3);
	engine->volume = CLAMP(float(EditorSettings::get_singleton()->get_project_metadata(META, "volume", 0.8)), 0.0f, 1.0f);
	song = RetroSong::create("musica_1", U("Nova música"), instrument_id);

	main = memnew(VBoxContainer);
	main->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	main->hide();

	// ---- cabeçalho: música, som e teclado (uma linha baixa; a janela já diz que é o compositor) ----
	HFlowContainer *header = memnew(HFlowContainer);
	main->add_child(header);
	_label(header, U("Música"));
	song_select = _nofocus(memnew(OptionButton));
	song_select->set_custom_minimum_size(Size2(150, 0) * EDSCALE);
	song_select->set_fit_to_longest_item(false);
	song_select->set_clip_text(true);
	song_select->connect(SceneStringName(item_selected), callable_mp(this, &RetroMusicEditorPlugin::_song_selected));
	header->add_child(song_select);
	_label(header, "Nome");
	name_edit = memnew(LineEdit);
	name_edit->set_max_length(128);
	name_edit->set_custom_minimum_size(Size2(120, 0) * EDSCALE);
	name_edit->connect(SceneStringName(text_changed), callable_mp(this, &RetroMusicEditorPlugin::_name_changed));
	header->add_child(name_edit);
	_label(header, "ID");
	id_edit = memnew(LineEdit);
	id_edit->set_max_length(32);
	id_edit->set_custom_minimum_size(Size2(90, 0) * EDSCALE);
	id_edit->connect(SceneStringName(text_changed), callable_mp(this, &RetroMusicEditorPlugin::_id_changed));
	header->add_child(id_edit);
	save_button = _nofocus(memnew(Button));
	save_button->set_text("Salvar");
	save_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_save).bind(false));
	header->add_child(save_button);
	export_button = _nofocus(memnew(Button));
	export_button->set_text("Exportar");
	export_button->set_tooltip_text(U("Exportar para o jogo: salva e gera som/<id>.vgm, que a MDCena pode tocar"));
	export_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_save).bind(true));
	header->add_child(export_button);
	Button *open_vgm_button = _nofocus(memnew(Button));
	open_vgm_button->set_text(U("Abrir VGM…"));
	open_vgm_button->set_tooltip_text(U("Ouve um arquivo .vgm ou .vgz (do projeto ou de qualquer pasta) nos chips emulados."));
	open_vgm_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_open_vgm_pressed));
	header->add_child(open_vgm_button);
	header->add_child(memnew(VSeparator));
	sound_status = _label(header, String());
	sound_button = _nofocus(memnew(Button));
	sound_button->set_text("Ligar");
	sound_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_start_sound));
	header->add_child(sound_button);
	header->add_child(memnew(VSeparator));
	keyboard_status = _label(header, String());
	keyboard_button = _nofocus(memnew(Button));
	keyboard_button->set_text("Conectar teclado");
	keyboard_button->set_tooltip_text(U("Conecta o teclado MIDI por USB e por Bluetooth (o SMK-25 pareado). Por USB o SMK-25 manda cada nota por duas portas; a cópia é descartada."));
	keyboard_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_connect_keyboard));
	header->add_child(keyboard_button);
	header->add_child(memnew(VSeparator));
	window_button = _nofocus(memnew(Button));
	window_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_toggle_separate));
	header->add_child(window_button);

	for (int i = 0; i < header->get_child_count(); i++) {
		Control *child = Object::cast_to<Control>(header->get_child(i));
		if (child && !Object::cast_to<VSeparator>(child)) {
			child->set_v_size_flags(Control::SIZE_SHRINK_CENTER);
		}
	}

	recovered_bar = memnew(HBoxContainer);
	recovered_bar->hide();
	main->add_child(recovered_bar);
	recovered_label = _label(recovered_bar, String());
	Button *discard = _nofocus(memnew(Button));
	discard->set_text("Descartar rascunho");
	discard->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_discard_draft));
	recovered_bar->add_child(discard);
	message = memnew(Label);
	message->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	message->hide();
	main->add_child(message);

	// ---- transporte ----
	HFlowContainer *transport = memnew(HFlowContainer);
	main->add_child(transport);
	Button *rewind = _nofocus(memnew(Button));
	rewind->set_text(U("⏮"));
	rewind->set_tooltip_text(U("Voltar ao início"));
	rewind->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_rewind));
	transport->add_child(rewind);
	play_button = _nofocus(memnew(Button));
	play_button->set_custom_minimum_size(Size2(76, 0) * EDSCALE);
	play_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_toggle));
	transport->add_child(play_button);
	record_button = _nofocus(memnew(Button));
	record_button->set_tooltip_text(U("Gravar o teclado na faixa selecionada"));
	record_button->set_custom_minimum_size(Size2(80, 0) * EDSCALE);
	record_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_record));
	transport->add_child(record_button);
	position_label = _label(transport, "1.1");
	position_label->set_tooltip_text(U("Compasso.tempo"));
	position_label->set_custom_minimum_size(Size2(54, 0) * EDSCALE);
	position_label->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
	position_label->set_mouse_filter(Control::MOUSE_FILTER_PASS);
	transport->add_child(memnew(VSeparator));
	_label(transport, "Tempo");
	tempo_spin = _spin(transport, SONG_TEMPO_MIN, SONG_TEMPO_MAX);
	tempo_spin->set_suffix("BPM");
	tempo_spin->set_custom_minimum_size(Size2(112, 0) * EDSCALE);
	tempo_spin->connect(SceneStringName(value_changed), callable_mp(this, &RetroMusicEditorPlugin::_tempo_changed));
	_label(transport, "Compasso");
	beats_spin = _spin(transport, 1, 12);
	beats_spin->set_suffix("/4");
	beats_spin->set_custom_minimum_size(Size2(76, 0) * EDSCALE);
	beats_spin->connect(SceneStringName(value_changed), callable_mp(this, &RetroMusicEditorPlugin::_beats_changed));
	_label(transport, U("Duração"));
	bars_spin = _spin(transport, 1, SONG_MAX_BARS);
	bars_spin->set_suffix("comp.");
	bars_spin->set_custom_minimum_size(Size2(112, 0) * EDSCALE);
	bars_spin->set_tooltip_text(U("Duração em compassos"));
	bars_spin->connect(SceneStringName(value_changed), callable_mp(this, &RetroMusicEditorPlugin::_bars_changed));
	transport->add_child(memnew(VSeparator));
	_label(transport, "Grade");
	grid_select = _nofocus(memnew(OptionButton));
	for (const RetroSongGrid &item : SONG_GRIDS) {
		grid_select->add_item(item.label);
		grid_select->set_item_metadata(grid_select->get_item_count() - 1, item.ticks);
	}
	grid_select->select(3);
	grid_select->set_fit_to_longest_item(false);
	grid_select->set_custom_minimum_size(Size2(84, 0) * EDSCALE);
	grid_select->connect(SceneStringName(item_selected), callable_mp(this, &RetroMusicEditorPlugin::_grid_selected));
	transport->add_child(grid_select);
	quantize_check = _nofocus(memnew(CheckBox));
	quantize_check->set_text(U("Quantizar gravação"));
	quantize_check->set_pressed(true);
	quantize_check->connect(SceneStringName(toggled), callable_mp(this, &RetroMusicEditorPlugin::_quantize_toggled));
	transport->add_child(quantize_check);
	metronome_check = _nofocus(memnew(CheckBox));
	metronome_check->set_text(U("Metrônomo"));
	metronome_check->connect(SceneStringName(toggled), callable_mp(this, &RetroMusicEditorPlugin::_metronome_toggled));
	transport->add_child(metronome_check);
	loop_check = _nofocus(memnew(CheckBox));
	loop_check->set_text("Loop");
	loop_check->connect(SceneStringName(toggled), callable_mp(this, &RetroMusicEditorPlugin::_loop_toggled));
	transport->add_child(loop_check);
	loop_from_label = _label(transport, "do");
	loop_from_spin = _spin(transport, 1, SONG_MAX_BARS);
	loop_from_spin->connect(SceneStringName(value_changed), callable_mp(this, &RetroMusicEditorPlugin::_loop_bars_changed));
	loop_to_label = _label(transport, "ao");
	loop_to_spin = _spin(transport, 1, SONG_MAX_BARS);
	loop_to_spin->connect(SceneStringName(value_changed), callable_mp(this, &RetroMusicEditorPlugin::_loop_bars_changed));
	fm6_check = _nofocus(memnew(CheckBox));
	fm6_check->set_text("FM6 livre");
	fm6_check->set_tooltip_text(U("O XGM usa o DAC do FM 6 para os efeitos PCM: reserve-o se o jogo tocar efeitos durante esta música."));
	fm6_check->connect(SceneStringName(toggled), callable_mp(this, &RetroMusicEditorPlugin::_fm6_toggled));
	transport->add_child(fm6_check);
	transport->add_child(memnew(VSeparator));
	undo_button = _nofocus(memnew(Button));
	undo_button->set_text("Desfazer");
	undo_button->set_tooltip_text("Desfazer (Ctrl+Z)");
	undo_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_undo));
	transport->add_child(undo_button);
	redo_button = _nofocus(memnew(Button));
	redo_button->set_text("Refazer");
	redo_button->set_tooltip_text("Refazer (Ctrl+Shift+Z)");
	redo_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_redo));
	transport->add_child(redo_button);
	transport->add_child(memnew(VSeparator));
	static const char *LIGHTS[10] = { "FM1", "FM2", "FM3", "FM4", "FM5", "FM6", "PSG1", "PSG2", "PSG3", "Ruído" };
	for (int i = 0; i < 10; i++) {
		channel_lights[i] = _label(transport, U(LIGHTS[i]));
	}

	for (int i = 0; i < transport->get_child_count(); i++) {
		Control *child = Object::cast_to<Control>(transport->get_child(i));
		if (child && !Object::cast_to<VSeparator>(child)) {
			child->set_v_size_flags(Control::SIZE_SHRINK_CENTER);
		}
	}

	// ---- faixas | piano roll | instrumentos ----
	HSplitContainer *body = memnew(HSplitContainer);
	body->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	main->add_child(body);
	VBoxContainer *tracks = memnew(VBoxContainer);
	tracks->set_custom_minimum_size(Size2(260, 0) * EDSCALE);
	body->add_child(tracks);
	HBoxContainer *tracks_head = memnew(HBoxContainer);
	tracks->add_child(tracks_head);
	Label *tracks_title = _label(tracks_head, "Faixas");
	tracks_title->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	tracks_title->set_theme_type_variation(SNAME("HeaderSmall"));
	add_track_button = _nofocus(memnew(Button));
	add_track_button->set_text(U("＋ Faixa"));
	add_track_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_add_track));
	tracks_head->add_child(add_track_button);
	ScrollContainer *tracks_scroll = memnew(ScrollContainer);
	tracks_scroll->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	tracks_scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	tracks->add_child(tracks_scroll);
	tracks_box = memnew(VBoxContainer);
	tracks_box->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	tracks_scroll->add_child(tracks_box);
	tracks_help = memnew(Label);
	tracks_help->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	tracks_help->set_modulate(Color(1, 1, 1, 0.6));
	tracks->add_child(tracks_help);

	HSplitContainer *right_split = memnew(HSplitContainer);
	right_split->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	body->add_child(right_split);
	roll = memnew(RetroPianoRoll);
	roll->song = &song;
	roll->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	roll->set_tooltip_text(U("Clique para criar, arraste para mover, a borda direita muda a duração, botão direito apaga. Delete apaga, setas transpõem, Ctrl+D duplica. Régua: clique posiciona; Shift+arrastar marca o loop. Ctrl+roda: zoom; Alt+roda: altura."));
	roll->connect("cursor_changed", callable_mp(this, &RetroMusicEditorPlugin::_roll_cursor));
	roll->connect("preview", callable_mp(this, &RetroMusicEditorPlugin::_roll_preview));
	roll->connect("preview_end", callable_mp(this, &RetroMusicEditorPlugin::_roll_preview_end));
	roll->connect("changed", callable_mp(this, &RetroMusicEditorPlugin::_roll_changed));
	right_split->add_child(roll);
	VBoxContainer *instruments = memnew(VBoxContainer);
	instruments->set_custom_minimum_size(Size2(280, 0) * EDSCALE);
	right_split->add_child(instruments);
	instrument_library = memnew(VBoxContainer);
	instrument_library->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	instruments->add_child(instrument_library);
	_section(instrument_library, "Instrumento da faixa");
	instrument_current = memnew(Label);
	instrument_current->set_clip_text(true);
	instrument_library->add_child(instrument_current);
	HFlowContainer *library_tools = memnew(HFlowContainer);
	instrument_library->add_child(library_tools);
	Button *import_button = _nofocus(memnew(Button));
	import_button->set_text(U("Importar…"));
	import_button->set_tooltip_text(U("Abrir .tfi, .dmp, .fui, .opni, .wopn"));
	import_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_import_pressed));
	library_tools->add_child(import_button);
	Button *browser_button = _nofocus(memnew(Button));
	browser_button->set_text(U("Da internet…"));
	browser_button->set_tooltip_text(U("Biblioteca de instrumentos do Furnace ou link https"));
	browser_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_browser_pressed));
	library_tools->add_child(browser_button);
	Button *copy_button = _nofocus(memnew(Button));
	copy_button->set_text(U("Editar cópia"));
	copy_button->set_tooltip_text(U("Cria uma cópia editável do instrumento da faixa (ou edita, se já for da música)"));
	copy_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_edit_copy));
	library_tools->add_child(copy_button);
	import_error = memnew(Label);
	import_error->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	import_error->add_theme_color_override(SceneStringName(font_color), Color(1, 0.55, 0.5));
	import_error->hide();
	instrument_library->add_child(import_error);
	kind_select = _nofocus(memnew(OptionButton));
	kind_select->add_item("Todos");
	kind_select->add_item("FM");
	kind_select->add_item("PSG");
	kind_select->add_item(U("Ruído"));
	kind_select->connect(SceneStringName(item_selected), callable_mp(this, &RetroMusicEditorPlugin::_kind_selected));
	instrument_library->add_child(kind_select);
	instrument_list = memnew(ItemList);
	instrument_list->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	instrument_list->connect(SceneStringName(item_selected), callable_mp(this, &RetroMusicEditorPlugin::_instrument_selected));
	instrument_list->connect("item_activated", callable_mp(this, &RetroMusicEditorPlugin::_instrument_activated));
	instrument_library->add_child(instrument_list);
	_help(instrument_library, U("Clique para usar na faixa e ouvir; dois cliques num instrumento da música abrem o editor. O teclado toca com o instrumento da faixa selecionada."));
	instrument_editor_scroll = memnew(ScrollContainer);
	instrument_editor_scroll->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	instrument_editor_scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	instrument_editor_scroll->hide();
	instruments->add_child(instrument_editor_scroll);
	instrument_editor = memnew(RetroInstrumentEditor);
	instrument_editor->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	instrument_editor->song = &song;
	instrument_editor->connect("changed", callable_mp(this, &RetroMusicEditorPlugin::_editor_changed));
	instrument_editor->connect("preview", callable_mp(this, &RetroMusicEditorPlugin::_editor_preview));
	instrument_editor->connect("remove", callable_mp(this, &RetroMusicEditorPlugin::_editor_remove));
	instrument_editor->connect("close", callable_mp(this, &RetroMusicEditorPlugin::_editor_close));
	instrument_editor->connect("export_requested", callable_mp(this, &RetroMusicEditorPlugin::_editor_export));
	instrument_editor_scroll->add_child(instrument_editor);
	ScrollContainer *browser_scroll = memnew(ScrollContainer);
	browser_scroll->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	browser_scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	instruments->add_child(browser_scroll);
	instrument_browser = memnew(RetroInstrumentBrowser);
	instrument_browser->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	instrument_browser->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	instrument_browser->connect("import_instruments", callable_mp(this, &RetroMusicEditorPlugin::_browser_import));
	instrument_browser->connect("preview_instrument", callable_mp(this, &RetroMusicEditorPlugin::_preview_patch));
	instrument_browser->connect("close", callable_mp(this, &RetroMusicEditorPlugin::_show_instrument_panel).bind(0));
	browser_scroll->add_child(instrument_browser);
	browser_scroll->hide();

	import_dialog = memnew(EditorFileDialog);
	import_dialog->set_file_mode(EditorFileDialog::FILE_MODE_OPEN_FILES);
	import_dialog->set_access(EditorFileDialog::ACCESS_FILESYSTEM);
	import_dialog->set_title("Importar instrumentos");
	import_dialog->add_filter("*.tfi,*.dmp,*.fui,*.opni,*.wopn", "Instrumentos de tracker");
	import_dialog->connect("files_selected", callable_mp(this, &RetroMusicEditorPlugin::_import_files));
	main->add_child(import_dialog);
	export_dialog = memnew(EditorFileDialog);
	export_dialog->set_file_mode(EditorFileDialog::FILE_MODE_SAVE_FILE);
	export_dialog->set_access(EditorFileDialog::ACCESS_FILESYSTEM);
	export_dialog->set_title("Exportar instrumento");
	export_dialog->connect("file_selected", callable_mp(this, &RetroMusicEditorPlugin::_export_file));
	main->add_child(export_dialog);
	choose_dialog = memnew(ConfirmationDialog);
	choose_dialog->set_title("Escolher instrumentos do arquivo");
	choose_dialog->set_ok_button_text("Importar");
	choose_dialog->connect(SceneStringName(confirmed), callable_mp(this, &RetroMusicEditorPlugin::_confirm_import));
	VBoxContainer *choose_box = memnew(VBoxContainer);
	choose_box->set_custom_minimum_size(Size2(380, 360) * EDSCALE);
	choose_dialog->add_child(choose_box);
	choose_help = memnew(Label);
	choose_help->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	choose_box->add_child(choose_help);
	HBoxContainer *choose_tools = memnew(HBoxContainer);
	choose_box->add_child(choose_tools);
	Button *all = memnew(Button);
	all->set_text("Todos");
	all->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_choose_all).bind(true));
	choose_tools->add_child(all);
	Button *none = memnew(Button);
	none->set_text("Nenhum");
	none->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_choose_all).bind(false));
	choose_tools->add_child(none);
	ScrollContainer *choose_scroll = memnew(ScrollContainer);
	choose_scroll->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	choose_box->add_child(choose_scroll);
	choose_list = memnew(VBoxContainer);
	choose_list->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	choose_scroll->add_child(choose_list);
	main->add_child(choose_dialog);

	// ---- teclado ----
	HBoxContainer *keys_bar = memnew(HBoxContainer);
	main->add_child(keys_bar);
	keys = memnew(RetroPianoKeys);
	keys->set_custom_minimum_size(Size2(0, 96) * EDSCALE);
	keys->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	keys->connect("key_pressed", callable_mp(this, &RetroMusicEditorPlugin::_key_pressed));
	keys->connect("key_released", callable_mp(this, &RetroMusicEditorPlugin::_key_released));
	keys->set_tooltip_text(U("Teclado do computador como nos trackers: Z…M a partir de C3, Q…I a partir de C4. Espaço toca/para."));
	keys_bar->add_child(keys);
	_load_pads();
	_build_pads(keys_bar);
	VBoxContainer *key_controls = memnew(VBoxContainer);
	keys_bar->add_child(key_controls);
	HBoxContainer *octave_row = memnew(HBoxContainer);
	key_controls->add_child(octave_row);
	_label(octave_row, "Oitava");
	Button *down = _nofocus(memnew(Button));
	down->set_text(U("−"));
	down->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_octave).bind(-1));
	octave_row->add_child(down);
	octave_label = _label(octave_row, "0");
	octave_label->set_custom_minimum_size(Size2(28, 0) * EDSCALE);
	octave_label->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
	Button *up = _nofocus(memnew(Button));
	up->set_text("+");
	up->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_octave).bind(1));
	octave_row->add_child(up);
	HBoxContainer *volume_row = memnew(HBoxContainer);
	key_controls->add_child(volume_row);
	_label(volume_row, "Volume");
	volume_slider = _nofocus(memnew(HSlider));
	volume_slider->set_min(0);
	volume_slider->set_max(1);
	volume_slider->set_step(0.01);
	volume_slider->set_value(engine->volume);
	volume_slider->set_custom_minimum_size(Size2(120, 0) * EDSCALE);
	volume_slider->set_v_size_flags(Control::SIZE_SHRINK_CENTER);
	volume_slider->connect(SceneStringName(value_changed), callable_mp(this, &RetroMusicEditorPlugin::_volume_changed));
	volume_row->add_child(volume_slider);
	Button *panic = _nofocus(memnew(Button));
	panic->set_text("Parar notas");
	panic->set_tooltip_text("Solta todas as notas presas");
	panic->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::all_notes_off));
	key_controls->add_child(panic);

	open_dialog = memnew(ConfirmationDialog);
	open_dialog->set_title(U("Alterações não salvas"));
	open_dialog->set_text(U("Há alterações não salvas nesta música."));
	open_dialog->set_ok_button_text("Salvar e abrir");
	open_dialog->set_cancel_button_text("Continuar editando");
	open_dialog->add_button("Descartar e abrir", false, "discard");
	open_dialog->connect(SceneStringName(confirmed), callable_mp(this, &RetroMusicEditorPlugin::_open_dialog_confirmed));
	open_dialog->connect("custom_action", callable_mp(this, &RetroMusicEditorPlugin::_open_dialog_action));
	main->add_child(open_dialog);

	vgm_file_dialog = memnew(EditorFileDialog);
	vgm_file_dialog->set_file_mode(EditorFileDialog::FILE_MODE_OPEN_FILE);
	vgm_file_dialog->set_access(EditorFileDialog::ACCESS_FILESYSTEM);
	vgm_file_dialog->set_title(U("Abrir VGM"));
	vgm_file_dialog->add_filter("*.vgm, *.vgz", U("Músicas VGM"));
	vgm_file_dialog->set_current_dir(_root());
	vgm_file_dialog->connect("file_selected", callable_mp(this, &RetroMusicEditorPlugin::_vgm_file_selected));
	main->add_child(vgm_file_dialog);

	vgm_player = memnew(RetroVgmPlayer);
	EditorNode::get_singleton()->add_child(vgm_player);
	vgm_dialog = memnew(AcceptDialog);
	vgm_dialog->set_title(U("Música VGM"));
	vgm_dialog->set_ok_button_text("Fechar");
	VBoxContainer *vgm_box = memnew(VBoxContainer);
	vgm_box->set_custom_minimum_size(Size2(460, 0) * EDSCALE);
	vgm_dialog->add_child(vgm_box);
	vgm_title = memnew(Label);
	vgm_title->set_theme_type_variation(SNAME("HeaderSmall"));
	vgm_title->set_clip_text(true);
	vgm_box->add_child(vgm_title);
	vgm_bar = memnew(RetroVgmBar);
	vgm_box->add_child(vgm_bar);
	_help(vgm_box, U("O som é o dos chips emulados do compositor: parecido com o Mega Drive, bom para reconhecer a música (não é idêntico ao console)."));
	vgm_dialog->connect("visibility_changed", callable_mp(this, &RetroMusicEditorPlugin::_vgm_dialog_visibility));
	EditorNode::get_singleton()->get_gui_base()->add_child(vgm_dialog);

	player = memnew(AudioStreamPlayer);
	Ref<RetroChipStream> stream;
	stream.instantiate();
	stream->engine = engine;
	player->set_stream(stream);
	add_child(player); // Fora do painel: o som não para quando o painel muda de janela.

	_set_document(song, String(), String());
	_update_status();
	// Tela principal: só o aviso de que o compositor está na janela (no modo encaixado, o próprio painel).
	placeholder = memnew(VBoxContainer);
	placeholder->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	placeholder->set_alignment(BoxContainer::ALIGNMENT_CENTER);
	placeholder->hide();
	Label *placeholder_text = memnew(Label);
	placeholder_text->set_text(U("O compositor está numa janela separada."));
	placeholder_text->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
	placeholder->add_child(placeholder_text);
	HBoxContainer *placeholder_buttons = memnew(HBoxContainer);
	placeholder_buttons->set_alignment(BoxContainer::ALIGNMENT_CENTER);
	placeholder->add_child(placeholder_buttons);
	Button *show_button = memnew(Button);
	show_button->set_text(U("Mostrar a janela"));
	show_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_show_window));
	placeholder_buttons->add_child(show_button);
	Button *dock_button = memnew(Button);
	dock_button->set_text(U("Trazer para esta tela"));
	dock_button->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_toggle_separate));
	placeholder_buttons->add_child(dock_button);
	EditorNode::get_singleton()->get_editor_main_screen()->get_control()->add_child(placeholder);

	window = memnew(Window);
	window->set_title(U("Música — Retro Studio"));
	window->set_min_size(Size2(960, 600) * EDSCALE);
	window->set_transient(false);
	window->set_exclusive(false);
	window->hide();
	window->connect("close_requested", callable_mp(this, &RetroMusicEditorPlugin::_window_closed));
	PanelContainer *background = memnew(PanelContainer);
	background->set_anchors_and_offsets_preset(Control::PRESET_FULL_RECT);
	background->set_theme_type_variation("BackgroundPanel");
	window->add_child(background);
	window->add_child(memnew(RetroMusicKeys));
	EditorNode::get_singleton()->get_gui_base()->add_child(window);

	separate = bool(EditorSettings::get_singleton()->get_project_metadata(META, "janela_separada", true));
	_place_main();
	set_process_input(true);
	set_process_shortcut_input(true);
}

RetroMusicEditorPlugin::~RetroMusicEditorPlugin() {
	// Grava já o que estava esperando o atraso do rascunho.
	if (loaded && draft_left >= 0) {
		_write_draft();
	}
	if (singleton == this) {
		singleton = nullptr;
	}
}

String RetroMusicEditorPlugin::_root() const {
	return ProjectSettings::get_singleton()->get_resource_path();
}

const RetroInstrument *RetroMusicEditorPlugin::_instrument(const String &p_id) const {
	return song.resolve_instrument(p_id);
}

const RetroInstrument *RetroMusicEditorPlugin::_live_instrument() const {
	if (selected >= 0 && selected < song.tracks.size()) {
		const RetroInstrument *instrument = _instrument(song.tracks[selected].instrument);
		if (instrument) {
			return instrument;
		}
	}
	return _instrument(instrument_id);
}

bool RetroMusicEditorPlugin::_dirty() const {
	return song.to_json() != baseline;
}

void RetroMusicEditorPlugin::_open_vgm_pressed() {
	vgm_file_dialog->popup_file_dialog();
}

void RetroMusicEditorPlugin::_vgm_file_selected(const String &p_path) {
	// Dentro do projeto vira res://; fora dele fica o caminho absoluto (o player aceita os dois).
	const String local = ProjectSettings::get_singleton()->localize_path(p_path);
	open_vgm(local);
}

bool RetroMusicEditorPlugin::open_vgm(const String &p_path) {
	const String extension = p_path.get_extension().to_lower();
	if (extension != "vgm" && extension != "vgz") {
		return false;
	}
	const String absolute = ProjectSettings::get_singleton()->globalize_path(p_path);
	const String relative = p_path.trim_prefix("res://");
	vgm_title->set_text(p_path.get_file());
	vgm_title->set_tooltip_text(relative);
	vgm_bar->set_file(_root() + "::" + relative, p_path.get_file(), absolute);
	Node *dialog_parent = separate && window->is_visible() ? static_cast<Node *>(window) : static_cast<Node *>(EditorNode::get_singleton()->get_gui_base());
	if (vgm_dialog->get_parent() != dialog_parent) {
		vgm_dialog->get_parent()->remove_child(vgm_dialog);
		dialog_parent->add_child(vgm_dialog);
	}
	vgm_dialog->popup_centered(Size2(500, 190) * EDSCALE);
	// A mesma chave da barra (projeto + arquivo), para ela mostrar esta música tocando.
	vgm_player->play(_root() + "::" + relative, p_path.get_file(), absolute);
	return true;
}

Dictionary RetroMusicEditorPlugin::ai_open_song(const String &p_id, bool p_play) {
	Dictionary result;
	EditorInterface::get_singleton()->set_main_screen_editor(get_plugin_name());
	if (!loaded) {
		_first_load();
	}
	if (_dirty() && saved_id != p_id) {
		result["ok"] = false;
		result["reason"] = U("A música aberta (\"") + song.name + U("\") tem alterações não salvas; peça ao usuário para salvar ou descartar.");
		return result;
	}
	if (saved_id != p_id || !_dirty()) {
		_open(p_id);
		_refresh_list();
	}
	if (saved_id != p_id) {
		result["ok"] = false;
		result["reason"] = message->is_visible() && !message->get_text().is_empty() ? message->get_text() : U("Música não encontrada: ") + p_id;
		return result;
	}
	if (p_play) {
		_play(0);
	}
	result["ok"] = true;
	result["id"] = p_id;
	result["name"] = song.name;
	result["playing"] = is_playing;
	return result;
}

Dictionary RetroMusicEditorPlugin::ai_song_changed(const String &p_id) {
	Dictionary result;
	if (!loaded) {
		result["open"] = false;
		return result;
	}
	_refresh_list();
	if (saved_id != p_id) {
		result["open"] = false;
		return result;
	}
	result["open"] = true;
	if (_dirty()) {
		result["reloaded"] = false;
		result["reason"] = U("o usuário tem alterações não salvas nesta música");
		return result;
	}
	_open(p_id);
	_refresh_list();
	result["reloaded"] = true;
	return result;
}

void RetroMusicEditorPlugin::_vgm_dialog_visibility() {
	if (!vgm_dialog->is_visible()) {
		vgm_player->stop_if(vgm_bar->key);
	}
}

void RetroMusicEditorPlugin::_save_settings() {
	EditorSettings::get_singleton()->set_project_metadata(META, "instrument", instrument_id);
	EditorSettings::get_singleton()->set_project_metadata(META, "octave", octave);
	EditorSettings::get_singleton()->set_project_metadata(META, "volume", engine->volume);
}

void RetroMusicEditorPlugin::_show_message(const String &p_text, bool p_problem) {
	message->set_text(p_text);
	message->set_visible(!p_text.is_empty());
	message->add_theme_color_override(SceneStringName(font_color), p_problem ? Color(1, 0.55, 0.5) : Color(0.55, 0.9, 0.75));
}

void RetroMusicEditorPlugin::make_visible(bool p_visible) {
	screen_visible = p_visible;
	if (separate) {
		// A tela Música só abre a janela; o compositor continua tocando ao voltar para o 2D.
		placeholder->set_visible(p_visible);
		if (p_visible) {
			_show_window();
		}
		return;
	}
	main->set_visible(p_visible);
	if (p_visible) {
		_activate();
	} else {
		_deactivate();
	}
}

// Fora do compositor o teclado não toca: o som e a música param e voltam ao abrir.
void RetroMusicEditorPlugin::_activate() {
	active = true;
	_start_sound();
	if (bool(EditorSettings::get_singleton()->get_project_metadata(META, "keyboard", false))) {
		OS::get_singleton()->open_midi_inputs();
		ble.start();
	}
	if (!loaded) {
		_first_load();
	}
}

void RetroMusicEditorPlugin::_deactivate() {
	active = false;
	_stop();
	_stop_sound();
}

// Põe o painel na janela (separada) ou na tela principal (encaixado).
void RetroMusicEditorPlugin::_place_main() {
	Node *target = separate ? static_cast<Node *>(window->get_child(0)) : static_cast<Node *>(EditorNode::get_singleton()->get_editor_main_screen()->get_control());
	if (main->get_parent() != target) {
		if (main->get_parent()) {
			main->get_parent()->remove_child(main);
		}
		target->add_child(main);
	}
	if (window_button) {
		window_button->set_text(separate ? U("Encaixar na tela") : U("Janela separada"));
		window_button->set_tooltip_text(separate ? U("Mostra o compositor na tela principal Música, em vez desta janela.") : U("Abre o compositor numa janela própria, que pode ir para outro monitor."));
	}
}

void RetroMusicEditorPlugin::_show_window() {
	main->show();
	if (!window->is_visible()) {
		const Size2 screen = DisplayServer::get_singleton()->screen_get_usable_rect(DisplayServer::get_singleton()->window_get_current_screen()).size;
		window->popup_centered((screen * 0.85).max(window->get_min_size()));
	} else {
		window->grab_focus();
	}
	if (!active) {
		_activate();
	}
}

void RetroMusicEditorPlugin::_window_closed() {
	window->hide();
	_deactivate();
}

void RetroMusicEditorPlugin::_toggle_separate() {
	separate = !separate;
	EditorSettings::get_singleton()->set_project_metadata(META, "janela_separada", separate);
	if (separate) {
		_place_main();
		placeholder->set_visible(screen_visible);
		_show_window();
		return;
	}
	window->hide();
	placeholder->hide();
	_place_main();
	if (screen_visible) {
		main->show();
	} else {
		// Encaixar pela janela: vai para a tela Música (make_visible liga o som).
		main->hide();
		_deactivate();
		EditorInterface::get_singleton()->set_main_screen_editor(get_plugin_name());
	}
}

void RetroMusicEditorPlugin::_flush() {
	const Vector<RetroChipWrite> writes = driver.take();
	if (sound_on && !writes.is_empty()) {
		engine->push(1, writes);
	}
}

void RetroMusicEditorPlugin::_start_sound() {
	if (sound_on) {
		return;
	}
	engine->setup(2);
	driver.all_notes_off();
	driver.invalidate(); // Chip novo: o driver recarrega os patches na próxima nota.
	sound_on = true;
	player->play();
	_flush();
	set_process(true);
	_update_status();
}

void RetroMusicEditorPlugin::_stop_sound() {
	all_notes_off();
	sound_on = false;
	player->stop();
	set_process(false);
	_update_status();
}

// USB (ALSA) e Bluetooth (BLE-MIDI pelo BlueZ). A escolha fica lembrada: a Música reconecta ao abrir.
void RetroMusicEditorPlugin::_connect_keyboard() {
	OS::get_singleton()->open_midi_inputs();
	ble.start();
	EditorSettings::get_singleton()->set_project_metadata(META, "keyboard", true);
	_show_message(String());
	_update_status();
}

void RetroMusicEditorPlugin::_update_status() {
	sound_status->set_text(sound_on ? U("Som: ligado") : U("Som: desligado"));
	sound_button->set_visible(!sound_on);
	const PackedStringArray inputs = OS::get_singleton()->get_connected_midi_inputs();
	String names;
	for (const String &name : inputs) {
		// O mesmo teclado aparece em duas portas: mostra o nome uma vez.
		const String base = name.get_slicec(':', 0).strip_edges();
		if (!names.contains(base)) {
			names += (names.is_empty() ? "" : ", ") + base;
		}
	}
	if (ble.is_connected()) {
		names += (names.is_empty() ? "" : ", ") + ble.get_device_name() + " (Bluetooth)";
	}
	const String waiting = ble.is_running() && !ble.is_connected() ? ble.get_status() : String();
	keyboard_status->set_text(U("Teclado: ") + (!names.is_empty() ? names : (!waiting.is_empty() ? waiting : U("nenhum"))));
	keyboard_status->set_tooltip_text(waiting);
	keyboard_button->set_visible(inputs.is_empty() && !ble.is_running());
	octave_label->set_text(octave > 0 ? "+" + itos(octave) : itos(octave));
}

// ---- documento ----

void RetroMusicEditorPlugin::_set_document(const RetroSong &p_song, const String &p_revision, const String &p_saved) {
	_stop();
	song = p_song;
	baseline = song.to_json();
	revision = p_revision;
	saved_id = p_saved;
	selected = 0;
	cursor = 0;
	// Carregar começa um histórico novo: o que veio do disco nunca vira um passo de desfazer.
	history.clear();
	history.push_back(baseline);
	history_index = 0;
	roll->cursor = 0;
	roll->set_track(0);
	if (!song.tracks.is_empty()) {
		instrument_id = song.tracks[0].instrument;
	}
	_rebuild_tracks();
	_refresh_transport();
	_fill_instruments();
	_song_changed(false);
	_sync_instrument_editor();
}

String RetroMusicEditorPlugin::_unique_id() const {
	HashSet<String> used;
	for (const Variant &item : songs) {
		used.insert(Dictionary(item)["id"]);
	}
	int index = songs.size() + 1;
	while (used.has("musica_" + itos(index))) {
		index++;
	}
	return "musica_" + itos(index);
}

void RetroMusicEditorPlugin::_new_song() {
	_delete_draft();
	recovered_at = String();
	_set_document(RetroSong::create(_unique_id(), U("Nova música"), instrument_id), String(), String());
	_show_message(String());
}

void RetroMusicEditorPlugin::_refresh_list() {
	songs = RetroSongFiles::list(_root());
	song_select->clear();
	if (saved_id.is_empty()) {
		song_select->add_item(song.name + U(" (não salva)"));
		song_select->set_item_metadata(0, String());
		song_select->select(0);
	}
	for (const Variant &value : songs) {
		const Dictionary item = value;
		const String id = item["id"];
		const bool problem = item.has("error");
		song_select->add_item(String(item["name"]) + (problem ? U(" (com erro)") : (bool(item.get("exported", false)) ? String() : U(" · não exportada"))));
		const int index = song_select->get_item_count() - 1;
		song_select->set_item_metadata(index, id);
		song_select->set_item_disabled(index, problem);
		if (problem) {
			song_select->set_item_tooltip(index, item["error"]);
		}
		if (id == saved_id) {
			song_select->select(index);
		}
	}
	song_select->add_item(U("＋ Nova música"));
	song_select->set_item_metadata(song_select->get_item_count() - 1, "__new__");
}

void RetroMusicEditorPlugin::_open(const String &p_id) {
	_show_message(String());
	RetroSong loaded_song;
	String rev, error;
	if (RetroSongFiles::load(_root(), p_id, loaded_song, rev, error) != OK) {
		_show_message(error, true);
		return;
	}
	_delete_draft();
	recovered_at = String();
	_set_document(loaded_song, rev, p_id);
}

bool RetroMusicEditorPlugin::_save(bool p_export) {
	_show_message(String());
	String new_revision, error;
	RetroSongExport result;
	if (RetroSongFiles::save(_root(), song, revision, new_revision, error, p_export, &result) != OK) {
		_show_message(error, true);
		return false;
	}
	revision = new_revision;
	saved_id = song.id;
	baseline = song.to_json();
	_delete_draft();
	recovered_at = String();
	if (result.exported) {
		const int seconds = int(Math::round(result.seconds));
		_show_message(U("Exportada para ") + result.vgm_path + " (" + itos(seconds / 60) + ":" + String::num_int64(seconds % 60).pad_zeros(2) + (result.loop ? U(", com loop") : String()) + U("). Para tocar no jogo, escolha o arquivo em Música, no Inspetor da MDCena."));
		EditorFileSystem::get_singleton()->update_file("res://" + result.vgm_path);
	} else {
		_show_message(U("Música salva em music/") + song.id + ".song.json.");
	}
	_refresh_list();
	_song_changed(false);
	return true;
}

void RetroMusicEditorPlugin::_song_selected(int p_index) {
	const String value = song_select->get_item_metadata(p_index);
	// O seletor mostra a música aberta até a troca acontecer.
	_refresh_list();
	if (value == saved_id) {
		return;
	}
	if (_dirty()) {
		pending_open = value;
		open_dialog->popup_centered();
		return;
	}
	_open_choice(value);
}

void RetroMusicEditorPlugin::_open_choice(const String &p_value) {
	pending_open = String();
	if (p_value == "__new__") {
		_new_song();
	} else {
		_open(p_value);
	}
}

void RetroMusicEditorPlugin::_open_dialog_confirmed() {
	if (_save()) {
		_open_choice(pending_open);
	}
}

void RetroMusicEditorPlugin::_open_dialog_action(const StringName &p_action) {
	if (p_action == StringName("discard")) {
		open_dialog->hide();
		_open_choice(pending_open);
	}
}

void RetroMusicEditorPlugin::_name_changed(const String &p_text) {
	if (p_text.strip_edges().is_empty()) {
		return;
	}
	song.name = p_text;
	_song_changed();
}

void RetroMusicEditorPlugin::_id_changed(const String &p_text) {
	// Nome dos arquivos e da constante no código: letras minúsculas, números e _.
	String clean = p_text.to_lower();
	for (int i = 0; i < clean.length(); i++) {
		const char32_t c = clean[i];
		if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) {
			clean[i] = '_';
		}
	}
	if (clean != p_text) {
		const int caret = id_edit->get_caret_column();
		id_edit->set_text(clean);
		id_edit->set_caret_column(caret);
	}
	song.id = clean;
	_song_changed();
}

void RetroMusicEditorPlugin::_song_changed(bool p_record) {
	if (p_record) {
		_record_history();
	}
	const bool dirty = _dirty();
	if (loaded) {
		draft_left = 0.7;
	}
	if (name_edit->get_text() != song.name) {
		name_edit->set_text(song.name);
	}
	if (id_edit->get_text() != song.id) {
		id_edit->set_text(song.id);
	}
	id_edit->set_editable(saved_id.is_empty());
	id_edit->set_tooltip_text(saved_id.is_empty() ? U("Nome dos arquivos e da constante no código: letras minúsculas, números e _") : U("O ID não muda depois de salvar (é o nome dos arquivos e da constante no código)."));
	save_button->set_disabled(!dirty && !saved_id.is_empty());
	undo_button->set_disabled(history_index <= 0);
	redo_button->set_disabled(history_index >= history.size() - 1);
	recovered_bar->set_visible(!recovered_at.is_empty() && dirty);
	recovered_label->set_text(U("Alterações não salvas recuperadas (") + recovered_at + ").");
	if (saved_id.is_empty() && song_select->get_item_count() > 0 && String(song_select->get_item_metadata(0)).is_empty()) {
		song_select->set_item_text(0, song.name + U(" (não salva)"));
	}
	_update_tracks();
	roll->queue_redraw();
}

void RetroMusicEditorPlugin::_record_history() {
	const String json = song.to_json();
	if (history_index >= 0 && history[history_index] == json) {
		return;
	}
	history.resize(history_index + 1);
	history.push_back(json);
	if (history.size() > HISTORY_LIMIT) {
		history.remove_at(0);
	}
	history_index = history.size() - 1;
}

void RetroMusicEditorPlugin::_undo() {
	if (history_index > 0) {
		history_index--;
		_apply_history();
	}
}

void RetroMusicEditorPlugin::_redo() {
	if (history_index < history.size() - 1) {
		history_index++;
		_apply_history();
	}
}

void RetroMusicEditorPlugin::_apply_history() {
	String error;
	const RetroSong restored = RetroSong::from_json(history[history_index], error);
	if (!error.is_empty()) {
		return;
	}
	const int previous_tracks = song.tracks.size();
	song = restored;
	selected = CLAMP(selected, 0, song.tracks.size() - 1);
	cursor = MIN(cursor, song.length() - 1);
	roll->cursor = cursor;
	roll->track = selected;
	roll->clear_selection();
	if (previous_tracks != song.tracks.size()) {
		_rebuild_tracks();
	}
	_refresh_transport();
	_fill_instruments();
	_song_changed(false);
	driver.invalidate();
	_sync_instrument_editor();
}

// Rascunho da música aberta, em .retro-studio/drafts/music.json (mesmo formato do Retro Studio em
// Electron): sobrevive a travamento e fechamento. Nunca grava a fonte da música.
static String _draft_path(const String &p_root) {
	return p_root.path_join(".retro-studio/drafts/music.json");
}

void RetroMusicEditorPlugin::_write_draft() {
	draft_left = -1;
	if (!_dirty()) {
		if (draft_owned) {
			_delete_draft();
		}
		return;
	}
	Dictionary state;
	state["song"] = song.to_dictionary();
	state["baseline"] = baseline;
	state["revision"] = revision.is_empty() ? Variant() : Variant(revision);
	state["savedId"] = saved_id.is_empty() ? Variant() : Variant(saved_id);
	Dictionary draft;
	draft["version"] = 1;
	draft["editor"] = "music";
	draft["savedAt"] = Time::get_singleton()->get_datetime_string_from_system(true) + ".000Z";
	draft["baseRevision"] = state["revision"];
	draft["state"] = state;
	const String path = _draft_path(_root());
	const String ignore = path.get_base_dir().path_join(".gitignore");
	DirAccess::make_dir_recursive_absolute(path.get_base_dir());
	if (!FileAccess::exists(ignore)) {
		Ref<FileAccess> file = FileAccess::open(ignore, FileAccess::WRITE);
		if (file.is_valid()) {
			file->store_string("*\n");
		}
	}
	const CharString text = (JSON::stringify(draft, "", false) + "\n").utf8();
	Vector<uint8_t> bytes;
	bytes.resize(text.length());
	memcpy(bytes.ptrw(), text.get_data(), text.length());
	if (RetroSongFiles::write_atomic(path, bytes) == OK) {
		draft_owned = true;
	}
}

void RetroMusicEditorPlugin::_delete_draft() {
	draft_left = -1;
	draft_owned = false;
	const String path = _draft_path(_root());
	if (FileAccess::exists(path)) {
		DirAccess::remove_absolute(path);
	}
}

bool RetroMusicEditorPlugin::_restore_draft() {
	const String path = _draft_path(_root());
	if (!FileAccess::exists(path)) {
		return false;
	}
	const Variant parsed = JSON::parse_string(FileAccess::get_file_as_string(path));
	if (parsed.get_type() != Variant::DICTIONARY) {
		return false;
	}
	const Dictionary draft = parsed;
	if (int(draft.get("version", 0)) != 1 || String(draft.get("editor", "")) != "music" || Variant(draft.get("state", Variant())).get_type() != Variant::DICTIONARY) {
		return false;
	}
	const Dictionary state = draft["state"];
	String error;
	const RetroSong restored = RetroSong::from_dictionary(state.get("song", Variant()), error);
	if (!error.is_empty()) {
		return false;
	}
	const Variant rev = state.get("revision", Variant()), saved = state.get("savedId", Variant());
	_set_document(restored, rev.get_type() == Variant::STRING ? String(rev) : String(), saved.get_type() == Variant::STRING ? String(saved) : String());
	baseline = state.get("baseline", "");
	draft_owned = true;
	recovered_at = _format_saved_at(draft.get("savedAt", ""));
	_refresh_list();
	_song_changed(false);
	return true;
}

void RetroMusicEditorPlugin::_discard_draft() {
	_delete_draft();
	recovered_at = String();
	if (!saved_id.is_empty()) {
		_open(saved_id);
	} else {
		_new_song();
	}
	_refresh_list();
}

void RetroMusicEditorPlugin::_first_load() {
	loaded = true;
	songs = RetroSongFiles::list(_root());
	// Rascunho não salvo (travamento, fechamento) tem prioridade sobre abrir a primeira música.
	if (_restore_draft()) {
		return;
	}
	for (const Variant &item : songs) {
		if (!Dictionary(item).has("error")) {
			_open(Dictionary(item)["id"]);
			_refresh_list();
			return;
		}
	}
	_new_song();
	_refresh_list();
}

// ---- faixas ----

void RetroMusicEditorPlugin::_rebuild_tracks() {
	while (tracks_box->get_child_count() > 0) {
		Node *child = tracks_box->get_child(0);
		tracks_box->remove_child(child);
		child->queue_free();
	}
	for (int index = 0; index < song.tracks.size(); index++) {
		PanelContainer *row = memnew(PanelContainer);
		row->set_mouse_filter(Control::MOUSE_FILTER_STOP);
		row->connect(SceneStringName(gui_input), callable_mp(this, &RetroMusicEditorPlugin::_track_input).bind(index));
		tracks_box->add_child(row);
		HBoxContainer *line = memnew(HBoxContainer);
		line->set_mouse_filter(Control::MOUSE_FILTER_PASS);
		row->add_child(line);
		ColorRect *swatch = memnew(ColorRect);
		swatch->set_color(Color::hex(TRACK_SWATCHES[index % 8]));
		swatch->set_custom_minimum_size(Size2(6, 0) * EDSCALE);
		swatch->set_mouse_filter(Control::MOUSE_FILTER_PASS);
		line->add_child(swatch);
		VBoxContainer *texts = memnew(VBoxContainer);
		texts->set_h_size_flags(Control::SIZE_EXPAND_FILL);
		texts->set_mouse_filter(Control::MOUSE_FILTER_PASS);
		line->add_child(texts);
		LineEdit *name = memnew(LineEdit);
		name->set_max_length(64);
		name->set_flat(true);
		name->set_text(song.tracks[index].name);
		name->set_tooltip_text(U("Nome da faixa ") + itos(index + 1));
		name->connect(SceneStringName(text_changed), callable_mp(this, &RetroMusicEditorPlugin::_track_name_changed).bind(index));
		name->connect(SceneStringName(focus_entered), callable_mp(this, &RetroMusicEditorPlugin::_select_track).bind(index));
		texts->add_child(name);
		Label *info = memnew(Label);
		info->set_modulate(Color(1, 1, 1, 0.6));
		info->set_clip_text(true);
		info->set_mouse_filter(Control::MOUSE_FILTER_PASS);
		texts->add_child(info);
		Button *mute = _nofocus(memnew(Button));
		mute->set_text("M");
		mute->set_toggle_mode(true);
		mute->set_tooltip_text(U("Mudo (só no editor)"));
		mute->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_track_flag).bind(index, false));
		line->add_child(mute);
		Button *solo = _nofocus(memnew(Button));
		solo->set_text("S");
		solo->set_toggle_mode(true);
		solo->set_tooltip_text(U("Solo (só no editor)"));
		solo->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_track_flag).bind(index, true));
		line->add_child(solo);
		Button *remove = _nofocus(memnew(Button));
		remove->set_text(U("×"));
		remove->set_tooltip_text("Remover " + song.tracks[index].name);
		remove->connect(SceneStringName(pressed), callable_mp(this, &RetroMusicEditorPlugin::_remove_track).bind(index));
		line->add_child(remove);
	}
	_update_tracks();
}

void RetroMusicEditorPlugin::_update_tracks() {
	if (tracks_box->get_child_count() != song.tracks.size()) {
		return;
	}
	int notes = 0;
	for (int index = 0; index < song.tracks.size(); index++) {
		const RetroSongTrack &track = song.tracks[index];
		notes += track.notes.size();
		PanelContainer *row = Object::cast_to<PanelContainer>(tracks_box->get_child(index));
		Ref<StyleBoxFlat> style;
		style.instantiate();
		style->set_bg_color(index == selected ? Color(0.36, 0.62, 1.0, 0.18) : Color(0, 0, 0, 0));
		style->set_content_margin_all(3 * EDSCALE);
		style->set_corner_radius_all(3);
		row->add_theme_style_override(SceneStringName(panel), style);
		Node *line = row->get_child(0);
		LineEdit *name = Object::cast_to<LineEdit>(line->get_child(1)->get_child(0));
		if (name->get_text() != track.name && !name->has_focus()) {
			name->set_text(track.name);
		}
		const RetroInstrument *instrument = _instrument(track.instrument);
		Object::cast_to<Label>(line->get_child(1)->get_child(1))->set_text((instrument ? instrument->name : track.instrument) + U(" · ") + itos(track.notes.size()) + " notas");
		Object::cast_to<Button>(line->get_child(2))->set_pressed_no_signal(track.mute);
		Object::cast_to<Button>(line->get_child(3))->set_pressed_no_signal(track.solo);
		Object::cast_to<Button>(line->get_child(4))->set_disabled(song.tracks.size() <= 1);
	}
	add_track_button->set_disabled(song.tracks.size() >= SONG_MAX_TRACKS);
	tracks_help->set_text(itos(notes) + U(" notas. Mudo e solo valem só para ouvir no editor; a exportação leva todas as faixas."));
	if (selected >= 0 && selected < song.tracks.size()) {
		const RetroInstrument *instrument = _instrument(song.tracks[selected].instrument);
		instrument_current->set_text((instrument ? instrument->name : song.tracks[selected].instrument) + U(" · ") + song.tracks[selected].name);
	}
}

void RetroMusicEditorPlugin::_select_track(int p_index) {
	if (p_index < 0 || p_index >= song.tracks.size()) {
		return;
	}
	if (p_index != selected) {
		selected = p_index;
		roll->set_track(p_index);
	}
	instrument_id = song.tracks[p_index].instrument;
	_update_tracks();
	_fill_instruments();
}

void RetroMusicEditorPlugin::_track_input(const Ref<InputEvent> &p_event, int p_index) {
	const Ref<InputEventMouseButton> button = p_event;
	if (button.is_valid() && button->is_pressed() && button->get_button_index() == MouseButton::LEFT) {
		_select_track(p_index);
	}
}

void RetroMusicEditorPlugin::_track_name_changed(const String &p_text, int p_index) {
	if (p_index >= song.tracks.size() || p_text.strip_edges().is_empty()) {
		return;
	}
	song.tracks.write[p_index].name = p_text;
	_song_changed();
}

void RetroMusicEditorPlugin::_track_flag(int p_index, bool p_solo) {
	if (p_index >= song.tracks.size()) {
		return;
	}
	RetroSongTrack &track = song.tracks.write[p_index];
	if (p_solo) {
		track.solo = !track.solo;
	} else {
		track.mute = !track.mute;
	}
	_song_changed();
}

void RetroMusicEditorPlugin::_add_track() {
	if (song.tracks.size() >= SONG_MAX_TRACKS) {
		return;
	}
	int index = song.tracks.size() + 1;
	bool taken = true;
	while (taken) {
		taken = false;
		for (const RetroSongTrack &track : song.tracks) {
			taken = taken || track.id == "faixa-" + itos(index);
		}
		index += taken;
	}
	RetroSongTrack track;
	track.id = "faixa-" + itos(index);
	track.name = "Faixa " + itos(index);
	track.instrument = instrument_id;
	song.tracks.push_back(track);
	_rebuild_tracks();
	_song_changed();
	_select_track(song.tracks.size() - 1);
}

void RetroMusicEditorPlugin::_remove_track(int p_index) {
	if (song.tracks.size() <= 1 || p_index >= song.tracks.size()) {
		return;
	}
	song.tracks.remove_at(p_index);
	selected = MIN(selected, song.tracks.size() - 1);
	roll->set_track(selected);
	_rebuild_tracks();
	_song_changed();
	_fill_instruments();
}

// ---- transporte ----

void RetroMusicEditorPlugin::_refresh_transport() {
	tempo_spin->set_value_no_signal(song.tempo);
	beats_spin->set_value_no_signal(song.beats_per_bar);
	bars_spin->set_value_no_signal(song.bars);
	loop_check->set_pressed_no_signal(song.has_loop);
	const int bar = SONG_PPQ * song.beats_per_bar;
	// set_max corta o valor anterior e avisaria uma mudança: aqui só se mostra a música.
	loop_from_spin->set_block_signals(true);
	loop_to_spin->set_block_signals(true);
	loop_from_spin->set_max(song.bars);
	loop_to_spin->set_max(song.bars);
	loop_from_spin->set_block_signals(false);
	loop_to_spin->set_block_signals(false);
	loop_from_spin->set_value_no_signal(song.has_loop ? song.loop_start / bar + 1 : 1);
	loop_to_spin->set_value_no_signal(song.has_loop ? song.loop_end / bar : song.bars);
	for (Control *control : { (Control *)loop_from_label, (Control *)loop_from_spin, (Control *)loop_to_label, (Control *)loop_to_spin }) {
		control->set_visible(song.has_loop);
	}
	fm6_check->set_pressed_no_signal(song.fm_channels == 5);
	play_button->set_text(is_playing ? U("■ Parar") : U("▶ Tocar"));
	play_button->set_tooltip_text(is_playing ? U("Parar (Espaço)") : U("Tocar a partir do marcador (Espaço)"));
	record_button->set_text(recording ? U("● Gravando") : U("● Gravar"));
	record_button->add_theme_color_override(SceneStringName(font_color), recording ? Color(1, 0.4, 0.4) : Color(1, 0.6, 0.6));
}

void RetroMusicEditorPlugin::_tempo_changed(double p_value) {
	song.tempo = CLAMP(int(Math::round(p_value)), SONG_TEMPO_MIN, SONG_TEMPO_MAX);
	_song_changed();
}

void RetroMusicEditorPlugin::_beats_changed(double p_value) {
	song.beats_per_bar = CLAMP(int(Math::round(p_value)), 1, 12);
	_set_bars(song.bars);
}

void RetroMusicEditorPlugin::_bars_changed(double p_value) {
	_set_bars(int(Math::round(p_value)));
}

void RetroMusicEditorPlugin::_set_bars(int p_bars) {
	const bool was_full = song.has_loop && song.loop_end == song.length();
	song.bars = CLAMP(p_bars, 1, SONG_MAX_BARS);
	song.normalize();
	if (was_full && song.has_loop) {
		song.loop_end = song.length();
	}
	cursor = MIN(cursor, song.length() - 1);
	roll->cursor = cursor;
	roll->clear_selection();
	_refresh_transport();
	_song_changed();
}

void RetroMusicEditorPlugin::_grid_selected(int p_index) {
	grid = grid_select->get_item_metadata(p_index);
	roll->grid = grid;
	roll->queue_redraw();
}

void RetroMusicEditorPlugin::_quantize_toggled(bool p_on) {
	quantize = p_on;
}

void RetroMusicEditorPlugin::_metronome_toggled(bool p_on) {
	metronome = p_on;
}

void RetroMusicEditorPlugin::_loop_toggled(bool p_on) {
	song.has_loop = p_on;
	if (p_on) {
		song.loop_start = 0;
		song.loop_end = song.length();
	}
	_refresh_transport();
	_song_changed();
}

// Compassos do loop em números da interface (1 = primeiro compasso).
void RetroMusicEditorPlugin::_loop_bars_changed(double p_value) {
	const int bar = SONG_PPQ * song.beats_per_bar;
	const int start = CLAMP(int(Math::round(loop_from_spin->get_value())), 1, song.bars);
	const int end = CLAMP(int(Math::round(loop_to_spin->get_value())), start, song.bars);
	song.has_loop = true;
	song.loop_start = (start - 1) * bar;
	song.loop_end = end * bar;
	_refresh_transport();
	_song_changed();
}

void RetroMusicEditorPlugin::_fm6_toggled(bool p_on) {
	song.fm_channels = p_on ? 5 : 6;
	_song_changed();
}

// Canais do chip: os da música quando ela toca, os do teclado ao vivo quando não.
void RetroMusicEditorPlugin::_update_lights() {
	const uint8_t active = engine->get_active(is_playing ? 0 : 1);
	const Color on(0.4, 0.85, 1.0), off(1, 1, 1, 0.3), unused(1, 1, 1, 0.1);
	for (int i = 0; i < 6; i++) {
		channel_lights[i]->set_modulate(i >= song.fm_channels ? unused : (active & (1 << i) ? on : off));
	}
	for (int i = 0; i < 3; i++) {
		channel_lights[6 + i]->set_modulate(!is_playing && driver.tone_held(i) ? on : off);
	}
	channel_lights[9]->set_modulate(!is_playing && driver.noise_held() ? on : off);
}

// ---- reprodução ----

RetroMusicEditorPlugin::Player RetroMusicEditorPlugin::_segment(int p_from, double p_start) {
	Player result;
	result.from = p_from;
	result.to = song.has_loop && p_from < song.loop_end ? song.loop_end : song.length();
	result.start = p_start;
	result.timeline = RetroSongTimeline::build(song, p_from, result.to, true, false);
	result.beat = int(Math::ceil(double(p_from) / SONG_PPQ));
	result.duration = double(result.timeline.end) / SONG_FPS;
	return result;
}

void RetroMusicEditorPlugin::_play(int p_from) {
	_stop();
	_start_sound();
	song_player = _segment(MIN(p_from, song.length() - 1), engine->get_time() + START_DELAY);
	if (!song_player.timeline.missing.is_empty()) {
		_show_message(U("Instrumento não encontrado: ") + String(", ").join(song_player.timeline.missing), true);
	}
	is_playing = true;
	roll->playing = true;
	_pump();
	_refresh_transport();
}

void RetroMusicEditorPlugin::_pump() {
	if (!is_playing) {
		return;
	}
	const double now = engine->get_time(), horizon = now + LOOKAHEAD;
	const RetroSongTimeline &timeline = song_player.timeline;
	while (song_player.next < timeline.frames.size()) {
		const RetroSongTimeline::Frame &item = timeline.frames[song_player.next];
		const double at = song_player.start + double(item.frame) / SONG_FPS;
		if (at > horizon) {
			break;
		}
		engine->push(0, item.writes, at);
		song_player.next++;
	}
	if (metronome) {
		while (true) {
			const int tick = song_player.beat * SONG_PPQ;
			if (tick >= song_player.to) {
				break;
			}
			const double at = song_player.start + double(song.tick_frame(tick) - song.tick_frame(song_player.from)) / SONG_FPS;
			if (at > horizon) {
				break;
			}
			engine->click(at, song_player.beat % song.beats_per_bar == 0);
			song_player.beat++;
		}
	}
	const double end = song_player.start + song_player.duration;
	if (now + LOOKAHEAD < end) {
		return;
	}
	if (song.has_loop && song_player.to == song.loop_end) {
		if (now < end - 0.02) {
			return;
		}
		_close_pending(song.loop_end);
		song_player = _segment(song.loop_start, end);
	} else if (now >= end) {
		_close_pending(song_player.to);
		_stop();
	}
}

double RetroMusicEditorPlugin::_current_tick(bool p_compensate) const {
	if (!is_playing) {
		return cursor;
	}
	const double latency = p_compensate ? AudioServer::get_singleton()->get_output_latency() : 0;
	const double elapsed = engine->get_time() - latency - song_player.start;
	return CLAMP(song_player.from + song.seconds_tick(MAX(0.0, elapsed)), double(song_player.from), double(song_player.to));
}

void RetroMusicEditorPlugin::_stop() {
	if (is_playing) {
		_close_pending(_current_tick());
		engine->clear(0);
	}
	is_playing = false;
	recording = false;
	roll->playing = false;
	roll->playhead = cursor;
	roll->queue_redraw();
	if (play_button) {
		_refresh_transport();
	}
}

void RetroMusicEditorPlugin::_toggle() {
	if (is_playing) {
		_stop();
	} else {
		_play(cursor);
	}
}

void RetroMusicEditorPlugin::_rewind() {
	cursor = 0;
	roll->cursor = 0;
	roll->queue_redraw();
	if (is_playing) {
		_play(0);
	}
}

// Gravação: o teclado (MIDI, computador ou tela) grava na faixa selecionada enquanto a música toca.
void RetroMusicEditorPlugin::_record() {
	if (recording) {
		_stop();
		return;
	}
	_play(cursor);
	if (is_playing) {
		recording = true;
		_refresh_transport();
	}
}

void RetroMusicEditorPlugin::_commit(int p_note, int p_velocity, double p_start, double p_end, int p_track) {
	const int track = p_track >= 0 ? p_track : selected;
	if (track < 0 || track >= song.tracks.size()) {
		return;
	}
	const int length = song.length();
	int t = int(Math::round(p_start)), d = int(Math::round(p_end - p_start));
	if (quantize) {
		t = retro_snap_tick(p_start, grid);
		d = retro_snap_length(p_end - p_start, grid);
	}
	t = MIN(t, length - 1);
	d = MAX(1, MIN(d, length - t));
	RetroSongNote note;
	note.t = t;
	note.d = d;
	note.n = p_note;
	note.v = p_velocity;
	song.tracks.write[track].notes.push_back(note);
	_song_changed();
}

void RetroMusicEditorPlugin::_close_pending(double p_end) {
	for (const KeyValue<int, PendingNote> &entry : pending) {
		_commit(entry.key, entry.value.v, entry.value.t, MAX(p_end, entry.value.t + 1));
	}
	pending.clear();
	for (const KeyValue<int, PadPending> &entry : pad_pending) {
		_commit(entry.value.n, entry.value.v, entry.value.t, MAX(p_end, entry.value.t + 1), entry.value.track);
	}
	pad_pending.clear();
}

// ---- instrumentos ----

void RetroMusicEditorPlugin::_fill_instruments() {
	instrument_list->clear();
	static const char *KINDS[4] = { "", "fm", "psg", "noise" };
	const String kind = KINDS[CLAMP(kind_select->get_selected(), 0, 3)];
	const String current = selected >= 0 && selected < song.tracks.size() ? song.tracks[selected].instrument : instrument_id;
	auto add = [&](const RetroInstrument &p_instrument) {
		if (!kind.is_empty() && p_instrument.kind != kind) {
			return;
		}
		const int index = instrument_list->add_item("   " + p_instrument.name + "  " + (p_instrument.kind == "fm" ? String("FM") : (p_instrument.kind == "noise" ? U("ruído") : String("PSG"))));
		instrument_list->set_item_metadata(index, p_instrument.id);
		if (p_instrument.kind == "fm") {
			instrument_list->set_item_tooltip(index, U("FM · algoritmo ") + itos(p_instrument.alg));
		}
		if (p_instrument.id == current) {
			instrument_list->select(index);
		}
	};
	auto header = [&](const String &p_title) {
		const int index = instrument_list->add_item(p_title);
		instrument_list->set_item_selectable(index, false);
		instrument_list->set_item_disabled(index, true);
		instrument_list->set_item_custom_fg_color(index, Color(0.65, 0.7, 0.72));
	};
	if (!song.instruments.is_empty()) {
		header(U("Da música"));
		for (const RetroInstrument &instrument : song.instruments) {
			add(instrument);
		}
	}
	for (const char *category : RetroChipInstruments::CATEGORIES) {
		bool any = false;
		for (const RetroInstrument &instrument : RetroChipInstruments::presets()) {
			any = any || (instrument.category == U(category) && (kind.is_empty() || instrument.kind == kind));
		}
		if (!any) {
			continue;
		}
		header(U(category));
		for (const RetroInstrument &instrument : RetroChipInstruments::presets()) {
			if (instrument.category == U(category)) {
				add(instrument);
			}
		}
	}
}

void RetroMusicEditorPlugin::_kind_selected(int p_index) {
	_fill_instruments();
}

void RetroMusicEditorPlugin::_instrument_selected(int p_index) {
	const String id = instrument_list->get_item_metadata(p_index);
	if (selected >= 0 && selected < song.tracks.size() && song.tracks[selected].instrument != id) {
		song.tracks.write[selected].instrument = id;
		_song_changed();
	}
	preview_instrument(id);
}

// Toca uma nota curta para ouvir o instrumento ao escolher (sem soltar teclas que o usuário segura).
void RetroMusicEditorPlugin::preview_instrument(const String &p_id) {
	const RetroInstrument *instrument = _instrument(p_id);
	if (!instrument) {
		return;
	}
	instrument_id = p_id;
	_save_settings();
	_start_sound();
	const int pitch = instrument->category == U("Baixos") ? 48 : (instrument->category == U("Percussão") && instrument->kind == "fm" ? 36 : 60);
	_play_live(-1, CLAMP(pitch + octave * 12, 0, 127), 100, instrument);
	preview_left = 0.45;
}

void RetroMusicEditorPlugin::_octave(int p_delta) {
	all_notes_off();
	octave = CLAMP(octave + p_delta, -3, 3);
	_save_settings();
	_update_status();
}

void RetroMusicEditorPlugin::_volume_changed(double p_value) {
	engine->volume = p_value;
	_save_settings();
}

// p_key: o que foi apertado (nota MIDI; -1 = prévia do instrumento, -2 = prévia do piano roll);
// p_note: a nota que soa, já com a oitava.
void RetroMusicEditorPlugin::_play_live(int p_key, int p_note, int p_velocity, const RetroInstrument *p_instrument) {
	const RetroInstrument *instrument = p_instrument ? p_instrument : _live_instrument();
	if (!instrument) {
		return;
	}
	if (playing.has(p_key)) {
		driver.note_off(playing[p_key]);
	}
	playing[p_key] = p_note;
	driver.note_on(*instrument, p_note, p_velocity);
	_flush();
}

void RetroMusicEditorPlugin::_release_live(int p_key) {
	if (!playing.has(p_key)) {
		return;
	}
	driver.note_off(playing[p_key]);
	playing.erase(p_key);
	_flush();
}

void RetroMusicEditorPlugin::note_on(int p_note, int p_velocity) {
	_start_sound();
	keys->lit[p_note] = p_velocity;
	keys->queue_redraw();
	const int sounding = CLAMP(p_note + octave * 12, 0, 127);
	_play_live(p_note, sounding, p_velocity);
	if (recording && is_playing) {
		PendingNote note;
		note.t = _current_tick();
		note.v = p_velocity;
		pending[sounding] = note;
	}
}

void RetroMusicEditorPlugin::note_off(int p_note) {
	keys->lit.erase(p_note);
	keys->queue_redraw();
	_release_live(p_note);
	const int sounding = CLAMP(p_note + octave * 12, 0, 127);
	if (recording && is_playing && pending.has(sounding)) {
		const PendingNote note = pending[sounding];
		pending.erase(sounding);
		const double now = _current_tick();
		_commit(sounding, note.v, note.t, now >= note.t ? now : song_player.to);
	}
}

void RetroMusicEditorPlugin::all_notes_off() {
	playing.clear();
	keys->lit.clear();
	keys->queue_redraw();
	driver.all_notes_off();
	driver.pitch_bend(0);
	driver.modulation(0);
	_flush();
}

void RetroMusicEditorPlugin::_key_pressed(int p_note, int p_velocity) {
	note_on(p_note, p_velocity);
}

void RetroMusicEditorPlugin::_key_released(int p_note) {
	note_off(p_note);
}

void RetroMusicEditorPlugin::_roll_cursor(int p_tick) {
	cursor = MIN(p_tick, song.length() - 1);
	roll->cursor = cursor;
	roll->queue_redraw();
}

// A nota do piano roll já é a que soa (sem a oitava do teclado).
void RetroMusicEditorPlugin::_roll_preview(int p_pitch, int p_velocity) {
	_start_sound();
	_play_live(-2, CLAMP(p_pitch, 0, 127), p_velocity);
}

void RetroMusicEditorPlugin::_roll_preview_end() {
	_release_live(-2);
}

void RetroMusicEditorPlugin::_roll_changed() {
	if (song.has_loop != loop_check->is_pressed() || song.has_loop) {
		_refresh_transport();
	}
	_song_changed();
}

// createPortDeduper: a mesma mensagem do mesmo teclado por outra porta, em menos de 500 ms, é cópia.
bool RetroMusicEditorPlugin::_accept_midi(const Ref<InputEventMIDI> &p_event) {
	const String key = vformat("%d|%d|%d|%d|%d", int(p_event->get_message()), p_event->get_channel(), p_event->get_pitch(), p_event->get_velocity(), p_event->get_controller_value());
	const uint64_t now = Time::get_singleton()->get_ticks_msec();
	if (recent_midi.has(key)) {
		const RecentMessage &last = recent_midi[key];
		if (last.device != p_event->get_device() && now - last.time < 500) {
			return false;
		}
	}
	RecentMessage entry;
	entry.device = p_event->get_device();
	entry.time = now;
	recent_midi[key] = entry;
	if (recent_midi.size() > 256) {
		recent_midi.clear();
	}
	return true;
}

void RetroMusicEditorPlugin::input(const Ref<InputEvent> &p_event) {
	const Ref<InputEventMIDI> midi = p_event;
	if (midi.is_null() || !main->is_visible_in_tree() || !_accept_midi(midi)) {
		return;
	}
	// Canal 10 são os pads: bateria (cada pad toca e grava a sua peça) ou atalhos do compositor.
	if (_pad_midi(midi)) {
		return;
	}
	const int channel = midi->get_channel();
	switch (midi->get_message()) {
		case MIDIMessage::NOTE_ON:
			if (channel == 9) {
				break;
			}
			if (midi->get_velocity() == 0) {
				note_off(midi->get_pitch());
			} else {
				note_on(midi->get_pitch(), midi->get_velocity());
			}
			break;
		case MIDIMessage::NOTE_OFF:
			if (channel != 9) {
				note_off(midi->get_pitch());
			}
			break;
		case MIDIMessage::PITCH_BEND:
			driver.pitch_bend((midi->get_pitch() - 8192) / 8192.0 * BEND_RANGE);
			_flush();
			break;
		case MIDIMessage::CONTROL_CHANGE:
			// Roda de modulação (CC1) → vibrato; CC 123 e 120 (pânico) soltam tudo.
			if (midi->get_controller_number() == 1) {
				driver.modulation(midi->get_controller_value() / 127.0);
				_flush();
			} else if (midi->get_controller_number() == 123 || midi->get_controller_number() == 120) {
				all_notes_off();
			}
			break;
		default:
			break;
	}
}

// Teclado do computador como nos trackers: Z…M a partir de C3, Q…I a partir de C4.
static int _computer_key_note(Key p_key) {
	switch (p_key) {
		case Key::Z:
			return 0;
		case Key::S:
			return 1;
		case Key::X:
			return 2;
		case Key::D:
			return 3;
		case Key::C:
			return 4;
		case Key::V:
			return 5;
		case Key::G:
			return 6;
		case Key::B:
			return 7;
		case Key::H:
			return 8;
		case Key::N:
			return 9;
		case Key::J:
			return 10;
		case Key::M:
			return 11;
		case Key::COMMA:
			return 12;
		case Key::Q:
			return 12;
		case Key::KEY_2:
			return 13;
		case Key::W:
			return 14;
		case Key::KEY_3:
			return 15;
		case Key::E:
			return 16;
		case Key::R:
			return 17;
		case Key::KEY_5:
			return 18;
		case Key::T:
			return 19;
		case Key::KEY_6:
			return 20;
		case Key::Y:
			return 21;
		case Key::KEY_7:
			return 22;
		case Key::U:
			return 23;
		case Key::I:
			return 24;
		default:
			return -1;
	}
}

void RetroMusicEditorPlugin::shortcut_input(const Ref<InputEvent> &p_event) {
	// Na janela separada, as teclas chegam pelo RetroMusicKeys de dentro dela.
	if (!separate && handle_key(p_event)) {
		main->get_viewport()->set_input_as_handled();
	}
}

void RetroMusicKeys::input(const Ref<InputEvent> &p_event) {
	if (RetroMusicEditorPlugin::singleton && RetroMusicEditorPlugin::singleton->handle_key(p_event)) {
		get_viewport()->set_input_as_handled();
	}
}

bool RetroMusicEditorPlugin::handle_key(const Ref<InputEventKey> &key) {
	if (key.is_null() || !main->is_visible_in_tree() || key->is_echo()) {
		return false;
	}
	Control *focus = main->get_viewport()->gui_get_focus_owner();
	if (focus && (Object::cast_to<LineEdit>(focus) || Object::cast_to<TextEdit>(focus))) {
		return false;
	}
	if (key->is_pressed() && key->is_command_or_control_pressed() && !key->is_alt_pressed()) {
		// Ctrl+Z, Ctrl+Shift+Z e Ctrl+Y: desfazer/refazer da música.
		const Key code = key->get_keycode();
		if (code == Key::Z || code == Key::Y) {
			if (code == Key::Y || key->is_shift_pressed()) {
				_redo();
			} else {
				_undo();
			}
			return true;
		}
		return false;
	}
	if (key->is_command_or_control_pressed() || key->is_alt_pressed()) {
		return false;
	}
	if (key->get_keycode() == Key::SPACE) {
		if (key->is_pressed()) {
			_toggle();
		}
		return true;
	}
	const int offset = _computer_key_note(key->get_physical_keycode());
	if (offset < 0) {
		return false;
	}
	if (key->is_pressed()) {
		if (!keys->lit.has(48 + offset)) {
			note_on(48 + offset, 100);
		}
	} else {
		note_off(48 + offset);
	}
	return true;
}

void RetroMusicEditorPlugin::_notification(int p_what) {
	if (p_what != NOTIFICATION_PROCESS) {
		return;
	}
	// Quadros de 1/60 s: envelopes do PSG e varreduras de altura, como o timer do antigo.
	const double delta = get_process_delta_time();
	tick_accumulator += delta;
	while (tick_accumulator >= 1.0 / 60) {
		tick_accumulator -= 1.0 / 60;
		driver.tick();
	}
	_flush();
	if (preview_left > 0) {
		preview_left -= delta;
		if (preview_left <= 0) {
			_release_live(-1);
		}
	}
	if (is_playing) {
		_pump();
	}
	const double tick = is_playing ? _current_tick() : cursor;
	if (is_playing) {
		roll->follow_playhead(tick);
	}
	const int bar = SONG_PPQ * song.beats_per_bar;
	position_label->set_text(itos(int(tick) / bar + 1) + "." + itos(int(tick) % bar / SONG_PPQ + 1));
	status_left -= delta;
	if (status_left <= 0) {
		status_left = 0.5;
		_update_status();
	}
	if (draft_left >= 0) {
		draft_left -= delta;
		if (draft_left < 0) {
			_write_draft();
		}
	}
	_update_lights();
}
