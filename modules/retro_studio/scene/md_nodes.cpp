#include "md_nodes.h"

#include "core/io/resource_uid.h"

#include "core/config/engine.h"
#include "core/core_string_names.h"
#include "core/io/file_access.h"
#include "core/io/image.h"
#include "core/templates/hash_set.h"
#include "core/templates/hashfuncs.h"
#include "core/object/callable_mp.h"
#include "core/object/class_db.h"
#include "scene/animation/animation_player.h"
#include "scene/main/scene_tree.h"
#include "scene/resources/2d/tile_set.h"
#include "scene/resources/font.h"
#include "scene/resources/image_texture.h"
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

bool fix_tile_set(const Ref<TileSet> &p_tile_set, const String &p_node) {
	if (p_tile_set.is_null() || (p_tile_set->get_tile_size() == Size2i(8, 8) && p_tile_set->get_tile_shape() == TileSet::TILE_SHAPE_SQUARE)) {
		return false;
	}
	WARN_PRINT(vformat(U("Retro Studio: o TileSet de %s estava com tiles de %d×%d; voltou para 8×8 quadrados, como no Mega Drive."), p_node, p_tile_set->get_tile_size().x, p_tile_set->get_tile_size().y));
	p_tile_set->set_tile_shape(TileSet::TILE_SHAPE_SQUARE);
	p_tile_set->set_tile_size(Size2i(8, 8));
	return true;
}

String resource_path(const String &p_path) {
	if (!p_path.begins_with("uid://")) {
		return p_path;
	}
	const String path = ResourceUID::uid_to_path(p_path);
	return path.is_empty() ? p_path : path; // ID desconhecido: fica como veio, e o aviso explica.
}

String file_problem(const String &p_given, const String &p_extensions) {
	// O ID é resolvido de novo aqui: um arquivo novo pode ter sido registrado depois de a cena carregar.
	const String p_path = resource_path(p_given);
	if (p_path.is_empty()) {
		return String();
	}
	if (p_path.begins_with("uid://")) {
		return U("O arquivo deste ID não foi encontrado no projeto (escolha de novo): ") + p_path;
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

int sprite_vram_tiles(const String &p_path, int p_hframes, int p_vframes) {
	Ref<Image> image = MDPersonagem::load_sheet(p_path);
	if (image.is_null()) {
		return 0;
	}
	return sprite_vram_tiles(image, p_hframes, p_vframes);
}

int sprite_vram_tiles(const Ref<Image> &p_source, int p_hframes, int p_vframes) {
	Ref<Image> image = p_source->duplicate();
	image->convert(Image::FORMAT_RGBA8);
	const int frame_w = image->get_width() / MAX(1, p_hframes), frame_h = image->get_height() / MAX(1, p_vframes);
	int most = 0;
	for (int fy = 0; fy < MAX(1, p_vframes); fy++) {
		for (int fx = 0; fx < MAX(1, p_hframes); fx++) {
			const Rect2i used = image->get_region(Rect2i(fx * frame_w, fy * frame_h, frame_w, frame_h))->get_used_rect();
			if (used.has_area()) {
				const int columns = (used.get_end().x + 7) / 8 - used.position.x / 8, rows = (used.get_end().y + 7) / 8 - used.position.y / 8;
				most = MAX(most, columns * rows);
			}
		}
	}
	return most;
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
	musica = RetroMD::resource_path(p_musica);
	update_configuration_warnings();
}

void MDCena::set_start_vai_para(const String &p_cena) {
	start_vai_para = RetroMD::resource_path(p_cena);
	update_configuration_warnings();
}

void MDCena::set_ao_fim_da_animacao(const String &p_cena) {
	ao_fim_da_animacao = RetroMD::resource_path(p_cena);
	update_configuration_warnings();
}

void MDCena::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_musica", "musica"), &MDCena::set_musica);
	ClassDB::bind_method(D_METHOD("get_musica"), &MDCena::get_musica);
	ClassDB::bind_method(D_METHOD("set_start_vai_para", "cena"), &MDCena::set_start_vai_para);
	ClassDB::bind_method(D_METHOD("get_start_vai_para"), &MDCena::get_start_vai_para);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "musica", PROPERTY_HINT_FILE, "*.vgm,*.xgm"), "set_musica", "get_musica");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "start_vai_para", PROPERTY_HINT_FILE, "*.tscn"), "set_start_vai_para", "get_start_vai_para");
	ClassDB::bind_method(D_METHOD("set_ao_fim_da_animacao", "cena"), &MDCena::set_ao_fim_da_animacao);
	ClassDB::bind_method(D_METHOD("get_ao_fim_da_animacao"), &MDCena::get_ao_fim_da_animacao);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "ao_fim_da_animacao", PROPERTY_HINT_FILE, "*.tscn"), "set_ao_fim_da_animacao", "get_ao_fim_da_animacao");
	ClassDB::bind_method(D_METHOD("set_salvar_ao_entrar", "salvar"), &MDCena::set_salvar_ao_entrar);
	ClassDB::bind_method(D_METHOD("get_salvar_ao_entrar"), &MDCena::get_salvar_ao_entrar);
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "salvar_ao_entrar"), "set_salvar_ao_entrar", "get_salvar_ao_entrar");
	ClassDB::bind_method(D_METHOD("set_luz_e_sombra", "ligado"), &MDCena::set_luz_e_sombra);
	ClassDB::bind_method(D_METHOD("get_luz_e_sombra"), &MDCena::get_luz_e_sombra);
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "luz_e_sombra"), "set_luz_e_sombra", "get_luz_e_sombra");
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
	for (const String &problem : { RetroMD::file_problem(musica, "vgm,xgm"), RetroMD::file_problem(start_vai_para, "tscn"), RetroMD::file_problem(ao_fim_da_animacao, "tscn") }) {
		if (!problem.is_empty()) {
			warnings.push_back(problem);
		}
	}
	return warnings;
}

// ---- MDCicloCores ----

void MDCicloCores::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(8);
	queue_redraw();
}

void MDCicloCores::set_modo(Modo p_modo) {
	modo = p_modo;
	notify_property_list_changed();
	queue_redraw();
}

void MDCicloCores::set_paleta(int p_paleta) {
	paleta = CLAMP(p_paleta, 0, 3);
	queue_redraw();
}

void MDCicloCores::set_primeira(int p_primeira) {
	primeira = CLAMP(p_primeira, 0, 15);
	update_configuration_warnings();
	queue_redraw();
}

void MDCicloCores::set_quantidade(int p_quantidade) {
	quantidade = CLAMP(p_quantidade, 1, 16);
	update_configuration_warnings();
	queue_redraw();
}

void MDCicloCores::set_cor_piscar(const Color &p_cor) {
	cor_piscar = Color(p_cor.r, p_cor.g, p_cor.b);
	queue_redraw();
}

#ifdef TOOLS_ENABLED
void MDCicloCores::_edit_set_rect(const Rect2 &p_rect) {
	set_position(get_position() + p_rect.position.round());
	set_tamanho(Vector2i(p_rect.size.round()));
}

Dictionary MDCicloCores::_edit_get_state() const {
	Dictionary state = Node2D::_edit_get_state();
	state["tamanho"] = tamanho; // Sem ele, redimensionar somaria a mudança a cada movimento (como na MDNota).
	return state;
}

void MDCicloCores::_edit_set_state(const Dictionary &p_state) {
	Node2D::_edit_set_state(p_state);
	if (p_state.has("tamanho")) {
		set_tamanho(p_state["tamanho"]);
	}
}
#endif

void MDCicloCores::_notification(int p_what) {
	if (p_what != NOTIFICATION_DRAW || !Engine::get_singleton()->is_editor_hint()) {
		return;
	}
	// Área tracejada em laranja (ciclo), verde (vai e volta) ou na cor do piscar.
	const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
	const Color c = modo == MODO_PISCAR ? cor_piscar : (modo == MODO_CICLO ? Color(1.0, 0.6, 0.2) : Color(0.5, 1.0, 0.4));
	draw_rect(area, Color(c, 0.08));
	const Vector2 corners[5] = { area.position, Vector2(area.get_end().x, area.position.y), area.get_end(), Vector2(area.position.x, area.get_end().y), area.position };
	for (int k = 0; k < 4; k++) {
		draw_dashed_line(corners[k], corners[k + 1], Color(c, 0.9), 1.0, 4.0);
	}
}

PackedStringArray MDCicloCores::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (primeira + quantidade > 16) {
		warnings.push_back(vformat(U("As cores %d a %d passam da cor 15 da paleta."), primeira, primeira + quantidade - 1));
	}
	if (primeira == 0) {
		warnings.push_back(U("A cor 0 é a transparência (e a cor de fundo na PAL0): comece na cor 1."));
	}
	if (modo != MODO_PISCAR && cores_usadas() < 2) {
		warnings.push_back(U("Para girar, escolha pelo menos 2 cores (uma só serve para piscar)."));
	}
	return warnings;
}

void MDCicloCores::_validate_property(PropertyInfo &p_property) const {
	static const char *const KEPT[] = { "position", "visible", nullptr };
	RetroMD::hide_unsupported(this, p_property, KEPT);
	const bool piscar = modo == MODO_PISCAR;
	if ((piscar && (p_property.name == "intervalo" || p_property.name == "para_tras")) ||
			(!piscar && (p_property.name == "cor_piscar" || p_property.name == "quadros_aceso" || p_property.name == "quadros_apagado" || p_property.name == "piscadas" || p_property.name == "variacao"))) {
		p_property.usage = PROPERTY_USAGE_NO_EDITOR;
	}
}

void MDCicloCores::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDCicloCores::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDCicloCores::get_tamanho);
	ClassDB::bind_method(D_METHOD("set_modo", "modo"), &MDCicloCores::set_modo);
	ClassDB::bind_method(D_METHOD("get_modo"), &MDCicloCores::get_modo);
	ClassDB::bind_method(D_METHOD("set_paleta", "paleta"), &MDCicloCores::set_paleta);
	ClassDB::bind_method(D_METHOD("get_paleta"), &MDCicloCores::get_paleta);
	ClassDB::bind_method(D_METHOD("set_primeira", "cor"), &MDCicloCores::set_primeira);
	ClassDB::bind_method(D_METHOD("get_primeira"), &MDCicloCores::get_primeira);
	ClassDB::bind_method(D_METHOD("set_quantidade", "quantidade"), &MDCicloCores::set_quantidade);
	ClassDB::bind_method(D_METHOD("get_quantidade"), &MDCicloCores::get_quantidade);
	ClassDB::bind_method(D_METHOD("set_intervalo", "quadros"), &MDCicloCores::set_intervalo);
	ClassDB::bind_method(D_METHOD("get_intervalo"), &MDCicloCores::get_intervalo);
	ClassDB::bind_method(D_METHOD("set_para_tras", "para_tras"), &MDCicloCores::set_para_tras);
	ClassDB::bind_method(D_METHOD("get_para_tras"), &MDCicloCores::get_para_tras);
	ClassDB::bind_method(D_METHOD("set_cor_piscar", "cor"), &MDCicloCores::set_cor_piscar);
	ClassDB::bind_method(D_METHOD("get_cor_piscar"), &MDCicloCores::get_cor_piscar);
	ClassDB::bind_method(D_METHOD("set_quadros_aceso", "quadros"), &MDCicloCores::set_quadros_aceso);
	ClassDB::bind_method(D_METHOD("get_quadros_aceso"), &MDCicloCores::get_quadros_aceso);
	ClassDB::bind_method(D_METHOD("set_quadros_apagado", "quadros"), &MDCicloCores::set_quadros_apagado);
	ClassDB::bind_method(D_METHOD("get_quadros_apagado"), &MDCicloCores::get_quadros_apagado);
	ClassDB::bind_method(D_METHOD("set_piscadas", "piscadas"), &MDCicloCores::set_piscadas);
	ClassDB::bind_method(D_METHOD("get_piscadas"), &MDCicloCores::get_piscadas);
	ClassDB::bind_method(D_METHOD("set_variacao", "variacao"), &MDCicloCores::set_variacao);
	ClassDB::bind_method(D_METHOD("get_variacao"), &MDCicloCores::get_variacao);
	ClassDB::bind_method(D_METHOD("set_atraso", "quadros"), &MDCicloCores::set_atraso);
	ClassDB::bind_method(D_METHOD("get_atraso"), &MDCicloCores::get_atraso);
	ClassDB::bind_method(D_METHOD("set_so_na_area", "so"), &MDCicloCores::set_so_na_area);
	ClassDB::bind_method(D_METHOD("get_so_na_area"), &MDCicloCores::get_so_na_area);
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "modo", PROPERTY_HINT_ENUM, U("Ciclo,Vai e volta,Piscar")), "set_modo", "get_modo");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta", PROPERTY_HINT_RANGE, "0,3,1"), "set_paleta", "get_paleta");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "primeira", PROPERTY_HINT_RANGE, "0,15,1"), "set_primeira", "get_primeira");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "quantidade", PROPERTY_HINT_RANGE, "1,16,1"), "set_quantidade", "get_quantidade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "intervalo", PROPERTY_HINT_RANGE, "1,255,1,suffix:quadros"), "set_intervalo", "get_intervalo");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "para_tras"), "set_para_tras", "get_para_tras");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor_piscar", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor_piscar", "get_cor_piscar");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "quadros_aceso", PROPERTY_HINT_RANGE, "1,255,1,suffix:quadros"), "set_quadros_aceso", "get_quadros_aceso");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "quadros_apagado", PROPERTY_HINT_RANGE, "1,3600,1,suffix:quadros"), "set_quadros_apagado", "get_quadros_apagado");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "piscadas", PROPERTY_HINT_RANGE, "1,8,1"), "set_piscadas", "get_piscadas");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "variacao", PROPERTY_HINT_RANGE, "0,100,1,suffix:%"), "set_variacao", "get_variacao");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "atraso", PROPERTY_HINT_RANGE, "0,3600,1,suffix:quadros"), "set_atraso", "get_atraso");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "so_na_area"), "set_so_na_area", "get_so_na_area");
	BIND_ENUM_CONSTANT(MODO_CICLO);
	BIND_ENUM_CONSTANT(MODO_VAI_E_VOLTA);
	BIND_ENUM_CONSTANT(MODO_PISCAR);
}

Vector<MDEfeitoPaleta> MDCicloCores::efeitos() const {
	MDEfeitoPaleta e;
	e.nome = get_name();
	e.paleta = paleta;
	e.primeira = primeira;
	e.quantidade = cores_usadas();
	e.intervalo = intervalo;
	e.sentido = para_tras ? -1 : 1;
	e.modo = modo;
	e.cor = cor_piscar;
	e.aceso = quadros_aceso;
	e.piscadas = piscadas;
	e.variacao = variacao;
	e.apagado = quadros_apagado;
	e.atraso = atraso;
	e.so_na_area = so_na_area;
	e.area = is_inside_tree() ? get_global_transform().xform(Rect2(Vector2(), Vector2(tamanho))) : Rect2(get_position(), Vector2(tamanho));
	Vector<MDEfeitoPaleta> out;
	out.push_back(e);
	return out;
}

// ---- MDCachoeira ----

void MDCachoeira::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(8);
	queue_redraw();
}

void MDCachoeira::set_paleta(int p_paleta) {
	paleta = CLAMP(p_paleta, 0, 3);
	queue_redraw();
}

void MDCachoeira::set_primeira(int p_primeira) {
	primeira = CLAMP(p_primeira, 0, 15);
	update_configuration_warnings();
}

void MDCachoeira::set_quantidade(int p_quantidade) {
	quantidade = CLAMP(p_quantidade, 1, 16);
	update_configuration_warnings();
}

void MDCachoeira::set_sentido(Sentido p_sentido) {
	sentido = p_sentido;
	queue_redraw();
}

void MDCachoeira::set_espuma(bool p_espuma) {
	espuma = p_espuma;
	notify_property_list_changed();
	update_configuration_warnings();
	queue_redraw();
}

void MDCachoeira::set_espuma_primeira(int p_primeira) {
	espuma_primeira = CLAMP(p_primeira, 0, 15);
	update_configuration_warnings();
}

void MDCachoeira::set_espuma_quantidade(int p_quantidade) {
	espuma_quantidade = CLAMP(p_quantidade, 1, 16);
	update_configuration_warnings();
}

Vector<MDEfeitoPaleta> MDCachoeira::efeitos() const {
	Vector<MDEfeitoPaleta> out;
	MDEfeitoPaleta agua;
	agua.nome = String(get_name()) + U(" (água)");
	agua.paleta = paleta;
	agua.primeira = primeira;
	agua.quantidade = MIN(quantidade, 16 - primeira);
	agua.intervalo = intervalo;
	// As faixas vão da primeira cor (em cima) à última (embaixo): andar para a frente leva o desenho para baixo.
	agua.sentido = sentido == SENTIDO_DESCENDO ? 1 : -1;
	agua.modo = MDCicloCores::MODO_CICLO;
	agua.so_na_area = so_na_area;
	agua.area = is_inside_tree() ? get_global_transform().xform(Rect2(Vector2(), Vector2(tamanho))) : Rect2(get_position(), Vector2(tamanho));
	out.push_back(agua);
	if (espuma) {
		MDEfeitoPaleta e;
		e.nome = String(get_name()) + " (espuma)";
		e.paleta = paleta;
		e.primeira = espuma_primeira;
		e.quantidade = MIN(espuma_quantidade, 16 - espuma_primeira);
		e.intervalo = espuma_intervalo;
		e.modo = MDCicloCores::MODO_VAI_E_VOLTA;
		e.so_na_area = so_na_area;
		e.area = agua.area;
		out.push_back(e);
	}
	return out;
}

#ifdef TOOLS_ENABLED
void MDCachoeira::_edit_set_rect(const Rect2 &p_rect) {
	set_position(get_position() + p_rect.position.round());
	set_tamanho(Vector2i(p_rect.size.round()));
}

