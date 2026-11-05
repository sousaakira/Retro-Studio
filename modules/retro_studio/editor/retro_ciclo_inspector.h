#pragma once

// Inspetor dos efeitos de paleta (MDCicloCores e MDCachoeira): no topo, as 4 paletas da cena em amostras.
// Clicar escolhe a paleta e a primeira cor; arrastar (ou Shift+clique) estende o trecho. Na MDCachoeira, os
// botões Água e Espuma dizem qual trecho o clique escolhe. As cores que os mapas usam embaixo da área do
// node ganham um ponto, e "Usar as cores da área" escolhe o trecho por elas. A prévia roda os efeitos como
// o jogo (MDEfeitoPaleta), 60 quadros por segundo.

#include "editor/inspector/editor_inspector.h"
#include "editor/plugins/editor_plugin.h"
#include "core/templates/hash_map.h"
#include "scene/resources/material.h"
#include "../scene/md_nodes.h"
#include "scene/gui/box_container.h"

struct MDEfeitoPaleta;
class MDMapa;
class Button;
class Label;
class Node2D;

class RetroCicloPanel : public VBoxContainer {
	GDCLASS(RetroCicloPanel, VBoxContainer);

public:
	// Estado da prévia de um efeito (como no jogo).
	struct Sim {
		Vector<Color> colors;
		int wait = 1, step = 0, dir = 1;
		bool lit = false;
	};

private:

	// Um trecho que o clique escolhe: as propriedades da primeira cor e da quantidade no node.
	struct Faixa {
		String label;
		StringName primeira, quantidade;
		StringName liga; // Propriedade que liga o trecho ao escolher (a espuma); vazio = sempre ligado.
		Color cor; // Moldura nas amostras.
	};


	ObjectID node_id;
	Vector<Faixa> faixas;
	int faixa = 0; // Trecho que o clique escolhe.
	static HashMap<ObjectID, int> faixa_do_node; // O Inspetor se refaz ao mudar propriedades: guarda a escolha.
	static ObjectID picking_node; // Node com o conta-gotas ligado (também sobrevive ao Inspetor se refazer).
	static String picked_text;
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
	void _picker_toggled(bool p_on);

	Button *picker = nullptr;
	Label *picked = nullptr;

protected:
	void _notification(int p_what);

public:
	static RetroCicloPanel *active; // O painel à vista (o conta-gotas da vista 2D fala com ele).
	static void scene_palettes(Node *p_root, Vector<Color> *r_palettes, String *r_sources);
	static void sim_reset(Sim &r_sim, const MDEfeitoPaleta &p_efeito, const Vector<Color> &p_palette);
	static bool sim_frame(Sim &r_sim, const MDEfeitoPaleta &p_efeito);
	// Número (1 a 15) da cor de p_palette (na grade do console) mais parecida com p_color; -1 sem cores.
	static int index_in(const Vector<Color> &p_palette, const Color &p_color);
	bool is_picking() const;
	void stop_picking();
	Color palette_color(int p_slot, int p_index) const; // Como o console mostra.
	// Conta-gotas: a cor no ponto da cena escolhe a primeira cor do trecho; com p_extend, estende o trecho até ela.
	void pick_at(const Vector2 &p_point, bool p_extend);
	// Cor e paleta do jogo dos mapas ou fundos no ponto da cena, de cima para baixo (plano A antes do B).
	static bool color_at(Node *p_root, const Vector2 &p_point, int &r_slot, Color &r_color);
	// Número da cor da paleta do jogo (1 a 15) mais parecida com p_color.
	int index_for(int p_slot, const Color &p_color) const;
	static MDMapa *plane_base(Node *p_root, int p_plano, int p_slot);
	static int plane_map_count(Node *p_root, int p_plano, int p_slot);
	static Vector<Color> plane_palette(Node *p_root, MDMapa *p_base);
	void setup(Node2D *p_node);
};

// Conta-gotas na vista 2D: com o botão do painel ligado, passar o mouse mostra a cor embaixo dele e clicar
// escolhe a cor no trecho do efeito (Shift+clique estende).
class RetroCicloPickerPlugin : public EditorPlugin {
	GDCLASS(RetroCicloPickerPlugin, EditorPlugin);

	bool hover_ok = false;
	int hover_slot = 0, hover_index = 0;
	Vector2 hover_pos;

	// Prévia das cores com o Animar ligado: os efeitos de paleta da cena rodam no editor e os mapas e fundos
	// trocam as cores por um shader posto direto no RenderingServer (nada vai para a cena salva).
	Ref<Shader> shader;
	HashMap<ObjectID, Ref<ShaderMaterial>> applied;
	ObjectID scene_id;
	String signature;
	double time = 0;
	Vector<Color> base[4];
	Vector<RetroCicloPanel::Sim> sims;
	Vector<MDEfeitoPaleta> efeitos;
	bool dirty = false;

	void _preview_tick(double p_delta);
	void _preview_apply(Node *p_root);
	void _preview_clear();

protected:
	void _notification(int p_what);

public:
	virtual String get_plugin_name() const override { return "RetroCicloPicker"; }
	virtual bool handles(Object *p_object) const override;
	virtual bool forward_canvas_gui_input(const Ref<InputEvent> &p_event) override;
	virtual void forward_canvas_draw_over_viewport(Control *p_overlay) override;
};

class RetroCicloInspector : public EditorInspectorPlugin {
	GDCLASS(RetroCicloInspector, EditorInspectorPlugin);

public:
	virtual bool can_handle(Object *p_object) override;
	virtual void parse_begin(Object *p_object) override;
};
