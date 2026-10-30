#include "retro_sgdk_export.h"

#include "../scene/md_nodes.h"

#include "core/config/project_settings.h"
#include "core/io/compression.h"
#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/image.h"
#include "core/io/resource_loader.h"
#include "core/templates/hash_map.h"
#include "scene/resources/2d/tile_set.h"
#include "scene/resources/packed_scene.h"

namespace RetroSgdkExport {

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

// ---- Coleta da cena ----

struct Asset {
	String symbol;
	String kind; // IMAGE, SPRITE ou MAP
	String file; // Relativo a res/, como o rescomp lê.
	String texture;
	int frame_tiles_w = 0, frame_tiles_h = 0, speed = 0;
};

struct SpriteEntry {
	MDSprite *node = nullptr;
	String variable;
	Vector2i position;
	int asset = -1;
	MDInimigo *enemy = nullptr;
	String prefix; // Variáveis do inimigo (inimigo_N).
};

struct MapEntry {
	MDMapa *node = nullptr;
	String variable;
	int asset = -1;
	Vector2i size; // Pixels pintados (múltiplos de 8).
};

struct Exporter {
	String project_dir;
	String scene_path;
	Result result;
	Vector<Asset> assets;
	HashMap<String, int> asset_by_key;
	HashMap<String, int> symbols;
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
		assets.push_back(asset);
		asset_by_key[key] = assets.size() - 1;
		return assets.size() - 1;
	}

