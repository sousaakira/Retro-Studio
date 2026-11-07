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
#include "editor/settings/editor_settings.h"
#include "scene/gui/panel_container.h"
#include "scene/main/window.h"
#include "servers/display/display_server.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/button.h"
#include "scene/gui/check_box.h"
#include "scene/gui/flow_container.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/item_list.h"
#include "scene/gui/color_picker.h"
#include "scene/resources/style_box_flat.h"
#include "scene/gui/color_rect.h"
#include "retro_image_convert.h"
#include "retro_sgdk_export.h"
#include "../scene/md_nodes.h"
#include "scene/gui/dialogs.h"
#include "scene/gui/menu_button.h"
#include "scene/gui/popup_menu.h"
#include "core/config/project_settings.h"
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

static const char *META_ANIMACOES = "retro_animacoes";

Array RetroAnimationEditor::frame_clipboard;

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
// mover a vista; arrastar um recorte = mover; alças = redimensionar (puxar a borda esquerda ou de cima
// compensa os pés, para a pose não sair do lugar); arrastar dentro da seleção = movê-la; arrastar no
// vazio (ou com Shift) = selecionar uma área; clique no vazio = selecionar o desenho sob o mouse.
// Chave numérica de um quadro para os caches (folha, recorte e o que mais pesar): 64 bits, dois hashes.
static uint64_t frame_key(const MDPersonagem::Quadro &p_frame, std::initializer_list<int> p_extra) {
	uint32_t a = p_frame.source.hash(), b = hash_murmur3_one_32(a, 0x9e3779b9);
	for (int v : { p_frame.rect.position.x, p_frame.rect.position.y, p_frame.rect.size.x, p_frame.rect.size.y }) {
		a = hash_murmur3_one_32(uint32_t(v), a);
		b = hash_murmur3_one_32(uint32_t(v) ^ 0x5bd1e995u, b);
	}
	for (int v : p_extra) {
		a = hash_murmur3_one_32(uint32_t(v), a);
		b = hash_murmur3_one_32(uint32_t(v) ^ 0x5bd1e995u, b);
	}
	return (uint64_t(hash_fmix32(a)) << 32) | hash_fmix32(b);
}

class RetroSheetView : public Control {
	GDCLASS(RetroSheetView, Control);

public:
	enum Drag {
		DRAG_NONE,
		DRAG_PAN,
		DRAG_MOVE,
		DRAG_RESIZE,
		DRAG_SELECT,
		DRAG_SELECTION_MOVE,
		DRAG_SELECTION_RESIZE,
		DRAG_GUIDE,
		DRAG_MEASURE,
	};
	static constexpr int RULER = 18; // Largura das réguas (em cima e à esquerda).
	// Lados puxados por uma alça.
	enum {
		LADO_ESQUERDO = 1,
		LADO_DIREITO = 2,
		LADO_CIMA = 4,
		LADO_BAIXO = 8,
	};

	RetroAnimationEditor *ed = nullptr;
	float zoom = 2;
	Vector2 pan = Vector2(16, 16);
	Drag drag = DRAG_NONE;
	Vector2 drag_from;
	Rect2i drag_rect;
	Vector2i drag_anchor;
	int drag_sides = 0;
	int drag_frame = -1;
	int guide_axis = 0, guide_index = -1; // Guia sendo arrastada.
	Dictionary before;
	bool pending_focus = false; // Enquadrar quando a vista ganhar tamanho.

	// Borda de pixel mais próxima (para guias e medidas, que ficam entre os pixels).
	Vector2i sheet_edge(const Vector2 &p_screen) const {
		const Vector2 p = ((p_screen - pan) / zoom).round();
		return Vector2i(p.x, p.y);
	}

	// Encaixe: a guia mais próxima (até 6 pixels da tela) e, com uma grade ligada, a linha da grade.
	int snap(int p_value, int p_axis, bool *r_ok = nullptr) const {
		if (r_ok) {
			*r_ok = false;
		}
		if (!ed->snap_button->is_pressed()) {
			return p_value;
		}
		const float reach = 6.0f / zoom;
		int best = p_value;
		float distance = reach + 1;
		for (int g : ed->guides[p_axis]) {
			if (Math::abs(g - p_value) <= reach && Math::abs(g - p_value) < distance) {
				best = g;
				distance = Math::abs(g - p_value);
			}
		}
		const int steps[] = { 0, 8, 16, 32 };
		const int step = steps[CLAMP(ed->sheet_grid_option->get_selected(), 0, 3)];
		if (distance > reach && step) {
			const int line = int(Math::round(float(p_value) / step)) * step;
			if (Math::abs(line - p_value) <= reach) {
				best = line;
				distance = 0;
			}
		}
		if (r_ok) {
			*r_ok = distance <= reach;
		}
		return best;
	}

	// Retângulo movido: a borda esquerda (ou, se não encaixar, a direita) gruda; o mesmo em y.
	Rect2i snap_move(Rect2i p_rect) const {
		for (int axis = 0; axis < 2; axis++) {
			bool ok = false;
			int start = snap(p_rect.position[axis], axis, &ok);
			if (!ok) {
				const int end = snap(p_rect.position[axis] + p_rect.size[axis], axis, &ok);
				start = ok ? end - p_rect.size[axis] : p_rect.position[axis];
			}
			p_rect.position[axis] = MAX(0, start);
		}
		return p_rect;
	}

	// Retângulo redimensionado: só os lados puxados grudam.
	Rect2i snap_sides(const Rect2i &p_rect, int p_sides) const {
		int x0 = p_rect.position.x, y0 = p_rect.position.y, x1 = p_rect.get_end().x, y1 = p_rect.get_end().y;
		if (p_sides & LADO_ESQUERDO) {
			x0 = CLAMP(snap(x0, 0), 0, x1 - 1);
		}
		if (p_sides & LADO_DIREITO) {
			x1 = MAX(snap(x1, 0), x0 + 1);
		}
		if (p_sides & LADO_CIMA) {
			y0 = CLAMP(snap(y0, 1), 0, y1 - 1);
		}
		if (p_sides & LADO_BAIXO) {
			y1 = MAX(snap(y1, 1), y0 + 1);
		}
		return Rect2i(x0, y0, x1 - x0, y1 - y0);
	}

	// Área arrastada no vazio, com as bordas encaixadas.
	Rect2i drag_area(const Vector2 &p_a, const Vector2 &p_b) const {
		const Vector2i a = sheet_point(p_a), b = sheet_point(p_b);
		const Vector2i from = a.min(b), to = a.max(b) + Vector2i(1, 1);
		const Rect2i r(snap(from.x, 0), snap(from.y, 1), 0, 0);
		const Vector2i end(snap(to.x, 0), snap(to.y, 1));
		return Rect2i(r.position, (end - r.position).maxi(1));
	}

	// Guia sob o ponto da tela (fora das réguas): eixo e índice, ou -1.
	int guide_at(const Vector2 &p_point, int &r_axis) const {
		for (int axis = 0; axis < 2; axis++) {
			for (int i = 0; i < ed->guides[axis].size(); i++) {
				const float at = pan[axis] + ed->guides[axis][i] * zoom;
				if (Math::abs(p_point[axis] - at) <= 4) {
					r_axis = axis;
					return i;
				}
			}
		}
		return -1;
	}

	bool in_ruler(const Vector2 &p_point) const {
		return p_point.x < RULER || p_point.y < RULER;
	}

	// Réguas com marcas que acompanham o zoom e as guias.
	void draw_rulers() {
		const Ref<Font> font = get_theme_default_font();
		const int font_size = MAX(8, get_theme_default_font_size() - 4);
		const Color back(0.15, 0.15, 0.17), tick(1, 1, 1, 0.45), text(1, 1, 1, 0.6);
		draw_rect(Rect2(0, 0, get_size().x, RULER), back);
		draw_rect(Rect2(0, 0, RULER, get_size().y), back);
		const int steps[] = { 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048 };
		int step = 2048;
		for (int candidate : steps) {
			if (candidate * zoom >= 48) {
				step = candidate;
				break;
			}
		}
		const int minor = MAX(1, step / (step >= 8 ? 4 : step));
		for (int axis = 0; axis < 2; axis++) {
			const float length = get_size()[axis];
			const int first = int(Math::floor((RULER - pan[axis]) / zoom / minor)) * minor;
			for (int v = first; pan[axis] + v * zoom < length; v += minor) {
				const float at = pan[axis] + v * zoom;
				if (at < RULER) {
					continue;
				}
				const bool major = v % step == 0;
				const float size = major ? RULER : RULER * 0.35f;
				if (axis == 0) {
					draw_line(Vector2(at, RULER - size), Vector2(at, RULER), tick);
					if (major) {
						draw_string(font, Vector2(at + 2, font_size), itos(v), HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, text);
					}
				} else {
					draw_line(Vector2(RULER - size, at), Vector2(RULER, at), tick);
					if (major) {
						draw_set_transform(Vector2(font_size, at - 2), -Math::PI / 2);
						draw_string(font, Vector2(), itos(v), HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, text);
						draw_set_transform(Vector2());
					}
				}
			}
		}
		const Color guide(0.3, 0.9, 1);
		for (int g : ed->guides[0]) {
			draw_line(Vector2(pan.x + g * zoom, 0), Vector2(pan.x + g * zoom, RULER), guide, 2);
		}
		for (int g : ed->guides[1]) {
			draw_line(Vector2(0, pan.y + g * zoom), Vector2(RULER, pan.y + g * zoom), guide, 2);
		}
		draw_rect(Rect2(0, 0, RULER, RULER), back);
	}

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

	// As 8 alças de um retângulo na tela: posição e lados que cada uma puxa.
	static void handles(const Rect2 &p_r, Vector2 r_points[8], int r_sides[8]) {
		const Vector2 a = p_r.position, b = p_r.get_end(), m = (a + b) / 2;
		const Vector2 points[8] = { a, Vector2(m.x, a.y), Vector2(b.x, a.y), Vector2(b.x, m.y), b, Vector2(m.x, b.y), Vector2(a.x, b.y), Vector2(a.x, m.y) };
		const int sides[8] = { LADO_ESQUERDO | LADO_CIMA, LADO_CIMA, LADO_DIREITO | LADO_CIMA, LADO_DIREITO, LADO_DIREITO | LADO_BAIXO, LADO_BAIXO, LADO_ESQUERDO | LADO_BAIXO, LADO_ESQUERDO };
		for (int i = 0; i < 8; i++) {
			r_points[i] = points[i];
			r_sides[i] = sides[i];
		}
	}

	static int handle_at(const Rect2 &p_r, const Vector2 &p_point) {
		Vector2 points[8];
		int sides[8];
		handles(p_r, points, sides);
		for (int i = 0; i < 8; i++) {
			// Recortes pequenos na tela: as alças do meio somem para não cobrir as dos cantos.
			if ((i % 2 == 1) && (p_r.size.x < 24 || p_r.size.y < 24)) {
				continue;
			}
			if (Rect2(points[i] - Vector2(5, 5), Vector2(10, 10)).has_point(p_point)) {
				return sides[i];
			}
		}
		return 0;
	}

	void draw_handles(const Rect2 &p_r, const Color &p_color) {
		Vector2 points[8];
		int sides[8];
		handles(p_r, points, sides);
		for (int i = 0; i < 8; i++) {
			if ((i % 2 == 1) && (p_r.size.x < 24 || p_r.size.y < 24)) {
				continue;
			}
			draw_rect(Rect2(points[i] - Vector2(3, 3), Vector2(7, 7)), p_color);
			draw_rect(Rect2(points[i] - Vector2(3, 3), Vector2(7, 7)), Color(0, 0, 0, 0.8), false, 1);
		}
	}

	// O retângulo de partida com os lados puxados pelo arraste (nunca vira do avesso).
	static Rect2i resized(const Rect2i &p_start, int p_sides, const Vector2i &p_delta) {
		int x0 = p_start.position.x, y0 = p_start.position.y, x1 = p_start.get_end().x, y1 = p_start.get_end().y;
		if (p_sides & LADO_ESQUERDO) {
			x0 = CLAMP(x0 + p_delta.x, 0, x1 - 1);
		}
		if (p_sides & LADO_DIREITO) {
			x1 = MAX(x1 + p_delta.x, x0 + 1);
		}
		if (p_sides & LADO_CIMA) {
			y0 = CLAMP(y0 + p_delta.y, 0, y1 - 1);
		}
		if (p_sides & LADO_BAIXO) {
			y1 = MAX(y1 + p_delta.y, y0 + 1);
		}
		return Rect2i(x0, y0, x1 - x0, y1 - y0);
	}

	static CursorShape cursor_for(int p_sides) {
		switch (p_sides) {
			case LADO_ESQUERDO | LADO_CIMA:
			case LADO_DIREITO | LADO_BAIXO:
				return CURSOR_FDIAGSIZE;
			case LADO_DIREITO | LADO_CIMA:
			case LADO_ESQUERDO | LADO_BAIXO:
				return CURSOR_BDIAGSIZE;
			case LADO_ESQUERDO:
			case LADO_DIREITO:
				return CURSOR_HSIZE;
			case LADO_CIMA:
			case LADO_BAIXO:
				return CURSOR_VSIZE;
		}
		return CURSOR_ARROW;
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

	void draw_grid(const Ref<Texture2D> &p_tex) {
		const Vector2i size = p_tex->get_size();
		// Parte da folha que aparece, para não desenhar linhas fora da vista.
		const Vector2i from = sheet_point(Vector2()).maxi(0);
		const Vector2i to = (sheet_point(get_size()) + Vector2i(1, 1)).min(size);
		if (zoom >= 8) {
			// Grade de pixel.
			for (int x = from.x; x <= to.x; x++) {
				draw_line(pan + Vector2(x * zoom, from.y * zoom), pan + Vector2(x * zoom, to.y * zoom), Color(1, 1, 1, 0.06));
			}
			for (int y = from.y; y <= to.y; y++) {
				draw_line(pan + Vector2(from.x * zoom, y * zoom), pan + Vector2(to.x * zoom, y * zoom), Color(1, 1, 1, 0.06));
			}
		}
		const int steps[] = { 0, 8, 16, 32 };
		const int step = steps[CLAMP(ed->sheet_grid_option->get_selected(), 0, 3)];
		if (!step || step * zoom < 4) {
			return;
		}
		const Color color(0.55, 0.8, 1, 0.22);
		for (int x = (from.x / step) * step; x <= to.x; x += step) {
			draw_line(pan + Vector2(x * zoom, from.y * zoom), pan + Vector2(x * zoom, to.y * zoom), color);
		}
		for (int y = (from.y / step) * step; y <= to.y; y += step) {
			draw_line(pan + Vector2(from.x * zoom, y * zoom), pan + Vector2(to.x * zoom, y * zoom), color);
		}
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
		if (ed->guides_sheet != path) {
			ed->_load_guides();
		}
		const Ref<Texture2D> tex = ed->_sheet(path);
		if (tex.is_valid()) {
			// Fundo de visualização (xadrez de 8 pixels da folha), só no editor.
			ed->_draw_background(this, Rect2(pan, tex->get_size() * zoom), 8 * zoom, Rect2(Vector2(), get_size()));
			draw_texture_rect(tex, Rect2(pan, tex->get_size() * zoom), false);
			if (ed->colors_button->is_pressed() && ed->color_overlays.has(path) && ed->color_overlays[path].is_valid()) {
				draw_texture_rect(ed->color_overlays[path], Rect2(pan, tex->get_size() * zoom), false);
			}
			draw_grid(tex);
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
		int from = -1, to = -1;
		ed->_frame_range(from, to);
		for (int i = 0; anim && i < anim->frames.size(); i++) {
			const MDPersonagem::Quadro &q = anim->frames[i];
			if (q.source != path) {
				continue;
			}
			const bool selected = i == ed->current_frame;
			const bool in_range = !selected && from != to && i >= from && i <= to;
			const Color color = selected ? Color(1, 0.85, 0.2) : in_range ? Color(1, 0.6, 0.9, 0.9) : Color(0.35, 0.8, 1, 0.85);
			const Rect2 r = screen_rect(q.rect);
			draw_rect(r, color, false, selected ? 2 : 1);
			draw_string(font, r.position + Vector2(3, font->get_ascent(font_size) + 1), itos(i + 1), HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color);
			const Vector2 feet = r.position + Vector2(q.anchor) * zoom;
			draw_line(feet - Vector2(5, 0), feet + Vector2(5, 0), Color(1, 0.3, 0.3), 1);
			draw_line(feet - Vector2(0, 5), feet + Vector2(0, 5), Color(1, 0.3, 0.3), 1);
		}
		if (anim && ed->current_frame < anim->frames.size() && anim->frames[ed->current_frame].source == path) {
			draw_handles(screen_rect(anim->frames[ed->current_frame].rect), Color(1, 0.85, 0.2));
		}
		if (ed->selection.has_area()) {
			draw_handles(screen_rect(ed->selection), Color(1, 1, 1));
		}
		const Color guide_color(0.3, 0.9, 1, 0.75);
		for (int g : ed->guides[0]) {
			draw_line(Vector2(pan.x + g * zoom, 0), Vector2(pan.x + g * zoom, get_size().y), guide_color);
		}
		for (int g : ed->guides[1]) {
			draw_line(Vector2(0, pan.y + g * zoom), Vector2(get_size().x, pan.y + g * zoom), guide_color);
		}
		if (ed->has_measure) {
			const Vector2 a = pan + Vector2(ed->measure_from) * zoom, b = pan + Vector2(ed->measure_to) * zoom;
			const Color color(1, 0.95, 0.3);
			draw_line(a, b, color, 2);
			draw_circle(a, 3, color);
			draw_circle(b, 3, color);
			const Vector2i d = (ed->measure_to - ed->measure_from).abs();
			const String text = vformat(U("↔ %d  ↕ %d px"), d.x, d.y);
			const Vector2 at = (a + b) / 2 + Vector2(6, -6);
			draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, 4, Color(0, 0, 0, 0.85));
			draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color);
		}
		draw_rulers();
	}

