#include "retro_sgdk_plugin.h"

#include "core/config/project_settings.h"
#include "core/io/file_access.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "editor/editor_interface.h"
#include "editor/editor_node.h"
#include "editor/script/script_editor_plugin.h"
#include "editor/settings/editor_settings.h"
#include "retro_image_convert.h"
#include "retro_palette_dock.h"
#include "retro_sgdk_export.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/rich_text_label.h"

namespace {

// Arquivos de um projeto SGDK que o explorador mostra e o editor de código abre.
const char *SGDK_TEXT_EXTENSIONS[] = { "c", "h", "s", "asm", "inc", "res", "mk", "ld", nullptr };
// Arquivos que o explorador mostra sem abrir no editor de código.
// O VGM e o VGZ abrem como recurso de áudio (AudioStreamVGM).
const char *SGDK_OTHER_EXTENSIONS[] = { "bin", "xgm", "pal", nullptr };

const Color COLOR_INFO(0.55, 0.8, 1.0);
const Color COLOR_OK(0.5, 0.9, 0.5);
const Color COLOR_ERROR(1.0, 0.45, 0.45);
const Color COLOR_WARNING(1.0, 0.8, 0.35);

// Os textos do Retro Studio estão em UTF-8; String(const char *) lê Latin-1.
String U(const char *p_text) {
	return String::utf8(p_text);
}

void _add_extensions(const String &p_setting, const char **p_extensions) {
	Vector<String> extensions = String(EDITOR_GET(p_setting)).split(",", false);
	bool changed = false;
	for (int i = 0; p_extensions[i]; i++) {
		if (!extensions.has(p_extensions[i])) {
			extensions.push_back(p_extensions[i]);
			changed = true;
		}
	}
	if (changed) {
		EditorSettings::get_singleton()->set(p_setting, String(",").join(extensions));
	}
}

String _home() {
	return OS::get_singleton()->get_environment("HOME");
}

} // namespace

String RetroSgdkPlugin::_rom_path() const {
	return ProjectSettings::get_singleton()->get_resource_path().path_join("out/rom.bin");
}

void RetroSgdkPlugin::_append(const String &p_text, const Color &p_color) {
	if (p_color.a > 0) {
		output->push_color(p_color);
	}
	output->add_text(p_text);
	if (p_color.a > 0) {
		output->pop();
	}
}

// Linha do gcc/ld: "arquivo:linha[:coluna]: error|warning|note: …". Devolve "res://arquivo:linha:coluna"
// (só arquivos do projeto) e o tipo; vazio quando a linha não é um diagnóstico.
String RetroSgdkPlugin::_diagnostic_target(const String &p_line, String &r_kind) const {
	static const char *KINDS[] = { ": fatal error:", ": error:", ": warning:", ": note:", nullptr };
	for (int i = 0; KINDS[i]; i++) {
		const int at = p_line.find(KINDS[i]);
		if (at <= 0) {
			continue;
		}
		const Vector<String> parts = p_line.substr(0, at).split(":");
		if (parts.size() < 2 || !parts[1].is_valid_int()) {
			return String();
		}
		String file = parts[0].strip_edges();
		const int line = parts[1].to_int();
		const int column = parts.size() > 2 && parts[2].is_valid_int() ? parts[2].to_int() : 1;
		if (file.is_relative_path()) {
			file = project_dir.path_join(file);
		}
		const String local = ProjectSettings::get_singleton()->localize_path(file.simplify_path());
		if (!local.begins_with("res://") || !FileAccess::exists(local)) {
			return String();
		}
		r_kind = String(KINDS[i]).trim_prefix(": ").trim_suffix(":");
		return vformat("%s:%d:%d", local, line, column);
	}
	return String();
}

