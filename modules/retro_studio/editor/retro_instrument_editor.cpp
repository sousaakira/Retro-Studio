#include "retro_instrument_editor.h"

#include "retro_instrument_formats.h"
#include "retro_map_ui.h"

#include "core/object/callable_mp.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/button.h"
#include "scene/gui/check_box.h"
#include "scene/gui/grid_container.h"
#include "scene/gui/label.h"
#include "scene/gui/line_edit.h"
#include "scene/gui/menu_button.h"
#include "scene/gui/option_button.h"
#include "scene/gui/panel_container.h"
#include "scene/gui/popup_menu.h"
#include "scene/gui/slider.h"
#include "scene/gui/spin_box.h"
#include "scene/scene_string_names.h"

// Roteamento de cada algoritmo (→ modula, + soma).
static const char *ROUTING[8] = { "S1→S2→S3→S4", "(S1+S2)→S3→S4", "(S1+(S2→S3))→S4", "((S1→S2)+S3)→S4", "(S1→S2)+(S3→S4)", "S1→(S2+S3+S4)", "(S1→S2)+S3+S4", "S1+S2+S3+S4" };
// Detune no registrador: 0..3 positivos, 4..7 negativos (4 = −0).
static const int DETUNE_VALUES[7] = { 7, 6, 5, 0, 1, 2, 3 };
static const char *DETUNE_LABELS[7] = { "−3", "−2", "−1", "0", "+1", "+2", "+3" };
struct _Field {
	const char *key;
	const char *label;
	const char *hint;
	int max;
	bool inverted;
};
static const _Field FIELDS[8] = {
	{ "tl", "Volume (TL)", "Atenuação: 0 = mais alto; nos moduladores, menos TL = timbre mais brilhante.", 127, true },
	{ "ar", "Ataque (AR)", "Velocidade de subida: 31 = instantâneo.", 31, false },
	{ "d1r", "Decaimento (D1R)", "Velocidade até o nível de sustentação.", 31, false },
	{ "sl", "Sustentação (SL)", "Nível onde o decaimento muda de velocidade: 0 = topo, 15 = silêncio.", 15, false },
	{ "d2r", "Decaimento 2 (D2R)", "Queda enquanto a tecla está apertada: 0 = sustenta.", 31, false },
	{ "rr", "Soltura (RR)", "Velocidade ao soltar a tecla: 15 = corta.", 15, false },
	{ "mul", "Multiplicador", "Harmônico do operador: 0 = meia frequência, 1 = fundamental, 2 = oitava…", 15, false },
	{ "ks", "Key scale (KS)", "Envelopes mais rápidos nas notas agudas.", 3, false },
};
struct _EnvField {
	const char *label;
	const char *hint;
	int slider_max;
	int max;
};
static const _EnvField ENV_FIELDS[5] = {
	{ "Volume", "0 = mais alto, 15 = mudo", 15, 15 },
	{ "Ataque", "Quadros até o volume máximo", 120, 255 },
	{ "Decaimento", "Quadros até a sustentação", 120, 255 },
	{ "Sustentação", "Quanto cai abaixo do volume (0 = nada, 15 = some)", 15, 15 },
	{ "Soltura", "Quadros até sumir depois de soltar", 120, 255 },
};

static int &_op_field(RetroInstrument::Op &r_op, int p_field) {
	switch (p_field) {
		case 0:
			return r_op.tl;
		case 1:
			return r_op.ar;
		case 2:
			return r_op.d1r;
		case 3:
			return r_op.sl;
		case 4:
			return r_op.d2r;
		case 5:
			return r_op.rr;
		case 6:
			return r_op.mul;
		default:
			return r_op.ks;
	}
}

static int &_env_field(RetroInstrument::Envelope &r_env, int p_field) {
	switch (p_field) {
		case 0:
			return r_env.volume;
		case 1:
			return r_env.attack;
		case 2:
			return r_env.decay;
		case 3:
			return r_env.sustain;
		default:
			return r_env.release;
	}
}

void RetroInstrumentEditor::_bind_methods() {
	ADD_SIGNAL(MethodInfo("changed"));
	ADD_SIGNAL(MethodInfo("preview"));
	ADD_SIGNAL(MethodInfo("remove"));
	ADD_SIGNAL(MethodInfo("close"));
	ADD_SIGNAL(MethodInfo("export_requested", PropertyInfo(Variant::STRING, "format")));
}

