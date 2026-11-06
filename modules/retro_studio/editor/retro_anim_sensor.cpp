#include "retro_anim_sensor.h"

#include "../scene/md_nodes.h"
#include "core/input/input_event.h"
#include "core/object/callable_mp.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/scene/canvas_item_editor_plugin.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/label.h"

static String TXT(const char *p_text) {
	return String::utf8(p_text);
}

static bool tem_sensor(const MDAnimacaoCenario *p_node) {
	return p_node && (p_node->get_ativacao() == MDAnimacaoCenario::ATIVACAO_PROXIMIDADE || p_node->get_ativacao() == MDAnimacaoCenario::ATIVACAO_CONTATO);
}

MDAnimacaoCenario *RetroAnimSensorPlugin::_node() const {
	MDAnimacaoCenario *node = Object::cast_to<MDAnimacaoCenario>(ObjectDB::get_instance(node_id));
	return node && node->is_inside_tree() ? node : nullptr;
}

Transform2D RetroAnimSensorPlugin::_to_screen() const {
	MDAnimacaoCenario *node = _node();
	return node ? CanvasItemEditor::get_singleton()->get_canvas_transform() * node->get_global_transform() : Transform2D();
}

// Cantos e meios dos lados, no espaço do node: 0 1 2 em cima, 3 e 4 nos lados, 5 6 7 embaixo.
Vector<Vector2> RetroAnimSensorPlugin::_handles(const Rect2 &p_rect) const {
	const Vector2 a = p_rect.position, b = p_rect.get_end(), m = p_rect.get_center();
	return { a, Vector2(m.x, a.y), Vector2(b.x, a.y), Vector2(a.x, m.y), Vector2(b.x, m.y), Vector2(a.x, b.y), Vector2(m.x, b.y), b };
}

int RetroAnimSensorPlugin::_handle_at(const Vector2 &p_screen) const {
	MDAnimacaoCenario *node = _node();
	if (!tem_sensor(node)) {
		return -1;
	}
	const Transform2D xf = _to_screen();
	const Rect2 rect = Rect2(node->get_area_ativacao());
	const Vector<Vector2> points = _handles(rect);
	for (int i = 0; i < points.size(); i++) {
		if (xf.xform(points[i]).distance_to(p_screen) <= 6 * EDSCALE) {
			return i;
		}
	}
	// Dentro do sensor, só a faixa da borda move o sensor inteiro (o meio fica para selecionar e mover o node).
	const Vector2 local = xf.affine_inverse().xform(p_screen);
	const float margin = 4 * EDSCALE / MAX(0.01f, xf.get_scale().x);
	if (rect.grow(margin).has_point(local) && !rect.grow(-margin).has_point(local)) {
		return 8;
	}
	return -1;
}

bool RetroAnimSensorPlugin::handles(Object *p_object) const {
	return Object::cast_to<MDAnimacaoCenario>(p_object) != nullptr;
}

void RetroAnimSensorPlugin::edit(Object *p_object) {
	MDAnimacaoCenario *node = Object::cast_to<MDAnimacaoCenario>(p_object);
	node_id = node ? node->get_instance_id() : ObjectID();
	drag = -1;
	update_overlays();
}

void RetroAnimSensorPlugin::make_visible(bool p_visible) {
	if (!p_visible) {
		node_id = ObjectID();
		drag = -1;
	}
	update_overlays();
}

