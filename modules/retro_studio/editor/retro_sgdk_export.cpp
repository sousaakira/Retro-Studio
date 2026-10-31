#include "retro_sgdk_export.h"

#include "retro_image_convert.h"

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
#include "scene/animation/animation_player.h"
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

const int FREE_VRAM_TILES = RetroMD::VRAM_FREE_TILES;

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
	int hframes = 1, vframes = 1; // Quadros por linha e linhas da folha.
	// Personagem do gestor de animações: tempos por animação, quais não repetem e onde ficam os pés.
	String timers;
	Vector<bool> loops;
	PackedStringArray anim_names; // Animações exportadas, na ordem das linhas do atlas.
	int anchor_x = 0, cell_w = 0;
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
	String name;
	String variable;
	String symbol; // map_<nome>: base dos recursos (ts_, pal_, map_).
	String texture; // Imagem do TileSet.
	int asset = -1;
	Vector2i size; // Pixels pintados (múltiplos de 8).
	Vector2i padded; // Tamanho da imagem do MAP (blocos de 128 px).
	Vector<uint8_t> indices; // Índices de cor por pixel, na imagem de tamanho padded.
	Vector<Color> palette;
	int tiles = 0; // Tiles distintos do mapa inteiro (repetidos e espelhados contam uma vez).
	bool streaming = false; // Carrega aos poucos, só a janela perto da câmera.
	int patterns = 0; // Streaming: padrões de 8×8 distintos.
	int slots = 0; // Streaming: vagas na VRAM (o pior caso de padrões numa janela).
};

struct ExitEntry {
	Rect2i area;
	int scene = -1;
};

// Uma trilha da animação, amostrada a 60 quadros por segundo.
struct AnimationTrack {
	int sprite = -1; // Índice em sprites.
	String kind; // "x", "y", "quadro" ou "visivel".
	Vector<int> values;
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
	bool uses_streaming = false; // Alguma cena carrega mapas aos poucos (o jogo.c leva o streaming).
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
	AnimationPlayer *animation_player = nullptr;
	String animation_name;
	int animation_frames = 0;
	bool animation_loop = false;
	int animation_end_scene = -1; // Cena aberta quando a animação termina.
	Vector<AnimationTrack> animation_tracks;
	Vector<BlinkingText> blinking;
	int start_scene = -1; // Cena aberta pelo START.
	int music = -1; // Asset XGM da cena.
	int background_tiles = 0;
	int image_tiles = 0; // Tiles dos MDFundo (os mapas entram em finish_maps).
	int sprite_tiles = 0;
	HashSet<String> sprite_names;

	void reset_scene() {
		sprite_names.clear();
		image_tiles = 0;
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
		animation_player = nullptr;
		animation_name = String();
		animation_frames = 0;
		animation_loop = false;
		animation_end_scene = -1;
		animation_tracks.clear();
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
		asset.hframes = MAX(1, p_node->get_hframes());
		asset.vframes = MAX(1, p_node->get_vframes());
		if (p_kind == "IMAGE") {
			Ref<Image> pixels = MDPersonagem::load_sheet(path);
			if (pixels.is_valid()) {
				pixels->convert(Image::FORMAT_RGBA8);
				asset.tiles = RetroMD::unique_tiles(pixels);
			}
		}
		assets.push_back(asset);
		asset_by_key[key] = assets.size() - 1;
		return assets.size() - 1;
	}

	// Personagem do gestor de animações: o atlas (uma animação por linha, células alinhadas pelos pés)
	// vira um PNG indexado de até 15 cores, e o SPRITE leva o tempo de cada quadro.
	// Linha do atlas exportado de uma animação do personagem (fallback se ela não foi exportada).
	int exported_index(const SpriteEntry &p_entry, const String &p_name, int p_fallback) const {
		const int found = assets[p_entry.asset].anim_names.find(p_name);
		return found >= 0 ? found : p_fallback;
	}