Dictionary MDCachoeira::_edit_get_state() const {
	Dictionary state = Node2D::_edit_get_state();
	state["tamanho"] = tamanho; // Como na MDNota: sem ele, redimensionar somaria a mudança a cada movimento.
	return state;
}

void MDCachoeira::_edit_set_state(const Dictionary &p_state) {
	Node2D::_edit_set_state(p_state);
	if (p_state.has("tamanho")) {
		set_tamanho(p_state["tamanho"]);
	}
}
#endif

void MDCachoeira::_notification(int p_what) {
	if (p_what != NOTIFICATION_DRAW || !Engine::get_singleton()->is_editor_hint()) {
		return;
	}
	// Área azul tracejada com setas no sentido da água e, com espuma, uma faixa clara na base.
	const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
	const Color c(0.35, 0.75, 1.0);
	draw_rect(area, Color(c, 0.08));
	const Vector2 corners[5] = { area.position, Vector2(area.get_end().x, area.position.y), area.get_end(), Vector2(area.position.x, area.get_end().y), area.position };
	for (int k = 0; k < 4; k++) {
		draw_dashed_line(corners[k], corners[k + 1], Color(c, 0.9), 1.0, 4.0);
	}
	const float dir = sentido == SENTIDO_DESCENDO ? 1.0 : -1.0;
	const float x = area.get_center().x;
	for (float y = 12; y < tamanho.y - 8; y += 24) {
		const Vector2 tip(x, sentido == SENTIDO_DESCENDO ? y + 6 : y - 6);
		draw_line(Vector2(x - 4, tip.y - 4 * dir), tip, Color(c, 0.7), 1.5);
		draw_line(Vector2(x + 4, tip.y - 4 * dir), tip, Color(c, 0.7), 1.5);
	}
	if (espuma) {
		draw_rect(Rect2(0, tamanho.y - 4, tamanho.x, 4), Color(1, 1, 1, 0.35));
	}
}

PackedStringArray MDCachoeira::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (primeira + quantidade > 16) {
		warnings.push_back(vformat(U("As cores da água (%d a %d) passam da cor 15 da paleta."), primeira, primeira + quantidade - 1));
	}
	if (primeira == 0 || (espuma && espuma_primeira == 0)) {
		warnings.push_back(U("A cor 0 é a transparência (e a cor de fundo na PAL0): comece na cor 1."));
	}
	if (quantidade < 2) {
		warnings.push_back(U("A água precisa de pelo menos 2 cores para correr (o ideal é de 3 a 6)."));
	}
	if (espuma) {
		if (espuma_primeira + espuma_quantidade > 16) {
			warnings.push_back(vformat(U("As cores da espuma (%d a %d) passam da cor 15 da paleta."), espuma_primeira, espuma_primeira + espuma_quantidade - 1));
		}
		if (espuma_primeira < primeira + quantidade && primeira < espuma_primeira + espuma_quantidade) {
			warnings.push_back(U("As cores da espuma se misturam com as da água: escolha outro trecho para a espuma."));
		}
	}
	return warnings;
}

void MDCachoeira::_validate_property(PropertyInfo &p_property) const {
	static const char *const KEPT[] = { "position", "visible", nullptr };
	RetroMD::hide_unsupported(this, p_property, KEPT);
	if (!espuma && p_property.name.begins_with("espuma_")) {
		p_property.usage = PROPERTY_USAGE_NO_EDITOR;
	}
}

void MDCachoeira::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDCachoeira::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDCachoeira::get_tamanho);
	ClassDB::bind_method(D_METHOD("set_paleta", "paleta"), &MDCachoeira::set_paleta);
	ClassDB::bind_method(D_METHOD("get_paleta"), &MDCachoeira::get_paleta);
	ClassDB::bind_method(D_METHOD("set_primeira", "cor"), &MDCachoeira::set_primeira);
	ClassDB::bind_method(D_METHOD("get_primeira"), &MDCachoeira::get_primeira);
	ClassDB::bind_method(D_METHOD("set_quantidade", "quantidade"), &MDCachoeira::set_quantidade);
	ClassDB::bind_method(D_METHOD("get_quantidade"), &MDCachoeira::get_quantidade);
	ClassDB::bind_method(D_METHOD("set_intervalo", "quadros"), &MDCachoeira::set_intervalo);
	ClassDB::bind_method(D_METHOD("get_intervalo"), &MDCachoeira::get_intervalo);
	ClassDB::bind_method(D_METHOD("set_sentido", "sentido"), &MDCachoeira::set_sentido);
	ClassDB::bind_method(D_METHOD("get_sentido"), &MDCachoeira::get_sentido);
	ClassDB::bind_method(D_METHOD("set_espuma", "espuma"), &MDCachoeira::set_espuma);
	ClassDB::bind_method(D_METHOD("get_espuma"), &MDCachoeira::get_espuma);
	ClassDB::bind_method(D_METHOD("set_espuma_primeira", "cor"), &MDCachoeira::set_espuma_primeira);
	ClassDB::bind_method(D_METHOD("get_espuma_primeira"), &MDCachoeira::get_espuma_primeira);
	ClassDB::bind_method(D_METHOD("set_espuma_quantidade", "quantidade"), &MDCachoeira::set_espuma_quantidade);
	ClassDB::bind_method(D_METHOD("get_espuma_quantidade"), &MDCachoeira::get_espuma_quantidade);
	ClassDB::bind_method(D_METHOD("set_espuma_intervalo", "quadros"), &MDCachoeira::set_espuma_intervalo);
	ClassDB::bind_method(D_METHOD("get_espuma_intervalo"), &MDCachoeira::get_espuma_intervalo);
	ClassDB::bind_method(D_METHOD("set_so_na_area", "so"), &MDCachoeira::set_so_na_area);
	ClassDB::bind_method(D_METHOD("get_so_na_area"), &MDCachoeira::get_so_na_area);
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta", PROPERTY_HINT_RANGE, "0,3,1"), "set_paleta", "get_paleta");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "so_na_area"), "set_so_na_area", "get_so_na_area");
	ADD_GROUP(U("Água"), "");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "primeira", PROPERTY_HINT_RANGE, "0,15,1"), "set_primeira", "get_primeira");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "quantidade", PROPERTY_HINT_RANGE, "1,16,1"), "set_quantidade", "get_quantidade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "intervalo", PROPERTY_HINT_RANGE, "1,255,1,suffix:quadros"), "set_intervalo", "get_intervalo");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "sentido", PROPERTY_HINT_ENUM, "Descendo,Subindo"), "set_sentido", "get_sentido");
	ADD_GROUP("Espuma", "");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "espuma"), "set_espuma", "get_espuma");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "espuma_primeira", PROPERTY_HINT_RANGE, "0,15,1"), "set_espuma_primeira", "get_espuma_primeira");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "espuma_quantidade", PROPERTY_HINT_RANGE, "1,16,1"), "set_espuma_quantidade", "get_espuma_quantidade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "espuma_intervalo", PROPERTY_HINT_RANGE, "1,255,1,suffix:quadros"), "set_espuma_intervalo", "get_espuma_intervalo");
	BIND_ENUM_CONSTANT(SENTIDO_DESCENDO);
	BIND_ENUM_CONSTANT(SENTIDO_SUBINDO);
}

// ---- MDAnimacaoCenario ----

// A mesma regra do runtime (anim_cenario.c, anim_cenario_atualizar): ativar começa a sequência do primeiro passo;
// com ativação, os ciclos se repetem; sem ela, termina o ciclo atual e roda mais "ciclos_apos" ciclos.
int MDAnimacaoCenario::Gatilho::quadro(const PackedInt32Array &p_passos, int p_intervalo, int p_ciclos_apos, int p_repouso, bool p_sensor) {
	const bool sustenta = p_sensor || sustenta_codigo;
	if (estado == REPOUSO) {
		if (!sustenta && pedidos == 0) {
			return p_repouso;
		}
		estado = ATIVO;
		passo = 0;
		espera = p_intervalo;
		restantes = MAX(sustenta ? p_ciclos_apos : 0, pedidos > 0 ? pedidos - 1 : 0);
		pedidos = 0;
		return p_passos[0];
	}
	if (sustenta) {
		restantes = MAX(restantes, p_ciclos_apos);
	}
	if (pedidos > 0) {
		restantes = MAX(restantes, pedidos);
		pedidos = 0;
	}
	if (--espera > 0) {
		return p_passos[passo];
	}
	espera = p_intervalo;
	if (++passo >= p_passos.size()) {
		passo = 0;
		if (!sustenta) {
			if (restantes == 0) {
				estado = REPOUSO;
				return p_repouso;
			}
			restantes--;
		}
	}
	return p_passos[passo];
}

void MDAnimacaoCenario::set_mapa(const NodePath &p_mapa) {
	mapa = p_mapa;
	update_configuration_warnings();
}

void MDAnimacaoCenario::set_quadros(const Ref<Texture2D> &p_quadros) {
	quadros = p_quadros;
	// Tira de uma linha só: a altura da área acompanha a da tira.
	if (quadros.is_valid() && quadros->get_height() >= 8 && quadros->get_height() % 8 == 0 && quadros->get_height() != tamanho.y) {
		set_tamanho(Vector2i(tamanho.x, quadros->get_height()));
	}
	update_configuration_warnings();
	queue_redraw();
}

void MDAnimacaoCenario::set_tamanho(const Vector2i &p_tamanho) {
	const Vector2i novo = Vector2i(MAX(8, p_tamanho.x / 8 * 8), MAX(8, p_tamanho.y / 8 * 8));
	// O sensor acompanha a área enquanto for igual a ela (o "inicialmente igual à área").
	if (area_ativacao == Rect2i(Vector2i(), tamanho)) {
		area_ativacao = Rect2i(Vector2i(), novo);
	}
	tamanho = novo;
	update_configuration_warnings();
	queue_redraw();
}

void MDAnimacaoCenario::set_intervalo(int p_intervalo) {
	intervalo = CLAMP(p_intervalo, 1, 255);
	queue_redraw();
}

void MDAnimacaoCenario::set_sequencia(const PackedInt32Array &p_sequencia) {
	sequencia = p_sequencia;
	if (sequencia.size() > 255) {
		sequencia.resize(255);
	}
	update_configuration_warnings();
	queue_redraw();
}

void MDAnimacaoCenario::set_fase(int p_fase) {
	fase = CLAMP(p_fase, 0, 65535);
	queue_redraw();
}

void MDAnimacaoCenario::set_ativacao(Ativacao p_ativacao) {
	ativacao = p_ativacao;
	simular_reiniciar();
	notify_property_list_changed();
	update_configuration_warnings();
	queue_redraw();
}

void MDAnimacaoCenario::set_area_ativacao(const Rect2i &p_area) {
	area_ativacao = Rect2i(p_area.position, p_area.size.maxi(1));
	update_configuration_warnings();
	queue_redraw();
}

void MDAnimacaoCenario::set_distancia_ativacao(int p_distancia) {
	distancia_ativacao = CLAMP(p_distancia, 0, 512);
	queue_redraw();
}

void MDAnimacaoCenario::set_alvos(Alvos p_alvos) {
	alvos = p_alvos;
	notify_property_list_changed();
	update_configuration_warnings();
}

void MDAnimacaoCenario::set_grupo_ativador(const StringName &p_grupo) {
	grupo_ativador = p_grupo;
	update_configuration_warnings();
}

void MDAnimacaoCenario::set_exigir_movimento(bool p_exigir) {
	exigir_movimento = p_exigir;
	notify_property_list_changed();
}

void MDAnimacaoCenario::set_velocidade_minima(int p_velocidade) {
	velocidade_minima = CLAMP(p_velocidade, 0, 3000);
}

void MDAnimacaoCenario::set_ciclos_apos_sair(int p_ciclos) {
	ciclos_apos_sair = CLAMP(p_ciclos, 0, 255);
}

void MDAnimacaoCenario::set_quadro_repouso(int p_quadro) {
	quadro_repouso = CLAMP(p_quadro, 0, 255);
	update_configuration_warnings();
	queue_redraw();
}

Rect2i MDAnimacaoCenario::sensor_efetivo() const {
	if (ativacao == ATIVACAO_PROXIMIDADE) {
		return area_ativacao.grow(distancia_ativacao);
	}
	return area_ativacao;
}

void MDAnimacaoCenario::simular_toque() {
	simula_toques++;
}

void MDAnimacaoCenario::simular_segurar(bool p_segurar) {
	simula_segurar = p_segurar;
}

void MDAnimacaoCenario::simular_reiniciar() {
	previa_gatilho = Gatilho();
	previa_quadro = -1;
	simula_toques = 0;
	simula_segurar = false;
}

int MDAnimacaoCenario::total_quadros() const {
	if (quadros.is_null() || tamanho.x <= 0) {
		return 0;
	}
	return quadros->get_width() / tamanho.x;
}

PackedInt32Array MDAnimacaoCenario::passos() const {
	if (!sequencia.is_empty()) {
		return sequencia;
	}
	PackedInt32Array out;
	for (int i = 0; i < MAX(1, total_quadros()); i++) {
		out.push_back(i);
	}
	return out;
}

// Como o jogo: o passo muda a cada "intervalo" quadros de vídeo, começando "fase" quadros adiantado.
int MDAnimacaoCenario::quadro_no_tempo(int64_t p_quadros_video) const {
	const PackedInt32Array p = passos();
	const int64_t passo = ((p_quadros_video + fase) / intervalo) % p.size();
	return p[int(passo)];
}

MDMapa *MDAnimacaoCenario::mapa_node() const {
	if (!mapa.is_empty()) {
		return Object::cast_to<MDMapa>(get_node_or_null(mapa));
	}
	// Sem mapa escolhido: o último MDMapa irmão (o de cima) que tem tiles embaixo da área.
	Node *parent = get_parent();
	if (!parent) {
		return nullptr;
	}
	MDMapa *found = nullptr;
	for (int i = 0; i < parent->get_child_count(); i++) {
		MDMapa *m = Object::cast_to<MDMapa>(parent->get_child(i));
		if (!m || m->get_tile_set().is_null()) {
			continue;
		}
		const Vector2i tile = m->get_tile_set()->get_tile_size();
		const Rect2i used = m->get_used_rect();
		const Rect2 rect(m->get_position() + Vector2(used.position * tile), Vector2(used.size * tile));
		if (rect.intersects(Rect2(get_position(), Vector2(tamanho)))) {
			found = m;
		}
	}
	return found;
}

#ifdef TOOLS_ENABLED
void MDAnimacaoCenario::_edit_set_rect(const Rect2 &p_rect) {
	set_position(get_position() + p_rect.position.round());
	set_tamanho(Vector2i(p_rect.size.round()));
}

Dictionary MDAnimacaoCenario::_edit_get_state() const {
	Dictionary state = Node2D::_edit_get_state();
	state["tamanho"] = tamanho; // Como na MDNota: sem ele, redimensionar somaria a mudança a cada movimento.
	state["area_ativacao"] = area_ativacao;
	return state;
}

void MDAnimacaoCenario::_edit_set_state(const Dictionary &p_state) {
	Node2D::_edit_set_state(p_state);
	if (p_state.has("tamanho")) {
		set_tamanho(p_state["tamanho"]);
	}
	if (p_state.has("area_ativacao")) {
		set_area_ativacao(p_state["area_ativacao"]);
	}
}
#endif

void MDAnimacaoCenario::_notification(int p_what) {
	if (!Engine::get_singleton()->is_editor_hint()) {
		return;
	}
	switch (p_what) {
		case NOTIFICATION_ENTER_TREE: {
			set_process_internal(true);
		} break;
		case NOTIFICATION_INTERNAL_PROCESS: {
			if (!MDSprite::is_previa_ligada()) {
				if (previa_tempo >= 0) {
					previa_tempo = -1;
					simular_reiniciar();
					queue_redraw();
				}
				return;
			}
			if (previa_tempo < 0) {
				previa_tempo = 0;
				previa_gatilho = Gatilho();
				queue_redraw();
			}
			const double antes = previa_tempo;
			previa_tempo += get_process_delta_time() * 60.0;
			if (!tem_gatilho()) {
				if (quadro_no_tempo(int64_t(previa_tempo)) != quadro_no_tempo(int64_t(antes))) {
					queue_redraw();
				}
				return;
			}
			// Com gatilho: um passo da máquina de estados por quadro de vídeo, como o jogo.
			const PackedInt32Array p = passos();
			for (int64_t t = int64_t(antes); t < int64_t(previa_tempo); t++) {
				const bool sensor = simula_segurar || simula_toques > 0;
				if (simula_toques > 0) {
					simula_toques--;
				}
				const int q = previa_gatilho.quadro(p, intervalo, ciclos_apos_sair, quadro_repouso, sensor);
				if (q != previa_quadro) {
					previa_quadro = q;
					queue_redraw();
				}
			}
		} break;
		case NOTIFICATION_DRAW: {
			const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
			const int total = total_quadros();
			if (total > 0) {
				int quadro = tem_gatilho() ? quadro_repouso : passos()[0];
				if (previa_tempo >= 0) {
					quadro = tem_gatilho() ? (previa_quadro >= 0 ? previa_quadro : quadro_repouso) : quadro_no_tempo(int64_t(previa_tempo));
				}
				if (quadro >= 0 && quadro < total) {
					draw_texture_rect_region(quadros, area, Rect2(quadro * tamanho.x, 0, tamanho.x, MIN(tamanho.y, quadros->get_height())));
				}
			}
			// Área animada: verde tracejada.
			const Color c(0.45, 1.0, 0.5);
			const Vector2 cantos[5] = { area.position, Vector2(area.get_end().x, area.position.y), area.get_end(), Vector2(area.position.x, area.get_end().y), area.position };
			for (int k = 0; k < 4; k++) {
				draw_dashed_line(cantos[k], cantos[k + 1], Color(c, 0.85), 1.0, 3.0);
			}
			// O sensor (laranja) aparece com o node selecionado, pelo plugin da vista 2D (RetroAnimSensorPlugin).
		} break;
	}
}

