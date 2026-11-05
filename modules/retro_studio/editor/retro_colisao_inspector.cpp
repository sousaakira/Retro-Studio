#include "retro_colisao_inspector.h"

#include "../scene/md_nodes.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/label.h"
#include "scene/gui/panel_container.h"
#include "scene/gui/rich_text_label.h"
#include "scene/resources/2d/tile_set.h"
#include "scene/resources/image_texture.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

// Na ordem dos números dos tipos (o tile n - 1 do TileSet padrão tem o desenho do tipo n).
const char *const TIPOS[][2] = {
	{ "solido", "Bloqueia." },
	{ "atravessavel", "Segura só por cima; para baixo, desce." },
	{ "dano", "Tira 1 de vida e deixa piscando (\"espinho\" também vale)." },
	{ "agua", "Anda e cai pela metade." },
	{ "morte", "Abismo, lava: tira a vida inteira na hora." },
	{ "escada", "Só marca a célula: o código do ator decide (eu->na_escada)." },
	{ "gelo", "Só marca: o código decide (eu->no_gelo, pisando nele)." },
	{ "limite", "Parede invisível só para os inimigos (MDInimigo, e MDAtor com respeita_limite)." },
	{ "areia", "Areia movediça: não segura nem bloqueia; só marca a célula, e o código do ator faz afundar (eu->na_areia, CELULA_AREIA)." },
};

} // namespace

bool RetroColisaoInspector::_is_collision_tile_set(Object *p_object) {
	TileSet *tiles = Object::cast_to<TileSet>(p_object);
	return tiles && tiles->get_custom_data_layer_by_name("tipo") >= 0;
}

bool RetroColisaoInspector::can_handle(Object *p_object) {
	return Object::cast_to<MDColisao>(p_object) || _is_collision_tile_set(p_object);
}

void RetroColisaoInspector::parse_begin(Object *p_object) {
	PanelContainer *panel = memnew(PanelContainer);
	VBoxContainer *box = memnew(VBoxContainer);
	panel->add_child(box);
	Label *title = memnew(Label(U("Tipos de colisão (dado \"tipo\" de cada tile)")));
	title->add_theme_color_override(SceneStringName(font_color), Color(1, 0.85, 0.4));
	box->add_child(title);
	RichTextLabel *text = memnew(RichTextLabel);
	text->set_fit_content(true);
	text->set_scroll_active(false);
	text->set_selection_enabled(true);
	text->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	// Os desenhos do TileSet padrão, ampliados, ao lado de cada nome.
	const Ref<TileSet> padrao = MDColisao::create_default_tile_set();
	const Ref<TileSetAtlasSource> atlas = padrao->get_source(padrao->get_source_id(0));
	const Ref<Image> image = atlas.is_valid() && atlas->get_texture().is_valid() ? atlas->get_texture()->get_image() : Ref<Image>();
	text->push_table(2);
	for (int i = 0; i < 8; i++) {
		text->push_cell();
		if (image.is_valid()) {
			Ref<Image> icon = image->get_region(Rect2i(i * 8, 0, 8, 8));
			icon->resize(16 * EDSCALE, 16 * EDSCALE, Image::INTERPOLATE_NEAREST);
			text->add_image(ImageTexture::create_from_image(icon));
		}
		text->pop();
		text->push_cell();
		text->push_bold();
		text->add_text(String(TIPOS[i][0]));
		text->pop();
		text->add_text(" " + U(TIPOS[i][1]));
		text->pop();
	}
	text->pop();
	text->add_newline();
	text->add_text(U("Outro nome vira um tipo próprio: CELULA_<NOME> no código, que decide o efeito (não bloqueia)."));
	if (Object::cast_to<MDColisao>(p_object)) {
		text->add_newline();
		text->add_text(U("Pinte no painel TileMap. Cena antiga com menos tipos: Projeto → Ferramentas → Atualizar tipos da colisão."));
	} else {
		text->add_newline();
		text->add_text(U("Para o jogo só importam o tamanho dos tiles (múltiplo de 8) e o dado \"tipo\" (Custom Data Layers; em cada tile, na aba TileSet). O resto do TileSet fica escondido aqui."));
	}
	box->add_child(text);
	add_custom_control(panel);
}

bool RetroColisaoInspector::parse_property(Object *p_object, const Variant::Type p_type, const String &p_path, const PropertyHint p_hint, const String &p_hint_text, const BitField<PropertyUsageFlags> p_usage, const bool p_wide) {
	if (!_is_collision_tile_set(p_object)) {
		return false;
	}
	// O que o jogo não usa num TileSet de colisão: some do Inspetor (os valores continuam salvos).
	static const char *const hidden[] = { "tile_shape", "tile_layout", "tile_offset_axis", "uv_clipping", "occlusion_layer", "physics_layer", "navigation_layer", "terrain_set", nullptr };
	for (int i = 0; hidden[i]; i++) {
		if (p_path.begins_with(hidden[i])) {
			return true;
		}
	}
	return false;
}
