#include "md_nodes.h"

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
	musica = p_musica;
	update_configuration_warnings();
}

void MDCena::set_start_vai_para(const String &p_cena) {
	start_vai_para = p_cena;
	update_configuration_warnings();
}

void MDCena::set_ao_fim_da_animacao(const String &p_cena) {
	ao_fim_da_animacao = p_cena;
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
	paleta_de = p_png;
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
	notify_property_list_changed();
	update_configuration_warnings();
}

// O gestor de animações editou o personagem: mesma atualização de quando ele é escolhido.
void MDSprite::_on_personagem_edited() {
	set_personagem(personagem);
}

void MDSprite::set_animacao(const String &p_animacao) {
	animacao = p_animacao;
	_update_personagem_preview();
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
	som_dano = p_som;
	update_configuration_warnings();
}

// No editor, o atlas do personagem vira a textura do Sprite2D (em memória, não vai para a cena) e a
// animação escolhida é a linha mostrada.
void MDSprite::_update_personagem_preview() {
	if (personagem.is_null() || personagem->get_animations().is_empty() || !Engine::get_singleton()->is_editor_hint()) {
		return;
	}
	// O mesmo atlas que o build exporta (só as animações usadas), para a posição bater com a do jogo.
	const Vector<int> used = get_used_animations();
	const Ref<Image> atlas = personagem->build_atlas(nullptr, used);
	if (atlas.is_null()) {
		return;
	}
	set_texture(ImageTexture::create_from_image(atlas));
	set_offset(-Vector2(get_apoio()));
	set_hframes(personagem->get_max_frames(used));
	set_vframes(used.size());
	set_frame(MAX(0, get_used_row(animacao)) * personagem->get_max_frames(used));
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

void MDSprite::_notification(int p_what) {
	if (p_what == NOTIFICATION_DRAW && Engine::get_singleton()->is_editor_hint() && _shows_collision_box()) {
		// A caixa é relativa ao canto da célula; o desenho do personagem está deslocado pelo apoio.
		draw_rect(Rect2(Vector2(get_caixa_efetiva().position) + get_offset(), get_caixa_efetiva().size), Color(1, 0.3, 0.3, 0.8), false, 1);
	}
}

PackedStringArray MDSprite::get_configuration_warnings() const {
	PackedStringArray warnings = Sprite2D::get_configuration_warnings();
	if (!paleta_de.is_empty() && RetroMD::png_palette(paleta_de).is_empty()) {
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
	som_pulo = p_som;
	update_configuration_warnings();
}

void MDJogador::set_som_morte(const String &p_som) {
	som_morte = p_som;
	update_configuration_warnings();
}

void MDJogador::set_som_ataque(const String &p_som) {
	som_ataque = p_som;
	update_configuration_warnings();
}

void MDJogador::set_botoes_pulo(int p_botoes) {
	botoes_pulo = p_botoes & 7;
	update_configuration_warnings();
}

void MDJogador::set_botoes_ataque(int p_botoes) {
	botoes_ataque = p_botoes & 7;
	update_configuration_warnings();
}

void MDJogador::set_botoes_correr(int p_botoes) {
	botoes_correr = p_botoes & 7;
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
	ADD_PROPERTY(PropertyInfo(Variant::INT, "botoes_pulo", PROPERTY_HINT_FLAGS, "A,B,C"), "set_botoes_pulo", "get_botoes_pulo");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "botoes_ataque", PROPERTY_HINT_FLAGS, "A,B,C"), "set_botoes_ataque", "get_botoes_ataque");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "botoes_correr", PROPERTY_HINT_FLAGS, "A,B,C"), "set_botoes_correr", "get_botoes_correr");
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

// ---- MDAtor ----

void MDAtor::set_codigo(const String &p_codigo) {
	codigo = p_codigo;
	update_configuration_warnings();
}

void MDAtor::set_camera_segue(bool p_segue) {
	camera_segue = p_segue;
}

void MDAtor::set_fixo_na_tela(bool p_fixo) {
	fixo_na_tela = p_fixo;
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
	const String source = codigo.is_empty() ? String() : FileAccess::get_file_as_string(codigo);
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
	ADD_PROPERTY(PropertyInfo(Variant::INT, "plano", PROPERTY_HINT_ENUM, U("BG B (atrás),BG A (frente)")), "set_plano", "get_plano");
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
	velocidade = CLAMP(p_velocidade, 1, 240);
}

