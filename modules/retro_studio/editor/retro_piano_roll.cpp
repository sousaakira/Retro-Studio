#include "retro_piano_roll.h"

#include "core/input/input_event.h"
#include "scene/resources/font.h"
#include "scene/scene_string_names.h"

static constexpr int EDGE = 6;
static const uint32_t TRACK_COLORS[8] = { 0x5bbda5ff, 0x5b8fbdff, 0xbd9a5bff, 0xbd5b7aff, 0x8f5bbdff, 0x7abd5bff, 0xbd765bff, 0x5bb3bdff };

static bool _black(int p_pitch) {
	const int n = p_pitch % 12;
	return n == 1 || n == 3 || n == 6 || n == 8 || n == 10;
}

void RetroPianoRoll::_bind_methods() {
	ADD_SIGNAL(MethodInfo("cursor_changed", PropertyInfo(Variant::INT, "tick")));
	ADD_SIGNAL(MethodInfo("preview", PropertyInfo(Variant::INT, "pitch"), PropertyInfo(Variant::INT, "velocity")));
	ADD_SIGNAL(MethodInfo("preview_end"));
	// A música mudou (fim de um gesto ou uma tecla): o editor grava um passo de desfazer.
	ADD_SIGNAL(MethodInfo("changed"));
}

RetroPianoRoll::RetroPianoRoll() {
	set_focus_mode(FOCUS_ALL);
	set_clip_contents(true);
	set_custom_minimum_size(Size2(200, 160));
}

Color RetroPianoRoll::_color(int p_track) const {
	return Color::hex(TRACK_COLORS[p_track % 8]);
}

Vector<RetroSongNote> *RetroPianoRoll::_notes() const {
	if (!song || track < 0 || track >= song->tracks.size()) {
		return nullptr;
	}
	return &song->tracks.write[track].notes;
}

double RetroPianoRoll::_tick_at(double p_x) const {
	return (p_x - KEYS + scroll_x) / zoom_x;
}

int RetroPianoRoll::_pitch_at(double p_y) const {
	return 127 - int(Math::floor((p_y - RULER + scroll_y) / row_height));
}

double RetroPianoRoll::_x_of(double p_tick) const {
	return KEYS + p_tick * zoom_x - scroll_x;
}

double RetroPianoRoll::_y_of(int p_pitch) const {
	return RULER + (127 - p_pitch) * row_height - scroll_y;
}

int RetroPianoRoll::_note_at(const Vector2 &p_position) const {
	const Vector<RetroSongNote> *notes = _notes();
	if (!notes) {
		return -1;
	}
	const double tick = _tick_at(p_position.x);
	const int pitch = _pitch_at(p_position.y);
	for (int index = notes->size() - 1; index >= 0; index--) {
		const RetroSongNote &note = (*notes)[index];
		if (note.n == pitch && tick >= note.t && tick < note.t + note.d) {
			return index;
		}
	}
	return -1;
}

void RetroPianoRoll::_clamp_scroll() {
	if (!song) {
		return;
	}
	const Size2 size = get_size();
	scroll_x = CLAMP(scroll_x, 0.0, MAX(0.0, song->length() * zoom_x - (size.x - KEYS)));
	scroll_y = CLAMP(scroll_y, 0.0, MAX(0.0, 128.0 * row_height - (size.y - RULER)));
}

void RetroPianoRoll::set_track(int p_track) {
	track = p_track;
	selection.clear();
	needs_reveal = true;
	reveal();
}

void RetroPianoRoll::clear_selection() {
	selection.clear();
	queue_redraw();
}

void RetroPianoRoll::reveal() {
	if (get_size().y <= RULER) {
		needs_reveal = true;
		return;
	}
	const Vector<RetroSongNote> *notes = _notes();
	int center = 60;
	if (notes && !notes->is_empty()) {
		int64_t sum = 0;
		for (const RetroSongNote &note : *notes) {
			sum += note.n;
		}
		center = int(Math::round(double(sum) / notes->size()));
	}
	scroll_y = (127 - center) * row_height - (get_size().y - RULER) / 2;
	_clamp_scroll();
	queue_redraw();
}

