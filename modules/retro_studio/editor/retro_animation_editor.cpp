#include "retro_animation_editor.h"

#include "core/core_string_names.h"
#include "core/input/input.h"
#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/object/callable_mp.h"
#include "core/object/class_db.h"
#include "core/os/os.h"
#include "editor/editor_interface.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/editor_node.h"
#include "editor/editor_string_names.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/gui/editor_file_dialog.h"
#include "editor/gui/editor_toaster.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/button.h"
#include "scene/gui/check_box.h"
#include "scene/gui/flow_container.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/item_list.h"
#include "scene/gui/label.h"
#include "scene/gui/line_edit.h"
#include "scene/gui/option_button.h"
#include "scene/gui/scroll_container.h"
#include "scene/gui/separator.h"
#include "scene/gui/spin_box.h"
#include "scene/gui/split_container.h"
#include "scene/audio/audio_stream_player.h"
#include "servers/audio/audio_stream.h"
#include "scene/resources/image_texture.h"
#include "scene/scene_string_names.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

Dictionary rect_dict(const Rect2i &p_rect) {
	Dictionary d;
	d["x"] = p_rect.position.x;
	d["y"] = p_rect.position.y;
	d["width"] = p_rect.size.x;
	d["height"] = p_rect.size.y;
	return d;
}

String new_id() {
	return vformat("anim-%d-rs%d", int64_t(OS::get_singleton()->get_unix_time() * 1000), int(OS::get_singleton()->get_ticks_usec() % 100000));
}

} // namespace

// Folha mostrada, com os recortes da animação numerados. Roda = zoom; botão do meio ou direito =
// mover a vista; arrastar um recorte = mover; canto = redimensionar; arrastar no vazio (ou com
// Shift) = selecionar uma área; clique no vazio = selecionar o desenho sob o mouse.
class RetroSheetView : public Control {
	GDCLASS(RetroSheetView, Control);

public:
	enum Drag {
		DRAG_NONE,
		DRAG_PAN,
		DRAG_MOVE,
		DRAG_RESIZE,
		DRAG_SELECT,
	};

	RetroAnimationEditor *ed = nullptr;
	float zoom = 2;
	Vector2 pan = Vector2(16, 16);
	Drag drag = DRAG_NONE;
	Vector2 drag_from;
	Rect2i drag_rect;
	int drag_frame = -1;
	Dictionary before;
	bool pending_focus = false; // Enquadrar quando a vista ganhar tamanho.

	String sheet_path() const {
		return ed->_shown_sheet();
	}

	Vector2i sheet_point(const Vector2 &p_screen) const {
		const Vector2 p = ((p_screen - pan) / zoom).floor();
		return Vector2i(p.x, p.y);
	}

	Rect2 screen_rect(const Rect2i &p_rect) const {
		return Rect2(pan + Vector2(p_rect.position) * zoom, Vector2(p_rect.size) * zoom);
	}

	// Enquadra os recortes da animação (ou a folha inteira, se ela não tem quadros nessa folha).
	void focus() {
		const MDPersonagem::Animacao *anim = ed->_parsed();
		pending_focus = !is_visible_in_tree() || get_size().x < 64;
		if (pending_focus) {
			return;
		}
		const String path = sheet_path();
		Rect2i box;
		bool first = true;
		for (int i = 0; anim && i < anim->frames.size(); i++) {
			if (anim->frames[i].source == path) {
				box = first ? anim->frames[i].rect : box.merge(anim->frames[i].rect);
				first = false;
			}
		}
		if (first) {
			const Ref<Texture2D> tex = ed->_sheet(path);
			if (tex.is_null()) {
				return;
			}
			box = Rect2i(Vector2i(), tex->get_size());
		}
		const Vector2 room = get_size() - Vector2(32, 32);
		const float fit = MIN(room.x / MAX(1, box.size.x), room.y / MAX(1, box.size.y));
		zoom = fit >= 1 ? MIN(Math::floor(fit), 8.0f) : MAX(fit, 0.25f);
		pan = (get_size() - Vector2(box.size) * zoom) / 2 - Vector2(box.position) * zoom;
		pan = pan.floor();
		queue_redraw();
	}

	void _notification(int p_what) {
		if ((p_what == NOTIFICATION_RESIZED || p_what == NOTIFICATION_VISIBILITY_CHANGED) && pending_focus) {
			callable_mp(this, &RetroSheetView::focus).call_deferred();
		}
		if (p_what != NOTIFICATION_DRAW) {
			return;
		}
		draw_rect(Rect2(Vector2(), get_size()), Color(0.11, 0.11, 0.13));
		const String path = sheet_path();
		const Ref<Texture2D> tex = ed->_sheet(path);
		if (tex.is_valid()) {
			draw_rect(Rect2(pan, tex->get_size() * zoom), Color(0.2, 0.2, 0.24));
			draw_texture_rect(tex, Rect2(pan, tex->get_size() * zoom), false);
		}
		const Ref<Font> font = get_theme_default_font();
		const int font_size = get_theme_default_font_size();
		if (ed->selection.has_area()) {
			// Seleção, com as células da grade que a faixa teria.
			Vector2i size, gap, count;
			const Rect2i cells = ed->_grid_cells(size, gap, count);
			for (int i = 0; i < count.x * count.y; i++) {
				const Vector2i at = cells.position + Vector2i(i % count.x, i / count.x) * (size + gap);
				draw_rect(screen_rect(Rect2i(at, size)), Color(1, 0.55, 0.2, 0.55), false, 1);
			}
			draw_rect(screen_rect(ed->selection), Color(1, 1, 1, 0.9), false, 1);
		}
		if (ed->key_target == RetroAnimationEditor::TECLADO_FOLHA) {
			draw_rect(Rect2(Vector2(1, 1), get_size() - Vector2(2, 2)), get_theme_color(SNAME("accent_color"), EditorStringName(Editor)), false, 2);
		}
		const MDPersonagem::Animacao *anim = ed->_parsed();
		for (int i = 0; anim && i < anim->frames.size(); i++) {
			const MDPersonagem::Quadro &q = anim->frames[i];
			if (q.source != path) {
				continue;
			}
			const bool selected = i == ed->current_frame;
			const Color color = selected ? Color(1, 0.85, 0.2) : Color(0.35, 0.8, 1, 0.85);
			const Rect2 r = screen_rect(q.rect);
			draw_rect(r, color, false, selected ? 2 : 1);
			draw_string(font, r.position + Vector2(3, font->get_ascent(font_size) + 1), itos(i + 1), HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color);
			const Vector2 feet = r.position + Vector2(q.anchor) * zoom;
			draw_line(feet - Vector2(5, 0), feet + Vector2(5, 0), Color(1, 0.3, 0.3), 1);
			draw_line(feet - Vector2(0, 5), feet + Vector2(0, 5), Color(1, 0.3, 0.3), 1);
			if (selected) {
				draw_rect(Rect2(r.get_end() - Vector2(4, 4), Vector2(8, 8)), color);
			}
		}
	}

	virtual void gui_input(const Ref<InputEvent> &p_event) override {
		const Ref<InputEventMouseButton> mb = p_event;
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (mb.is_valid() && mb->is_pressed()) {
			if (mb->get_button_index() == MouseButton::WHEEL_UP || mb->get_button_index() == MouseButton::WHEEL_DOWN) {
				const Vector2 world = (mb->get_position() - pan) / zoom;
				zoom = CLAMP(zoom * (mb->get_button_index() == MouseButton::WHEEL_UP ? 1.25f : 0.8f), 0.25f, 16.0f);
				pan = mb->get_position() - world * zoom;
				queue_redraw();
				accept_event();
				return;
			}
			ed->_set_key_target(RetroAnimationEditor::TECLADO_FOLHA);
			drag = DRAG_PAN;
			drag_from = mb->get_position();
			if (mb->get_button_index() == MouseButton::LEFT && (!anim || mb->is_shift_pressed())) {
				drag = DRAG_SELECT;
				ed->_before_edit(before);
			} else if (mb->get_button_index() == MouseButton::LEFT) {
				const String path = sheet_path();
				if (ed->current_frame < anim->frames.size()) {
					const Rect2 r = screen_rect(anim->frames[ed->current_frame].rect);
					if (Rect2(r.get_end() - Vector2(6, 6), Vector2(12, 12)).has_point(drag_from)) {
						drag = DRAG_RESIZE;
						drag_frame = ed->current_frame;
					}
				}
				for (int i = anim->frames.size() - 1; drag == DRAG_PAN && i >= 0; i--) {
					if (anim->frames[i].source == path && screen_rect(anim->frames[i].rect).has_point(drag_from)) {
						drag = DRAG_MOVE;
						drag_frame = i;
						if (i != ed->current_frame) {
							ed->_frame_selected(i);
						}
					}
				}
				if (drag == DRAG_PAN) {
					drag = DRAG_SELECT;
					ed->_before_edit(before);
				} else {
					drag_rect = anim->frames[drag_frame].rect;
					ed->_before_edit(before);
				}
			}
			accept_event();
			return;
		}
		if (mb.is_valid() && !mb->is_pressed() && drag != DRAG_NONE) {
			if (drag == DRAG_SELECT) {
				// Clique sem arrastar: o desenho sob o mouse.
				const Vector2i a = sheet_point(drag_from), b = sheet_point(mb->get_position());
				if (drag_from.distance_to(mb->get_position()) < 3) {
					ed->_set_selection(ed->_detect_sprite(a));
				} else {
					ed->_set_selection(Rect2i(a.min(b), (a - b).abs() + Vector2i(1, 1)));
				}
				ed->_commit(U("Selecionar"), before);
			}
			if ((drag == DRAG_MOVE || drag == DRAG_RESIZE) && anim && drag_frame < anim->frames.size() && anim->frames[drag_frame].rect != drag_rect) {
				ed->_commit(drag == DRAG_MOVE ? U("Mover recorte") : U("Redimensionar recorte"), before);
			}
			drag = DRAG_NONE;
			return;
		}
		const Ref<InputEventMouseMotion> mm = p_event;
		if (mm.is_valid() && drag != DRAG_NONE) {
			if (drag == DRAG_PAN) {
				pan += mm->get_relative();
				queue_redraw();
				return;
			}
			if (drag == DRAG_SELECT) {
				const Vector2i a = sheet_point(drag_from), b = sheet_point(mm->get_position());
				if (drag_from.distance_to(mm->get_position()) >= 3) {
					ed->_set_selection(Rect2i(a.min(b), (a - b).abs() + Vector2i(1, 1)));
				}
				return;
			}
			const Vector2 delta_f = (mm->get_position() - drag_from) / zoom;
			const Vector2i delta(Math::round(delta_f.x), Math::round(delta_f.y));
			Rect2i rect = drag_rect;
			if (drag == DRAG_MOVE) {
				rect.position = (rect.position + delta).maxi(0);
			} else {
				rect.size = (rect.size + delta).maxi(1);
			}
			if (anim && drag_frame < anim->frames.size() && anim->frames[drag_frame].rect != rect) {
				ed->_set_frame_rect(drag_frame, rect);
			}
		}
	}

