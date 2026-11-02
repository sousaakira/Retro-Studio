#include "retro_map_import.h"
#include "retro_map_editor.h"

#include "retro_image_convert.h"
#include "retro_sgdk_export.h"

#include "core/config/project_settings.h"
#include "core/input/input.h"
#include "scene/gui/button.h"
#include "scene/gui/check_box.h"
#include "scene/gui/panel_container.h"
#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/resource_loader.h"
#include "core/io/resource_saver.h"
#include "core/object/callable_mp.h"
#include "editor/editor_node.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/gui/editor_toaster.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/label.h"
#include "scene/gui/option_button.h"
#include "scene/resources/2d/tile_set.h"

namespace {
String U(const char *p_text) {
	return String::utf8(p_text);
}

constexpr int ATLAS_COLUMNS = 32; // 256 px de largura, como os TileSets do Sota.
} // namespace

namespace RetroMapImport {

Result build(const String &p_png, const Vector2i &p_offset) {
	Result r;
	Ref<Image> image = MDPersonagem::load_sheet(p_png);
	if (image.is_null() || image->is_empty()) {
		r.error = U("Não foi possível ler ") + p_png.get_file() + ".";
		return r;
	}
	image = image->duplicate();
	image->convert(Image::FORMAT_RGBA8);
	const int width = (image->get_width() + 7) / 8 * 8;
	const int height = (image->get_height() + 7) / 8 * 8;
	if (width != image->get_width() || height != image->get_height()) {
		Ref<Image> padded = Image::create_empty(width, height, false, Image::FORMAT_RGBA8);
		padded->fill(Color(0, 0, 0, 0));
		padded->blit_rect(image, Rect2i(Point2i(), image->get_size()), Point2i());
		image = padded;
		r.padded = true;
	}
	r.size = Vector2i(width, height);
	const Vector2i cells(width / 8, height / 8);
	if (cells.x > 1024 || cells.y > 1024 || int64_t(cells.x) * cells.y > 65536) {
		r.error = vformat(U("O cenário (%d×%d px) passa do maior mapa que o jogo lê: até 1024 células (8192 px) de lado e 65536 células no total."), width, height);
		return r;
	}

	// Cores na grade do console: no máximo 15 mais a transparência (a cor 0).
	Vector<uint8_t> indices;
	Vector<Color> palette;
	r.original_colors = RetroImageConvert::quantize(image, indices, palette);
	r.colors = palette.size() - 1;

	// Tiles de 8×8: os iguais viram um só; os todos transparentes ficam sem tile.
	HashMap<String, int> tile_of;
	Vector<String> tiles; // 64 índices por tile, como texto (chave e dados).
	Vector<int> cell_tile;
	cell_tile.resize(cells.x * cells.y);
	for (int cy = 0; cy < cells.y; cy++) {
		for (int cx = 0; cx < cells.x; cx++) {
			String key;
			key.resize_uninitialized(65);
			char32_t *k = key.ptrw();
			bool empty = true;
			for (int y = 0; y < 8; y++) {
				for (int x = 0; x < 8; x++) {
					const uint8_t index = indices[(cy * 8 + y) * width + cx * 8 + x];
					empty = empty && index == 0;
					k[y * 8 + x] = char32_t(index + 1);
				}
			}
			k[64] = 0;
			int found = -1;
			if (!empty) {
				const HashMap<String, int>::Iterator it = tile_of.find(key);
				if (it) {
					found = it->value;
				} else {
					found = tiles.size();
					tile_of[key] = found;
					tiles.push_back(key);
				}
				r.cells++;
			}
			cell_tile.write[cy * cells.x + cx] = found;
		}
	}
	r.unique = tiles.size();
	if (r.unique == 0) {
		r.error = U("A imagem está toda transparente: não há nada para pôr no mapa.");
		return r;
	}

	// Imagem dos tiles (PNG indexado com a paleta do cenário) ao lado do PNG original.
	const int rows = (r.unique + ATLAS_COLUMNS - 1) / ATLAS_COLUMNS;
	const int atlas_w = ATLAS_COLUMNS * 8, atlas_h = rows * 8;
	Vector<uint8_t> atlas;
	atlas.resize(atlas_w * atlas_h);
	memset(atlas.ptrw(), 0, atlas.size());
	for (int t = 0; t < r.unique; t++) {
		const char32_t *k = tiles[t].ptr();
		const int ox = (t % ATLAS_COLUMNS) * 8, oy = (t / ATLAS_COLUMNS) * 8;
		for (int i = 0; i < 64; i++) {
			atlas.write[(oy + i / 8) * atlas_w + ox + i % 8] = uint8_t(k[i] - 1);
		}
	}
	const String base = p_png.get_file().get_basename();
	r.atlas_path = p_png.get_base_dir().path_join(base + "_tiles.png");
	const Vector<uint8_t> png = RetroSgdkExport::indexed_png(atlas_w, atlas_h, atlas, palette);
	{
		const Ref<FileAccess> file = FileAccess::open(r.atlas_path, FileAccess::WRITE);
		if (file.is_null()) {
			r.error = U("Não foi possível gravar ") + r.atlas_path + ".";
			return r;
		}
		file->store_buffer(png.ptr(), png.size());
	}
	EditorFileSystem *efs = EditorFileSystem::get_singleton();
	efs->update_file(r.atlas_path);
	Vector<String> reimport;
	reimport.push_back(r.atlas_path);
	efs->reimport_files(reimport);
	const Ref<Texture2D> texture = ResourceLoader::load(r.atlas_path, "Texture2D", ResourceFormatLoader::CACHE_MODE_REPLACE);
	if (texture.is_null()) {
		r.error = U("A imagem dos tiles foi gravada, mas o editor não conseguiu abri-la: ") + r.atlas_path + ".";
		return r;
	}

	// TileSet em res://tilesets/<nome>.tres; ao reimportar, o mesmo recurso é atualizado (as cenas que o
	// usam veem o desenho novo).
	DirAccess::make_dir_recursive_absolute(ProjectSettings::get_singleton()->globalize_path("res://tilesets"));
	r.tileset_path = "res://tilesets/" + base + ".tres";
	Ref<TileSet> tile_set;
	if (FileAccess::exists(r.tileset_path)) {
		tile_set = ResourceLoader::load(r.tileset_path, "TileSet");
	}
	if (tile_set.is_null()) {
		tile_set.instantiate();
	}
	while (tile_set->get_source_count() > 0) {
		tile_set->remove_source(tile_set->get_source_id(0));
	}
	tile_set->set_tile_size(Size2i(8, 8));
	Ref<TileSetAtlasSource> source;
	source.instantiate();
	source->set_texture(texture);
	source->set_texture_region_size(Vector2i(8, 8));
	for (int t = 0; t < r.unique; t++) {
		source->create_tile(Vector2i(t % ATLAS_COLUMNS, t / ATLAS_COLUMNS));
	}
	const int source_id = tile_set->add_source(source);
	tile_set->set_meta("retro_origem", p_png); // De que PNG o TileSet veio (para reimportar).
	// O recurso fica ligado ao arquivo (o FLAG_CHANGE_PATH só troca o caminho durante a gravação): sem isso,
	// a cena guardaria uma cópia do TileSet dentro dela em vez de apontar para tilesets/<nome>.tres.
	if (tile_set->get_path() != r.tileset_path) {
		tile_set->set_path(r.tileset_path, true);
	}
	const Error err = ResourceSaver::save(tile_set, r.tileset_path);
	if (err != OK) {
		r.error = U("Não foi possível gravar ") + r.tileset_path + ".";
		return r;
	}
	efs->update_file(r.tileset_path);
	r.tile_set = tile_set;

	// Os dados do mapa, montados numa camada solta (a cena só muda no Ctrl+Z-ável do diálogo).
	TileMapLayer *layer = memnew(TileMapLayer);
	layer->set_tile_set(tile_set);
	for (int cy = 0; cy < cells.y; cy++) {
		for (int cx = 0; cx < cells.x; cx++) {
			const int t = cell_tile[cy * cells.x + cx];
			if (t >= 0) {
				layer->set_cell(Vector2i(cx, cy) + p_offset, source_id, Vector2i(t % ATLAS_COLUMNS, t / ATLAS_COLUMNS));
			}
		}
	}
	r.map_data = layer->get_tile_map_data_as_array();
	memdelete(layer);
	return r;
}

bool move_cells(const Vector<TileMapLayer *> &p_layers, const Vector2i &p_delta, String &r_error) {
	Vector<TileMapLayer *> layers;
	for (TileMapLayer *layer : p_layers) {
		if (!layer->get_used_cells().is_empty()) {
			layers.push_back(layer);
		}
	}
	if (layers.is_empty()) {
		r_error = U("O mapa está vazio.");
		return false;
	}
	for (TileMapLayer *layer : layers) {
		const Rect2i used = layer->get_used_rect();
		const Vector2i start = used.position + p_delta;
		if (start.x < 0 || start.y < 0) {
			const Size2i tile = layer->get_tile_set().is_valid() ? layer->get_tile_set()->get_tile_size() : Size2i(8, 8);
			r_error = start.y < 0 ? vformat(U("%s já encosta em cima (pode subir no máximo %d px)."), layer->get_name(), used.position.y * tile.y)
								  : vformat(U("%s já encosta à esquerda (pode ir no máximo %d px para a esquerda)."), layer->get_name(), used.position.x * tile.x);
			return false;
		}
	}
	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	undo->create_action(layers.size() == 1 ? U("Mover o desenho: ") + layers[0]->get_name() : U("Mover o desenho dos mapas"), UndoRedo::MERGE_DISABLE, layers[0]);
	for (TileMapLayer *layer : layers) {
		const TypedArray<Vector2i> cells = layer->get_used_cells();
		TileMapLayer *moved = memnew(TileMapLayer);
		moved->set_tile_set(layer->get_tile_set());
		for (int i = 0; i < cells.size(); i++) {
			const Vector2i cell = cells[i];
			moved->set_cell(cell + p_delta, layer->get_cell_source_id(cell), layer->get_cell_atlas_coords(cell), layer->get_cell_alternative_tile(cell));
		}
		undo->add_do_property(layer, "tile_map_data", moved->get_tile_map_data_as_array());
		undo->add_undo_property(layer, "tile_map_data", layer->get_tile_map_data_as_array());
		memdelete(moved);
		// O deslocamento fica no node, para a reimportação do PNG pôr o desenho no mesmo lugar.
		const Vector2i offset = layer->get_meta("retro_deslocamento", Vector2i());
		undo->add_do_method(layer, "set_meta", "retro_deslocamento", offset + p_delta);
		undo->add_undo_method(layer, "set_meta", "retro_deslocamento", offset);
		// O Inspetor refaz o painel (a posição mostrada) depois de mover e do Ctrl+Z.
		undo->add_do_method(layer, "notify_property_list_changed");
		undo->add_undo_method(layer, "notify_property_list_changed");
	}
	undo->commit_action();
	return true;
}

} // namespace RetroMapImport

