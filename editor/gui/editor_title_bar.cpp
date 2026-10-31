/**************************************************************************/
/*  editor_title_bar.cpp                                                  */
/**************************************************************************/
/*                         This file is part of:                          */
/*                             GODOT ENGINE                               */
/*                        https://godotengine.org                         */
/**************************************************************************/
/* Copyright (c) 2014-present Godot Engine contributors (see AUTHORS.md). */
/* Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.                  */
/*                                                                        */
/* Permission is hereby granted, free of charge, to any person obtaining  */
/* a copy of this software and associated documentation files (the        */
/* "Software"), to deal in the Software without restriction, including    */
/* without limitation the rights to use, copy, modify, merge, publish,    */
/* distribute, sublicense, and/or sell copies of the Software, and to     */
/* permit persons to whom the Software is furnished to do so, subject to  */
/* the following conditions:                                              */
/*                                                                        */
/* The above copyright notice and this permission notice shall be         */
/* included in all copies or substantial portions of the Software.        */
/*                                                                        */
/* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,        */
/* EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF     */
/* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. */
/* IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY   */
/* CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,   */
/* TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE      */
/* SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.                 */
/**************************************************************************/

#include "editor_title_bar.h"

#include "core/object/callable_mp.h"
#include "scene/main/scene_tree.h"
#include "scene/main/window.h"
#include "servers/display/display_server.h"

void EditorTitleBar::gui_input(const Ref<InputEvent> &p_event) {
	if (!can_move) {
		return;
	}

	Ref<InputEventMouseMotion> mm = p_event;
	if (mm.is_valid() && moving) {
		if (mm->get_button_mask().has_flag(MouseButtonMask::LEFT)) {
			Window *w = Object::cast_to<Window>(get_viewport());
			if (w) {
				Point2 mouse = DisplayServer::get_singleton()->mouse_get_position();
				w->set_position(mouse - click_pos);
			}
		} else {
			moving = false;
		}
	}

	Ref<InputEventMouseButton> mb = p_event;
	if (mb.is_valid() && has_point(mb->get_position())) {
		Window *w = Object::cast_to<Window>(get_viewport());
		if (w) {
			if (mb->get_button_index() == MouseButton::LEFT) {
				if (mb->is_pressed()) {
					if (DisplayServer::get_singleton()->has_feature(DisplayServerEnums::FEATURE_WINDOW_DRAG)) {
						DisplayServer::get_singleton()->window_start_drag(w->get_window_id());
					} else {
						click_pos = DisplayServer::get_singleton()->mouse_get_position() - w->get_position();
						moving = true;
					}
				} else {
					moving = false;
				}
			}
			if (mb->get_button_index() == MouseButton::LEFT && mb->is_double_click() && mb->is_pressed()) {
				if (own_frame || DisplayServer::get_singleton()->window_maximize_on_title_dbl_click()) {
					if (w->get_mode() == Window::MODE_WINDOWED) {
						w->set_mode(Window::MODE_MAXIMIZED);
					} else if (w->get_mode() == Window::MODE_MAXIMIZED) {
						w->set_mode(Window::MODE_WINDOWED);
					}
				} else if (DisplayServer::get_singleton()->window_minimize_on_title_dbl_click()) {
					w->set_mode(Window::MODE_MINIMIZED);
				}
				moving = false;
			}
		}
	}
}

void EditorWindowResizeHandle::gui_input(const Ref<InputEvent> &p_event) {
	Ref<InputEventMouseButton> mb = p_event;
	if (mb.is_valid() && mb->is_pressed() && mb->get_button_index() == MouseButton::LEFT) {
		Window *w = Object::cast_to<Window>(get_viewport());
		if (w) {
			DisplayServer::get_singleton()->window_start_resize(edge, w->get_window_id());
		}
		accept_event();
	}
}

Control::CursorShape EditorWindowResizeHandle::get_cursor_shape(const Point2 &p_pos) const {
	switch (edge) {
		case DisplayServerEnums::WINDOW_EDGE_TOP:
		case DisplayServerEnums::WINDOW_EDGE_BOTTOM:
			return CURSOR_VSIZE;
		case DisplayServerEnums::WINDOW_EDGE_LEFT:
		case DisplayServerEnums::WINDOW_EDGE_RIGHT:
			return CURSOR_HSIZE;
		case DisplayServerEnums::WINDOW_EDGE_TOP_LEFT:
		case DisplayServerEnums::WINDOW_EDGE_BOTTOM_RIGHT:
			return CURSOR_FDIAGSIZE;
		default:
			return CURSOR_BDIAGSIZE;
	}
}