	virtual void gui_input(const Ref<InputEvent> &p_event) override {
		const Ref<InputEventMouseButton> mb = p_event;
		const MDPersonagem::Animacao *anim = ed->_parsed();
		const String path = sheet_path();
		const bool editing_frame = anim && ed->current_frame < anim->frames.size() && anim->frames[ed->current_frame].source == path;
		if (mb.is_valid() && mb->is_pressed()) {
			if (mb->get_button_index() == MouseButton::WHEEL_UP || mb->get_button_index() == MouseButton::WHEEL_DOWN) {
				const Vector2 world = (mb->get_position() - pan) / zoom;
				zoom = CLAMP(zoom * (mb->get_button_index() == MouseButton::WHEEL_UP ? 1.25f : 0.8f), 0.25f, 32.0f);
				pan = mb->get_position() - world * zoom;
				queue_redraw();
				accept_event();
				return;
			}
			ed->_set_key_target(RetroAnimationEditor::TECLADO_FOLHA);
			drag = DRAG_PAN;
			drag_from = mb->get_position();
			int axis = 0;
			const int guide = in_ruler(drag_from) ? -1 : guide_at(drag_from, axis);
			if (guide >= 0 && (mb->is_double_click() || mb->get_button_index() == MouseButton::RIGHT)) {
				// Duplo clique ou botão direito numa guia: tira a guia.
				ed->guides[axis].remove_at(guide);
				ed->_save_guides();
				drag = DRAG_NONE;
				queue_redraw();
				accept_event();
				return;
			}
			if (mb->get_button_index() == MouseButton::LEFT && in_ruler(drag_from)) {
				// Arrastar da régua de cima cria uma guia horizontal; da esquerda, uma vertical.
				if (drag_from.x < RULER && drag_from.y < RULER) {
					drag = DRAG_NONE;
					accept_event();
					return;
				}
				guide_axis = drag_from.y < RULER ? 1 : 0;
				ed->guides[guide_axis].push_back(sheet_edge(drag_from)[guide_axis]);
				guide_index = ed->guides[guide_axis].size() - 1;
				drag = DRAG_GUIDE;
				queue_redraw();
				accept_event();
				return;
			}
			if (mb->get_button_index() == MouseButton::LEFT && guide >= 0 && !ed->measure_button->is_pressed()) {
				guide_axis = axis;
				guide_index = guide;
				drag = DRAG_GUIDE;
				accept_event();
				return;
			}
			if (mb->get_button_index() == MouseButton::LEFT && ed->measure_button->is_pressed()) {
				drag = DRAG_MEASURE;
				ed->has_measure = true;
				ed->measure_from = ed->measure_to = sheet_edge(drag_from);
				ed->_refresh_measure();
				queue_redraw();
				accept_event();
				return;
			}
			if (mb->get_button_index() == MouseButton::LEFT) {
				ed->_before_edit(before);
				const bool has_selection = ed->selection.has_area();
				int sides = 0;
				if (has_selection && (sides = handle_at(screen_rect(ed->selection), drag_from))) {
					drag = DRAG_SELECTION_RESIZE;
					drag_sides = sides;
					drag_rect = ed->selection;
				} else if (editing_frame && !mb->is_shift_pressed() && (sides = handle_at(screen_rect(anim->frames[ed->current_frame].rect), drag_from))) {
					drag = DRAG_RESIZE;
					drag_sides = sides;
					drag_frame = ed->current_frame;
					drag_rect = anim->frames[drag_frame].rect;
					drag_anchor = anim->frames[drag_frame].anchor;
				} else if (has_selection && !mb->is_shift_pressed() && screen_rect(ed->selection).has_point(drag_from)) {
					drag = DRAG_SELECTION_MOVE;
					drag_rect = ed->selection;
				} else {
					drag = DRAG_SELECT;
					for (int i = anim && !mb->is_shift_pressed() ? anim->frames.size() - 1 : -1; i >= 0; i--) {
						if (anim->frames[i].source == path && screen_rect(anim->frames[i].rect).has_point(drag_from)) {
							drag = DRAG_MOVE;
							drag_frame = i;
							if (i != ed->current_frame) {
								ed->_frame_selected(i);
							}
							anim = ed->_parsed();
							drag_rect = anim->frames[i].rect;
							break;
						}
					}
				}
			}
			accept_event();
			return;
		}
		if (mb.is_valid() && !mb->is_pressed() && drag == DRAG_GUIDE) {
			// Soltar na régua ou fora da vista tira a guia.
			const Vector2 at = mb->get_position();
			if (guide_index >= 0 && guide_index < ed->guides[guide_axis].size() && (at[1 - guide_axis] < 0 || at[guide_axis] < RULER || !Rect2(Vector2(), get_size()).has_point(at))) {
				ed->guides[guide_axis].remove_at(guide_index);
			}
			guide_index = -1;
			drag = DRAG_NONE;
			ed->_save_guides();
			queue_redraw();
			return;
		}
		if (mb.is_valid() && !mb->is_pressed() && drag == DRAG_MEASURE) {
			drag = DRAG_NONE;
			if (ed->measure_from == ed->measure_to) {
				ed->has_measure = false;
			}
			ed->_refresh_measure();
			queue_redraw();
			return;
		}
		if (mb.is_valid() && !mb->is_pressed() && drag != DRAG_NONE) {
			if (drag == DRAG_SELECT) {
				// Clique sem arrastar: o desenho sob o mouse.
				if (drag_from.distance_to(mb->get_position()) < 3) {
					ed->_set_selection(ed->_detect_sprite(sheet_point(drag_from)));
				} else {
					ed->_set_selection(drag_area(drag_from, mb->get_position()));
				}
				ed->_commit(U("Selecionar"), before);
			} else if (drag == DRAG_SELECTION_MOVE && drag_from.distance_to(mb->get_position()) < 3) {
				// Clique dentro da seleção sem arrastar: o desenho sob o mouse, como no vazio.
				ed->_set_selection(ed->_detect_sprite(sheet_point(drag_from)));
				ed->_commit(U("Selecionar"), before);
			} else if (drag == DRAG_SELECTION_MOVE || drag == DRAG_SELECTION_RESIZE) {
				ed->_commit(drag == DRAG_SELECTION_MOVE ? U("Mover seleção") : U("Tamanho da seleção"), before);
			} else if ((drag == DRAG_MOVE || drag == DRAG_RESIZE) && anim && drag_frame < anim->frames.size() && anim->frames[drag_frame].rect != drag_rect) {
				ed->_commit(drag == DRAG_MOVE ? U("Mover recorte") : U("Redimensionar recorte"), before);
			}
			drag = DRAG_NONE;
			return;
		}
		const Ref<InputEventMouseMotion> mm = p_event;
		if (mm.is_valid() && drag == DRAG_NONE) {
			return;
		}
		if (mm.is_valid()) {
			if (drag == DRAG_GUIDE) {
				if (guide_index >= 0 && guide_index < ed->guides[guide_axis].size()) {
					ed->guides[guide_axis].write[guide_index] = MAX(0, sheet_edge(mm->get_position())[guide_axis]);
					queue_redraw();
				}
				return;
			}
			if (drag == DRAG_MEASURE) {
				Vector2i to = sheet_edge(mm->get_position());
				if (mm->is_shift_pressed()) {
					// Shift trava no eixo de maior distância.
					const Vector2i d = (to - ed->measure_from).abs();
					to[d.x >= d.y ? 1 : 0] = ed->measure_from[d.x >= d.y ? 1 : 0];
				}
				ed->measure_to = to;
				ed->_refresh_measure();
				queue_redraw();
				return;
			}
			if (drag == DRAG_PAN) {
				pan += mm->get_relative();
				queue_redraw();
				return;
			}
			if (drag == DRAG_SELECT) {
				if (drag_from.distance_to(mm->get_position()) >= 3) {
					ed->_set_selection(drag_area(drag_from, mm->get_position()));
				}
				return;
			}
			const Vector2 delta_f = (mm->get_position() - drag_from) / zoom;
			const Vector2i delta(Math::round(delta_f.x), Math::round(delta_f.y));
			if (drag == DRAG_SELECTION_MOVE || drag == DRAG_SELECTION_RESIZE) {
				Rect2i rect = drag_rect;
				if (drag == DRAG_SELECTION_MOVE) {
					rect.position = (rect.position + delta).maxi(0);
					rect = snap_move(rect);
				} else {
					rect = snap_sides(resized(drag_rect, drag_sides, delta), drag_sides);
				}
				if (rect != ed->selection) {
					ed->_set_selection(rect, drag == DRAG_SELECTION_RESIZE);
				}
				return;
			}
			if (!anim || drag_frame >= anim->frames.size()) {
				return;
			}
			if (drag == DRAG_MOVE) {
				Rect2i rect = drag_rect;
				rect.position = (rect.position + delta).maxi(0);
				rect = snap_move(rect);
				if (anim->frames[drag_frame].rect != rect) {
					ed->_set_frame_rect(drag_frame, rect);
				}
			} else {
				// Puxar a borda esquerda ou de cima desloca os pés junto: o desenho fica no lugar.
				const Rect2i rect = snap_sides(resized(drag_rect, drag_sides, delta), drag_sides);
				const Vector2i anchor = drag_anchor - (rect.position - drag_rect.position);
				if (anim->frames[drag_frame].rect != rect) {
					ed->_set_frame_rect(drag_frame, rect, anchor);
				}
			}
		}
	}

	virtual CursorShape get_cursor_shape(const Point2 &p_pos) const override {
		if (drag == DRAG_GUIDE) {
			return guide_axis == 0 ? CURSOR_HSIZE : CURSOR_VSIZE;
		}
		if (drag == DRAG_MEASURE || (drag == DRAG_NONE && ed->measure_button->is_pressed() && !in_ruler(p_pos))) {
			return CURSOR_CROSS;
		}
		if (drag == DRAG_NONE && !in_ruler(p_pos)) {
			int axis = 0;
			if (guide_at(p_pos, axis) >= 0) {
				return axis == 0 ? CURSOR_HSIZE : CURSOR_VSIZE;
			}
		}
		if (drag == DRAG_RESIZE || drag == DRAG_SELECTION_RESIZE) {
			return cursor_for(drag_sides);
		}
		if (drag == DRAG_PAN) {
			return CURSOR_DRAG;
		}
		if (drag == DRAG_SELECT) {
			return CURSOR_CROSS;
		}
		if (drag == DRAG_MOVE || drag == DRAG_SELECTION_MOVE) {
			return CURSOR_MOVE;
		}
		if (ed->selection.has_area()) {
			const int sides = handle_at(screen_rect(ed->selection), p_pos);
			if (sides) {
				return cursor_for(sides);
			}
			if (screen_rect(ed->selection).has_point(p_pos)) {
				return CURSOR_MOVE;
			}
		}
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (anim && ed->current_frame < anim->frames.size() && anim->frames[ed->current_frame].source == sheet_path()) {
			const int sides = handle_at(screen_rect(anim->frames[ed->current_frame].rect), p_pos);
			if (sides) {
				return cursor_for(sides);
			}
		}
		return CURSOR_ARROW;
	}

	RetroSheetView() {
		set_clip_contents(true);
		set_texture_filter(TEXTURE_FILTER_NEAREST);
		set_focus_mode(FOCUS_CLICK);
	}
};

// Prévia da animação na célula comum, alinhada pelos pés. Clique marca os pés do quadro em edição.
// Roda = zoom no ponto do mouse; botão do meio ou direito = mover a vista; Espelhar = virado para a
// esquerda, como o jogo desenha (só a prévia).
class RetroAnimationPreview : public Control {
	GDCLASS(RetroAnimationPreview, Control);

public:
	RetroAnimationEditor *ed = nullptr;
	int zoom = 0; // 0 = ajustar à prévia; senão, a escala inteira.
	Vector2 view_offset; // Deslocamento da vista (com zoom fixo).
	bool flip = false;
	bool panning = false;

	struct Layout {
		MDPersonagem::Celula cell;
		float scale = 1;
		Vector2 origin;
	};

	int fit_scale(const MDPersonagem::Celula &p_cell) const {
		const Vector2 room = get_size() - Vector2(16, 40);
		return MAX(1, int(Math::floor(MIN(room.x / p_cell.size.x, room.y / p_cell.size.y))));
	}

	Vector2 centered(const MDPersonagem::Celula &p_cell, float p_scale) const {
		return ((get_size() - Vector2(0, 24) - Vector2(p_cell.size) * p_scale) / 2).floor();
	}

	Layout layout() const {
		Layout l;
		l.cell = ed->personagem->get_cell();
		l.scale = zoom > 0 ? zoom : fit_scale(l.cell);
		l.origin = centered(l.cell, l.scale) + (zoom > 0 ? view_offset : Vector2());
		return l;
	}

	int current_scale() const {
		return ed->personagem.is_valid() ? int(layout().scale) : 1;
	}

	// Muda a escala mantendo parado o ponto da tela p_at (o meio da prévia, se negativo).
	void set_zoom(int p_zoom, Vector2 p_at = Vector2(-1, -1)) {
		if (ed->personagem.is_null()) {
			return;
		}
		const Layout l = layout();
		if (p_zoom <= 0) {
			zoom = 0;
			view_offset = Vector2();
		} else {
			p_zoom = CLAMP(p_zoom, 1, 32);
			if (p_at.x < 0) {
				p_at = Vector2(l.origin) + Vector2(l.cell.anchor) * l.scale; // Os pés ficam no lugar.
			}
			const Vector2 origin = p_at - (p_at - l.origin) * (float(p_zoom) / l.scale);
			zoom = p_zoom;
			view_offset = (origin - centered(l.cell, p_zoom)).round();
		}
		queue_redraw();
		ed->_refresh_zoom_label();
	}

	// Pés na tela e a direção x (−1 com o espelho).
	Vector2 feet_screen(const Layout &p_l) const {
		return p_l.origin + Vector2(p_l.cell.anchor) * p_l.scale;
	}

	// Ponto da tela relativo aos pés, em pixels do personagem (desfaz o espelho).
	Vector2 to_feet(const Layout &p_l, const Vector2 &p_screen) const {
		Vector2 p = (p_screen - feet_screen(p_l)) / p_l.scale;
		if (flip) {
			p.x = -p.x;
		}
		return p;
	}

	void draw_frame(const Layout &p_l, const MDPersonagem::Quadro &p_q, float p_alpha, const Color &p_tint = Color(1, 1, 1)) {
		const Ref<Texture2D> tex = ed->_sheet(p_q.source);
		if (tex.is_null()) {
			return;
		}
		const Vector2 top_left = Vector2(p_q.offset - p_q.anchor) * p_l.scale;
		draw_texture_rect_region(tex, Rect2(top_left, Vector2(p_q.rect.size) * p_l.scale), Rect2(p_q.rect), Color(p_tint.r, p_tint.g, p_tint.b, p_alpha));
	}

	void _notification(int p_what) {
		if (p_what == NOTIFICATION_RESIZED && ed && ed->zoom_label) {
			ed->_refresh_zoom_label();
		}
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
		const Vector2 cell_size = Vector2(l.cell.size) * l.scale;
		if (ed->scenery.is_valid()) {
			// Cenário repetido na horizontal, com a linha do chão nos pés.
			const Vector2 size = Vector2(ed->scenery->get_size()) * l.scale;
			const Vector2 feet_at = feet_screen(l);
			const float y = feet_at.y - ed->ground_field->get_value() * l.scale;
			const float shift = Math::fposmod(float(ed->scenery_scroll) * l.scale * (flip ? -1.0f : 1.0f), size.x);
			for (float x = feet_at.x - shift - Math::ceil(feet_at.x / size.x + 1) * size.x; x < get_size().x; x += size.x) {
				draw_texture_rect(ed->scenery, Rect2(x, y, size.x, size.y), false);
			}
			draw_rect(Rect2(l.origin, cell_size), Color(1, 1, 1, 0.15), false, 1);
		} else {
			ed->_draw_background(this, Rect2(l.origin, cell_size), 4 * l.scale, Rect2(Vector2(), get_size()));
		}
		if (l.scale >= 6) {
			// Grade de pixel, para encaixar no detalhe.
			for (int x = 1; x < l.cell.size.x; x++) {
				draw_line(l.origin + Vector2(x * l.scale, 0), l.origin + Vector2(x * l.scale, cell_size.y), Color(1, 1, 1, 0.035));
			}
			for (int y = 1; y < l.cell.size.y; y++) {
				draw_line(l.origin + Vector2(0, y * l.scale), l.origin + Vector2(cell_size.x, y * l.scale), Color(1, 1, 1, 0.035));
			}
		}
		for (int x = 8; x < l.cell.size.x; x += 8) {
			draw_line(l.origin + Vector2(x * l.scale, 0), l.origin + Vector2(x * l.scale, cell_size.y), Color(1, 1, 1, 0.07));
		}
		for (int y = 8; y < l.cell.size.y; y += 8) {
			draw_line(l.origin + Vector2(0, y * l.scale), l.origin + Vector2(cell_size.x, y * l.scale), Color(1, 1, 1, 0.07));
		}
		const Vector2 feet = feet_screen(l);
		// Desenho e caixas relativos aos pés; com o espelho, virados em volta da linha dos pés.
		draw_set_transform(feet, 0, Vector2(flip ? -1 : 1, 1));
		const MDPersonagem::Quadro *reference = ed->playing ? nullptr : ed->_reference_frame();
		const float alpha = ed->reference_alpha->get_value() / 100.0;
		if (reference) {
			draw_frame(l, *reference, alpha);
		} else if (!ed->playing && ed->_onion() && anim->frames.size() > 1) {
			// Onion skin: o anterior em vermelho e o seguinte em azul, por baixo.
			const int count = anim->frames.size();
			draw_frame(l, anim->frames[(frame + count - 1) % count], alpha, Color(1, 0.35, 0.35));
			if (count > 2) {
				draw_frame(l, anim->frames[(frame + 1) % count], alpha, Color(0.35, 0.65, 1));
			}
		}
		draw_frame(l, anim->frames[frame], 1);
		draw_set_transform(Vector2());
		draw_line(feet - Vector2(8, 0), feet + Vector2(8, 0), Color(1, 0.3, 0.3), 1);
		draw_line(feet - Vector2(0, 8), feet + Vector2(0, 8), Color(1, 0.3, 0.3), 1);
		const Ref<Font> font = get_theme_default_font();
		const int font_size = get_theme_default_font_size();
		if (ed->show_boxes) {
			// Caixas na tela (o texto das etiquetas não espelha): preenchimento leve, contorno e o nome.
			// A caixa sob o mouse (ou sendo arrastada) ganha as alças.
			const Vector<Caixa> list = caixas(anim, frame);
			const int small = MAX(10, font_size - 3);
			for (int i = list.size() - 1; i >= 0; i--) {
				const Caixa &c = list[i];
				const Rect2 r = to_screen(l, c.rect);
				const bool hot = c.kind == (drag_kind ? drag_kind : hover_kind);
				if (c.active) {
					draw_rect(r, Color(c.color, hot ? 0.22 : 0.12));
					draw_rect(r, Color(c.color, 0.95), false, hot ? 2 : 1);
				} else {
					// Ataque fora dos quadros do golpe: tracejado, para saber onde ele está.
					const Vector2 p[4] = { r.position, Vector2(r.get_end().x, r.position.y), r.get_end(), Vector2(r.position.x, r.get_end().y) };
					for (int k = 0; k < 4; k++) {
						draw_dashed_line(p[k], p[(k + 1) % 4], Color(c.color, 0.6), 1, 4);
					}
				}
				const Rect2 tag = tag_rect(r, c.label, font, small);
				draw_rect(tag, Color(c.color, c.active ? 0.85 : 0.45));
				draw_string(font, tag.position + Vector2(3, tag.size.y - 3), c.label, HORIZONTAL_ALIGNMENT_LEFT, -1, small, Color(0.05, 0.05, 0.08));
				if (hot && c.active) {
					for (int h = 0; h < 8; h++) {
						const Vector2 at = handle_screen(l, c.rect, h);
						draw_rect(Rect2(at - Vector2(3, 3), Vector2(7, 7)), Color(0.05, 0.05, 0.08));
						draw_rect(Rect2(at - Vector2(2, 2), Vector2(5, 5)), c.color);
					}
				}
			}
		}
		draw_rect(Rect2(0, get_size().y - 24, get_size().x, 24), Color(0.11, 0.11, 0.13));
		const String caption = vformat(U("Quadro %d de %d · %d/60 s · célula %d×%d%s%s"), frame + 1, anim->frames.size(), anim->frames[frame].ticks, l.cell.size.x, l.cell.size.y, flip ? U(" · espelhado") : String(), anim->frames[frame].event.is_empty() ? String() : U(" · ⚑ ") + anim->frames[frame].event);
		draw_string(font, Vector2(0, get_size().y - 8), caption, HORIZONTAL_ALIGNMENT_CENTER, get_size().x, font_size, Color(0.8, 0.8, 0.85));
	}

	int box_kind = 0; // Caixa sendo desenhada (1 = corpo, 2 = ataque, 3 = dano).
	Vector2i box_start;
	Dictionary before;

	// Caixas editáveis direto na prévia: bordas e cantos mudam o tamanho, a etiqueta move.
	struct Caixa {
		int kind = 0; // 1 = corpo, 2 = ataque, 3 = dano (o mesmo de _set_box).
		Rect2i rect; // Relativa aos pés.
		Color color;
		String label;
		bool active = true; // Ataque: só nos quadros do golpe.
	};
	int hover_kind = 0;
	int drag_kind = 0;
	int drag_handle = -1; // 0..7 = alça (ver handle_point), 8 = mover (pela etiqueta ou por dentro).
	int last_drag_kind = 0;
	Rect2i drag_rect;
	Vector2 drag_from;

	// Na ordem de prioridade para o mouse: ataque, dano, corpo.
	Vector<Caixa> caixas(const MDPersonagem::Animacao *p_anim, int p_frame) const {
		Vector<Caixa> list;
		if (p_anim && p_anim->attack) {
			Caixa c;
			c.kind = 2;
			c.rect = p_anim->attack_box;
			c.color = Color(1, 0.3, 0.3);
			c.active = p_frame >= p_anim->attack_first && p_frame <= p_anim->attack_last;
			c.label = p_anim->attack_first == p_anim->attack_last ? vformat(U("ataque · quadro %d"), p_anim->attack_first + 1) : vformat(U("ataque · quadros %d–%d"), p_anim->attack_first + 1, p_anim->attack_last + 1);
			list.push_back(c);
		}
		if (ed->personagem->has_custom_hurt_box()) {
			Caixa c;
			c.kind = 3;
			c.rect = ed->personagem->get_hurt_box();
			c.color = Color(0.75, 0.45, 1);
			c.label = U("dano");
			list.push_back(c);
		}
		Caixa c;
		c.kind = 1;
		c.rect = ed->personagem->get_body_box();
		c.color = Color(0.3, 1, 0.4);
		c.label = ed->personagem->has_custom_hurt_box() ? U("corpo") : U("corpo e dano");
		list.push_back(c);
		return list;
	}

	// Ponto do personagem (relativo aos pés) na tela, com o espelho.
	Vector2 point_screen(const Layout &p_l, const Vector2 &p_point) const {
		return feet_screen(p_l) + Vector2(flip ? -p_point.x : p_point.x, p_point.y) * p_l.scale;
	}

	Rect2 to_screen(const Layout &p_l, const Rect2i &p_rect) const {
		const Vector2 a = point_screen(p_l, p_rect.position), b = point_screen(p_l, p_rect.get_end());
		return Rect2(a.min(b), (b - a).abs());
	}