bool RetroMapMoveInspector::can_handle(Object *p_object) {
	return Object::cast_to<MDMapa>(p_object) || Object::cast_to<MDColisao>(p_object) || Object::cast_to<MDPrioridade>(p_object);
}

// A camada escolhida ou, com "todos juntos", todos os mapas da cena (para não desalinhar fundo, frente e colisão).
Vector<TileMapLayer *> RetroMapMoveInspector::_layers(ObjectID p_layer) {
	Vector<TileMapLayer *> layers;
	TileMapLayer *layer = Object::cast_to<TileMapLayer>(ObjectDB::get_instance(p_layer));
	if (!layer) {
		return layers;
	}
	Node *root = EditorNode::get_singleton()->get_edited_scene();
	if (!all_layers || !root) {
		layers.push_back(layer);
		return layers;
	}
	const TypedArray<Node> found = root->find_children("*", "TileMapLayer", true, true);
	for (int i = 0; i < found.size(); i++) {
		TileMapLayer *other = Object::cast_to<TileMapLayer>(found[i]);
		if (other && (Object::cast_to<MDMapa>(other) || Object::cast_to<MDColisao>(other) || Object::cast_to<MDPrioridade>(other)) && other->get_owner() == root) {
			layers.push_back(other);
		}
	}
	if (!layers.has(layer)) {
		layers.push_back(layer);
	}
	return layers;
}

