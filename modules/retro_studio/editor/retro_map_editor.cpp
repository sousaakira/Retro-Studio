#include "retro_map_editor.h"

#include "../scene/md_nodes.h"
#include "core/input/input_event.h"
#include "core/object/class_db.h"
#include "core/object/callable_mp.h"
#include "editor/editor_interface.h"
#include "editor/editor_node.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/gui/editor_toaster.h"
#include "editor/themes/editor_scale.h"
#include "scene/2d/tile_map_layer.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/check_box.h"
#include "scene/gui/label.h"
#include "scene/gui/option_button.h"
#include "scene/gui/panel_container.h"
#include "scene/gui/scroll_container.h"
#include "scene/gui/separator.h"
#include "scene/gui/split_container.h"
#include "scene/main/scene_tree.h"
#include "servers/display/display_server.h"
#include "scene/resources/2d/tile_set.h"
#include "scene/theme/theme_db.h"

namespace {
String U(const char *p_text) {
	return String::utf8(p_text);
}

// A fonte de atlas da camada (MDMapa e as camadas de atributo usam uma só) e o id dela.
Ref<TileSetAtlasSource> layer_atlas(TileMapLayer *p_layer, int *r_id = nullptr) {
	if (!p_layer || p_layer->get_tile_set().is_null()) {
		return Ref<TileSetAtlasSource>();
	}
	const Ref<TileSet> tiles = p_layer->get_tile_set();
	for (int i = 0; i < tiles->get_source_count(); i++) {
		const int id = tiles->get_source_id(i);
		Ref<TileSetAtlasSource> atlas = tiles->get_source(id);
		if (atlas.is_valid() && atlas->get_texture().is_valid()) {
			if (r_id) {
				*r_id = id;
			}
			return atlas;
		}
	}
	return Ref<TileSetAtlasSource>();
}

Vector2i tile_size_of(TileMapLayer *p_layer) {
	return p_layer && p_layer->get_tile_set().is_valid() ? p_layer->get_tile_set()->get_tile_size() : Vector2i(8, 8);
}

// Tamanho de cada tile na imagem do atlas (o padrão do Godot é 16×16; o Mega Drive usa 8×8).
Vector2i region_size_of(const Ref<TileSetAtlasSource> &p_atlas) {
	return p_atlas.is_valid() ? p_atlas->get_texture_region_size() : Vector2i(8, 8);
}

// Retângulo de uma célula na tela: a região do atlas maior que a célula fica centrada nela, como no 2D.
Rect2 cell_rect(const Vector2 &p_offset, const Vector2i &p_cell, const Vector2i &p_tile, const Vector2i &p_region, int p_zoom) {
	const Vector2 center = Vector2(p_cell * p_tile) + Vector2(p_tile) / 2;
	return Rect2(p_offset + (center - Vector2(p_region) / 2) * p_zoom, Vector2(p_region) * p_zoom);
}

String layer_label(TileMapLayer *p_layer) {
	if (MDMapa *mapa = Object::cast_to<MDMapa>(p_layer)) {
		return vformat(U("%s — plano %s"), p_layer->get_name(), mapa->get_plano() == MDFundo::PLANO_A ? "A" : "B");
	}
	if (Object::cast_to<MDColisao>(p_layer)) {
		return vformat(U("%s — colisão"), p_layer->get_name());
	}
	if (Object::cast_to<MDPrioridade>(p_layer)) {
		return vformat(U("%s — prioridade"), p_layer->get_name());
	}
	return p_layer->get_name();
}
// Desenha um tile com os espelhos do alternativo (tamanho negativo: o Godot espelha no mesmo lugar).
void draw_tile(CanvasItem *p_canvas, const Ref<TileSetAtlasSource> &p_atlas, const Vector2i &p_coords, int p_alternative, Rect2 p_rect, const Color &p_tint) {
	if (p_alternative & TileSetAtlasSource::TRANSFORM_FLIP_H) {
		p_rect.size.x = -p_rect.size.x;
	}
	if (p_alternative & TileSetAtlasSource::TRANSFORM_FLIP_V) {
		p_rect.size.y = -p_rect.size.y;
	}
	p_canvas->draw_texture_rect_region(p_atlas->get_texture(), p_rect, p_atlas->get_tile_texture_region(p_coords), p_tint, false, false);
}

RetroMapCell cell_of(TileMapLayer *p_layer, const Vector2i &p_at) {
	RetroMapCell cell;
	cell.source = p_layer->get_cell_source_id(p_at);
	if (cell.source >= 0) {
		cell.atlas = p_layer->get_cell_atlas_coords(p_at);
		cell.alternative = p_layer->get_cell_alternative_tile(p_at);
	}
	return cell;
}
} // namespace

// ---- pincel ----

RetroMapBrush RetroMapBrush::from_atlas(int p_source, const Vector2i &p_origin, const Vector2i &p_size) {
	RetroMapBrush brush;
	brush.source = p_source;
	brush.origin = p_origin;
	brush.size = p_size.max(Vector2i(1, 1));
	brush.cells.resize(brush.size.x * brush.size.y);
	for (int y = 0; y < brush.size.y; y++) {
		for (int x = 0; x < brush.size.x; x++) {
			RetroMapCell &cell = brush.cells.write[y * brush.size.x + x];
			cell.source = p_source;
			cell.atlas = p_origin + Vector2i(x, y);
		}
	}
	return brush;
}

void RetroMapBrush::flip(bool p_horizontal) {
	Vector<RetroMapCell> flipped;
	flipped.resize(cells.size());
	const int bit = p_horizontal ? TileSetAtlasSource::TRANSFORM_FLIP_H : TileSetAtlasSource::TRANSFORM_FLIP_V;
	for (int y = 0; y < size.y; y++) {
		for (int x = 0; x < size.x; x++) {
			RetroMapCell cell = get(Vector2i(x, y));
			if (!cell.is_empty()) {
				cell.alternative ^= bit;
			}
			const Vector2i to = p_horizontal ? Vector2i(size.x - 1 - x, y) : Vector2i(x, size.y - 1 - y);
			flipped.write[to.y * size.x + to.x] = cell;
		}
	}
	cells = flipped;
	(p_horizontal ? flipped_h : flipped_v) = !(p_horizontal ? flipped_h : flipped_v);
}

// ---- paleta ----

void RetroTilePalette::update_size() {
	TileMapLayer *layer = editor ? editor->get_active_layer() : nullptr;
	const Ref<TileSetAtlasSource> atlas = layer_atlas(layer);
	set_custom_minimum_size(atlas.is_valid() ? Vector2(atlas->get_texture()->get_size()) * zoom : Vector2());
	queue_redraw();
}

void RetroTilePalette::_notification(int p_what) {
	if (p_what != NOTIFICATION_DRAW || !editor) {
		return;
	}
	TileMapLayer *layer = editor->get_active_layer();
	int source_id = -1;
	const Ref<TileSetAtlasSource> atlas = layer_atlas(layer, &source_id);
	if (atlas.is_null()) {
		return;
	}
	const Ref<Texture2D> texture = atlas->get_texture();
	const Vector2 size = Vector2(texture->get_size()) * zoom;
	// Xadrez atrás: a cor 0 (transparente) aparece como no editor de imagens.
	const int check = 8 * zoom;
	for (int y = 0; y < size.y; y += check) {
		for (int x = 0; x < size.x; x += check) {
			draw_rect(Rect2(x, y, MIN(check, size.x - x), MIN(check, size.y - y)), ((x + y) / check) % 2 ? Color(0.22, 0.22, 0.24) : Color(0.28, 0.28, 0.3));
		}
	}
	draw_texture_rect(texture, Rect2(Vector2(), size), false);
	const Vector2 step = Vector2(region_size_of(atlas)) * zoom;
	const Color grid(0, 0, 0, 0.35);
	for (float x = 0; x <= size.x; x += step.x) {
		draw_line(Vector2(x, 0), Vector2(x, size.y), grid);
	}
	for (float y = 0; y <= size.y; y += step.y) {
		draw_line(Vector2(0, y), Vector2(size.x, y), grid);
	}
	if (show_numbers && zoom >= 2) {
		const Ref<Font> font = get_theme_default_font();
		const int font_size = MAX(6, int(step.y * 0.32));
		const int columns = atlas->get_atlas_grid_size().x;
		for (int y = 0; y * step.y < size.y; y++) {
			for (int x = 0; x < columns; x++) {
				const String text = itos(y * columns + x);
				const Vector2 at = Vector2(x, y) * step + Vector2(1, font->get_ascent(font_size) + 1);
				draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, 2, Color(0, 0, 0));
				draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, Color(1, 1, 1));
			}
		}
	}
	// Seleção: a do arraste em andamento ou o pincel atual.
	Rect2i selected;
	if (dragging) {
		selected = Rect2i(drag_start.min(drag_end), (drag_end - drag_start).abs() + Vector2i(1, 1));
	} else if (editor->brush.is_valid() && editor->brush.source == source_id) {
		selected = Rect2i(editor->brush.origin, editor->brush.size);
	}
	if (selected.size != Vector2i()) {
		const Rect2 rect(Vector2(selected.position) * step, Vector2(selected.size) * step);
		draw_rect(rect, Color(0.3, 0.6, 1, 0.25));
		draw_rect(rect, Color(0.4, 0.75, 1), false, 2);
	}
}

