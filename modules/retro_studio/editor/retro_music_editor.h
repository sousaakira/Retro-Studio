#pragma once

#include "retro_ble_midi.h"
#include "retro_chip_driver.h"
#include "retro_chip_stream.h"
#include "retro_piano_roll.h"
#include "retro_song.h"

class EditorFileDialog;
class RetroInstrumentBrowser;
class RetroInstrumentEditor;
class AcceptDialog;
class PopupPanel;
class RetroVgmBar;
class RetroVgmPlayer;
class ScrollContainer;

#include "core/templates/hash_map.h"
#include "editor/plugins/editor_plugin.h"
#include "scene/gui/control.h"

class AudioStreamPlayer;
class Button;
class CheckBox;
class ConfirmationDialog;
class HBoxContainer;
class LineEdit;
class SpinBox;
class HSlider;
class ItemList;
class Label;
class OptionButton;
class VBoxContainer;
class Window;
class RetroMusicEditorPlugin;

// Na janela separada, as teclas não chegam aos atalhos do editor: este node, dentro da janela, recebe
// as teclas antes dos controles e passa ao compositor (notas pelo teclado do computador, Espaço, Ctrl+Z).
class RetroMusicKeys : public Node {
	GDCLASS(RetroMusicKeys, Node);

protected:
	virtual void input(const Ref<InputEvent> &p_event) override;

public:
	RetroMusicKeys() { set_process_input(true); }
};

// Teclado na tela (duas oitavas e meia): clique toca, arrastar desliza; mostra as notas apertadas
// (também as do teclado MIDI).
class RetroPianoKeys : public Control {
	GDCLASS(RetroPianoKeys, Control)

	int pressed_note = -1;
	int _note_at(const Vector2 &p_position) const;
	bool _is_black(int p_note) const;

protected:
	void _notification(int p_what);
	static void _bind_methods();
	virtual void gui_input(const Ref<InputEvent> &p_event) override;

public:
	int first_note = 48; // C3
	int count = 30;
	HashMap<int, int> lit; // nota → velocity
};

// Tela principal "Música" (#89), aberta numa janela própria (ou encaixada na tela): o compositor do Retro Studio atual (MusicWorkspace.vue + useSongEditor.js).
// Músicas em music/<id>.song.json, faixas com instrumento FM/PSG, piano roll, tocar com loop e metrônomo,
// gravar pelo teclado, desfazer/refazer e rascunho em .retro-studio/drafts/music.json. O som: YM2612 + PSG
// emulados, chip 0 para a música e chip 1 para o teclado ao vivo.
class RetroMusicEditorPlugin : public EditorPlugin {
	GDCLASS(RetroMusicEditorPlugin, EditorPlugin)

	struct Player {
		int from = 0;
		int to = 0;
		double start = 0;
		RetroSongTimeline timeline;
		int next = 0;
		int beat = 0;
		double duration = 0;
	};
	struct PendingNote {
		double t = 0;
		int v = 100;
	};

	VBoxContainer *main = nullptr;
	// Janela separada (padrão) ou encaixado na tela principal Música.
	Window *window = nullptr;
	VBoxContainer *placeholder = nullptr;
	Button *window_button = nullptr;
	bool separate = true;
	bool screen_visible = false;
	bool active = false;
	void _place_main();
	void _show_window();
	void _window_closed();
	void _toggle_separate();
	void _activate();
	void _deactivate();
	// Música.
	OptionButton *song_select = nullptr;
	LineEdit *name_edit = nullptr;
	LineEdit *id_edit = nullptr;
	Button *save_button = nullptr;
	Button *export_button = nullptr;
	Label *sound_status = nullptr;
	Button *sound_button = nullptr;
	Label *keyboard_status = nullptr;
	Button *keyboard_button = nullptr;
	HBoxContainer *recovered_bar = nullptr;
	Label *recovered_label = nullptr;
	Label *message = nullptr;
	ConfirmationDialog *open_dialog = nullptr;
	// Transporte.
	Button *play_button = nullptr;
	Button *record_button = nullptr;
	Label *position_label = nullptr;
	SpinBox *tempo_spin = nullptr;
	SpinBox *beats_spin = nullptr;
	SpinBox *bars_spin = nullptr;
	OptionButton *grid_select = nullptr;
	CheckBox *quantize_check = nullptr;
	CheckBox *metronome_check = nullptr;
	CheckBox *loop_check = nullptr;
	SpinBox *loop_from_spin = nullptr;
	SpinBox *loop_to_spin = nullptr;
	Label *loop_from_label = nullptr;
	Label *loop_to_label = nullptr;
	CheckBox *fm6_check = nullptr;
	Button *undo_button = nullptr;
	Button *redo_button = nullptr;
	Label *channel_lights[10] = {};
	// Faixas, piano roll e instrumentos.
	VBoxContainer *tracks_box = nullptr;
	Button *add_track_button = nullptr;
	Label *tracks_help = nullptr;
	RetroPianoRoll *roll = nullptr;
	Label *instrument_current = nullptr;
	OptionButton *kind_select = nullptr;
	ItemList *instrument_list = nullptr;
	// Instrumentos da música: importar, da internet, editar.
	VBoxContainer *instrument_library = nullptr;
	ScrollContainer *instrument_editor_scroll = nullptr;
	RetroInstrumentEditor *instrument_editor = nullptr;
	RetroInstrumentBrowser *instrument_browser = nullptr;
	Label *import_error = nullptr;
	EditorFileDialog *import_dialog = nullptr;
	EditorFileDialog *export_dialog = nullptr;
	ConfirmationDialog *choose_dialog = nullptr;
	VBoxContainer *choose_list = nullptr;
	Label *choose_help = nullptr;
	Array import_choices;
	String editing_id;
	String export_format;
	// Teclado.
	Label *octave_label = nullptr;
	HSlider *volume_slider = nullptr;
	RetroPianoKeys *keys = nullptr;

