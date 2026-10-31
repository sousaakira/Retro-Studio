#pragma once

#include "editor/script/syntax_highlighters.h"
#include "scene/resources/syntax_highlighter.h"

// Realce dos arquivos de um projeto SGDK no editor de código do Godot: C, assembly 68000 e .res.
// Seguem o modelo dos realces de JSON e Markdown do próprio editor (um CodeHighlighter por aba).

class RetroCSyntaxHighlighter : public EditorSyntaxHighlighter {
	GDCLASS(RetroCSyntaxHighlighter, EditorSyntaxHighlighter)

	Ref<CodeHighlighter> highlighter;

public:
	virtual void _update_cache() override;
	virtual Dictionary _get_line_syntax_highlighting_impl(int p_line) override { return highlighter->get_line_syntax_highlighting(p_line); }

	virtual PackedStringArray _get_supported_languages() const override { return PackedStringArray{ "c", "h", "inc" }; }
	virtual String _get_name() const override { return "C (SGDK)"; }

	virtual Ref<EditorSyntaxHighlighter> _create() const override;

	RetroCSyntaxHighlighter() { highlighter.instantiate(); }
};

class RetroAsmSyntaxHighlighter : public EditorSyntaxHighlighter {
	GDCLASS(RetroAsmSyntaxHighlighter, EditorSyntaxHighlighter)

	Ref<CodeHighlighter> highlighter;

public:
	virtual void _update_cache() override;
	virtual Dictionary _get_line_syntax_highlighting_impl(int p_line) override { return highlighter->get_line_syntax_highlighting(p_line); }

	virtual PackedStringArray _get_supported_languages() const override { return PackedStringArray{ "s", "asm", "68k" }; }
	virtual String _get_name() const override { return "Assembly 68000"; }

	virtual Ref<EditorSyntaxHighlighter> _create() const override;

	RetroAsmSyntaxHighlighter() { highlighter.instantiate(); }
};

class RetroResSyntaxHighlighter : public EditorSyntaxHighlighter {
	GDCLASS(RetroResSyntaxHighlighter, EditorSyntaxHighlighter)

	Ref<CodeHighlighter> highlighter;

public:
	virtual void _update_cache() override;
	virtual Dictionary _get_line_syntax_highlighting_impl(int p_line) override { return highlighter->get_line_syntax_highlighting(p_line); }

	virtual PackedStringArray _get_supported_languages() const override { return PackedStringArray{ "res" }; }
	virtual String _get_name() const override { return "Recursos SGDK (.res)"; }

	virtual Ref<EditorSyntaxHighlighter> _create() const override;

	RetroResSyntaxHighlighter() { highlighter.instantiate(); }
};