	void use_palette(int p_slot, const String &p_symbol, const String &p_texture, const String &p_node) {
		if (palette_source[p_slot].is_empty()) {
			palette_source[p_slot] = p_symbol;
			palette_texture[p_slot] = p_texture;
		} else if (palette_texture[p_slot] != p_texture) {
			result.warnings.push_back(vformat(U("%s usa a PAL%d, que já carrega as cores de %s; as cores de %s podem sair diferentes."), p_node, p_slot, palette_texture[p_slot].get_file(), p_texture.get_file()));
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
			result.errors.push_back(String(p_node->get_name()) + ": " + warning);
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
				entry.variable = vformat("sprite_%d", sprites.size());
				entry.position = position;
				entry.asset = asset_for("SPRITE", sprite, sprite->get_velocidade_animacao());
				use_palette(sprite->get_paleta(), assets[entry.asset].symbol, assets[entry.asset].texture, name);
				entry.enemy = Object::cast_to<MDInimigo>(sprite);
				if (entry.enemy) {
					entry.prefix = vformat("inimigo_%d", sprites.size());
				}
				if (MDJogador *jogador = Object::cast_to<MDJogador>(sprite)) {
					if (player) {
						result.warnings.push_back(U("Há mais de um MDJogador; só o primeiro é controlado."));
					} else {
						player = jogador;
						player_sprite = sprites.size();
					}
				}
				sprites.push_back(entry);
			}
		} else if (MDTexto *texto = Object::cast_to<MDTexto>(p_node)) {
			if (check(p_node, texto->get_configuration_warnings()) && !texto->get_texto().is_empty()) {
				text_code += vformat("\tVDP_drawText(\"%s\", %d, %d);\n", texto->get_texto().c_escape(), position.x / 8, position.y / 8);
				text_rows = MAX(text_rows, position.y / 8 + 1);
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
				result.errors.push_back(name + U(": já há um mapa nesse plano; use BG A para um e BG B para o outro."));
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
			result.errors.push_back(name + U(": não foi possível ler a imagem do TileSet."));
			return;
		}
		image->convert(Image::FORMAT_RGBA8);
		const Vector2i tile_size = tiles->get_tile_size();
		const Rect2i used = p_mapa->get_used_rect();
		const Vector2i size = Vector2i(used.get_end().x * tile_size.x, used.get_end().y * tile_size.y);
		if (size.x <= 0 || size.y <= 0) {
			result.warnings.push_back(name + U(": o mapa está vazio."));
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
				result.warnings.push_back(name + U(": tiles alternativos (girados ou espelhados) ainda não são exportados; saem sem a variação."));
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
			result.errors.push_back(vformat(U("%s: %d pixels do TileSet não têm cor na paleta do PNG."), name, missing));
			return;
		}
		Asset asset;
		asset.kind = "MAP";
		asset.symbol = symbol_for("map_", name);
		asset.texture = texture->get_path();
		asset.file = "gerado/" + asset.symbol + ".png";
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

	String resources() const {
		String res = String(GENERATED_MARK) + U(" a partir de ") + scene_path + U(". Não edite: o arquivo é refeito no build.\n");
		for (const Asset &asset : assets) {
			if (asset.kind == "IMAGE") {
				res += vformat("IMAGE %s \"%s\" BEST\n", asset.symbol, asset.file);
			} else if (asset.kind == "SPRITE") {
				res += vformat("SPRITE %s \"%s\" %d %d NONE %d\n", asset.symbol, asset.file, asset.frame_tiles_w, asset.frame_tiles_h, asset.speed);
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
		if (collision.is_empty()) {
			// Sem mapa sólido: o chão é a posição inicial.
			code += vformat(
					"\t\tjogador_x = clamp(jogador_x + dx, 0, %d);\n"
					"\t\tif (jogador_no_chao && (botoes & (BUTTON_A | BUTTON_B | BUTTON_C))) {\n"
					"\t\t\tjogador_vy16 = -%d;\n"
					"\t\t\tjogador_no_chao = FALSE;\n"
					"\t\t}\n"
					"\t\tif (!jogador_no_chao) {\n"
					"\t\t\tjogador_vy16 += %d;\n"
					"\t\t\tjogador_y16 += jogador_vy16;\n"
					"\t\t\tif (jogador_y16 >= JOGADOR_INICIO_Y * 16) {\n"
					"\t\t\t\tjogador_y16 = JOGADOR_INICIO_Y * 16;\n"
					"\t\t\t\tjogador_vy16 = 0;\n"
					"\t\t\t\tjogador_no_chao = TRUE;\n"
					"\t\t\t}\n"
					"\t\t}\n",
					MAX(world.x, RetroMD::SCREEN_WIDTH) - box.position.x - box.size.x, player->get_forca_pulo(), player->get_gravidade());
		} else {
			// Com mapa sólido: anda pixel a pixel até encostar num tile; cair do mapa volta ao início.
			code += vformat(
					"\t\tfor (s16 passo = abs(dx); passo > 0; passo--) {\n"
					"\t\t\tconst s16 nx = jogador_x + (dx > 0 ? 1 : -1);\n"
					"\t\t\tif (caixa_solida(nx + %d, (jogador_y16 >> 4) + %d, %d, %d)) {\n"
					"\t\t\t\tbreak;\n"
					"\t\t\t}\n"
					"\t\t\tjogador_x = nx;\n"
					"\t\t}\n"
					"\t\tjogador_no_chao = caixa_solida(jogador_x + %d, (jogador_y16 >> 4) + %d + 1, %d, %d);\n"
					"\t\tif (jogador_no_chao && (botoes & (BUTTON_A | BUTTON_B | BUTTON_C))) {\n"
					"\t\t\tjogador_vy16 = -%d;\n"
					"\t\t}\n"
					"\t\tjogador_vy16 = min(jogador_vy16 + %d, 8 * 16);\n"
					"\t\tconst s16 alvo = (jogador_y16 + jogador_vy16) >> 4;\n"
					"\t\ts16 y = jogador_y16 >> 4;\n"
					"\t\tbool bateu = FALSE;\n"
					"\t\twhile (y != alvo) {\n"
					"\t\t\tconst s16 ny = y + (alvo > y ? 1 : -1);\n"
					"\t\t\tif (caixa_solida(jogador_x + %d, ny + %d, %d, %d)) {\n"
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
					"\t\t\tjogador_reiniciar();\n"
					"\t\t}\n",
					box.position.x, box.position.y, box.size.x, box.size.y, box.position.x, box.position.y, box.size.x, box.size.y, player->get_forca_pulo(),
					player->get_gravidade(), box.position.x, box.position.y, box.size.x, box.size.y);
		}
		code += vformat("\t\tSPR_setAnim(%s, dx && jogador_no_chao ? 1 : 0);\n\t}\n", p_entry.variable);
		return code;
	}

	// Patrulha entre os limites; com mapa sólido, vira em paredes e na beira do chão. Encostar no
	// jogador (caixas sobrepostas) faz o jogador voltar ao início.
	String enemy_code(const SpriteEntry &p_entry) const {
		const MDInimigo *enemy = p_entry.enemy;
		const Rect2i box = enemy->get_caixa_efetiva();
		const String v = p_entry.prefix;
		const int y = p_entry.position.y;
		String code = vformat("static void %s_atualizar(void) {\n\tconst s16 nx = %s_x + %s_dir * %d;\n", v, v, v, enemy->get_velocidade());
		String blocked = vformat("nx < %d || nx > %d", p_entry.position.x, p_entry.position.x + enemy->get_distancia());
		if (!collision.is_empty() && enemy->get_vira_na_borda()) {
			// Parede na frente ou nenhum chão embaixo da ponta da frente.
			code += vformat("\tconst s16 frente = %s_dir > 0 ? nx + %d : nx + %d;\n", v, box.position.x + box.size.x - 1, box.position.x);
			blocked += vformat(" || caixa_solida(nx + %d, %d, %d, %d) || !solido(frente, %d)", box.position.x, y + box.position.y, box.size.x, box.size.y, y + box.position.y + box.size.y);
		}
		code += vformat("\tif (%s) {\n\t\t%s_dir = -%s_dir;\n\t} else {\n\t\t%s_x = nx;\n\t}\n\tSPR_setHFlip(%s, %s_dir < 0);\n", blocked, v, v, v, p_entry.variable, v);
		if (player) {
			const Rect2i pbox = player->get_caixa_efetiva();
			code += vformat("\tconst s16 jx = jogador_x + %d, jy = (jogador_y16 >> 4) + %d;\n"
							"\tconst s16 ix = %s_x + %d, iy = %d;\n"
							"\tif (jx < ix + %d && ix < jx + %d && jy < iy + %d && iy < jy + %d) {\n\t\tjogador_reiniciar();\n\t}\n",
					pbox.position.x, pbox.position.y, v, box.position.x, y + box.position.y, box.size.x, pbox.size.x, box.size.y, pbox.size.y);
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

	String source(const String &p_scene_name) const {
		String c = String(GENERATED_MARK) + U(" a partir de ") + scene_path + U(" (cena ") + p_scene_name + U("). Não edite: o arquivo é refeito no build.\n");
		c += "#include <genesis.h>\n\n#include \"cenas_gerado.h\"\n\n";
		for (const MapEntry &entry : maps) {
			c += vformat("static Map *%s; // %s\n", entry.variable, entry.node->get_name());
		}
		for (const SpriteEntry &entry : sprites) {
			c += vformat("static Sprite *%s; // %s\n", entry.variable, entry.node->get_name());
		}
		const bool scrolls = !maps.is_empty();
		if (scrolls) {
			c += vformat(U("\n// Câmera: canto superior esquerdo da tela no mundo (%d×%d).\n#define MUNDO_LARGURA %d\n#define MUNDO_ALTURA %d\nstatic s16 camera_x, camera_y;\n"), world.x, world.y, world.x, world.y);
		}
		if (player) {
			const SpriteEntry &entry = sprites[player_sprite];
			c += vformat(U("\n// Jogador (%s): posição e velocidade vertical em 1/16 de pixel.\n#define JOGADOR_INICIO_X %d\n#define JOGADOR_INICIO_Y %d\n"), player->get_name(), entry.position.x, entry.position.y);
			c += "static s16 jogador_x = JOGADOR_INICIO_X;\nstatic s16 jogador_y16 = JOGADOR_INICIO_Y * 16, jogador_vy16 = 0;\nstatic bool jogador_no_chao = TRUE;\n";
			c += U("\n// Volta ao início (caiu do mapa ou encostou num inimigo).\nstatic void jogador_reiniciar(void) {\n\tjogador_x = JOGADOR_INICIO_X;\n\tjogador_y16 = JOGADOR_INICIO_Y * 16;\n\tjogador_vy16 = 0;\n}\n");
		}
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				c += vformat(U("\n// Inimigo %s: patrulha de x = %d a %d.\nstatic s16 %s_x = %d, %s_dir = 1;\n"), entry.node->get_name(), entry.position.x, entry.position.x + entry.enemy->get_distancia(), entry.prefix,
						entry.position.x, entry.prefix);
			}
		}
		c += "\n";
		if (!collision.is_empty()) {
			c += collision_code();
		}
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
			c += "}\n\n";
		}
		c += "static void sprites_posicionar(void) {\n";
		const String camera_x = scrolls ? " - camera_x" : "", camera_y = scrolls ? " - camera_y" : "";
		for (int i = 0; i < sprites.size(); i++) {
			const SpriteEntry &entry = sprites[i];
			if (i == player_sprite) {
				c += vformat("\tSPR_setPosition(%s, jogador_x%s, (jogador_y16 >> 4)%s);\n", entry.variable, camera_x, camera_y);
			} else if (entry.enemy) {
				c += vformat("\tSPR_setPosition(%s, %s_x%s, %d%s);\n", entry.variable, entry.prefix, camera_x, entry.position.y, camera_y);
			} else {
				c += vformat("\tSPR_setPosition(%s, %d%s, %d%s);\n", entry.variable, entry.position.x, camera_x, entry.position.y, camera_y);
			}
		}
		c += "}\n\n";

		String palettes;
		for (int slot = 0; slot < 4; slot++) {
			if (palette_source[slot].is_empty()) {
				continue;
			}
			const bool image = palette_source[slot].begins_with("img_") || palette_source[slot].begins_with("spr_");
			palettes += vformat("\tPAL_setPalette(PAL%d, %s%s, DMA);\n", slot, palette_source[slot], image ? ".palette->data" : ".data");
		}
		c += "static void cena_iniciar(void) {\n\tVDP_setScreenWidth320();\n" + palettes + "\tu16 tile = TILE_USER_INDEX;\n" + draw_code;
		bool map_on_a = false;
		for (const MapEntry &entry : maps) {
			map_on_a = map_on_a || entry.node->get_plano() == MDFundo::PLANO_A;
		}
		if (map_on_a && !text_code.is_empty()) {
			// O mapa rola no plano A e apagaria os textos: eles vão para o plano window, fixo no topo.
			c += vformat(U("\t// Textos no plano window (linhas 0 a %d), que não rola com o mapa.\n\tVDP_setWindowVPos(FALSE, %d);\n\tVDP_setTextPlane(WINDOW);\n"), text_rows - 1, text_rows);
		}
		c += text_code;
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
			c += "\tsprites_posicionar();\n";
		}
		c += "}\n\nstatic void cena_atualizar(void) {\n";
		if (player) {
			c += player_code(sprites[player_sprite]);
		}
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				c += vformat("\t%s_atualizar();\n", entry.prefix);
			}
		}
		if (scrolls) {
			c += "\tcamera_atualizar();\n";
		}
		if (!sprites.is_empty()) {
			c += "\tsprites_posicionar();\n\tSPR_update();\n";
		}
		c += "}\n\nint main(bool hard) {\n\t(void)hard;\n\tcena_iniciar();\n\twhile (TRUE) {\n\t\tcena_atualizar();\n\t\tSYS_doVBlankProcess();\n\t}\n\treturn 0;\n}\n";
		return c;
	}
};

} // namespace

