#include "retro_sgdk_plugin.h"

#include "core/config/project_settings.h"
#include "core/io/file_access.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "editor/editor_interface.h"
#include "core/io/dir_access.h"
#include "editor/editor_node.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/gui/editor_toaster.h"
#include "editor/script/script_editor_plugin.h"
#include "editor/settings/editor_settings.h"
#include "retro_image_convert.h"
#include "retro_palette_dock.h"
#include "retro_rom_releases.h"
#include "retro_sgdk_export.h"
#include "../scene/md_nodes.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/editor_data.h"
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

RetroSgdkPlugin *RetroSgdkPlugin::singleton = nullptr;

void RetroSgdkPlugin::_append(const String &p_text, const Color &p_color) {
	report_log += p_text;
	if (report_log.length() > 12000) {
		report_log = report_log.substr(report_log.length() - 10000);
	}
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

// Onde a função p_function chama p_symbol nos .c do projeto ("res://arquivo:linha:coluna"); com LTO o ld
// não diz o arquivo. Vazio quando não acha.
String RetroSgdkPlugin::_link_target(const String &p_function, const String &p_symbol) const {
	if (p_function.is_empty()) {
		return String();
	}
	Vector<String> folders = { "res://src" };
	while (!folders.is_empty()) {
		const String folder = folders[folders.size() - 1];
		folders.remove_at(folders.size() - 1);
		if (folder.ends_with("/gerado")) {
			continue;
		}
		Ref<DirAccess> dir = DirAccess::open(folder);
		if (dir.is_null()) {
			continue;
		}
		for (const String &sub : dir->get_directories()) {
			folders.push_back(folder.path_join(sub));
		}
		for (const String &name : dir->get_files()) {
			if (name.get_extension() != "c") {
				continue;
			}
			const Vector<String> lines = FileAccess::get_file_as_string(folder.path_join(name)).split("\n");
			int inside = -1; // Linha da definição de p_function.
			for (int i = 0; i < lines.size(); i++) {
				const String &line = lines[i];
				if (inside < 0) {
					const int at = line.find(p_function + "(");
					if (at > 0 && !line.begins_with("\t") && !line.begins_with(" ") && !line.strip_edges().ends_with(";")) {
						inside = i;
					}
				} else if (line.begins_with("}")) {
					break;
				} else {
					const int at = line.find(p_symbol);
					if (at >= 0) {
						return vformat("%s:%d:%d", folder.path_join(name), i + 1, at + 1);
					}
				}
			}
			if (inside >= 0) {
				return vformat("%s:%d:1", folder.path_join(name), inside + 1);
			}
		}
	}
	return String();
}

void RetroSgdkPlugin::_append_output(const String &p_text) {
	const Vector<String> lines = p_text.split("\n");
	for (int i = 0; i < lines.size(); i++) {
		const String &line = lines[i];
		const String end = i < lines.size() - 1 ? "\n" : "";
		const int in_function = line.find(": in function `");
		if (in_function >= 0) {
			link_function = line.substr(in_function + 15).get_slicec('\'', 0);
		}
		const int undefined = line.find("undefined reference to `");
		if (undefined >= 0) {
			const String symbol = line.substr(undefined + 24).get_slicec('\'', 0);
			if (link_errors.has(link_function + "/" + symbol)) {
				_append(line + end);
				continue;
			}
			link_errors.insert(link_function + "/" + symbol);
			const String target = _link_target(link_function, symbol);
			const String message = link_function.is_empty() ? vformat(U("%s não existe (o linker não achou a função ou variável)"), symbol) : vformat(U("%s não existe (chamada em %s; o linker não achou a função ou variável)"), symbol, link_function);
			error_count++;
			if (first_problem.is_empty() && !target.is_empty()) {
				first_problem = target;
			}
			if (report_problems.size() < 40) {
				const Vector<String> parts = target.trim_prefix("res://").split(":");
				report_problems.push_back(target.is_empty() ? "ld: error: " + message : target.trim_prefix("res://") + ": error: " + message);
				Dictionary problem;
				problem["file"] = target.is_empty() ? String() : ProjectSettings::get_singleton()->globalize_path("res://" + parts[0]);
				problem["line"] = parts.size() > 1 ? parts[1].to_int() : 1;
				problem["column"] = parts.size() > 2 ? parts[2].to_int() : 1;
				problem["message"] = message;
				problem["type"] = "error";
				report_errors.push_back(problem);
			}
			if (!target.is_empty()) {
				output->push_meta(target);
			}
			_append(line, COLOR_ERROR);
			if (!target.is_empty()) {
				output->pop();
			}
			_append(end);
			continue;
		}
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
		if (kind != "note" && report_problems.size() < 40) {
			report_problems.push_back(line.strip_edges());
			const Vector<String> parts = target.trim_prefix("res://").split(":");
			Dictionary problem;
			problem["file"] = ProjectSettings::get_singleton()->globalize_path("res://" + parts[0]);
			problem["line"] = parts.size() > 1 ? parts[1].to_int() : 1;
			problem["column"] = parts.size() > 2 ? parts[2].to_int() : 1;
			problem["message"] = line.substr(line.find(": " + kind + ":") + kind.length() + 3).strip_edges();
			problem["type"] = kind;
			report_errors.push_back(problem);
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

// Projeto → Ferramentas → Criar código C da cena: src/<cena>.c com as funções que o jogo gerado chama.
void RetroSgdkPlugin::_create_scene_code() {
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	if (!root || !root->is_class("MDCena") || root->get_scene_file_path().is_empty()) {
		EditorToaster::get_singleton()->popup_str(U("Abra e salve uma cena com uma MDCena na raiz."), EditorToaster::SEVERITY_WARNING);
		return;
	}
	const String ident = RetroSgdkExport::scene_identifier(root->get_scene_file_path());
	const String path = "res://src/" + ident + ".c";
	if (!FileAccess::exists(path)) {
		DirAccess::make_dir_recursive_absolute(ProjectSettings::get_singleton()->globalize_path("res://src"));
		const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
		if (file.is_null()) {
			EditorToaster::get_singleton()->popup_str(U("Não foi possível criar ") + path + ".", EditorToaster::SEVERITY_ERROR);
			return;
		}
		file->store_string(vformat(U("// Código C da cena %s (%s). O jogo gerado chama estas funções; apague a que não usar.\n"
									 "// Os sprites da cena e o resto do jogo (vidas, pontos, sons, trocar de cena) estão em\n"
									 "// gerado/cena_%s.h, que o build refaz a partir da cena.\n"
									 "#include \"gerado/cena_%s.h\"\n"
									 "\n"
									 "// Uma vez, com a cena montada, antes de clarear a tela.\n"
									 "void %s_iniciar(void) {\n"
									 "}\n"
									 "\n"
									 "// Todo quadro, depois do jogo gerado e antes de os sprites irem para a tela.\n"
									 "void %s_atualizar(void) {\n"
									 "}\n"),
				root->get_name(), root->get_scene_file_path().get_file(), ident, ident, ident, ident));
		file->close();
		EditorFileSystem::get_singleton()->scan_changes();
	}
	_open_diagnostic(path + ":1:1");
}

void RetroSgdkPlugin::_create_actor_code() {
	MDAtor *ator = nullptr;
	for (Node *node : EditorInterface::get_singleton()->get_selection()->get_top_selected_node_list()) {
		ator = ator ? ator : Object::cast_to<MDAtor>(node);
	}
	if (!ator) {
		EditorToaster::get_singleton()->popup_str(U("Selecione um MDAtor na árvore da cena."), EditorToaster::SEVERITY_WARNING);
		return;
	}
	String path = ator->get_codigo();
	if (path.is_empty()) {
		String base;
		const String name = String(ator->get_name()).to_lower();
		for (int i = 0; i < name.length(); i++) {
			base += is_ascii_alphanumeric_char(name[i]) ? String::chr(name[i]) : String("_");
		}
		path = "res://src/" + (base.is_empty() || is_digit(base[0]) ? "ator_" + base : base) + ".c";
	}
	if (!FileAccess::exists(path)) {
		DirAccess::make_dir_recursive_absolute(ProjectSettings::get_singleton()->globalize_path(path.get_base_dir()));
		const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
		if (file.is_null()) {
			EditorToaster::get_singleton()->popup_str(U("Não foi possível criar ") + path + ".", EditorToaster::SEVERITY_ERROR);
			return;
		}
		MDAtor probe;
		probe.set_codigo(path);
		const String prefix = probe.get_prefixo();
		file->store_string(vformat(U("// Código do ator %s: roda no Mega Drive a cada quadro, como um script do Godot.\n"
									 "// A API (controle, mover_e_colidir, animações, outros atores, sons) está em gerado/ator.h, e as\n"
									 "// animações do personagem (ANIM_...) em gerado/codigo_%s.h, que o build refaz.\n"
									 "#include \"gerado/codigo_%s.h\"\n"
									 "\n"
									 "// Posições e velocidades em 1/256 de pixel: PX(2) são 2 pixels.\n"
									 "#define VELOCIDADE PX(2) // Por quadro.\n"
									 "#define PULO PX(5) // Velocidade inicial do pulo.\n"
									 "#define GRAVIDADE 64 // Somada à velocidade de queda a cada quadro (1/4 de pixel).\n"
									 "#define QUEDA_MAXIMA PX(6)\n"
									 "\n"
									 "// Uma vez, quando o ator aparece.\n"
									 "void %s_pronto(Ator *eu) {\n"
									 "}\n"
									 "\n"
									 "// A cada quadro: andar com o direcional e pular com C.\n"
									 "void %s_quadro(Ator *eu) {\n"
									 "\taplicar_gravidade(eu, GRAVIDADE, QUEDA_MAXIMA);\n"
									 "\tif (eu->no_chao && apertou(BOTAO_C)) {\n"
									 "\t\teu->vy = -PULO;\n"
									 "\t}\n"
									 "\teu->vx = 0;\n"
									 "\tif (botao(BOTAO_ESQUERDA)) {\n"
									 "\t\teu->vx = -VELOCIDADE;\n"
									 "\t\tvirar(eu, -1);\n"
									 "\t} else if (botao(BOTAO_DIREITA)) {\n"
									 "\t\teu->vx = VELOCIDADE;\n"
									 "\t\tvirar(eu, 1);\n"
									 "\t}\n"
									 "\tmover_e_colidir(eu);\n"
									 "}\n"),
				ator->get_name(), prefix, prefix, prefix, prefix));
		file->close();
		EditorFileSystem::get_singleton()->scan_changes();
	}
	if (ator->get_codigo() != path) {
		EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
		undo->create_action(U("Criar código do ator"));
		undo->add_do_property(ator, "codigo", path);
		undo->add_undo_property(ator, "codigo", ator->get_codigo());
		undo->commit_action();
	}
	_open_diagnostic(path + ":1:1");
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
	if (self->clean_build) {
		// Versão para teste: build limpo de release (os alvos rodam em ordem).
		args.push_back("clean");
		args.push_back("release");
	}
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
	self->build_pid.set(pid);
	while (OS::get_singleton()->is_process_running(pid)) {
		OS::get_singleton()->delay_usec(10000);
	}
	self->exit_code = OS::get_singleton()->get_process_exit_code(pid);
	self->build_pid.set(0);
	self->building.clear();
}

void RetroSgdkPlugin::_start_build(bool p_run_after) {
	if (building.is_set()) {
		return;
	}
	project_dir = ProjectSettings::get_singleton()->get_resource_path();
	make_bottom_panel_item_visible(panel);
	output->clear();
	report = Dictionary();
	report_problems.clear();
	report_errors.clear();
	report_log = String();
	if (!FileAccess::exists(project_dir.path_join("Makefile"))) {
		_append(U("Este projeto não tem Makefile: o Retro Studio compila projetos SGDK.\n"), COLOR_ERROR);
		_report_finish(false, U("O projeto não tem Makefile."));
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
		report_problems.push_back(error);
		Dictionary problem;
		problem["message"] = error;
		problem["type"] = "error";
		report_errors.push_back(problem);
	}
	report["avisos_das_cenas"] = Variant(exported.warnings);
	if (!exported.errors.is_empty()) {
		_append(U("\nAs cenas têm problemas; corrija antes de compilar.\n"), COLOR_ERROR);
		_report_finish(false, U("As cenas têm problemas (veja problemas); o make não rodou."));
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
	link_function = String();
	link_errors.clear();
	run_after_build = p_run_after;
	clean_build = !release_draft.is_empty();
	building.set();
	build_button->set_disabled(true);
	run_button->set_disabled(true);
	release_button->set_disabled(true);
	build_thread.start(_build_thread, this);
}

void RetroSgdkPlugin::_finish_build() {
	build_thread.wait_to_finish();
	build_button->set_disabled(false);
	run_button->set_disabled(false);
	release_button->set_disabled(false);
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
		_report_finish(false, vformat(U("O make falhou (código %d)."), exit_code));
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
	_report_finish(true, String());
}

void RetroSgdkPlugin::_report_finish(bool p_ok, const String &p_reason) {
	report["ok"] = p_ok;
	if (!p_reason.is_empty()) {
		report["motivo"] = p_reason;
	}
	report["erros"] = error_count;
	report["avisos"] = warning_count;
	report["problemas"] = report_problems;
	report["uso_vram"] = usage;
	report["rom"] = p_ok ? _rom_path() : String();
	report["emulador"] = p_ok && run_after_build;
	report["fim_do_log"] = report_log.length() > 3000 ? report_log.substr(report_log.length() - 3000) : report_log;
	if (release_draft.is_empty()) {
		return;
	}
	// Versão para teste: com o build bom, a ROM vira a cópia numerada e o registro.
	const Dictionary draft = release_draft;
	release_draft = Dictionary();
	String error = p_reason;
	Dictionary release;
	if (p_ok) {
		release = RetroRomReleases::finish(project_dir, draft, _rom_path(), error);
	} else if (error.is_empty()) {
		error = U("O build falhou.");
	}
	if (release.is_empty()) {
		_append(U("\nA versão ") + String(draft["version"]) + U(" não foi gerada: ") + error + "\n", COLOR_ERROR);
		report["versao_erro"] = error;
		if (release_dialog) {
			release_dialog->release_failed(error);
		}
		return;
	}
	const String rom = Dictionary(release["rom"])["file"];
	_append(vformat(U("\nVersão %s gerada: %s (registro em releases/releases.json e releases/CHANGELOG.md).\n"), draft["version"], rom), COLOR_OK);
	report["versao"] = release;
	EditorFileSystem::get_singleton()->scan_changes();
	if (release_dialog) {
		release_dialog->release_done(release);
	}
}

bool RetroSgdkPlugin::start_release(const Dictionary &p_request, String &r_error) {
	if (is_building()) {
		r_error = U("Já há um build rodando; espere ele terminar.");
		return false;
	}
	const String dir = ProjectSettings::get_singleton()->get_resource_path();
	if (!FileAccess::exists(dir.path_join("Makefile"))) {
		r_error = U("Este projeto não tem Makefile: o Retro Studio compila projetos SGDK.");
		return false;
	}
	release_draft = RetroRomReleases::prepare(dir, p_request, r_error);
	if (release_draft.is_empty()) {
		return false;
	}
	_start_build(false);
	if (is_building()) {
		return true;
	}
	// Parou antes do make (cenas com problemas): o _report_finish já avisou e limpou o rascunho.
	r_error = report.get("versao_erro", report.get("motivo", U("O build não começou.")));
	return false;
}

void RetroSgdkPlugin::_open_releases() {
	if (!release_dialog) {
		release_dialog = memnew(RetroReleaseDialog);
		EditorNode::get_singleton()->get_gui_base()->add_child(release_dialog);
	}
	release_dialog->open();
}

bool RetroSgdkPlugin::start_build_for_ai(bool p_run) {
	if (is_building()) {
		return false;
	}
	_start_build(p_run);
	return is_building();
}

Dictionary RetroSgdkPlugin::get_report() const {
	return report;
}

Dictionary RetroSgdkPlugin::get_summary() const {
	Dictionary summary;
	const bool ok = report.get("ok", false);
	summary["success"] = ok;
	summary["romPath"] = ok ? Variant(_rom_path()) : Variant();
	summary["exitCode"] = exit_code;
	summary["error"] = ok ? Variant() : report.get("motivo", Variant());
	Array errors;
	for (const Variant &item : report_errors) {
		if (String(Dictionary(item).get("type", "")).ends_with("error") && errors.size() < 40) {
			errors.push_back(item);
		}
	}
	summary["errors"] = errors;
	summary["warnings"] = warning_count;
	return summary;
}

void RetroSgdkPlugin::stop_all() {
	if (build_pid.get()) {
		List<String> args;
		args.push_back("-TERM");
		args.push_back("--");
		args.push_back("-" + itos(build_pid.get())); // O grupo do make (o sh criou uma sessão nova).
		OS::get_singleton()->execute("/bin/kill", args);
	}
	if (emulator_pid && OS::get_singleton()->is_process_running(emulator_pid)) {
		OS::get_singleton()->kill(emulator_pid);
	}
	emulator_pid = 0;
}

void RetroSgdkPlugin::open_problem(const Dictionary &p_problem) {
	String file = p_problem.get("file", "");
	if (file.is_empty()) {
		return;
	}
	if (!file.begins_with("res://")) {
		file = ProjectSettings::get_singleton()->localize_path(file.is_relative_path() ? ProjectSettings::get_singleton()->get_resource_path().path_join(file) : file);
	}
	_open_diagnostic(vformat("%s:%d:%d", file, int(p_problem.get("line", 1)), int(p_problem.get("column", 1))));
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
	release_button->set_button_icon(release_button->get_editor_theme_icon(SNAME("RetroRelease")));
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
	singleton = this;
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
	release_button = memnew(Button);
	release_button->set_tooltip_text(U("Versões para teste: gera uma ROM numerada com o registro do que mudou."));
	release_button->set_theme_type_variation("RunBarButton");
	release_button->set_focus_mode(Control::FOCUS_NONE);
	// F7 vale também no editor de código (lá o Ctrl+Shift+B é o marcador anterior).
	release_button->set_shortcut(ED_SHORTCUT_ARRAY("retro_studio/release_rom", U("Versões para teste"), { int32_t(Key::F7), int32_t(KeyModifierMask::CMD_OR_CTRL | KeyModifierMask::SHIFT | Key::B) }));
	release_button->set_shortcut_in_tooltip(true);
	release_button->connect(SceneStringName(pressed), callable_mp(this, &RetroSgdkPlugin::_open_releases));
	toolbar->add_child(release_button);
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

	add_tool_menu_item(U("Criar código C da cena"), callable_mp(this, &RetroSgdkPlugin::_create_scene_code));
	add_tool_menu_item(U("Criar código do ator"), callable_mp(this, &RetroSgdkPlugin::_create_actor_code));
	add_dock(memnew(RetroPaletteDock));
	add_context_menu_plugin(EditorContextMenuPlugin::CONTEXT_SLOT_FILESYSTEM, memnew(RetroImageMenu));
}

RetroSgdkPlugin::~RetroSgdkPlugin() {
	singleton = nullptr;
	if (build_thread.is_started()) {
		build_thread.wait_to_finish();
	}
}