PackedStringArray MDAnimacaoCenario::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (quadros.is_null()) {
		warnings.push_back(U("Escolha a tira de quadros (PNG com os quadros lado a lado, cada um do tamanho da área)."));
		return warnings;
	}
	if (quadros->get_width() % tamanho.x != 0 || quadros->get_height() != tamanho.y) {
		warnings.push_back(vformat(U("A tira tem %d×%d px: ela precisa ter a altura da área (%d px) e uma largura múltipla da largura da área (%d px)."), quadros->get_width(), quadros->get_height(), tamanho.y, tamanho.x));
	}
	if (total_quadros() < 2) {
		warnings.push_back(U("A tira precisa de pelo menos 2 quadros para animar."));
	}
	for (int i = 0; i < sequencia.size(); i++) {
		if (sequencia[i] < 0 || sequencia[i] >= total_quadros()) {
			warnings.push_back(vformat(U("A sequência pede o quadro %d, mas a tira tem os quadros 0 a %d."), sequencia[i], total_quadros() - 1));
			break;
		}
	}
	if (tem_gatilho() && quadro_repouso >= total_quadros()) {
		warnings.push_back(vformat(U("quadro_repouso é %d, mas a tira tem os quadros 0 a %d."), quadro_repouso, total_quadros() - 1));
	}
	if ((ativacao == ATIVACAO_PROXIMIDADE || ativacao == ATIVACAO_CONTATO) && alvos == ALVOS_GRUPO && String(grupo_ativador).strip_edges().is_empty()) {
		warnings.push_back(U("Alvos em \"Grupo personalizado\": escreva o nome do grupo em grupo_ativador (o mesmo da aba Grupos dos atores)."));
	}
	const Vector2 pos = get_position();
	if (Math::fmod(pos.x, 8.0f) != 0 || Math::fmod(pos.y, 8.0f) != 0) {
		warnings.push_back(U("A posição precisa estar na grade de 8 px (as células do mapa)."));
	}
	if (is_inside_tree() && !mapa_node()) {
		warnings.push_back(U("Nenhum MDMapa embaixo da área: escolha o mapa em \"mapa\" ou ponha a área sobre um."));
	}
	return warnings;
}

void MDAnimacaoCenario::_validate_property(PropertyInfo &p_property) const {
	static const char *const KEPT[] = { "position", "visible", nullptr };
	RetroMD::hide_unsupported(this, p_property, KEPT);
	const String name = p_property.name;
	const bool sensor = ativacao == ATIVACAO_PROXIMIDADE || ativacao == ATIVACAO_CONTATO;
	bool hide = false;
	if (name == "fase") {
		hide = tem_gatilho(); // Com gatilho, cada ativação começa do primeiro passo.
	} else if (name == "area_ativacao" || name == "alvos" || name == "exigir_movimento") {
		hide = !sensor;
	} else if (name == "distancia_ativacao") {
		hide = ativacao != ATIVACAO_PROXIMIDADE;
	} else if (name == "grupo_ativador") {
		hide = !sensor || alvos != ALVOS_GRUPO;
	} else if (name == "velocidade_minima") {
		hide = !sensor || !exigir_movimento;
	} else if (name == "ciclos_apos_sair" || name == "quadro_repouso") {
		hide = !tem_gatilho();
	}
	if (hide) {
		p_property.usage = PROPERTY_USAGE_NO_EDITOR;
	}
}

void MDAnimacaoCenario::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_mapa", "mapa"), &MDAnimacaoCenario::set_mapa);
	ClassDB::bind_method(D_METHOD("get_mapa"), &MDAnimacaoCenario::get_mapa);
	ClassDB::bind_method(D_METHOD("set_quadros", "quadros"), &MDAnimacaoCenario::set_quadros);
	ClassDB::bind_method(D_METHOD("get_quadros"), &MDAnimacaoCenario::get_quadros);
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDAnimacaoCenario::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDAnimacaoCenario::get_tamanho);
	ClassDB::bind_method(D_METHOD("set_intervalo", "quadros"), &MDAnimacaoCenario::set_intervalo);
	ClassDB::bind_method(D_METHOD("get_intervalo"), &MDAnimacaoCenario::get_intervalo);
	ClassDB::bind_method(D_METHOD("set_sequencia", "sequencia"), &MDAnimacaoCenario::set_sequencia);
	ClassDB::bind_method(D_METHOD("get_sequencia"), &MDAnimacaoCenario::get_sequencia);
	ClassDB::bind_method(D_METHOD("set_fase", "quadros"), &MDAnimacaoCenario::set_fase);
	ClassDB::bind_method(D_METHOD("get_fase"), &MDAnimacaoCenario::get_fase);
	ClassDB::bind_method(D_METHOD("set_ativacao", "ativacao"), &MDAnimacaoCenario::set_ativacao);
	ClassDB::bind_method(D_METHOD("get_ativacao"), &MDAnimacaoCenario::get_ativacao);
	ClassDB::bind_method(D_METHOD("set_area_ativacao", "area"), &MDAnimacaoCenario::set_area_ativacao);
	ClassDB::bind_method(D_METHOD("get_area_ativacao"), &MDAnimacaoCenario::get_area_ativacao);
	ClassDB::bind_method(D_METHOD("set_distancia_ativacao", "pixels"), &MDAnimacaoCenario::set_distancia_ativacao);
	ClassDB::bind_method(D_METHOD("get_distancia_ativacao"), &MDAnimacaoCenario::get_distancia_ativacao);
	ClassDB::bind_method(D_METHOD("set_alvos", "alvos"), &MDAnimacaoCenario::set_alvos);
	ClassDB::bind_method(D_METHOD("get_alvos"), &MDAnimacaoCenario::get_alvos);
	ClassDB::bind_method(D_METHOD("set_grupo_ativador", "grupo"), &MDAnimacaoCenario::set_grupo_ativador);
	ClassDB::bind_method(D_METHOD("get_grupo_ativador"), &MDAnimacaoCenario::get_grupo_ativador);
	ClassDB::bind_method(D_METHOD("set_exigir_movimento", "exigir"), &MDAnimacaoCenario::set_exigir_movimento);
	ClassDB::bind_method(D_METHOD("get_exigir_movimento"), &MDAnimacaoCenario::get_exigir_movimento);
	ClassDB::bind_method(D_METHOD("set_velocidade_minima", "pixels_por_segundo"), &MDAnimacaoCenario::set_velocidade_minima);
	ClassDB::bind_method(D_METHOD("get_velocidade_minima"), &MDAnimacaoCenario::get_velocidade_minima);
	ClassDB::bind_method(D_METHOD("set_ciclos_apos_sair", "ciclos"), &MDAnimacaoCenario::set_ciclos_apos_sair);
	ClassDB::bind_method(D_METHOD("get_ciclos_apos_sair"), &MDAnimacaoCenario::get_ciclos_apos_sair);
	ClassDB::bind_method(D_METHOD("set_quadro_repouso", "quadro"), &MDAnimacaoCenario::set_quadro_repouso);
	ClassDB::bind_method(D_METHOD("get_quadro_repouso"), &MDAnimacaoCenario::get_quadro_repouso);
	ClassDB::bind_method(D_METHOD("total_quadros"), &MDAnimacaoCenario::total_quadros);
	ADD_PROPERTY(PropertyInfo(Variant::NODE_PATH, "mapa", PROPERTY_HINT_NODE_PATH_VALID_TYPES, "MDMapa"), "set_mapa", "get_mapa");
	ADD_PROPERTY(PropertyInfo(Variant::OBJECT, "quadros", PROPERTY_HINT_RESOURCE_TYPE, "Texture2D"), "set_quadros", "get_quadros");
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "intervalo", PROPERTY_HINT_RANGE, "1,255,1,suffix:quadros"), "set_intervalo", "get_intervalo");
	ADD_PROPERTY(PropertyInfo(Variant::PACKED_INT32_ARRAY, "sequencia"), "set_sequencia", "get_sequencia");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "fase", PROPERTY_HINT_RANGE, "0,1000,1,or_greater,suffix:quadros"), "set_fase", "get_fase");
	ADD_GROUP(U("Ativação"), "");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "ativacao", PROPERTY_HINT_ENUM, U("Sempre,Proximidade,Contato,Por código")), "set_ativacao", "get_ativacao");
	ADD_PROPERTY(PropertyInfo(Variant::RECT2I, "area_ativacao", PROPERTY_HINT_NONE, "suffix:px"), "set_area_ativacao", "get_area_ativacao");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "distancia_ativacao", PROPERTY_HINT_RANGE, "0,512,1,suffix:px"), "set_distancia_ativacao", "get_distancia_ativacao");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "alvos", PROPERTY_HINT_ENUM, "Jogador,Inimigos,Grupo personalizado"), "set_alvos", "get_alvos");
	ADD_PROPERTY(PropertyInfo(Variant::STRING_NAME, "grupo_ativador"), "set_grupo_ativador", "get_grupo_ativador");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "exigir_movimento"), "set_exigir_movimento", "get_exigir_movimento");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade_minima", PROPERTY_HINT_RANGE, "0,3000,1,suffix:px/s"), "set_velocidade_minima", "get_velocidade_minima");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "ciclos_apos_sair", PROPERTY_HINT_RANGE, "0,255,1"), "set_ciclos_apos_sair", "get_ciclos_apos_sair");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "quadro_repouso", PROPERTY_HINT_RANGE, "0,255,1"), "set_quadro_repouso", "get_quadro_repouso");
	BIND_ENUM_CONSTANT(ATIVACAO_SEMPRE);
	BIND_ENUM_CONSTANT(ATIVACAO_PROXIMIDADE);
	BIND_ENUM_CONSTANT(ATIVACAO_CONTATO);
	BIND_ENUM_CONSTANT(ATIVACAO_CODIGO);
	BIND_ENUM_CONSTANT(ALVOS_JOGADOR);
	BIND_ENUM_CONSTANT(ALVOS_INIMIGOS);
	BIND_ENUM_CONSTANT(ALVOS_GRUPO);
}

// ---- MDParticulas ----

int MDParticulas::forma_quadros(Forma p_forma) {
	static const int quadros[] = { 1, 2, 3, 4, 2, 4, 1 };
	return quadros[CLAMP(int(p_forma), 0, 6)];
}

// Desenhos de 8×8 (centro entre os pixels 3 e 4), do nascer ao morrer.
void MDParticulas::forma_pixels(Forma p_forma, int p_quadro, uint8_t r_pixels[64]) {
	memset(r_pixels, 0, 64);
	auto ponto = [&](int x, int y) {
		if (x >= 0 && x < 8 && y >= 0 && y < 8) {
			r_pixels[y * 8 + x] = 1;
		}
	};
	auto circulo = [&](float r, bool cheio, bool pontilhado) {
		for (int y = 0; y < 8; y++) {
			for (int x = 0; x < 8; x++) {
				const float d = Vector2(x - 3.5f, y - 3.5f).length();
				const bool dentro = cheio ? d <= r : (d <= r && d > r - 1.2f);
				if (dentro && (!pontilhado || (x + y) % 2 == 0)) {
					ponto(x, y);
				}
			}
		}
	};
	switch (p_forma) {
		case FORMA_GRAO:
			ponto(3, 3);
			ponto(4, 3);
			ponto(3, 4);
			break;
		case FORMA_GOTA:
			for (int y = p_quadro == 0 ? 1 : 3; y <= 5; y++) {
				ponto(4, y);
			}
			ponto(3, 5);
			break;
		case FORMA_FAISCA: {
			const int braco = 2 - CLAMP(p_quadro, 0, 2);
			ponto(3, 3);
			for (int k = 1; k <= braco; k++) {
				ponto(3 - k, 3);
				ponto(3 + k, 3);
				ponto(3, 3 - k);
				ponto(3, 3 + k);
			}
		} break;
		case FORMA_FUMACA: {
			static const float raio[] = { 1.0f, 2.0f, 2.8f, 3.4f };
			const int q = CLAMP(p_quadro, 0, 3);
			circulo(raio[q], true, q >= 2);
		} break;
		case FORMA_ESTRELA:
			ponto(3, 3);
			if (p_quadro == 0) {
				ponto(2, 3);
				ponto(4, 3);
				ponto(3, 2);
				ponto(3, 4);
			} else {
				ponto(2, 2);
				ponto(4, 4);
				ponto(4, 2);
				ponto(2, 4);
			}
			break;
		case FORMA_EXPLOSAO: {
			const int q = CLAMP(p_quadro, 0, 3);
			if (q < 2) {
				circulo(q == 0 ? 1.2f : 2.2f, true, false);
			} else {
				circulo(q == 2 ? 3.2f : 3.6f, false, q == 3);
			}
		} break;
		case FORMA_IMAGEM:
			break;
	}
}

void MDParticulas::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(1);
	queue_redraw();
}

void MDParticulas::set_forma(Forma p_forma) {
	forma = p_forma;
	notify_property_list_changed();
	update_configuration_warnings();
	queue_redraw();
}

void MDParticulas::set_textura(const Ref<Texture2D> &p_textura) {
	textura = p_textura;
	update_configuration_warnings();
	queue_redraw();
}

void MDParticulas::set_modo(Modo p_modo) {
	modo = p_modo;
	notify_property_list_changed();
}

#ifdef TOOLS_ENABLED
void MDParticulas::_edit_set_rect(const Rect2 &p_rect) {
	set_position(get_position() + p_rect.position.round());
	set_tamanho(Vector2i(p_rect.size.round()));
}

Dictionary MDParticulas::_edit_get_state() const {
	Dictionary state = Node2D::_edit_get_state();
	state["tamanho"] = tamanho;
	return state;
}

void MDParticulas::_edit_set_state(const Dictionary &p_state) {
	Node2D::_edit_set_state(p_state);
	if (p_state.has("tamanho")) {
		set_tamanho(p_state["tamanho"]);
	}
}
#endif

// Prévia: o mesmo sorteio (xorshift de 16 bits) e as mesmas regras do particulas.c, a 60 quadros por segundo.
uint16_t MDParticulas::previa_ate(uint16_t p_n) {
	uint16_t r = previa_sorteio;
	r ^= r << 7;
	r ^= r >> 9;
	r ^= r << 8;
	previa_sorteio = r;
	return p_n ? uint16_t((uint32_t(r) * p_n) >> 16) : 0;
}

int MDParticulas::previa_espera_sorteada(int p_base) {
	const int faixa = p_base * variacao / 100;
	if (!faixa) {
		return MAX(1, p_base);
	}
	return MAX(1, p_base - faixa / 2 + previa_ate(uint16_t(faixa + 1)));
}

void MDParticulas::previa_soltar() {
	for (Previa &p : previa) {
		if (p.vida) {
			continue;
		}
		p.pos = Vector2(previa_ate(uint16_t(tamanho.x)), previa_ate(uint16_t(tamanho.y)));
		auto entre = [&](float a, float b) {
			return b <= a ? a : a + (b - a) * previa_ate(65535) / 65535.0f;
		};
		p.vel = Vector2(entre(velocidade_min.x, velocidade_max.x), entre(velocidade_min.y, velocidade_max.y)) / 60.0f;
		p.total = p.vida = MAX(1, int(Math::round(entre(vida_min, MAX(vida_min, vida_max)))));
		return;
	}
}

void MDParticulas::previa_reiniciar() {
	previa.resize(maximo);
	for (Previa &p : previa) {
		p.vida = 0;
	}
	previa_sorteio = semente ? uint16_t(semente) : uint16_t(0xACE1);
	previa_acumulado = 0;
	previa_espera = modo == MODO_CONTINUO ? previa_espera_sorteada(60 * 16 / por_segundo) : (intervalo ? previa_espera_sorteada(intervalo) : 0);
	previa_tempo = 0;
}

void MDParticulas::previa_quadro() {
	if (previa.size() != maximo) {
		previa_reiniciar();
	}
	if (ligado) {
		if (modo == MODO_CONTINUO) {
			previa_acumulado += 16;
			while (previa_acumulado >= previa_espera) {
				previa_acumulado -= previa_espera;
				previa_espera = previa_espera_sorteada(60 * 16 / por_segundo);
				previa_soltar();
			}
		} else if (previa_espera && !--previa_espera) {
			for (int i = 0; i < rajada; i++) {
				previa_soltar();
			}
			previa_espera = previa_espera_sorteada(intervalo);
		}
	}
	for (Previa &p : previa) {
		if (p.vida && --p.vida) {
			p.vel += gravidade / 3600.0f;
			p.pos += p.vel;
		}
	}
}

