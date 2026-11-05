#include "retro_ciclo_inspector.h"

#include "../scene/md_nodes.h"
#include "../scene/md_personagem.h"
#include "retro_image_convert.h"
#include "retro_palette_dock.h"

#include "core/input/input_event.h"
#include "core/math/random_number_generator.h"
#include "core/object/callable_mp.h"
#include "editor/editor_interface.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/scene/canvas_item_editor_plugin.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/button.h"
#include "scene/gui/label.h"
#include "scene/resources/2d/tile_set.h"
#include "scene/theme/theme_db.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

const int CELL = 16; // Lado de cada amostra (antes do EDSCALE).
const int GAP = 2;
const int LABEL_W = 36;

} // namespace

HashMap<ObjectID, int> RetroCicloPanel::faixa_do_node;
RetroCicloPanel *RetroCicloPanel::active = nullptr;
ObjectID RetroCicloPanel::picking_node;
String RetroCicloPanel::picked_text;

Node2D *RetroCicloPanel::_node() const {
	return Object::cast_to<Node2D>(ObjectDB::get_instance(node_id));
}

// Os efeitos como o jogo vai rodar (um do MDCicloCores; um ou dois da MDCachoeira).
Vector<MDEfeitoPaleta> RetroCicloPanel::_efeitos() const {
	Node2D *node = _node();
	if (MDCicloCores *ciclo = Object::cast_to<MDCicloCores>(node)) {
		return ciclo->efeitos();
	}
	if (MDCachoeira *cachoeira = Object::cast_to<MDCachoeira>(node)) {
		return cachoeira->efeitos();
	}
	return Vector<MDEfeitoPaleta>();
}

int RetroCicloPanel::_paleta() const {
	Node2D *node = _node();
	return node ? CLAMP(int(node->get("paleta")), 0, 3) : 0;
}

int RetroCicloPanel::_primeira(int p_faixa) const {
	Node2D *node = _node();
	return node ? int(node->get(faixas[p_faixa].primeira)) : 1;
}

int RetroCicloPanel::_quantidade(int p_faixa) const {
	const int primeira = _primeira(p_faixa);
	Node2D *node = _node();
	return node ? MAX(1, MIN(int(node->get(faixas[p_faixa].quantidade)), 16 - primeira)) : 1;
}

// As paletas como o gerador decide: a de cada slot vem do primeiro node da cena que o usa.
void RetroCicloPanel::_load_palettes() {
	for (int i = 0; i < 4; i++) {
		palettes[i].clear();
		sources[i] = String();
	}
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	if (!root) {
		return;
	}
	Vector<Node *> stack;
	stack.push_back(root);
	Vector<Node *> order;
	// Ordem da árvore (pré-ordem), como o gerador percorre.
	while (!stack.is_empty()) {
		Node *n = stack[stack.size() - 1];
		stack.remove_at(stack.size() - 1);
		order.push_back(n);
		for (int i = n->get_child_count() - 1; i >= 0; i--) {
			stack.push_back(n->get_child(i));
		}
	}
	for (Node *n : order) {
		int slot = -1;
		Vector<Color> colors;
		String source;
		if (MDFundo *fundo = Object::cast_to<MDFundo>(n)) {
			slot = fundo->get_paleta();
			if (fundo->get_texture().is_valid()) {
				source = fundo->get_texture()->get_path();
				colors = RetroMD::png_palette(source);
			}
		} else if (MDSprite *figura = Object::cast_to<MDSprite>(n); figura && figura->get_personagem().is_valid()) {
			slot = figura->get_paleta();
			if (slot >= 0 && slot < 4 && palettes[slot].is_empty()) {
				const Ref<Image> atlas = figura->get_personagem()->build_atlas(nullptr, figura->get_used_animations());
				if (atlas.is_valid()) {
					Vector<uint8_t> indices;
					RetroImageConvert::quantize(atlas, indices, colors);
				}
				source = figura->get_personagem()->get_path();
			}
		} else if (MDSprite *sprite = Object::cast_to<MDSprite>(n)) {
			slot = sprite->get_paleta();
			if (sprite->get_texture().is_valid()) {
				source = sprite->get_texture()->get_path();
				colors = RetroMD::png_palette(source);
			}
		} else if (MDMapa *mapa = Object::cast_to<MDMapa>(n)) {
			slot = mapa->get_paleta();
			const Ref<Texture2D> atlas = mapa->get_atlas_texture();
			if (atlas.is_valid()) {
				source = atlas->get_path();
				colors = RetroMD::png_palette(source);
			}
		}
		if (slot >= 0 && slot < 4 && palettes[slot].is_empty() && !colors.is_empty()) {
			for (int k = 0; k < MIN(colors.size(), 16); k++) {
				palettes[slot].push_back(RetroPaletteDock::to_console(colors[k]));
			}
			sources[slot] = source.get_file();
		}
	}
}