void RetroMapMoveInspector::_move(ObjectID p_layer, Vector2i p_delta) {
	if (Input::get_singleton()->is_key_pressed(Key::SHIFT)) {
		p_delta *= 8; // 64 px.
	}
	String error;
	if (!RetroMapImport::move_cells(_layers(p_layer), p_delta, error)) {
		EditorToaster::get_singleton()->popup_str(error, EditorToaster::SEVERITY_WARNING);
	}
}

void RetroMapMoveInspector::_snap(ObjectID p_layer, bool p_top) {
	const Vector<TileMapLayer *> layers = _layers(p_layer);
	// O desenho que começa mais perto do canto encosta; os outros andam o mesmo tanto.
	int nearest = INT_MAX;
	for (TileMapLayer *layer : layers) {
		if (!layer->get_used_cells().is_empty()) {
			const Vector2i start = layer->get_used_rect().position;
			nearest = MIN(nearest, p_top ? start.y : start.x);
		}
	}
	if (nearest == INT_MAX) {
		return;
	}
	if (nearest == 0) {
		EditorToaster::get_singleton()->popup_str(p_top ? U("O desenho já encosta em cima.") : U("O desenho já encosta à esquerda."), EditorToaster::SEVERITY_INFO);
		return;
	}
	String error;
	if (!RetroMapImport::move_cells(layers, p_top ? Vector2i(0, -nearest) : Vector2i(-nearest, 0), error)) {
		EditorToaster::get_singleton()->popup_str(error, EditorToaster::SEVERITY_WARNING);
	}
}

