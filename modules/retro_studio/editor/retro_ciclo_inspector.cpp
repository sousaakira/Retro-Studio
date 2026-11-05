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
#include "scene/resources/material.h"
#include "servers/rendering/rendering_server.h"

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
// ---- Cores como o jogo vai mostrar ----

// Imagem RGBA de um PNG, guardada enquanto o arquivo não muda.
static Ref<Image> rgba_image(const String &p_path) {
	struct Cached {
		uint64_t modified = 0;
		Ref<Image> image;
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
		cache[p_path] = c;
	}
	return cache[p_path].image;
}

// Os MDMapa da cena na ordem do build (pré-ordem da árvore).
static Vector<MDMapa *> scene_maps(Node *p_root) {
	Vector<MDMapa *> maps;
	Vector<Node *> stack;
	if (p_root) {
		stack.push_back(p_root);
	}
	while (!stack.is_empty()) {
		Node *n = stack[stack.size() - 1];
		stack.remove_at(stack.size() - 1);
		if (MDMapa *mapa = Object::cast_to<MDMapa>(n)) {
			maps.push_back(mapa);
		}
		for (int i = n->get_child_count() - 1; i >= 0; i--) {
			stack.push_back(n->get_child(i));
		}
	}
	return maps;
}

// O primeiro mapa do plano com a PAL: os outros da mesma PAL no plano são desenhados junto e usam a paleta dele
// (mapas de PALs diferentes no mesmo plano guardam cada um a sua, como no build).
MDMapa *RetroCicloPanel::plane_base(Node *p_root, int p_plano, int p_slot) {
	for (MDMapa *mapa : scene_maps(p_root)) {
		if (mapa->get_plano() == p_plano && mapa->get_paleta() == p_slot && mapa->get_tile_set().is_valid()) {
			return mapa;
		}
	}
	return nullptr;
}

int RetroCicloPanel::plane_map_count(Node *p_root, int p_plano, int p_slot) {
	int count = 0;
	for (MDMapa *mapa : scene_maps(p_root)) {
		count += mapa->get_plano() == p_plano && mapa->get_paleta() == p_slot && mapa->get_tile_set().is_valid();
	}
	return count;
}

// Cor de um mapa no ponto da cena (com os tiles espelhados); falso onde é transparente ou vazio.
static bool map_pixel(MDMapa *p_mapa, const Vector2 &p_point, Color &r_color) {
	const Ref<TileSet> tiles = p_mapa->get_tile_set();
	const Ref<Texture2D> texture = p_mapa->get_atlas_texture();
	if (tiles.is_null() || texture.is_null()) {
		return false;
	}
	const Vector2 local = p_mapa->to_local(p_point);
	const Vector2i cell = p_mapa->local_to_map(local);
	const int source_id = p_mapa->get_cell_source_id(cell);
	if (source_id < 0 || !tiles->has_source(source_id)) {
		return false;
	}
	const Ref<TileSetAtlasSource> atlas = tiles->get_source(source_id);
	const Ref<Image> image = rgba_image(texture->get_path());
	if (atlas.is_null() || image.is_null()) {
		return false;
	}
	const Vector2i size = tiles->get_tile_size();
	Vector2i in = Vector2i((local - p_mapa->map_to_local(cell) + Vector2(size) / 2).floor()).clamp(Vector2i(), size - Vector2i(1, 1));
	const int alt = p_mapa->get_cell_alternative_tile(cell);
	if (alt & TileSetAtlasSource::TRANSFORM_TRANSPOSE) {
		SWAP(in.x, in.y);
	}
	if (alt & TileSetAtlasSource::TRANSFORM_FLIP_H) {
		in.x = size.x - 1 - in.x;
	}
	if (alt & TileSetAtlasSource::TRANSFORM_FLIP_V) {
		in.y = size.y - 1 - in.y;
	}
	const Vector2i pixel = atlas->get_tile_texture_region(p_mapa->get_cell_atlas_coords(cell)).position + in;
	if (pixel.x < 0 || pixel.y < 0 || pixel.x >= image->get_width() || pixel.y >= image->get_height()) {
		return false;
	}
	r_color = image->get_pixel(pixel.x, pixel.y);
	return r_color.a >= 0.5;
}

