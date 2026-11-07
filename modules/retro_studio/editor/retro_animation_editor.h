#pragma once

// Gestor de animações: tela principal "Animações", aberta ao editar um .charset.json (MDPersonagem).
// À esquerda as animações; no centro a folha, com os recortes da animação (arrastar move, o canto
// redimensiona), e a linha do tempo; à direita a prévia tocando no tempo do console, com os pés
// (clique marca), as caixas de corpo e ataque e os campos da animação e do quadro. Grava no mesmo
// .charset.json do Retro Studio em Electron; os nodes que usam o personagem se atualizam na hora.

#include "../scene/md_personagem.h"
#include "editor/plugins/editor_plugin.h"
#include "core/object/undo_redo.h"
#include "scene/gui/box_container.h"

class Button;
class CheckBox;
class EditorFileDialog;
class OptionButton;
class ItemList;
class Label;
class LineEdit;
class SpinBox;
class AudioStreamPlayer;
class Texture2D;
class Window;
class MenuButton;
class ConfirmationDialog;

class RetroAnimationEditor : public VBoxContainer {
	GDCLASS(RetroAnimationEditor, VBoxContainer);

	friend class RetroSheetView;
	friend class RetroAnimationPreview;

	enum Campo {
		CAMPO_FPS,
		CAMPO_TEMPO,
		CAMPO_APOIO_X,
		CAMPO_APOIO_Y,
		CAMPO_AJUSTE_X,
		CAMPO_AJUSTE_Y,
		CAMPO_RECORTE_X,
		CAMPO_RECORTE_Y,
		CAMPO_RECORTE_L,
		CAMPO_RECORTE_A,
		CAMPO_CORPO_X,
		CAMPO_CORPO_Y,
		CAMPO_CORPO_L,
		CAMPO_CORPO_A,
		CAMPO_ATAQUE_X,
		CAMPO_ATAQUE_Y,
		CAMPO_ATAQUE_L,
		CAMPO_ATAQUE_A,
		CAMPO_ATAQUE_DE,
		CAMPO_ATAQUE_ATE,
		CAMPO_DANO_X,
		CAMPO_DANO_Y,
		CAMPO_DANO_L,
		CAMPO_DANO_A,
		CAMPO_MAX,
	};

	Ref<MDPersonagem> personagem;
	Dictionary data; // Cópia de trabalho do JSON (a mesma que o personagem lê).
	String saved_json; // Como está no disco, para saber se há mudanças.
	int current_anim = -1; // Índice em data["animations"].
	int current_frame = 0; // Quadro em edição.
	int play_frame = 0; // Quadro na prévia, enquanto toca.
	bool updating = false;
	bool playing = true;
	double play_ticks = 0;
	HashMap<String, Ref<Texture2D>> sheets; // Folha (res://) → textura.
	HashMap<String, Ref<Image>> sheet_images; // Folha (res://) → pixels RGBA, para recortar.
	String shown_source; // Folha mostrada no centro (res://).
	Rect2i selection; // Seleção na folha mostrada (tamanho 0 = nenhuma).

public:
	// Onde as setas do teclado agem: a área clicada por último.
	enum TecladoAlvo {
		TECLADO_PREVIA, // Ajuste fino do quadro.
		TECLADO_FOLHA, // Seleção, ou o recorte do quadro em edição.
	};

private:
	TecladoAlvo key_target = TECLADO_PREVIA;
	void _set_key_target(TecladoAlvo p_target);

	enum AcaoSelecao {
		SELECAO_ADICIONAR,
		SELECAO_SUBSTITUIR,
		SELECAO_SEPARAR,
		SELECAO_GRADE,
		SELECAO_MAX,
	};
	enum CampoGrade {
		GRADE_LARGURA,
		GRADE_ALTURA,
		GRADE_ESPACO_X,
		GRADE_ESPACO_Y,
		GRADE_MAX,
	};