	// Alças em coordenadas do personagem: 0 canto esq./cima, 1 cima, 2 canto dir./cima, 3 direita,
	// 4 canto dir./baixo, 5 baixo, 6 canto esq./baixo, 7 esquerda.
	static Vector2 handle_point(const Rect2i &p_rect, int p_handle) {
		static const float fx[8] = { 0, 0.5, 1, 1, 1, 0.5, 0, 0 };
		static const float fy[8] = { 0, 0, 0, 0.5, 1, 1, 1, 0.5 };
		return Vector2(p_rect.position) + Vector2(p_rect.size) * Vector2(fx[p_handle], fy[p_handle]);
	}

	Vector2 handle_screen(const Layout &p_l, const Rect2i &p_rect, int p_handle) const {
		return point_screen(p_l, handle_point(p_rect, p_handle));
	}

	static Rect2 tag_rect(const Rect2 &p_box, const String &p_label, const Ref<Font> &p_font, int p_size) {
		const Vector2 text = p_font->get_string_size(p_label, HORIZONTAL_ALIGNMENT_LEFT, -1, p_size);
		const float h = text.y + 2;
		return Rect2(p_box.position - Vector2(0, h), Vector2(text.x + 6, h));
	}

	// Caixa e alça sob o mouse (-1 se nenhuma): alças primeiro, depois as bordas, depois a etiqueta.
	int box_at(const Vector2 &p_screen, int &r_handle) const {
		r_handle = -1;
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (!ed->show_boxes || !anim || anim->frames.is_empty()) {
			return 0;
		}
		const Layout l = layout();
		const int frame = CLAMP(ed->playing ? ed->play_frame : ed->current_frame, 0, anim->frames.size() - 1);
		const Vector<Caixa> list = caixas(anim, frame);
		const Ref<Font> font = get_theme_default_font();
		const int small = MAX(10, get_theme_default_font_size() - 3);
		for (const Caixa &c : list) {
			for (int h = 0; h < 8; h += 2) {
				if (handle_screen(l, c.rect, h).distance_to(p_screen) <= 6) {
					r_handle = h;
					return c.kind;
				}
			}
		}
		for (const Caixa &c : list) {
			const Rect2 r = to_screen(l, c.rect);
			if (!r.grow(5).has_point(p_screen) || r.grow(-4).has_point(p_screen)) {
				continue;
			}
			// Perto de uma borda: qual (no espaço da tela, convertida para a do personagem).
			const bool left = Math::abs(p_screen.x - r.position.x) <= 5, right = Math::abs(p_screen.x - r.get_end().x) <= 5;
			const bool top = Math::abs(p_screen.y - r.position.y) <= 5, bottom = Math::abs(p_screen.y - r.get_end().y) <= 5;
			const bool char_left = flip ? right : left, char_right = flip ? left : right;
			if (top) {
				r_handle = 1;
			} else if (bottom) {
				r_handle = 5;
			} else if (char_right) {
				r_handle = 3;
			} else if (char_left) {
				r_handle = 7;
			}
			if (r_handle >= 0) {
				return c.kind;
			}
		}
		for (const Caixa &c : list) {
			if (tag_rect(to_screen(l, c.rect), c.label, font, small).has_point(p_screen)) {
				r_handle = 8;
				return c.kind;
			}
		}
		// Dentro de uma caixa: a menor sob o mouse (a de dano dentro do corpo, por exemplo). Arrastar
		// move; um clique sem arrastar continua marcando os pés.
		int inside = 0;
		int64_t smallest = INT64_MAX;
		for (const Caixa &c : list) {
			const Rect2 r = to_screen(l, c.rect);
			const int64_t area = int64_t(c.rect.size.x) * c.rect.size.y;
			if (r.has_point(p_screen) && area < smallest) {
				smallest = area;
				inside = c.kind;
			}
		}
		if (inside) {
			r_handle = 9;
		}
		return inside;
	}

	bool drag_pending = false; // Apertou dentro de uma caixa e ainda não arrastou.

	void mark_feet(const Layout &p_l, const Vector2 &p_screen) {
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (!anim || ed->current_frame >= anim->frames.size()) {
			return;
		}
		const MDPersonagem::Quadro &q = anim->frames[ed->current_frame];
		const Vector2 p = to_feet(p_l, p_screen).floor();
		const Vector2i at = Vector2i(p.x, p.y) + q.anchor - q.offset;
		ed->_set_frame_anchor(at.clamp(Vector2i(), q.rect.size));
		ed->_commit(U("Marcar os pés"), before);
	}

	Rect2i dragged_rect(const Vector2 &p_screen) const {
		const Vector2 d = to_feet(layout(), p_screen) - to_feet(layout(), drag_from);
		const Vector2i delta(Math::round(d.x), Math::round(d.y));
		if (drag_handle == 8) {
			return Rect2i(drag_rect.position + delta, drag_rect.size);
		}
		int left = drag_rect.position.x, top = drag_rect.position.y, right = drag_rect.get_end().x, bottom = drag_rect.get_end().y;
		const bool l = drag_handle == 0 || drag_handle == 6 || drag_handle == 7;
		const bool r = drag_handle == 2 || drag_handle == 3 || drag_handle == 4;
		const bool t = drag_handle == 0 || drag_handle == 1 || drag_handle == 2;
		const bool b = drag_handle == 4 || drag_handle == 5 || drag_handle == 6;
		if (l) {
			left = MIN(left + delta.x, right - 1);
		}
		if (r) {
			right = MAX(right + delta.x, left + 1);
		}
		if (t) {
			top = MIN(top + delta.y, bottom - 1);
		}
		if (b) {
			bottom = MAX(bottom + delta.y, top + 1);
		}
		return Rect2i(left, top, right - left, bottom - top);
	}

	Vector2i feet_point(const Layout &p_l, const Vector2 &p_screen) const {
		// Medida pelas bordas: arrastar até a cruz dos pés termina a caixa exatamente nos pés.
		const Vector2 p = to_feet(p_l, p_screen).round();
		return Vector2i(p.x, p.y);
	}

	virtual void gui_input(const Ref<InputEvent> &p_event) override {
		const Ref<InputEventMouseButton> mb = p_event;
		const Ref<InputEventMouseMotion> mm = p_event;
		if (ed->personagem.is_null()) {
			return;
		}
		if (mb.is_valid() && mb->is_pressed() && (mb->get_button_index() == MouseButton::WHEEL_UP || mb->get_button_index() == MouseButton::WHEEL_DOWN)) {
			const int now = current_scale();
			set_zoom(mb->get_button_index() == MouseButton::WHEEL_UP ? now + 1 : MAX(1, now - 1), mb->get_position());
			accept_event();
			return;
		}
		if (mb.is_valid() && (mb->get_button_index() == MouseButton::MIDDLE || mb->get_button_index() == MouseButton::RIGHT)) {
			panning = mb->is_pressed();
			if (panning && zoom == 0) {
				zoom = current_scale(); // Mover a vista fixa a escala atual.
				view_offset = Vector2();
				ed->_refresh_zoom_label();
			}
			accept_event();
			return;
		}
		if (mm.is_valid() && panning) {
			view_offset += mm->get_relative();
			queue_redraw();
			accept_event();
			return;
		}
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (!anim || ed->current_frame >= anim->frames.size()) {
			return;
		}
		const Layout l = layout();
		static const char *box_names[] = { "", "Caixa do corpo", "Caixa de ataque", "Caixa de dano" };
		if (drag_kind) {
			if (mm.is_valid()) {
				if (drag_pending && mm->get_position().distance_to(drag_from) < 3) {
					accept_event();
					return;
				}
				drag_pending = false;
				ed->_set_box(drag_kind, dragged_rect(mm->get_position()));
				accept_event();
				return;
			}
			if (mb.is_valid() && mb->get_button_index() == MouseButton::LEFT && !mb->is_pressed()) {
				const bool was_click = drag_pending;
				drag_pending = false;
				drag_kind = 0;
				if (was_click) {
					// Clique dentro da caixa, sem arrastar: o que o "Clique marca" escolhe (os pés).
					if (ed->click_option->get_selected() == 0) {
						mark_feet(l, mb->get_position());
					}
				} else {
					ed->_commit(String::utf8(box_names[drag_kind ? drag_kind : last_drag_kind]), before);
				}
				queue_redraw();
				accept_event();
				return;
			}
		}
		if (mm.is_valid() && !box_kind) {
			int handle;
			const int kind = box_at(mm->get_position(), handle);
			if (kind != hover_kind) {
				hover_kind = kind;
				queue_redraw();
			}
		}
		if (mb.is_valid() && mb->get_button_index() == MouseButton::LEFT && mb->is_pressed() && !box_kind) {
			int handle;
			int kind = box_at(mb->get_position(), handle);
			if (handle == 9 && ed->click_option->get_selected() != 0) {
				kind = 0; // Desenhando caixa nova: arrastar por dentro desenha, como antes.
			}
			if (kind) {
				grab_focus();
				ed->_set_key_target(RetroAnimationEditor::TECLADO_PREVIA);
				if (ed->playing) {
					ed->_toggle_play();
				}
				ed->_before_edit(before);
				const MDPersonagem::Animacao *now = ed->_parsed();
				for (const Caixa &c : caixas(now, ed->current_frame)) {
					if (c.kind == kind) {
						drag_rect = c.rect;
					}
				}
				drag_kind = kind;
				last_drag_kind = kind;
				drag_pending = handle == 9;
				drag_handle = handle == 9 ? 8 : handle;
				drag_from = mb->get_position();
				accept_event();
				return;
			}
		}
		if (mb.is_valid() && mb->get_button_index() == MouseButton::LEFT && !mb->is_pressed() && box_kind) {
			ed->_commit(box_kind == 1 ? U("Caixa do corpo") : box_kind == 2 ? U("Caixa de ataque") : U("Caixa de dano"), before);
			box_kind = 0;
			accept_event();
			return;
		}
		if (mm.is_valid() && box_kind) {
			const Vector2i at = feet_point(l, mm->get_position());
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
			box_start = feet_point(l, mb->get_position());
			ed->_set_box(box_kind, Rect2i(box_start, Vector2i(1, 1)));
			accept_event();
			return;
		}
		// Pés: o pixel clicado, no recorte do quadro.
		const MDPersonagem::Quadro &q = anim->frames[ed->current_frame];
		const Vector2 p = to_feet(l, mb->get_position()).floor();
		const Vector2i feet = Vector2i(p.x, p.y) + q.anchor - q.offset;
		ed->_set_frame_anchor(feet.clamp(Vector2i(), q.rect.size));
		ed->_commit(U("Marcar os pés"), before);
		accept_event();
	}

	virtual CursorShape get_cursor_shape(const Point2 &p_pos) const override {
		if (panning) {
			return CURSOR_DRAG;
		}
		int handle = drag_kind ? drag_handle : -1;
		if (!drag_kind) {
			box_at(p_pos, handle);
		}
		if (handle == 8 || (handle == 9 && ed->click_option->get_selected() == 0)) {
			return CURSOR_MOVE;
		}
		if (handle == 1 || handle == 5) {
			return CURSOR_VSIZE;
		}
		if (handle == 3 || handle == 7) {
			return CURSOR_HSIZE;
		}
		if (handle == 0 || handle == 4) {
			return flip ? CURSOR_BDIAGSIZE : CURSOR_FDIAGSIZE;
		}
		if (handle == 2 || handle == 6) {
			return flip ? CURSOR_FDIAGSIZE : CURSOR_BDIAGSIZE;
		}
		return CURSOR_CROSS;
	}

	RetroAnimationPreview() {
		set_clip_contents(true);
		set_texture_filter(TEXTURE_FILTER_NEAREST);
		set_custom_minimum_size(Size2(240, 200) * EDSCALE);
		set_focus_mode(FOCUS_CLICK);
		set_tooltip_text(U("Caixas: arraste por dentro (ou pela etiqueta) para mover, e a borda ou o canto para mudar o tamanho (Ctrl+Z desfaz). Com caixas uma dentro da outra, vale a menor.\nVerde: corpo (bate no chão e nas paredes; também leva golpe se não houver caixa de dano) · roxo: dano · vermelho: ataque (tracejado fora dos quadros do golpe).\nClique sem arrastar: marca o que estiver escolhido embaixo (pés do quadro, ou arraste para desenhar uma caixa nova).\nRoda: zoom no ponto do mouse · botão do meio ou direito: mover a vista.\nSetas (em qualquer lugar do editor): ajuste fino do quadro (Shift = 8 pixels)."));
	}
};

// Ritmo da animação: cada quadro com a largura do tempo dele (para ver de relance os quadros longos e
// curtos), o quadro em edição em amarelo, o trecho em rosa e a posição da prévia tocando. Clique
// escolhe o quadro.
class RetroRhythmBar : public Control {
	GDCLASS(RetroRhythmBar, Control);

public:
	RetroAnimationEditor *ed = nullptr;

	int total_ticks(const MDPersonagem::Animacao *p_anim) const {
		int total = 0;
		for (const MDPersonagem::Quadro &q : p_anim->frames) {
			total += q.ticks;
		}
		return MAX(1, total);
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
		const float per_tick = get_size().x / total_ticks(anim);
		const Ref<Font> font = get_theme_default_font();
		const int font_size = MAX(8, get_theme_default_font_size() - 3);
		int from = -1, to = -1;
		ed->_frame_range(from, to);
		float x = 0;
		for (int i = 0; i < anim->frames.size(); i++) {
			const float w = anim->frames[i].ticks * per_tick;
			const Rect2 r(x + 1, 2, MAX(1.0f, w - 2), get_size().y - 4);
			const bool in_range = from != to && i >= from && i <= to;
			draw_rect(r, in_range ? Color(0.55, 0.3, 0.5) : (i % 2 ? Color(0.25, 0.32, 0.42) : Color(0.3, 0.38, 0.5)));
			if (i == ed->current_frame) {
				draw_rect(r, Color(1, 0.85, 0.2), false, 2);
			}
			const String label = w > 34 ? vformat(U("%d·%d"), i + 1, anim->frames[i].ticks) : (w > 12 ? itos(i + 1) : String());
			if (!label.is_empty()) {
				draw_string(font, Vector2(r.position.x + 3, r.position.y + (r.size.y + font->get_ascent(font_size) - font->get_descent(font_size)) / 2), label, HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 4, font_size, Color(1, 1, 1, 0.85));
			}
			x += w;
		}
		if (ed->playing) {
			int before = 0;
			for (int i = 0; i < ed->play_frame && i < anim->frames.size(); i++) {
				before += anim->frames[i].ticks;
			}
			const float at = (before + MIN(double(anim->frames[CLAMP(ed->play_frame, 0, anim->frames.size() - 1)].ticks), ed->play_ticks)) * per_tick;
			draw_line(Vector2(at, 0), Vector2(at, get_size().y), Color(1, 1, 1, 0.9), 2);
		}
	}

	virtual void gui_input(const Ref<InputEvent> &p_event) override {
		const Ref<InputEventMouseButton> mb = p_event;
		const MDPersonagem::Animacao *anim = ed->_parsed();
		if (mb.is_null() || !mb->is_pressed() || mb->get_button_index() != MouseButton::LEFT || !anim || anim->frames.is_empty()) {
			return;
		}
		const float per_tick = get_size().x / total_ticks(anim);
		float x = 0;
		for (int i = 0; i < anim->frames.size(); i++) {
			x += anim->frames[i].ticks * per_tick;
			if (mb->get_position().x < x || i == anim->frames.size() - 1) {
				if (ed->playing) {
					ed->_toggle_play();
				}
				ed->_frame_selected(i);
				break;
			}
		}
		accept_event();
	}