void EditorWindowResizeHandle::setup(DisplayServerEnums::WindowResizeEdge p_edge, int p_thickness) {
	edge = p_edge;
	set_mouse_filter(MOUSE_FILTER_STOP);
	const bool left = p_edge == DisplayServerEnums::WINDOW_EDGE_LEFT || p_edge == DisplayServerEnums::WINDOW_EDGE_TOP_LEFT || p_edge == DisplayServerEnums::WINDOW_EDGE_BOTTOM_LEFT;
	const bool right = p_edge == DisplayServerEnums::WINDOW_EDGE_RIGHT || p_edge == DisplayServerEnums::WINDOW_EDGE_TOP_RIGHT || p_edge == DisplayServerEnums::WINDOW_EDGE_BOTTOM_RIGHT;
	const bool top = p_edge == DisplayServerEnums::WINDOW_EDGE_TOP || p_edge == DisplayServerEnums::WINDOW_EDGE_TOP_LEFT || p_edge == DisplayServerEnums::WINDOW_EDGE_TOP_RIGHT;
	const bool bottom = p_edge == DisplayServerEnums::WINDOW_EDGE_BOTTOM || p_edge == DisplayServerEnums::WINDOW_EDGE_BOTTOM_LEFT || p_edge == DisplayServerEnums::WINDOW_EDGE_BOTTOM_RIGHT;
	const int corner = p_thickness * 3; // Cantos um pouco maiores: mais fáceis de pegar.
	// Horizontal: borda esquerda/direita é fina; topo/base ocupam a largura (menos os cantos).
	set_anchor(SIDE_LEFT, right ? 1.0 : 0.0);
	set_anchor(SIDE_RIGHT, left ? 0.0 : 1.0);
	set_anchor(SIDE_TOP, bottom ? 1.0 : 0.0);
	set_anchor(SIDE_BOTTOM, top ? 0.0 : 1.0);
	const bool corner_edge = (left || right) && (top || bottom);
	const int width = corner_edge ? corner : p_thickness;
	set_offset(SIDE_LEFT, right ? -width : (left ? 0 : corner));
	set_offset(SIDE_RIGHT, left ? width : (right ? 0 : -corner));
	set_offset(SIDE_TOP, bottom ? -width : (top ? 0 : corner));
	set_offset(SIDE_BOTTOM, top ? width : (bottom ? 0 : -corner));
}

void EditorTitleBar::_keep_end_control_last() {
	if (end_control && end_control->get_parent() == this && end_control->get_index() != get_child_count() - 1) {
		move_child(end_control, -1);
	}
}

void EditorTitleBar::set_center_control(Control *p_center_control) {
	center_control = p_center_control;
}

Control *EditorTitleBar::get_center_control() const {
	return center_control;
}

void EditorTitleBar::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_EXIT_TREE: {
			SceneTree::get_singleton()->get_root()->disconnect(SceneStringName(nonclient_window_input), callable_mp(this, &EditorTitleBar::gui_input));
			get_window()->set_nonclient_area(Rect2i());
		} break;
		case NOTIFICATION_ENTER_TREE: {
			SceneTree::get_singleton()->get_root()->connect(SceneStringName(nonclient_window_input), callable_mp(this, &EditorTitleBar::gui_input));
			[[fallthrough]];
		}
		case NOTIFICATION_RESIZED: {
			get_window()->set_nonclient_area(get_global_transform().xform(Rect2i(get_position(), get_size())));
		} break;
		case NOTIFICATION_CHILD_ORDER_CHANGED: {
			callable_mp(this, &EditorTitleBar::_keep_end_control_last).call_deferred();
		} break;
		case NOTIFICATION_SORT_CHILDREN: {
			if (!center_control) {
				break;
			}
			Control *prev = nullptr;
			Control *base = nullptr;
			Control *next = nullptr;

			bool rtl = is_layout_rtl();

			int start;
			int end;
			int delta;
			if (rtl) {
				start = get_child_count() - 1;
				end = -1;
				delta = -1;
			} else {
				start = 0;
				end = get_child_count();
				delta = +1;
			}

			for (int i = start; i != end; i += delta) {
				Control *c = as_sortable_control(get_child(i));
				if (!c) {
					continue;
				}
				if (base) {
					next = c;
					break;
				}
				if (c != center_control) {
					prev = c;
					continue;
				}
				base = c;
			}
			if (base && prev && next) {
				Size2i title_size = get_size();
				Size2i c_size = base->get_combined_minimum_size();

				int min_offset = prev->get_position().x + prev->get_combined_minimum_size().x;
				int max_offset = next->get_position().x + next->get_size().x - next->get_combined_minimum_size().x - c_size.x;

				int offset = (title_size.width - c_size.width) / 2;
				offset = CLAMP(offset, min_offset, max_offset);

				fit_child_in_rect(prev, Rect2i(prev->get_position().x, 0, offset - prev->get_position().x, title_size.height));
				fit_child_in_rect(base, Rect2i(offset, 0, c_size.width, title_size.height));
				fit_child_in_rect(next, Rect2i(offset + c_size.width, 0, next->get_position().x + next->get_size().x - (offset + c_size.width), title_size.height));
			}
		} break;
	}
}

void EditorTitleBar::set_can_move_window(bool p_enabled) {
	can_move = p_enabled;
	set_process_input(can_move);
}

bool EditorTitleBar::get_can_move_window() const {
	return can_move;
}