	AudioStreamPlayer *player = nullptr;
	RetroVgmPlayer *vgm_player = nullptr;
	AcceptDialog *vgm_dialog = nullptr;
	EditorFileDialog *vgm_file_dialog = nullptr;
	void _open_vgm_pressed();
	void _vgm_file_selected(const String &p_path);
	Label *vgm_title = nullptr;
	RetroVgmBar *vgm_bar = nullptr;
	Ref<RetroChipEngine> engine;
	RetroChipDriver driver;
	bool sound_on = false;
	String instrument_id; // Instrumento das faixas novas.
	int octave = 0;
	double tick_accumulator = 0;
	double status_left = 0;
	RetroBleMidi ble;
	HashMap<int, int> playing; // tecla → nota soando (com a oitava)
	double preview_left = 0;
	int roll_preview = -1;
	// Deduplicação das portas (o SMK-25 por USB manda cada nota por duas portas).
	struct RecentMessage {
		int device = 0;
		uint64_t time = 0;
	};
	HashMap<String, RecentMessage> recent_midi;

	// Documento.
	bool loaded = false;
	RetroSong song;
	String baseline;
	String revision;
	String saved_id;
	Array songs;
	int selected = 0;
	int grid = 12;
	bool quantize = true;
	bool metronome = false;
	int cursor = 0;
	String pending_open;
	Vector<String> history;
	int history_index = -1;
	double draft_left = -1;
	bool draft_owned = false;
	String recovered_at;
	// Reprodução e gravação.
	bool is_playing = false;
	bool recording = false;
	Player song_player;
	HashMap<int, PendingNote> pending;

	// Pads (canal 10 do MIDI; porte de drumPads.js, useDrumPads.js e PadPanel.vue).
	struct PadKit {
		String instrument;
		int note = 60;
	};
	struct PadPending {
		double t = 0;
		int v = 100;
		int n = 60;
		int track = -1;
	};
	bool pad_controls = false;
	int pad_notes[8] = {};
	PadKit pad_kit[8];
	int pad_learning = -1;
	HashMap<int, int> pad_lit; // pad → velocity
	HashMap<int, int> pad_playing; // pad → nota soando
	HashMap<int, PadPending> pad_pending;
	Button *pad_buttons[8] = {};
	Button *pad_drums_button = nullptr;
	Button *pad_controls_button = nullptr;
	Label *pad_learn_label = nullptr;
	Button *pad_learn_cancel = nullptr;
	PopupPanel *pad_config = nullptr;
	VBoxContainer *pad_config_box = nullptr;

	void _build_pads(Control *p_parent);
	void _load_pads();
	void _save_pads();
	void _update_pads();
	void _fill_pad_config();
	bool _pad_midi(const Ref<InputEventMIDI> &p_event);
	void _pad_hit(int p_index, int p_velocity);
	void _pad_down(int p_index);
	void _pad_up(int p_index);
	void _pad_mode(bool p_controls);
	void _pad_configure();
	void _pad_instrument_selected(int p_item, int p_pad, Object *p_select);
	void _pad_note_changed(double p_value, int p_pad);
	void _pad_learn();
	void _pad_learn_cancel();
	void _pad_reset();
	int _drum_track(const String &p_instrument);

	String _root() const;
	const RetroInstrument *_instrument(const String &p_id) const;
	const RetroInstrument *_live_instrument() const;
	bool _dirty() const;
	void _flush();
	void _start_sound();
	void _stop_sound();
	void _connect_keyboard();
	void _update_status();
	void _show_message(const String &p_text, bool p_problem = false);

