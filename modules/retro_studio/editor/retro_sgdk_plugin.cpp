#include "retro_sgdk_plugin.h"

#include "core/config/project_settings.h"
#include "core/io/file_access.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "scene/main/scene_tree.h"
#include "editor/editor_interface.h"
#include "core/io/dir_access.h"
#include "editor/editor_node.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/gui/editor_toaster.h"
#include "editor/script/script_editor_plugin.h"
#include "editor/settings/editor_settings.h"
#include "retro_image_convert.h"
#include "retro_sfx_editor.h"
#include "retro_map_import.h"
#include "retro_palette_dock.h"
#include "retro_colisao_inspector.h"
#include "retro_env.h"
#include "retro_rom_releases.h"
#include "retro_sgdk_export.h"
#include "../scene/md_nodes.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/editor_data.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/label.h"
#include "scene/resources/style_box_flat.h"
#include "servers/rendering/rendering_server.h"
#include "scene/gui/progress_bar.h"
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
	return retro_home();
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
		Vector<String> parts = p_line.substr(0, at).split(":");
		// Caminho do Windows com a letra do disco ("C:/jogo/src/a.c:10:5"): junta a letra ao resto.
		if (parts.size() >= 3 && parts[0].strip_edges().length() == 1 && (parts[1].begins_with("/") || parts[1].begins_with("\\"))) {
			parts.set(1, parts[0].strip_edges() + ":" + parts[1]);
			parts.remove_at(0);
		}
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
		_progress_line(line);
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
		file->store_string(vformat(U("// Código do ator %s: roda no Mega Drive a cada quadro.\n"
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

static void _find_collision_layers(Node *p_node, Vector<MDColisao *> &r_layers) {
	if (MDColisao *layer = Object::cast_to<MDColisao>(p_node)) {
		r_layers.push_back(layer);
	}
	for (int i = 0; i < p_node->get_child_count(); i++) {
		_find_collision_layers(p_node->get_child(i), r_layers);
	}
}

void RetroSgdkPlugin::_update_collision_types() {
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	Vector<MDColisao *> layers;
	if (root) {
		_find_collision_layers(root, layers);
	}
	if (layers.is_empty()) {
		EditorToaster::get_singleton()->popup_str(U("A cena aberta não tem MDColisao."), EditorToaster::SEVERITY_WARNING);
		return;
	}
	int proprios = 0;
	for (MDColisao *layer : layers) {
		proprios += layer->atualizar_tipos();
	}
	EditorInterface::get_singleton()->mark_scene_as_unsaved();
	String message = vformat(U("Tipos da colisão atualizados em %d camada(s): solido, atravessavel, dano, agua, morte, escada, gelo e limite. Salve a cena."), layers.size());
	if (proprios > 0) {
		message += vformat(U(" %d célula(s) com tipo próprio saíram (o TileSet padrão só tem os prontos)."), proprios);
	}
	EditorToaster::get_singleton()->popup_str(message, proprios ? EditorToaster::SEVERITY_WARNING : EditorToaster::SEVERITY_INFO);
}

// Lê a saída do processo (stdout e, em p_stderr, o stderr) e entrega só linhas inteiras ao painel,
// para não cortar um caractere UTF-8 ao meio. Volta quando o pipe fecha.
void RetroSgdkPlugin::_read_pipe(RetroSgdkPlugin *p_self, const Ref<FileAccess> &p_pipe) {
	LocalVector<uint8_t> pending;
	uint8_t buffer[4096];
	while (true) {
		const uint64_t count = p_pipe->get_buffer(buffer, sizeof(buffer));
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
				MutexLock lock(p_self->pipe_mutex);
				p_self->pipe += String::utf8((const char *)pending.ptr(), cut).replace("\r\n", "\n");
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
}

struct RetroStderrReader {
	RetroSgdkPlugin *self = nullptr;
	Ref<FileAccess> pipe;
};

void RetroSgdkPlugin::_read_stderr_thread(void *p_data) {
	RetroStderrReader *reader = static_cast<RetroStderrReader *>(p_data);
	_read_pipe(reader->self, reader->pipe);
}

int RetroSgdkPlugin::_stream_process(RetroSgdkPlugin *p_self, const String &p_path, const List<String> &p_args, SafeNumeric<int64_t> *r_pid) {
	const Dictionary process = OS::get_singleton()->execute_with_pipe(p_path, p_args, true);
	const ProcessID pid = process.get("pid", 0);
	if (r_pid) {
		// O pid fica disponível já, para o processo poder ser interrompido enquanto a saída é lida.
		r_pid->set(int64_t(pid));
	}
	const Ref<FileAccess> stdio = process.get("stdio", Ref<FileAccess>());
	if (stdio.is_null()) {
		return -1;
	}
	// O stderr numa thread à parte (no Linux ele já vem junto do stdout, pelo sh): com os dois pipes
	// lidos ao mesmo tempo, nenhum enche e trava o processo.
	RetroStderrReader reader;
	reader.self = p_self;
	reader.pipe = process.get("stderr", Ref<FileAccess>());
	Thread stderr_thread;
	if (reader.pipe.is_valid()) {
		stderr_thread.start(_read_stderr_thread, &reader);
	}
	_read_pipe(p_self, stdio);
	if (stderr_thread.is_started()) {
		stderr_thread.wait_to_finish();
	}
	while (OS::get_singleton()->is_process_running(pid)) {
		OS::get_singleton()->delay_usec(10000);
	}
	if (r_pid) {
		r_pid->set(0);
	}
	return OS::get_singleton()->get_process_exit_code(pid);
}

void RetroSgdkPlugin::_build_thread(void *p_self) {
	RetroSgdkPlugin *self = static_cast<RetroSgdkPlugin *>(p_self);
	List<String> make_args;
	make_args.push_back("-C");
	make_args.push_back(self->project_dir);
	// O makefile.gen do SGDK não inclui as dependências (.d): sem elas, um cabeçalho gerado que muda
	// (codigo_<ator>.h, ator.h, cena_<x>.h) não recompila os .c que o incluem.
	make_args.push_back("-f");
	make_args.push_back("Makefile");
	make_args.push_back("-f");
	make_args.push_back("out/retro_dependencias.mk");
	if (self->clean_build) {
		// Versão para teste: build limpo de release (os alvos rodam em ordem).
		make_args.push_back("clean");
		make_args.push_back("release");
	}
#ifdef WINDOWS_ENABLED
	// O make.exe do kit, direto; GDK e PATH já estão no ambiente do editor (_start_build).
	const String program = retro_find_in_path("make", retro_build_path(self->gdk));
	self->exit_code = _stream_process(self, program.is_empty() ? String("make.exe") : program, make_args, &self->build_pid);
#else
	// Sem shell interpretando caminhos: o sh só junta stderr ao stdout e executa o env com os
	// argumentos recebidos ("$@"); o env passa GDK e PATH ao make.
	List<String> args;
	args.push_back("-c");
	args.push_back("exec \"$@\" 2>&1");
	args.push_back("retro-studio-build");
	args.push_back("/usr/bin/env");
	args.push_back("GDK=" + self->gdk);
	args.push_back("PATH=" + retro_build_path(self->gdk));
	args.push_back("make");
	for (const String &arg : make_args) {
		args.push_back(arg);
	}
	self->exit_code = _stream_process(self, "/bin/sh", args, &self->build_pid);
#endif
	self->build_pid.set(0);
	self->building.clear();
}

void RetroSgdkPlugin::_start_build(bool p_run_after) {
	if (building.is_set() || repair_thread.is_started()) {
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
		_progress_end(false, U("Sem Makefile"));
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
		_progress_end(false, U("Cenas com problemas (painel SGDK)"));
		return;
	}
	if (!exported.skipped) {
		_append(exported.written.is_empty() ? U("Cenas sem mudanças desde o último build.\n") : U("Cenas geradas: ") + String(", ").join(exported.written) + "\n", COLOR_INFO);
	}
	usage = exported.info;
	gdk = retro_gdk_setting();
	DirAccess::make_dir_recursive_absolute(project_dir.path_join("out"));
	{
		const Ref<FileAccess> deps = FileAccess::open(project_dir.path_join("out/retro_dependencias.mk"), FileAccess::WRITE);
		if (deps.is_valid()) {
			deps->store_string(U("# Gravado pelo Retro Studio a cada build: recompila os .c quando um cabeçalho que eles incluem muda.\n"
								 "-include $(DEPS)\n"
								 "# Cabeçalho que deixou de existir (o código de um ator removido) não trava o build.\n"
								 "%.h: ;\n"
								 "# Nem um recurso gerado que deixou de existir (outra cena principal, um mapa removido): o .d do\n"
								 "# rescomp ainda o cita até o cenas_gerado.res ser recompilado.\n"
								 "%.png: ;\n%.bin: ;\n%.wav: ;\n%.vgm: ;\n%.xgm: ;\n"));
		}
	}
	{
		// O build do SGDK roda o make e o rescomp (um programa Java). Sem eles, o erro do make
		// ("java: not found") não diz o que fazer.
		const String path = retro_build_path(gdk);
		Vector<String> faltando;
		Vector<String> deps;
		if (retro_find_in_path("make", path).is_empty()) {
			faltando.push_back("make");
			deps.push_back("make");
		}
		if (retro_find_in_path("java", path).is_empty()) {
			faltando.push_back("Java");
			deps.push_back("java");
		}
		if (!FileAccess::exists(gdk.path_join("makefile.gen"))) {
			faltando.push_back(U("o kit SGDK (") + gdk + ")");
		}
		if (!faltando.is_empty()) {
			const String falta = U(" e ").join(faltando);
			String texto = vformat(U("Falta %s para compilar.\n"), falta);
			texto += _repair_hint(deps);
			_append(texto, COLOR_ERROR);
			_show_environment(true);
			const String resumo = vformat(U("Falta %s para compilar (use o botão Reparar do painel SGDK)."), falta);
			report_problems.push_back(resumo);
			Dictionary problem;
			problem["message"] = resumo;
			problem["type"] = "error";
			report_errors.push_back(problem);
			_report_finish(false, resumo);
			_progress_end(false, vformat(U("Falta %s (painel SGDK)"), falta));
			return;
		}
	}
#ifdef WINDOWS_ENABLED
	{
		// Makefile de um projeto criado no Linux (ou por uma versão antiga): o "export PATH" com ":"
		// estraga o PATH do Windows e o make não acha o Java. Fica só para o Linux.
		const String makefile_path = project_dir.path_join("Makefile");
		const String makefile = FileAccess::get_file_as_string(makefile_path);
		const String old_line = "export PATH := $(GDK)/bin:$(PATH)\n";
		if (makefile.contains(old_line) && !makefile.contains("Windows_NT")) {
			const String fixed = makefile.replace(old_line, U("ifneq ($(OS),Windows_NT)\n") + old_line + "endif\n");
			Ref<FileAccess> file = FileAccess::open(makefile_path, FileAccess::WRITE);
			if (file.is_valid()) {
				file->store_string(fixed);
				_append(U("Makefile ajustado para o Windows (o export PATH vale só no Linux).\n"), COLOR_INFO);
			}
		}
	}
	// O make.exe herda o ambiente do editor: GDK e o PATH com o kit, o Java e o make do Retro Studio.
	OS::get_singleton()->set_environment("GDK", gdk);
	OS::get_singleton()->set_environment("PATH", retro_build_path(gdk).replace("/", "\\"));
#endif
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
	build_canceled = false;
	// O botão usado gira e continua ativo (clicado de novo, para o build); os outros esperam.
	busy_button = p_run_after ? run_button : build_button;
	busy_frame = 0;
	busy_time = 0;
	build_button->set_disabled(busy_button != build_button);
	run_button->set_disabled(busy_button != run_button);
	release_button->set_disabled(true);
	busy_button->set_button_icon(busy_button->get_editor_theme_icon(SNAME("Progress1")));
	busy_button->set_tooltip_text(U("Compilando… clique para parar."));
	progress_total = MAX(1, _count_build_steps());
	progress_done = 0;
	_progress_set(0.03, U("Compilando…"));
	build_thread.start(_build_thread, this);
}

// Passos que o make pode mostrar: cada .c, .s e .asm de src/ e res/ (e da raiz) e, para cada .res,
// o rescomp e a montagem do .rs. Num build sem mudanças o make pula direto para a ligação.
int RetroSgdkPlugin::_count_build_steps() const {
	int steps = 0;
	const String dirs[] = { "src", "res" };
	for (const String &top : dirs) {
		Vector<String> pending;
		pending.push_back(project_dir.path_join(top));
		while (!pending.is_empty()) {
			const String dir = pending[pending.size() - 1];
			pending.remove_at(pending.size() - 1);
			const Ref<DirAccess> da = DirAccess::open(dir);
			if (da.is_null()) {
				continue;
			}
			da->list_dir_begin();
			for (String name = da->get_next(); !name.is_empty(); name = da->get_next()) {
				if (name.begins_with(".")) {
					continue;
				}
				if (da->current_is_dir()) {
					pending.push_back(dir.path_join(name));
					continue;
				}
				const String ext = name.get_extension().to_lower();
				steps += ext == "res" ? 2 : (ext == "c" || ext == "s" || ext == "asm") ? 1 : 0;
			}
		}
	}
	return steps;
}

// Uma linha do make: em que etapa o build está.
void RetroSgdkPlugin::_progress_line(const String &p_line) {
	if (!building.is_set() && !build_thread.is_started()) {
		return;
	}
	const double compile_share = 0.78;
	if (p_line.contains(" -T ") && p_line.contains("md.ld")) {
		_progress_set(0.86, U("Ligando a ROM…"));
	} else if (p_line.contains("objcopy") && p_line.contains("rom.bin")) {
		_progress_set(0.92, U("Gerando a ROM…"));
	} else if (p_line.contains("sizebnd")) {
		_progress_set(0.96, U("Tamanho e checksum…"));
	} else if (p_line.contains("rescomp")) {
		String file;
		for (const String &part : p_line.split(" ", false)) {
			if (part.ends_with(".res")) {
				file = part.get_file();
				break;
			}
		}
		progress_done++;
		_progress_set(0.03 + compile_share * MIN(1.0, double(progress_done) / progress_total), U("Recursos: ") + file);
	} else if (p_line.contains(" -c ")) {
		const String file = p_line.substr(p_line.find(" -c ") + 4).get_slicec(' ', 0);
		if (file.is_empty()) {
			return;
		}
		progress_done++;
		_progress_set(0.03 + compile_share * MIN(1.0, double(progress_done) / progress_total), U("Compilando ") + file.get_file().replace(".rs", ".res"));
	}
}

void RetroSgdkPlugin::_progress_set(double p_value, const String &p_text) {
	progress_hide_msec = 0;
	progress_bar->set_value(MAX(progress_bar->get_value(), p_value * 100.0));
	progress_bar->set_modulate(Color(1, 1, 1));
	progress_bar->show();
	progress_label->set_text(p_text);
	progress_label->remove_theme_color_override(SceneStringName(font_color));
	progress_box->show();
	if (p_value <= 0.03) {
		progress_bar->set_value(p_value * 100.0); // Build novo começa do início.
	}
}

// Resultado na barra por alguns segundos (o erro fica mais tempo).
void RetroSgdkPlugin::_progress_end(bool p_ok, const String &p_text) {
	progress_box->show();
	progress_bar->set_value(p_ok ? 100 : progress_bar->get_value());
	progress_bar->set_visible(p_ok);
	progress_label->set_text(p_text);
	progress_label->add_theme_color_override(SceneStringName(font_color), p_ok ? COLOR_OK : COLOR_ERROR);
	progress_hide_msec = OS::get_singleton()->get_ticks_msec() + (p_ok ? 4000 : 10000);
}

void RetroSgdkPlugin::_button_pressed(bool p_run) {
	if (building.is_set() || build_thread.is_started()) {
		if (busy_button == (p_run ? run_button : build_button)) {
			_stop_build();
		}
		return;
	}
	if (start_pending) {
		return;
	}
	// Salvar e gerar as cenas trava a tela por um instante: primeiro a barra e o ícone aparecem
	// (um quadro desenhado), depois o build começa.
	start_pending = true;
	Button *button = p_run ? run_button : build_button;
	button->set_button_icon(button->get_editor_theme_icon(SNAME("Progress1")));
	_progress_set(0.01, U("Salvando e gerando as cenas…"));
	RenderingServer::get_singleton()->connect(SNAME("frame_post_draw"), callable_mp(this, &RetroSgdkPlugin::_deferred_start).bind(p_run), CONNECT_ONE_SHOT | CONNECT_DEFERRED);
}

void RetroSgdkPlugin::_deferred_start(bool p_run) {
	start_pending = false;
	_start_build(p_run);
	if (!busy_button) {
		_update_icons(); // Parou antes do make (cenas com problemas, sem Makefile).
	}
}

void RetroSgdkPlugin::_stop_build() {
	if (!build_pid.get()) {
		return;
	}
	build_canceled = true;
	progress_label->set_text(U("Parando…"));
	List<String> args;
#ifdef WINDOWS_ENABLED
	// O make e os filhos dele (gcc, java).
	args.push_back("/PID");
	args.push_back(itos(build_pid.get()));
	args.push_back("/T");
	args.push_back("/F");
	OS::get_singleton()->execute("taskkill", args);
#else
	args.push_back("-TERM");
	args.push_back("--");
	args.push_back("-" + itos(build_pid.get())); // O grupo do make (o sh criou uma sessão nova).
	OS::get_singleton()->execute("/bin/kill", args);
#endif
}

void RetroSgdkPlugin::_finish_build() {
	build_thread.wait_to_finish();
	build_button->set_disabled(false);
	run_button->set_disabled(false);
	release_button->set_disabled(false);
	busy_button = nullptr;
	build_button->set_tooltip_text(U("Compilar ROM: roda o make do projeto com o SGDK."));
	run_button->set_tooltip_text(U("Rodar no emulador: compila e abre a ROM."));
	_update_icons();
	if (build_canceled) {
		_append(U("\nBuild interrompido.\n"), COLOR_WARNING);
		_report_finish(false, U("O build foi interrompido."));
		_progress_end(false, U("Build interrompido"));
		return;
	}
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
		_progress_end(false, error_count > 0 ? (error_count == 1 ? U("Falhou: 1 erro (painel SGDK)") : vformat(U("Falhou: %d erros (painel SGDK)"), error_count)) : U("Falhou (painel SGDK)"));
		return;
	}
	_append(U("\nROM pronta: ") + _rom_path() + "\n", COLOR_OK);
	// Uso de VRAM e de sprites por cena, calculado ao gerar as cenas.
	for (const String &line : usage) {
		_append(line + "\n", COLOR_INFO);
	}
	_progress_end(true, run_after_build ? U("ROM pronta — abrindo o emulador") : U("ROM pronta"));
	if (run_after_build) {
		_run_rom();
	}
	_report_finish(true, String());
}

void RetroSgdkPlugin::_cli_tick() {
	// Espera a primeira varredura e as importações (as cenas precisam das texturas importadas).
	EditorFileSystem *fs = EditorFileSystem::get_singleton();
	if (!fs || fs->is_scanning() || fs->is_importing()) {
		cli_idle_frames = 0;
		return;
	}
	if (++cli_idle_frames < 30) {
		return;
	}
	cli_started = true;
	if (cli_mode == 4) {
		String error;
		const RetroSfx sfx = RetroSfx::preset(cli_sfx.get_slicec(':', 0));
		const String path = sfx.save(ProjectSettings::get_singleton()->get_resource_path().path_join("som"), cli_sfx.get_slicec(':', 1), error);
		print_line(path.is_empty() ? error : U("Gravado: ") + path);
		_cli_quit(!path.is_empty());
		return;
	}
	if (cli_mode == 3) {
		// Converter um PNG (testes): o caminho pode ser res:// ou do disco.
		const String path = cli_convert.begins_with("res://") ? ProjectSettings::get_singleton()->globalize_path(cli_convert) : cli_convert;
		String message;
		const bool ok = !RetroImageConvert::convert(path, message, cli_dither).is_empty();
		print_line(message);
		_cli_quit(ok);
		return;
	}
	if (cli_mode == 2) {
		_start_build(false); // Termina no _report_finish.
		return;
	}
	const String dir = ProjectSettings::get_singleton()->get_resource_path();
	const RetroSgdkExport::Result exported = RetroSgdkExport::export_main_scene(dir);
	for (const String &warning : exported.warnings) {
		print_line(U("Aviso: ") + warning);
	}
	for (const String &line : exported.info) {
		print_line(line);
	}
	for (const String &line : exported.written) {
		print_line(U("Gerado: ") + line);
	}
	for (const String &error : exported.errors) {
		print_line(U("Erro: ") + error);
	}
	_cli_quit(exported.errors.is_empty());
}

void RetroSgdkPlugin::_open_sfx_editor() {
	if (!sfx_editor) {
		sfx_editor = memnew(RetroSfxEditor);
		EditorNode::get_singleton()->get_gui_base()->add_child(sfx_editor);
	}
	sfx_editor->open();
}

void RetroSgdkPlugin::_cli_quit(bool p_ok) {
	print_line(p_ok ? U("RETRO-CLI: OK") : U("RETRO-CLI: FALHOU"));
	get_tree()->quit(p_ok ? 0 : 1);
}

void RetroSgdkPlugin::_report_finish(bool p_ok, const String &p_reason) {
	if (cli_mode == 2 && cli_started) {
		for (const String &problem : report_problems) {
			print_line(U("Erro: ") + problem);
		}
		for (const String &line : usage) {
			print_line(line);
		}
		if (!p_ok) {
			print_line(U("Motivo: ") + p_reason);
			print_line(report_log.length() > 6000 ? report_log.substr(report_log.length() - 6000) : report_log);
		} else {
			print_line(U("ROM: ") + _rom_path());
		}
		_cli_quit(p_ok);
	}
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
	_stop_build();
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
	const String configured_emulator = retro_emulator_setting();
	// O configurado ou, se faltam bibliotecas a ele (SDL2, GLEW), o BlastEm oficial em old/. Sem nenhum,
	// o emulador fecharia na hora sem a janela aparecer.
	Vector<String> faltando;
	String nota;
	const String emulator = retro_resolve_emulator(configured_emulator, faltando, nota);
	if (emulator.is_empty()) {
		if (!FileAccess::exists(configured_emulator)) {
			_append(U("O emulador não está em ") + configured_emulator + ".\n" + _repair_hint(Vector<String>()), COLOR_ERROR);
		} else {
			_append(vformat(U("O emulador não abre: faltam bibliotecas no sistema (%s).\n"), String(", ").join(faltando)) + _repair_hint(retro_dependencies_for_libraries(faltando)), COLOR_ERROR);
		}
		_show_environment(true);
		return;
	}
	if (!nota.is_empty()) {
		_append(nota + "\n", COLOR_INFO);
	}
	List<String> args;
	args.push_back(rom);
	// O BlastEm abre com a configuração do Retro Studio (pixels sem suavização), num HOME próprio; a
	// variável vale só para ele: o editor a devolve logo depois de criar o processo.
	const String blastem_home = retro_blastem_home(emulator);
	const String old_home = OS::get_singleton()->get_environment("HOME");
	if (!blastem_home.is_empty()) {
		OS::get_singleton()->set_environment("HOME", blastem_home);
	}
	const Error started = OS::get_singleton()->create_process(emulator, args, &emulator_pid);
	if (!blastem_home.is_empty()) {
		OS::get_singleton()->set_environment("HOME", old_home);
	}
	if (started != OK) {
		emulator_pid = 0;
		_append(U("Não foi possível abrir o emulador: ") + emulator + U(" (Configurações do Editor → Retro Studio → Emulador).\n"), COLOR_ERROR);
		return;
	}
	_append(U("Rodando no emulador.\n"), COLOR_OK);
}

void RetroSgdkPlugin::_update_icons() {
	if (busy_button) {
		return; // O botão do build em andamento mostra o ícone girando.
	}
	build_button->set_button_icon(build_button->get_editor_theme_icon(SNAME("RetroBuildRom")));
	run_button->set_button_icon(run_button->get_editor_theme_icon(SNAME("MainPlay")));
	release_button->set_button_icon(release_button->get_editor_theme_icon(SNAME("RetroRelease")));
}

void RetroSgdkPlugin::_env_thread(void *p_self) {
	RetroSgdkPlugin *self = static_cast<RetroSgdkPlugin *>(p_self);
	Vector<String> deps;
	const Vector<String> problems = retro_check_environment(self->env_gdk, self->env_emulator, deps);
	{
		MutexLock lock(self->env_mutex);
		self->env_problems = problems;
		self->env_deps = deps;
	}
	self->env_checking.clear();
}

void RetroSgdkPlugin::_check_environment(bool p_announce) {
	env_announce = env_announce || p_announce;
	if (env_thread.is_started()) {
		return; // Já conferindo; o resultado chega no _process.
	}
	env_gdk = retro_gdk_setting();
	env_emulator = retro_emulator_setting();
	env_checking.set();
	env_thread.start(_env_thread, this);
}

void RetroSgdkPlugin::_environment_checked() {
	Vector<String> problems;
	Vector<String> deps;
	{
		MutexLock lock(env_mutex);
		problems = env_problems;
		deps = env_deps;
	}
	const bool announce = env_announce;
	env_announce = false;
	if (problems.is_empty()) {
		env_bar->hide();
		if (announce) {
			_append(U("Ambiente conferido: kit, Java, make e emulador prontos.\n"), COLOR_OK);
		}
		return;
	}
	env_label->set_text(U("Falta algo para compilar ou rodar: ") + String(" ").join(problems));
	env_repair->set_visible(!retro_installer_path().is_empty());
	env_bar->show();
	// Ao abrir o editor, só a faixa e um aviso; depois de um pedido, os detalhes no painel.
	if (announce) {
		String text = U("Ambiente incompleto:\n");
		for (const String &problem : problems) {
			text += "  - " + problem + "\n";
		}
		_append(text + _repair_hint(deps), COLOR_ERROR);
	} else {
		EditorToaster::get_singleton()->popup_str(U("Retro Studio: falta algo para compilar ou rodar. Veja o painel SGDK (botão Reparar)."), EditorToaster::SEVERITY_WARNING);
	}
}

void RetroSgdkPlugin::_show_environment(bool p_open_panel) {
	if (p_open_panel) {
		make_bottom_panel_item_visible(panel);
	}
	_check_environment(false);
}

String RetroSgdkPlugin::_repair_hint(const Vector<String> &p_dependencies) const {
	String hint;
	if (!retro_installer_path().is_empty()) {
		hint = U("Clique em Reparar, no topo deste painel: o Retro Studio confere a instalação e instala o que faltar.\n");
		if (!p_dependencies.is_empty() && !retro_install_command(p_dependencies).is_empty()) {
			hint += U("Ou rode num terminal: ") + retro_install_command(p_dependencies) + "\n";
		}
	} else if (!p_dependencies.is_empty() && !retro_install_command(p_dependencies).is_empty()) {
		hint = U("Rode num terminal: ") + retro_install_command(p_dependencies) + U("\nDepois tente de novo (não precisa reabrir o editor).\n");
	} else if (!retro_system_package_note().is_empty()) {
		hint = retro_system_package_note() + U("\nOu confira os caminhos em Configurações do Editor → Retro Studio.\n");
	} else {
		hint = U("Rode o instalar.sh do pacote do Retro Studio, ou confira os caminhos em Configurações do Editor → Retro Studio.\n");
	}
	return hint;
}

void RetroSgdkPlugin::_repair_thread(void *p_self) {
	RetroSgdkPlugin *self = static_cast<RetroSgdkPlugin *>(p_self);
	List<String> args;
#ifdef WINDOWS_ENABLED
	args.push_back("-NoProfile");
	args.push_back("-NonInteractive");
	args.push_back("-ExecutionPolicy");
	args.push_back("Bypass");
	args.push_back("-File");
	args.push_back(retro_installer_path());
	args.push_back("-Reparar");
	self->repair_exit = _stream_process(self, "powershell.exe", args, nullptr);
#else
	// Sem terminal (entrada em /dev/null): o instalador pede a senha dos pacotes do sistema pela janela
	// do pkexec, se precisar.
	args.push_back("-c");
	args.push_back("exec \"$@\" 2>&1 </dev/null");
	args.push_back("retro-studio-reparar");
	args.push_back(retro_installer_path());
	args.push_back("--reparar");
	self->repair_exit = _stream_process(self, "/bin/sh", args, nullptr);
#endif
	self->repairing.clear();
}

void RetroSgdkPlugin::_start_repair() {
	const String installer = retro_installer_path();
	if (installer.is_empty()) {
		_append(_repair_hint(Vector<String>()), COLOR_ERROR);
		return;
	}
	if (repair_thread.is_started() || is_building()) {
		return;
	}
	make_bottom_panel_item_visible(panel);
	output->clear();
	_append(U("Reparando o ambiente (") + installer + U(")…\n"), COLOR_INFO);
	env_repair->set_disabled(true);
	repairing.set();
	repair_thread.start(_repair_thread, this);
}

void RetroSgdkPlugin::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_ENTER_TREE: {
			for (const String &arg : OS::get_singleton()->get_cmdline_user_args()) {
				if (arg.begins_with("--retro-converter=")) {
					cli_mode = 3;
					cli_convert = arg.get_slicec('=', 1);
				} else if (arg.begins_with("--retro-sfx=")) {
					cli_mode = 4;
					cli_sfx = arg.get_slicec('=', 1);
				} else if (arg == "--retro-pontilhado") {
					cli_dither = true;
				} else if (arg == "--retro-build") {
					cli_mode = 2;
				} else if (arg == "--retro-export" && cli_mode == 0) {
					cli_mode = 1;
				}
			}
			_add_extensions("docks/filesystem/textfile_extensions", SGDK_TEXT_EXTENSIONS);
			_add_extensions("docks/filesystem/other_file_extensions", SGDK_OTHER_EXTENSIONS);
			set_process(true);
			callable_mp(this, &RetroSgdkPlugin::_check_environment).call_deferred(false);
		} break;
		case NOTIFICATION_PROCESS: {
			if (cli_mode && !cli_started) {
				_cli_tick();
			}
			String text;
			{
				MutexLock lock(pipe_mutex);
				text = pipe;
				pipe = String();
			}
			if (!text.is_empty()) {
				_append_output(text);
			}
			if (busy_button) {
				// Ícone girando: 8 quadros, 10 por segundo.
				busy_time += get_process_delta_time();
				if (busy_time >= 0.1) {
					busy_time = 0;
					busy_frame = (busy_frame + 1) % 8;
					busy_button->set_button_icon(busy_button->get_editor_theme_icon(StringName("Progress" + itos(busy_frame + 1))));
				}
			}
			if (!building.is_set() && build_thread.is_started()) {
				_finish_build();
			}
			if (!env_checking.is_set() && env_thread.is_started()) {
				env_thread.wait_to_finish();
				_environment_checked();
			}
			if (!repairing.is_set() && repair_thread.is_started()) {
				repair_thread.wait_to_finish();
				env_repair->set_disabled(false);
				if (repair_exit == 0) {
					_append(U("\nReparo terminado.\n"), COLOR_OK);
				} else {
					_append(U("\nO reparo não resolveu tudo (veja acima).\n"), COLOR_ERROR);
				}
				_check_environment(true);
			}
			if (progress_hide_msec && OS::get_singleton()->get_ticks_msec() >= progress_hide_msec && !busy_button) {
				progress_hide_msec = 0;
				progress_box->hide();
			}
		} break;
	}
}

RetroSgdkPlugin::RetroSgdkPlugin() {
	singleton = this;
#ifdef WINDOWS_ENABLED
	// SGDK para Windows (ferramentas .exe e o sh do msys) e o BlastEm para Windows.
	EDITOR_DEF("retro_studio/sgdk/gdk_path", retro_default_gdk());
	EDITOR_DEF("retro_studio/emulator/path", retro_default_emulator());
#else
	EDITOR_DEF("retro_studio/sgdk/gdk_path", retro_default_gdk());
	EDITOR_DEF("retro_studio/emulator/path", retro_default_emulator());
#endif
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
	build_button->connect(SceneStringName(pressed), callable_mp(this, &RetroSgdkPlugin::_button_pressed).bind(false));
	toolbar->add_child(build_button);
	run_button = memnew(Button);
	run_button->set_tooltip_text(U("Rodar no emulador: compila e abre a ROM."));
	run_button->set_theme_type_variation("RunBarButton");
	run_button->set_focus_mode(Control::FOCUS_NONE);
	run_button->set_shortcut(ED_SHORTCUT("retro_studio/run_rom", U("Rodar no emulador"), Key::F5));
	run_button->set_shortcut_in_tooltip(true);
	run_button->connect(SceneStringName(pressed), callable_mp(this, &RetroSgdkPlugin::_button_pressed).bind(true));
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
	progress_box = memnew(HBoxContainer);
	progress_box->hide();
	progress_label = memnew(Label);
	progress_label->set_vertical_alignment(VERTICAL_ALIGNMENT_CENTER);
	progress_label->set_custom_minimum_size(Size2(230, 0) * EDSCALE);
	progress_label->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_RIGHT);
	progress_label->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
	progress_box->add_child(progress_label);
	progress_bar = memnew(ProgressBar);
	progress_bar->set_custom_minimum_size(Size2(110, 0) * EDSCALE);
	progress_bar->set_v_size_flags(Control::SIZE_SHRINK_CENTER);
	progress_bar->set_show_percentage(false);
	// Fundo visível na barra de título (o do tema some no fundo escuro).
	Ref<StyleBoxFlat> bar_bg;
	bar_bg.instantiate();
	bar_bg->set_bg_color(Color(1, 1, 1, 0.14));
	bar_bg->set_corner_radius_all(3 * EDSCALE);
	bar_bg->set_content_margin_all(0);
	progress_bar->add_theme_style_override(SNAME("background"), bar_bg);
	Ref<StyleBoxFlat> bar_fill;
	bar_fill.instantiate();
	bar_fill->set_bg_color(Color(0.35, 0.65, 1));
	bar_fill->set_corner_radius_all(3 * EDSCALE);
	progress_bar->add_theme_style_override(SNAME("fill"), bar_fill);
	progress_bar->set_custom_minimum_size(Size2(120, 8) * EDSCALE);
	progress_box->add_child(progress_bar);
	toolbar->add_child(progress_box);
	toolbar->move_child(progress_box, 0); // À esquerda dos botões.
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
	env_bar = memnew(HBoxContainer);
	env_bar->hide();
	env_label = memnew(Label);
	env_label->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	env_label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	env_label->add_theme_color_override(SceneStringName(font_color), COLOR_WARNING);
	env_bar->add_child(env_label);
	env_repair = memnew(Button);
	env_repair->set_text(U("Reparar"));
	env_repair->set_tooltip_text(U("Confere a instalação e instala o que faltar (kit, emulador; pacotes do sistema pedem a sua senha)."));
	env_repair->connect(SceneStringName(pressed), callable_mp(this, &RetroSgdkPlugin::_start_repair));
	env_bar->add_child(env_repair);
	Button *env_recheck = memnew(Button);
	env_recheck->set_text(U("Conferir de novo"));
	env_recheck->connect(SceneStringName(pressed), callable_mp(this, &RetroSgdkPlugin::_check_environment).bind(true));
	env_bar->add_child(env_recheck);
	panel->add_child(env_bar);
	panel->add_child(output);
	add_control_to_bottom_panel(panel, "SGDK");

	add_tool_menu_item(U("Criar código C da cena"), callable_mp(this, &RetroSgdkPlugin::_create_scene_code));
	add_tool_menu_item(U("Criar código do ator"), callable_mp(this, &RetroSgdkPlugin::_create_actor_code));
	add_tool_menu_item(U("Atualizar tipos da colisão"), callable_mp(this, &RetroSgdkPlugin::_update_collision_types));
	add_tool_menu_item(U("Efeitos sonoros (PSG)…"), callable_mp(this, &RetroSgdkPlugin::_open_sfx_editor));
	Ref<RetroColisaoInspector> collision_inspector;
	collision_inspector.instantiate();
	Ref<RetroMapMoveInspector> map_move_inspector;
	map_move_inspector.instantiate();
	add_inspector_plugin(map_move_inspector);
	Ref<RetroTileSetLock> tile_set_lock;
	tile_set_lock.instantiate();
	add_inspector_plugin(tile_set_lock);
	add_inspector_plugin(collision_inspector);
	add_dock(memnew(RetroPaletteDock));
	add_context_menu_plugin(EditorContextMenuPlugin::CONTEXT_SLOT_FILESYSTEM, memnew(RetroImageMenu));
}

RetroSgdkPlugin::~RetroSgdkPlugin() {
	singleton = nullptr;
	if (build_thread.is_started()) {
		build_thread.wait_to_finish();
	}
	if (env_thread.is_started()) {
		env_thread.wait_to_finish();
	}
	if (repair_thread.is_started()) {
		repair_thread.wait_to_finish();
	}
}
