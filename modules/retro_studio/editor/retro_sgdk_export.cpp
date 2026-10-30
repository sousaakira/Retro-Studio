#include "retro_sgdk_export.h"

#include "../scene/md_nodes.h"

#include "core/config/project_settings.h"
#include "core/io/compression.h"
#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/image.h"
#include "core/io/resource_loader.h"
#include "core/templates/hash_map.h"
#include "core/templates/hash_set.h"
#include "core/templates/hashfuncs.h"
#include "scene/resources/2d/tile_set.h"
#include "scene/resources/packed_scene.h"

namespace RetroSgdkExport {

namespace {

// ---- PNG de 4 bits indexado (o formato que o rescomp converte sem requantizar) ----

uint32_t crc32(const uint8_t *p_data, int64_t p_size) {
	static uint32_t table[256];
	static bool ready = false;
	if (!ready) {
		for (uint32_t n = 0; n < 256; n++) {
			uint32_t c = n;
			for (int k = 0; k < 8; k++) {
				c = c & 1 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
			}
			table[n] = c;
		}
		ready = true;
	}
	uint32_t c = 0xFFFFFFFFu;
	for (int64_t i = 0; i < p_size; i++) {
		c = table[(c ^ p_data[i]) & 255] ^ (c >> 8);
	}
	return c ^ 0xFFFFFFFFu;
}

void put_u32(Vector<uint8_t> &r_out, uint32_t p_value) {
	r_out.push_back(p_value >> 24);
	r_out.push_back((p_value >> 16) & 255);
	r_out.push_back((p_value >> 8) & 255);
	r_out.push_back(p_value & 255);
}

void put_chunk(Vector<uint8_t> &r_out, const char *p_type, const Vector<uint8_t> &p_data) {
	put_u32(r_out, p_data.size());
	const int start = r_out.size();
	for (int i = 0; i < 4; i++) {
		r_out.push_back(p_type[i]);
	}
	r_out.append_array(p_data);
	put_u32(r_out, crc32(r_out.ptr() + start, r_out.size() - start));
}

} // namespace

Vector<uint8_t> indexed_png(int p_width, int p_height, const Vector<uint8_t> &p_indices, const Vector<Color> &p_palette) {
	const int stride = (p_width + 1) / 2 + 1;
	Vector<uint8_t> lines;
	lines.resize(int64_t(p_height) * stride);
	memset(lines.ptrw(), 0, lines.size());
	for (int y = 0; y < p_height; y++) {
		for (int x = 0; x < p_width; x++) {
			lines.write[int64_t(y) * stride + 1 + (x >> 1)] |= p_indices[int64_t(y) * p_width + x] << (x & 1 ? 0 : 4);
		}
	}
	Vector<uint8_t> compressed;
	compressed.resize(Compression::get_max_compressed_buffer_size(lines.size(), Compression::MODE_DEFLATE));
	compressed.resize(Compression::compress(compressed.ptrw(), lines.ptr(), lines.size(), Compression::MODE_DEFLATE));
	Vector<uint8_t> header, colors, transparency, empty, png;
	put_u32(header, p_width);
	put_u32(header, p_height);
	for (uint8_t byte : { 4, 3, 0, 0, 0 }) {
		header.push_back(byte);
	}
	for (int i = 0; i < 16; i++) {
		const Color color = i < p_palette.size() ? p_palette[i] : Color(0, 0, 0);
		colors.push_back(color.get_r8());
		colors.push_back(color.get_g8());
		colors.push_back(color.get_b8());
	}
	transparency.push_back(0);
	for (uint8_t byte : { 137, 80, 78, 71, 13, 10, 26, 10 }) {
		png.push_back(byte);
	}
	put_chunk(png, "IHDR", header);
	put_chunk(png, "PLTE", colors);
	put_chunk(png, "tRNS", transparency);
	put_chunk(png, "IDAT", compressed);
	put_chunk(png, "IEND", empty);
	return png;
}

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

String identifier(const String &p_text) {
	String result;
	const String base = p_text.to_lower();
	for (int i = 0; i < base.length(); i++) {
		result += is_ascii_alphanumeric_char(base[i]) ? String::chr(base[i]) : String("_");
	}
	return result;
}

// ---- VRAM ----

const int SPRITE_VRAM_TILES = RetroMD::VRAM_SPRITE_TILES;
const int BACKGROUND_VRAM_TILES = RetroMD::VRAM_BACKGROUND_TILES;

// Tiles distintos de 8×8, como o rescomp conta com a otimização ALL (repetidos e espelhados viram um só).
template <typename F>
int count_unique_tiles(int p_width, int p_height, F p_pixel) {
	HashSet<uint32_t> seen;
	uint32_t tile[64], variant[64];
	for (int ty = 0; ty + 8 <= p_height; ty += 8) {
		for (int tx = 0; tx + 8 <= p_width; tx += 8) {
			for (int i = 0; i < 64; i++) {
				tile[i] = p_pixel(tx + (i & 7), ty + (i >> 3));
			}
			uint32_t best = UINT32_MAX;
			for (int flip = 0; flip < 4; flip++) {
				for (int i = 0; i < 64; i++) {
					const int x = flip & 1 ? 7 - (i & 7) : i & 7, y = flip & 2 ? 7 - (i >> 3) : i >> 3;
					variant[i] = tile[y * 8 + x];
				}
				best = MIN(best, hash_murmur3_buffer(variant, sizeof(variant)));
			}
			seen.insert(best);
		}
	}
	return seen.size();
}

// ---- Coleta das cenas ----

struct Asset {
	String symbol;
	String kind; // IMAGE, SPRITE, MAP, XGM ou WAV
	String file; // Relativo a res/, como o rescomp lê.
	String texture;
	int frame_tiles_w = 0, frame_tiles_h = 0, speed = 0;
	int tiles = 0; // Tiles na VRAM (fundos e mapas).
	String define; // WAV: constante do efeito (SOM_...) e o número dele no XGM.
	int sound_id = 0;
};

struct SpriteEntry {
	MDSprite *node = nullptr;
	String variable;
	Vector2i position;
	int asset = -1;
	MDInimigo *enemy = nullptr;
	MDItem *item = nullptr;
	MDPlataforma *platform = nullptr;
	String prefix; // Variáveis do inimigo (inimigo_N) ou do item (item_N).
};

struct MapEntry {
	MDMapa *node = nullptr;
	String variable;
	int asset = -1;
	Vector2i size; // Pixels pintados (múltiplos de 8).
};

struct ExitEntry {
	Rect2i area;
	int scene = -1;
};

struct ParallaxEntry {
	String name;
	String plane;
	int percent = 0;
};

struct CheckpointEntry {
	String name;
	Rect2i area;
	String sound;
};

struct BlinkingText {
	String text;
	Vector2i tile;
};

struct SceneInfo {
	String path;
	String ident; // Nome nas funções do C (cena_<ident>_iniciar).
};

struct Exporter {
	String project_dir;
	Result result;
	Vector<Asset> assets;
	HashMap<String, int> asset_by_key;
	HashMap<String, int> symbols;
	HashSet<String> produced; // Arquivos gerados neste build, mudados ou não.
	Vector<SceneInfo> scenes; // A primeira é a cena principal.
	HashMap<String, int> scene_by_path;

	// ---- Estado da cena sendo exportada ----
	int scene = 0;
	String scene_label; // Prefixo das mensagens ("fase.tscn").
	String palette_source[4]; // Símbolo cuja paleta carrega cada PAL.
	String palette_texture[4];
	String draw_code; // Fundos e mapas, na ordem da cena.
	String text_code;
	int text_rows = 0; // Linhas de tiles até o último texto.
	Vector<SpriteEntry> sprites;
	Vector<MapEntry> maps;
	MDJogador *player = nullptr;
	int player_sprite = -1;
	// Colisão: uma célula de 8×8 por byte, de todos os mapas sólidos.
	Vector2i collision_cells;
	Vector<uint8_t> collision;
	Vector2i world; // Tamanho do mundo em pixels (o maior mapa, ou a tela).
	Vector<ExitEntry> exits;
	Vector<CheckpointEntry> checkpoints;
	Vector<ParallaxEntry> parallaxes; // Fundos que rolam com a câmera.
	Vector<BlinkingText> blinking;
	int start_scene = -1; // Cena aberta pelo START.
	int music = -1; // Asset XGM da cena.
	int background_tiles = 0;
	int sprite_tiles = 0;
	HashSet<String> sprite_names;

	void reset_scene() {
		sprite_names.clear();
		for (int i = 0; i < 4; i++) {
			palette_source[i] = String();
			palette_texture[i] = String();
		}
		draw_code = String();
		text_code = String();
		text_rows = 0;
		sprites.clear();
		maps.clear();
		player = nullptr;
		player_sprite = -1;
		collision_cells = Vector2i();
		collision.clear();
		world = Vector2i();
		exits.clear();
		checkpoints.clear();
		parallaxes.clear();
		blinking.clear();
		start_scene = -1;
		music = -1;
		background_tiles = 0;
		sprite_tiles = 0;
	}

	// Índice da cena (a primeira vez, entra na fila de exportação).
	int scene_for(const String &p_path) {
		if (scene_by_path.has(p_path)) {
			return scene_by_path[p_path];
		}
		SceneInfo info;
		info.path = p_path;
		info.ident = symbol_for("", p_path.get_file().get_basename());
		scenes.push_back(info);
		scene_by_path[p_path] = scenes.size() - 1;
		return scenes.size() - 1;
	}

	String scene_constant(int p_scene) const {
		return "CENA_" + scenes[p_scene].ident.to_upper();
	}

