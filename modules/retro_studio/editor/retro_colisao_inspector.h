#pragma once

// Inspetor da colisão: ao selecionar uma MDColisao ou abrir um TileSet de colisão (com o dado "tipo"), mostra
// no topo os tipos prontos com o desenho de cada um e o que fazem; no TileSet, esconde o que não vai para o
// jogo (formato, física, renderização, navegação, terrenos).

#include "editor/inspector/editor_inspector.h"

class RetroColisaoInspector : public EditorInspectorPlugin {
	GDCLASS(RetroColisaoInspector, EditorInspectorPlugin);

	static bool _is_collision_tile_set(Object *p_object);

public:
	virtual bool can_handle(Object *p_object) override;
	virtual void parse_begin(Object *p_object) override;
	virtual bool parse_property(Object *p_object, const Variant::Type p_type, const String &p_path, const PropertyHint p_hint, const String &p_hint_text, const BitField<PropertyUsageFlags> p_usage, const bool p_wide = false) override;
};