	virtual CursorShape get_cursor_shape(const Point2 &p_pos) const override {
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (anim && ed->current_frame < anim->frames.size()) {
			const Rect2 r = screen_rect(anim->frames[ed->current_frame].rect);
			if (Rect2(r.get_end() - Vector2(6, 6), Vector2(12, 12)).has_point(p_pos)) {
				return CURSOR_FDIAGSIZE;
			}
		}
		return drag == DRAG_PAN ? CURSOR_DRAG : drag == DRAG_SELECT ? CURSOR_CROSS : CURSOR_ARROW;
	}

	RetroSheetView() {
		set_clip_contents(true);
		set_texture_filter(TEXTURE_FILTER_NEAREST);
		set_focus_mode(FOCUS_CLICK);
	}
};

// Prévia da animação na célula comum, alinhada pelos pés. Clique marca os pés do quadro em edição.
class RetroAnimationPreview : public Control {
	GDCLASS(RetroAnimationPreview, Control);

public:
	RetroAnimationEditor *ed = nullptr;

	struct Layout {
		MDPersonagem::Celula cell;
		float scale = 1;
		Vector2 origin;
	};

	Layout layout() const {
		Layout l;
		l.cell = ed->personagem->get_cell();
		const Vector2 room = get_size() - Vector2(16, 40);
		l.scale = MAX(1.0f, Math::floor(MIN(room.x / l.cell.size.x, room.y / l.cell.size.y)));
		l.origin = ((get_size() - Vector2(0, 24) - Vector2(l.cell.size) * l.scale) / 2).floor();
		return l;
	}

	void draw_frame(const Layout &p_l, const MDPersonagem::Quadro &p_q, float p_alpha) {
		const Ref<Texture2D> tex = ed->_sheet(p_q.source);
		if (tex.is_null()) {
			return;
		}
		const Vector2 top_left = Vector2(p_l.cell.anchor - p_q.anchor + p_q.offset) * p_l.scale;
		draw_texture_rect_region(tex, Rect2(p_l.origin + top_left, Vector2(p_q.rect.size) * p_l.scale), Rect2(p_q.rect), Color(1, 1, 1, p_alpha));
	}

	void _notification(int p_what) {
		if (p_what != NOTIFICATION_DRAW) {
			return;
		}
		draw_rect(Rect2(Vector2(), get_size()), Color(0.11, 0.11, 0.13));
		if (ed->key_target == RetroAnimationEditor::TECLADO_PREVIA) {
			draw_rect(Rect2(Vector2(1, 1), get_size() - Vector2(2, 2)), get_theme_color(SNAME("accent_color"), EditorStringName(Editor)), false, 2);
		}
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (!anim || anim->frames.is_empty()) {
			return;
		}
		const Layout l = layout();
		const int frame = CLAMP(ed->playing ? ed->play_frame : ed->current_frame, 0, anim->frames.size() - 1);
		draw_rect(Rect2(l.origin, Vector2(l.cell.size) * l.scale), Color(0.17, 0.17, 0.2));
		for (int x = 8; x < l.cell.size.x; x += 8) {
			draw_line(l.origin + Vector2(x * l.scale, 0), l.origin + Vector2(x * l.scale, l.cell.size.y * l.scale), Color(1, 1, 1, 0.05));
		}
		for (int y = 8; y < l.cell.size.y; y += 8) {
			draw_line(l.origin + Vector2(0, y * l.scale), l.origin + Vector2(l.cell.size.x * l.scale, y * l.scale), Color(1, 1, 1, 0.05));
		}
		const MDPersonagem::Quadro *reference = ed->playing ? nullptr : ed->_reference_frame();
		if (reference) {
			draw_frame(l, *reference, 0.3);
		}
		draw_frame(l, anim->frames[frame], 1);
		const Vector2 feet = l.origin + Vector2(l.cell.anchor) * l.scale;
		const Rect2i body = ed->personagem->get_body_box();
		draw_rect(Rect2(feet + Vector2(body.position) * l.scale, Vector2(body.size) * l.scale), Color(0.3, 1, 0.4, 0.8), false, 1);
		if (anim->attack && frame >= anim->attack_first && frame <= anim->attack_last) {
			draw_rect(Rect2(feet + Vector2(anim->attack_box.position) * l.scale, Vector2(anim->attack_box.size) * l.scale), Color(1, 0.3, 0.3, 0.9), false, 1);
		}
		draw_line(feet - Vector2(8, 0), feet + Vector2(8, 0), Color(1, 0.3, 0.3), 1);
		draw_line(feet - Vector2(0, 8), feet + Vector2(0, 8), Color(1, 0.3, 0.3), 1);
		const Ref<Font> font = get_theme_default_font();
		const int font_size = get_theme_default_font_size();
		const String caption = vformat(U("Quadro %d de %d · %d/60 s · célula %d×%d"), frame + 1, anim->frames.size(), anim->frames[frame].ticks, l.cell.size.x, l.cell.size.y);
		draw_string(font, Vector2(0, get_size().y - 8), caption, HORIZONTAL_ALIGNMENT_CENTER, get_size().x, font_size, Color(0.8, 0.8, 0.85));
	}

	int box_kind = 0; // Caixa sendo desenhada (1 = corpo, 2 = ataque).
	Vector2i box_start;
	Vector2i box_cell_anchor; // Pés na célula quando o desenho começou.
	Dictionary before;

	Vector2i cell_point(const Layout &p_l, const Vector2 &p_screen) const {
		const Vector2 p = ((p_screen - p_l.origin) / p_l.scale).floor();
		return Vector2i(p.x, p.y);
	}

	virtual void gui_input(const Ref<InputEvent> &p_event) override {
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (!anim || ed->current_frame >= anim->frames.size()) {
			return;
		}
		const Layout l = layout();
		const Ref<InputEventMouseButton> mb = p_event;
		if (mb.is_valid() && mb->get_button_index() == MouseButton::LEFT && !mb->is_pressed() && box_kind) {
			ed->_commit(box_kind == 1 ? U("Caixa do corpo") : U("Caixa de ataque"), before);
			box_kind = 0;
			accept_event();
			return;
		}
		const Ref<InputEventMouseMotion> mm = p_event;
		if (mm.is_valid() && box_kind) {
			// Medida pelas bordas: arrastar até a cruz dos pés termina a caixa exatamente nos pés.
			const Vector2 p = ((mm->get_position() - l.origin) / l.scale).round();
			const Vector2i at = Vector2i(p.x, p.y) - box_cell_anchor;
			ed->_set_box(box_kind, Rect2i(at.min(box_start), (at - box_start).abs().maxi(1)));
			accept_event();
			return;
		}
		if (mb.is_null() || !mb->is_pressed() || mb->get_button_index() != MouseButton::LEFT) {
			return;
		}
		grab_focus();
		ed->_set_key_target(RetroAnimationEditor::TECLADO_PREVIA);
		if (ed->playing) {
			ed->_toggle_play();
		}
		ed->_before_edit(before);
		const int mode = ed->click_option->get_selected();
		if (mode > 0) {
			// Arrastar desenha a caixa, relativa aos pés.
			box_kind = mode;
			box_cell_anchor = l.cell.anchor;
			const Vector2 p = ((mb->get_position() - l.origin) / l.scale).round();
			box_start = Vector2i(p.x, p.y) - box_cell_anchor;
			ed->_set_box(box_kind, Rect2i(box_start, Vector2i(1, 1)));
			accept_event();
			return;
		}
		const MDPersonagem::Quadro &q = anim->frames[ed->current_frame];
		const Vector2i top_left = l.cell.anchor - q.anchor + q.offset;
		const Vector2i feet = cell_point(l, mb->get_position()) - top_left;
		ed->_set_frame_anchor(feet.clamp(Vector2i(), q.rect.size));
		ed->_commit(U("Marcar os pés"), before);
		accept_event();
	}

	RetroAnimationPreview() {
		set_clip_contents(true);
		set_texture_filter(TEXTURE_FILTER_NEAREST);
		set_custom_minimum_size(Size2(240, 240) * EDSCALE);
		set_tooltip_text(U("Clique: marca o que estiver escolhido embaixo (pés do quadro, ou arraste para desenhar a caixa do corpo ou de ataque).\nSetas (em qualquer lugar do gestor): ajuste fino do quadro (Shift = 8 pixels).\nVerde: corpo · vermelho: ataque · cruz: pés."));
	}
};

// ---- Dados ----

Array RetroAnimationEditor::_animations() const {
	return data.get("animations", Array());
}

Dictionary RetroAnimationEditor::_anim() const {
	const Array list = _animations();
	return current_anim >= 0 && current_anim < list.size() ? Dictionary(list[current_anim]) : Dictionary();
}

const MDPersonagem::Animacao *RetroAnimationEditor::_parsed() const {
	if (personagem.is_null()) {
		return nullptr;
	}
	for (const MDPersonagem::Animacao &anim : personagem->get_animations()) {
		if (anim.index == current_anim) {
			return &anim;
		}
	}
	return nullptr;
}

Ref<Texture2D> RetroAnimationEditor::_sheet(const String &p_path) {
	if (p_path.is_empty()) {
		return Ref<Texture2D>();
	}
	if (!sheets.has(p_path)) {
		const Ref<Image> image = _sheet_image(p_path);
		sheets[p_path] = image.is_valid() ? Ref<Texture2D>(ImageTexture::create_from_image(image)) : Ref<Texture2D>();
	}
	return sheets[p_path];
}

Ref<Image> RetroAnimationEditor::_sheet_image(const String &p_path) {
	if (p_path.is_empty()) {
		return Ref<Image>();
	}
	if (!sheet_images.has(p_path)) {
		const Ref<Image> image = MDPersonagem::load_sheet(p_path);
		if (image.is_valid()) {
			image->convert(Image::FORMAT_RGBA8);
		}
		sheet_images[p_path] = image;
	}
	return sheet_images[p_path];
}

// A folha escolhida no seletor; sem escolha, a do quadro em edição ou a primeira do personagem.
String RetroAnimationEditor::_shown_sheet() const {
	if (!shown_source.is_empty()) {
		return shown_source;
	}
	const MDPersonagem::Animacao *anim = _parsed();
	if (anim && current_frame < anim->frames.size()) {
		return anim->frames[current_frame].source;
	}
	if (personagem.is_valid()) {
		const HashMap<String, String> sources = personagem->get_sources();
		for (const Variant &item : Array(data.get("sources", Array()))) {
			const String id = Dictionary(item).get("id", "");
			if (sources.has(id)) {
				return sources[id];
			}
		}
		if (sources.has("sheet-1")) {
			return sources["sheet-1"];
		}
	}
	return String();
}

String RetroAnimationEditor::_source_id_of(const String &p_path) const {
	if (personagem.is_valid()) {
		for (const KeyValue<String, String> &E : personagem->get_sources()) {
			if (E.value == p_path) {
				return E.key;
			}
		}
	}
	return "sheet-1";
}

// Quadro livre com os pés na base do recorte, no meio dos pixels mais baixos do desenho (entre os
// pés de verdade, não no meio de uma espada esticada).
Dictionary RetroAnimationEditor::_frame_dict(const Rect2i &p_rect, const String &p_source_id) {
	Dictionary f = rect_dict(p_rect);
	const int feet_x = MDPersonagem::feet_x(_sheet_image(_shown_sheet()), p_rect);
	f["anchorX"] = feet_x;
	f["anchorY"] = p_rect.size.y;
	f["sourceId"] = p_source_id;
	return f;
}