	// Música (XGM) ou efeito (WAV) do projeto.
	int sound_for(const String &p_kind, const String &p_path) {
		const String key = p_kind + "|" + p_path;
		if (asset_by_key.has(key)) {
			return asset_by_key[key];
		}
		Asset asset;
		asset.kind = p_kind;
		asset.file = res_relative(p_path);
		asset.symbol = symbol_for(p_kind == "XGM" ? "mus_" : "sfx_", p_path.get_file().get_basename());
		if (p_kind == "WAV") {
			int count = 0;
			for (const Asset &other : assets) {
				count += other.kind == "WAV";
			}
			asset.define = "SOM_" + asset.symbol.substr(4).to_upper();
			asset.sound_id = 64 + count; // Os números abaixo de 64 são das amostras das músicas.
		}
		assets.push_back(asset);
		asset_by_key[key] = assets.size() - 1;
		return assets.size() - 1;
	}

	String symbol_for(const String &p_prefix, const String &p_name) {
		const String symbol = p_prefix + identifier(p_name);
		const int used = symbols.has(symbol) ? symbols[symbol] : 0;
		symbols[symbol] = used + 1;
		return used ? symbol + "_" + itos(used + 1) : symbol;
	}

	String res_relative(const String &p_path) const {
		const String global = p_path.begins_with("res://") ? ProjectSettings::get_singleton()->globalize_path(p_path) : p_path;
		const String res_dir = project_dir.path_join("res") + "/";
		if (global.begins_with(res_dir)) {
			return global.substr(res_dir.length());
		}
		return "../" + global.substr(project_dir.length() + 1);
	}

	int asset_for(const String &p_kind, Sprite2D *p_node, int p_speed) {
		const Ref<Texture2D> image = p_node->get_texture();
		const String path = image->get_path();
		const int frame_w = image->get_width() / MAX(1, p_node->get_hframes()), frame_h = image->get_height() / MAX(1, p_node->get_vframes());
		const String key = p_kind + "|" + path + "|" + itos(frame_w) + "x" + itos(frame_h) + "|" + itos(p_speed);
		if (asset_by_key.has(key)) {
			return asset_by_key[key];
		}
		Asset asset;
		asset.kind = p_kind;
		asset.texture = path;
		asset.file = res_relative(path);
		asset.symbol = symbol_for(p_kind == "IMAGE" ? "img_" : "spr_", path.get_file().get_basename());
		asset.frame_tiles_w = frame_w / 8;
		asset.frame_tiles_h = frame_h / 8;
		asset.speed = p_speed;
		if (p_kind == "IMAGE") {
			Ref<Image> pixels;
			pixels.instantiate();
			if (pixels->load(path) == OK) {
				pixels->convert(Image::FORMAT_RGBA8);
				asset.tiles = RetroMD::unique_tiles(pixels);
			}
		}
		assets.push_back(asset);
		asset_by_key[key] = assets.size() - 1;
		return assets.size() - 1;
	}

	void use_palette(int p_slot, const String &p_symbol, const String &p_texture, const String &p_node) {
		if (palette_source[p_slot].is_empty()) {
			palette_source[p_slot] = p_symbol;
			palette_texture[p_slot] = p_texture;
		} else if (palette_texture[p_slot] != p_texture && RetroMD::png_palette(palette_texture[p_slot]) != RetroMD::png_palette(p_texture)) {
			result.warnings.push_back(scene_label + vformat(U("%s usa a PAL%d, que já carrega as cores de %s; as cores de %s podem sair diferentes."), p_node, p_slot, palette_texture[p_slot].get_file(), p_texture.get_file()));
		}
	}

	// Posição em relação à raiz da cena (a instância não está na árvore, então soma os pais).
	static Vector2 scene_position(Node *p_node, Node *p_root) {
		Vector2 position;
		for (Node *node = p_node; node && node != p_root; node = node->get_parent()) {
			if (Node2D *node_2d = Object::cast_to<Node2D>(node)) {
				position += node_2d->get_position();
			}
		}
		return position;
	}

	bool check(Node *p_node, const PackedStringArray &p_warnings) {
		for (const String &warning : p_warnings) {
			result.errors.push_back(scene_label + String(p_node->get_name()) + ": " + warning);
		}
		return p_warnings.is_empty();
	}

