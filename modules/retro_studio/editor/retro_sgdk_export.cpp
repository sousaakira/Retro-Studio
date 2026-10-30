#include "retro_sgdk_export.h"

#include "../scene/md_nodes.h"

#include "core/config/project_settings.h"
#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/resource_loader.h"
#include "core/templates/hash_map.h"
#include "scene/resources/packed_scene.h"

namespace RetroSgdkExport {

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

struct Asset {
	String symbol;
	String kind; // IMAGE ou SPRITE
	String file; // Relativo a res/, como o rescomp lê.
	String texture;
	int frame_tiles_w = 0, frame_tiles_h = 0, speed = 0;
};

struct Exporter {
	String project_dir;
	Result result;
	Vector<Asset> assets;
	HashMap<String, int> asset_by_key;
	HashMap<String, int> symbols;
	String palette_source[4]; // Recurso que carrega cada paleta.
	String palette_texture[4];
	String init_code, update_code, declarations;
	int sprite_count = 0;
	int player_count = 0;

	String symbol_for(const String &p_prefix, const String &p_texture) {
		String base = p_texture.get_file().get_basename().to_lower();
		String symbol = p_prefix;
		for (int i = 0; i < base.length(); i++) {
			const char32_t c = base[i];
			symbol += is_ascii_alphanumeric_char(c) ? String::chr(c) : String("_");
		}
		const int used = symbols.has(symbol) ? symbols[symbol] : 0;
		symbols[symbol] = used + 1;
		return used ? symbol + "_" + itos(used + 1) : symbol;
	}

	String res_relative(const String &p_texture) const {
		const String global = ProjectSettings::get_singleton()->globalize_path(p_texture);
		const String res_dir = project_dir.path_join("res") + "/";
		if (global.begins_with(res_dir)) {
			return global.substr(res_dir.length());
		}
		return "../" + global.substr(project_dir.length() + 1);
	}

	int asset_for(const String &p_kind, Sprite2D *p_node, int p_speed) {
		const Ref<Texture2D> texture = p_node->get_texture();
		const String path = texture->get_path();
		const int frame_w = texture->get_width() / MAX(1, p_node->get_hframes()), frame_h = texture->get_height() / MAX(1, p_node->get_vframes());
		const String key = p_kind + "|" + path + "|" + itos(frame_w) + "x" + itos(frame_h) + "|" + itos(p_speed);
		if (asset_by_key.has(key)) {
			return asset_by_key[key];
		}
		Asset asset;
		asset.kind = p_kind;
		asset.texture = path;
		asset.file = res_relative(path);
		asset.symbol = symbol_for(p_kind == "IMAGE" ? "img_" : "spr_", path);
		asset.frame_tiles_w = frame_w / 8;
		asset.frame_tiles_h = frame_h / 8;
		asset.speed = p_speed;
		assets.push_back(asset);
		asset_by_key[key] = assets.size() - 1;
		return assets.size() - 1;
	}