	Label *title = nullptr;
	Label *info = nullptr;
	Button *save_button = nullptr;
	Label *empty_label = nullptr;
	Control *body = nullptr;
	ItemList *anim_list = nullptr;
	Control *sheet_view = nullptr;
	ItemList *timeline = nullptr;
	Control *preview = nullptr;
	Button *play_button = nullptr;
	OptionButton *reference_option = nullptr; // Quadro mostrado por baixo, para alinhar.
	OptionButton *click_option = nullptr; // O que o clique na prévia marca: pés, corpo ou ataque.
	LineEdit *name_edit = nullptr;
	CheckBox *loop_check = nullptr;
	CheckBox *attack_check = nullptr;
	CheckBox *hurt_check = nullptr; // Caixa de dano própria (senão, o corpo).
	void _hurt_toggled(bool p_on);
	void _hurt_from_body();
	Label *mode_label = nullptr;
	SpinBox *fields[CAMPO_MAX] = {};
	OptionButton *sheet_option = nullptr;
	EditorFileDialog *sheet_dialog = nullptr;
	Label *selection_label = nullptr;
	Button *selection_buttons[SELECAO_MAX] = {};
	SpinBox *grid_fields[GRADE_MAX] = {};
	Label *grid_count = nullptr;
	Label *offset_label = nullptr; // Ajuste fino do quadro em edição.
	// Evento do quadro: som tocado quando o quadro entra (no jogo e na prévia).
	LineEdit *event_edit = nullptr; // Evento do quadro (quadro_evento no código do MDAtor).
	void _event_changed(const String &p_text);
	void _event_focus_exited();
	OptionButton *sound_option = nullptr;
	Button *sound_listen = nullptr;
	AudioStreamPlayer *sound_player = nullptr;
	PackedStringArray sound_files; // .wav do projeto, na ordem do sound_option (depois de "nenhum").
	void _refresh_sounds();
	void _sound_chosen(int p_index);
	void _play_sound(const String &p_path);
	Control *form_box = nullptr;
	Label *no_animation_label = nullptr;

	// Prévia: zoom, espelho, velocidade e opacidade da referência.
	Label *zoom_label = nullptr;
	Button *flip_button = nullptr;
	OptionButton *speed_option = nullptr;
	SpinBox *reference_alpha = nullptr;
	double _speed() const;
	void _zoom_step(int p_direction);
	void _zoom_fit();
	void _refresh_zoom_label();
	void _step_frame(int p_direction); // Quadro anterior/seguinte (pausa a prévia).
	void _flip_toggled(bool p_on);

	// Fila de quadros: trecho escolhido com Shift+clique (ou Ctrl+clique), arrastar reordena.
	int range_from = -1, range_to = -1; // Trecho (inclusivo); -1 = só o quadro em edição.
	bool range_pending = false;
	void _frame_range(int &r_from, int &r_to) const;
	void _timeline_multi(int p_index, bool p_selected);
	void _timeline_range_update();
	Variant _timeline_drag(const Point2 &p_point);
	bool _timeline_can_drop(const Point2 &p_point, const Variant &p_data) const;
	void _timeline_drop(const Point2 &p_point, const Variant &p_data);
	OptionButton *nudge_scope = nullptr; // Ajuste fino: este quadro, o trecho ou a animação.
	SpinBox *repeat_times = nullptr;
	Label *repeat_label = nullptr;
	Button *repeat_button = nullptr;
	void _refresh_repeat();
	void _repeat_range();
	void _use_fps();
	void _move_animation(int p_direction);

	// Folha: grade de referência por cima, guias das réguas (por folha, gravadas no projeto), encaixe e medida.
	OptionButton *sheet_grid_option = nullptr;
	Vector<int> guides[2]; // 0 = guias verticais (x), 1 = horizontais (y), em pixels da folha.
	String guides_sheet; // Folha das guias carregadas.
	Button *snap_button = nullptr;
	Button *measure_button = nullptr;
	bool has_measure = false;
	Vector2i measure_from, measure_to;
	Button *measure_gap[2] = {};
	void _load_guides();
	void _save_guides();
	void _clear_guides();
	void _refresh_measure();
	void _measure_to_gap(int p_axis);
	void _measure_toggled(bool p_on);
	SpinBox *selection_fields[4] = {}; // X, Y, largura e altura da seleção.
	void _selection_field_changed(double p_value, int p_field);
	void _edge(int p_side, int p_amount); // Recua (−) ou expande (+) uma borda do recorte, sem mexer na pose.
	void _edge_button(int p_code); // lado * 2 + (0 recuar, 1 expandir).

	// Lista de animações filtrada pela busca; o metadado de cada item é o índice da animação.
	LineEdit *anim_filter = nullptr;
	void _filter_changed(const String &p_text);

	// Personagem: duplicar, excluir (vai para a lixeira) e mostrar no Sistema de Arquivos.
	MenuButton *character_menu = nullptr;
	ConfirmationDialog *delete_dialog = nullptr;
	void _character_menu(int p_id);
	void _duplicate_character();
	void _delete_character();

