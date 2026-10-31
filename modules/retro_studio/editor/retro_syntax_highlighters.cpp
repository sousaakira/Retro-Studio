#include "retro_syntax_highlighters.h"

#include "editor/settings/editor_settings.h"

namespace {

const char *C_KEYWORDS[] = {
	"auto", "break", "case", "const", "continue", "default", "do", "else", "enum", "extern", "for", "goto", "if",
	"inline", "register", "restrict", "return", "sizeof", "static", "struct", "switch", "typedef", "union",
	"volatile", "while", nullptr
};

// Tipos do C e os que o SGDK define em types.h.
const char *C_TYPES[] = {
	"void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "bool",
	"u8", "u16", "u32", "s8", "s16", "s32", "vu8", "vu16", "vu32", "vs8", "vs16", "vs32",
	"fix16", "fix32", "fastfix16", "fastfix32", "f16", "f32", "uint8_t", "uint16_t", "uint32_t",
	"int8_t", "int16_t", "int32_t", "size_t", "Sprite", "Map", "Image", "TileSet", "Palette",
	"SpriteDefinition", "VDPPlane", "TransferMethod", nullptr
};

const char *C_CONSTANTS[] = { "TRUE", "FALSE", "NULL", "true", "false", nullptr };

const char *ASM_DIRECTIVES[] = {
	"dc", "ds", "dcb", "even", "align", "include", "incbin", "equ", "set", "macro", "endm", "rept", "endr",
	"section", "global", "globl", "extern", "if", "else", "endif", "org", nullptr
};

const char *ASM_REGISTERS[] = {
	"d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7",
	"sp", "pc", "sr", "ccr", "usp", nullptr
};

const char *ASM_MNEMONICS[] = {
	"move", "movea", "movem", "movep", "moveq", "lea", "pea", "clr", "add", "adda", "addi", "addq", "addx",
	"sub", "suba", "subi", "subq", "subx", "mulu", "muls", "divu", "divs", "neg", "negx", "ext", "swap", "exg",
	"and", "andi", "or", "ori", "eor", "eori", "not", "lsl", "lsr", "asl", "asr", "rol", "ror", "roxl", "roxr",
	"btst", "bset", "bclr", "bchg", "cmp", "cmpa", "cmpi", "cmpm", "tst", "tas", "jmp", "jsr", "rts", "rte", "rtr",
	"bra", "bsr", "beq", "bne", "bcc", "bcs", "bhi", "bls", "bge", "bgt", "ble", "blt", "bmi", "bpl", "bvc", "bvs",
	"dbra", "dbf", "dbeq", "dbne", "scc", "seq", "sne", "link", "unlk", "nop", "stop", "trap", "reset", "chk",
	nullptr
};

// Comandos do rescomp (SGDK) e as opções mais usadas.
const char *RES_TYPES[] = {
	"IMAGE", "SPRITE", "TILESET", "PALETTE", "MAP", "TILEMAP", "OBJECTS", "BITMAP", "XGM", "XGM2", "WAV", "BIN",
	"ALIGN", "UNGROUP", "NEAR", "FAR", nullptr
};
const char *RES_OPTIONS[] = {
	"NONE", "BEST", "AUTO", "APLIB", "LZ4W", "FAST", "ALL", "DUPLICATE", "ROWS", "COLUMNS", "FULL", "PCM",
	"DPCM", "XGM", "XGM2", "TRUE", "FALSE", nullptr
};

void add_words(const Ref<CodeHighlighter> &p_highlighter, const char **p_words, const Color &p_color, bool p_upper_too = false) {
	for (int i = 0; p_words[i]; i++) {
		p_highlighter->add_keyword_color(p_words[i], p_color);
		if (p_upper_too) {
			p_highlighter->add_keyword_color(String(p_words[i]).to_upper(), p_color);
		}
	}
}

void reset(const Ref<CodeHighlighter> &p_highlighter, TextEdit *p_text_edit) {
	p_highlighter->set_text_edit(p_text_edit);
	p_highlighter->clear_keyword_colors();
	p_highlighter->clear_member_keyword_colors();
	p_highlighter->clear_color_regions();
	p_highlighter->set_symbol_color(EDITOR_GET("text_editor/theme/highlighting/symbol_color"));
	p_highlighter->set_number_color(EDITOR_GET("text_editor/theme/highlighting/number_color"));
	p_highlighter->set_function_color(EDITOR_GET("text_editor/theme/highlighting/function_color"));
	p_highlighter->set_member_variable_color(EDITOR_GET("text_editor/theme/highlighting/text_color"));
}

} // namespace

