#include "retro_animation_editor.h"

#include "core/io/json.h"
#include "core/object/callable_mp.h"
#include "core/object/class_db.h"
#include "core/os/os.h"
#include "editor/editor_interface.h"
#include "editor/editor_node.h"
#include "editor/editor_string_names.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/button.h"
#include "scene/gui/check_box.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/item_list.h"
#include "scene/gui/label.h"
#include "scene/gui/line_edit.h"
#include "scene/gui/scroll_container.h"
#include "scene/gui/separator.h"
#include "scene/gui/spin_box.h"
#include "scene/gui/split_container.h"
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

// Folha do quadro em edição, com os recortes da animação numerados. Roda = zoom; botão do meio,
// direito ou arrastar no vazio = mover a vista; arrastar um recorte = mover; canto = redimensionar.
class RetroSheetView : public Control {
	GDCLASS(RetroSheetView, Control);

public:
	enum Drag {
		DRAG_NONE,
		DRAG_PAN,
		DRAG_MOVE,
		DRAG_RESIZE,
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
		const MDPersonagem::Animacao *anim = ed->_parsed();
		return anim && ed->current_frame < anim->frames.size() ? anim->frames[ed->current_frame].source : String();
	}

	Rect2 screen_rect(const Rect2i &p_rect) const {
		return Rect2(pan + Vector2(p_rect.position) * zoom, Vector2(p_rect.size) * zoom);
	}