void RetroTilePalette::gui_input(const Ref<InputEvent> &p_event) {
	TileMapLayer *layer = editor ? editor->get_active_layer() : nullptr;
	int source_id = -1;
	const Ref<TileSetAtlasSource> atlas = layer_atlas(layer, &source_id);
	if (atlas.is_null()) {
		return;
	}
	const Vector2 step = Vector2(region_size_of(atlas)) * zoom;
	const Vector2i limit = atlas->get_atlas_grid_size() - Vector2i(1, 1);
	Ref<InputEventMouseButton> button = p_event;
	if (button.is_valid() && button->get_button_index() == MouseButton::LEFT) {
		const Vector2i cell = Vector2i((button->get_position() / step).floor()).clamp(Vector2i(), limit);
		if (button->is_pressed()) {
			dragging = true;
			drag_start = cell;
			drag_end = cell;
		} else if (dragging) {
			dragging = false;
			editor->set_brush(RetroMapBrush::from_atlas(source_id, drag_start.min(drag_end), (drag_end - drag_start).abs() + Vector2i(1, 1)));
		}
		queue_redraw();
		accept_event();
		return;
	}
	Ref<InputEventMouseButton> wheel = p_event;
	if (wheel.is_valid() && wheel->is_pressed() && wheel->is_ctrl_pressed() && (wheel->get_button_index() == MouseButton::WHEEL_UP || wheel->get_button_index() == MouseButton::WHEEL_DOWN)) {
		zoom = CLAMP(zoom + (wheel->get_button_index() == MouseButton::WHEEL_UP ? 1 : -1), 1, 6);
		update_size();
		accept_event();
		return;
	}
	Ref<InputEventMouseMotion> motion = p_event;
	if (motion.is_valid() && dragging) {
		drag_end = Vector2i((motion->get_position() / step).floor()).clamp(Vector2i(), limit);
		queue_redraw();
	}
}

// ---- mapa ----

Vector2i RetroMapView::_cell_at(const Vector2 &p_position) const {
	TileMapLayer *layer = editor ? editor->get_active_layer() : nullptr;
	const Vector2 step = Vector2(tile_size_of(layer)) * zoom;
	return Vector2i(((p_position - offset) / step).floor());
}

void RetroMapView::zoom_at(int p_zoom, const Vector2 &p_anchor) {
	p_zoom = CLAMP(p_zoom, 1, 8);
	if (p_zoom == zoom) {
		return;
	}
	// O ponto sob o mouse fica no mesmo lugar.
	const Vector2 world = (p_anchor - offset) / zoom;
	zoom = p_zoom;
	offset = p_anchor - world * zoom;
	queue_redraw();
	if (editor) {
		editor->update_status();
	}
}

void RetroMapView::_draw_layer(TileMapLayer *p_layer, const Rect2i &p_visible, float p_alpha) {
	int source_id = -1;
	const Ref<TileSetAtlasSource> atlas = layer_atlas(p_layer, &source_id);
	if (atlas.is_null()) {
		return;
	}
	const Ref<Texture2D> texture = atlas->get_texture();
	const Vector2i tile = tile_size_of(p_layer), region = region_size_of(atlas);
	const Color tint(1, 1, 1, p_alpha);
	for (const Vector2i cell : p_layer->get_used_cells()) {
		if (!p_visible.has_point(cell) || p_layer->get_cell_source_id(cell) != source_id) {
			continue;
		}
		const Vector2i coords = p_layer->get_cell_atlas_coords(cell);
		if (!atlas->has_tile(coords)) {
			continue;
		}
		const int alternative = p_layer->get_cell_alternative_tile(cell);
		Rect2 rect = cell_rect(offset, cell, tile, region, zoom);
		if (alternative & TileSetAtlasSource::TRANSFORM_FLIP_H) {
			rect.size.x = -rect.size.x;
		}
		if (alternative & TileSetAtlasSource::TRANSFORM_FLIP_V) {
			rect.size.y = -rect.size.y;
		}
		draw_texture_rect_region(texture, rect, atlas->get_tile_texture_region(coords), tint, false, false);
	}
}

void RetroMapView::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_DRAW: {
			draw_rect(Rect2(Vector2(), get_size()), Color(0.16, 0.16, 0.18));
			if (!editor) {
				return;
			}
			TileMapLayer *active = editor->get_active_layer();
			const Vector2 step = Vector2(tile_size_of(active)) * zoom;
			const Rect2i visible(Vector2i(((-offset) / step).floor()) - Vector2i(1, 1), Vector2i((get_size() / step).ceil()) + Vector2i(3, 3));
			// Fundo do mundo (x, y >= 0) um pouco mais claro: fora dele nada entra no jogo.
			draw_rect(Rect2(offset.max(Vector2()), get_size()), Color(0.2, 0.2, 0.23));
			const bool has_layers = !editor->get_layers().is_empty();
			for (TileMapLayer *layer : editor->get_layers()) {
				if (editor->hidden_layers.has(layer->get_instance_id())) {
					continue;
				}
				const bool attribute = Object::cast_to<MDColisao>(layer) || Object::cast_to<MDPrioridade>(layer);
				float alpha = attribute ? 0.55 : 1.0;
				if (editor->is_layer_dimmed(layer)) {
					alpha *= 0.3;
				}
				_draw_layer(layer, visible, alpha);
			}
			if (show_grid && zoom >= 2) {
				const Color grid(1, 1, 1, 0.07);
				const float start_x = Math::fposmod(offset.x, step.x), start_y = Math::fposmod(offset.y, step.y);
				for (float x = start_x; x < get_size().x; x += step.x) {
					draw_line(Vector2(x, 0), Vector2(x, get_size().y), grid);
				}
				for (float y = start_y; y < get_size().y; y += step.y) {
					draw_line(Vector2(0, y), Vector2(get_size().x, y), grid);
				}
			}
			// Eixos do canto (0, 0) e a primeira tela do console.
			draw_line(Vector2(offset.x, 0), Vector2(offset.x, get_size().y), Color(0.4, 0.8, 0.4, 0.6));
			draw_line(Vector2(0, offset.y), Vector2(get_size().x, offset.y), Color(0.8, 0.4, 0.4, 0.6));
			draw_rect(Rect2(offset, Vector2(guide_width, 224) * zoom), Color(0.6, 0.5, 1, 0.5), false, 1);
			// Seleção (tracejada) e o retângulo em andamento.
			if (editor->selection.has_area()) {
				const Rect2 rect(offset + Vector2(editor->selection.position) * step, Vector2(editor->selection.size) * step);
				draw_rect(rect, Color(1, 0.85, 0.3, 0.12));
				draw_dashed_line(rect.position, Vector2(rect.get_end().x, rect.position.y), Color(1, 0.85, 0.3), 1, 4);
				draw_dashed_line(Vector2(rect.get_end().x, rect.position.y), rect.get_end(), Color(1, 0.85, 0.3), 1, 4);
				draw_dashed_line(rect.get_end(), Vector2(rect.position.x, rect.get_end().y), Color(1, 0.85, 0.3), 1, 4);
				draw_dashed_line(Vector2(rect.position.x, rect.get_end().y), rect.position, Color(1, 0.85, 0.3), 1, 4);
			}
			// Prévia sob o cursor: pincel, borracha, retângulo em andamento.
			if (hover.x != INT_MIN && active && !editor->locked_layers.has(active->get_instance_id())) {
				const RetroMapEditor::Tool tool = editor->tool;
				if (shaping) {
					const Rect2i shape = _shape_rect();
					if (tool == RetroMapEditor::TOOL_RECT && editor->brush.is_valid()) {
						const Ref<TileSetAtlasSource> atlas = layer_atlas(active);
						for (int y = shape.position.y; y < shape.get_end().y; y++) {
							for (int x = shape.position.x; x < shape.get_end().x; x++) {
								const RetroMapCell cell = editor->brush.tiled(Vector2i(x, y), shape_start);
								if (!cell.is_empty() && atlas.is_valid() && atlas->has_tile(cell.atlas)) {
									draw_tile(this, atlas, cell.atlas, cell.alternative, cell_rect(offset, Vector2i(x, y), tile_size_of(active), region_size_of(atlas), zoom), Color(1, 1, 1, 0.6));
								}
							}
						}
					}
					draw_rect(Rect2(offset + Vector2(shape.position) * step, Vector2(shape.size) * step), tool == RetroMapEditor::TOOL_SELECT ? Color(1, 0.85, 0.3) : Color(0.4, 0.75, 1), false, 1);
				} else if ((tool == RetroMapEditor::TOOL_PENCIL || tool == RetroMapEditor::TOOL_RECT || tool == RetroMapEditor::TOOL_FILL) && editor->brush.is_valid()) {
					_draw_brush(active, hover);
					const Vector2 size = tool == RetroMapEditor::TOOL_PENCIL ? Vector2(editor->brush.size) : Vector2(1, 1);
					draw_rect(Rect2(offset + Vector2(hover) * step, size * step), Color(0.4, 0.75, 1), false, 1);
				} else if (tool == RetroMapEditor::TOOL_ERASER) {
					draw_rect(Rect2(offset + Vector2(hover) * step, step), Color(1, 0.4, 0.4, 0.3));
					draw_rect(Rect2(offset + Vector2(hover) * step, step), Color(1, 0.4, 0.4), false, 1);
				} else if (tool == RetroMapEditor::TOOL_SELECT) {
					draw_rect(Rect2(offset + Vector2(hover) * step, step), Color(1, 0.85, 0.3), false, 1);
				}
			}
			if (!has_layers) {
				const Ref<Font> font = get_theme_default_font();
				draw_string(font, Vector2(20, 40), U("A cena aberta não tem mapas. Crie uma camada no painel da direita."), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(1, 1, 1, 0.7));
			}
		} break;
		case NOTIFICATION_MOUSE_EXIT: {
			hover = Vector2i(INT_MIN, INT_MIN);
			queue_redraw();
		} break;
	}
}

