#pragma once

// "Importar como mapa" (botão direito num PNG): o cenário inteiro desenhado no Aseprite (ou em outro editor)
// vira um MDMapa, como o "Importar mapa do Aseprite" do Retro Studio em Electron.
// - As cores vão para a grade do console, no máximo 15 mais a transparência (uma paleta por mapa).
// - A imagem é cortada em tiles de 8×8; os iguais viram um só, e os vazios (transparentes) ficam sem tile.
// - Os tiles diferentes vão para <pasta do PNG>/<nome>_tiles.png e o TileSet, para res://tilesets/<nome>.tres.
// - O MDMapa escolhido (ou um novo) recebe o desenho célula por célula, a partir do canto (0, 0).
// Reimportar o mesmo PNG atualiza os mesmos arquivos; a colisão e os outros nodes da cena não mudam.

#include "../scene/md_nodes.h"

#include "scene/gui/dialogs.h"

class Label;
class OptionButton;

namespace RetroMapImport {
struct Result {
	String error; // Vazio = deu certo.
	String atlas_path; // res://…_tiles.png
	String tileset_path; // res://tilesets/….tres
	Ref<TileSet> tile_set;
	PackedByteArray map_data; // tile_map_data do mapa preenchido.
	Vector2i size; // Em pixels (já completado até múltiplos de 8).
	int cells = 0; // Células com desenho.
	int unique = 0; // Tiles diferentes.
	int colors = 0; // Cores na paleta (sem a transparência).
	int original_colors = 0; // Cores da imagem original.
	bool padded = false; // O tamanho foi completado com transparente.
};
// Gera a imagem dos tiles e o TileSet e devolve os dados do mapa (não mexe na cena).
Result build(const String &p_png);
} // namespace RetroMapImport

class RetroMapImportDialog : public ConfirmationDialog {
	GDCLASS(RetroMapImportDialog, ConfirmationDialog);

	String png;
	Label *info = nullptr;
	OptionButton *target = nullptr;
	Label *warning = nullptr;
	Vector<ObjectID> maps; // MDMapa da cena, na ordem das opções.

	void _target_changed(int p_index);
	void _import();

public:
	void open(const String &p_png);
	RetroMapImportDialog();
};