void MDCorrenteza::set_direcao(Direcao p_direcao) {
	direcao = p_direcao;
}

void MDCorrenteza::set_periodo(int p_periodo) {
	periodo = CLAMP(p_periodo, 2, 128);
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
			(flowing && (p_property.name == "amplitude" || p_property.name == "passos_por_segundo"))) {
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
	ADD_PROPERTY(PropertyInfo(Variant::INT, "velocidade", PROPERTY_HINT_RANGE, "1,240,1,suffix:px/s"), "set_velocidade", "get_velocidade");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "direcao", PROPERTY_HINT_ENUM, "Esquerda,Direita"), "set_direcao", "get_direcao");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "periodo", PROPERTY_HINT_RANGE, "2,128,1,suffix:px"), "set_periodo", "get_periodo");
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

// ---- MDColisao ----

PackedStringArray MDColisao::get_configuration_warnings() const {
	PackedStringArray warnings = TileMapLayer::get_configuration_warnings();
	const Ref<TileSet> tiles = get_tile_set();
	if (tiles.is_null()) {
		warnings.push_back(U("Falta o TileSet. O dado personalizado \"tipo\" de cada tile diz se ele é solido, atravessavel, espinho ou agua; sem ele, tudo é sólido."));
	} else if (tiles->get_tile_size().x % 8 || tiles->get_tile_size().y % 8) {
		warnings.push_back(U("Os tiles precisam ter lados múltiplos de 8 (a colisão é uma grade de 8×8)."));
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

MDColisao::Tipo MDColisao::get_tipo(const Vector2i &p_cell) const {
	const Ref<TileSet> tiles = get_tile_set();
	if (tiles.is_null() || tiles->get_custom_data_layer_by_name("tipo") < 0) {
		return TIPO_SOLIDO;
	}
	const Ref<TileSetAtlasSource> atlas = tiles->get_source(get_cell_source_id(p_cell));
	const TileData *tile = atlas.is_valid() ? atlas->get_tile_data(get_cell_atlas_coords(p_cell), get_cell_alternative_tile(p_cell)) : nullptr;
	const String tipo = tile ? String(tile->get_custom_data("tipo")).strip_edges().to_lower() : String();
	if (tipo == "atravessavel" || tipo == U("atravessável")) {
		return TIPO_ATRAVESSAVEL;
	}
	if (tipo == "espinho") {
		return TIPO_ESPINHO;
	}
	if (tipo == "agua" || tipo == U("água")) {
		return TIPO_AGUA;
	}
	return TIPO_SOLIDO;
}

Ref<TileSet> MDColisao::create_default_tile_set() {
	// Quatro tiles de 8×8: sólido (vermelho), atravessável (verde, borda de cima), espinho (rosa) e água (azul).
	Ref<Image> image = Image::create_empty(32, 8, false, Image::FORMAT_RGBA8);
	for (int y = 0; y < 8; y++) {
		for (int x = 0; x < 8; x++) {
			image->set_pixel(x, y, Color(1, 0.2, 0.2));
			image->set_pixel(8 + x, y, y < 2 ? Color(0.3, 1, 0.3) : Color(0.3, 1, 0.3, 0.35));
			image->set_pixel(16 + x, y, Math::abs(x - 3.5f) <= y / 2.0f ? Color(1, 0.3, 0.9) : Color(0, 0, 0, 0));
			image->set_pixel(24 + x, y, Color(0.2, 0.5, 1, 0.8));
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
	const char *names[] = { "solido", "atravessavel", "espinho", "agua" };
	for (int i = 0; i < 4; i++) {
		atlas->create_tile(Vector2i(i, 0));
		atlas->get_tile_data(Vector2i(i, 0), 0)->set_custom_data("tipo", names[i]);
	}
	return tiles;
}

void MDColisao::_notification(int p_what) {
	if (p_what == NOTIFICATION_ENTER_TREE && Engine::get_singleton()->is_editor_hint() && get_tile_set().is_null()) {
		set_tile_set(create_default_tile_set());
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
	if (p_what == NOTIFICATION_ENTER_TREE && Engine::get_singleton()->is_editor_hint() && get_tile_set().is_null()) {
		set_tile_set(MDColisao::create_default_tile_set());
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