// Conta as cores (índices do PNG indexado) dos tiles dos mapas que a área do node cobre.
void RetroCicloPanel::_scan_area() {
	for (int s = 0; s < 4; s++) {
		for (int c = 0; c < 16; c++) {
			counts[s][c] = 0;
		}
	}
	area_palette = -1;
	Node2D *node = _node();
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	if (!node || !root || !node->is_inside_tree()) {
		return;
	}
	const Transform2D xform = node->get_global_transform();
	const Rect2 area = xform.xform(Rect2(Vector2(), Vector2(Vector2i(node->get("tamanho")))));
	Vector<Node *> stack;
	stack.push_back(root);
	while (!stack.is_empty()) {
		Node *n = stack[stack.size() - 1];
		stack.remove_at(stack.size() - 1);
		for (int i = 0; i < n->get_child_count(); i++) {
			stack.push_back(n->get_child(i));
		}
		// Imagem de fundo (MDFundo): os pixels do PNG indexado que a área cobre.
		if (MDFundo *fundo = Object::cast_to<MDFundo>(n); fundo && fundo->is_visible_in_tree() && fundo->get_texture().is_valid()) {
			const int slot = fundo->get_paleta();
			const String path = fundo->get_texture()->get_path();
			const Vector<Color> plte = RetroMD::png_palette(path);
			Ref<Image> image = MDPersonagem::load_sheet(path);
			if (slot >= 0 && slot < 4 && !plte.is_empty() && image.is_valid()) {
				image->convert(Image::FORMAT_RGBA8);
				HashMap<uint32_t, int> index_of;
				for (int k = plte.size() - 1; k >= 0; k--) {
					index_of[plte[k].to_rgba32() | 0xFF] = k;
				}
				// Da área (global) para os pixels da imagem: local do sprite menos o canto do desenho.
				const Rect2 rect = fundo->get_rect();
				const Vector2 a = fundo->to_local(area.position) - rect.position;
				const Vector2 b = fundo->to_local(area.get_end()) - rect.position;
				const int x0 = CLAMP(int(MIN(a.x, b.x)), 0, image->get_width()), x1 = CLAMP(int(MAX(a.x, b.x)), 0, image->get_width());
				const int y0 = CLAMP(int(MIN(a.y, b.y)), 0, image->get_height()), y1 = CLAMP(int(MAX(a.y, b.y)), 0, image->get_height());
				for (int py = y0; py < y1; py++) {
					for (int px = x0; px < x1; px++) {
						const Color c = image->get_pixel(px, py);
						const HashMap<uint32_t, int>::Iterator it = c.a < 0.5 ? HashMap<uint32_t, int>::Iterator() : index_of.find(c.to_rgba32() | 0xFF);
						if (it && it->value < 16) {
							counts[slot][it->value]++;
						}
					}
				}
			}
			continue;
		}
		MDMapa *mapa = Object::cast_to<MDMapa>(n);
		if (!mapa || !mapa->is_visible_in_tree()) {
			continue;
		}
		const int slot = mapa->get_paleta();
		const Ref<TileSet> tiles = mapa->get_tile_set();
		const Ref<Texture2D> texture = mapa->get_atlas_texture();
		if (slot < 0 || slot > 3 || tiles.is_null() || texture.is_null() || tiles->get_source_count() == 0) {
			continue;
		}
		const Ref<TileSetAtlasSource> atlas = tiles->get_source(tiles->get_source_id(0));
		const Vector<Color> plte = RetroMD::png_palette(texture->get_path());
		Ref<Image> image = MDPersonagem::load_sheet(texture->get_path());
		if (atlas.is_null() || plte.is_empty() || image.is_null()) {
			continue;
		}
		image->convert(Image::FORMAT_RGBA8);
		HashMap<uint32_t, int> index_of;
		for (int k = plte.size() - 1; k >= 0; k--) {
			index_of[plte[k].to_rgba32() | 0xFF] = k; // A primeira ocorrência vence.
		}
		const Vector2i a = mapa->local_to_map(mapa->to_local(area.position));
		const Vector2i b = mapa->local_to_map(mapa->to_local(area.get_end() - Vector2(0.01, 0.01)));
		for (int y = MIN(a.y, b.y); y <= MAX(a.y, b.y); y++) {
			for (int x = MIN(a.x, b.x); x <= MAX(a.x, b.x); x++) {
				if (mapa->get_cell_source_id(Vector2i(x, y)) < 0) {
					continue;
				}
				const Rect2i region = atlas->get_tile_texture_region(mapa->get_cell_atlas_coords(Vector2i(x, y)));
				for (int py = region.position.y; py < region.get_end().y && py < image->get_height(); py++) {
					for (int px = region.position.x; px < region.get_end().x && px < image->get_width(); px++) {
						const Color c = image->get_pixel(px, py);
						if (c.a < 0.5) {
							continue;
						}
						const HashMap<uint32_t, int>::Iterator it = index_of.find(c.to_rgba32() | 0xFF);
						if (it && it->value < 16) {
							counts[slot][it->value]++;
						}
					}
				}
			}
		}
	}
	int best = 0;
	for (int s = 0; s < 4; s++) {
		int total = 0;
		for (int c = 1; c < 16; c++) {
			total += counts[s][c];
		}
		if (total > best) {
			best = total;
			area_palette = s;
		}
	}
}