void RetroMapMoveInspector::_fix_region(ObjectID p_layer) {
	RetroMapEditor::fix_region_size(Object::cast_to<TileMapLayer>(ObjectDB::get_instance(p_layer)));
}

void RetroMapMoveInspector::_fix_negative(ObjectID p_layer) {
	const Vector<TileMapLayer *> layers = _layers(p_layer);
	Vector2i start(INT_MAX, INT_MAX);
	for (TileMapLayer *layer : layers) {
		if (!layer->get_used_cells().is_empty()) {
			start = start.min(layer->get_used_rect().position);
		}
	}
	if (start.x == INT_MAX) {
		return;
	}
	// Só os eixos que passaram de 0 andam; o resto do desenho fica onde está.
	const Vector2i delta(MAX(0, -start.x), MAX(0, -start.y));
	if (delta == Vector2i()) {
		return;
	}
	String error;
	if (!RetroMapImport::move_cells(layers, delta, error)) {
		EditorToaster::get_singleton()->popup_str(error, EditorToaster::SEVERITY_WARNING);
	} else if (Object *object = ObjectDB::get_instance(p_layer)) {
		object->notify_property_list_changed(); // O painel sem o aviso resolvido.
	}
}

void RetroMapMoveInspector::_convert_tileset(ObjectID p_layer) {
	MDMapa *mapa = Object::cast_to<MDMapa>(ObjectDB::get_instance(p_layer));
	if (!mapa || mapa->get_tile_set().is_null()) {
		return;
	}
	const Ref<TileSet> tiles = mapa->get_tile_set();
	const Ref<Texture2D> old_texture = mapa->get_atlas_texture();
	Ref<TileSetAtlasSource> source;
	int source_id = -1;
	for (int i = 0; i < tiles->get_source_count(); i++) {
		Ref<TileSetAtlasSource> atlas = tiles->get_source(tiles->get_source_id(i));
		if (atlas.is_valid() && atlas->get_texture() == old_texture) {
			source = atlas;
			source_id = tiles->get_source_id(i);
			break;
		}
	}
	if (source.is_null() || old_texture.is_null()) {
		return;
	}
	const String original = old_texture->get_path();
	Ref<Image> image = MDPersonagem::load_sheet(original);
	if (image.is_null()) {
		EditorToaster::get_singleton()->popup_str(U("Não foi possível ler ") + original.get_file() + ".", EditorToaster::SEVERITY_ERROR);
		return;
	}
	image->convert(Image::FORMAT_RGBA8);
	// As 15 cores saem só dos tiles pintados nos mapas da cena que usam este TileSet: um tileset grande,
	// cheio de desenhos que a fase não usa, não gasta a paleta.
	Vector<Vector2i> used;
	Node *root = EditorNode::get_singleton()->get_edited_scene();
	TypedArray<Node> maps = root ? root->find_children("*", "MDMapa", true, false) : TypedArray<Node>();
	if (root && Object::cast_to<MDMapa>(root)) {
		maps.push_back(root);
	}
	for (int i = 0; i < maps.size(); i++) {
		MDMapa *other = Object::cast_to<MDMapa>(maps[i]);
		if (!other || other->get_tile_set() != tiles) {
			continue;
		}
		for (const Vector2i cell : other->get_used_cells()) {
			if (other->get_cell_source_id(cell) == source_id) {
				const Vector2i atlas = other->get_cell_atlas_coords(cell);
				if (!used.has(atlas)) {
					used.push_back(atlas);
				}
			}
		}
	}
	const Vector2i tile = tiles->get_tile_size();
	const Vector2i margin = source->get_margins(), separation = source->get_separation();
	Ref<Image> sample;
	if (used.is_empty()) {
		sample = image; // Mapa vazio: a imagem inteira.
	} else {
		sample = Image::create_empty(tile.x * used.size(), tile.y, false, Image::FORMAT_RGBA8);
		for (int i = 0; i < used.size(); i++) {
			const Vector2i from = margin + used[i] * (tile + separation);
			sample->blit_rect(image, Rect2i(from, tile), Vector2i(i * tile.x, 0));
		}
	}
	// Uma cópia por TileSet (outro mapa com outro TileSet da mesma imagem ganha a dele, com a paleta dele).
	String suffix = mapa->get_name();
	const String tileset_path = tiles->get_path();
	if (!tileset_path.is_empty() && !tileset_path.contains("::")) {
		suffix = tileset_path.get_file().get_basename();
	}
	const String out_path = original.get_basename().trim_suffix("_md") + "_" + suffix.to_lower().validate_filename() + "_md.png";
	String message;
	if (RetroImageConvert::convert_with_sample(original, sample, out_path, message).is_empty()) {
		EditorToaster::get_singleton()->popup_str(message, EditorToaster::SEVERITY_ERROR);
		return;
	}
	EditorFileSystem::get_singleton()->update_file(out_path);
	Vector<String> files;
	files.push_back(out_path);
	EditorFileSystem::get_singleton()->reimport_files(files);
	const Ref<Texture2D> new_texture = ResourceLoader::load(out_path, "", ResourceFormatLoader::CACHE_MODE_REPLACE);
	if (new_texture.is_null()) {
		EditorToaster::get_singleton()->popup_str(U("Não foi possível abrir ") + out_path.get_file() + ".", EditorToaster::SEVERITY_ERROR);
		return;
	}
	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	undo->create_action(U("Converter a imagem do TileSet para o Mega Drive"));
	undo->add_do_method(source.ptr(), "set_texture", new_texture);
	undo->add_undo_method(source.ptr(), "set_texture", old_texture);
	for (int i = 0; i < maps.size(); i++) {
		MDMapa *other = Object::cast_to<MDMapa>(maps[i]);
		if (other && other->get_tile_set() == tiles) {
			undo->add_do_method(other, "update_configuration_warnings");
			undo->add_undo_method(other, "update_configuration_warnings");
		}
	}
	// O Inspetor monta de novo o painel (sem o aviso que acabou de ser resolvido).
	undo->add_do_method(mapa, "notify_property_list_changed");
	undo->add_undo_method(mapa, "notify_property_list_changed");
	undo->commit_action();
	EditorToaster::get_singleton()->popup_str(vformat(U("%s A paleta saiu dos %d tiles que os mapas usam; o PNG original fica como está. Salve a cena."), message, used.size()), EditorToaster::SEVERITY_INFO);
}