	RetroRhythmBar() {
		set_custom_minimum_size(Size2(0, 22) * EDSCALE);
		set_tooltip_text(U("Ritmo: cada quadro com a largura do tempo dele (número·tempo em 1/60 s). Amarelo: quadro em edição; rosa: o trecho; a linha branca é a prévia tocando. Clique para escolher o quadro."));
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
	const bool was_updating = updating;
	updating = true;
	const int values[4] = { selection.position.x, selection.position.y, selection.size.x, selection.size.y };
	for (int i = 0; i < 4; i++) {
		selection_fields[i]->set_value(values[i]);
		selection_fields[i]->set_editable(has);
		if (!has) {
			selection_fields[i]->get_line_edit()->set_text(String()); // Sem seleção: campos em branco.
		}
	}
	updating = was_updating;
	selection_buttons[SELECAO_ADICIONAR]->set_disabled(!has || (anim && anim->frames.size() >= 255));
	selection_buttons[SELECAO_SUBSTITUIR]->set_disabled(!has || !anim);
	selection_buttons[SELECAO_SEPARAR]->set_disabled(!has);
	Vector2i size, gap, count;
	(void)_grid_cells(size, gap, count);
	selection_buttons[SELECAO_GRADE]->set_disabled(!has || count.x * count.y == 0);
	grid_count->set_text(has ? vformat(U("= %d"), count.x * count.y) : String());
	grid_count->set_tooltip_text(has ? vformat(U("A faixa em grade teria %d quadros."), count.x * count.y) : String());
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
	_clear_frame_caches();
	_refresh();
	_refresh_sheets();
	_refresh_selection();
}

void RetroAnimationEditor::_apply() {
	// Arrastando: sem o sinal changed (prévias e nodes que usam o personagem refariam tudo a cada
	// movimento); ele vai uma vez ao soltar o botão.
	const bool live = _live_edit();
	applying = true;
	(void)personagem->set_data(data, !live);
	applying = false;
	const MDPersonagem::Animacao *anim = _parsed();
	current_frame = anim ? CLAMP(current_frame, 0, anim->frames.size() - 1) : 0;
	play_frame = anim ? CLAMP(play_frame, 0, anim->frames.size() - 1) : 0;
	if (!anim || range_to >= anim->frames.size()) {
		range_from = range_to = -1;
	}
	if (live) {
		// Arrastando (caixa, recorte, campo) ou nas setas: só o que acompanha a mudança. A lista e a fila, que
		// percorrem o personagem todo, ficam para quando soltar o botão.
		_refresh_fields();
		sheet_view->queue_redraw();
		preview->queue_redraw();
		refresh_due = true;
		return;
	}
	refresh_due = false;
	_refresh_list();
	_refresh_timeline();
	_refresh_fields();
	sheet_view->queue_redraw();
	preview->queue_redraw();
	_colors_later();
}

// Mudança contínua em andamento: botão do mouse apertado (arrasto) ou setas há menos de 350 ms.
bool RetroAnimationEditor::_live_edit() const {
	return Input::get_singleton()->is_mouse_button_pressed(MouseButton::LEFT) || OS::get_singleton()->get_ticks_msec() < live_until_ms;
}

void RetroAnimationEditor::_clear_frame_caches() {
	cost_cache.clear();
	signature_cache.clear();
	thumb_cache.clear();
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
	if (Variant(after) == Variant(p_before)) { // Comparação profunda, sem gerar o JSON inteiro.
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
	range_from = range_to = -1;
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

void RetroAnimationEditor::_set_frame_rect(int p_frame, const Rect2i &p_rect, const Vector2i &p_anchor) {
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
	const Vector2i anchor = p_anchor.x >= 0 || p_anchor.y >= 0 ? p_anchor : Vector2i(f.get("anchorX", p_rect.size.x / 2), f.get("anchorY", p_rect.size.y));
	f["anchorX"] = CLAMP(anchor.x, 0, p_rect.size.x);
	f["anchorY"] = CLAMP(anchor.y, 0, p_rect.size.y);
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
	} else if (p_kind == 3) {
		Dictionary hurt = data.get("hurtBox", Dictionary());
		for (const Variant &key : rect.keys()) {
			hurt[key] = rect[key];
		}
		hurt["custom"] = true;
		data["hurtBox"] = hurt;
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
	if ((key->is_ctrl_pressed() || key->is_meta_pressed()) && code == Key::S && window && get_window() == window) {
		// Na janela separada os atalhos do editor não chegam: Ctrl+S grava o personagem aqui.
		get_viewport()->set_input_as_handled();
		_save();
		return;
	}
	if (key->is_ctrl_pressed() || key->is_meta_pressed()) {
		// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: o histórico do gestor (o campo de texto em foco tem o seu).
		if (code == Key::F && !key->is_shift_pressed()) {
			const Control *focus = get_viewport()->gui_get_focus_owner();
			if (!focus || is_ancestor_of(focus)) {
				get_viewport()->set_input_as_handled();
				anim_filter->grab_focus();
				anim_filter->select_all();
				return;
			}
		}
		if ((code == Key::C || code == Key::X || code == Key::V) && !key->is_shift_pressed()) {
			const Control *focus = get_viewport()->gui_get_focus_owner();
			if (!focus || (is_ancestor_of(focus) && !Object::cast_to<LineEdit>(focus))) {
				get_viewport()->set_input_as_handled();
				if (code == Key::V) {
					_paste_frames();
				} else {
					_copy_frames(code == Key::X);
				}
				return;
			}
		}
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
	if (code == Key::SPACE || code == Key::COMMA || code == Key::PERIOD) {
		// Espaço toca/pausa; vírgula e ponto: quadro anterior e seguinte.
		const Control *focus = get_viewport()->gui_get_focus_owner();
		if (key->is_echo() && code == Key::SPACE) {
			return;
		}
		if (focus && (Object::cast_to<LineEdit>(focus) || !is_ancestor_of(focus))) {
			return;
		}
		get_viewport()->set_input_as_handled();
		if (code == Key::SPACE) {
			_toggle_play();
		} else {
			_step_frame(code == Key::COMMA ? -1 : 1);
		}
		return;
	}
	const Vector2i delta = code == Key::LEFT ? Vector2i(-1, 0) : code == Key::RIGHT ? Vector2i(1, 0) : code == Key::UP ? Vector2i(0, -1) : code == Key::DOWN ? Vector2i(0, 1) : Vector2i();
	if (code == Key::ESCAPE && key_target == TECLADO_FOLHA && has_measure) {
		const Control *focus = get_viewport()->gui_get_focus_owner();
		if (!focus || is_ancestor_of(focus)) {
			get_viewport()->set_input_as_handled();
			has_measure = false;
			_refresh_measure();
			sheet_view->queue_redraw();
			return;
		}
	}
	if (delta == Vector2i() && !(code == Key::ESCAPE && key_target == TECLADO_FOLHA && selection.has_area())) {
		return;
	}
	const Control *focus = get_viewport()->gui_get_focus_owner();
	if (focus && (Object::cast_to<LineEdit>(focus) || !is_ancestor_of(focus))) {
		return; // Digitando num campo, ou o foco está em outro painel do editor.
	}
	get_viewport()->set_input_as_handled();
	// Setas (e a tecla segurada): como um arrasto, a lista e a fila esperam uma pausa nas teclas.
	live_until_ms = OS::get_singleton()->get_ticks_msec() + 350;
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
	// Este quadro, o trecho escolhido na fila ou a animação inteira.
	int from = current_frame, to = current_frame;
	if (nudge_scope->get_selected() == 1) {
		_frame_range(from, to);
	} else if (nudge_scope->get_selected() == 2) {
		from = 0;
		to = anim->frames.size() - 1;
	}
	Vector<Vector2i> offsets;
	for (int i = from; i <= to; i++) {
		offsets.push_back((anim->frames[i].offset + p_delta).clampi(-128, 128));
	}
	const Array frames = _ensure_free(a);
	for (int i = from; i <= to; i++) {
		Dictionary f = frames[i];
		const Vector2i offset = offsets[i - from];
		for (int axis = 0; axis < 2; axis++) {
			const String key = axis ? "offsetY" : "offsetX";
			if (offset[axis]) {
				f[key] = offset[axis];
			} else {
				f.erase(key);
			}
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

bool RetroAnimationEditor::_onion() const {
	return reference_option->get_selected() >= 0 && Vector2i(reference_option->get_item_metadata(reference_option->get_selected())).x == 5;
}

void RetroAnimationEditor::_refresh_references() {
	Vector2i previous(1, -1);
	if (reference_option->get_selected() >= 0) {
		previous = reference_option->get_item_metadata(reference_option->get_selected());
	}
	reference_option->clear();
	const char *names[] = { "Sem referência", "Quadro anterior", "Quadro seguinte", "Primeiro quadro", "Anterior e seguinte (cores)" };
	const int kinds[] = { 0, 1, 2, 3, 5 };
	for (int i = 0; i < 5; i++) {
		reference_option->add_item(U(names[i]));
		reference_option->set_item_metadata(-1, Vector2i(kinds[i], -1));
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
	character_menu->set_disabled(!has);
	if (!has) {
		title->set_text(U("Animações"));
		info->set_text(String());
		return;
	}
	const bool changed = has_unsaved_changes();
	title->set_text(personagem->get_character_name() + (changed ? " *" : ""));
	const MDPersonagem::Celula cell = personagem->get_cell();
	_scan_repeats();
	int most_tiles = 0, heavy = 0;
	for (const MDPersonagem::Animacao &anim : personagem->get_animations()) {
		for (const MDPersonagem::Quadro &q : anim.frames) {
			const MDPersonagem::Custo cost = _cost(q);
			most_tiles = MAX(most_tiles, cost.tiles);
			heavy += (cost.sprites > 16 || cost.linha_sprites > 10 || cost.linha_px > 160) ? 1 : 0; // Os avisos de _cost_problems.
		}
	}
	info->set_text(vformat(U("%s · %d animações · célula %d×%d (pés em %d, %d) · VRAM: ≈ %d tiles por sprite%s"), personagem->get_path().get_file(), personagem->get_animations().size(), cell.size.x, cell.size.y, cell.anchor.x, cell.anchor.y, most_tiles,
			(heavy ? vformat(U(" · ⚠ %d quadros pesados"), heavy) : String()) + (repeats_mirror ? vformat(U(" · %d espelhados"), repeats_mirror) : String())));
	info->set_tooltip_text(U("Com todas as animações: cada sprite deste personagem na tela reserva na VRAM os tiles do maior quadro (as cenas que usam só algumas animações gastam menos). Quadros pesados passam de 16 sprites de hardware ou pesam demais numa linha da tela."));
	updating = true;
	const Array list = _animations();
	anim_list->clear();
	const String filter = anim_filter->get_text().strip_edges();
	for (int i = 0; i < list.size(); i++) {
		const Dictionary a = list[i];
		if (!filter.is_empty() && String(a.get("name", "")).findn(filter) < 0 && i != current_anim) {
			continue;
		}
		int count = 0;
		for (const MDPersonagem::Animacao &parsed : personagem->get_animations()) {
			if (parsed.index == i) {
				count = parsed.frames.size();
			}
		}
		const bool free = a.get("frames", Variant()).get_type() == Variant::ARRAY;
		anim_list->add_item(vformat("%s (%d)", a.get("name", ""), count));
		anim_list->set_item_metadata(-1, i);
		anim_list->set_item_tooltip(-1, vformat(U("%s: %d quadros, %s"), a.get("name", ""), count, free ? U("quadros livres") : U("faixa em grade")));
	}
	for (int item = 0; item < anim_list->get_item_count(); item++) {
		if (int(anim_list->get_item_metadata(item)) == current_anim) {
			anim_list->select(item);
			anim_list->ensure_current_is_visible();
		}
	}
	_refresh_references();
	updating = false;
}

void RetroAnimationEditor::_refresh_timeline() {
	updating = true;
	timeline->clear();
	const MDPersonagem::Animacao *anim = _parsed();
	for (int i = 0; anim && i < anim->frames.size(); i++) {
		const MDPersonagem::Quadro &q = anim->frames[i];
		const Ref<Texture2D> sheet = _sheet(q.source);
		Ref<Texture2D> thumb;
		const uint64_t thumb_key = frame_key(q, { 3 });
		if (const Ref<Texture2D> *found = thumb_cache.getptr(thumb_key)) {
			thumb = *found;
		} else if (sheet.is_valid()) {
			const Ref<Image> image = _sheet_image(q.source);
			const Rect2i rect = image.is_valid() ? q.rect.intersection(Rect2i(Vector2i(), image->get_size())) : Rect2i();
			if (rect.size.x > 0 && rect.size.y > 0) {
				Ref<Image> part = image->get_region(rect);
				const float scale = MIN(64.0f * EDSCALE / rect.size.x, 64.0f * EDSCALE / rect.size.y);
				part->resize(MAX(1, int(rect.size.x * scale)), MAX(1, int(rect.size.y * scale)), Image::INTERPOLATE_NEAREST);
				thumb = ImageTexture::create_from_image(part);
				thumb_cache[thumb_key] = thumb;
			}
		}
		const bool strike = anim->attack && i >= anim->attack_first && i <= anim->attack_last;
		timeline->add_item(vformat("%d  %d/60%s%s%s", i + 1, q.ticks, strike ? U("  ◆") : "", q.sound.is_empty() ? "" : U("  ♪"), q.event.is_empty() ? "" : U("  ⚑")), thumb);
		const MDPersonagem::Custo cost = _cost(q);
		const String problems = _cost_problems(cost);
		const String repeat = _repeat_text(i);
		timeline->set_item_tooltip(-1, vformat(U("Quadro %d · ≈ %d tiles · %d sprites%s%s%s"), i + 1, cost.tiles, cost.sprites, q.event.is_empty() ? String() : U(" · evento ") + q.event, problems.is_empty() ? String() : "\n" + problems, repeat.is_empty() ? String() : "\n" + repeat));
		if (repeats.has(Vector2i(current_anim, i))) {
			timeline->set_item_text(-1, timeline->get_item_text(timeline->get_item_count() - 1) + (repeats[Vector2i(current_anim, i)].x == 1 ? U("  =") : U("  ⇋")));
		}
		if (!problems.is_empty()) {
			timeline->set_item_custom_fg_color(-1, Color(1, 0.55, 0.45));
		}
	}
	if (anim && current_frame < anim->frames.size()) {
		timeline->select(current_frame);
		for (int i = range_from; i >= 0 && i <= range_to && i < anim->frames.size(); i++) {
			timeline->select(i, false);
		}
		timeline->set_current(current_frame);
		timeline->ensure_current_is_visible();
	}
	updating = false;
	_refresh_repeat();
	rhythm->queue_redraw();
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
		anim->attack_first + 1, anim->attack_last + 1,
		personagem->get_hurt_box().position.x, personagem->get_hurt_box().position.y, personagem->get_hurt_box().size.x, personagem->get_hurt_box().size.y
	};
	offset_label->set_text(vformat("%d, %d", q.offset.x, q.offset.y));
	{
		const MDPersonagem::Custo cost = _cost(q);
		const String problems = _cost_problems(cost);
		const String repeat = _repeat_text(current_frame);
		cost_label->set_text(vformat(U("≈ %d tiles · %d sprites de hardware · numa linha: até %d sprites e %d px"), cost.tiles, cost.sprites, cost.linha_sprites, cost.linha_px) + (problems.is_empty() ? String() : "\n" + problems) + (repeat.is_empty() ? String() : "\n" + repeat));
		cost_label->add_theme_color_override(SceneStringName(font_color), problems.is_empty() ? Color(0.7, 0.85, 0.75) : Color(1, 0.6, 0.5));
	}
	int sound_index = q.sound.is_empty() ? 0 : sound_files.find(q.sound) + 1;
	if (sound_index <= 0 && !q.sound.is_empty()) {
		// Som fora da lista (arquivo apagado ou ainda não visto): aparece no fim para não sumir.
		sound_files.push_back(q.sound);
		sound_option->add_item(q.sound.get_file() + U(" (não encontrado)"));
		sound_index = sound_files.size();
	}
	sound_option->select(sound_index);
	sound_listen->set_disabled(q.sound.is_empty());
	if (!event_edit->has_focus()) {
		event_edit->set_text(q.event);
	}
	{
		// Os nomes já usados no personagem, para repetir igual nos outros quadros.
		PackedStringArray names;
		for (const MDPersonagem::Animacao &other : personagem->get_animations()) {
			for (const MDPersonagem::Quadro &frame : other.frames) {
				if (!frame.event.is_empty() && !names.has(frame.event)) {
					names.push_back(frame.event);
				}
			}
		}
		event_edit->set_tooltip_text(U("Nome de um evento que o código do MDAtor lê quando este quadro entra: quadro_evento(eu) == EVENTO_<NOME>. Ex.: soltar_tiro no quadro em que a mão abre, pode_cancelar no fim do golpe. Vazio = nenhum.") + (names.is_empty() ? String() : U("\nUsados neste personagem: ") + String(", ").join(names)));
	}
	fields[CAMPO_APOIO_X]->set_max(q.rect.size.x);
	fields[CAMPO_APOIO_Y]->set_max(q.rect.size.y);
	for (int i = 0; i < CAMPO_MAX; i++) {
		fields[i]->set_value(values[i]);
	}
	for (int i = CAMPO_ATAQUE_X; i <= CAMPO_ATAQUE_ATE; i++) {
		fields[i]->set_editable(anim->attack);
	}
	hurt_check->set_pressed(personagem->has_custom_hurt_box());
	for (int i = CAMPO_DANO_X; i <= CAMPO_DANO_A; i++) {
		fields[i]->set_editable(personagem->has_custom_hurt_box());
	}
	updating = false;
}

void RetroAnimationEditor::_anim_selected(int p_index) {
	if (updating) {
		return;
	}
	current_anim = anim_list->get_item_metadata(p_index);
	current_frame = 0;
	range_from = range_to = -1;
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
	if (p_index < range_from || p_index > range_to) {
		range_from = range_to = -1;
	}
	const MDPersonagem::Animacao *anim = _parsed();
	if (anim && p_index < anim->frames.size() && anim->frames[p_index].source != _shown_sheet()) {
		shown_source = String();
		_refresh_sheets();
		static_cast<RetroSheetView *>(sheet_view)->focus();
	}
	if (timeline->get_item_count() > p_index && (!timeline->is_selected(p_index) || (range_from < 0 && timeline->get_selected_items().size() > 1))) {
		updating = true;
		timeline->select(p_index);
		updating = false;
	}
	_refresh_fields();
	_refresh_repeat();
	rhythm->queue_redraw();
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

void RetroAnimationEditor::_hurt_toggled(bool p_on) {
	if (updating || personagem.is_null()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	Dictionary hurt = data.get("hurtBox", Dictionary());
	if (!hurt.has("width") || int(hurt.get("width", 0)) <= 0) {
		hurt = rect_dict(personagem->get_body_box()); // Começa igual ao corpo.
	}
	hurt["custom"] = p_on;
	data["hurtBox"] = hurt;
	_apply();
	_commit(U("Caixa de dano própria"), before);
}

void RetroAnimationEditor::_boxes_toggled(bool p_on) {
	show_boxes = p_on;
	preview->queue_redraw();
}

// O quadro em edição passa a acertar golpe: liga o ataque (só este quadro) ou estende o trecho.
void RetroAnimationEditor::_strike_here() {
	const MDPersonagem::Animacao *anim = _parsed();
	if (!anim || anim->frames.is_empty()) {
		return;
	}
	if (anim->attack && current_frame >= anim->attack_first && current_frame <= anim->attack_last) {
		EditorToaster::get_singleton()->popup_str(U("Este quadro já está no golpe. Ajuste a caixa vermelha na prévia."));
		return;
	}
	Dictionary before;
	_before_edit(before);
	Dictionary a = _anim();
	Dictionary attack = a.get("attack", Dictionary());
	if (!attack.has("width") || int(attack.get("width", 0)) <= 0) {
		// Caixa nova na frente do corpo, na altura do meio.
		const Rect2i body = personagem->get_body_box();
		attack = rect_dict(Rect2i(body.get_end().x, body.position.y + body.size.y / 4, MAX(8, body.size.x), MAX(8, body.size.y / 2)));
	}
	if (!anim->attack) {
		attack["firstFrame"] = current_frame;
		attack["lastFrame"] = current_frame;
	} else {
		attack["firstFrame"] = MIN(anim->attack_first, current_frame);
		attack["lastFrame"] = MAX(anim->attack_last, current_frame);
	}
	attack["enabled"] = true;
	a["attack"] = attack;
	_apply();
	_commit(U("Golpe neste quadro"), before);
}

void RetroAnimationEditor::_hurt_from_body() {
	if (personagem.is_null()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	_set_box(3, personagem->get_body_box());
	_commit(U("Caixa de dano igual ao corpo"), before);
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
		case CAMPO_DANO_X:
		case CAMPO_DANO_Y:
		case CAMPO_DANO_L:
		case CAMPO_DANO_A: {
			Rect2i box = personagem->get_hurt_box();
			const int index = p_field - CAMPO_DANO_X;
			(index < 2 ? box.position : box.size)[index % 2] = v;
			_set_box(3, box);
			return _commit(U("Caixa de dano"), before, true);
		}
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
	rhythm->queue_redraw();
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
	_clear_frame_caches();
	shown_source = String();
	selection = Rect2i();
	current_anim = -1;
	current_frame = 0;
	range_from = range_to = -1;
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
	_load_scenery();
	color_overlays.clear();
	if (colors_button->is_pressed()) {
		_analyze_colors();
	}
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
			if (refresh_due && !_live_edit() && personagem.is_valid()) {
				refresh_due = false;
				applying = true;
				personagem->emit_changed();
				applying = false;
				_refresh_list();
				_refresh_timeline();
				_refresh_fields();
				_colors_later();
			}
			if (colors_due >= 0 && OS::get_singleton()->get_ticks_msec() / 1000.0 >= colors_due) {
				_analyze_colors();
			}
			// Tempo do console: 60 quadros de vídeo por segundo (NTSC).
			const MDPersonagem::Animacao *anim = _parsed();
			if (!playing || !anim || anim->frames.is_empty()) {
				break;
			}
			play_ticks += get_process_delta_time() * 60.0 * _speed();
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
			rhythm->queue_redraw();
			if (scenery.is_valid() && walk_field->get_value() > 0) {
				scenery_scroll += get_process_delta_time() * walk_field->get_value() * _speed();
				preview->queue_redraw();
			}
			if (changed) {
				preview->queue_redraw();
				_play_sound(anim->frames[play_frame].sound);
			}
		} break;
	}
}

// Os .wav do projeto (fora de .retro-studio e das pastas geradas pelo build).
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

// Assinatura do desenho do quadro (recortado aos pixels visíveis), ou do desenho espelhado.
uint64_t RetroAnimationEditor::_frame_signature(const MDPersonagem::Quadro &p_frame, bool p_mirrored) {
	// Guardada por folha + recorte: depende só dos pixels (a lista de animações a pede para todos os quadros).
	const uint64_t key = frame_key(p_frame, { int(p_mirrored), 1 });
	if (const uint64_t *found = signature_cache.getptr(key)) {
		return *found;
	}
	const uint64_t signature = _frame_signature_uncached(p_frame, p_mirrored);
	signature_cache[key] = signature;
	return signature;
}

uint64_t RetroAnimationEditor::_frame_signature_uncached(const MDPersonagem::Quadro &p_frame, bool p_mirrored) {
	const Ref<Image> sheet = _sheet_image(p_frame.source);
	if (sheet.is_null()) {
		return 0;
	}
	const Rect2i rect = p_frame.rect.intersection(Rect2i(Vector2i(), sheet->get_size()));
	const int width = sheet->get_width();
	const uint8_t *pixels = sheet->ptr();
	int x0 = rect.get_end().x, y0 = rect.get_end().y, x1 = -1, y1 = -1;
	for (int y = rect.position.y; y < rect.get_end().y; y++) {
		for (int x = rect.position.x; x < rect.get_end().x; x++) {
			if (pixels[(y * width + x) * 4 + 3] >= 128) {
				x0 = MIN(x0, x);
				y0 = MIN(y0, y);
				x1 = MAX(x1, x);
				y1 = MAX(y1, y);
			}
		}
	}
	if (x1 < 0) {
		return 0;
	}
	uint32_t hash = hash_murmur3_one_32(uint32_t((x1 - x0) << 16 | (y1 - y0)));
	for (int y = y0; y <= y1; y++) {
		for (int i = 0; i <= x1 - x0; i++) {
			const int x = p_mirrored ? x1 - i : x0 + i;
			const uint8_t *p = pixels + (y * width + x) * 4;
			// Pixel vazio conta como vazio, qualquer que seja a cor guardada nele.
			const uint32_t value = p[3] >= 128 ? (uint32_t(p[0]) << 16 | uint32_t(p[1]) << 8 | p[2]) | 0x1000000 : 0;
			hash = hash_murmur3_one_32(value, hash);
		}
	}
	return (uint64_t(hash_fmix32(hash)) << 32) | uint32_t((x1 - x0 + 1) * (y1 - y0 + 1));
}

// Quadros com o mesmo desenho de um quadro anterior (igual ou espelhado), no personagem todo.
void RetroAnimationEditor::_scan_repeats() {
	repeats.clear();
	repeats_equal = repeats_mirror = 0;
	if (personagem.is_null()) {
		return;
	}
	HashMap<uint64_t, Vector2i> first;
	for (const MDPersonagem::Animacao &anim : personagem->get_animations()) {
		for (int f = 0; f < anim.frames.size(); f++) {
			const Vector2i here(anim.index, f);
			const uint64_t normal = _frame_signature(anim.frames[f], false);
			if (!normal) {
				continue;
			}
			if (first.has(normal)) {
				const Vector2i other = first[normal];
				repeats[here] = Vector3i(1, other.x, other.y);
				repeats_equal++;
				continue;
			}
			const uint64_t mirrored = _frame_signature(anim.frames[f], true);
			if (mirrored != normal && first.has(mirrored)) {
				const Vector2i other = first[mirrored];
				repeats[here] = Vector3i(2, other.x, other.y);
				repeats_mirror++;
			}
			first[normal] = here;
		}
	}
}

String RetroAnimationEditor::_repeat_text(int p_frame) const {
	const Vector2i here(current_anim, p_frame);
	if (!repeats.has(here)) {
		return String();
	}
	const Vector3i other = repeats[here];
	String name;
	for (const MDPersonagem::Animacao &anim : personagem->get_animations()) {
		if (anim.index == other.y) {
			name = anim.name;
		}
	}
	if (other.x == 1) {
		return vformat(U("= Mesmo desenho do quadro %d de %s: o build guarda os tiles uma vez só (não gasta ROM a mais)."), other.z + 1, name);
	}
	return vformat(U("⇋ Espelho do quadro %d de %s: ocupa a ROM de novo. Dá para mostrar aquele quadro virado (direção do ator) e tirar este."), other.z + 1, name);
}

MDPersonagem::Custo RetroAnimationEditor::_cost(const MDPersonagem::Quadro &p_frame) {
	// Guardado por folha, recorte, pés, ajuste fino e célula (o que muda o desenho dentro da célula).
	const MDPersonagem::Celula cell = personagem->get_cell();
	const uint64_t key = frame_key(p_frame, { p_frame.anchor.x, p_frame.anchor.y, p_frame.offset.x, p_frame.offset.y, cell.size.x, cell.size.y, cell.anchor.x, cell.anchor.y, 2 });
	if (const MDPersonagem::Custo *found = cost_cache.getptr(key)) {
		return *found;
	}
	const MDPersonagem::Custo cost = MDPersonagem::frame_cost(_sheet_image(p_frame.source), p_frame, cell);
	cost_cache[key] = cost;
	return cost;
}

// Avisos do custo de um quadro (vazio se está tudo bem).
String RetroAnimationEditor::_cost_problems(const MDPersonagem::Custo &p_cost) {
	PackedStringArray problems;
	if (p_cost.sprites > 16) {
		problems.push_back(vformat(U("⚠ %d sprites de hardware: o SGDK aceita 16 por quadro."), p_cost.sprites));
	}
	if (p_cost.linha_sprites > 10) {
		problems.push_back(vformat(U("⚠ %d sprites numa linha: mais da metade das 20 que o VDP mostra (os outros sprites na mesma altura podem sumir)."), p_cost.linha_sprites));
	}
	if (p_cost.linha_px > 160) {
		problems.push_back(vformat(U("⚠ %d px de sprite numa linha: mais da metade dos 320 que o VDP mostra."), p_cost.linha_px));
	}
	return String("\n").join(problems);
}

// ---- Fundo de visualização ----

void RetroAnimationEditor::_background_changed() {
	EditorSettings::get_singleton()->set_project_metadata(META_ANIMACOES, "fundo_cor", background_picker->get_pick_color());
	EditorSettings::get_singleton()->set_project_metadata(META_ANIMACOES, "fundo_xadrez", checker_button->is_pressed());
	EditorSettings::get_singleton()->save_project_metadata();
	_show_background();
}

void RetroAnimationEditor::_show_background() {
	sheet_view->queue_redraw();
	preview->queue_redraw();
	// A fila de quadros também: as miniaturas sobre a mesma cor.
	Ref<StyleBoxFlat> panel;
	panel.instantiate();
	panel->set_bg_color(background_picker->get_pick_color());
	panel->set_content_margin_all(4 * EDSCALE);
	timeline->add_theme_style_override(SceneStringName(panel), panel);
}

// Cor lisa ou xadrez (quadrados de p_square px na tela), só na parte de p_area que aparece.
void RetroAnimationEditor::_draw_background(CanvasItem *p_canvas, const Rect2 &p_area, float p_square, const Rect2 &p_visible) const {
	const Color color = background_picker ? background_picker->get_pick_color() : Color(0.2, 0.2, 0.24);
	const Rect2 area = p_area.intersection(p_visible);
	if (!area.has_area()) {
		return;
	}
	p_canvas->draw_rect(area, color);
	if (!checker_button || !checker_button->is_pressed() || p_square < 2) {
		return;
	}
	// Tom alternado: mais claro numa cor escura, mais escuro numa clara.
	const Color other = color.get_luminance() < 0.5 ? color.lightened(0.18) : color.darkened(0.15);
	const int first_x = int(Math::floor((area.position.x - p_area.position.x) / p_square));
	const int first_y = int(Math::floor((area.position.y - p_area.position.y) / p_square));
	for (int j = first_y; p_area.position.y + j * p_square < area.get_end().y; j++) {
		for (int i = first_x; p_area.position.x + i * p_square < area.get_end().x; i++) {
			if ((i + j) & 1) {
				const Rect2 square(p_area.position + Vector2(i, j) * p_square, Vector2(p_square, p_square));
				p_canvas->draw_rect(square.intersection(area), other);
			}
		}
	}
}

// ---- Cenário da prévia ----

void RetroAnimationEditor::_load_scenery() {
	scenery = Ref<Texture2D>();
	scenery_scroll = 0;
	const Dictionary all = personagem.is_valid() ? Dictionary(EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "cenarios", Dictionary())) : Dictionary();
	const Dictionary entry = personagem.is_valid() ? Dictionary(all.get(personagem->get_path(), Dictionary())) : Dictionary();
	scenery_path = entry.get("png", "");
	const Ref<Image> image = scenery_path.is_empty() ? Ref<Image>() : MDPersonagem::load_sheet(scenery_path);
	if (image.is_valid()) {
		scenery = ImageTexture::create_from_image(image);
	}
	updating = true;
	ground_field->set_max(MAX(1, image.is_valid() ? image->get_height() : 4096));
	ground_field->set_value(entry.get("chao", image.is_valid() ? image->get_height() : 0));
	walk_field->set_value(entry.get("andar", 0));
	updating = false;
	scenery_button->set_text(scenery.is_valid() ? scenery_path.get_file() : U("Escolher PNG…"));
	scenery_clear->set_visible(scenery.is_valid());
	ground_field->set_editable(scenery.is_valid());
	walk_field->set_editable(scenery.is_valid());
	preview->queue_redraw();
}

void RetroAnimationEditor::_scenery_changed(double p_value) {
	if (updating || personagem.is_null()) {
		return;
	}
	Dictionary all = EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "cenarios", Dictionary());
	if (scenery_path.is_empty()) {
		all.erase(personagem->get_path());
	} else {
		Dictionary entry;
		entry["png"] = scenery_path;
		entry["chao"] = int(ground_field->get_value());
		entry["andar"] = int(walk_field->get_value());
		all[personagem->get_path()] = entry;
	}
	EditorSettings::get_singleton()->set_project_metadata(META_ANIMACOES, "cenarios", all);
	preview->queue_redraw();
}

void RetroAnimationEditor::_scenery_chosen(const String &p_path) {
	if (personagem.is_null()) {
		return;
	}
	const Ref<Image> image = MDPersonagem::load_sheet(p_path);
	if (image.is_null()) {
		EditorToaster::get_singleton()->popup_str(U("Não foi possível ler ") + p_path, EditorToaster::SEVERITY_WARNING);
		return;
	}
	scenery_path = p_path;
	updating = true;
	ground_field->set_max(image->get_height());
	ground_field->set_value(image->get_height()); // Começa com o chão embaixo do PNG.
	updating = false;
	_scenery_changed(0);
	_load_scenery();
}

void RetroAnimationEditor::_scenery_cleared() {
	scenery_path = String();
	_scenery_changed(0);
	_load_scenery();
}

// ---- Cores ----

String RetroAnimationEditor::_palette_png() const {
	if (personagem.is_null()) {
		return String();
	}
	const Dictionary all = EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "paletas", Dictionary());
	return all.get(personagem->get_path(), String());
}

void RetroAnimationEditor::_colors_toggled(bool p_on) {
	palette_menu->set_visible(p_on);
	swatches->set_visible(p_on);
	colors_label->set_visible(p_on);
	if (p_on) {
		_analyze_colors();
	}
	sheet_view->queue_redraw();
}

void RetroAnimationEditor::_palette_menu(int p_id) {
	if (p_id == 1) {
		palette_dialog->popup_file_dialog();
		return;
	}
	_palette_chosen(String());
}

// Paleta para comparar, por personagem (configurações do projeto no editor; não muda o jogo).
void RetroAnimationEditor::_palette_chosen(const String &p_path) {
	if (personagem.is_null()) {
		return;
	}
	if (!p_path.is_empty() && RetroMD::png_palette(p_path).is_empty()) {
		EditorToaster::get_singleton()->popup_str(U("Esse PNG não é indexado (sem paleta). Converta-o para o Mega Drive antes."), EditorToaster::SEVERITY_WARNING);
		return;
	}
	Dictionary all = EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "paletas", Dictionary());
	if (p_path.is_empty()) {
		all.erase(personagem->get_path());
	} else {
		all[personagem->get_path()] = p_path;
	}
	EditorSettings::get_singleton()->set_project_metadata(META_ANIMACOES, "paletas", all);
	_analyze_colors();
}

void RetroAnimationEditor::_colors_later() {
	if (colors_button && colors_button->is_pressed()) {
		colors_due = OS::get_singleton()->get_ticks_msec() / 1000.0 + 0.6; // Depois de uma pausa nas mudanças.
	}
}

void RetroAnimationEditor::_analyze_colors() {
	colors_due = -1;
	color_overlays.clear();
	for (int i = swatches->get_child_count() - 1; i >= 0; i--) {
		Node *child = swatches->get_child(i);
		swatches->remove_child(child);
		memdelete(child);
	}
	if (personagem.is_null() || !colors_button->is_pressed()) {
		return;
	}
	String problem;
	const Ref<Image> atlas = personagem->build_atlas(&problem);
	if (atlas.is_null()) {
		colors_label->set_text(problem);
		return;
	}
	auto level = [](float p_channel) { return CLAMP(int(Math::round(p_channel * 7.0f)), 0, 7); };
	auto key_of = [&](const Color &p_color) { return level(p_color.r) << 6 | level(p_color.g) << 3 | level(p_color.b); };
	const String palette_png = _palette_png();
	const Vector<Color> reference = palette_png.is_empty() ? Vector<Color>() : RetroMD::png_palette(palette_png);
	// Cor final de cada cor da grade do console, como o build: a mais próxima da paleta.
	HashMap<int, int> final_key;
	Vector<Color> palette;
	int colors = 0;
	if (!reference.is_empty()) {
		palette = reference;
		HashSet<int> seen;
		for (int y = 0; y < atlas->get_height(); y++) {
			for (int x = 0; x < atlas->get_width(); x++) {
				const Color pixel = atlas->get_pixel(x, y);
				if (pixel.a < 0.5) {
					continue;
				}
				const int key = key_of(pixel);
				seen.insert(key);
				if (final_key.has(key)) {
					continue;
				}
				float best = 1e9;
				int index = 1;
				for (int i = 1; i < MIN(16, reference.size()); i++) {
					const Color c = reference[i];
					const float d = (c.r - pixel.r) * (c.r - pixel.r) + (c.g - pixel.g) * (c.g - pixel.g) + (c.b - pixel.b) * (c.b - pixel.b);
					if (d < best) {
						best = d;
						index = i;
					}
				}
				final_key[key] = key_of(reference[index]);
			}
		}
		colors = seen.size();
	} else {
		Vector<uint8_t> indices;
		colors = RetroImageConvert::quantize(atlas, indices, palette);
		for (int y = 0; y < atlas->get_height(); y++) {
			for (int x = 0; x < atlas->get_width(); x++) {
				const uint8_t index = indices[y * atlas->get_width() + x];
				if (index) {
					final_key[key_of(atlas->get_pixel(x, y))] = key_of(palette[index]);
				}
			}
		}
	}
	int changed_colors = 0;
	for (const KeyValue<int, int> &E : final_key) {
		changed_colors += E.key != E.value ? 1 : 0;
	}
	// Pixels que mudam, nos recortes de cada folha.
	int changed_pixels = 0;
	HashMap<String, Ref<Image>> overlays;
	for (const MDPersonagem::Animacao &anim : personagem->get_animations()) {
		for (const MDPersonagem::Quadro &q : anim.frames) {
			const Ref<Image> sheet = _sheet_image(q.source);
			if (sheet.is_null()) {
				continue;
			}
			if (!overlays.has(q.source)) {
				overlays[q.source] = Image::create_empty(sheet->get_width(), sheet->get_height(), false, Image::FORMAT_RGBA8);
			}
			Ref<Image> overlay = overlays[q.source];
			const Rect2i rect = q.rect.intersection(Rect2i(Vector2i(), sheet->get_size()));
			for (int y = rect.position.y; y < rect.get_end().y; y++) {
				for (int x = rect.position.x; x < rect.get_end().x; x++) {
					const Color pixel = sheet->get_pixel(x, y);
					if (pixel.a < 0.5) {
						continue;
					}
					const int key = key_of(pixel);
					if (final_key.has(key) && final_key[key] != key && overlay->get_pixel(x, y).a == 0) {
						overlay->set_pixel(x, y, Color(1, 0, 1, 0.85));
						changed_pixels++;
					}
				}
			}
		}
	}
	for (const KeyValue<String, Ref<Image>> &E : overlays) {
		color_overlays[E.key] = ImageTexture::create_from_image(E.value);
	}
	// As cores que ficam.
	for (int i = 1; i < palette.size() && i < 16; i++) {
		ColorRect *swatch = memnew(ColorRect);
		swatch->set_color(palette[i]);
		swatch->set_custom_minimum_size(Size2(6, 18) * EDSCALE);
		swatch->set_tooltip_text(vformat(U("Cor %d: %s"), i, palette[i].to_html(false)));
		swatches->add_child(swatch);
	}
	palette_menu->set_text(reference.is_empty() ? U("15 cores do build") : palette_png.get_file());
	String text;
	if (reference.is_empty()) {
		text = colors > 15 ? vformat(U("⚠ %d cores → 15 · %d px mudam"), colors, changed_pixels) : vformat(U("%d cores ✓"), colors);
	} else {
		text = changed_pixels ? vformat(U("⚠ %d fora da paleta · %d px mudam"), changed_colors, changed_pixels) : vformat(U("%d cores, todas na paleta ✓"), colors);
	}
	colors_label->set_text(text);
	colors_label->set_tooltip_text(text + (changed_pixels ? U(" (em magenta na folha)") : String()) + vformat(U("\nO personagem tem %d cores."), colors) + U("\nAs cores contam na grade do Mega Drive (8 níveis por canal): tons que o console não distingue viram a mesma cor."));
	colors_label->add_theme_color_override(SceneStringName(font_color), changed_pixels ? Color(1, 0.6, 0.5) : Color(0.7, 0.85, 0.75));
	sheet_view->queue_redraw();
}

void RetroAnimationEditor::_event_changed(const String &p_text) {
	const MDPersonagem::Animacao *anim = _parsed();
	Dictionary a = _anim();
	if (updating || !anim || a.is_empty() || current_frame >= anim->frames.size()) {
		return;
	}
	const String name = MDPersonagem::event_name(p_text);
	if (name == anim->frames[current_frame].event) {
		event_edit->set_text(name);
		return;
	}
	Dictionary before;
	_before_edit(before);
	const Array frames = _ensure_free(a);
	Dictionary f = frames[current_frame];
	if (name.is_empty()) {
		f.erase("event");
	} else {
		f["event"] = name;
	}
	_apply();
	_commit(U("Evento do quadro"), before);
	event_edit->set_text(name);
}

void RetroAnimationEditor::_event_focus_exited() {
	_event_changed(event_edit->get_text());
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

// ---- Prévia: zoom, velocidade, quadro a quadro ----

double RetroAnimationEditor::_speed() const {
	const double speeds[] = { 0.25, 0.5, 1, 50.0 / 60.0, 2 };
	return speeds[CLAMP(speed_option->get_selected(), 0, 4)];
}

void RetroAnimationEditor::_zoom_step(int p_direction) {
	RetroAnimationPreview *view = static_cast<RetroAnimationPreview *>(preview);
	view->set_zoom(MAX(1, view->current_scale() + p_direction));
}

void RetroAnimationEditor::_zoom_fit() {
	static_cast<RetroAnimationPreview *>(preview)->set_zoom(0);
}

void RetroAnimationEditor::_refresh_zoom_label() {
	const RetroAnimationPreview *view = static_cast<RetroAnimationPreview *>(preview);
	zoom_label->set_text(vformat(U("%d×"), view->current_scale()));
	zoom_label->set_tooltip_text(view->zoom == 0 ? U("Escala ajustada ao tamanho da prévia.") : U("Escala fixa (Ajustar volta a caber na prévia)."));
}

void RetroAnimationEditor::_flip_toggled(bool p_on) {
	static_cast<RetroAnimationPreview *>(preview)->flip = p_on;
	preview->queue_redraw();
}

void RetroAnimationEditor::_step_frame(int p_direction) {
	const MDPersonagem::Animacao *anim = _parsed();
	if (!anim || anim->frames.is_empty()) {
		return;
	}
	if (playing) {
		_toggle_play();
	}
	const int count = anim->frames.size();
	_frame_selected((current_frame + p_direction + count) % count);
}

// ---- Fila de quadros: trecho e arrastar ----

void RetroAnimationEditor::_frame_range(int &r_from, int &r_to) const {
	if (range_from >= 0 && range_to >= range_from) {
		r_from = range_from;
		r_to = range_to;
	} else {
		r_from = r_to = current_frame;
	}
}

void RetroAnimationEditor::_timeline_multi(int p_index, bool p_selected) {
	if (updating || range_pending) {
		return;
	}
	// O Shift+clique avisa quadro por quadro: lê a seleção uma vez, depois.
	range_pending = true;
	callable_mp(this, &RetroAnimationEditor::_timeline_range_update).call_deferred();
}

void RetroAnimationEditor::_timeline_range_update() {
	range_pending = false;
	const Vector<int> items = timeline->get_selected_items();
	if (items.is_empty()) {
		_refresh_timeline(); // Ctrl+clique tirou o último: volta a marcar o quadro em edição.
		return;
	}
	if (items.size() == 1) {
		range_from = range_to = -1;
		_frame_selected(items[0]);
		return;
	}
	// Trecho contínuo, do primeiro ao último marcado.
	range_from = items[0];
	range_to = items[items.size() - 1];
	const int frame = current_frame >= range_from && current_frame <= range_to ? current_frame : range_to;
	current_frame = -1; // Força a atualização em _frame_selected.
	_frame_selected(frame);
	updating = true;
	for (int i = range_from; i <= range_to; i++) {
		timeline->select(i, false);
	}
	updating = false;
	sheet_view->queue_redraw();
	_refresh_repeat();
}

Variant RetroAnimationEditor::_timeline_drag(const Point2 &p_point) {
	const int index = timeline->get_item_at_position(p_point, true);
	const MDPersonagem::Animacao *anim = _parsed();
	if (index < 0 || !anim || anim->frames.size() < 2) {
		return Variant();
	}
	Label *label = memnew(Label(vformat(U("Quadro %d"), index + 1)));
	timeline->set_drag_preview(label);
	Dictionary data_drag;
	data_drag["type"] = "retro_quadro";
	data_drag["anim"] = current_anim;
	data_drag["index"] = index;
	return data_drag;
}

bool RetroAnimationEditor::_timeline_can_drop(const Point2 &p_point, const Variant &p_data) const {
	const Dictionary d = p_data;
	return String(d.get("type", "")) == "retro_quadro" && int(d.get("anim", -2)) == current_anim;
}

void RetroAnimationEditor::_timeline_drop(const Point2 &p_point, const Variant &p_data) {
	const Dictionary d = p_data;
	const MDPersonagem::Animacao *anim = _parsed();
	Dictionary a = _anim();
	if (!anim || a.is_empty()) {
		return;
	}
	const int from = d.get("index", -1);
	const int count = anim->frames.size();
	int target = timeline->get_item_at_position(p_point);
	if (from < 0 || from >= count || target < 0) {
		return;
	}
	// Soltar na metade direita de um quadro põe depois dele.
	const Rect2 rect = timeline->get_item_rect(target);
	int dest = p_point.x > rect.get_center().x ? target + 1 : target;
	if (dest > from) {
		dest--;
	}
	dest = CLAMP(dest, 0, count - 1);
	if (dest == from) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	Array frames = _ensure_free(a);
	const Variant frame = frames[from];
	frames.remove_at(from);
	frames.insert(dest, frame);
	current_frame = dest;
	range_from = range_to = -1;
	_apply();
	_commit(U("Mover quadro"), before);
}

void RetroAnimationEditor::_refresh_repeat() {
	if (!repeat_label) {
		return;
	}
	const MDPersonagem::Animacao *anim = _parsed();
	if (!anim || anim->frames.is_empty()) {
		repeat_button->set_disabled(true);
		return;
	}
	int from, to;
	_frame_range(from, to);
	const int length = to - from + 1;
	const int added = length * (int(repeat_times->get_value()) - 1);
	const int total = anim->frames.size() + added;
	repeat_label->set_text(vformat(U("Trecho: %s · +%d quadros, total %d"), from == to ? vformat(U("quadro %d"), from + 1) : vformat(U("quadros %d–%d"), from + 1, to + 1), added, total));
	repeat_button->set_disabled(added <= 0 || total > 255);
	repeat_button->set_tooltip_text(total > 255 ? U("Passaria de 255 quadros, o limite do SGDK por animação.") : U("Põe as cópias do trecho logo depois dele."));
}

// Repete o trecho escolhido (Shift+clique na fila) até completar N vezes, logo depois dele.
void RetroAnimationEditor::_repeat_range() {
	const MDPersonagem::Animacao *anim = _parsed();
	Dictionary a = _anim();
	if (!anim || a.is_empty()) {
		return;
	}
	int from, to;
	_frame_range(from, to);
	const int length = to - from + 1;
	const int times = repeat_times->get_value();
	const int added = length * (times - 1);
	if (added <= 0 || anim->frames.size() + added > 255) {
		return;
	}
	if (anim->attack) {
		const int first = anim->attack_first, last = anim->attack_last;
		const bool inside = first >= from && last <= to;
		const bool outside = last < from || first > to;
		if (!inside && !outside) {
			EditorToaster::get_singleton()->popup_str(U("O trecho pega só parte da janela de ataque. Escolha um trecho que contenha o ataque inteiro, ou nenhum quadro dele."), EditorToaster::SEVERITY_WARNING);
			return;
		}
	}
	Dictionary before;
	_before_edit(before);
	Array frames = _ensure_free(a);
	Array block;
	for (int i = from; i <= to; i++) {
		block.push_back(Dictionary(frames[i]).duplicate(true));
	}
	for (int t = 1; t < times; t++) {
		for (int i = 0; i < length; i++) {
			frames.insert(to + 1 + (t - 1) * length + i, Dictionary(block[i]).duplicate(true));
		}
	}
	a["frameCount"] = frames.size();
	a["columns"] = frames.size();
	if (anim->attack && anim->attack_first > to) {
		// O ataque depois do trecho anda junto com os quadros.
		Dictionary attack = a.get("attack", Dictionary());
		attack["firstFrame"] = anim->attack_first + added;
		attack["lastFrame"] = anim->attack_last + added;
		a["attack"] = attack;
	}
	range_from = from;
	range_to = to + added;
	_apply();
	_commit(vformat(U("Repetir trecho %d vezes"), times), before);
	_refresh_timeline();
}

void RetroAnimationEditor::_trim_frames() {
	const MDPersonagem::Animacao *anim = _parsed();
	Dictionary a = _anim();
	if (!anim || a.is_empty() || anim->frames.is_empty()) {
		return;
	}
	int from = current_frame, to = current_frame;
	if (nudge_scope->get_selected() == 1) {
		_frame_range(from, to);
	} else if (nudge_scope->get_selected() == 2) {
		from = 0;
		to = anim->frames.size() - 1;
	}
	// Recortes aparados (lidos antes de a animação virar quadros livres).
	Vector<Rect2i> rects;
	Vector<Vector2i> anchors;
	int changed = 0;
	for (int i = from; i <= to; i++) {
		const MDPersonagem::Quadro &q = anim->frames[i];
		Rect2i rect = q.rect;
		const Ref<Image> sheet = _sheet_image(q.source);
		if (sheet.is_valid()) {
			const Rect2i inside = q.rect.intersection(Rect2i(Vector2i(), sheet->get_size()));
			const Rect2i used = inside.has_area() ? sheet->get_region(inside)->get_used_rect() : Rect2i();
			if (used.has_area()) {
				rect = Rect2i(inside.position + used.position, used.size);
			}
		}
		changed += rect != q.rect ? 1 : 0;
		rects.push_back(rect);
		anchors.push_back(q.anchor - (rect.position - q.rect.position));
	}
	if (!changed) {
		EditorToaster::get_singleton()->popup_str(U("Os recortes já estão justos no desenho."));
		return;
	}
	Dictionary before;
	_before_edit(before);
	const Array frames = _ensure_free(a);
	for (int i = from; i <= to; i++) {
		Dictionary f = frames[i];
		const Rect2i rect = rects[i - from];
		f["x"] = rect.position.x;
		f["y"] = rect.position.y;
		f["width"] = rect.size.x;
		f["height"] = rect.size.y;
		// Os pés podem ficar fora do recorte aparado (a sola transparente embaixo): o ajuste fino compensa.
		const Vector2i anchor = anchors[i - from];
		const Vector2i clamped = anchor.clamp(Vector2i(), rect.size);
		f["anchorX"] = clamped.x;
		f["anchorY"] = clamped.y;
		const Vector2i offset = Vector2i(int(f.get("offsetX", 0)), int(f.get("offsetY", 0))) + (clamped - anchor);
		for (int axis = 0; axis < 2; axis++) {
			const String key = axis ? "offsetY" : "offsetX";
			if (offset[axis]) {
				f[key] = offset[axis];
			} else {
				f.erase(key);
			}
		}
	}
	_apply();
	_commit(vformat(U("Aparar %d recortes"), changed), before);
}

// Os quadros do trecho voltam a usar a velocidade (fps) da animação, sem tempo próprio.
void RetroAnimationEditor::_use_fps() {
	const MDPersonagem::Animacao *anim = _parsed();
	Dictionary a = _anim();
	if (!anim || a.is_empty()) {
		return;
	}
	int from, to;
	_frame_range(from, to);
	Dictionary before;
	_before_edit(before);
	const Array frames = _ensure_free(a);
	for (int i = from; i <= to && i < frames.size(); i++) {
		Dictionary(frames[i]).erase("durationTicks");
	}
	_apply();
	_commit(U("Usar a velocidade da animação"), before);
}

void RetroAnimationEditor::_copy_frames(bool p_cut) {
	const MDPersonagem::Animacao *anim = _parsed();
	Dictionary a = _anim();
	if (!anim || a.is_empty() || anim->frames.is_empty()) {
		return;
	}
	int from, to;
	_frame_range(from, to);
	// Copiar lê de uma cópia: uma faixa em grade continua em grade.
	Dictionary scratch = a.duplicate(true);
	const Array copy_frames = MDPersonagem::ensure_free_frames(scratch, anim);
	frame_clipboard.clear();
	for (int i = from; i <= to && i < copy_frames.size(); i++) {
		Dictionary f = Dictionary(copy_frames[i]).duplicate(true);
		f["_folha"] = anim->frames[i].source; // Para colar em outro personagem.
		frame_clipboard.push_back(f);
	}
	if (p_cut) {
		if (to - from + 1 >= anim->frames.size()) {
			EditorToaster::get_singleton()->popup_str(U("A animação precisa de pelo menos um quadro: copiei sem recortar."), EditorToaster::SEVERITY_WARNING);
			return;
		}
		Dictionary before;
		_before_edit(before);
		Array list = _ensure_free(a);
		for (int i = to; i >= from; i--) {
			list.remove_at(i);
		}
		a["frameCount"] = list.size();
		a["columns"] = list.size();
		current_frame = MIN(from, list.size() - 1);
		range_from = range_to = -1;
		_apply();
		_commit(U("Recortar quadros"), before);
	}
	EditorToaster::get_singleton()->popup_str(vformat(p_cut ? U("%d quadros recortados.") : U("%d quadros copiados."), frame_clipboard.size()));
}

void RetroAnimationEditor::_paste_frames() {
	const MDPersonagem::Animacao *anim = _parsed();
	Dictionary a = _anim();
	if (frame_clipboard.is_empty() || !anim || a.is_empty()) {
		return;
	}
	if (anim->frames.size() + frame_clipboard.size() > 255) {
		EditorToaster::get_singleton()->popup_str(U("Passaria de 255 quadros, o limite do SGDK por animação."), EditorToaster::SEVERITY_WARNING);
		return;
	}
	Dictionary before;
	_before_edit(before);
	// Folhas que ainda não são deste personagem entram nele.
	Array sources = data.get("sources", Array());
	if (sources.is_empty() && data.has("source")) {
		Dictionary only = Dictionary(data["source"]).duplicate();
		only["id"] = "sheet-1";
		sources.push_back(only);
	}
	HashMap<String, String> ids; // Caminho res:// → id da folha neste personagem.
	for (const KeyValue<String, String> &E : personagem->get_sources()) {
		ids[E.value] = E.key;
	}
	Array frames = _ensure_free(a);
	int at = current_frame + 1;
	for (const Variant &item : frame_clipboard) {
		Dictionary f = Dictionary(item).duplicate(true);
		const String sheet = f.get("_folha", "");
		f.erase("_folha");
		if (!sheet.is_empty()) {
			if (!ids.has(sheet)) {
				String id;
				for (int n = sources.size() + 1; id.is_empty() || personagem->get_sources().has(id); n++) {
					id = "sheet-" + itos(n);
				}
				Dictionary source;
				source["id"] = id;
				source["name"] = sheet.get_file();
				source["path"] = sheet.trim_prefix("res://");
				sources.push_back(source);
				ids[sheet] = id;
			}
			f["sourceId"] = ids[sheet];
		}
		frames.insert(at++, f);
	}
	data["sources"] = sources;
	a["frameCount"] = frames.size();
	a["columns"] = frames.size();
	range_from = current_frame + 1;
	range_to = at - 1;
	current_frame = range_from;
	_apply();
	_commit(vformat(U("Colar %d quadros"), frame_clipboard.size()), before);
	_refresh_sheets();
	_refresh_timeline();
}

// A ordem é a linha da animação no atlas; os nodes escolhem a animação pelo nome.
void RetroAnimationEditor::_move_animation(int p_direction) {
	Array list = _animations();
	const int target = current_anim + p_direction;
	if (current_anim < 0 || target < 0 || target >= list.size()) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	const Variant item = list[current_anim];
	list[current_anim] = list[target];
	list[target] = item;
	current_anim = target;
	_apply();
	_commit(U("Mover animação"), before);
}

// ---- Folha: guias, medida, seleção pelos campos e bordas do recorte ----

void RetroAnimationEditor::_load_guides() {
	guides_sheet = _shown_sheet();
	guides[0].clear();
	guides[1].clear();
	const Dictionary all = EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "guias", Dictionary());
	const Dictionary entry = all.get(guides_sheet, Dictionary());
	for (int axis = 0; axis < 2; axis++) {
		for (const Variant &v : Array(entry.get(axis ? "y" : "x", Array()))) {
			guides[axis].push_back(int(v));
		}
	}
}

// Guias por folha, nas configurações do projeto no editor (não entram no .charset.json nem no jogo).
void RetroAnimationEditor::_save_guides() {
	if (guides_sheet.is_empty()) {
		return;
	}
	Dictionary all = EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "guias", Dictionary());
	if (guides[0].is_empty() && guides[1].is_empty()) {
		all.erase(guides_sheet);
	} else {
		Dictionary entry;
		for (int axis = 0; axis < 2; axis++) {
			while (guides[axis].size() > 64) {
				guides[axis].remove_at(0);
			}
			Array list;
			for (int g : guides[axis]) {
				list.push_back(g);
			}
			entry[axis ? "y" : "x"] = list;
		}
		all[guides_sheet] = entry;
	}
	EditorSettings::get_singleton()->set_project_metadata(META_ANIMACOES, "guias", all);
	EditorSettings::get_singleton()->save_project_metadata(); // Grava já: as guias não se perdem se o editor fechar mal.
}

void RetroAnimationEditor::_clear_guides() {
	guides[0].clear();
	guides[1].clear();
	_save_guides();
	sheet_view->queue_redraw();
}

void RetroAnimationEditor::_refresh_measure() {
	const Vector2i d = (measure_to - measure_from).abs();
	for (int axis = 0; axis < 2; axis++) {
		measure_gap[axis]->set_visible(has_measure && d[axis] > 0);
		measure_gap[axis]->set_text(vformat(axis ? U("Espaço Y ← %d") : U("Espaço X ← %d"), d[axis]));
	}
}

void RetroAnimationEditor::_measure_to_gap(int p_axis) {
	grid_fields[GRADE_ESPACO_X + p_axis]->set_value(Math::abs(measure_to[p_axis] - measure_from[p_axis]));
}

void RetroAnimationEditor::_measure_toggled(bool p_on) {
	if (!p_on) {
		has_measure = false;
		_refresh_measure();
	}
	sheet_view->queue_redraw();
}

void RetroAnimationEditor::_selection_field_changed(double p_value, int p_field) {
	if (updating || !selection.has_area()) {
		return;
	}
	Rect2i rect = selection;
	(p_field < 2 ? rect.position : rect.size)[p_field % 2] = int(p_value);
	Dictionary before = _state();
	_set_selection(rect, false);
	_commit(U("Seleção pelos campos"), before, true);
}

// Lados: 0 esquerda, 1 direita, 2 cima, 3 baixo. Mexer na esquerda ou em cima leva os pés junto.
void RetroAnimationEditor::_edge(int p_side, int p_amount) {
	const MDPersonagem::Animacao *anim = _parsed();
	if (!anim || current_frame >= anim->frames.size()) {
		return;
	}
	const MDPersonagem::Quadro &q = anim->frames[current_frame];
	Rect2i rect = q.rect;
	Vector2i anchor = q.anchor;
	const int axis = p_side < 2 ? 0 : 1;
	if (p_side == 0 || p_side == 2) {
		const int amount = CLAMP(p_amount, -(rect.size[axis] - 1), rect.position[axis]);
		rect.position[axis] -= amount;
		rect.size[axis] += amount;
		anchor[axis] += amount;
	} else {
		rect.size[axis] = MAX(1, rect.size[axis] + p_amount);
	}
	if (rect == q.rect) {
		return;
	}
	Dictionary before;
	_before_edit(before);
	_set_frame_rect(current_frame, rect, anchor);
	_commit(U("Borda do recorte"), before, true);
}

void RetroAnimationEditor::_edge_button(int p_code) {
	const int step = Input::get_singleton()->is_key_pressed(Key::SHIFT) ? 8 : 1;
	_edge(p_code / 2, p_code % 2 ? step : -step);
}

void RetroAnimationEditor::_filter_changed(const String &p_text) {
	_refresh_list();
}

// ---- Personagem: duplicar e excluir ----

void RetroAnimationEditor::_character_menu(int p_id) {
	if (personagem.is_null()) {
		return;
	}
	switch (p_id) {
		case 0:
			_duplicate_character();
			break;
		case 1:
			delete_dialog->set_text(vformat(U("Mandar %s para a lixeira?\n\nAs folhas (PNG) ficam. As cenas que usam este personagem ficam sem ele até você escolher outro."), personagem->get_path().get_file()));
			delete_dialog->popup_centered();
			break;
		case 2:
			EditorInterface::get_singleton()->select_file(personagem->get_path());
			break;
		case 3:
			_export_sheet_dialog();
			break;
	}
}

void RetroAnimationEditor::_export_sheet_dialog() {
	const String path = personagem->get_path();
	sheet_export_dialog->set_current_dir(ProjectSettings::get_singleton()->globalize_path(path.get_base_dir()));
	sheet_export_dialog->set_current_file(path.get_file().trim_suffix(".charset.json") + "_folha.png");
	sheet_export_dialog->popup_file_dialog();
}

// O mesmo atlas do build (células alinhadas pelos pés, uma animação por linha, na ordem da lista), com
// todas as animações e as cores da paleta escolhida em Cores (ou as 15 que o build escolhe).
void RetroAnimationEditor::_export_sheet(const String &p_path) {
	if (personagem.is_null()) {
		return;
	}
	const Vector<int> rows = personagem->all_animations();
	if (rows.is_empty()) {
		EditorToaster::get_singleton()->popup_str(U("O personagem ainda não tem animações."), EditorToaster::SEVERITY_WARNING);
		return;
	}
	String problem;
	const Ref<Image> atlas = personagem->build_atlas(&problem, rows);
	if (atlas.is_null()) {
		EditorToaster::get_singleton()->popup_str(problem.is_empty() ? U("Não foi possível montar a folha.") : problem, EditorToaster::SEVERITY_ERROR);
		return;
	}
	const String palette_png = _palette_png();
	const Vector<Color> reference = palette_png.is_empty() ? Vector<Color>() : RetroMD::png_palette(palette_png);
	Vector<uint8_t> indices;
	Vector<Color> palette;
	const int colors = RetroSgdkExport::index_sprite_atlas(atlas, reference, indices, palette);
	const Vector<uint8_t> png = RetroSgdkExport::indexed_png(atlas->get_width(), atlas->get_height(), indices, palette);
	const Ref<FileAccess> file = FileAccess::open(p_path, FileAccess::WRITE);
	if (file.is_null()) {
		EditorToaster::get_singleton()->popup_str(U("Não foi possível gravar ") + p_path, EditorToaster::SEVERITY_ERROR);
		return;
	}
	file->store_buffer(png.ptr(), png.size());
	file->close();
	const String local = ProjectSettings::get_singleton()->localize_path(p_path);
	if (local.begins_with("res://")) {
		EditorFileSystem::get_singleton()->update_file(local);
		EditorFileSystem::get_singleton()->scan_changes();
	}
	const MDPersonagem::Celula cell = personagem->get_cell(rows);
	String text = vformat(U("Folha montada: %s (%d × %d px, %d animações, célula %d × %d)"), p_path.get_file(), atlas->get_width(), atlas->get_height(), rows.size(), cell.size.x, cell.size.y);
	if (colors > 15) {
		text += vformat(U(". %d cores reduzidas para 15"), colors);
	} else if (!reference.is_empty()) {
		text += U(", na paleta de ") + palette_png.get_file();
	}
	EditorToaster::get_singleton()->popup_str(text + ".", colors > 15 ? EditorToaster::SEVERITY_WARNING : EditorToaster::SEVERITY_INFO);
}

void RetroAnimationEditor::_duplicate_character() {
	save_if_changed();
	const String from = personagem->get_path();
	const String base = from.trim_suffix(".charset.json");
	String path = base + "_copia.charset.json";
	for (int n = 2; FileAccess::exists(path); n++) {
		path = base + "_copia" + itos(n) + ".charset.json";
	}
	Dictionary copy = data.duplicate(true);
	copy["characterId"] = vformat("%x-%x", int64_t(OS::get_singleton()->get_unix_time()), int64_t(OS::get_singleton()->get_ticks_usec()));
	copy["characterName"] = String(copy.get("characterName", from.get_file().get_basename())) + "_copia";
	// A cópia ainda não foi exportada por ninguém.
	copy.erase("exportedFileName");
	copy.erase("exportedResourceName");
	copy.erase("exportedHeaderName");
	copy.erase("spriteName");
	copy.erase("exportFileName");
	const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
	if (file.is_null()) {
		EditorToaster::get_singleton()->popup_str(U("Não foi possível criar ") + path, EditorToaster::SEVERITY_ERROR);
		return;
	}
	file->store_string(JSON::stringify(copy, "  ", false) + "\n");
	file->close();
	EditorFileSystem::get_singleton()->update_file(path);
	const Ref<MDPersonagem> created = ResourceLoader::load(path, "MDPersonagem");
	if (created.is_valid()) {
		edit(created);
		EditorToaster::get_singleton()->popup_str(vformat(U("Cópia criada: %s"), path.get_file()));
	}
}

void RetroAnimationEditor::_delete_character() {
	if (personagem.is_null()) {
		return;
	}
	const String path = personagem->get_path();
	saved_json = JSON::stringify(data); // Não grava de novo o que vai para a lixeira.
	edit(Ref<MDPersonagem>());
	Error err = OS::get_singleton()->move_to_trash(ProjectSettings::get_singleton()->globalize_path(path));
	if (err == OK && FileAccess::exists(path + ".uid")) {
		OS::get_singleton()->move_to_trash(ProjectSettings::get_singleton()->globalize_path(path + ".uid"));
	}
	EditorFileSystem::get_singleton()->update_file(path);
	if (err != OK) {
		EditorToaster::get_singleton()->popup_str(U("Não foi possível mandar para a lixeira: ") + path, EditorToaster::SEVERITY_ERROR);
	} else {
		EditorToaster::get_singleton()->popup_str(vformat(U("%s foi para a lixeira."), path.get_file()));
	}
}

// ---- Janela separada ----

void RetroAnimationEditor::setup_window() {
	placeholder = memnew(VBoxContainer);
	placeholder->set_v_size_flags(SIZE_EXPAND_FILL);
	static_cast<VBoxContainer *>(placeholder)->set_alignment(BoxContainer::ALIGNMENT_CENTER);
	placeholder->hide();
	Label *text = memnew(Label(U("O editor de personagens está numa janela separada.")));
	text->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
	placeholder->add_child(text);
	HBoxContainer *buttons = memnew(HBoxContainer);
	buttons->set_alignment(BoxContainer::ALIGNMENT_CENTER);
	placeholder->add_child(buttons);
	Button *show_button = memnew(Button(U("Mostrar a janela")));
	show_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_show_window));
	buttons->add_child(show_button);
	Button *dock_button = memnew(Button(U("Trazer para esta tela")));
	dock_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_toggle_separate));
	buttons->add_child(dock_button);
	EditorInterface::get_singleton()->get_editor_main_screen()->add_child(placeholder);

	window = memnew(Window);
	window->set_title(U("Personagem — Retro Studio"));
	window->set_min_size(Size2(900, 560) * EDSCALE);
	window->set_transient(false);
	window->set_exclusive(false);
	window->hide();
	window->connect("close_requested", callable_mp(this, &RetroAnimationEditor::_window_closed));
	PanelContainer *background = memnew(PanelContainer);
	background->set_anchors_and_offsets_preset(PRESET_FULL_RECT);
	background->set_theme_type_variation("BackgroundPanel");
	window->add_child(background);
	EditorNode::get_singleton()->get_gui_base()->add_child(window);

	separate = bool(EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "janela_separada", true));
	_place();
}