void RetroMapView::_draw_brush(TileMapLayer *p_layer, const Vector2i &p_at) {
	const Ref<TileSet> tiles = p_layer->get_tile_set();
	if (tiles.is_null()) {
		return;
	}
	const RetroMapBrush &brush = editor->brush;
	// O balde e o retângulo mostram só a primeira célula; o lápis, o carimbo inteiro.
	const Vector2i size = editor->tool == RetroMapEditor::TOOL_PENCIL ? brush.size : Vector2i(1, 1);
	for (int y = 0; y < size.y; y++) {
		for (int x = 0; x < size.x; x++) {
			const RetroMapCell cell = brush.get(Vector2i(x, y));
			const Ref<TileSetAtlasSource> atlas = cell.is_empty() || !tiles->has_source(cell.source) ? Ref<TileSetAtlasSource>() : Ref<TileSetAtlasSource>(tiles->get_source(cell.source));
			if (atlas.is_null() || atlas->get_texture().is_null()) {
				continue;
			}
			Rect2 region(Vector2(atlas->get_margins() + cell.atlas * (region_size_of(atlas) + atlas->get_separation())), Vector2(region_size_of(atlas)));
			Rect2 rect = cell_rect(offset, p_at + Vector2i(x, y), tile_size_of(p_layer), region_size_of(atlas), zoom);
			if (cell.alternative & TileSetAtlasSource::TRANSFORM_FLIP_H) {
				rect.size.x = -rect.size.x;
			}
			if (cell.alternative & TileSetAtlasSource::TRANSFORM_FLIP_V) {
				rect.size.y = -rect.size.y;
			}
			draw_texture_rect_region(atlas->get_texture(), rect, region, Color(1, 1, 1, 0.6));
		}
	}
}

// Põe um valor numa célula da camada do traço, guardando o antigo para o desfazer. Um tile da imagem
// que ainda não existe no atlas nasce agora (o desfazer o tira). Falso se não deu para pintar.
bool RetroMapView::_put(const Vector2i &p_at, const RetroMapCell &p_value) {
	TileMapLayer *layer = stroke_layer;
	if (!p_value.is_empty()) {
		const Ref<TileSet> tiles = layer->get_tile_set();
		const Ref<TileSetAtlasSource> atlas = tiles.is_valid() && tiles->has_source(p_value.source) ? Ref<TileSetAtlasSource>(tiles->get_source(p_value.source)) : Ref<TileSetAtlasSource>();
		if (atlas.is_null()) {
			return false;
		}
		if (!atlas->has_tile(p_value.atlas)) {
			if (!atlas->has_room_for_tile(p_value.atlas, Vector2i(1, 1), 1, Vector2i(), 1)) {
				return false;
			}
			atlas->create_tile(p_value.atlas);
			stroke_created.push_back(p_value.atlas);
			stroke_atlas = atlas;
		}
	}
	if (!stroke_old.has(p_at)) {
		stroke_old[p_at] = cell_of(layer, p_at);
	}
	stroke_new[p_at] = p_value;
	layer->set_cell(p_at, p_value.source, p_value.atlas, p_value.alternative);
	return true;
}

void RetroMapView::_paint_at(const Vector2i &p_cell) {
	TileMapLayer *layer = editor->get_active_layer();
	if (!layer || editor->locked_layers.has(layer->get_instance_id())) {
		return;
	}
	stroke_layer = layer;
	if (editor->tool == RetroMapEditor::TOOL_ERASER) {
		_put(p_cell, RetroMapCell());
		return;
	}
	if (!editor->brush.is_valid()) {
		return;
	}
	for (int y = 0; y < editor->brush.size.y; y++) {
		for (int x = 0; x < editor->brush.size.x; x++) {
			const RetroMapCell value = editor->brush.get(Vector2i(x, y));
			if (!value.is_empty()) {
				_put(p_cell + Vector2i(x, y), value);
			}
		}
	}
}

Rect2i RetroMapView::_shape_rect() const {
	return Rect2i(shape_start.min(hover), (hover - shape_start).abs() + Vector2i(1, 1));
}

void RetroMapView::_fill_rect(const Rect2i &p_rect) {
	TileMapLayer *layer = editor->get_active_layer();
	if (!layer || editor->locked_layers.has(layer->get_instance_id()) || !editor->brush.is_valid()) {
		return;
	}
	stroke_layer = layer;
	for (int y = p_rect.position.y; y < p_rect.get_end().y; y++) {
		for (int x = p_rect.position.x; x < p_rect.get_end().x; x++) {
			const RetroMapCell value = editor->brush.tiled(Vector2i(x, y), p_rect.position);
			if (!value.is_empty()) {
				_put(Vector2i(x, y), value);
			}
		}
	}
	finish_stroke(U("Retângulo no mapa"));
}

void RetroMapView::clear_cells(const Rect2i &p_rect) {
	TileMapLayer *layer = editor->get_active_layer();
	if (!layer || editor->locked_layers.has(layer->get_instance_id())) {
		return;
	}
	stroke_layer = layer;
	for (int y = p_rect.position.y; y < p_rect.get_end().y; y++) {
		for (int x = p_rect.position.x; x < p_rect.get_end().x; x++) {
			if (layer->get_cell_source_id(Vector2i(x, y)) >= 0) {
				_put(Vector2i(x, y), RetroMapCell());
			}
		}
	}
	finish_stroke(U("Apagar a seleção do mapa"));
}

