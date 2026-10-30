#include "md_nodes.h"

#include "core/config/engine.h"
#include "core/io/file_access.h"
#include "core/io/image.h"
#include "core/templates/hash_set.h"
#include "core/templates/hashfuncs.h"
#include "core/object/class_db.h"
#include "scene/main/scene_tree.h"
#include "scene/resources/2d/tile_set.h"
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

String file_problem(const String &p_path, const String &p_extensions) {
	if (p_path.is_empty()) {
		return String();
	}
	if (!p_path.begins_with("res://")) {
		return U("O arquivo precisa estar dentro do projeto: ") + p_path;
	}
	if (!p_extensions.split(",").has(p_path.get_extension().to_lower())) {
		return vformat(U("%s precisa ser um arquivo %s."), p_path.get_file(), p_extensions.to_upper().replace(",", U(" ou ")));
	}
	if (!FileAccess::exists(p_path)) {
		return U("O arquivo não existe: ") + p_path;
	}
	return String();
}

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

Vector<Color> png_palette(const String &p_path) {
	Vector<Color> colors;
	const Vector<uint8_t> png = FileAccess::get_file_as_bytes(p_path);
	if (png.size() < 33 || png[25] != 3) {
		return colors;
	}
	int64_t at = 8;
	while (at + 8 <= png.size()) {
		const uint32_t length = uint32_t(png[at]) << 24 | uint32_t(png[at + 1]) << 16 | uint32_t(png[at + 2]) << 8 | png[at + 3];
		if (png[at + 4] == 'P' && png[at + 5] == 'L' && png[at + 6] == 'T' && png[at + 7] == 'E' && at + 8 + int64_t(length) <= png.size()) {
			for (uint32_t i = 0; i + 2 < length; i += 3) {
				colors.push_back(Color::from_rgba8(png[at + 8 + i], png[at + 9 + i], png[at + 10 + i]));
			}
			break;
		}
		at += 12 + length;
	}
	return colors;
}

void hide_unsupported(const Object *p_object, PropertyInfo &r_property, const char *const *p_kept) {
	if (!(r_property.usage & PROPERTY_USAGE_EDITOR) || (r_property.usage & (PROPERTY_USAGE_CATEGORY | PROPERTY_USAGE_GROUP | PROPERTY_USAGE_SUBGROUP))) {
		return;
	}
	for (StringName c = p_object->get_class_name(); String(c).begins_with("MD"); c = ClassDB::get_parent_class(c)) {
		if (ClassDB::has_property(c, r_property.name, true)) {
			return;
		}
	}
	for (const char *const *kept = p_kept; *kept; kept++) {
		if (r_property.name == *kept) {
			return;
		}
	}
	r_property.usage &= ~PROPERTY_USAGE_EDITOR;
}

int unique_tiles(const Ref<Image> &p_image) {
	if (p_image.is_null()) {
		return 0;
	}
	HashSet<uint32_t> seen;
	uint32_t tile[64], variant[64];
	for (int ty = 0; ty + 8 <= p_image->get_height(); ty += 8) {
		for (int tx = 0; tx + 8 <= p_image->get_width(); tx += 8) {
			for (int i = 0; i < 64; i++) {
				const Color color = p_image->get_pixel(tx + (i & 7), ty + (i >> 3));
				tile[i] = color.a < 0.5 ? 0u : color.to_rgba32();
			}
			uint32_t best = UINT32_MAX;
			for (int flip = 0; flip < 4; flip++) {
				for (int i = 0; i < 64; i++) {
					const int x = flip & 1 ? 7 - (i & 7) : i & 7, y = flip & 2 ? 7 - (i >> 3) : i >> 3;
					variant[i] = tile[y * 8 + x];
				}
				best = MIN(best, hash_murmur3_buffer(variant, sizeof(variant)));
			}
			seen.insert(best);
		}
	}
	return seen.size();
}

} // namespace RetroMD

namespace {
// O que cada tipo de node do Mega Drive aproveita das classes do Godot.
const char *const KEPT_NODE2D[] = { "position", "visible", nullptr };
const char *const KEPT_SPRITE[] = { "position", "visible", "texture", "hframes", "vframes", "frame", "frame_coords", "flip_h", nullptr };
const char *const KEPT_FUNDO[] = { "position", "visible", "texture", nullptr };
const char *const KEPT_MAPA[] = { "visible", "tile_map_data", "tile_set", "enabled", nullptr };
} // namespace

