#pragma once

// Editor de mapas: janela própria (pode ir para outro monitor) com o jeito do editor de mapas do Retro
// Studio em Electron. Paleta de tiles grande à esquerda (arrastar um retângulo vira um pincel de vários
// tiles), o mapa no meio (roda = zoom, botão do meio = arrastar, prévia do pincel sob o cursor) e as
// camadas à direita (MDMapa, MDColisao e MDPrioridade da cena aberta, com olho e cadeado só desta
// janela). Pinta direto nos nodes da cena, com o desfazer do editor; o painel TileMap do 2D continua
// valendo para retoques.

#include "core/templates/hash_set.h"
#include "scene/gui/control.h"
#include "scene/main/window.h"
#include "scene/resources/2d/tile_set.h"

class Button;
class CheckBox;
class HSplitContainer;
class Label;
class OptionButton;
class ScrollContainer;
class TileMapLayer;
class VBoxContainer;
class InputEventKey;
class RetroMapEditor;

// Uma célula de mapa: fonte do TileSet, tile do atlas e alternativo (com os bits de espelho).
struct RetroMapCell {
	int source = -1;
	Vector2i atlas = Vector2i(-1, -1);
	int alternative = 0;
	bool is_empty() const { return source < 0; }
	bool operator==(const RetroMapCell &p_other) const { return source == p_other.source && atlas == p_other.atlas && alternative == p_other.alternative; }
};

// Pincel (carimbo): um bloco de células. Vem da paleta (um retângulo do atlas) ou copiado do mapa; as
// células vazias não pintam. Pode ser espelhado (X/Y), o que o Mega Drive faz de graça.
struct RetroMapBrush {
	int source = -1; // Fonte do atlas escolhida na paleta (destaque nela); -1 = carimbo copiado do mapa.
	Vector2i origin; // Canto do retângulo na paleta.
	Vector2i size = Vector2i(1, 1);
	Vector<RetroMapCell> cells; // size.x × size.y, linha a linha.
	bool flipped_h = false, flipped_v = false;
	bool is_valid() const { return !cells.is_empty(); }
	RetroMapCell get(const Vector2i &p_at) const { return cells[p_at.y * size.x + p_at.x]; }
	// A célula do pincel que cai em p_cell quando ele se repete a partir de p_start (retângulo, balde).
	RetroMapCell tiled(const Vector2i &p_cell, const Vector2i &p_start) const {
		return get(Vector2i(Math::posmod(p_cell.x - p_start.x, size.x), Math::posmod(p_cell.y - p_start.y, size.y)));
	}
	static RetroMapBrush from_atlas(int p_source, const Vector2i &p_origin, const Vector2i &p_size);
	void flip(bool p_horizontal);
};

class RetroTilePalette : public Control {
	GDCLASS(RetroTilePalette, Control);

	RetroMapEditor *editor = nullptr;
	bool dragging = false;
	Vector2i drag_start;
	Vector2i drag_end;

protected:
	void _notification(int p_what);
	virtual void gui_input(const Ref<InputEvent> &p_event) override;

public:
	int zoom = 3;
	bool show_numbers = false;
	void set_editor(RetroMapEditor *p_editor) { editor = p_editor; }
	void update_size();
};

class RetroMapView : public Control {
	GDCLASS(RetroMapView, Control);

	RetroMapEditor *editor = nullptr;
	bool panning = false;
	bool painting = false;
	bool shaping = false; // Arrastando um retângulo (ferramenta retângulo ou seleção).
	Vector2i shape_start;
	Vector2i hover = Vector2i(INT_MIN, INT_MIN);
	// Traço em andamento: célula -> valor antigo; o desfazer sai no fim.
	HashMap<Vector2i, RetroMapCell> stroke_old;
	HashMap<Vector2i, RetroMapCell> stroke_new;
	TileMapLayer *stroke_layer = nullptr;
	Vector<Vector2i> stroke_created; // Tiles criados no atlas durante o traço.
	Ref<TileSetAtlasSource> stroke_atlas;