// Acompanha a reprodução: vira a página quando o cursor sai da tela.
void RetroPianoRoll::follow_playhead(double p_tick) {
	playhead = p_tick;
	if (playing) {
		const double x = _x_of(p_tick);
		if (x > get_size().x - 40 || x < KEYS) {
			scroll_x = MAX(0.0, p_tick * zoom_x - 60);
			_clamp_scroll();
		}
	}
	queue_redraw();
}

void RetroPianoRoll::_remove(const HashSet<int> &p_indices) {
	Vector<RetroSongNote> *notes = _notes();
	if (!notes || p_indices.is_empty()) {
		return;
	}
	Vector<RetroSongNote> kept;
	HashSet<int> moved;
	for (int index = 0; index < notes->size(); index++) {
		if (p_indices.has(index)) {
			continue;
		}
		if (selection.has(index)) {
			moved.insert(kept.size());
		}
		kept.push_back((*notes)[index]);
	}
	*notes = kept;
	selection = moved;
	edited = true;
}

void RetroPianoRoll::_finish_edit() {
	if (edited) {
		edited = false;
		emit_signal(SNAME("changed"));
	}
}

Control::CursorShape RetroPianoRoll::get_cursor_shape(const Point2 &p_pos) const {
	if (drag != DRAG_NONE) {
		return drag == DRAG_MOVE ? CURSOR_DRAG : (drag == DRAG_RESIZE ? CURSOR_HSIZE : CURSOR_ARROW);
	}
	if (p_pos.y < RULER) {
		return CURSOR_POINTING_HAND;
	}
	if (p_pos.x < KEYS) {
		return CURSOR_ARROW;
	}
	const int index = _note_at(p_pos);
	if (index < 0) {
		return CURSOR_CROSS;
	}
	const RetroSongNote &note = (*_notes())[index];
	return _x_of(note.t + note.d) - p_pos.x <= EDGE ? CURSOR_HSIZE : CURSOR_DRAG;
}