// ---- MDCena ----

void MDCena::set_musica(const String &p_musica) {
	musica = p_musica;
	update_configuration_warnings();
}

void MDCena::set_start_vai_para(const String &p_cena) {
	start_vai_para = p_cena;
	update_configuration_warnings();
}

void MDCena::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_musica", "musica"), &MDCena::set_musica);
	ClassDB::bind_method(D_METHOD("get_musica"), &MDCena::get_musica);
	ClassDB::bind_method(D_METHOD("set_start_vai_para", "cena"), &MDCena::set_start_vai_para);
	ClassDB::bind_method(D_METHOD("get_start_vai_para"), &MDCena::get_start_vai_para);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "musica", PROPERTY_HINT_FILE, "*.vgm,*.xgm"), "set_musica", "get_musica");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "start_vai_para", PROPERTY_HINT_FILE, "*.tscn"), "set_start_vai_para", "get_start_vai_para");
}

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
	for (const String &problem : { RetroMD::file_problem(musica, "vgm,xgm"), RetroMD::file_problem(start_vai_para, "tscn") }) {
		if (!problem.is_empty()) {
			warnings.push_back(problem);
		}
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

void MDFundo::set_rolagem(int p_rolagem) {
	rolagem = CLAMP(p_rolagem, 0, 100);
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
	if (rolagem > 0 && image.is_valid() && image->get_width() != 512) {
		// O plano tem 64 tiles (512 px) e dá a volta: só uma imagem dessa largura emenda ao rolar.
		warnings.push_back(vformat(U("Para rolar sem emenda, a imagem precisa ter 512 px de largura (a do plano); esta tem %d."), image->get_width()));
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
	ClassDB::bind_method(D_METHOD("set_rolagem", "rolagem"), &MDFundo::set_rolagem);
	ClassDB::bind_method(D_METHOD("get_rolagem"), &MDFundo::get_rolagem);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "rolagem", PROPERTY_HINT_RANGE, "0,100,1,suffix:% da câmera"), "set_rolagem", "get_rolagem");
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

void MDSprite::set_caixa_colisao(const Rect2i &p_caixa) {
	caixa_colisao = p_caixa;
	queue_redraw();
}

Vector2i MDSprite::get_frame_size() const {
	const Ref<Texture2D> image = get_texture();
	return image.is_valid() ? Vector2i(image->get_width() / MAX(1, get_hframes()), image->get_height() / MAX(1, get_vframes())) : Vector2i();
}

Rect2i MDSprite::get_caixa_efetiva() const {
	return caixa_colisao.has_area() ? caixa_colisao : Rect2i(Vector2i(), get_frame_size());
}

void MDSprite::_notification(int p_what) {
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint() && _shows_collision_box()) {
		draw_rect(Rect2(get_caixa_efetiva()), Color(1, 0.3, 0.3, 0.8), false, 1);
	}
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
	ClassDB::bind_method(D_METHOD("set_caixa_colisao", "caixa"), &MDSprite::set_caixa_colisao);
	ClassDB::bind_method(D_METHOD("get_caixa_colisao"), &MDSprite::get_caixa_colisao);
	// Relativa ao canto do sprite; vazia usa o quadro inteiro.
	ADD_PROPERTY(PropertyInfo(Variant::RECT2I, "caixa_colisao", PROPERTY_HINT_NONE, "suffix:px"), "set_caixa_colisao", "get_caixa_colisao");
}

MDSprite::MDSprite() {
	set_centered(false);
}

// ---- MDJogador ----

void MDJogador::_validate_property(PropertyInfo &p_property) const {
	// Visto de cima não há pulo nem gravidade.
	if (modo == MODO_VISTO_DE_CIMA && (p_property.name == "forca_pulo" || p_property.name == "gravidade" || p_property.name == "som_pulo")) {
		p_property.usage &= ~PROPERTY_USAGE_EDITOR;
	}
}

void MDJogador::set_modo(Modo p_modo) {
	modo = p_modo;
	notify_property_list_changed();
}