Result export_main_scene(const String &p_project_dir) {
	Exporter exporter;
	exporter.project_dir = p_project_dir;
	exporter.scene_path = GLOBAL_GET("application/run/main_scene");
	if (exporter.scene_path.is_empty()) {
		exporter.result.skipped = true;
		return exporter.result;
	}
	const Ref<PackedScene> scene = ResourceLoader::load(exporter.scene_path, "PackedScene");
	if (scene.is_null()) {
		exporter.result.errors.push_back(U("A cena principal não pôde ser carregada: ") + exporter.scene_path);
		return exporter.result;
	}
	Node *root = scene->instantiate();
	if (!Object::cast_to<MDCena>(root)) {
		// Projetos que não usam cenas do Mega Drive seguem só com o código escrito à mão.
		exporter.result.skipped = true;
		if (root) {
			memdelete(root);
		}
		return exporter.result;
	}
	exporter.visit(root, root);
	if (exporter.sprites.size() > RetroMD::MAX_SPRITES) {
		exporter.result.errors.push_back(vformat(U("A cena tem %d sprites; o console mostra no máximo %d."), exporter.sprites.size(), RetroMD::MAX_SPRITES));
	}
	const String scene_name = root->get_name();
	String c;
	if (exporter.result.errors.is_empty()) {
		c = exporter.source(scene_name); // Usa os nodes, que ainda existem.
	}
	memdelete(root);
	if (!exporter.result.errors.is_empty()) {
		return exporter.result;
	}
	exporter.write("res/cenas_gerado.res", exporter.resources());
	exporter.write("src/gerado/cenas.c", c);
	return exporter.result;
}

} // namespace RetroSgdkExport