void RetroCicloPanel::_update_info() {
	Node2D *node = _node();
	if (!node) {
		return;
	}
	String text;
	for (int f = 0; f < faixas.size(); f++) {
		const bool ligada = faixas[f].liga == StringName() || bool(node->get(faixas[f].liga));
		if (!text.is_empty()) {
			text += "\n";
		}
		text += vformat(U("%s: PAL%d, cores %d a %d"), faixas[f].label, _paleta(), _primeira(f), _primeira(f) + _quantidade(f) - 1);
		if (!ligada) {
			text += U(" (desligada)");
		}
	}
	if (!sources[_paleta()].is_empty()) {
		text += U(" (paleta de ") + sources[_paleta()] + ")";
	}
	if (area_palette >= 0) {
		PackedStringArray used;
		for (int c = 1; c < 16; c++) {
			if (counts[area_palette][c]) {
				used.push_back(itos(c));
			}
		}
		text += "\n" + vformat(U("Na área: PAL%d, cores %s (ponto amarelo)."), area_palette, String(", ").join(used));
	} else {
		text += "\n" + U("Nenhum mapa nem fundo embaixo da área: arraste ou redimensione a área sobre a arte do efeito.");
	}
	text += "\n" + U("No jogo o efeito vale para a paleta inteira, em toda a tela (a área só ajuda a escolher).");
	info->set_text(text);
	use_area->set_disabled(area_palette < 0);
	use_area->set_text(faixas.size() > 1 ? vformat(U("Usar as cores da área na %s"), faixas[faixa].label.to_lower()) : U("Usar as cores da área"));
}

void RetroCicloPanel::_reset_simulation() {
	sims.clear();
	const Vector<Color> &pal = palettes[_paleta()];
	for (const MDEfeitoPaleta &e : _efeitos()) {
		Sim sim;
		for (int k = 0; k < e.quantidade; k++) {
			const int idx = e.primeira + k;
			sim.colors.push_back(idx < pal.size() ? pal[idx] : Color(0.2, 0.2, 0.2));
		}
		sim.dir = e.sentido;
		sim.step = e.modo == MDCicloCores::MODO_PISCAR ? e.piscadas : 0;
		sim.wait = e.atraso ? e.atraso : (e.modo == MDCicloCores::MODO_PISCAR ? _wait_off(e) : e.intervalo);
		sims.push_back(sim);
	}
	sim_time = 0;
}

int RetroCicloPanel::_wait_off(const MDEfeitoPaleta &p_efeito) {
	const int range = p_efeito.apagado * p_efeito.variacao / 100;
	if (!range) {
		return p_efeito.apagado;
	}
	return MAX(1, p_efeito.apagado - range / 2 + int(Math::rand() % uint32_t(range + 1)));
}

// Um quadro do jogo (a mesma lógica de efeitos_quadro no código gerado).
void RetroCicloPanel::_simulate_frame() {
	const Vector<MDEfeitoPaleta> efeitos = _efeitos();
	for (int i = 0; i < sims.size() && i < efeitos.size(); i++) {
		const MDEfeitoPaleta &e = efeitos[i];
		Sim &sim = sims.write[i];
		if (sim.colors.is_empty() || --sim.wait > 0) {
			continue;
		}
		if (e.modo == MDCicloCores::MODO_PISCAR) {
			sim.lit = !sim.lit;
			if (sim.lit || --sim.step > 0) {
				sim.wait = e.aceso;
			} else {
				sim.step = e.piscadas;
				sim.wait = _wait_off(e);
			}
			continue;
		}
		sim.wait = e.intervalo;
		const int n = sim.colors.size();
		if (sim.dir > 0) {
			const Color last = sim.colors[n - 1];
			for (int k = n - 1; k > 0; k--) {
				sim.colors.write[k] = sim.colors[k - 1];
			}
			sim.colors.write[0] = last;
		} else {
			const Color first = sim.colors[0];
			for (int k = 0; k + 1 < n; k++) {
				sim.colors.write[k] = sim.colors[k + 1];
			}
			sim.colors.write[n - 1] = first;
		}
		if (e.modo == MDCicloCores::MODO_VAI_E_VOLTA && ++sim.step >= n - 1) {
			sim.step = 0;
			sim.dir = -sim.dir;
		}
	}
}