	// Enquadra os recortes da animação.
	void focus() {
		const MDPersonagem::Animacao *anim = ed->_parsed();
		pending_focus = !is_visible_in_tree() || get_size().x < 64;
		if (!anim || anim->frames.is_empty() || pending_focus) {
			return;
		}
		const String path = sheet_path();
		Rect2i box;
		bool first = true;
		for (const MDPersonagem::Quadro &q : anim->frames) {
			if (q.source == path) {
				box = first ? q.rect : box.merge(q.rect);
				first = false;
			}
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
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (!anim) {
			return;
		}
		const String path = sheet_path();
		const Ref<Texture2D> tex = ed->_sheet(path);
		if (tex.is_valid()) {
			draw_rect(Rect2(pan, tex->get_size() * zoom), Color(0.2, 0.2, 0.24));
			draw_texture_rect(tex, Rect2(pan, tex->get_size() * zoom), false);
		}
		const Ref<Font> font = get_theme_default_font();
		const int font_size = get_theme_default_font_size();
		for (int i = 0; i < anim->frames.size(); i++) {
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
			drag = DRAG_PAN;
			drag_from = mb->get_position();
			if (mb->get_button_index() == MouseButton::LEFT && anim) {
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
				if (drag != DRAG_PAN) {
					drag_rect = anim->frames[drag_frame].rect;
					ed->_before_edit(before);
				}
			}
			accept_event();
			return;
		}
		if (mb.is_valid() && !mb->is_pressed() && drag != DRAG_NONE) {
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
		return drag == DRAG_PAN ? CURSOR_DRAG : CURSOR_ARROW;
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
		if (!ed->playing && ed->onion->is_pressed() && anim->frames.size() > 1) {
			draw_frame(l, anim->frames[(frame + anim->frames.size() - 1) % anim->frames.size()], 0.3);
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

	virtual void gui_input(const Ref<InputEvent> &p_event) override {
		const Ref<InputEventMouseButton> mb = p_event;
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (mb.is_null() || !mb->is_pressed() || mb->get_button_index() != MouseButton::LEFT || !anim || ed->current_frame >= anim->frames.size()) {
			return;
		}
		if (ed->playing) {
			ed->_toggle_play();
		}
		const Layout l = layout();
		const MDPersonagem::Quadro &q = anim->frames[ed->current_frame];
		const Vector2 cell_point = ((mb->get_position() - l.origin) / l.scale).floor();
		const Vector2i top_left = l.cell.anchor - q.anchor + q.offset;
		const Vector2i feet = Vector2i(cell_point) - top_left;
		Dictionary before;
		ed->_before_edit(before);
		ed->_set_frame_anchor(feet.clamp(Vector2i(), q.rect.size));
		ed->_commit(U("Marcar os pés"), before);
		accept_event();
	}

	RetroAnimationPreview() {
		set_clip_contents(true);
		set_texture_filter(TEXTURE_FILTER_NEAREST);
		set_custom_minimum_size(Size2(240, 240) * EDSCALE);
		set_tooltip_text(U("Clique para marcar os pés do quadro em edição.\nVerde: corpo · vermelho: ataque · cruz: pés."));
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
		const Ref<Image> image = MDPersonagem::load_sheet(p_path);
		sheets[p_path] = image.is_valid() ? Ref<Texture2D>(ImageTexture::create_from_image(image)) : Ref<Texture2D>();
	}
	return sheets[p_path];
}

// Faixa em grade vira quadros livres (mesmos recortes) antes de editar um quadro, como no Electron.
Array RetroAnimationEditor::_ensure_free(Dictionary p_anim) {
	if (p_anim.get("frames", Variant()).get_type() == Variant::ARRAY) {
		return p_anim["frames"];
	}
	Array frames;
	const MDPersonagem::Animacao *parsed = _parsed();
	Vector2i biggest;
	for (int i = 0; parsed && i < parsed->frames.size(); i++) {
		const MDPersonagem::Quadro &q = parsed->frames[i];
		Dictionary f = rect_dict(q.rect);
		f["anchorX"] = q.anchor.x;
		f["anchorY"] = q.anchor.y;
		f["sourceId"] = q.source_id;
		frames.push_back(f);
		biggest = biggest.max(q.rect.size);
	}
	p_anim["frames"] = frames;
	p_anim["frameCount"] = frames.size();
	p_anim["frameWidth"] = biggest.x;
	p_anim["frameHeight"] = biggest.y;
	p_anim["columns"] = frames.size();
	p_anim["rows"] = 1;
	if (parsed && !parsed->frames.is_empty()) {
		p_anim["region"] = rect_dict(parsed->frames[0].rect);
	}
	return frames;
}

void RetroAnimationEditor::_apply() {
	(void)personagem->set_data(data);
	const MDPersonagem::Animacao *anim = _parsed();
	current_frame = anim ? CLAMP(current_frame, 0, anim->frames.size() - 1) : 0;
	play_frame = anim ? CLAMP(play_frame, 0, anim->frames.size() - 1) : 0;
	_refresh_list();
	_refresh_timeline();
	_refresh_fields();
	sheet_view->queue_redraw();
	preview->queue_redraw();
}

void RetroAnimationEditor::_commit(const String &p_name, const Dictionary &p_before, bool p_merge) {
	EditorUndoRedoManager *undo_redo = EditorUndoRedoManager::get_singleton();
	undo_redo->create_action(p_name, p_merge ? UndoRedo::MERGE_ENDS : UndoRedo::MERGE_DISABLE, personagem.ptr());
	undo_redo->add_do_method(this, "_set_snapshot", personagem, data.duplicate(true));
	undo_redo->add_undo_method(this, "_set_snapshot", personagem, p_before);
	undo_redo->commit_action(false);
}

void RetroAnimationEditor::_set_snapshot(const Ref<MDPersonagem> &p_personagem, const Dictionary &p_data) {
	if (p_personagem != personagem) {
		(void)p_personagem->set_data(p_data.duplicate(true));
		return;
	}
	data = p_data.duplicate(true);
	current_anim = CLAMP(current_anim, 0, _animations().size() - 1);
	_apply();
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
		timeline->add_item(vformat("%d  %d/60", i + 1, q.ticks), thumb);
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
	if (a.is_empty() || !anim || anim->frames.is_empty()) {
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
	for (int i = 0; i < CAMPO_MAX; i++) {
		fields[i]->set_value(values[i]);
	}
	fields[CAMPO_APOIO_X]->set_max(q.rect.size.x);
	fields[CAMPO_APOIO_Y]->set_max(q.rect.size.y);
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
	} else if (!personagem->get_animations().is_empty()) {
		base.source_id = personagem->get_animations()[0].frames[0].source_id;
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
	if (current_anim < 0 || current_anim >= list.size() || personagem->get_animations().size() < 2) {
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
	personagem = p_personagem;
	sheets.clear();
	current_anim = 0;
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
	_refresh();
	callable_mp(static_cast<RetroSheetView *>(sheet_view), &RetroSheetView::focus).call_deferred();
}

void RetroAnimationEditor::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_THEME_CHANGED: {
			save_button->set_button_icon(get_editor_theme_icon(SNAME("Save")));
			play_button->set_button_icon(get_editor_theme_icon(playing ? SNAME("Pause") : SNAME("Play")));
		} break;
		case NOTIFICATION_VISIBILITY_CHANGED: {
			set_process(personagem.is_valid() && is_visible_in_tree());
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
			}
		} break;
	}
}

void RetroAnimationEditor::_bind_methods() {
	ClassDB::bind_method(D_METHOD("_set_snapshot", "personagem", "data"), &RetroAnimationEditor::_set_snapshot);
}

RetroAnimationEditor::RetroAnimationEditor() {
	set_v_size_flags(SIZE_EXPAND_FILL);

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
	save_button = memnew(Button(U("Salvar")));
	save_button->set_tooltip_text(U("Grava o .charset.json (Ctrl+S também grava)."));
	save_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_save));
	top->add_child(save_button);

	empty_label = memnew(Label(U("Dê dois cliques num personagem (.charset.json) no Sistema de Arquivos para editar as animações.")));
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
	RetroSheetView *sheet = memnew(RetroSheetView);
	sheet->ed = this;
	sheet->set_v_size_flags(SIZE_EXPAND_FILL);
	sheet->set_custom_minimum_size(Size2(200, 200) * EDSCALE);
	sheet->set_tooltip_text(U("Arraste um recorte para movê-lo e o canto amarelo para redimensionar.\nRoda: zoom · arrastar no vazio ou botão do meio: mover a vista."));
	sheet_view = sheet;
	center->add_child(sheet);
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
	onion = memnew(CheckBox(U("Quadro anterior")));
	onion->set_tooltip_text(U("Com a prévia pausada, mostra o quadro anterior por baixo, para alinhar os pés."));
	onion->set_pressed(true);
	onion->connect(SceneStringName(toggled), callable_mp(static_cast<CanvasItem *>(preview_control), &CanvasItem::queue_redraw).unbind(1));
	play_row->add_child(onion);

	ScrollContainer *scroll = memnew(ScrollContainer);
	scroll->set_v_size_flags(SIZE_EXPAND_FILL);
	scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	right->add_child(scroll);
	VBoxContainer *form = memnew(VBoxContainer);
	form->set_h_size_flags(SIZE_EXPAND_FILL);
	scroll->add_child(form);

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
