/**************************************************************************/
/*  editor_title_bar.h                                                    */
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

#pragma once

#include "scene/gui/box_container.h"
#include "servers/display/display_server_enums.h"

class EditorTitleBar : public HBoxContainer {
	GDCLASS(EditorTitleBar, HBoxContainer);

	Point2i click_pos;
	bool moving = false;
	bool can_move = false;
	bool own_frame = false; // Retro Studio: janela sem a barra do sistema (Linux); duplo clique maximiza.
	Control *center_control = nullptr;
	Control *end_control = nullptr;

protected:
	void _notification(int p_what);

	virtual void gui_input(const Ref<InputEvent> &p_event) override;
	static void _bind_methods() {}

public:
	void set_center_control(Control *p_center_control);
	Control *get_center_control() const;

	void set_can_move_window(bool p_enabled);
	bool get_can_move_window() const;
	void set_own_frame(bool p_enabled) { own_frame = p_enabled; }
	// Retro Studio: controle que fica sempre por último (botões da janela), mesmo com os
	// controles que os plugins acrescentam depois.
	void set_end_control(Control *p_control) { end_control = p_control; }
	void _keep_end_control_last();
};

// Retro Studio: faixa na borda da janela sem a barra do sistema; arrastar redimensiona pelo
// gerenciador de janelas (DisplayServer::window_start_resize), como a borda normal.
class EditorWindowResizeHandle : public Control {
	GDCLASS(EditorWindowResizeHandle, Control);

	DisplayServerEnums::WindowResizeEdge edge = DisplayServerEnums::WINDOW_EDGE_BOTTOM_RIGHT;

protected:
	static void _bind_methods() {}
	virtual void gui_input(const Ref<InputEvent> &p_event) override;

public:
	virtual CursorShape get_cursor_shape(const Point2 &p_pos = Point2i()) const override;
	// Ancora a faixa na borda ou no canto da janela.
	void setup(DisplayServerEnums::WindowResizeEdge p_edge, int p_thickness);
};