void MDParticulas::_notification(int p_what) {
	if (!Engine::get_singleton()->is_editor_hint()) {
		return;
	}
	switch (p_what) {
		case NOTIFICATION_ENTER_TREE: {
			set_process_internal(true);
		} break;
		case NOTIFICATION_INTERNAL_PROCESS: {
			if (!MDSprite::is_previa_ligada()) {
				if (previa_tempo >= 0 && !previa.is_empty()) {
					previa.clear();
					queue_redraw();
				}
				return;
			}
			if (previa.is_empty()) {
				previa_reiniciar();
				if (modo == MODO_RAJADA) {
					for (int i = 0; i < rajada; i++) {
						previa_soltar(); // A primeira rajada logo, para ver o efeito.
					}
				}
			}
			previa_tempo += get_process_delta_time();
			int quadros = 0;
			while (previa_tempo >= 1.0 / 60.0 && quadros < 8) {
				previa_tempo -= 1.0 / 60.0;
				previa_quadro();
				quadros++;
			}
			if (quadros) {
				queue_redraw();
			}
		} break;
		case NOTIFICATION_DRAW: {
			// Área tracejada amarela.
			const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
			const Color c(1.0, 0.85, 0.3);
			const Vector2 cantos[5] = { area.position, Vector2(area.get_end().x, area.position.y), area.get_end(), Vector2(area.position.x, area.get_end().y), area.position };
			for (int k = 0; k < 4; k++) {
				draw_dashed_line(cantos[k], cantos[k + 1], Color(c, 0.9), 1.0, 3.0);
			}
			if (previa.is_empty()) {
				return;
			}
			// Cor da partícula na paleta da cena (o primeiro mapa, fundo ou sprite com a mesma PAL).
			Color cor_pixel(1, 1, 1);
			Node *root = is_inside_tree() ? get_tree()->get_edited_scene_root() : nullptr;
			if (root) {
				TypedArray<Node> nodes = root->find_children("*", "", true, false);
				nodes.push_front(root);
				for (int i = 0; i < nodes.size(); i++) {
					String path;
					if (MDMapa *mapa = Object::cast_to<MDMapa>(nodes[i]); mapa && mapa->get_paleta() == paleta && mapa->get_atlas_texture().is_valid()) {
						path = mapa->get_atlas_texture()->get_path();
					} else if (MDFundo *fundo = Object::cast_to<MDFundo>(nodes[i]); fundo && fundo->get_paleta() == paleta && fundo->get_texture().is_valid()) {
						path = fundo->get_texture()->get_path();
					}
					const Vector<Color> plte = path.is_empty() ? Vector<Color>() : RetroMD::png_palette(path);
					if (cor < plte.size()) {
						cor_pixel = plte[cor];
						break;
					}
				}
			}
			const int quadros = forma == FORMA_IMAGEM && textura.is_valid() ? MAX(1, textura->get_width() / 8) : forma_quadros(forma);
			uint8_t pixels[64];
			for (const Previa &p : previa) {
				if (!p.vida) {
					continue;
				}
				const int idade = p.total - p.vida;
				const int quadro = quadros > 1 ? MIN(quadros - 1, idade * quadros / MAX(1, p.total)) : 0;
				const Vector2 canto = (p.pos - Vector2(4, 4)).floor();
				if (forma == FORMA_IMAGEM) {
					if (textura.is_valid()) {
						draw_texture_rect_region(textura, Rect2(canto, Vector2(8, 8)), Rect2(quadro * 8, 0, 8, 8));
					}
					continue;
				}
				forma_pixels(forma, quadro, pixels);
				for (int i = 0; i < 64; i++) {
					if (pixels[i]) {
						draw_rect(Rect2(canto + Vector2(i & 7, i >> 3), Vector2(1, 1)), cor_pixel);
					}
				}
			}
		} break;
	}
}

PackedStringArray MDParticulas::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (forma == FORMA_IMAGEM) {
		if (textura.is_null()) {
			warnings.push_back(U("Forma Imagem: escolha a textura (quadros de 8×8 lado a lado, do nascer ao morrer)."));
		} else if (textura->get_height() != 8 || textura->get_width() % 8 || textura->get_width() > 64) {
			warnings.push_back(U("A textura precisa ter 8 px de altura e de 8 a 64 px de largura (1 a 8 quadros de 8×8)."));
		}
	}
	if (vida_max < vida_min) {
		warnings.push_back(U("A vida máxima é menor que a mínima."));
	}
	return warnings;
}

void MDParticulas::_validate_property(PropertyInfo &p_property) const {
	static const char *const KEPT[] = { "position", "visible", nullptr };
	RetroMD::hide_unsupported(this, p_property, KEPT);
	const bool continuo = modo == MODO_CONTINUO;
	if ((p_property.name == "textura" && forma != FORMA_IMAGEM) || (p_property.name == "cor" && forma == FORMA_IMAGEM) ||
			(continuo && (p_property.name == "rajada" || p_property.name == "intervalo")) || (!continuo && p_property.name == "por_segundo")) {
		p_property.usage = PROPERTY_USAGE_NO_EDITOR;
	}
}

void MDParticulas::_bind_methods() {
#define PROP(m_type, m_name, m_hint, m_hint_text) \
	ClassDB::bind_method(D_METHOD("set_" #m_name, "valor"), &MDParticulas::set_##m_name); \
	ClassDB::bind_method(D_METHOD("get_" #m_name), &MDParticulas::get_##m_name); \
	ADD_PROPERTY(PropertyInfo(m_type, #m_name, m_hint, m_hint_text), "set_" #m_name, "get_" #m_name);
	PROP(Variant::VECTOR2I, tamanho, PROPERTY_HINT_NONE, "suffix:px");
	PROP(Variant::INT, forma, PROPERTY_HINT_ENUM, U("Grão,Gota,Faísca,Fumaça,Estrela,Explosão,Imagem"));
	PROP(Variant::OBJECT, textura, PROPERTY_HINT_RESOURCE_TYPE, "Texture2D");
	PROP(Variant::INT, paleta, PROPERTY_HINT_RANGE, "0,3,1");
	PROP(Variant::INT, cor, PROPERTY_HINT_RANGE, "1,15,1");
	PROP(Variant::BOOL, prioridade, PROPERTY_HINT_NONE, "");
	PROP(Variant::INT, maximo, PROPERTY_HINT_RANGE, "1,16,1");
	ADD_GROUP(U("Emissão"), "");
	PROP(Variant::INT, modo, PROPERTY_HINT_ENUM, U("Contínuo,Rajada"));
	PROP(Variant::INT, por_segundo, PROPERTY_HINT_RANGE, "1,60,1");
	PROP(Variant::INT, rajada, PROPERTY_HINT_RANGE, "1,16,1");
	PROP(Variant::INT, intervalo, PROPERTY_HINT_RANGE, "0,3600,1,suffix:quadros");
	PROP(Variant::INT, variacao, PROPERTY_HINT_RANGE, "0,100,1,suffix:%");
	PROP(Variant::BOOL, ligado, PROPERTY_HINT_NONE, "");
	PROP(Variant::INT, semente, PROPERTY_HINT_RANGE, "0,65535,1");
	ADD_GROUP(U("Movimento"), "");
	PROP(Variant::INT, vida_min, PROPERTY_HINT_RANGE, "1,255,1,suffix:quadros");
	PROP(Variant::INT, vida_max, PROPERTY_HINT_RANGE, "1,255,1,suffix:quadros");
	PROP(Variant::VECTOR2, velocidade_min, PROPERTY_HINT_NONE, "suffix:px/s");
	PROP(Variant::VECTOR2, velocidade_max, PROPERTY_HINT_NONE, "suffix:px/s");
	PROP(Variant::VECTOR2, gravidade, PROPERTY_HINT_NONE, "suffix:px/s²");
#undef PROP
	BIND_ENUM_CONSTANT(FORMA_GRAO);
	BIND_ENUM_CONSTANT(FORMA_GOTA);
	BIND_ENUM_CONSTANT(FORMA_FAISCA);
	BIND_ENUM_CONSTANT(FORMA_FUMACA);
	BIND_ENUM_CONSTANT(FORMA_ESTRELA);
	BIND_ENUM_CONSTANT(FORMA_EXPLOSAO);
	BIND_ENUM_CONSTANT(FORMA_IMAGEM);
	BIND_ENUM_CONSTANT(MODO_CONTINUO);
	BIND_ENUM_CONSTANT(MODO_RAJADA);
}

// ---- MDTrajeto ----

void MDTrajeto::set_ciclo(bool p_ciclo) {
	ciclo = p_ciclo;
	update_configuration_warnings();
}

PackedVector2Array MDTrajeto::pontos() const {
	PackedVector2Array out;
	const Ref<Curve2D> c = get_curve();
	if (c.is_null() || c->get_point_count() < 2) {
		return out;
	}
	const PackedVector2Array linha = c->tessellate(5, 4);
	if (linha.is_empty()) {
		return out;
	}
	const Vector2 origem = linha[0];
	for (const Vector2 &p : linha) {
		out.push_back(p - origem);
	}
	return out;
}

PackedStringArray MDTrajeto::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (get_curve().is_null() || get_curve()->get_point_count() < 2) {
		warnings.push_back(U("Desenhe o trajeto com pelo menos 2 pontos (ferramentas de curva na barra do editor 2D)."));
	}
	if (is_inside_tree() && !Object::cast_to<MDPlataforma>(get_parent()) && !Object::cast_to<MDInimigo>(get_parent())) {
		warnings.push_back(U("O MDTrajeto precisa ser filho de uma MDPlataforma ou de um MDInimigo."));
	}
	return warnings;
}

void MDTrajeto::_validate_property(PropertyInfo &p_property) const {
	static const char *const KEPT_TRAJETO[] = { "position", "visible", "curve", nullptr };
	RetroMD::hide_unsupported(this, p_property, KEPT_TRAJETO);
}

void MDTrajeto::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_ciclo", "ciclo"), &MDTrajeto::set_ciclo);
	ClassDB::bind_method(D_METHOD("get_ciclo"), &MDTrajeto::get_ciclo);
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "ciclo"), "set_ciclo", "get_ciclo");
}

// ---- MDMenu ----

#define MDMENU_SETTER(m_prop, m_type)                         \
	void MDMenu::set_##m_prop(m_type p_valor) {               \
		m_prop = p_valor;                                      \
		queue_redraw();                                        \
		update_configuration_warnings();                       \
	}
MDMENU_SETTER(mostrar_continuar, bool)
MDMENU_SETTER(mostrar_senha, bool)
MDMENU_SETTER(mostrar_opcoes, bool)
MDMENU_SETTER(mostrar_salvar, bool)
MDMENU_SETTER(mostrar_sair, bool)
MDMENU_SETTER(texto_comecar, const String &)
MDMENU_SETTER(texto_continuar, const String &)
MDMENU_SETTER(texto_senha, const String &)
MDMENU_SETTER(texto_opcoes, const String &)
MDMENU_SETTER(texto_salvar, const String &)
MDMENU_SETTER(texto_sair, const String &)
#undef MDMENU_SETTER

String MDMenu::rotulo_comecar() const {
	return texto_comecar.is_empty() ? U("COMEÇAR") : texto_comecar;
}
String MDMenu::rotulo_continuar() const {
	return texto_continuar.is_empty() ? String("CONTINUAR") : texto_continuar;
}
String MDMenu::rotulo_senha() const {
	return texto_senha.is_empty() ? String("SENHA") : texto_senha;
}
String MDMenu::rotulo_opcoes() const {
	return texto_opcoes.is_empty() ? U("OPÇÕES") : texto_opcoes;
}
String MDMenu::rotulo_salvar() const {
	return texto_salvar.is_empty() ? String("SALVAR") : texto_salvar;
}
String MDMenu::rotulo_sair() const {
	return texto_sair.is_empty() ? U("SAIR PARA O TÍTULO") : texto_sair;
}

PackedStringArray MDMenu::itens_visiveis() const {
	PackedStringArray itens;
	if (tipo == TIPO_TITULO) {
		itens.push_back(rotulo_comecar());
		if (mostrar_continuar) {
			itens.push_back(rotulo_continuar());
		}
		if (mostrar_senha) {
			itens.push_back(rotulo_senha());
		}
		if (mostrar_opcoes) {
			itens.push_back(rotulo_opcoes());
		}
	} else {
		itens.push_back(rotulo_continuar());
		if (mostrar_opcoes) {
			itens.push_back(rotulo_opcoes());
		}
		if (mostrar_salvar) {
			itens.push_back(rotulo_salvar());
		}
		if (mostrar_sair) {
			itens.push_back(rotulo_sair());
		}
	}
	return itens;
}

void MDMenu::set_tipo(Tipo p_tipo) {
	tipo = p_tipo;
	notify_property_list_changed();
	queue_redraw();
	update_configuration_warnings();
}

void MDMenu::set_comecar_vai_para(const String &p_cena) {
	comecar_vai_para = RetroMD::resource_path(p_cena);
	update_configuration_warnings();
}

void MDMenu::set_slots(int p_slots) {
	slots = CLAMP(p_slots, 1, 3);
}

void MDMenu::set_som_cursor(const String &p_som) {
	som_cursor = RetroMD::resource_path(p_som);
	update_configuration_warnings();
}

void MDMenu::set_som_escolha(const String &p_som) {
	som_escolha = RetroMD::resource_path(p_som);
	update_configuration_warnings();
}

void MDMenu::_notification(int p_what) {
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		if (tipo == TIPO_PAUSA) {
			// A pausa aparece no topo da tela; no editor, só um marcador.
			draw_rect(Rect2(0, 0, 16, 8), Color(1, 0.75, 0.2, 0.9));
			return;
		}
		// Prévia do título: um retângulo por item, do tamanho do texto, com uma linha vazia entre eles.
		const PackedStringArray itens = itens_visiveis();
		for (int i = 0; i < itens.size(); i++) {
			const Rect2 linha(Vector2(16, i * 16), Vector2(itens[i].length() * 8, 8));
			draw_rect(linha, Color(0.93, 0.93, 0.93, 0.55));
		}
		draw_rect(Rect2(0, 0, 8, 8), Color(1, 0.75, 0.2, 0.9)); // O cursor.
	}
}

PackedStringArray MDMenu::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (tipo == TIPO_TITULO) {
		if (comecar_vai_para.is_empty()) {
			warnings.push_back(U("Escolha a cena do Começar (comecar_vai_para)."));
		} else {
			const String problem = RetroMD::file_problem(comecar_vai_para, "tscn");
			if (!problem.is_empty()) {
				warnings.push_back(problem);
			}
		}
	}
	for (const String &som : { som_cursor, som_escolha }) {
		const String problem = RetroMD::file_problem(som, "wav");
		if (!som.is_empty() && !problem.is_empty()) {
			warnings.push_back(problem);
		}
	}
	return warnings;
}

void MDMenu::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
	const StringName &name = p_property.name;
	const bool titulo = tipo == TIPO_TITULO;
	if ((!titulo && (name == "comecar_vai_para" || name == "mostrar_continuar" || name == "mostrar_senha" || name == "slots" || name == "texto_comecar" || name == "texto_senha")) ||
			(titulo && (name == "mostrar_salvar" || name == "mostrar_sair" || name == "texto_salvar" || name == "texto_sair" || name == "cor_fundo" || name == "cor_borda" || name == "cor_texto"))) {
		p_property.usage = PROPERTY_USAGE_NO_EDITOR;
	}
}

void MDMenu::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_tipo", "tipo"), &MDMenu::set_tipo);
	ClassDB::bind_method(D_METHOD("get_tipo"), &MDMenu::get_tipo);
	ClassDB::bind_method(D_METHOD("set_comecar_vai_para", "cena"), &MDMenu::set_comecar_vai_para);
	ClassDB::bind_method(D_METHOD("get_comecar_vai_para"), &MDMenu::get_comecar_vai_para);
#define MDMENU_BIND(m_prop, m_arg)                                                                     \
	ClassDB::bind_method(D_METHOD("set_" #m_prop, m_arg), &MDMenu::set_##m_prop);                     \
	ClassDB::bind_method(D_METHOD("get_" #m_prop), &MDMenu::get_##m_prop);
	MDMENU_BIND(mostrar_continuar, "mostrar")
	MDMENU_BIND(mostrar_senha, "mostrar")
	MDMENU_BIND(mostrar_opcoes, "mostrar")
	MDMENU_BIND(mostrar_salvar, "mostrar")
	MDMENU_BIND(mostrar_sair, "mostrar")
	MDMENU_BIND(slots, "slots")
	MDMENU_BIND(texto_comecar, "texto")
	MDMENU_BIND(texto_continuar, "texto")
	MDMENU_BIND(texto_senha, "texto")
	MDMENU_BIND(texto_opcoes, "texto")
	MDMENU_BIND(texto_salvar, "texto")
	MDMENU_BIND(texto_sair, "texto")
	MDMENU_BIND(som_cursor, "som")
	MDMENU_BIND(som_escolha, "som")
	MDMENU_BIND(cor_fundo, "cor")
	MDMENU_BIND(cor_borda, "cor")
	MDMENU_BIND(cor_texto, "cor")
#undef MDMENU_BIND
	ADD_PROPERTY(PropertyInfo(Variant::INT, "tipo", PROPERTY_HINT_ENUM, U("Tela de título,Pausa (START)")), "set_tipo", "get_tipo");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "comecar_vai_para", PROPERTY_HINT_FILE, "*.tscn"), "set_comecar_vai_para", "get_comecar_vai_para");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "mostrar_continuar"), "set_mostrar_continuar", "get_mostrar_continuar");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "mostrar_senha"), "set_mostrar_senha", "get_mostrar_senha");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "mostrar_opcoes"), "set_mostrar_opcoes", "get_mostrar_opcoes");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "mostrar_salvar"), "set_mostrar_salvar", "get_mostrar_salvar");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "mostrar_sair"), "set_mostrar_sair", "get_mostrar_sair");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "slots", PROPERTY_HINT_RANGE, "1,3,1"), "set_slots", "get_slots");
	ADD_GROUP("Textos", "texto_");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto_comecar", PROPERTY_HINT_PLACEHOLDER_TEXT, U("COMEÇAR")), "set_texto_comecar", "get_texto_comecar");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto_continuar", PROPERTY_HINT_PLACEHOLDER_TEXT, "CONTINUAR"), "set_texto_continuar", "get_texto_continuar");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto_senha", PROPERTY_HINT_PLACEHOLDER_TEXT, "SENHA"), "set_texto_senha", "get_texto_senha");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto_opcoes", PROPERTY_HINT_PLACEHOLDER_TEXT, U("OPÇÕES")), "set_texto_opcoes", "get_texto_opcoes");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto_salvar", PROPERTY_HINT_PLACEHOLDER_TEXT, "SALVAR"), "set_texto_salvar", "get_texto_salvar");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto_sair", PROPERTY_HINT_PLACEHOLDER_TEXT, U("SAIR PARA O TÍTULO")), "set_texto_sair", "get_texto_sair");
	ADD_GROUP("Sons e cores", "");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_cursor", PROPERTY_HINT_FILE, "*.wav"), "set_som_cursor", "get_som_cursor");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_escolha", PROPERTY_HINT_FILE, "*.wav"), "set_som_escolha", "get_som_escolha");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor_fundo", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor_fundo", "get_cor_fundo");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor_borda", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor_borda", "get_cor_borda");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor_texto", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor_texto", "get_cor_texto");

	BIND_ENUM_CONSTANT(TIPO_TITULO);
	BIND_ENUM_CONSTANT(TIPO_PAUSA);
}

// ---- MDDialogo ----

