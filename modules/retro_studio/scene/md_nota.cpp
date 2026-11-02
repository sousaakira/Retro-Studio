#include "md_nota.h"

#include "md_nodes.h"

#include "core/config/engine.h"
#include "core/object/class_db.h"
#include "scene/resources/font.h"
#include "scene/theme/theme_db.h"

namespace {
String U(const char *p_text) {
	return String::utf8(p_text);
}

const char *const KEPT_NOTA[] = { "position", "visible", nullptr };
} // namespace

String MDNota::nome_do_tipo(Tipo p_tipo) {
	switch (p_tipo) {
		case TIPO_PROBLEMA:
			return U("problema");
		case TIPO_INFORMACAO:
			return U("informação");
		default:
			return U("tarefa");
	}
}

String MDNota::nome_da_situacao(Situacao p_situacao) {
	switch (p_situacao) {
		case SITUACAO_EM_ANDAMENTO:
			return U("em andamento");
		case SITUACAO_RESOLVIDA:
			return U("resolvida");
		default:
			return U("aberta");
	}
}

Color MDNota::cor() const {
	if (situacao == SITUACAO_RESOLVIDA) {
		return Color(0.35, 0.85, 0.45);
	}
	switch (tipo) {
		case TIPO_PROBLEMA:
			return Color(1, 0.35, 0.35);
		case TIPO_INFORMACAO:
			return Color(0.4, 0.7, 1);
		default:
			return Color(1, 0.75, 0.2);
	}
}

void MDNota::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(8);
	queue_redraw();
}

void MDNota::set_tipo(Tipo p_tipo) {
	tipo = p_tipo;
	queue_redraw();
}

void MDNota::set_texto(const String &p_texto) {
	texto = p_texto;
	queue_redraw();
	update_configuration_warnings();
}

void MDNota::set_situacao(Situacao p_situacao) {
	situacao = p_situacao;
	queue_redraw();
}

void MDNota::set_resposta(const String &p_resposta) {
	resposta = p_resposta;
	queue_redraw();
}

#ifdef TOOLS_ENABLED
void MDNota::_edit_set_rect(const Rect2 &p_rect) {
	// Arrastar uma borda move a origem e muda o tamanho (a nota não gira nem muda de escala).
	set_position(get_position() + p_rect.position.round());
	set_tamanho(Vector2i(p_rect.size.round()));
}
#endif

void MDNota::_notification(int p_what) {
	if (p_what != NOTIFICATION_DRAW || !Engine::get_singleton()->is_editor_hint()) {
		return;
	}
	const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
	const Color c = cor();
	const bool resolvida = situacao == SITUACAO_RESOLVIDA;
	draw_rect(area, Color(c, resolvida ? 0.05 : 0.12));
	draw_rect(area, Color(c, resolvida ? 0.5 : 0.9), false, 1);
	// Etiqueta no canto: tipo (e situação, se não for aberta) e a primeira linha do texto, em letra pequena.
	const Ref<Font> font = ThemeDB::get_singleton()->get_fallback_font();
	if (font.is_null()) {
		return;
	}
	const int size = 6;
	String titulo = nome_do_tipo(tipo).capitalize();
	if (situacao != SITUACAO_ABERTA) {
		titulo += " (" + nome_da_situacao(situacao) + ")";
	}
	const float largura = MAX(8.0f, tamanho.x - 4.0f);
	const float altura_linha = font->get_height(size);
	const Vector2 inicio = Vector2(2, 2 + font->get_ascent(size));
	draw_rect(Rect2(Vector2(), Vector2(MIN(float(tamanho.x), font->get_string_size(titulo, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + 4), altura_linha + 3)), Color(c, 0.85));
	draw_string(font, inicio, titulo, HORIZONTAL_ALIGNMENT_LEFT, largura, size, Color(0, 0, 0));
	const String corpo = texto.strip_edges();
	if (!corpo.is_empty() && tamanho.y > altura_linha * 2 + 4) {
		const int linhas = MAX(1, int((tamanho.y - altura_linha - 6) / altura_linha));
		draw_multiline_string(font, inicio + Vector2(0, altura_linha + 2), corpo, HORIZONTAL_ALIGNMENT_LEFT, largura, size, linhas, Color(1, 1, 1, resolvida ? 0.6 : 0.95));
	}
}

PackedStringArray MDNota::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (texto.strip_edges().is_empty()) {
		warnings.push_back(U("Escreva no texto o que a IA deve fazer ou saber sobre esta área."));
	}
	return warnings;
}

void MDNota::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NOTA);
}

void MDNota::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDNota::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDNota::get_tamanho);
	ClassDB::bind_method(D_METHOD("set_tipo", "tipo"), &MDNota::set_tipo);
	ClassDB::bind_method(D_METHOD("get_tipo"), &MDNota::get_tipo);
	ClassDB::bind_method(D_METHOD("set_texto", "texto"), &MDNota::set_texto);
	ClassDB::bind_method(D_METHOD("get_texto"), &MDNota::get_texto);
	ClassDB::bind_method(D_METHOD("set_situacao", "situacao"), &MDNota::set_situacao);
	ClassDB::bind_method(D_METHOD("get_situacao"), &MDNota::get_situacao);
	ClassDB::bind_method(D_METHOD("set_resposta", "resposta"), &MDNota::set_resposta);
	ClassDB::bind_method(D_METHOD("get_resposta"), &MDNota::get_resposta);

	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "tipo", PROPERTY_HINT_ENUM, U("Tarefa,Problema,Informação")), "set_tipo", "get_tipo");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto", PROPERTY_HINT_MULTILINE_TEXT), "set_texto", "get_texto");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "situacao", PROPERTY_HINT_ENUM, U("Aberta,Em andamento,Resolvida")), "set_situacao", "get_situacao");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "resposta", PROPERTY_HINT_MULTILINE_TEXT), "set_resposta", "get_resposta");

	BIND_ENUM_CONSTANT(TIPO_TAREFA);
	BIND_ENUM_CONSTANT(TIPO_PROBLEMA);
	BIND_ENUM_CONSTANT(TIPO_INFORMACAO);
	BIND_ENUM_CONSTANT(SITUACAO_ABERTA);
	BIND_ENUM_CONSTANT(SITUACAO_EM_ANDAMENTO);
	BIND_ENUM_CONSTANT(SITUACAO_RESOLVIDA);
}