// Acrescenta a animação (com nome único a partir de p_base_name) e a seleciona.
void RetroAnimationEditor::_add_animation(const String &p_base_name, Dictionary p_anim) {
	String name = p_base_name;
	for (int n = 2; personagem->find_animation(name) >= 0; n++) {
		name = p_base_name + "_" + itos(n);
	}
	Dictionary a;
	a["id"] = new_id();
	a["name"] = name;
	for (const Variant &key : p_anim.keys()) {
		a[key] = p_anim[key];
	}
	if (!a.has("fps")) {
		a["fps"] = 8;
	}
	if (!a.has("loop")) {
		a["loop"] = true;
	}
	if (a.get("frames", Variant()).get_type() == Variant::ARRAY) {
		const Array frames = a["frames"];
		Vector2i biggest;
		for (const Variant &item : frames) {
			const Dictionary f = item;
			biggest = biggest.max(Vector2i(f.get("width", 1), f.get("height", 1)));
		}
		const Dictionary first = frames.is_empty() ? Dictionary() : Dictionary(frames[0]);
		a["region"] = rect_dict(Rect2i(first.get("x", 0), first.get("y", 0), first.get("width", 1), first.get("height", 1)));
		a["columns"] = frames.size();
		a["rows"] = 1;
		a["frameCount"] = frames.size();
		a["frameWidth"] = biggest.x;
		a["frameHeight"] = biggest.y;
		a["anchorX"] = first.get("anchorX", 0);
		a["anchorY"] = first.get("anchorY", 0);
		a["sourceId"] = first.get("sourceId", "sheet-1");
	}
	Array list = _animations();
	list.push_back(a);
	data["animations"] = list;
	current_anim = list.size() - 1;
	current_frame = 0;
}

// Células da faixa em grade dentro da seleção, com os tamanhos dos campos.
Rect2i RetroAnimationEditor::_grid_cells(Vector2i &r_size, Vector2i &r_gap, Vector2i &r_count) const {
	r_size = Vector2i(MAX(1, int(grid_fields[GRADE_LARGURA]->get_value())), MAX(1, int(grid_fields[GRADE_ALTURA]->get_value())));
	r_gap = Vector2i(grid_fields[GRADE_ESPACO_X]->get_value(), grid_fields[GRADE_ESPACO_Y]->get_value());
	r_count = Vector2i(MAX(0, (selection.size.x + r_gap.x) / (r_size.x + r_gap.x)), MAX(0, (selection.size.y + r_gap.y) / (r_size.y + r_gap.y)));
	if (r_count.x * r_count.y > 255) {
		r_count.y = MAX(1, 255 / MAX(1, r_count.x));
		r_count.x = MIN(r_count.x, 255);
	}
	return selection;
}

// ---- Folhas e seleção ----


void RetroAnimationEditor::_refresh_sheets() {
	sheet_option->clear();
	if (personagem.is_null()) {
		return;
	}
	const String shown = _shown_sheet();
	const HashMap<String, String> sources = personagem->get_sources();
	Array list = data.get("sources", Array());
	if (list.is_empty() && data.has("source")) {
		Dictionary only = Dictionary(data["source"]).duplicate();
		only["id"] = "sheet-1";
		list.push_back(only);
	}
	for (const Variant &item : list) {
		const Dictionary source = item;
		const String path = sources.has(source.get("id", "")) ? sources[source.get("id", "")] : String();
		sheet_option->add_item(source.get("name", path.get_file()));
		sheet_option->set_item_metadata(-1, path);
		sheet_option->set_item_tooltip(-1, path);
		if (path == shown) {
			sheet_option->select(sheet_option->get_item_count() - 1);
		}
	}
}

void RetroAnimationEditor::_sheet_chosen(int p_index) {
	shown_source = sheet_option->get_item_metadata(p_index);
	selection = Rect2i();
	_refresh_selection();
	static_cast<RetroSheetView *>(sheet_view)->focus();
}

void RetroAnimationEditor::_add_sheet() {
	sheet_dialog->popup_file_dialog();
}

void RetroAnimationEditor::_sheet_file_chosen(const String &p_path) {
	if (personagem.is_null()) {
		return;
	}
	for (const KeyValue<String, String> &E : personagem->get_sources()) {
		if (E.value == p_path) {
			// A folha já é do personagem: só passa a mostrá-la.
			shown_source = p_path;
			_refresh_sheets();
			_sheet_chosen(sheet_option->get_selected());
			return;
		}
	}
	Dictionary before;
	_before_edit(before);
	Array list = data.get("sources", Array());
	if (list.is_empty() && data.has("source")) {
		Dictionary only = Dictionary(data["source"]).duplicate();
		only["id"] = "sheet-1";
		list.push_back(only);
	}
	String id;
	for (int n = list.size() + 1; id.is_empty() || personagem->get_sources().has(id); n++) {
		id = "sheet-" + itos(n);
	}
	Dictionary source;
	source["id"] = id;
	source["name"] = p_path.get_file();
	source["path"] = p_path.trim_prefix("res://");
	list.push_back(source);
	data["sources"] = list;
	shown_source = p_path;
	_apply();
	_commit(U("Adicionar folha"), before);
	_refresh_sheets();
	selection = Rect2i();
	_refresh_selection();
	static_cast<RetroSheetView *>(sheet_view)->focus();
}

void RetroAnimationEditor::_set_selection(const Rect2i &p_rect, bool p_reset_grid) {
	const Ref<Image> image = _sheet_image(_shown_sheet());
	selection = image.is_valid() ? p_rect.intersection(Rect2i(Vector2i(), image->get_size())) : Rect2i();
	if (selection.has_area() && p_reset_grid) {
		// A grade começa com quadros quadrados da altura da seleção.
		updating = true;
		grid_fields[GRADE_ALTURA]->set_value(selection.size.y);
		grid_fields[GRADE_LARGURA]->set_value(MIN(selection.size.x, selection.size.y));
		updating = false;
	}
	_refresh_selection();
}

void RetroAnimationEditor::_refresh_selection() {
	const bool has = selection.has_area();
	const MDPersonagem::Animacao *anim = _parsed();
	String text = has ? vformat(U("Seleção %d, %d · %d×%d"), selection.position.x, selection.position.y, selection.size.x, selection.size.y) : U("Arraste na folha para selecionar, ou clique num desenho.");
	if (key_target == TECLADO_FOLHA) {
		text += has ? U("  ·  Teclado: setas movem, Shift+setas mudam o tamanho, Esc limpa") : U("  ·  Teclado: setas movem o recorte do quadro, Shift+setas mudam o tamanho");
	}
	selection_label->set_text(text);
	selection_buttons[SELECAO_ADICIONAR]->set_disabled(!has || (anim && anim->frames.size() >= 255));
	selection_buttons[SELECAO_SUBSTITUIR]->set_disabled(!has || !anim);
	selection_buttons[SELECAO_SEPARAR]->set_disabled(!has);
	Vector2i size, gap, count;
	(void)_grid_cells(size, gap, count);
	selection_buttons[SELECAO_GRADE]->set_disabled(!has || count.x * count.y == 0);
	grid_count->set_text(has ? vformat(U("= %d quadros"), count.x * count.y) : String());
	sheet_view->queue_redraw();
}

void RetroAnimationEditor::_grid_changed(double p_value) {
	if (!updating) {
		_refresh_selection();
	}
}

Rect2i RetroAnimationEditor::_detect_sprite(const Vector2i &p_point) {
	return MDPersonagem::detect_drawing(_sheet_image(_shown_sheet()), p_point);
}

Vector<Rect2i> RetroAnimationEditor::_split_selection() {
	return MDPersonagem::split_drawings(_sheet_image(_shown_sheet()), selection);
}

void RetroAnimationEditor::_selection_action(int p_action) {
	if (personagem.is_null() || !selection.has_area()) {
		return;
	}
	const String source_id = _source_id_of(_shown_sheet());
	Dictionary before;
	_before_edit(before);
	Dictionary a = _anim();
	String action_name;
	switch (p_action) {
		case SELECAO_ADICIONAR: {
			action_name = U("Adicionar quadro");
			if (a.is_empty()) {
				Dictionary anim;
				Array frames;
				frames.push_back(_frame_dict(selection, source_id));
				anim["frames"] = frames;
				_add_animation("animacao", anim);
			} else {
				Array frames = _ensure_free(a);
				frames.insert(current_frame + 1, _frame_dict(selection, source_id));
				current_frame++;
				a["frameCount"] = frames.size();
				a["columns"] = frames.size();
			}
		} break;
		case SELECAO_SUBSTITUIR: {
			action_name = U("Substituir quadro");
			Array frames = _ensure_free(a);
			if (current_frame < frames.size()) {
				frames[current_frame] = _frame_dict(selection, source_id);
			}
		} break;
		case SELECAO_SEPARAR: {
			action_name = U("Nova animação com os desenhos");
			const Vector<Rect2i> rects = _split_selection();
			if (rects.is_empty()) {
				EditorToaster::get_singleton()->popup_str(U("Nenhum desenho na seleção (tudo transparente ou da cor do fundo)."), EditorToaster::SEVERITY_WARNING);
				return;
			}
			Array frames;
			for (const Rect2i &rect : rects) {
				frames.push_back(_frame_dict(rect, source_id));
			}
			Dictionary anim;
			anim["frames"] = frames;
			_add_animation("animacao", anim);
		} break;
		case SELECAO_GRADE: {
			action_name = U("Nova faixa em grade");
			Vector2i size, gap, count;
			(void)_grid_cells(size, gap, count);
			if (count.x * count.y == 0) {
				return;
			}
			Dictionary anim;
			anim["region"] = rect_dict(selection);
			anim["frameWidth"] = size.x;
			anim["frameHeight"] = size.y;
			anim["spacingX"] = gap.x;
			anim["spacingY"] = gap.y;
			anim["columns"] = count.x;
			anim["rows"] = count.y;
			anim["frameCount"] = count.x * count.y;
			anim["anchorX"] = size.x / 2;
			anim["anchorY"] = size.y;
			anim["sourceId"] = source_id;
			_add_animation("animacao", anim);
		} break;
	}
	_apply();
	_commit(action_name, before);
	if (p_action == SELECAO_SEPARAR || p_action == SELECAO_GRADE || (p_action == SELECAO_ADICIONAR && a.is_empty())) {
		name_edit->grab_focus();
		name_edit->select_all();
	}
}

String RetroAnimationEditor::create_character(const String &p_sheet, String &r_error) {
	const String base = p_sheet.get_basename();
	String path = base + ".charset.json";
	for (int n = 2; FileAccess::exists(path); n++) {
		path = base + "_" + itos(n) + ".charset.json";
	}
	const String relative = p_sheet.trim_prefix("res://");
	Dictionary source;
	source["id"] = "sheet-1";
	source["name"] = p_sheet.get_file();
	source["path"] = relative;
	Dictionary single;
	single["path"] = relative;
	single["name"] = p_sheet.get_file();
	Array sources;
	sources.push_back(source);
	Dictionary body_box = rect_dict(Rect2i(-8, -32, 16, 32));
	Dictionary d;
	d["format"] = "retro-studio-charset-project";
	d["version"] = 8;
	d["characterId"] = vformat("%x-%x", int64_t(OS::get_singleton()->get_unix_time()), int64_t(OS::get_singleton()->get_ticks_usec()));
	d["characterName"] = p_sheet.get_file().get_basename();
	d["source"] = single;
	d["sources"] = sources;
	d["activeSourceId"] = "sheet-1";
	d["frameWidth"] = 32;
	d["frameHeight"] = 32;
	d["anchorX"] = 16;
	d["anchorY"] = 32;
	d["spacingX"] = 0;
	d["spacingY"] = 0;
	d["captureMode"] = "free";
	d["bodyBox"] = body_box;
	d["animations"] = Array();
	const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
	if (file.is_null()) {
		r_error = U("Não foi possível criar ") + path + ".";
		return String();
	}
	file->store_string(JSON::stringify(d, "  ", false) + "\n");
	return path;
}