void MDJogador::set_velocidade(int p_velocidade) {
	velocidade = CLAMP(p_velocidade, 0, 16);
}

void MDJogador::set_forca_pulo(int p_forca) {
	forca_pulo = CLAMP(p_forca, 0, 1024);
}

void MDJogador::set_gravidade(int p_gravidade) {
	gravidade = CLAMP(p_gravidade, 0, 256);
}

void MDJogador::set_vidas(int p_vidas) {
	vidas = CLAMP(p_vidas, 0, 9);
}

void MDJogador::set_som_pulo(const String &p_som) {
	som_pulo = p_som;
	update_configuration_warnings();
}

void MDJogador::set_som_morte(const String &p_som) {
	som_morte = p_som;
	update_configuration_warnings();
}

PackedStringArray MDJogador::get_configuration_warnings() const {
	PackedStringArray warnings = MDSprite::get_configuration_warnings();
	if (get_vframes() < 2) {
		warnings.push_back(U("A folha precisa de 2 linhas: a 0 é a animação parada e a 1, andando."));
	}
	for (const String &problem : { RetroMD::file_problem(som_pulo, "wav"), RetroMD::file_problem(som_morte, "wav") }) {
		if (!problem.is_empty()) {
			warnings.push_back(problem);
		}
	}
	return warnings;
}

void MDJogador::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_modo", "modo"), &MDJogador::set_modo);
	ClassDB::bind_method(D_METHOD("get_modo"), &MDJogador::get_modo);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "modo", PROPERTY_HINT_ENUM, "Plataforma (de lado),Visto de cima"), "set_modo", "get_modo");
	BIND_ENUM_CONSTANT(MODO_PLATAFORMA);
	BIND_ENUM_CONSTANT(MODO_VISTO_DE_CIMA);
	ClassDB::bind_method(D_METHOD("set_velocidade", "velocidade"), &MDJogador::set_velocidade);
	ClassDB::bind_method(D_METHOD("get_velocidade"), &MDJogador::get_velocidade);
	ClassDB::bind_method(D_METHOD("set_forca_pulo", "forca"), &MDJogador::set_forca_pulo);
	ClassDB::bind_method(D_METHOD("get_forca_pulo"), &MDJogador::get_forca_pulo);
	ClassDB::bind_method(D_METHOD("set_gravidade", "gravidade"), &MDJogador::set_gravidade);
	ClassDB::bind_method(D_METHOD("get_gravidade"), &MDJogador::get_gravidade);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade", PROPERTY_HINT_RANGE, "0,16,1,suffix:px/quadro"), "set_velocidade", "get_velocidade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "forca_pulo", PROPERTY_HINT_RANGE, "0,1024,1,suffix:1/16 px/quadro"), "set_forca_pulo", "get_forca_pulo");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "gravidade", PROPERTY_HINT_RANGE, "0,256,1,suffix:1/16 px/quadro²"), "set_gravidade", "get_gravidade");
	ClassDB::bind_method(D_METHOD("set_vidas", "vidas"), &MDJogador::set_vidas);
	ClassDB::bind_method(D_METHOD("get_vidas"), &MDJogador::get_vidas);
	ClassDB::bind_method(D_METHOD("set_som_pulo", "som"), &MDJogador::set_som_pulo);
	ClassDB::bind_method(D_METHOD("get_som_pulo"), &MDJogador::get_som_pulo);
	ClassDB::bind_method(D_METHOD("set_som_morte", "som"), &MDJogador::set_som_morte);
	ClassDB::bind_method(D_METHOD("get_som_morte"), &MDJogador::get_som_morte);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "vidas", PROPERTY_HINT_RANGE, "0,9,1"), "set_vidas", "get_vidas");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_pulo", PROPERTY_HINT_FILE, "*.wav"), "set_som_pulo", "get_som_pulo");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_morte", PROPERTY_HINT_FILE, "*.wav"), "set_som_morte", "get_som_morte");
}

// ---- MDInimigo ----

void MDInimigo::set_distancia(int p_distancia) {
	distancia = CLAMP(p_distancia, 0, 4096);
	queue_redraw();
}