// Balde: troca a mancha de células iguais (vizinhas pelos lados) que começa no clique. A mancha fica
// dentro do mundo da cena (o retângulo que junta o que todas as camadas usam e a primeira tela), senão um
// clique no vazio encheria o infinito.
void RetroMapView::_flood_fill(const Vector2i &p_cell) {
	TileMapLayer *layer = editor->get_active_layer();
	if (!layer || editor->locked_layers.has(layer->get_instance_id()) || !editor->brush.is_valid()) {
		return;
	}
	Rect2i bounds(Vector2i(), Vector2i(guide_width, 224) / tile_size_of(layer));
	for (TileMapLayer *other : editor->get_layers()) {
		const Rect2i used = other->get_used_rect();
		if (used.has_area()) {
			bounds = bounds.merge(used);
		}
	}
	if (!bounds.has_point(p_cell)) {
		hint = U("O balde só enche dentro do mundo da cena (a área dos mapas e a primeira tela).");
		editor->update_status();
		return;
	}
	const RetroMapCell target = cell_of(layer, p_cell);
	if (editor->brush.size == Vector2i(1, 1) && editor->brush.get(Vector2i()) == target) {
		return; // Já é o tile do pincel.
	}
	stroke_layer = layer;
	HashSet<Vector2i> seen;
	Vector<Vector2i> stack;
	stack.push_back(p_cell);
	seen.insert(p_cell);
	const int limit = 200000;
	while (!stack.is_empty() && seen.size() < limit) {
		const Vector2i at = stack[stack.size() - 1];
		stack.remove_at(stack.size() - 1);
		const RetroMapCell value = editor->brush.tiled(at, p_cell);
		if (!value.is_empty()) {
			_put(at, value);
		}
		static const Vector2i sides[4] = { Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1) };
		for (const Vector2i &side : sides) {
			const Vector2i next = at + side;
			if (bounds.has_point(next) && !seen.has(next) && (stroke_old.has(next) ? stroke_old[next] : cell_of(layer, next)) == target) {
				seen.insert(next);
				stack.push_back(next);
			}
		}
	}
	finish_stroke(U("Balde no mapa"));
}

void RetroMapView::finish_stroke(const String &p_action) {
	painting = false;
	if (!stroke_layer || stroke_new.is_empty()) {
		stroke_old.clear();
		stroke_new.clear();
		stroke_created.clear();
		stroke_atlas.unref();
		stroke_layer = nullptr;
		return;
	}
	// As células já foram pintadas durante o traço: a ação só registra o fazer e o desfazer.
	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	const String action = !p_action.is_empty() ? p_action : editor->tool == RetroMapEditor::TOOL_ERASER ? U("Apagar no mapa") : U("Pintar no mapa");
	undo->create_action(action, UndoRedo::MERGE_DISABLE, stroke_layer);
	if (stroke_atlas.is_valid()) {
		for (const Vector2i &coords : stroke_created) {
			undo->add_do_method(stroke_atlas.ptr(), "create_tile", coords, Vector2i(1, 1));
			undo->add_undo_method(stroke_atlas.ptr(), "remove_tile", coords);
		}
	}
	for (const KeyValue<Vector2i, RetroMapCell> &E : stroke_new) {
		undo->add_do_method(stroke_layer, "set_cell", E.key, E.value.source, E.value.atlas, E.value.alternative);
		const RetroMapCell &old = stroke_old[E.key];
		undo->add_undo_method(stroke_layer, "set_cell", E.key, old.source, old.atlas, old.alternative);
	}
	undo->commit_action(false);
	stroke_old.clear();
	stroke_new.clear();
	stroke_created.clear();
	stroke_atlas.unref();
	stroke_layer = nullptr;
}

void RetroMapView::_pick_at(const Vector2i &p_cell) {
	// Conta-gotas: a camada ativa primeiro; senão a de cima que tem tile ali, e ela vira a ativa.
	TileMapLayer *found = nullptr;
	TileMapLayer *active = editor->get_active_layer();
	if (active && active->get_cell_source_id(p_cell) >= 0) {
		found = active;
	} else {
		const Vector<TileMapLayer *> layers = editor->get_layers();
		for (int i = layers.size() - 1; i >= 0; i--) {
			if (!editor->hidden_layers.has(layers[i]->get_instance_id()) && layers[i]->get_cell_source_id(p_cell) >= 0) {
				found = layers[i];
				break;
			}
		}
	}
	if (!found) {
		return;
	}
	if (found != active) {
		editor->set_active_layer(found);
	}
	// Pega o tile com o espelho que ele tem no mapa.
	RetroMapBrush brush = RetroMapBrush::from_atlas(found->get_cell_source_id(p_cell), found->get_cell_atlas_coords(p_cell), Vector2i(1, 1));
	brush.cells.write[0].alternative = found->get_cell_alternative_tile(p_cell);
	brush.flipped_h = brush.cells[0].alternative & TileSetAtlasSource::TRANSFORM_FLIP_H;
	brush.flipped_v = brush.cells[0].alternative & TileSetAtlasSource::TRANSFORM_FLIP_V;
	if (editor->tool != RetroMapEditor::TOOL_RECT && editor->tool != RetroMapEditor::TOOL_FILL) {
		editor->tool = RetroMapEditor::TOOL_PENCIL;
	}
	editor->set_brush(brush);
}

void RetroMapView::gui_input(const Ref<InputEvent> &p_event) {
	if (!editor) {
		return;
	}
	Ref<InputEventMouseButton> button = p_event;
	if (button.is_valid()) {
		const MouseButton index = button->get_button_index();
		if (button->is_pressed() && (index == MouseButton::WHEEL_UP || index == MouseButton::WHEEL_DOWN || index == MouseButton::WHEEL_LEFT || index == MouseButton::WHEEL_RIGHT)) {
			const float direction = (index == MouseButton::WHEEL_UP || index == MouseButton::WHEEL_LEFT) ? 1 : -1;
			if (button->is_ctrl_pressed()) {
				offset.y += direction * 48; // Ctrl+roda rola na vertical.
			} else if (button->is_alt_pressed() || button->is_shift_pressed() || index == MouseButton::WHEEL_LEFT || index == MouseButton::WHEEL_RIGHT) {
				offset.x += direction * 48; // Alt (ou Shift)+roda rola na horizontal.
			} else {
				zoom_at(zoom + int(direction), button->get_position());
			}
			queue_redraw();
			accept_event();
			return;
		}
		if (index == MouseButton::MIDDLE) {
			panning = button->is_pressed();
			accept_event();
			return;
		}
		if (index == MouseButton::LEFT) {
			const Vector2i cell = _cell_at(button->get_position());
			const RetroMapEditor::Tool tool = editor->tool;
			if (button->is_pressed()) {
				hover = cell;
				if (tool == RetroMapEditor::TOOL_RECT || tool == RetroMapEditor::TOOL_SELECT) {
					shaping = true;
					shape_start = cell;
				} else if (tool == RetroMapEditor::TOOL_FILL) {
					_flood_fill(cell);
				} else {
					painting = true;
					_paint_at(cell);
				}
			} else if (shaping) {
				shaping = false;
				hover = cell;
				if (tool == RetroMapEditor::TOOL_RECT) {
					_fill_rect(_shape_rect());
				} else if (tool == RetroMapEditor::TOOL_SELECT) {
					editor->selection = _shape_rect();
					editor->update_status();
				}
			} else if (painting) {
				finish_stroke();
			}
			queue_redraw();
			accept_event();
			return;
		}
		if (index == MouseButton::RIGHT && button->is_pressed()) {
			_pick_at(_cell_at(button->get_position()));
			queue_redraw();
			accept_event();
			return;
		}
	}
	Ref<InputEventMouseMotion> motion = p_event;
	if (motion.is_valid()) {
		if (panning) {
			offset += motion->get_relative();
			queue_redraw();
			return;
		}
		const Vector2i cell = _cell_at(motion->get_position());
		if (cell != hover) {
			hover = cell;
			if (painting) {
				_paint_at(cell);
			}
			editor->update_status();
			queue_redraw();
		}
	}
}

// ---- tiles de 16 px para 8 px ----

