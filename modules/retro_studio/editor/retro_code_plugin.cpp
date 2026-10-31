#include "retro_code_plugin.h"

#include "retro_sgdk_plugin.h"
#include "retro_syntax_highlighters.h"

#include "core/config/project_settings.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "editor/gui/code_editor.h"
#include "editor/gui/editor_toaster.h"
#include "editor/script/script_editor_base.h"
#include "editor/script/script_editor_plugin.h"
#include "editor/settings/editor_settings.h"
#include "scene/gui/code_edit.h"
#include "scene/scene_string_names.h"

namespace {
String U(const char *p_text) {
	return String::utf8(p_text);
}
} // namespace

RetroCodePlugin::RetroCodePlugin() {
	EDITOR_DEF("retro_studio/clangd/path", "clangd");
	Ref<RetroCSyntaxHighlighter> c_highlighter;
	c_highlighter.instantiate();
	highlighters.push_back(c_highlighter);
	Ref<RetroAsmSyntaxHighlighter> asm_highlighter;
	asm_highlighter.instantiate();
	highlighters.push_back(asm_highlighter);
	Ref<RetroResSyntaxHighlighter> res_highlighter;
	res_highlighter.instantiate();
	highlighters.push_back(res_highlighter);
}

void RetroCodePlugin::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_ENTER_TREE: {
			if (ScriptEditor::get_singleton()) {
				for (const Ref<EditorSyntaxHighlighter> &highlighter : highlighters) {
					ScriptEditor::get_singleton()->register_syntax_highlighter(highlighter);
				}
			}
			set_process(true); // Mensagens do clangd e abas novas de .c/.h.
		} break;
		case NOTIFICATION_EXIT_TREE: {
			if (clangd.is_valid()) {
				clangd->stop();
			}
			if (ScriptEditor::get_singleton()) {
				for (const Ref<EditorSyntaxHighlighter> &highlighter : highlighters) {
					ScriptEditor::get_singleton()->unregister_syntax_highlighter(highlighter);
				}
			}
		} break;
		case NOTIFICATION_PROCESS: {
			if (clangd.is_valid()) {
				clangd->poll();
			}
			if (OS::get_singleton()->get_ticks_msec() - clangd_last_scan > 300) {
				clangd_last_scan = OS::get_singleton()->get_ticks_msec();
				_clangd_scan();
			}
		} break;
	}
}

bool RetroCodePlugin::_clangd_start() {
	if (clangd.is_valid() && clangd->is_running()) {
		return true;
	}
	if (clangd_failed) {
		return false;
	}
	const String project = ProjectSettings::get_singleton()->get_resource_path();
	const String cache = ProjectSettings::get_singleton()->globalize_path(ProjectSettings::get_singleton()->get_project_data_path()).path_join("clangd");
	const String gdk = EDITOR_GET("retro_studio/sgdk/gdk_path");
	RetroClangd::write_compile_commands(project, cache, gdk);
	clangd.instantiate();
	clangd->set_notification_handler(callable_mp(this, &RetroCodePlugin::_clangd_notification));
	if (clangd->start(EDITOR_GET("retro_studio/clangd/path"), project, cache) != OK) {
		clangd_failed = true;
		clangd.unref();
		EditorToaster::get_singleton()->popup_str(U("clangd não encontrado: o editor de código fica sem autocompletar. Instale o clangd (sudo apt install clangd) ou ajuste retro_studio/clangd/path."), EditorToaster::SEVERITY_WARNING);
		return false;
	}
	return true;
}