// Paleta do mapa no jogo. Um mapa sozinho na PAL do plano usa a paleta do PNG dele; com mais mapas da mesma PAL
// no plano, o build junta os desenhos (os de baixo na árvore por cima) e tira as cores do resultado
// (RetroImageConvert::quantize).
// A mesma conta aqui, guardada enquanto os mapas e as imagens não mudam.
Vector<Color> RetroCicloPanel::plane_palette(Node *p_root, MDMapa *p_base) {
	Vector<MDMapa *> maps;
	for (MDMapa *mapa : scene_maps(p_root)) {
		if (mapa->get_plano() == p_base->get_plano() && mapa->get_paleta() == p_base->get_paleta() && mapa->get_tile_set().is_valid()) {
			maps.push_back(mapa);
		}
	}
	const Ref<Texture2D> base_texture = p_base->get_atlas_texture();
	if (maps.size() < 2) {
		return base_texture.is_valid() ? RetroMD::png_palette(base_texture->get_path()) : Vector<Color>();
	}
	String key;
	Vector2i size;
	for (MDMapa *mapa : maps) {
		const PackedByteArray data = mapa->get_tile_map_data_as_array();
		const Ref<Texture2D> texture = mapa->get_atlas_texture();
		const String path = texture.is_valid() ? texture->get_path() : String();
		key += vformat("%d:%d:%s:%d;", mapa->get_instance_id(), int64_t(hash_murmur3_buffer(data.ptr(), data.size())), path, int64_t(FileAccess::get_modified_time(path)));
		const Vector2i tile = mapa->get_tile_set()->get_tile_size();
		const Rect2i used = mapa->get_used_rect();
		size = size.max(Vector2i(used.get_end().x * tile.x, used.get_end().y * tile.y));
	}
	static HashMap<String, Vector<Color>> cache;
	if (cache.has(key)) {
		return cache[key];
	}
	Vector<Color> palette;
	if (size.x <= 0 || size.y <= 0 || int64_t(size.x) * size.y > 64 * 1024 * 1024) {
		return base_texture.is_valid() ? RetroMD::png_palette(base_texture->get_path()) : palette;
	}
	Ref<Image> composite = Image::create_empty(size.x, size.y, false, Image::FORMAT_RGBA8);
	composite->fill(Color(0, 0, 0, 0));
	for (MDMapa *mapa : maps) {
		const Ref<TileSet> tiles = mapa->get_tile_set();
		const Ref<Texture2D> texture = mapa->get_atlas_texture();
		const Ref<Image> image = texture.is_valid() ? rgba_image(texture->get_path()) : Ref<Image>();
		if (image.is_null()) {
			continue;
		}
		const Vector2i tile = tiles->get_tile_size();
		for (const Vector2i cell : mapa->get_used_cells()) {
			const int source_id = mapa->get_cell_source_id(cell);
			if (cell.x < 0 || cell.y < 0 || !tiles->has_source(source_id)) {
				continue;
			}
			const Ref<TileSetAtlasSource> atlas = tiles->get_source(source_id);
			if (atlas.is_null()) {
				continue;
			}
			Ref<Image> piece = image->get_region(atlas->get_tile_texture_region(mapa->get_cell_atlas_coords(cell)));
			const int alt = mapa->get_cell_alternative_tile(cell);
			if (alt & TileSetAtlasSource::TRANSFORM_FLIP_H) {
				piece->flip_x();
			}
			if (alt & TileSetAtlasSource::TRANSFORM_FLIP_V) {
				piece->flip_y();
			}
			composite->blend_rect(piece, Rect2i(Vector2i(), piece->get_size()), cell * tile);
		}
	}
	Vector<uint8_t> indices;
	RetroImageConvert::quantize(composite, indices, palette);
	cache[key] = palette;
	return palette;
}

int RetroCicloPanel::index_in(const Vector<Color> &p_palette, const Color &p_color) {
	const Color c = RetroPaletteDock::to_console(p_color);
	int best = -1;
	float best_d = 1e9;
	for (int k = 1; k < p_palette.size(); k++) {
		const Color q = p_palette[k];
		const float d = (c.r - q.r) * (c.r - q.r) + (c.g - q.g) * (c.g - q.g) + (c.b - q.b) * (c.b - q.b);
		if (d < best_d) {
			best_d = d;
			best = k;
		}
	}
	return best;
}