// Faixa em grade vira quadros livres (mesmos recortes) antes de editar um quadro, como no Electron.
Array RetroAnimationEditor::_ensure_free(Dictionary p_anim) {
	return MDPersonagem::ensure_free_frames(p_anim, _parsed());
}

// O personagem mudou por fora do gestor (a IA gravou pelo servidor MCP): mostra o que está nele.
// A IA já gravou o arquivo, então não há mudança pendente.
void RetroAnimationEditor::_on_external_change() {
	if (applying || personagem.is_null()) {
		return;
	}
	data = personagem->get_data();
	saved_json = JSON::stringify(data);
	if (current_anim >= _animations().size()) {
		current_anim = _animations().size() - 1;
	}
	if (current_anim < 0 && !_animations().is_empty()) {
		current_anim = 0;
	}
	sheets.clear();
	sheet_images.clear();
	_refresh();
	_refresh_sheets();
	_refresh_selection();
}

void RetroAnimationEditor::_apply() {
	applying = true;
	(void)personagem->set_data(data);
	applying = false;
	const MDPersonagem::Animacao *anim = _parsed();
	current_frame = anim ? CLAMP(current_frame, 0, anim->frames.size() - 1) : 0;
	play_frame = anim ? CLAMP(play_frame, 0, anim->frames.size() - 1) : 0;
	_refresh_list();
	_refresh_timeline();
	_refresh_fields();
	sheet_view->queue_redraw();
	preview->queue_redraw();
}

Dictionary RetroAnimationEditor::_state() const {
	Dictionary state;
	state["data"] = data.duplicate(true);
	state["selection"] = selection;
	state["anim"] = current_anim;
	state["frame"] = current_frame;
	return state;
}

// Mudanças seguidas com o mesmo nome em menos de 0,8 s (tecla segurada, campo arrastado) viram um passo.
void RetroAnimationEditor::_commit(const String &p_name, const Dictionary &p_before, bool p_merge) {
	const Dictionary after = _state();
	if (JSON::stringify(after) == JSON::stringify(p_before)) {
		return; // Nada mudou (seta na borda da folha, por exemplo).
	}
	history->create_action(p_name, p_merge ? UndoRedo::MERGE_ENDS : UndoRedo::MERGE_DISABLE);
	history->add_do_method(callable_mp(this, &RetroAnimationEditor::_restore).bind(after));
	history->add_undo_method(callable_mp(this, &RetroAnimationEditor::_restore).bind(p_before));
	history->commit_action(false);
	_refresh_history();
}

// Volta ao estado, inclusive à animação e ao quadro em que a mudança foi feita.
void RetroAnimationEditor::_restore(const Dictionary &p_state) {
	const bool other_anim = int(p_state["anim"]) != current_anim;
	data = Dictionary(p_state["data"]).duplicate(true);
	selection = p_state["selection"];
	current_anim = CLAMP(int(p_state["anim"]), _animations().is_empty() ? -1 : 0, _animations().size() - 1);
	current_frame = p_state["frame"];
	_apply();
	_refresh_sheets();
	_refresh_selection();
	if (other_anim) {
		shown_source = String();
		static_cast<RetroSheetView *>(sheet_view)->focus();
	}
}

void RetroAnimationEditor::_undo() {
	if (history->has_undo()) {
		history->undo();
		_refresh_history();
	}
}

void RetroAnimationEditor::_redo() {
	if (history->has_redo()) {
		history->redo();
		_refresh_history();
	}
}

void RetroAnimationEditor::_refresh_history() {
	undo_button->set_disabled(!history->has_undo());
	redo_button->set_disabled(!history->has_redo());
	undo_button->set_tooltip_text(history->has_undo() ? vformat(U("Desfazer: %s (Ctrl+Z)"), history->get_current_action_name()) : U("Nada para desfazer (Ctrl+Z)"));
	redo_button->set_tooltip_text(history->has_redo() ? U("Refazer (Ctrl+Shift+Z ou Ctrl+Y)") : U("Nada para refazer (Ctrl+Shift+Z ou Ctrl+Y)"));
}

void RetroAnimationEditor::_set_frame_rect(int p_frame, const Rect2i &p_rect) {
	Dictionary anim = _anim();
	const Array frames = _ensure_free(anim);
	if (p_frame < 0 || p_frame >= frames.size()) {
		return;
	}
	Dictionary f = frames[p_frame];
	const Dictionary rect = rect_dict(p_rect);
	for (const Variant &key : rect.keys()) {
		f[key] = rect[key];
	}
	f["anchorX"] = CLAMP(int(f.get("anchorX", p_rect.size.x / 2)), 0, p_rect.size.x);
	f["anchorY"] = CLAMP(int(f.get("anchorY", p_rect.size.y)), 0, p_rect.size.y);
	_apply();
}

// Na grade o apoio é da faixa inteira; nos quadros livres, de cada quadro.
void RetroAnimationEditor::_set_frame_anchor(const Vector2i &p_anchor) {
	Dictionary anim = _anim();
	if (anim.get("frames", Variant()).get_type() == Variant::ARRAY) {
		const Array frames = anim["frames"];
		if (current_frame < frames.size()) {
			Dictionary f = frames[current_frame];
			f["anchorX"] = p_anchor.x;
			f["anchorY"] = p_anchor.y;
		}
	} else {
		anim["anchorX"] = p_anchor.x;
		anim["anchorY"] = p_anchor.y;
	}
	_apply();
}

void RetroAnimationEditor::_set_box(int p_kind, const Rect2i &p_box) {
	const Dictionary rect = rect_dict(p_box);
	if (p_kind == 1) {
		Dictionary body_box = data.get("bodyBox", Dictionary());
		for (const Variant &key : rect.keys()) {
			body_box[key] = rect[key];
		}
		data["bodyBox"] = body_box;
	} else {
		Dictionary a = _anim();
		Dictionary attack = a.get("attack", Dictionary());
		if (!bool(attack.get("enabled", false))) {
			// Caixa nova: vale para o quadro em edição; os quadros se ajustam nos campos.
			attack["enabled"] = true;
			attack["firstFrame"] = current_frame;
			attack["lastFrame"] = current_frame;
		}
		for (const Variant &key : rect.keys()) {
			attack[key] = rect[key];
		}
		a["attack"] = attack;
	}
	_apply();
}