void RetroCodePlugin::_clangd_scan() {
	// Documentos fechados: avisa o clangd e esquece.
	Vector<ObjectID> closed;
	for (const KeyValue<ObjectID, ClangdDoc> &E : clangd_docs) {
		if (!ObjectDB::get_instance(E.key)) {
			closed.push_back(E.key);
		}
	}
	for (const ObjectID &id : closed) {
		if (clangd.is_valid()) {
			Dictionary text_document;
			text_document["uri"] = clangd_docs[id].uri;
			Dictionary params;
			params["textDocument"] = text_document;
			clangd->notify("textDocument/didClose", params);
		}
		clangd_docs.erase(id);
	}
	// Texto alterado: envia ao clangd 400 ms depois da última tecla (atualiza os erros).
	const uint64_t now = OS::get_singleton()->get_ticks_msec();
	for (const KeyValue<ObjectID, ClangdDoc> &E : clangd_docs) {
		if (E.value.dirty && now - E.value.changed_at > 400) {
			_clangd_sync(E.key);
		}
	}

	ScriptEditor *script_editor = ScriptEditor::get_singleton();
	ScriptEditorBase *current = script_editor ? script_editor->get_current_editor() : nullptr;
	CodeEdit *edit = current ? Object::cast_to<CodeEdit>(current->get_base_editor()) : nullptr;
	if (!edit || clangd_docs.has(edit->get_instance_id())) {
		return;
	}
	const Ref<Resource> resource = current->get_edited_resource();
	const String path = resource.is_valid() ? resource->get_path() : String();
	const String extension = path.get_extension().to_lower();
	if (extension == "c" || extension == "h") {
		_clangd_attach(edit, path);
		if (clangd_docs.has(edit->get_instance_id())) {
			clangd_docs[edit->get_instance_id()].base = current->get_instance_id();
		}
	}
}

void RetroCodePlugin::_clangd_attach(CodeEdit *p_edit, const String &p_path) {
	if (!_clangd_start()) {
		return;
	}
	const uint64_t id = p_edit->get_instance_id();
	ClangdDoc doc;
	doc.uri = RetroClangd::path_to_uri(ProjectSettings::get_singleton()->globalize_path(p_path));
	clangd_docs[p_edit->get_instance_id()] = doc;

	p_edit->set_code_completion_enabled(true);
	TypedArray<String> prefixes;
	prefixes.push_back(".");
	prefixes.push_back(">");
	prefixes.push_back(":");
	p_edit->set_code_completion_prefixes(prefixes);
	p_edit->set_symbol_lookup_on_click_enabled(true);
	p_edit->connect(SceneStringName(text_changed), callable_mp(this, &RetroCodePlugin::_clangd_text_changed).bind(id));
	p_edit->connect("code_completion_requested", callable_mp(this, &RetroCodePlugin::_clangd_completion_requested).bind(id));
	p_edit->connect("symbol_validate", callable_mp(this, &RetroCodePlugin::_clangd_symbol_validate).bind(id));
	p_edit->connect("symbol_lookup", callable_mp(this, &RetroCodePlugin::_clangd_symbol_lookup).bind(id));
	p_edit->connect("caret_changed", callable_mp(this, &RetroCodePlugin::_clangd_caret_changed).bind(id));

	Dictionary text_document;
	text_document["uri"] = doc.uri;
	text_document["languageId"] = "c";
	text_document["version"] = doc.version;
	text_document["text"] = p_edit->get_text();
	Dictionary params;
	params["textDocument"] = text_document;
	clangd->notify("textDocument/didOpen", params);
}

void RetroCodePlugin::_clangd_sync(ObjectID p_edit) {
	CodeEdit *edit = Object::cast_to<CodeEdit>(ObjectDB::get_instance(p_edit));
	if (!edit || !clangd_docs.has(p_edit) || clangd.is_null()) {
		return;
	}
	ClangdDoc &doc = clangd_docs[p_edit];
	if (!doc.dirty) {
		return;
	}
	doc.dirty = false;
	doc.version++;
	Dictionary text_document;
	text_document["uri"] = doc.uri;
	text_document["version"] = doc.version;
	Dictionary change;
	change["text"] = edit->get_text();
	Array changes;
	changes.push_back(change);
	Dictionary params;
	params["textDocument"] = text_document;
	params["contentChanges"] = changes;
	clangd->notify("textDocument/didChange", params);
}

void RetroCodePlugin::_clangd_text_changed(uint64_t p_edit) {
	const ObjectID id = ObjectID(p_edit);
	CodeEdit *edit = Object::cast_to<CodeEdit>(ObjectDB::get_instance(id));
	if (!edit || !clangd_docs.has(id)) {
		return;
	}
	clangd_docs[id].dirty = true;
	clangd_docs[id].changed_at = OS::get_singleton()->get_ticks_msec();
	// Depois de duas letras de um nome, pede sugestões (uma vez por palavra).
	const String before = edit->get_line(edit->get_caret_line()).substr(0, edit->get_caret_column());
	int word = 0;
	for (int i = before.length() - 1; i >= 0 && (is_ascii_identifier_char(before[i])); i--) {
		word++;
	}
	if (word == 2 && edit->get_code_completion_options().is_empty()) {
		edit->request_code_completion();
	}
}

