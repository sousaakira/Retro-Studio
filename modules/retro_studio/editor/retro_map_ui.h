#pragma once

// Peças de interface da tela Mapa usadas pelo plugin e pela barra lateral.

#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/item_list.h"
#include "scene/gui/label.h"

// Cores dos botões de paleta (PAL0 a PAL3), as mesmas da sobreposição de paleta.
static const Color PALETTE_SWATCHES[4] = { Color(0.5, 0.5, 0.55), Color(0.2, 0.6, 1.0), Color(0.3, 1.0, 0.4), Color(1.0, 0.3, 0.9) };

// O JSON do Godot lê todo número como float; o Retro Studio grava inteiros como inteiros (1, não 1.0).
static inline Variant _json_ints(const Variant &p_value) {
	switch (p_value.get_type()) {
		case Variant::FLOAT: {
			const double value = p_value;
			return value == Math::floor(value) && Math::abs(value) < 9007199254740992.0 ? Variant(int64_t(value)) : p_value;
		}
		case Variant::ARRAY: {
			const Array source = p_value;
			Array result;
			for (int i = 0; i < source.size(); i++) {
				result.push_back(_json_ints(source[i]));
			}
			return result;
		}
		case Variant::DICTIONARY: {
			const Dictionary source = p_value;
			Dictionary result;
			for (const KeyValue<Variant, Variant> &entry : source) {
				result[entry.key] = _json_ints(entry.value);
			}
			return result;
		}
		default:
			return p_value;
	}
}

static inline String U(const char *p_text) {
	return String::utf8(p_text);
}

static inline Label *_section(VBoxContainer *p_parent, const String &p_text) {
	Label *label = memnew(Label);
	label->set_text(p_text);
	label->set_theme_type_variation(SNAME("HeaderSmall"));
	p_parent->add_child(label);
	return label;
}

static inline Label *_help(VBoxContainer *p_parent, const String &p_text) {
	Label *label = memnew(Label);
	label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	label->set_custom_minimum_size(Size2(260, 0) * EDSCALE); // Com largura definida, a altura do texto quebrado fica certa.
	label->set_text(p_text);
	label->set_modulate(Color(1, 1, 1, 0.7));
	p_parent->add_child(label);
	return label;
}

static inline ItemList *_image_grid(int p_icon_width, int p_icon_height, bool p_text) {
	ItemList *list = memnew(ItemList);
	list->set_icon_mode(ItemList::ICON_MODE_TOP);
	list->set_max_columns(0);
	list->set_same_column_width(true);
	list->set_fixed_icon_size(Size2i(p_icon_width, p_icon_height) * EDSCALE);
	if (p_text) {
		list->set_fixed_column_width(MAX(p_icon_width + 16, 84) * EDSCALE);
		list->set_max_text_lines(1);
		list->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
	}
	list->set_auto_height(true);
	list->set_texture_filter(CanvasItem::TEXTURE_FILTER_NEAREST); // Pixel art sem borrão.
	return list;
}

static inline Button *_value_button(HBoxContainer *p_row, const String &p_text, const Ref<Texture2D> &p_icon, const Ref<ButtonGroup> &p_group) {
	Button *button = memnew(Button);
	button->set_text(p_text);
	button->set_button_icon(p_icon);
	button->set_toggle_mode(true);
	button->set_button_group(p_group);
	button->set_flat(false);
	p_row->add_child(button);
	return button;
}