// Setas em qualquer lugar do gestor (menos digitando num campo): ajuste fino do quadro em edição.
// Vem antes da interface, para a lista e a fila de quadros não usarem as setas para navegar.
void RetroAnimationEditor::input(const Ref<InputEvent> &p_event) {
	const Ref<InputEventKey> key = p_event;
	if (key.is_null() || !key->is_pressed() || !is_visible_in_tree() || personagem.is_null() || key->is_alt_pressed()) {
		return;
	}
	const Key code = key->get_keycode();
	if (key->is_ctrl_pressed() || key->is_meta_pressed()) {
		// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: o histórico do gestor (o campo de texto em foco tem o seu).
		const bool undo = code == Key::Z && !key->is_shift_pressed();
		const bool redo = (code == Key::Z && key->is_shift_pressed()) || code == Key::Y;
		const Control *focus = get_viewport()->gui_get_focus_owner();
		if ((!undo && !redo) || (focus && (Object::cast_to<LineEdit>(focus) || !is_ancestor_of(focus)))) {
			return;
		}
		get_viewport()->set_input_as_handled();
		if (undo) {
			_undo();
		} else {
			_redo();
		}
		return;
	}
	const Vector2i delta = code == Key::LEFT ? Vector2i(-1, 0) : code == Key::RIGHT ? Vector2i(1, 0) : code == Key::UP ? Vector2i(0, -1) : code == Key::DOWN ? Vector2i(0, 1) : Vector2i();
	if (delta == Vector2i() && !(code == Key::ESCAPE && key_target == TECLADO_FOLHA && selection.has_area())) {
		return;
	}
	const Control *focus = get_viewport()->gui_get_focus_owner();
	if (focus && (Object::cast_to<LineEdit>(focus) || !is_ancestor_of(focus))) {
		return; // Digitando num campo, ou o foco está em outro painel do editor.
	}
	get_viewport()->set_input_as_handled();
	if (key_target == TECLADO_PREVIA) {
		_nudge(delta * (key->is_shift_pressed() ? 8 : 1));
		return;
	}
	if (code == Key::ESCAPE) {
		Dictionary before = _state();
		_set_selection(Rect2i(), false);
		_commit(U("Limpar seleção"), before);
		return;
	}
	// Na folha: a seleção, ou, sem seleção, o recorte do quadro em edição. Shift muda o tamanho.
	auto adjust = [&](Rect2i p_rect) {
		if (key->is_shift_pressed()) {
			p_rect.size = (p_rect.size + delta).maxi(1);
		} else {
			p_rect.position = (p_rect.position + delta).maxi(0);
		}
		return p_rect;
	};
	if (selection.has_area()) {
		Dictionary before = _state();
		_set_selection(adjust(selection), false);
		_commit(key->is_shift_pressed() ? U("Tamanho da seleção") : U("Mover seleção"), before, true);
		return;
	}
	const MDPersonagem::Animacao *anim = _parsed();
	if (!anim || current_frame >= anim->frames.size()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	_set_frame_rect(current_frame, adjust(anim->frames[current_frame].rect));
	_commit(key->is_shift_pressed() ? U("Redimensionar recorte") : U("Mover recorte"), before, true);
}

void RetroAnimationEditor::_set_key_target(TecladoAlvo p_target) {
	if (key_target == p_target) {
		return;
	}
	key_target = p_target;
	sheet_view->queue_redraw();
	preview->queue_redraw();
	_refresh_selection();
}

void RetroAnimationEditor::_nudge_button(int p_direction) {
	const Vector2i deltas[] = { Vector2i(-1, 0), Vector2i(0, -1), Vector2i(0, 1), Vector2i(1, 0) };
	_nudge(deltas[p_direction] * (Input::get_singleton()->is_key_pressed(Key::SHIFT) ? 8 : 1));
}

void RetroAnimationEditor::_nudge(const Vector2i &p_delta) {
	Dictionary a = _anim();
	const MDPersonagem::Animacao *anim = _parsed();
	if (a.is_empty() || !anim || current_frame >= anim->frames.size()) {
		return;
	}
	if (playing) {
		_toggle_play(); // O ajuste é no quadro em edição; a prévia para nele.
	}
	Dictionary before;
	_before_edit(before);
	const Vector2i offset = (anim->frames[current_frame].offset + p_delta).clampi(-128, 128);
	const Array frames = _ensure_free(a);
	Dictionary f = frames[current_frame];
	for (int axis = 0; axis < 2; axis++) {
		const String key = axis ? "offsetY" : "offsetX";
		if (offset[axis]) {
			f[key] = offset[axis];
		} else {
			f.erase(key);
		}
	}
	_apply();
	_commit(U("Ajuste fino"), before, true);
}

// Quadro de referência escolhido (metadado: x = tipo, y = animação para "primeiro quadro de").
const MDPersonagem::Quadro *RetroAnimationEditor::_reference_frame() const {
	const MDPersonagem::Animacao *anim = _parsed();
	if (!anim || anim->frames.is_empty() || reference_option->get_selected() < 0) {
		return nullptr;
	}
	const Vector2i choice = reference_option->get_item_metadata(reference_option->get_selected());
	const int count = anim->frames.size();
	switch (choice.x) {
		case 1:
			return count > 1 ? &anim->frames[(current_frame + count - 1) % count] : nullptr;
		case 2:
			return count > 1 ? &anim->frames[(current_frame + 1) % count] : nullptr;
		case 3:
			return current_frame > 0 ? &anim->frames[0] : nullptr;
		case 4:
			for (const MDPersonagem::Animacao &other : personagem->get_animations()) {
				if (other.index == choice.y && other.index != current_anim) {
					return &other.frames[0];
				}
			}
			break;
	}
	return nullptr;
}

void RetroAnimationEditor::_refresh_references() {
	Vector2i previous(1, -1);
	if (reference_option->get_selected() >= 0) {
		previous = reference_option->get_item_metadata(reference_option->get_selected());
	}
	reference_option->clear();
	const char *names[] = { "Sem referência", "Quadro anterior", "Quadro seguinte", "Primeiro quadro" };
	for (int i = 0; i < 4; i++) {
		reference_option->add_item(U(names[i]));
		reference_option->set_item_metadata(-1, Vector2i(i, -1));
	}
	if (personagem.is_valid() && personagem->get_animations().size() > 1) {
		reference_option->add_separator();
		for (const MDPersonagem::Animacao &other : personagem->get_animations()) {
			reference_option->add_item(vformat(U("1º quadro de %s"), other.name));
			reference_option->set_item_metadata(-1, Vector2i(4, other.index));
		}
	}
	for (int i = 0; i < reference_option->get_item_count(); i++) {
		if (!reference_option->is_item_separator(i) && Vector2i(reference_option->get_item_metadata(i)) == previous) {
			reference_option->select(i);
		}
	}
}

// ---- Interface ----

void RetroAnimationEditor::_refresh() {
	_refresh_list();
	_refresh_timeline();
	_refresh_fields();
	sheet_view->queue_redraw();
	preview->queue_redraw();
}

void RetroAnimationEditor::_refresh_list() {
	const bool has = personagem.is_valid();
	empty_label->set_visible(!has);
	body->set_visible(has);
	save_button->set_disabled(!has);
	if (!has) {
		title->set_text(U("Animações"));
		info->set_text(String());
		return;
	}
	const bool changed = has_unsaved_changes();
	title->set_text(personagem->get_character_name() + (changed ? " *" : ""));
	const MDPersonagem::Celula cell = personagem->get_cell();
	info->set_text(vformat(U("%s · %d animações · célula %d×%d (pés em %d, %d)"), personagem->get_path().get_file(), personagem->get_animations().size(), cell.size.x, cell.size.y, cell.anchor.x, cell.anchor.y));
	updating = true;
	const Array list = _animations();
	anim_list->clear();
	for (int i = 0; i < list.size(); i++) {
		const Dictionary a = list[i];
		int count = 0;
		for (const MDPersonagem::Animacao &parsed : personagem->get_animations()) {
			if (parsed.index == i) {
				count = parsed.frames.size();
			}
		}
		const bool free = a.get("frames", Variant()).get_type() == Variant::ARRAY;
		anim_list->add_item(vformat("%s (%d)", a.get("name", ""), count));
		anim_list->set_item_tooltip(i, vformat(U("%s: %d quadros, %s"), a.get("name", ""), count, free ? U("quadros livres") : U("faixa em grade")));
	}
	if (current_anim >= 0 && current_anim < list.size()) {
		anim_list->select(current_anim);
		anim_list->ensure_current_is_visible();
	}
	_refresh_references();
	updating = false;
}

void RetroAnimationEditor::_refresh_timeline() {
	updating = true;
	timeline->clear();
	const MDPersonagem::Animacao *anim = _parsed();
	HashMap<String, Ref<Image>> images;
	for (int i = 0; anim && i < anim->frames.size(); i++) {
		const MDPersonagem::Quadro &q = anim->frames[i];
		const Ref<Texture2D> sheet = _sheet(q.source);
		Ref<Texture2D> thumb;
		if (sheet.is_valid()) {
			if (!images.has(q.source)) {
				images[q.source] = sheet->get_image();
			}
			const Ref<Image> image = images[q.source];
			const Rect2i rect = q.rect.intersection(Rect2i(Vector2i(), image->get_size()));
			if (rect.size.x > 0 && rect.size.y > 0) {
				Ref<Image> part = image->get_region(rect);
				const float scale = MIN(64.0f * EDSCALE / rect.size.x, 64.0f * EDSCALE / rect.size.y);
				part->resize(MAX(1, int(rect.size.x * scale)), MAX(1, int(rect.size.y * scale)), Image::INTERPOLATE_NEAREST);
				thumb = ImageTexture::create_from_image(part);
			}
		}
		timeline->add_item(vformat("%d  %d/60%s", i + 1, q.ticks, q.sound.is_empty() ? "" : U("  ♪")), thumb);
	}
	if (anim && current_frame < anim->frames.size()) {
		timeline->select(current_frame);
		timeline->ensure_current_is_visible();
	}
	updating = false;
}

void RetroAnimationEditor::_refresh_fields() {
	const Dictionary a = _anim();
	const MDPersonagem::Animacao *anim = _parsed();
	const bool has = !a.is_empty() && anim && !anim->frames.is_empty();
	form_box->set_visible(has);
	no_animation_label->set_visible(!has && personagem.is_valid());
	if (!has) {
		return;
	}
	updating = true;
	const MDPersonagem::Quadro &q = anim->frames[CLAMP(current_frame, 0, anim->frames.size() - 1)];
	if (!name_edit->has_focus()) {
		name_edit->set_text(a.get("name", ""));
	}
	loop_check->set_pressed(anim->loop);
	attack_check->set_pressed(anim->attack);
	const bool free = a.get("frames", Variant()).get_type() == Variant::ARRAY;
	mode_label->set_text(free ? U("Quadros livres: cada quadro tem recorte, pés e tempo próprios.") : U("Faixa em grade: os pés valem para a faixa toda. Mexer no recorte, no tempo ou no ajuste de um quadro passa a animação para quadros livres."));
	const Rect2i body_box = personagem->get_body_box();
	const int values[CAMPO_MAX] = {
		anim->fps, q.ticks, q.anchor.x, q.anchor.y, q.offset.x, q.offset.y,
		q.rect.position.x, q.rect.position.y, q.rect.size.x, q.rect.size.y,
		body_box.position.x, body_box.position.y, body_box.size.x, body_box.size.y,
		anim->attack_box.position.x, anim->attack_box.position.y, anim->attack_box.size.x, anim->attack_box.size.y,
		anim->attack_first + 1, anim->attack_last + 1
	};
	offset_label->set_text(vformat("%d, %d", q.offset.x, q.offset.y));
	int sound_index = q.sound.is_empty() ? 0 : sound_files.find(q.sound) + 1;
	if (sound_index <= 0 && !q.sound.is_empty()) {
		// Som fora da lista (arquivo apagado ou ainda não visto): aparece no fim para não sumir.
		sound_files.push_back(q.sound);
		sound_option->add_item(q.sound.get_file() + U(" (não encontrado)"));
		sound_index = sound_files.size();
	}
	sound_option->select(sound_index);
	sound_listen->set_disabled(q.sound.is_empty());
	fields[CAMPO_APOIO_X]->set_max(q.rect.size.x);
	fields[CAMPO_APOIO_Y]->set_max(q.rect.size.y);
	for (int i = 0; i < CAMPO_MAX; i++) {
		fields[i]->set_value(values[i]);
	}
	for (int i = CAMPO_ATAQUE_X; i <= CAMPO_ATAQUE_ATE; i++) {
		fields[i]->set_editable(anim->attack);
	}
	updating = false;
}

void RetroAnimationEditor::_anim_selected(int p_index) {
	if (updating) {
		return;
	}
	current_anim = p_index;
	current_frame = 0;
	play_frame = 0;
	play_ticks = 0;
	shown_source = String();
	_refresh_sheets();
	_refresh_selection();
	_refresh_timeline();
	_refresh_fields();
	preview->queue_redraw();
	static_cast<RetroSheetView *>(sheet_view)->focus();
}

void RetroAnimationEditor::_frame_selected(int p_index) {
	if (updating) {
		return;
	}
	current_frame = p_index;
	const MDPersonagem::Animacao *anim = _parsed();
	if (anim && p_index < anim->frames.size() && anim->frames[p_index].source != _shown_sheet()) {
		shown_source = String();
		_refresh_sheets();
		static_cast<RetroSheetView *>(sheet_view)->focus();
	}
	if (timeline->get_item_count() > p_index && !timeline->is_selected(p_index)) {
		updating = true;
		timeline->select(p_index);
		updating = false;
	}
	_refresh_fields();
	sheet_view->queue_redraw();
	preview->queue_redraw();
}

void RetroAnimationEditor::_name_changed(const String &p_name) {
	const String name = p_name.strip_edges();
	Dictionary a = _anim();
	if (updating || a.is_empty() || name.is_empty() || name == String(a.get("name", ""))) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	a["name"] = name;
	_apply();
	_commit(U("Renomear animação"), before, true);
}

void RetroAnimationEditor::_name_focus_exited() {
	_name_changed(name_edit->get_text());
}

void RetroAnimationEditor::_loop_toggled(bool p_on) {
	Dictionary a = _anim();
	if (updating || a.is_empty()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	a["loop"] = p_on;
	_apply();
	_commit(U("Repetir animação"), before);
}

void RetroAnimationEditor::_attack_toggled(bool p_on) {
	Dictionary a = _anim();
	if (updating || a.is_empty()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	Dictionary attack = a.get("attack", Dictionary());
	if (!attack.has("width")) {
		attack = rect_dict(Rect2i(0, -24, 16, 16));
		attack["firstFrame"] = 0;
		attack["lastFrame"] = 0;
	}
	attack["enabled"] = p_on;
	a["attack"] = attack;
	_apply();
	_commit(U("Caixa de ataque"), before);
}

void RetroAnimationEditor::_field_changed(double p_value, int p_field) {
	Dictionary a = _anim();
	const MDPersonagem::Animacao *anim = _parsed();
	if (updating || a.is_empty() || !anim) {
		return;
	}
	const int v = int(p_value);
	Dictionary before;
	_before_edit(before);
	switch (p_field) {
		case CAMPO_FPS:
			a["fps"] = v;
			break;
		case CAMPO_TEMPO: {
			const Array frames = _ensure_free(a);
			Dictionary f = frames[current_frame];
			f["durationTicks"] = v;
		} break;
		case CAMPO_APOIO_X:
		case CAMPO_APOIO_Y: {
			Vector2i anchor = anim->frames[current_frame].anchor;
			anchor[p_field == CAMPO_APOIO_X ? 0 : 1] = v;
			_set_frame_anchor(anchor);
		} break;
		case CAMPO_AJUSTE_X:
		case CAMPO_AJUSTE_Y: {
			const Array frames = _ensure_free(a);
			Dictionary f = frames[current_frame];
			const String key = p_field == CAMPO_AJUSTE_X ? "offsetX" : "offsetY";
			if (v) {
				f[key] = v;
			} else {
				f.erase(key);
			}
		} break;
		case CAMPO_RECORTE_X:
		case CAMPO_RECORTE_Y:
		case CAMPO_RECORTE_L:
		case CAMPO_RECORTE_A: {
			Rect2i rect = anim->frames[current_frame].rect;
			const int index = p_field - CAMPO_RECORTE_X;
			(index < 2 ? rect.position : rect.size)[index % 2] = v;
			_set_frame_rect(current_frame, rect);
		} break;
		case CAMPO_CORPO_X:
		case CAMPO_CORPO_Y:
		case CAMPO_CORPO_L:
		case CAMPO_CORPO_A: {
			Rect2i box = personagem->get_body_box();
			const int index = p_field - CAMPO_CORPO_X;
			(index < 2 ? box.position : box.size)[index % 2] = v;
			Dictionary body_box = data.get("bodyBox", Dictionary());
			const Dictionary rect = rect_dict(box);
			for (const Variant &key : rect.keys()) {
				body_box[key] = rect[key];
			}
			data["bodyBox"] = body_box;
		} break;
		default: {
			Dictionary attack = a.get("attack", Dictionary());
			Rect2i box = anim->attack_box;
			if (p_field <= CAMPO_ATAQUE_A) {
				const int index = p_field - CAMPO_ATAQUE_X;
				(index < 2 ? box.position : box.size)[index % 2] = v;
				const Dictionary rect = rect_dict(box);
				for (const Variant &key : rect.keys()) {
					attack[key] = rect[key];
				}
			} else {
				attack[p_field == CAMPO_ATAQUE_DE ? "firstFrame" : "lastFrame"] = v - 1;
			}
			a["attack"] = attack;
		} break;
	}
	_apply();
	_commit(U("Mudar animação"), before, true);
}

void RetroAnimationEditor::_new_animation() {
	if (personagem.is_null()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	const MDPersonagem::Animacao *parsed = _parsed();
	MDPersonagem::Quadro base;
	base.rect = Rect2i(0, 0, 32, 32);
	base.anchor = Vector2i(16, 32);
	if (parsed && current_frame < parsed->frames.size()) {
		base = parsed->frames[current_frame];
	} else {
		base.source_id = _source_id_of(_shown_sheet());
		if (selection.has_area()) {
			base.rect = selection;
			base.anchor = Vector2i(selection.size.x / 2, selection.size.y);
		}
	}
	Array list = _animations();
	String name = "animacao";
	for (int n = 2; personagem->find_animation(name) >= 0; n++) {
		name = "animacao_" + itos(n);
	}
	Dictionary f = rect_dict(base.rect);
	f["anchorX"] = base.anchor.x;
	f["anchorY"] = base.anchor.y;
	f["sourceId"] = base.source_id;
	Dictionary a;
	a["id"] = new_id();
	a["name"] = name;
	a["region"] = rect_dict(base.rect);
	a["columns"] = 1;
	a["rows"] = 1;
	a["frameCount"] = 1;
	a["frameWidth"] = base.rect.size.x;
	a["frameHeight"] = base.rect.size.y;
	a["anchorX"] = base.anchor.x;
	a["anchorY"] = base.anchor.y;
	a["fps"] = 8;
	a["loop"] = true;
	a["sourceId"] = base.source_id;
	Array frames;
	frames.push_back(f);
	a["frames"] = frames;
	list.push_back(a);
	data["animations"] = list;
	current_anim = list.size() - 1;
	current_frame = 0;
	_apply();
	_commit(U("Nova animação"), before);
	static_cast<RetroSheetView *>(sheet_view)->focus();
	name_edit->grab_focus();
	name_edit->select_all();
}

void RetroAnimationEditor::_duplicate_animation() {
	Dictionary a = _anim();
	if (a.is_empty()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	Dictionary copy = a.duplicate(true);
	String name = String(a.get("name", "")) + "_copia";
	for (int n = 2; personagem->find_animation(name) >= 0; n++) {
		name = String(a.get("name", "")) + "_copia" + itos(n);
	}
	copy["name"] = name;
	copy["id"] = new_id();
	Array list = _animations();
	list.insert(current_anim + 1, copy);
	current_anim++;
	_apply();
	_commit(U("Duplicar animação"), before);
}

void RetroAnimationEditor::_remove_animation() {
	Array list = _animations();
	if (current_anim < 0 || current_anim >= list.size()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	list.remove_at(current_anim);
	current_anim = MIN(current_anim, list.size() - 1);
	current_frame = 0;
	_apply();
	_commit(U("Remover animação"), before);
}

// 0 = para a esquerda, 1 = para a direita, 2 = duplicar, 3 = remover.
void RetroAnimationEditor::_frame_action(int p_action) {
	Dictionary a = _anim();
	const MDPersonagem::Animacao *anim = _parsed();
	if (a.is_empty() || !anim) {
		return;
	}
	const int count = anim->frames.size();
	const int target = current_frame + (p_action == 0 ? -1 : 1);
	if ((p_action < 2 && (target < 0 || target >= count)) || (p_action == 2 && count >= 255) || (p_action == 3 && count < 2)) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	Array frames = _ensure_free(a);
	const Variant frame = frames[current_frame];
	if (p_action < 2) {
		frames[current_frame] = frames[target];
		frames[target] = frame;
		current_frame = target;
	} else if (p_action == 2) {
		frames.insert(current_frame + 1, Dictionary(frame).duplicate(true));
		current_frame++;
	} else {
		frames.remove_at(current_frame);
	}
	a["frameCount"] = frames.size();
	a["columns"] = frames.size();
	_apply();
	const char *names[] = { "Mover quadro", "Mover quadro", "Duplicar quadro", "Remover quadro" };
	_commit(U(names[p_action]), before);
}

void RetroAnimationEditor::_toggle_play() {
	playing = !playing;
	play_frame = current_frame;
	play_ticks = 0;
	play_button->set_button_icon(get_editor_theme_icon(playing ? SNAME("Pause") : SNAME("Play")));
	preview->queue_redraw();
}

void RetroAnimationEditor::_save() {
	if (personagem.is_null()) {
		return;
	}
	const Error err = personagem->save_to_file();
	if (err != OK) {
		EditorNode::get_singleton()->show_warning(U("Não foi possível gravar ") + personagem->get_path());
		return;
	}
	saved_json = JSON::stringify(data);
	_refresh_list();
}

bool RetroAnimationEditor::has_unsaved_changes() const {
	return personagem.is_valid() && JSON::stringify(data) != saved_json;
}

void RetroAnimationEditor::save_if_changed() {
	if (has_unsaved_changes()) {
		_save();
	}
}

String RetroAnimationEditor::get_edited_path() const {
	return personagem.is_valid() ? personagem->get_path() : String();
}

void RetroAnimationEditor::edit(const Ref<MDPersonagem> &p_personagem) {
	if (p_personagem == personagem) {
		return;
	}
	// Trocar de personagem grava o anterior, para as mudanças não ficarem só na memória.
	save_if_changed();
	const Callable external = callable_mp(this, &RetroAnimationEditor::_on_external_change);
	if (personagem.is_valid() && personagem->is_connected(CoreStringName(changed), external)) {
		personagem->disconnect(CoreStringName(changed), external);
	}
	personagem = p_personagem;
	if (personagem.is_valid()) {
		personagem->connect(CoreStringName(changed), external);
	}
	history->clear_history();
	_refresh_history();
	sheets.clear();
	sheet_images.clear();
	shown_source = String();
	selection = Rect2i();
	current_anim = -1;
	current_frame = 0;
	play_frame = 0;
	play_ticks = 0;
	if (personagem.is_valid()) {
		data = personagem->get_data();
		saved_json = JSON::stringify(data);
		if (!personagem->get_animations().is_empty()) {
			current_anim = personagem->get_animations()[0].index;
		}
	}
	set_process(personagem.is_valid() && is_visible_in_tree());
	_refresh_sounds();
	_refresh();
	_refresh_sheets();
	_refresh_selection();
	callable_mp(static_cast<RetroSheetView *>(sheet_view), &RetroSheetView::focus).call_deferred();
}

void RetroAnimationEditor::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_THEME_CHANGED: {
			save_button->set_button_icon(get_editor_theme_icon(SNAME("Save")));
			play_button->set_button_icon(get_editor_theme_icon(playing ? SNAME("Pause") : SNAME("Play")));
			sound_listen->set_button_icon(get_editor_theme_icon(SNAME("AudioStreamPlayer")));
		} break;
		case NOTIFICATION_VISIBILITY_CHANGED: {
			set_process(personagem.is_valid() && is_visible_in_tree());
			if (personagem.is_valid() && is_visible_in_tree()) {
				_refresh_sounds(); // Sons novos no projeto entram na lista.
				_refresh_fields();
			}
		} break;
		case NOTIFICATION_PROCESS: {
			// Tempo do console: 60 quadros de vídeo por segundo (NTSC).
			const MDPersonagem::Animacao *anim = _parsed();
			if (!playing || !anim || anim->frames.is_empty()) {
				break;
			}
			play_ticks += get_process_delta_time() * 60.0;
			play_frame = CLAMP(play_frame, 0, anim->frames.size() - 1);
			const int last = anim->frames.size() - 1;
			bool changed = false;
			while (true) {
				const int ticks = anim->frames[play_frame].ticks;
				if (play_frame == last && !anim->loop) {
					// Sem repetição, o último quadro fica um segundo na tela e a prévia recomeça.
					if (play_ticks < ticks + 60) {
						break;
					}
				} else if (play_ticks < ticks) {
					break;
				}
				play_ticks -= play_frame == last && !anim->loop ? ticks + 60 : ticks;
				play_frame = play_frame == last ? 0 : play_frame + 1;
				changed = true;
			}
			if (changed) {
				preview->queue_redraw();
				_play_sound(anim->frames[play_frame].sound);
			}
		} break;
	}
}

// Os .wav do projeto (fora de .godot e das pastas geradas pelo build).
static void collect_sounds(EditorFileSystemDirectory *p_dir, PackedStringArray &r_files) {
	if (!p_dir) {
		return;
	}
	for (int i = 0; i < p_dir->get_file_count(); i++) {
		if (p_dir->get_file(i).get_extension().to_lower() == "wav") {
			r_files.push_back(p_dir->get_file_path(i));
		}
	}
	for (int i = 0; i < p_dir->get_subdir_count(); i++) {
		const String path = p_dir->get_subdir(i)->get_path();
		if (!path.begins_with("res://build/") && !path.begins_with("res://res/gerado/")) {
			collect_sounds(p_dir->get_subdir(i), r_files);
		}
	}
}

void RetroAnimationEditor::_refresh_sounds() {
	sound_files.clear();
	collect_sounds(EditorFileSystem::get_singleton()->get_filesystem(), sound_files);
	sound_files.sort();
	sound_option->clear();
	sound_option->add_item(U("(nenhum)"));
	for (const String &path : sound_files) {
		sound_option->add_item(path.trim_prefix("res://"));
	}
}

void RetroAnimationEditor::_sound_chosen(int p_index) {
	const MDPersonagem::Animacao *anim = _parsed();
	if (updating || !anim || anim->frames.is_empty()) {
		return;
	}
	if (p_index < 0) {
		_play_sound(anim->frames[CLAMP(current_frame, 0, anim->frames.size() - 1)].sound);
		return;
	}
	Dictionary a = _anim();
	Dictionary before;
	_before_edit(before);
	const Array frames = _ensure_free(a);
	Dictionary f = frames[current_frame];
	const String path = p_index > 0 && p_index <= sound_files.size() ? sound_files[p_index - 1] : String();
	if (path.is_empty()) {
		f.erase("sound");
	} else {
		f["sound"] = path;
	}
	_apply();
	_commit(U("Som do quadro"), before);
	_play_sound(path);
}

void RetroAnimationEditor::_play_sound(const String &p_path) {
	if (p_path.is_empty() || !is_visible_in_tree()) {
		return;
	}
	const Ref<AudioStream> stream = ResourceLoader::load(p_path, "AudioStream");
	if (stream.is_valid()) {
		sound_player->set_stream(stream);
		sound_player->play();
	}
}

void RetroAnimationEditor::_bind_methods() {

}

RetroAnimationEditor::~RetroAnimationEditor() {
	memdelete(history);
}

RetroAnimationEditor::RetroAnimationEditor() {
	history = memnew(UndoRedo);
	set_v_size_flags(SIZE_EXPAND_FILL);
	set_process_input(true);

	HBoxContainer *top = memnew(HBoxContainer);
	add_child(top);
	title = memnew(Label);
	title->set_theme_type_variation("HeaderSmall");
	top->add_child(title);
	info = memnew(Label);
	info->set_modulate(Color(1, 1, 1, 0.6));
	info->set_h_size_flags(SIZE_EXPAND_FILL);
	info->set_clip_text(true);
	top->add_child(info);
	undo_button = memnew(Button(U("Desfazer")));
	undo_button->set_focus_mode(FOCUS_NONE);
	undo_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_undo));
	top->add_child(undo_button);
	redo_button = memnew(Button(U("Refazer")));
	redo_button->set_focus_mode(FOCUS_NONE);
	redo_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_redo));
	top->add_child(redo_button);
	save_button = memnew(Button(U("Salvar")));
	save_button->set_tooltip_text(U("Grava o .charset.json (Ctrl+S também grava)."));
	save_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_save));
	top->add_child(save_button);

	empty_label = memnew(Label(U("Dê dois cliques num personagem (.charset.json) no Sistema de Arquivos para editar as animações.\nPara criar um, clique com o botão direito numa folha (PNG) → Novo personagem com esta folha.")));
	empty_label->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
	empty_label->set_vertical_alignment(VERTICAL_ALIGNMENT_CENTER);
	empty_label->set_v_size_flags(SIZE_EXPAND_FILL);
	add_child(empty_label);

	HSplitContainer *split = memnew(HSplitContainer);
	split->set_v_size_flags(SIZE_EXPAND_FILL);
	body = split;
	add_child(split);

	// Esquerda: animações.
	VBoxContainer *left = memnew(VBoxContainer);
	left->set_custom_minimum_size(Size2(150, 0) * EDSCALE);
	split->add_child(left);
	Label *anims_label = memnew(Label(U("Animações")));
	left->add_child(anims_label);
	anim_list = memnew(ItemList);
	anim_list->set_v_size_flags(SIZE_EXPAND_FILL);
	anim_list->connect(SceneStringName(item_selected), callable_mp(this, &RetroAnimationEditor::_anim_selected));
	left->add_child(anim_list);
	HBoxContainer *anim_buttons = memnew(HBoxContainer);
	left->add_child(anim_buttons);
	const char *anim_button_names[] = { "Nova", "Duplicar", "Remover" };
	void (RetroAnimationEditor::*anim_button_methods[])() = { &RetroAnimationEditor::_new_animation, &RetroAnimationEditor::_duplicate_animation, &RetroAnimationEditor::_remove_animation };
	for (int i = 0; i < 3; i++) {
		Button *button = memnew(Button(U(anim_button_names[i])));
		button->set_h_size_flags(SIZE_EXPAND_FILL);
		button->connect(SceneStringName(pressed), callable_mp(this, anim_button_methods[i]));
		anim_buttons->add_child(button);
	}

	HSplitContainer *center_split = memnew(HSplitContainer);
	center_split->set_h_size_flags(SIZE_EXPAND_FILL);
	split->add_child(center_split);

	// Centro: folha e linha do tempo.
	VSplitContainer *center = memnew(VSplitContainer);
	center->set_h_size_flags(SIZE_EXPAND_FILL);
	center_split->add_child(center);
	VBoxContainer *sheet_box = memnew(VBoxContainer);
	sheet_box->set_v_size_flags(SIZE_EXPAND_FILL);
	center->add_child(sheet_box);
	HBoxContainer *sheet_row = memnew(HBoxContainer);
	sheet_box->add_child(sheet_row);
	sheet_row->add_child(memnew(Label(U("Folha"))));
	sheet_option = memnew(OptionButton);
	sheet_option->set_clip_text(true);
	sheet_option->set_custom_minimum_size(Size2(80, 0) * EDSCALE);
	sheet_option->set_h_size_flags(SIZE_EXPAND_FILL);
	sheet_option->connect(SceneStringName(item_selected), callable_mp(this, &RetroAnimationEditor::_sheet_chosen));
	sheet_row->add_child(sheet_option);
	Button *add_sheet = memnew(Button);
	add_sheet->set_flat(true);
	add_sheet->set_tooltip_text(U("Adicionar outra folha (PNG do projeto) ao personagem."));
	add_sheet->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("Add"), EditorStringName(EditorIcons)));
	add_sheet->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_add_sheet));
	sheet_row->add_child(add_sheet);
	sheet_dialog = memnew(EditorFileDialog);
	sheet_dialog->set_file_mode(EditorFileDialog::FILE_MODE_OPEN_FILE);
	sheet_dialog->set_access(EditorFileDialog::ACCESS_RESOURCES);
	sheet_dialog->add_filter("*.png", U("Imagem PNG"));
	sheet_dialog->set_title(U("Adicionar folha"));
	sheet_dialog->connect("file_selected", callable_mp(this, &RetroAnimationEditor::_sheet_file_chosen));
	add_child(sheet_dialog);

	RetroSheetView *sheet = memnew(RetroSheetView);
	sheet->ed = this;
	sheet->set_v_size_flags(SIZE_EXPAND_FILL);
	sheet->set_custom_minimum_size(Size2(200, 200) * EDSCALE);
	sheet->set_tooltip_text(U("Arraste no vazio (ou com Shift) para selecionar; clique num desenho para selecioná-lo.\nArraste um recorte para movê-lo e o canto amarelo para redimensionar.\nRoda: zoom · botão do meio ou direito: mover a vista."));
	sheet_view = sheet;
	sheet_box->add_child(sheet);

	selection_label = memnew(Label);
	selection_label->set_clip_text(true);
	selection_label->set_modulate(Color(1, 1, 1, 0.7));
	sheet_box->add_child(selection_label);
	HFlowContainer *selection_row = memnew(HFlowContainer);
	sheet_box->add_child(selection_row);
	const char *selection_names[] = { "Adicionar quadro", "Substituir quadro", "Separar desenhos", "Criar faixa em grade" };
	const char *selection_tips[] = {
		"Põe a seleção como quadro novo depois do quadro em edição (sem animação, cria uma).",
		"Troca o recorte do quadro em edição pela seleção.",
		"Cria uma animação com cada desenho da seleção num quadro, na ordem de leitura. Bom para folhas com espaçamentos irregulares.",
		"Cria uma animação em grade: a seleção dividida em quadros do tamanho e espaçamento ao lado.",
	};
	for (int i = 0; i < SELECAO_MAX; i++) {
		selection_buttons[i] = memnew(Button(U(selection_names[i])));
		selection_buttons[i]->set_tooltip_text(U(selection_tips[i]));
		selection_buttons[i]->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_selection_action).bind(i));
		if (i == SELECAO_GRADE) {
			HBoxContainer *grid_row = memnew(HBoxContainer);
			HBoxContainer *gap_row = memnew(HBoxContainer);
			grid_row->add_child(memnew(Label(U("Grade"))));
			const char *grid_tips[] = { "Largura do quadro", "Altura do quadro", "Espaço entre colunas", "Espaço entre linhas" };
			for (int g = 0; g < GRADE_MAX; g++) {
				grid_fields[g] = memnew(SpinBox);
				grid_fields[g]->set_min(g < GRADE_ESPACO_X ? 1 : 0);
				grid_fields[g]->set_max(1024);
				grid_fields[g]->set_value(g < GRADE_ESPACO_X ? 32 : 0);
				grid_fields[g]->set_select_all_on_focus(true);
				grid_fields[g]->set_tooltip_text(U(grid_tips[g]));
				grid_fields[g]->connect(SceneStringName(value_changed), callable_mp(this, &RetroAnimationEditor::_grid_changed));
				(g < GRADE_ESPACO_X ? grid_row : gap_row)->add_child(grid_fields[g]);
				if (g == GRADE_LARGURA) {
					grid_row->add_child(memnew(Label(U("×"))));
				} else if (g == GRADE_ALTURA) {
					gap_row->add_child(memnew(Label(U("espaço"))));
				}
			}
			grid_count = memnew(Label);
			selection_row->add_child(grid_row);
			selection_row->add_child(gap_row);
			selection_row->add_child(grid_count);
			selection_row->add_child(selection_buttons[i]);
		} else {
			selection_row->add_child(selection_buttons[i]);
		}
	}
	VBoxContainer *timeline_box = memnew(VBoxContainer);
	center->add_child(timeline_box);
	HBoxContainer *frame_buttons = memnew(HBoxContainer);
	timeline_box->add_child(frame_buttons);
	Label *timeline_label = memnew(Label(U("Quadros")));
	timeline_label->set_h_size_flags(SIZE_EXPAND_FILL);
	frame_buttons->add_child(timeline_label);
	const char *frame_icons[] = { "MoveLeft", "MoveRight", "Duplicate", "Remove" };
	const char *frame_tips[] = { "Mover o quadro para a esquerda", "Mover o quadro para a direita", "Duplicar o quadro", "Remover o quadro" };
	for (int i = 0; i < 4; i++) {
		Button *button = memnew(Button);
		button->set_flat(true);
		button->set_tooltip_text(U(frame_tips[i]));
		button->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(frame_icons[i], EditorStringName(EditorIcons)));
		button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_frame_action).bind(i));
		frame_buttons->add_child(button);
	}
	timeline = memnew(ItemList);
	timeline->set_icon_mode(ItemList::ICON_MODE_TOP);
	timeline->set_max_columns(0);
	timeline->set_same_column_width(true);
	timeline->set_fixed_icon_size(Size2i(64, 64) * EDSCALE);
	timeline->set_texture_filter(TEXTURE_FILTER_NEAREST);
	timeline->set_custom_minimum_size(Size2(0, 110) * EDSCALE);
	timeline->connect(SceneStringName(item_selected), callable_mp(this, &RetroAnimationEditor::_frame_selected));
	timeline_box->add_child(timeline);

	// Direita: prévia e campos.
	VBoxContainer *right = memnew(VBoxContainer);
	right->set_custom_minimum_size(Size2(250, 0) * EDSCALE);
	center_split->add_child(right);
	RetroAnimationPreview *preview_control = memnew(RetroAnimationPreview);
	preview_control->ed = this;
	preview = preview_control;
	right->add_child(preview_control);
	HBoxContainer *play_row = memnew(HBoxContainer);
	right->add_child(play_row);
	play_button = memnew(Button);
	play_button->set_tooltip_text(U("Tocar ou pausar a prévia (no tempo do console, 60 quadros por segundo)."));
	play_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_toggle_play));
	play_row->add_child(play_button);
	reference_option = memnew(OptionButton);
	reference_option->set_h_size_flags(SIZE_EXPAND_FILL);
	reference_option->set_clip_text(true);
	reference_option->set_tooltip_text(U("Com a prévia pausada, mostra este quadro por baixo, para alinhar os pés (clique) e o ajuste fino (setas)."));
	reference_option->connect(SceneStringName(item_selected), callable_mp(static_cast<CanvasItem *>(preview_control), &CanvasItem::queue_redraw).unbind(1));
	play_row->add_child(reference_option);
	HBoxContainer *click_row = memnew(HBoxContainer);
	right->add_child(click_row);
	click_row->add_child(memnew(Label(U("Clique marca"))));
	click_option = memnew(OptionButton);
	click_option->set_h_size_flags(SIZE_EXPAND_FILL);
	click_option->add_item(U("os pés do quadro"));
	click_option->add_item(U("a caixa do corpo"));
	click_option->add_item(U("a caixa de ataque"));
	click_option->set_tooltip_text(U("Pés: um clique. Caixas: arraste na prévia (relativas aos pés; o ataque vale nos quadros escolhidos nos campos)."));
	click_row->add_child(click_option);
	HBoxContainer *nudge_row = memnew(HBoxContainer);
	right->add_child(nudge_row);
	nudge_row->add_child(memnew(Label(U("Ajuste fino"))));
	const char *nudge_icons[] = { "ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight" };
	const char *nudge_tips[] = { "para a esquerda", "para cima", "para baixo", "para a direita" };
	for (int i = 0; i < 4; i++) {
		Button *button = memnew(Button);
		button->set_flat(true);
		button->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(nudge_icons[i], EditorStringName(EditorIcons)));
		button->set_tooltip_text(vformat(U("Move o desenho do quadro 1 pixel %s (Shift: 8). As setas do teclado fazem o mesmo."), U(nudge_tips[i])));
		button->set_focus_mode(FOCUS_NONE);
		button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_nudge_button).bind(i));
		nudge_row->add_child(button);
	}
	offset_label = memnew(Label);
	offset_label->set_modulate(Color(1, 1, 1, 0.7));
	nudge_row->add_child(offset_label);

	ScrollContainer *scroll = memnew(ScrollContainer);
	scroll->set_v_size_flags(SIZE_EXPAND_FILL);
	scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	right->add_child(scroll);
	VBoxContainer *form = memnew(VBoxContainer);
	form->set_h_size_flags(SIZE_EXPAND_FILL);
	scroll->add_child(form);
	form_box = scroll;
	no_animation_label = memnew(Label(U("Ainda sem animações. Selecione um desenho na folha (clique nele ou arraste em volta) e use Adicionar quadro, Separar desenhos ou Criar faixa em grade.")));
	no_animation_label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	no_animation_label->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	no_animation_label->set_modulate(Color(1, 1, 1, 0.7));
	right->add_child(no_animation_label);
	right->move_child(no_animation_label, scroll->get_index());

	struct Faixa {
		int min, max;
	};
	const Faixa ranges[CAMPO_MAX] = {
		{ 1, 60 }, { 1, 255 }, { 0, 1024 }, { 0, 1024 }, { -128, 128 }, { -128, 128 },
		{ 0, 16384 }, { 0, 16384 }, { 1, 1024 }, { 1, 1024 },
		{ -256, 256 }, { -256, 256 }, { 0, 256 }, { 0, 256 },
		{ -256, 256 }, { -256, 256 }, { 0, 256 }, { 0, 256 }, { 1, 255 }, { 1, 255 }
	};
	for (int i = 0; i < CAMPO_MAX; i++) {
		fields[i] = memnew(SpinBox);
		fields[i]->set_min(ranges[i].min);
		fields[i]->set_max(ranges[i].max);
		fields[i]->set_h_size_flags(SIZE_EXPAND_FILL);
		fields[i]->set_select_all_on_focus(true);
		fields[i]->connect(SceneStringName(value_changed), callable_mp(this, &RetroAnimationEditor::_field_changed).bind(i));
	}
	auto section = [&](const String &p_title) {
		Label *label = memnew(Label(p_title));
		label->set_theme_type_variation("HeaderSmall");
		form->add_child(memnew(HSeparator));
		form->add_child(label);
		GridContainer *grid = memnew(GridContainer);
		grid->set_columns(2);
		form->add_child(grid);
		return grid;
	};
	auto row = [&](GridContainer *p_grid, const String &p_label, Control *p_a, Control *p_b = nullptr) {
		p_grid->add_child(memnew(Label(p_label)));
		HBoxContainer *box = memnew(HBoxContainer);
		box->set_h_size_flags(SIZE_EXPAND_FILL);
		box->add_child(p_a);
		if (p_b) {
			box->add_child(p_b);
		}
		p_grid->add_child(box);
	};

	GridContainer *anim_grid = section(U("Animação"));
	name_edit = memnew(LineEdit);
	name_edit->set_h_size_flags(SIZE_EXPAND_FILL);
	name_edit->set_tooltip_text(U("Nome usado nos nodes (MDSprite, MDJogador…). Renomear exige escolher de novo nos nodes que usavam o nome antigo."));
	name_edit->connect(SceneStringName(text_submitted), callable_mp(this, &RetroAnimationEditor::_name_changed));
	name_edit->connect(SceneStringName(focus_exited), callable_mp(this, &RetroAnimationEditor::_name_focus_exited));
	row(anim_grid, U("Nome"), name_edit);
	fields[CAMPO_FPS]->set_suffix("fps");
	fields[CAMPO_FPS]->set_tooltip_text(U("Velocidade dos quadros sem tempo próprio."));
	row(anim_grid, U("Velocidade"), fields[CAMPO_FPS]);
	loop_check = memnew(CheckBox(U("Repetir")));
	loop_check->set_tooltip_text(U("Sem repetição, a animação para no último quadro (pulo, golpe, morte)."));
	loop_check->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_loop_toggled));
	row(anim_grid, String(), loop_check);
	mode_label = memnew(Label);
	mode_label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	mode_label->set_modulate(Color(1, 1, 1, 0.6));
	mode_label->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	form->add_child(mode_label);

	GridContainer *frame_grid = section(U("Quadro"));
	fields[CAMPO_TEMPO]->set_suffix("/60 s");
	fields[CAMPO_TEMPO]->set_tooltip_text(U("Quanto tempo o quadro fica na tela, em quadros de vídeo (60 por segundo)."));
	row(frame_grid, U("Tempo"), fields[CAMPO_TEMPO]);
	row(frame_grid, U("Pés"), fields[CAMPO_APOIO_X], fields[CAMPO_APOIO_Y]);
	fields[CAMPO_AJUSTE_X]->set_tooltip_text(U("Desloca o desenho na célula sem mexer no recorte."));
	row(frame_grid, U("Ajuste fino"), fields[CAMPO_AJUSTE_X], fields[CAMPO_AJUSTE_Y]);
	row(frame_grid, U("Recorte"), fields[CAMPO_RECORTE_X], fields[CAMPO_RECORTE_Y]);
	row(frame_grid, U("Tamanho"), fields[CAMPO_RECORTE_L], fields[CAMPO_RECORTE_A]);
	sound_option = memnew(OptionButton);
	sound_option->set_h_size_flags(SIZE_EXPAND_FILL);
	sound_option->set_clip_text(true);
	sound_option->set_tooltip_text(U("Som tocado quando este quadro entra: o passo no quadro do pé no chão, o golpe no quadro da espada. Os .wav do projeto aparecem aqui."));
	sound_option->connect(SceneStringName(item_selected), callable_mp(this, &RetroAnimationEditor::_sound_chosen));
	sound_listen = memnew(Button);
	sound_listen->set_flat(true);
	sound_listen->set_tooltip_text(U("Ouvir o som do quadro."));
	sound_listen->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_sound_chosen).bind(-1));
	row(frame_grid, U("Som"), sound_option, sound_listen);
	sound_player = memnew(AudioStreamPlayer);
	add_child(sound_player);

	GridContainer *body_grid = section(U("Corpo (personagem inteiro)"));
	row(body_grid, U("Posição"), fields[CAMPO_CORPO_X], fields[CAMPO_CORPO_Y]);
	row(body_grid, U("Tamanho"), fields[CAMPO_CORPO_L], fields[CAMPO_CORPO_A]);

	GridContainer *attack_grid = section(U("Ataque"));
	attack_check = memnew(CheckBox(U("Tem caixa de ataque")));
	attack_check->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_attack_toggled));
	row(attack_grid, String(), attack_check);
	row(attack_grid, U("Posição"), fields[CAMPO_ATAQUE_X], fields[CAMPO_ATAQUE_Y]);
	row(attack_grid, U("Tamanho"), fields[CAMPO_ATAQUE_L], fields[CAMPO_ATAQUE_A]);
	row(attack_grid, U("Quadros"), fields[CAMPO_ATAQUE_DE], fields[CAMPO_ATAQUE_ATE]);

	_refresh();
	_refresh_history();
}

