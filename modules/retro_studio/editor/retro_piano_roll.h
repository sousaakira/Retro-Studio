#pragma once

#include "retro_song.h"

#include "core/templates/hash_set.h"
#include "scene/gui/control.h"

// #89: piano roll do compositor (porte de PianoRoll.vue). Edita as notas da faixa selecionada; as outras
// faixas aparecem apagadas por baixo. Clique no vazio cria (arraste para o tamanho), arraste a nota para
// mover, a borda direita para mudar a duração; botão direito apaga. Régua: clique posiciona o início da
// reprodução; Shift+arrastar marca o loop. A roda rola; Ctrl+roda dá zoom; Alt+roda muda a altura.
class RetroPianoRoll : public Control {
	GDCLASS(RetroPianoRoll, Control)

	enum DragMode {
		DRAG_NONE,
		DRAG_LOOP,
		DRAG_KEY,
		DRAG_ERASE,
		DRAG_BOX,
		DRAG_RESIZE,
		DRAG_MOVE,
	};
	struct Origin {
		int index = 0;
		int t = 0, n = 0, d = 0;
	};
	DragMode drag = DRAG_NONE;
	Vector2 drag_start;
	Vector2 box_end;
	int drag_from = 0; // Loop: tick onde começou.
	int drag_pitch = -1; // Tecla tocada.
	int drag_target = -1; // Nota sob o mouse ao começar.
	Vector<Origin> origins;
	HashSet<int> box_base;
	bool edited = false; // O gesto mudou a música.
	double zoom_x = 1.5;
	int row_height = 12;
	double scroll_x = 0;
	double scroll_y = 0;
	int last_length = 12;
	int hover = -1;
	bool needs_reveal = true; // Centraliza quando tiver tamanho.

	Vector<RetroSongNote> *_notes() const;
	double _tick_at(double p_x) const;
	int _pitch_at(double p_y) const;
	double _x_of(double p_tick) const;
	double _y_of(int p_pitch) const;
	int _note_at(const Vector2 &p_position) const;
	void _clamp_scroll();
	void _remove(const HashSet<int> &p_indices);
	void _finish_edit();
	Color _color(int p_track) const;

protected:
	void _notification(int p_what);
	static void _bind_methods();
	virtual void gui_input(const Ref<InputEvent> &p_event) override;

public:
	static constexpr int KEYS = 56;
	static constexpr int RULER = 24;

	RetroSong *song = nullptr;
	int track = 0;
	int grid = 12;
	double playhead = 0;
	int cursor = 0;
	bool playing = false;
	HashSet<int> selection; // Índices das notas da faixa.

	void set_track(int p_track);
	void reveal(); // Mostra a região das notas (ou C4).
	void follow_playhead(double p_tick);
	void clear_selection();
	virtual CursorShape get_cursor_shape(const Point2 &p_pos) const override;

	RetroPianoRoll();
};