bool RetroCicloPanel::_cell_at(const Vector2 &p_pos, int &r_row, int &r_col) const {
	const float cell = CELL * EDSCALE, gap = GAP * EDSCALE;
	const float x = p_pos.x - LABEL_W * EDSCALE;
	if (x < 0 || p_pos.y < 0) {
		return false;
	}
	r_col = int(x / (cell + gap));
	r_row = int(p_pos.y / (cell + gap));
	return r_col >= 0 && r_col < 16 && r_row >= 0 && r_row < 4;
}

// Guarda os valores do trecho escolhido antes de mudar (para o desfazer).
void RetroCicloPanel::_remember() {
	Node2D *node = _node();
	old_values.clear();
	if (!node) {
		return;
	}
	const Faixa &f = faixas[faixa];
	old_values["paleta"] = node->get("paleta");
	old_values[f.primeira] = node->get(f.primeira);
	old_values[f.quantidade] = node->get(f.quantidade);
	if (f.liga != StringName()) {
		old_values[f.liga] = node->get(f.liga);
	}
}

void RetroCicloPanel::_set_range(int p_paleta, int p_primeira, int p_quantidade) {
	Node2D *node = _node();
	if (!node) {
		return;
	}
	const Faixa &f = faixas[faixa];
	node->set("paleta", p_paleta);
	node->set(f.primeira, p_primeira);
	node->set(f.quantidade, p_quantidade);
	grid->queue_redraw();
	_update_info();
}

// A mudança já está no node: a ação só registra o fazer e o desfazer.
void RetroCicloPanel::_commit_range(const String &p_action) {
	Node2D *node = _node();
	if (!node) {
		return;
	}
	// Escolher as cores da espuma liga a espuma. Só agora, no fim do arrasto: ligar mostra mais propriedades,
	// e o Inspetor se refaz (com este painel).
	const Faixa &f = faixas[faixa];
	if (f.liga != StringName() && !bool(node->get(f.liga))) {
		node->set(f.liga, true);
	}
	bool changed = false;
	for (const KeyValue<Variant, Variant> &kv : old_values) {
		changed = changed || node->get(kv.key) != kv.value;
	}
	if (!changed) {
		return;
	}
	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	undo->create_action(p_action, UndoRedo::MERGE_DISABLE, node);
	for (const KeyValue<Variant, Variant> &kv : old_values) {
		undo->add_do_property(node, kv.key, node->get(kv.key));
		undo->add_undo_property(node, kv.key, kv.value);
	}
	undo->commit_action(false);
	node->notify_property_list_changed();
}

void RetroCicloPanel::_select_faixa(int p_faixa) {
	faixa = CLAMP(p_faixa, 0, faixas.size() - 1);
	faixa_do_node[node_id] = faixa;
	for (int i = 0; i < faixa_buttons.size(); i++) {
		faixa_buttons[i]->set_pressed_no_signal(i == faixa);
	}
	grid->queue_redraw();
	_update_info();
}

void RetroCicloPanel::_grid_draw() {
	Node2D *node = _node();
	const float cell = CELL * EDSCALE, gap = GAP * EDSCALE;
	const Ref<Font> font = get_theme_font(SceneStringName(font), SNAME("Label"));
	const int font_size = get_theme_font_size(SceneStringName(font_size), SNAME("Label"));
	const Color text_color = get_theme_color(SceneStringName(font_color), SNAME("Label"));
	for (int row = 0; row < 4; row++) {
		const float y = row * (cell + gap);
		grid->draw_string(font, Vector2(0, y + cell * 0.8), "PAL" + itos(row), HORIZONTAL_ALIGNMENT_LEFT, -1, font_size * 0.85, text_color);
		for (int col = 0; col < 16; col++) {
			const Rect2 r(LABEL_W * EDSCALE + col * (cell + gap), y, cell, cell);
			grid->draw_rect(r, col < palettes[row].size() ? palettes[row][col] : Color(0.15, 0.15, 0.15));
			if (col == 0) {
				grid->draw_line(r.position, r.get_end(), Color(1, 0.3, 0.3, 0.8), 1.5); // Cor 0: transparência.
			}
			if (counts[row][col] && col > 0) {
				grid->draw_circle(r.get_center() + Vector2(0, cell * 0.28), cell * 0.14, Color(1, 0.9, 0.2));
				grid->draw_arc(r.get_center() + Vector2(0, cell * 0.28), cell * 0.14, 0, Math::TAU, 10, Color(0, 0, 0, 0.8), 1.0);
			}
		}
	}
	if (!node) {
		return;
	}
	// Moldura de cada trecho; o que o clique escolhe fica mais grossa.
	const float y = _paleta() * (cell + gap);
	for (int f = 0; f < faixas.size(); f++) {
		if (faixas[f].liga != StringName() && !bool(node->get(faixas[f].liga)) && f != faixa) {
			continue;
		}
		const Rect2 sel(LABEL_W * EDSCALE + _primeira(f) * (cell + gap) - 2, y - 2, _quantidade(f) * (cell + gap) - gap + 4, cell + 4);
		grid->draw_rect(sel, faixas[f].cor, false, (f == faixa ? 2.5 : 1.2) * EDSCALE);
	}
}

