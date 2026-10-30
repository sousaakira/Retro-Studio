#include "md_nodes.h"

#include "core/io/file_access.h"
#include "core/object/class_db.h"
#include "scene/main/scene_tree.h"
#include "scene/resources/font.h"
#include "scene/theme/theme_db.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

bool _aligned(const Vector2 &p_position) {
	return Math::is_equal_approx(Math::fposmod(p_position.x, 8.0f), 0.0f) && Math::is_equal_approx(Math::fposmod(p_position.y, 8.0f), 0.0f);
}

} // namespace

namespace RetroMD {

// O rescomp do SGDK 1.81 converte PNG indexado (paleta de até 16 cores) sem requantizar.
PackedStringArray texture_problems(const Ref<Texture2D> &p_texture, int p_frame_width, int p_frame_height) {
	PackedStringArray problems;
	if (p_texture.is_null()) {
		problems.push_back(U("Falta a imagem (Texture)."));
		return problems;
	}
	const String path = p_texture->get_path();
	if (!path.begins_with("res://") || path.contains("::") || path.get_extension().to_lower() != "png") {
		problems.push_back(U("A imagem precisa ser um arquivo PNG do projeto."));
		return problems;
	}
	if (p_frame_width % 8 || p_frame_height % 8) {
		problems.push_back(vformat(U("O tamanho (%d×%d) precisa ser múltiplo de 8: o console desenha em tiles de 8×8."), p_frame_width, p_frame_height));
	}
	const Vector<uint8_t> png = FileAccess::get_file_as_bytes(path);
	// Assinatura, IHDR (tipo de cor no byte 25) e o PLTE logo depois, quando existe.
	if (png.size() < 33 || png[25] != 3) {
		problems.push_back(U("O PNG precisa ser indexado (paleta de até 16 cores; a cor 0 é a transparência)."));
		return problems;
	}
	int64_t at = 8;
	while (at + 8 <= png.size()) {
		const uint32_t length = uint32_t(png[at]) << 24 | uint32_t(png[at + 1]) << 16 | uint32_t(png[at + 2]) << 8 | png[at + 3];
		if (png[at + 4] == 'P' && png[at + 5] == 'L' && png[at + 6] == 'T' && png[at + 7] == 'E') {
			if (length / 3 > 16) {
				problems.push_back(vformat(U("A paleta do PNG tem %d cores; o Mega Drive usa 16 por paleta."), int(length / 3)));
			}
			break;
		}
		at += 12 + length;
	}
	return problems;
}

} // namespace RetroMD

// ---- MDCena ----

PackedStringArray MDCena::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (is_inside_tree() && get_tree()->get_edited_scene_root() && get_tree()->get_edited_scene_root() != this) {
		warnings.push_back(U("MDCena deve ser a raiz da cena."));
	}
	int sprites = 0;
	TypedArray<Node> nodes = find_children("*", "MDSprite", true, false);
	sprites = nodes.size();
	if (sprites > RetroMD::MAX_SPRITES) {
		warnings.push_back(vformat(U("A cena tem %d sprites; o console mostra no máximo %d."), sprites, RetroMD::MAX_SPRITES));
	}
	if (find_children("*", "MDJogador", true, false).size() > 1) {
		warnings.push_back(U("Só um MDJogador por cena é controlado pelo controle 1."));
	}
	return warnings;
}

// ---- MDFundo ----

void MDFundo::set_plano(Plano p_plano) {
	plano = p_plano;
}

void MDFundo::set_paleta(int p_paleta) {
	paleta = CLAMP(p_paleta, 0, 3);
	update_configuration_warnings();
}

PackedStringArray MDFundo::get_configuration_warnings() const {
	PackedStringArray warnings = Sprite2D::get_configuration_warnings();
	const Ref<Texture2D> image = get_texture();
	warnings.append_array(RetroMD::texture_problems(image, image.is_valid() ? image->get_width() : 0, image.is_valid() ? image->get_height() : 0));
	if (!_aligned(get_position())) {
		warnings.push_back(U("A posição precisa ser múltipla de 8 (o fundo é desenhado em tiles)."));
	}
	if (get_rotation() != 0 || get_scale() != Vector2(1, 1) || is_centered() || get_hframes() != 1 || get_vframes() != 1) {
		warnings.push_back(U("Fundos não giram, não mudam de escala, não são centralizados e não têm quadros."));
	}
	return warnings;
}

void MDFundo::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_plano", "plano"), &MDFundo::set_plano);
	ClassDB::bind_method(D_METHOD("get_plano"), &MDFundo::get_plano);
	ClassDB::bind_method(D_METHOD("set_paleta", "paleta"), &MDFundo::set_paleta);
	ClassDB::bind_method(D_METHOD("get_paleta"), &MDFundo::get_paleta);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "plano", PROPERTY_HINT_ENUM, "BG B (atrás),BG A (frente)"), "set_plano", "get_plano");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta", PROPERTY_HINT_RANGE, "0,3,1"), "set_paleta", "get_paleta");
	BIND_ENUM_CONSTANT(PLANO_B);
	BIND_ENUM_CONSTANT(PLANO_A);
}

MDFundo::MDFundo() {
	set_centered(false);
}

// ---- MDSprite ----

void MDSprite::set_paleta(int p_paleta) {
	paleta = CLAMP(p_paleta, 0, 3);
	update_configuration_warnings();
}