void RetroCodePlugin::_clangd_completion_requested(uint64_t p_edit) {
	const ObjectID id = ObjectID(p_edit);
	CodeEdit *edit = Object::cast_to<CodeEdit>(ObjectDB::get_instance(id));
	if (!edit || !clangd_docs.has(id) || clangd.is_null()) {
		return;
	}
	_clangd_sync(id);
	Dictionary text_document;
	text_document["uri"] = clangd_docs[id].uri;
	Dictionary position;
	position["line"] = edit->get_caret_line();
	position["character"] = edit->get_caret_column();
	Dictionary params;
	params["textDocument"] = text_document;
	params["position"] = position;
	clangd->request("textDocument/completion", params, callable_mp(this, &RetroCodePlugin::_clangd_completion_result).bind(p_edit));
}

static CodeEdit::CodeCompletionKind _lsp_kind(int p_kind) {
	switch (p_kind) {
		case 2: // Method
		case 3: // Function
		case 4: // Constructor
			return CodeEdit::KIND_FUNCTION;
		case 5: // Field
		case 10: // Property
			return CodeEdit::KIND_MEMBER;
		case 6: // Variable
			return CodeEdit::KIND_VARIABLE;
		case 7: // Class
		case 22: // Struct
		case 8: // Interface
			return CodeEdit::KIND_CLASS;
		case 13: // Enum
			return CodeEdit::KIND_ENUM;
		case 20: // EnumMember
		case 21: // Constant
			return CodeEdit::KIND_CONSTANT;
		case 17: // File
			return CodeEdit::KIND_FILE_PATH;
		case 14: // Keyword
			return CodeEdit::KIND_KEYWORD;
		default:
			return CodeEdit::KIND_PLAIN_TEXT;
	}
}

void RetroCodePlugin::_clangd_completion_result(const Variant &p_result, uint64_t p_edit) {
	CodeEdit *edit = Object::cast_to<CodeEdit>(ObjectDB::get_instance(ObjectID(p_edit)));
	if (!edit) {
		return;
	}
	Array items;
	if (p_result.get_type() == Variant::ARRAY) {
		items = p_result;
	} else if (p_result.get_type() == Variant::DICTIONARY) {
		items = Dictionary(p_result).get("items", Array());
	}
	const int count = MIN(items.size(), 200);
	for (int i = 0; i < count; i++) {
		const Dictionary item = items[i];
		const String label = String(item.get("label", "")).strip_edges().trim_prefix(U("•")).strip_edges();
		String insert = item.get("insertText", label);
		if (item.has("textEdit")) {
			insert = Dictionary(item["textEdit"]).get("newText", insert);
		}
		if (label.is_empty()) {
			continue;
		}
		// Assinaturas longas deixam a lista mais larga que o editor: corta o fim (o texto inserido é inteiro).
		const String shown = label.length() > 56 ? label.substr(0, 55) + U("…") : label;
		edit->add_code_completion_option(_lsp_kind(item.get("kind", 1)), shown, insert.strip_edges());
	}
	edit->update_code_completion_options(true);
}

void RetroCodePlugin::_clangd_symbol_validate(const String &p_symbol, uint64_t p_edit) {
	CodeEdit *edit = Object::cast_to<CodeEdit>(ObjectDB::get_instance(ObjectID(p_edit)));
	if (edit) {
		edit->set_symbol_lookup_word_as_valid(p_symbol.is_valid_ascii_identifier());
	}
}

void RetroCodePlugin::_clangd_symbol_lookup(const String &p_symbol, int p_line, int p_column, uint64_t p_edit) {
	const ObjectID id = ObjectID(p_edit);
	if (!clangd_docs.has(id) || clangd.is_null()) {
		return;
	}
	_clangd_sync(id);
	Dictionary text_document;
	text_document["uri"] = clangd_docs[id].uri;
	Dictionary position;
	position["line"] = p_line;
	position["character"] = p_column;
	Dictionary params;
	params["textDocument"] = text_document;
	params["position"] = position;
	clangd->request("textDocument/definition", params, callable_mp(this, &RetroCodePlugin::_clangd_definition_result));
}