	int asset_for_personagem(MDSprite *p_sprite) {
		const Ref<MDPersonagem> personagem = p_sprite->get_personagem();
		const Vector<int> used = p_sprite->get_used_animations(); // A prévia do editor usa as mesmas.
		String key = "PERSONAGEM|" + personagem->get_path();
		for (int a : used) {
			key += "|" + itos(a);
		}
		if (asset_by_key.has(key)) {
			return asset_by_key[key];
		}
		const String name = p_sprite->get_name();
		String problem = personagem->get_load_error();
		const Ref<Image> atlas = problem.is_empty() ? personagem->build_atlas(&problem, used) : Ref<Image>();
		const MDPersonagem::Celula cell = personagem->get_cell(used);
		if (problem.is_empty() && (cell.size.x > 248 || cell.size.y > 248)) {
			problem = vformat(U("a célula do personagem (%d×%d) passa de 248×248."), cell.size.x, cell.size.y);
		}
		if (!problem.is_empty()) {
			result.errors.push_back(scene_label + name + ": " + problem);
			return -1;
		}
		Vector<uint8_t> indices;
		Vector<Color> palette;
		const int colors = RetroImageConvert::quantize(atlas, indices, palette);
		if (colors > 15) {
			result.warnings.push_back(scene_label + vformat(U("%s: o personagem tem %d cores; a paleta foi reduzida para 15."), name, colors));
		}
		Asset asset;
		asset.kind = "SPRITE";
		asset.symbol = symbol_for("spr_", personagem->get_path().get_file().get_basename().get_basename());
		asset.file = "gerado/" + asset.symbol + ".png";
		write_bytes("res/" + asset.file, indexed_png(atlas->get_width(), atlas->get_height(), indices, palette));
		asset.texture = "res://res/" + asset.file;
		asset.frame_tiles_w = cell.size.x / 8;
		asset.frame_tiles_h = cell.size.y / 8;
		asset.hframes = personagem->get_max_frames(used);
		asset.vframes = used.size();
		asset.timers = personagem->get_timers(used);
		for (int a : used) {
			asset.loops.push_back(personagem->get_animations()[a].loop);
			asset.anim_names.push_back(personagem->get_animations()[a].name);
		}
		asset.anchor_x = cell.anchor.x;
		asset.cell_w = cell.size.x;
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
				image_tiles += asset.tiles;
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
		} else if (MDColisao *colisao = Object::cast_to<MDColisao>(p_node)) {
			if (check(p_node, colisao->get_configuration_warnings())) {
				add_collision_layer(colisao);
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
				entry.asset = sprite->get_personagem().is_valid() ? asset_for_personagem(sprite) : asset_for("SPRITE", sprite, sprite->get_velocidade_animacao());
				if (entry.asset < 0) {
					return;
				}
				// O motor reserva o maior quadro, sem os tiles vazios que o rescomp corta.
				sprite_tiles += RetroMD::sprite_vram_tiles(assets[entry.asset].texture, assets[entry.asset].hframes, assets[entry.asset].vframes);
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
		} else if (AnimationPlayer *animation = Object::cast_to<AnimationPlayer>(p_node)) {
			if (animation_player) {
				result.warnings.push_back(scene_label + name + U(": só o primeiro AnimationPlayer da cena vai para o jogo."));
			} else {
				animation_player = animation;
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

	// A grade de colisão cresce para caber células x células de 8×8.
	void grow_collision(const Vector2i &p_cells) {
		if (collision.is_empty()) {
			collision_cells = p_cells;
			collision.resize(int64_t(p_cells.x) * p_cells.y);
			memset(collision.ptrw(), 0, collision.size());
		} else if (p_cells.x > collision_cells.x || p_cells.y > collision_cells.y) {
			Vector<uint8_t> grown;
			const Vector2i bigger(MAX(p_cells.x, collision_cells.x), MAX(p_cells.y, collision_cells.y));
			grown.resize(int64_t(bigger.x) * bigger.y);
			memset(grown.ptrw(), 0, grown.size());
			for (int y = 0; y < collision_cells.y; y++) {
				memcpy(grown.ptrw() + y * bigger.x, collision.ptr() + y * collision_cells.x, collision_cells.x);
			}
			collision = grown;
			collision_cells = bigger;
		}
	}

	// MDColisao: cada célula pintada marca as células de 8×8 que ela cobre.
	void add_collision_layer(MDColisao *p_layer) {
		const Vector2i tile_size = p_layer->get_tile_set()->get_tile_size();
		const Rect2i used = p_layer->get_used_rect();
		if (used.size.x <= 0 || used.size.y <= 0) {
			return;
		}
		grow_collision(Vector2i(used.get_end().x * tile_size.x / 8, used.get_end().y * tile_size.y / 8));
		for (const Vector2i cell : p_layer->get_used_cells()) {
			for (int y = 0; y < tile_size.y / 8; y++) {
				for (int x = 0; x < tile_size.x / 8; x++) {
					collision.write[int64_t(cell.y * tile_size.y / 8 + y) * collision_cells.x + cell.x * tile_size.x / 8 + x] = p_layer->get_tipo(cell);
				}
			}
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
		Ref<Image> image = MDPersonagem::load_sheet(texture->get_path());
		if (image.is_null()) {
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
			grow_collision(cells); // Com dois mapas sólidos (ou uma MDColisao), a colisão cobre o maior.
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
		// Os recursos e o código do mapa saem em finish_maps, que decide se a cena precisa de streaming.
		MapEntry entry;
		entry.node = p_mapa;
		entry.name = name;
		entry.variable = vformat("mapa_%d", maps.size());
		entry.symbol = symbol_for("map_", name);
		entry.texture = texture->get_path();
		entry.size = Vector2i(cells.x * 8, cells.y * 8);
		entry.padded = padded;
		entry.indices = indices;
		entry.palette = palette;
		entry.tiles = count_unique_tiles(padded.x, padded.y, [&](int x, int y) { return uint32_t(indices[int64_t(y) * padded.x + x]); });
		use_palette(p_mapa->get_paleta(), "pal_" + entry.symbol.substr(4), entry.texture, name);
		draw_code += vformat("@@MAPA_%d@@", maps.size()); // Trocado pelo código do mapa em finish_maps.
		maps.push_back(entry);
		world.x = MAX(world.x, entry.size.x);
		world.y = MAX(world.y, entry.size.y);
	}

	// Janela de células carregada no streaming: a tela (40×28) mais uma coluna e uma linha de folga; cabe
	// no plano de 64×32, que dá a volta.
	static const int STREAM_COLUMNS = 42;
	static const int STREAM_ROWS = 30;

	// Padrões de 8×8 do mapa sem repetição (o espelhado de um conta como ele) e, por célula, 0 (vazia) ou
	// padrão + 1 com os bits 12 (espelho horizontal) e 13 (vertical). Devolve o pior caso de padrões
	// diferentes numa janela de streaming.
	int build_stream(const MapEntry &p_map, Vector<uint8_t> &r_patterns, Vector<uint16_t> &r_cells) {
		const Vector2i cells(p_map.size.x / 8, p_map.size.y / 8);
		HashMap<String, int> pattern_of;
		Vector<int> ids;
		ids.resize(cells.x * cells.y);
		r_cells.resize(cells.x * cells.y);
		uint8_t tile[64], variant[64], packed[32];
		for (int cy = 0; cy < cells.y; cy++) {
			for (int cx = 0; cx < cells.x; cx++) {
				bool empty = true;
				for (int i = 0; i < 64; i++) {
					tile[i] = p_map.indices[int64_t(cy * 8 + (i >> 3)) * p_map.padded.x + cx * 8 + (i & 7)];
					empty = empty && !tile[i];
				}
				const int cell = cy * cells.x + cx;
				ids.write[cell] = -1;
				r_cells.write[cell] = 0;
				if (empty) {
					continue;
				}
				int found = -1, flips = 0;
				for (int flip = 0; flip < 4 && found < 0; flip++) {
					for (int i = 0; i < 64; i++) {
						const int x = flip & 1 ? 7 - (i & 7) : i & 7, y = flip & 2 ? 7 - (i >> 3) : i >> 3;
						variant[i] = tile[y * 8 + x];
					}
					for (int i = 0; i < 32; i++) {
						packed[i] = variant[i * 2] << 4 | variant[i * 2 + 1];
					}
					const String key = String::hex_encode_buffer(packed, 32);
					if (pattern_of.has(key)) {
						found = pattern_of[key];
						flips = flip;
					}
				}
				if (found < 0) {
					for (int i = 0; i < 32; i++) {
						packed[i] = tile[i * 2] << 4 | tile[i * 2 + 1];
					}
					found = pattern_of.size();
					pattern_of[String::hex_encode_buffer(packed, 32)] = found;
					for (int i = 0; i < 32; i++) {
						r_patterns.push_back(packed[i]);
					}
				}
				ids.write[cell] = found;
				r_cells.write[cell] = uint16_t((found + 1) | (flips & 1 ? 0x1000 : 0) | (flips & 2 ? 0x2000 : 0));
			}
		}
		// Pior caso: desliza a janela pelo mapa contando os padrões distintos dentro dela.
		const int window_w = MIN(STREAM_COLUMNS, cells.x), window_h = MIN(STREAM_ROWS, cells.y);
		Vector<int> uses;
		uses.resize(pattern_of.size());
		int peak = 0;
		for (int top = 0; top + window_h <= cells.y; top++) {
			memset(uses.ptrw(), 0, uses.size() * sizeof(int));
			int distinct = 0;
			auto column = [&](int p_x, int p_delta) {
				for (int y = top; y < top + window_h; y++) {
					const int id = ids[y * cells.x + p_x];
					if (id < 0) {
						continue;
					}
					if (p_delta > 0 && uses.write[id]++ == 0) {
						distinct++;
					} else if (p_delta < 0 && --uses.write[id] == 0) {
						distinct--;
					}
				}
			};
			for (int x = 0; x < window_w; x++) {
				column(x, 1);
			}
			peak = MAX(peak, distinct);
			for (int left = 1; left + window_w <= cells.x; left++) {
				column(left - 1, -1);
				column(left + window_w - 1, 1);
				peak = MAX(peak, distinct);
			}
		}
		return peak;
	}

	// Decide como cada mapa vai para a VRAM: inteiro (TILESET + MAP do SGDK) quando tudo cabe, ou por
	// streaming quando os fundos e mapas da cena passam do limite.
	void finish_maps() {
		int map_tiles = 0;
		for (const MapEntry &entry : maps) {
			map_tiles += entry.tiles;
		}
		const bool stream = image_tiles + map_tiles > FREE_VRAM_TILES - sprite_tiles;
		background_tiles = image_tiles;
		for (int i = 0; i < maps.size(); i++) {
			MapEntry &entry = maps.write[i];
			const String base = entry.symbol.substr(4);
			const String plane = entry.node->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B";
			String code;
			if (!stream) {
				Asset asset;
				asset.kind = "MAP";
				asset.symbol = entry.symbol;
				asset.texture = entry.texture;
				asset.file = "gerado/" + asset.symbol + ".png";
				asset.tiles = entry.tiles;
				write_bytes("res/" + asset.file, indexed_png(entry.padded.x, entry.padded.y, entry.indices, entry.palette));
				assets.push_back(asset);
				entry.asset = assets.size() - 1;
				background_tiles += entry.tiles;
				code = vformat("\t// %s\n\tVDP_loadTileSet(&ts_%s, tile, DMA);\n\t%s = MAP_create(&%s, %s, TILE_ATTR_FULL(PAL%d, FALSE, FALSE, FALSE, tile));\n\ttile += ts_%s.numTile;\n",
						entry.name, base, entry.variable, entry.symbol, plane, entry.node->get_paleta(), base);
			} else {
				Vector<uint8_t> patterns;
				Vector<uint16_t> cells;
				entry.slots = build_stream(entry, patterns, cells);
				entry.patterns = patterns.size() / 32;
				entry.streaming = true;
				if (entry.patterns > 4095) {
					result.errors.push_back(scene_label + entry.name + vformat(U(": %d padrões de 8×8 diferentes; o streaming guarda até 4095 por mapa."), entry.patterns));
				}
				// No 68000 os dados ficam em big-endian.
				Vector<uint8_t> cell_bytes;
				cell_bytes.resize(cells.size() * 2);
				for (int c = 0; c < cells.size(); c++) {
					cell_bytes.write[c * 2] = cells[c] >> 8;
					cell_bytes.write[c * 2 + 1] = cells[c] & 255;
				}
				for (const String &kind : { String("padroes"), String("celulas") }) {
					Asset asset;
					asset.kind = "BIN";
					asset.symbol = entry.symbol + "_" + kind;
					asset.file = "gerado/" + asset.symbol + ".bin";
					write_bytes("res/" + asset.file, kind == "padroes" ? patterns : cell_bytes);
					assets.push_back(asset);
				}
				// A paleta sai de um PNG pequeno com as cores do mapa.
				Asset palette;
				palette.kind = "PALETTE";
				palette.symbol = "pal_" + base;
				palette.file = "gerado/" + palette.symbol + ".png";
				Vector<uint8_t> blank;
				blank.resize(64);
				memset(blank.ptrw(), 0, 64);
				write_bytes("res/" + palette.file, indexed_png(8, 8, blank, entry.palette));
				assets.push_back(palette);
				background_tiles += entry.slots;
				uses_streaming = true;
				code = vformat(U("\t// %s (streaming: %d padrões, até %d na tela)\n\tstream_preparar(&%s, tile);\n\ttile += %d;\n"), entry.name, entry.patterns, entry.slots, entry.variable, entry.slots);
			}
			draw_code = draw_code.replace(vformat("@@MAPA_%d@@", i), code);
		}
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

	// A animação em autoplay do AnimationPlayer vira tabelas, um valor por quadro (60 por segundo), das
	// trilhas de position, frame e visible de MDSprites comuns.
	void bake_animation(Node *p_root) {
		if (!animation_player) {
			return;
		}
		const String player_name = animation_player->get_name();
		animation_name = animation_player->get_autoplay();
		if (animation_name.is_empty() || !animation_player->has_animation(animation_name)) {
			result.warnings.push_back(scene_label + player_name + U(": escolha uma animação em Autoplay on Load; só ela vai para o jogo."));
			return;
		}
		const Ref<Animation> animation = animation_player->get_animation(animation_name);
		animation_loop = animation->get_loop_mode() != Animation::LOOP_NONE;
		animation_frames = CLAMP(int(Math::ceil(animation->get_length() * 60)), 1, 60 * 60);
		if (animation->get_length() * 60 > 60 * 60) {
			result.warnings.push_back(scene_label + player_name + U(": a animação passa de 60 segundos; só o primeiro minuto vai para o jogo."));
		}
		Node *base = animation_player->get_node_or_null(animation_player->get_root_node());
		for (int t = 0; t < animation->get_track_count(); t++) {
			if (!animation->track_is_enabled(t)) {
				continue;
			}
			const NodePath path = animation->track_get_path(t);
			const String property = path.get_concatenated_subnames();
			Node *target = base ? base->get_node_or_null(NodePath(path.get_concatenated_names())) : nullptr;
			int sprite = -1;
			for (int i = 0; i < sprites.size(); i++) {
				if (sprites[i].node == target) {
					sprite = i;
				}
			}
			const bool supported = animation->track_get_type(t) == Animation::TYPE_VALUE && (property == "position" || property == "frame" || property == "visible");
			if (sprite < 0 || !supported) {
				result.warnings.push_back(scene_label + vformat(U("%s: a trilha %s não vai para o jogo (só position, frame e visible de MDSprites)."), player_name, String(path)));
				continue;
			}
			const SpriteEntry &entry = sprites[sprite];
			if (entry.enemy || entry.item || entry.platform || sprite == player_sprite) {
				result.warnings.push_back(scene_label + vformat(U("%s: %s já se move sozinho no jogo; a trilha %s é ignorada."), player_name, target->get_name(), String(path)));
				continue;
			}
			// A posição animada é relativa ao pai; no jogo, conta a partir da raiz da cena.
			const Vector2 offset = scene_position(target->get_parent(), p_root);
			Vector<AnimationTrack> baked;
			if (property == "position") {
				baked.resize(2);
				baked.write[0].kind = "x";
				baked.write[1].kind = "y";
			} else {
				baked.resize(1);
				baked.write[0].kind = property == "frame" ? "quadro" : "visivel";
			}
			for (int i = 0; i < animation_frames; i++) {
				const Variant value = animation->value_track_interpolate(t, i / 60.0);
				if (property == "position") {
					const Vector2 position = Vector2(value) + offset;
					baked.write[0].values.push_back(int(Math::round(position.x)));
					baked.write[1].values.push_back(int(Math::round(position.y)));
				} else if (property == "frame") {
					baked.write[0].values.push_back(int(Math::round(double(value))));
				} else {
					baked.write[0].values.push_back(bool(value) ? 1 : 0);
				}
			}
			for (AnimationTrack &track : baked) {
				track.sprite = sprite;
				animation_tracks.push_back(track);
			}
		}
	}

	String animation_code() const {
		if (animation_tracks.is_empty()) {
			return String();
		}
		String c = vformat(U("// Animação \"%s\" do AnimationPlayer (%d quadros, %s), um valor por quadro.\n#define ANIMACAO_QUADROS %d\nstatic u16 animacao_quadro;\n"),
				animation_name, animation_frames, animation_loop ? U("repete") : U("toca uma vez"), animation_frames);
		for (int i = 0; i < animation_tracks.size(); i++) {
			const AnimationTrack &track = animation_tracks[i];
			bool constant = true;
			for (int value : track.values) {
				constant = constant && value == track.values[0];
			}
			if (constant) {
				continue; // Valor fixo: vai direto em animacao_aplicar.
			}
			c += vformat("static const %s animacao_%d_%s[ANIMACAO_QUADROS] = {", track.kind == "x" || track.kind == "y" ? "s16" : "u8", i, track.kind);
			for (int f = 0; f < track.values.size(); f++) {
				c += (f % 20 == 0 ? "\n\t" : " ") + itos(track.values[f]) + ",";
			}
			c += "\n};\n";
		}
		const bool scrolls = !maps.is_empty();
		auto value_of = [&](int p_track) {
			const AnimationTrack &track = animation_tracks[p_track];
			for (int value : track.values) {
				if (value != track.values[0]) {
					return vformat("animacao_%d_%s[animacao_quadro]", p_track, track.kind);
				}
			}
			return itos(track.values[0]);
		};
		c += "\nstatic void animacao_aplicar(void) {\n";
		for (int i = 0; i < animation_tracks.size(); i++) {
			const AnimationTrack &track = animation_tracks[i];
			const SpriteEntry &entry = sprites[track.sprite];
			if (track.kind == "x") {
				// A trilha "y" vem logo depois da "x" do mesmo position.
				c += vformat("\tSPR_setPosition(%s, %s%s, %s%s);\n", entry.variable, value_of(i), scrolls ? " - camera_x" : "", value_of(i + 1), scrolls ? " - camera_y" : "");
			} else if (track.kind == "quadro") {
				const int columns = MAX(1, entry.node->get_hframes());
				c += vformat("\tSPR_setAnimAndFrame(%s, %s / %d, %s %% %d);\n", entry.variable, value_of(i), columns, value_of(i), columns);
			} else if (track.kind == "visivel") {
				c += vformat("\tSPR_setVisibility(%s, %s ? AUTO_FAST : HIDDEN);\n", entry.variable, value_of(i));
			}
		}
		c += "}\n\nstatic void animacao_avancar(void) {\n\tif (animacao_quadro + 1 < ANIMACAO_QUADROS) {\n\t\tanimacao_quadro++;\n\t}";
		if (animation_loop) {
			c += " else {\n\t\tanimacao_quadro = 0;\n\t}";
		} else if (animation_end_scene >= 0) {
			c += vformat(" else {\n\t\tjogo_trocar_cena(%s); // Fim da animação.\n\t}", scene_constant(animation_end_scene));
		}
		c += "\n}\n\n";
		return c;
	}

	bool scene_streams() const {
		for (const MapEntry &entry : maps) {
			if (entry.streaming) {
				return true;
			}
		}
		return false;
	}

	bool has_tile_type(int p_type) const {
		for (int i = 0; i < collision.size(); i++) {
			if (collision[i] == p_type) {
				return true;
			}
		}
		return false;
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
		if (!has_platforms()) {
			return String();
		}
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
				if (asset.timers.is_empty()) {
					res += vformat("SPRITE %s \"%s\" %d %d NONE %d\n", asset.symbol, asset.file, asset.frame_tiles_w, asset.frame_tiles_h, asset.speed);
				} else {
					res += vformat("SPRITE %s \"%s\" %d %d NONE %s NONE\n", asset.symbol, asset.file, asset.frame_tiles_w, asset.frame_tiles_h, asset.timers);
				}
			} else if (asset.kind == "XGM") {
				res += vformat("XGM %s \"%s\"\n", asset.symbol, asset.file);
			} else if (asset.kind == "WAV") {
				res += vformat("WAV %s \"%s\" XGM\n", asset.symbol, asset.file);
			} else if (asset.kind == "BIN") {
				res += vformat("BIN %s \"%s\" 2\n", asset.symbol, asset.file); // Alinhado em 2 para ler como u16/u32.
			} else if (asset.kind == "PALETTE") {
				res += vformat("PALETTE %s \"%s\"\n", asset.symbol, asset.file);
			} else {
				const String base = asset.symbol.substr(4);
				res += vformat("TILESET ts_%s \"%s\" BEST ALL\nMAP %s \"%s\" ts_%s BEST 0\nPALETTE pal_%s \"%s\"\n", base, asset.file, asset.symbol, asset.file, base, base, asset.file);
			}
		}
		return res;
	}

	// Deslocamento do sprite espelhado de um personagem, para os pés ficarem no mesmo lugar (0 = nenhum).
	int flip_shift(const SpriteEntry &p_entry) const {
		const Asset &asset = assets[p_entry.asset];
		return asset.timers.is_empty() ? 0 : 2 * asset.anchor_x - asset.cell_w;
	}

	// Animação do jogador conforme o estado. Sem personagem: linha 0 parado, linha 1 andando. Com
	// personagem: as animações escolhidas para parado, andando, pulando e caindo (só troca quando muda).
	String player_animation(const SpriteEntry &p_entry, const String &p_moving, const String &p_air) const {
		if (player->get_personagem().is_null()) {
			return vformat("\t\tSPR_setAnim(%s, %s ? 1 : 0);\n", p_entry.variable, p_moving);
		}
		auto index = [&](const String &p_name, int p_fallback) {
			return exported_index(p_entry, p_name, p_fallback);
		};
		const int still = index(player->get_anim_parado(), 0);
		const int moving = index(player->get_anim_andando(), still);
		const int falling = index(player->get_anim_caindo(), still);
		const int jumping = index(player->get_anim_pulando(), falling);
		String state = vformat("%s ? %d : %d", p_moving, moving, still);
		if (!p_air.is_empty()) {
			state = vformat("%s ? (jogador_vy16 < 0 ? %d : %d) : (%s)", p_air, jumping, falling, state);
		}
		return vformat("\t\t{\n\t\t\tconst u16 animacao = %s;\n\t\t\tif (animacao != jogador_animacao) {\n\t\t\t\tjogador_animacao = animacao;\n\t\t\t\tSPR_setAnim(%s, animacao);\n\t\t\t}\n\t\t}\n", state, p_entry.variable);
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
				"\t\t\tSPR_setHFlip(%s, TRUE);%s\n"
				"\t\t} else if (botoes & BUTTON_RIGHT) {\n"
				"\t\t\tdx = %d;\n"
				"\t\t\tSPR_setHFlip(%s, FALSE);%s\n"
				"\t\t}\n",
				speed, p_entry.variable, flip_shift(p_entry) ? "\n\t\t\tjogador_virado = TRUE;" : "", speed, p_entry.variable, flip_shift(p_entry) ? "\n\t\t\tjogador_virado = FALSE;" : "");
		if (player->get_modo() == MDJogador::MODO_VISTO_DE_CIMA) {
			// Visto de cima: 4 direções, sem gravidade; com mapa sólido, anda pixel a pixel em cada eixo.
			code += vformat("\t\ts16 dy = 0;\n\t\tif (botoes & BUTTON_UP) {\n\t\t\tdy = -%d;\n\t\t} else if (botoes & BUTTON_DOWN) {\n\t\t\tdy = %d;\n\t\t}\n", speed, speed);
			if (collision.is_empty()) {
				code += vformat("\t\tjogador_x = clamp(jogador_x + dx, 0, %d);\n\t\tjogador_y16 = clamp((jogador_y16 >> 4) + dy, 0, %d) << 4;\n",
						MAX(world.x, RetroMD::SCREEN_WIDTH) - box.position.x - box.size.x, MAX(world.y, RetroMD::SCREEN_HEIGHT) - box.position.y - box.size.y);
			} else {
				const String here = vformat("jogador_x + %d, (jogador_y16 >> 4) + %d, %d, %d", box.position.x, box.position.y, box.size.x, box.size.y);
				if (has_tile_type(MDColisao::TIPO_AGUA)) {
					code += "\t\tif (caixa_tem(" + here + ", AGUA)) {\n\t\t\tdx /= 2;\n\t\t\tdy /= 2;\n\t\t}\n";
				}
				if (has_tile_type(MDColisao::TIPO_ESPINHO)) {
					code += "\t\tif (caixa_tem(" + here + ", ESPINHO)) {\n\t\t\tjogador_morrer();\n\t\t}\n";
				}
				code += vformat("\t\tfor (s16 passo = abs(dx); passo > 0; passo--) {\n\t\t\tconst s16 nx = jogador_x + (dx > 0 ? 1 : -1);\n\t\t\tif (caixa_solida(nx + %d, (jogador_y16 >> 4) + %d, %d, %d)) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tjogador_x = nx;\n\t\t}\n"
								"\t\tfor (s16 passo = abs(dy); passo > 0; passo--) {\n\t\t\tconst s16 ny = (jogador_y16 >> 4) + (dy > 0 ? 1 : -1);\n\t\t\tif (ny < 0 || ny + %d > MAPA_ALTURA || caixa_solida(jogador_x + %d, ny + %d, %d, %d)) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tjogador_y16 = ny << 4;\n\t\t}\n",
						box.position.x, box.position.y, box.size.x, box.size.y, box.position.y + box.size.y, box.position.x, box.position.y, box.size.x, box.size.y);
			}
			code += "\t\tjogador_botoes_antes = botoes;\n" + player_animation(p_entry, "dx || dy", "") + "\t}\n";
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
			// o topo de uma plataforma ou de um tile atravessável também segura; espinho custa uma vida; na
			// água, anda e cai devagar e pode nadar para cima.
			const bool platforms = has_platforms();
			const bool oneway = has_tile_type(MDColisao::TIPO_ATRAVESSAVEL);
			const bool water = has_tile_type(MDColisao::TIPO_AGUA);
			const String bx = itos(box.position.x), by = itos(box.position.y), bw = itos(box.size.x), bh = itos(box.size.y);
			const String feet = itos(box.position.y + box.size.y);
			const String here = "jogador_x + " + bx + ", (jogador_y16 >> 4) + " + by + ", " + bw + ", " + bh;
			String ground = "caixa_solida(jogador_x + " + bx + ", (jogador_y16 >> 4) + " + by + " + 1, " + bw + ", " + bh + ")";
			String landing;
			if (platforms) {
				ground += " || jogador_em_plataforma()";
				landing += vformat(" || (ny > y && plataforma_embaixo(ny + %d))", box.position.y + box.size.y - 1);
			}
			if (oneway) {
				ground += " || (!jogador_descendo && atravessavel_na_linha(jogador_x + " + bx + ", (jogador_y16 >> 4) + " + feet + ", " + bw + "))";
				landing += " || (ny > y && !jogador_descendo && atravessavel_na_linha(jogador_x + " + bx + ", ny + " + feet + " - 1, " + bw + "))";
			}
			if (water) {
				code += "\t\tconst bool na_agua = caixa_tem(" + here + ", AGUA);\n\t\tif (na_agua && (dx > 1 || dx < -1)) {\n\t\t\tdx /= 2;\n\t\t}\n";
			}
			code += "\t\tfor (s16 passo = abs(dx); passo > 0; passo--) {\n\t\t\tconst s16 nx = jogador_x + (dx > 0 ? 1 : -1);\n"
					"\t\t\tif (caixa_solida(nx + " + bx + ", (jogador_y16 >> 4) + " + by + ", " + bw + ", " + bh + ")) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tjogador_x = nx;\n\t\t}\n";
			code += "\t\tjogador_no_chao = " + ground + ";\n";
			if (oneway) {
				code += U("\t\tif (jogador_descendo) {\n\t\t\tjogador_descendo--;\n"
						  "\t\t} else if (jogador_no_chao && (botoes & BUTTON_DOWN) && !caixa_solida(jogador_x + ") + bx + ", (jogador_y16 >> 4) + " + by + " + 1, " + bw + ", " + bh + ")" + (platforms ? String(" && !jogador_em_plataforma()") : String()) +
						U(") {\n\t\t\t// Em pé num tile atravessável: ↓ desce.\n\t\t\tjogador_descendo = 12;\n\t\t\tjogador_no_chao = FALSE;\n\t\t}\n");
			}
			const int jump = player->get_forca_pulo(), gravity = player->get_gravidade();
			code += String(water ? "\t\tif ((jogador_no_chao || na_agua) && (botoes & ~jogador_botoes_antes & PULO)) {\n" : "\t\tif (jogador_no_chao && (botoes & ~jogador_botoes_antes & PULO)) {\n") + jump_sound +
					(water ? vformat("\t\t\tjogador_vy16 = na_agua ? -%d : -%d;\n\t\t}\n", MAX(1, jump / 2), jump) : vformat("\t\t\tjogador_vy16 = -%d;\n\t\t}\n", jump));
			code += "\t\tif (!(botoes & PULO) && jogador_vy16 < -PULO_CURTO) {\n\t\t\tjogador_vy16 = -PULO_CURTO;\n\t\t}\n";
			code += water ? vformat("\t\tjogador_vy16 = na_agua ? min(jogador_vy16 + %d, 2 * 16) : min(jogador_vy16 + %d, 8 * 16);\n", MAX(1, gravity / 4), gravity)
						  : vformat("\t\tjogador_vy16 = min(jogador_vy16 + %d, 8 * 16);\n", gravity);
			code += "\t\tconst s16 alvo = (jogador_y16 + jogador_vy16) >> 4;\n\t\ts16 y = jogador_y16 >> 4;\n\t\tbool bateu = FALSE;\n"
					"\t\twhile (y != alvo) {\n\t\t\tconst s16 ny = y + (alvo > y ? 1 : -1);\n"
					"\t\t\tif (caixa_solida(jogador_x + " + bx + ", ny + " + by + ", " + bw + ", " + bh + ")" + landing + ") {\n\t\t\t\tbateu = TRUE;\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\ty = ny;\n\t\t}\n"
					"\t\tif (bateu) {\n\t\t\tjogador_y16 = y << 4;\n\t\t\tjogador_vy16 = 0;\n\t\t} else {\n\t\t\tjogador_y16 += jogador_vy16;\n\t\t}\n";
			if (has_tile_type(MDColisao::TIPO_ESPINHO)) {
				code += "\t\tif (caixa_tem(" + here + ", ESPINHO)) {\n\t\t\tjogador_morrer();\n\t\t}\n";
			}
			code += "\t\tif ((jogador_y16 >> 4) > MAPA_ALTURA) {\n\t\t\tjogador_morrer();\n\t\t}\n";
		}
		code += "\t\tjogador_botoes_antes = botoes;\n" + player_animation(p_entry, "dx && jogador_no_chao", "!jogador_no_chao") + "\t}\n";
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
				blocked += vformat(" || !%s(frente, %d)", needs_floor_helper() ? "chao" : "solido", y + box.position.y + box.size.y);
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

	// Inimigos que viram na beira do chão: com tiles atravessáveis, o topo deles também é chão.
	bool needs_floor_helper() const {
		if (top_down() || !has_tile_type(MDColisao::TIPO_ATRAVESSAVEL)) {
			return false;
		}
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy && entry.enemy->get_vira_na_borda()) {
				return true;
			}
		}
		return false;
	}

	String collision_code() const {
		const bool oneway = has_tile_type(MDColisao::TIPO_ATRAVESSAVEL) && player && !top_down();
		const bool spikes = has_tile_type(MDColisao::TIPO_ESPINHO) && player;
		const bool water = has_tile_type(MDColisao::TIPO_AGUA) && player;
		String code = vformat(U("// Colisão: uma célula de 8×8 por byte (0 vazio, 1 sólido, 2 atravessável, 3 espinho, 4 água).\n#define MAPA_LARGURA %d\n#define MAPA_ALTURA %d\n"), collision_cells.x * 8, collision_cells.y * 8);
		code += String(oneway || needs_floor_helper() ? "#define ATRAVESSAVEL 2\n" : "") + (spikes ? "#define ESPINHO 3\n" : "") + (water ? "#define AGUA 4\n" : "");
		code += vformat("static const u8 mapa_colisao[%d] = {", collision.size());
		for (int i = 0; i < collision.size(); i++) {
			code += (i % 64 == 0 ? "\n\t" : "") + itos(collision[i]) + ",";
		}
		code += vformat(U("\n};\n\nstatic u8 celula(s16 x, s16 y) {\n"
						  "\tif (x < 0 || x >= MAPA_LARGURA) {\n\t\treturn 1; // As laterais do mapa são paredes.\n\t}\n"
						  "\tif (y < 0 || y >= MAPA_ALTURA) {\n\t\treturn 0;\n\t}\n"
						  "\treturn mapa_colisao[(y >> 3) * %d + (x >> 3)];\n}\n\n"
						  "static bool solido(s16 x, s16 y) {\n\treturn celula(x, y) == 1;\n}\n\n"),
				collision_cells.x);
		if (needs_floor_helper()) {
			code += "static bool chao(s16 x, s16 y) {\n\tconst u8 tipo = celula(x, y);\n\treturn tipo == 1 || tipo == ATRAVESSAVEL;\n}\n\n";
		}
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
		if (spikes || water) {
			code += U("// Algum ponto da caixa (cantos e a cada 8 pixels) está numa célula desse tipo?\n");
			code += "static bool caixa_tem(s16 x, s16 y, s16 w, s16 h, u8 tipo) {\n"
					"\tfor (s16 cy = y;; cy += 8) {\n"
					"\t\tif (cy > y + h - 1) {\n\t\t\tcy = y + h - 1;\n\t\t}\n"
					"\t\tfor (s16 cx = x;; cx += 8) {\n"
					"\t\t\tif (cx > x + w - 1) {\n\t\t\t\tcx = x + w - 1;\n\t\t\t}\n"
					"\t\t\tif (celula(cx, cy) == tipo) {\n\t\t\t\treturn TRUE;\n\t\t\t}\n"
					"\t\t\tif (cx == x + w - 1) {\n\t\t\t\tbreak;\n\t\t\t}\n"
					"\t\t}\n"
					"\t\tif (cy == y + h - 1) {\n\t\t\tbreak;\n\t\t}\n"
					"\t}\n\treturn FALSE;\n}\n\n";
		}
		if (oneway) {
			code += U("// A linha (o topo de uma célula) tem um tile atravessável sob a largura dada?\n");
			code += "static bool atravessavel_na_linha(s16 x, s16 linha, s16 w) {\n"
					"\tif (linha & 7) {\n\t\treturn FALSE;\n\t}\n"
					"\tfor (s16 cx = x;; cx += 8) {\n"
					"\t\tif (cx > x + w - 1) {\n\t\t\tcx = x + w - 1;\n\t\t}\n"
					"\t\tif (celula(cx, linha) == ATRAVESSAVEL) {\n\t\t\treturn TRUE;\n\t\t}\n"
					"\t\tif (cx == x + w - 1) {\n\t\t\tbreak;\n\t\t}\n"
					"\t}\n\treturn FALSE;\n}\n\n";
		}
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
			if (entry.streaming) {
				// Estado do streaming: usos e vaga na VRAM de cada padrão, e as vagas livres.
				c += vformat("static u8 %s_usos[%d];\nstatic u16 %s_vaga[%d];\nstatic u16 %s_livres[%d];\n", entry.variable, entry.patterns, entry.variable, entry.patterns, entry.variable, MAX(1, entry.slots));
				c += vformat("static MapaStream %s = { %s, TILE_ATTR(PAL%d, FALSE, FALSE, FALSE), 0, %d, %d, (const u16 *)%s_celulas, (const u32 *)%s_padroes, %s_usos, %s_vaga, %s_livres, 0, %d, %d, 0, 0 }; // %s\n",
						entry.variable, entry.node->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B", entry.node->get_paleta(), entry.size.x / 8, entry.size.y / 8, entry.symbol, entry.symbol,
						entry.variable, entry.variable, entry.variable, entry.slots, entry.patterns, entry.node->get_name());
			} else {
				c += vformat("static Map *%s; // %s\n", entry.variable, entry.node->get_name());
			}
		}
		for (const SpriteEntry &entry : sprites) {
			c += vformat("Sprite *%s; // %s\n", entry.variable, entry.node->get_name());
		}
		const bool scrolls = !maps.is_empty();
		const bool enemies = has_enemies();
		// Visto de cima não há queda; espinhos matam nos dois modos.
		const bool can_die = player && (enemies || (!collision.is_empty() && !top_down()) || has_tile_type(MDColisao::TIPO_ESPINHO));
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
			if (player->get_personagem().is_valid()) {
				c += U("static u16 jogador_animacao; // Animação tocando agora.\n");
				if (flip_shift(sprites[player_sprite])) {
					c += U("static bool jogador_virado; // Olhando para a esquerda (o desenho espelha em volta dos pés).\n");
				}
			}
			if (!collision.is_empty() && !top_down() && has_tile_type(MDColisao::TIPO_ATRAVESSAVEL)) {
				c += U("static u8 jogador_descendo; // Quadros atravessando um tile atravessável (↓).\n");
			}
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
				if (entry.streaming) {
					c += vformat("\tstream_mover(&%s, camera_x, camera_y);\n\tVDP_setHorizontalScroll(%s, -camera_x);\n\tVDP_setVerticalScroll(%s, camera_y);\n", entry.variable, entry.node->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B", entry.node->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B");
				} else {
					c += vformat("\tMAP_scrollTo(%s, camera_x, camera_y);\n", entry.variable);
				}
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
					const String shift = flip_shift(entry) ? vformat(" + (jogador_virado ? %d : 0)", flip_shift(entry)) : String();
					c += vformat("\tSPR_setPosition(%s, jogador_x%s%s, (jogador_y16 >> 4)%s);\n", entry.variable, shift, camera_x, camera_y);
				} else if (entry.enemy) {
					const String shift = flip_shift(entry) ? vformat(" + (%s_dir < 0 ? %d : 0)", entry.prefix, flip_shift(entry)) : String();
					c += vformat("\tSPR_setPosition(%s, %s_x%s%s, %d%s);\n", entry.variable, entry.prefix, shift, camera_x, entry.position.y, camera_y);
				} else if (entry.platform) {
					c += vformat("\tSPR_setPosition(%s, %s_x%s, %s_y%s);\n", entry.variable, entry.prefix, camera_x, entry.prefix, camera_y);
				} else {
					c += vformat("\tSPR_setPosition(%s, %d%s, %d%s);\n", entry.variable, entry.position.x, camera_x, entry.position.y, camera_y);
				}
			}
			c += "}\n\n";
		}

		c += animation_code();
		HashSet<int> stop_callbacks;
		for (const SpriteEntry &entry : sprites) {
			const Asset &asset = assets[entry.asset];
			if (asset.timers.is_empty() || !asset.loops.has(false) || stop_callbacks.has(entry.asset)) {
				continue;
			}
			stop_callbacks.insert(entry.asset);
			c += vformat(U("// Animações de %s que não repetem param no último quadro (timer 0 congela o quadro).\nstatic void %s_quadro_mudou(Sprite *sprite) {\n\tswitch (sprite->animInd) {\n"), asset.symbol, asset.symbol);
			for (int a = 0; a < asset.loops.size(); a++) {
				if (!asset.loops[a]) {
					c += vformat("\t\tcase %d:\n", a);
				}
			}
			c += "\t\t\tif (sprite->frameInd == sprite->animation->numFrame - 1) {\n\t\t\t\tsprite->timer = 0;\n\t\t\t}\n\t\t\tbreak;\n\t}\n}\n\n";
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
			if (player->get_personagem().is_valid()) {
				c += vformat("\tjogador_animacao = %d;\n", exported_index(sprites[player_sprite], sprites[player_sprite].node->get_animacao(), 0));
				if (flip_shift(sprites[player_sprite])) {
					c += "\tjogador_virado = FALSE;\n";
				}
			}
			if (!collision.is_empty() && !top_down() && has_tile_type(MDColisao::TIPO_ATRAVESSAVEL)) {
				c += "\tjogador_descendo = 0;\n";
			}
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
			// Os sprites ficam com o que precisam; o resto da VRAM é dos fundos e mapas.
			c += vformat("\tSPR_initEx(%d);\n", MAX(1, sprite_tiles));
			for (const SpriteEntry &entry : sprites) {
				const Asset &asset = assets[entry.asset];
				c += vformat("\t%s = SPR_addSprite(&%s, 0, 0, TILE_ATTR(PAL%d, %s, FALSE, FALSE));\n", entry.variable, asset.symbol, entry.node->get_paleta(), entry.node->get_prioridade() ? "TRUE" : "FALSE");
				// O SPR_addSprite deixa o sprite sempre visível; fora da tela a coordenada dá a volta.
				c += vformat("\tSPR_setVisibility(%s, AUTO_FAST);\n", entry.variable);
				if (!asset.timers.is_empty()) {
					const int start = exported_index(entry, entry.node->get_animacao(), 0);
					if (start > 0) {
						c += vformat("\tSPR_setAnim(%s, %d);\n", entry.variable, start);
					}
					if (asset.loops.has(false)) {
						c += vformat("\t%s->onFrameChange = %s_quadro_mudou;\n", entry.variable, asset.symbol);
					}
				} else if (entry.node->get_frame() > 0) {
					c += vformat("\tSPR_setAnimAndFrame(%s, %d, %d);\n", entry.variable, entry.node->get_frame() / MAX(1, entry.node->get_hframes()), entry.node->get_frame() % MAX(1, entry.node->get_hframes()));
				}
				if (entry.node->is_flipped_h()) {
					c += vformat("\tSPR_setHFlip(%s, TRUE);\n", entry.variable);
				}
			}
			c += "\tsprites_posicionar();\n";
			if (!animation_tracks.is_empty()) {
				c += "\tanimacao_quadro = 0;\n\tanimacao_aplicar();\n";
			}
			c += "\tif (" + ident + "_iniciar) {\n\t\t" + ident + "_iniciar();\n\t}\n\tSPR_update();\n";
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
			c += "\tsprites_posicionar();\n";
			if (!animation_tracks.is_empty()) {
				c += "\tanimacao_avancar();\n\tanimacao_aplicar();\n";
			}
			c += "\tif (" + ident + "_atualizar) {\n\t\t" + ident + "_atualizar();\n\t}\n\tSPR_update();\n";
		} else {
			c += "\tif (" + ident + "_atualizar) {\n\t\t" + ident + "_atualizar();\n\t}\n";
		}
		c += "}\n\n";

		// Fim: devolve a memória dos mapas e dos sprites; o jogo.c limpa os planos.
		c += "void cena_" + ident + "_encerrar(void) {\n";
		for (const MapEntry &entry : maps) {
			if (!entry.streaming) {
				c += vformat("\tMAP_release(%s);\n\t%s = NULL;\n", entry.variable, entry.variable);
			}
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
		if (uses_streaming) {
			h += U("\n// Mapa carregado aos poucos: só os padrões de 8×8 da janela perto da câmera ficam na VRAM.\n"
				   "typedef struct {\n"
				   "\tVDPPlane plano;\n\tu16 atributos; // Paleta e prioridade (TILE_ATTR).\n\tu16 base; // Primeiro tile da VRAM do mapa.\n"
				   "\tu16 largura, altura; // Em células de 8×8.\n"
				   "\tconst u16 *celulas; // 0 (vazia) ou padrão + 1, bit 12 espelho horizontal, bit 13 vertical.\n"
				   "\tconst u32 *padroes; // 8 palavras por padrão.\n"
				   "\tu8 *usos; // Células da janela que usam cada padrão.\n\tu16 *vaga; // Tile (a partir de base) de cada padrão carregado.\n"
				   "\tu16 *livres;\n\tu16 n_livres, n_vagas, n_padroes;\n\ts16 coluna, linha; // Canto da janela carregada.\n"
				   "} MapaStream;\n\n"
				   "void stream_preparar(MapaStream *mapa, u16 base);\n"
				   "void stream_mover(MapaStream *mapa, s16 camera_x, s16 camera_y);\n");
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

	// Streaming de mapas: a janela de 42×30 células em volta da câmera fica no plano (64×32, dando a
	// volta); cada padrão usado nela ocupa uma vaga na VRAM enquanto alguma célula o usa.
	String stream_runtime() const {
		String c = vformat("#define JANELA_COLUNAS %d\n#define JANELA_LINHAS %d\n#define FORA_DA_JANELA (-32768)\n\n", STREAM_COLUMNS, STREAM_ROWS);
		c += U("static void stream_carregar(MapaStream *m, s16 x, s16 y) {\n"
			   "\tu16 tile = 0;\n"
			   "\tif (x >= 0 && y >= 0 && x < m->largura && y < m->altura) {\n"
			   "\t\tconst u16 celula = m->celulas[y * m->largura + x];\n"
			   "\t\tif (celula) {\n"
			   "\t\t\tconst u16 padrao = (celula & 0x0FFF) - 1;\n"
			   "\t\t\tif (!m->usos[padrao]) {\n"
			   "\t\t\t\tif (!m->n_livres) {\n\t\t\t\t\treturn; // Sem vaga (o build garante que não acontece).\n\t\t\t\t}\n"
			   "\t\t\t\tm->vaga[padrao] = m->livres[--m->n_livres];\n"
			   "\t\t\t\tVDP_loadTileData(m->padroes + padrao * 8, m->base + m->vaga[padrao], 1, DMA);\n"
			   "\t\t\t}\n"
			   "\t\t\tm->usos[padrao]++;\n"
			   "\t\t\ttile = m->atributos | (m->base + m->vaga[padrao]) | (celula & 0x1000 ? TILE_ATTR_HFLIP_MASK : 0) | (celula & 0x2000 ? TILE_ATTR_VFLIP_MASK : 0);\n"
			   "\t\t}\n"
			   "\t}\n"
			   "\tVDP_setTileMapXY(m->plano, tile, x & 63, y & 31);\n"
			   "}\n\n"
			   "static void stream_soltar(MapaStream *m, s16 x, s16 y) {\n"
			   "\tif (x < 0 || y < 0 || x >= m->largura || y >= m->altura) {\n\t\treturn;\n\t}\n"
			   "\tconst u16 celula = m->celulas[y * m->largura + x];\n"
			   "\tif (!celula) {\n\t\treturn;\n\t}\n"
			   "\tconst u16 padrao = (celula & 0x0FFF) - 1;\n"
			   "\tif (m->usos[padrao] && !--m->usos[padrao]) {\n\t\tm->livres[m->n_livres++] = m->vaga[padrao];\n\t}\n"
			   "}\n\n"
			   "void stream_preparar(MapaStream *m, u16 base) {\n"
			   "\tm->base = base;\n\tm->coluna = m->linha = FORA_DA_JANELA;\n"
			   "}\n\n"
			   "// Esvazia a janela e carrega a de novo, inteira (início da cena ou salto grande da câmera).\n"
			   "static void stream_recarregar(MapaStream *m, s16 coluna, s16 linha) {\n"
			   "\tmemset(m->usos, 0, m->n_padroes);\n"
			   "\tm->n_livres = m->n_vagas;\n"
			   "\tfor (u16 i = 0; i < m->n_vagas; i++) {\n\t\tm->livres[i] = m->n_vagas - 1 - i;\n\t}\n"
			   "\tm->coluna = coluna;\n\tm->linha = linha;\n"
			   "\tfor (s16 y = linha; y < linha + JANELA_LINHAS; y++) {\n"
			   "\t\tfor (s16 x = coluna; x < coluna + JANELA_COLUNAS; x++) {\n\t\t\tstream_carregar(m, x, y);\n\t\t}\n"
			   "\t}\n"
			   "}\n\n"
			   "// A câmera andou: solta a coluna ou linha que saiu da janela e carrega a que entrou, uma por vez.\n"
			   "void stream_mover(MapaStream *m, s16 camera_x, s16 camera_y) {\n"
			   "\tconst s16 coluna = camera_x >> 3, linha = camera_y >> 3;\n"
			   "\tif (m->coluna == FORA_DA_JANELA || abs(coluna - m->coluna) >= JANELA_COLUNAS || abs(linha - m->linha) >= JANELA_LINHAS) {\n"
			   "\t\tstream_recarregar(m, coluna, linha);\n\t\treturn;\n\t}\n"
			   "\twhile (m->coluna < coluna) {\n"
			   "\t\tfor (s16 y = m->linha; y < m->linha + JANELA_LINHAS; y++) {\n\t\t\tstream_soltar(m, m->coluna, y);\n\t\t}\n"
			   "\t\tfor (s16 y = m->linha; y < m->linha + JANELA_LINHAS; y++) {\n\t\t\tstream_carregar(m, m->coluna + JANELA_COLUNAS, y);\n\t\t}\n"
			   "\t\tm->coluna++;\n\t}\n"
			   "\twhile (m->coluna > coluna) {\n"
			   "\t\tfor (s16 y = m->linha; y < m->linha + JANELA_LINHAS; y++) {\n\t\t\tstream_soltar(m, m->coluna + JANELA_COLUNAS - 1, y);\n\t\t}\n"
			   "\t\tm->coluna--;\n"
			   "\t\tfor (s16 y = m->linha; y < m->linha + JANELA_LINHAS; y++) {\n\t\t\tstream_carregar(m, m->coluna, y);\n\t\t}\n"
			   "\t}\n"
			   "\twhile (m->linha < linha) {\n"
			   "\t\tfor (s16 x = m->coluna; x < m->coluna + JANELA_COLUNAS; x++) {\n\t\t\tstream_soltar(m, x, m->linha);\n\t\t}\n"
			   "\t\tfor (s16 x = m->coluna; x < m->coluna + JANELA_COLUNAS; x++) {\n\t\t\tstream_carregar(m, x, m->linha + JANELA_LINHAS);\n\t\t}\n"
			   "\t\tm->linha++;\n\t}\n"
			   "\twhile (m->linha > linha) {\n"
			   "\t\tfor (s16 x = m->coluna; x < m->coluna + JANELA_COLUNAS; x++) {\n\t\t\tstream_soltar(m, x, m->linha + JANELA_LINHAS - 1);\n\t\t}\n"
			   "\t\tm->linha--;\n"
			   "\t\tfor (s16 x = m->coluna; x < m->coluna + JANELA_COLUNAS; x++) {\n\t\t\tstream_carregar(m, x, m->linha);\n\t\t}\n"
			   "\t}\n"
			   "}\n\n");
		return c;
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
		if (uses_streaming) {
			c += stream_runtime();
		}
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
		if (!cena->get_ao_fim_da_animacao().is_empty()) {
			exporter.animation_end_scene = exporter.scene_for(cena->get_ao_fim_da_animacao());
		}
		exporter.visit(root, root);
		exporter.finish_maps();
		exporter.bake_animation(root);
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
		if (exporter.background_tiles + exporter.sprite_tiles > FREE_VRAM_TILES) {
			exporter.result.errors.push_back(exporter.scene_label + vformat(U("fundos e mapas (%d tiles%s) e sprites (%d tiles) passam dos %d tiles livres na VRAM. Simplifique as imagens, repita mais tiles ou use sprites menores."),
																			exporter.background_tiles, exporter.scene_streams() ? U(", com streaming") : String(), exporter.sprite_tiles, FREE_VRAM_TILES));
		}
		exporter.result.info.push_back(vformat(U("%s: VRAM %d/%d tiles (%d%%): fundos e mapas %d%s, sprites %d; %d/%d sprites."), path.get_file(), exporter.background_tiles + exporter.sprite_tiles, FREE_VRAM_TILES,
				(exporter.background_tiles + exporter.sprite_tiles) * 100 / FREE_VRAM_TILES, exporter.background_tiles, exporter.scene_streams() ? U(" com streaming") : String(), exporter.sprite_tiles,
				exporter.sprites.size(), RetroMD::MAX_SPRITES));
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
