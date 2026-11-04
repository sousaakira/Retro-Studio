// #89 fase 2: instrumentos próprios da música no compositor (importar, da internet, editar, exportar).
// Porte da parte de instrumentos de MusicWorkspace.vue.
#include "retro_music_editor.h"

#include "retro_instrument_browser.h"
#include "retro_instrument_editor.h"
#include "retro_instrument_formats.h"
#include "retro_map_ui.h"

#include "core/io/file_access.h"
#include "editor/gui/editor_file_dialog.h"
#include "scene/gui/check_box.h"
#include "scene/gui/dialogs.h"
#include "scene/gui/item_list.h"
#include "scene/gui/label.h"
#include "scene/gui/scroll_container.h"

static constexpr const char *PREVIEW_ID = "x-preview";

void RetroMusicEditorPlugin::_show_instrument_panel(int p_panel) {
	instrument_library->set_visible(p_panel == 0);
	instrument_editor_scroll->set_visible(p_panel == 1);
	Object::cast_to<Control>(instrument_browser->get_parent())->set_visible(p_panel == 2);
	if (p_panel != 1) {
		editing_id = String();
	}
	if (p_panel == 0) {
		_fill_instruments();
	} else if (p_panel == 2) {
		instrument_browser->open();
	}
}

int RetroMusicEditorPlugin::_usage(const String &p_id) const {
	int count = 0;
	for (const RetroSongTrack &track : song.tracks) {
		count += track.instrument == p_id;
	}
	return count;
}

Array RetroMusicEditorPlugin::_add_instruments(const Array &p_list, bool p_assign) {
	Array added;
	const int room = SONG_MAX_INSTRUMENTS - song.instruments.size();
	if (room <= 0) {
		import_error->set_text(U("A música já tem ") + itos(SONG_MAX_INSTRUMENTS) + U(" instrumentos próprios."));
		import_error->show();
		return added;
	}
	for (int i = 0; i < MIN(room, p_list.size()); i++) {
		PackedStringArray taken;
		for (const RetroInstrument &own : song.instruments) {
			taken.push_back(own.id);
		}
		String error;
		const RetroInstrument instrument = RetroInstrumentFormats::song_instrument(p_list[i], taken, error);
		if (!error.is_empty()) {
			import_error->set_text(error);
			import_error->show();
			continue;
		}
		song.instruments.push_back(instrument);
		song.has_instruments = true;
		added.push_back(instrument.id);
	}
	if (p_list.size() > room) {
		import_error->set_text(U("Só ") + itos(room) + U(" couberam (limite de ") + itos(SONG_MAX_INSTRUMENTS) + U(" por música)."));
		import_error->show();
	}
	if (p_assign && !added.is_empty() && selected >= 0 && selected < song.tracks.size()) {
		song.tracks.write[selected].instrument = added[0];
		instrument_id = added[0];
	}
	_song_changed();
	_fill_instruments();
	if (p_assign && !added.is_empty()) {
		preview_instrument(added[0]);
	}
	return added;
}

void RetroMusicEditorPlugin::_import_pressed() {
	import_dialog->popup_file_dialog();
}

void RetroMusicEditorPlugin::_browser_pressed() {
	_show_instrument_panel(2);
}

void RetroMusicEditorPlugin::_import_files(const PackedStringArray &p_paths) {
	import_error->hide();
	Array found;
	PackedStringArray warnings;
	for (const String &path : p_paths) {
		PackedStringArray file_warnings;
		String error;
		const Array list = RetroInstrumentFormats::import_file(path.get_file(), FileAccess::get_file_as_bytes(path), file_warnings, error);
		if (!error.is_empty()) {
			import_error->set_text(path.get_file() + ": " + error);
			import_error->show();
			continue;
		}
		found.append_array(list);
		for (const String &warning : file_warnings) {
			if (!warnings.has(warning)) {
				warnings.push_back(warning);
			}
		}
	}
	if (found.size() > 1) {
		_choose(found, warnings);
	} else if (found.size() == 1) {
		_add_instruments(found, true);
		if (!warnings.is_empty()) {
			import_error->set_text(String(" ").join(warnings));
			import_error->show();
		}
	}
}

// Da internet: a seleção na biblioteca já é a escolha; um banco baixado de link abre o seletor.
void RetroMusicEditorPlugin::_browser_import(const Array &p_list, bool p_choose, const PackedStringArray &p_warnings) {
	import_error->hide();
	if (p_choose && p_list.size() > 1) {
		_show_instrument_panel(0);
		_choose(p_list, p_warnings);
	} else {
		_add_instruments(p_list, true);
	}
}

void RetroMusicEditorPlugin::_choose(const Array &p_list, const PackedStringArray &p_warnings) {
	import_choices = p_list;
	while (choose_list->get_child_count() > 0) {
		Node *child = choose_list->get_child(0);
		choose_list->remove_child(child);
		child->queue_free();
	}
	for (int i = 0; i < p_list.size(); i++) {
		const Dictionary item = p_list[i];
		CheckBox *check = memnew(CheckBox);
		const String kind = item.get("kind", "");
		check->set_text(String(item.get("name", "")) + "  " + (kind == "fm" ? String("FM") : (kind == "noise" ? U("Ruído") : String("PSG"))));
		check->set_pressed(i < 8);
		choose_list->add_child(check);
	}
	choose_help->set_text(itos(p_list.size()) + U(" instrumentos no arquivo. Marque os que entram na música.") + (p_warnings.is_empty() ? String() : "\n" + String(" ").join(p_warnings)));
	choose_dialog->popup_centered();
}