RetroInstrument *RetroInstrumentEditor::_instrument() const {
	if (!song) {
		return nullptr;
	}
	for (int i = 0; i < song->instruments.size(); i++) {
		if (song->instruments[i].id == id) {
			return &song->instruments.write[i];
		}
	}
	return nullptr;
}

void RetroInstrumentEditor::_emit(const StringName &p_signal) {
	emit_signal(p_signal);
}

void RetroInstrumentEditor::_changed() {
	emit_signal(SNAME("changed"));
}

// p_muted: texto de apoio (apagado e com quebra de linha); rótulos de campo não quebram.
static Label *_text(Control *p_parent, const String &p_text, bool p_muted = false) {
	Label *label = memnew(Label);
	label->set_text(p_text);
	if (p_muted) {
		label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		label->set_custom_minimum_size(Size2(120, 0) * EDSCALE);
	}
	if (p_muted) {
		label->set_modulate(Color(1, 1, 1, 0.6));
	}
	p_parent->add_child(label);
	return label;
}

void RetroInstrumentEditor::build() {
	while (get_child_count() > 0) {
		Node *child = get_child(0);
		remove_child(child);
		child->queue_free();
	}
	for (int i = 0; i < 4; i++) {
		operator_titles[i] = nullptr;
		envelopes[i] = nullptr;
	}
	routing_label = nullptr;
	RetroInstrument *instrument = _instrument();
	if (!instrument) {
		return;
	}
	HBoxContainer *head = memnew(HBoxContainer);
	add_child(head);
	Label *title = memnew(Label);
	title->set_text("Editar instrumento");
	title->set_theme_type_variation(SNAME("HeaderSmall"));
	title->set_h_size_flags(SIZE_EXPAND_FILL);
	head->add_child(title);
	Button *done = memnew(Button);
	done->set_text("Concluir");
	done->connect(SceneStringName(pressed), callable_mp(this, &RetroInstrumentEditor::_emit).bind(SNAME("close")));
	head->add_child(done);

	HBoxContainer *name_row = memnew(HBoxContainer);
	add_child(name_row);
	_text(name_row, "Nome");
	LineEdit *name = memnew(LineEdit);
	name->set_max_length(64);
	name->set_text(instrument->name);
	name->set_h_size_flags(SIZE_EXPAND_FILL);
	name->connect(SceneStringName(text_changed), callable_mp(this, &RetroInstrumentEditor::_name_changed));
	name_row->add_child(name);
	const String kind = instrument->kind == "fm" ? U("FM · YM2612") : (instrument->kind == "noise" ? U("PSG · ruído") : U("PSG · onda quadrada"));
	_text(this, kind + U(" · ") + instrument->id + U(" · ") + (used ? U("usado em ") + itos(used) + U(" faixa(s)") : U("nenhuma faixa usa")), true);
	if (instrument->extra.has("source")) {
		_text(this, U("Origem: ") + String(instrument->extra["source"]), true);
	}

	HBoxContainer *actions = memnew(HBoxContainer);
	add_child(actions);
	Button *listen = memnew(Button);
	listen->set_text(U("▶ Ouvir"));
	listen->connect(SceneStringName(pressed), callable_mp(this, &RetroInstrumentEditor::_emit).bind(SNAME("preview")));
	actions->add_child(listen);
	if (instrument->kind == "fm") {
		MenuButton *export_menu = memnew(MenuButton);
		export_menu->set_text("Exportar");
		export_menu->set_flat(false);
		for (const RetroInstrumentFormats::ExportFormat &format : RetroInstrumentFormats::EXPORT_FORMATS) {
			export_menu->get_popup()->add_item(format.label);
		}
		export_menu->get_popup()->connect(SceneStringName(id_pressed), callable_mp(this, &RetroInstrumentEditor::_export_selected));
		actions->add_child(export_menu);
	}
	Control *spacer = memnew(Control);
	spacer->set_h_size_flags(SIZE_EXPAND_FILL);
	actions->add_child(spacer);
	Button *remove = memnew(Button);
	remove->set_text("Apagar");
	remove->set_disabled(used > 0);
	remove->set_tooltip_text(used ? U("Troque o instrumento das faixas que o usam antes de apagar.") : U("Apagar da música"));
	remove->connect(SceneStringName(pressed), callable_mp(this, &RetroInstrumentEditor::_emit).bind(SNAME("remove")));
	actions->add_child(remove);

	if (instrument->kind == "fm") {
		_section(this, "Canal");
		GridContainer *channel = memnew(GridContainer);
		channel->set_columns(2);
		add_child(channel);
		_text(channel, "Algoritmo");
		OptionButton *alg = memnew(OptionButton);
		for (int i = 0; i < 8; i++) {
			alg->add_item(itos(i) + U(" · ") + U(ROUTING[i]));
		}
		alg->select(instrument->alg);
		alg->connect(SceneStringName(item_selected), callable_mp(this, &RetroInstrumentEditor::_channel_value).bind(0));
		channel->add_child(alg);
		_text(channel, "Feedback do S1");
		SpinBox *fb = memnew(SpinBox);
		fb->set_max(7);
		fb->set_value(instrument->fb);
		fb->connect(SceneStringName(value_changed), callable_mp(this, &RetroInstrumentEditor::_channel_value).bind(1));
		channel->add_child(fb);
		Label *ams_label = _text(channel, "LFO volume (AMS)");
		ams_label->set_tooltip_text(U("Quanto o LFO mexe no volume dos operadores com AM ligado"));
		ams_label->set_mouse_filter(MOUSE_FILTER_PASS);
		OptionButton *ams = memnew(OptionButton);
		for (const char *label : { "desligado", "1,4 dB", "5,9 dB", "11,8 dB" }) {
			ams->add_item(label);
		}
		ams->select(instrument->ams);
		ams->connect(SceneStringName(item_selected), callable_mp(this, &RetroInstrumentEditor::_channel_value).bind(2));
		channel->add_child(ams);
		Label *pms_label = _text(channel, U("LFO afinação (PMS)"));
		pms_label->set_tooltip_text(U("Quanto o LFO mexe na afinação (vibrato); a roda de modulação também liga o LFO"));
		pms_label->set_mouse_filter(MOUSE_FILTER_PASS);
		OptionButton *pms = memnew(OptionButton);
		for (const char *label : { "desligado", "3,4 cents", "6,7", "10", "14", "20", "40", "80 cents" }) {
			pms->add_item(label);
		}
		pms->select(instrument->pms);
		pms->connect(SceneStringName(item_selected), callable_mp(this, &RetroInstrumentEditor::_channel_value).bind(3));
		channel->add_child(pms);
		routing_label = _text(this, String(), true);

		for (int index = 0; index < 4; index++) {
			PanelContainer *panel = memnew(PanelContainer);
			add_child(panel);
			VBoxContainer *box = memnew(VBoxContainer);
			panel->add_child(box);
			operator_titles[index] = memnew(Label);
			operator_titles[index]->set_theme_type_variation(SNAME("HeaderSmall"));
			box->add_child(operator_titles[index]);
			envelopes[index] = memnew(Control);
			envelopes[index]->set_custom_minimum_size(Size2(0, 36) * EDSCALE);
			envelopes[index]->connect(SceneStringName(draw), callable_mp(this, &RetroInstrumentEditor::_draw_envelope).bind(index));
			box->add_child(envelopes[index]);
			GridContainer *grid = memnew(GridContainer);
			grid->set_columns(3);
			box->add_child(grid);
			RetroInstrument::Op &op = instrument->ops[index];
			for (int field = 0; field < 8; field++) {
				const _Field &info = FIELDS[field];
				Label *label = _text(grid, U(info.label));
								label->set_tooltip_text(U(info.hint));
				label->set_mouse_filter(MOUSE_FILTER_PASS);
				HSlider *slider = memnew(HSlider);
				slider->set_max(info.max);
				slider->set_h_size_flags(SIZE_EXPAND_FILL);
				slider->set_v_size_flags(SIZE_SHRINK_CENTER);
				slider->set_custom_minimum_size(Size2(80, 0) * EDSCALE);
				slider->set_value(info.inverted ? info.max - _op_field(op, field) : _op_field(op, field));
				grid->add_child(slider);
				SpinBox *spin = memnew(SpinBox);
				spin->set_max(info.max);
				spin->set_value(_op_field(op, field));
				grid->add_child(spin);
				slider->connect(SceneStringName(value_changed), callable_mp(this, &RetroInstrumentEditor::_operator_value).bind(index, field, spin, true));
				spin->connect(SceneStringName(value_changed), callable_mp(this, &RetroInstrumentEditor::_operator_value).bind(index, field, slider, false));
			}
			_text(grid, "Detune");
			OptionButton *detune = memnew(OptionButton);
			for (int i = 0; i < 7; i++) {
				detune->add_item(U(DETUNE_LABELS[i]));
				if (DETUNE_VALUES[i] == op.dt) {
					detune->select(i);
				}
			}
			if (op.dt == 4) {
				detune->add_item(U("−0"));
				detune->select(7);
			}
			detune->connect(SceneStringName(item_selected), callable_mp(this, &RetroInstrumentEditor::_detune_selected).bind(index, detune));
			grid->add_child(detune);
			grid->add_child(memnew(Control));
			CheckBox *am = memnew(CheckBox);
			am->set_text("AM (LFO no volume)");
			am->set_pressed(op.am);
			am->connect(SceneStringName(toggled), callable_mp(this, &RetroInstrumentEditor::_am_toggled).bind(index));
			box->add_child(am);
		}
		_update_routing();
		return;
	}
	_section(this, "Envelope (quadros de 1/60 s)");
	GridContainer *grid = memnew(GridContainer);
	grid->set_columns(3);
	add_child(grid);
	for (int field = 0; field < 5; field++) {
		const _EnvField &info = ENV_FIELDS[field];
		Label *label = _text(grid, U(info.label));
				label->set_tooltip_text(U(info.hint));
		label->set_mouse_filter(MOUSE_FILTER_PASS);
		HSlider *slider = memnew(HSlider);
		slider->set_max(info.slider_max);
		slider->set_h_size_flags(SIZE_EXPAND_FILL);
		slider->set_v_size_flags(SIZE_SHRINK_CENTER);
		slider->set_custom_minimum_size(Size2(80, 0) * EDSCALE);
		slider->set_value(_env_field(instrument->envelope, field));
		grid->add_child(slider);
		SpinBox *spin = memnew(SpinBox);
		spin->set_max(info.max);
		spin->set_value(_env_field(instrument->envelope, field));
		grid->add_child(spin);
		slider->connect(SceneStringName(value_changed), callable_mp(this, &RetroInstrumentEditor::_envelope_value).bind(field, spin));
		spin->connect(SceneStringName(value_changed), callable_mp(this, &RetroInstrumentEditor::_envelope_value).bind(field, slider));
	}
	if (instrument->kind == "noise") {
		_text(grid, "Tipo");
		OptionButton *mode = memnew(OptionButton);
		mode->add_item("Branco (chiado)");
		mode->add_item(U("Periódico (zumbido)"));
		mode->select(instrument->mode == "periodic" ? 1 : 0);
		mode->connect(SceneStringName(item_selected), callable_mp(this, &RetroInstrumentEditor::_noise_selected).bind(false));
		grid->add_child(mode);
		grid->add_child(memnew(Control));
		_text(grid, "Altura");
		OptionButton *rate = memnew(OptionButton);
		for (const char *label : { "Agudo", "Médio", "Grave", "Segue a nota (usa o PSG 3)" }) {
			rate->add_item(U(label));
		}
		rate->select(instrument->rate);
		rate->connect(SceneStringName(item_selected), callable_mp(this, &RetroInstrumentEditor::_noise_selected).bind(true));
		grid->add_child(rate);
	}
}

