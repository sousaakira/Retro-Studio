#pragma once

// MDAnimacaoCenario no editor: o sensor (area_ativacao) aparece em laranja na vista 2D com o node selecionado, com
// alças para mover e redimensionar (com desfazer); a área animada continua verde e se ajusta pela ferramenta de
// seleção. No Inspetor, botões simulam a ativação na prévia do Animar (um toque ou um ator parado no sensor), sem
// mudar nada na cena salva.

#include "editor/inspector/editor_inspector.h"
#include "editor/plugins/editor_plugin.h"

class MDAnimacaoCenario;

class RetroAnimSensorPlugin : public EditorPlugin {
	GDCLASS(RetroAnimSensorPlugin, EditorPlugin);

	ObjectID node_id;
	int drag = -1; // Alça arrastada: 0 a 7 (cantos e lados) ou 8 (o sensor inteiro); -1 = nenhuma.
	Vector2 drag_from; // Ponto do mouse no espaço do node quando o arrasto começou.
	Rect2i drag_rect; // Sensor antes do arrasto (para o desfazer).

	MDAnimacaoCenario *_node() const;
	Transform2D _to_screen() const;
	Vector<Vector2> _handles(const Rect2 &p_rect) const;
	int _handle_at(const Vector2 &p_screen) const;

public:
	virtual String get_plugin_name() const override { return "RetroAnimSensor"; }
	virtual bool handles(Object *p_object) const override;
	virtual void edit(Object *p_object) override;
	virtual void make_visible(bool p_visible) override;
	virtual bool forward_canvas_gui_input(const Ref<InputEvent> &p_event) override;
	virtual void forward_canvas_draw_over_viewport(Control *p_overlay) override;

	RetroAnimSensorPlugin();
};

class RetroAnimSensorInspector : public EditorInspectorPlugin {
	GDCLASS(RetroAnimSensorInspector, EditorInspectorPlugin);

public:
	virtual bool can_handle(Object *p_object) override;
	virtual void parse_begin(Object *p_object) override;
};
