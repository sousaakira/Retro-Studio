#include "retro_sgdk_export.h"

#include "core/io/resource_uid.h"

#include "retro_image_convert.h"
#include "retro_runtime.gen.h"

#include "../scene/md_letreiro.h"
#include "../scene/md_nota.h"
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
#include "scene/resources/image_texture.h"
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
// TILE_FONT_INDEX do SGDK 1.81 com a VRAM padrão (0xC000 / 32 − 96); lá ele não é constante de compilação.
const int FONT_TILE_INDEX = 0xC000 / 32 - 96;

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
	String timers; // Não vazio = personagem do gestor de animações.
	Vector<Vector<int>> frame_ticks; // Tempo de cada quadro (1/60 s), por animação exportada.
	Vector<bool> loops;
	Vector<PackedStringArray> frame_sounds; // Som de cada quadro (vazio = nenhum), por animação exportada.
	bool has_frame_sounds = false;
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
	Vector<Vector2i> path; // MDTrajeto filho: posição a cada quadro (no mundo), na velocidade do node.
	bool path_loop = false; // Dá a volta (ciclo) em vez de ir e voltar.
};

// Pontos a cada p_step px ao longo da linha (ida; com ciclo, inclui a volta ao primeiro ponto).
static Vector<Vector2i> sample_path(const PackedVector2Array &p_points, int p_step, bool p_loop, const Vector2i &p_origin) {
	Vector<Vector2i> out;
	PackedVector2Array points = p_points;
	if (p_loop && points.size() > 1) {
		points.push_back(points[0]);
	}
	if (points.size() < 2) {
		return out;
	}
	const float step = MAX(1, p_step);
	float wanted = 0; // Distância do próximo ponto da tabela.
	float walked = 0; // Distância até o começo do segmento.
	for (int i = 0; i + 1 < points.size(); i++) {
		const Vector2 a = points[i], b = points[i + 1];
		const float length = a.distance_to(b);
		while (length > 0 && wanted <= walked + length) {
			const Vector2 p = a.lerp(b, (wanted - walked) / length);
			out.push_back(p_origin + Vector2i(Math::round(p.x), Math::round(p.y)));
			wanted += step;
			if (out.size() >= 4000) {
				return out;
			}
		}
		walked += length;
	}
	if (!p_loop) {
		const Vector2 end = points[points.size() - 1];
		const Vector2i last = p_origin + Vector2i(Math::round(end.x), Math::round(end.y));
		if (out.is_empty() || out[out.size() - 1] != last) {
			out.push_back(last);
		}
	}
	return out;
}

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
	// Correnteza (MDCorrenteza): colunas a mais carregadas à direita só nas linhas de água que corre.
	int margin = 0;
	int margin_y0 = 0, margin_y1 = 0; // Linhas (de células) com a margem.
	int base = 0; // Streaming: primeiro tile da VRAM das vagas do mapa (fixo no build).
	int scroll_x = 100, scroll_y = 100; // Parallax: % do movimento da câmera.
};

struct ExitEntry {
	Rect2i area;
	int scene = -1;
};

// Caixa de diálogo (MDDialogo): páginas já quebradas em linhas e codificadas com as letras da cena.
struct DialogEntry {
	MDDialogo *node = nullptr;
	String name; // Nome do node.
	String define; // DIALOGO_<NOME>
	Rect2i area;
	Vector<Vector<uint8_t>> pages;
	Vector<String> page_texts; // O texto de cada página (comentário no código gerado).
	Vector<Vector<uint8_t>> options;
	int next = -1;
	int portrait = -1; // Asset IMAGE do retrato.
	int portrait_cols = 0;
};

// Uma trilha da animação, amostrada a 60 quadros por segundo.
struct AnimationTrack {
	int sprite = -1; // Índice em sprites.
	String kind; // "x", "y", "quadro", "visivel", "anim" (animação do personagem) ou "espelho".
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

// Valor do jogo escrito por um MDTexto (HUD montado na cena).
struct HudText {
	MDTexto::Valor valor = MDTexto::VALOR_NENHUM;
	Vector2i tile; // Onde o valor começa (logo depois do texto).
	int digits = 0;
	String symbol;
	String node_name;
};

// Ator (MDAtor): sprite comandado pelo código C do node.
struct ActorEntry {
	MDAtor *node = nullptr;
	String type; // Variável do AtorTipo na cena.
	String prefix; // Funções do código (<prefixo>_pronto e _quadro); vazio sem código.
	Vector2i feet; // Posição no mundo (os pés, com personagem).
	Vector2i anchor; // Pés dentro da célula.
	Rect2i body; // Caixa do corpo relativa aos pés.
	int asset = -1;
	int groups = 0;
	int duracao = 0; // Décimos de segundo até sumir sozinho (MDLetreiro); 0 = fica.
};

// Texto por cima do jogo (MDLetreiro): vira um ator fixo na tela no fim da cena, quando as paletas já são conhecidas.
struct LetreiroEntry {
	MDLetreiro *node = nullptr;
	Vector2i position;
};

// Código de ator: o personagem que dá nome às animações (ANIM_...) do cabeçalho dele.
struct ScriptInfo {
	String path;
	int asset = -1;
	PackedStringArray anim_names; // Código sem node (asset -1): os ANIM_ que ele cita.
};

// Água que corre ou ondula (MDCorrenteza).
struct WaterEntry {
	String name;
	int plane = 0; // 0 = BG B, 1 = BG A.
	int y0 = 0, y1 = 0; // Linhas do mundo (px), y1 exclusivo.
	bool flowing = true;
	int speed = 40, period = 40, amplitude = 2, steps = 8;
	bool right = false;
	bool own_scroll = false; // Parallax próprio da faixa (nuvens), em % da câmera.
	int scroll = 100;
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
	Vector<ActorEntry> actors;
	int camera_actor = -1;
	Vector<WaterEntry> waters;
	HashSet<Vector2i> priority_cells[2]; // MDPrioridade: células (no mundo) com prioridade, por plano (0 = B, 1 = A). // Ator com camera_segue (sem MDJogador, a câmera e as saídas são dele).
	// Do jogo todo: grupos dos atores (GRUPO_<NOME>, um bit cada) e os códigos usados.
	HashMap<String, int> group_bits;
	HashMap<String, int> custom_types; // Tipos de colisão com nome próprio (CELULA_<NOME>).
	HashMap<String, ScriptInfo> scripts;
	bool uses_actors = false;
	// Tipos que o código cria durante o jogo (TIPO_<NOME> = <nome>.tscn com um MDAtor na raiz).
	Vector<ActorEntry> templates;
	Vector<Node *> template_roots;
	int template_tiles = 0; // VRAM que os tipos podem ocupar (somada às cenas com atores).
	~Exporter() {
		for (Node *root : template_roots) {
			memdelete(root);
		}
	}
	// Colisão: uma célula de 8×8 por byte, de todos os mapas sólidos.
	Vector2i collision_cells;
	Vector<uint8_t> collision;
	Vector2i world; // Tamanho do mundo em pixels (o maior mapa, ou a tela).
	Vector<ExitEntry> exits;
	Vector<DialogEntry> dialogs;
	Vector<char32_t> dialog_letters; // Letra de cada código (código = índice + 2).
	PackedInt32Array dialog_tiles; // 8 palavras por tile: moldura e letras.
	int dialog_vram = 0; // Tiles reservados (moldura, letras e o maior retrato).
	int dialog_portrait_tiles = 0;
	int dialog_rows = 8;
	bool uses_dialogs = false;
	// Menu pronto (MDMenu): um por cena.
	MDMenu *menu = nullptr;
	Vector2i menu_tile; // Título: canto do menu em tiles.
	int menu_scene = -1; // Cena do Começar.
	Vector<char32_t> menu_letters;
	PackedInt32Array menu_tiles;
	Vector<Vector<uint8_t>> menu_texts; // MT_TOTAL textos codificados.
	Vector<int> menu_items; // Ações (MENU_*).
	int menu_vram = 0;
	int menu_width = 0;
	int menu_rows = 0; // Linhas da maior tela (com as vazias entre elas).
	bool uses_menu = false;
	Vector<CheckpointEntry> checkpoints;
	Vector<ParallaxEntry> parallaxes; // Fundos que rolam com a câmera.
	AnimationPlayer *animation_player = nullptr;
	String animation_name;
	int animation_frames = 0;
	bool animation_loop = false;
	int animation_end_scene = -1; // Cena aberta quando a animação termina.
	Vector<AnimationTrack> animation_tracks;
	Vector<BlinkingText> blinking;
	Vector<HudText> hud_texts;
	MDCamera *camera = nullptr; // A primeira MDCamera da cena.
	Vector<Rect2i> camera_zones;
	int start_scene = -1; // Cena aberta pelo START.
	bool save_on_enter = false; // MDCena.salvar_ao_entrar: grava o progresso ao entrar.
	bool shadow_mode = false; // MDCena.luz_e_sombra.
	Vector<MDCicloCores *> color_cycles;
	int music = -1; // Asset XGM da cena.
	int background_tiles = 0;
	int image_tiles = 0; // Tiles dos MDFundo (os mapas entram em finish_maps).
	int sprite_tiles = 0;
	HashSet<String> sprite_names;
	Vector<LetreiroEntry> letreiros;

	void reset_scene() {
		sprite_names.clear();
		letreiros.clear();
		image_tiles = 0;
		for (int i = 0; i < 4; i++) {
			palette_source[i] = String();
			palette_texture[i] = String();
		}
		draw_code = String();
		text_code = String();
		text_rows = 0;
		hud_texts.clear();
		camera = nullptr;
		camera_zones.clear();
		sprites.clear();
		maps.clear();
		player = nullptr;
		player_sprite = -1;
		actors.clear();
		camera_actor = -1;
		priority_cells[0].clear();
		priority_cells[1].clear();
		waters.clear();
		collision_cells = Vector2i();
		collision.clear();
		world = Vector2i();
		exits.clear();
		dialogs.clear();
		dialog_letters.clear();
		dialog_tiles.clear();
		dialog_vram = 0;
		dialog_portrait_tiles = 0;
		dialog_rows = 8;
		menu = nullptr;
		menu_tile = Vector2i();
		menu_scene = -1;
		menu_letters.clear();
		menu_tiles.clear();
		menu_texts.clear();
		menu_items.clear();
		menu_vram = 0;
		menu_width = 0;
		menu_rows = 0;
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
		save_on_enter = false;
		shadow_mode = false;
		color_cycles.clear();
		music = -1;
		background_tiles = 0;
		sprite_tiles = 0;
	}