void RetroInstrumentEditor::_update_routing() {
	RetroInstrument *instrument = _instrument();
	if (!instrument || !routing_label) {
		return;
	}
	String carriers;
	for (int i = 0; i < 4; i++) {
		const bool carrier = RetroChipInstruments::is_carrier(instrument->alg, i);
		if (carrier) {
			carriers += (carriers.is_empty() ? "S" : ", S") + itos(i + 1);
		}
		if (operator_titles[i]) {
			operator_titles[i]->set_text("S" + itos(i + 1) + "  " + (carrier ? String("soa") : String("modula")));
			operator_titles[i]->add_theme_color_override(SceneStringName(font_color), carrier ? Color(0.45, 0.85, 0.72) : Color(0.75, 0.78, 0.8));
		}
	}
	routing_label->set_text(U(ROUTING[instrument->alg]) + U(" · soam: ") + carriers);
}

void RetroInstrumentEditor::_name_changed(const String &p_text) {
	RetroInstrument *instrument = _instrument();
	if (instrument && !p_text.strip_edges().is_empty()) {
		instrument->name = p_text;
		_changed();
	}
}

void RetroInstrumentEditor::_channel_value(double p_value, int p_field) {
	RetroInstrument *instrument = _instrument();
	if (!instrument) {
		return;
	}
	int *fields[4] = { &instrument->alg, &instrument->fb, &instrument->ams, &instrument->pms };
	const int limits[4] = { 7, 7, 3, 7 };
	*fields[p_field] = CLAMP(int(Math::round(p_value)), 0, limits[p_field]);
	_update_routing();
	_changed();
}