bool RetroAnimSensorPlugin::forward_canvas_gui_input(const Ref<InputEvent> &p_event) {
	MDAnimacaoCenario *node = _node();
	if (!tem_sensor(node)) {
		return false;
	}
	const Ref<InputEventMouseButton> mb = p_event;
	if (mb.is_valid() && mb->get_button_index() == MouseButton::LEFT) {
		if (mb->is_pressed()) {
			const int handle = _handle_at(mb->get_position());
			if (handle < 0) {
				return false;
			}
			drag = handle;
			drag_rect = node->get_area_ativacao();
			drag_from = _to_screen().affine_inverse().xform(mb->get_position());
			return true;
		}
		if (drag >= 0) {
			drag = -1;
			const Rect2i now = node->get_area_ativacao();
			if (now != drag_rect) {
				EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
				undo->create_action(TXT("Ajustar o sensor da animação de cenário"));
				undo->add_do_method(node, "set_area_ativacao", now);
				undo->add_undo_method(node, "set_area_ativacao", drag_rect);
				undo->add_do_method(this, "update_overlays");
				undo->add_undo_method(this, "update_overlays");
				undo->commit_action(false); // Já está aplicado (o arrasto mostra ao vivo).
			}
			return true;
		}
		return false;
	}
	const Ref<InputEventMouseMotion> mm = p_event;
	if (mm.is_valid() && drag >= 0) {
		const Vector2 local = _to_screen().affine_inverse().xform(mm->get_position());
		const Vector2i delta = Vector2i((local - drag_from).round());
		Vector2i a = drag_rect.position, b = drag_rect.get_end();
		if (drag == 8) {
			a += delta;
			b += delta;
		} else {
			if (drag == 0 || drag == 3 || drag == 5) {
				a.x = MIN(a.x + delta.x, b.x - 1);
			}
			if (drag == 2 || drag == 4 || drag == 7) {
				b.x = MAX(b.x + delta.x, a.x + 1);
			}
			if (drag <= 2) {
				a.y = MIN(a.y + delta.y, b.y - 1);
			}
			if (drag >= 5) {
				b.y = MAX(b.y + delta.y, a.y + 1);
			}
		}
		node->set_area_ativacao(Rect2i(a, b - a));
		update_overlays();
		return true;
	}
	if (mm.is_valid()) {
		const int handle = _handle_at(mm->get_position());
		CanvasItemEditor::get_singleton()->get_viewport_control()->set_default_cursor_shape(handle == 8 ? Control::CURSOR_MOVE : handle >= 0 ? Control::CURSOR_CROSS : Control::CURSOR_ARROW);
	}
	return false;
}

void RetroAnimSensorPlugin::forward_canvas_draw_over_viewport(Control *p_overlay) {
	MDAnimacaoCenario *node = _node();
	if (!tem_sensor(node)) {
		return;
	}
	const Transform2D xf = _to_screen();
	const Color laranja(1.0, 0.6, 0.15);
	auto contorno = [&](const Rect2 &p_rect, const Color &p_color, float p_dash) {
		const Vector2 c[5] = { p_rect.position, Vector2(p_rect.get_end().x, p_rect.position.y), p_rect.get_end(), Vector2(p_rect.position.x, p_rect.get_end().y), p_rect.position };
		for (int k = 0; k < 4; k++) {
			p_overlay->draw_dashed_line(xf.xform(c[k]), xf.xform(c[k + 1]), p_color, 1.5 * EDSCALE, p_dash * EDSCALE);
		}
	};
	const Rect2 sensor = Rect2(node->get_area_ativacao());
	// Proximidade: a distância em volta, mais clara.
	if (node->get_ativacao() == MDAnimacaoCenario::ATIVACAO_PROXIMIDADE && node->get_distancia_ativacao() > 0) {
		contorno(Rect2(node->sensor_efetivo()), Color(laranja, 0.45), 2);
	}
	Vector<Vector2> quad;
	for (const Vector2 &p : { sensor.position, Vector2(sensor.get_end().x, sensor.position.y), sensor.get_end(), Vector2(sensor.position.x, sensor.get_end().y) }) {
		quad.push_back(xf.xform(p));
	}
	p_overlay->draw_colored_polygon(quad, Color(laranja, 0.12));
	contorno(sensor, laranja, 5);
	for (const Vector2 &p : _handles(sensor)) {
		const Vector2 s = xf.xform(p);
		p_overlay->draw_rect(Rect2(s - Vector2(4, 4) * EDSCALE, Vector2(8, 8) * EDSCALE), laranja);
		p_overlay->draw_rect(Rect2(s - Vector2(4, 4) * EDSCALE, Vector2(8, 8) * EDSCALE), Color(0, 0, 0, 0.8), false, 1);
	}
	const Ref<Font> font = p_overlay->get_theme_font(SceneStringName(font), SNAME("Label"));
	const int size = p_overlay->get_theme_font_size(SceneStringName(font_size), SNAME("Label"));
	p_overlay->draw_string(font, xf.xform(sensor.position) + Vector2(2, -4) * EDSCALE, node->get_ativacao() == MDAnimacaoCenario::ATIVACAO_CONTATO ? TXT("sensor (contato)") : TXT("sensor (proximidade)"), HORIZONTAL_ALIGNMENT_LEFT, -1, size, laranja);
}

