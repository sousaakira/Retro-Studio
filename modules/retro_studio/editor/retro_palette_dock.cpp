#include "retro_palette_dock.h"

#include "../scene/md_nodes.h"

#include "core/io/file_access.h"
#include "editor/editor_interface.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/color_rect.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/label.h"
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

// Percorre a cena na ordem do gerador e anota quem usa cada paleta.
void RetroPaletteDock::_collect(Node *p_node, Slot *r_slots, bool &r_has_text, String &r_signature) const {
	int slot = -1;
	String texture;
	if (MDFundo *fundo = Object::cast_to<MDFundo>(p_node)) {
		slot = fundo->get_paleta();
		texture = fundo->get_texture().is_valid() ? fundo->get_texture()->get_path() : String();
	} else if (MDSprite *sprite = Object::cast_to<MDSprite>(p_node)) {
		slot = sprite->get_paleta();
		texture = sprite->get_texture().is_valid() ? sprite->get_texture()->get_path() : String();
	} else if (MDMapa *mapa = Object::cast_to<MDMapa>(p_node)) {
		slot = mapa->get_paleta();
		const Ref<Texture2D> atlas = mapa->get_atlas_texture();
		texture = atlas.is_valid() ? atlas->get_path() : String();
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
		_collect(p_node->get_child(i), r_slots, r_has_text, r_signature);
	}
}

void RetroPaletteDock::_rebuild(const Slot *p_slots, bool p_has_text, bool p_has_scene) {
	for (int i = content->get_child_count() - 1; i >= 0; i--) {
		Node *child = content->get_child(i);
		content->remove_child(child);
		child->queue_free();
	}
	if (!p_has_scene) {
		Label *empty = memnew(Label);
		empty->set_text(U("Abra uma cena com uma MDCena na raiz para ver as paletas."));
		empty->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		content->add_child(empty);
		return;
	}
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
	bool has_text = false;
	String new_signature;
	const bool has_scene = Object::cast_to<MDCena>(root) != nullptr;
	if (has_scene) {
		_collect(root, slots, has_text, new_signature);
		new_signature += has_text ? "T" : "";
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
	_rebuild(slots, has_text, has_scene);
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
	set_name(U("Paletas"));
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