void RetroSgdkPlugin::_append_output(const String &p_text) {
	const Vector<String> lines = p_text.split("\n");
	for (int i = 0; i < lines.size(); i++) {
		const String &line = lines[i];
		const String end = i < lines.size() - 1 ? "\n" : "";
		String kind;
		const String target = _diagnostic_target(line, kind);
		if (target.is_empty()) {
			_append(line + end);
			continue;
		}
		Color color = COLOR_INFO;
		if (kind.ends_with("error")) {
			color = COLOR_ERROR;
			error_count++;
		} else if (kind == "warning") {
			color = COLOR_WARNING;
			warning_count++;
		}
		if (first_problem.is_empty() && kind != "note") {
			first_problem = target;
		}
		output->push_meta(target);
		_append(line, color);
		output->pop();
		_append(end);
	}
}

void RetroSgdkPlugin::_open_diagnostic(const Variant &p_meta) {
	// "res://arquivo:linha:coluna" (o caminho não tem ':' depois de res://).
	const String meta = p_meta;
	const int column_at = meta.rfind_char(':');
	const int line_at = meta.rfind_char(':', column_at - 1);
	if (line_at <= 6) {
		return;
	}
	const String path = meta.substr(0, line_at);
	const int line = meta.substr(line_at + 1, column_at - line_at - 1).to_int();
	const int column = meta.substr(column_at + 1).to_int();
	ScriptEditor *script_editor = ScriptEditor::get_singleton();
	const Ref<Resource> file = script_editor ? script_editor->open_file(path) : Ref<Resource>();
	if (file.is_null()) {
		return;
	}
	EditorInterface::get_singleton()->set_main_screen_editor("Script");
	script_editor->edit(file, MAX(line - 1, 0), MAX(column - 1, 0));
}

void RetroSgdkPlugin::_build_thread(void *p_self) {
	RetroSgdkPlugin *self = static_cast<RetroSgdkPlugin *>(p_self);
	// Sem shell interpretando caminhos: o sh só junta stderr ao stdout e executa o env com os
	// argumentos recebidos ("$@"); o env passa GDK e PATH ao make.
	List<String> args;
	args.push_back("-c");
	args.push_back("exec \"$@\" 2>&1");
	args.push_back("retro-studio-build");
	args.push_back("/usr/bin/env");
	args.push_back("GDK=" + self->gdk);
	args.push_back("PATH=" + self->gdk.path_join("bin") + ":" + OS::get_singleton()->get_environment("PATH"));
	args.push_back("make");
	args.push_back("-C");
	args.push_back(self->project_dir);
	const Dictionary process = OS::get_singleton()->execute_with_pipe("/bin/sh", args, true);
	const Ref<FileAccess> stdio = process.get("stdio", Ref<FileAccess>());
	if (stdio.is_null()) {
		self->exit_code = -1;
		self->building.clear();
		return;
	}
	// Lê em blocos e entrega só linhas inteiras, para não cortar um caractere UTF-8 ao meio.
	LocalVector<uint8_t> pending;
	uint8_t buffer[4096];
	while (true) {
		const uint64_t count = stdio->get_buffer(buffer, sizeof(buffer));
		for (uint64_t i = 0; i < count; i++) {
			pending.push_back(buffer[i]);
		}
		int64_t cut = count == 0 ? int64_t(pending.size()) : -1;
		for (int64_t i = int64_t(pending.size()) - 1; cut < 0 && i >= 0; i--) {
			if (pending[i] == '\n') {
				cut = i + 1;
			}
		}
		if (cut > 0) {
			{
				MutexLock lock(self->pipe_mutex);
				self->pipe += String::utf8((const char *)pending.ptr(), cut);
			}
			LocalVector<uint8_t> rest;
			for (uint32_t i = cut; i < pending.size(); i++) {
				rest.push_back(pending[i]);
			}
			pending = rest;
		}
		if (count == 0) {
			break;
		}
	}
	const ProcessID pid = process.get("pid", 0);
	while (OS::get_singleton()->is_process_running(pid)) {
		OS::get_singleton()->delay_usec(10000);
	}
	self->exit_code = OS::get_singleton()->get_process_exit_code(pid);
	self->building.clear();
}