void RetroMapMoveInspector::parse_begin(Object *p_object) {
	TileMapLayer *layer = Object::cast_to<TileMapLayer>(p_object);
	const ObjectID id = layer->get_instance_id();
	PanelContainer *panel = memnew(PanelContainer);
	VBoxContainer *box = memnew(VBoxContainer);
	panel->add_child(box);
	Label *title = memnew(Label(U("Posição do desenho")));
	title->add_theme_color_override(SceneStringName(font_color), Color(1, 0.85, 0.4));
	box->add_child(title);
	Label *where = memnew(Label);
	where->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	where->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
	const Size2i tile = layer->get_tile_set().is_valid() ? layer->get_tile_set()->get_tile_size() : Size2i(8, 8);
	if (layer->get_used_cells().is_empty()) {
		where->set_text(U("O mapa está vazio."));
	} else {
		const Rect2i used = layer->get_used_rect();
		where->set_text(vformat(U("Começa em x %d, y %d px; ocupa %d×%d px. O node fica em (0, 0); as setas movem o desenho."), used.position.x * tile.x, used.position.y * tile.y, used.size.x * tile.x, used.size.y * tile.y));
	}
	box->add_child(where);
	// Avisos com conserto num clique: desenho fora do canto (0, 0) e imagem do TileSet fora do formato.
	if (!layer->get_used_cells().is_empty() && (layer->get_used_rect().position.x < 0 || layer->get_used_rect().position.y < 0)) {
		Label *negative = memnew(Label(U("Parte do desenho está antes do canto (0, 0) e não entraria no jogo.")));
		negative->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		negative->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
		negative->add_theme_color_override(SceneStringName(font_color), Color(1, 0.55, 0.45));
		box->add_child(negative);
		Button *fix = memnew(Button);
		fix->set_text(U("Trazer o desenho para dentro"));
		fix->set_tooltip_text(U("Move o desenho para a direita e/ou para baixo até começar em (0, 0). Com \"Mover todos os mapas da cena juntos\", a colisão e os outros mapas acompanham."));
		fix->connect(SceneStringName(pressed), callable_mp_static(&RetroMapMoveInspector::_fix_negative).bind(id));
		box->add_child(fix);
	}
	if (RetroMapEditor::needs_region_fix(layer)) {
		Label *region = memnew(Label(U("O TileSet recorta a imagem em tiles maiores que 8×8 (o padrão do Godot é 16×16): no 2D eles transbordam da célula e o jogo só pega um pedaço de cada.")));
		region->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
		region->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
		region->add_theme_color_override(SceneStringName(font_color), Color(1, 0.55, 0.45));
		box->add_child(region);
		Button *fix = memnew(Button);
		fix->set_text(U("Ajustar os tiles para 8×8"));
		fix->set_tooltip_text(U("Cada tile grande vira um bloco de tiles de 8×8, nos mapas da cena que usam este TileSet. Dá para desfazer."));
		fix->connect(SceneStringName(pressed), callable_mp_static(&RetroMapMoveInspector::_fix_region).bind(id));
		box->add_child(fix);
	}
	if (MDMapa *mapa = Object::cast_to<MDMapa>(layer)) {
		const Ref<Texture2D> image = mapa->get_atlas_texture();
		bool needs_conversion = false;
		if (image.is_valid() && image->get_path().get_extension().to_lower() == "png") {
			for (const String &problem : RetroMD::texture_problems(image, image->get_width(), image->get_height())) {
				needs_conversion = needs_conversion || problem.contains("indexado") || problem.contains("paleta do PNG") || problem.contains(U("múltiplo de 8"));
			}
		}
		if (needs_conversion) {
			Label *format = memnew(Label(vformat(U("A imagem do TileSet (%s) não está no formato do Mega Drive: PNG indexado, até 15 cores mais a transparência."), image->get_path().get_file())));
			format->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
			format->set_custom_minimum_size(Size2(200, 0) * EDSCALE);
			format->add_theme_color_override(SceneStringName(font_color), Color(1, 0.55, 0.45));
			box->add_child(format);
			Button *convert = memnew(Button);
			convert->set_text(U("Converter a imagem do TileSet"));
			convert->set_tooltip_text(U("Grava uma cópia no formato do console (nome_md.png, cores reduzidas a 15) e o TileSet passa a usá-la; o PNG original fica como está. Vale para todos os mapas que usam este TileSet. Dá para desfazer."));
			convert->connect(SceneStringName(pressed), callable_mp_static(&RetroMapMoveInspector::_convert_tileset).bind(id));
			box->add_child(convert);
		}
	}
	HBoxContainer *row = memnew(HBoxContainer);
	box->add_child(row);
	const struct {
		const char *text, *tip;
		Vector2i delta;
	} arrows[] = { { "←", "Esquerda", Vector2i(-1, 0) }, { "↑", "Cima", Vector2i(0, -1) }, { "↓", "Baixo", Vector2i(0, 1) }, { "→", "Direita", Vector2i(1, 0) } };
	for (const auto &a : arrows) {
		Button *button = memnew(Button);
		button->set_text(U(a.text));
		button->set_tooltip_text(U(a.tip) + U(": 1 tile (8 px); com Shift, 64 px."));
		button->connect(SceneStringName(pressed), callable_mp_static(&RetroMapMoveInspector::_move).bind(id, a.delta));
		row->add_child(button);
	}
	HBoxContainer *row2 = memnew(HBoxContainer);
	box->add_child(row2);
	Button *top = memnew(Button);
	top->set_text(U("Encostar no topo"));
	top->set_tooltip_text(U("Sobe o desenho até a primeira linha desenhada ficar em y = 0 (tira o espaço vazio de cima)."));
	top->connect(SceneStringName(pressed), callable_mp_static(&RetroMapMoveInspector::_snap).bind(id, true));
	row2->add_child(top);
	Button *left = memnew(Button);
	left->set_text(U("Encostar à esquerda"));
	left->set_tooltip_text(U("Leva o desenho até a primeira coluna desenhada ficar em x = 0."));
	left->connect(SceneStringName(pressed), callable_mp_static(&RetroMapMoveInspector::_snap).bind(id, false));
	row2->add_child(left);
	CheckBox *all = memnew(CheckBox);
	all->set_text(U("Mover todos os mapas da cena juntos"));
	all->set_tooltip_text(U("Fundo, frente, colisão e prioridade andam juntos e continuam alinhados. Desligado, só este mapa anda."));
	all->set_pressed(all_layers);
	all->connect(SceneStringName(toggled), callable_mp_static(&RetroMapMoveInspector::_all_toggled));
	box->add_child(all);
	add_custom_control(panel);
}

