#include "retro_palette_dock.h"

#include "../scene/md_nodes.h"

#include "core/io/file_access.h"
#include "editor/editor_interface.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/color_rect.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/label.h"
#include "scene/gui/progress_bar.h"
#include "scene/resources/2d/tile_set.h"
#include "scene/gui/scroll_container.h"
#include "scene/gui/separator.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

const Color COLOR_WARNING(1.0, 0.8, 0.4);

} // namespace

Color RetroPaletteDock::to_console(const Color &p_color) {
	// O VDP guarda 3 bits por canal; o rescomp e o RGB24_TO_VDPCOLOR do SGDK usam os 3 bits de cima.
	return Color::from_rgba8((p_color.get_r8() >> 5) * 36, (p_color.get_g8() >> 5) * 36, (p_color.get_b8() >> 5) * 36);
}

int RetroPaletteDock::_image_tiles(const String &p_path) {
	const String key = p_path + "|" + itos(FileAccess::get_modified_time(p_path));
	if (!tile_cache.has(key)) {
		Ref<Image> image;
		image.instantiate();
		int tiles = 0;
		if (image->load(p_path) == OK) {
			image->convert(Image::FORMAT_RGBA8);
			tiles = RetroMD::unique_tiles(image);
		}
		tile_cache[key] = tiles;
	}
	return tile_cache[key];
}

// O mapa vira um tileset com os tiles de 8×8 distintos dos tiles do atlas que ele usa, mais o vazio.
int RetroPaletteDock::_map_tiles(MDMapa *p_mapa) {
	const Ref<TileSet> tiles = p_mapa->get_tile_set();
	const Ref<Texture2D> texture = p_mapa->get_atlas_texture();
	if (tiles.is_null() || texture.is_null()) {
		return 0;
	}
	const Ref<TileSetAtlasSource> atlas = tiles->get_source(tiles->get_source_id(0));
	HashSet<Vector2i> used;
	for (const Vector2i cell : p_mapa->get_used_cells()) {
		used.insert(p_mapa->get_cell_atlas_coords(cell));
	}
	String key = texture->get_path() + "|" + itos(FileAccess::get_modified_time(texture->get_path()));
	Vector<Vector2i> coords;
	for (const Vector2i &coord : used) {
		coords.push_back(coord);
	}
	coords.sort();
	for (const Vector2i &coord : coords) {
		key += "|" + itos(coord.x) + "," + itos(coord.y);
	}
	if (!tile_cache.has(key)) {
		Ref<Image> source;
		source.instantiate();
		int count = 0;
		if (source->load(texture->get_path()) == OK) {
			source->convert(Image::FORMAT_RGBA8);
			const Vector2i size = tiles->get_tile_size();
			Ref<Image> strip = Image::create_empty(size.x * (coords.size() + 1), size.y, false, Image::FORMAT_RGBA8);
			for (int i = 0; i < coords.size(); i++) {
				strip->blit_rect(source, atlas->get_tile_texture_region(coords[i]), Vector2i(i * size.x, 0));
			}
			count = RetroMD::unique_tiles(strip);
		}
		tile_cache[key] = count;
	}
	return tile_cache[key];
}