void RetroMusicEditorPlugin::_choose_all(bool p_on) {
	for (int i = 0; i < choose_list->get_child_count(); i++) {
		Object::cast_to<CheckBox>(choose_list->get_child(i))->set_pressed(p_on);
	}
}

void RetroMusicEditorPlugin::_confirm_import() {
	Array chosen;
	for (int i = 0; i < choose_list->get_child_count() && i < import_choices.size(); i++) {
		if (Object::cast_to<CheckBox>(choose_list->get_child(i))->is_pressed()) {
			chosen.push_back(import_choices[i]);
		}
	}
	import_choices.clear();
	if (!chosen.is_empty()) {
		_add_instruments(chosen, true);
	}
}

void RetroMusicEditorPlugin::_edit_copy() {
	if (selected < 0 || selected >= song.tracks.size()) {
		return;
	}
	const String id = song.tracks[selected].instrument;
	for (const RetroInstrument &own : song.instruments) {
		if (own.id == id) {
			_edit_instrument(id);
			return;
		}
	}
	for (const RetroInstrument &preset : RetroChipInstruments::presets()) {
		if (preset.id == id) {
			Dictionary source = preset.to_dictionary();
			source["name"] = preset.name + U(" (meu)");
			Array list;
			list.push_back(source);
			const Array added = _add_instruments(list, true);
			if (!added.is_empty()) {
				_edit_instrument(added[0]);
			}
			return;
		}
	}
}

void RetroMusicEditorPlugin::_edit_instrument(const String &p_id) {
	_show_instrument_panel(1);
	editing_id = p_id;
	instrument_editor->id = p_id;
	instrument_editor->used = _usage(p_id);
	instrument_editor->build();
}

void RetroMusicEditorPlugin::_instrument_activated(int p_index) {
	const String id = instrument_list->get_item_metadata(p_index);
	for (const RetroInstrument &own : song.instruments) {
		if (own.id == id) {
			_edit_instrument(id);
			return;
		}
	}
}

// Depois de desfazer/abrir: o editor acompanha o instrumento, ou fecha se ele sumiu.
void RetroMusicEditorPlugin::_sync_instrument_editor() {
	if (editing_id.is_empty()) {
		return;
	}
	for (const RetroInstrument &own : song.instruments) {
		if (own.id == editing_id) {
			instrument_editor->used = _usage(editing_id);
			instrument_editor->build();
			return;
		}
	}
	_show_instrument_panel(0);
}

// O teclado toca com os valores novos na próxima nota.
void RetroMusicEditorPlugin::_editor_changed() {
	driver.invalidate(editing_id);
	_song_changed();
}

void RetroMusicEditorPlugin::_editor_preview() {
	preview_instrument(editing_id);
}

void RetroMusicEditorPlugin::_editor_remove() {
	if (_usage(editing_id)) {
		return;
	}
	for (int i = 0; i < song.instruments.size(); i++) {
		if (song.instruments[i].id == editing_id) {
			song.instruments.remove_at(i);
			break;
		}
	}
	driver.invalidate(editing_id);
	_show_instrument_panel(0);
	_song_changed();
	_fill_instruments();
}

void RetroMusicEditorPlugin::_editor_close() {
	_show_instrument_panel(0);
}

void RetroMusicEditorPlugin::_editor_export(const String &p_format) {
	const RetroInstrument *instrument = _instrument(editing_id);
	if (!instrument) {
		return;
	}
	export_format = p_format;
	String name = instrument->name;
	for (const char *bad : { "\\", "/", ":", "*", "?", "\"", "<", ">", "|" }) {
		name = name.replace(bad, "_");
	}
	export_dialog->clear_filters();
	export_dialog->add_filter("*." + p_format, p_format.to_upper());
	export_dialog->set_current_file((name.is_empty() ? String("instrumento") : name) + "." + p_format);
	export_dialog->popup_file_dialog();
}

void RetroMusicEditorPlugin::_export_file(const String &p_path) {
	const RetroInstrument *instrument = _instrument(editing_id);
	if (!instrument) {
		return;
	}
	String error;
	const Vector<uint8_t> bytes = RetroInstrumentFormats::export_instrument(*instrument, export_format, error);
	if (!error.is_empty()) {
		_show_message(error, true);
		return;
	}
	Ref<FileAccess> file = FileAccess::open(p_path, FileAccess::WRITE);
	if (file.is_null()) {
		_show_message(U("Não foi possível gravar ") + p_path, true);
		return;
	}
	file->store_buffer(bytes.ptr(), bytes.size());
	_show_message(U("Instrumento exportado para ") + p_path + ".");
}

// Toca um instrumento que ainda não está na música (prévia da biblioteca online).
void RetroMusicEditorPlugin::_preview_patch(const Dictionary &p_instrument, int p_note) {
	Dictionary data = p_instrument.duplicate(true);
	data["id"] = PREVIEW_ID;
	data.erase("category");
	if (String(data.get("name", "")).strip_edges().is_empty()) {
		data["name"] = "Instrumento";
	}
	String error;
	const RetroInstrument patch = RetroInstrument::from_dictionary(data, error);
	if (!error.is_empty()) {
		return;
	}
	_start_sound();
	driver.invalidate(PREVIEW_ID);
	_play_live(-1, CLAMP(p_note + octave * 12, 0, 127), 100, &patch);
	preview_left = 0.6;
}