bool RetroTileSetLock::can_handle(Object *p_object) {
	return Object::cast_to<TileSet>(p_object) != nullptr;
}

bool RetroTileSetLock::parse_property(Object *p_object, const Variant::Type p_type, const String &p_path, const PropertyHint p_hint, const String &p_hint_text, const BitField<PropertyUsageFlags> p_usage, const bool p_wide) {
	if (p_path == "tile_shape" || p_path == "tile_layout" || p_path == "tile_offset_axis") {
		return true; // Sempre quadrado.
	}
	if (p_path != "tile_size") {
		return false;
	}
	HBoxContainer *row = memnew(HBoxContainer);
	Label *name = memnew(Label(U("Tile Size")));
	name->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	row->add_child(name);
	Label *value = memnew(Label(U("8 × 8 px (Mega Drive)")));
	value->set_tooltip_text(U("Os planos do Mega Drive são feitos de tiles de 8×8 pixels; o tamanho não muda. Para a fase ficar maior ou menor, mude o tamanho do PNG (ou mova o desenho no Inspetor do mapa)."));
	value->set_mouse_filter(Control::MOUSE_FILTER_PASS);
	value->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	row->add_child(value);
	add_custom_control(row);
	return true;
}

void RetroMapImportDialog::open(const String &p_png) {
	png = p_png;
	maps.clear();
	target->clear();
	Node *root = EditorNode::get_singleton()->get_edited_scene();
	if (!Object::cast_to<MDCena>(root)) {
		EditorToaster::get_singleton()->popup_str(U("Abra a cena (com uma MDCena na raiz) onde o mapa vai entrar e tente de novo."), EditorToaster::SEVERITY_WARNING);
		return;
	}
	const Ref<Image> image = MDPersonagem::load_sheet(p_png);
	if (image.is_null()) {
		EditorToaster::get_singleton()->popup_str(U("Não foi possível ler ") + p_png.get_file() + ".", EditorToaster::SEVERITY_ERROR);
		return;
	}
	info->set_text(vformat(U("%s (%d×%d px) entra na cena %s. Os tiles vão para %s_tiles.png e o TileSet, para tilesets/%s.tres."),
			p_png.get_file(), image->get_width(), image->get_height(), root->get_name(), p_png.get_file().get_basename(), p_png.get_file().get_basename()));
	// Os MDMapa da cena. Fica escolhido o que já veio deste PNG (reimportar), senão o selecionado se estiver
	// vazio, senão um mapa novo (no plano A se já há um mapa no plano B): nunca troca um desenho sem querer.
	int chosen = -1;
	bool has_plane_b = false;
	TypedArray<Node> found = root->find_children("*", "MDMapa", true, true);
	for (int i = 0; i < found.size(); i++) {
		MDMapa *mapa = Object::cast_to<MDMapa>(found[i]);
		if (!mapa || (mapa != root && mapa->get_owner() != root)) {
			continue;
		}
		const Ref<TileSet> ts = mapa->get_tile_set();
		const bool same = ts.is_valid() && String(ts->get_meta("retro_origem", "")) == p_png;
		target->add_item(vformat(U("%s (plano %s)%s"), mapa->get_name(), mapa->get_plano() == MDFundo::PLANO_A ? "A" : "B", same ? U(" — reimportar") : String()));
		maps.push_back(mapa->get_instance_id());
		has_plane_b = has_plane_b || mapa->get_plano() == MDFundo::PLANO_B;
		if (same || (chosen < 0 && mapa->get_used_cells().is_empty() && EditorNode::get_singleton()->get_editor_selection()->is_selected(mapa))) {
			chosen = maps.size() - 1;
		}
	}
	target->add_item(U("Novo MDMapa no plano B (fundo, atrás)"));
	target->add_item(U("Novo MDMapa no plano A (frente)"));
	target->select(chosen >= 0 ? chosen : maps.size() + (has_plane_b ? 1 : 0));
	_target_changed(target->get_selected());
	popup_centered(Size2(560, 0) * EDSCALE);
}

