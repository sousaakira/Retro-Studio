#pragma once

// Editor de código C do projeto: realce de sintaxe de C (SGDK), assembly 68000 e .res, e o clangd
// para autocompletar, ir para a declaração (Ctrl+clique) e marcar erros enquanto se digita.
// A lista de compilação do clangd fica no cache do editor (.retro-studio/clangd), sem gravar no projeto.

#include "editor/plugins/editor_plugin.h"
#include "retro_clangd.h"

class CodeEdit;
class EditorSyntaxHighlighter;

class RetroCodePlugin : public EditorPlugin {
	GDCLASS(RetroCodePlugin, EditorPlugin);

	Vector<Ref<EditorSyntaxHighlighter>> highlighters;

	struct ClangdDoc {
		String uri;
		int version = 1;
		bool dirty = false;
		uint64_t changed_at = 0;
		ObjectID base; // TextEditorBase da aba, para a barra de status.
		HashMap<int, String> problems; // Linha → mensagem do clangd (erros e avisos).
	};
	Ref<RetroClangd> clangd;
	HashMap<ObjectID, ClangdDoc> clangd_docs;
	bool clangd_failed = false;
	uint64_t clangd_last_scan = 0;
	bool _clangd_start();
	void _clangd_scan();
	void _clangd_attach(CodeEdit *p_edit, const String &p_path);
	void _clangd_sync(ObjectID p_edit);
	void _clangd_text_changed(uint64_t p_edit);
	void _clangd_completion_requested(uint64_t p_edit);
	void _clangd_completion_result(const Variant &p_result, uint64_t p_edit);
	void _clangd_symbol_validate(const String &p_symbol, uint64_t p_edit);
	void _clangd_symbol_lookup(const String &p_symbol, int p_line, int p_column, uint64_t p_edit);
	void _clangd_definition_result(const Variant &p_result);
	void _clangd_notification(const String &p_method, const Variant &p_params);
	void _clangd_caret_changed(uint64_t p_edit);
	void _clangd_show_problem(ObjectID p_edit);

protected:
	void _notification(int p_what);

public:
	virtual String get_plugin_name() const override { return "RetroCode"; }

	RetroCodePlugin();
};