void MDDialogo::set_falas(const PackedStringArray &p_falas) {
	falas = p_falas;
	update_configuration_warnings();
}

void MDDialogo::set_ativar(Ativar p_ativar) {
	ativar = p_ativar;
	notify_property_list_changed();
	queue_redraw();
	update_configuration_warnings();
}

void MDDialogo::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = Vector2i(MAX(8, p_tamanho.x), MAX(8, p_tamanho.y));
	queue_redraw();
}

void MDDialogo::set_opcoes(const PackedStringArray &p_opcoes) {
	opcoes = p_opcoes;
	update_configuration_warnings();
}

void MDDialogo::set_proximo(const NodePath &p_proximo) {
	proximo = p_proximo;
	update_configuration_warnings();
}

void MDDialogo::set_retrato(const String &p_retrato) {
	retrato = RetroMD::resource_path(p_retrato);
	update_configuration_warnings();
}

void MDDialogo::set_linhas(int p_linhas) {
	linhas = CLAMP(p_linhas, LINHAS_MIN, LINHAS_MAX);
	update_configuration_warnings();
}

void MDDialogo::_notification(int p_what) {
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		if (ativar == ATIVAR_AO_TOCAR || ativar == ATIVAR_APERTAR_CIMA) {
			const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
			draw_rect(area, Color(0.55, 0.65, 0.95, 0.22));
			draw_rect(area, Color(0.55, 0.65, 0.95, 0.9), false, 1);
		} else {
			// Sem área: um balão pequeno marca onde o node está.
			draw_rect(Rect2(0, 0, 12, 8), Color(0.55, 0.65, 0.95, 0.9));
			draw_rect(Rect2(2, 8, 3, 3), Color(0.55, 0.65, 0.95, 0.9));
		}
	}
}

PackedStringArray MDDialogo::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	bool any = false;
	for (const String &fala : falas) {
		any = any || !fala.strip_edges().is_empty();
	}
	if (!any) {
		warnings.push_back(U("Escreva as falas (uma página por item)."));
	}
	if (opcoes.size() > linhas - 2) {
		warnings.push_back(vformat(U("A caixa mostra %d opções (linhas − 2); aumente as linhas ou use menos opções."), linhas - 2));
	}
	if (!retrato.is_empty()) {
		const String problem = RetroMD::file_problem(retrato, "png");
		if (!problem.is_empty()) {
			warnings.push_back(problem);
		}
	}
	if (!proximo.is_empty() && is_inside_tree() && !Object::cast_to<MDDialogo>(get_node_or_null(proximo))) {
		warnings.push_back(U("O próximo diálogo precisa ser outro MDDialogo da cena."));
	}
	return warnings;
}

void MDDialogo::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
	if ((p_property.name == "tamanho" || p_property.name == "uma_vez") && (ativar == ATIVAR_AO_INICIAR || ativar == ATIVAR_PELO_CODIGO)) {
		p_property.usage = PROPERTY_USAGE_NO_EDITOR;
	}
}

void MDDialogo::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_falas", "falas"), &MDDialogo::set_falas);
	ClassDB::bind_method(D_METHOD("get_falas"), &MDDialogo::get_falas);
	ClassDB::bind_method(D_METHOD("set_ativar", "ativar"), &MDDialogo::set_ativar);
	ClassDB::bind_method(D_METHOD("get_ativar"), &MDDialogo::get_ativar);
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDDialogo::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDDialogo::get_tamanho);
	ClassDB::bind_method(D_METHOD("set_uma_vez", "uma_vez"), &MDDialogo::set_uma_vez);
	ClassDB::bind_method(D_METHOD("get_uma_vez"), &MDDialogo::get_uma_vez);
	ClassDB::bind_method(D_METHOD("set_opcoes", "opcoes"), &MDDialogo::set_opcoes);
	ClassDB::bind_method(D_METHOD("get_opcoes"), &MDDialogo::get_opcoes);
	ClassDB::bind_method(D_METHOD("set_variavel", "variavel"), &MDDialogo::set_variavel);
	ClassDB::bind_method(D_METHOD("get_variavel"), &MDDialogo::get_variavel);
	ClassDB::bind_method(D_METHOD("set_proximo", "proximo"), &MDDialogo::set_proximo);
	ClassDB::bind_method(D_METHOD("get_proximo"), &MDDialogo::get_proximo);
	ClassDB::bind_method(D_METHOD("set_velocidade", "velocidade"), &MDDialogo::set_velocidade);
	ClassDB::bind_method(D_METHOD("get_velocidade"), &MDDialogo::get_velocidade);
	ClassDB::bind_method(D_METHOD("set_retrato", "retrato"), &MDDialogo::set_retrato);
	ClassDB::bind_method(D_METHOD("get_retrato"), &MDDialogo::get_retrato);
	ClassDB::bind_method(D_METHOD("set_paleta_retrato", "paleta"), &MDDialogo::set_paleta_retrato);
	ClassDB::bind_method(D_METHOD("get_paleta_retrato"), &MDDialogo::get_paleta_retrato);
	ClassDB::bind_method(D_METHOD("set_linhas", "linhas"), &MDDialogo::set_linhas);
	ClassDB::bind_method(D_METHOD("get_linhas"), &MDDialogo::get_linhas);
	ClassDB::bind_method(D_METHOD("set_cor_fundo", "cor"), &MDDialogo::set_cor_fundo);
	ClassDB::bind_method(D_METHOD("get_cor_fundo"), &MDDialogo::get_cor_fundo);
	ClassDB::bind_method(D_METHOD("set_cor_borda", "cor"), &MDDialogo::set_cor_borda);
	ClassDB::bind_method(D_METHOD("get_cor_borda"), &MDDialogo::get_cor_borda);
	ClassDB::bind_method(D_METHOD("set_cor_texto", "cor"), &MDDialogo::set_cor_texto);
	ClassDB::bind_method(D_METHOD("get_cor_texto"), &MDDialogo::get_cor_texto);

	const String multiline = vformat("%d/%d:", Variant::STRING, PROPERTY_HINT_MULTILINE_TEXT);
	ADD_PROPERTY(PropertyInfo(Variant::PACKED_STRING_ARRAY, "falas", PROPERTY_HINT_TYPE_STRING, multiline), "set_falas", "get_falas");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "ativar", PROPERTY_HINT_ENUM, U("Ao iniciar a cena,Ao tocar a área,Apertar para cima na área,Pelo código")), "set_ativar", "get_ativar");
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "uma_vez"), "set_uma_vez", "get_uma_vez");
	ADD_PROPERTY(PropertyInfo(Variant::PACKED_STRING_ARRAY, "opcoes"), "set_opcoes", "get_opcoes");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "variavel", PROPERTY_HINT_RANGE, "-1,15,1"), "set_variavel", "get_variavel");
	ADD_PROPERTY(PropertyInfo(Variant::NODE_PATH, "proximo", PROPERTY_HINT_NODE_PATH_VALID_TYPES, "MDDialogo"), "set_proximo", "get_proximo");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade", PROPERTY_HINT_RANGE, "0,30,1,suffix:quadros por letra"), "set_velocidade", "get_velocidade");
	ADD_GROUP(U("Aparência"), "");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "retrato", PROPERTY_HINT_FILE, "*.png"), "set_retrato", "get_retrato");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta_retrato", PROPERTY_HINT_RANGE, "0,3,1"), "set_paleta_retrato", "get_paleta_retrato");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "linhas", PROPERTY_HINT_RANGE, vformat("%d,%d,1", LINHAS_MIN, LINHAS_MAX)), "set_linhas", "get_linhas");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor_fundo", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor_fundo", "get_cor_fundo");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor_borda", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor_borda", "get_cor_borda");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor_texto", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor_texto", "get_cor_texto");

	BIND_ENUM_CONSTANT(ATIVAR_AO_INICIAR);
	BIND_ENUM_CONSTANT(ATIVAR_AO_TOCAR);
	BIND_ENUM_CONSTANT(ATIVAR_APERTAR_CIMA);
	BIND_ENUM_CONSTANT(ATIVAR_PELO_CODIGO);
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
	ADD_PROPERTY(PropertyInfo(Variant::INT, "plano", PROPERTY_HINT_ENUM, U("BG B (atrás),BG A (frente)")), "set_plano", "get_plano");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta", PROPERTY_HINT_RANGE, "0,3,1"), "set_paleta", "get_paleta");
	ClassDB::bind_method(D_METHOD("set_rolagem", "rolagem"), &MDFundo::set_rolagem);
	ClassDB::bind_method(D_METHOD("get_rolagem"), &MDFundo::get_rolagem);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "rolagem", PROPERTY_HINT_RANGE, U("0,100,1,suffix:% da câmera")), "set_rolagem", "get_rolagem");
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

void MDSprite::set_paleta_de(const String &p_png) {
	paleta_de = RetroMD::resource_path(p_png);
	update_configuration_warnings();
}

void MDSprite::set_caixa_colisao(const Rect2i &p_caixa) {
	caixa_colisao = p_caixa;
	queue_redraw();
}

void MDSprite::set_personagem(const Ref<MDPersonagem> &p_personagem) {
	const Callable changed = callable_mp(this, &MDSprite::_on_personagem_edited);
	if (personagem.is_valid() && personagem->is_connected(CoreStringName(changed), changed)) {
		personagem->disconnect(CoreStringName(changed), changed);
	}
	personagem = p_personagem;
	previa_atlas_ok = false; // O personagem pode ter mudado (gestor de animações, ajuste na cena).
	if (personagem.is_null()) {
		set_offset(Vector2());
	}
	if (personagem.is_valid() && Engine::get_singleton()->is_editor_hint()) {
		personagem->connect(CoreStringName(changed), changed);
	}
	if (personagem.is_valid() && personagem->find_animation(animacao) < 0) {
		animacao = personagem->get_animations().is_empty() ? String() : personagem->get_animations()[0].name;
	}
	_personagem_changed();
	_update_personagem_preview();
	previa_atualizar_processo();
	notify_property_list_changed();
	update_configuration_warnings();
}

// O gestor de animações editou o personagem: mesma atualização de quando ele é escolhido.
void MDSprite::_on_personagem_edited() {
	set_personagem(personagem);
}

void MDSprite::set_animacao(const String &p_animacao) {
	if (p_animacao != animacao) {
		// Outra animação começa do primeiro quadro (a mesma continua, como tocar_animacao no jogo).
		previa_quadro = 0;
		previa_espera = 0;
		previa_segurando = false;
	}
	animacao = p_animacao;
	_update_personagem_preview();
}

// ---- Prévia da animação no editor ----

const MDPersonagem::Animacao *MDSprite::get_previa_animacao() const {
	if (personagem.is_null() || personagem->get_animations().is_empty()) {
		return nullptr;
	}
	return &personagem->get_animations()[MAX(0, personagem->find_animation(animacao))];
}

void MDSprite::previa_atualizar_processo() {
	set_process_internal(Engine::get_singleton()->is_editor_hint() && previa_ligada && personagem.is_valid() && is_inside_tree());
}

void MDSprite::set_previa_quadro(int p_quadro) {
	previa_quadro = p_quadro;
	previa_espera = 0;
	previa_segurando = false;
	_previa_mostrar();
}

// Mostra o quadro previa_quadro da animação escolhida (linha da animação no atlas, coluna do quadro).
void MDSprite::_previa_mostrar() {
	const MDPersonagem::Animacao *anim = get_previa_animacao();
	if (!anim || anim->frames.is_empty() || get_hframes() < 1 || get_texture().is_null()) {
		return;
	}
	previa_quadro = CLAMP(previa_quadro, 0, anim->frames.size() - 1);
	// A linha vem da lista do atlas que está na tela (a de agora pode ter mudado e o atlas ainda não).
	const int columns = get_hframes();
	const int mostrar = MAX(0, previa_usadas.find(personagem->find_animation(animacao))) * columns + MIN(previa_quadro, columns - 1);
	if (mostrar < columns * get_vframes() && mostrar != get_frame()) {
		set_frame(mostrar);
	}
}

// Um quadro de vídeo (1/60 s): cada quadro da animação fica o tempo dele, como no jogo. A animação sem
// repetição para no último quadro e, na prévia, recomeça depois de um instante.
void MDSprite::_previa_avancar() {
	const MDPersonagem::Animacao *anim = get_previa_animacao();
	if (!anim || anim->frames.is_empty()) {
		return;
	}
	previa_quadro = CLAMP(previa_quadro, 0, anim->frames.size() - 1);
	if (previa_espera <= 0) {
		previa_espera = anim->frames[previa_quadro].ticks;
	}
	if (--previa_espera > 0) {
		return;
	}
	int next = previa_quadro + 1;
	if (next >= anim->frames.size()) {
		if (!anim->loop && !previa_segurando) {
			previa_segurando = true;
			previa_espera = 40;
			return;
		}
		previa_segurando = false;
		next = 0;
	}
	previa_quadro = next;
	previa_espera = anim->frames[next].ticks;
	_previa_mostrar();
}

int MDSprite::get_animacao_index(const String &p_name) const {
	return personagem.is_valid() ? MAX(0, personagem->find_animation(p_name)) : 0;
}

namespace {
void find_animation_players(Node *p_node, Vector<AnimationPlayer *> &r_players) {
	if (AnimationPlayer *player = Object::cast_to<AnimationPlayer>(p_node)) {
		r_players.push_back(player);
	}
	for (int i = 0; i < p_node->get_child_count(); i++) {
		find_animation_players(p_node->get_child(i), r_players);
	}
}
} // namespace

// A escolhida em "animacao" e as que as trilhas "animacao" dos AnimationPlayers da cena usam para
// este sprite (cutscenes), na ordem em que aparecem. O editor e o build usam a mesma lista.
Vector<int> MDSprite::get_used_animations() const {
	Vector<int> used;
	if (personagem.is_null() || personagem->get_animations().is_empty()) {
		return used;
	}
	used.push_back(MAX(0, personagem->find_animation(animacao)));
	Node *scene = get_owner() ? get_owner() : nullptr;
	if (!scene) {
		return used;
	}
	Vector<AnimationPlayer *> players;
	find_animation_players(scene, players);
	for (AnimationPlayer *player : players) {
		Node *base = player->get_node_or_null(player->get_root_node());
		LocalVector<StringName> names;
		player->get_animation_list(&names);
		for (const StringName &name : names) {
			const Ref<Animation> animation = player->get_animation(name);
			for (int t = 0; animation.is_valid() && t < animation->get_track_count(); t++) {
				const NodePath path = animation->track_get_path(t);
				if (animation->track_get_type(t) != Animation::TYPE_VALUE || path.get_concatenated_subnames() != "animacao" || !base || base->get_node_or_null(NodePath(path.get_concatenated_names())) != this) {
					continue;
				}
				for (int k = 0; k < animation->track_get_key_count(t); k++) {
					const int found = personagem->find_animation(animation->track_get_key_value(t, k));
					if (found >= 0 && !used.has(found)) {
						used.push_back(found);
					}
				}
			}
		}
	}
	return used;
}

int MDSprite::get_used_row(const String &p_name) const {
	return personagem.is_valid() ? get_used_animations().find(personagem->find_animation(p_name)) : -1;
}

namespace {
// Só a animação escolhida (inimigos e itens tocam uma só).
Vector<int> only_animation(const Ref<MDPersonagem> &p_personagem, const String &p_name) {
	Vector<int> used;
	if (p_personagem.is_valid() && !p_personagem->get_animations().is_empty()) {
		used.push_back(MAX(0, p_personagem->find_animation(p_name)));
	}
	return used;
}
} // namespace

// A animação de patrulha e, se houver, a de derrota.
Vector<int> MDInimigo::get_used_animations() const {
	Vector<int> used = only_animation(personagem, animacao);
	const int defeat = personagem.is_valid() ? personagem->find_animation(anim_derrota) : -1;
	if (defeat >= 0 && !used.has(defeat)) {
		used.push_back(defeat);
	}
	return used;
}

void MDInimigo::set_vida(int p_vida) {
	vida = CLAMP(p_vida, 1, 99);
}

void MDInimigo::set_anim_derrota(const String &p_anim) {
	anim_derrota = p_anim;
	_update_personagem_preview();
}

void MDInimigo::_validate_property(PropertyInfo &p_property) const {
	if (p_property.name == "anim_derrota") {
		if (personagem.is_valid()) {
			p_property.hint = PROPERTY_HINT_ENUM;
			p_property.hint_string = "," + String(",").join(personagem->get_animation_names()); // Vazio = some na hora.
		} else {
			p_property.usage = PROPERTY_USAGE_STORAGE;
		}
	}
}

Vector<int> MDItem::get_used_animations() const {
	return only_animation(personagem, animacao);
}

// O jogador leva as animações dos estados (e a inicial).
Vector<int> MDJogador::get_used_animations() const {
	Vector<int> used;
	if (personagem.is_null()) {
		return used;
	}
	for (const String &name : { animacao, anim_parado, anim_andando, anim_pulando, anim_caindo, anim_ataque, anim_morte, anim_dano }) {
		const int found = personagem->find_animation(name);
		if (found >= 0 && !used.has(found)) {
			used.push_back(found);
		}
	}
	if (used.is_empty() && !personagem->get_animations().is_empty()) {
		used.push_back(0);
	}
	return used;
}

void MDJogador::set_anim_parado(const String &p_anim) {
	anim_parado = p_anim;
	_update_personagem_preview();
}

void MDJogador::set_anim_andando(const String &p_anim) {
	anim_andando = p_anim;
	_update_personagem_preview();
}

void MDJogador::set_anim_pulando(const String &p_anim) {
	anim_pulando = p_anim;
	_update_personagem_preview();
}

void MDJogador::set_anim_caindo(const String &p_anim) {
	anim_caindo = p_anim;
	_update_personagem_preview();
}

void MDJogador::set_anim_ataque(const String &p_anim) {
	anim_ataque = p_anim;
	_update_personagem_preview();
	update_configuration_warnings();
}

void MDJogador::set_anim_morte(const String &p_anim) {
	anim_morte = p_anim;
	_update_personagem_preview();
}