// ---- Plugin ----

String RetroAnimationPlugin::get_plugin_name() const {
	return U("Animações");
}

const Ref<Texture2D> RetroAnimationPlugin::get_plugin_icon() const {
	return EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("AnimatedSprite2D"), EditorStringName(EditorIcons));
}

void RetroAnimationPlugin::make_visible(bool p_visible) {
	editor->set_visible(p_visible);
}

void RetroAnimationPlugin::edit(Object *p_object) {
	MDPersonagem *personagem = Object::cast_to<MDPersonagem>(p_object);
	if (personagem) {
		editor->edit(Ref<MDPersonagem>(personagem));
	}
}

bool RetroAnimationPlugin::handles(Object *p_object) const {
	return Object::cast_to<MDPersonagem>(p_object) != nullptr;
}

String RetroAnimationPlugin::get_unsaved_status(const String &p_for_scene) const {
	if (!p_for_scene.is_empty() || !editor->has_unsaved_changes()) {
		return String();
	}
	return vformat(U("Salvar as mudanças nas animações de %s?"), editor->get_edited_path().get_file());
}

void RetroAnimationPlugin::save_external_data() {
	editor->save_if_changed();
}

RetroAnimationPlugin::RetroAnimationPlugin() {
	editor = memnew(RetroAnimationEditor);
	EditorInterface::get_singleton()->get_editor_main_screen()->add_child(editor);
	editor->hide();
}