	void visit(Node *p_node, Node *p_root) {
		const String name = p_node->get_name();
		const Vector2i position = Vector2i(scene_position(p_node, p_root).round());
		if (MDFundo *fundo = Object::cast_to<MDFundo>(p_node)) {
			if (check(p_node, fundo->get_configuration_warnings())) {
				const Asset &asset = assets[asset_for("IMAGE", fundo, 0)];
				use_palette(fundo->get_paleta(), asset.symbol, asset.texture, name);
				background_tiles += asset.tiles;
				if (fundo->get_rolagem() > 0) {
					ParallaxEntry parallax;
					parallax.name = name;
					parallax.plane = fundo->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B";
					parallax.percent = fundo->get_rolagem();
					parallaxes.push_back(parallax);
				}
				draw_code += vformat("\t// %s\n\tVDP_drawImageEx(%s, &%s, TILE_ATTR_FULL(PAL%d, FALSE, FALSE, FALSE, tile), %d, %d, FALSE, TRUE);\n\ttile += %s.tileset->numTile;\n",
						name, fundo->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B", asset.symbol, fundo->get_paleta(), position.x / 8, position.y / 8, asset.symbol);
			}
		} else if (MDMapa *mapa = Object::cast_to<MDMapa>(p_node)) {
			if (check(p_node, mapa->get_configuration_warnings())) {
				add_map(mapa);
			}
		} else if (MDSprite *sprite = Object::cast_to<MDSprite>(p_node)) {
			if (check(p_node, sprite->get_configuration_warnings())) {
				SpriteEntry entry;
				entry.node = sprite;
				// Visível para o código C da cena (cena_<ident>.h): <cena>_<node>.
				entry.variable = scenes[scene].ident + "_" + identifier(name);
				for (int n = 2; sprite_names.has(entry.variable); n++) {
					entry.variable = scenes[scene].ident + "_" + identifier(name) + "_" + itos(n);
				}
				sprite_names.insert(entry.variable);
				entry.position = position;
				entry.asset = asset_for("SPRITE", sprite, sprite->get_velocidade_animacao());
				// Teto: o motor reserva o maior quadro, e o rescomp ainda corta os tiles vazios dele.
				sprite_tiles += assets[entry.asset].frame_tiles_w * assets[entry.asset].frame_tiles_h;
				use_palette(sprite->get_paleta(), assets[entry.asset].symbol, assets[entry.asset].texture, name);
				entry.enemy = Object::cast_to<MDInimigo>(sprite);
				if (entry.enemy) {
					entry.prefix = vformat("inimigo_%d", sprites.size());
					if (!entry.enemy->get_som_derrota().is_empty()) {
						sound_for("WAV", entry.enemy->get_som_derrota());
					}
				}
				entry.platform = Object::cast_to<MDPlataforma>(sprite);
				if (entry.platform) {
					entry.prefix = vformat("plataforma_%d", sprites.size());
				}
				entry.item = Object::cast_to<MDItem>(sprite);
				if (entry.item) {
					entry.prefix = vformat("item_%d", sprites.size());
					if (!entry.item->get_som().is_empty()) {
						sound_for("WAV", entry.item->get_som());
					}
				}
				if (MDJogador *jogador = Object::cast_to<MDJogador>(sprite)) {
					if (player) {
						result.warnings.push_back(scene_label + U("há mais de um MDJogador; só o primeiro é controlado."));
					} else {
						player = jogador;
						player_sprite = sprites.size();
						for (const String &som : { jogador->get_som_pulo(), jogador->get_som_morte() }) {
							if (!som.is_empty()) {
								sound_for("WAV", som);
							}
						}
					}
				}
				sprites.push_back(entry);
			}
		} else if (MDTexto *texto = Object::cast_to<MDTexto>(p_node)) {
			if (check(p_node, texto->get_configuration_warnings()) && !texto->get_texto().is_empty()) {
				text_code += vformat("\tVDP_drawText(\"%s\", %d, %d);\n", texto->get_texto().c_escape(), position.x / 8, position.y / 8);
				text_rows = MAX(text_rows, position.y / 8 + 1);
				if (texto->get_piscar()) {
					BlinkingText blink;
					blink.text = texto->get_texto();
					blink.tile = position / 8;
					blinking.push_back(blink);
				}
			}
		} else if (MDRetorno *retorno = Object::cast_to<MDRetorno>(p_node)) {
			if (check(p_node, retorno->get_configuration_warnings())) {
				CheckpointEntry checkpoint;
				checkpoint.name = name;
				checkpoint.area = Rect2i(position, retorno->get_tamanho());
				checkpoint.sound = retorno->get_som();
				if (!checkpoint.sound.is_empty()) {
					sound_for("WAV", checkpoint.sound);
				}
				checkpoints.push_back(checkpoint);
			}
		} else if (MDSaida *saida = Object::cast_to<MDSaida>(p_node)) {
			if (check(p_node, saida->get_configuration_warnings())) {
				ExitEntry exit;
				exit.area = Rect2i(position, saida->get_tamanho());
				exit.scene = scene_for(saida->get_destino());
				exits.push_back(exit);
			}
		}
		for (int i = 0; i < p_node->get_child_count(); i++) {
			visit(p_node->get_child(i), p_root);
		}
	}

	// O mapa pintado vira um PNG indexado com a paleta do atlas (TILESET + MAP + PALETTE no rescomp)
	// e, se for sólido, células de colisão.
	void add_map(MDMapa *p_mapa) {
		const String name = p_mapa->get_name();
		for (const MapEntry &other : maps) {
			if (other.node->get_plano() == p_mapa->get_plano()) {
				result.errors.push_back(scene_label + name + U(": já há um mapa nesse plano; use BG A para um e BG B para o outro."));
				return;
			}
		}
		const Ref<TileSet> tiles = p_mapa->get_tile_set();
		const Ref<TileSetAtlasSource> atlas = tiles->get_source(tiles->get_source_id(0));
		const int source_id = tiles->get_source_id(0);
		const Ref<Texture2D> texture = atlas->get_texture();
		const Vector<Color> palette = RetroMD::png_palette(texture->get_path());
		Ref<Image> image;
		image.instantiate();
		if (image->load(texture->get_path()) != OK) {
			result.errors.push_back(scene_label + name + U(": não foi possível ler a imagem do TileSet."));
			return;
		}
		image->convert(Image::FORMAT_RGBA8);
		const Vector2i tile_size = tiles->get_tile_size();
		const Rect2i used = p_mapa->get_used_rect();
		const Vector2i size = Vector2i(used.get_end().x * tile_size.x, used.get_end().y * tile_size.y);
		if (size.x <= 0 || size.y <= 0) {
			result.warnings.push_back(scene_label + name + U(": o mapa está vazio."));
			return;
		}
		// O MAP do SGDK trabalha em blocos de 128×128 e a janela da tela precisa caber no mapa.
		const Vector2i padded(MAX((size.x + 127) / 128 * 128, 384), MAX((size.y + 127) / 128 * 128, 256));
		Vector<uint8_t> indices;
		indices.resize(int64_t(padded.x) * padded.y);
		memset(indices.ptrw(), 0, indices.size());
		HashMap<uint32_t, uint8_t> index_of;
		for (int i = palette.size() - 1; i >= 1; i--) {
			index_of[palette[i].to_rgba32() | 0xFF] = i;
		}
		const Vector2i cells(size.x / 8, size.y / 8);
		if (p_mapa->is_solido()) {
			if (collision.is_empty()) {
				collision_cells = cells;
				collision.resize(int64_t(cells.x) * cells.y);
				memset(collision.ptrw(), 0, collision.size());
			} else if (cells.x > collision_cells.x || cells.y > collision_cells.y) {
				// Dois mapas sólidos de tamanhos diferentes: a colisão cobre o maior.
				Vector<uint8_t> grown;
				const Vector2i bigger(MAX(cells.x, collision_cells.x), MAX(cells.y, collision_cells.y));
				grown.resize(int64_t(bigger.x) * bigger.y);
				memset(grown.ptrw(), 0, grown.size());
				for (int y = 0; y < collision_cells.y; y++) {
					memcpy(grown.ptrw() + y * bigger.x, collision.ptr() + y * collision_cells.x, collision_cells.x);
				}
				collision = grown;
				collision_cells = bigger;
			}
		}
		int missing = 0;
		for (const Vector2i cell : p_mapa->get_used_cells()) {
			if (p_mapa->get_cell_source_id(cell) != source_id) {
				continue;
			}
			if (p_mapa->get_cell_alternative_tile(cell) != 0) {
				result.warnings.push_back(scene_label + name + U(": tiles alternativos (girados ou espelhados) ainda não são exportados; saem sem a variação."));
			}
			const Rect2i region = atlas->get_tile_texture_region(p_mapa->get_cell_atlas_coords(cell));
			for (int y = 0; y < tile_size.y; y++) {
				for (int x = 0; x < tile_size.x; x++) {
					const Color color = image->get_pixel(region.position.x + x, region.position.y + y);
					uint8_t index = 0;
					if (color.a >= 0.5) {
						const uint32_t key = color.to_rgba32() | 0xFF;
						if (index_of.has(key)) {
							index = index_of[key];
						} else {
							missing++;
						}
					}
					indices.write[int64_t(cell.y * tile_size.y + y) * padded.x + cell.x * tile_size.x + x] = index;
				}
			}
			if (p_mapa->is_solido()) {
				for (int y = 0; y < tile_size.y / 8; y++) {
					for (int x = 0; x < tile_size.x / 8; x++) {
						collision.write[int64_t(cell.y * tile_size.y / 8 + y) * collision_cells.x + cell.x * tile_size.x / 8 + x] = 1;
					}
				}
			}
		}
		if (missing) {
			result.errors.push_back(vformat(U("%s%s: %d pixels do TileSet não têm cor na paleta do PNG."), scene_label, name, missing));
			return;
		}
		Asset asset;
		asset.kind = "MAP";
		asset.symbol = symbol_for("map_", name);
		asset.texture = texture->get_path();
		asset.file = "gerado/" + asset.symbol + ".png";
		asset.tiles = count_unique_tiles(padded.x, padded.y, [&](int x, int y) { return uint32_t(indices[int64_t(y) * padded.x + x]); });
		background_tiles += asset.tiles;
		write_bytes("res/" + asset.file, indexed_png(padded.x, padded.y, indices, palette));
		assets.push_back(asset);
		MapEntry entry;
		entry.node = p_mapa;
		entry.variable = vformat("mapa_%d", maps.size());
		entry.asset = assets.size() - 1;
		entry.size = Vector2i(cells.x * 8, cells.y * 8);
		use_palette(p_mapa->get_paleta(), "pal_" + asset.symbol.substr(4), asset.texture, name);
		draw_code += vformat("\t// %s\n\tVDP_loadTileSet(&ts_%s, tile, DMA);\n\t%s = MAP_create(&%s, %s, TILE_ATTR_FULL(PAL%d, FALSE, FALSE, FALSE, tile));\n\ttile += ts_%s.numTile;\n",
				name, asset.symbol.substr(4), entry.variable, asset.symbol, p_mapa->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B", p_mapa->get_paleta(), asset.symbol.substr(4));
		maps.push_back(entry);
		world.x = MAX(world.x, entry.size.x);
		world.y = MAX(world.y, entry.size.y);
	}

	void write_bytes(const String &p_relative, const Vector<uint8_t> &p_bytes) {
		const String path = project_dir.path_join(p_relative);
		produced.insert(p_relative);
		if (FileAccess::exists(path) && FileAccess::get_file_as_bytes(path) == p_bytes) {
			return;
		}
		DirAccess::make_dir_recursive_absolute(path.get_base_dir());
		const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
		if (file.is_null()) {
			result.errors.push_back(U("Não foi possível gravar ") + p_relative + ".");
			return;
		}
		file->store_buffer(p_bytes.ptr(), p_bytes.size());
		result.written.push_back(p_relative);
	}

	void write(const String &p_relative, const String &p_content) {
		const String path = project_dir.path_join(p_relative);
		if (FileAccess::exists(path)) {
			const Ref<FileAccess> current = FileAccess::open(path, FileAccess::READ);
			if (current.is_valid() && !current->get_line().begins_with(GENERATED_MARK)) {
				result.errors.push_back(p_relative + U(" existe e não foi gerado pelo Retro Studio; o arquivo foi preservado. Renomeie ou apague para gerar a cena."));
				return;
			}
		}
		write_bytes(p_relative, p_content.to_utf8_buffer());
	}

	// ---- Código ----

	String sound_define(const String &p_path) const {
		return assets[asset_by_key["WAV|" + p_path]].define;
	}

	bool top_down() const {
		return player && player->get_modo() == MDJogador::MODO_VISTO_DE_CIMA;
	}

	bool has_platforms() const {
		for (const SpriteEntry &entry : sprites) {
			if (entry.platform) {
				return true;
			}
		}
		return false;
	}

	// Plataformas: vão e voltam de A até A + deslocamento; quem está em cima vai junto. Com jogador e
	// mapa sólido, os auxiliares dizem se os pés estão no topo de alguma e levam o jogador.
	String platform_code() const {
		String code;
		const bool carries = player && !collision.is_empty() && !top_down();
		if (carries) {
			const Rect2i box = player->get_caixa_efetiva();
			code += vformat(U("// Os pés do jogador (a linha logo abaixo da caixa) estão no topo da caixa (x, topo, largura)?\n"
							  "static bool jogador_sobre(s16 x, s16 topo, s16 largura) {\n"
							  "\tconst s16 jx = jogador_x + %d;\n"
							  "\treturn (jogador_y16 >> 4) + %d == topo && jx < x + largura && x < jx + %d;\n}\n\n"),
					box.position.x, box.position.y + box.size.y, box.size.x);
			code += U("// Leva o jogador junto com a plataforma; na horizontal, para numa parede.\n"
					  "static void jogador_levar(s16 dx, s16 dy) {\n"
					  "\tfor (s16 passo = abs(dx); passo > 0; passo--) {\n"
					  "\t\tconst s16 nx = jogador_x + (dx > 0 ? 1 : -1);\n");
			code += vformat("\t\tif (caixa_solida(nx + %d, (jogador_y16 >> 4) + %d, %d, %d)) {\n\t\t\tbreak;\n\t\t}\n\t\tjogador_x = nx;\n\t}\n\tjogador_y16 += dy << 4;\n}\n\n",
					box.position.x, box.position.y, box.size.x, box.size.y);
		}
		String standing, landing;
		for (const SpriteEntry &entry : sprites) {
			if (!entry.platform) {
				continue;
			}
			const String v = entry.prefix;
			const Rect2i box = entry.platform->get_caixa_efetiva();
			const Vector2i offset = entry.platform->get_deslocamento();
			const int length = MAX(1, MAX(Math::abs(offset.x), Math::abs(offset.y)));
			code += vformat(U("// Plataforma %s: de (%d, %d) a (%d, %d).\nstatic void %s_mover(void) {\n"), entry.node->get_name(), entry.position.x, entry.position.y, entry.position.x + offset.x, entry.position.y + offset.y, v);
			if (carries) {
				code += vformat("\tconst s16 antes_x = %s_x, antes_y = %s_y;\n\tconst bool levando = jogador_sobre(antes_x + %d, antes_y + %d, %d);\n", v, v, box.position.x, box.position.y, box.size.x);
			}
			code += vformat("\t%s_passo += %s_dir * %d;\n\tif (%s_passo >= %d) {\n\t\t%s_passo = %d;\n\t\t%s_dir = -1;\n\t} else if (%s_passo <= 0) {\n\t\t%s_passo = 0;\n\t\t%s_dir = 1;\n\t}\n",
					v, v, entry.platform->get_velocidade(), v, length, v, length, v, v, v, v);
			code += vformat("\t%s_x = %d + (s32)%d * %s_passo / %d;\n\t%s_y = %d + (s32)%d * %s_passo / %d;\n", v, entry.position.x, offset.x, v, length, v, entry.position.y, offset.y, v, length);
			if (carries) {
				code += vformat("\tif (levando) {\n\t\tjogador_levar(%s_x - antes_x, %s_y - antes_y);\n\t}\n", v, v);
				standing += vformat("\t\tjogador_sobre(%s_x + %d, %s_y + %d, %d) ||\n", v, box.position.x, v, box.position.y, box.size.x);
				landing += vformat("\t\t(%s_y + %d == linha && jx < %s_x + %d && %s_x + %d < jx + %d) ||\n", v, box.position.y, v, box.position.x + box.size.x, v, box.position.x, player->get_caixa_efetiva().size.x);
			}
			code += "}\n\n";
		}
		if (carries) {
			code += "static bool jogador_em_plataforma(void) {\n\treturn\n" + standing.trim_suffix(" ||\n") + ";\n}\n\n";
			code += vformat(U("// A linha de baixo da caixa do jogador, descendo, entraria no topo de uma plataforma?\n"
							  "static bool plataforma_embaixo(s16 linha) {\n\tconst s16 jx = jogador_x + %d;\n\treturn\n"),
					player->get_caixa_efetiva().position.x);
			code += landing.trim_suffix(" ||\n") + ";\n}\n\n";
		}
		return code;
	}

	bool has_enemies() const {
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				return true;
			}
		}
		return false;
	}