void RetroSgdkPlugin::_start_build(bool p_run_after) {
	if (building.is_set()) {
		return;
	}
	project_dir = ProjectSettings::get_singleton()->get_resource_path();
	make_bottom_panel_item_visible(panel);
	output->clear();
	if (!FileAccess::exists(project_dir.path_join("Makefile"))) {
		_append(U("Este projeto não tem Makefile: o Retro Studio compila projetos SGDK.\n"), COLOR_ERROR);
		return;
	}
	if (ScriptEditor::get_singleton()) {
		ScriptEditor::get_singleton()->save_all_scripts();
	}
	EditorInterface::get_singleton()->save_all_scenes();
	// A cena principal (MDCena) vira código e recursos do SGDK antes do make.
	const RetroSgdkExport::Result exported = RetroSgdkExport::export_main_scene(project_dir);
	for (const String &warning : exported.warnings) {
		_append(U("Aviso: ") + warning + "\n", COLOR_WARNING);
	}
	for (const String &error : exported.errors) {
		_append(error + "\n", COLOR_ERROR);
	}
	if (!exported.errors.is_empty()) {
		_append(U("\nAs cenas têm problemas; corrija antes de compilar.\n"), COLOR_ERROR);
		return;
	}
	if (!exported.skipped) {
		_append(exported.written.is_empty() ? U("Cenas sem mudanças desde o último build.\n") : U("Cenas geradas: ") + String(", ").join(exported.written) + "\n", COLOR_INFO);
	}
	usage = exported.info;
	gdk = EDITOR_GET("retro_studio/sgdk/gdk_path");
	_append(U("Compilando ") + project_dir + U(" com o SGDK…\n"), COLOR_INFO);
	{
		MutexLock lock(pipe_mutex);
		pipe = String();
	}
	error_count = 0;
	warning_count = 0;
	first_problem = String();
	run_after_build = p_run_after;
	building.set();
	build_button->set_disabled(true);
	run_button->set_disabled(true);
	build_thread.start(_build_thread, this);
}

void RetroSgdkPlugin::_finish_build() {
	build_thread.wait_to_finish();
	build_button->set_disabled(false);
	run_button->set_disabled(false);
	if (error_count > 0 || warning_count > 0) {
		const String summary = vformat(U("\n%d erro(s), %d aviso(s)"), error_count, warning_count);
		const Color color = error_count > 0 ? COLOR_ERROR : COLOR_WARNING;
		if (first_problem.is_empty()) {
			_append(summary, color);
		} else {
			output->push_meta(first_problem);
			_append(summary + U(" — clique para ir ao primeiro"), color);
			output->pop();
		}
		_append("\n");
	}
	if (exit_code != 0) {
		_append(vformat(U("\nA compilação falhou (código %d).\n"), exit_code), COLOR_ERROR);
		return;
	}
	_append(U("\nROM pronta: ") + _rom_path() + "\n", COLOR_OK);
	// Uso de VRAM e de sprites por cena, calculado ao gerar as cenas.
	for (const String &line : usage) {
		_append(line + "\n", COLOR_INFO);
	}
	if (run_after_build) {
		_run_rom();
	}
}

void RetroSgdkPlugin::_run_rom() {
	const String rom = _rom_path();
	if (!FileAccess::exists(rom)) {
		_append(U("A ROM ainda não existe: compile primeiro.\n"), COLOR_ERROR);
		return;
	}
	// Uma janela de emulador por vez: rodar de novo troca a ROM em execução.
	if (emulator_pid && OS::get_singleton()->is_process_running(emulator_pid)) {
		OS::get_singleton()->kill(emulator_pid);
	}
	const String emulator = EDITOR_GET("retro_studio/emulator/path");
	List<String> args;
	args.push_back(rom);
	if (OS::get_singleton()->create_process(emulator, args, &emulator_pid) != OK) {
		emulator_pid = 0;
		_append(U("Não foi possível abrir o emulador: ") + emulator + U(" (Configurações do Editor → Retro Studio → Emulador).\n"), COLOR_ERROR);
		return;
	}
	_append(U("Rodando no emulador.\n"), COLOR_OK);
}