void RetroCicloPanel::_grid_input(const Ref<InputEvent> &p_event) {
	Node2D *node = _node();
	if (!node) {
		return;
	}
	const Ref<InputEventMouseButton> mb = p_event;
	if (mb.is_valid() && mb->get_button_index() == MouseButton::LEFT) {
		int row, col;
		if (mb->is_pressed() && _cell_at(mb->get_position(), row, col)) {
			_remember();
			anchor = mb->is_shift_pressed() && row == _paleta() ? _primeira(faixa) : col;
			dragging = true;
			_set_range(row, MIN(anchor, col), Math::abs(col - anchor) + 1);
			grid->accept_event();
		} else if (!mb->is_pressed() && dragging) {
			dragging = false;
			_commit_range(U("Escolher as cores do efeito"));
			_reset_simulation();
		}
		return;
	}
	const Ref<InputEventMouseMotion> mm = p_event;
	if (mm.is_valid() && dragging) {
		int row, col;
		if (_cell_at(Vector2(mm->get_position().x, _paleta() * (CELL + GAP) * EDSCALE + 1), row, col)) {
			_set_range(_paleta(), MIN(anchor, col), Math::abs(col - anchor) + 1);
		}
	}
}

void RetroCicloPanel::_preview_draw() {
	const Vector<MDEfeitoPaleta> efeitos = _efeitos();
	if (sims.is_empty()) {
		return;
	}
	const float h = preview->get_size().y;
	const float w = 22 * EDSCALE, group_gap = 14 * EDSCALE;
	float x = 0;
	for (int i = 0; i < sims.size() && i < efeitos.size(); i++) {
		const Sim &sim = sims[i];
		const Color flash = RetroPaletteDock::to_console(efeitos[i].cor);
		for (int k = 0; k < sim.colors.size(); k++) {
			const Color c = efeitos[i].modo == MDCicloCores::MODO_PISCAR && sim.lit ? flash : sim.colors[k];
			preview->draw_rect(Rect2(x, 0, w - 1, h), c);
			x += w;
		}
		x += group_gap;
	}
}

void RetroCicloPanel::_use_area_pressed() {
	if (area_palette < 0) {
		return;
	}
	int first = -1, last = -1;
	for (int c = 1; c < 16; c++) {
		if (counts[area_palette][c]) {
			first = first < 0 ? c : first;
			last = c;
		}
	}
	if (first < 0) {
		return;
	}
	_remember();
	_set_range(area_palette, first, last - first + 1);
	_commit_range(U("Usar as cores da área"));
	_reset_simulation();
}

void RetroCicloPanel::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_ENTER_TREE: {
			active = this;
		} break;
		case NOTIFICATION_EXIT_TREE: {
			if (active == this) {
				active = nullptr;
			}
		} break;
		case NOTIFICATION_READY: {
			_load_palettes();
			_scan_area();
			_update_info();
			_reset_simulation();
			set_process(true);
		} break;
		case NOTIFICATION_PROCESS: {
			Node2D *node = _node();
			if (!node) {
				return;
			}
			// Mudou alguma propriedade (pelo Inspetor ou desfazer): recomeça a prévia.
			String sig = itos(_paleta());
			for (const MDEfeitoPaleta &e : _efeitos()) {
				sig += vformat("|%d,%d,%d,%d,%d,%s,%d,%d,%d,%d,%d", e.primeira, e.quantidade, e.intervalo, e.sentido, e.modo, e.cor.to_html(false), e.aceso, e.piscadas, e.variacao, e.apagado, e.atraso);
			}
			if (sig != sim_signature) {
				sim_signature = sig;
				_reset_simulation();
				_update_info();
				grid->queue_redraw();
			}
			// Moveu ou redimensionou a área: conta de novo as cores embaixo dela.
			const Transform2D xform = node->is_inside_tree() ? node->get_global_transform() : Transform2D();
			const String area = vformat("%s|%s", xform.get_origin(), Vector2i(node->get("tamanho")));
			if (area != area_signature && !dragging) {
				area_signature = area;
				_scan_area();
				_update_info();
				grid->queue_redraw();
			}
			sim_time += get_process_delta_time();
			int frames = 0;
			while (sim_time >= 1.0 / 60.0 && frames < 8) {
				sim_time -= 1.0 / 60.0;
				_simulate_frame();
				frames++;
			}
			if (frames) {
				preview->queue_redraw();
			}
		} break;
	}
}

