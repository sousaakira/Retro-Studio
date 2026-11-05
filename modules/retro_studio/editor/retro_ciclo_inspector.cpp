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

MDCicloCores *RetroCicloPanel::_node() const {
	return Object::cast_to<MDCicloCores>(ObjectDB::get_instance(node_id));
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
	MDCicloCores *node = _node();
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	if (!node || !root || !node->is_inside_tree()) {
		return;
	}
	const Transform2D xform = node->get_global_transform();
	const Rect2 area = xform.xform(Rect2(Vector2(), Vector2(node->get_tamanho())));
	Vector<Node *> stack;
	stack.push_back(root);
	while (!stack.is_empty()) {
		Node *n = stack[stack.size() - 1];
		stack.remove_at(stack.size() - 1);
		for (int i = 0; i < n->get_child_count(); i++) {
			stack.push_back(n->get_child(i));
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
	MDCicloCores *node = _node();
	if (!node) {
		return;
	}
	String text = vformat(U("PAL%d, cores %d a %d"), node->get_paleta(), node->get_primeira(), node->get_primeira() + node->cores_usadas() - 1);
	if (!sources[node->get_paleta()].is_empty()) {
		text += U(" (de ") + sources[node->get_paleta()] + ")";
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
		text += "\n" + U("Nenhum mapa embaixo da área: arraste ou redimensione a área sobre a arte do efeito.");
	}
	text += "\n" + U("No jogo o efeito vale para a paleta inteira, em toda a tela (a área só ajuda a escolher).");
	info->set_text(text);
	use_area->set_disabled(area_palette < 0);
}

void RetroCicloPanel::_reset_simulation() {
	MDCicloCores *node = _node();
	sim_colors.clear();
	if (!node) {
		return;
	}
	const Vector<Color> &pal = palettes[node->get_paleta()];
	for (int k = 0; k < node->cores_usadas(); k++) {
		const int idx = node->get_primeira() + k;
		sim_colors.push_back(idx < pal.size() ? pal[idx] : Color(0.2, 0.2, 0.2));
	}
	sim_dir = node->get_para_tras() ? -1 : 1;
	sim_lit = false;
	sim_step = node->get_modo() == MDCicloCores::MODO_PISCAR ? node->get_piscadas() : 0;
	sim_wait = node->get_atraso() ? node->get_atraso() : (node->get_modo() == MDCicloCores::MODO_PISCAR ? _wait_off() : node->get_intervalo());
	sim_time = 0;
}

int RetroCicloPanel::_wait_off() const {
	MDCicloCores *node = _node();
	const int off = node->get_quadros_apagado();
	const int range = off * node->get_variacao() / 100;
	if (!range) {
		return off;
	}
	return MAX(1, off - range / 2 + int(Math::rand() % uint32_t(range + 1)));
}

// Um quadro do jogo (a mesma lógica de efeitos_quadro no código gerado).
void RetroCicloPanel::_simulate_frame() {
	MDCicloCores *node = _node();
	if (!node || sim_colors.is_empty() || --sim_wait > 0) {
		return;
	}
	if (node->get_modo() == MDCicloCores::MODO_PISCAR) {
		sim_lit = !sim_lit;
		if (sim_lit) {
			sim_wait = node->get_quadros_aceso();
		} else if (--sim_step > 0) {
			sim_wait = node->get_quadros_aceso();
		} else {
			sim_step = node->get_piscadas();
			sim_wait = _wait_off();
		}
		return;
	}
	sim_wait = node->get_intervalo();
	const int n = sim_colors.size();
	if (sim_dir > 0) {
		const Color last = sim_colors[n - 1];
		for (int k = n - 1; k > 0; k--) {
			sim_colors.write[k] = sim_colors[k - 1];
		}
		sim_colors.write[0] = last;
	} else {
		const Color first = sim_colors[0];
		for (int k = 0; k + 1 < n; k++) {
			sim_colors.write[k] = sim_colors[k + 1];
		}
		sim_colors.write[n - 1] = first;
	}
	if (node->get_modo() == MDCicloCores::MODO_VAI_E_VOLTA && ++sim_step >= n - 1) {
		sim_step = 0;
		sim_dir = -sim_dir;
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

void RetroCicloPanel::_set_range(int p_paleta, int p_primeira, int p_quantidade) {
	MDCicloCores *node = _node();
	if (!node) {
		return;
	}
	node->set_paleta(p_paleta);
	node->set_primeira(p_primeira);
	node->set_quantidade(p_quantidade);
	grid->queue_redraw();
	_update_info();
}

// A mudança já está no node: a ação só registra o fazer e o desfazer.
void RetroCicloPanel::_commit_range(const String &p_action) {
	MDCicloCores *node = _node();
	if (!node || (node->get_paleta() == old_paleta && node->get_primeira() == old_primeira && node->get_quantidade() == old_quantidade)) {
		return;
	}
	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	undo->create_action(p_action, UndoRedo::MERGE_DISABLE, node);
	undo->add_do_property(node, "paleta", node->get_paleta());
	undo->add_do_property(node, "primeira", node->get_primeira());
	undo->add_do_property(node, "quantidade", node->get_quantidade());
	undo->add_undo_property(node, "paleta", old_paleta);
	undo->add_undo_property(node, "primeira", old_primeira);
	undo->add_undo_property(node, "quantidade", old_quantidade);
	undo->commit_action(false);
	node->notify_property_list_changed();
}

void RetroCicloPanel::_grid_draw() {
	MDCicloCores *node = _node();
	const float cell = CELL * EDSCALE, gap = GAP * EDSCALE;
	const Ref<Font> font = get_theme_font(SceneStringName(font), SNAME("Label"));
	const int font_size = get_theme_font_size(SceneStringName(font_size), SNAME("Label"));
	const Color text_color = get_theme_color(SceneStringName(font_color), SNAME("Label"));
	for (int row = 0; row < 4; row++) {
		const float y = row * (cell + gap);
		grid->draw_string(font, Vector2(0, y + cell * 0.8), "PAL" + itos(row), HORIZONTAL_ALIGNMENT_LEFT, -1, font_size * 0.85, text_color);
		for (int col = 0; col < 16; col++) {
			const Rect2 r(LABEL_W * EDSCALE + col * (cell + gap), y, cell, cell);
			if (col < palettes[row].size()) {
				grid->draw_rect(r, palettes[row][col]);
			} else {
				grid->draw_rect(r, Color(0.15, 0.15, 0.15));
			}
			if (col == 0) {
				// Cor 0: transparência.
				grid->draw_line(r.position, r.get_end(), Color(1, 0.3, 0.3, 0.8), 1.5);
			}
			if (counts[row][col] && col > 0) {
				grid->draw_circle(r.get_center() + Vector2(0, cell * 0.28), cell * 0.14, Color(1, 0.9, 0.2));
				grid->draw_arc(r.get_center() + Vector2(0, cell * 0.28), cell * 0.14, 0, Math::TAU, 10, Color(0, 0, 0, 0.8), 1.0);
			}
		}
	}
	if (node) {
		const float y = node->get_paleta() * (cell + gap);
		const Rect2 sel(LABEL_W * EDSCALE + node->get_primeira() * (cell + gap) - 2, y - 2, node->cores_usadas() * (cell + gap) - gap + 4, cell + 4);
		grid->draw_rect(sel, Color(1, 1, 1), false, 2.0 * EDSCALE);
	}
}

void RetroCicloPanel::_grid_input(const Ref<InputEvent> &p_event) {
	MDCicloCores *node = _node();
	if (!node) {
		return;
	}
	const Ref<InputEventMouseButton> mb = p_event;
	if (mb.is_valid() && mb->get_button_index() == MouseButton::LEFT) {
		int row, col;
		if (mb->is_pressed() && _cell_at(mb->get_position(), row, col)) {
			old_paleta = node->get_paleta();
			old_primeira = node->get_primeira();
			old_quantidade = node->get_quantidade();
			if (mb->is_shift_pressed() && row == node->get_paleta()) {
				anchor = node->get_primeira();
			} else {
				anchor = col;
			}
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
		if (_cell_at(Vector2(mm->get_position().x, node->get_paleta() * (CELL + GAP) * EDSCALE + 1), row, col)) {
			_set_range(node->get_paleta(), MIN(anchor, col), Math::abs(col - anchor) + 1);
		}
	}
}

void RetroCicloPanel::_preview_draw() {
	MDCicloCores *node = _node();
	if (!node || sim_colors.is_empty()) {
		return;
	}
	const float h = preview->get_size().y;
	const float w = MIN(preview->get_size().x / sim_colors.size(), 28 * EDSCALE);
	const Color flash = RetroPaletteDock::to_console(node->get_cor_piscar());
	for (int k = 0; k < sim_colors.size(); k++) {
		const Color c = node->get_modo() == MDCicloCores::MODO_PISCAR && sim_lit ? flash : sim_colors[k];
		preview->draw_rect(Rect2(k * w, 0, w - 1, h), c);
	}
}

void RetroCicloPanel::_use_area_pressed() {
	MDCicloCores *node = _node();
	if (!node || area_palette < 0) {
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
	old_paleta = node->get_paleta();
	old_primeira = node->get_primeira();
	old_quantidade = node->get_quantidade();
	_set_range(area_palette, first, last - first + 1);
	_commit_range(U("Usar as cores da área"));
	_reset_simulation();
}

void RetroCicloPanel::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_READY: {
			_load_palettes();
			_scan_area();
			_update_info();
			_reset_simulation();
			set_process(true);
		} break;
		case NOTIFICATION_PROCESS: {
			MDCicloCores *node = _node();
			if (!node) {
				return;
			}
			// Mudou alguma propriedade (pelo Inspetor ou desfazer): recomeça a prévia.
			const String sig = vformat("%d|%d|%d|%d|%d|%d|%s|%d|%d|%d|%d|%d", node->get_modo(), node->get_paleta(), node->get_primeira(), node->get_quantidade(), node->get_intervalo(), node->get_para_tras(),
					node->get_cor_piscar().to_html(false), node->get_quadros_aceso(), node->get_quadros_apagado(), node->get_piscadas(), node->get_variacao(), node->get_atraso());
			if (sig != sim_signature) {
				sim_signature = sig;
				_reset_simulation();
				_update_info();
				grid->queue_redraw();
			}
			// Moveu ou redimensionou a área: conta de novo as cores embaixo dela.
			const Transform2D xform = node->is_inside_tree() ? node->get_global_transform() : Transform2D();
			const String area = vformat("%s|%s", xform.get_origin(), node->get_tamanho());
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

void RetroCicloPanel::setup(MDCicloCores *p_node) {
	node_id = p_node->get_instance_id();
	Label *title = memnew(Label(U("Cores do efeito: clique numa cor; arraste ou Shift+clique para o trecho")));
	title->add_theme_color_override(SceneStringName(font_color), Color(1, 0.75, 0.4));
	title->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	add_child(title);
	grid = memnew(Control);
	grid->set_custom_minimum_size(Size2(LABEL_W + 16 * (CELL + GAP), 4 * (CELL + GAP)) * EDSCALE);
	grid->set_mouse_filter(Control::MOUSE_FILTER_STOP);
	grid->set_default_cursor_shape(Control::CURSOR_POINTING_HAND);
	grid->connect(SceneStringName(draw), callable_mp(this, &RetroCicloPanel::_grid_draw));
	grid->connect(SceneStringName(gui_input), callable_mp(this, &RetroCicloPanel::_grid_input));
	add_child(grid);
	Label *preview_label = memnew(Label(U("Prévia (no ritmo do jogo):")));
	add_child(preview_label);
	preview = memnew(Control);
	preview->set_custom_minimum_size(Size2(0, 20) * EDSCALE);
	preview->connect(SceneStringName(draw), callable_mp(this, &RetroCicloPanel::_preview_draw));
	add_child(preview);
	use_area = memnew(Button);
	use_area->set_text(U("Usar as cores da área"));
	use_area->set_tooltip_text(U("Escolhe a paleta e o trecho pelas cores que os mapas usam embaixo da área do node."));
	use_area->connect(SceneStringName(pressed), callable_mp(this, &RetroCicloPanel::_use_area_pressed));
	add_child(use_area);
	info = memnew(Label);
	info->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	info->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	add_child(info);
}

bool RetroCicloInspector::can_handle(Object *p_object) {
	return Object::cast_to<MDCicloCores>(p_object) != nullptr;
}

void RetroCicloInspector::parse_begin(Object *p_object) {
	RetroCicloPanel *panel = memnew(RetroCicloPanel);
	panel->setup(Object::cast_to<MDCicloCores>(p_object));
	add_custom_control(panel);
}