	void use_palette(int p_slot, const Asset &p_asset, const String &p_node) {
		if (palette_source[p_slot].is_empty()) {
			palette_source[p_slot] = p_asset.symbol;
			palette_texture[p_slot] = p_asset.texture;
		} else if (palette_texture[p_slot] != p_asset.texture) {
			result.warnings.push_back(vformat(U("%s usa a PAL%d, que já carrega as cores de %s; as cores de %s podem sair diferentes."), p_node, p_slot, palette_texture[p_slot].get_file(), p_asset.texture.get_file()));
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
		const Vector2 position = scene_position(p_node, p_root).round();
		if (MDFundo *fundo = Object::cast_to<MDFundo>(p_node)) {
			if (check(p_node, fundo->get_configuration_warnings())) {
				const Asset &asset = assets[asset_for("IMAGE", fundo, 0)];
				use_palette(fundo->get_paleta(), asset, name);
				init_code += vformat("\t// %s\n\tVDP_drawImageEx(%s, &%s, TILE_ATTR_FULL(PAL%d, FALSE, FALSE, FALSE, tile), %d, %d, FALSE, TRUE);\n\ttile += %s.tileset->numTile;\n",
						name, fundo->get_plano() == MDFundo::PLANO_A ? "BG_A" : "BG_B", asset.symbol, fundo->get_paleta(), int(position.x) / 8, int(position.y) / 8, asset.symbol);
			}
		} else if (MDSprite *sprite = Object::cast_to<MDSprite>(p_node)) {
			if (check(p_node, sprite->get_configuration_warnings())) {
				const Asset &asset = assets[asset_for("SPRITE", sprite, sprite->get_velocidade_animacao())];
				use_palette(sprite->get_paleta(), asset, name);
				const String variable = vformat("sprite_%d", sprite_count++);
				declarations += vformat("static Sprite *%s; // %s\n", variable, name);
				init_code += vformat("\t%s = SPR_addSprite(&%s, %d, %d, TILE_ATTR(PAL%d, %s, FALSE, FALSE));\n", variable, asset.symbol, int(position.x), int(position.y), sprite->get_paleta(), sprite->get_prioridade() ? "TRUE" : "FALSE");
				if (sprite->get_frame() > 0) {
					init_code += vformat("\tSPR_setAnimAndFrame(%s, %d, %d);\n", variable, sprite->get_frame() / MAX(1, sprite->get_hframes()), sprite->get_frame() % MAX(1, sprite->get_hframes()));
				}
				if (sprite->is_flipped_h()) {
					init_code += vformat("\tSPR_setHFlip(%s, TRUE);\n", variable);
				}
				if (MDJogador *jogador = Object::cast_to<MDJogador>(sprite)) {
					if (player_count++ == 0) {
						add_player(jogador, variable, position, asset);
					}
				}
			}
		} else if (MDTexto *texto = Object::cast_to<MDTexto>(p_node)) {
			if (check(p_node, texto->get_configuration_warnings()) && !texto->get_texto().is_empty()) {
				init_code += vformat("\tVDP_drawText(\"%s\", %d, %d);\n", texto->get_texto().c_escape(), int(position.x) / 8, int(position.y) / 8);
			}
		}
		for (int i = 0; i < p_node->get_child_count(); i++) {
			visit(p_node->get_child(i), p_root);
		}
	}

	void add_player(MDJogador *p_jogador, const String &p_sprite, const Vector2 &p_position, const Asset &p_asset) {
		declarations += vformat(U("// Jogador (%s): posição e velocidade vertical em 1/16 de pixel; o chão é a posição inicial.\n"), p_jogador->get_name());
		declarations += vformat("static s16 jogador_x = %d;\nstatic s16 jogador_y16 = %d * 16, jogador_vy16 = 0;\nstatic bool jogador_no_chao = TRUE;\n", int(p_position.x), int(p_position.y));
		const int width = p_asset.frame_tiles_w * 8;
		update_code += vformat(
				"\t{\n"
				"\t\tconst u16 botoes = JOY_readJoypad(JOY_1);\n"
				"\t\tbool andando = FALSE;\n"
				"\t\tif (botoes & BUTTON_LEFT) {\n"
				"\t\t\tjogador_x -= %d;\n"
				"\t\t\tSPR_setHFlip(%s, TRUE);\n"
				"\t\t\tandando = TRUE;\n"
				"\t\t} else if (botoes & BUTTON_RIGHT) {\n"
				"\t\t\tjogador_x += %d;\n"
				"\t\t\tSPR_setHFlip(%s, FALSE);\n"
				"\t\t\tandando = TRUE;\n"
				"\t\t}\n"
				"\t\tjogador_x = clamp(jogador_x, 0, %d);\n"
				"\t\tif (jogador_no_chao && (botoes & (BUTTON_A | BUTTON_B | BUTTON_C))) {\n"
				"\t\t\tjogador_vy16 = -%d;\n"
				"\t\t\tjogador_no_chao = FALSE;\n"
				"\t\t}\n"
				"\t\tif (!jogador_no_chao) {\n"
				"\t\t\tjogador_vy16 += %d;\n"
				"\t\t\tjogador_y16 += jogador_vy16;\n"
				"\t\t\tif (jogador_y16 >= %d * 16) {\n"
				"\t\t\t\tjogador_y16 = %d * 16;\n"
				"\t\t\t\tjogador_vy16 = 0;\n"
				"\t\t\t\tjogador_no_chao = TRUE;\n"
				"\t\t\t}\n"
				"\t\t}\n"
				"\t\tSPR_setAnim(%s, andando && jogador_no_chao ? 1 : 0);\n"
				"\t\tSPR_setPosition(%s, jogador_x, jogador_y16 / 16);\n"
				"\t}\n",
				p_jogador->get_velocidade(), p_sprite, p_jogador->get_velocidade(), p_sprite, RetroMD::SCREEN_WIDTH - width, p_jogador->get_forca_pulo(),
				p_jogador->get_gravidade(), int(p_position.y), int(p_position.y), p_sprite, p_sprite);
	}

	void write(const String &p_relative, const String &p_content) {
		const String path = project_dir.path_join(p_relative);
		if (FileAccess::exists(path)) {
			const Ref<FileAccess> current = FileAccess::open(path, FileAccess::READ);
			if (current.is_valid() && !current->get_line().begins_with(GENERATED_MARK)) {
				result.errors.push_back(p_relative + U(" existe e não foi gerado pelo Retro Studio; o arquivo foi preservado. Renomeie ou apague para gerar a cena."));
				return;
			}
			if (FileAccess::get_file_as_string(path) == p_content) {
				return;
			}
		}
		DirAccess::make_dir_recursive_absolute(path.get_base_dir());
		const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
		if (file.is_null()) {
			result.errors.push_back(U("Não foi possível gravar ") + p_relative + ".");
			return;
		}
		file->store_string(p_content);
		result.written.push_back(p_relative);
	}
};

} // namespace

Result export_main_scene(const String &p_project_dir) {
	Exporter exporter;
	exporter.project_dir = p_project_dir;
	const String main_scene = GLOBAL_GET("application/run/main_scene");
	if (main_scene.is_empty()) {
		exporter.result.skipped = true;
		return exporter.result;
	}
	const Ref<PackedScene> scene = ResourceLoader::load(main_scene, "PackedScene");
	if (scene.is_null()) {
		exporter.result.errors.push_back(U("A cena principal não pôde ser carregada: ") + main_scene);
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
	exporter.init_code += "\tu16 tile = TILE_USER_INDEX;\n";
	// Na ordem da cena: fundos, textos e sprites (as paletas são carregadas antes de tudo).
	exporter.visit(root, root);
	if (exporter.sprite_count > RetroMD::MAX_SPRITES) {
		exporter.result.errors.push_back(vformat(U("A cena tem %d sprites; o console mostra no máximo %d."), exporter.sprite_count, RetroMD::MAX_SPRITES));
	}
	if (exporter.player_count > 1) {
		exporter.result.warnings.push_back(U("Há mais de um MDJogador; só o primeiro é controlado."));
	}
	const String scene_name = root->get_name();
	memdelete(root);
	if (!exporter.result.errors.is_empty()) {
		return exporter.result;
	}

	String res = String(GENERATED_MARK) + U(" a partir de ") + main_scene + U(". Não edite: o arquivo é refeito no build.\n");
	for (const Asset &asset : exporter.assets) {
		if (asset.kind == "IMAGE") {
			res += vformat("IMAGE %s \"%s\" BEST\n", asset.symbol, asset.file);
		} else {
			res += vformat("SPRITE %s \"%s\" %d %d NONE %d\n", asset.symbol, asset.file, asset.frame_tiles_w, asset.frame_tiles_h, asset.speed);
		}
	}
	String palettes;
	for (int slot = 0; slot < 4; slot++) {
		if (!exporter.palette_source[slot].is_empty()) {
			palettes += vformat("\tPAL_setPalette(PAL%d, %s.palette->data, DMA);\n", slot, exporter.palette_source[slot]);
		}
	}
	// Sprites são criados depois de SPR_init; o resto do código de início vem antes.
	String init = exporter.init_code;
	const int first_sprite = init.find("\tsprite_0 = ");
	if (first_sprite >= 0) {
		init = init.insert(first_sprite, "\tSPR_init();\n");
	}
	String c = String(GENERATED_MARK) + U(" a partir de ") + main_scene + U(" (cena ") + scene_name + U("). Não edite: o arquivo é refeito no build.\n");
	c += "#include <genesis.h>\n\n#include \"cenas_gerado.h\"\n\n";
	c += exporter.declarations;
	c += "\nstatic void cena_iniciar(void) {\n\tVDP_setScreenWidth320();\n" + palettes + init + "}\n\n";
	c += "static void cena_atualizar(void) {\n" + exporter.update_code + (exporter.sprite_count ? "\tSPR_update();\n" : "") + "}\n\n";
	c += "int main(bool hard) {\n\t(void)hard;\n\tcena_iniciar();\n\twhile (TRUE) {\n\t\tcena_atualizar();\n\t\tSYS_doVBlankProcess();\n\t}\n\treturn 0;\n}\n";
	exporter.write("res/cenas_gerado.res", res);
	exporter.write("src/gerado/cenas.c", c);
	return exporter.result;
}

} // namespace RetroSgdkExport