void RetroCicloPanel::setup(Node2D *p_node) {
	node_id = p_node->get_instance_id();
	const bool cachoeira = Object::cast_to<MDCachoeira>(p_node) != nullptr;
	if (cachoeira) {
		faixas.push_back({ U("Água"), "primeira", "quantidade", StringName(), Color(1, 1, 1) });
		faixas.push_back({ "Espuma", "espuma_primeira", "espuma_quantidade", "espuma", Color(0.45, 0.85, 1.0) });
	} else {
		faixas.push_back({ "Cores", "primeira", "quantidade", StringName(), Color(1, 1, 1) });
	}
	Label *title = memnew(Label(cachoeira ? U("Cores da cachoeira: pinte a queda com faixas das cores da água em sequência, de cima para baixo. Clique numa cor; arraste ou Shift+clique para o trecho.")
										  : U("Cores do efeito: clique numa cor; arraste ou Shift+clique para o trecho")));
	title->add_theme_color_override(SceneStringName(font_color), Color(1, 0.75, 0.4));
	title->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	title->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	add_child(title);
	if (faixa_do_node.has(node_id)) {
		faixa = CLAMP(faixa_do_node[node_id], 0, faixas.size() - 1);
	}
	if (faixas.size() > 1) {
		HBoxContainer *row = memnew(HBoxContainer);
		Label *escolhe = memnew(Label(U("O clique escolhe:")));
		row->add_child(escolhe);
		for (int f = 0; f < faixas.size(); f++) {
			Button *b = memnew(Button);
			b->set_text(faixas[f].label);
			b->set_toggle_mode(true);
			b->set_pressed(f == faixa);
			b->connect(SceneStringName(pressed), callable_mp(this, &RetroCicloPanel::_select_faixa).bind(f));
			row->add_child(b);
			faixa_buttons.push_back(b);
		}
		add_child(row);
	}
	grid = memnew(Control);
	grid->set_custom_minimum_size(Size2(LABEL_W + 16 * (CELL + GAP), 4 * (CELL + GAP)) * EDSCALE);
	grid->set_mouse_filter(Control::MOUSE_FILTER_STOP);
	grid->set_default_cursor_shape(Control::CURSOR_POINTING_HAND);
	grid->connect(SceneStringName(draw), callable_mp(this, &RetroCicloPanel::_grid_draw));
	grid->connect(SceneStringName(gui_input), callable_mp(this, &RetroCicloPanel::_grid_input));
	add_child(grid);
	add_child(memnew(Label(U("Prévia (no ritmo do jogo):"))));
	preview = memnew(Control);
	preview->set_custom_minimum_size(Size2(0, 20) * EDSCALE);
	preview->connect(SceneStringName(draw), callable_mp(this, &RetroCicloPanel::_preview_draw));
	add_child(preview);
	use_area = memnew(Button);
	use_area->set_text(U("Usar as cores da área"));
	use_area->set_tooltip_text(U("Escolhe a paleta e o trecho pelas cores que os mapas usam embaixo da área do node."));
	use_area->connect(SceneStringName(pressed), callable_mp(this, &RetroCicloPanel::_use_area_pressed));
	add_child(use_area);
	picker = memnew(Button);
	picker->set_text(U("Conta-gotas: clicar na cena escolhe a cor"));
	picker->set_toggle_mode(true);
	picker->set_tooltip_text(U("Ligado, passe o mouse na vista 2D para ver a cor e clique para escolhê-la (paleta e primeira cor do trecho). Shift+clique estende o trecho até a cor clicada."));
	picker->connect(SceneStringName(toggled), callable_mp(this, &RetroCicloPanel::_picker_toggled));
	add_child(picker);
	picked = memnew(Label);
	picked->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	picked->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	picked->hide();
	add_child(picked);
	if (picking_node == node_id) {
		picker->set_pressed_no_signal(true);
		picked->set_text(picked_text);
		picked->show();
	}
	info = memnew(Label);
	info->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	info->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	add_child(info);
}

void RetroCicloPanel::_picker_toggled(bool p_on) {
	picked->set_visible(p_on);
	picking_node = p_on ? node_id : ObjectID();
	if (p_on) {
		picked_text = U("Clique na cena numa cor (Shift+clique estende o trecho). Esc ou o botão desligam.");
		picked->set_text(picked_text);
	}
	CanvasItemEditor::get_singleton()->update_viewport();
}

void RetroCicloPanel::stop_picking() {
	if (picker && picker->is_pressed()) {
		picker->set_pressed(false); // Dispara _picker_toggled.
	}
}

Color RetroCicloPanel::palette_color(int p_slot, int p_index) const {
	if (p_slot < 0 || p_slot > 3 || p_index < 0 || p_index >= palettes[p_slot].size()) {
		return Color(0.2, 0.2, 0.2);
	}
	return palettes[p_slot][p_index];
}

bool RetroCicloPanel::is_picking() const {
	return picker && picker->is_pressed();
}