	Vector2i _cell_at(const Vector2 &p_position) const;
	void _paint_at(const Vector2i &p_cell);
	bool _put(const Vector2i &p_at, const RetroMapCell &p_value);
	void _fill_rect(const Rect2i &p_rect);
	void _flood_fill(const Vector2i &p_cell);
	Rect2i _shape_rect() const;
	void _draw_brush(TileMapLayer *p_layer, const Vector2i &p_at);
	void _pick_at(const Vector2i &p_cell);
	void _draw_layer(TileMapLayer *p_layer, const Rect2i &p_visible, float p_alpha);

protected:
	void _notification(int p_what);
	virtual void gui_input(const Ref<InputEvent> &p_event) override;
	virtual void input(const Ref<InputEvent> &p_event) override;

public:
	int zoom = 2;
	Vector2 offset = Vector2(24, 24);
	bool show_grid = true;
	int guide_width = 320; // Tela do console: H40 (320 px) ou H32 (256 px).
	void set_editor(RetroMapEditor *p_editor) { editor = p_editor; }
	void zoom_at(int p_zoom, const Vector2 &p_anchor);
	void finish_stroke(const String &p_action = String());
	void clear_cells(const Rect2i &p_rect); // Apaga a área na camada ativa (Delete na seleção).
	String hint;
};

class RetroMapEditor : public Window {
	GDCLASS(RetroMapEditor, Window);

	static RetroMapEditor *singleton;

	RetroTilePalette *palette = nullptr;
	ScrollContainer *palette_scroll = nullptr;
	Label *palette_title = nullptr;
	RetroMapView *view = nullptr;
	VBoxContainer *layer_list = nullptr;
	Label *status = nullptr;
	Label *zoom_label = nullptr;
	Button *tool_buttons[5] = {};
	CheckBox *dim_others = nullptr;
	Button *fix_region = nullptr;
	void _fix_region_pressed();
	bool refresh_queued = false;

	void _tool_pressed(int p_tool);
	void _flip_pressed(bool p_horizontal);
	void _copy_selection(bool p_cut);
	void _zoom_step(int p_delta);
	void _palette_zoom_step(int p_delta);
	void _layer_pressed(ObjectID p_layer);
	void _visibility_toggled(bool p_on, ObjectID p_layer);
	void _lock_toggled(bool p_on, ObjectID p_layer);
	void _new_layer(bool p_plane_a);
	void _queue_refresh();
	void _refresh_now();
	void _layer_changed();
	void _close_requested();
	void _connect_scene();

protected:
	static void _bind_methods();
	void _notification(int p_what);

public:
	// Atalhos da janela (ela não recebe os do editor); a vista os encaminha. Verdadeiro se usou a tecla.
	bool handle_key(const Ref<InputEventKey> &p_key);
	enum Tool {
		TOOL_PENCIL,
		TOOL_ERASER,
		TOOL_RECT,
		TOOL_FILL,
		TOOL_SELECT,
		TOOL_MAX,
	};
	Tool tool = TOOL_PENCIL;
	Rect2i selection; // Área selecionada na camada ativa (células); vazia = nenhuma.
	RetroMapBrush brush;
	ObjectID active_layer;
	HashSet<ObjectID> hidden_layers; // Só nesta janela: o jogo e o 2D não mudam.
	HashSet<ObjectID> locked_layers;

	static RetroMapEditor *get_singleton() { return singleton; }
	// TileSet com regiões maiores que a célula (16×16 no padrão do Godot): conserto com desfazer, que
	// transforma cada tile grande num bloco de tiles de 8×8 nos mapas que usam o TileSet.
	static bool needs_region_fix(TileMapLayer *p_layer);
	static void fix_region_size(TileMapLayer *p_layer);
	void open();
	// Camadas de tiles da cena aberta, na ordem de desenho: plano B, plano A, prioridade, colisão.
	Vector<TileMapLayer *> get_layers() const;
	TileMapLayer *get_active_layer() const;
	void set_active_layer(TileMapLayer *p_layer);
	bool is_layer_dimmed(TileMapLayer *p_layer) const;
	void set_brush(const RetroMapBrush &p_brush);
	void update_status();
	void scene_changed();

	RetroMapEditor();
	~RetroMapEditor();
};