void RetroCodePlugin::_clangd_definition_result(const Variant &p_result) {
	Dictionary location;
	if (p_result.get_type() == Variant::ARRAY && !Array(p_result).is_empty()) {
		location = Array(p_result)[0];
	} else if (p_result.get_type() == Variant::DICTIONARY) {
		location = p_result;
	}
	if (location.is_empty()) {
		return;
	}
	// Location { uri, range } ou LocationLink { targetUri, targetSelectionRange }.
	const String uri = location.get("uri", location.get("targetUri", ""));
	const Dictionary range = location.get("range", location.get("targetSelectionRange", Dictionary()));
	const Dictionary start = range.get("start", Dictionary());
	const int line = start.get("line", 0);
	const int column = start.get("character", 0);
	const String path = RetroClangd::uri_to_path(uri);
	const String local = ProjectSettings::get_singleton()->localize_path(path);
	if (local.begins_with("res://")) {
		Dictionary problem;
		problem["file"] = local;
		problem["line"] = line + 1;
		problem["column"] = column + 1;
		RetroSgdkPlugin::get_singleton()->open_problem(problem);
	} else if (!path.is_empty()) {
		// Declaração do SGDK (fora do projeto): mostra onde fica.
		EditorToaster::get_singleton()->popup_str(vformat(U("Declarado no SGDK: %s:%d"), path.get_file(), line + 1), EditorToaster::SEVERITY_INFO);
	}
}

void RetroCodePlugin::_clangd_notification(const String &p_method, const Variant &p_params) {
	if (p_method != "textDocument/publishDiagnostics") {
		return;
	}
	const Dictionary params = p_params;
	const String uri = params.get("uri", "");
	for (KeyValue<ObjectID, ClangdDoc> &E : clangd_docs) {
		if (E.value.uri != uri) {
			continue;
		}
		CodeEdit *edit = Object::cast_to<CodeEdit>(ObjectDB::get_instance(E.key));
		if (!edit) {
			return;
		}
		// Limpa as marcas anteriores e pinta as linhas com erro (vermelho) ou aviso (amarelo).
		for (const KeyValue<int, String> &P : E.value.problems) {
			if (P.key < edit->get_line_count()) {
				edit->set_line_background_color(P.key, Color(0, 0, 0, 0));
			}
		}
		E.value.problems.clear();
		const Array diagnostics = params.get("diagnostics", Array());
		for (int i = 0; i < diagnostics.size(); i++) {
			const Dictionary diagnostic = diagnostics[i];
			const int severity = diagnostic.get("severity", 1);
			if (severity > 2) {
				continue; // Informações e dicas não marcam a linha.
			}
			const int line = Dictionary(Dictionary(diagnostic.get("range", Dictionary())).get("start", Dictionary())).get("line", 0);
			if (line >= edit->get_line_count() || E.value.problems.has(line)) {
				continue;
			}
			const String message = String(diagnostic.get("message", "")).get_slicec('\n', 0);
			E.value.problems[line] = (severity == 1 ? U("Erro: ") : U("Aviso: ")) + message;
			edit->set_line_background_color(line, severity == 1 ? Color(1.0, 0.3, 0.3, 0.18) : Color(1.0, 0.8, 0.3, 0.14));
		}
		_clangd_show_problem(E.key);
		return;
	}
}

void RetroCodePlugin::_clangd_caret_changed(uint64_t p_edit) {
	_clangd_show_problem(ObjectID(p_edit));
}

// Barra de status do editor: o problema da linha do cursor ou, sem ele, o primeiro do arquivo.
void RetroCodePlugin::_clangd_show_problem(ObjectID p_edit) {
	CodeEdit *edit = Object::cast_to<CodeEdit>(ObjectDB::get_instance(p_edit));
	if (!edit || !clangd_docs.has(p_edit)) {
		return;
	}
	const ClangdDoc &doc = clangd_docs[p_edit];
	TextEditorBase *base = Object::cast_to<TextEditorBase>(ObjectDB::get_instance(doc.base));
	if (!base || !base->get_code_editor()) {
		return;
	}
	CodeTextEditor *code_editor = base->get_code_editor();
	int line = edit->get_caret_line();
	if (!doc.problems.has(line)) {
		line = -1;
		for (const KeyValue<int, String> &P : doc.problems) {
			if (line < 0 || P.key < line) {
				line = P.key;
			}
		}
	}
	if (line < 0) {
		code_editor->set_error("");
		return;
	}
	code_editor->set_error(vformat("%d: %s", line + 1, doc.problems[line]));
	code_editor->set_error_pos(line, 0);
}