	String resources() const {
		String res = String(GENERATED_MARK) + U(" a partir de ") + scenes[0].path + U(". Não edite: o arquivo é refeito no build.\n");
		for (const Asset &asset : assets) {
			if (asset.kind == "IMAGE") {
				res += vformat("IMAGE %s \"%s\" BEST\n", asset.symbol, asset.file);
			} else if (asset.kind == "SPRITE") {
				res += vformat("SPRITE %s \"%s\" %d %d NONE %d\n", asset.symbol, asset.file, asset.frame_tiles_w, asset.frame_tiles_h, asset.speed);
			} else if (asset.kind == "XGM") {
				res += vformat("XGM %s \"%s\"\n", asset.symbol, asset.file);
			} else if (asset.kind == "WAV") {
				res += vformat("WAV %s \"%s\" XGM\n", asset.symbol, asset.file);
			} else {
				const String base = asset.symbol.substr(4);
				res += vformat("TILESET ts_%s \"%s\" BEST ALL\nMAP %s \"%s\" ts_%s BEST 0\nPALETTE pal_%s \"%s\"\n", base, asset.file, asset.symbol, asset.file, base, base, asset.file);
			}
		}
		return res;
	}

	String player_code(const SpriteEntry &p_entry) const {
		const Rect2i box = player->get_caixa_efetiva();
		const int speed = player->get_velocidade();
		const String jump_sound = player->get_som_pulo().is_empty() ? String() : "\t\t\tjogo_som(" + sound_define(player->get_som_pulo()) + ");\n";
		String code = vformat(
				"\t{\n"
				"\t\tconst u16 botoes = JOY_readJoypad(JOY_1);\n"
				"\t\ts16 dx = 0;\n"
				"\t\tif (botoes & BUTTON_LEFT) {\n"
				"\t\t\tdx = -%d;\n"
				"\t\t\tSPR_setHFlip(%s, TRUE);\n"
				"\t\t} else if (botoes & BUTTON_RIGHT) {\n"
				"\t\t\tdx = %d;\n"
				"\t\t\tSPR_setHFlip(%s, FALSE);\n"
				"\t\t}\n",
				speed, p_entry.variable, speed, p_entry.variable);
		if (player->get_modo() == MDJogador::MODO_VISTO_DE_CIMA) {
			// Visto de cima: 4 direções, sem gravidade; com mapa sólido, anda pixel a pixel em cada eixo.
			code += vformat("\t\ts16 dy = 0;\n\t\tif (botoes & BUTTON_UP) {\n\t\t\tdy = -%d;\n\t\t} else if (botoes & BUTTON_DOWN) {\n\t\t\tdy = %d;\n\t\t}\n", speed, speed);
			if (collision.is_empty()) {
				code += vformat("\t\tjogador_x = clamp(jogador_x + dx, 0, %d);\n\t\tjogador_y16 = clamp((jogador_y16 >> 4) + dy, 0, %d) << 4;\n",
						MAX(world.x, RetroMD::SCREEN_WIDTH) - box.position.x - box.size.x, MAX(world.y, RetroMD::SCREEN_HEIGHT) - box.position.y - box.size.y);
			} else {
				code += vformat("\t\tfor (s16 passo = abs(dx); passo > 0; passo--) {\n\t\t\tconst s16 nx = jogador_x + (dx > 0 ? 1 : -1);\n\t\t\tif (caixa_solida(nx + %d, (jogador_y16 >> 4) + %d, %d, %d)) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tjogador_x = nx;\n\t\t}\n"
								"\t\tfor (s16 passo = abs(dy); passo > 0; passo--) {\n\t\t\tconst s16 ny = (jogador_y16 >> 4) + (dy > 0 ? 1 : -1);\n\t\t\tif (ny < 0 || ny + %d > MAPA_ALTURA || caixa_solida(jogador_x + %d, ny + %d, %d, %d)) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tjogador_y16 = ny << 4;\n\t\t}\n",
						box.position.x, box.position.y, box.size.x, box.size.y, box.position.y + box.size.y, box.position.x, box.position.y, box.size.x, box.size.y);
			}
			code += vformat("\t\tjogador_botoes_antes = botoes;\n\t\tSPR_setAnim(%s, dx || dy ? 1 : 0);\n\t}\n", p_entry.variable);
			return code;
		}
		if (collision.is_empty()) {
			// Sem mapa sólido: o chão é a posição inicial.
			code += vformat(
					"\t\tjogador_x = clamp(jogador_x + dx, 0, %d);\n"
					"\t\tif (jogador_no_chao && (botoes & ~jogador_botoes_antes & PULO)) {\n"
					"%s"
					"\t\t\tjogador_vy16 = -%d;\n"
					"\t\t\tjogador_no_chao = FALSE;\n"
					"\t\t}\n"
					"\t\tif (!jogador_no_chao) {\n"
					"\t\t\tif (!(botoes & PULO) && jogador_vy16 < -PULO_CURTO) {\n\t\t\t\tjogador_vy16 = -PULO_CURTO;\n\t\t\t}\n"
					"\t\t\tjogador_vy16 += %d;\n"
					"\t\t\tjogador_y16 += jogador_vy16;\n"
					"\t\t\tif (jogador_y16 >= JOGADOR_INICIO_Y * 16) {\n"
					"\t\t\t\tjogador_y16 = JOGADOR_INICIO_Y * 16;\n"
					"\t\t\t\tjogador_vy16 = 0;\n"
					"\t\t\t\tjogador_no_chao = TRUE;\n"
					"\t\t\t}\n"
					"\t\t}\n",
					MAX(world.x, RetroMD::SCREEN_WIDTH) - box.position.x - box.size.x, jump_sound, player->get_forca_pulo(), player->get_gravidade());
		} else {
			// Com mapa sólido: anda pixel a pixel até encostar num tile; cair do mapa custa uma vida. Caindo,
			// o topo de uma plataforma também segura.
			const bool platforms = has_platforms();
			const String platform_ground = platforms ? " || jogador_em_plataforma()" : "";
			const String platform_landing = platforms ? vformat(" || (ny > y && plataforma_embaixo(ny + %d))", box.position.y + box.size.y - 1) : "";
			code += vformat(
					"\t\tfor (s16 passo = abs(dx); passo > 0; passo--) {\n"
					"\t\t\tconst s16 nx = jogador_x + (dx > 0 ? 1 : -1);\n"
					"\t\t\tif (caixa_solida(nx + %d, (jogador_y16 >> 4) + %d, %d, %d)) {\n"
					"\t\t\t\tbreak;\n"
					"\t\t\t}\n"
					"\t\t\tjogador_x = nx;\n"
					"\t\t}\n"
					"\t\tjogador_no_chao = caixa_solida(jogador_x + %d, (jogador_y16 >> 4) + %d + 1, %d, %d)%s;\n"
					"\t\tif (jogador_no_chao && (botoes & ~jogador_botoes_antes & PULO)) {\n"
					"%s"
					"\t\t\tjogador_vy16 = -%d;\n"
					"\t\t}\n"
					"\t\tif (!(botoes & PULO) && jogador_vy16 < -PULO_CURTO) {\n\t\t\tjogador_vy16 = -PULO_CURTO;\n\t\t}\n"
					"\t\tjogador_vy16 = min(jogador_vy16 + %d, 8 * 16);\n"
					"\t\tconst s16 alvo = (jogador_y16 + jogador_vy16) >> 4;\n"
					"\t\ts16 y = jogador_y16 >> 4;\n"
					"\t\tbool bateu = FALSE;\n"
					"\t\twhile (y != alvo) {\n"
					"\t\t\tconst s16 ny = y + (alvo > y ? 1 : -1);\n"
					"\t\t\tif (caixa_solida(jogador_x + %d, ny + %d, %d, %d)%s) {\n"
					"\t\t\t\tbateu = TRUE;\n"
					"\t\t\t\tbreak;\n"
					"\t\t\t}\n"
					"\t\t\ty = ny;\n"
					"\t\t}\n"
					"\t\tif (bateu) {\n"
					"\t\t\tjogador_y16 = y << 4;\n"
					"\t\t\tjogador_vy16 = 0;\n"
					"\t\t} else {\n"
					"\t\t\tjogador_y16 += jogador_vy16;\n"
					"\t\t}\n"
					"\t\tif ((jogador_y16 >> 4) > MAPA_ALTURA) {\n"
					"\t\t\tjogador_morrer();\n"
					"\t\t}\n",
					box.position.x, box.position.y, box.size.x, box.size.y, box.position.x, box.position.y, box.size.x, box.size.y, platform_ground, jump_sound, player->get_forca_pulo(),
					player->get_gravidade(), box.position.x, box.position.y, box.size.x, box.size.y, platform_landing);
		}
		code += vformat("\t\tjogador_botoes_antes = botoes;\n\t\tSPR_setAnim(%s, dx && jogador_no_chao ? 1 : 0);\n\t}\n", p_entry.variable);
		return code;
	}