void RetroInstrumentEditor::_operator_value(double p_value, int p_operator, int p_field, Object *p_twin, bool p_from_slider) {
	RetroInstrument *instrument = _instrument();
	if (!instrument) {
		return;
	}
	const _Field &info = FIELDS[p_field];
	const int value = CLAMP(int(Math::round(p_from_slider && info.inverted ? info.max - p_value : p_value)), 0, info.max);
	_op_field(instrument->ops[p_operator], p_field) = value;
	Range *twin = Object::cast_to<Range>(p_twin);
	if (twin) {
		twin->set_value_no_signal(!p_from_slider && info.inverted ? info.max - value : value);
	}
	if (envelopes[p_operator]) {
		envelopes[p_operator]->queue_redraw();
	}
	_changed();
}

void RetroInstrumentEditor::_detune_selected(int p_index, int p_operator, Object *p_select) {
	RetroInstrument *instrument = _instrument();
	if (instrument) {
		instrument->ops[p_operator].dt = p_index < 7 ? DETUNE_VALUES[p_index] : 4;
		_changed();
	}
}

void RetroInstrumentEditor::_am_toggled(bool p_on, int p_operator) {
	RetroInstrument *instrument = _instrument();
	if (instrument) {
		instrument->ops[p_operator].am = p_on ? 1 : 0;
		_changed();
	}
}