	void _set_document(const RetroSong &p_song, const String &p_revision, const String &p_saved);
	String _unique_id() const;
	void _new_song();
	void _refresh_list();
	void _open(const String &p_id);
	bool _save(bool p_export = false);
	void _song_selected(int p_index);
	void _open_choice(const String &p_value);
	void _open_dialog_action(const StringName &p_action);
	void _open_dialog_confirmed();
	void _name_changed(const String &p_text);
	void _id_changed(const String &p_text);
	void _song_changed(bool p_record = true);
	void _record_history();
	void _undo();
	void _redo();
	void _apply_history();
	void _write_draft();
	void _delete_draft();
	bool _restore_draft();
	void _discard_draft();
	void _first_load();

	void _rebuild_tracks();
	void _update_tracks();
	void _select_track(int p_index);
	void _track_input(const Ref<InputEvent> &p_event, int p_index);
	void _track_name_changed(const String &p_text, int p_index);
	void _track_flag(int p_index, bool p_solo);
	void _add_track();
	void _remove_track(int p_index);
	void _refresh_transport();
	void _tempo_changed(double p_value);
	void _beats_changed(double p_value);
	void _bars_changed(double p_value);
	void _set_bars(int p_bars);
	void _grid_selected(int p_index);
	void _quantize_toggled(bool p_on);
	void _metronome_toggled(bool p_on);
	void _loop_toggled(bool p_on);
	void _loop_bars_changed(double p_value);
	void _fm6_toggled(bool p_on);
	void _update_lights();

	Player _segment(int p_from, double p_start);
	void _play(int p_from);
	void _pump();
	double _current_tick(bool p_compensate = true) const;
	void _stop();
	void _toggle();
	void _record();
	void _commit(int p_note, int p_velocity, double p_start, double p_end, int p_track = -1);
	void _close_pending(double p_end);
	void _rewind();

	void _fill_instruments();
	void _show_instrument_panel(int p_panel); // 0 lista, 1 editor, 2 internet
	int _usage(const String &p_id) const;
	Array _add_instruments(const Array &p_list, bool p_assign);
	void _import_pressed();
	void _browser_pressed();
	void _import_files(const PackedStringArray &p_paths);
	void _browser_import(const Array &p_list, bool p_choose, const PackedStringArray &p_warnings);
	void _choose(const Array &p_list, const PackedStringArray &p_warnings);
	void _choose_all(bool p_on);
	void _confirm_import();
	void _edit_copy();
	void _edit_instrument(const String &p_id);
	void _instrument_activated(int p_index);
	void _sync_instrument_editor();
	void _editor_changed();
	void _editor_preview();
	void _editor_remove();
	void _editor_close();
	void _editor_export(const String &p_format);
	void _export_file(const String &p_path);
	void _preview_patch(const Dictionary &p_instrument, int p_note);
	void _kind_selected(int p_index);
	void _instrument_selected(int p_index);
	void _octave(int p_delta);
	void _volume_changed(double p_value);
	void _play_live(int p_key, int p_note, int p_velocity, const RetroInstrument *p_instrument = nullptr);
	void _release_live(int p_key);
	void _key_pressed(int p_note, int p_velocity);
	void _key_released(int p_note);
	void _roll_cursor(int p_tick);
	void _roll_preview(int p_pitch, int p_velocity);
	void _roll_preview_end();
	void _roll_changed();
	bool _accept_midi(const Ref<InputEventMIDI> &p_event);
	void _save_settings();
	void _vgm_dialog_visibility();

protected:
	void _notification(int p_what);

public:
	inline static RetroMusicEditorPlugin *singleton = nullptr;
	void note_on(int p_note, int p_velocity = 100);
	void note_off(int p_note);
	void all_notes_off();
	void preview_instrument(const String &p_id);
	// #103: VGM/VGZ clicado no explorador abre numa janela e já começa a tocar. p_path: res://…
	bool open_vgm(const String &p_path);
	// IA (music_open): abre (e toca) uma música, sem passar por cima de alterações não salvas de outra.
	Dictionary ai_open_song(const String &p_id, bool p_play);
	// IA (music_write): a música mudou no disco; recarrega se estiver aberta e sem alterações.
	Dictionary ai_song_changed(const String &p_id);
	// Teclas do compositor (notas, Espaço, desfazer); verdadeiro se usou a tecla.
	bool handle_key(const Ref<InputEventKey> &p_key);

	virtual String get_plugin_name() const override { return String::utf8("Música"); }
	virtual bool has_main_screen() const override { return true; }
	virtual const Ref<Texture2D> get_plugin_icon() const override;
	virtual void make_visible(bool p_visible) override;
	virtual void input(const Ref<InputEvent> &p_event) override;
	virtual void shortcut_input(const Ref<InputEvent> &p_event) override;

	RetroMusicEditorPlugin();
	~RetroMusicEditorPlugin();
};