void MDJogador::set_anim_dano(const String &p_anim) {
	anim_dano = p_anim;
	_update_personagem_preview();
}

void MDJogador::set_energia(int p_energia) {
	energia = CLAMP(p_energia, 0, 9);
}

void MDJogador::set_invencivel(int p_quadros) {
	invencivel = CLAMP(p_quadros, 0, 600);
}

void MDJogador::set_som_dano(const String &p_som) {
	som_dano = RetroMD::resource_path(p_som);
	update_configuration_warnings();
}

// No editor, o atlas do personagem vira a textura do Sprite2D (em memória, não vai para a cena) e a
// animação escolhida é a linha mostrada.
void MDSprite::_update_personagem_preview() {
	if (personagem.is_null() || personagem->get_animations().is_empty() || !Engine::get_singleton()->is_editor_hint()) {
		return;
	}
	// O mesmo atlas que o build exporta (só as animações usadas), para a posição bater com a do jogo.
	// Só é refeito quando as animações usadas ou o personagem mudam (trocar de animação, na trilha de
	// um AnimationPlayer por exemplo, só troca a linha mostrada).
	const Vector<int> used = get_used_animations();
	if (!previa_atlas_ok || !(used == previa_usadas) || get_texture().is_null()) {
		const Ref<Image> atlas = personagem->build_atlas(nullptr, used);
		if (atlas.is_null()) {
			return;
		}
		set_texture(ImageTexture::create_from_image(atlas));
		set_offset(-Vector2(get_apoio()));
		set_hframes(personagem->get_max_frames(used));
		set_vframes(used.size());
		previa_usadas = used;
		previa_atlas_ok = true;
	}
	_previa_mostrar();
	queue_redraw();
}

Vector2i MDSprite::get_apoio() const {
	return personagem.is_valid() && !personagem->get_animations().is_empty() ? personagem->get_cell(get_used_animations()).anchor : Vector2i();
}

Vector2i MDSprite::get_frame_size() const {
	if (personagem.is_valid()) {
		return personagem->get_cell(get_used_animations()).size;
	}
	const Ref<Texture2D> image = get_texture();
	return image.is_valid() ? Vector2i(image->get_width() / MAX(1, get_hframes()), image->get_height() / MAX(1, get_vframes())) : Vector2i();
}

Rect2i MDSprite::get_caixa_efetiva() const {
	if (caixa_colisao.has_area()) {
		return caixa_colisao;
	}
	if (personagem.is_valid()) {
		// O corpo do personagem é relativo aos pés; a caixa do sprite, ao canto da célula.
		const Rect2i body = personagem->get_body_box();
		return Rect2i(personagem->get_cell(get_used_animations()).anchor + body.position, body.size);
	}
	return Rect2i(Vector2i(), get_frame_size());
}

bool MDSprite::tem_caixa_dano_propria() const {
	return personagem.is_valid() && personagem->has_custom_hurt_box();
}

Rect2i MDSprite::get_caixa_dano_efetiva() const {
	if (!tem_caixa_dano_propria()) {
		return get_caixa_efetiva();
	}
	const Rect2i hurt = personagem->get_hurt_box();
	return Rect2i(personagem->get_cell(get_used_animations()).anchor + hurt.position, hurt.size);
}

void MDSprite::_notification(int p_what) {
	if (p_what == NOTIFICATION_ENTER_TREE) {
		previa_atualizar_processo();
	} else if (p_what == NOTIFICATION_INTERNAL_PROCESS) {
		previa_acumulado = MIN(previa_acumulado + get_process_delta_time() * 60.0, 4.0);
		while (previa_acumulado >= 1.0) {
			previa_acumulado -= 1.0;
			_previa_avancar();
		}
	}
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint() && _shows_collision_box()) {
		// A caixa é relativa ao canto da célula; o desenho do personagem está deslocado pelo apoio.
		draw_rect(Rect2(Vector2(get_caixa_efetiva().position) + get_offset(), get_caixa_efetiva().size), Color(1, 0.3, 0.3, 0.8), false, 1);
	}
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint() && tem_caixa_dano_propria()) {
		// Caixa de dano do personagem (roxa): onde ele leva golpe.
		const Rect2i hurt = get_caixa_dano_efetiva();
		draw_rect(Rect2(Vector2(hurt.position) + get_offset(), hurt.size), Color(0.75, 0.45, 1, 0.85), false, 1);
	}
}

PackedStringArray MDSprite::get_configuration_warnings() const {
	PackedStringArray warnings = Sprite2D::get_configuration_warnings();
	if (!paleta_de.is_empty() && RetroMD::png_palette(get_paleta_de()).is_empty()) {
		warnings.push_back(U("paleta_de: ") + paleta_de + U(" não é um PNG indexado (ou não existe)."));
	}
	if (personagem.is_valid()) {
		if (!personagem->get_load_error().is_empty()) {
			warnings.push_back(personagem->get_load_error());
		} else if (personagem->get_animations().is_empty()) {
			warnings.push_back(U("O personagem ainda não tem animações: crie-as no gestor de animações (dois cliques no .charset.json)."));
		}
		const Vector2i cell = personagem->get_cell(get_used_animations()).size;
		if (cell.x > 248 || cell.y > 248) {
			warnings.push_back(vformat(U("A célula do personagem (%d×%d) passa de 248×248; diminua o ajuste fino ou os recortes no gestor de animações."), cell.x, cell.y));
		}
		if (get_rotation() != 0 || get_scale() != Vector2(1, 1) || is_centered()) {
			warnings.push_back(U("Sprites do console não giram nem mudam de escala."));
		}
		return warnings;
	}
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
	ClassDB::bind_method(D_METHOD("set_personagem", "personagem"), &MDSprite::set_personagem);
	ClassDB::bind_method(D_METHOD("get_personagem"), &MDSprite::get_personagem);
	ClassDB::bind_method(D_METHOD("set_animacao", "animacao"), &MDSprite::set_animacao);
	ClassDB::bind_method(D_METHOD("get_animacao"), &MDSprite::get_animacao);
	ADD_PROPERTY(PropertyInfo(Variant::OBJECT, "personagem", PROPERTY_HINT_RESOURCE_TYPE, "MDPersonagem"), "set_personagem", "get_personagem");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "animacao", PROPERTY_HINT_ENUM_SUGGESTION, ""), "set_animacao", "get_animacao");
	ClassDB::bind_method(D_METHOD("set_paleta_de", "png"), &MDSprite::set_paleta_de);
	ClassDB::bind_method(D_METHOD("get_paleta_de"), &MDSprite::get_paleta_de);
	// Personagens que dividem uma paleta (jogador, inimigos e HUD na mesma PAL): as cores vão para a
	// cor mais próxima da paleta deste PNG, na ordem dele.
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "paleta_de", PROPERTY_HINT_FILE, "*.png"), "set_paleta_de", "get_paleta_de");
}

MDSprite::MDSprite() {
	set_centered(false);
}

// ---- MDJogador ----

// Sugere as animações de cada estado pelos nomes mais comuns (os do Sota incluídos).
void MDJogador::_personagem_changed() {
	if (personagem.is_null()) {
		return;
	}
	auto guess = [&](String &r_field, std::initializer_list<const char *> p_names) {
		if (!r_field.is_empty() && personagem->find_animation(r_field) >= 0) {
			return;
		}
		for (const char *name : p_names) {
			if (personagem->find_animation(name) >= 0) {
				r_field = name;
				return;
			}
		}
		r_field = String();
	};
	guess(anim_parado, { "parado", "idle", "n_idle", "stand" });
	guess(anim_andando, { "andando", "corrida", "correndo", "run", "walk", "n_corrida" });
	guess(anim_pulando, { "pulando", "pulo", "pulo_frente", "jump", "subindo" });
	guess(anim_caindo, { "caindo", "queda", "fall", "n_queda" });
	// Ataque e morte não são adivinhados: o ataque muda os botões (B deixa de pular).
	if (!anim_parado.is_empty()) {
		animacao = anim_parado;
	}
}

void MDJogador::_validate_property(PropertyInfo &p_property) const {
	if (String(p_property.name).begins_with("anim_")) {
		if (personagem.is_valid()) {
			p_property.hint = PROPERTY_HINT_ENUM;
			p_property.hint_string = "," + String(",").join(personagem->get_animation_names()); // Vazio = usa a do estado mais próximo.
		} else {
			p_property.usage = PROPERTY_USAGE_STORAGE;
		}
	}
	// Visto de cima não há pulo nem gravidade.
	if (p_property.name == "velocidade_correndo" && !botoes_correr) {
		p_property.usage &= ~PROPERTY_USAGE_EDITOR;
	}
	if (modo == MODO_VISTO_DE_CIMA && (p_property.name == "forca_pulo" || p_property.name == "gravidade" || p_property.name == "som_pulo" || p_property.name == "botoes_pulo")) {
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
	som_pulo = RetroMD::resource_path(p_som);
	update_configuration_warnings();
}

void MDJogador::set_som_morte(const String &p_som) {
	som_morte = RetroMD::resource_path(p_som);
	update_configuration_warnings();
}

void MDJogador::set_som_ataque(const String &p_som) {
	som_ataque = RetroMD::resource_path(p_som);
	update_configuration_warnings();
}

void MDJogador::set_botoes_pulo(int p_botoes) {
	botoes_pulo = p_botoes & 63;
	update_configuration_warnings();
}

void MDJogador::set_botoes_ataque(int p_botoes) {
	botoes_ataque = p_botoes & 63;
	update_configuration_warnings();
}

void MDJogador::set_botoes_correr(int p_botoes) {
	botoes_correr = p_botoes & 63;
	update_configuration_warnings();
	notify_property_list_changed();
}

void MDJogador::set_velocidade_correndo(int p_velocidade) {
	velocidade_correndo = CLAMP(p_velocidade, 0, 16);
}

void MDJogador::set_pausa_start(bool p_pausa) {
	pausa_start = p_pausa;
}

int MDJogador::jump_mask() const {
	if (botoes_pulo) {
		return botoes_pulo;
	}
	return anim_ataque.is_empty() ? 7 : 5;
}

int MDJogador::attack_mask() const {
	return botoes_ataque ? botoes_ataque : 2;
}

PackedStringArray MDJogador::get_configuration_warnings() const {
	PackedStringArray warnings = MDSprite::get_configuration_warnings();
	const bool attacks = personagem.is_valid() && !anim_ataque.is_empty();
	if (attacks && (jump_mask() & attack_mask())) {
		warnings.push_back(U("O mesmo botão pula e ataca: escolha botões diferentes em botoes_pulo e botoes_ataque."));
	}
	if (botoes_correr && (jump_mask() & botoes_correr) && modo == MODO_PLATAFORMA) {
		warnings.push_back(U("O mesmo botão pula e corre: escolha botões diferentes em botoes_pulo e botoes_correr."));
	}
	if (personagem.is_null() && get_vframes() < 2) {
		warnings.push_back(U("A folha precisa de 2 linhas: a 0 é a animação parada e a 1, andando."));
	}
	if (personagem.is_valid() && !anim_ataque.is_empty()) {
		const int found = personagem->find_animation(anim_ataque);
		if (found >= 0 && !personagem->get_animations()[found].attack) {
			warnings.push_back(vformat(U("A animação de ataque \"%s\" não tem caixa de ataque: desenhe-a no gestor de animações (Clique marca → a caixa de ataque)."), anim_ataque));
		}
	}
	for (const String &problem : { RetroMD::file_problem(som_pulo, "wav"), RetroMD::file_problem(som_morte, "wav"), RetroMD::file_problem(som_ataque, "wav"), RetroMD::file_problem(som_dano, "wav") }) {
		if (!problem.is_empty()) {
			warnings.push_back(problem);
		}
	}
	return warnings;
}

void MDJogador::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_anim_parado", "anim"), &MDJogador::set_anim_parado);
	ClassDB::bind_method(D_METHOD("get_anim_parado"), &MDJogador::get_anim_parado);
	ClassDB::bind_method(D_METHOD("set_anim_andando", "anim"), &MDJogador::set_anim_andando);
	ClassDB::bind_method(D_METHOD("get_anim_andando"), &MDJogador::get_anim_andando);
	ClassDB::bind_method(D_METHOD("set_anim_pulando", "anim"), &MDJogador::set_anim_pulando);
	ClassDB::bind_method(D_METHOD("get_anim_pulando"), &MDJogador::get_anim_pulando);
	ClassDB::bind_method(D_METHOD("set_anim_caindo", "anim"), &MDJogador::set_anim_caindo);
	ClassDB::bind_method(D_METHOD("get_anim_caindo"), &MDJogador::get_anim_caindo);
	ADD_GROUP(U("Animações do personagem"), "anim_");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "anim_parado"), "set_anim_parado", "get_anim_parado");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "anim_andando"), "set_anim_andando", "get_anim_andando");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "anim_pulando"), "set_anim_pulando", "get_anim_pulando");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "anim_caindo"), "set_anim_caindo", "get_anim_caindo");
	ClassDB::bind_method(D_METHOD("set_anim_ataque", "anim"), &MDJogador::set_anim_ataque);
	ClassDB::bind_method(D_METHOD("get_anim_ataque"), &MDJogador::get_anim_ataque);
	ClassDB::bind_method(D_METHOD("set_anim_morte", "anim"), &MDJogador::set_anim_morte);
	ClassDB::bind_method(D_METHOD("get_anim_morte"), &MDJogador::get_anim_morte);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "anim_ataque"), "set_anim_ataque", "get_anim_ataque");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "anim_morte"), "set_anim_morte", "get_anim_morte");
	ClassDB::bind_method(D_METHOD("set_anim_dano", "anim"), &MDJogador::set_anim_dano);
	ClassDB::bind_method(D_METHOD("get_anim_dano"), &MDJogador::get_anim_dano);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "anim_dano"), "set_anim_dano", "get_anim_dano");
	ADD_GROUP("", "");
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
	ADD_PROPERTY(PropertyInfo(Variant::INT, "gravidade", PROPERTY_HINT_RANGE, U("0,256,1,suffix:1/16 px/quadro²")), "set_gravidade", "get_gravidade");
	ClassDB::bind_method(D_METHOD("set_vidas", "vidas"), &MDJogador::set_vidas);
	ClassDB::bind_method(D_METHOD("get_vidas"), &MDJogador::get_vidas);
	ClassDB::bind_method(D_METHOD("set_som_pulo", "som"), &MDJogador::set_som_pulo);
	ClassDB::bind_method(D_METHOD("get_som_pulo"), &MDJogador::get_som_pulo);
	ClassDB::bind_method(D_METHOD("set_som_morte", "som"), &MDJogador::set_som_morte);
	ClassDB::bind_method(D_METHOD("get_som_morte"), &MDJogador::get_som_morte);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "vidas", PROPERTY_HINT_RANGE, "0,9,1"), "set_vidas", "get_vidas");
	ClassDB::bind_method(D_METHOD("set_energia", "energia"), &MDJogador::set_energia);
	ClassDB::bind_method(D_METHOD("get_energia"), &MDJogador::get_energia);
	ClassDB::bind_method(D_METHOD("set_invencivel", "quadros"), &MDJogador::set_invencivel);
	ClassDB::bind_method(D_METHOD("get_invencivel"), &MDJogador::get_invencivel);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "energia", PROPERTY_HINT_RANGE, "0,9,1"), "set_energia", "get_energia");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "invencivel", PROPERTY_HINT_RANGE, "0,600,1,suffix:quadros"), "set_invencivel", "get_invencivel");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_pulo", PROPERTY_HINT_FILE, "*.wav"), "set_som_pulo", "get_som_pulo");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_morte", PROPERTY_HINT_FILE, "*.wav"), "set_som_morte", "get_som_morte");
	ClassDB::bind_method(D_METHOD("set_som_ataque", "som"), &MDJogador::set_som_ataque);
	ClassDB::bind_method(D_METHOD("get_som_ataque"), &MDJogador::get_som_ataque);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_ataque", PROPERTY_HINT_FILE, "*.wav"), "set_som_ataque", "get_som_ataque");
	ClassDB::bind_method(D_METHOD("set_som_dano", "som"), &MDJogador::set_som_dano);
	ClassDB::bind_method(D_METHOD("get_som_dano"), &MDJogador::get_som_dano);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "som_dano", PROPERTY_HINT_FILE, "*.wav"), "set_som_dano", "get_som_dano");
	ClassDB::bind_method(D_METHOD("set_botoes_pulo", "botoes"), &MDJogador::set_botoes_pulo);
	ClassDB::bind_method(D_METHOD("get_botoes_pulo"), &MDJogador::get_botoes_pulo);
	ClassDB::bind_method(D_METHOD("set_botoes_ataque", "botoes"), &MDJogador::set_botoes_ataque);
	ClassDB::bind_method(D_METHOD("get_botoes_ataque"), &MDJogador::get_botoes_ataque);
	ClassDB::bind_method(D_METHOD("set_botoes_correr", "botoes"), &MDJogador::set_botoes_correr);
	ClassDB::bind_method(D_METHOD("get_botoes_correr"), &MDJogador::get_botoes_correr);
	ClassDB::bind_method(D_METHOD("set_velocidade_correndo", "velocidade"), &MDJogador::set_velocidade_correndo);
	ClassDB::bind_method(D_METHOD("get_velocidade_correndo"), &MDJogador::get_velocidade_correndo);
	ClassDB::bind_method(D_METHOD("set_pausa_start", "pausa"), &MDJogador::set_pausa_start);
	ClassDB::bind_method(D_METHOD("get_pausa_start"), &MDJogador::get_pausa_start);
	ADD_GROUP("Controles", "");
	ClassDB::bind_method(D_METHOD("set_flash_dano", "flash"), &MDJogador::set_flash_dano);
	ClassDB::bind_method(D_METHOD("get_flash_dano"), &MDJogador::get_flash_dano);
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "flash_dano"), "set_flash_dano", "get_flash_dano");
	ClassDB::bind_method(D_METHOD("set_controle", "controle"), &MDJogador::set_controle);
	ClassDB::bind_method(D_METHOD("get_controle"), &MDJogador::get_controle);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "controle", PROPERTY_HINT_RANGE, "1,2,1"), "set_controle", "get_controle");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "botoes_pulo", PROPERTY_HINT_FLAGS, "A,B,C,X,Y,Z"), "set_botoes_pulo", "get_botoes_pulo");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "botoes_ataque", PROPERTY_HINT_FLAGS, "A,B,C,X,Y,Z"), "set_botoes_ataque", "get_botoes_ataque");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "botoes_correr", PROPERTY_HINT_FLAGS, "A,B,C,X,Y,Z"), "set_botoes_correr", "get_botoes_correr");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade_correndo", PROPERTY_HINT_RANGE, "0,16,1,suffix:px/quadro"), "set_velocidade_correndo", "get_velocidade_correndo");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "pausa_start"), "set_pausa_start", "get_pausa_start");
	ADD_GROUP("", "");
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
	som_derrota = RetroMD::resource_path(p_som);
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
	ClassDB::bind_method(D_METHOD("set_vida", "vida"), &MDInimigo::set_vida);
	ClassDB::bind_method(D_METHOD("get_vida"), &MDInimigo::get_vida);
	ClassDB::bind_method(D_METHOD("set_anim_derrota", "anim"), &MDInimigo::set_anim_derrota);
	ClassDB::bind_method(D_METHOD("get_anim_derrota"), &MDInimigo::get_anim_derrota);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "vida", PROPERTY_HINT_RANGE, "1,99,1"), "set_vida", "get_vida");
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "anim_derrota"), "set_anim_derrota", "get_anim_derrota");
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
	som = RetroMD::resource_path(p_som);
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