void MDInimigo::set_velocidade(int p_velocidade) {
	velocidade = CLAMP(p_velocidade, 0, 16);
}

void MDInimigo::set_vira_na_borda(bool p_vira) {
	vira_na_borda = p_vira;
}

void MDInimigo::set_pisavel(bool p_pisavel) {
	pisavel = p_pisavel;
}

void MDInimigo::set_pontos(int p_pontos) {
	pontos = CLAMP(p_pontos, 0, 9999);
}

void MDInimigo::set_som_derrota(const String &p_som) {
	som_derrota = p_som;
	update_configuration_warnings();
}

PackedStringArray MDInimigo::get_configuration_warnings() const {
	PackedStringArray warnings = MDSprite::get_configuration_warnings();
	const String problem = RetroMD::file_problem(som_derrota, "wav");
	if (!problem.is_empty()) {
		warnings.push_back(problem);
	}
	return warnings;
}

void MDInimigo::_notification(int p_what) {
	// Faixa da patrulha embaixo do sprite.
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		const Vector2i quadro = get_frame_size();
		const float y = quadro.y + 2;
		draw_dashed_line(Vector2(0, y), Vector2(quadro.x + distancia, y), Color(1, 0.8, 0.3, 0.9), 1, 3);
		draw_line(Vector2(distancia, y - 3), Vector2(distancia, y + 3), Color(1, 0.8, 0.3, 0.9));
	}
}

void MDInimigo::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_distancia", "distancia"), &MDInimigo::set_distancia);
	ClassDB::bind_method(D_METHOD("get_distancia"), &MDInimigo::get_distancia);
	ClassDB::bind_method(D_METHOD("set_velocidade", "velocidade"), &MDInimigo::set_velocidade);
	ClassDB::bind_method(D_METHOD("get_velocidade"), &MDInimigo::get_velocidade);
	ClassDB::bind_method(D_METHOD("set_vira_na_borda", "vira"), &MDInimigo::set_vira_na_borda);
	ClassDB::bind_method(D_METHOD("get_vira_na_borda"), &MDInimigo::get_vira_na_borda);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "distancia", PROPERTY_HINT_RANGE, "0,4096,1,suffix:px"), "set_distancia", "get_distancia");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade", PROPERTY_HINT_RANGE, "0,16,1,suffix:px/quadro"), "set_velocidade", "get_velocidade");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "vira_na_borda"), "set_vira_na_borda", "get_vira_na_borda");
	ClassDB::bind_method(D_METHOD("set_pisavel", "pisavel"), &MDInimigo::set_pisavel);
	ClassDB::bind_method(D_METHOD("get_pisavel"), &MDInimigo::get_pisavel);
	ClassDB::bind_method(D_METHOD("set_pontos", "pontos"), &MDInimigo::set_pontos);
	ClassDB::bind_method(D_METHOD("get_pontos"), &MDInimigo::get_pontos);
	ClassDB::bind_method(D_METHOD("set_som_derrota", "som"), &MDInimigo::set_som_derrota);
	ClassDB::bind_method(D_METHOD("get_som_derrota"), &MDInimigo::get_som_derrota);
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "pisavel"), "set_pisavel", "get_pisavel");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "pontos", PROPERTY_HINT_RANGE, "0,9999,1"), "set_pontos", "get_pontos");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_derrota", PROPERTY_HINT_FILE, "*.wav"), "set_som_derrota", "get_som_derrota");
}

// ---- MDPlataforma ----

void MDPlataforma::set_deslocamento(const Vector2i &p_deslocamento) {
	deslocamento = p_deslocamento;
	queue_redraw();
}

void MDPlataforma::set_velocidade(int p_velocidade) {
	velocidade = CLAMP(p_velocidade, 1, 16);
}

void MDPlataforma::_notification(int p_what) {
	// Trajeto até a outra ponta, onde a plataforma aparece só com o contorno.
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		const Vector2 size = Vector2(get_frame_size());
		const Color color(0.4, 0.9, 1, 0.9);
		draw_dashed_line(size / 2, size / 2 + Vector2(deslocamento), color, 1, 3);
		draw_rect(Rect2(Vector2(deslocamento), size), color, false, 1);
	}
}

