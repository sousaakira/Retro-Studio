#include "retro_md_inspector.h"

#include "core/io/resource_loader.h"
#include "core/object/callable_mp.h"
#include "editor/gui/editor_file_dialog.h"
#include "editor/themes/editor_scale.h"
#include "scene/2d/node_2d.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/texture_rect.h"
#include "scene/resources/texture.h"

static String TXT(const char *p_text) {
	return String::utf8(p_text);
}

// ---- Imagem: só PNG do projeto ----

RetroPngProperty::RetroPngProperty() {
	HBoxContainer *row = memnew(HBoxContainer);
	add_child(row);
	preview = memnew(TextureRect);
	preview->set_custom_minimum_size(Size2(32, 32) * EDSCALE);
	preview->set_expand_mode(TextureRect::EXPAND_IGNORE_SIZE);
	preview->set_stretch_mode(TextureRect::STRETCH_KEEP_ASPECT_CENTERED);
	preview->set_texture_filter(CanvasItem::TEXTURE_FILTER_NEAREST);
	row->add_child(preview);
	choose = memnew(Button);
	choose->set_h_size_flags(SIZE_EXPAND_FILL);
	choose->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_ELLIPSIS);
	choose->set_clip_text(true);
	choose->connect(SceneStringName(pressed), callable_mp(this, &RetroPngProperty::_choose_pressed));
	choose->set_drag_forwarding(Callable(), callable_mp(this, &RetroPngProperty::_can_drop), callable_mp(this, &RetroPngProperty::_drop));
	row->add_child(choose);
	add_focusable(choose);
	clear = memnew(Button);
	clear->set_flat(true);
	clear->set_tooltip_text(TXT("Tirar a imagem."));
	clear->connect(SceneStringName(pressed), callable_mp(this, &RetroPngProperty::_clear_pressed));
	row->add_child(clear);
	add_focusable(clear);
}

void RetroPngProperty::_notification(int p_what) {
	if (p_what == NOTIFICATION_THEME_CHANGED || p_what == NOTIFICATION_ENTER_TREE) {
		clear->set_button_icon(get_editor_theme_icon(SNAME("Clear")));
	}
}

void RetroPngProperty::update_property() {
	const Ref<Texture2D> texture = get_edited_property_value();
	const String path = texture.is_valid() ? texture->get_path() : String();
	preview->set_texture(texture);
	if (texture.is_null()) {
		choose->set_text(TXT("Escolher PNG…"));
		choose->set_tooltip_text(TXT("Escolha um PNG do projeto (ou arraste um do painel Arquivos). O Mega Drive usa imagens indexadas com as cores da paleta."));
	} else if (path.is_empty() || path.contains("::")) {
		// Textura embutida na cena (criada pelo "Novo" do Godot em versões antigas): o exportador não converte.
		choose->set_text(TXT("Textura embutida (troque por um PNG)"));
		choose->set_tooltip_text(TXT("Esta textura não é um arquivo PNG do projeto e o exportador do Mega Drive não sabe convertê-la. Escolha um PNG."));
	} else {
		choose->set_text(path.get_file());
		choose->set_tooltip_text(path + vformat(TXT("\n%d × %d px"), texture->get_width(), texture->get_height()));
	}
	clear->set_visible(texture.is_valid());
	choose->set_disabled(is_read_only());
	clear->set_disabled(is_read_only());
}

void RetroPngProperty::_choose_pressed() {
	if (!dialog) {
		dialog = memnew(EditorFileDialog);
		dialog->set_file_mode(EditorFileDialog::FILE_MODE_OPEN_FILE);
		dialog->set_access(EditorFileDialog::ACCESS_RESOURCES);
		dialog->add_filter("*.png", TXT("Imagem PNG"));
		dialog->set_title(TXT("Escolher PNG do projeto"));
		dialog->connect("file_selected", callable_mp(this, &RetroPngProperty::_file_selected));
		add_child(dialog);
	}
	const Ref<Texture2D> texture = get_edited_property_value();
	if (texture.is_valid() && !texture->get_path().is_empty() && !texture->get_path().contains("::")) {
		dialog->set_current_path(texture->get_path());
	}
	dialog->popup_file_dialog();
}

void RetroPngProperty::_clear_pressed() {
	emit_changed(get_edited_property(), Ref<Texture2D>());
}

void RetroPngProperty::_file_selected(const String &p_path) {
	const Ref<Texture2D> texture = ResourceLoader::load(p_path, "Texture2D");
	if (texture.is_valid()) {
		emit_changed(get_edited_property(), texture);
	}
}

// PNG arrastado do painel Arquivos (um arquivo .png de res://) ou uma textura carregada de um PNG.
String RetroPngProperty::_png_from_drag(const Variant &p_data) const {
	const Dictionary data = p_data;
	const String type = data.get("type", "");
	if (type == "files") {
		const Vector<String> files = data.get("files", Vector<String>());
		return files.size() == 1 && files[0].get_extension().to_lower() == "png" ? files[0] : String();
	}
	if (type == "resource") {
		const Ref<Texture2D> texture = data.get("resource", Ref<Resource>());
		return texture.is_valid() && texture->get_path().get_extension().to_lower() == "png" ? texture->get_path() : String();
	}
	return String();
}

bool RetroPngProperty::_can_drop(const Point2 &p_point, const Variant &p_data) const {
	return !is_read_only() && !_png_from_drag(p_data).is_empty();
}

void RetroPngProperty::_drop(const Point2 &p_point, const Variant &p_data) {
	const String path = _png_from_drag(p_data);
	if (!path.is_empty()) {
		_file_selected(path);
	}
}

// ---- Plugin ----

static bool is_md_node(Object *p_object) {
	return Object::cast_to<Node>(p_object) && String(p_object->get_class_name()).begins_with("MD");
}

bool RetroMDInspector::can_handle(Object *p_object) {
	return is_md_node(p_object);
}

bool RetroMDInspector::parse_property(Object *p_object, const Variant::Type p_type, const String &p_path, const PropertyHint p_hint, const String &p_hint_text, const BitField<PropertyUsageFlags> p_usage, const bool p_wide) {
	if (!is_md_node(p_object)) {
		return false;
	}
	if (p_path == "script") {
		return true; // O console não roda GDScript: o código do jogo é C (src/<cena>.c, src/<ator>.c).
	}
	if (p_type == Variant::OBJECT && p_hint == PROPERTY_HINT_RESOURCE_TYPE && p_hint_text.split(",").has("Texture2D")) {
		add_property_editor(p_path, memnew(RetroPngProperty));
		return true;
	}
	return false;
}