	// Patrulha entre os limites; com mapa sólido, vira em paredes e na beira do chão. Encostar no
	// jogador (caixas sobrepostas) custa uma vida.
	String enemy_code(const SpriteEntry &p_entry) const {
		const MDInimigo *enemy = p_entry.enemy;
		const Rect2i box = enemy->get_caixa_efetiva();
		const String v = p_entry.prefix;
		const int y = p_entry.position.y;
		String code = vformat("static void %s_atualizar(void) {\n\tif (!%s_vivo) {\n\t\treturn;\n\t}\n\tconst s16 nx = %s_x + %s_dir * %d;\n", v, v, v, v, enemy->get_velocidade());
		String blocked = vformat("nx < %d || nx > %d", p_entry.position.x, p_entry.position.x + enemy->get_distancia());
		if (!collision.is_empty() && enemy->get_vira_na_borda()) {
			blocked += vformat(" || caixa_solida(nx + %d, %d, %d, %d)", box.position.x, y + box.position.y, box.size.x, box.size.y);
			if (!top_down()) {
				// Parede na frente ou nenhum chão embaixo da ponta da frente.
				code += vformat("\tconst s16 frente = %s_dir > 0 ? nx + %d : nx + %d;\n", v, box.position.x + box.size.x - 1, box.position.x);
				blocked += vformat(" || !solido(frente, %d)", y + box.position.y + box.size.y);
			}
		}
		code += vformat("\tif (%s) {\n\t\t%s_dir = -%s_dir;\n\t} else {\n\t\t%s_x = nx;\n\t}\n\tSPR_setHFlip(%s, %s_dir < 0);\n", blocked, v, v, v, p_entry.variable, v);
		if (player) {
			const Rect2i pbox = player->get_caixa_efetiva();
			code += vformat("\tconst s16 jx = jogador_x + %d, jy = (jogador_y16 >> 4) + %d;\n"
							"\tconst s16 ix = %s_x + %d, iy = %d;\n"
							"\tif (!(jx < ix + %d && ix < jx + %d && jy < iy + %d && iy < jy + %d)) {\n\t\treturn;\n\t}\n",
					pbox.position.x, pbox.position.y, v, box.position.x, y + box.position.y, box.size.x, pbox.size.x, box.size.y, pbox.size.y);
			if (enemy->get_pisavel()) {
				// Caindo, com os pés na parte de cima do inimigo: derrota e o jogador quica.
				code += vformat(U("\tif (jogador_vy16 > 0 && jy + %d - iy <= 8) {\n\t\t%s_vivo = FALSE;\n\t\tSPR_setVisibility(%s, HIDDEN);\n\t\tjogador_vy16 = -80;\n"), pbox.size.y, v, p_entry.variable);
				if (enemy->get_pontos() > 0) {
					code += vformat("\t\tpontos += %d;\n\t\thud_desenhar();\n", enemy->get_pontos());
				}
				if (!enemy->get_som_derrota().is_empty()) {
					code += "\t\tjogo_som(" + sound_define(enemy->get_som_derrota()) + ");\n";
				}
				code += "\t\treturn;\n\t}\n";
			}
			code += "\tjogador_morrer();\n";
		}
		return code + "}\n\n";
	}

	String collision_code() const {
		String code = vformat("// Colisão dos mapas sólidos: uma célula de 8×8 por byte (1 = sólido).\n#define MAPA_LARGURA %d\n#define MAPA_ALTURA %d\n", collision_cells.x * 8, collision_cells.y * 8);
		code += vformat("static const u8 mapa_colisao[%d] = {", collision.size());
		for (int i = 0; i < collision.size(); i++) {
			code += (i % 64 == 0 ? "\n\t" : "") + itos(collision[i]) + ",";
		}
		code += vformat("\n};\n\nstatic bool solido(s16 x, s16 y) {\n"
						"\tif (x < 0 || x >= MAPA_LARGURA) {\n\t\treturn TRUE; // As laterais do mapa são paredes.\n\t}\n"
						"\tif (y < 0 || y >= MAPA_ALTURA) {\n\t\treturn FALSE;\n\t}\n"
						"\treturn mapa_colisao[(y >> 3) * %d + (x >> 3)];\n}\n\n",
				collision_cells.x);
		code += U("// Testa a caixa nos cantos e a cada 8 pixels, para não atravessar tiles.\n");
		code += "static bool caixa_solida(s16 x, s16 y, s16 w, s16 h) {\n"
				"\tfor (s16 cy = y;; cy += 8) {\n"
				"\t\tif (cy > y + h - 1) {\n\t\t\tcy = y + h - 1;\n\t\t}\n"
				"\t\tfor (s16 cx = x;; cx += 8) {\n"
				"\t\t\tif (cx > x + w - 1) {\n\t\t\t\tcx = x + w - 1;\n\t\t\t}\n"
				"\t\t\tif (solido(cx, cy)) {\n\t\t\t\treturn TRUE;\n\t\t\t}\n"
				"\t\t\tif (cx == x + w - 1) {\n\t\t\t\tbreak;\n\t\t\t}\n"
				"\t\t}\n"
				"\t\tif (cy == y + h - 1) {\n\t\t\tbreak;\n\t\t}\n"
				"\t}\n\treturn FALSE;\n}\n\n";
		return code;
	}