bool RetroMapEditor::needs_region_fix(TileMapLayer *p_layer) {
	const Ref<TileSetAtlasSource> atlas = layer_atlas(p_layer);
	return atlas.is_valid() && Object::cast_to<MDMapa>(p_layer) && region_size_of(atlas) != tile_size_of(p_layer) &&
			region_size_of(atlas).x % tile_size_of(p_layer).x == 0 && region_size_of(atlas).y % tile_size_of(p_layer).y == 0;
}

void RetroMapEditor::fix_region_size(TileMapLayer *p_layer) {
	if (!needs_region_fix(p_layer)) {
		return;
	}
	const Ref<TileSet> old_tiles = p_layer->get_tile_set();
	int source_id = -1;
	const Ref<TileSetAtlasSource> old_atlas = layer_atlas(p_layer, &source_id);
	const Vector2i tile = tile_size_of(p_layer);
	const Vector2i factor = region_size_of(old_atlas) / tile;
	// Um TileSet novo (o antigo fica para o desfazer), com regiões do tamanho da célula. Cada tile grande
	// vira um bloco de tiles de 8 px a partir da célula onde estava.
	Ref<TileSet> new_tiles = old_tiles->duplicate(true);
	Ref<TileSetAtlasSource> new_atlas = new_tiles->get_source(source_id);
	while (new_atlas->get_tiles_count() > 0) {
		new_atlas->remove_tile(new_atlas->get_tile_id(0));
	}
	new_atlas->set_margins(old_atlas->get_margins());
	new_atlas->set_separation(Vector2i());
	new_atlas->set_texture_region_size(tile);
	Node *root = EditorNode::get_singleton()->get_edited_scene();
	Vector<TileMapLayer *> layers;
	if (root) {
		TypedArray<Node> found = root->find_children("*", "TileMapLayer", true, false);
		for (int i = 0; i < found.size(); i++) {
			TileMapLayer *layer = Object::cast_to<TileMapLayer>(found[i]);
			if (layer && layer->get_tile_set() == old_tiles) {
				layers.push_back(layer);
			}
		}
	}
	if (!layers.has(p_layer)) {
		layers.push_back(p_layer);
	}
	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	undo->create_action(U("Ajustar os tiles do mapa para 8×8"), UndoRedo::MERGE_DISABLE, p_layer);
	for (TileMapLayer *layer : layers) {
		const Vector<uint8_t> old_data = layer->get_tile_map_data_as_array();
		// Monta o mapa novo numa camada temporária, para gerar os dados no formato do Godot.
		TileMapLayer *scratch = memnew(TileMapLayer);
		scratch->set_tile_set(new_tiles);
		TypedArray<Vector2i> cells = layer->get_used_cells();
		cells.sort();
		for (int i = 0; i < cells.size(); i++) {
			const Vector2i cell = cells[i];
			if (layer->get_cell_source_id(cell) != source_id) {
				scratch->set_cell(cell, layer->get_cell_source_id(cell), layer->get_cell_atlas_coords(cell), layer->get_cell_alternative_tile(cell));
				continue;
			}
			const Vector2i coords = layer->get_cell_atlas_coords(cell);
			for (int y = 0; y < factor.y; y++) {
				for (int x = 0; x < factor.x; x++) {
					const Vector2i piece = coords * factor + Vector2i(x, y);
					if (!new_atlas->has_tile(piece) && new_atlas->has_room_for_tile(piece, Vector2i(1, 1), 1, Vector2i(), 1)) {
						new_atlas->create_tile(piece);
					}
					if (new_atlas->has_tile(piece)) {
						scratch->set_cell(cell + Vector2i(x, y), source_id, piece, 0);
					}
				}
			}
		}
		const Vector<uint8_t> new_data = scratch->get_tile_map_data_as_array();
		memdelete(scratch);
		undo->add_do_method(layer, "set_tile_set", new_tiles);
		undo->add_do_method(layer, "set_tile_map_data_from_array", new_data);
		undo->add_undo_method(layer, "set_tile_set", old_tiles);
		undo->add_undo_method(layer, "set_tile_map_data_from_array", old_data);
		undo->add_do_method(layer, "update_configuration_warnings");
		undo->add_undo_method(layer, "update_configuration_warnings");
		undo->add_do_method(layer, "notify_property_list_changed");
		undo->add_undo_method(layer, "notify_property_list_changed");
	}
	if (singleton) {
		undo->add_do_method(singleton, "_queue_refresh");
		undo->add_undo_method(singleton, "_queue_refresh");
	}
	undo->commit_action();
	EditorToaster::get_singleton()->popup_str(vformat(U("Tiles ajustados para %d×%d px em %d camada(s): cada tile de %d×%d virou um bloco de tiles do Mega Drive. O 2D e o jogo agora mostram o mesmo. Salve a cena."), tile.x, tile.y, layers.size(), region_size_of(old_atlas).x, region_size_of(old_atlas).y), EditorToaster::SEVERITY_INFO);
}

void RetroMapEditor::_fix_region_pressed() {
	fix_region_size(get_active_layer());
}

// ---- janela ----

RetroMapEditor *RetroMapEditor::singleton = nullptr;

void RetroMapEditor::_bind_methods() {
	ClassDB::bind_method(D_METHOD("_queue_refresh"), &RetroMapEditor::_queue_refresh);
}

Vector<TileMapLayer *> RetroMapEditor::get_layers() const {
	Vector<TileMapLayer *> plane_b, plane_a, attributes, collision;
	Node *root = EditorNode::get_singleton() ? EditorNode::get_singleton()->get_edited_scene() : nullptr;
	if (!root) {
		return Vector<TileMapLayer *>();
	}
	TypedArray<Node> found = root->find_children("*", "TileMapLayer", true, false);
	for (int i = 0; i < found.size(); i++) {
		TileMapLayer *layer = Object::cast_to<TileMapLayer>(found[i]);
		if (!layer || (layer->get_owner() != root && layer != root)) {
			continue;
		}
		if (MDMapa *mapa = Object::cast_to<MDMapa>(layer)) {
			(mapa->get_plano() == MDFundo::PLANO_A ? plane_a : plane_b).push_back(layer);
		} else if (Object::cast_to<MDPrioridade>(layer)) {
			attributes.push_back(layer);
		} else if (Object::cast_to<MDColisao>(layer)) {
			collision.push_back(layer);
		}
	}
	Vector<TileMapLayer *> layers = plane_b;
	layers.append_array(plane_a);
	layers.append_array(attributes);
	layers.append_array(collision);
	return layers;
}

TileMapLayer *RetroMapEditor::get_active_layer() const {
	TileMapLayer *layer = Object::cast_to<TileMapLayer>(ObjectDB::get_instance(active_layer));
	return layer && get_layers().has(layer) ? layer : nullptr;
}

void RetroMapEditor::set_active_layer(TileMapLayer *p_layer) {
	const ObjectID id = p_layer ? p_layer->get_instance_id() : ObjectID();
	if (id == active_layer) {
		return;
	}
	active_layer = id;
	// O pincel é do atlas da camada: outra camada, outro pincel (o primeiro tile dela).
	int source_id = -1;
	brush = layer_atlas(p_layer, &source_id).is_valid() ? RetroMapBrush::from_atlas(source_id, Vector2i(), Vector2i(1, 1)) : RetroMapBrush();
	selection = Rect2i();
	_queue_refresh();
}

bool RetroMapEditor::is_layer_dimmed(TileMapLayer *p_layer) const {
	return dim_others && dim_others->is_pressed() && p_layer->get_instance_id() != active_layer;
}

void RetroMapEditor::set_brush(const RetroMapBrush &p_brush) {
	brush = p_brush;
	if (tool == TOOL_ERASER || tool == TOOL_SELECT) {
		tool = TOOL_PENCIL; // Escolher um tile volta ao lápis (o retângulo e o balde continuam).
	}
	for (int i = 0; i < TOOL_MAX; i++) {
		tool_buttons[i]->set_pressed_no_signal(tool == i);
	}
	palette->queue_redraw();
	view->queue_redraw();
	update_status();
}

