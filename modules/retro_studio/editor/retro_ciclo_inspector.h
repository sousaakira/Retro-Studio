#pragma once

// Inspetor dos efeitos de paleta (MDCicloCores e MDCachoeira): no topo, as 4 paletas da cena em amostras.
// Clicar escolhe a paleta e a primeira cor; arrastar (ou Shift+clique) estende o trecho. Na MDCachoeira, os
// botões Água e Espuma dizem qual trecho o clique escolhe. As cores que os mapas usam embaixo da área do
// node ganham um ponto, e "Usar as cores da área" escolhe o trecho por elas. A prévia roda os efeitos como
// o jogo (MDEfeitoPaleta), 60 quadros por segundo.

#include "editor/inspector/editor_inspector.h"
#include "core/templates/hash_map.h"
#include "scene/gui/box_container.h"

struct MDEfeitoPaleta;
class Button;
class Label;
class Node2D;

class RetroCicloPanel : public VBoxContainer {
	GDCLASS(RetroCicloPanel, VBoxContainer);

	// Um trecho que o clique escolhe: as propriedades da primeira cor e da quantidade no node.
	struct Faixa {
		String label;
		StringName primeira, quantidade;
		StringName liga; // Propriedade que liga o trecho ao escolher (a espuma); vazio = sempre ligado.
		Color cor; // Moldura nas amostras.
	};

	// Estado da prévia de um efeito (como no jogo).
	struct Sim {
		Vector<Color> colors;
		int wait = 1, step = 0, dir = 1;
		bool lit = false;
	};

	ObjectID node_id;
	Vector<Faixa> faixas;
	int faixa = 0; // Trecho que o clique escolhe.
	static HashMap<ObjectID, int> faixa_do_node; // O Inspetor se refaz ao mudar propriedades: guarda a escolha.
	Vector<Color> palettes[4]; // Como o console mostra (3 bits por canal).
	String sources[4]; // Quem define cada paleta.
	int counts[4][16] = {}; // Pixels de cada cor dos mapas embaixo da área.
	int area_palette = -1; // Paleta com mais pixels na área.
	String area_signature;

	Control *grid = nullptr;
	Control *preview = nullptr;
	Label *info = nullptr;
	Button *use_area = nullptr;
	Vector<Button *> faixa_buttons;

	// Seleção com o mouse: valores antes do arrasto, para o desfazer.
	bool dragging = false;
	int anchor = 0;
	Dictionary old_values;

	// Prévia.
	String sim_signature;
	double sim_time = 0;
	Vector<Sim> sims;

	Node2D *_node() const;
	Vector<MDEfeitoPaleta> _efeitos() const;
	int _paleta() const;
	int _primeira(int p_faixa) const;
	int _quantidade(int p_faixa) const;
	void _load_palettes();
	void _scan_area();
	void _update_info();
	void _reset_simulation();
	void _simulate_frame();
	static int _wait_off(const MDEfeitoPaleta &p_efeito);
	bool _cell_at(const Vector2 &p_pos, int &r_row, int &r_col) const;
	void _remember();
	void _set_range(int p_paleta, int p_primeira, int p_quantidade);
	void _commit_range(const String &p_action);
	void _select_faixa(int p_faixa);
	void _grid_draw();
	void _grid_input(const Ref<InputEvent> &p_event);
	void _preview_draw();
	void _use_area_pressed();

protected:
	void _notification(int p_what);

public:
	void setup(Node2D *p_node);
};

class RetroCicloInspector : public EditorInspectorPlugin {
	GDCLASS(RetroCicloInspector, EditorInspectorPlugin);

public:
	virtual bool can_handle(Object *p_object) override;
	virtual void parse_begin(Object *p_object) override;
};