void RetroCSyntaxHighlighter::_update_cache() {
	reset(highlighter, text_edit);
	add_words(highlighter, C_KEYWORDS, EDITOR_GET("text_editor/theme/highlighting/keyword_color"));
	add_words(highlighter, C_TYPES, EDITOR_GET("text_editor/theme/highlighting/base_type_color"));
	add_words(highlighter, C_CONSTANTS, EDITOR_GET("text_editor/theme/highlighting/keyword_color"));

	const Color string_color = EDITOR_GET("text_editor/theme/highlighting/string_color");
	highlighter->add_color_region("\"", "\"", string_color);
	highlighter->add_color_region("'", "'", string_color);
	const Color comment_color = EDITOR_GET("text_editor/theme/highlighting/comment_color");
	highlighter->add_color_region("//", "", comment_color, true);
	highlighter->add_color_region("/*", "*/", comment_color);
	// Diretivas do pré-processador (#include, #define...) até o fim da linha.
	highlighter->add_color_region("#", "", EDITOR_GET("text_editor/theme/highlighting/control_flow_keyword_color"), true);
}

Ref<EditorSyntaxHighlighter> RetroCSyntaxHighlighter::_create() const {
	Ref<RetroCSyntaxHighlighter> syntax_highlighter;
	syntax_highlighter.instantiate();
	return syntax_highlighter;
}

void RetroAsmSyntaxHighlighter::_update_cache() {
	reset(highlighter, text_edit);
	add_words(highlighter, ASM_MNEMONICS, EDITOR_GET("text_editor/theme/highlighting/keyword_color"), true);
	add_words(highlighter, ASM_DIRECTIVES, EDITOR_GET("text_editor/theme/highlighting/control_flow_keyword_color"), true);
	add_words(highlighter, ASM_REGISTERS, EDITOR_GET("text_editor/theme/highlighting/base_type_color"), true);

	const Color string_color = EDITOR_GET("text_editor/theme/highlighting/string_color");
	highlighter->add_color_region("\"", "\"", string_color);
	const Color comment_color = EDITOR_GET("text_editor/theme/highlighting/comment_color");
	highlighter->add_color_region(";", "", comment_color, true);
	highlighter->add_color_region("|", "", comment_color, true);
	highlighter->add_color_region("/*", "*/", comment_color);
	highlighter->add_color_region("#", "", EDITOR_GET("text_editor/theme/highlighting/control_flow_keyword_color"), true);
}

Ref<EditorSyntaxHighlighter> RetroAsmSyntaxHighlighter::_create() const {
	Ref<RetroAsmSyntaxHighlighter> syntax_highlighter;
	syntax_highlighter.instantiate();
	return syntax_highlighter;
}

void RetroResSyntaxHighlighter::_update_cache() {
	reset(highlighter, text_edit);
	add_words(highlighter, RES_TYPES, EDITOR_GET("text_editor/theme/highlighting/keyword_color"));
	add_words(highlighter, RES_OPTIONS, EDITOR_GET("text_editor/theme/highlighting/base_type_color"));

	highlighter->add_color_region("\"", "\"", EDITOR_GET("text_editor/theme/highlighting/string_color"));
	highlighter->add_color_region("//", "", EDITOR_GET("text_editor/theme/highlighting/comment_color"), true);
	highlighter->add_color_region("#", "", EDITOR_GET("text_editor/theme/highlighting/comment_color"), true);
}

Ref<EditorSyntaxHighlighter> RetroResSyntaxHighlighter::_create() const {
	Ref<RetroResSyntaxHighlighter> syntax_highlighter;
	syntax_highlighter.instantiate();
	return syntax_highlighter;
}
