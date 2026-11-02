#pragma once

// Animação dos sprites na vista 2D.
// - "Animar": os sprites com personagem tocam a animação deles no cenário, com o tempo de cada quadro
//   igual ao do jogo (também durante o play do AnimationPlayer). É só prévia: nada muda na cena.
// - "Ajustar": com um sprite selecionado, ←/→ trocam o quadro mostrado e o quadro é ajustado ali, no meio
//   do cenário: arrastar o desenho muda o ajuste fino do quadro; as bordas da caixa verde (corpo) e da
//   vermelha (ataque) mudam as caixas; + e − mudam o tempo do quadro. Tudo grava no personagem
//   (.charset.json), com desfazer, como no gestor de animações; vale para todas as cenas que o usam.
// - "#": escreve em cada célula dos mapas o número do tile no TileSet (linha × colunas + coluna, a partir
//   de 0), para ver na tela como os tiles estão ordenados. Só o mapa selecionado, ou todos os MDMapa.

#include "../scene/md_nodes.h"

#include "editor/plugins/editor_plugin.h"

class Button;
class HBoxContainer;
class Label;
class SpinBox;

class RetroSpriteCanvasPlugin : public EditorPlugin {
	GDCLASS(RetroSpriteCanvasPlugin, EditorPlugin);

	enum Arrasto {
		ARRASTO_NADA,
		ARRASTO_DESENHO, // Ajuste fino do quadro.
		ARRASTO_CORPO,
		ARRASTO_ATAQUE,
	};
	enum Borda {
		BORDA_ESQUERDA = 1,
		BORDA_DIREITA = 2,
		BORDA_CIMA = 4,
		BORDA_BAIXO = 8,
	};

	HBoxContainer *barra = nullptr;
	Button *animar = nullptr;
	Button *ajustar = nullptr;
	Button *numeros = nullptr;
	Label *info = nullptr;
	// Controles do ajuste pelo mouse: quadro anterior/seguinte, um botão por quadro e o tempo do quadro.
	HBoxContainer *controles = nullptr;
	Button *anterior = nullptr;
	Button *seguinte = nullptr;
	HBoxContainer *quadros = nullptr;
	SpinBox *tempo = nullptr;
	ObjectID sprite_id;

	Arrasto arrasto = ARRASTO_NADA;
	int bordas = 0; // Bordas arrastadas (0 = a caixa inteira).
	Vector2 arrasto_de; // Ponto local (pés = 0, 0) onde o arrasto começou.
	Vector2i aplicado; // Deslocamento já aplicado, em pixels.
	Dictionary antes; // Dados do personagem antes do arrasto.
	Vector2i ajuste_inicial;
	Rect2i caixa_inicial;

	MDSprite *_sprite() const;
	bool _pode_ajustar(MDSprite *p_sprite) const;
	Transform2D _tela(MDSprite *p_sprite) const;
	bool _ataque_visivel(MDSprite *p_sprite) const;
	int _bordas_em(const Rect2 &p_tela, const Vector2 &p_ponto) const;

	void _animar_alternado(bool p_ligado);
	void _ajustar_alternado(bool p_ligado);
	void _atualizar_processos(Node *p_node);
	void _atualizar_icones();
	void _atualizar_info();
	void _trocar_quadro(int p_passo);
	void _mudar_tempo(int p_passo);
	void _definir_tempo(int p_ticks);
	void _tempo_alterado(double p_valor);
	void _quadro_clicado(int p_quadro);
	Dictionary _editar(const Dictionary &p_dados, const Vector2i &p_delta) const;
	void _aplicar_dados(const Ref<MDPersonagem> &p_personagem, const Dictionary &p_dados);
	void _registrar(const String &p_nome, const Dictionary &p_antes, const Dictionary &p_depois, bool p_juntar);
	void _cancelar_arrasto();
	void _numeros_alternado(bool p_ligado);
	void _desenhar_numeros(Control *p_overlay, TileMapLayer *p_layer);

protected:
	static void _bind_methods();
	void _notification(int p_what);

public:
	virtual String get_plugin_name() const override { return "RetroSpriteCanvas"; }
	virtual bool handles(Object *p_object) const override;
	virtual void edit(Object *p_object) override;
	virtual void make_visible(bool p_visible) override;
	virtual bool forward_canvas_gui_input(const Ref<InputEvent> &p_event) override;
	virtual void forward_canvas_draw_over_viewport(Control *p_overlay) override;
	virtual void forward_canvas_force_draw_over_viewport(Control *p_overlay) override;

	RetroSpriteCanvasPlugin();
};