void RetroSgdkPlugin::_update_icons() {
	build_button->set_button_icon(build_button->get_editor_theme_icon(SNAME("RetroBuildRom")));
	run_button->set_button_icon(run_button->get_editor_theme_icon(SNAME("MainPlay")));
}

void RetroSgdkPlugin::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_ENTER_TREE: {
			_add_extensions("docks/filesystem/textfile_extensions", SGDK_TEXT_EXTENSIONS);
			_add_extensions("docks/filesystem/other_file_extensions", SGDK_OTHER_EXTENSIONS);
			set_process(true);
		} break;
		case NOTIFICATION_PROCESS: {
			String text;
			{
				MutexLock lock(pipe_mutex);
				text = pipe;
				pipe = String();
			}
			if (!text.is_empty()) {
				_append_output(text);
			}
			if (!building.is_set() && build_thread.is_started()) {
				_finish_build();
			}
		} break;
	}
}

RetroSgdkPlugin::RetroSgdkPlugin() {
	EDITOR_DEF("retro_studio/sgdk/gdk_path", _home().path_join(".retrostudio/toolkit/marsdev/mars/m68k-elf"));
	EDITOR_DEF("retro_studio/emulator/path", _home().path_join(".retrostudio/emulators/blastem/blastem"));
	EditorSettings::get_singleton()->add_property_hint(PropertyInfo(Variant::STRING, "retro_studio/sgdk/gdk_path", PROPERTY_HINT_GLOBAL_DIR));
	EditorSettings::get_singleton()->add_property_hint(PropertyInfo(Variant::STRING, "retro_studio/emulator/path", PROPERTY_HINT_GLOBAL_FILE));

	// Só ícones na barra de cima; o nome e o atalho ficam na dica.
	HBoxContainer *toolbar = memnew(HBoxContainer);
	build_button = memnew(Button);
	build_button->set_tooltip_text(U("Compilar ROM: roda o make do projeto com o SGDK."));
	build_button->set_theme_type_variation("RunBarButton");
	build_button->set_focus_mode(Control::FOCUS_NONE);
	build_button->set_shortcut(ED_SHORTCUT("retro_studio/build_rom", U("Compilar ROM"), Key::F6));
	build_button->set_shortcut_in_tooltip(true);
	build_button->connect(SceneStringName(pressed), callable_mp(this, &RetroSgdkPlugin::_start_build).bind(false));
	toolbar->add_child(build_button);
	run_button = memnew(Button);
	run_button->set_tooltip_text(U("Rodar no emulador: compila e abre a ROM."));
	run_button->set_theme_type_variation("RunBarButton");
	run_button->set_focus_mode(Control::FOCUS_NONE);
	run_button->set_shortcut(ED_SHORTCUT("retro_studio/run_rom", U("Rodar no emulador"), Key::F5));
	run_button->set_shortcut_in_tooltip(true);
	run_button->connect(SceneStringName(pressed), callable_mp(this, &RetroSgdkPlugin::_start_build).bind(true));
	toolbar->add_child(run_button);
	build_button->connect(SceneStringName(theme_changed), callable_mp(this, &RetroSgdkPlugin::_update_icons));
	add_control_to_container(CONTAINER_TOOLBAR, toolbar);

	panel = memnew(VBoxContainer);
	panel->set_custom_minimum_size(Size2(0, 180) * EDSCALE);
	output = memnew(RichTextLabel);
	output->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	output->set_selection_enabled(true);
	output->set_context_menu_enabled(true);
	output->set_scroll_follow(true);
	output->set_meta_underline(true);
	output->connect("meta_clicked", callable_mp(this, &RetroSgdkPlugin::_open_diagnostic));
	panel->add_child(output);
	add_control_to_bottom_panel(panel, "SGDK");

	add_dock(memnew(RetroPaletteDock));
	add_context_menu_plugin(EditorContextMenuPlugin::CONTEXT_SLOT_FILESYSTEM, memnew(RetroImageMenu));
}

RetroSgdkPlugin::~RetroSgdkPlugin() {
	if (build_thread.is_started()) {
		build_thread.wait_to_finish();
	}
}