	// Código de uma cena: cena_<ident>_iniciar/atualizar/encerrar, chamadas pelo jogo.c.
	String source(const String &p_scene_name) const {
		const String ident = scenes[scene].ident;
		String c = String(GENERATED_MARK) + U(" a partir de ") + scenes[scene].path + U(" (cena ") + p_scene_name + U("). Não edite: o arquivo é refeito no build.\n");
		c += "#include \"cena_" + ident + ".h\"\n\n";
		// O código C da cena é opcional: sem src/<ident>.c, os símbolos fracos ficam nulos.
		c += vformat("void %s_iniciar(void) __attribute__((weak));\nvoid %s_atualizar(void) __attribute__((weak));\n\n", ident, ident);
		for (const MapEntry &entry : maps) {
			c += vformat("static Map *%s; // %s\n", entry.variable, entry.node->get_name());
		}
		for (const SpriteEntry &entry : sprites) {
			c += vformat("Sprite *%s; // %s\n", entry.variable, entry.node->get_name());
		}
		const bool scrolls = !maps.is_empty();
		const bool enemies = has_enemies();
		const bool can_die = player && (enemies || (!collision.is_empty() && !top_down())); // Visto de cima não há queda.
		const bool hud_lives = player && player->get_vidas() > 0;
		bool hud_score = false; // Há itens ou inimigos que dão pontos.
		for (const SpriteEntry &entry : sprites) {
			hud_score = hud_score || (entry.item && entry.item->get_pontos() > 0) || (entry.enemy && entry.enemy->get_pisavel() && entry.enemy->get_pontos() > 0);
		}
		hud_score = hud_score && player;
		const bool hud = hud_lives || hud_score;
		if (scrolls) {
			c += vformat(U("\n// Câmera: canto superior esquerdo da tela no mundo (%d×%d).\n#define MUNDO_LARGURA %d\n#define MUNDO_ALTURA %d\nstatic s16 camera_x, camera_y;\n"), world.x, world.y, world.x, world.y);
		}
		if (player) {
			const SpriteEntry &entry = sprites[player_sprite];
			c += vformat(U("\n// Jogador (%s): posição e velocidade vertical em 1/16 de pixel.\n#define JOGADOR_INICIO_X %d\n#define JOGADOR_INICIO_Y %d\n"), player->get_name(), entry.position.x, entry.position.y);
			c += "static s16 jogador_x, jogador_y16, jogador_vy16;\nstatic bool jogador_no_chao;\n";
			// O pulo vale ao apertar (segurar não pula de novo); soltar na subida encurta o pulo.
			c += U("#define PULO (BUTTON_A | BUTTON_B | BUTTON_C)\n#define PULO_CURTO 48 // Velocidade de subida que sobra ao soltar o botão.\nstatic u16 jogador_botoes_antes;\n");
			if (checkpoints.is_empty()) {
				c += "\nstatic void jogador_reiniciar(void) {\n\tjogador_x = JOGADOR_INICIO_X;\n\tjogador_y16 = JOGADOR_INICIO_Y * 16;\n\tjogador_vy16 = 0;\n\tjogador_no_chao = TRUE;\n}\n";
			} else {
				c += U("static s16 retorno_x, retorno_y; // Onde o jogador volta: o início ou o último ponto de retorno.\n");
				c += "\nstatic void jogador_reiniciar(void) {\n\tjogador_x = retorno_x;\n\tjogador_y16 = retorno_y * 16;\n\tjogador_vy16 = 0;\n\tjogador_no_chao = TRUE;\n}\n";
			}
			if (hud) {
				c += U("\n// Pontos no meio e vidas no canto superior direito.\nstatic void hud_desenhar(void) {\n");
				if (hud_score) {
					c += "\tchar numero[11];\n\tuintToStr(pontos, numero, 6);\n\tVDP_drawText(\"PONTOS\", 13, 0);\n\tVDP_drawText(numero, 20, 0);\n";
				}
				if (hud_lives) {
					c += "\tchar texto[] = \"VIDAS 0\";\n\ttexto[6] = '0' + vidas;\n\tVDP_drawText(texto, 31, 0);\n";
				}
				c += "}\n";
			}
			if (can_die) {
				c += U("\n// Caiu do mapa ou encostou num inimigo: perde uma vida e volta ao início; sem vidas, fim de jogo.\nstatic void jogador_morrer(void) {\n");
				if (!player->get_som_morte().is_empty()) {
					c += "\tjogo_som(" + sound_define(player->get_som_morte()) + ");\n";
				}
				if (hud_lives) {
					c += "\tif (vidas <= 1) {\n\t\tvidas = 0;\n\t\tjogo_perdeu();\n\t\treturn;\n\t}\n\tvidas--;\n\thud_desenhar();\n";
				}
				c += "\tjogador_reiniciar();\n}\n";
			}
		}
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				c += vformat(U("\n// Inimigo %s: patrulha de x = %d a %d.\nstatic s16 %s_x, %s_dir;\nstatic bool %s_vivo;\n"), entry.node->get_name(), entry.position.x, entry.position.x + entry.enemy->get_distancia(), entry.prefix, entry.prefix, entry.prefix);
			} else if (entry.item) {
				c += vformat(U("\nstatic bool %s_ativo; // Item %s, até o jogador pegar.\n"), entry.prefix, entry.node->get_name());
			} else if (entry.platform) {
				c += vformat(U("\n// Plataforma %s: posição e passo no trajeto.\nstatic s16 %s_x, %s_y, %s_passo, %s_dir;\n"), entry.node->get_name(), entry.prefix, entry.prefix, entry.prefix, entry.prefix);
			}
		}
		if (start_scene >= 0) {
			c += U("\nstatic u16 botoes_antes; // Para o START valer ao apertar, e não ao segurar.\n");
		}
		if (!blinking.is_empty()) {
			c += U("\nstatic u16 quadros; // Relógio dos textos que piscam.\n");
		}
		c += "\n";
		if (!collision.is_empty() && (player || enemies)) {
			c += collision_code();
		}
		c += platform_code();
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				c += enemy_code(entry);
			}
		}
		// Câmera centrada no jogador, presa às bordas do mundo; os sprites ficam na posição do mundo.
		if (scrolls) {
			c += "static void camera_atualizar(void) {\n";
			if (player) {
				const Rect2i box = player->get_caixa_efetiva();
				c += vformat("\tcamera_x = clamp(jogador_x + %d - %d, 0, max(MUNDO_LARGURA - %d, 0));\n\tcamera_y = clamp((jogador_y16 >> 4) + %d - %d, 0, max(MUNDO_ALTURA - %d, 0));\n",
						box.position.x + box.size.x / 2, RetroMD::SCREEN_WIDTH / 2, RetroMD::SCREEN_WIDTH, box.position.y + box.size.y / 2, RetroMD::SCREEN_HEIGHT / 2, RetroMD::SCREEN_HEIGHT);
			}
			for (const MapEntry &entry : maps) {
				c += vformat("\tMAP_scrollTo(%s, camera_x, camera_y);\n", entry.variable);
			}
			// Parallax: o fundo rola uma fração da câmera (o plano de 512 px dá a volta).
			for (const ParallaxEntry &parallax : parallaxes) {
				bool map_plane = false; // No plano de um mapa, quem rola é o mapa.
				for (const MapEntry &entry : maps) {
					map_plane = map_plane || (entry.node->get_plano() == MDFundo::PLANO_A) == (parallax.plane == "BG_A");
				}
				if (map_plane) {
					continue;
				}
				c += vformat("\tVDP_setHorizontalScroll(%s, -(s16)((s32)camera_x * %d / 100)); // %s\n\tVDP_setVerticalScroll(%s, (s16)((s32)camera_y * %d / 100));\n",
						parallax.plane, parallax.percent, parallax.name, parallax.plane, parallax.percent);
			}
			c += "}\n\n";
		}
		if (!sprites.is_empty()) {
			c += "static void sprites_posicionar(void) {\n";
			const String camera_x = scrolls ? " - camera_x" : "", camera_y = scrolls ? " - camera_y" : "";
			for (int i = 0; i < sprites.size(); i++) {
				const SpriteEntry &entry = sprites[i];
				if (i == player_sprite) {
					c += vformat("\tSPR_setPosition(%s, jogador_x%s, (jogador_y16 >> 4)%s);\n", entry.variable, camera_x, camera_y);
				} else if (entry.enemy) {
					c += vformat("\tSPR_setPosition(%s, %s_x%s, %d%s);\n", entry.variable, entry.prefix, camera_x, entry.position.y, camera_y);
				} else if (entry.platform) {
					c += vformat("\tSPR_setPosition(%s, %s_x%s, %s_y%s);\n", entry.variable, entry.prefix, camera_x, entry.prefix, camera_y);
				} else {
					c += vformat("\tSPR_setPosition(%s, %d%s, %d%s);\n", entry.variable, entry.position.x, camera_x, entry.position.y, camera_y);
				}
			}
			c += "}\n\n";
		}

		// Início: tudo é desenhado com a tela escura e as cores entram num fade.
		c += "void cena_" + ident + "_iniciar(void) {\n\tPAL_setColors(0, palette_black, 64, CPU);\n\tVDP_setScreenWidth320();\n\tu16 cores[64];\n\tmemset(cores, 0, sizeof(cores));\n";
		for (int slot = 0; slot < 4; slot++) {
			if (palette_source[slot].is_empty()) {
				continue;
			}
			const bool image = palette_source[slot].begins_with("img_") || palette_source[slot].begins_with("spr_");
			c += vformat("\tmemcpy(&cores[%d], %s%s, 16 * 2);\n", slot * 16, palette_source[slot], image ? ".palette->data" : ".data");
		}
		if (palette_source[0].is_empty()) {
			c += "\tcores[15] = RGB24_TO_VDPCOLOR(0xEEEEEE); // Cor da fonte (PAL0, cor 15).\n";
		}
		if (!draw_code.is_empty()) {
			c += "\tu16 tile = TILE_USER_INDEX;\n" + draw_code;
		}
		bool map_on_a = false;
		for (const MapEntry &entry : maps) {
			map_on_a = map_on_a || entry.node->get_plano() == MDFundo::PLANO_A;
		}
		const int fixed_rows = MAX(text_rows, hud ? 1 : 0);
		if (map_on_a && fixed_rows > 0) {
			// O mapa rola no plano A e apagaria os textos: eles vão para o plano window, fixo no topo.
			c += vformat(U("\t// Textos no plano window (linhas 0 a %d), que não rola com o mapa.\n\tVDP_setWindowVPos(FALSE, %d);\n\tVDP_setTextPlane(WINDOW);\n"), fixed_rows - 1, fixed_rows);
		}
		c += text_code;
		if (player) {
			if (!checkpoints.is_empty()) {
				c += "\tretorno_x = JOGADOR_INICIO_X;\n\tretorno_y = JOGADOR_INICIO_Y;\n";
			}
			c += "\tjogador_reiniciar();\n\tjogador_botoes_antes = JOY_readJoypad(JOY_1);\n";
			if (hud_lives) {
				c += vformat("\tif (vidas == 0) {\n\t\tvidas = %d; // Jogo novo.\n\t}\n", player->get_vidas());
			}
			if (hud) {
				c += "\thud_desenhar();\n";
			}
		}
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				c += vformat("\t%s_x = %d;\n\t%s_dir = 1;\n\t%s_vivo = TRUE;\n", entry.prefix, entry.position.x, entry.prefix, entry.prefix);
			} else if (entry.item) {
				c += vformat("\t%s_ativo = TRUE;\n", entry.prefix);
			} else if (entry.platform) {
				c += vformat("\t%s_x = %d;\n\t%s_y = %d;\n\t%s_passo = 0;\n\t%s_dir = 1;\n", entry.prefix, entry.position.x, entry.prefix, entry.position.y, entry.prefix, entry.prefix);
			}
		}
		if (start_scene >= 0) {
			c += "\tbotoes_antes = JOY_readJoypad(JOY_1);\n";
		}
		if (!blinking.is_empty()) {
			c += "\tquadros = 0;\n";
		}
		if (scrolls) {
			c += "\tcamera_atualizar();\n";
		}
		if (!sprites.is_empty()) {
			c += "\tSPR_init();\n";
			for (const SpriteEntry &entry : sprites) {
				const Asset &asset = assets[entry.asset];
				c += vformat("\t%s = SPR_addSprite(&%s, 0, 0, TILE_ATTR(PAL%d, %s, FALSE, FALSE));\n", entry.variable, asset.symbol, entry.node->get_paleta(), entry.node->get_prioridade() ? "TRUE" : "FALSE");
				// O SPR_addSprite deixa o sprite sempre visível; fora da tela a coordenada dá a volta.
				c += vformat("\tSPR_setVisibility(%s, AUTO_FAST);\n", entry.variable);
				if (entry.node->get_frame() > 0) {
					c += vformat("\tSPR_setAnimAndFrame(%s, %d, %d);\n", entry.variable, entry.node->get_frame() / MAX(1, entry.node->get_hframes()), entry.node->get_frame() % MAX(1, entry.node->get_hframes()));
				}
				if (entry.node->is_flipped_h()) {
					c += vformat("\tSPR_setHFlip(%s, TRUE);\n", entry.variable);
				}
			}
			c += "\tsprites_posicionar();\n\tif (" + ident + "_iniciar) {\n\t\t" + ident + "_iniciar();\n\t}\n\tSPR_update();\n";
		} else {
			c += "\tif (" + ident + "_iniciar) {\n\t\t" + ident + "_iniciar();\n\t}\n";
		}
		c += music >= 0 ? vformat("\tjogo_musica(%s);\n", assets[music].symbol) : String("\tjogo_musica(NULL);\n");
		c += "\tPAL_fadeInAll(cores, 15, FALSE);\n}\n\n";

		c += "void cena_" + ident + "_atualizar(void) {\n";
		if (start_scene >= 0) {
			c += vformat("\t{\n\t\tconst u16 botoes = JOY_readJoypad(JOY_1);\n\t\tif ((botoes & BUTTON_START) && !(botoes_antes & BUTTON_START)) {\n\t\t\tjogo_trocar_cena(%s);\n\t\t}\n\t\tbotoes_antes = botoes;\n\t}\n", scene_constant(start_scene));
		}
		if (!blinking.is_empty()) {
			c += "\tif (++quadros == 30) {\n";
			for (const BlinkingText &blink : blinking) {
				c += vformat("\t\tVDP_clearText(%d, %d, %d);\n", blink.tile.x, blink.tile.y, blink.text.length());
			}
			c += "\t} else if (quadros == 60) {\n";
			for (const BlinkingText &blink : blinking) {
				c += vformat("\t\tVDP_drawText(\"%s\", %d, %d);\n", blink.text.c_escape(), blink.tile.x, blink.tile.y);
			}
			c += "\t\tquadros = 0;\n\t}\n";
		}
		// As plataformas andam antes do jogador, para ele já pisar onde elas estão.
		for (const SpriteEntry &entry : sprites) {
			if (entry.platform) {
				c += vformat("\t%s_mover();\n", entry.prefix);
			}
		}
		if (player) {
			c += player_code(sprites[player_sprite]);
			const Rect2i box = player->get_caixa_efetiva();
			// Pontos de retorno: o jogador volta com os pés no fundo da área, centralizado.
			for (const CheckpointEntry &checkpoint : checkpoints) {
				const Vector2i respawn(checkpoint.area.position.x + checkpoint.area.size.x / 2 - (box.position.x + box.size.x / 2), checkpoint.area.get_end().y - (box.position.y + box.size.y));
				c += vformat(U("\tif (retorno_x != %d || retorno_y != %d) {\n\t\t// Ponto de retorno %s.\n\t\tconst s16 jx = jogador_x + %d, jy = (jogador_y16 >> 4) + %d;\n\t\tif (jx < %d && %d < jx + %d && jy < %d && %d < jy + %d) {\n\t\t\tretorno_x = %d;\n\t\t\tretorno_y = %d;\n"),
						respawn.x, respawn.y, checkpoint.name, box.position.x, box.position.y, checkpoint.area.get_end().x, checkpoint.area.position.x, box.size.x, checkpoint.area.get_end().y, checkpoint.area.position.y, box.size.y, respawn.x, respawn.y);
				if (!checkpoint.sound.is_empty()) {
					c += "\t\t\tjogo_som(" + sound_define(checkpoint.sound) + ");\n";
				}
				c += "\t\t}\n\t}\n";
			}
			for (const ExitEntry &exit : exits) {
				c += vformat(U("\t{\n\t\t// Saída para %s.\n\t\tconst s16 jx = jogador_x + %d, jy = (jogador_y16 >> 4) + %d;\n\t\tif (jx < %d && %d < jx + %d && jy < %d && %d < jy + %d) {\n\t\t\tjogo_trocar_cena(%s);\n\t\t}\n\t}\n"),
						scenes[exit.scene].path.get_file(), box.position.x, box.position.y, exit.area.get_end().x, exit.area.position.x, box.size.x, exit.area.get_end().y, exit.area.position.y, box.size.y, scene_constant(exit.scene));
			}
			for (const SpriteEntry &entry : sprites) {
				if (!entry.item) {
					continue;
				}
				const Rect2i ibox = entry.item->get_caixa_efetiva();
				const Vector2i corner = entry.position + ibox.position;
				c += vformat(U("\tif (%s_ativo) {\n\t\t// Item %s.\n\t\tconst s16 jx = jogador_x + %d, jy = (jogador_y16 >> 4) + %d;\n\t\tif (jx < %d && %d < jx + %d && jy < %d && %d < jy + %d) {\n\t\t\t%s_ativo = FALSE;\n\t\t\tSPR_setVisibility(%s, HIDDEN);\n"),
						entry.prefix, entry.node->get_name(), box.position.x, box.position.y, corner.x + ibox.size.x, corner.x, box.size.x, corner.y + ibox.size.y, corner.y, box.size.y, entry.prefix, entry.variable);
				if (entry.item->get_pontos() > 0) {
					c += vformat("\t\t\tpontos += %d;\n\t\t\thud_desenhar();\n", entry.item->get_pontos());
				}
				if (!entry.item->get_som().is_empty()) {
					c += "\t\t\tjogo_som(" + sound_define(entry.item->get_som()) + ");\n";
				}
				c += "\t\t}\n\t}\n";
			}
		}
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				c += vformat("\t%s_atualizar();\n", entry.prefix);
			}
		}
		if (scrolls) {
			c += "\tcamera_atualizar();\n";
		}
		// O código C da cena roda depois do jogo gerado e antes de os sprites irem para a tela.
		if (!sprites.is_empty()) {
			c += "\tsprites_posicionar();\n\tif (" + ident + "_atualizar) {\n\t\t" + ident + "_atualizar();\n\t}\n\tSPR_update();\n";
		} else {
			c += "\tif (" + ident + "_atualizar) {\n\t\t" + ident + "_atualizar();\n\t}\n";
		}
		c += "}\n\n";

		// Fim: devolve a memória dos mapas e dos sprites; o jogo.c limpa os planos.
		c += "void cena_" + ident + "_encerrar(void) {\n";
		for (const MapEntry &entry : maps) {
			c += vformat("\tMAP_release(%s);\n\t%s = NULL;\n", entry.variable, entry.variable);
		}
		if (!sprites.is_empty()) {
			c += "\tSPR_end();\n";
		}
		c += "}\n";
		return c;
	}

	// Cabeçalho do código C da cena: os sprites pelo nome do node e as funções que o programador pode escrever.
	String scene_header(const String &p_scene_name) const {
		const String ident = scenes[scene].ident;
		String h = String(GENERATED_MARK) + U(" a partir de ") + scenes[scene].path + U(" (cena ") + p_scene_name + U("). Não edite: o arquivo é refeito no build.\n#pragma once\n\n#include \"jogo.h\"\n\n");
		if (!sprites.is_empty()) {
			h += vformat(U("// Sprites da cena, pelo nome do node (criados em cena_%s_iniciar).\n"), ident);
			for (const SpriteEntry &entry : sprites) {
				h += vformat("extern Sprite *%s; // %s\n", entry.variable, entry.node->get_name());
			}
			h += "\n";
		}
		h += vformat(U("// Código C da cena (opcional): escreva estas funções em src/%s.c e o jogo as chama.\n"
					   "void %s_iniciar(void); // Uma vez, com a cena montada, antes de clarear a tela.\n"
					   "void %s_atualizar(void); // Todo quadro, depois do jogo gerado e antes de os sprites irem para a tela.\n"),
				ident, ident, ident);
		return h;
	}

	String game_header() const {
		String h = String(GENERATED_MARK) + U(". Não edite: o arquivo é refeito no build.\n#pragma once\n\n#include <genesis.h>\n\n#include \"cenas_gerado.h\"\n\n// Cenas do jogo; a primeira é a cena principal do projeto.\nenum {\n");
		for (int i = 0; i < scenes.size(); i++) {
			h += vformat("\t%s, // %s\n", scene_constant(i), scenes[i].path);
		}
		h += "\tCENAS_TOTAL\n};\n\n";
		bool any_sound = false;
		for (const Asset &asset : assets) {
			if (asset.kind == "WAV") {
				if (!any_sound) {
					h += U("// Efeitos sonoros (números das amostras PCM no driver XGM).\n");
					any_sound = true;
				}
				h += vformat("#define %s %d\n", asset.define, asset.sound_id);
			}
		}
		h += U("\nextern u8 vidas; // 0 = jogo novo (a primeira cena com jogador define as vidas).\nextern u32 pontos;\n\n"
			   "void jogo_trocar_cena(u16 cena); // Troca no fim do quadro.\n"
			   "void jogo_perdeu(void); // Mostra o fim de jogo e volta à cena principal.\n"
			   "void jogo_musica(const u8 *musica); // NULL = silêncio; a mesma música continua tocando.\n"
			   "void jogo_som(u8 som);\n\n");
		for (const SceneInfo &info : scenes) {
			h += vformat("void cena_%s_iniciar(void);\nvoid cena_%s_atualizar(void);\nvoid cena_%s_encerrar(void);\n", info.ident, info.ident, info.ident);
		}
		return h;
	}

	String game_source() const {
		bool audio = false;
		for (const Asset &asset : assets) {
			audio = audio || asset.kind == "XGM" || asset.kind == "WAV";
		}
		String c = String(GENERATED_MARK) + U(". Não edite: o arquivo é refeito no build.\n#include \"jogo.h\"\n\n");
		c += "typedef struct {\n\tvoid (*iniciar)(void);\n\tvoid (*atualizar)(void);\n\tvoid (*encerrar)(void);\n} Cena;\n\nstatic const Cena cenas[CENAS_TOTAL] = {\n";
		for (const SceneInfo &info : scenes) {
			c += vformat("\t{ cena_%s_iniciar, cena_%s_atualizar, cena_%s_encerrar },\n", info.ident, info.ident, info.ident);
		}
		c += "};\n\nu8 vidas;\nu32 pontos;\nstatic u16 cena_atual, cena_proxima;\nstatic bool perdeu;\nstatic const u8 *musica_atual;\n\n";
		c += "void jogo_trocar_cena(u16 cena) {\n\tcena_proxima = cena;\n}\n\n";
		c += "void jogo_perdeu(void) {\n\tperdeu = TRUE;\n}\n\n";
		c += "void jogo_musica(const u8 *musica) {\n\tif (musica == musica_atual) {\n\t\treturn;\n\t}\n\tmusica_atual = musica;\n\tif (musica) {\n\t\tXGM_startPlay(musica);\n\t} else {\n\t\tXGM_stopPlay();\n\t}\n}\n\n";
		c += "void jogo_som(u8 som) {\n\tXGM_startPlayPCM(som, 1, SOUND_PCM_CH2);\n}\n\n";
		c += U("// Escurece a tela e desfaz a cena atual: sprites, mapas, planos e rolagem.\n"
			   "static void tela_limpar(void) {\n\tPAL_fadeOutAll(15, FALSE);\n\tcenas[cena_atual].encerrar();\n"
			   "\tVDP_setWindowVPos(FALSE, 0);\n\tVDP_setTextPlane(BG_A);\n"
			   "\tVDP_clearPlane(BG_A, TRUE);\n\tVDP_clearPlane(BG_B, TRUE);\n\tVDP_clearPlane(WINDOW, TRUE);\n"
			   "\tVDP_setHorizontalScroll(BG_A, 0);\n\tVDP_setHorizontalScroll(BG_B, 0);\n\tVDP_setVerticalScroll(BG_A, 0);\n\tVDP_setVerticalScroll(BG_B, 0);\n}\n\n");
		c += "static void fim_de_jogo(void) {\n\ttela_limpar();\n\tjogo_musica(NULL);\n\tVDP_drawText(\"GAME OVER\", 15, 13);\n\tPAL_setColor(15, RGB24_TO_VDPCOLOR(0xEEEEEE));\n"
			 "\tfor (u16 i = 0; i < 150; i++) {\n\t\tSYS_doVBlankProcess();\n\t}\n\tPAL_fadeOutAll(15, FALSE);\n\tVDP_clearPlane(BG_A, TRUE);\n}\n\n";
		c += "int main(bool hard) {\n\t(void)hard;\n";
		if (audio) {
			c += "\tZ80_loadDriver(Z80_DRIVER_XGM, TRUE);\n";
		}
		for (const Asset &asset : assets) {
			if (asset.kind == "WAV") {
				c += vformat("\tXGM_setPCM(%s, %s, sizeof(%s));\n", asset.define, asset.symbol, asset.symbol);
			}
		}
		// Voltar à cena principal (pelo fim de jogo ou por uma saída) começa um jogo novo.
		c += "\tcenas[cena_atual].iniciar();\n\twhile (TRUE) {\n\t\tcenas[cena_atual].atualizar();\n\t\tSYS_doVBlankProcess();\n"
			 "\t\tif (perdeu) {\n\t\t\tperdeu = FALSE;\n\t\t\tfim_de_jogo();\n\t\t\tcena_atual = cena_proxima = 0;\n"
			 "\t\t} else if (cena_proxima != cena_atual) {\n\t\t\ttela_limpar();\n\t\t\tcena_atual = cena_proxima;\n\t\t} else {\n\t\t\tcontinue;\n\t\t}\n"
			 "\t\tif (cena_atual == 0) {\n\t\t\tvidas = 0;\n\t\t\tpontos = 0;\n\t\t}\n\t\tcenas[cena_atual].iniciar();\n\t}\n\treturn 0;\n}\n";
		return c;
	}

	// Apaga arquivos gerados por builds antigos que este build não refez (ex.: uma cena removida).
	void remove_stale(const String &p_dir, bool p_check_mark) {
		const Ref<DirAccess> dir = DirAccess::open(project_dir.path_join(p_dir));
		if (dir.is_null()) {
			return;
		}
		for (const String &file : dir->get_files()) {
			const String relative = p_dir.path_join(file);
			if (produced.has(relative)) {
				continue;
			}
			if (p_check_mark) {
				const Ref<FileAccess> current = FileAccess::open(project_dir.path_join(relative), FileAccess::READ);
				if (current.is_null() || !current->get_line().begins_with(GENERATED_MARK)) {
					continue;
				}
			}
			if (dir->remove(file) == OK) {
				result.written.push_back(relative + U(" (removido)"));
			}
		}
	}
};

} // namespace