	// Índice da cena (a primeira vez, entra na fila de exportação).
	int scene_for(const String &p_scene) {
		const String p_path = ResourceUID::ensure_path(p_scene); // Um destino guardado como uid:// vira o caminho.
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
		String key = "PERSONAGEM|" + personagem->get_path() + "|" + p_sprite->get_paleta_de();
		for (int a : used) {
			key += "|" + itos(a);
		}
		if (asset_by_key.has(key)) {
			return asset_by_key[key];
		}
		const String name = p_sprite->get_name();
		String problem = personagem->get_load_error();
		if (problem.is_empty() && used.is_empty()) {
			problem = U("o personagem ainda não tem animações.");
		}
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
		const Vector<Color> reference = p_sprite->get_paleta_de().is_empty() ? Vector<Color>() : RetroMD::png_palette(p_sprite->get_paleta_de());
		int colors = 0;
		if (!reference.is_empty()) {
			// Paleta de outro PNG, na ordem dele: cada cor vai para a mais próxima (a 0 é a transparência).
			palette = reference;
			palette.resize(16);
			indices.resize(atlas->get_width() * atlas->get_height());
			HashMap<uint32_t, uint8_t> nearest;
			for (int y = 0; y < atlas->get_height(); y++) {
				for (int x = 0; x < atlas->get_width(); x++) {
					const Color pixel = atlas->get_pixel(x, y);
					uint8_t index = 0;
					if (pixel.a >= 0.5) {
						const uint32_t rgb = pixel.to_argb32() & 0xFFFFFF;
						if (nearest.has(rgb)) {
							index = nearest[rgb];
						} else {
							float best = 1e9;
							for (int i = 1; i < MIN(16, reference.size()); i++) {
								const Color c = reference[i];
								const float d = (c.r - pixel.r) * (c.r - pixel.r) + (c.g - pixel.g) * (c.g - pixel.g) + (c.b - pixel.b) * (c.b - pixel.b);
								if (d < best) {
									best = d;
									index = i;
								}
							}
							nearest[rgb] = index;
						}
					}
					indices.write[y * atlas->get_width() + x] = index;
				}
			}
		} else {
			colors = RetroImageConvert::quantize(atlas, indices, palette);
		}
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
			Vector<int> ticks;
			PackedStringArray frame_sounds;
			for (const MDPersonagem::Quadro &q : personagem->get_animations()[a].frames) {
				ticks.push_back(q.ticks);
				frame_sounds.push_back(q.sound);
				if (!q.sound.is_empty()) {
					sound_for("WAV", q.sound);
					asset.has_frame_sounds = true;
				}
			}
			asset.frame_ticks.push_back(ticks);
			asset.frame_sounds.push_back(frame_sounds);
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
		if (Object::cast_to<MDNota>(p_node)) {
			return; // Nota para a IA: só existe no editor (nem ela nem os filhos vão para o jogo).
		}
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
		} else if (MDCorrenteza *agua = Object::cast_to<MDCorrenteza>(p_node)) {
			if (check(p_node, agua->get_configuration_warnings())) {
				WaterEntry water;
				water.name = name;
				water.plane = agua->get_plano() == MDFundo::PLANO_A ? 1 : 0;
				water.y0 = MAX(0, position.y);
				water.y1 = position.y + agua->get_tamanho().y;
				water.flowing = agua->get_modo() == MDCorrenteza::MODO_CORRENTEZA;
				water.speed = agua->get_velocidade();
				water.period = agua->get_periodo();
				water.amplitude = agua->get_amplitude();
				water.steps = agua->get_passos_por_segundo();
				water.right = agua->get_direcao() == MDCorrenteza::DIRECAO_DIREITA;
				water.own_scroll = water.flowing && agua->is_rolagem_propria();
				water.scroll = agua->get_rolagem();
				if (water.flowing && STREAM_COLUMNS + (water.period + 7) / 8 > 64) {
					result.errors.push_back(scene_label + name + vformat(U(": o período de %d px não cabe no plano (a tela mais a volta passam de 64 colunas); use até 184 px."), water.period));
				}
				waters.push_back(water);
			}
		} else if (MDPrioridade *prioridade = Object::cast_to<MDPrioridade>(p_node)) {
			const int plane = prioridade->get_plano() == MDFundo::PLANO_A ? 1 : 0;
			for (const Vector2i &cell : prioridade->get_used_cells()) {
				priority_cells[plane].insert(position / 8 + cell);
			}
		} else if (MDColisao *colisao = Object::cast_to<MDColisao>(p_node)) {
			if (check(p_node, colisao->get_configuration_warnings())) {
				add_collision_layer(colisao);
			}
		} else if (MDMapa *mapa = Object::cast_to<MDMapa>(p_node)) {
			if (check(p_node, mapa->get_configuration_warnings())) {
				add_map(mapa);
			}
		} else if (MDAtor *ator = Object::cast_to<MDAtor>(p_node)) {
			if (check(p_node, ator->get_configuration_warnings())) {
				add_actor(ator, position);
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
				// Com personagem, o node fica nos pés; o SGDK posiciona pelo canto da célula.
				entry.position = position - sprite->get_apoio();
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
				if (entry.enemy || entry.platform) {
					for (int k = 0; k < sprite->get_child_count(); k++) {
						MDTrajeto *trajeto = Object::cast_to<MDTrajeto>(sprite->get_child(k));
						if (!trajeto) {
							continue;
						}
						check(trajeto, trajeto->get_configuration_warnings());
						const int speed = entry.enemy ? entry.enemy->get_velocidade() : entry.platform->get_velocidade();
						entry.path_loop = trajeto->get_ciclo();
						entry.path = sample_path(trajeto->pontos(), speed, entry.path_loop, position);
						if (entry.path.size() < 2) {
							entry.path.clear();
						} else if (entry.path.size() >= 4000) {
							result.warnings.push_back(scene_label + name + U(": o trajeto é longo demais para a velocidade (4000 posições); ele foi cortado."));
						}
						break;
					}
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
						for (const String &som : { jogador->get_som_pulo(), jogador->get_som_morte(), jogador->get_som_ataque(), jogador->get_som_dano() }) {
							if (!som.is_empty()) {
								sound_for("WAV", som);
							}
						}
					}
				}
				sprites.push_back(entry);
			}
		} else if (MDTexto *texto = Object::cast_to<MDTexto>(p_node)) {
			const bool shows_value = texto->get_valor() != MDTexto::VALOR_NENHUM;
			if (check(p_node, texto->get_configuration_warnings()) && (!texto->get_texto().is_empty() || shows_value)) {
				if (!texto->get_texto().is_empty()) {
					text_code += vformat("\tVDP_drawText(\"%s\", %d, %d);\n", texto->get_texto().c_escape(), position.x / 8, position.y / 8);
				}
				text_rows = MAX(text_rows, position.y / 8 + 1);
				if (shows_value) {
					HudText hud_text;
					hud_text.valor = texto->get_valor();
					hud_text.tile = position / 8 + Vector2i(texto->get_texto().length(), 0);
					hud_text.digits = texto->get_digitos();
					hud_text.symbol = texto->get_simbolo();
					hud_text.node_name = name;
					hud_texts.push_back(hud_text);
				} else if (texto->get_piscar()) {
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
		} else if (MDCamera *camera_node = Object::cast_to<MDCamera>(p_node)) {
			if (check(p_node, camera_node->get_configuration_warnings())) {
				if (camera) {
					result.warnings.push_back(scene_label + name + U(": só a primeira MDCamera da cena vale."));
				} else {
					camera = camera_node;
				}
			}
		} else if (MDZonaCamera *zone = Object::cast_to<MDZonaCamera>(p_node)) {
			if (check(p_node, zone->get_configuration_warnings())) {
				camera_zones.push_back(Rect2i(position, zone->get_tamanho()));
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
		} else if (MDLetreiro *letreiro = Object::cast_to<MDLetreiro>(p_node)) {
			if (check(p_node, letreiro->get_configuration_warnings())) {
				LetreiroEntry entry;
				entry.node = letreiro;
				entry.position = position;
				letreiros.push_back(entry);
			}
		} else if (MDCicloCores *ciclo = Object::cast_to<MDCicloCores>(p_node)) {
			if (check(p_node, ciclo->get_configuration_warnings())) {
				if (color_cycles.size() >= 8) {
					result.warnings.push_back(scene_label + name + U(": a cena pode ter até 8 ciclos de cores; este fica de fora."));
				} else {
					color_cycles.push_back(ciclo);
				}
			}
		} else if (MDMenu *menu_node = Object::cast_to<MDMenu>(p_node)) {
			if (check(p_node, menu_node->get_configuration_warnings())) {
				if (menu) {
					result.warnings.push_back(scene_label + name + U(": só o primeiro MDMenu da cena vale."));
				} else {
					menu = menu_node;
					menu_tile = position / 8;
					if (menu_node->get_tipo() == MDMenu::TIPO_TITULO && !menu_node->get_comecar_vai_para().is_empty()) {
						menu_scene = scene_for(menu_node->get_comecar_vai_para());
					}
					for (const String &som : { menu_node->get_som_cursor(), menu_node->get_som_escolha() }) {
						if (!som.is_empty()) {
							sound_for("WAV", som);
						}
					}
				}
			}
		} else if (MDDialogo *dialogo = Object::cast_to<MDDialogo>(p_node)) {
			if (check(p_node, dialogo->get_configuration_warnings())) {
				DialogEntry entry;
				entry.node = dialogo;
				entry.name = name;
				entry.area = Rect2i(position, dialogo->get_tamanho());
				dialogs.push_back(entry);
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

	// Letreiros da cena: o texto vira um PNG indexado em res/gerado/ e um ator fixo na tela, sem código, que
	// some sozinho depois da duração. As cores vão para as mais próximas da paleta escolhida, se ela já
	// carrega as cores de outro desenho (assim não briga com ele); senão o letreiro a ocupa.
	void finish_letreiros() {
		int na_fonte = 0;
		for (const LetreiroEntry &entry : letreiros) {
			MDLetreiro *node = entry.node;
			const String name = node->get_name();
			// Branco = letra, preto = borda; as cores de verdade entram na paleta.
			const Ref<Image> image = MDLetreiro::desenhar(node->get_texto(), Color(1, 1, 1), node->get_borda(), Color(0, 0, 0), node->get_alinhamento(), node->get_entrelinha());
			const int slot = node->get_paleta();
			Vector<Color> palette;
			uint8_t index_cor = 1, index_borda = 2;
			const Vector<Color> reference = palette_texture[slot].is_empty() ? Vector<Color>() : RetroMD::png_palette(palette_texture[slot]);
			if (reference.size() >= 2) {
				palette = reference;
				const Color wanted[2] = { node->get_cor(), node->get_cor_da_borda() };
				uint8_t *found[2] = { &index_cor, &index_borda };
				for (int w = 0; w < (node->get_borda() == MDLetreiro::BORDA_NENHUMA ? 1 : 2); w++) {
					float best = 1e9;
					for (int i = 1; i < MIN(16, reference.size()); i++) {
						const Color c = reference[i];
						const float d = (c.r - wanted[w].r) * (c.r - wanted[w].r) + (c.g - wanted[w].g) * (c.g - wanted[w].g) + (c.b - wanted[w].b) * (c.b - wanted[w].b);
						if (d < best) {
							best = d;
							*found[w] = i;
						}
					}
					if (best > 0.06) {
						result.warnings.push_back(scene_label + vformat(U("%s: a PAL%d (de %s) não tem uma cor perto de #%s; o letreiro usa #%s. Escolha outra paleta ou uma cor dela."), name, slot, palette_texture[slot].get_file(), wanted[w].to_html(false), reference[*found[w]].to_html(false)));
					}
				}
			} else {
				palette.push_back(Color(0, 0, 0, 0));
				palette.push_back(node->get_cor());
				palette.push_back(node->get_cor_da_borda());
			}
			Vector<uint8_t> indices;
			indices.resize(image->get_width() * image->get_height());
			for (int y = 0; y < image->get_height(); y++) {
				for (int x = 0; x < image->get_width(); x++) {
					const Color pixel = image->get_pixel(x, y);
					indices.write[y * image->get_width() + x] = pixel.a < 0.5 ? 0 : (pixel.r > 0.5 ? index_cor : index_borda);
				}
			}
			// O símbolo sai do nome do arquivo (spr_<arquivo>, em asset_for); a cena no nome evita que dois
			// letreiros de mesmo nome em cenas diferentes gravem o mesmo PNG.
			const String file = "gerado/letreiro_" + scenes[scene].ident + "_" + identifier(name) + ".png";
			write_bytes("res/" + file, indexed_png(image->get_width(), image->get_height(), indices, palette));
			Ref<ImageTexture> texture = ImageTexture::create_from_image(image);
			texture->set_path_cache("res://res/" + file);
			// Um MDAtor só para o build (não entra na cena): fixo na tela, sem código.
			MDAtor *ator = memnew(MDAtor);
			template_roots.push_back(ator);
			ator->set_name(name);
			ator->set_texture(texture);
			ator->set_paleta(slot);
			ator->set_prioridade(node->get_prioridade());
			ator->set_fixo_na_tela(true);
			ator->set_vram_da_fonte(node->get_vram_da_fonte());
			const int before = actors.size();
			add_actor(ator, entry.position);
			if (actors.size() > before) {
				actors.write[actors.size() - 1].duracao = int(Math::round(node->get_duracao() * 10));
			}
			if (node->get_vram_da_fonte()) {
				if (++na_fonte == 2) {
					result.warnings.push_back(scene_label + name + U(": mais de um letreiro com vram_da_fonte na cena; se aparecerem juntos, um embaralha o outro."));
				}
				if (!text_code.is_empty()) {
					result.warnings.push_back(scene_label + name + U(": a cena tem MDTexto; enquanto o letreiro (vram_da_fonte) aparece, esses textos saem embaralhados."));
				}
			}
		}
	}

	// Grupos (um bit por nome, no jogo todo) e o código do ator.
	void register_actor(ActorEntry &r_entry, MDAtor *p_ator) {
		List<Node::GroupInfo> groups;
		p_ator->get_groups(&groups);
		for (const Node::GroupInfo &group : groups) {
			if (!group.persistent) {
				continue;
			}
			const String name = identifier(group.name).to_upper();
			if (!group_bits.has(name)) {
				if (group_bits.size() >= 16) {
					result.warnings.push_back(scene_label + p_ator->get_name() + U(": o jogo passa de 16 grupos de atores; ") + String(group.name) + U(" ficou de fora."));
					continue;
				}
				group_bits[name] = group_bits.size();
			}
			r_entry.groups |= 1 << group_bits[name];
		}
		r_entry.prefix = p_ator->get_prefixo();
		if (r_entry.prefix.is_empty()) {
			return;
		}
		if (!scripts.has(r_entry.prefix)) {
			ScriptInfo info;
			info.path = p_ator->get_codigo();
			info.asset = r_entry.asset;
			scripts[r_entry.prefix] = info;
		} else if (scripts[r_entry.prefix].path != p_ator->get_codigo()) {
			result.errors.push_back(scene_label + p_ator->get_name() + U(": ") + p_ator->get_codigo() + U(" e ") + scripts[r_entry.prefix].path + U(" têm o mesmo nome; as funções do código se chocariam. Renomeie um deles."));
		} else if (assets[scripts[r_entry.prefix].asset].anim_names != assets[r_entry.asset].anim_names) {
			result.warnings.push_back(scene_label + p_ator->get_name() + U(": outro ator com o código ") + p_ator->get_codigo().get_file() + U(" usa um personagem com outras animações; os ANIM_ do código seguem o primeiro."));
		}
	}

	// Nomes em maiúsculas citados no texto depois do prefixo (ANIM_, GRUPO_…), sem repetir, na ordem.
	static PackedStringArray cited(const String &p_text, const String &p_prefix) {
		PackedStringArray names;
		for (int at = p_text.find(p_prefix); at >= 0; at = p_text.find(p_prefix, at + 1)) {
			if (at > 0 && (is_ascii_alphanumeric_char(p_text[at - 1]) || p_text[at - 1] == '_')) {
				continue;
			}
			int end = at + p_prefix.length();
			while (end < p_text.length() && (is_ascii_upper_case(p_text[end]) || is_digit(p_text[end]) || p_text[end] == '_')) {
				end++;
			}
			const String name = p_text.substr(at + p_prefix.length(), end - at - p_prefix.length());
			if (!name.is_empty() && !names.has(name)) {
				names.push_back(name);
			}
		}
		return names;
	}

	// Código de ator que nenhum MDAtor de nenhuma cena usa (um .c que inclui gerado/codigo_<nome>.h): ganha o
	// cabeçalho mesmo assim, com os ANIM_ que cita, e os GRUPO_ que só ele cita entram nos grupos, para o
	// projeto compilar. Não entra no jogo: nenhum tipo de ator aponta para as funções dele.
	void add_orphan_scripts() {
		PackedStringArray sources, waves, scenes_found;
		collect_files("", sources, waves, scenes_found);
		const String mark = "#include \"gerado/codigo_";
		for (const String &file : sources) {
			if (!file.ends_with(".c")) {
				continue;
			}
			const String text = FileAccess::get_file_as_string(project_dir.path_join(file));
			const int at = text.find(mark);
			if (at < 0) {
				continue;
			}
			const String prefix = text.substr(at + mark.length()).get_slicec('"', 0).trim_suffix(".h");
			if (prefix.is_empty() || !prefix.is_valid_ascii_identifier() || scripts.has(prefix)) {
				continue;
			}
			ScriptInfo info;
			info.path = "res://" + file;
			info.anim_names = cited(text, "ANIM_");
			for (const String &group : cited(text, "GRUPO_")) {
				if (!group_bits.has(group) && group_bits.size() < 16) {
					group_bits[group] = group_bits.size();
				}
			}
			scripts[prefix] = info;
			uses_actors = true;
			result.warnings.push_back(file.get_file() + U(": nenhum MDAtor usa este código; ele compila, mas não entra no jogo."));
		}
	}

	// Antes das cenas: o código do projeto cita SOM_<NOME> (o .wav com esse nome) e TIPO_<NOME> (a cena
	// <nome>.tscn com um MDAtor na raiz, para criar_ator). Os dois entram no jogo por isso.
	void scan_code() {
		PackedStringArray sources, waves, scenes_found;
		collect_files("", sources, waves, scenes_found);
		HashSet<String> sounds, types;
		for (const String &file : sources) {
			const String text = FileAccess::get_file_as_string(project_dir.path_join(file));
			for (const String &prefix : { String("SOM_"), String("TIPO_") }) {
				for (int at = text.find(prefix); at >= 0; at = text.find(prefix, at + 1)) {
					if (at > 0 && (is_ascii_alphanumeric_char(text[at - 1]) || text[at - 1] == '_')) {
						continue;
					}
					int end = at + prefix.length();
					while (end < text.length() && (is_ascii_upper_case(text[end]) || is_digit(text[end]) || text[end] == '_')) {
						end++;
					}
					if (end > at + prefix.length()) {
						(prefix == "SOM_" ? sounds : types).insert(text.substr(at + prefix.length(), end - at - prefix.length()));
					}
				}
			}
		}
		for (const String &wave : waves) {
			if (sounds.has(identifier(wave.get_file().get_basename()).to_upper())) {
				sound_for("WAV", "res://" + wave);
			}
		}
		for (const String &path : scenes_found) {
			const String name = identifier(path.get_file().get_basename()).to_upper();
			if (types.has(name)) {
				add_template("res://" + path, name);
			}
		}
	}

	void collect_files(const String &p_relative, PackedStringArray &r_sources, PackedStringArray &r_waves, PackedStringArray &r_scenes) {
		const Ref<DirAccess> dir = DirAccess::open(project_dir.path_join(p_relative));
		if (dir.is_null()) {
			return;
		}
		for (const String &name : dir->get_directories()) {
			const String relative = p_relative.is_empty() ? name : p_relative.path_join(name);
			if (!name.begins_with(".") && relative != "out" && relative != "releases" && relative != "src/gerado" && relative != "res/gerado") {
				collect_files(relative, r_sources, r_waves, r_scenes);
			}
		}
		for (const String &name : dir->get_files()) {
			const String relative = p_relative.is_empty() ? name : p_relative.path_join(name);
			const String ext = name.get_extension().to_lower();
			if (ext == "c" || ext == "h") {
				r_sources.push_back(relative);
			} else if (ext == "wav") {
				r_waves.push_back(relative);
			} else if (ext == "tscn") {
				r_scenes.push_back(relative);
			}
		}
	}

	void add_template(const String &p_path, const String &p_name) {
		const Ref<PackedScene> packed = ResourceLoader::load(p_path, "PackedScene");
		Node *root = packed.is_valid() ? packed->instantiate() : nullptr;
		MDAtor *ator = Object::cast_to<MDAtor>(root);
		if (!ator) {
			if (root) {
				memdelete(root);
			}
			return; // Uma cena comum com o mesmo nome: não é um tipo de ator.
		}
		template_roots.push_back(root);
		scene_label = p_path.get_file() + ": ";
		if (!check(ator, ator->get_configuration_warnings())) {
			return;
		}
		ActorEntry entry;
		entry.node = ator;
		entry.asset = ator->get_personagem().is_valid() ? asset_for_personagem(ator) : asset_for("SPRITE", ator, ator->get_velocidade_animacao());
		if (entry.asset < 0) {
			return;
		}
		const Asset &asset = assets[entry.asset];
		entry.type = "TIPO_" + p_name;
		entry.anchor = ator->get_apoio();
		const Rect2i box = ator->get_caixa_efetiva();
		entry.body = Rect2i(box.position - entry.anchor, box.size);
		if (!ator->get_vram_da_fonte()) {
			template_tiles += RetroMD::sprite_vram_tiles(asset.texture, asset.hframes, asset.vframes);
		}
		register_actor(entry, ator);
		uses_actors = true;
		templates.push_back(entry);
	}

	void add_actor(MDAtor *p_ator, const Vector2i &p_position) {
		ActorEntry entry;
		entry.node = p_ator;
		entry.asset = p_ator->get_personagem().is_valid() ? asset_for_personagem(p_ator) : asset_for("SPRITE", p_ator, p_ator->get_velocidade_animacao());
		if (entry.asset < 0) {
			return;
		}
		const Asset &asset = assets[entry.asset];
		entry.type = scenes[scene].ident + "_" + identifier(p_ator->get_name()) + "_tipo";
		for (int n = 2; sprite_names.has(entry.type); n++) {
			entry.type = scenes[scene].ident + "_" + identifier(p_ator->get_name()) + "_" + itos(n) + "_tipo";
		}
		sprite_names.insert(entry.type);
		entry.feet = p_position;
		entry.anchor = p_ator->get_apoio();
		const Rect2i box = p_ator->get_caixa_efetiva();
		entry.body = Rect2i(box.position - entry.anchor, box.size);
		const int tiles = RetroMD::sprite_vram_tiles(asset.texture, asset.hframes, asset.vframes);
		if (p_ator->get_dorme_longe()) {
			// Conta depois, pelos que cabem perto da tela ao mesmo tempo (sleeping_tiles).
		} else if (!p_ator->get_vram_da_fonte()) {
			sprite_tiles += tiles;
		} else if (tiles > 96) {
			result.errors.push_back(scene_label + p_ator->get_name() + vformat(U(": com vram_da_fonte, o quadro cabe em 96 tiles (a fonte); este usa %d."), tiles));
		}
		use_palette(p_ator->get_paleta(), asset.symbol, asset.texture, p_ator->get_name());
		register_actor(entry, p_ator);
		if (p_ator->get_camera_segue()) {
			if (camera_actor >= 0) {
				result.warnings.push_back(scene_label + p_ator->get_name() + U(": só o primeiro ator com camera_segue é seguido."));
			} else {
				camera_actor = actors.size();
			}
		}
		uses_actors = true;
		actors.push_back(entry);
	}

	// Atores com dorme_longe: só os que estão perto da tela (32 px de margem) têm sprite. Para cada
	// desenho, conta quantos cabem numa janela da largura da tela mais as margens e uma folga para
	// andarem (96 px de cada lado), pela posição inicial.
	int sleeping_tiles() const {
		HashMap<int, Vector<int>> by_asset;
		for (const ActorEntry &entry : actors) {
			if (entry.node->get_dorme_longe()) {
				by_asset[entry.asset].push_back(entry.feet.x);
			}
		}
		int total = 0;
		const int window = RetroMD::SCREEN_WIDTH + 64 + 192;
		for (KeyValue<int, Vector<int>> &group : by_asset) {
			Vector<int> xs = group.value;
			xs.sort();
			int most = 0;
			for (int i = 0, j = 0; i < xs.size(); i++) {
				while (xs[i] - xs[j] > window) {
					j++;
				}
				most = MAX(most, i - j + 1);
			}
			const Asset &asset = assets[group.key];
			total += most * RetroMD::sprite_vram_tiles(asset.texture, asset.hframes, asset.vframes);
		}
		return total;
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
			const uint8_t tipo = collision_type(p_layer->get_nome_tipo(cell), p_layer->get_name());
			for (int y = 0; y < tile_size.y / 8; y++) {
				for (int x = 0; x < tile_size.x / 8; x++) {
					collision.write[int64_t(cell.y * tile_size.y / 8 + y) * collision_cells.x + cell.x * tile_size.x / 8 + x] = tipo;
				}
			}
		}
	}

	// Número do tipo de colisão: os prontos têm número fixo (MDColisao::Tipo); um nome próprio ganha o
	// próximo a partir de 9, no jogo todo, e vira CELULA_<NOME> em gerado/atores.h.
	uint8_t collision_type(const String &p_nome, const String &p_layer) {
		const int pronto = MDColisao::tipo_pronto(p_nome);
		if (pronto) {
			return pronto;
		}
		const String name = identifier(p_nome).to_upper();
		if (!custom_types.has(name)) {
			if (MDColisao::TIPO_PROPRIO + custom_types.size() > MDColisao::TIPO_MAXIMO) {
				result.warnings.push_back(scene_label + p_layer + U(": passou de 7 tipos de colisão próprios; \"") + p_nome + U("\" ficou sólido."));
				return MDColisao::TIPO_SOLIDO;
			}
			custom_types[name] = MDColisao::TIPO_PROPRIO + custom_types.size();
		}
		return custom_types[name];
	}

	// O mapa pintado vira um PNG indexado com a paleta do atlas (TILESET + MAP + PALETTE no rescomp)
	// e, se for sólido, células de colisão.
	void add_map(MDMapa *p_mapa) {
		const String name = p_mapa->get_name();
		// Um segundo mapa no mesmo plano é desenhado por cima do primeiro (o plano tem um tile por célula).
		int merge_into = -1;
		for (int i = 0; i < maps.size(); i++) {
			if (maps[i].node->get_plano() == p_mapa->get_plano()) {
				merge_into = i;
				break;
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
		int missing = 0, transposed = 0;
		for (const Vector2i cell : p_mapa->get_used_cells()) {
			if (p_mapa->get_cell_source_id(cell) != source_id) {
				continue;
			}
			// Espelhos do tile (alternativo com TRANSFORM_FLIP_H/V): o pixel sai do lado oposto. Os padrões
			// espelhados contam como o mesmo tile mais adiante (bits de espelho do plano), sem gastar VRAM.
			const int alternative = p_mapa->get_cell_alternative_tile(cell);
			const bool flip_h = alternative & TileSetAtlasSource::TRANSFORM_FLIP_H, flip_v = alternative & TileSetAtlasSource::TRANSFORM_FLIP_V;
			if (alternative & TileSetAtlasSource::TRANSFORM_TRANSPOSE) {
				transposed++;
			}
			const Rect2i region = atlas->get_tile_texture_region(p_mapa->get_cell_atlas_coords(cell));
			for (int y = 0; y < tile_size.y; y++) {
				for (int x = 0; x < tile_size.x; x++) {
					const Color color = image->get_pixel(region.position.x + (flip_h ? tile_size.x - 1 - x : x), region.position.y + (flip_v ? tile_size.y - 1 - y : y));
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
		if (transposed) {
			result.warnings.push_back(vformat(U("%s%s: %d tile(s) girados 90° saem sem o giro (o Mega Drive só espelha na horizontal e na vertical)."), scene_label, name, transposed));
		}
		if (missing) {
			result.errors.push_back(vformat(U("%s%s: %d pixels do TileSet não têm cor na paleta do PNG."), scene_label, name, missing));
			return;
		}
		// "Na frente": as células pintadas ganham o bit de prioridade (passam na frente dos sprites).
		if (p_mapa->is_na_frente()) {
			const int plane = p_mapa->get_plano() == MDFundo::PLANO_A ? 1 : 0;
			for (const Vector2i cell : p_mapa->get_used_cells()) {
				for (int y = 0; y < tile_size.y / 8; y++) {
					for (int x = 0; x < tile_size.x / 8; x++) {
						priority_cells[plane].insert(Vector2i(cell.x * tile_size.x / 8 + x, cell.y * tile_size.y / 8 + y));
					}
				}
			}
		}
		if (merge_into >= 0) {
			merge_map(maps.write[merge_into], name, cells * 8, padded, indices, palette);
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
		entry.scroll_x = p_mapa->get_rolagem();
		entry.scroll_y = p_mapa->get_rolagem_vertical();
		use_palette(p_mapa->get_paleta(), "pal_" + entry.symbol.substr(4), entry.texture, name);
		draw_code += vformat("@@MAPA_%d@@", maps.size()); // Trocado pelo código do mapa em finish_maps.
		maps.push_back(entry);
		world.x = MAX(world.x, entry.size.x);
		world.y = MAX(world.y, entry.size.y);
	}

	// Desenha o mapa p_name por cima de r_base (mesmo plano): onde ele tem pixel, vale o pixel dele. As cores dos
	// dois vão juntas para uma paleta (até 15 mais a transparência), a do primeiro mapa.
	void merge_map(MapEntry &r_base, const String &p_name, const Vector2i &p_size, const Vector2i &p_padded, const Vector<uint8_t> &p_indices, const Vector<Color> &p_palette) {
		const Vector2i size = r_base.size.max(p_size);
		const Vector2i padded = r_base.padded.max(p_padded);
		Ref<Image> image = Image::create_empty(padded.x, padded.y, false, Image::FORMAT_RGBA8);
		image->fill(Color(0, 0, 0, 0));
		for (int y = 0; y < padded.y; y++) {
			for (int x = 0; x < padded.x; x++) {
				uint8_t over = x < p_padded.x && y < p_padded.y ? p_indices[int64_t(y) * p_padded.x + x] : 0;
				if (over) {
					image->set_pixel(x, y, p_palette[over]);
					continue;
				}
				const uint8_t under = x < r_base.padded.x && y < r_base.padded.y ? r_base.indices[int64_t(y) * r_base.padded.x + x] : 0;
				if (under) {
					image->set_pixel(x, y, r_base.palette[under]);
				}
			}
		}
		Vector<uint8_t> indices;
		Vector<Color> palette;
		const int colors = RetroImageConvert::quantize(image, indices, palette);
		if (colors > palette.size() - 1) {
			result.warnings.push_back(scene_label + vformat(U("%s e %s: o plano junto tem %d cores; foram reduzidas para %d (uma paleta)."), r_base.name, p_name, colors, palette.size() - 1));
		}
		r_base.name += " + " + p_name;
		r_base.size = size;
		r_base.padded = padded;
		r_base.indices = indices;
		r_base.palette = palette;
		r_base.tiles = count_unique_tiles(padded.x, padded.y, [&](int x, int y) { return uint32_t(indices[int64_t(y) * padded.x + x]); });
		world.x = MAX(world.x, size.x);
		world.y = MAX(world.y, size.y);
	}

	// Janela de células carregada no streaming: a tela (40×28) mais uma coluna e uma linha de folga; cabe
	// no plano de 64×32, que dá a volta.
	// Janela do streaming: exatamente o que a tela mostra (40 colunas + 1 parcial, 28 linhas + 1 parcial). Com as
	// vagas fixas, a coluna ou linha nova chega no mesmo vblank em que aparece; não precisa de folga.
	static const int STREAM_COLUMNS = 41;
	static const int STREAM_ROWS = 29;

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
			// Nas linhas da correnteza a janela é mais larga (margem à direita).
			auto column = [&](int p_x, int p_delta, bool p_margin_rows) {
				for (int y = top; y < top + window_h; y++) {
					if ((y >= p_map.margin_y0 && y < p_map.margin_y1 && p_map.margin > 0) != p_margin_rows || p_x < 0 || p_x >= cells.x) {
						continue;
					}
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
				column(x, 1, false);
			}
			for (int x = 0; x < window_w + p_map.margin; x++) {
				column(x, 1, true);
			}
			peak = MAX(peak, distinct);
			for (int left = 1; left + window_w <= cells.x; left++) {
				column(left - 1, -1, false);
				column(left - 1, -1, true);
				column(left + window_w - 1, 1, false);
				column(left + window_w + p_map.margin - 1, 1, true);
				peak = MAX(peak, distinct);
			}
		}
		return peak;
	}

	// Vaga fixa de cada padrão (como o Sota faz: VRAM alocada de antemão). Dois padrões que podem estar
	// juntos numa janela da câmera (colunas × linhas de células, com a margem da correnteza) nunca dividem
	// a vaga; assim as palavras do mapa ficam prontas na ROM e o jogo só confere se o padrão está na vaga.
	// Cor gulosa na ordem em que os padrões aparecem da esquerda para a direita.
	int assign_slots(const MapEntry &p_map, const Vector<uint16_t> &p_cells, int p_patterns, Vector<uint16_t> &r_slot) const {
		// Duas ordens (da esquerda para a direita, ou os mais repetidos primeiro); fica a que usa menos vagas.
		Vector<uint16_t> other;
		const int by_place = color_slots(p_map, p_cells, p_patterns, r_slot, false);
		const int by_count = color_slots(p_map, p_cells, p_patterns, other, true);
		if (by_count < by_place) {
			r_slot = other;
			return by_count;
		}
		return by_place;
	}

	int color_slots(const MapEntry &p_map, const Vector<uint16_t> &p_cells, int p_patterns, Vector<uint16_t> &r_slot, bool p_by_count) const {
		const int cols = p_map.size.x / 8, rows = p_map.size.y / 8;
		const int window_w = STREAM_COLUMNS, window_h = STREAM_ROWS;
		// Nas linhas da correnteza a janela se estende "margin" colunas para a direita: uma célula ali enxerga
		// as que estão até window_w - 1 + margin colunas à esquerda dela.
		auto extra = [&](int p_row) {
			return p_row >= p_map.margin_y0 && p_row < p_map.margin_y1 ? p_map.margin : 0;
		};
		Vector<int> ids;
		ids.resize(p_cells.size());
		Vector<Vector<int>> occurrences;
		occurrences.resize(p_patterns);
		for (int c = 0; c < p_cells.size(); c++) {
			ids.write[c] = p_cells[c] ? int(p_cells[c] & 0x0FFF) - 1 : -1;
			if (ids[c] >= 0) {
				occurrences.write[ids[c]].push_back(c);
			}
		}
		// Ordem: coluna da primeira aparição (a câmera anda mais na horizontal), depois a linha.
		Vector<Vector3i> order; // (repetições, lugar, padrão), em ordem lexicográfica.
		for (int p = 0; p < p_patterns; p++) {
			int first_x = cols, first_y = rows;
			for (int c : occurrences[p]) {
				if (c % cols < first_x || (c % cols == first_x && c / cols < first_y)) {
					first_x = c % cols;
					first_y = c / cols;
				}
			}
			order.push_back(Vector3i(p_by_count ? -occurrences[p].size() : 0, first_x * rows + first_y, p));
		}
		order.sort();
		r_slot.resize(p_patterns);
		for (int p = 0; p < p_patterns; p++) {
			r_slot.write[p] = 0xFFFF;
		}
		Vector<uint32_t> stamp;
		uint32_t generation = 0;
		int slots = 0;
		Vector<int> diff;
		auto mark = [&](int q, int p) {
			if (q >= 0 && q != p && r_slot[q] != 0xFFFF) {
				if (r_slot[q] >= stamp.size()) {
					stamp.resize(r_slot[q] + 1);
				}
				stamp.write[r_slot[q]] = generation;
			}
		};
		for (const Vector3i &item : order) {
			const int p = item.z;
			generation++;
			const Vector<int> &occ = occurrences[p];
			if (occ.size() <= 4) {
				for (int c : occ) {
					const int ox = c % cols, oy = c / cols;
					const int left = window_w - 1 + extra(oy); // Quem está à esquerda e cabe na janela desta célula.
					for (int y = MAX(0, oy - window_h + 1); y <= MIN(rows - 1, oy + window_h - 1); y++) {
						const int *row = ids.ptr() + y * cols;
						const int right = window_w - 1 + extra(y); // A célula da direita, na linha dela.
						for (int x = MAX(0, ox - left); x <= MIN(cols - 1, ox + right); x++) {
							mark(row[x], p);
						}
					}
				}
			} else {
				// Padrão que se repete muito (céu, água): a união das janelas dele, por diferenças em 2D.
				diff.resize((cols + 1) * (rows + 1));
				memset(diff.ptrw(), 0, diff.size() * sizeof(int));
				auto add_rect = [&](int p_x0, int p_x1, int p_y0, int p_y1) { // Meio aberto: [x0, x1) × [y0, y1).
					p_x0 = MAX(0, p_x0);
					p_x1 = MIN(cols, p_x1);
					p_y0 = MAX(0, p_y0);
					p_y1 = MIN(rows, p_y1);
					if (p_x0 >= p_x1 || p_y0 >= p_y1) {
						return;
					}
					diff.write[p_y0 * (cols + 1) + p_x0]++;
					diff.write[p_y0 * (cols + 1) + p_x1]--;
					diff.write[p_y1 * (cols + 1) + p_x0]--;
					diff.write[p_y1 * (cols + 1) + p_x1]++;
				};
				for (int c : occ) {
					const int ox = c % cols, oy = c / cols;
					const int y0 = oy - window_h + 1, y1 = oy + window_h;
					const int x0 = ox - (window_w - 1 + extra(oy));
					// À direita, a extensão depende da linha de quem está lá: separa as linhas da margem.
					const int m0 = CLAMP(p_map.margin_y0, y0, y1), m1 = CLAMP(p_map.margin_y1, y0, y1);
					add_rect(x0, ox + window_w, y0, m0);
					add_rect(x0, ox + window_w + (p_map.margin_y1 > p_map.margin_y0 ? p_map.margin : 0), m0, m1);
					add_rect(x0, ox + window_w, m1, y1);
				}
				for (int y = 0; y < rows; y++) {
					for (int x = 0; x < cols; x++) {
						int v = diff[y * (cols + 1) + x];
						if (x > 0) {
							v += diff[y * (cols + 1) + x - 1];
						}
						if (y > 0) {
							v += diff[(y - 1) * (cols + 1) + x];
						}
						if (x > 0 && y > 0) {
							v -= diff[(y - 1) * (cols + 1) + x - 1];
						}
						diff.write[y * (cols + 1) + x] = v; // Prefixo acumulado no lugar (já lidos os vizinhos).
						if (v > 0) {
							mark(ids[y * cols + x], p);
						}
					}
				}
			}
			int slot = 0;
			while (slot < stamp.size() && stamp[slot] == generation) {
				slot++;
			}
			r_slot.write[p] = slot;
			slots = MAX(slots, slot + 1);
		}
		return slots;
	}

	// Decide como cada mapa vai para a VRAM: inteiro (TILESET + MAP do SGDK) quando tudo cabe, ou por
	// streaming quando os fundos e mapas da cena passam do limite.
	// Depois de finish_maps (a colisão decide se o jogador tem energia).
	void check_hud() {
		if ((camera || !camera_zones.is_empty()) && (maps.is_empty() || (!player && actors.is_empty()))) {
			result.warnings.push_back(scene_label + U("a câmera (MDCamera/MDZonaCamera) só vale em cena com mapa e MDJogador (ou MDAtor com camera_segue): sem eles a tela não rola."));
		}
		for (const HudText &hud_text : hud_texts) {
			if ((hud_text.valor == MDTexto::VALOR_ENERGIA || hud_text.valor == MDTexto::VALOR_ENERGIA_BARRA) && !player_energy()) {
				result.warnings.push_back(scene_label + hud_text.node_name + U(": a energia só aparece numa cena com MDJogador com energia (o texto fica sem o valor)."));
			}
		}
	}

	// Código da letra nas páginas (2 em diante); a primeira vez, a letra entra na tabela da cena.
	uint8_t dialog_code(char32_t p_letter) {
		int index = dialog_letters.find(p_letter);
		if (index < 0) {
			uint8_t lines[8];
			if (p_letter != ' ' && !MDLetreiro::glifo(p_letter, lines)) {
				result.warnings.push_back(scene_label + vformat(U("a letra \"%s\" não existe na fonte dos diálogos e sai como \"?\"."), String::chr(p_letter)));
				return dialog_code('?');
			}
			if (dialog_letters.size() >= 250) {
				return dialog_code('?');
			}
			dialog_letters.push_back(p_letter);
			index = dialog_letters.size() - 1;
		}
		return uint8_t(index + 2);
	}

	// Quebra um texto em linhas de até p_width letras (pelas palavras; palavra maior que a linha é cortada).
	static Vector<String> wrap_text(const String &p_text, int p_width) {
		Vector<String> lines;
		for (const String &paragraph : p_text.replace("\r", "").replace("\t", " ").split("\n")) {
			String line;
			for (String word : paragraph.split(" ", false)) {
				while (word.length() > p_width) {
					if (!line.is_empty()) {
						lines.push_back(line);
						line = String();
					}
					lines.push_back(word.substr(0, p_width));
					word = word.substr(p_width);
				}
				if (line.is_empty()) {
					line = word;
				} else if (line.length() + 1 + word.length() <= p_width) {
					line += " " + word;
				} else {
					lines.push_back(line);
					line = word;
				}
			}
			lines.push_back(line); // Parágrafo vazio vira linha em branco.
		}
		return lines;
	}

	// Moldura (9 tiles: cantos, lados e fundo) com 1 px transparente por fora, 1 px de borda (cor 14) e o fundo (13).
	static int frame_pixel(int p_tile, int p_x, int p_y) {
		const int col = p_tile % 3, row = p_tile / 3;
		const int x = col == 2 ? 7 - p_x : p_x, y = row == 2 ? 7 - p_y : p_y;
		const bool edge_x = col != 1, edge_y = row != 1;
		if ((edge_x && x < 1) || (edge_y && y < 1)) {
			return 0;
		}
		if (edge_x && edge_y && x == 1 && y == 1) {
			return 0; // Canto arredondado.
		}
		if ((edge_x && x == 1) || (edge_y && y == 1)) {
			return 14;
		}
		return 13;
	}

	void finish_dialogs() {
		if (dialogs.is_empty()) {
			return;
		}
		uses_dialogs = true;
		HashMap<MDDialogo *, int> index_of;
		for (int i = 0; i < dialogs.size(); i++) {
			index_of[dialogs[i].node] = i;
			dialog_rows = MAX(dialog_rows, dialogs[i].node->get_linhas());
		}
		dialog_rows = dialogs[0].node->get_linhas();
		for (const DialogEntry &entry : dialogs) {
			dialog_rows = MAX(dialog_rows, entry.node->get_linhas());
		}
		const int text_lines = (dialog_rows - 1) / 2; // Linhas de texto com uma vazia entre elas (o runtime pula uma).
		const int inner_rows = dialog_rows - 2;
		dialog_code(' ');
		dialog_code('v');
		dialog_code('>');
		HashSet<String> defines;
		for (DialogEntry &entry : dialogs) {
			MDDialogo *node = entry.node;
			String define = "DIALOGO_" + identifier(entry.name).to_upper();
			while (defines.has(define)) {
				define += "_";
			}
			defines.insert(define);
			entry.define = define;
			if (!node->get_proximo().is_empty()) {
				MDDialogo *next = Object::cast_to<MDDialogo>(node->get_node_or_null(node->get_proximo()));
				if (next && index_of.has(next)) {
					entry.next = index_of[next];
				}
			}
			int width = 38;
			if (!node->get_retrato().is_empty()) {
				const Ref<Image> pixels = MDPersonagem::load_sheet(node->get_retrato());
				if (pixels.is_null()) {
					result.errors.push_back(scene_label + entry.name + U(": o retrato não pôde ser lido."));
				} else if (pixels->get_width() % 8 || pixels->get_height() % 8) {
					result.errors.push_back(scene_label + entry.name + U(": o retrato precisa ter largura e altura múltiplas de 8."));
				} else if (pixels->get_height() > inner_rows * 8 || pixels->get_width() > 16 * 8) {
					result.errors.push_back(scene_label + entry.name + vformat(U(": o retrato tem %dx%d px; cabe até 128x%d (linhas da caixa − 2, vezes 8)."), pixels->get_width(), pixels->get_height(), inner_rows * 8));
				} else {
					const String key = "IMAGE|" + node->get_retrato();
					int asset_index = -1;
					if (asset_by_key.has(key)) {
						asset_index = asset_by_key[key];
					} else {
						Asset asset;
						asset.kind = "IMAGE";
						asset.texture = node->get_retrato();
						asset.file = res_relative(node->get_retrato());
						asset.symbol = symbol_for("img_", node->get_retrato().get_file().get_basename());
						asset.frame_tiles_w = pixels->get_width() / 8;
						asset.frame_tiles_h = pixels->get_height() / 8;
						Ref<Image> rgba = pixels->duplicate();
						rgba->convert(Image::FORMAT_RGBA8);
						asset.tiles = RetroMD::unique_tiles(rgba);
						assets.push_back(asset);
						asset_index = assets.size() - 1;
						asset_by_key[key] = asset_index;
					}
					entry.portrait = asset_index;
					entry.portrait_cols = pixels->get_width() / 8;
					// O VDP_drawImageEx usa os tiles do tileset (sem repetidos), no máximo um por célula.
					dialog_portrait_tiles = MAX(dialog_portrait_tiles, assets[asset_index].frame_tiles_w * assets[asset_index].frame_tiles_h);
					width = 38 - entry.portrait_cols - 1;
				}
			}
			for (const String &fala : node->get_falas()) {
				if (fala.strip_edges().is_empty()) {
					continue;
				}
				const Vector<String> lines = wrap_text(fala.strip_edges(), width);
				for (int start = 0; start < lines.size(); start += text_lines) {
					Vector<uint8_t> codes;
					String text;
					for (int l = start; l < MIN(start + text_lines, lines.size()); l++) {
						if (l > start) {
							codes.push_back(1);
							text += " / ";
						}
						text += lines[l];
						for (int k = 0; k < lines[l].length(); k++) {
							codes.push_back(dialog_code(lines[l][k]));
						}
					}
					codes.push_back(0);
					entry.pages.push_back(codes);
					entry.page_texts.push_back(text);
				}
			}
			for (const String &option : node->get_opcoes()) {
				Vector<uint8_t> codes;
				const String text = option.strip_edges().left(width - 2);
				for (int k = 0; k < text.length(); k++) {
					codes.push_back(dialog_code(text[k]));
				}
				codes.push_back(0);
				entry.options.push_back(codes);
			}
			if (entry.pages.is_empty()) {
				Vector<uint8_t> empty;
				empty.push_back(0);
				entry.pages.push_back(empty);
				entry.page_texts.push_back(String());
			}
			if ((node->get_ativar() == MDDialogo::ATIVAR_AO_TOCAR || node->get_ativar() == MDDialogo::ATIVAR_APERTAR_CIMA) && !player && camera_actor < 0) {
				result.warnings.push_back(scene_label + entry.name + U(": a área só abre o diálogo numa cena com MDJogador (ou com um ator que a câmera segue); sem eles, use \"Pelo código\"."));
			}
		}
		// Tiles: moldura e letras (fundo 13, letra 15).
		for (int t = 0; t < 9; t++) {
			for (int y = 0; y < 8; y++) {
				uint32_t word = 0;
				for (int x = 0; x < 8; x++) {
					word = (word << 4) | uint32_t(frame_pixel(t, x, y));
				}
				dialog_tiles.push_back(int32_t(word));
			}
		}
		for (char32_t letter : dialog_letters) {
			uint8_t lines[8] = {};
			if (letter != ' ') {
				MDLetreiro::glifo(letter, lines);
			}
			for (int y = 0; y < 8; y++) {
				uint32_t word = 0;
				for (int x = 0; x < 8; x++) {
					word = (word << 4) | ((lines[y] & (0x80 >> x)) ? 15u : 13u);
				}
				dialog_tiles.push_back(int32_t(word));
			}
		}
		dialog_vram = dialog_tiles.size() / 8 + dialog_portrait_tiles;
		background_tiles += dialog_vram;
	}

	static String dialog_bytes(const Vector<uint8_t> &p_codes) {
		String out = "{ ";
		for (int i = 0; i < p_codes.size(); i++) {
			out += (i ? ", " : "") + itos(p_codes[i]);
		}
		return out + " }";
	}

	static String vdp_color(const Color &p_color) {
		return vformat("RGB24_TO_VDPCOLOR(0x%06X)", p_color.to_rgba32() >> 8);
	}

	// Tabelas dos diálogos da cena (antes da cena_<nome>_iniciar).
	String dialog_tables(bool p_window_top, int p_fixed_rows, bool p_has_sprites) const {
		if (dialogs.is_empty()) {
			return String();
		}
		String c = U("// ---- Caixas de diálogo (MDDialogo) ----\nstatic const u32 dialogo_tiles[] = {\n");
		for (int i = 0; i < dialog_tiles.size(); i++) {
			c += vformat("%s0x%08X,%s", i % 8 == 0 ? "\t" : "", uint32_t(dialog_tiles[i]), i % 8 == 7 ? "\n" : " ");
		}
		c += "};\n";
		String letters;
		for (char32_t letter : dialog_letters) {
			letters += String::chr(letter);
		}
		c += U("// Letras (código 2 em diante): ") + letters.replace("*/", "* /") + "\n";
		for (int d = 0; d < dialogs.size(); d++) {
			const DialogEntry &entry = dialogs[d];
			for (int p = 0; p < entry.pages.size(); p++) {
				c += vformat("static const u8 dialogo_%d_%d[] = %s; // %s\n", d, p, dialog_bytes(entry.pages[p]), entry.page_texts[p].replace("\n", " "));
			}
			c += vformat("static const u8 *const dialogo_%d_paginas[] = { ", d);
			for (int p = 0; p < entry.pages.size(); p++) {
				c += vformat("%sdialogo_%d_%d", p ? ", " : "", d, p);
			}
			c += " };\n";
			if (!entry.options.is_empty()) {
				for (int o = 0; o < entry.options.size(); o++) {
					c += vformat("static const u8 dialogo_%d_opcao_%d[] = %s;\n", d, o, dialog_bytes(entry.options[o]));
				}
				c += vformat("static const u8 *const dialogo_%d_opcoes[] = { ", d);
				for (int o = 0; o < entry.options.size(); o++) {
					c += vformat("%sdialogo_%d_opcao_%d", o ? ", " : "", d, o);
				}
				c += " };\n";
			}
		}
		c += "static const Dialogo dialogos[] = {\n";
		for (int d = 0; d < dialogs.size(); d++) {
			const DialogEntry &entry = dialogs[d];
			c += vformat("\t{ dialogo_%d_paginas, %d, %s, %d, %d, %d, %d, %s, %d, %d }, // %s\n", d, entry.pages.size(),
					entry.options.is_empty() ? String("NULL") : vformat("dialogo_%d_opcoes", d), entry.options.size(), entry.node->get_variavel(), entry.next,
					entry.node->get_velocidade(), entry.portrait >= 0 ? "&" + assets[entry.portrait].symbol : String("NULL"), entry.node->get_paleta_retrato(), entry.portrait_cols, entry.name);
		}
		c += "};\n";
		const MDDialogo *first = dialogs[0].node;
		const String sprite_vram = p_has_sprites ? vformat(" - %d", MAX(1, sprite_tiles)) : String();
		c += vformat(U("// A moldura, as letras e o retrato ficam logo abaixo dos sprites (contados na VRAM dos fundos).\n"
					   "static const DialogoCena dialogo_cena = { dialogos, %d, dialogo_tiles, %d, %d%s - %d, %d, %d, %d, %d, %s, %s, %s }; // %d = TILE_FONT_INDEX.\n\n"),
				dialogs.size(), dialog_tiles.size() / 8, FONT_TILE_INDEX, sprite_vram, dialog_vram, p_window_top ? p_fixed_rows : 0, dialog_rows,
				dialog_letters.find('v') + 2, dialog_letters.find('>') + 2, vdp_color(first->get_cor_fundo()), vdp_color(first->get_cor_borda()), vdp_color(first->get_cor_texto()), FONT_TILE_INDEX);
		for (int d = 0; d < dialogs.size(); d++) {
			const MDDialogo::Ativar ativar = dialogs[d].node->get_ativar();
			if (ativar != MDDialogo::ATIVAR_PELO_CODIGO) {
				c += vformat("static bool dialogo_%d_feito, dialogo_%d_dentro;\n", d, d);
			}
		}
		c += "static u16 dialogo_botoes_antes;\n\n";
		return c;
	}

	// Condição em C: o jogador (ou o ator da câmera) toca a área.
	String touch_test(const Rect2i &p_area) const {
		if (player) {
			const Rect2i box = player->get_caixa_efetiva();
			return vformat("(jogador_x + %d < %d && %d < jogador_x + %d && (jogador_y16 >> 4) + %d < %d && %d < (jogador_y16 >> 4) + %d)",
					box.position.x, p_area.get_end().x, p_area.position.x, box.position.x + box.size.x,
					box.position.y, p_area.get_end().y, p_area.position.y, box.position.y + box.size.y);
		}
		if (camera_actor >= 0) {
			return vformat("(ator_camera && corpo_esquerda(ator_camera) < %d && %d < corpo_esquerda(ator_camera) + ator_camera->corpo_l && corpo_topo(ator_camera) < %d && %d < corpo_topo(ator_camera) + ator_camera->corpo_a)",
					p_area.get_end().x, p_area.position.x, p_area.get_end().y, p_area.position.y);
		}
		return "FALSE";
	}

	// No começo da cena_<nome>_atualizar: com a caixa aberta, só ela anda.
	String dialog_update_head() const {
		if (dialogs.is_empty()) {
			return String();
		}
		String c = U("\t// Caixa de diálogo aberta: a cena fica parada.\n\tif (dialogo_aberto()) {\n\t\tdialogo_atualizar();\n\t\tif (!dialogo_aberto()) {\n");
		c += "\t\t\tdialogo_botoes_antes = JOY_readJoypad(JOY_1);\n";
		if (player) {
			c += U("\t\t\tjogador_botoes_antes = dialogo_botoes_antes; // O botão que fechou não pula nem ataca.\n");
			if (player->get_pausa_start()) {
				c += "\t\t\tpausa_botoes_antes = dialogo_botoes_antes;\n";
			}
		}
		if (start_scene >= 0) {
			c += "\t\t\tbotoes_antes = dialogo_botoes_antes;\n";
		}
		c += "\t\t}\n\t\treturn;\n\t}\n";
		for (int d = 0; d < dialogs.size(); d++) {
			if (dialogs[d].node->get_ativar() == MDDialogo::ATIVAR_AO_INICIAR) {
				c += vformat(U("\tif (!dialogo_%d_feito) { // %s: abre quando a cena começa.\n\t\tdialogo_%d_feito = TRUE;\n\t\tdialogo_abrir(%s);\n\t\treturn;\n\t}\n"), d, dialogs[d].name, d, dialogs[d].define);
			}
		}
		return c;
	}

	// Depois do movimento do jogador: as áreas que abrem diálogos.
	String dialog_triggers() const {
		String c;
		bool needs_buttons = false;
		for (int d = 0; d < dialogs.size(); d++) {
			const MDDialogo *node = dialogs[d].node;
			const MDDialogo::Ativar ativar = node->get_ativar();
			if (ativar != MDDialogo::ATIVAR_AO_TOCAR && ativar != MDDialogo::ATIVAR_APERTAR_CIMA) {
				continue;
			}
			needs_buttons = needs_buttons || ativar == MDDialogo::ATIVAR_APERTAR_CIMA;
			c += vformat("\t{ // %s\n\t\tconst bool dentro = %s;\n", dialogs[d].name, touch_test(dialogs[d].area));
			const String once = node->get_uma_vez() ? vformat(" && !dialogo_%d_feito", d) : String();
			if (ativar == MDDialogo::ATIVAR_AO_TOCAR) {
				c += vformat("\t\tif (dentro && !dialogo_%d_dentro%s) {\n", d, once);
			} else {
				c += vformat("\t\tif (dentro && (dialogo_apertou & BUTTON_UP)%s) {\n", once);
			}
			c += vformat("\t\t\tdialogo_%d_feito = TRUE;\n\t\t\tdialogo_abrir(%s);\n\t\t}\n\t\tdialogo_%d_dentro = dentro;\n\t}\n", d, dialogs[d].define, d);
		}
		if (needs_buttons) {
			c = "\t{\n\tconst u16 dialogo_botoes = JOY_readJoypad(JOY_1);\n\tconst u16 dialogo_apertou = dialogo_botoes & ~dialogo_botoes_antes;\n\tdialogo_botoes_antes = dialogo_botoes;\n" + c + "\t}\n";
		}
		return c;
	}

	uint8_t menu_code(char32_t p_letter) {
		int index = menu_letters.find(p_letter);
		if (index < 0) {
			uint8_t lines[8];
			if (p_letter != ' ' && !MDLetreiro::glifo(p_letter, lines)) {
				result.warnings.push_back(scene_label + vformat(U("a letra \"%s\" não existe na fonte do menu e sai como \"?\"."), String::chr(p_letter)));
				return menu_code('?');
			}
			if (menu_letters.size() >= 250) {
				return menu_code('?');
			}
			menu_letters.push_back(p_letter);
			index = menu_letters.size() - 1;
		}
		return uint8_t(index + 2);
	}

	void finish_menu() {
		if (!menu) {
			return;
		}
		uses_menu = true;
		const bool pause = menu->get_tipo() == MDMenu::TIPO_PAUSA;
		if (!pause && start_scene >= 0) {
			result.warnings.push_back(scene_label + U("a cena tem MDMenu de título: o start_vai_para da MDCena é ignorado (START escolhe o item do menu)."));
			start_scene = -1;
		}
		if (!pause && menu_scene < 0) {
			result.errors.push_back(scene_label + U("o MDMenu de título precisa da cena do Começar (comecar_vai_para)."));
		}
		// Na ordem do enum MT_* de menu.h.
		const String texts[] = { menu->rotulo_comecar(), menu->rotulo_continuar(), menu->rotulo_senha(), menu->rotulo_opcoes(), "VOLTAR",
			menu->rotulo_salvar(), menu->rotulo_sair(), U("MÚSICA"), "EFEITOS", "CONTROLES", "LIGADO", "DESLIGADO", "NORMAL",
			"A E C TROCADOS", "A E B TROCADOS", "APAGAR PROGRESSO", "SLOT", "VAZIO", "SALVO", "PROGRESSO SALVO", "APAGAR TUDO?",
			"SIM", U("NÃO"), "SENHA ERRADA", "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", ">123 " };
		menu_code(' ');
		for (const String &text : texts) {
			Vector<uint8_t> codes;
			for (int i = 0; i < text.length(); i++) {
				codes.push_back(menu_code(text[i]));
			}
			codes.push_back(0);
			menu_texts.push_back(codes);
		}
		// Itens (ações do menu.h: 0 Começar, 1 Continuar, 2 Senha, 3 Opções, 5 Salvar, 6 Sair).
		if (!pause) {
			menu_items.push_back(0);
			if (menu->get_mostrar_continuar()) {
				menu_items.push_back(1);
			}
			if (menu->get_mostrar_senha()) {
				menu_items.push_back(2);
			}
		} else {
			menu_items.push_back(1);
		}
		if (menu->get_mostrar_opcoes()) {
			menu_items.push_back(3);
		}
		if (pause && menu->get_mostrar_salvar()) {
			menu_items.push_back(5);
		}
		if (pause && menu->get_mostrar_sair()) {
			menu_items.push_back(6);
		}
		// Largura: a maior linha de todas as telas, mais o cursor e um espaço.
		auto len = [&](int p_mt) { return texts[p_mt].length(); };
		int width = 0;
		for (int item : menu_items) {
			static const int text_of[] = { 0, 1, 2, 3, 4, 5, 6 };
			width = MAX(width, len(text_of[item]));
		}
		const int on_off = MAX(len(10), len(11));
		width = MAX(width, len(7) + 1 + on_off);
		width = MAX(width, len(8) + 1 + on_off);
		width = MAX(width, len(9) + 1 + MAX(len(12), MAX(len(13), len(14))));
		width = MAX(width, MAX(len(15), len(4)));
		width = MAX(width, len(16) + 3 + MAX(len(17), len(18)));
		width = MAX(width, MAX(len(19), len(20)) - 2);
		width = MAX(width, MAX(len(23), len(2)) - 2);
		width = MAX(width, 8);
		menu_width = width + 2;
		int biggest = MAX(menu_items.size(), pause ? 4 : 5);
		if (!pause) {
			biggest = MAX(biggest, menu->get_slots() + 1);
		}
		menu_rows = biggest * 2 - 1;
		if (!pause && menu_tile.x + menu_width > 40) {
			result.warnings.push_back(scene_label + vformat(U("o menu tem %d colunas e começa na coluna %d: passa da borda direita da tela (40 colunas)."), menu_width, menu_tile.x));
		}
		if (!pause) {
			// Com o mapa no plano A, os textos vão para o window no topo, que precisa cobrir o menu.
			text_rows = MAX(text_rows, menu_tile.y + menu_rows);
		}
		// Tiles: na pausa a moldura (9) e as letras com fundo (13); no título, as letras transparentes.
		if (pause) {
			for (int t = 0; t < 9; t++) {
				for (int y = 0; y < 8; y++) {
					uint32_t word = 0;
					for (int x = 0; x < 8; x++) {
						word = (word << 4) | uint32_t(frame_pixel(t, x, y));
					}
					menu_tiles.push_back(int32_t(word));
				}
			}
		}
		for (char32_t letter : menu_letters) {
			uint8_t lines[8] = {};
			if (letter != ' ') {
				MDLetreiro::glifo(letter, lines);
			}
			for (int y = 0; y < 8; y++) {
				uint32_t word = 0;
				for (int x = 0; x < 8; x++) {
					word = (word << 4) | ((lines[y] & (0x80 >> x)) ? 15u : (pause ? 13u : 0u));
				}
				menu_tiles.push_back(int32_t(word));
			}
		}
		menu_vram = menu_tiles.size() / 8;
		background_tiles += menu_vram;
	}

	String menu_tables(bool p_window_top, int p_fixed_rows, bool p_has_sprites) const {
		if (!menu) {
			return String();
		}
		const bool pause = menu->get_tipo() == MDMenu::TIPO_PAUSA;
		String c = U("// ---- Menu (MDMenu) ----\nstatic const u32 menu_tiles[] = {\n");
		for (int i = 0; i < menu_tiles.size(); i++) {
			c += vformat("%s0x%08X,%s", i % 8 == 0 ? "\t" : "", uint32_t(menu_tiles[i]), i % 8 == 7 ? "\n" : " ");
		}
		c += "};\n";
		for (int t = 0; t < menu_texts.size(); t++) {
			c += vformat("static const u8 menu_texto_%d[] = %s;\n", t, dialog_bytes(menu_texts[t]));
		}
		c += "static const u8 *const menu_textos[] = { ";
		for (int t = 0; t < menu_texts.size(); t++) {
			c += vformat("%smenu_texto_%d", t ? ", " : "", t);
		}
		c += " };\nstatic const u8 menu_itens[] = { ";
		for (int i = 0; i < menu_items.size(); i++) {
			c += (i ? ", " : "") + itos(menu_items[i]);
		}
		c += " };\n";
		const String sprite_vram = p_has_sprites ? vformat(" - %d", MAX(1, sprite_tiles)) : String();
		const String cursor_sound = menu->get_som_cursor().is_empty() ? String("0") : sound_define(menu->get_som_cursor());
		const String choice_sound = menu->get_som_escolha().is_empty() ? String("0") : sound_define(menu->get_som_escolha());
		const int row = pause ? (p_window_top ? p_fixed_rows : 0) : menu_tile.y;
		c += vformat("static const MenuCena menu_cena = { menu_tiles, %d, %d%s - %d - %d, %s, %d, %d, %d, menu_textos, menu_itens, %d, %s, %d, %s, %s, %s, %s, %s };\n\n",
				menu_tiles.size() / 8, FONT_TILE_INDEX, sprite_vram, dialog_vram, menu_vram, pause ? "TRUE" : "FALSE", pause ? 0 : menu_tile.x, row, menu_width,
				menu_items.size(), menu_scene >= 0 ? scene_constant(menu_scene) : String("0"), pause ? 1 : menu->get_slots(), cursor_sound, choice_sound,
				vdp_color(menu->get_cor_fundo()), vdp_color(menu->get_cor_borda()), vdp_color(menu->get_cor_texto()));
		if (pause) {
			c += "static u16 menu_botoes_antes;\n\n";
		}
		return c;
	}

	// Começo da cena_<nome>_atualizar: título anda o menu; pausa abre com START e para a cena.
	String menu_update_head() const {
		if (!menu) {
			return String();
		}
		if (menu->get_tipo() == MDMenu::TIPO_TITULO) {
			return "\tmenu_atualizar();\n";
		}
		String c = U("\t{ // Pausa (MDMenu): START abre o menu e a cena fica parada.\n\t\tconst u16 botoes = jogo_ler(JOY_1);\n\t\tconst bool start = (botoes & BUTTON_START) && !(menu_botoes_antes & BUTTON_START);\n\t\tmenu_botoes_antes = botoes;\n"
					 "\t\tif (menu_aberto()) {\n\t\t\tmenu_atualizar();\n\t\t\tif (!menu_aberto()) {\n\t\t\t\tif (jogo_musica_ligada) {\n\t\t\t\t\tXGM_resumePlay();\n\t\t\t\t}\n\t\t\t\tmenu_botoes_antes = jogo_ler(JOY_1);\n");
		if (player) {
			c += "\t\t\t\tjogador_botoes_antes = menu_botoes_antes;\n";
		}
		c += "\t\t\t}\n\t\t\treturn;\n\t\t}\n\t\tif (start) {\n\t\t\tXGM_pausePlay();\n\t\t\tmenu_abrir();\n\t\t\treturn;\n\t\t}\n\t}\n";
		return c;
	}

	void finish_maps() {
		int map_tiles = 0;
		for (const MapEntry &entry : maps) {
			map_tiles += entry.tiles;
		}
		// A prioridade por célula (MDPrioridade, mapa "na frente") vai nas palavras prontas do streaming.
		const bool stream = image_tiles + map_tiles > FREE_VRAM_TILES - sprite_tiles || !priority_cells[0].is_empty() || !priority_cells[1].is_empty();
		background_tiles = image_tiles;
		// Os mapas com streaming ficam no começo da VRAM livre (TILE_USER_INDEX = 16 no SGDK), antes das
		// imagens: assim o tile de cada vaga é conhecido no build e vai pronto nas palavras do mapa.
		int stream_base = 16;
		String stream_code;
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
				// A água que corre desloca as linhas até um período: essas linhas carregam colunas a mais.
				for (const WaterEntry &water : waters) {
					if (water.flowing && water.plane == (entry.node->get_plano() == MDFundo::PLANO_A ? 1 : 0)) {
						const int top = water.y0 / 8, bottom = (water.y1 + 7) / 8;
						if (entry.margin == 0) {
							entry.margin_y0 = top;
							entry.margin_y1 = bottom;
						}
						entry.margin = MAX(entry.margin, (water.period + 7) / 8);
						entry.margin_y0 = MIN(entry.margin_y0, top);
						entry.margin_y1 = MAX(entry.margin_y1, bottom);
					}
				}
				entry.slots = build_stream(entry, patterns, cells);
				entry.patterns = patterns.size() / 32;
				entry.streaming = true;
				// MDPrioridade: o bit 15 da célula põe o tile na frente dos sprites sem prioridade.
				const HashSet<Vector2i> &front = priority_cells[entry.node->get_plano() == MDFundo::PLANO_A ? 1 : 0];
				if (!front.is_empty()) {
					const Vector2i origin = Vector2i(entry.node->get_position()) / 8;
					const int columns = entry.size.x / 8;
					for (int c = 0; c < cells.size(); c++) {
						if (cells[c] && front.has(origin + Vector2i(c % columns, c / columns))) {
							cells.write[c] |= 0x8000;
						}
					}
				}
				if (entry.patterns > 4095) {
					result.errors.push_back(scene_label + entry.name + vformat(U(": %d padrões de 8×8 diferentes; o streaming guarda até 4095 por mapa."), entry.patterns));
				}
				// Vagas fixas (o pior caso dinâmico fica só como referência na mensagem).
				const int peak = entry.slots;
				Vector<uint16_t> slot_of;
				entry.slots = assign_slots(entry, cells, entry.patterns, slot_of);
				entry.base = stream_base;
				stream_base += entry.slots;
				if (stream_base > 2047) {
					result.errors.push_back(scene_label + entry.name + U(": as vagas dos mapas passam do fim da VRAM de tiles."));
				}
				// Palavras prontas do plano (tile da vaga, paleta, espelhos e prioridade), por linhas e por colunas.
				const int cols = entry.size.x / 8, rows = entry.size.y / 8;
				Vector<uint16_t> words, slots_table;
				words.resize(cells.size());
				for (int c = 0; c < cells.size(); c++) {
					const uint16_t cell = cells[c];
					words.write[c] = cell ? uint16_t((entry.node->get_paleta() << 13) | (cell & 0x8000) | ((cell & 0x3000) >> 1) | (entry.base + slot_of[(cell & 0x0FFF) - 1])) : 0;
				}
				for (int pat = 0; pat < slot_of.size(); pat++) {
					slots_table.push_back(uint16_t(entry.base + slot_of[pat]));
				}
				// No 68000 os dados ficam em big-endian.
				auto big_endian = [](const Vector<uint16_t> &p_values) {
					Vector<uint8_t> bytes;
					bytes.resize(p_values.size() * 2);
					for (int i = 0; i < p_values.size(); i++) {
						bytes.write[i * 2] = p_values[i] >> 8;
						bytes.write[i * 2 + 1] = p_values[i] & 255;
					}
					return bytes;
				};
				Vector<uint16_t> by_columns;
				by_columns.resize(cells.size());
				for (int x = 0; x < cols; x++) {
					for (int y = 0; y < rows; y++) {
						by_columns.write[x * rows + y] = words[y * cols + x];
					}
				}
				const Vector<uint8_t> datas[5] = { patterns, big_endian(cells), big_endian(slots_table), big_endian(words), big_endian(by_columns) };
				const char *kinds[5] = { "padroes", "celulas", "vagas", "linhas", "colunas" };
				for (int k = 0; k < 5; k++) {
					Asset asset;
					asset.kind = "BIN";
					asset.symbol = entry.symbol + "_" + kinds[k];
					asset.file = "gerado/" + asset.symbol + ".bin";
					write_bytes("res/" + asset.file, datas[k]);
					assets.push_back(asset);
				}
				result.info.push_back(vformat(U("%s%s: streaming com %d vagas fixas para %d padrões (pior janela: %d)."), scene_label, entry.name, entry.slots, entry.patterns, peak));
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
				stream_code += vformat(U("\t// %s (streaming: %d padrões em %d vagas fixas, tiles %d a %d)\n\tstream_preparar(&%s);\n\ttile += %d;\n"), entry.name, entry.patterns, entry.slots, entry.base, entry.base + entry.slots - 1, entry.variable, entry.slots);
			}
			draw_code = draw_code.replace(vformat("@@MAPA_%d@@", i), code);
		}
		draw_code = stream_code + draw_code; // As vagas dos mapas vêm primeiro na VRAM.
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

	// Água (MDCorrenteza): rolagem por linha. Cada plano tem a tabela das 224 linhas com a rolagem normal,
	// e as linhas das áreas ganham o deslocamento da correnteza ou da ondulação.
	String water_code(const String &p_shake_x) const {
		String base[2];
		for (int plane = 0; plane < 2; plane++) {
			const String name = plane ? "BG_A" : "BG_B";
			base[plane] = "0";
			for (const ParallaxEntry &parallax : parallaxes) {
				if (parallax.plane == name) {
					base[plane] = vformat("-(s16)((s32)camera_x * %d / 100)", parallax.percent);
				}
			}
			for (const MapEntry &entry : maps) {
				if ((entry.node->get_plano() == MDFundo::PLANO_A) == (plane == 1)) {
					base[plane] = entry.streaming ? vformat("-(plano_x[%d]", plane) + p_shake_x + ")" : vformat("-plano_x[%d]", plane);
				}
			}
		}
		String c = U("// Água e nuvens (MDCorrenteza): rolagem por linha dos dois planos.\nstatic s16 agua_linhas[2][224]; // 0 = BG B, 1 = BG A.\nstatic u16 agua_quadros;\n"
					 "static s16 plano_x[2], plano_y[2]; // Onde cada plano está (o mapa com parallax anda menos que a câmera).\n");
		for (int i = 0; i < waters.size(); i++) {
			if (waters[i].flowing) {
				c += vformat("static u32 agua_fase_%d; // %s: 1/256 px.\n", i, waters[i].name);
			}
		}
		bool waves = false;
		for (const WaterEntry &w : waters) {
			waves = waves || !w.flowing;
		}
		if (waves) {
			c += U("static const s8 agua_onda[8] = { 0, 1, 2, 1, 0, -1, -2, -1 };\n");
		}
		c += U("\nstatic void agua_atualizar(void) {\n");
		c += vformat("\tconst s16 base_b = %s, base_a = %s;\n\tfor (u16 i = 0; i < 224; i++) {\n\t\tagua_linhas[0][i] = base_b;\n\t\tagua_linhas[1][i] = base_a;\n\t}\n\tagua_quadros++;\n", base[0], base[1]);
		for (int i = 0; i < waters.size(); i++) {
			const WaterEntry &w = waters[i];
			c += vformat(U("\t{ // %s\n\t\ts16 de = %d - plano_y[%d], ate = %d - plano_y[%d];\n\t\tif (de < 0) {\n\t\t\tde = 0;\n\t\t}\n\t\tif (ate > 224) {\n\t\t\tate = 224;\n\t\t}\n\t\ts16 *linhas = agua_linhas[%d];\n\t\tconst s16 base = %s;\n"),
					w.name, w.y0, w.plane, w.y1, w.plane, w.plane, w.plane ? "base_a" : "base_b");
			if (w.flowing && w.own_scroll) {
				// Parallax próprio (nuvens): a faixa anda scroll% da câmera mais o deslize. Como o desenho se repete
				// no período, mostra-se o mesmo desenho a até um período da janela que o plano já tem carregada.
				c += vformat(U("\t\tagua_fase_%d += %d; // %d px/s.\n\t\tif (agua_fase_%d >= %d) {\n\t\t\tagua_fase_%d -= %d;\n\t\t}\n\t\ts32 d = (s32)camera_x * %d / 100 - plano_x[%d] %s (s32)(agua_fase_%d >> 8); // Rolagem de %d%%.\n\t\td %%= %d;\n\t\tif (d < 0) {\n\t\t\td += %d;\n\t\t}\n\t\tconst s16 desloca = (s16)d;\n\t\tfor (s16 l = de; l < ate; l++) {\n\t\t\tlinhas[l] = base - desloca;\n\t\t}\n"),
						i, w.speed * 256 / 60, w.speed, i, w.period * 256, i, w.period * 256, w.scroll, w.plane, w.right ? "-" : "+", i, w.scroll, w.period, w.period);
			} else if (w.flowing) {
				// Correnteza: a fase anda velocidade px/s e volta ao chegar no período.
				c += vformat(U("\t\tagua_fase_%d += %d; // %d px/s.\n\t\tif (agua_fase_%d >= %d) {\n\t\t\tagua_fase_%d -= %d;\n\t\t}\n\t\tconst s16 desloca = %s;\n\t\tfor (s16 l = de; l < ate; l++) {\n\t\t\tlinhas[l] = base - desloca;\n\t\t}\n"),
						i, w.speed * 256 / 60, w.speed, i, w.period * 256, i, w.period * 256,
						w.right ? vformat("%d - (s16)(agua_fase_%d >> 8)", w.period - 1, i) : vformat("(s16)(agua_fase_%d >> 8)", i));
			} else {
				// Ondulação: faixas de 4 linhas (a primeira parada) vão para lados opostos, em compasso.
				c += vformat(U("\t\tconst s16 onda = agua_onda[(u16)((u32)agua_quadros * %d / 60) & 7] * %d / 2;\n\t\tfor (s16 l = de; l < ate; l++) {\n\t\t\tconst s16 linha = l + plano_y[%d] - %d;\n\t\t\tif (linha & 3) {\n\t\t\t\tlinhas[l] = base + (linha & 4 ? -onda : onda);\n\t\t\t}\n\t\t}\n"),
						w.steps, w.amplitude, w.plane, w.y0);
			}
			c += "\t}\n";
		}
		c += "\tVDP_setHorizontalScrollLine(BG_B, 0, agua_linhas[0], 224, DMA_QUEUE);\n\tVDP_setHorizontalScrollLine(BG_A, 0, agua_linhas[1], 224, DMA_QUEUE);\n}\n\n";
		return c;
	}

	// Tipos dos atores da cena: o código (símbolos fracos: sem o arquivo, o ator fica parado), o desenho,
	// o corpo e as tabelas de tempo das animações.
	String actor_types() const {
		if (actors.is_empty()) {
			return String();
		}
		String c = U("// Atores (MDAtor): o código de cada um é opcional (símbolos fracos).\n");
		HashSet<String> declared;
		for (const ActorEntry &entry : actors) {
			if (!entry.prefix.is_empty() && !declared.has(entry.prefix)) {
				declared.insert(entry.prefix);
				c += vformat("void %s_pronto(Ator *eu) __attribute__((weak));\nvoid %s_quadro(Ator *eu) __attribute__((weak));\nvoid %s_cenario(Ator *eu, u8 tipo) __attribute__((weak));\n", entry.prefix, entry.prefix, entry.prefix);
			}
		}
		for (const ActorEntry &entry : actors) {
			c += "static const AtorTipo " + entry.type + " = " + type_initializer(entry) + "; // " + String(entry.node->get_name()) + "\n";
		}
		return c + "\n";
	}

	String type_initializer(const ActorEntry &p_entry) const {
		const Asset &asset = assets[p_entry.asset];
		const bool timed = !asset.timers.is_empty();
		const int cell_w = asset.cell_w > 0 ? asset.cell_w : asset.frame_tiles_w * 8;
		const int anim = timed ? MAX(0, p_entry.node->get_used_row(p_entry.node->get_animacao())) : 0;
		const String code = p_entry.prefix.is_empty() ? String("NULL, NULL") : p_entry.prefix + "_pronto, " + p_entry.prefix + "_quadro";
		const String scenery_hook = p_entry.prefix.is_empty() ? String("NULL") : p_entry.prefix + "_cenario";
		return vformat("{ %s, &%s, TILE_ATTR(PAL%d, %s, FALSE, FALSE), %d, %d, %d, %d, %d, %d, %d, %s, %s, %s, %s, %d, %d, 0x%04x, %s, %s, %s, %s, %s, %s, %d }",
				code, asset.symbol, p_entry.node->get_paleta(), p_entry.node->get_prioridade() ? "TRUE" : "FALSE", p_entry.anchor.x, p_entry.anchor.y, cell_w,
				p_entry.body.position.x, p_entry.body.position.y, p_entry.body.size.x, p_entry.body.size.y,
				timed ? asset.symbol + "_tempos" : String("NULL"), timed ? asset.symbol + "_quadros" : String("NULL"), timed ? asset.symbol + "_repete" : String("NULL"),
				timed && asset.has_frame_sounds ? asset.symbol + "_sons" : String("NULL"), anim, p_entry.node->get_vida(), p_entry.groups, p_entry.node->get_fixo_na_tela() ? "TRUE" : "FALSE", p_entry.node->get_vram_da_fonte() ? "TRUE" : "FALSE", p_entry.node->get_dorme_longe() ? "TRUE" : "FALSE",
				p_entry.node->get_respeita_limite() ? "TRUE" : "FALSE", p_entry.node->get_dano_do_cenario() ? "TRUE" : "FALSE", scenery_hook, p_entry.duracao);
	}

	// Tabelas de tempo (e de som) das animações de um personagem, como static.
	String timing_tables(int p_asset) const {
		const Asset &asset = assets[p_asset];
		if (asset.timers.is_empty()) {
			return String();
		}
		String c;
		String table = vformat("static const u8 *const %s_tempos[] = {", asset.symbol);
		String counts = vformat("static const u8 %s_quadros[] = {", asset.symbol);
		String loops = vformat("static const u8 %s_repete[] = {", asset.symbol);
		for (int a = 0; a < asset.frame_ticks.size(); a++) {
			c += vformat("static const u8 %s_tempos_%d[] = {", asset.symbol, a);
			for (int f = 0; f < asset.frame_ticks[a].size(); f++) {
				c += (f ? ", " : "") + itos(asset.frame_ticks[a][f]);
			}
			c += "};\n";
			table += vformat("%s%s_tempos_%d", a ? ", " : "", asset.symbol, a);
			counts += (a ? ", " : "") + itos(asset.frame_ticks[a].size());
			loops += (a ? ", " : "") + String(asset.loops[a] ? "1" : "0");
		}
		c += table + "};\n" + counts + "};\n" + loops + "};\n";
		if (asset.has_frame_sounds) {
			String sound_table = vformat("static const u8 *const %s_sons[] = {", asset.symbol);
			for (int a = 0; a < asset.frame_sounds.size(); a++) {
				c += vformat("static const u8 %s_sons_%d[] = {", asset.symbol, a);
				for (int f = 0; f < asset.frame_sounds[a].size(); f++) {
					c += (f ? ", " : "") + (asset.frame_sounds[a][f].is_empty() ? String("0") : sound_define(asset.frame_sounds[a][f]));
				}
				c += "};\n";
				sound_table += vformat("%s%s_sons_%d", a ? ", " : "", asset.symbol, a);
			}
			c += sound_table + "};\n";
		}
		return c;
	}

	// gerado/tipos.c: os tipos que o código cria com criar_ator(&TIPO_..., x, y).
	String types_source() const {
		String c = String(GENERATED_MARK) + U(". Não edite: o arquivo é refeito no build.\n// Tipos de ator criados pelo código (TIPO_<NOME> = <nome>.tscn com um MDAtor na raiz).\n#include \"atores.h\"\n\n");
		HashSet<int> tables;
		HashSet<String> declared;
		for (const ActorEntry &entry : templates) {
			if (!tables.has(entry.asset)) {
				tables.insert(entry.asset);
				c += timing_tables(entry.asset);
			}
			if (!entry.prefix.is_empty() && !declared.has(entry.prefix)) {
				declared.insert(entry.prefix);
				c += vformat("void %s_pronto(Ator *eu) __attribute__((weak));\nvoid %s_quadro(Ator *eu) __attribute__((weak));\nvoid %s_cenario(Ator *eu, u8 tipo) __attribute__((weak));\n", entry.prefix, entry.prefix, entry.prefix);
			}
		}
		for (const ActorEntry &entry : templates) {
			c += "const AtorTipo " + entry.type + " = " + type_initializer(entry) + "; // " + entry.node->get_scene_file_path() + "\n";
		}
		return c;
	}

	// gerado/atores.h: a API dos atores e os grupos do jogo.
	String actors_header() const {
		String c = String(GENERATED_MARK) + U(". Não edite: o arquivo é refeito no build.\n#pragma once\n\n#include \"ator.h\"\n\n// Grupos dos atores (aba Grupos de cada MDAtor); some para juntar: GRUPO_A | GRUPO_B.\n");
		Vector<String> names;
		for (const KeyValue<String, int> &group : group_bits) {
			names.push_back(group.key);
		}
		names.sort();
		for (const String &name : names) {
			c += vformat("#define GRUPO_%s 0x%04x\n", name, 1 << group_bits[name]);
		}
		if (!custom_types.is_empty()) {
			c += U("\n// Tipos de colisão com nome próprio (dado \"tipo\" do TileSet da MDColisao): não bloqueiam; o código decide o efeito.\n");
			for (const KeyValue<String, int> &tipo : custom_types) {
				c += vformat("#define CELULA_%s %d\n", tipo.key, tipo.value);
			}
		}
		if (!templates.is_empty()) {
			c += U("\n// Tipos para criar_ator(&TIPO_..., x, y): as cenas com um MDAtor na raiz que o código cita.\n");
			for (const ActorEntry &entry : templates) {
				c += "extern const AtorTipo " + entry.type + "; // " + entry.node->get_scene_file_path() + "\n";
			}
		}
		return c;
	}

	// gerado/codigo_<prefixo>.h: o que o código de um ator inclui (animações do personagem e as funções).
	String script_header(const String &p_prefix, const ScriptInfo &p_info) const {
		String c = String(GENERATED_MARK) + U(" para ") + p_info.path + U(". Não edite: o arquivo é refeito no build.\n#pragma once\n\n#include \"atores.h\"\n");
		const PackedStringArray &anim_names = p_info.asset >= 0 ? assets[p_info.asset].anim_names : p_info.anim_names;
		if (p_info.asset < 0) {
			c += U("\n// Nenhum MDAtor usa este código: ele compila, mas não entra no jogo. Os ANIM_ abaixo são os que ele cita.\n");
		}
		if (!anim_names.is_empty()) {
			c += U("\n// Animações do personagem, para tocar_animacao(eu, ANIM_...).\n");
			HashSet<String> used;
			for (int i = 0; i < anim_names.size(); i++) {
				String name = "ANIM_" + identifier(anim_names[i]).to_upper();
				for (int n = 2; used.has(name); n++) {
					name = "ANIM_" + identifier(anim_names[i]).to_upper() + "_" + itos(n);
				}
				used.insert(name);
				c += vformat("#define %s %d\n", name, i);
			}
		}
		c += vformat(U("\n// Escreva estas funções em %s.\nvoid %s_pronto(Ator *eu); // Quando o ator aparece.\nvoid %s_quadro(Ator *eu); // A cada quadro.\n// Opcional: no lugar do efeito pronto, a cada quadro que o corpo toca dano ou morte do cenário\n// (tipo = CELULA_DANO ou CELULA_MORTE).\nvoid %s_cenario(Ator *eu, u8 tipo);\n"), p_info.path.get_file(), p_prefix, p_prefix, p_prefix);
		return c;
	}

	String sound_define(const String &p_path) const {
		return assets[asset_by_key["WAV|" + p_path]].define;
	}

	// A animação em autoplay do AnimationPlayer vira tabelas, um valor por quadro (60 por segundo), das
	// trilhas de position, frame, visible, flip_h e animacao (personagens) de MDSprites comuns.
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
			const bool supported = animation->track_get_type(t) == Animation::TYPE_VALUE && (property == "position" || property == "frame" || property == "visible" || property == "flip_h" || property == "animacao");
			if (sprite < 0 || !supported) {
				result.warnings.push_back(scene_label + vformat(U("%s: a trilha %s não vai para o jogo (só position, frame, visible, flip_h e animacao de MDSprites)."), player_name, String(path)));
				continue;
			}
			const bool character = sprites[sprite].node->get_personagem().is_valid();
			if ((property == "animacao" && !character) || (property == "frame" && character)) {
				result.warnings.push_back(scene_label + vformat(U("%s: a trilha %s é ignorada (num sprite com personagem, troque a animação pela trilha animacao; sem personagem, pela frame)."), player_name, String(path)));
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
				baked.write[0].kind = property == "frame" ? "quadro" : property == "visible" ? "visivel" : property == "flip_h" ? "espelho" : "anim";
			}
			for (int i = 0; i < animation_frames; i++) {
				const Variant value = animation->value_track_interpolate(t, i / 60.0);
				if (property == "position") {
					const Vector2 position = Vector2(value) + offset - Vector2(entry.node->get_apoio());
					baked.write[0].values.push_back(int(Math::round(position.x)));
					baked.write[1].values.push_back(int(Math::round(position.y)));
				} else if (property == "frame") {
					baked.write[0].values.push_back(int(Math::round(double(value))));
				} else if (property == "animacao") {
					baked.write[0].values.push_back(exported_index(entry, value, 0));
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
			} else if (track.kind == "anim") {
				// SPR_setAnim só recomeça a animação quando ela muda.
				c += vformat("\tSPR_setAnim(%s, %s);\n", entry.variable, value_of(i));
			} else if (track.kind == "espelho") {
				// Espelha dentro da célula, como o Sprite2D no editor.
				c += vformat("\tSPR_setHFlip(%s, %s);\n", entry.variable, value_of(i));
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

	// Tabela do trajeto (x, y por posição) e o passo dele: ida e volta, ou dando a volta (ciclo).
	static String path_table(const SpriteEntry &p_entry) {
		String c = vformat(U("static const s16 %s_trajeto[%d] = { // MDTrajeto: x, y a cada quadro.\n"), p_entry.prefix, p_entry.path.size() * 2);
		for (int i = 0; i < p_entry.path.size(); i++) {
			c += vformat("%s%d, %d,%s", i % 8 == 0 ? "\t" : "", p_entry.path[i].x, p_entry.path[i].y, i % 8 == 7 ? "\n" : " ");
		}
		return c + "\n};\n";
	}

	static String path_step(const SpriteEntry &p_entry) {
		const String v = p_entry.prefix;
		const int count = p_entry.path.size();
		String c;
		if (p_entry.path_loop) {
			c += vformat("\tif (++%s_passo >= %d) {\n\t\t%s_passo = 0;\n\t}\n", v, count, v);
		} else {
			c += vformat("\t%s_passo += %s_dir;\n\tif (%s_passo >= %d) {\n\t\t%s_passo = %d;\n\t\t%s_dir = -1;\n\t} else if (%s_passo <= 0) {\n\t\t%s_passo = 0;\n\t\t%s_dir = 1;\n\t}\n",
					v, v, v, count - 1, v, count - 1, v, v, v, v);
		}
		c += vformat("\t%s_x = %s_trajeto[%s_passo * 2];\n\t%s_y = %s_trajeto[%s_passo * 2 + 1];\n", v, v, v, v, v, v);
		return c;
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
			if (!entry.path.is_empty()) {
				code += path_table(entry);
			}
			const String v = entry.prefix;
			const Rect2i box = entry.platform->get_caixa_efetiva();
			const Vector2i offset = entry.platform->get_deslocamento();
			const int length = MAX(1, MAX(Math::abs(offset.x), Math::abs(offset.y)));
			code += vformat(U("// Plataforma %s: de (%d, %d) a (%d, %d).\nstatic void %s_mover(void) {\n"), entry.node->get_name(), entry.position.x, entry.position.y, entry.position.x + offset.x, entry.position.y + offset.y, v);
			if (carries) {
				code += vformat("\tconst s16 antes_x = %s_x, antes_y = %s_y;\n\tconst bool levando = jogador_sobre(antes_x + %d, antes_y + %d, %d);\n", v, v, box.position.x, box.position.y, box.size.x);
			}
			if (!entry.path.is_empty()) {
				code += path_step(entry);
			} else {
				code += vformat("\t%s_passo += %s_dir * %d;\n\tif (%s_passo >= %d) {\n\t\t%s_passo = %d;\n\t\t%s_dir = -1;\n\t} else if (%s_passo <= 0) {\n\t\t%s_passo = 0;\n\t\t%s_dir = 1;\n\t}\n",
						v, v, entry.platform->get_velocidade(), v, length, v, length, v, v, v, v);
				code += vformat("\t%s_x = %d + (s32)%d * %s_passo / %d;\n\t%s_y = %d + (s32)%d * %s_passo / %d;\n", v, entry.position.x, offset.x, v, length, v, entry.position.y, offset.y, v, length);
			}
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
					// O rescomp do SGDK 1.81 só aceita um tempo por sprite: com 0, quem dá o tempo de cada
					// quadro é o <sprite>_quadro_mudou gerado (tempos do gestor de animações).
					res += vformat("SPRITE %s \"%s\" %d %d NONE 0 NONE\n", asset.symbol, asset.file, asset.frame_tiles_w, asset.frame_tiles_h);
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

	// Animação do personagem do jogador com esse nome (nula se não houver).
	const MDPersonagem::Animacao *player_anim(const String &p_name) const {
		if (!player || player->get_personagem().is_null() || p_name.is_empty()) {
			return nullptr;
		}
		const int found = player->get_personagem()->find_animation(p_name);
		return found >= 0 ? &player->get_personagem()->get_animations()[found] : nullptr;
	}

	// Animação de derrota do inimigo (nula se não houver).
	const MDPersonagem::Animacao *enemy_defeat_anim(const SpriteEntry &p_entry) const {
		const Ref<MDPersonagem> personagem = p_entry.enemy ? p_entry.enemy->get_personagem() : Ref<MDPersonagem>();
		const int found = personagem.is_valid() && !p_entry.enemy->get_anim_derrota().is_empty() ? personagem->find_animation(p_entry.enemy->get_anim_derrota()) : -1;
		return found >= 0 ? &personagem->get_animations()[found] : nullptr;
	}

	// Duração da animação em quadros de vídeo (soma dos tempos dos quadros).
	static int anim_ticks(const MDPersonagem::Animacao *p_anim) {
		int ticks = 0;
		for (const MDPersonagem::Quadro &q : p_anim->frames) {
			ticks += q.ticks;
		}
		return MAX(1, ticks);
	}

	// O jogador ataca com B quando tem animação de ataque.
	bool player_attacks() const {
		return player_anim(player ? player->get_anim_ataque() : String()) != nullptr;
	}

	// Visto de cima não há queda; espinhos matam nos dois modos.
	// Câmera seguindo o jogador: folga no meio da tela, olhar à frente, zonas que a prendem e suavidade.
	// Sem MDCamera, folga 0 e sem suavidade: centrada no jogador (presa às bordas do mundo).
	String camera_code() const {
		// O alvo: o MDJogador ou, sem ele, o ator com camera_segue (ator_camera, que o código pode trocar).
		String center_x, center_y, moved_x;
		if (player) {
			const Rect2i box = player->get_caixa_efetiva();
			center_x = vformat("jogador_x + %d", box.position.x + box.size.x / 2);
			center_y = vformat("(jogador_y16 >> 4) + %d", box.position.y + box.size.y / 2);
			moved_x = "jogador_x";
		} else {
			center_x = "centro_x(ator_camera)";
			center_y = "centro_y(ator_camera)";
			moved_x = "PIXELS(ator_camera->x)";
		}
		const Vector2i slack = camera ? camera->get_folga() : Vector2i();
		const int ahead = camera ? camera->get_a_frente() : 0;
		const int smooth = camera ? camera->get_suavidade() : 0;
		const int w = RetroMD::SCREEN_WIDTH, h = RetroMD::SCREEN_HEIGHT;
		String c;
		if (ahead > 0) {
			c += U("static s16 camera_frente; // Deslocamento atual para a frente do jogador.\nstatic s16 camera_jogador_antes;\nstatic s8 camera_olha = 1; // Para onde o jogador andou por último.\n");
		}
		if (!camera_zones.is_empty()) {
			c += vformat(U("// Zonas da câmera (MDZonaCamera): x, y, largura, altura.\n#define CAMERA_ZONAS %d\nstatic const s16 camera_zonas[CAMERA_ZONAS][4] = {\n"), camera_zones.size());
			for (const Rect2i &zone : camera_zones) {
				c += vformat("\t{ %d, %d, %d, %d },\n", zone.position.x, zone.position.y, zone.size.x, zone.size.y);
			}
			c += "};\n";
		}
		c += "\nstatic void camera_seguir(void) {\n";
		if (!actors.is_empty()) {
			c += U("\tif (atores_camera(&camera_x, &camera_y)) { // O código dos atores posiciona a câmera.\n\t\tcamera_pronta = TRUE;\n\t\treturn;\n\t}\n");
		}
		if (!player) {
			c += "\tif (!ator_camera) {\n\t\treturn;\n\t}\n";
		}
		c += vformat("\tconst s16 meio_x = %s, meio_y = %s; // Meio da caixa do jogador.\n\ts16 px = meio_x;\n\tconst s16 py = meio_y;\n", center_x, center_y);
		if (ahead > 0) {
			c += vformat("\tconst s16 andou_x = %s;\n\tif (andou_x > camera_jogador_antes) {\n\t\tcamera_olha = 1;\n\t} else if (andou_x < camera_jogador_antes) {\n\t\tcamera_olha = -1;\n\t}\n\tcamera_jogador_antes = andou_x;\n"
						 "\tconst s16 frente = camera_olha * %d;\n\tif (!camera_pronta) {\n\t\tcamera_frente = frente;\n\t} else if (camera_frente < frente) {\n\t\tcamera_frente = min(camera_frente + 2, frente);\n\t} else if (camera_frente > frente) {\n\t\tcamera_frente = max(camera_frente - 2, frente);\n\t}\n\tpx += camera_frente;\n",
					moved_x, ahead);
		}
		c += vformat("\ts16 alvo_x = camera_x, alvo_y = camera_y;\n\tif (!camera_pronta) {\n\t\talvo_x = px - %d;\n\t\talvo_y = py - %d;\n\t}\n", w / 2, h / 2);
		c += vformat(U("\t// Folga: a câmera só anda quando o jogador sai da área de %d×%d no meio da tela.\n"), slack.x, slack.y);
		c += vformat("\tif (px < camera_x + %d) {\n\t\talvo_x = px - %d;\n\t} else if (px > camera_x + %d) {\n\t\talvo_x = px - %d;\n\t}\n", w / 2 - slack.x / 2, w / 2 - slack.x / 2, w / 2 + slack.x / 2, w / 2 + slack.x / 2);
		c += vformat("\tif (py < camera_y + %d) {\n\t\talvo_y = py - %d;\n\t} else if (py > camera_y + %d) {\n\t\talvo_y = py - %d;\n\t}\n", h / 2 - slack.y / 2, h / 2 - slack.y / 2, h / 2 + slack.y / 2, h / 2 + slack.y / 2);
		c += "\ts16 x0 = 0, y0 = 0, x1 = MUNDO_LARGURA, y1 = MUNDO_ALTURA;\n";
		if (!camera_zones.is_empty()) {
			c += U("\tfor (u16 i = 0; i < CAMERA_ZONAS; i++) { // A primeira zona com o jogador dentro prende a câmera.\n\t\tconst s16 *z = camera_zonas[i];\n\t\tif (meio_x >= z[0] && meio_x < z[0] + z[2] && meio_y >= z[1] && meio_y < z[1] + z[3]) {\n\t\t\tx0 = z[0];\n\t\t\ty0 = z[1];\n\t\t\tx1 = z[0] + z[2];\n\t\t\ty1 = z[1] + z[3];\n\t\t\tbreak;\n\t\t}\n\t}\n");
		}
		c += vformat(U("\t// Área menor que a tela: centrada nela.\n\talvo_x = x1 - x0 <= %d ? x0 - (%d - (x1 - x0)) / 2 : clamp(alvo_x, x0, x1 - %d);\n\talvo_y = y1 - y0 <= %d ? y0 - (%d - (y1 - y0)) / 2 : clamp(alvo_y, y0, y1 - %d);\n"), w, w, w, h, h, h);
		c += vformat("\talvo_x = clamp(alvo_x, 0, max(MUNDO_LARGURA - %d, 0));\n\talvo_y = clamp(alvo_y, 0, max(MUNDO_ALTURA - %d, 0));\n", w, h);
		if (smooth > 0) {
			c += vformat(U("\tif (camera_pronta) { // Anda 1/%d da distância por quadro (pelo menos 1 pixel).\n\t\ts16 d = alvo_x - camera_x;\n\t\ts16 passo = d >> %d;\n\t\tif (!passo && d) {\n\t\t\tpasso = d > 0 ? 1 : -1;\n\t\t}\n\t\talvo_x = camera_x + passo;\n\t\td = alvo_y - camera_y;\n\t\tpasso = d >> %d;\n\t\tif (!passo && d) {\n\t\t\tpasso = d > 0 ? 1 : -1;\n\t\t}\n\t\talvo_y = camera_y + passo;\n\t}\n"), 1 << smooth, smooth, smooth);
		}
		c += "\tcamera_x = alvo_x;\n\tcamera_y = alvo_y;\n\tcamera_pronta = TRUE;\n}\n\n";
		return c;
	}

	bool player_can_die() const {
		return player && (has_enemies() || (!collision.is_empty() && !top_down()) || has_tile_type(MDColisao::TIPO_ESPINHO) || has_tile_type(MDColisao::TIPO_MORTE));
	}

	// Com energia, um golpe tira energia (piscando, invencível) em vez da vida.
	bool player_energy() const {
		return player_can_die() && player->get_energia() > 0;
	}

	// O que acontece quando um inimigo ou um espinho pega o jogador.
	String hurt_call() const {
		return player_energy() ? "jogador_ferir();" : "jogador_morrer();";
	}

	bool player_death_anim() const {
		return player_can_die() && player_anim(player ? player->get_anim_morte() : String()) != nullptr;
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

	// Máscara A = 1, B = 2, C = 4 → "(BUTTON_A | BUTTON_C)".
	static String button_mask(int p_mask) {
		PackedStringArray names;
		static const char *BUTTONS[] = { "BUTTON_A", "BUTTON_B", "BUTTON_C", "BUTTON_X", "BUTTON_Y", "BUTTON_Z" }; // X, Y e Z: controle de 6 botões.
		for (int i = 0; i < 6; i++) {
			if (p_mask & (1 << i)) {
				names.push_back(BUTTONS[i]);
			}
		}
		return names.is_empty() ? String("0") : "(" + String(" | ").join(names) + ")";
	}

	String player_code(const SpriteEntry &p_entry) const {
		const Rect2i box = player->get_caixa_efetiva();
		// Com botão de correr, a velocidade sai da variável rapidez (lida a cada quadro).
		const String speed = player->get_botoes_correr() ? String("rapidez") : itos(player->get_velocidade());
		const String jump_sound = player->get_som_pulo().is_empty() ? String() : "\t\t\tjogo_som(" + sound_define(player->get_som_pulo()) + ");\n";
		String code = vformat(
				"\t{\n"
				"\t\tu16 botoes = jogo_ler(JOGADOR_CONTROLE);\n"
				"%s"
				"%s\t\ts16 dx = 0;\n"
				"\t\tif (botoes & BUTTON_LEFT) {\n"
				"\t\t\tdx = -%s;\n"
				"\t\t\tSPR_setHFlip(%s, TRUE);%s\n"
				"\t\t} else if (botoes & BUTTON_RIGHT) {\n"
				"\t\t\tdx = %s;\n"
				"\t\t\tSPR_setHFlip(%s, FALSE);%s\n"
				"\t\t}\n",
				player_energy() ? String(vformat("\t\tif (jogador_ferido) {\n\t\t\tjogador_ferido--;\n\t\t\tSPR_setVisibility(%s, (jogador_ferido & 4) ? HIDDEN : AUTO_FAST);\n\t\t}\n\t\tif (jogador_atordoado) {\n\t\t\tjogador_atordoado--;\n\t\t\tbotoes = 0;\n\t\t}\n", p_entry.variable)) : String(),
				player->get_botoes_correr() ? vformat("\t\tconst s16 rapidez = (botoes & CORRER) ? VELOCIDADE_CORRENDO : %d;\n", player->get_velocidade()) : String(),
				speed, p_entry.variable, flip_shift(p_entry) || player_attacks() || player_energy() ? "\n\t\t\tjogador_virado = TRUE;" : "", speed, p_entry.variable, flip_shift(p_entry) || player_attacks() || player_energy() ? "\n\t\t\tjogador_virado = FALSE;" : "");
		if (player_energy()) {
			// Atordoado depois de um golpe: sem controle, empurrado para trás.
			code += "\t\tif (jogador_atordoado) {\n\t\t\tdx = jogador_virado ? 1 : -1;\n\t\t}\n";
		}
		if (player_attacks()) {
			// B (ao apertar) começa o golpe: a animação de ataque toca até o fim, sem trocar pelo estado.
			const MDPersonagem::Animacao *attack = player_anim(player->get_anim_ataque());
			const int index = exported_index(p_entry, player->get_anim_ataque(), 0);
			code += vformat("\t\tif (jogador_atacando) {\n\t\t\tjogador_atacando--;\n\t\t} else if (botoes & ~jogador_botoes_antes & ATAQUE) {\n\t\t\tjogador_atacando = %d;\n\t\t\tjogador_animacao = %d;\n\t\t\tSPR_setAnim(%s, %d);\n%s\t\t}\n",
					anim_ticks(attack), index, p_entry.variable, index, player->get_som_ataque().is_empty() ? String() : "\t\t\tjogo_som(" + sound_define(player->get_som_ataque()) + ");\n");
		}
		if (player->get_modo() == MDJogador::MODO_VISTO_DE_CIMA) {
			// Visto de cima: 4 direções, sem gravidade; com mapa sólido, anda pixel a pixel em cada eixo.
			code += vformat("\t\ts16 dy = 0;\n\t\tif (botoes & BUTTON_UP) {\n\t\t\tdy = -%s;\n\t\t} else if (botoes & BUTTON_DOWN) {\n\t\t\tdy = %s;\n\t\t}\n", speed, speed);
			if (collision.is_empty()) {
				code += vformat("\t\tjogador_x = clamp(jogador_x + dx, 0, %d);\n\t\tjogador_y16 = clamp((jogador_y16 >> 4) + dy, 0, %d) << 4;\n",
						MAX(world.x, RetroMD::SCREEN_WIDTH) - box.position.x - box.size.x, MAX(world.y, RetroMD::SCREEN_HEIGHT) - box.position.y - box.size.y);
			} else {
				const String here = vformat("jogador_x + %d, (jogador_y16 >> 4) + %d, %d, %d", box.position.x, box.position.y, box.size.x, box.size.y);
				if (has_tile_type(MDColisao::TIPO_AGUA)) {
					code += "\t\tif (caixa_tem(" + here + ", AGUA)) {\n\t\t\tdx /= 2;\n\t\t\tdy /= 2;\n\t\t}\n";
				}
				if (has_tile_type(MDColisao::TIPO_ESPINHO)) {
					code += "\t\tif (caixa_tem(" + here + ", ESPINHO)) {\n\t\t\t" + hurt_call() + "\n\t\t}\n";
				}
				if (has_tile_type(MDColisao::TIPO_MORTE)) {
					code += U("\t\tif (caixa_tem(") + here + U(", MORTE)) {\n\t\t\tjogador_morrer(); // Abismo, lava: a vida inteira.\n\t\t}\n");
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
				code += "\t\tif (caixa_tem(" + here + ", ESPINHO)) {\n\t\t\t" + hurt_call() + "\n\t\t}\n";
			}
			if (has_tile_type(MDColisao::TIPO_MORTE)) {
				code += U("\t\tif (caixa_tem(") + here + U(", MORTE)) {\n\t\t\tjogador_morrer(); // Abismo, lava: a vida inteira.\n\t\t}\n");
			}
			code += "\t\tif ((jogador_y16 >> 4) > MAPA_ALTURA) {\n\t\t\tjogador_morrer();\n\t\t}\n";
		}
		code += "\t\tjogador_botoes_antes = botoes;\n";
		const String animation = player_animation(p_entry, "dx && jogador_no_chao", "!jogador_no_chao");
		PackedStringArray gates;
		if (player_attacks()) {
			gates.push_back("!jogador_atacando");
		}
		if (player_energy() && player_anim(player->get_anim_dano())) {
			gates.push_back("!jogador_atordoado"); // A animação de dano toca até o fim.
		}
		code += gates.is_empty() ? animation : "\t\tif (" + String(" && ").join(gates) + ")\n" + animation;
		if (player_attacks()) {
			// Caixa de ataque (relativa aos pés) nos quadros marcados; olhando para a esquerda, espelhada.
			const MDPersonagem::Animacao *attack = player_anim(player->get_anim_ataque());
			const Vector2i feet = player->get_personagem()->get_cell(player->get_used_animations()).anchor;
			const Rect2i hit = attack->attack_box;
			code += vformat(U("\t\tgolpe_ativo = jogador_atacando && %s->frameInd >= %d && %s->frameInd <= %d;\n"
							  "\t\tgolpe_x = jogador_x + %d + (jogador_virado ? %d : %d);\n"
							  "\t\tgolpe_y = (jogador_y16 >> 4) + %d;\n"),
					p_entry.variable, attack->attack ? attack->attack_first : 1, p_entry.variable, attack->attack ? attack->attack_last : 0,
					feet.x, -hit.position.x - hit.size.x, hit.position.x, feet.y + hit.position.y);
		}
		code += "\t}\n";
		return code;
	}

	// Patrulha entre os limites; com mapa sólido, vira em paredes e na beira do chão. Encostar no
	// jogador (caixas sobrepostas) custa uma vida.
	String enemy_code(const SpriteEntry &p_entry) const {
		const MDInimigo *enemy = p_entry.enemy;
		const Rect2i box = enemy->get_caixa_efetiva();
		const String v = p_entry.prefix;
		const int y = p_entry.position.y;
		const MDPersonagem::Animacao *defeat_anim = enemy_defeat_anim(p_entry);
		String code = p_entry.path.is_empty() ? String() : path_table(p_entry);
		code += vformat("static void %s_atualizar(void) {\n\tif (!%s_vivo) {\n", v, v);
		if (defeat_anim) {
			// Derrotado: a animação de derrota toca parada e o sprite some no fim.
			code += vformat("\t\tif (%s_morrendo && --%s_morrendo == 0) {\n\t\t\tSPR_setVisibility(%s, HIDDEN);\n\t\t}\n", v, v, p_entry.variable);
		}
		code += "\t\treturn;\n\t}\n";
		if (enemy->get_vida() > 1) {
			code += vformat("\tif (%s_ferido) {\n\t\t%s_ferido--;\n\t\tSPR_setVisibility(%s, (%s_ferido & 4) ? HIDDEN : AUTO_FAST);\n\t}\n", v, v, p_entry.variable, v);
		}
		const bool on_path = !p_entry.path.is_empty();
		const String enemy_y = on_path ? v + "_y" : itos(y);
		if (on_path) {
			// Segue o MDTrajeto (voa: sem gravidade nem paredes); olha para o lado em que anda.
			code += vformat("\tconst s16 antes_x = %s_x;\n", v) + path_step(p_entry);
			code += vformat("\tif (%s_x != antes_x) {\n\t\tSPR_setHFlip(%s, %s_x < antes_x);\n\t}\n", v, p_entry.variable, v);
		}
		code += on_path ? String() : vformat("\tconst s16 nx = %s_x + %s_dir * %d;\n", v, v, enemy->get_velocidade());
		String blocked = vformat("nx < %d || nx > %d", p_entry.position.x, p_entry.position.x + enemy->get_distancia());
		if (!on_path && !collision.is_empty() && enemy->get_vira_na_borda()) {
			blocked += vformat(" || caixa_solida(nx + %d, %d, %d, %d)", box.position.x, y + box.position.y, box.size.x, box.size.y);
			if (has_tile_type(MDColisao::TIPO_LIMITE)) {
				// Limite: parede invisível só para os inimigos.
				blocked += vformat(" || caixa_tem(nx + %d, %d, %d, %d, LIMITE)", box.position.x, y + box.position.y, box.size.x, box.size.y);
			}
			if (!top_down()) {
				// Parede na frente ou nenhum chão embaixo da ponta da frente.
				code += vformat("\tconst s16 frente = %s_dir > 0 ? nx + %d : nx + %d;\n", v, box.position.x + box.size.x - 1, box.position.x);
				blocked += vformat(" || !%s(frente, %d)", needs_floor_helper() ? "chao" : "solido", y + box.position.y + box.size.y);
			}
		}
		if (!on_path) {
			code += vformat("\tif (%s) {\n\t\t%s_dir = -%s_dir;\n\t} else {\n\t\t%s_x = nx;\n\t}\n\tSPR_setHFlip(%s, %s_dir < 0);\n", blocked, v, v, v, p_entry.variable, v);
		}
		if (player) {
			const Rect2i pbox = player->get_caixa_efetiva();
			// Derrotado: some (ou toca a animação de derrota), dá os pontos e toca o som.
			String defeat = vformat("\t\t%s_vivo = FALSE;\n", v);
			if (defeat_anim) {
				const int index = exported_index(p_entry, enemy->get_anim_derrota(), 0);
				defeat += vformat("\t\t%s_morrendo = %d;\n\t\tSPR_setVisibility(%s, AUTO_FAST);\n\t\tSPR_setAnim(%s, %d);\n", v, MAX(2, anim_ticks(defeat_anim) + (defeat_anim->loop ? 0 : 20)), p_entry.variable, p_entry.variable, index);
			} else {
				defeat += vformat("\t\tSPR_setVisibility(%s, HIDDEN);\n", p_entry.variable);
			}
			if (enemy->get_pontos() > 0) {
				defeat += vformat("\t\tpontos += %d;\n\t\thud_desenhar();\n", enemy->get_pontos());
			}
			if (!enemy->get_som_derrota().is_empty()) {
				defeat += "\t\tjogo_som(" + sound_define(enemy->get_som_derrota()) + ");\n";
			}
			if (enemy->get_vida() > 1) {
				// Mais de um golpe: cada um tira vida e deixa o inimigo piscando (sem levar outro).
				defeat = vformat("\t\tif (!%s_ferido) {\n\t\t\tif (--%s_vida == 0) {\n", v, v) + "\t\t\t\t" + defeat.substr(2).replace("\n\t\t", "\n\t\t\t\t").trim_suffix("\t\t") + vformat("\t\t\t} else {\n\t\t\t\t%s_ferido = 30;\n\t\t\t}\n\t\t}\n", v);
			}
			code += vformat("\tconst s16 jx = jogador_x + %d, jy = (jogador_y16 >> 4) + %d;\n\tconst s16 ix = %s_x + %d, iy = %s + %d;\n",
					pbox.position.x, pbox.position.y, v, box.position.x, enemy_y, box.position.y);
			if (player_attacks()) {
				const Rect2i hit = player_anim(player->get_anim_ataque())->attack_box;
				code += vformat(U("\t// Atingido pela caixa de ataque do jogador.\n\tif (golpe_ativo && golpe_x < ix + %d && ix < golpe_x + %d && golpe_y < iy + %d && iy < golpe_y + %d) {\n"), box.size.x, hit.size.x, box.size.y, hit.size.y) + defeat + "\t\treturn;\n\t}\n";
			}
			code += vformat("\tif (!(jx < ix + %d && ix < jx + %d && jy < iy + %d && iy < jy + %d)) {\n\t\treturn;\n\t}\n", box.size.x, pbox.size.x, box.size.y, pbox.size.y);
			if (enemy->get_pisavel()) {
				// Caindo, com os pés na parte de cima do inimigo: derrota e o jogador quica.
				code += vformat(U("\tif (jogador_vy16 > 0 && jy + %d - iy <= 8) {\n"), pbox.size.y) + defeat + "\t\tjogador_vy16 = -80;\n\t\treturn;\n\t}\n";
			}
			code += "\t" + hurt_call() + "\n";
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
		const bool death = has_tile_type(MDColisao::TIPO_MORTE) && player;
		const bool limit = has_tile_type(MDColisao::TIPO_LIMITE) && has_enemies();
		String code = vformat(U("// Colisão: uma célula de 8×8 por byte (0 vazio, 1 sólido, 2 atravessável, 3 dano, 4 água, 5 morte, 6 escada,\n// 7 gelo, 8 limite dos inimigos, 9+ tipos próprios).\n#define MAPA_LARGURA %d\n#define MAPA_ALTURA %d\n"), collision_cells.x * 8, collision_cells.y * 8);
		code += String(oneway || needs_floor_helper() ? "#define ATRAVESSAVEL 2\n" : "") + (spikes ? "#define ESPINHO 3\n" : "") + (water ? "#define AGUA 4\n" : "") + (death ? "#define MORTE 5\n" : "") + (limit ? "#define LIMITE 8\n" : "");
		code += vformat("static const u8 mapa_colisao[%d] = {", collision.size());
		for (int i = 0; i < collision.size(); i++) {
			code += (i % 64 == 0 ? "\n\t" : "") + itos(collision[i]) + ",";
		}
		if (!player && !has_enemies()) {
			return code + "\n};\n\n"; // Só os atores: o ator.c lê a grade direto.
		}
		code += vformat(U("\n};\n\nstatic u8 celula(s16 x, s16 y) {\n"
						  "\tif (x < 0 || x >= MAPA_LARGURA) {\n\t\treturn 1; // As laterais do mapa são paredes.\n\t}\n"
						  "\tif (y < 0 || y >= MAPA_ALTURA) {\n\t\treturn 0;\n\t}\n"
						  "\treturn mapa_colisao[(y >> 3) * %d + (x >> 3)];\n}\n\n"),
				collision_cells.x);
		if (needs_floor_helper()) {
			code += "static bool chao(s16 x, s16 y) {\n\tconst u8 tipo = celula(x, y);\n\treturn tipo == 1 || tipo == ATRAVESSAVEL;\n}\n\n";
		}
		code += "static bool solido(s16 x, s16 y) {\n\treturn celula(x, y) == 1;\n}\n\n";
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
		if (spikes || water || death || limit) {
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
		c += "#include \"cena_" + ident + ".h\"\n";
		if (!actors.is_empty()) {
			c += "#include \"ator.h\"\n";
		}
		c += "\n";
		// O código C da cena é opcional: sem src/<ident>.c, os símbolos fracos ficam nulos.
		c += vformat("void %s_iniciar(void) __attribute__((weak));\nvoid %s_atualizar(void) __attribute__((weak));\n\n", ident, ident);
		for (const MapEntry &entry : maps) {
			if (entry.streaming) {
				// Estado do streaming: usos e vaga na VRAM de cada padrão, e as vagas livres.
				c += vformat("static u16 %s_dono[%d]; // Padrão + 1 em cada vaga.\n", entry.variable, entry.slots);
				c += vformat("static MapaStream %s = { %s, %d, %d, %d, (const u16 *)%s_celulas, (const u32 *)%s_padroes, (const u16 *)%s_vagas, (const u16 *)%s_linhas, (const u16 *)%s_colunas, %s_dono, %d, 0, 0, %d, %d, %d }; // %s\n",
						entry.variable, entry.node->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B", entry.base, entry.size.x / 8, entry.size.y / 8, entry.symbol, entry.symbol, entry.symbol, entry.symbol, entry.symbol,
						entry.variable, entry.slots, entry.margin, entry.margin_y0, entry.margin_y1, entry.node->get_name());
			} else {
				c += vformat("static Map *%s; // %s\n", entry.variable, entry.node->get_name());
			}
		}
		for (const SpriteEntry &entry : sprites) {
			c += vformat("Sprite *%s; // %s\n", entry.variable, entry.node->get_name());
		}
		const bool scrolls = !maps.is_empty();
		const bool enemies = has_enemies();
		const bool can_die = player_can_die();
		const bool hud_lives = player && player->get_vidas() > 0;
		bool hud_score = false; // Há itens ou inimigos que dão pontos.
		for (const SpriteEntry &entry : sprites) {
			hud_score = hud_score || (entry.item && entry.item->get_pontos() > 0) || (entry.enemy && (entry.enemy->get_pisavel() || player_attacks()) && entry.enemy->get_pontos() > 0);
		}
		hud_score = hud_score && player;
		const bool hud_energy = player_energy();
		// Com MDTexto mostrando valores, eles são o HUD; sem nenhum, o automático (pontos, vidas e energia no topo).
		const bool custom_hud = !hud_texts.is_empty();
		const bool hud = player && (hud_lives || hud_score || hud_energy || custom_hud);
		String custom_hud_code;
		for (const HudText &hud_text : hud_texts) {
			const String at = vformat("%d, %d", hud_text.tile.x, hud_text.tile.y);
			switch (hud_text.valor) {
				case MDTexto::VALOR_PONTOS:
					custom_hud_code += vformat("\tuintToStr(pontos, numero, %d);\n\tVDP_drawText(numero, %s);\n", hud_text.digits > 0 ? hud_text.digits : 6, at);
					break;
				case MDTexto::VALOR_VIDAS: {
					const int initial = player ? player->get_vidas() : 1;
					custom_hud_code += vformat("\tuintToStr(vidas, numero, %d);\n\tVDP_drawText(numero, %s);\n", hud_text.digits > 0 ? hud_text.digits : String::num_int64(MAX(initial, 1)).length(), at);
				} break;
				case MDTexto::VALOR_ENERGIA:
				case MDTexto::VALOR_ENERGIA_BARRA:
					if (!hud_energy) {
						// Sem energia na cena o valor fica de fora (o aviso sai em check_hud).
					} else if (hud_text.valor == MDTexto::VALOR_ENERGIA) {
						custom_hud_code += vformat("\tuintToStr(jogador_energia, numero, %d);\n\tVDP_drawText(numero, %s);\n", hud_text.digits > 0 ? hud_text.digits : String::num_int64(player->get_energia()).length(), at);
					} else {
						custom_hud_code += vformat("\tfor (u16 i = 0; i < JOGADOR_ENERGIA; i++) {\n\t\tVDP_drawText(i < jogador_energia ? \"%s\" : \" \", %d + i, %d);\n\t}\n", hud_text.symbol.c_escape(), hud_text.tile.x, hud_text.tile.y);
					}
					break;
				default:
					break;
			}
		}
		if (!custom_hud_code.is_empty()) {
			custom_hud_code = "\tchar numero[11];\n" + custom_hud_code;
		}
		if (scrolls) {
			c += vformat(U("\n// Câmera: canto superior esquerdo da tela no mundo (%d×%d).\n#define MUNDO_LARGURA %d\n#define MUNDO_ALTURA %d\nstatic s16 camera_x, camera_y;\nstatic bool camera_pronta; // FALSE = vai direto ao alvo (início da cena, volta do jogador).\n"), world.x, world.y, world.x, world.y);
		}
		if (player) {
			const SpriteEntry &entry = sprites[player_sprite];
			c += vformat(U("\n// Jogador (%s): posição e velocidade vertical em 1/16 de pixel.\n#define JOGADOR_INICIO_X %d\n#define JOGADOR_INICIO_Y %d\n"), player->get_name(), entry.position.x, entry.position.y);
			c += "static s16 jogador_x, jogador_y16, jogador_vy16;\nstatic bool jogador_no_chao;\n";
			if (player->get_personagem().is_valid()) {
				c += U("static u16 jogador_animacao; // Animação tocando agora.\n");
				if (flip_shift(sprites[player_sprite]) || player_attacks() || player_energy()) {
					c += U("static bool jogador_virado; // Olhando para a esquerda (o desenho espelha em volta dos pés).\n");
				}
				if (player_attacks()) {
					c += U("static u16 jogador_atacando; // Quadros de vídeo que faltam no golpe.\nstatic bool golpe_ativo; // A caixa de ataque vale neste quadro.\nstatic s16 golpe_x, golpe_y; // Canto da caixa de ataque no mundo.\n");
				}
				if (player_death_anim()) {
					c += U("static u16 jogador_morrendo; // Quadros de vídeo que faltam na animação de morte.\n");
				}
			}
			if (player_energy()) {
				c += vformat(U("#define JOGADOR_ENERGIA %d\nstatic u8 jogador_energia; // Golpes que ainda aguenta nesta vida.\nstatic u16 jogador_ferido; // Quadros invencível, piscando, depois de um golpe.\nstatic u16 jogador_atordoado; // Quadros sem controle depois de um golpe.\n"), player->get_energia());
			}
			if (!collision.is_empty() && !top_down() && has_tile_type(MDColisao::TIPO_ATRAVESSAVEL)) {
				c += U("static u8 jogador_descendo; // Quadros atravessando um tile atravessável (↓).\n");
			}
			// O pulo vale ao apertar (segurar não pula de novo); soltar na subida encurta o pulo.
			c += "#define PULO " + button_mask(player->jump_mask()) + "\n";
			if (player_attacks()) {
				c += "#define ATAQUE " + button_mask(player->attack_mask()) + "\n";
			}
			if (player->get_botoes_correr()) {
				c += "#define CORRER " + button_mask(player->get_botoes_correr()) + vformat("\n#define VELOCIDADE_CORRENDO %d\n", player->get_velocidade_correndo());
			}
			if (player->get_pausa_start()) {
				c += U("static bool pausado; // START pausa o jogo e a música.\nstatic u16 pausa_botoes_antes;\n");
			}
			c += U("#define PULO_CURTO 48 // Velocidade de subida que sobra ao soltar o botão.\nstatic u16 jogador_botoes_antes;\n");
			c += vformat(U("#define JOGADOR_CONTROLE JOY_%d // MDJogador.controle.\n"), player->get_controle());
			const String energy_reset = player_energy() ? vformat("\tjogador_energia = JOGADOR_ENERGIA;\n\tjogador_ferido = 0;\n\tjogador_atordoado = 0;\n\tSPR_setVisibility(%s, AUTO_FAST);\n", sprites[player_sprite].variable) : String();
			if (checkpoints.is_empty()) {
				c += "\nstatic void jogador_reiniciar(void) {\n\tjogador_x = JOGADOR_INICIO_X;\n\tjogador_y16 = JOGADOR_INICIO_Y * 16;\n\tjogador_vy16 = 0;\n\tjogador_no_chao = TRUE;\n" + energy_reset + (scrolls ? "\tcamera_pronta = FALSE;\n" : "") + "}\n";
			} else {
				c += U("static s16 retorno_x, retorno_y; // Onde o jogador volta: o início ou o último ponto de retorno.\n");
				c += "\nstatic void jogador_reiniciar(void) {\n\tjogador_x = retorno_x;\n\tjogador_y16 = retorno_y * 16;\n\tjogador_vy16 = 0;\n\tjogador_no_chao = TRUE;\n" + energy_reset + (scrolls ? "\tcamera_pronta = FALSE;\n" : "") + "}\n";
			}
			if (hud && custom_hud) {
				c += U("\n// HUD montado com os MDTexto da cena.\nstatic void hud_desenhar(void) {\n") + custom_hud_code + "}\n";
			} else if (hud) {
				c += U("\n// Pontos no meio e vidas no canto superior direito.\nstatic void hud_desenhar(void) {\n");
				if (hud_score) {
					c += "\tchar numero[11];\n\tuintToStr(pontos, numero, 6);\n\tVDP_drawText(\"PONTOS\", 13, 0);\n\tVDP_drawText(numero, 20, 0);\n";
				}
				if (hud_lives) {
					c += "\tchar texto[] = \"VIDAS 0\";\n\ttexto[6] = '0' + vidas;\n\tVDP_drawText(texto, 31, 0);\n";
				}
				if (hud_energy) {
					c += "\tchar energia[] = \"ENERGIA 0\";\n\tenergia[8] = '0' + jogador_energia;\n\tVDP_drawText(energia, 1, 0);\n";
				}
				c += "}\n";
			}
			if (can_die) {
				c += U("\n// Perde uma vida e volta ao início (ou ao ponto de retorno); sem vidas, fim de jogo.\nstatic void jogador_perder_vida(void) {\n");
				if (hud_lives) {
					c += "\tif (vidas <= 1) {\n\t\tvidas = 0;\n\t\tjogo_perdeu();\n\t\treturn;\n\t}\n\tvidas--;\n\thud_desenhar();\n";
				}
				c += "\tjogador_reiniciar();\n";
				if (hud_energy) {
					c += "\thud_desenhar();\n";
				}
				if (player->get_personagem().is_valid()) {
					c += U("\tjogador_animacao = 0xFFFF; // Volta para a animação do estado.\n");
				}
				if (player_attacks()) {
					c += "\tjogador_atacando = 0;\n\tgolpe_ativo = FALSE;\n";
				}
				c += "}\n";
				c += U("\n// Caiu do mapa, encostou num inimigo ou num espinho.\nstatic void jogador_morrer(void) {\n");
				if (player_death_anim()) {
					c += "\tif (jogador_morrendo) {\n\t\treturn;\n\t}\n";
				}
				if (player->get_flash_dano()) {
					c += U("\tjogo_flash(RGB24_TO_VDPCOLOR(0xFFFFFF), 4); // MDJogador.flash_dano.\n");
				}
				if (!player->get_som_morte().is_empty()) {
					c += "\tjogo_som(" + sound_define(player->get_som_morte()) + ");\n";
				}
				if (player_death_anim()) {
					// A animação de morte toca com o jogador parado; depois, perde a vida.
					const MDPersonagem::Animacao *death = player_anim(player->get_anim_morte());
					const int index = exported_index(sprites[player_sprite], player->get_anim_morte(), 0);
					c += vformat("\tjogador_morrendo = %d;\n\tjogador_animacao = %d;\n\tSPR_setAnim(%s, %d);\n%s\treturn;\n",
							MAX(30, anim_ticks(death) + (death->loop ? 0 : 30)), index, sprites[player_sprite].variable, index, player_attacks() ? "\tjogador_atacando = 0;\n\tgolpe_ativo = FALSE;\n" : "");
				} else {
					c += "\tjogador_perder_vida();\n";
				}
				c += "}\n";
				if (player_energy()) {
					c += U("\n// Golpe de inimigo ou espinho: tira energia, deixa o jogador piscando (sem levar outro golpe) e o\n// empurra para trás; sem energia, perde a vida.\nstatic void jogador_ferir(void) {\n\tif (jogador_ferido) {\n\t\treturn;\n\t}\n");
					if (player_death_anim()) {
						c += "\tif (jogador_morrendo) {\n\t\treturn;\n\t}\n";
					}
					c += "\tif (jogador_energia <= 1) {\n\t\tjogador_energia = 0;\n\t\thud_desenhar();\n\t\tjogador_morrer();\n\t\treturn;\n\t}\n\tjogador_energia--;\n\thud_desenhar();\n";
					if (player->get_flash_dano()) {
						c += U("\tjogo_flash(RGB24_TO_VDPCOLOR(0xFFFFFF), 4); // MDJogador.flash_dano.\n");
					}
					const MDPersonagem::Animacao *damage = player_anim(player->get_anim_dano());
					c += vformat("\tjogador_ferido = %d;\n\tjogador_atordoado = %d;\n", MAX(1, player->get_invencivel()), damage ? MIN(anim_ticks(damage), MAX(1, player->get_invencivel())) : 12);
					if (!top_down()) {
						c += U("\tjogador_vy16 = -48; // Um pulinho para trás.\n\tjogador_no_chao = FALSE;\n");
					}
					if (player_attacks()) {
						c += "\tjogador_atacando = 0;\n\tgolpe_ativo = FALSE;\n";
					}
					if (damage) {
						const int index = exported_index(sprites[player_sprite], player->get_anim_dano(), 0);
						c += vformat("\tjogador_animacao = %d;\n\tSPR_setAnim(%s, %d);\n", index, sprites[player_sprite].variable, index);
					}
					if (!player->get_som_dano().is_empty()) {
						c += "\tjogo_som(" + sound_define(player->get_som_dano()) + ");\n";
					}
					c += "}\n";
				}
			}
		}
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				if (entry.path.is_empty()) {
					c += vformat(U("\n// Inimigo %s: patrulha de x = %d a %d.\nstatic s16 %s_x, %s_dir;\nstatic bool %s_vivo;\n"), entry.node->get_name(), entry.position.x, entry.position.x + entry.enemy->get_distancia(), entry.prefix, entry.prefix, entry.prefix);
				} else {
					c += vformat(U("\n// Inimigo %s: segue o MDTrajeto.\nstatic s16 %s_x, %s_y, %s_passo, %s_dir;\nstatic bool %s_vivo;\n"), entry.node->get_name(), entry.prefix, entry.prefix, entry.prefix, entry.prefix, entry.prefix);
				}
				if (entry.enemy->get_vida() > 1) {
					c += vformat(U("static u8 %s_vida, %s_ferido; // Golpes que faltam e quadros piscando.\n"), entry.prefix, entry.prefix);
				}
				if (enemy_defeat_anim(entry)) {
					c += vformat(U("static u16 %s_morrendo; // Quadros que faltam na animação de derrota.\n"), entry.prefix);
				}
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
		if (!collision.is_empty() && (player || enemies || !actors.is_empty())) {
			c += collision_code();
		}
		c += platform_code();
		for (const SpriteEntry &entry : sprites) {
			if (entry.enemy) {
				c += enemy_code(entry);
			}
		}
		// Câmera centrada no jogador, presa às bordas do mundo; os sprites ficam na posição do mundo.
		const bool follows = player || camera_actor >= 0 || !actors.is_empty();
		if (scrolls) {
			if (follows) {
				c += camera_code();
			}
			// Com atores, tremer_tela desloca os planos (só o desenho; a câmera fica onde está).
			const String shake_x = actors.is_empty() ? String() : " + atores_tremor_x()", shake_y = actors.is_empty() ? String() : " + atores_tremor_y()";
			if (!waters.is_empty()) {
				c += water_code(shake_x);
			}
			c += "static void camera_atualizar(void) {\n";
			if (follows) {
				c += "\tcamera_seguir();\n";
			}
			if (!waters.is_empty()) {
				// Onde cada plano está, para as faixas (MDCorrenteza): a câmera, um fundo com parallax ou o mapa.
				c += "\tplano_x[0] = plano_x[1] = camera_x;\n\tplano_y[0] = plano_y[1] = camera_y;\n";
				for (const ParallaxEntry &parallax : parallaxes) {
					const int p = parallax.plane == "BG_A" ? 1 : 0;
					c += vformat("\tplano_x[%d] = (s16)((s32)camera_x * %d / 100);\n\tplano_y[%d] = (s16)((s32)camera_y * %d / 100);\n", p, parallax.percent, p, parallax.percent);
				}
			}
			for (const MapEntry &entry : maps) {
				const String plane = entry.node->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B";
				String x = "camera_x", y = "camera_y";
				if (entry.scroll_x != 100 || entry.scroll_y != 100) {
					// Parallax: o mapa anda uma fração da câmera, sem passar da borda dele.
					c += vformat(U("\t{ // %s: rolagem de %d%% na horizontal e %d%% na vertical\n"), entry.name, entry.scroll_x, entry.scroll_y);
					c += vformat("\tconst s16 px = min(max((s16)((s32)camera_x * %d / 100), 0), %d);\n\tconst s16 py = min(max((s16)((s32)camera_y * %d / 100), 0), %d);\n",
							entry.scroll_x, MAX(entry.size.x - 320, 0), entry.scroll_y, MAX(entry.size.y - 224, 0));
					x = "px";
					y = "py";
				}
				if (!waters.is_empty()) {
					const int p = entry.node->get_plano() == MDFundo::PLANO_A ? 1 : 0;
					c += vformat("\tplano_x[%d] = %s;\n\tplano_y[%d] = %s;\n", p, x, p, y);
				}
				if (entry.streaming) {
					c += vformat("\tstream_mover(&%s, %s, %s);\n\tVDP_setHorizontalScroll(%s, -(%s%s));\n\tVDP_setVerticalScroll(%s, %s%s);\n", entry.variable, x, y, plane, x, shake_x, plane, y, shake_y);
				} else {
					c += vformat("\tMAP_scrollTo(%s, %s, %s);\n", entry.variable, x, y);
				}
				if (x == "px") {
					c += "\t}\n";
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
			if (!waters.is_empty()) {
				c += U("\tagua_atualizar(); // A rolagem por linha substitui a do plano inteiro.\n");
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
					const String ey = entry.path.is_empty() ? itos(entry.position.y) : entry.prefix + "_y";
					c += vformat("\tSPR_setPosition(%s, %s_x%s%s, %s%s);\n", entry.variable, entry.prefix, shift, camera_x, ey, camera_y);
				} else if (entry.platform) {
					c += vformat("\tSPR_setPosition(%s, %s_x%s, %s_y%s);\n", entry.variable, entry.prefix, camera_x, entry.prefix, camera_y);
				} else {
					c += vformat("\tSPR_setPosition(%s, %d%s, %d%s);\n", entry.variable, entry.position.x, camera_x, entry.position.y, camera_y);
				}
			}
			c += "}\n\n";
		}

		c += animation_code();
		HashSet<int> frame_callbacks;
		Vector<int> table_assets; // Sprites comuns (com o callback da troca de quadro) e depois os atores (só as tabelas).
		HashSet<int> sprite_assets;
		for (const SpriteEntry &entry : sprites) {
			table_assets.push_back(entry.asset);
			sprite_assets.insert(entry.asset);
		}
		for (const ActorEntry &entry : actors) {
			table_assets.push_back(entry.asset);
		}
		for (int asset_index : table_assets) {
			const Asset &asset = assets[asset_index];
			if (asset.timers.is_empty() || frame_callbacks.has(asset_index)) {
				continue;
			}
			frame_callbacks.insert(asset_index);
			// Tabelas de tempos e a troca de quadro: o SGDK chama o callback a cada quadro novo, e o
			// timer dele é o tempo na tela; sem repetição, o último quadro fica (timer 0 congela).
			c += vformat(U("// Tempo de cada quadro (1/60 s) das animações de %s, do gestor de animações.\n"), asset.symbol);
			String table = vformat("static const u8 *const %s_tempos[] = {", asset.symbol);
			String counts = vformat("static const u8 %s_quadros[] = {", asset.symbol);
			String loops = vformat("static const u8 %s_repete[] = {", asset.symbol);
			for (int a = 0; a < asset.frame_ticks.size(); a++) {
				c += vformat("static const u8 %s_tempos_%d[] = {", asset.symbol, a);
				for (int f = 0; f < asset.frame_ticks[a].size(); f++) {
					c += (f ? ", " : "") + itos(asset.frame_ticks[a][f]);
				}
				c += "};\n";
				table += vformat("%s%s_tempos_%d", a ? ", " : "", asset.symbol, a);
				counts += (a ? ", " : "") + itos(asset.frame_ticks[a].size());
				loops += (a ? ", " : "") + String(asset.loops[a] ? "1" : "0");
			}
			c += table + "};\n" + counts + "};\n" + loops + "};\n";
			String sound_call;
			if (asset.has_frame_sounds) {
				// Eventos por quadro: o som (número do XGM, 0 = nenhum) toca quando o quadro entra.
				c += vformat(U("// Som de cada quadro (0 = nenhum), do gestor de animações.\n"));
				String sound_table = vformat("static const u8 *const %s_sons[] = {", asset.symbol);
				for (int a = 0; a < asset.frame_sounds.size(); a++) {
					c += vformat("static const u8 %s_sons_%d[] = {", asset.symbol, a);
					for (int f = 0; f < asset.frame_sounds[a].size(); f++) {
						c += (f ? ", " : "") + (asset.frame_sounds[a][f].is_empty() ? String("0") : sound_define(asset.frame_sounds[a][f]));
					}
					c += "};\n";
					sound_table += vformat("%s%s_sons_%d", a ? ", " : "", asset.symbol, a);
				}
				c += sound_table + "};\n";
				sound_call = vformat("\tif (q < %s_quadros[a] && %s_sons[a][q]) {\n\t\tjogo_som(%s_sons[a][q]);\n\t}\n", asset.symbol, asset.symbol, asset.symbol);
			}
			if (!sprite_assets.has(asset_index)) {
				c += "\n";
				continue; // Os atores contam o tempo dos quadros no ator.c.
			}
			c += vformat("\nstatic void %s_quadro_mudou(Sprite *sprite) {\n"
						 "\tconst s16 a = sprite->animInd, q = sprite->frameInd;\n"
						 "%s"
						 "\tif (q >= %s_quadros[a] || (!%s_repete[a] && q == sprite->animation->numFrame - 1)) {\n\t\tsprite->timer = 0;\n\t} else {\n\t\tsprite->timer = %s_tempos[a][q];\n\t}\n}\n\n",
					asset.symbol, sound_call, asset.symbol, asset.symbol, asset.symbol);
		}

		c += actor_types();

		// Início: tudo é desenhado com a tela escura e as cores entram num fade.
		{
			bool window_top = false;
			for (const MapEntry &entry : maps) {
				window_top = window_top || entry.node->get_plano() == MDFundo::PLANO_A;
			}
			const int rows = MAX(text_rows, hud && !custom_hud ? 1 : 0);
			c += dialog_tables(window_top && rows > 0, rows, !sprites.is_empty() || !actors.is_empty());
			c += menu_tables(window_top && rows > 0, rows, !sprites.is_empty() || !actors.is_empty());
			if (!color_cycles.is_empty()) {
				c += U("// Ciclos de cores (MDCicloCores): paleta, primeira cor, quantidade, quadros por passo, sentido.\nstatic const CicloCores ciclos_de_cores[] = {\n");
				for (const MDCicloCores *ciclo : color_cycles) {
					c += vformat("\t{ %d, %d, %d, %d, %d }, // %s\n", ciclo->get_paleta(), ciclo->get_primeira(), MIN(ciclo->get_quantidade(), 16 - ciclo->get_primeira()), ciclo->get_intervalo(), ciclo->get_para_tras() ? -1 : 1, String(ciclo->get_name()));
				}
				c += "};\n\n";
			}
		}
		c += "void cena_" + ident + "_iniciar(void) {\n\tPAL_setColors(0, palette_black, 64, CPU);\n\tVDP_setScreenWidth320();\n" + String(waters.is_empty() || maps.is_empty() ? "" : "\tVDP_setScrollingMode(HSCROLL_LINE, VSCROLL_PLANE); // Água: rolagem por linha.\n\tagua_quadros = 0;\n") + "\tu16 cores[64];\n\tmemset(cores, 0, sizeof(cores));\n";
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
		const int fixed_rows = MAX(text_rows, hud && !custom_hud ? 1 : 0);
		if (map_on_a && fixed_rows > 0) {
			// O mapa rola no plano A e apagaria os textos: eles vão para o plano window, fixo no topo.
			c += vformat(U("\t// Textos no plano window (linhas 0 a %d), que não rola com o mapa.\n\tVDP_setWindowVPos(FALSE, %d);\n\tVDP_setTextPlane(WINDOW);\n"), fixed_rows - 1, fixed_rows);
		}
		c += text_code;
		if (!player && !custom_hud_code.is_empty()) {
			c += U("\t{ // Valores do jogo nos textos (ex.: os pontos na tela final).\n") + custom_hud_code.replace("\n\t", "\n\t\t").replace_first("\t", "\t\t") + "\t}\n";
		}
		if (player) {
			if (!checkpoints.is_empty()) {
				c += "\tretorno_x = JOGADOR_INICIO_X;\n\tretorno_y = JOGADOR_INICIO_Y;\n";
			}
			c += "\tjogador_reiniciar();\n\tjogador_botoes_antes = jogo_ler(JOGADOR_CONTROLE);\n";
			if (player->get_pausa_start()) {
				c += "\tpausado = FALSE;\n\tpausa_botoes_antes = jogador_botoes_antes;\n";
			}
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
				if (!entry.path.is_empty()) {
					c += vformat("\t%s_y = %d;\n\t%s_passo = 0;\n", entry.prefix, entry.position.y, entry.prefix);
				}
				if (entry.enemy->get_vida() > 1) {
					c += vformat("\t%s_vida = %d;\n\t%s_ferido = 0;\n", entry.prefix, entry.enemy->get_vida(), entry.prefix);
				}
				if (enemy_defeat_anim(entry)) {
					c += vformat("\t%s_morrendo = 0;\n", entry.prefix);
				}
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
			c += "\tcamera_pronta = FALSE;\n\tcamera_atualizar();\n";
		}
		if (!sprites.is_empty() || !actors.is_empty()) {
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
					c += vformat("\t%s->onFrameChange = %s_quadro_mudou;\n", entry.variable, asset.symbol);
				} else if (entry.node->get_frame() > 0) {
					c += vformat("\tSPR_setAnimAndFrame(%s, %d, %d);\n", entry.variable, entry.node->get_frame() / MAX(1, entry.node->get_hframes()), entry.node->get_frame() % MAX(1, entry.node->get_hframes()));
				}
				if (entry.node->is_flipped_h()) {
					c += vformat("\tSPR_setHFlip(%s, TRUE);\n", entry.variable);
				}
			}
			if (!actors.is_empty()) {
				// Os atores nascem com o sprite e o <codigo>_pronto de cada um, na ordem da cena.
				c += vformat("\tatores_iniciar(%s, %s);\n", collision.is_empty() ? String("NULL, 0, 0") : vformat("mapa_colisao, %d, %d", collision_cells.x, collision_cells.y), scrolls ? "MUNDO_LARGURA, MUNDO_ALTURA" : "320, 224");
				for (int i = 0; i < actors.size(); i++) {
					const ActorEntry &entry = actors[i];
					const String create = vformat("criar_ator(&%s, PX(%d), PX(%d))", entry.type, entry.feet.x, entry.feet.y);
					const String name = entry.node->get_name();
					if (i == camera_actor) {
						c += "\tator_camera = " + create + "; // " + name + "\n";
						if (entry.node->is_flipped_h()) {
							c += "\tif (ator_camera) {\n\t\tator_camera->direcao = -1;\n\t}\n";
						}
					} else if (entry.node->is_flipped_h()) {
						c += "\t{ // " + name + U(", espelhado no editor: começa olhando para a esquerda.\n\t\tAtor *a = ") + create + ";\n\t\tif (a) {\n\t\t\ta->direcao = -1;\n\t\t}\n\t}\n";
					} else {
						c += "\t" + create + "; // " + name + "\n";
					}
				}
				if (scrolls) {
					c += "\tcamera_pronta = FALSE;\n\tcamera_atualizar();\n";
				}
				c += vformat("\tatores_desenhar(%s);\n", scrolls ? "camera_x, camera_y" : "0, 0");
			}
			if (!sprites.is_empty()) {
				c += "\tsprites_posicionar();\n";
			}
			if (!animation_tracks.is_empty()) {
				c += "\tanimacao_quadro = 0;\n\tanimacao_aplicar();\n";
			}
			c += "\tif (" + ident + "_iniciar) {\n\t\t" + ident + "_iniciar();\n\t}\n\tSPR_update();\n";
		} else {
			c += "\tif (" + ident + "_iniciar) {\n\t\t" + ident + "_iniciar();\n\t}\n";
		}
		if (!dialogs.is_empty()) {
			c += "\tdialogo_preparar(&dialogo_cena);\n\tdialogo_botoes_antes = JOY_readJoypad(JOY_1);\n";
			for (int d = 0; d < dialogs.size(); d++) {
				if (dialogs[d].node->get_ativar() != MDDialogo::ATIVAR_PELO_CODIGO) {
					c += vformat("\tdialogo_%d_feito = FALSE;\n\tdialogo_%d_dentro = FALSE;\n", d, d);
				}
			}
		}
		if (menu) {
			c += "\tmenu_preparar(&menu_cena);\n";
			if (menu->get_tipo() == MDMenu::TIPO_PAUSA) {
				c += "\tmenu_botoes_antes = jogo_ler(JOY_1);\n";
			}
		}
		if (save_on_enter) {
			c += U("\tjogo_salvar(jogo_slot); // Ponto de salvamento (MDCena.salvar_ao_entrar).\n");
		}
		if (shadow_mode) {
			c += U("\tVDP_setHilightShadow(TRUE); // MDCena.luz_e_sombra: o que tem prioridade baixa fica na sombra.\n");
		}
		c += music >= 0 ? vformat("\tjogo_musica(%s);\n", assets[music].symbol) : String("\tjogo_musica(NULL);\n");
		c += "\tPAL_fadeInAll(cores, 15, FALSE);\n";
		if (!color_cycles.is_empty()) {
			c += "\tjogo_ciclos(ciclos_de_cores, " + itos(color_cycles.size()) + ");\n";
		}
		c += "}\n\n";

		c += "void cena_" + ident + "_atualizar(void) {\n";
		c += dialog_update_head();
		c += menu_update_head();
		if (player && player->get_pausa_start() && !(menu && menu->get_tipo() == MDMenu::TIPO_PAUSA)) {
			// A faixa "PAUSA" vai no plano window, logo abaixo dos textos fixos (se houver), sem mexer nos planos A e B.
			bool window_used = false;
			for (const MapEntry &entry : maps) {
				window_used = window_used || entry.node->get_plano() == MDFundo::PLANO_A;
			}
			const int rows = MAX(text_rows, hud && !custom_hud ? 1 : 0);
			const int window_rows = window_used ? rows : 0;
			const int pause_row = window_used ? rows : 0; // Sem window, a faixa cobre a primeira linha enquanto pausa.
			c += U("\t{ // Pausa: START para tudo (e a música) até apertar de novo.\n\t\tconst u16 botoes = jogo_ler(JOGADOR_CONTROLE);\n\t\tconst bool start = (botoes & BUTTON_START) && !(pausa_botoes_antes & BUTTON_START);\n\t\tpausa_botoes_antes = botoes;\n\t\tif (start) {\n\t\t\tpausado = !pausado;\n\t\t\tif (pausado) {\n\t\t\t\tXGM_pausePlay();\n");
			c += vformat("\t\t\t\tVDP_setWindowVPos(FALSE, %d);\n", pause_row + 1);
			c += vformat("\t\t\t\tVDP_drawTextEx(WINDOW, \"                 PAUSA                  \", TILE_ATTR(PAL0, TRUE, FALSE, FALSE), 0, %d, CPU);\n", pause_row);
			c += vformat("\t\t\t} else {\n\t\t\t\tVDP_setWindowVPos(FALSE, %d);\n\t\t\t\tXGM_resumePlay();\n\t\t\t}\n\t\t}\n\t\tif (pausado) {\n\t\t\treturn;\n\t\t}\n\t}\n", window_rows);
		}
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
			if (player_death_anim()) {
				c += "\tif (jogador_morrendo) {\n\t\tif (--jogador_morrendo == 0) {\n\t\t\tjogador_perder_vida();\n\t\t}\n\t} else\n";
			}
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
		if (!actors.is_empty()) {
			c += "\tatores_atualizar();\n";
			if (!player && camera_actor >= 0) {
				for (const ExitEntry &exit : exits) {
					c += vformat(U("\tif (ator_camera && corpo_esquerda(ator_camera) < %d && %d < corpo_esquerda(ator_camera) + ator_camera->corpo_l && corpo_topo(ator_camera) < %d && %d < corpo_topo(ator_camera) + ator_camera->corpo_a) {\n\t\tjogo_trocar_cena(%s); // Saída para %s.\n\t}\n"),
							exit.area.get_end().x, exit.area.position.x, exit.area.get_end().y, exit.area.position.y, scene_constant(exit.scene), scenes[exit.scene].path.get_file());
				}
			}
		}
		c += dialog_triggers();
		if (scrolls) {
			c += "\tcamera_atualizar();\n";
		}
		if (!actors.is_empty()) {
			c += vformat("\tatores_desenhar(%s);\n", scrolls ? "camera_x, camera_y" : "0, 0");
		}
		// O código C da cena roda depois do jogo gerado e antes de os sprites irem para a tela.
		if (!sprites.is_empty() || !actors.is_empty()) {
			if (!sprites.is_empty()) {
				c += "\tsprites_posicionar();\n";
			}
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
		if (!actors.is_empty()) {
			c += "\tatores_encerrar();\n";
		}
		if (!waters.is_empty() && !maps.is_empty()) {
			c += "\tVDP_setScrollingMode(HSCROLL_PLANE, VSCROLL_PLANE);\n";
		}
		if (!sprites.is_empty() || !actors.is_empty()) {
			c += "\tSPR_end();\n";
		}
		c += "}\n";
		return c;
	}

	// Cabeçalho do código C da cena: os sprites pelo nome do node e as funções que o programador pode escrever.
	String scene_header(const String &p_scene_name) const {
		const String ident = scenes[scene].ident;
		String h = String(GENERATED_MARK) + U(" a partir de ") + scenes[scene].path + U(" (cena ") + p_scene_name + U("). Não edite: o arquivo é refeito no build.\n#pragma once\n\n#include \"jogo.h\"\n\n");
		if (menu) {
			h += "#include \"menu.h\"\n";
		}
		if (!dialogs.is_empty()) {
			h += U("#include \"dialogo.h\"\n\n// Diálogos da cena, para dialogo_abrir() no código C.\n");
			for (int d = 0; d < dialogs.size(); d++) {
				h += vformat("#define %s %d // %s\n", dialogs[d].define, d, dialogs[d].name);
			}
			h += "\n";
		}
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
			h += U("\n// Mapa carregado aos poucos (como o Sota faz): cada padrão de 8×8 tem uma vaga fixa na VRAM, escolhida no\n"
				   "// build para que dois padrões da mesma janela da câmera nunca dividam a vaga. As palavras do plano vêm\n"
				   "// prontas da ROM; o jogo só manda pela fila do DMA os padrões que ainda não estão na vaga.\n"
				   "typedef struct {\n"
				   "\tVDPPlane plano;\n\tu16 base; // Tile da primeira vaga.\n"
				   "\tu16 largura, altura; // Em células de 8×8.\n"
				   "\tconst u16 *celulas; // 0 (vazia) ou padrão + 1 (bits 0 a 11), por linhas.\n"
				   "\tconst u32 *padroes; // 8 palavras por padrão.\n"
				   "\tconst u16 *vagas; // Tile (vaga fixa) de cada padrão.\n"
				   "\tconst u16 *linhas; // Palavra do plano de cada célula, por linhas.\n"
				   "\tconst u16 *colunas; // As mesmas, por colunas.\n"
				   "\tu16 *dono; // Padrão + 1 que está em cada vaga (0 = nenhum).\n"
				   "\tu16 n_vagas;\n\ts16 coluna, linha; // Canto da janela carregada.\n"
				   "\tu8 margem; // Correnteza: colunas a mais à direita nas linhas margem_y0 a margem_y1 - 1.\n\ts16 margem_y0, margem_y1;\n"
				   "} MapaStream;\n\n"
				   "void stream_preparar(MapaStream *mapa);\n"
				   "void stream_mover(MapaStream *mapa, s16 camera_x, s16 camera_y);\n");
		}
		h += U("\nextern u8 vidas; // 0 = jogo novo (a primeira cena com jogador define as vidas).\nextern u32 pontos;\n"
			   "#define JOGO_VARS 16\nextern u16 jogo_var[JOGO_VARS]; // Variáveis do jogo (chaves, fases abertas...): zeram no jogo novo e vão no save.\n\n"
			   "// Progresso salvo na SRAM do cartucho (o cabeçalho do SGDK já declara 64 KB de SRAM): cena, vidas, pontos\n"
			   "// e jogo_var. JOGO_SLOTS slots; jogo_slot é o usado pelos pontos de salvamento (MDCena.salvar_ao_entrar).\n"
			   "#define JOGO_SLOTS 3\nextern u8 jogo_slot;\n"
			   "bool jogo_salvar(u8 slot);\n"
			   "bool jogo_carregar(u8 slot); // Troca para a cena salva (FALSE: slot vazio ou estragado).\n"
			   "bool jogo_tem_save(u8 slot);\n"
			   "void jogo_apagar_save(u8 slot);\n"
			   "// Senha de 8 letras (cena, vidas e pontos arredondados para dezenas; jogo_var não entra).\n"
			   "#define JOGO_SENHA_LETRAS 8\n"
			   "void jogo_senha(char *texto); // texto com espaço para 9 bytes.\n"
			   "bool jogo_usar_senha(const char *texto); // Confere e troca para a cena da senha.\n"
			   "u16 jogo_cena_atual(void);\n\n"
			   "// Efeitos de paleta: ciclos de cores (MDCicloCores) e o flash da tela (todas as cores numa só por alguns quadros).\n"
			   "typedef struct {\n\tu8 paleta, primeira, quantidade, intervalo;\n\ts8 sentido; // 1 = as cores andam para a frente, -1 = para trás.\n} CicloCores;\n"
			   "void jogo_ciclos(const CicloCores *ciclos, u8 quantos); // NULL, 0 = desliga.\n"
			   "void jogo_flash(u16 cor, u8 quadros);\n\n"
			   "// Opções (menu Opções do MDMenu), guardadas na SRAM e lidas quando o jogo liga.\n"
			   "extern u8 jogo_musica_ligada, jogo_efeitos_ligados;\n"
			   "extern u8 jogo_controles; // 0 = normal, 1 = A e C trocados, 2 = A e B trocados.\n"
			   "void jogo_config_aplicar(void); // Liga ou desliga a música conforme jogo_musica_ligada.\n"
			   "void jogo_config_salvar(void);\n"
			   "u16 jogo_ler(u16 controle); // JOY_readJoypad com os botões trocados conforme jogo_controles.\n"
			   "#define jogo_seis_botoes(controle) (JOY_getJoypadType(controle) == JOY_TYPE_PAD6) // Controle de 6 botões (X, Y, Z, MODE)?\n\n"
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
		c += U("// Garante que o padrão da célula está na vaga dele; senão, manda pela fila do DMA (no vblank) ou, com\n"
			   "// imediato (recarga inteira, tela escura), na hora.\n"
			   "static inline void stream_garantir(MapaStream *m, u16 *dono, u16 celula, bool imediato) {\n"
			   "\tcelula &= 0x0FFF;\n"
			   "\tif (!celula) {\n\t\treturn;\n\t}\n"
			   "\tconst u16 vaga = m->vagas[celula - 1];\n"
			   "\tu16 *atual = dono + (vaga - m->base);\n"
			   "\tif (*atual != celula) {\n"
			   "\t\t*atual = celula;\n"
			   "\t\tconst u32 *padrao = m->padroes + (celula - 1) * 8;\n"
			   "\t\tif (imediato || !DMA_queueDma(DMA_VRAM, (void *)padrao, vaga << 5, 16, 2)) {\n"
			   "\t\t\tVDP_loadTileData(padrao, vaga, 1, DMA);\n"
			   "\t\t}\n"
			   "\t}\n"
			   "}\n\n"
			   "// DMA de palavras da ROM para a VRAM. O DMA não atravessa um limite de 128 KB da origem; o DMA_queueDma do\n"
			   "// SGDK divide, mas calcula o destino da segunda parte como se o passo fosse 2. Aqui o destino segue o passo.\n"
			   "static void stream_dma(const u16 *origem, u16 destino, u16 n, u16 passo, bool imediato) {\n"
			   "\tconst u32 endereco = (u32)origem;\n"
			   "\t// Palavras até o fim do banco: de 1 a 65536 (em 32 bits; em 16 bits o início exato de um banco daria 0).\n"
			   "\tconst u32 cabem = (0x20000 - (endereco & 0x1FFFF)) >> 1;\n"
			   "\tif (n > cabem) {\n"
			   "\t\tstream_dma(origem + cabem, destino + cabem * passo, n - cabem, passo, imediato);\n"
			   "\t\tn = cabem;\n"
			   "\t}\n"
			   "\tif (imediato || !DMA_queueDmaFast(DMA_VRAM, (void *)origem, destino, n, passo)) {\n"
			   "\t\tDMA_doDmaFast(DMA_VRAM, (void *)origem, destino, n, passo);\n"
			   "\t}\n"
			   "}\n\n"
			   "static inline u16 stream_endereco(const MapaStream *m, u16 x, u16 y) {\n"
			   "\treturn (m->plano == BG_A ? VDP_BG_A : VDP_BG_B) + (((y & 31) << 6) + (x & 63)) * 2;\n"
			   "}\n\n"
			   "// Coluna x, n células a partir da linha y0 (dentro do mapa): confere os padrões e manda as palavras\n"
			   "// prontas da ROM num DMA com passo de uma linha do plano (128 bytes), dividido onde o plano dá a volta.\n"
			   "static void stream_coluna(MapaStream *m, s16 x, s16 y0, s16 n, bool imediato) {\n"
			   "\tif (x < 0 || x >= (s16)m->largura) {\n\t\treturn;\n\t}\n"
			   "\tif (y0 < 0) {\n\t\tn += y0;\n\t\ty0 = 0;\n\t}\n"
			   "\tif (y0 + n > (s16)m->altura) {\n\t\tn = m->altura - y0;\n\t}\n"
			   "\tif (n <= 0) {\n\t\treturn;\n\t}\n"
			   "\tu16 *const dono = m->dono;\n"
			   "\tconst u16 largura = m->largura;\n"
			   "\tconst u16 *celula = m->celulas + y0 * largura + x;\n"
			   "\tfor (s16 i = 0; i < n; i++, celula += largura) {\n\t\tstream_garantir(m, dono, *celula, imediato);\n\t}\n"
			   "\tconst u16 *palavras = m->colunas + x * m->altura + y0;\n"
			   "\twhile (n > 0) {\n"
			   "\t\tconst s16 parte = min(n, 32 - (y0 & 31));\n"
			   "\t\tstream_dma(palavras, stream_endereco(m, x, y0), parte, 128, imediato);\n"
			   "\t\tpalavras += parte;\n\t\ty0 += parte;\n\t\tn -= parte;\n"
			   "\t}\n"
			   "}\n\n"
			   "// Linha y, n células a partir da coluna x0 (dentro do mapa), dividida onde o plano de 64 colunas dá a volta.\n"
			   "static void stream_linha(MapaStream *m, s16 x0, s16 y, s16 n, bool imediato) {\n"
			   "\tif (y < 0 || y >= (s16)m->altura) {\n\t\treturn;\n\t}\n"
			   "\tif (x0 < 0) {\n\t\tn += x0;\n\t\tx0 = 0;\n\t}\n"
			   "\tif (x0 + n > (s16)m->largura) {\n\t\tn = m->largura - x0;\n\t}\n"
			   "\tif (n <= 0) {\n\t\treturn;\n\t}\n"
			   "\tu16 *const dono = m->dono;\n"
			   "\tconst u16 *celula = m->celulas + y * m->largura + x0;\n"
			   "\tfor (s16 i = 0; i < n; i++) {\n\t\tstream_garantir(m, dono, celula[i], imediato);\n\t}\n"
			   "\tconst u16 *palavras = m->linhas + y * m->largura + x0;\n"
			   "\twhile (n > 0) {\n"
			   "\t\tconst s16 parte = min(n, 64 - (x0 & 63));\n"
			   "\t\tstream_dma(palavras, stream_endereco(m, x0, y), parte, 2, imediato);\n"
			   "\t\tpalavras += parte;\n\t\tx0 += parte;\n\t\tn -= parte;\n"
			   "\t}\n"
			   "}\n\n"
			   "void stream_preparar(MapaStream *m) {\n"
			   "\tm->coluna = m->linha = FORA_DA_JANELA;\n"
			   "}\n\n"
			   "// Largura da janela na linha y: nas linhas da correnteza, mais as colunas da margem.\n"
			   "static inline s16 stream_largura(const MapaStream *m, s16 y) {\n"
			   "\treturn JANELA_COLUNAS + (y >= m->margem_y0 && y < m->margem_y1 ? m->margem : 0);\n"
			   "}\n\n"
			   "// Carrega a janela inteira (início da cena ou salto grande da câmera), com DMA na hora.\n"
			   "static void stream_recarregar(MapaStream *m, s16 coluna, s16 linha) {\n"
			   "\tmemset(m->dono, 0, m->n_vagas * 2);\n"
			   "\tm->coluna = coluna;\n\tm->linha = linha;\n"
			   "\tfor (s16 y = linha; y < linha + JANELA_LINHAS; y++) {\n"
			   "\t\tstream_linha(m, coluna, y, stream_largura(m, y), TRUE);\n"
			   "\t}\n"
			   "}\n\n"
			   "// Coluna que entra pela direita: nas linhas da margem ela fica mais longe (x + margem).\n"
			   "static void stream_borda_direita(MapaStream *m, s16 x) {\n"
			   "\ts16 y = m->linha;\n"
			   "\tconst s16 fim = m->linha + JANELA_LINHAS;\n"
			   "\twhile (y < fim) {\n"
			   "\t\tconst s16 largura = stream_largura(m, y);\n"
			   "\t\ts16 n = 1;\n"
			   "\t\twhile (y + n < fim && stream_largura(m, y + n) == largura) {\n\t\t\tn++;\n\t\t}\n"
			   "\t\tstream_coluna(m, x + largura, y, n, FALSE);\n"
			   "\t\ty += n;\n"
			   "\t}\n"
			   "}\n\n"
			   "// A câmera andou: carrega a coluna ou a linha que entrou na janela (as que saem não precisam de nada).\n"
			   "void stream_mover(MapaStream *m, s16 camera_x, s16 camera_y) {\n"
			   "\tconst s16 coluna = camera_x >> 3, linha = camera_y >> 3;\n"
			   "\tif (m->coluna == FORA_DA_JANELA || abs(coluna - m->coluna) >= JANELA_COLUNAS || abs(linha - m->linha) >= JANELA_LINHAS) {\n"
			   "\t\tstream_recarregar(m, coluna, linha);\n\t\treturn;\n\t}\n"
			   "\twhile (m->coluna < coluna) {\n"
			   "\t\tstream_borda_direita(m, m->coluna);\n"
			   "\t\tm->coluna++;\n\t}\n"
			   "\twhile (m->coluna > coluna) {\n"
			   "\t\tm->coluna--;\n"
			   "\t\tstream_coluna(m, m->coluna, m->linha, JANELA_LINHAS, FALSE);\n"
			   "\t}\n"
			   "\twhile (m->linha < linha) {\n"
			   "\t\tconst s16 entra = m->linha + JANELA_LINHAS;\n"
			   "\t\tstream_linha(m, m->coluna, entra, stream_largura(m, entra), FALSE);\n"
			   "\t\tm->linha++;\n\t}\n"
			   "\twhile (m->linha > linha) {\n"
			   "\t\tm->linha--;\n"
			   "\t\tstream_linha(m, m->coluna, m->linha, stream_largura(m, m->linha), FALSE);\n"
			   "\t}\n"
			   "}\n\n");
		return c;
	}

	// Save na SRAM e senha: sempre no jogo.c (poucas centenas de bytes; o linker do SGDK não descarta o que
	// não é chamado, mas cabe folgado). Cada slot: "RS", versão, dados e soma de 16 bits.
	static String save_runtime() {
		return U("// ---- Progresso salvo (SRAM) ----\n"
				 "#define SAVE_VERSAO 1\n#define SAVE_TAMANHO 64 // Bytes da SRAM por slot.\n#define SAVE_DADOS (2 + 1 + 4 + JOGO_VARS * 2)\n\n"
				 "static u16 save_soma(const u8 *dados, u16 n) {\n\tu16 soma = 0x5253;\n\tfor (u16 i = 0; i < n; i++) {\n\t\tsoma = ((soma << 1) | (soma >> 15)) ^ dados[i];\n\t}\n\treturn soma;\n}\n\n"
				 "bool jogo_salvar(u8 slot) {\n\tif (slot >= JOGO_SLOTS) {\n\t\treturn FALSE;\n\t}\n\tu8 dados[SAVE_DADOS];\n\tu16 n = 0;\n"
				 "\tdados[n++] = cena_atual >> 8;\n\tdados[n++] = cena_atual;\n\tdados[n++] = vidas;\n"
				 "\tfor (s16 b = 24; b >= 0; b -= 8) {\n\t\tdados[n++] = pontos >> b;\n\t}\n"
				 "\tfor (u16 i = 0; i < JOGO_VARS; i++) {\n\t\tdados[n++] = jogo_var[i] >> 8;\n\t\tdados[n++] = jogo_var[i];\n\t}\n"
				 "\tconst u16 soma = save_soma(dados, n);\n\tconst u32 base = (u32)slot * SAVE_TAMANHO;\n"
				 "\tSRAM_enable();\n\tSRAM_writeByte(base, 'R');\n\tSRAM_writeByte(base + 1, 'S');\n\tSRAM_writeByte(base + 2, SAVE_VERSAO);\n"
				 "\tfor (u16 i = 0; i < n; i++) {\n\t\tSRAM_writeByte(base + 3 + i, dados[i]);\n\t}\n"
				 "\tSRAM_writeByte(base + 3 + n, soma >> 8);\n\tSRAM_writeByte(base + 4 + n, soma);\n\tSRAM_disable();\n\treturn TRUE;\n}\n\n"
				 "static bool save_ler(u8 slot, u8 *dados) {\n\tif (slot >= JOGO_SLOTS) {\n\t\treturn FALSE;\n\t}\n\tconst u32 base = (u32)slot * SAVE_TAMANHO;\n"
				 "\tSRAM_enableRO();\n\tbool ok = SRAM_readByte(base) == 'R' && SRAM_readByte(base + 1) == 'S' && SRAM_readByte(base + 2) == SAVE_VERSAO;\n"
				 "\tif (ok) {\n\t\tfor (u16 i = 0; i < SAVE_DADOS; i++) {\n\t\t\tdados[i] = SRAM_readByte(base + 3 + i);\n\t\t}\n"
				 "\t\tconst u16 soma = (SRAM_readByte(base + 3 + SAVE_DADOS) << 8) | SRAM_readByte(base + 4 + SAVE_DADOS);\n"
				 "\t\tok = soma == save_soma(dados, SAVE_DADOS) && ((dados[0] << 8) | dados[1]) < CENAS_TOTAL;\n\t}\n\tSRAM_disable();\n\treturn ok;\n}\n\n"
				 "bool jogo_tem_save(u8 slot) {\n\tu8 dados[SAVE_DADOS];\n\treturn save_ler(slot, dados);\n}\n\n"
				 "bool jogo_carregar(u8 slot) {\n\tu8 dados[SAVE_DADOS];\n\tif (!save_ler(slot, dados)) {\n\t\treturn FALSE;\n\t}\n"
				 "\tu16 n = 0;\n\tconst u16 cena = (dados[0] << 8) | dados[1];\n\tn = 2;\n\tvidas = dados[n++];\n\tpontos = 0;\n"
				 "\tfor (u16 i = 0; i < 4; i++) {\n\t\tpontos = (pontos << 8) | dados[n++];\n\t}\n"
				 "\tfor (u16 i = 0; i < JOGO_VARS; i++) {\n\t\tjogo_var[i] = (dados[n] << 8) | dados[n + 1];\n\t\tn += 2;\n\t}\n"
				 "\tjogo_slot = slot;\n\tcena_proxima = cena;\n\trecarregar = TRUE;\n\treturn TRUE;\n}\n\n"
				 "void jogo_apagar_save(u8 slot) {\n\tif (slot >= JOGO_SLOTS) {\n\t\treturn;\n\t}\n\tSRAM_enable();\n\tSRAM_writeByte((u32)slot * SAVE_TAMANHO, 0);\n\tSRAM_disable();\n}\n\n"
				 "// ---- Senha: 8 letras de 5 bits = cena (6), vidas (4), pontos / 10 (20) e verificação (10), embaralhadas ----\n"
				 "static const char senha_letras[] = \"ABCDEFGHJKLMNPQRSTUVWXYZ23456789\"; // Sem I, O, 0 e 1.\n\n"
				 "static u16 senha_verificacao(u32 valor) {\n\treturn (u16)(((valor ^ (valor >> 10) ^ (valor >> 20)) * 0x2B5 + 0x15D) & 0x3FF);\n}\n\n"
				 "void jogo_senha(char *texto) {\n\tu32 dezenas = pontos / 10;\n\tif (dezenas > 0xFFFFF) {\n\t\tdezenas = 0xFFFFF;\n\t}\n"
				 "\tconst u32 valor = (cena_atual & 63) | ((u32)(vidas & 15) << 6) | (dezenas << 10);\n\tconst u16 verificacao = senha_verificacao(valor);\n"
				 "\tu8 anterior = 0;\n\tfor (u16 i = 0; i < JOGO_SENHA_LETRAS; i++) {\n"
				 "\t\tu8 grupo = i < 6 ? (valor >> (i * 5)) & 31 : (verificacao >> ((i - 6) * 5)) & 31;\n"
				 "\t\tgrupo = (grupo + anterior + i * 7 + 3) & 31;\n\t\tanterior = grupo;\n\t\ttexto[i] = senha_letras[grupo];\n\t}\n\ttexto[JOGO_SENHA_LETRAS] = 0;\n}\n\n"
				 "bool jogo_usar_senha(const char *texto) {\n\tu32 valor = 0;\n\tu16 verificacao = 0;\n\tu8 anterior = 0;\n"
				 "\tfor (u16 i = 0; i < JOGO_SENHA_LETRAS; i++) {\n\t\ts16 grupo = -1;\n\t\tfor (u16 k = 0; k < 32; k++) {\n\t\t\tif (senha_letras[k] == texto[i]) {\n\t\t\t\tgrupo = k;\n\t\t\t}\n\t\t}\n"
				 "\t\tif (grupo < 0) {\n\t\t\treturn FALSE;\n\t\t}\n\t\tconst u8 bits = (grupo - anterior - i * 7 - 3) & 31;\n\t\tanterior = grupo;\n"
				 "\t\tif (i < 6) {\n\t\t\tvalor |= (u32)bits << (i * 5);\n\t\t} else {\n\t\t\tverificacao |= bits << ((i - 6) * 5);\n\t\t}\n\t}\n"
				 "\tconst u16 cena = valor & 63;\n\tif (verificacao != senha_verificacao(valor) || cena >= CENAS_TOTAL || cena == 0) {\n\t\treturn FALSE;\n\t}\n"
				 "\tvidas = (valor >> 6) & 15;\n\tpontos = (valor >> 10) * 10;\n\tmemset(jogo_var, 0, sizeof(jogo_var));\n\tcena_proxima = cena;\n\trecarregar = TRUE;\n\treturn TRUE;\n}\n\n");
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
		c += "};\n\nu8 vidas;\nu32 pontos;\nu16 jogo_var[JOGO_VARS];\nu8 jogo_slot;\nstatic u16 cena_atual, cena_proxima;\nstatic bool perdeu, recarregar;\nstatic const u8 *musica_atual;\n\n";
		c += "u16 jogo_cena_atual(void) {\n\treturn cena_atual;\n}\n\n";
		c += U("// ---- Efeitos de paleta ----\n#define CICLOS_MAX 8\n"
			   "static const CicloCores *ciclos;\nstatic u8 ciclos_quantos, ciclos_lidos;\nstatic u8 ciclo_espera[CICLOS_MAX];\nstatic u16 ciclo_cores[CICLOS_MAX][16];\n"
			   "static u8 flash_quadros;\nstatic u16 flash_salvas[64];\n\n"
			   "void jogo_ciclos(const CicloCores *lista, u8 quantos) {\n\tciclos = lista;\n\tciclos_quantos = quantos > CICLOS_MAX ? CICLOS_MAX : quantos;\n\tciclos_lidos = FALSE;\n}\n\n"
			   "void jogo_flash(u16 cor, u8 quadros) {\n\tif (!flash_quadros) {\n\t\tPAL_getColors(0, flash_salvas, 64);\n\t}\n\tu16 todas[64];\n\tfor (u16 i = 0; i < 64; i++) {\n\t\ttodas[i] = (i & 15) ? cor : flash_salvas[i];\n\t}\n"
			   "\tPAL_setColors(0, todas, 64, DMA_QUEUE);\n\tflash_quadros = quadros ? quadros : 1;\n}\n\n"
			   "// Uma vez por quadro, depois da cena: o flash volta às cores salvas e os ciclos giram (escrita na fila do DMA, no vblank).\n"
			   "static void efeitos_quadro(void) {\n\tif (flash_quadros) {\n\t\tif (--flash_quadros == 0) {\n\t\t\tPAL_setColors(0, flash_salvas, 64, DMA_QUEUE);\n\t\t}\n\t\treturn;\n\t}\n"
			   "\tif (!ciclos_quantos) {\n\t\treturn;\n\t}\n\tif (!ciclos_lidos) {\n\t\tfor (u8 i = 0; i < ciclos_quantos; i++) {\n\t\t\tPAL_getColors(ciclos[i].paleta * 16 + ciclos[i].primeira, ciclo_cores[i], ciclos[i].quantidade);\n\t\t\tciclo_espera[i] = ciclos[i].intervalo;\n\t\t}\n\t\tciclos_lidos = TRUE;\n\t}\n"
			   "\tfor (u8 i = 0; i < ciclos_quantos; i++) {\n\t\tconst CicloCores *c = &ciclos[i];\n\t\tif (--ciclo_espera[i]) {\n\t\t\tcontinue;\n\t\t}\n\t\tciclo_espera[i] = c->intervalo;\n\t\tu16 *cores = ciclo_cores[i];\n"
			   "\t\tif (c->sentido > 0) {\n\t\t\tconst u16 ultima = cores[c->quantidade - 1];\n\t\t\tfor (u8 k = c->quantidade - 1; k > 0; k--) {\n\t\t\t\tcores[k] = cores[k - 1];\n\t\t\t}\n\t\t\tcores[0] = ultima;\n\t\t} else {\n"
			   "\t\t\tconst u16 primeira = cores[0];\n\t\t\tfor (u8 k = 0; k + 1 < c->quantidade; k++) {\n\t\t\t\tcores[k] = cores[k + 1];\n\t\t\t}\n\t\t\tcores[c->quantidade - 1] = primeira;\n\t\t}\n"
			   "\t\tPAL_setColors(c->paleta * 16 + c->primeira, cores, c->quantidade, DMA_QUEUE);\n\t}\n}\n\n");
		c += save_runtime();
		c += U("// ---- Opções (SRAM depois dos slots: \"RC\", versão, música, efeitos, controles e soma) ----\n"
			   "#define CONFIG_ENDERECO (JOGO_SLOTS * SAVE_TAMANHO)\n"
			   "u8 jogo_musica_ligada = 1, jogo_efeitos_ligados = 1, jogo_controles;\n\n"
			   "void jogo_config_salvar(void) {\n\tconst u8 dados[3] = { jogo_musica_ligada, jogo_efeitos_ligados, jogo_controles };\n"
			   "\tSRAM_enable();\n\tSRAM_writeByte(CONFIG_ENDERECO, 'R');\n\tSRAM_writeByte(CONFIG_ENDERECO + 1, 'C');\n\tSRAM_writeByte(CONFIG_ENDERECO + 2, 1);\n"
			   "\tfor (u16 i = 0; i < 3; i++) {\n\t\tSRAM_writeByte(CONFIG_ENDERECO + 3 + i, dados[i]);\n\t}\n\tSRAM_writeByte(CONFIG_ENDERECO + 6, save_soma(dados, 3));\n\tSRAM_disable();\n}\n\n"
			   "static void jogo_config_carregar(void) {\n\tu8 dados[3];\n\tSRAM_enableRO();\n"
			   "\tconst bool ok = SRAM_readByte(CONFIG_ENDERECO) == 'R' && SRAM_readByte(CONFIG_ENDERECO + 1) == 'C' && SRAM_readByte(CONFIG_ENDERECO + 2) == 1;\n"
			   "\tfor (u16 i = 0; i < 3; i++) {\n\t\tdados[i] = SRAM_readByte(CONFIG_ENDERECO + 3 + i);\n\t}\n\tconst u8 soma = SRAM_readByte(CONFIG_ENDERECO + 6);\n\tSRAM_disable();\n"
			   "\tif (ok && soma == (u8)save_soma(dados, 3) && dados[2] < 3) {\n\t\tjogo_musica_ligada = dados[0] != 0;\n\t\tjogo_efeitos_ligados = dados[1] != 0;\n\t\tjogo_controles = dados[2];\n\t}\n}\n\n"
			   "u16 jogo_ler(u16 controle) {\n\tconst u16 b = JOY_readJoypad(controle);\n"
			   "\tif (jogo_controles == 1) {\n\t\treturn (b & ~(BUTTON_A | BUTTON_C)) | ((b & BUTTON_A) ? BUTTON_C : 0) | ((b & BUTTON_C) ? BUTTON_A : 0);\n\t}\n"
			   "\tif (jogo_controles == 2) {\n\t\treturn (b & ~(BUTTON_A | BUTTON_B)) | ((b & BUTTON_A) ? BUTTON_B : 0) | ((b & BUTTON_B) ? BUTTON_A : 0);\n\t}\n\treturn b;\n}\n\n");
		c += "void jogo_trocar_cena(u16 cena) {\n\tcena_proxima = cena;\n}\n\n";
		c += "void jogo_perdeu(void) {\n\tperdeu = TRUE;\n}\n\n";
		c += "void jogo_musica(const u8 *musica) {\n\tif (musica == musica_atual) {\n\t\treturn;\n\t}\n\tmusica_atual = musica;\n\tif (musica && jogo_musica_ligada) {\n\t\tXGM_startPlay(musica);\n\t} else {\n\t\tXGM_stopPlay();\n\t}\n}\n\n";
		c += "void jogo_config_aplicar(void) {\n\tif (musica_atual && jogo_musica_ligada) {\n\t\tXGM_startPlay(musica_atual);\n\t} else {\n\t\tXGM_stopPlay();\n\t}\n}\n\n";
		// Efeitos nos canais 2 a 4 do XGM (o 1 é da música): o primeiro livre; sem livre, o mais antigo.
		c += U("void jogo_som(u8 som) {\n\tif (!jogo_efeitos_ligados) {\n\t\treturn;\n\t}\n\tstatic u8 proximo;\n\tstatic const u16 canais[3] = { SOUND_PCM_CH2, SOUND_PCM_CH3, SOUND_PCM_CH4 };\n\tstatic const u16 mascaras[3] = { SOUND_PCM_CH2_MSK, SOUND_PCM_CH3_MSK, SOUND_PCM_CH4_MSK };\n\tconst u8 tocando = XGM_isPlayingPCM(SOUND_PCM_CH2_MSK | SOUND_PCM_CH3_MSK | SOUND_PCM_CH4_MSK);\n\tfor (u16 i = 0; i < 3; i++) {\n\t\tif (!(tocando & mascaras[i])) {\n\t\t\tXGM_startPlayPCM(som, 1, canais[i]);\n\t\t\treturn;\n\t\t}\n\t}\n\tXGM_startPlayPCM(som, 1, canais[proximo]);\n\tproximo = (proximo + 1) % 3;\n}\n\n");
		if (uses_streaming) {
			c += stream_runtime();
		}
		c += U("// Escurece a tela e desfaz a cena atual: sprites, mapas, planos e rolagem.\n"
			   "static void tela_limpar(void) {\n\tif (flash_quadros) {\n\t\tflash_quadros = 0;\n\t\tPAL_setColors(0, flash_salvas, 64, CPU);\n\t}\n\tjogo_ciclos(NULL, 0);\n\tPAL_fadeOutAll(15, FALSE);\n\tcenas[cena_atual].encerrar();\n\tVDP_setHilightShadow(FALSE);\n"
			   "\tVDP_setWindowVPos(FALSE, 0);\n\tVDP_setTextPlane(BG_A);\n"
			   "\tVDP_clearPlane(BG_A, TRUE);\n\tVDP_clearPlane(BG_B, TRUE);\n\tVDP_clearPlane(WINDOW, TRUE);\n"
			   "\tVDP_setHorizontalScroll(BG_A, 0);\n\tVDP_setHorizontalScroll(BG_B, 0);\n\tVDP_setVerticalScroll(BG_A, 0);\n\tVDP_setVerticalScroll(BG_B, 0);\n}\n\n");
		c += "static void fim_de_jogo(void) {\n\ttela_limpar();\n\tjogo_musica(NULL);\n\tVDP_drawText(\"GAME OVER\", 15, 13);\n\tPAL_setColor(15, RGB24_TO_VDPCOLOR(0xEEEEEE));\n"
			 "\tfor (u16 i = 0; i < 150; i++) {\n\t\tSYS_doVBlankProcess();\n\t}\n\tPAL_fadeOutAll(15, FALSE);\n\tVDP_clearPlane(BG_A, TRUE);\n}\n\n";
		c += "int main(bool hard) {\n\t(void)hard;\n";
		if (uses_streaming) {
			// O streaming manda os padrões e as colunas novas pela fila do DMA (no vblank): fila maior.
			c += U("\tDMA_initEx(256, 0xFFFF, 0); // Sem limite de bytes por quadro, como o DMA_init.\n");
		}
		if (audio) {
			c += "\tZ80_loadDriver(Z80_DRIVER_XGM, TRUE);\n";
		}
		for (const Asset &asset : assets) {
			if (asset.kind == "WAV") {
				c += vformat("\tXGM_setPCM(%s, %s, sizeof(%s));\n", asset.define, asset.symbol, asset.symbol);
			}
		}
		c += "\tjogo_config_carregar();\n";
		// Voltar à cena principal (pelo fim de jogo ou por uma saída) começa um jogo novo.
		c += "\tcenas[cena_atual].iniciar();\n\twhile (TRUE) {\n\t\tcenas[cena_atual].atualizar();\n\t\tefeitos_quadro();\n\t\tSYS_doVBlankProcess();\n"
			 "\t\tif (perdeu) {\n\t\t\tperdeu = FALSE;\n\t\t\tfim_de_jogo();\n\t\t\tcena_atual = cena_proxima = 0;\n"
			 "\t\t} else if (cena_proxima != cena_atual || recarregar) {\n\t\t\trecarregar = FALSE;\n\t\t\ttela_limpar();\n\t\t\tcena_atual = cena_proxima;\n\t\t} else {\n\t\t\tcontinue;\n\t\t}\n"
			 "\t\tif (cena_atual == 0) {\n\t\t\tvidas = 0;\n\t\t\tpontos = 0;\n\t\t\tmemset(jogo_var, 0, sizeof(jogo_var));\n\t\t}\n\t\tcenas[cena_atual].iniciar();\n\t}\n\treturn 0;\n}\n";
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
	// "Set as Main Scene" grava o ID (uid://); o build usa o caminho (nomes CENA_<NOME>, mensagens).
	const String main_scene = ResourceUID::ensure_path(GLOBAL_GET("application/run/main_scene"));
	if (main_scene.is_empty()) {
		exporter.result.skipped = true;
		return exporter.result;
	}
	exporter.scene_for(main_scene);
	exporter.scan_code();
	// Todas as cenas do projeto com uma MDCena na raiz entram no jogo, e ele começa na principal: trocar a
	// cena principal para testar uma fase não deixa sem cena (CENA_<NOME>) nem sem cabeçalho (codigo_<ator>.h)
	// o código e as saídas das outras.
	{
		PackedStringArray sources, waves, scene_files;
		exporter.collect_files("", sources, waves, scene_files);
		scene_files.sort();
		for (const String &file : scene_files) {
			const String path = "res://" + file;
			const Ref<PackedScene> packed = ResourceLoader::load(path, "PackedScene");
			if (packed.is_valid() && packed->get_state().is_valid() && packed->get_state()->get_node_count() > 0 && packed->get_state()->get_node_type(0) == SNAME("MDCena")) {
				exporter.scene_for(path);
			}
		}
	}
	// A fila: a principal primeiro, as outras cenas do projeto e os destinos das saídas e do START.
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
			const String root_class = root ? root->get_class() : String("?");
			if (root) {
				memdelete(root);
			}
			if (i == 0) {
				// Projetos que não usam cenas do Mega Drive seguem só com o código escrito à mão. Com outras
				// cenas MDCena no projeto, a principal com outra raiz é engano: compilaria o jogo antigo.
				if (exporter.scenes.size() <= 1) {
					exporter.result.skipped = true;
					return exporter.result;
				}
				exporter.result.errors.push_back(vformat(U("%s: a cena principal precisa ter uma MDCena na raiz (a raiz é um %s). Abra a cena, clique com o botão direito na raiz, escolha \"Alterar Tipo...\" e procure MDCena."),
						path, root_class));
				continue;
			}
			exporter.result.errors.push_back(path + U(": a raiz da cena precisa ser uma MDCena (botão direito na raiz, \"Alterar Tipo...\", MDCena)."));
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
		exporter.save_on_enter = cena->get_salvar_ao_entrar();
		exporter.shadow_mode = cena->get_luz_e_sombra();
		if (!cena->get_ao_fim_da_animacao().is_empty()) {
			exporter.animation_end_scene = exporter.scene_for(cena->get_ao_fim_da_animacao());
		}
		exporter.visit(root, root);
		exporter.finish_letreiros(); // Antes da conta dos sprites: o letreiro sem vram_da_fonte ocupa a VRAM deles.
		if (!exporter.actors.is_empty()) {
			exporter.sprite_tiles += exporter.template_tiles; // Os tipos que o código cria precisam de vaga.
			exporter.sprite_tiles += exporter.sleeping_tiles();
		}
		exporter.finish_maps();
		exporter.finish_dialogs();
		exporter.finish_menu();
		exporter.check_hud();
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
		if (!exporter.exits.is_empty() && !exporter.player && exporter.camera_actor < 0) {
			exporter.result.warnings.push_back(exporter.scene_label + U("as saídas só funcionam numa cena com MDJogador."));
		}
		if (exporter.sprites.size() + exporter.actors.size() > RetroMD::MAX_SPRITES) {
			exporter.result.errors.push_back(exporter.scene_label + vformat(U("a cena tem %d sprites; o console mostra no máximo %d."), exporter.sprites.size() + exporter.actors.size(), RetroMD::MAX_SPRITES));
		}
		if (exporter.background_tiles + exporter.sprite_tiles > FREE_VRAM_TILES) {
			exporter.result.errors.push_back(exporter.scene_label + vformat(U("fundos e mapas (%d tiles%s) e sprites (%d tiles) passam dos %d tiles livres na VRAM. Simplifique as imagens, repita mais tiles ou use sprites menores."),
																			exporter.background_tiles, exporter.scene_streams() ? U(", com streaming") : String(), exporter.sprite_tiles, FREE_VRAM_TILES));
		}
		exporter.result.info.push_back(vformat(U("%s: VRAM %d/%d tiles (%d%%): fundos e mapas %d%s, sprites %d; %d/%d sprites."), path.get_file(), exporter.background_tiles + exporter.sprite_tiles, FREE_VRAM_TILES,
				(exporter.background_tiles + exporter.sprite_tiles) * 100 / FREE_VRAM_TILES, exporter.background_tiles, exporter.scene_streams() ? U(" com streaming") : String(), exporter.sprite_tiles,
				exporter.sprites.size() + exporter.actors.size(), RetroMD::MAX_SPRITES));
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
	exporter.add_orphan_scripts();
	exporter.write("res/cenas_gerado.res", exporter.resources());
	exporter.write("src/gerado/jogo.h", exporter.game_header());
	exporter.write("src/gerado/jogo.c", exporter.game_source());
	// Bibliotecas do runtime (src/gerado/): os atores e os diálogos, só quando o jogo usa.
	for (const RetroRuntimeFile *file = RETRO_RUNTIME_FILES; file->name; file++) {
		const String name = file->name;
		if ((name.begins_with("ator.") && exporter.uses_actors) || (name.begins_with("dialogo.") && exporter.uses_dialogs) || (name.begins_with("menu.") && exporter.uses_menu)) {
			exporter.write("src/gerado/" + name, String::utf8((const char *)file->data));
		}
	}
	if (exporter.uses_actors) {
		exporter.write("src/gerado/atores.h", exporter.actors_header());
		if (!exporter.templates.is_empty()) {
			exporter.write("src/gerado/tipos.c", exporter.types_source());
		}
		for (const KeyValue<String, ScriptInfo> &script : exporter.scripts) {
			exporter.write("src/gerado/codigo_" + script.key + ".h", exporter.script_header(script.key, script.value));
		}
	}
	exporter.remove_stale("src/gerado", true);
	exporter.remove_stale("res/gerado", false);
	return exporter.result;
}

} // namespace RetroSgdkExport