// Número da cor na paleta do jogo (1 a 15) mais parecida com a cor dada (na grade do console).
int RetroCicloPanel::index_for(int p_slot, const Color &p_color) const {
	return p_slot < 0 || p_slot > 3 ? -1 : index_in(palettes[p_slot], p_color);
}

// As paletas do jogo (como o console mostra): a de cada PAL vem do primeiro node da cena que a usa.
void RetroCicloPanel::scene_palettes(Node *root, Vector<Color> *palettes, String *sources) {
	for (int i = 0; i < 4; i++) {
		palettes[i].clear();
		sources[i] = String();
	}
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
			// Os mapas de um mesmo plano viram um só no jogo: a paleta é a do primeiro, com as cores de todos
			// (a mesma conta do build). Os outros mapas do plano não carregam paleta própria.
			if (plane_base(root, mapa->get_plano(), mapa->get_paleta()) == mapa) {
				slot = mapa->get_paleta();
				colors = plane_palette(root, mapa);
				const Ref<Texture2D> atlas = mapa->get_atlas_texture();
				source = atlas.is_valid() ? atlas->get_path() : String();
				if (plane_map_count(root, mapa->get_plano(), slot) > 1) {
					source = vformat(U("mapas da PAL%d no plano %s juntos"), slot, mapa->get_plano() == MDFundo::PLANO_A ? "A" : "B");
				}
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

void RetroCicloPanel::_load_palettes() {
	scene_palettes(EditorInterface::get_singleton()->get_edited_scene_root(), palettes, sources);
}

// Conta as cores (pela paleta do jogo) dos mapas e fundos que a área do node cobre.
void RetroCicloPanel::_scan_area() {
	for (int sl = 0; sl < 4; sl++) {
		for (int c = 0; c < 16; c++) {
			counts[sl][c] = 0;
		}
	}
	area_palette = -1;
	Node2D *node = _node();
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	if (!node || !root || !node->is_inside_tree()) {
		return;
	}
	const Rect2 area = node->get_global_transform().xform(Rect2(Vector2(), Vector2(Vector2i(node->get("tamanho")))));
	// Ponto a ponto da área (no máximo 128×128 amostras), a cor de cima: a mesma que o conta-gotas vê.
	const Vector2 step = (area.size / 128).max(Vector2(1, 1));
	for (float y = area.position.y + 0.5; y < area.get_end().y; y += step.y) {
		for (float x = area.position.x + 0.5; x < area.get_end().x; x += step.x) {
			int slot = 0;
			Color color;
			if (color_at(root, Vector2(x, y), slot, color)) {
				const int index = index_for(slot, color);
				if (index > 0 && index < 16) {
					counts[slot][index]++;
				}
			}
		}
	}
	int best = 0;
	for (int sl = 0; sl < 4; sl++) {
		int total = 0;
		for (int c = 1; c < 16; c++) {
			total += counts[sl][c];
		}
		if (total > best) {
			best = total;
			area_palette = sl;
		}
	}
}

void RetroCicloPanel::_update_info() {
	Node2D *node = _node();
	if (!node) {
		return;
	}
	// Uma linha por trecho e uma com as cores embaixo da área; o resto fica nas dicas.
	PackedStringArray lines;
	for (int f = 0; f < faixas.size(); f++) {
		const bool ligada = faixas[f].liga == StringName() || bool(node->get(faixas[f].liga));
		const int first = _primeira(f), last = first + _quantidade(f) - 1;
		lines.push_back(vformat(U("%s: PAL%d · cores %s%s"), faixas[f].label, _paleta(), first == last ? itos(first) : vformat(U("%d–%d"), first, last), ligada ? String() : U(" (desligada)")));
	}
	if (area_palette >= 0) {
		PackedStringArray used;
		for (int c = 1; c < 16; c++) {
			if (counts[area_palette][c]) {
				used.push_back(itos(c));
			}
		}
		lines.push_back(vformat(U("Na área: PAL%d · %s"), area_palette, String(", ").join(used)));
	} else {
		lines.push_back(U("Na área: nada (ponha a área sobre a arte)"));
	}
	info->set_text(String("\n").join(lines));
	info->set_tooltip_text(vformat(U("Paleta %d: %s.\nNo jogo o efeito vale para a paleta inteira, em toda a tela; a área só ajuda a escolher as cores."), _paleta(), sources[_paleta()].is_empty() ? U("nenhum node usa") : sources[_paleta()]));
	use_area->set_disabled(area_palette < 0);
	use_area->set_tooltip_text(faixas.size() > 1 ? vformat(U("Usar as cores embaixo da área na %s"), faixas[faixa].label.to_lower()) : U("Usar as cores embaixo da área"));
}

void RetroCicloPanel::sim_reset(Sim &r_sim, const MDEfeitoPaleta &p_efeito, const Vector<Color> &p_palette) {
	r_sim = Sim();
	for (int k = 0; k < p_efeito.quantidade; k++) {
		const int idx = p_efeito.primeira + k;
		r_sim.colors.push_back(idx < p_palette.size() ? p_palette[idx] : Color(0.2, 0.2, 0.2));
	}
	r_sim.dir = p_efeito.sentido;
	r_sim.step = p_efeito.modo == MDCicloCores::MODO_PISCAR ? p_efeito.piscadas : 0;
	r_sim.wait = p_efeito.atraso ? p_efeito.atraso : (p_efeito.modo == MDCicloCores::MODO_PISCAR ? _wait_off(p_efeito) : p_efeito.intervalo);
}

// Um quadro do jogo (a mesma lógica de efeitos_quadro no código gerado). Verdadeiro se as cores mudaram.
bool RetroCicloPanel::sim_frame(Sim &r_sim, const MDEfeitoPaleta &p_efeito) {
	if (r_sim.colors.is_empty() || --r_sim.wait > 0) {
		return false;
	}
	if (p_efeito.modo == MDCicloCores::MODO_PISCAR) {
		r_sim.lit = !r_sim.lit;
		if (r_sim.lit || --r_sim.step > 0) {
			r_sim.wait = p_efeito.aceso;
		} else {
			r_sim.step = p_efeito.piscadas;
			r_sim.wait = _wait_off(p_efeito);
		}
		return true;
	}
	r_sim.wait = p_efeito.intervalo;
	const int n = r_sim.colors.size();
	if (r_sim.dir > 0) {
		const Color last = r_sim.colors[n - 1];
		for (int k = n - 1; k > 0; k--) {
			r_sim.colors.write[k] = r_sim.colors[k - 1];
		}
		r_sim.colors.write[0] = last;
	} else {
		const Color first = r_sim.colors[0];
		for (int k = 0; k + 1 < n; k++) {
			r_sim.colors.write[k] = r_sim.colors[k + 1];
		}
		r_sim.colors.write[n - 1] = first;
	}
	if (p_efeito.modo == MDCicloCores::MODO_VAI_E_VOLTA && ++r_sim.step >= n - 1) {
		r_sim.step = 0;
		r_sim.dir = -r_sim.dir;
	}
	return true;
}

void RetroCicloPanel::_reset_simulation() {
	sims.clear();
	for (const MDEfeitoPaleta &e : _efeitos()) {
		Sim sim;
		sim_reset(sim, e, palettes[_paleta()]);
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

void RetroCicloPanel::_simulate_frame() {
	const Vector<MDEfeitoPaleta> efeitos = _efeitos();
	for (int i = 0; i < sims.size() && i < efeitos.size(); i++) {
		sim_frame(sims.write[i], efeitos[i]);
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
		case NOTIFICATION_THEME_CHANGED: {
			if (picker) {
				picker->set_button_icon(get_editor_theme_icon(SNAME("ColorPick")));
				use_area->set_button_icon(get_editor_theme_icon(SNAME("RegionEdit")));
			}
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
	if (faixa_do_node.has(node_id)) {
		faixa = CLAMP(faixa_do_node[node_id], 0, faixas.size() - 1);
	}
	add_theme_constant_override("separation", 4 * EDSCALE);

	// Barra: qual trecho o clique marca (na cachoeira) e as ferramentas em ícones.
	HBoxContainer *bar = memnew(HBoxContainer);
	add_child(bar);
	if (faixas.size() > 1) {
		for (int f = 0; f < faixas.size(); f++) {
			Button *b = memnew(Button);
			b->set_text(faixas[f].label);
			b->set_toggle_mode(true);
			b->set_pressed(f == faixa);
			b->set_tooltip_text(vformat(U("O clique nas amostras ou na cena escolhe as cores da %s."), faixas[f].label.to_lower()));
			b->connect(SceneStringName(pressed), callable_mp(this, &RetroCicloPanel::_select_faixa).bind(f));
			bar->add_child(b);
			faixa_buttons.push_back(b);
		}
	} else {
		Label *title = memnew(Label(U("Cores do efeito")));
		bar->add_child(title);
	}
	Control *spacer = memnew(Control);
	spacer->set_h_size_flags(SIZE_EXPAND_FILL);
	bar->add_child(spacer);
	picker = memnew(Button);
	picker->set_toggle_mode(true);
	picker->set_flat(true);
	picker->set_tooltip_text(U("Conta-gotas: passe o mouse na vista 2D para ver a cor e clique para escolhê-la. Shift+clique estende o trecho até a cor clicada. Esc desliga."));
	picker->connect(SceneStringName(toggled), callable_mp(this, &RetroCicloPanel::_picker_toggled));
	bar->add_child(picker);
	use_area = memnew(Button);
	use_area->set_flat(true);
	use_area->connect(SceneStringName(pressed), callable_mp(this, &RetroCicloPanel::_use_area_pressed));
	bar->add_child(use_area);

	grid = memnew(Control);
	grid->set_custom_minimum_size(Size2(LABEL_W + 16 * (CELL + GAP), 4 * (CELL + GAP)) * EDSCALE);
	grid->set_mouse_filter(Control::MOUSE_FILTER_STOP);
	grid->set_default_cursor_shape(Control::CURSOR_POINTING_HAND);
	grid->set_tooltip_text(cachoeira ? U("Clique numa cor; arraste ou Shift+clique para o trecho.\nPinte a queda com faixas das cores da água em sequência, de cima para baixo.")
									 : U("Clique numa cor; arraste ou Shift+clique para o trecho."));
	grid->connect(SceneStringName(draw), callable_mp(this, &RetroCicloPanel::_grid_draw));
	grid->connect(SceneStringName(gui_input), callable_mp(this, &RetroCicloPanel::_grid_input));
	add_child(grid);

	HBoxContainer *preview_row = memnew(HBoxContainer);
	Label *preview_label = memnew(Label(U("Prévia")));
	preview_label->add_theme_color_override(SceneStringName(font_color), Color(0.7, 0.7, 0.7));
	preview_row->add_child(preview_label);
	preview = memnew(Control);
	preview->set_h_size_flags(SIZE_EXPAND_FILL);
	preview->set_custom_minimum_size(Size2(0, 18) * EDSCALE);
	preview->set_tooltip_text(U("O efeito no ritmo do jogo (60 quadros por segundo)."));
	preview->connect(SceneStringName(draw), callable_mp(this, &RetroCicloPanel::_preview_draw));
	preview_row->add_child(preview);
	add_child(preview_row);

	picked = memnew(Label);
	picked->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	picked->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	picked->add_theme_color_override(SceneStringName(font_color), Color(1, 0.8, 0.45));
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
	info->set_mouse_filter(MOUSE_FILTER_PASS);
	add_child(info);
}

void RetroCicloPanel::_picker_toggled(bool p_on) {
	picked->set_visible(p_on);
	picking_node = p_on ? node_id : ObjectID();
	if (p_on) {
		picked_text = U("Conta-gotas ligado: clique numa cor na cena (Shift+clique estende).");
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

bool RetroCicloPanel::color_at(Node *p_root, const Vector2 &p_point, int &r_slot, Color &r_color) {
	if (!p_root) {
		return false;
	}
	// Plano A por cima do B. Em cada plano, os mapas de baixo na árvore por cima (como o build junta), e os
	// fundos (MDFundo) por último.
	for (int pass = 0; pass < 2; pass++) {
		const MDFundo::Plano plano = pass == 0 ? MDFundo::PLANO_A : MDFundo::PLANO_B;
		const Vector<MDMapa *> maps = scene_maps(p_root);
		for (int i = maps.size() - 1; i >= 0; i--) {
			if (maps[i]->get_plano() == plano && maps[i]->is_visible_in_tree() && map_pixel(maps[i], p_point, r_color)) {
				r_slot = maps[i]->get_paleta(); // Cada mapa fica na PAL dele (mesmo dividindo o plano).
				return true;
			}
		}
		TypedArray<Node> fundos = p_root->find_children("*", "MDFundo", true, false);
		for (int i = fundos.size() - 1; i >= 0; i--) {
			MDFundo *fundo = Object::cast_to<MDFundo>(fundos[i]);
			if (!fundo || fundo->get_plano() != plano || !fundo->is_visible_in_tree() || fundo->get_texture().is_null()) {
				continue;
			}
			const Ref<Image> image = rgba_image(fundo->get_texture()->get_path());
			const Vector2i pixel = Vector2i((fundo->to_local(p_point) - fundo->get_rect().position).floor());
			if (image.is_valid() && pixel.x >= 0 && pixel.y >= 0 && pixel.x < image->get_width() && pixel.y < image->get_height()) {
				r_color = image->get_pixel(pixel.x, pixel.y);
				if (r_color.a >= 0.5) {
					r_slot = fundo->get_paleta();
					return true;
				}
			}
		}
	}
	return false;
}

void RetroCicloPanel::pick_at(const Vector2 &p_point, bool p_extend) {
	int slot = 0;
	Color color;
	const int index = color_at(EditorInterface::get_singleton()->get_edited_scene_root(), p_point, slot, color) ? index_for(slot, color) : -1;
	if (index <= 0) {
		picked_text = U("Ali só há transparência: clique na arte de um mapa ou fundo.");
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
	picked_text = vformat(U("PAL%d, cor %d escolhida. %s"), slot, index, p_extend ? String() : U("Shift+clique noutra cor estende o trecho."));
	// O Inspetor pode ter se refeito com o commit: o texto vai para o painel novo.
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
		Color color;
		hover_ok = RetroCicloPanel::color_at(EditorInterface::get_singleton()->get_edited_scene_root(), to_scene.xform(hover_pos), hover_slot, color);
		hover_index = hover_ok ? panel->index_for(hover_slot, color) : -1;
		hover_ok = hover_ok && hover_index > 0;
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

// ---- Prévia das cores no editor (Animar) ----

void RetroCicloPickerPlugin::_notification(int p_what) {
	switch (p_what) {
		case NOTIFICATION_READY: {
			set_process(true);
		} break;
		case NOTIFICATION_PROCESS: {
			_preview_tick(get_process_delta_time());
		} break;
		case NOTIFICATION_EXIT_TREE: {
			_preview_clear();
		} break;
	}
}

void RetroCicloPickerPlugin::_preview_clear() {
	// Devolve a cada node o material dele (o da propriedade, normalmente nenhum).
	for (const KeyValue<ObjectID, Ref<ShaderMaterial>> &kv : applied) {
		CanvasItem *item = Object::cast_to<CanvasItem>(ObjectDB::get_instance(kv.key));
		if (!item) {
			continue;
		}
		const Ref<Material> own = item->get_material();
		RenderingServer::get_singleton()->canvas_item_set_material(item->get_canvas_item(), own.is_valid() ? own->get_rid() : RID());
		RenderingServer::get_singleton()->canvas_item_set_use_parent_material(item->get_canvas_item(), item->get_use_parent_material());
	}
	if (!applied.is_empty() && CanvasItemEditor::get_singleton()) {
		CanvasItemEditor::get_singleton()->update_viewport();
	}
	applied.clear();
	signature = String();
	sims.clear();
	efeitos.clear();
}

void RetroCicloPickerPlugin::_preview_tick(double p_delta) {
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	if (!MDSprite::is_previa_ligada() || !root) {
		if (!applied.is_empty() || !signature.is_empty()) {
			_preview_clear();
		}
		return;
	}
	if (root->get_instance_id() != scene_id) {
		_preview_clear();
		scene_id = root->get_instance_id();
	}
	// Os efeitos da cena; se mudaram (propriedades, nodes novos), recomeça como o jogo ao entrar na cena.
	Vector<MDEfeitoPaleta> now;
	TypedArray<Node> found = root->find_children("*", "", true, false);
	found.push_front(root);
	for (int i = 0; i < found.size(); i++) {
		if (MDCicloCores *ciclo = Object::cast_to<MDCicloCores>(found[i])) {
			now.append_array(ciclo->efeitos());
		} else if (MDCachoeira *cachoeira = Object::cast_to<MDCachoeira>(found[i])) {
			now.append_array(cachoeira->efeitos());
		}
	}
	String sig;
	for (const MDEfeitoPaleta &e : now) {
		sig += vformat("%d,%d,%d,%d,%d,%d,%s,%d,%d,%d,%d,%d,%d,%s;", e.paleta, e.primeira, e.quantidade, e.intervalo, e.sentido, e.modo, e.cor.to_html(false), e.aceso, e.piscadas, e.variacao, e.apagado, e.atraso, int(e.so_na_area), String(Variant(e.area)));
	}
	if (sig != signature) {
		signature = sig;
		efeitos = now;
		String sources[4];
		RetroCicloPanel::scene_palettes(root, base, sources);
		sims.clear();
		for (const MDEfeitoPaleta &e : efeitos) {
			RetroCicloPanel::Sim sim;
			RetroCicloPanel::sim_reset(sim, e, base[CLAMP(e.paleta, 0, 3)]);
			sims.push_back(sim);
		}
		time = 0;
		dirty = true;
	}
	if (efeitos.is_empty()) {
		if (!applied.is_empty()) {
			_preview_clear();
			signature = sig;
		}
		return;
	}
	time += p_delta;
	int frames = 0;
	while (time >= 1.0 / 60.0 && frames < 8) {
		time -= 1.0 / 60.0;
		for (int i = 0; i < sims.size(); i++) {
			dirty = RetroCicloPanel::sim_frame(sims.write[i], efeitos[i]) || dirty;
		}
		frames++;
	}
	if (dirty) {
		dirty = false;
		_preview_apply(root);
	}
}

void RetroCicloPickerPlugin::_preview_apply(Node *p_root) {
	if (shader.is_null()) {
		shader.instantiate();
		// Troca as cores do PNG do node pelas do quadro: cada cor de origem tem a cor que ela vira agora.
		shader->set_code(R"(shader_type canvas_item;
uniform vec4 de[16];
uniform vec4 para[16];
uniform vec4 para_area[16];
uniform vec4 areas[8];
uniform int n_areas = 0;
uniform int quantas = 0;
varying vec4 tom;
varying vec2 mundo;
void vertex() {
	tom = COLOR;
	mundo = (MODEL_MATRIX * vec4(VERTEX, 0.0, 1.0)).xy;
}
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	// Dentro de uma área "só na área", valem também os efeitos dela; fora, só os que mudam a PAL inteira.
	bool dentro = false;
	for (int a = 0; a < 8; a++) {
		if (a >= n_areas) {
			break;
		}
		if (mundo.x >= areas[a].x && mundo.y >= areas[a].y && mundo.x < areas[a].z && mundo.y < areas[a].w) {
			dentro = true;
			break;
		}
	}
	for (int i = 1; i < 16; i++) {
		if (i >= quantas) {
			break;
		}
		if (distance(c.rgb, de[i].rgb) < 0.01) {
			c.rgb = dentro ? para_area[i].rgb : para[i].rgb;
			break;
		}
	}
	COLOR = c * tom;
}
)");
	}
	// Paletas do quadro: a do jogo com as cores de cada efeito por cima. "now" vale fora das áreas (só os efeitos
	// da PAL inteira); "inside" vale nas células das áreas "só na área" (todos), como o build troca os pixels.
	Vector<Color> now[4], inside[4];
	PackedColorArray areas[4]; // Retângulos (x0, y0, x1, y1) no vec4 do shader.
	for (int sl = 0; sl < 4; sl++) {
		now[sl] = base[sl];
		inside[sl] = base[sl];
	}
	for (int i = 0; i < sims.size() && i < efeitos.size(); i++) {
		const MDEfeitoPaleta &e = efeitos[i];
		const int sl = CLAMP(e.paleta, 0, 3);
		for (int k = 0; k < sims[i].colors.size(); k++) {
			const int idx = e.primeira + k;
			const Color c = e.modo == MDCicloCores::MODO_PISCAR && sims[i].lit ? RetroPaletteDock::to_console(e.cor) : sims[i].colors[k];
			if (idx < inside[sl].size()) {
				inside[sl].write[idx] = c;
			}
			if (!e.so_na_area && idx < now[sl].size()) {
				now[sl].write[idx] = c;
			}
		}
		if (e.so_na_area && areas[sl].size() < 8) {
			// Células de 8×8 que tocam a área (a mesma conta do build).
			const Vector2 a = (e.area.position / 8).floor() * 8, b = (e.area.get_end() / 8).ceil() * 8;
			areas[sl].push_back(Color(a.x, a.y, b.x, b.y));
		}
	}
	TypedArray<Node> found = p_root->find_children("*", "", true, false);
	found.push_front(p_root);
	RenderingServer *rs = RenderingServer::get_singleton();
	for (int i = 0; i < found.size(); i++) {
		CanvasItem *item = Object::cast_to<CanvasItem>(found[i]);
		String path;
		int slot = -1;
		if (MDMapa *mapa = Object::cast_to<MDMapa>(found[i])) {
			const Ref<Texture2D> atlas = mapa->get_atlas_texture();
			path = atlas.is_valid() ? atlas->get_path() : String();
			slot = mapa->get_paleta();
		} else if (MDFundo *fundo = Object::cast_to<MDFundo>(found[i])) {
			path = fundo->get_texture().is_valid() ? fundo->get_texture()->get_path() : String();
			slot = fundo->get_paleta();
		}
		if (!item || path.is_empty() || slot < 0 || slot > 3) {
			continue;
		}
		// Cada cor do PNG do node vai para o número dela na paleta do jogo e pega a cor do quadro.
		const Vector<Color> plte = RetroMD::png_palette(path);
		PackedColorArray de, para, para_area;
		bool changes = false;
		for (int k = 0; k < 16; k++) {
			const Color src = k < plte.size() ? plte[k] : Color(0, 0, 0);
			Color dst = src, dst_area = src;
			const int g = k ? RetroCicloPanel::index_in(base[slot], src) : -1;
			if (g > 0 && g < now[slot].size() && now[slot][g] != base[slot][g]) {
				dst = now[slot][g];
				changes = true;
			}
			if (g > 0 && g < inside[slot].size() && inside[slot][g] != base[slot][g]) {
				dst_area = inside[slot][g];
				changes = true;
			}
			de.push_back(src);
			para.push_back(dst);
			para_area.push_back(dst_area);
		}
		const ObjectID id = item->get_instance_id();
		if (!changes && !applied.has(id)) {
			continue;
		}
		Ref<ShaderMaterial> material = applied.has(id) ? applied[id] : Ref<ShaderMaterial>();
		if (material.is_null()) {
			material.instantiate();
			material->set_shader(shader);
			applied[id] = material;
			rs->canvas_item_set_use_parent_material(item->get_canvas_item(), false);
			rs->canvas_item_set_material(item->get_canvas_item(), material->get_rid());
		}
		material->set_shader_parameter("de", de);
		material->set_shader_parameter("para", para);
		material->set_shader_parameter("para_area", para_area);
		PackedColorArray rects = areas[slot];
		material->set_shader_parameter("n_areas", rects.size());
		while (rects.size() < 8) {
			rects.push_back(Color(0, 0, 0, 0));
		}
		material->set_shader_parameter("areas", rects);
		material->set_shader_parameter("quantas", MIN(plte.size(), 16));
	}
	// Com o editor economizando processador, a vista só se redesenha quando alguém pede: mudar o parâmetro do
	// shader não pede.
	CanvasItemEditor::get_singleton()->update_viewport();
}

bool RetroCicloInspector::can_handle(Object *p_object) {
	return Object::cast_to<MDCicloCores>(p_object) || Object::cast_to<MDCachoeira>(p_object);
}

void RetroCicloInspector::parse_begin(Object *p_object) {
	RetroCicloPanel *panel = memnew(RetroCicloPanel);
	panel->setup(Object::cast_to<Node2D>(p_object));
	add_custom_control(panel);
}