void RetroInstrumentEditor::_envelope_value(double p_value, int p_field, Object *p_twin) {
	RetroInstrument *instrument = _instrument();
	if (!instrument) {
		return;
	}
	const int value = CLAMP(int(Math::round(p_value)), 0, ENV_FIELDS[p_field].max);
	_env_field(instrument->envelope, p_field) = value;
	Range *twin = Object::cast_to<Range>(p_twin);
	if (twin) {
		twin->set_value_no_signal(value);
	}
	_changed();
}

void RetroInstrumentEditor::_noise_selected(int p_index, bool p_rate) {
	RetroInstrument *instrument = _instrument();
	if (!instrument) {
		return;
	}
	if (p_rate) {
		instrument->rate = CLAMP(p_index, 0, 3);
	} else {
		instrument->mode = p_index == 1 ? "periodic" : "white";
	}
	_changed();
}

void RetroInstrumentEditor::_export_selected(int p_index) {
	emit_signal(SNAME("export_requested"), String(RetroInstrumentFormats::EXPORT_FORMATS[CLAMP(p_index, 0, 3)].id));
}

// Desenho do envelope: ataque, decaimento até SL, D2R por um tempo, soltura. Escala aproximada.
void RetroInstrumentEditor::_draw_envelope(int p_operator) {
	RetroInstrument *instrument = _instrument();
	Control *canvas = envelopes[p_operator];
	if (!instrument || !canvas) {
		return;
	}
	const RetroInstrument::Op &op = instrument->ops[p_operator];
	auto time = [](double p_rate) { return p_rate ? MIN(60.0, 90.0 / (p_rate + 1)) : 60.0; };
	const double level = op.sl / 15.0;
	const double attack = op.ar >= 31 ? 0 : time(op.ar * 2), decay = op.d1r ? time(op.d1r * 2) : 0, hold = 40;
	const double sustain_end = MIN(1.0, level + (op.d2r ? hold / time(op.d2r * 2) * 0.6 : 0)), release = time(op.rr * 4 + 2);
	double total = attack + (op.d1r ? decay : 0) + hold + release;
	if (total <= 0) {
		total = 1;
	}
	Vector<Vector2> points;
	double t = 0;
	points.push_back(Vector2(0, 1));
	t += attack;
	points.push_back(Vector2(t, 0));
	if (op.d1r) {
		t += decay;
		points.push_back(Vector2(t, level));
	} else {
		points.push_back(Vector2(t, 0));
	}
	t += hold;
	points.push_back(Vector2(t, op.d1r ? sustain_end : 0));
	t += release;
	points.push_back(Vector2(t, 1));
	const Size2 size = canvas->get_size();
	canvas->draw_rect(Rect2(Vector2(), size), Color(0, 0, 0, 0.25));
	Vector<Vector2> scaled;
	for (const Vector2 &point : points) {
		scaled.push_back(Vector2(point.x / total * size.x, (4 + point.y * 28) / 36.0 * size.y));
	}
	const bool carrier = RetroChipInstruments::is_carrier(instrument->alg, p_operator);
	canvas->draw_polyline(scaled, carrier ? Color(0.45, 0.85, 0.72) : Color(0.6, 0.65, 0.7), 1.5 * EDSCALE, true);
}