String scene_identifier(const String &p_scene_path) {
	return identifier(p_scene_path.get_file().get_basename());
}

Result export_main_scene(const String &p_project_dir) {
	Exporter exporter;
	exporter.project_dir = p_project_dir;
	const String main_scene = GLOBAL_GET("application/run/main_scene");
	if (main_scene.is_empty()) {
		exporter.result.skipped = true;
		return exporter.result;
	}
	exporter.scene_for(main_scene);
	// As cenas entram na fila pela cena principal e pelos destinos das saídas e do START.
	for (int i = 0; i < exporter.scenes.size(); i++) {
		const String path = exporter.scenes[i].path;
		const Ref<PackedScene> scene = ResourceLoader::load(path, "PackedScene");
		if (scene.is_null()) {
			exporter.result.errors.push_back(U("A cena não pôde ser carregada: ") + path);
			continue;
		}
		Node *root = scene->instantiate();
		MDCena *cena = Object::cast_to<MDCena>(root);
		if (!cena) {
			if (root) {
				memdelete(root);
			}
			if (i == 0) {
				// Projetos que não usam cenas do Mega Drive seguem só com o código escrito à mão.
				exporter.result.skipped = true;
				return exporter.result;
			}
			exporter.result.errors.push_back(path + U(": a raiz da cena precisa ser uma MDCena."));
			continue;
		}
		exporter.reset_scene();
		exporter.scene = i;
		exporter.scene_label = path.get_file() + ": ";
		exporter.check(root, cena->get_configuration_warnings());
		if (!cena->get_musica().is_empty()) {
			exporter.music = exporter.sound_for("XGM", cena->get_musica());
		}
		if (!cena->get_start_vai_para().is_empty()) {
			exporter.start_scene = exporter.scene_for(cena->get_start_vai_para());
		}
		exporter.visit(root, root);
		for (const ParallaxEntry &parallax : exporter.parallaxes) {
			for (const MapEntry &map : exporter.maps) {
				if ((map.node->get_plano() == MDFundo::PLANO_A) == (parallax.plane == "BG_A")) {
					exporter.result.warnings.push_back(exporter.scene_label + parallax.name + U(": o fundo está no mesmo plano do mapa, que manda na rolagem; a rolagem do fundo é ignorada."));
				}
			}
			if (exporter.maps.is_empty()) {
				exporter.result.warnings.push_back(exporter.scene_label + parallax.name + U(": sem MDMapa a câmera não anda, então o fundo não rola."));
			}
		}
		if (exporter.has_platforms() && (!exporter.player || exporter.collision.is_empty())) {
			exporter.result.warnings.push_back(exporter.scene_label + U("as plataformas só seguram o jogador numa cena com MDJogador e um MDMapa sólido."));
		}
		if (!exporter.exits.is_empty() && !exporter.player) {
			exporter.result.warnings.push_back(exporter.scene_label + U("as saídas só funcionam numa cena com MDJogador."));
		}
		if (exporter.sprites.size() > RetroMD::MAX_SPRITES) {
			exporter.result.errors.push_back(exporter.scene_label + vformat(U("a cena tem %d sprites; o console mostra no máximo %d."), exporter.sprites.size(), RetroMD::MAX_SPRITES));
		}
		if (exporter.background_tiles > BACKGROUND_VRAM_TILES) {
			exporter.result.errors.push_back(exporter.scene_label + vformat(U("fundos e mapas usam %d tiles, mas só %d cabem na VRAM. Simplifique as imagens ou repita mais tiles."), exporter.background_tiles, BACKGROUND_VRAM_TILES));
		}
		if (exporter.sprite_tiles > SPRITE_VRAM_TILES) {
			exporter.result.errors.push_back(exporter.scene_label + vformat(U("os sprites usam %d tiles, mas o motor de sprites reserva %d na VRAM."), exporter.sprite_tiles, SPRITE_VRAM_TILES));
		}
		exporter.result.info.push_back(vformat(U("%s: VRAM de fundos e mapas %d/%d tiles (%d%%), sprites %d/%d tiles (%d%%), %d/%d sprites."), path.get_file(), exporter.background_tiles, BACKGROUND_VRAM_TILES,
				exporter.background_tiles * 100 / BACKGROUND_VRAM_TILES, exporter.sprite_tiles, SPRITE_VRAM_TILES, exporter.sprite_tiles * 100 / SPRITE_VRAM_TILES, exporter.sprites.size(), RetroMD::MAX_SPRITES));
		if (exporter.result.errors.is_empty()) {
			// Usa os nodes, que ainda existem.
			exporter.write("src/gerado/cena_" + exporter.scenes[i].ident + ".h", exporter.scene_header(root->get_name()));
			exporter.write("src/gerado/cena_" + exporter.scenes[i].ident + ".c", exporter.source(root->get_name()));
		}
		memdelete(root);
	}
	if (!exporter.result.errors.is_empty()) {
		return exporter.result;
	}
	exporter.write("res/cenas_gerado.res", exporter.resources());
	exporter.write("src/gerado/jogo.h", exporter.game_header());
	exporter.write("src/gerado/jogo.c", exporter.game_source());
	exporter.remove_stale("src/gerado", true);
	exporter.remove_stale("res/gerado", false);
	return exporter.result;
}

} // namespace RetroSgdkExport