// Índice da cor de um pixel pela paleta do PNG indexado (a primeira cor igual vence). Guarda as imagens.
static bool pixel_index(const String &p_path, const Vector2i &p_pixel, int &r_index) {
	struct Cached {
		uint64_t modified = 0;
		Ref<Image> image;
		HashMap<uint32_t, int> index_of;
	};
	static HashMap<String, Cached> cache;
	const uint64_t modified = FileAccess::get_modified_time(p_path);
	if (!cache.has(p_path) || cache[p_path].modified != modified) {
		Cached c;
		c.modified = modified;
		c.image = MDPersonagem::load_sheet(p_path);
		if (c.image.is_valid()) {
			c.image->convert(Image::FORMAT_RGBA8);
		}
		const Vector<Color> plte = RetroMD::png_palette(p_path);
		for (int k = plte.size() - 1; k >= 0; k--) {
			c.index_of[plte[k].to_rgba32() | 0xFF] = k;
		}
		cache[p_path] = c;
	}
	const Cached &c = cache[p_path];
	if (c.image.is_null() || p_pixel.x < 0 || p_pixel.y < 0 || p_pixel.x >= c.image->get_width() || p_pixel.y >= c.image->get_height()) {
		return false;
	}
	const Color color = c.image->get_pixel(p_pixel.x, p_pixel.y);
	if (color.a < 0.5) {
		return false; // Transparente: a cor vem da camada de baixo.
	}
	const HashMap<uint32_t, int>::ConstIterator it = c.index_of.find(color.to_rgba32() | 0xFF);
	if (!it || it->value > 15) {
		return false;
	}
	r_index = it->value;
	return true;
}

bool RetroCicloPanel::color_at(Node *p_root, const Vector2 &p_point, int &r_slot, int &r_index) {
	if (!p_root) {
		return false;
	}
	// Mapas e fundos na ordem de desenho; a busca vai do último (por cima) ao primeiro, plano A antes do B.
	Vector<Node2D *> layers;
	Vector<Node *> stack;
	stack.push_back(p_root);
	while (!stack.is_empty()) {
		Node *n = stack[stack.size() - 1];
		stack.remove_at(stack.size() - 1);
		if ((Object::cast_to<MDMapa>(n) || Object::cast_to<MDFundo>(n)) && Object::cast_to<CanvasItem>(n)->is_visible_in_tree()) {
			layers.push_back(Object::cast_to<Node2D>(n));
		}
		for (int i = n->get_child_count() - 1; i >= 0; i--) {
			stack.push_back(n->get_child(i));
		}
	}
	for (int pass = 0; pass < 2; pass++) {
		const MDFundo::Plano plano = pass == 0 ? MDFundo::PLANO_A : MDFundo::PLANO_B;
		for (int i = layers.size() - 1; i >= 0; i--) {
			if (MDMapa *mapa = Object::cast_to<MDMapa>(layers[i])) {
				const Ref<TileSet> tiles = mapa->get_tile_set();
				const Ref<Texture2D> texture = mapa->get_atlas_texture();
				if (mapa->get_plano() != plano || tiles.is_null() || texture.is_null() || tiles->get_source_count() == 0) {
					continue;
				}
				const Vector2 local = mapa->to_local(p_point);
				const Vector2i cell = mapa->local_to_map(local);
				if (mapa->get_cell_source_id(cell) < 0) {
					continue;
				}
				const Ref<TileSetAtlasSource> atlas = tiles->get_source(mapa->get_cell_source_id(cell));
				if (atlas.is_null()) {
					continue;
				}
				const Vector2i size = tiles->get_tile_size();
				Vector2i in = Vector2i((local - mapa->map_to_local(cell) + Vector2(size) / 2).floor());
				in = in.clamp(Vector2i(), size - Vector2i(1, 1));
				// Tiles espelhados (Espelhar X/Y do editor de mapas).
				const int alt = mapa->get_cell_alternative_tile(cell);
				if (alt & TileSetAtlasSource::TRANSFORM_TRANSPOSE) {
					SWAP(in.x, in.y);
				}
				if (alt & TileSetAtlasSource::TRANSFORM_FLIP_H) {
					in.x = size.x - 1 - in.x;
				}
				if (alt & TileSetAtlasSource::TRANSFORM_FLIP_V) {
					in.y = size.y - 1 - in.y;
				}
				const Rect2i region = atlas->get_tile_texture_region(mapa->get_cell_atlas_coords(cell));
				if (pixel_index(texture->get_path(), region.position + in, r_index)) {
					r_slot = mapa->get_paleta();
					return true;
				}
			} else if (MDFundo *fundo = Object::cast_to<MDFundo>(layers[i])) {
				if (fundo->get_plano() != plano || fundo->get_texture().is_null()) {
					continue;
				}
				const Vector2 pixel = fundo->to_local(p_point) - fundo->get_rect().position;
				if (pixel_index(fundo->get_texture()->get_path(), Vector2i(pixel.floor()), r_index)) {
					r_slot = fundo->get_paleta();
					return true;
				}
			}
		}
	}
	return false;
}

