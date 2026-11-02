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

// Pincel: um retângulo de tiles do atlas da camada ativa.
struct RetroMapBrush {
	int source = -1;
	Vector2i origin;
	Vector2i size = Vector2i(1, 1);
	bool is_valid() const { return source >= 0; }
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
	Vector2i hover = Vector2i(INT_MIN, INT_MIN);
	// Traço em andamento: célula -> valor antigo (fonte, atlas, alternativo); o desfazer sai no fim.
	struct Cell {
		int source = -1;
		Vector2i atlas = Vector2i(-1, -1);
		int alternative = 0;
	};
	HashMap<Vector2i, Cell> stroke_old;
	HashMap<Vector2i, Cell> stroke_new;
	TileMapLayer *stroke_layer = nullptr;
	Vector<Vector2i> stroke_created; // Tiles criados no atlas durante o traço.
	Ref<TileSetAtlasSource> stroke_atlas;

	Vector2i _cell_at(const Vector2 &p_position) const;
	void _paint_at(const Vector2i &p_cell);
	void _finish_stroke();
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
	Button *tool_pencil = nullptr;
	Button *tool_eraser = nullptr;
	CheckBox *dim_others = nullptr;
	Button *fix_region = nullptr;
	void _fix_region_pressed();
	bool refresh_queued = false;

	void _tool_pressed(int p_tool);
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
	};
	Tool tool = TOOL_PENCIL;
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
