#pragma once

// Inspetor do MDCicloCores: no topo, as 4 paletas da cena em amostras. Clicar escolhe a paleta e a
// primeira cor; arrastar (ou Shift+clique) estende o trecho. As cores que os mapas usam embaixo da área
// do node ganham um ponto, e "Usar as cores da área" escolhe o trecho por elas. Uma prévia mostra o
// efeito (ciclo, vai e volta ou piscar) no ritmo do jogo, 60 quadros por segundo.

#include "editor/inspector/editor_inspector.h"
#include "scene/gui/box_container.h"

class Button;
class Label;
class MDCicloCores;

class RetroCicloPanel : public VBoxContainer {
	GDCLASS(RetroCicloPanel, VBoxContainer);

	ObjectID node_id;
	Vector<Color> palettes[4]; // Como o console mostra (3 bits por canal).
	String sources[4]; // Quem define cada paleta.
	int counts[4][16] = {}; // Pixels de cada cor dos mapas embaixo da área.
	int area_palette = -1; // Paleta com mais pixels na área.
	String area_signature;

	Control *grid = nullptr;
	Control *preview = nullptr;
	Label *info = nullptr;
	Button *use_area = nullptr;

	// Seleção com o mouse: valores antes do arrasto, para o desfazer.
	bool dragging = false;
	int anchor = 0;
	int old_paleta = 0, old_primeira = 0, old_quantidade = 0;

	// Simulação do efeito (a mesma lógica do jogo).
	String sim_signature;
	double sim_time = 0;
	Vector<Color> sim_colors;
	int sim_wait = 0, sim_step = 0, sim_dir = 1;
	bool sim_lit = false;

	MDCicloCores *_node() const;
	void _load_palettes();
	void _scan_area();
	void _update_info();
	void _reset_simulation();
	void _simulate_frame();
	int _wait_off() const;
	bool _cell_at(const Vector2 &p_pos, int &r_row, int &r_col) const;
	void _set_range(int p_paleta, int p_primeira, int p_quantidade);
	void _commit_range(const String &p_action);
	void _grid_draw();
	void _grid_input(const Ref<InputEvent> &p_event);
	void _preview_draw();
	void _use_area_pressed();

protected:
	void _notification(int p_what);

public:
	void setup(MDCicloCores *p_node);
};

class RetroCicloInspector : public EditorInspectorPlugin {
	GDCLASS(RetroCicloInspector, EditorInspectorPlugin);

public:
	virtual bool can_handle(Object *p_object) override;
	virtual void parse_begin(Object *p_object) override;
};