// Percorre a cena na ordem do gerador e anota quem usa cada paleta e quanto cada node ocupa.
void RetroPaletteDock::_collect(Node *p_node, Slot *r_slots, Usage &r_usage, bool &r_has_text, String &r_signature) {
	int slot = -1;
	String texture;
	if (MDFundo *fundo = Object::cast_to<MDFundo>(p_node)) {
		slot = fundo->get_paleta();
		texture = fundo->get_texture().is_valid() ? fundo->get_texture()->get_path() : String();
		if (!texture.is_empty()) {
			r_usage.background_tiles += _image_tiles(texture);
		}
	} else if (MDSprite *sprite = Object::cast_to<MDSprite>(p_node)) {
		slot = sprite->get_paleta();
		texture = sprite->get_texture().is_valid() ? sprite->get_texture()->get_path() : String();
		// Teto: o motor reserva o quadro inteiro, e o rescomp ainda corta os tiles vazios dele.
		const Vector2i frame = sprite->get_frame_size();
		r_usage.sprite_tiles += (frame.x / 8) * (frame.y / 8);
		r_usage.sprites++;
	} else if (MDMapa *mapa = Object::cast_to<MDMapa>(p_node)) {
		slot = mapa->get_paleta();
		const Ref<Texture2D> atlas = mapa->get_atlas_texture();
		texture = atlas.is_valid() ? atlas->get_path() : String();
		r_usage.background_tiles += _map_tiles(mapa);
	} else if (Object::cast_to<MDTexto>(p_node)) {
		r_has_text = true;
	}
	if (slot >= 0 && slot < 4 && !texture.is_empty()) {
		Slot &s = r_slots[slot];
		const String name = p_node->get_name();
		r_signature += vformat("%s|%d|%s;", name, slot, texture);
		if (s.texture.is_empty()) {
			s.texture = texture;
			s.colors = RetroMD::png_palette(texture);
			s.users.push_back(name);
		} else if (s.texture == texture || RetroMD::png_palette(texture) == s.colors) {
			s.users.push_back(name);
		} else {
			s.conflicts.push_back(vformat("%s (%s)", name, texture.get_file()));
		}
	}
	for (int i = 0; i < p_node->get_child_count(); i++) {
		_collect(p_node->get_child(i), r_slots, r_usage, r_has_text, r_signature);
	}
}

void RetroPaletteDock::_add_meter(const String &p_label, int p_used, int p_total) {
	Label *label = memnew(Label);
	label->set_text(vformat(U("%s: %d de %d"), p_label, p_used, p_total));
	if (p_used > p_total) {
		label->add_theme_color_override(SceneStringName(font_color), COLOR_WARNING);
		label->set_text(label->get_text() + U(" — não cabe!"));
	}
	content->add_child(label);
	ProgressBar *bar = memnew(ProgressBar);
	bar->set_max(p_total);
	bar->set_value(MIN(p_used, p_total));
	bar->set_show_percentage(true);
	content->add_child(bar);
}