void RetroMapImportDialog::_target_changed(int p_index) {
	MDMapa *mapa = p_index < maps.size() ? Object::cast_to<MDMapa>(ObjectDB::get_instance(maps[p_index])) : nullptr;
	if (mapa && !mapa->get_used_cells().is_empty()) {
		warning->set_text(U("O desenho atual deste mapa será trocado pelo do PNG (Ctrl+Z desfaz). A colisão e os outros nodes não mudam."));
		warning->show();
	} else {
		warning->hide();
	}
}

void RetroMapImportDialog::_import() {
	Node *root = EditorNode::get_singleton()->get_edited_scene();
	if (!Object::cast_to<MDCena>(root)) {
		return;
	}
	const int index = target->get_selected();
	MDMapa *mapa = index < maps.size() ? Object::cast_to<MDMapa>(ObjectDB::get_instance(maps[index])) : nullptr;
	if (index < maps.size() && !mapa) {
		return; // O mapa saiu da cena enquanto o diálogo estava aberto.
	}
	const Vector2i offset = mapa ? Vector2i(mapa->get_meta("retro_deslocamento", Vector2i())) : Vector2i();
	const RetroMapImport::Result r = RetroMapImport::build(png, offset);
	if (!r.error.is_empty()) {
		EditorToaster::get_singleton()->popup_str(r.error, EditorToaster::SEVERITY_ERROR);
		return;
	}

	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	undo->create_action(U("Importar mapa: ") + png.get_file());
	if (!mapa) {
		// Mapa novo, depois dos fundos e mapas que já estão no começo da cena (para ficar atrás dos sprites).
		const bool plane_a = index == maps.size() + 1;
		mapa = memnew(MDMapa);
		mapa->set_name(plane_a ? "Frente" : "Fundo");
		mapa->set_plano(plane_a ? MDFundo::PLANO_A : MDFundo::PLANO_B);
		mapa->set_paleta(plane_a ? 2 : 0);
		mapa->set_solido(false); // A colisão é pintada na MDColisao.
		int at = 0;
		while (at < root->get_child_count() && (Object::cast_to<MDMapa>(root->get_child(at)) || Object::cast_to<MDFundo>(root->get_child(at)))) {
			at++;
		}
		undo->add_do_method(root, "add_child", mapa, true);
		undo->add_do_method(root, "move_child", mapa, at);
		undo->add_do_method(mapa, "set_owner", root);
		undo->add_do_reference(mapa);
		undo->add_undo_method(root, "remove_child", mapa);
	} else {
		undo->add_undo_property(mapa, "tile_set", mapa->get_tile_set());
		undo->add_undo_property(mapa, "tile_map_data", mapa->get_tile_map_data_as_array());
	}
	undo->add_do_property(mapa, "tile_set", r.tile_set);
	undo->add_do_property(mapa, "tile_map_data", r.map_data);
	undo->commit_action();
	EditorNode::get_singleton()->get_editor_selection()->clear();
	EditorNode::get_singleton()->get_editor_selection()->add_node(mapa);

	String message = vformat(U("%s importado em %s: %d×%d px, %d tiles diferentes em %d células, %d cores"),
			png.get_file(), mapa->get_name(), r.size.x, r.size.y, r.unique, r.cells, r.colors);
	if (r.original_colors > r.colors) {
		message += vformat(U(" (a imagem tinha %d: as cores foram reduzidas para caber numa paleta; divida o cenário em camadas para ter mais cores)"), r.original_colors);
	}
	if (r.padded) {
		message += U("; o tamanho foi completado com transparente até múltiplos de 8");
	}
	message += U(". Salve a cena e pinte a colisão na MDColisao.");
	EditorToaster::get_singleton()->popup_str(message, r.original_colors > r.colors ? EditorToaster::SEVERITY_WARNING : EditorToaster::SEVERITY_INFO);
}

