#include "retro_map_import.h"

#include "retro_image_convert.h"
#include "retro_sgdk_export.h"

#include "core/config/project_settings.h"
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

Result build(const String &p_png) {
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
				layer->set_cell(Vector2i(cx, cy), source_id, Vector2i(t % ATLAS_COLUMNS, t / ATLAS_COLUMNS));
			}
		}
	}
	r.map_data = layer->get_tile_map_data_as_array();
	memdelete(layer);
	return r;
}

} // namespace RetroMapImport

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
	const RetroMapImport::Result r = RetroMapImport::build(png);
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