	// Janela separada (como o compositor de músicas) ou encaixado na tela principal Animações.
	Window *window = nullptr;
	Control *placeholder = nullptr;
	Button *window_button = nullptr;
	bool separate = true;
	bool screen_visible = false;
	void _place();
	void _show_window();
	void _window_closed();
	void _toggle_separate();

	Array _animations() const;
	Dictionary _anim() const;
	const MDPersonagem::Animacao *_parsed() const;
	Ref<Texture2D> _sheet(const String &p_path);
	Ref<Image> _sheet_image(const String &p_path);
	String _shown_sheet() const;
	String _source_id_of(const String &p_path) const;
	Dictionary _frame_dict(const Rect2i &p_rect, const String &p_source_id);
	void _add_animation(const String &p_base_name, Dictionary p_anim);
	Rect2i _grid_cells(Vector2i &r_size, Vector2i &r_gap, Vector2i &r_count) const;
	Array _ensure_free(Dictionary p_anim);
	// Estado para desfazer: o JSON, a seleção na folha e a animação/quadro em edição.
	Dictionary _state() const;
	void _before_edit(Dictionary &r_before) const { r_before = _state(); }
	void _apply();
	bool applying = false; // O próprio gestor está gravando no personagem.
	void _on_external_change();
	void _commit(const String &p_name, const Dictionary &p_before, bool p_merge = false);
	void _restore(const Dictionary &p_state);
	UndoRedo *history = nullptr; // Histórico próprio do gestor (não se mistura com o da cena).
	Button *undo_button = nullptr;
	Button *redo_button = nullptr;
	void _undo();
	void _redo();
	void _refresh_history();

	void _refresh();
	void _refresh_list();
	void _refresh_timeline();
	void _refresh_fields();
	void _anim_selected(int p_index);
	void _frame_selected(int p_index);
	void _name_changed(const String &p_name);
	void _name_focus_exited();
	void _loop_toggled(bool p_on);
	void _attack_toggled(bool p_on);
	void _field_changed(double p_value, int p_field);
	void _new_animation();
	void _duplicate_animation();
	void _remove_animation();
	void _frame_action(int p_action);
	void _toggle_play();
	void _save();

	// Folhas e seleção.
	void _refresh_sheets();
	void _sheet_chosen(int p_index);
	void _add_sheet();
	void _sheet_file_chosen(const String &p_path);
	void _set_selection(const Rect2i &p_rect, bool p_reset_grid = true);
	void _refresh_selection();
	void _grid_changed(double p_value);
	void _selection_action(int p_action);
	Rect2i _detect_sprite(const Vector2i &p_point);
	Vector<Rect2i> _split_selection();

	// Usados pela folha e pela prévia.
	void _set_frame_rect(int p_frame, const Rect2i &p_rect, const Vector2i &p_anchor = Vector2i(-1, -1));
	void _set_frame_anchor(const Vector2i &p_anchor);
	void _set_box(int p_kind, const Rect2i &p_box); // 1 = corpo, 2 = ataque, 3 = dano (relativas aos pés).
	void _nudge(const Vector2i &p_delta); // Ajuste fino do quadro em edição.
	void _nudge_button(int p_direction); // 0 esquerda, 1 cima, 2 baixo, 3 direita.
	const MDPersonagem::Quadro *_reference_frame() const;
	void _refresh_references();

protected:
	void _notification(int p_what);
	static void _bind_methods();

public:
	virtual void input(const Ref<InputEvent> &p_event) override;
	void edit(const Ref<MDPersonagem> &p_personagem);
	bool has_unsaved_changes() const;
	void save_if_changed();
	String get_edited_path() const;
	void setup_window(); // Cria a janela separada e o aviso na tela principal (depois de pôr o editor nela).
	void set_screen_visible(bool p_visible); // A tela principal Animações apareceu ou sumiu.
	// Cria um personagem vazio com a folha (ao lado dela) e devolve o caminho; vazio se falhar.
	static String create_character(const String &p_sheet, String &r_error);

	RetroAnimationEditor();
	~RetroAnimationEditor();
};

class RetroAnimationPlugin : public EditorPlugin {
	GDCLASS(RetroAnimationPlugin, EditorPlugin);

	RetroAnimationEditor *editor = nullptr;

public:
	virtual String get_plugin_name() const override;
	virtual const Ref<Texture2D> get_plugin_icon() const override;
	virtual bool has_main_screen() const override { return true; }
	virtual void make_visible(bool p_visible) override;
	virtual void edit(Object *p_object) override;
	virtual bool handles(Object *p_object) const override;
	virtual String get_unsaved_status(const String &p_for_scene) const override;
	virtual void save_external_data() override;

	RetroAnimationPlugin();
};