RetroMapImportDialog::RetroMapImportDialog() {
	set_title(U("Importar como mapa"));
	set_ok_button_text(U("Importar"));
	VBoxContainer *vb = memnew(VBoxContainer);
	add_child(vb);
	info = memnew(Label);
	info->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	info->set_custom_minimum_size(Size2(520, 0) * EDSCALE);
	vb->add_child(info);
	HBoxContainer *row = memnew(HBoxContainer);
	vb->add_child(row);
	Label *label = memnew(Label);
	label->set_text(U("Mapa:"));
	row->add_child(label);
	target = memnew(OptionButton);
	target->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	target->connect(SceneStringName(item_selected), callable_mp(this, &RetroMapImportDialog::_target_changed));
	row->add_child(target);
	warning = memnew(Label);
	warning->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	warning->set_custom_minimum_size(Size2(520, 0) * EDSCALE); // Sem largura, o texto quebraria a cada letra.
	warning->add_theme_color_override(SceneStringName(font_color), Color(1, 0.8, 0.4));
	vb->add_child(warning);
	Label *hint = memnew(Label);
	hint->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	hint->set_custom_minimum_size(Size2(520, 0) * EDSCALE);
	hint->set_text(U("Cada camada do Aseprite (fundo, frente) exportada como um PNG do mesmo tamanho vai num MDMapa. "
					 "Cada mapa tem uma paleta: até 15 cores mais a transparência. Reimportar o PNG atualiza o mesmo mapa."));
	hint->set_modulate(Color(1, 1, 1, 0.7));
	vb->add_child(hint);
	// O botão Importar (a classe não é registrada no ClassDB, então o sinal "confirmed" não é achado por nome).
	get_ok_button()->connect(SceneStringName(pressed), callable_mp(this, &RetroMapImportDialog::_import));
}
