#pragma once

// Inspetor dos nodes do Mega Drive (MD*): tira o que o console não usa. As imagens (texture, quadros, textura)
// aceitam só um PNG do projeto, sem a lista "Novo" de texturas do Godot (ViewportTexture, GradientTexture...),
// que o exportador não sabe converter; o Script do Godot some (o código do jogo é C, em src/).

#include "editor/inspector/editor_inspector.h"

class Button;
class EditorFileDialog;
class TextureRect;

class RetroPngProperty : public EditorProperty {
	GDCLASS(RetroPngProperty, EditorProperty);

	TextureRect *preview = nullptr;
	Button *choose = nullptr;
	Button *clear = nullptr;
	EditorFileDialog *dialog = nullptr;

	void _choose_pressed();
	void _clear_pressed();
	void _file_selected(const String &p_path);
	String _png_from_drag(const Variant &p_data) const;
	bool _can_drop(const Point2 &p_point, const Variant &p_data) const;
	void _drop(const Point2 &p_point, const Variant &p_data);

protected:
	void _notification(int p_what);

public:
	virtual void update_property() override;
	RetroPngProperty();
};

class RetroMDInspector : public EditorInspectorPlugin {
	GDCLASS(RetroMDInspector, EditorInspectorPlugin);

public:
	virtual bool can_handle(Object *p_object) override;
	virtual bool parse_property(Object *p_object, const Variant::Type p_type, const String &p_path, const PropertyHint p_hint, const String &p_hint_text, const BitField<PropertyUsageFlags> p_usage, const bool p_wide = false) override;
};