// ---- MDAtor ----

void MDAtor::set_codigo(const String &p_codigo) {
	codigo = RetroMD::resource_path(p_codigo);
	_update_personagem_preview(); // As animações do atlas são as citadas no código.
	update_configuration_warnings();
}

void MDAtor::set_camera_segue(bool p_segue) {
	camera_segue = p_segue;
}

void MDAtor::set_fixo_na_tela(bool p_fixo) {
	fixo_na_tela = p_fixo;
}

void MDAtor::set_respeita_limite(bool p_respeita) {
	respeita_limite = p_respeita;
}

void MDAtor::set_dano_do_cenario(bool p_dano) {
	dano_do_cenario = p_dano;
}

void MDAtor::set_dorme_longe(bool p_dorme) {
	dorme_longe = p_dorme;
}

void MDAtor::set_vram_da_fonte(bool p_fonte) {
	vram_da_fonte = p_fonte;
}

void MDAtor::set_vida(int p_vida) {
	vida = CLAMP(p_vida, 0, 9999);
}

String MDAtor::get_prefixo() const {
	if (codigo.is_empty()) {
		return String();
	}
	String out;
	const String base = codigo.get_file().get_basename().to_lower();
	for (int i = 0; i < base.length(); i++) {
		const char32_t c = base[i];
		out += is_ascii_alphanumeric_char(c) ? String::chr(c) : String("_");
	}
	if (!out.is_empty() && is_digit(out[0])) {
		out = "a_" + out;
	}
	return out;
}

Vector<int> MDAtor::get_used_animations() const {
	Vector<int> used;
	if (personagem.is_null() || personagem->get_animations().is_empty()) {
		return used;
	}
	const String source = codigo.is_empty() ? String() : FileAccess::get_file_as_string(get_codigo());
	const int start = MAX(0, personagem->find_animation(animacao));
	const Vector<MDPersonagem::Animacao> &anims = personagem->get_animations();
	for (int i = 0; i < anims.size(); i++) {
		String name = "ANIM_";
		const String lower = anims[i].name.to_lower();
		for (int j = 0; j < lower.length(); j++) {
			name += is_ascii_alphanumeric_char(lower[j]) ? String::chr(lower[j]).to_upper() : String("_");
		}
		// O nome inteiro: ANIM_N_IDLE não conta como ANIM_N_IDLE_2.
		bool cited = source.is_empty();
		for (int at = source.find(name); !cited && at >= 0; at = source.find(name, at + 1)) {
			const int end = at + name.length();
			cited = end >= source.length() || !(is_ascii_alphanumeric_char(source[end]) || source[end] == '_');
		}
		if (cited || i == start) {
			used.push_back(i);
		}
	}
	return used;
}

PackedStringArray MDAtor::get_configuration_warnings() const {
	PackedStringArray warnings = MDSprite::get_configuration_warnings();
	if (codigo.is_empty()) {
		warnings.push_back(U("Sem código o ator fica parado. Crie um em Projeto → Ferramentas → Criar código do ator (com o node selecionado)."));
	} else if (!FileAccess::exists(codigo)) {
		warnings.push_back(U("O código ") + codigo + U(" não existe."));
	} else if (codigo.get_extension() != "c") {
		warnings.push_back(U("O código do ator precisa ser um arquivo .c."));
	}
	return warnings;
}

void MDAtor::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_codigo", "codigo"), &MDAtor::set_codigo);
	ClassDB::bind_method(D_METHOD("get_codigo"), &MDAtor::get_codigo);
	ClassDB::bind_method(D_METHOD("set_camera_segue", "segue"), &MDAtor::set_camera_segue);
	ClassDB::bind_method(D_METHOD("get_camera_segue"), &MDAtor::get_camera_segue);
	ClassDB::bind_method(D_METHOD("set_vida", "vida"), &MDAtor::set_vida);
	ClassDB::bind_method(D_METHOD("get_vida"), &MDAtor::get_vida);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "codigo", PROPERTY_HINT_FILE, "*.c"), "set_codigo", "get_codigo");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "camera_segue"), "set_camera_segue", "get_camera_segue");
	ClassDB::bind_method(D_METHOD("set_fixo_na_tela", "fixo"), &MDAtor::set_fixo_na_tela);
	ClassDB::bind_method(D_METHOD("get_fixo_na_tela"), &MDAtor::get_fixo_na_tela);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "vida", PROPERTY_HINT_RANGE, "0,9999,1"), "set_vida", "get_vida");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "fixo_na_tela"), "set_fixo_na_tela", "get_fixo_na_tela");
	ClassDB::bind_method(D_METHOD("set_vram_da_fonte", "fonte"), &MDAtor::set_vram_da_fonte);
	ClassDB::bind_method(D_METHOD("get_vram_da_fonte"), &MDAtor::get_vram_da_fonte);
	// Créditos, avisos que aparecem um pouco: os tiles ocupam o lugar da fonte (96), não a VRAM dos sprites.
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "vram_da_fonte"), "set_vram_da_fonte", "get_vram_da_fonte");
	ClassDB::bind_method(D_METHOD("set_dorme_longe", "dorme"), &MDAtor::set_dorme_longe);
	ClassDB::bind_method(D_METHOD("get_dorme_longe"), &MDAtor::get_dorme_longe);
	// Inimigos espalhados pela fase: longe da tela ficam sem sprite e sem rodar o código, e a VRAM
	// só precisa dos que cabem perto da tela ao mesmo tempo.
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "dorme_longe"), "set_dorme_longe", "get_dorme_longe");
	ClassDB::bind_method(D_METHOD("set_respeita_limite", "respeita"), &MDAtor::set_respeita_limite);
	ClassDB::bind_method(D_METHOD("get_respeita_limite"), &MDAtor::get_respeita_limite);
	ClassDB::bind_method(D_METHOD("set_dano_do_cenario", "dano"), &MDAtor::set_dano_do_cenario);
	ClassDB::bind_method(D_METHOD("get_dano_do_cenario"), &MDAtor::get_dano_do_cenario);
	// Células de limite da MDColisao são paredes para este ator (inimigos que não saem da área).
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "respeita_limite"), "set_respeita_limite", "get_respeita_limite");
	// Dano e morte do cenário (MDColisao) agem nele: o efeito pronto, ou <nome>_cenario no código.
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "dano_do_cenario"), "set_dano_do_cenario", "get_dano_do_cenario");
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

void MDMapa::set_rolagem(int p_percent) {
	rolagem = CLAMP(p_percent, 0, 200);
}

void MDMapa::set_rolagem_vertical(int p_percent) {
	rolagem_vertical = CLAMP(p_percent, 0, 200);
}

void MDMapa::set_na_frente(bool p_na_frente) {
	na_frente = p_na_frente;
}

Ref<Texture2D> MDMapa::get_atlas_texture() const {
	const Ref<TileSet> tiles = get_tile_set();
	if (tiles.is_null() || tiles->get_source_count() != 1) {
		return Ref<Texture2D>();
	}
	const Ref<TileSetAtlasSource> atlas = tiles->get_source(tiles->get_source_id(0));
	return atlas.is_valid() ? atlas->get_texture() : Ref<Texture2D>();
}

void MDMapa::_notification(int p_what) {
	if (p_what == NOTIFICATION_ENTER_TREE && Engine::get_singleton()->is_editor_hint()) {
		RetroMD::fix_tile_set(get_tile_set(), get_name());
	}
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
	for (int i = 0; i < tiles->get_source_count(); i++) {
		const Ref<TileSetAtlasSource> atlas = tiles->get_source(tiles->get_source_id(i));
		if (atlas.is_valid() && atlas->get_texture_region_size() != size) {
			warnings.push_back(vformat(U("O atlas recorta a imagem em tiles de %d×%d px, mas as células são de %d×%d: no 2D os tiles transbordam e o jogo só pega um pedaço de cada. Use \"Ajustar os tiles para 8×8\" no Inspetor ou no Editor de mapas."), atlas->get_texture_region_size().x, atlas->get_texture_region_size().y, size.x, size.y));
			break;
		}
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
	ADD_PROPERTY(PropertyInfo(Variant::INT, "plano", PROPERTY_HINT_ENUM, U("BG B (atrás),BG A (frente)")), "set_plano", "get_plano");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta", PROPERTY_HINT_RANGE, "0,3,1"), "set_paleta", "get_paleta");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "solido"), "set_solido", "is_solido");
	ClassDB::bind_method(D_METHOD("set_rolagem", "porcento"), &MDMapa::set_rolagem);
	ClassDB::bind_method(D_METHOD("get_rolagem"), &MDMapa::get_rolagem);
	ClassDB::bind_method(D_METHOD("set_rolagem_vertical", "porcento"), &MDMapa::set_rolagem_vertical);
	ClassDB::bind_method(D_METHOD("get_rolagem_vertical"), &MDMapa::get_rolagem_vertical);
	ClassDB::bind_method(D_METHOD("set_na_frente", "na_frente"), &MDMapa::set_na_frente);
	ClassDB::bind_method(D_METHOD("is_na_frente"), &MDMapa::is_na_frente);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "rolagem", PROPERTY_HINT_RANGE, "0,200,1,suffix:%"), "set_rolagem", "get_rolagem");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "rolagem_vertical", PROPERTY_HINT_RANGE, "0,200,1,suffix:%"), "set_rolagem_vertical", "get_rolagem_vertical");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "na_frente"), "set_na_frente", "is_na_frente");
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

void MDTexto::set_valor(Valor p_valor) {
	valor = p_valor;
	queue_redraw();
	notify_property_list_changed();
}

void MDTexto::set_digitos(int p_digitos) {
	digitos = CLAMP(p_digitos, 0, 10);
	queue_redraw();
}

void MDTexto::set_simbolo(const String &p_simbolo) {
	simbolo = p_simbolo.substr(0, 1);
	queue_redraw();
	update_configuration_warnings();
}

void MDTexto::_notification(int p_what) {
	if (p_what != NOTIFICATION_DRAW) {
		return;
	}
	// Prévia aproximada: a fonte do editor no tamanho dos tiles do console; o valor aparece como exemplo.
	String shown = texto;
	const int places = digitos > 0 ? digitos : (valor == VALOR_PONTOS ? 6 : 1);
	switch (valor) {
		case VALOR_PONTOS:
			shown += String("0").repeat(places);
			break;
		case VALOR_VIDAS:
			shown += String("0").repeat(places - 1) + "3";
			break;
		case VALOR_ENERGIA:
			shown += String("0").repeat(places - 1) + "5";
			break;
		case VALOR_ENERGIA_BARRA:
			shown += simbolo.is_empty() ? String() : simbolo.repeat(5);
			break;
		default:
			break;
	}
	const Ref<Font> font = ThemeDB::get_singleton()->get_fallback_font();
	for (int i = 0; i < shown.length(); i++) {
		draw_string(font, Vector2(i * 8, 7), String::chr(shown[i]), HORIZONTAL_ALIGNMENT_LEFT, -1, 9, i < texto.length() ? Color(1, 1, 1) : Color(1, 0.85, 0.4));
	}
}

PackedStringArray MDTexto::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (!_aligned(get_position())) {
		warnings.push_back(U("A posição precisa ser múltipla de 8 (o texto é escrito em tiles)."));
	}
	const String all = texto + (valor == VALOR_ENERGIA_BARRA ? simbolo : String());
	for (int i = 0; i < all.length(); i++) {
		if (all[i] < 32 || all[i] > 126) {
			warnings.push_back(U("A fonte do SGDK só tem os caracteres ASCII (sem acentos)."));
			break;
		}
	}
	if (valor == VALOR_ENERGIA_BARRA && simbolo.is_empty()) {
		warnings.push_back(U("Escolha o símbolo da barra de energia."));
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
	ClassDB::bind_method(D_METHOD("set_valor", "valor"), &MDTexto::set_valor);
	ClassDB::bind_method(D_METHOD("get_valor"), &MDTexto::get_valor);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "valor", PROPERTY_HINT_ENUM, U("Nenhum (só o texto),Pontos,Vidas,Energia (número),Energia (barra)")), "set_valor", "get_valor");
	ClassDB::bind_method(D_METHOD("set_digitos", "digitos"), &MDTexto::set_digitos);
	ClassDB::bind_method(D_METHOD("get_digitos"), &MDTexto::get_digitos);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "digitos", PROPERTY_HINT_RANGE, U("0,10,1,suffix:(0 = automático)")), "set_digitos", "get_digitos");
	ClassDB::bind_method(D_METHOD("set_simbolo", "simbolo"), &MDTexto::set_simbolo);
	ClassDB::bind_method(D_METHOD("get_simbolo"), &MDTexto::get_simbolo);
	ADD_PROPERTY(PropertyInfo(Variant::STRING, "simbolo"), "set_simbolo", "get_simbolo");
	BIND_ENUM_CONSTANT(VALOR_NENHUM);
	BIND_ENUM_CONSTANT(VALOR_PONTOS);
	BIND_ENUM_CONSTANT(VALOR_VIDAS);
	BIND_ENUM_CONSTANT(VALOR_ENERGIA);
	BIND_ENUM_CONSTANT(VALOR_ENERGIA_BARRA);
}

// ---- MDSaida ----

void MDSaida::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(1);
	queue_redraw();
}

void MDSaida::set_destino(const String &p_destino) {
	destino = RetroMD::resource_path(p_destino);
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

// ---- MDCamera ----

void MDCamera::set_folga(const Vector2i &p_folga) {
	folga = Vector2i(CLAMP(p_folga.x, 0, RetroMD::SCREEN_WIDTH - 32), CLAMP(p_folga.y, 0, RetroMD::SCREEN_HEIGHT - 32));
	queue_redraw();
}

void MDCamera::set_suavidade(int p_suavidade) {
	suavidade = CLAMP(p_suavidade, 0, 5);
}

void MDCamera::set_a_frente(int p_a_frente) {
	a_frente = CLAMP(p_a_frente, 0, 96);
	queue_redraw();
}

void MDCamera::_notification(int p_what) {
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		const Vector2 screen(RetroMD::SCREEN_WIDTH, RetroMD::SCREEN_HEIGHT);
		draw_rect(Rect2(Vector2(), screen), Color(1, 0.6, 0.2, 0.9), false, 1);
		const Rect2 slack((screen - Vector2(folga)) / 2, Vector2(folga));
		draw_rect(slack, Color(1, 0.6, 0.2, 0.15));
		draw_rect(slack, Color(1, 0.6, 0.2, 0.7), false, 1);
		if (a_frente > 0) {
			const Vector2 middle = screen / 2;
			draw_line(middle, middle + Vector2(a_frente, 0), Color(1, 0.6, 0.2, 0.9), 1);
		}
	}
}

PackedStringArray MDCamera::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (get_rotation() != 0 || get_scale() != Vector2(1, 1)) {
		warnings.push_back(U("A câmera não gira nem muda de escala."));
	}
	return warnings;
}

void MDCamera::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_folga", "folga"), &MDCamera::set_folga);
	ClassDB::bind_method(D_METHOD("get_folga"), &MDCamera::get_folga);
	ClassDB::bind_method(D_METHOD("set_suavidade", "suavidade"), &MDCamera::set_suavidade);
	ClassDB::bind_method(D_METHOD("get_suavidade"), &MDCamera::get_suavidade);
	ClassDB::bind_method(D_METHOD("set_a_frente", "a_frente"), &MDCamera::set_a_frente);
	ClassDB::bind_method(D_METHOD("get_a_frente"), &MDCamera::get_a_frente);
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "folga", PROPERTY_HINT_NONE, "suffix:px"), "set_folga", "get_folga");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "suavidade", PROPERTY_HINT_RANGE, U("0,5,1")), "set_suavidade", "get_suavidade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "a_frente", PROPERTY_HINT_RANGE, U("0,96,1,suffix:px")), "set_a_frente", "get_a_frente");
}

// ---- MDZonaCamera ----

void MDZonaCamera::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(8);
	queue_redraw();
}

void MDZonaCamera::_notification(int p_what) {
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
		draw_rect(area, Color(1, 0.85, 0.2, 0.08));
		draw_rect(area, Color(1, 0.85, 0.2, 0.8), false, 2);
	}
}

PackedStringArray MDZonaCamera::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (get_rotation() != 0 || get_scale() != Vector2(1, 1)) {
		warnings.push_back(U("A zona não gira nem muda de escala; use o tamanho."));
	}
	return warnings;
}