void RetroAnimationEditor::set_screen_visible(bool p_visible) {
	screen_visible = p_visible;
	if (!window || !separate) {
		set_visible(p_visible);
		return;
	}
	// A tela Animações só abre a janela; fechar a tela não fecha a janela.
	placeholder->set_visible(p_visible);
	if (p_visible) {
		_show_window();
	}
}

void RetroAnimationEditor::_place() {
	Node *target = separate ? window->get_child(0) : static_cast<Node *>(EditorInterface::get_singleton()->get_editor_main_screen());
	if (get_parent() != target) {
		if (get_parent()) {
			get_parent()->remove_child(this);
		}
		target->add_child(this);
	}
	window_button->set_text(separate ? U("Encaixar na tela") : U("Janela separada"));
	window_button->set_tooltip_text(separate ? U("Mostra o editor na tela principal Animações, em vez desta janela.") : U("Abre o editor de personagens numa janela própria, que pode ir para outro monitor."));
}

void RetroAnimationEditor::_show_window() {
	show();
	if (!window->is_visible()) {
		const Size2 screen = DisplayServer::get_singleton()->screen_get_usable_rect(DisplayServer::get_singleton()->window_get_current_screen()).size;
		window->popup_centered((screen * 0.85).max(window->get_min_size()));
	} else {
		window->grab_focus();
	}
	set_process(personagem.is_valid() && is_visible_in_tree());
	callable_mp(static_cast<RetroSheetView *>(sheet_view), &RetroSheetView::focus).call_deferred();
}