void RetroPaletteDock::_rebuild(const Slot *p_slots, const Usage &p_usage, bool p_has_text, bool p_has_scene) {
	for (int i = content->get_child_count() - 1; i >= 0; i--) {
		Node *child = content->get_child(i);
		content->remove_child(child);
		child->queue_free();
	}
	if (!p_has_scene) {
		Label *empty = memnew(Label);
		empty->set_text(U("Abra uma cena com uma MDCena na raiz para ver o uso de VRAM e as paletas."));
		empty->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		content->add_child(empty);
		return;
	}
	Label *vram = memnew(Label);
	vram->set_text("VRAM");
	vram->set_theme_type_variation("HeaderSmall");
	content->add_child(vram);
	_add_meter(U("Tiles de fundos e mapas"), p_usage.background_tiles, RetroMD::VRAM_BACKGROUND_TILES);
	_add_meter(U("Tiles de sprites (teto)"), p_usage.sprite_tiles, RetroMD::VRAM_SPRITE_TILES);
	_add_meter(U("Sprites"), p_usage.sprites, RetroMD::MAX_SPRITES);
	content->add_child(memnew(HSeparator));

	const int swatch = 14 * EDSCALE;
	for (int slot = 0; slot < 4; slot++) {
		const Slot &s = p_slots[slot];
		Label *header = memnew(Label);
		header->set_text(s.texture.is_empty() ? vformat(U("PAL%d — livre"), slot) : vformat(U("PAL%d — %s"), slot, s.texture.get_file()));
		header->set_theme_type_variation("HeaderSmall");
		content->add_child(header);

		GridContainer *grid = memnew(GridContainer);
		grid->set_columns(16);
		grid->add_theme_constant_override("h_separation", 1);
		grid->add_theme_constant_override("v_separation", 1);
		content->add_child(grid);
		for (int i = 0; i < 16; i++) {
			ColorRect *cell = memnew(ColorRect);
			cell->set_custom_minimum_size(Size2(swatch, swatch));
			String tip = vformat(U("PAL%d, cor %d"), slot, i);
			if (i == 0) {
				// A cor 0 é a transparência dos sprites e dos planos.
				cell->set_color(Color(0.25, 0.25, 0.25));
				tip += U(": transparente");
			} else if (i < s.colors.size()) {
				const Color console = to_console(s.colors[i]);
				cell->set_color(console);
				tip += vformat(U(": #%s no PNG, #%s no console"), s.colors[i].to_html(false), console.to_html(false));
			} else if (slot == 0 && i == 15 && s.texture.is_empty()) {
				// Sem ninguém na PAL0, o jogo gerado pinta a cor 15 de branco para a fonte.
				cell->set_color(Color::from_rgba8(216, 216, 216));
				tip += U(": branco da fonte (VDP_drawText)");
			} else {
				cell->set_color(Color(0, 0, 0));
				tip += U(": sem uso");
			}
			cell->set_tooltip_text(tip);
			grid->add_child(cell);
		}

		Label *users = memnew(Label);
		users->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		users->set_text(s.users.is_empty() ? (slot == 0 && p_has_text ? U("Textos (cor 15)") : U("Nenhum node usa.")) : U("Usada por: ") + String(", ").join(s.users) + (slot == 0 && p_has_text ? U(" e os textos (cor 15)") : String()));
		content->add_child(users);
		if (!s.conflicts.is_empty()) {
			Label *warning = memnew(Label);
			warning->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
			warning->add_theme_color_override(SceneStringName(font_color), COLOR_WARNING);
			warning->set_text(U("Outra paleta neste slot, as cores vão sair erradas: ") + String(", ").join(s.conflicts));
			content->add_child(warning);
		}
		if (s.colors.size() > 16) {
			Label *warning = memnew(Label);
			warning->add_theme_color_override(SceneStringName(font_color), COLOR_WARNING);
			warning->set_text(vformat(U("O PNG tem %d cores; só 16 cabem."), s.colors.size()));
			content->add_child(warning);
		}
		if (slot < 3) {
			content->add_child(memnew(HSeparator));
		}
	}
}

void RetroPaletteDock::_refresh() {
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	Slot slots[4];
	Usage usage;
	bool has_text = false;
	String new_signature;
	const bool has_scene = Object::cast_to<MDCena>(root) != nullptr;
	if (has_scene) {
		_collect(root, slots, usage, has_text, new_signature);
		new_signature += has_text ? "T" : "";
		new_signature += vformat("|%d|%d|%d", usage.background_tiles, usage.sprite_tiles, usage.sprites);
		// As cores mudam quando o PNG muda no disco.
		for (const Slot &s : slots) {
			if (!s.texture.is_empty()) {
				new_signature += itos(FileAccess::get_modified_time(s.texture));
			}
		}
	} else {
		new_signature = "-";
	}
	if (new_signature == signature) {
		return;
	}
	signature = new_signature;
	_rebuild(slots, usage, has_text, has_scene);
}

void RetroPaletteDock::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_VISIBILITY_CHANGED: {
			set_process(is_visible_in_tree());
			if (is_visible_in_tree()) {
				_refresh();
			}
		} break;
		case NOTIFICATION_PROCESS: {
			// A cena muda por desfazer, Inspetor, arrastar nodes…: confere duas vezes por segundo.
			elapsed += get_process_delta_time();
			if (elapsed >= 0.5) {
				elapsed = 0;
				_refresh();
			}
		} break;
	}
}

RetroPaletteDock::RetroPaletteDock() {
	set_name(U("Console"));
	set_icon_name("MDPaleta");
	set_default_slot(EditorDock::DOCK_SLOT_RIGHT_BL);

	ScrollContainer *scroll = memnew(ScrollContainer);
	scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	scroll->set_v_size_flags(SIZE_EXPAND_FILL);
	add_child(scroll);
	content = memnew(VBoxContainer);
	content->set_h_size_flags(SIZE_EXPAND_FILL);
	scroll->add_child(content);
}