void MDZonaCamera::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDZonaCamera::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDZonaCamera::get_tamanho);
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
}

// ---- MDCorrenteza ----

void MDCorrenteza::set_tamanho(const Vector2i &p_tamanho) {
	tamanho = p_tamanho.maxi(8);
	queue_redraw();
}

void MDCorrenteza::set_plano(MDFundo::Plano p_plano) {
	plano = p_plano;
}

void MDCorrenteza::set_modo(Modo p_modo) {
	modo = p_modo;
	notify_property_list_changed();
	queue_redraw();
}

void MDCorrenteza::set_velocidade(int p_velocidade) {
	velocidade = CLAMP(p_velocidade, 0, 240); // 0: a faixa só acompanha a câmera (parallax).
}

void MDCorrenteza::set_direcao(Direcao p_direcao) {
	direcao = p_direcao;
}

void MDCorrenteza::set_periodo(int p_periodo) {
	periodo = CLAMP(p_periodo, 2, 184); // 184 px: a janela (41 colunas) mais a volta cabem no plano de 64 colunas.
}

void MDCorrenteza::set_rolagem_propria(bool p_propria) {
	rolagem_propria = p_propria;
	notify_property_list_changed();
}

void MDCorrenteza::set_rolagem(int p_percent) {
	rolagem = CLAMP(p_percent, 0, 200);
}

void MDCorrenteza::set_amplitude(int p_amplitude) {
	amplitude = CLAMP(p_amplitude, 1, 4);
}

void MDCorrenteza::set_passos_por_segundo(int p_passos) {
	passos_por_segundo = CLAMP(p_passos, 1, 30);
}

void MDCorrenteza::_notification(int p_what) {
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint()) {
		const Rect2 area = Rect2(Vector2(), Vector2(tamanho));
		const Color color = modo == MODO_CORRENTEZA ? Color(0.3, 0.7, 1.0) : Color(0.5, 1.0, 0.9);
		draw_rect(area, Color(color, 0.12));
		draw_rect(area, Color(color, 0.85), false, 2);
	}
}

PackedStringArray MDCorrenteza::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (get_rotation() != 0 || get_scale() != Vector2(1, 1)) {
		warnings.push_back(U("A área não gira nem muda de escala; use o tamanho."));
	}
	return warnings;
}

void MDCorrenteza::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
	const bool flowing = modo == MODO_CORRENTEZA;
	if ((!flowing && (p_property.name == "velocidade" || p_property.name == "direcao" || p_property.name == "periodo")) ||
			(flowing && (p_property.name == "amplitude" || p_property.name == "passos_por_segundo")) ||
			((!flowing || !rolagem_propria) && p_property.name == "rolagem") || (!flowing && p_property.name == "rolagem_propria")) {
		p_property.usage = PROPERTY_USAGE_NO_EDITOR;
	}
}

void MDCorrenteza::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_tamanho", "tamanho"), &MDCorrenteza::set_tamanho);
	ClassDB::bind_method(D_METHOD("get_tamanho"), &MDCorrenteza::get_tamanho);
	ClassDB::bind_method(D_METHOD("set_plano", "plano"), &MDCorrenteza::set_plano);
	ClassDB::bind_method(D_METHOD("get_plano"), &MDCorrenteza::get_plano);
	ClassDB::bind_method(D_METHOD("set_modo", "modo"), &MDCorrenteza::set_modo);
	ClassDB::bind_method(D_METHOD("get_modo"), &MDCorrenteza::get_modo);
	ClassDB::bind_method(D_METHOD("set_velocidade", "velocidade"), &MDCorrenteza::set_velocidade);
	ClassDB::bind_method(D_METHOD("get_velocidade"), &MDCorrenteza::get_velocidade);
	ClassDB::bind_method(D_METHOD("set_direcao", "direcao"), &MDCorrenteza::set_direcao);
	ClassDB::bind_method(D_METHOD("get_direcao"), &MDCorrenteza::get_direcao);
	ClassDB::bind_method(D_METHOD("set_periodo", "periodo"), &MDCorrenteza::set_periodo);
	ClassDB::bind_method(D_METHOD("get_periodo"), &MDCorrenteza::get_periodo);
	ClassDB::bind_method(D_METHOD("set_amplitude", "amplitude"), &MDCorrenteza::set_amplitude);
	ClassDB::bind_method(D_METHOD("get_amplitude"), &MDCorrenteza::get_amplitude);
	ClassDB::bind_method(D_METHOD("set_passos_por_segundo", "passos"), &MDCorrenteza::set_passos_por_segundo);
	ClassDB::bind_method(D_METHOD("get_passos_por_segundo"), &MDCorrenteza::get_passos_por_segundo);
	ADD_PROPERTY(PropertyInfo(Variant::VECTOR2I, "tamanho", PROPERTY_HINT_NONE, "suffix:px"), "set_tamanho", "get_tamanho");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "plano", PROPERTY_HINT_ENUM, U("BG B (atrás),BG A (frente)")), "set_plano", "get_plano");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "modo", PROPERTY_HINT_ENUM, U("Correnteza,Ondulação")), "set_modo", "get_modo");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade", PROPERTY_HINT_RANGE, "0,240,1,suffix:px/s"), "set_velocidade", "get_velocidade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "direcao", PROPERTY_HINT_ENUM, "Esquerda,Direita"), "set_direcao", "get_direcao");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "periodo", PROPERTY_HINT_RANGE, "2,184,1,suffix:px"), "set_periodo", "get_periodo");
	ClassDB::bind_method(D_METHOD("set_rolagem_propria", "propria"), &MDCorrenteza::set_rolagem_propria);
	ClassDB::bind_method(D_METHOD("is_rolagem_propria"), &MDCorrenteza::is_rolagem_propria);
	ClassDB::bind_method(D_METHOD("set_rolagem", "porcento"), &MDCorrenteza::set_rolagem);
	ClassDB::bind_method(D_METHOD("get_rolagem"), &MDCorrenteza::get_rolagem);
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "rolagem_propria"), "set_rolagem_propria", "is_rolagem_propria");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "rolagem", PROPERTY_HINT_RANGE, "0,200,1,suffix:%"), "set_rolagem", "get_rolagem");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "amplitude", PROPERTY_HINT_RANGE, "1,4,1,suffix:px"), "set_amplitude", "get_amplitude");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "passos_por_segundo", PROPERTY_HINT_RANGE, "1,30,1"), "set_passos_por_segundo", "get_passos_por_segundo");
	BIND_ENUM_CONSTANT(MODO_CORRENTEZA);
	BIND_ENUM_CONSTANT(MODO_ONDULACAO);
	BIND_ENUM_CONSTANT(DIRECAO_ESQUERDA);
	BIND_ENUM_CONSTANT(DIRECAO_DIREITA);
}

void MDCamera::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
}

void MDZonaCamera::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
}

void MDCena::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
}

void MDFundo::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_FUNDO);
}

void MDSprite::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_SPRITE);
	const StringName &name = p_property.name;
	if (personagem.is_valid()) {
		// A folha, os quadros e o tempo vêm do personagem: o atlas da prévia não vai para a cena.
		if (name == "texture" || name == "hframes" || name == "vframes" || name == "frame" || name == "frame_coords" || name == "velocidade_animacao" || name == "offset") {
			p_property.usage = PROPERTY_USAGE_NONE;
		} else if (name == "animacao") {
			p_property.hint = PROPERTY_HINT_ENUM;
			p_property.hint_string = String(",").join(personagem->get_animation_names());
		}
	} else if (name == "animacao") {
		p_property.usage = PROPERTY_USAGE_STORAGE;
	}
}

void MDMapa::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_MAPA);
}

void MDTexto::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_NODE2D);
	if (p_property.name == "digitos" && (valor == VALOR_NENHUM || valor == VALOR_ENERGIA_BARRA)) {
		p_property.usage = PROPERTY_USAGE_STORAGE;
	} else if (p_property.name == "simbolo" && valor != VALOR_ENERGIA_BARRA) {
		p_property.usage = PROPERTY_USAGE_STORAGE;
	}
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
	som = RetroMD::resource_path(p_som);
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

// ---- MDColisao ----

PackedStringArray MDColisao::get_configuration_warnings() const {
	PackedStringArray warnings = TileMapLayer::get_configuration_warnings();
	const Ref<TileSet> tiles = get_tile_set();
	if (tiles.is_null()) {
		warnings.push_back(U("Falta o TileSet. O dado personalizado \"tipo\" de cada tile diz o que ele é (solido, atravessavel, dano, agua, morte, escada, gelo, limite, areia ou um nome próprio); sem ele, tudo é sólido."));
	} else if (tiles->get_tile_size().x % 8 || tiles->get_tile_size().y % 8) {
		warnings.push_back(U("Os tiles precisam ter lados múltiplos de 8 (a colisão é uma grade de 8×8)."));
	} else if (tiles->get_tile_shape() != TileSet::TILE_SHAPE_SQUARE) {
		warnings.push_back(U("O TileSet não está com tiles quadrados (Tile Shape): a pintura fica desalinhada da grade de 8×8. Use Square."));
	}
	if (get_used_rect().position.x < 0 || get_used_rect().position.y < 0) {
		warnings.push_back(U("Há células em coordenadas negativas; a colisão começa no canto (0, 0)."));
	}
	if (get_position() != Vector2() || get_rotation() != 0 || get_scale() != Vector2(1, 1)) {
		warnings.push_back(U("A camada fica na posição (0, 0), sem rotação nem escala."));
	}
	return warnings;
}

void MDColisao::_validate_property(PropertyInfo &p_property) const {
	static const char *const kept[] = { "visible", "tile_map_data", "tile_set", "enabled", nullptr };
	RetroMD::hide_unsupported(this, p_property, kept);
}

String MDColisao::get_nome_tipo(const Vector2i &p_cell) const {
	const Ref<TileSet> tiles = get_tile_set();
	if (tiles.is_null() || tiles->get_custom_data_layer_by_name("tipo") < 0) {
		return "solido";
	}
	const Ref<TileSetAtlasSource> atlas = tiles->get_source(get_cell_source_id(p_cell));
	const TileData *tile = atlas.is_valid() ? atlas->get_tile_data(get_cell_atlas_coords(p_cell), get_cell_alternative_tile(p_cell)) : nullptr;
	String nome = tile ? String(tile->get_custom_data("tipo")).strip_edges().to_lower() : String();
	nome = nome.replace(U("á"), "a").replace(U("â"), "a").replace(U("ã"), "a").replace(U("é"), "e").replace(U("ê"), "e").replace(U("í"), "i").replace(U("ó"), "o").replace(U("ô"), "o").replace(U("ú"), "u").replace(U("ç"), "c");
	return nome.is_empty() ? String("solido") : nome;
}

int MDColisao::tipo_pronto(const String &p_nome) {
	static const char *const nomes[] = { "", "solido", "atravessavel", "dano", "agua", "morte", "escada", "gelo", "limite", "areia" };
	if (p_nome == "espinho") {
		return TIPO_ESPINHO;
	}
	if (p_nome == "areia movedica" || p_nome == "areia_movedica" || p_nome == "areiamovedica") {
		return TIPO_AREIA;
	}
	for (int i = 1; i <= TIPO_AREIA; i++) {
		if (p_nome == nomes[i]) {
			return i;
		}
	}
	return 0;
}

Ref<TileSet> MDColisao::create_default_tile_set() {
	// Um tile de 8×8 por tipo pronto, na ordem dos números (o sólido em 0:0 e o atravessável em 1:0, como
	// nos TileSets antigos), cada um com um desenho para reconhecer ao pintar.
	const int count = TIPO_AREIA;
	Ref<Image> image = Image::create_empty(count * 8, 8, false, Image::FORMAT_RGBA8);
	for (int t = 1; t <= count; t++) {
		const int ox = (t - 1) * 8;
		for (int y = 0; y < 8; y++) {
			for (int x = 0; x < 8; x++) {
				Color c(0, 0, 0, 0);
				switch (t) {
					case TIPO_SOLIDO: // Bloco vermelho com borda clara.
						c = (x == 0 || y == 0) ? Color(1, 0.55, 0.55) : Color(0.85, 0.15, 0.15);
						break;
					case TIPO_ATRAVESSAVEL: // Prancha verde: sólida só em cima.
						c = y < 2 ? Color(0.3, 1, 0.3) : (y == 2 && (x & 2) ? Color(0.3, 1, 0.3, 0.6) : Color(0.3, 1, 0.3, 0.18));
						break;
					case TIPO_ESPINHO: // Espinhos rosa.
						c = Math::abs((x % 4) - 1.5f) <= (y - 1) / 3.0f ? Color(1, 0.25, 0.85) : Color(1, 0.25, 0.85, 0.12);
						break;
					case TIPO_AGUA: // Ondas azuis.
						c = ((y + (x / 2 % 2)) % 4 == 0) ? Color(0.75, 0.9, 1) : Color(0.2, 0.5, 1, 0.65);
						break;
					case TIPO_MORTE: // Caveira: preto com um X branco.
						c = (x == y || x == 7 - y) ? Color(1, 1, 1) : Color(0.1, 0, 0.15, 0.9);
						break;
					case TIPO_ESCADA: // Degraus marrons.
						c = (x == 1 || x == 6 || y % 3 == 1) ? Color(0.8, 0.55, 0.25) : Color(0.8, 0.55, 0.25, 0.12);
						break;
					case TIPO_GELO: // Azul-claro com brilho.
						c = (x + y == 3 || x + y == 4) ? Color(1, 1, 1) : Color(0.6, 0.95, 1, 0.75);
						break;
					case TIPO_LIMITE: // Listras amarelas (só para inimigos).
						c = ((x + y) % 4 < 2) ? Color(1, 0.85, 0.1, 0.9) : Color(0.2, 0.2, 0.2, 0.5);
						break;
					case TIPO_AREIA: // Areia ocre com grãos e uma seta para baixo (afunda).
						if (x == 3 || x == 4) {
							c = y < 6 ? Color(0.35, 0.18, 0.05) : Color(0.85, 0.6, 0.25, 0.85);
						} else if (y == 5 && (x == 2 || x == 5)) {
							c = Color(0.35, 0.18, 0.05);
						} else {
							c = ((x * 3 + y * 5) % 7 == 0) ? Color(1, 0.85, 0.55) : Color(0.85, 0.6, 0.25, 0.85);
						}
						break;
				}
				image->set_pixel(ox + x, y, c);
			}
		}
	}
	Ref<TileSet> tiles;
	tiles.instantiate();
	tiles->set_tile_size(Vector2i(8, 8));
	tiles->add_custom_data_layer();
	tiles->set_custom_data_layer_name(0, "tipo");
	tiles->set_custom_data_layer_type(0, Variant::STRING);
	Ref<TileSetAtlasSource> atlas;
	atlas.instantiate();
	atlas->set_texture(ImageTexture::create_from_image(image));
	atlas->set_texture_region_size(Vector2i(8, 8));
	tiles->add_source(atlas);
	const char *names[] = { "solido", "atravessavel", "dano", "agua", "morte", "escada", "gelo", "limite", "areia" };
	for (int i = 0; i < count; i++) {
		atlas->create_tile(Vector2i(i, 0));
		atlas->get_tile_data(Vector2i(i, 0), 0)->set_custom_data("tipo", names[i]);
	}
	return tiles;
}

int MDColisao::atualizar_tipos() {
	// Lê o tipo de cada célula com o TileSet atual e pinta de novo com o tile do mesmo tipo no padrão.
	struct Pintada {
		Vector2i cell;
		int tipo;
	};
	Vector<Pintada> cells;
	int proprios = 0;
	for (const Vector2i &cell : get_used_cells()) {
		const int tipo = tipo_pronto(get_nome_tipo(cell));
		if (tipo == 0) {
			proprios++;
			continue;
		}
		cells.push_back({ cell, tipo });
	}
	clear();
	const Ref<TileSet> tiles = create_default_tile_set();
	set_tile_set(tiles);
	const int source = tiles->get_source_id(0);
	for (const Pintada &p : cells) {
		set_cell(p.cell, source, Vector2i(p.tipo - 1, 0));
	}
	return proprios;
}

void MDColisao::_bind_methods() {
	ClassDB::bind_method(D_METHOD("atualizar_tipos"), &MDColisao::atualizar_tipos);
}

void MDColisao::_notification(int p_what) {
	if (p_what == NOTIFICATION_ENTER_TREE && Engine::get_singleton()->is_editor_hint()) {
		if (get_tile_set().is_null()) {
			set_tile_set(create_default_tile_set());
		}
		RetroMD::fix_tile_set(get_tile_set(), get_name());
	}
}

// ---- MDPrioridade ----

void MDPrioridade::set_plano(MDFundo::Plano p_plano) {
	plano = p_plano;
}

void MDPrioridade::_validate_property(PropertyInfo &p_property) const {
	static const char *const kept[] = { "visible", "tile_map_data", "tile_set", "enabled", nullptr };
	RetroMD::hide_unsupported(this, p_property, kept);
}

void MDPrioridade::_notification(int p_what) {
	if (p_what == NOTIFICATION_ENTER_TREE && Engine::get_singleton()->is_editor_hint()) {
		if (get_tile_set().is_null()) {
			set_tile_set(MDColisao::create_default_tile_set());
		}
		RetroMD::fix_tile_set(get_tile_set(), get_name());
	}
}

void MDPrioridade::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_plano", "plano"), &MDPrioridade::set_plano);
	ClassDB::bind_method(D_METHOD("get_plano"), &MDPrioridade::get_plano);
	ADD_PROPERTY(PropertyInfo(Variant::INT, "plano", PROPERTY_HINT_ENUM, U("BG B (atrás),BG A (frente)")), "set_plano", "get_plano");
}

MDPrioridade::MDPrioridade() {
	set_self_modulate(Color(1, 0.8, 0.2, 0.35));
}

MDColisao::MDColisao() {
	// No editor, a colisão fica por cima do desenho sem escondê-lo.
	set_self_modulate(Color(1, 1, 1, 0.45));
}