void RetroPianoRoll::gui_input(const Ref<InputEvent> &p_event) {
	if (!song) {
		return;
	}
	Vector<RetroSongNote> *notes = _notes();
	const int length = song->length();
	const Ref<InputEventMouseButton> button = p_event;
	if (button.is_valid()) {
		const Vector2 position = button->get_position();
		const MouseButton index = button->get_button_index();
		// ---- roda ----
		if (button->is_pressed() && (index == MouseButton::WHEEL_UP || index == MouseButton::WHEEL_DOWN || index == MouseButton::WHEEL_LEFT || index == MouseButton::WHEEL_RIGHT)) {
			const double sign = (index == MouseButton::WHEEL_UP || index == MouseButton::WHEEL_LEFT) ? -1 : 1;
			const double factor = button->get_factor() > 0 ? button->get_factor() : 1;
			if (button->is_command_or_control_pressed()) {
				const double tick = _tick_at(position.x);
				zoom_x = CLAMP(zoom_x * (sign < 0 ? 1.15 : 1 / 1.15), 0.25, 8.0);
				scroll_x = tick * zoom_x - (position.x - KEYS);
			} else if (button->is_alt_pressed()) {
				row_height = CLAMP(row_height + (sign < 0 ? 1 : -1), 6, 24);
			} else if (button->is_shift_pressed() || index == MouseButton::WHEEL_LEFT || index == MouseButton::WHEEL_RIGHT) {
				scroll_x += sign * 60 * factor;
			} else {
				scroll_y += sign * 3 * row_height * factor;
			}
			needs_reveal = false; // O usuário rolou: não centraliza mais sozinho.
			_clamp_scroll();
			queue_redraw();
			accept_event();
			return;
		}
		if (button->is_pressed()) {
			grab_focus();
			// ---- régua ----
			if (position.y < RULER) {
				if (position.x < KEYS || index != MouseButton::LEFT) {
					return;
				}
				const int tick = MIN(length - 1, retro_snap_tick(_tick_at(position.x), grid));
				if (button->is_shift_pressed()) {
					drag = DRAG_LOOP;
					drag_from = tick;
					song->has_loop = true;
					song->loop_start = tick;
					song->loop_end = MIN(length, tick + grid);
					edited = true;
				} else {
					emit_signal(SNAME("cursor_changed"), MAX(0, int(Math::floor(_tick_at(position.x) / grid)) * grid));
				}
				queue_redraw();
				accept_event();
				return;
			}
			// ---- teclas do piano ----
			if (position.x < KEYS) {
				if (index == MouseButton::LEFT) {
					drag = DRAG_KEY;
					drag_pitch = _pitch_at(position.y);
					emit_signal(SNAME("preview"), drag_pitch, 100);
				}
				accept_event();
				return;
			}
			const int target = _note_at(position);
			if (index == MouseButton::RIGHT) {
				if (target >= 0) {
					HashSet<int> doomed;
					doomed.insert(target);
					_remove(doomed);
				}
				drag = DRAG_ERASE;
				queue_redraw();
				accept_event();
				return;
			}
			if (index != MouseButton::LEFT || !notes) {
				return;
			}
			const bool additive = button->is_shift_pressed() || button->is_command_or_control_pressed();
			if (target >= 0) {
				if (additive) {
					if (selection.has(target)) {
						selection.erase(target);
					} else {
						selection.insert(target);
					}
				} else if (!selection.has(target)) {
					selection.clear();
					selection.insert(target);
				}
				const RetroSongNote &note = (*notes)[target];
				drag = _x_of(note.t + note.d) - position.x <= EDGE ? DRAG_RESIZE : DRAG_MOVE;
				drag_start = position;
				drag_target = target;
				origins.clear();
				for (const int selected : selection) {
					const RetroSongNote &item = (*notes)[selected];
					origins.push_back({ selected, item.t, item.n, item.d });
				}
				emit_signal(SNAME("preview"), note.n, note.v);
			} else if (additive) {
				drag = DRAG_BOX;
				drag_start = position;
				box_end = position;
				box_base = selection;
			} else {
				const int t = MAX(0, MIN(length - grid, int(Math::floor(_tick_at(position.x) / grid)) * grid));
				const int n = _pitch_at(position.y);
				if (n < 0 || n > 127) {
					return;
				}
				RetroSongNote note;
				note.t = t;
				note.d = MIN(last_length, length - t);
				note.n = n;
				note.v = 100;
				notes->push_back(note);
				const int created = notes->size() - 1;
				selection.clear();
				selection.insert(created);
				drag = DRAG_RESIZE;
				drag_start = position;
				drag_target = created;
				origins.clear();
				origins.push_back({ created, note.t, note.n, note.d });
				edited = true;
				emit_signal(SNAME("preview"), n, 100);
			}
			queue_redraw();
			accept_event();
			return;
		}
		// ---- soltar ----
		if (drag == DRAG_RESIZE && drag_target >= 0 && notes && drag_target < notes->size()) {
			last_length = (*notes)[drag_target].d;
		}
		if (drag != DRAG_NONE && drag != DRAG_BOX && drag != DRAG_LOOP && drag != DRAG_ERASE) {
			emit_signal(SNAME("preview_end"));
		}
		drag = DRAG_NONE;
		drag_target = -1;
		_finish_edit();
		queue_redraw();
		accept_event();
		return;
	}
	const Ref<InputEventMouseMotion> motion = p_event;
	if (motion.is_valid()) {
		const Vector2 position = motion->get_position();
		const int hovered = position.x < KEYS && position.y >= RULER ? _pitch_at(position.y) : -1;
		if (hovered != hover) {
			hover = hovered;
			queue_redraw();
		}
		switch (drag) {
			case DRAG_NONE:
				return;
			case DRAG_LOOP: {
				const int tick = retro_snap_tick(_tick_at(position.x), grid);
				const int start = MAX(0, MIN(drag_from, tick)), end = MIN(length, MAX(drag_from, tick));
				song->loop_start = start;
				song->loop_end = MAX(start + grid, end);
				edited = true;
			} break;
			case DRAG_KEY: {
				const int pitch = _pitch_at(position.y);
				if (pitch != drag_pitch) {
					emit_signal(SNAME("preview_end"));
					drag_pitch = pitch;
					emit_signal(SNAME("preview"), pitch, 100);
				}
			} break;
			case DRAG_ERASE: {
				const int index = position.x >= KEYS ? _note_at(position) : -1;
				if (index >= 0) {
					HashSet<int> doomed;
					doomed.insert(index);
					_remove(doomed);
				}
			} break;
			case DRAG_BOX: {
				box_end = position;
				const double t0 = _tick_at(MIN(drag_start.x, position.x)), t1 = _tick_at(MAX(drag_start.x, position.x));
				const int p0 = _pitch_at(MAX(drag_start.y, position.y)), p1 = _pitch_at(MIN(drag_start.y, position.y));
				selection = box_base;
				for (int index = 0; notes && index < notes->size(); index++) {
					const RetroSongNote &note = (*notes)[index];
					if (note.t + note.d > t0 && note.t < t1 && note.n >= p0 && note.n <= p1) {
						selection.insert(index);
					}
				}
			} break;
			case DRAG_RESIZE: {
				const double delta = (position.x - drag_start.x) / zoom_x;
				for (const Origin &origin : origins) {
					RetroSongNote &note = notes->write[origin.index];
					note.d = MAX(1, MIN(retro_snap_length(origin.d + delta, grid), length - note.t));
				}
				edited = true;
			} break;
			case DRAG_MOVE: {
				const double delta = (position.x - drag_start.x) / zoom_x;
				const int shift = int(Math::round(delta / grid)) * grid, rows = int(Math::round((drag_start.y - position.y) / row_height));
				int min_t = INT_MAX, max_end = 0, min_n = 127, max_n = 0;
				for (const Origin &origin : origins) {
					min_t = MIN(min_t, origin.t);
					max_end = MAX(max_end, origin.t + origin.d);
					min_n = MIN(min_n, origin.n);
					max_n = MAX(max_n, origin.n);
				}
				const int dt = MAX(-min_t, MIN(shift, length - max_end)), dn = MAX(-min_n, MIN(rows, 127 - max_n));
				for (const Origin &origin : origins) {
					RetroSongNote &note = notes->write[origin.index];
					if (origin.index == drag_target && note.n != origin.n + dn) {
						emit_signal(SNAME("preview_end"));
						emit_signal(SNAME("preview"), origin.n + dn, note.v);
					}
					if (note.t != origin.t + dt || note.n != origin.n + dn) {
						edited = true;
					}
					note.t = origin.t + dt;
					note.n = origin.n + dn;
				}
			} break;
		}
		queue_redraw();
		accept_event();
		return;
	}
	// ---- teclado ----
	const Ref<InputEventKey> key = p_event;
	if (key.is_null() || !key->is_pressed() || !notes) {
		return;
	}
	const Key code = key->get_keycode();
	if ((code == Key::KEY_DELETE || code == Key::BACKSPACE) && !selection.is_empty()) {
		_remove(selection);
	} else if (key->is_command_or_control_pressed() && code == Key::A) {
		selection.clear();
		for (int index = 0; index < notes->size(); index++) {
			selection.insert(index);
		}
	} else if (code == Key::ESCAPE && !selection.is_empty()) {
		selection.clear();
	} else if ((code == Key::UP || code == Key::DOWN) && !selection.is_empty()) {
		const int step = (code == Key::UP ? 1 : -1) * (key->is_shift_pressed() ? 12 : 1);
		bool fits = true;
		for (const int index : selection) {
			const int pitch = (*notes)[index].n + step;
			fits = fits && pitch >= 0 && pitch <= 127;
		}
		if (fits) {
			for (const int index : selection) {
				notes->write[index].n += step;
			}
			edited = true;
		}
	} else if ((code == Key::LEFT || code == Key::RIGHT) && !selection.is_empty()) {
		const int step = (code == Key::RIGHT ? 1 : -1) * grid;
		bool fits = true;
		for (const int index : selection) {
			const RetroSongNote &note = (*notes)[index];
			fits = fits && note.t + step >= 0 && note.t + note.d + step <= length;
		}
		if (fits) {
			for (const int index : selection) {
				notes->write[index].t += step;
			}
			edited = true;
		}
	} else if (key->is_command_or_control_pressed() && code == Key::D && !selection.is_empty()) {
		// Duplica a seleção logo depois dela.
		int start = INT_MAX, end = 0;
		for (const int index : selection) {
			start = MIN(start, (*notes)[index].t);
			end = MAX(end, (*notes)[index].t + (*notes)[index].d);
		}
		const int span = end - start;
		if (end + span <= length) {
			Vector<RetroSongNote> copies;
			for (const int index : selection) {
				RetroSongNote copy = (*notes)[index];
				copy.t += span;
				copies.push_back(copy);
			}
			selection.clear();
			for (const RetroSongNote &copy : copies) {
				selection.insert(notes->size());
				notes->push_back(copy);
			}
			edited = true;
		}
	} else {
		return;
	}
	_finish_edit();
	queue_redraw();
	accept_event();
}