void RetroCicloPanel::pick_at(const Vector2 &p_point, bool p_extend) {
	int slot = 0, index = 0;
	if (!color_at(EditorInterface::get_singleton()->get_edited_scene_root(), p_point, slot, index)) {
		picked_text = U("Ali não há cor de mapa nem de fundo (ou é a transparência).");
		picked->set_text(picked_text);
		return;
	}
	if (index == 0) {
		picked_text = vformat(U("PAL%d, cor 0: é a transparência (e o fundo da tela na PAL0); escolha outra."), slot);
		picked->set_text(picked_text);
		return;
	}
	_remember();
	if (p_extend && slot == _paleta()) {
		const int first = MIN(_primeira(faixa), index), last = MAX(_primeira(faixa) + _quantidade(faixa) - 1, index);
		_set_range(slot, first, last - first + 1);
	} else {
		_set_range(slot, index, 1);
	}
	_commit_range(U("Conta-gotas: escolher a cor"));
	_reset_simulation();
	picked_text = vformat(U("Escolhida: PAL%d, cor %d. %s"), slot, index, p_extend ? U("") : U("Shift+clique noutra cor estende o trecho."));
	// O Inspetor pode ter se refeito com o commit: o texto vai também para o painel novo.
	if (active && active->picked) {
		active->picked->set_text(picked_text);
	}
}

bool RetroCicloPickerPlugin::handles(Object *p_object) const {
	return Object::cast_to<MDCicloCores>(p_object) || Object::cast_to<MDCachoeira>(p_object);
}

bool RetroCicloPickerPlugin::forward_canvas_gui_input(const Ref<InputEvent> &p_event) {
	RetroCicloPanel *panel = RetroCicloPanel::active;
	if (!panel || !panel->is_picking()) {
		if (hover_ok) {
			hover_ok = false;
			update_overlays();
		}
		return false;
	}
	CanvasItemEditor *canvas = CanvasItemEditor::get_singleton();
	const Transform2D to_scene = canvas->get_canvas_transform().affine_inverse();
	const Ref<InputEventMouseMotion> mm = p_event;
	if (mm.is_valid()) {
		hover_pos = mm->get_position();
		hover_ok = RetroCicloPanel::color_at(EditorInterface::get_singleton()->get_edited_scene_root(), to_scene.xform(hover_pos), hover_slot, hover_index);
		update_overlays();
		return false; // A vista continua rolando e dando zoom.
	}
	const Ref<InputEventKey> k = p_event;
	if (k.is_valid() && k->is_pressed() && k->get_keycode() == Key::ESCAPE) {
		panel->stop_picking();
		hover_ok = false;
		update_overlays();
		return true;
	}
	const Ref<InputEventMouseButton> mb = p_event;
	if (mb.is_valid() && mb->get_button_index() == MouseButton::LEFT) {
		if (mb->is_pressed()) {
			panel->pick_at(to_scene.xform(mb->get_position()), mb->is_shift_pressed());
		}
		return true; // Não seleciona nem arrasta nodes enquanto o conta-gotas está ligado.
	}
	return false;
}

void RetroCicloPickerPlugin::forward_canvas_draw_over_viewport(Control *p_overlay) {
	RetroCicloPanel *panel = RetroCicloPanel::active;
	if (!panel || !panel->is_picking() || !hover_ok) {
		return;
	}
	// Amostra da cor embaixo do mouse, como o console mostra, com a paleta e o número.
	const Vector2 at = hover_pos + Vector2(16, 16) * EDSCALE;
	const float side = 22 * EDSCALE;
	const Ref<Font> font = p_overlay->get_theme_font(SceneStringName(font), SNAME("Label"));
	const int size = p_overlay->get_theme_font_size(SceneStringName(font_size), SNAME("Label"));
	const String text = vformat(U("PAL%d · cor %d"), hover_slot, hover_index);
	p_overlay->draw_rect(Rect2(at, Vector2(side + 10 * EDSCALE + font->get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x, side + 6 * EDSCALE)), Color(0, 0, 0, 0.8));
	p_overlay->draw_rect(Rect2(at + Vector2(3, 3) * EDSCALE, Vector2(side, side)), panel->palette_color(hover_slot, hover_index));
	p_overlay->draw_string(font, at + Vector2(side + 7 * EDSCALE, side * 0.75 + 3 * EDSCALE), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(1, 1, 1));
}

bool RetroCicloInspector::can_handle(Object *p_object) {
	return Object::cast_to<MDCicloCores>(p_object) || Object::cast_to<MDCachoeira>(p_object);
}

void RetroCicloInspector::parse_begin(Object *p_object) {
	RetroCicloPanel *panel = memnew(RetroCicloPanel);
	panel->setup(Object::cast_to<Node2D>(p_object));
	add_custom_control(panel);
}
