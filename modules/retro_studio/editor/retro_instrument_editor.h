#pragma once

#include "retro_song.h"

#include "scene/gui/box_container.h"

class Label;

// #89: editor de um instrumento da música (porte de InstrumentEditor.vue): FM de 4 operadores, PSG ou
// ruído. Edita o instrumento em song.instruments diretamente; "changed" a cada mudança (o compositor
// recarrega o patch no chip e grava o passo de desfazer). Exporta FM para TFI, DMP, FUI e OPNI.
class RetroInstrumentEditor : public VBoxContainer {
	GDCLASS(RetroInstrumentEditor, VBoxContainer)

	Label *routing_label = nullptr;
	Label *operator_titles[4] = {};
	Control *envelopes[4] = {};

	RetroInstrument *_instrument() const;
	void _emit(const StringName &p_signal);
	void _changed();
	void _name_changed(const String &p_text);
	void _channel_value(double p_value, int p_field);
	void _operator_value(double p_value, int p_operator, int p_field, Object *p_twin, bool p_from_slider);
	void _detune_selected(int p_index, int p_operator, Object *p_select);
	void _am_toggled(bool p_on, int p_operator);
	void _envelope_value(double p_value, int p_field, Object *p_twin);
	void _noise_selected(int p_index, bool p_rate);
	void _export_selected(int p_index);
	void _draw_envelope(int p_operator);
	void _update_routing();

protected:
	static void _bind_methods();

public:
	RetroSong *song = nullptr;
	String id;
	int used = 0;

	// Monta os controles do instrumento (de novo ao trocar de instrumento ou depois de desfazer).
	void build();
};