void RetroPianoRoll::_notification(int p_what) {
	if (p_what == NOTIFICATION_RESIZED) {
		if (needs_reveal) {
			reveal();
		}
		_clamp_scroll();
		return;
	}
	if (p_what == NOTIFICATION_MOUSE_EXIT && hover >= 0) {
		hover = -1;
		queue_redraw();
		return;
	}
	if (p_what != NOTIFICATION_DRAW || !song) {
		return;
	}
	const Size2 size = get_size();
	const double w = size.x, h = size.y;
	const Color bg(0.09, 0.11, 0.13), panel(0.125, 0.145, 0.165), border(0.255, 0.275, 0.3), muted(0.655, 0.7, 0.725);
	const Ref<Font> font = get_theme_font(SceneStringName(font), SNAME("Label"));
	draw_rect(Rect2(0, 0, w, h), bg);
	const int top = MAX(0, 127 - int(Math::floor((h - RULER + scroll_y) / row_height)) - 1);
	const int bottom = MIN(127, 127 - int(Math::floor(scroll_y / row_height)) + 1);
	// Linhas das notas: teclas pretas mais escuras, divisa forte em cada C.
	for (int pitch = top; pitch <= bottom; pitch++) {
		const double y = _y_of(pitch);
		if (_black(pitch)) {
			draw_rect(Rect2(KEYS, y, w - KEYS, row_height), Color(0, 0, 0, 0.22));
		}
		if (pitch % 12 == 0) {
			draw_rect(Rect2(KEYS, y + row_height - 1, w - KEYS, 1), border);
		}
	}
	const int length = song->length();
	const int first = MAX(0, int(Math::floor(_tick_at(KEYS) / grid)) * grid);
	const double last = MIN(double(length), _tick_at(w));
	const int bar = SONG_PPQ * song->beats_per_bar;
	for (int tick = first; tick <= last; tick += grid) {
		const double x = Math::round(_x_of(tick)) + 0.5;
		const Color line = tick % bar == 0 ? Color(muted, 0.55) : (tick % SONG_PPQ == 0 ? border : Color(1, 1, 1, 0.05));
		draw_line(Vector2(x, RULER), Vector2(x, h), line);
	}
	// Fim da música.
	const double end_x = _x_of(length);
	if (end_x < w) {
		draw_rect(Rect2(end_x, RULER, w - end_x, h - RULER), Color(0, 0, 0, 0.45));
	}
	// Loop.
	if (song->has_loop) {
		draw_rect(Rect2(_x_of(song->loop_start), RULER, (song->loop_end - song->loop_start) * zoom_x, h - RULER), Color(0.357, 0.741, 0.647, 0.06));
	}
	// Outras faixas, apagadas.
	for (int index = 0; index < song->tracks.size(); index++) {
		if (index == track) {
			continue;
		}
		const Color color = Color(_color(index), 0.22);
		for (const RetroSongNote &note : song->tracks[index].notes) {
			const double x = _x_of(note.t), y = _y_of(note.n);
			if (x > w || x + note.d * zoom_x < KEYS || y > h || y + row_height < RULER) {
				continue;
			}
			draw_rect(Rect2(x, y + 1, MAX(2.0, note.d * zoom_x), row_height - 2), color);
		}
	}
	// Faixa atual: opacidade pela velocity, contorno nas selecionadas.
	const Color own = _color(track);
	const Vector<RetroSongNote> *notes = _notes();
	for (int index = 0; notes && index < notes->size(); index++) {
		const RetroSongNote &note = (*notes)[index];
		const double x = _x_of(note.t), width = MAX(3.0, note.d * zoom_x), y = _y_of(note.n);
		if (x > w || x + width < KEYS || y > h || y + row_height < RULER) {
			continue;
		}
		draw_rect(Rect2(x, y + 1, width, row_height - 2), Color(own, 0.45 + 0.55 * note.v / 127.0));
		if (selection.has(index)) {
			draw_rect(Rect2(x + 0.75, y + 1.75, width - 1.5, row_height - 3.5), Color(1, 1, 1), false, 1.5);
		} else {
			draw_rect(Rect2(x + width - 2, y + 1, 2, row_height - 2), Color(0, 0, 0, 0.35));
		}
		if (row_height >= 11 && width > 34) {
			draw_string(font, Vector2(x + 3, y + row_height - 3), retro_note_name(note.n), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(0, 0, 0, 0.75));
		}
	}
	if (drag == DRAG_BOX) {
		const Rect2 box = Rect2(drag_start, Vector2()).expand(box_end);
		draw_dashed_line(box.position, Vector2(box.get_end().x, box.position.y), own, 1, 4);
		draw_dashed_line(Vector2(box.get_end().x, box.position.y), box.get_end(), own, 1, 4);
		draw_dashed_line(box.get_end(), Vector2(box.position.x, box.get_end().y), own, 1, 4);
		draw_dashed_line(Vector2(box.position.x, box.get_end().y), box.position, own, 1, 4);
	}
	// Teclas do piano.
	for (int pitch = top; pitch <= bottom; pitch++) {
		const double y = _y_of(pitch);
		draw_rect(Rect2(0, y, KEYS, row_height), _black(pitch) ? Color(0.106, 0.118, 0.133) : Color(0.91, 0.91, 0.91));
		draw_rect(Rect2(0, y + row_height - 1, KEYS, 1), Color(0, 0, 0, 0.35));
		if (hover == pitch) {
			draw_rect(Rect2(0, y, KEYS, row_height), Color(0.357, 0.741, 0.647, 0.55));
		}
		if (pitch % 12 == 0 && row_height >= 9) {
			draw_string(font, Vector2(KEYS - 28, y + row_height - 2), retro_note_name(pitch), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(0.2, 0.2, 0.2));
		}
	}
	// Régua: compassos, loop, posição inicial.
	draw_rect(Rect2(0, 0, w, RULER), panel);
	draw_rect(Rect2(0, RULER - 1, w, 1), border);
	if (song->has_loop) {
		const double start = MAX(double(KEYS), _x_of(song->loop_start));
		draw_rect(Rect2(start, RULER - 7, MAX(0.0, _x_of(song->loop_end) - start), 6), Color(0.357, 0.741, 0.647, 0.35));
	}
	for (int tick = (first / bar) * bar; tick <= last; tick += bar) {
		const double x = _x_of(tick);
		if (x >= KEYS - 1) {
			draw_string(font, Vector2(x + 3, 15), itos(tick / bar + 1), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, muted);
		}
	}
	const Color marker(0.949, 0.82, 0.42);
	const double cx = _x_of(cursor);
	if (cx >= KEYS) {
		Vector<Vector2> triangle = { Vector2(cx - 5, RULER - 9), Vector2(cx + 5, RULER - 9), Vector2(cx, RULER - 1) };
		draw_colored_polygon(triangle, marker);
	}
	if (playing) {
		const double px = Math::round(_x_of(playhead)) + 0.5;
		if (px >= KEYS && px <= w) {
			draw_line(Vector2(px, 0), Vector2(px, h), marker);
		}
	}
	draw_rect(Rect2(0, 0, KEYS, RULER), panel);
}