void RetroAnimationEditor::_window_closed() {
	// As mudanças ficam pendentes (Salvar, Ctrl+S ou ao fechar o projeto), como na tela principal.
	window->hide();
	set_process(false);
}

void RetroAnimationEditor::_toggle_separate() {
	separate = !separate;
	EditorSettings::get_singleton()->set_project_metadata(META_ANIMACOES, "janela_separada", separate);
	if (separate) {
		_place();
		placeholder->set_visible(screen_visible);
		_show_window();
		return;
	}
	window->hide();
	placeholder->hide();
	_place();
	if (screen_visible) {
		show();
	} else {
		hide();
		EditorInterface::get_singleton()->set_main_screen_editor(U("Animações"));
	}
	callable_mp(static_cast<RetroSheetView *>(sheet_view), &RetroSheetView::focus).call_deferred();
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
	character_menu = memnew(MenuButton);
	character_menu->set_text(U("Personagem"));
	character_menu->set_flat(false);
	character_menu->set_tooltip_text(U("Duplicar, excluir ou achar este personagem no Sistema de Arquivos, ou exportar a folha montada."));
	character_menu->get_popup()->add_item(U("Duplicar personagem"), 0);
	character_menu->get_popup()->add_item(U("Excluir personagem (lixeira)…"), 1);
	character_menu->get_popup()->add_separator();
	character_menu->get_popup()->add_item(U("Mostrar no Sistema de Arquivos"), 2);
	character_menu->get_popup()->add_separator();
	character_menu->get_popup()->add_item(U("Exportar folha montada…"), 3);
	character_menu->get_popup()->set_item_tooltip(character_menu->get_popup()->get_item_count() - 1, U("Grava um PNG indexado com todas as animações, uma por linha, com as células alinhadas pelos pés: o mesmo atlas que o build manda para a ROM. As cores seguem a paleta escolhida em Cores. O fundo de visualização não vai junto."));
	character_menu->get_popup()->connect(SceneStringName(id_pressed), callable_mp(this, &RetroAnimationEditor::_character_menu));
	top->add_child(character_menu);
	delete_dialog = memnew(ConfirmationDialog);
	delete_dialog->set_title(U("Excluir personagem"));
	delete_dialog->set_ok_button_text(U("Mandar para a lixeira"));
	delete_dialog->connect(SceneStringName(confirmed), callable_mp(this, &RetroAnimationEditor::_delete_character));
	add_child(delete_dialog);
	window_button = memnew(Button);
	window_button->set_focus_mode(FOCUS_NONE);
	window_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_toggle_separate));
	top->add_child(window_button);
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
	anim_filter = memnew(LineEdit);
	anim_filter->set_placeholder(U("Buscar animação (Ctrl+F)"));
	anim_filter->set_clear_button_enabled(true);
	anim_filter->connect(SceneStringName(text_changed), callable_mp(this, &RetroAnimationEditor::_filter_changed));
	left->add_child(anim_filter);
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
	HBoxContainer *order_row = memnew(HBoxContainer);
	left->add_child(order_row);
	const char *order_names[] = { "Subir", "Descer" };
	const char *order_icons[] = { "MoveUp", "MoveDown" };
	for (int i = 0; i < 2; i++) {
		Button *button = memnew(Button(U(order_names[i])));
		button->set_h_size_flags(SIZE_EXPAND_FILL);
		button->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(order_icons[i], EditorStringName(EditorIcons)));
		button->set_tooltip_text(U("Muda a ordem das animações (a linha de cada uma no atlas do sprite). Os nodes escolhem a animação pelo nome, então nada se perde."));
		button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_move_animation).bind(i == 0 ? -1 : 1));
		order_row->add_child(button);
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
	sheet_grid_option = memnew(OptionButton);
	sheet_grid_option->add_item(U("Sem grade"));
	sheet_grid_option->add_item(U("Grade 8 px"));
	sheet_grid_option->add_item(U("Grade 16 px"));
	sheet_grid_option->add_item(U("Grade 32 px"));
	sheet_grid_option->set_tooltip_text(U("Grade por cima da folha, só para ver (8 px = um tile). Com zoom alto aparece também a grade de pixel."));
	sheet_grid_option->connect(SceneStringName(item_selected), callable_mp(this, &RetroAnimationEditor::_grid_changed).unbind(1).bind(0.0));
	HBoxContainer *tools_row = memnew(HBoxContainer);
	sheet_box->add_child(tools_row);
	tools_row->add_child(sheet_grid_option);
	snap_button = memnew(Button(U("Encaixar")));
	snap_button->set_toggle_mode(true);
	snap_button->set_pressed(true);
	snap_button->set_focus_mode(FOCUS_NONE);
	snap_button->set_tooltip_text(U("Ao arrastar, criar ou redimensionar a seleção e os recortes, as bordas grudam nas guias e, com uma grade ligada, nas linhas da grade."));
	tools_row->add_child(snap_button);
	measure_button = memnew(Button(U("Medir")));
	measure_button->set_toggle_mode(true);
	measure_button->set_focus_mode(FOCUS_NONE);
	measure_button->set_tooltip_text(U("Arraste na folha para medir em pixels (Shift trava num eixo, Esc limpa). A medida pode virar o espaço da grade."));
	measure_button->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_measure_toggled));
	tools_row->add_child(measure_button);
	for (int axis = 0; axis < 2; axis++) {
		measure_gap[axis] = memnew(Button);
		measure_gap[axis]->set_focus_mode(FOCUS_NONE);
		measure_gap[axis]->set_tooltip_text(axis ? U("Usa a medida vertical como espaço entre as linhas da grade.") : U("Usa a medida horizontal como espaço entre as colunas da grade."));
		measure_gap[axis]->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_measure_to_gap).bind(axis));
		measure_gap[axis]->hide();
		tools_row->add_child(measure_gap[axis]);
	}
	colors_button = memnew(Button(U("Cores")));
	colors_button->set_toggle_mode(true);
	colors_button->set_focus_mode(FOCUS_NONE);
	colors_button->set_tooltip_text(U("Faz a mesma redução de cores do build, sem gravar nada: quantas cores o personagem tem, as 15 que ficam (o Mega Drive mostra 15 cores mais a transparente por paleta, na grade de 8 níveis por canal) e, em magenta na folha, os pixels que vão mudar de cor."));
	colors_button->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_colors_toggled));
	tools_row->add_child(colors_button);
	palette_menu = memnew(MenuButton);
	palette_menu->set_flat(false);
	palette_menu->set_tooltip_text(U("Com qual paleta comparar: as 15 cores que o build escolhe para o personagem, ou a paleta de um PNG indexado (como a paleta_de do node, quando o jogador, os inimigos e o HUD dividem uma paleta)."));
	palette_menu->get_popup()->add_item(U("O build escolhe as 15 cores"), 0);
	palette_menu->get_popup()->add_item(U("Paleta de um PNG indexado…"), 1);
	palette_menu->get_popup()->connect(SceneStringName(id_pressed), callable_mp(this, &RetroAnimationEditor::_palette_menu));
	palette_menu->hide();
	tools_row->add_child(palette_menu);
	swatches = memnew(HBoxContainer);
	swatches->add_theme_constant_override("separation", 1);
	swatches->hide();
	tools_row->add_child(swatches);
	colors_label = memnew(Label);
	colors_label->set_clip_text(true);
	colors_label->set_h_size_flags(SIZE_EXPAND_FILL);
	colors_label->set_custom_minimum_size(Size2(60, 0) * EDSCALE);
	colors_label->set_mouse_filter(MOUSE_FILTER_PASS);
	colors_label->hide();
	tools_row->add_child(colors_label);
	sheet_export_dialog = memnew(EditorFileDialog);
	sheet_export_dialog->set_file_mode(EditorFileDialog::FILE_MODE_SAVE_FILE);
	sheet_export_dialog->set_access(EditorFileDialog::ACCESS_FILESYSTEM);
	sheet_export_dialog->add_filter("*.png", U("PNG indexado"));
	sheet_export_dialog->set_title(U("Exportar folha montada"));
	sheet_export_dialog->connect("file_selected", callable_mp(this, &RetroAnimationEditor::_export_sheet));
	add_child(sheet_export_dialog);
	palette_dialog = memnew(EditorFileDialog);
	palette_dialog->set_file_mode(EditorFileDialog::FILE_MODE_OPEN_FILE);
	palette_dialog->set_access(EditorFileDialog::ACCESS_RESOURCES);
	palette_dialog->add_filter("*.png", U("PNG indexado"));
	palette_dialog->set_title(U("Paleta de um PNG indexado"));
	palette_dialog->connect("file_selected", callable_mp(this, &RetroAnimationEditor::_palette_chosen));
	add_child(palette_dialog);
	tools_row->add_child(memnew(VSeparator));
	Label *background_label = memnew(Label(U("Fundo")));
	background_label->set_tooltip_text(U("Cor atrás da folha e da prévia, só para ver melhor a animação. Não vai para o jogo."));
	background_label->set_mouse_filter(MOUSE_FILTER_PASS);
	tools_row->add_child(background_label);
	background_picker = memnew(ColorPickerButton);
	background_picker->set_edit_alpha(false);
	background_picker->set_custom_minimum_size(Size2(22, 18) * EDSCALE);
	background_picker->set_v_size_flags(SIZE_SHRINK_CENTER);
	background_picker->set_tooltip_text(U("Cor de fundo da folha e da prévia (só no editor; não vai para o jogo). Uma cor que contraste com o personagem ajuda a ver o contorno e os pés."));
	background_picker->set_pick_color(EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "fundo_cor", Color(0.2, 0.2, 0.24)));
	background_picker->connect("color_changed", callable_mp(this, &RetroAnimationEditor::_background_changed).unbind(1));
	tools_row->add_child(background_picker);
	checker_button = memnew(Button);
	checker_button->set_toggle_mode(true);
	checker_button->set_flat(true);
	checker_button->set_focus_mode(FOCUS_NONE);
	checker_button->set_tooltip_text(U("Xadrez: alterna a cor de fundo com um tom mais claro, para ver onde termina o desenho e o que é transparente."));
	checker_button->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("Checkerboard"), EditorStringName(EditorIcons)));
	// O ícone do xadrez é grande (feito para fundo de painel): fica do tamanho dos outros.
	checker_button->add_theme_constant_override("icon_max_width", 16 * EDSCALE);
	checker_button->set_v_size_flags(SIZE_SHRINK_CENTER);
	checker_button->set_pressed(bool(EditorSettings::get_singleton()->get_project_metadata(META_ANIMACOES, "fundo_xadrez", false)));
	checker_button->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_background_changed).unbind(1));
	tools_row->add_child(checker_button);
	Control *tools_spacer = memnew(Control);
	tools_spacer->set_h_size_flags(SIZE_EXPAND_FILL);
	tools_row->add_child(tools_spacer);
	Button *clear_guides = memnew(Button(U("Limpar guias")));
	clear_guides->set_focus_mode(FOCUS_NONE);
	clear_guides->set_tooltip_text(U("Tira as guias desta folha. Para criar uma guia, arraste a partir da régua de cima ou da esquerda; para tirar uma, arraste-a de volta para a régua, dê dois cliques nela ou clique com o botão direito."));
	clear_guides->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_clear_guides));
	tools_row->add_child(clear_guides);
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
	sheet->set_tooltip_text(U("Arraste no vazio (ou com Shift) para selecionar; clique num desenho para selecioná-lo.\nArraste um recorte ou a seleção para movê-los; as alças redimensionam (a borda esquerda ou de cima leva os pés junto).\nRoda: zoom · botão do meio ou direito: mover a vista."));
	sheet_view = sheet;
	sheet_box->add_child(sheet);

	selection_label = memnew(Label);
	selection_label->set_clip_text(true);
	selection_label->set_modulate(Color(1, 1, 1, 0.7));
	sheet_box->add_child(selection_label);
	// Uma linha: seleção (X, Y, largura, altura) · ações em ícones · grade (tamanho e espaço) · criar faixa.
	HFlowContainer *selection_row = memnew(HFlowContainer);
	sheet_box->add_child(selection_row);
	auto small_spin = [&](SpinBox *p_spin) {
		p_spin->set_custom_minimum_size(Size2(62, 0) * EDSCALE);
		p_spin->set_select_all_on_focus(true);
	};
	auto icon_button = [&](const char *p_icon, const String &p_tip) {
		Button *button = memnew(Button);
		button->set_flat(true);
		button->set_focus_mode(FOCUS_NONE);
		button->set_tooltip_text(p_tip);
		button->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(p_icon, EditorStringName(EditorIcons)));
		return button;
	};
	HBoxContainer *selection_numbers = memnew(HBoxContainer);
	selection_numbers->add_theme_constant_override("separation", 2);
	selection_row->add_child(selection_numbers);
	Label *selection_title = memnew(Label(U("Seleção")));
	selection_title->set_modulate(Color(1, 1, 1, 0.7));
	selection_numbers->add_child(selection_title);
	const char *selection_field_tips[] = { "X da seleção na folha", "Y da seleção na folha", "Largura da seleção", "Altura da seleção" };
	for (int i = 0; i < 4; i++) {
		selection_fields[i] = memnew(SpinBox);
		selection_fields[i]->set_min(i < 2 ? 0 : 1);
		selection_fields[i]->set_max(16384);
		small_spin(selection_fields[i]);
		selection_fields[i]->set_tooltip_text(U(selection_field_tips[i]));
		selection_fields[i]->connect(SceneStringName(value_changed), callable_mp(this, &RetroAnimationEditor::_selection_field_changed).bind(i));
		selection_numbers->add_child(selection_fields[i]);
	}
	const char *selection_icons[] = { "Add", "Reload", "AtlasTexture", "Grid" };
	const char *selection_tips[] = {
		"Adicionar quadro: põe a seleção como quadro novo depois do quadro em edição (sem animação, cria uma).",
		"Substituir quadro: troca o recorte do quadro em edição pela seleção.",
		"Separar desenhos: cria uma animação com cada desenho da seleção num quadro, na ordem de leitura. Bom para folhas com espaçamentos irregulares.",
		"Criar faixa em grade: cria uma animação com a seleção dividida em quadros do tamanho e do espaço ao lado.",
	};
	HBoxContainer *actions = memnew(HBoxContainer);
	actions->add_theme_constant_override("separation", 0);
	selection_row->add_child(actions);
	for (int i = 0; i < SELECAO_GRADE; i++) {
		selection_buttons[i] = icon_button(selection_icons[i], U(selection_tips[i]));
		selection_buttons[i]->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_selection_action).bind(i));
		actions->add_child(selection_buttons[i]);
	}
	HBoxContainer *grid_row = memnew(HBoxContainer);
	grid_row->add_theme_constant_override("separation", 2);
	selection_row->add_child(grid_row);
	grid_row->add_child(memnew(VSeparator));
	Label *grid_title = memnew(Label(U("Grade")));
	grid_title->set_modulate(Color(1, 1, 1, 0.7));
	grid_title->set_tooltip_text(U("Tamanho de cada quadro e espaço entre eles, para Criar faixa em grade."));
	grid_title->set_mouse_filter(MOUSE_FILTER_PASS);
	grid_row->add_child(grid_title);
	const char *grid_tips[] = { "Largura do quadro", "Altura do quadro", "Espaço entre colunas", "Espaço entre linhas" };
	for (int g = 0; g < GRADE_MAX; g++) {
		grid_fields[g] = memnew(SpinBox);
		grid_fields[g]->set_min(g < GRADE_ESPACO_X ? 1 : 0);
		grid_fields[g]->set_max(1024);
		grid_fields[g]->set_value(g < GRADE_ESPACO_X ? 32 : 0);
		small_spin(grid_fields[g]);
		grid_fields[g]->set_tooltip_text(U(grid_tips[g]));
		grid_fields[g]->connect(SceneStringName(value_changed), callable_mp(this, &RetroAnimationEditor::_grid_changed));
		if (g == GRADE_ESPACO_X) {
			Label *gap = memnew(Label(U("+")));
			gap->set_tooltip_text(U("Espaço entre os quadros (colunas, linhas)."));
			gap->set_mouse_filter(MOUSE_FILTER_PASS);
			gap->set_modulate(Color(1, 1, 1, 0.7));
			grid_row->add_child(gap);
		}
		grid_row->add_child(grid_fields[g]);
		if (g == GRADE_LARGURA) {
			grid_row->add_child(memnew(Label(U("×"))));
		}
	}
	grid_count = memnew(Label);
	grid_count->set_modulate(Color(1, 1, 1, 0.7));
	grid_count->set_mouse_filter(MOUSE_FILTER_PASS);
	grid_row->add_child(grid_count);
	selection_buttons[SELECAO_GRADE] = icon_button(selection_icons[SELECAO_GRADE], U(selection_tips[SELECAO_GRADE]));
	selection_buttons[SELECAO_GRADE]->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_selection_action).bind(SELECAO_GRADE));
	grid_row->add_child(selection_buttons[SELECAO_GRADE]);
	VBoxContainer *timeline_box = memnew(VBoxContainer);
	center->add_child(timeline_box);
	HBoxContainer *frame_buttons = memnew(HBoxContainer);
	timeline_box->add_child(frame_buttons);
	Label *timeline_label = memnew(Label(U("Quadros")));
	timeline_label->set_h_size_flags(SIZE_EXPAND_FILL);
	frame_buttons->add_child(timeline_label);
	const char *clip_icons[] = { "ActionCopy", "ActionCut", "ActionPaste" };
	const char *clip_tips[] = { "Copiar o quadro ou o trecho (Ctrl+C)", "Recortar o quadro ou o trecho (Ctrl+X)", "Colar depois do quadro em edição (Ctrl+V), também em outra animação ou outro personagem" };
	for (int i = 0; i < 3; i++) {
		Button *button = memnew(Button);
		button->set_flat(true);
		button->set_focus_mode(FOCUS_NONE);
		button->set_tooltip_text(U(clip_tips[i]));
		button->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(clip_icons[i], EditorStringName(EditorIcons)));
		if (i == 2) {
			button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_paste_frames));
		} else {
			button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_copy_frames).bind(i == 1));
		}
		frame_buttons->add_child(button);
	}
	frame_buttons->add_child(memnew(VSeparator));
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
	RetroRhythmBar *rhythm_bar = memnew(RetroRhythmBar);
	rhythm_bar->ed = this;
	rhythm = rhythm_bar;
	timeline_box->add_child(rhythm_bar);
	timeline = memnew(ItemList);
	timeline->set_icon_mode(ItemList::ICON_MODE_TOP);
	timeline->set_max_columns(0);
	timeline->set_same_column_width(true);
	timeline->set_fixed_icon_size(Size2i(64, 64) * EDSCALE);
	timeline->set_texture_filter(TEXTURE_FILTER_NEAREST);
	timeline->set_custom_minimum_size(Size2(0, 110) * EDSCALE);
	timeline->set_select_mode(ItemList::SELECT_MULTI);
	timeline->set_tooltip_text(U("Clique: quadro em edição · Shift+clique: escolhe um trecho (para repetir, ajustar ou mudar o tempo de vários).\nArraste um quadro para mudar a ordem. Vírgula e ponto: quadro anterior e seguinte; Espaço: tocar."));
	timeline->connect(SceneStringName(item_selected), callable_mp(this, &RetroAnimationEditor::_frame_selected));
	timeline->connect("multi_selected", callable_mp(this, &RetroAnimationEditor::_timeline_multi));
	timeline->set_drag_forwarding(callable_mp(this, &RetroAnimationEditor::_timeline_drag), callable_mp(this, &RetroAnimationEditor::_timeline_can_drop), callable_mp(this, &RetroAnimationEditor::_timeline_drop));
	timeline_box->add_child(timeline);

	// Direita: prévia e campos.
	VSplitContainer *right_split = memnew(VSplitContainer);
	right_split->set_custom_minimum_size(Size2(280, 0) * EDSCALE);
	center_split->add_child(right_split);
	VBoxContainer *right = memnew(VBoxContainer);
	right->set_v_size_flags(SIZE_EXPAND_FILL);
	right_split->add_child(right);
	RetroAnimationPreview *preview_control = memnew(RetroAnimationPreview);
	preview_control->ed = this;
	preview_control->set_v_size_flags(SIZE_EXPAND_FILL);
	preview = preview_control;
	right->add_child(preview_control);
	HBoxContainer *play_row = memnew(HBoxContainer);
	right->add_child(play_row);
	Button *previous_button = memnew(Button);
	previous_button->set_flat(true);
	previous_button->set_focus_mode(FOCUS_NONE);
	previous_button->set_tooltip_text(U("Quadro anterior (vírgula)."));
	previous_button->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("PlayStartBackwards"), EditorStringName(EditorIcons)));
	previous_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_step_frame).bind(-1));
	play_row->add_child(previous_button);
	play_button = memnew(Button);
	play_button->set_focus_mode(FOCUS_NONE);
	play_button->set_tooltip_text(U("Tocar ou pausar a prévia (Espaço), no tempo do console."));
	play_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_toggle_play));
	play_row->add_child(play_button);
	Button *next_button = memnew(Button);
	next_button->set_flat(true);
	next_button->set_focus_mode(FOCUS_NONE);
	next_button->set_tooltip_text(U("Quadro seguinte (ponto)."));
	next_button->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("PlayStart"), EditorStringName(EditorIcons)));
	next_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_step_frame).bind(1));
	play_row->add_child(next_button);
	reference_option = memnew(OptionButton);
	reference_option->set_h_size_flags(SIZE_EXPAND_FILL);
	reference_option->set_clip_text(true);
	reference_option->set_tooltip_text(U("Com a prévia pausada, mostra este quadro por baixo, para alinhar os pés (clique) e o ajuste fino (setas). Anterior e seguinte: os dois ao mesmo tempo, o anterior em vermelho e o seguinte em azul (onion skin)."));
	reference_option->connect(SceneStringName(item_selected), callable_mp(static_cast<CanvasItem *>(preview_control), &CanvasItem::queue_redraw).unbind(1));
	play_row->add_child(reference_option);
	reference_alpha = memnew(SpinBox);
	reference_alpha->set_min(10);
	reference_alpha->set_max(80);
	reference_alpha->set_step(5);
	reference_alpha->set_value(30);
	reference_alpha->set_suffix("%");
	reference_alpha->set_tooltip_text(U("Opacidade do quadro de referência."));
	reference_alpha->connect(SceneStringName(value_changed), callable_mp(static_cast<CanvasItem *>(preview_control), &CanvasItem::queue_redraw).unbind(1));
	play_row->add_child(reference_alpha);

	HBoxContainer *view_row = memnew(HBoxContainer);
	right->add_child(view_row);
	view_row->add_child(memnew(Label(U("Zoom"))));
	Button *zoom_out = memnew(Button);
	zoom_out->set_flat(true);
	zoom_out->set_focus_mode(FOCUS_NONE);
	zoom_out->set_tooltip_text(U("Diminuir (roda do mouse na prévia)."));
	zoom_out->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("ZoomLess"), EditorStringName(EditorIcons)));
	zoom_out->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_zoom_step).bind(-1));
	view_row->add_child(zoom_out);
	zoom_label = memnew(Label);
	zoom_label->set_custom_minimum_size(Size2(32, 0) * EDSCALE);
	zoom_label->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
	zoom_label->set_mouse_filter(MOUSE_FILTER_PASS);
	view_row->add_child(zoom_label);
	Button *zoom_in = memnew(Button);
	zoom_in->set_flat(true);
	zoom_in->set_focus_mode(FOCUS_NONE);
	zoom_in->set_tooltip_text(U("Aumentar (roda do mouse na prévia, no ponto do mouse)."));
	zoom_in->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("ZoomMore"), EditorStringName(EditorIcons)));
	zoom_in->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_zoom_step).bind(1));
	view_row->add_child(zoom_in);
	Button *zoom_fit = memnew(Button(U("Ajustar")));
	zoom_fit->set_focus_mode(FOCUS_NONE);
	zoom_fit->set_tooltip_text(U("Volta a caber na prévia, centrado."));
	zoom_fit->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_zoom_fit));
	view_row->add_child(zoom_fit);
	flip_button = memnew(Button(U("Espelhar")));
	flip_button->set_toggle_mode(true);
	flip_button->set_focus_mode(FOCUS_NONE);
	flip_button->set_tooltip_text(U("Mostra o personagem virado para o outro lado, como o jogo desenha (só a prévia; o arquivo não muda)."));
	flip_button->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_flip_toggled));
	view_row->add_child(flip_button);
	boxes_button = memnew(Button(U("Caixas")));
	boxes_button->set_toggle_mode(true);
	boxes_button->set_pressed(true);
	boxes_button->set_focus_mode(FOCUS_NONE);
	boxes_button->set_tooltip_text(U("Mostra as caixas na prévia: corpo (verde), dano (roxo) e ataque (vermelho). Arraste as bordas, os cantos ou a etiqueta para ajustar."));
	boxes_button->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_boxes_toggled));
	view_row->add_child(boxes_button);
	strike_button = memnew(Button(U("Golpe aqui")));
	strike_button->set_focus_mode(FOCUS_NONE);
	strike_button->set_tooltip_text(U("Faz o quadro em edição acertar golpe: liga a caixa de ataque desta animação (começa neste quadro) ou estende o trecho do golpe até ele. Depois, ajuste a caixa vermelha na prévia."));
	strike_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_strike_here));
	view_row->add_child(strike_button);
	speed_option = memnew(OptionButton);
	speed_option->add_item(U("0,25×"));
	speed_option->add_item(U("0,5×"));
	speed_option->add_item(U("1× (60 Hz)"));
	speed_option->add_item(U("PAL (50 Hz)"));
	speed_option->add_item(U("2×"));
	speed_option->select(2);
	speed_option->set_h_size_flags(SIZE_EXPAND_FILL);
	speed_option->set_clip_text(true);
	speed_option->set_tooltip_text(U("Velocidade da prévia (não muda o jogo). PAL: como num console europeu, a 50 quadros por segundo."));
	view_row->add_child(speed_option);
	HBoxContainer *scenery_row = memnew(HBoxContainer);
	right->add_child(scenery_row);
	scenery_row->add_child(memnew(Label(U("Cenário"))));
	scenery_button = memnew(Button(U("Escolher PNG…")));
	scenery_button->set_h_size_flags(SIZE_EXPAND_FILL);
	scenery_button->set_clip_text(true);
	scenery_button->set_focus_mode(FOCUS_NONE);
	scenery_button->set_tooltip_text(U("Um PNG do projeto atrás da prévia (um pedaço do mapa, o fundo da fase), repetido na horizontal, para ver o personagem no lugar. Só na prévia."));
	scenery_row->add_child(scenery_button);
	scenery_clear = memnew(Button);
	scenery_clear->set_flat(true);
	scenery_clear->set_focus_mode(FOCUS_NONE);
	scenery_clear->set_tooltip_text(U("Tirar o cenário."));
	scenery_clear->set_button_icon(EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("Clear"), EditorStringName(EditorIcons)));
	scenery_clear->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_scenery_cleared));
	scenery_row->add_child(scenery_clear);
	ground_field = memnew(SpinBox);
	ground_field->set_min(0);
	ground_field->set_max(4096);
	ground_field->set_prefix(U("chão"));
	ground_field->set_custom_minimum_size(Size2(96, 0) * EDSCALE);
	ground_field->set_tooltip_text(U("Linha do chão no PNG do cenário (pixels a partir de cima): ela fica na altura dos pés."));
	ground_field->connect(SceneStringName(value_changed), callable_mp(this, &RetroAnimationEditor::_scenery_changed));
	scenery_row->add_child(ground_field);
	walk_field = memnew(SpinBox);
	walk_field->set_min(0);
	walk_field->set_max(600);
	walk_field->set_suffix("px/s");
	walk_field->set_custom_minimum_size(Size2(96, 0) * EDSCALE);
	walk_field->set_tooltip_text(U("Andar: o cenário corre nessa velocidade enquanto a animação toca, como se o personagem andasse (vira com Espelhar). Use a velocidade do node (MDJogador → velocidade) para ver se o pé desliza no chão."));
	walk_field->connect(SceneStringName(value_changed), callable_mp(this, &RetroAnimationEditor::_scenery_changed));
	scenery_row->add_child(walk_field);
	scenery_dialog = memnew(EditorFileDialog);
	scenery_dialog->set_file_mode(EditorFileDialog::FILE_MODE_OPEN_FILE);
	scenery_dialog->set_access(EditorFileDialog::ACCESS_RESOURCES);
	scenery_dialog->add_filter("*.png", U("Imagem PNG"));
	scenery_dialog->set_title(U("Cenário da prévia"));
	scenery_dialog->connect("file_selected", callable_mp(this, &RetroAnimationEditor::_scenery_chosen));
	add_child(scenery_dialog);
	scenery_button->connect(SceneStringName(pressed), callable_mp(static_cast<FileDialog *>(scenery_dialog), &FileDialog::popup_file_dialog));

	HBoxContainer *click_row = memnew(HBoxContainer);
	right->add_child(click_row);
	click_row->add_child(memnew(Label(U("Clique marca"))));
	click_option = memnew(OptionButton);
	click_option->set_h_size_flags(SIZE_EXPAND_FILL);
	click_option->add_item(U("os pés do quadro"));
	click_option->add_item(U("a caixa do corpo"));
	click_option->add_item(U("a caixa de ataque"));
	click_option->add_item(U("a caixa de dano"));
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
	nudge_scope = memnew(OptionButton);
	nudge_scope->add_item(U("este quadro"));
	nudge_scope->add_item(U("o trecho"));
	nudge_scope->add_item(U("a animação"));
	nudge_scope->set_h_size_flags(SIZE_EXPAND_FILL);
	nudge_scope->set_clip_text(true);
	nudge_scope->set_focus_mode(FOCUS_NONE);
	nudge_scope->set_tooltip_text(U("Onde o ajuste fino (botões e setas) age: o quadro em edição, o trecho escolhido com Shift+clique na fila, ou todos os quadros da animação."));
	nudge_row->add_child(nudge_scope);

	VBoxContainer *right_bottom = memnew(VBoxContainer);
	right_bottom->set_v_size_flags(SIZE_EXPAND_FILL);
	right_split->add_child(right_bottom);
	ScrollContainer *scroll = memnew(ScrollContainer);
	scroll->set_v_size_flags(SIZE_EXPAND_FILL);
	scroll->set_custom_minimum_size(Size2(0, 160) * EDSCALE);
	scroll->set_horizontal_scroll_mode(ScrollContainer::SCROLL_MODE_DISABLED);
	right_bottom->add_child(scroll);
	VBoxContainer *form = memnew(VBoxContainer);
	form->set_h_size_flags(SIZE_EXPAND_FILL);
	scroll->add_child(form);
	form_box = scroll;
	no_animation_label = memnew(Label(U("Ainda sem animações. Selecione um desenho na folha (clique nele ou arraste em volta) e use Adicionar quadro, Separar desenhos ou Criar faixa em grade.")));
	no_animation_label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	no_animation_label->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	no_animation_label->set_modulate(Color(1, 1, 1, 0.7));
	right_bottom->add_child(no_animation_label);
	right_bottom->move_child(no_animation_label, scroll->get_index());

	struct Faixa {
		int min, max;
	};
	const Faixa ranges[CAMPO_MAX] = {
		{ 1, 60 }, { 1, 255 }, { 0, 1024 }, { 0, 1024 }, { -128, 128 }, { -128, 128 },
		{ 0, 16384 }, { 0, 16384 }, { 1, 1024 }, { 1, 1024 },
		{ -256, 256 }, { -256, 256 }, { 0, 256 }, { 0, 256 },
		{ -256, 256 }, { -256, 256 }, { 0, 256 }, { 0, 256 }, { 1, 255 }, { 1, 255 },
		{ -256, 256 }, { -256, 256 }, { 1, 256 }, { 1, 256 }
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
	Button *use_fps = memnew(Button(U("Usar fps")));
	use_fps->set_tooltip_text(U("O quadro (ou o trecho escolhido na fila) volta a usar a velocidade da animação, sem tempo próprio."));
	use_fps->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_use_fps));
	row(frame_grid, U("Tempo"), fields[CAMPO_TEMPO], use_fps);
	cost_label = memnew(Label);
	cost_label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	cost_label->set_custom_minimum_size(Size2(160, 0) * EDSCALE);
	cost_label->set_h_size_flags(SIZE_EXPAND_FILL);
	cost_label->set_mouse_filter(MOUSE_FILTER_PASS);
	cost_label->set_tooltip_text(U("Estimativa de como o rescomp do SGDK corta o quadro em sprites de hardware de até 4×4 tiles, a partir do desenho (as partes vazias não gastam VRAM). O número exato sai no build; a estimativa costuma acertar os sprites e ficar igual ou um pouco acima nos tiles.\nLimites: 16 sprites por quadro (SGDK); numa linha da tela, 20 sprites e 320 px de sprite somando todos os sprites da linha (H40). O jogador, os inimigos e os itens na mesma altura dividem a linha."));
	row(frame_grid, U("Custo"), cost_label);
	row(frame_grid, U("Pés"), fields[CAMPO_APOIO_X], fields[CAMPO_APOIO_Y]);
	fields[CAMPO_AJUSTE_X]->set_tooltip_text(U("Desloca o desenho na célula sem mexer no recorte."));
	row(frame_grid, U("Ajuste fino"), fields[CAMPO_AJUSTE_X], fields[CAMPO_AJUSTE_Y]);
	row(frame_grid, U("Recorte"), fields[CAMPO_RECORTE_X], fields[CAMPO_RECORTE_Y]);
	row(frame_grid, U("Tamanho"), fields[CAMPO_RECORTE_L], fields[CAMPO_RECORTE_A]);
	HFlowContainer *edges = memnew(HFlowContainer);
	edges->set_h_size_flags(SIZE_EXPAND_FILL);
	const char *edge_names[] = { "Esq.", "Dir.", "Cima", "Baixo" };
	const char *edge_tips[] = { "esquerda", "direita", "de cima", "de baixo" };
	for (int side = 0; side < 4; side++) {
		HBoxContainer *edge = memnew(HBoxContainer);
		edge->add_theme_constant_override("separation", 0);
		edge->add_child(memnew(Label(U(edge_names[side]))));
		for (int grow = 0; grow < 2; grow++) {
			Button *button = memnew(Button(grow ? "+" : U("−")));
			button->set_flat(true);
			button->set_focus_mode(FOCUS_NONE);
			button->set_tooltip_text(vformat(grow ? U("Expande a borda %s do recorte 1 pixel (Shift: 8), sem mexer na pose.") : U("Recua a borda %s do recorte 1 pixel (Shift: 8), sem mexer na pose."), U(edge_tips[side])));
			button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_edge_button).bind(side * 2 + grow));
			edge->add_child(button);
		}
		edges->add_child(edge);
	}
	Button *trim = memnew(Button(U("Aparar")));
	trim->set_tooltip_text(U("Corta as bordas transparentes do recorte, deixando só o desenho; os pés andam junto, então a pose fica no lugar. Vale para o quadro em edição, o trecho escolhido na fila ou a animação inteira (a mesma escolha do ajuste fino)."));
	trim->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_trim_frames));
	edges->add_child(trim);
	row(frame_grid, U("Bordas"), edges);
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
	event_edit = memnew(LineEdit);
	event_edit->set_h_size_flags(SIZE_EXPAND_FILL);
	event_edit->set_placeholder(U("(nenhum)"));
	event_edit->connect(SceneStringName(text_submitted), callable_mp(this, &RetroAnimationEditor::_event_changed));
	event_edit->connect(SceneStringName(focus_exited), callable_mp(this, &RetroAnimationEditor::_event_focus_exited));
	row(frame_grid, U("Evento"), event_edit);

	GridContainer *repeat_grid = section(U("Repetir trecho"));
	repeat_label = memnew(Label);
	repeat_label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	repeat_label->set_custom_minimum_size(Size2(160, 0) * EDSCALE);
	repeat_label->set_modulate(Color(1, 1, 1, 0.7));
	repeat_times = memnew(SpinBox);
	repeat_times->set_min(2);
	repeat_times->set_max(16);
	repeat_times->set_value(2);
	repeat_times->set_suffix(U("vezes"));
	repeat_times->set_tooltip_text(U("Quantas vezes o trecho aparece no total (2 = mais uma cópia)."));
	repeat_times->connect(SceneStringName(value_changed), callable_mp(this, &RetroAnimationEditor::_refresh_repeat).unbind(1));
	repeat_button = memnew(Button(U("Repetir")));
	repeat_button->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_repeat_range));
	row(repeat_grid, U("No total"), repeat_times, repeat_button);
	form->add_child(repeat_label);

	GridContainer *body_grid = section(U("Corpo (personagem inteiro)"));
	row(body_grid, U("Posição"), fields[CAMPO_CORPO_X], fields[CAMPO_CORPO_Y]);
	row(body_grid, U("Tamanho"), fields[CAMPO_CORPO_L], fields[CAMPO_CORPO_A]);

	GridContainer *hurt_grid = section(U("Dano (onde leva golpe)"));
	hurt_check = memnew(CheckBox(U("Caixa própria")));
	hurt_check->set_tooltip_text(U("Desligada, o personagem leva golpe no corpo (verde). Ligada, numa caixa só dela (roxa): menor que o corpo para um golpe que raspa não acertar, ou só no tronco. Vale para todo o personagem. O corpo continua batendo no chão e nas paredes."));
	hurt_check->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_hurt_toggled));
	Button *hurt_copy = memnew(Button(U("Copiar do corpo")));
	hurt_copy->set_tooltip_text(U("Começa a caixa de dano igual ao corpo."));
	hurt_copy->connect(SceneStringName(pressed), callable_mp(this, &RetroAnimationEditor::_hurt_from_body));
	row(hurt_grid, String(), hurt_check, hurt_copy);
	row(hurt_grid, U("Posição"), fields[CAMPO_DANO_X], fields[CAMPO_DANO_Y]);
	row(hurt_grid, U("Tamanho"), fields[CAMPO_DANO_L], fields[CAMPO_DANO_A]);

	GridContainer *attack_grid = section(U("Ataque"));
	attack_check = memnew(CheckBox(U("Tem caixa de ataque")));
	attack_check->connect(SceneStringName(toggled), callable_mp(this, &RetroAnimationEditor::_attack_toggled));
	row(attack_grid, String(), attack_check);
	row(attack_grid, U("Posição"), fields[CAMPO_ATAQUE_X], fields[CAMPO_ATAQUE_Y]);
	row(attack_grid, U("Tamanho"), fields[CAMPO_ATAQUE_L], fields[CAMPO_ATAQUE_A]);
	row(attack_grid, U("Quadros"), fields[CAMPO_ATAQUE_DE], fields[CAMPO_ATAQUE_ATE]);

	_refresh();
	_refresh_history();
	_refresh_zoom_label();
	_show_background();
}

// ---- Plugin ----

String RetroAnimationPlugin::get_plugin_name() const {
	return U("Animações");
}

const Ref<Texture2D> RetroAnimationPlugin::get_plugin_icon() const {
	return EditorNode::get_singleton()->get_editor_theme()->get_icon(SNAME("AnimatedSprite2D"), EditorStringName(EditorIcons));
}

void RetroAnimationPlugin::make_visible(bool p_visible) {
	editor->set_screen_visible(p_visible);
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
	editor->setup_window();
}