void MDPlataforma::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_deslocamento", "deslocamento"), &MDPlataforma::set_deslocamento);
	ClassDB::bind_method(D_METHOD("get_deslocamento"), &MDPlataforma::get_deslocamento);
	ClassDB::bind_method(D_METHOD("set_velocidade", "velocidade"), &MDPlataforma::set_velocidade);
	ClassDB::bind_method(D_METHOD("get_velocidade"), &MDPlataforma::get_velocidade);
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "deslocamento", PROPERTY_HINT_NONE, "suffix:px"), "set_deslocamento", "get_deslocamento");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade", PROPERTY_HINT_RANGE, "1,16,1,suffix:px/quadro"), "set_velocidade", "get_velocidade");
}

// ---- MDItem ----

void MDItem::set_pontos(int p_pontos) {
	pontos = CLAMP(p_pontos, 0, 9999);
}

void MDItem::set_som(const String &p_som) {
	som = p_som;
	update_configuration_warnings();
}

PackedStringArray MDItem::get_configuration_warnings() const {
	PackedStringArray warnings = MDSprite::get_configuration_warnings();
	const String problem = RetroMD::file_problem(som, "wav");
	if (!problem.is_empty()) {
		warnings.push_back(problem);
	}
	return warnings;
}

void MDItem::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_pontos", "pontos"), &MDItem::set_pontos);
	ClassDB::bind_method(D_METHOD("get_pontos"), &MDItem::get_pontos);
	ClassDB::bind_method(D_METHOD("set_som", "som"), &MDItem::set_som);
	ClassDB::bind_method(D_METHOD("get_som"), &MDItem::get_som);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "pontos", PROPERTY_HINT_RANGE, "0,9999,1"), "set_pontos", "get_pontos");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som", PROPERTY_HINT_FILE, "*.wav"), "set_som", "get_som");
}

// ---- MDMapa ----

void MDMapa::set_plano(MDFundo::Plano p_plano) {
	plano = p_plano;
}

void MDMapa::set_paleta(int p_paleta) {
	paleta = CLAMP(p_paleta, 0, 3);
}

void MDMapa::set_solido(bool p_solido) {
	solido = p_solido;
}

Ref<Texture2D> MDMapa::get_atlas_texture() const {
	const Ref<TileSet> tiles = get_tile_set();
	if (tiles.is_null() || tiles->get_source_count() != 1) {
		return Ref<Texture2D>();
	}
	const Ref<TileSetAtlasSource> atlas = tiles->get_source(tiles->get_source_id(0));
	return atlas.is_valid() ? atlas->get_texture() : Ref<Texture2D>();
}

PackedStringArray MDMapa::get_configuration_warnings() const {
	PackedStringArray warnings = TileMapLayer::get_configuration_warnings();
	const Ref<TileSet> tiles = get_tile_set();
	if (tiles.is_null()) {
		warnings.push_back(U("Falta o TileSet (Tile Set no Inspetor)."));
		return warnings;
	}
	const Ref<Texture2D> image = get_atlas_texture();
	if (image.is_null()) {
		warnings.push_back(U("O TileSet precisa de exatamente uma fonte de atlas, com uma imagem PNG."));
		return warnings;
	}
	const Vector2i size = tiles->get_tile_size();
	if (size.x % 8 || size.y % 8) {
		warnings.push_back(vformat(U("Os tiles (%d×%d) precisam ter lados múltiplos de 8."), size.x, size.y));
	}
	warnings.append_array(RetroMD::texture_problems(image, image->get_width(), image->get_height()));
	const Rect2i used = get_used_rect();
	if (used.position.x < 0 || used.position.y < 0) {
		warnings.push_back(U("Há tiles em coordenadas negativas; o mapa começa no canto superior esquerdo (0, 0)."));
	}
	if (get_position() != Vector2() || get_rotation() != 0 || get_scale() != Vector2(1, 1)) {
		warnings.push_back(U("O mapa fica na posição (0, 0), sem rotação nem escala."));
	}
	return warnings;
}