RetroAnimSensorPlugin::RetroAnimSensorPlugin() {
	Ref<RetroAnimSensorInspector> inspector;
	inspector.instantiate();
	add_inspector_plugin(inspector);
}

// ---- Inspetor: simular a ativação na prévia ----

bool RetroAnimSensorInspector::can_handle(Object *p_object) {
	return Object::cast_to<MDAnimacaoCenario>(p_object) != nullptr;
}

void RetroAnimSensorInspector::parse_begin(Object *p_object) {
	MDAnimacaoCenario *node = Object::cast_to<MDAnimacaoCenario>(p_object);
	if (!node || !node->tem_gatilho()) {
		return;
	}
	VBoxContainer *box = memnew(VBoxContainer);
	Label *title = memnew(Label);
	title->set_text(TXT("Prévia da ativação (com o Animar ligado)"));
	title->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	box->add_child(title);
	HBoxContainer *row = memnew(HBoxContainer);
	box->add_child(row);
	const ObjectID id = node->get_instance_id();
	Button *toque = memnew(Button);
	toque->set_text(TXT("Encostar"));
	toque->set_tooltip_text(TXT("Um quadro de ativação, como um ator passando: anima o ciclo e os ciclos depois (ciclos_apos_sair) e volta ao repouso. Só na prévia; a cena não muda."));
	toque->connect(SceneStringName(pressed), callable_mp_static(+[](ObjectID p_id) {
		if (MDAnimacaoCenario *n = Object::cast_to<MDAnimacaoCenario>(ObjectDB::get_instance(p_id))) {
			n->simular_toque();
		}
	}).bind(id));
	row->add_child(toque);
	Button *segurar = memnew(Button);
	segurar->set_text(TXT("Segurar"));
	segurar->set_toggle_mode(true);
	segurar->set_pressed_no_signal(node->simulando_segurar());
	segurar->set_tooltip_text(TXT("Enquanto ligado, é como um ator dentro do sensor (ou anim_cenario_sustentar no código). Ao soltar, termina o ciclo e os ciclos depois. Só na prévia."));
	segurar->connect(SceneStringName(toggled), callable_mp_static(+[](bool p_on, ObjectID p_id) {
		if (MDAnimacaoCenario *n = Object::cast_to<MDAnimacaoCenario>(ObjectDB::get_instance(p_id))) {
			n->simular_segurar(p_on);
		}
	}).bind(id));
	row->add_child(segurar);
	Button *reiniciar = memnew(Button);
	reiniciar->set_text(TXT("Repouso"));
	reiniciar->set_tooltip_text(TXT("Volta a prévia ao repouso (quadro_repouso)."));
	reiniciar->connect(SceneStringName(pressed), callable_mp_static(+[](ObjectID p_id, Button *p_segurar) {
		if (MDAnimacaoCenario *n = Object::cast_to<MDAnimacaoCenario>(ObjectDB::get_instance(p_id))) {
			n->simular_reiniciar();
			n->queue_redraw();
		}
		p_segurar->set_pressed_no_signal(false);
	}).bind(id, segurar));
	row->add_child(reiniciar);
	add_custom_control(box);
}
