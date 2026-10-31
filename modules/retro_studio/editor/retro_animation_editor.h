#pragma once

// Gestor de animações: tela principal "Animações", aberta ao editar um .charset.json (MDPersonagem).
// À esquerda as animações; no centro a folha, com os recortes da animação (arrastar move, o canto
// redimensiona), e a linha do tempo; à direita a prévia tocando no tempo do console, com os pés
// (clique marca), as caixas de corpo e ataque e os campos da animação e do quadro. Grava no mesmo
// .charset.json do Retro Studio em Electron; os nodes que usam o personagem se atualizam na hora.

#include "../scene/md_personagem.h"
#include "editor/plugins/editor_plugin.h"
#include "scene/gui/box_container.h"

class Button;
class CheckBox;
class EditorFileDialog;
class OptionButton;
class ItemList;
class Label;
class LineEdit;
class SpinBox;
class Texture2D;

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
	Label *mode_label = nullptr;
	SpinBox *fields[CAMPO_MAX] = {};
	OptionButton *sheet_option = nullptr;
	EditorFileDialog *sheet_dialog = nullptr;
	Label *selection_label = nullptr;
	Button *selection_buttons[SELECAO_MAX] = {};
	SpinBox *grid_fields[GRADE_MAX] = {};
	Label *grid_count = nullptr;
	Control *form_box = nullptr;
	Label *no_animation_label = nullptr;

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
	void _before_edit(Dictionary &r_before) const { r_before = data.duplicate(true); }
	void _apply();
	void _commit(const String &p_name, const Dictionary &p_before, bool p_merge = false);
	void _set_snapshot(const Ref<MDPersonagem> &p_personagem, const Dictionary &p_data);

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
	void _set_selection(const Rect2i &p_rect);
	void _refresh_selection();
	void _grid_changed(double p_value);
	void _selection_action(int p_action);
	Rect2i _detect_sprite(const Vector2i &p_point);
	Vector<Rect2i> _split_selection();

	// Usados pela folha e pela prévia.
	void _set_frame_rect(int p_frame, const Rect2i &p_rect);
	void _set_frame_anchor(const Vector2i &p_anchor);
	void _set_box(int p_kind, const Rect2i &p_box); // 1 = corpo, 2 = ataque (relativas aos pés).
	void _nudge(const Vector2i &p_delta); // Ajuste fino do quadro em edição.
	const MDPersonagem::Quadro *_reference_frame() const;
	void _refresh_references();

protected:
	void _notification(int p_what);
	static void _bind_methods();

public:
	void edit(const Ref<MDPersonagem> &p_personagem);
	bool has_unsaved_changes() const;
	void save_if_changed();
	String get_edited_path() const;
	// Cria um personagem vazio com a folha (ao lado dela) e devolve o caminho; vazio se falhar.
	static String create_character(const String &p_sheet, String &r_error);

	RetroAnimationEditor();
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