void MDSprite::set_prioridade(bool p_prioridade) {
	prioridade = p_prioridade;
}

void MDSprite::set_velocidade_animacao(int p_ticks) {
	velocidade_animacao = CLAMP(p_ticks, 0, 255);
}

PackedStringArray MDSprite::get_configuration_warnings() const {
	PackedStringArray warnings = Sprite2D::get_configuration_warnings();
	const Ref<Texture2D> image = get_texture();
	const int width = image.is_valid() ? image->get_width() / MAX(1, get_hframes()) : 0;
	const int height = image.is_valid() ? image->get_height() / MAX(1, get_vframes()) : 0;
	warnings.append_array(RetroMD::texture_problems(image, width, height));
	if (width > 256 || height > 256) {
		warnings.push_back(U("Cada quadro pode ter no máximo 256×256 pixels."));
	}
	if (get_rotation() != 0 || get_scale() != Vector2(1, 1) || is_centered()) {
		warnings.push_back(U("Sprites do console não giram, não mudam de escala e se posicionam pelo canto superior esquerdo (desligue Centered)."));
	}
	return warnings;
}

void MDSprite::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_paleta", "paleta"), &MDSprite::set_paleta);
	ClassDB::bind_method(D_METHOD("get_paleta"), &MDSprite::get_paleta);
	ClassDB::bind_method(D_METHOD("set_prioridade", "prioridade"), &MDSprite::set_prioridade);
	ClassDB::bind_method(D_METHOD("get_prioridade"), &MDSprite::get_prioridade);
	ClassDB::bind_method(D_METHOD("set_velocidade_animacao", "ticks"), &MDSprite::set_velocidade_animacao);
	ClassDB::bind_method(D_METHOD("get_velocidade_animacao"), &MDSprite::get_velocidade_animacao);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta", PROPERTY_HINT_RANGE, "0,3,1"), "set_paleta", "get_paleta");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "prioridade"), "set_prioridade", "get_prioridade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade_animacao", PROPERTY_HINT_RANGE, "0,255,1,suffix:quadros"), "set_velocidade_animacao", "get_velocidade_animacao");
}

MDSprite::MDSprite() {
	set_centered(false);
}

// ---- MDJogador ----

void MDJogador::set_velocidade(int p_velocidade) {
	velocidade = CLAMP(p_velocidade, 0, 16);
}

void MDJogador::set_forca_pulo(int p_forca) {
	forca_pulo = CLAMP(p_forca, 0, 1024);
}

void MDJogador::set_gravidade(int p_gravidade) {
	gravidade = CLAMP(p_gravidade, 0, 256);
}

PackedStringArray MDJogador::get_configuration_warnings() const {
	PackedStringArray warnings = MDSprite::get_configuration_warnings();
	if (get_vframes() < 2) {
		warnings.push_back(U("A folha precisa de 2 linhas: a 0 é a animação parada e a 1, andando."));
	}
	return warnings;
}

void MDJogador::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_velocidade", "velocidade"), &MDJogador::set_velocidade);
	ClassDB::bind_method(D_METHOD("get_velocidade"), &MDJogador::get_velocidade);
	ClassDB::bind_method(D_METHOD("set_forca_pulo", "forca"), &MDJogador::set_forca_pulo);
	ClassDB::bind_method(D_METHOD("get_forca_pulo"), &MDJogador::get_forca_pulo);
	ClassDB::bind_method(D_METHOD("set_gravidade", "gravidade"), &MDJogador::set_gravidade);
	ClassDB::bind_method(D_METHOD("get_gravidade"), &MDJogador::get_gravidade);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade", PROPERTY_HINT_RANGE, "0,16,1,suffix:px/quadro"), "set_velocidade", "get_velocidade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "forca_pulo", PROPERTY_HINT_RANGE, "0,1024,1,suffix:1/16 px/quadro"), "set_forca_pulo", "get_forca_pulo");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "gravidade", PROPERTY_HINT_RANGE, "0,256,1,suffix:1/16 px/quadro²"), "set_gravidade", "get_gravidade");
}

// ---- MDTexto ----

void MDTexto::set_texto(const String &p_texto) {
	texto = p_texto;
	queue_redraw();
	update_configuration_warnings();
}

void MDTexto::_notification(int p_what) {
	if (p_what != NOTIFICATION_DRAW || texto.is_empty()) {
		return;
	}
	// Prévia aproximada: a fonte do editor no tamanho dos tiles do console.
	const Ref<Font> font = ThemeDB::get_singleton()->get_fallback_font();
	for (int i = 0; i < texto.length(); i++) {
		draw_string(font, Vector2(i * 8, 7), String::chr(texto[i]), HORIZONTAL_ALIGNMENT_LEFT, -1, 9, Color(1, 1, 1));
	}
}

PackedStringArray MDTexto::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (!_aligned(get_position())) {
		warnings.push_back(U("A posição precisa ser múltipla de 8 (o texto é escrito em tiles)."));
	}
	for (int i = 0; i < texto.length(); i++) {
		if (texto[i] < 32 || texto[i] > 126) {
			warnings.push_back(U("A fonte do SGDK só tem os caracteres ASCII (sem acentos)."));
			break;
		}
	}
	return warnings;
}

void MDTexto::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_texto", "texto"), &MDTexto::set_texto);
	ClassDB::bind_method(D_METHOD("get_texto"), &MDTexto::get_texto);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto"), "set_texto", "get_texto");
}