void RetroMapEditor::update_status() {
	TileMapLayer *layer = get_active_layer();
	String text;
	if (!layer) {
		text = U("Escolha uma camada à direita.");
	} else {
		text = vformat(U("Camada: %s"), layer_label(layer));
		if (locked_layers.has(layer->get_instance_id())) {
			text += U(" (com cadeado)");
		}
		if (brush.is_valid()) {
			const Ref<TileSetAtlasSource> atlas = layer_atlas(layer);
			const int columns = atlas.is_valid() ? atlas->get_atlas_grid_size().x : 0;
			if (brush.source >= 0) {
				text += vformat(U("  |  pincel: tile %d (%d, %d), %d×%d"), brush.origin.y * columns + brush.origin.x, brush.origin.x, brush.origin.y, brush.size.x, brush.size.y);
			} else {
				text += vformat(U("  |  carimbo %d×%d"), brush.size.x, brush.size.y);
			}
			if (brush.flipped_h || brush.flipped_v) {
				text += brush.flipped_h && brush.flipped_v ? U(", espelhado ↔ e ↕") : brush.flipped_h ? U(", espelhado ↔") : U(", espelhado ↕");
			}
		}
		if (selection.has_area()) {
			text += vformat(U("  |  seleção %d×%d (Ctrl+C copia, Ctrl+X recorta, Delete apaga)"), selection.size.x, selection.size.y);
		}
		if (!view->hint.is_empty()) {
			text += "  |  " + view->hint;
			view->hint = String();
		}
	}
	text += vformat(U("  |  zoom %d×"), view->zoom);
	status->set_text(text + "   " + U("P lápis · E borracha · R retângulo · B balde · S seleção · X/Y espelham · clique direito pega o tile · roda zoom · botão do meio arrasta"));
	zoom_label->set_text(vformat(U("%d×"), view->zoom));
	fix_region->set_visible(layer && needs_region_fix(layer));
	if (layer) {
		const Ref<TileSetAtlasSource> atlas = layer_atlas(layer);
		palette_title->set_text(atlas.is_valid() ? vformat(U("Tiles: %s"), atlas->get_texture()->get_path().get_file()) : U("A camada não tem imagem no TileSet."));
	} else {
		palette_title->set_text(U("Tiles"));
	}
}

void RetroMapEditor::_tool_pressed(int p_tool) {
	tool = Tool(p_tool);
	for (int i = 0; i < TOOL_MAX; i++) {
		tool_buttons[i]->set_pressed_no_signal(tool == i);
	}
	if (tool != TOOL_SELECT) {
		selection = Rect2i();
	}
	view->queue_redraw();
	update_status();
}

void RetroMapEditor::_flip_pressed(bool p_horizontal) {
	if (!brush.is_valid()) {
		return;
	}
	brush.flip(p_horizontal);
	if (tool == TOOL_ERASER || tool == TOOL_SELECT) {
		_tool_pressed(TOOL_PENCIL);
	}
	view->queue_redraw();
	update_status();
}

// A seleção vira o carimbo (com os espelhos de cada célula); recortar também a apaga do mapa.
void RetroMapEditor::_copy_selection(bool p_cut) {
	TileMapLayer *layer = get_active_layer();
	if (!layer || !selection.has_area()) {
		return;
	}
	RetroMapBrush stamp;
	stamp.size = selection.size;
	stamp.cells.resize(stamp.size.x * stamp.size.y);
	bool any = false;
	for (int y = 0; y < stamp.size.y; y++) {
		for (int x = 0; x < stamp.size.x; x++) {
			const Vector2i at = selection.position + Vector2i(x, y);
			RetroMapCell &cell = stamp.cells.write[y * stamp.size.x + x];
			cell.source = layer->get_cell_source_id(at);
			if (cell.source >= 0) {
				cell.atlas = layer->get_cell_atlas_coords(at);
				cell.alternative = layer->get_cell_alternative_tile(at);
				any = true;
			}
		}
	}
	if (!any) {
		return;
	}
	if (p_cut) {
		view->clear_cells(selection);
	}
	selection = Rect2i();
	tool = TOOL_PENCIL;
	set_brush(stamp);
}

void RetroMapEditor::_zoom_step(int p_delta) {
	view->zoom_at(view->zoom + p_delta, view->get_size() / 2);
}

void RetroMapEditor::_palette_zoom_step(int p_delta) {
	palette->zoom = CLAMP(palette->zoom + p_delta, 1, 6);
	palette->update_size();
}

void RetroMapEditor::_layer_pressed(ObjectID p_layer) {
	set_active_layer(Object::cast_to<TileMapLayer>(ObjectDB::get_instance(p_layer)));
}

void RetroMapEditor::_visibility_toggled(bool p_on, ObjectID p_layer) {
	if (p_on) {
		hidden_layers.erase(p_layer);
	} else {
		hidden_layers.insert(p_layer);
	}
	view->queue_redraw();
}

void RetroMapEditor::_lock_toggled(bool p_on, ObjectID p_layer) {
	if (p_on) {
		locked_layers.insert(p_layer);
	} else {
		locked_layers.erase(p_layer);
	}
	view->queue_redraw();
	update_status();
}

void RetroMapEditor::_new_layer(bool p_plane_a) {
	Node *root = EditorNode::get_singleton()->get_edited_scene();
	if (!root) {
		return;
	}
	MDMapa *mapa = memnew(MDMapa);
	mapa->set_plano(p_plane_a ? MDFundo::PLANO_A : MDFundo::PLANO_B);
	// O TileSet da camada ativa (ou do primeiro mapa): a camada nova já tem tiles para pintar.
	TileMapLayer *model = get_active_layer();
	if (!Object::cast_to<MDMapa>(model)) {
		model = nullptr;
		for (TileMapLayer *layer : get_layers()) {
			if (Object::cast_to<MDMapa>(layer)) {
				model = layer;
				break;
			}
		}
	}
	if (model) {
		mapa->set_tile_set(model->get_tile_set());
	}
	mapa->set_name(p_plane_a ? U("Frente") : U("Fundo"));
	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	undo->create_action(U("Nova camada de mapa"), UndoRedo::MERGE_DISABLE, root);
	undo->add_do_method(root, "add_child", mapa, true);
	undo->add_do_method(mapa, "set_owner", root);
	undo->add_do_reference(mapa);
	undo->add_undo_method(root, "remove_child", mapa);
	undo->commit_action();
	set_active_layer(mapa);
}

void RetroMapEditor::_queue_refresh() {
	if (!refresh_queued) {
		refresh_queued = true;
		callable_mp(this, &RetroMapEditor::_refresh_now).call_deferred();
	}
}

void RetroMapEditor::_layer_changed() {
	view->queue_redraw();
}

void RetroMapEditor::_connect_scene() {
	for (TileMapLayer *layer : get_layers()) {
		const Callable changed = callable_mp(this, &RetroMapEditor::_layer_changed);
		if (!layer->is_connected(CoreStringName(changed), changed)) {
			layer->connect(CoreStringName(changed), changed);
		}
	}
}