void MDMapa::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_plano", "plano"), &MDMapa::set_plano);
	ClassDB::bind_method(D_METHOD("get_plano"), &MDMapa::get_plano);
	ClassDB::bind_method(D_METHOD("set_paleta", "paleta"), &MDMapa::set_paleta);
	ClassDB::bind_method(D_METHOD("get_paleta"), &MDMapa::get_paleta);
	ClassDB::bind_method(D_METHOD("set_solido", "solido"), &MDMapa::set_solido);
	ClassDB::bind_method(D_METHOD("is_solido"), &MDMapa::is_solido);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "plano", PROPERTY_HINT_ENUM, "BG B (atrás),BG A (frente)"), "set_plano", "get_plano");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta", PROPERTY_HINT_RANGE, "0,3,1"), "set_paleta", "get_paleta");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "solido"), "set_solido", "is_solido");
}

// ---- MDTexto ----

void MDTexto::set_texto(const String &p_texto) {
	texto = p_texto;
	queue_redraw();
	update_configuration_warnings();
}

void MDTexto::set_piscar(bool p_piscar) {
	piscar = p_piscar;
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
	ClassDB::bind_method(D_METHOD("set_piscar", "piscar"), &MDTexto::set_piscar);
	ClassDB::bind_method(D_METHOD("get_piscar"), &MDTexto::get_piscar);
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "piscar"), "set_piscar", "get_piscar");
}

// ---- MDSaida ----

void MDSaida::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(1);
	queue_redraw();
}

void MDSaida::set_destino(const String &p_destino) {
	destino = p_destino;
	update_configuration_warnings();
}

void MDSaida::_notification(int p_what) {
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
		draw_rect(area, Color(0.3, 0.8, 1, 0.25));
		draw_rect(area, Color(0.3, 0.8, 1, 0.9), false, 1);
	}
}

PackedStringArray MDSaida::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (destino.is_empty()) {
		warnings.push_back(U("Escolha a cena de destino."));
	} else {
		const String problem = RetroMD::file_problem(destino, "tscn");
		if (!problem.is_empty()) {
			warnings.push_back(problem);
		}
	}
	if (get_rotation() != 0 || get_scale() != Vector2(1, 1)) {
		warnings.push_back(U("A saída não gira nem muda de escala; use o tamanho."));
	}
	return warnings;
}

void MDSaida::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDSaida::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDSaida::get_tamanho);
	ClassDB::bind_method(D_METHOD("set_destino", "destino"), &MDSaida::set_destino);
	ClassDB::bind_method(D_METHOD("get_destino"), &MDSaida::get_destino);
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "destino", PROPERTY_HINT_FILE, "*.tscn"), "set_destino", "get_destino");
}

void MDCena::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
}

void MDFundo::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_FUNDO);
}

void MDSprite::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_SPRITE);
}

void MDMapa::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_MAPA);
}

void MDTexto::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
}

void MDSaida::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
}

// ---- MDRetorno ----

void MDRetorno::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(1);
	queue_redraw();
}

void MDRetorno::set_som(const String &p_som) {
	som = p_som;
	update_configuration_warnings();
}

void MDRetorno::_notification(int p_what) {
	// Área e uma bandeira no fundo, onde o jogador reaparece.
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		const Color color(0.4, 1, 0.5, 0.9);
		draw_rect(Rect2(Vector2(), Vector2(tamanho)), Color(color, 0.2));
		draw_rect(Rect2(Vector2(), Vector2(tamanho)), color, false, 1);
		const float x = tamanho.x / 2.0f, bottom = tamanho.y;
		draw_line(Vector2(x, bottom), Vector2(x, bottom - 14), color, 1);
		draw_colored_polygon({ Vector2(x, bottom - 14), Vector2(x + 7, bottom - 11), Vector2(x, bottom - 8) }, color);
	}
}

PackedStringArray MDRetorno::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	const String problem = RetroMD::file_problem(som, "wav");
	if (!problem.is_empty()) {
		warnings.push_back(problem);
	}
	return warnings;
}

void MDRetorno::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
}

void MDRetorno::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDRetorno::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDRetorno::get_tamanho);
	ClassDB::bind_method(D_METHOD("set_som", "som"), &MDRetorno::set_som);
	ClassDB::bind_method(D_METHOD("get_som"), &MDRetorno::get_som);
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som", PROPERTY_HINT_FILE, "*.wav"), "set_som", "get_som");
}