void RetroMapEditor::_refresh_now() {
	refresh_queued = false;
	const Vector<TileMapLayer *> layers = get_layers();
	if (!get_active_layer() && !layers.is_empty()) {
		// Começa no primeiro mapa do plano A (onde se pinta mais), senão no primeiro que houver.
		TileMapLayer *first = layers[0];
		for (TileMapLayer *layer : layers) {
			MDMapa *mapa = Object::cast_to<MDMapa>(layer);
			if (mapa && mapa->get_plano() == MDFundo::PLANO_A) {
				first = layer;
				break;
			}
		}
		active_layer = ObjectID();
		set_active_layer(first);
		refresh_queued = false;
	}
	_connect_scene();
	// Lista de camadas: da de cima (desenhada por último) para a de baixo, como num editor de imagens.
	while (layer_list->get_child_count() > 0) {
		Node *child = layer_list->get_child(0);
		layer_list->remove_child(child);
		child->queue_free();
	}
	for (int i = layers.size() - 1; i >= 0; i--) {
		TileMapLayer *layer = layers[i];
		const ObjectID id = layer->get_instance_id();
		HBoxContainer *row = memnew(HBoxContainer);
		Button *eye = memnew(Button);
		eye->set_toggle_mode(true);
		eye->set_pressed_no_signal(!hidden_layers.has(id));
		eye->set_button_icon(get_editor_theme_icon(hidden_layers.has(id) ? SNAME("GuiVisibilityHidden") : SNAME("GuiVisibilityVisible")));
		eye->set_flat(true);
		eye->set_tooltip_text(U("Mostrar ou esconder nesta janela (o jogo e o 2D não mudam)."));
		eye->connect(SceneStringName(toggled), callable_mp(this, &RetroMapEditor::_visibility_toggled).bind(id));
		eye->connect(SceneStringName(toggled), callable_mp(this, &RetroMapEditor::_queue_refresh).unbind(1));
		row->add_child(eye);
		Button *lock = memnew(Button);
		lock->set_toggle_mode(true);
		lock->set_pressed_no_signal(locked_layers.has(id));
		lock->set_button_icon(get_editor_theme_icon(locked_layers.has(id) ? SNAME("Lock") : SNAME("Unlock")));
		lock->set_flat(true);
		lock->set_tooltip_text(U("Cadeado: não deixa pintar nesta camada sem querer."));
		lock->connect(SceneStringName(toggled), callable_mp(this, &RetroMapEditor::_lock_toggled).bind(id));
		lock->connect(SceneStringName(toggled), callable_mp(this, &RetroMapEditor::_queue_refresh).unbind(1));
		row->add_child(lock);
		Button *name = memnew(Button);
		name->set_text(layer_label(layer));
		name->set_toggle_mode(true);
		name->set_pressed_no_signal(id == active_layer);
		name->set_text_alignment(HORIZONTAL_ALIGNMENT_LEFT);
		name->set_h_size_flags(Control::SIZE_EXPAND_FILL);
		name->set_clip_text(true);
		name->set_tooltip_text(U("Pintar nesta camada."));
		if (id == active_layer) {
			// A camada ativa em destaque (azul, com a borda do botão pressionado).
			name->add_theme_color_override(SceneStringName(font_color), Color(0.45, 0.78, 1));
			name->add_theme_color_override("font_pressed_color", Color(0.45, 0.78, 1));
			name->set_text(U("▶ ") + layer_label(layer));
		}
		name->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_layer_pressed).bind(id));
		row->add_child(name);
		layer_list->add_child(row);
	}
	palette->update_size();
	view->queue_redraw();
	update_status();
	set_title(EditorNode::get_singleton()->get_edited_scene() ? vformat(U("Editor de mapas — %s"), EditorNode::get_singleton()->get_edited_scene()->get_scene_file_path().get_file()) : U("Editor de mapas"));
}

void RetroMapEditor::scene_changed() {
	active_layer = ObjectID();
	brush = RetroMapBrush();
	selection = Rect2i();
	hidden_layers.clear();
	locked_layers.clear();
	_queue_refresh();
}

void RetroMapEditor::open() {
	if (!is_visible()) {
		const Size2 screen = DisplayServer::get_singleton()->screen_get_usable_rect(DisplayServer::get_singleton()->window_get_current_screen()).size;
		popup_centered((screen * 0.85).max(get_min_size()));
	} else {
		grab_focus();
	}
	_queue_refresh();
}

void RetroMapEditor::_close_requested() {
	if (view) {
		view->queue_redraw();
	}
	hide();
}

void RetroMapView::input(const Ref<InputEvent> &p_event) {
	Ref<InputEventKey> key = p_event;
	if (editor && key.is_valid() && editor->handle_key(key)) {
		get_viewport()->set_input_as_handled();
	}
}

bool RetroMapEditor::handle_key(const Ref<InputEventKey> &p_key) {
	const Ref<InputEventKey> &key = p_key;
	if (key.is_null() || !key->is_pressed() || key->is_echo()) {
		return false;
	}
	const Key code = key->get_keycode();
	// Atalhos da janela (ela não recebe os do editor).
	if (key->is_command_or_control_pressed()) {
		if (code == Key::Z && key->is_shift_pressed()) {
			EditorUndoRedoManager::get_singleton()->redo();
		} else if (code == Key::Z) {
			EditorUndoRedoManager::get_singleton()->undo();
		} else if (code == Key::Y) {
			EditorUndoRedoManager::get_singleton()->redo();
		} else if (code == Key::S) {
			EditorInterface::get_singleton()->save_scene();
		} else if (code == Key::C || code == Key::X) {
			if (!selection.has_area()) {
				return false;
			}
			_copy_selection(code == Key::X);
		} else {
			return false;
		}
		view->queue_redraw();
		return true;
	}
	if (key->is_alt_pressed()) {
		return false;
	}
	if (code == Key::P) {
		_tool_pressed(TOOL_PENCIL);
	} else if (code == Key::E) {
		_tool_pressed(TOOL_ERASER);
	} else if (code == Key::R) {
		_tool_pressed(TOOL_RECT);
	} else if (code == Key::B) {
		_tool_pressed(TOOL_FILL);
	} else if (code == Key::S) {
		_tool_pressed(TOOL_SELECT);
	} else if (code == Key::X) {
		_flip_pressed(true);
	} else if (code == Key::Y) {
		_flip_pressed(false);
	} else if ((code == Key::KEY_DELETE || code == Key::BACKSPACE) && selection.has_area()) {
		view->clear_cells(selection);
		selection = Rect2i();
		update_status();
	} else if (code == Key::ESCAPE && selection.has_area()) {
		selection = Rect2i();
		view->queue_redraw();
		update_status();
	} else if (code == Key::G) {
		view->show_grid = !view->show_grid;
		view->queue_redraw();
	} else {
		return false;
	}
	return true;
}

void RetroMapEditor::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_THEME_CHANGED: {
			if (tool_buttons[0]) {
				static const char *const icons[TOOL_MAX] = { "Edit", "Eraser", "Rectangle", "Bucket", "ToolSelect" };
				for (int i = 0; i < TOOL_MAX; i++) {
					tool_buttons[i]->set_button_icon(get_editor_theme_icon(icons[i]));
				}
			}
		} break;
		case NOTIFICATION_VISIBILITY_CHANGED: {
			if (is_visible()) {
				_queue_refresh();
			}
		} break;
	}
}

RetroMapEditor::RetroMapEditor() {
	singleton = this;
	set_title(U("Editor de mapas"));
	set_min_size(Size2(900, 560) * EDSCALE);
	set_transient(false);
	set_exclusive(false);
	hide();
	connect("close_requested", callable_mp(this, &RetroMapEditor::_close_requested));

	PanelContainer *background = memnew(PanelContainer);
	background->set_anchors_and_offsets_preset(Control::PRESET_FULL_RECT);
	background->set_theme_type_variation("BackgroundPanel");
	add_child(background);
	VBoxContainer *main = memnew(VBoxContainer);
	background->add_child(main);

	// Barra de ferramentas.
	HBoxContainer *toolbar = memnew(HBoxContainer);
	main->add_child(toolbar);
	static const char *const tool_names[TOOL_MAX] = { "Lápis", "Borracha", "Retângulo", "Balde", "Seleção" };
	static const char *const tool_tips[TOOL_MAX] = {
		"Lápis (P): pinta o pincel escolhido na paleta. Arraste para pintar vários.",
		"Borracha (E): apaga tiles da camada ativa.",
		"Retângulo (R): arraste um retângulo; ele se enche com o pincel, repetido.",
		"Balde (B): troca a mancha de tiles iguais em que você clicar pelo pincel (dentro do mundo da cena).",
		"Seleção (S): arraste uma área. Ctrl+C copia como carimbo, Ctrl+X recorta (para mover), Delete apaga, Esc desfaz a seleção.",
	};
	for (int i = 0; i < TOOL_MAX; i++) {
		Button *button = memnew(Button);
		button->set_text(U(tool_names[i]));
		button->set_toggle_mode(true);
		button->set_pressed(i == TOOL_PENCIL);
		button->set_tooltip_text(U(tool_tips[i]));
		button->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_tool_pressed).bind(i));
		toolbar->add_child(button);
		tool_buttons[i] = button;
	}
	toolbar->add_child(memnew(VSeparator));
	Button *flip_h = memnew(Button);
	flip_h->set_text(U("↔"));
	flip_h->set_tooltip_text(U("Espelhar o pincel na horizontal (X). O Mega Drive espelha tiles sem gastar VRAM."));
	flip_h->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_flip_pressed).bind(true));
	toolbar->add_child(flip_h);
	Button *flip_v = memnew(Button);
	flip_v->set_text(U("↕"));
	flip_v->set_tooltip_text(U("Espelhar o pincel na vertical (Y)."));
	flip_v->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_flip_pressed).bind(false));
	toolbar->add_child(flip_v);
	toolbar->add_child(memnew(VSeparator));
	CheckBox *grid = memnew(CheckBox);
	grid->set_text(U("Grade"));
	grid->set_pressed(true);
	grid->set_tooltip_text(U("Grade de 8 px (G)."));
	toolbar->add_child(grid);
	OptionButton *guide = memnew(OptionButton);
	guide->add_item(U("Tela H40 (320 px)"));
	guide->add_item(U("Tela H32 (256 px)"));
	guide->set_tooltip_text(U("Contorno roxo: o tamanho da tela do console a partir do canto (0, 0)."));
	toolbar->add_child(guide);
	toolbar->add_child(memnew(VSeparator));
	Button *zoom_out = memnew(Button);
	zoom_out->set_text(U("−"));
	zoom_out->set_flat(true);
	zoom_out->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_zoom_step).bind(-1));
	toolbar->add_child(zoom_out);
	zoom_label = memnew(Label);
	zoom_label->set_text("2×");
	toolbar->add_child(zoom_label);
	Button *zoom_in = memnew(Button);
	zoom_in->set_text("+");
	zoom_in->set_flat(true);
	zoom_in->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_zoom_step).bind(1));
	toolbar->add_child(zoom_in);
	toolbar->add_child(memnew(VSeparator));
	Button *undo_button = memnew(Button);
	undo_button->set_text(U("Desfazer"));
	undo_button->set_tooltip_text(U("Ctrl+Z"));
	undo_button->connect(SceneStringName(pressed), callable_mp(EditorUndoRedoManager::get_singleton(), &EditorUndoRedoManager::undo));
	toolbar->add_child(undo_button);
	Button *redo_button = memnew(Button);
	redo_button->set_text(U("Refazer"));
	redo_button->set_tooltip_text(U("Ctrl+Shift+Z ou Ctrl+Y"));
	redo_button->connect(SceneStringName(pressed), callable_mp(EditorUndoRedoManager::get_singleton(), &EditorUndoRedoManager::redo));
	toolbar->add_child(redo_button);

	// Paleta | mapa | camadas.
	HSplitContainer *split_left = memnew(HSplitContainer);
	split_left->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	main->add_child(split_left);

	VBoxContainer *left = memnew(VBoxContainer);
	left->set_custom_minimum_size(Size2(300, 0) * EDSCALE);
	split_left->add_child(left);
	HBoxContainer *palette_bar = memnew(HBoxContainer);
	left->add_child(palette_bar);
	palette_title = memnew(Label);
	palette_title->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	palette_title->set_clip_text(true);
	palette_bar->add_child(palette_title);
	Button *numbers = memnew(Button);
	numbers->set_text("#");
	numbers->set_toggle_mode(true);
	numbers->set_flat(true);
	numbers->set_tooltip_text(U("Mostrar o número de cada tile."));
	palette_bar->add_child(numbers);
	Button *palette_out = memnew(Button);
	palette_out->set_text(U("−"));
	palette_out->set_flat(true);
	palette_out->set_tooltip_text(U("Diminuir a paleta (ou Ctrl+roda sobre ela)."));
	palette_out->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_palette_zoom_step).bind(-1));
	palette_bar->add_child(palette_out);
	Button *palette_in = memnew(Button);
	palette_in->set_text("+");
	palette_in->set_flat(true);
	palette_in->set_tooltip_text(U("Aumentar a paleta."));
	palette_in->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_palette_zoom_step).bind(1));
	palette_bar->add_child(palette_in);
	fix_region = memnew(Button);
	fix_region->set_text(U("Ajustar os tiles para 8×8"));
	fix_region->set_tooltip_text(U("O TileSet desta camada recorta a imagem em tiles de 16×16 px (o padrão do Godot), mas o Mega Drive usa 8×8: no 2D cada tile transborda da célula e o jogo só pega um quarto dele. Ajustar transforma cada tile grande num bloco de tiles de 8×8 nos mapas que usam este TileSet. Dá para desfazer."));
	fix_region->add_theme_color_override(SceneStringName(font_color), Color(1, 0.6, 0.45));
	fix_region->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	fix_region->hide();
	fix_region->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_fix_region_pressed));
	left->add_child(fix_region);
	palette_scroll = memnew(ScrollContainer);
	palette_scroll->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	left->add_child(palette_scroll);
	palette = memnew(RetroTilePalette);
	palette->set_editor(this);
	palette->set_texture_filter(CanvasItem::TEXTURE_FILTER_NEAREST); // Pixel art sem suavização, como no console.
	palette_scroll->add_child(palette);
	Label *palette_help = memnew(Label);
	palette_help->set_text(U("Clique num tile ou arraste um retângulo para pintar vários de uma vez."));
	palette_help->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	palette_help->set_custom_minimum_size(Size2(280, 0) * EDSCALE);
	palette_help->add_theme_color_override(SceneStringName(font_color), Color(1, 1, 1, 0.55));
	left->add_child(palette_help);

	HSplitContainer *split_right = memnew(HSplitContainer);
	split_right->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	split_left->add_child(split_right);
	view = memnew(RetroMapView);
	view->set_editor(this);
	view->set_texture_filter(CanvasItem::TEXTURE_FILTER_NEAREST);
	view->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	view->set_clip_contents(true);
	view->set_focus_mode(Control::FOCUS_CLICK);
	view->set_process_input(true);
	split_right->add_child(view);

	VBoxContainer *right = memnew(VBoxContainer);
	right->set_custom_minimum_size(Size2(240, 0) * EDSCALE);
	split_right->add_child(right);
	Label *layers_title = memnew(Label(U("Camadas")));
	right->add_child(layers_title);
	ScrollContainer *layers_scroll = memnew(ScrollContainer);
	layers_scroll->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	layers_scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	right->add_child(layers_scroll);
	layer_list = memnew(VBoxContainer);
	layer_list->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	layers_scroll->add_child(layer_list);
	dim_others = memnew(CheckBox);
	dim_others->set_text(U("Apagar as outras camadas"));
	dim_others->set_tooltip_text(U("Deixa as camadas que não estão ativas meio transparentes."));
	right->add_child(dim_others);
	HBoxContainer *new_row = memnew(HBoxContainer);
	right->add_child(new_row);
	Button *new_b = memnew(Button);
	new_b->set_text(U("+ Plano B"));
	new_b->set_tooltip_text(U("Nova camada de mapa no plano B (fundo, atrás)."));
	new_b->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	new_b->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_new_layer).bind(false));
	new_row->add_child(new_b);
	Button *new_a = memnew(Button);
	new_a->set_text(U("+ Plano A"));
	new_a->set_tooltip_text(U("Nova camada de mapa no plano A (frente). Duas camadas no mesmo plano viram um plano só no jogo; a de baixo na lista fica por baixo."));
	new_a->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	new_a->connect(SceneStringName(pressed), callable_mp(this, &RetroMapEditor::_new_layer).bind(true));
	new_row->add_child(new_a);

	status = memnew(Label);
	status->set_clip_text(true);
	status->add_theme_color_override(SceneStringName(font_color), Color(1, 1, 1, 0.7));
	main->add_child(status);

	grid->connect(SceneStringName(toggled), callable_mp(this, &RetroMapEditor::_layer_changed).unbind(1));
	grid->connect(SceneStringName(toggled), callable_mp(static_cast<CanvasItem *>(view), &CanvasItem::queue_redraw).unbind(1));
	grid->connect(SceneStringName(toggled), callable_mp_static(+[](bool p_on, RetroMapView *p_view) { p_view->show_grid = p_on; }).bind(view));
	guide->connect(SceneStringName(item_selected), callable_mp_static(+[](int p_index, RetroMapView *p_view) { p_view->guide_width = p_index == 0 ? 320 : 256; p_view->queue_redraw(); }).bind(view));
	numbers->connect(SceneStringName(toggled), callable_mp_static(+[](bool p_on, RetroTilePalette *p_palette) { p_palette->show_numbers = p_on; p_palette->queue_redraw(); }).bind(palette));
	dim_others->connect(SceneStringName(toggled), callable_mp(static_cast<CanvasItem *>(view), &CanvasItem::queue_redraw).unbind(1));
}

RetroMapEditor::~RetroMapEditor() {
	if (singleton == this) {
		singleton = nullptr;
	}
}
