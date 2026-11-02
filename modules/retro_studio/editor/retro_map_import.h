#pragma once

// "Importar como mapa" (botão direito num PNG): o cenário inteiro desenhado no Aseprite (ou em outro editor)
// vira um MDMapa, como o "Importar mapa do Aseprite" do Retro Studio em Electron.
// - As cores vão para a grade do console, no máximo 15 mais a transparência (uma paleta por mapa).
// - A imagem é cortada em tiles de 8×8; os iguais viram um só, e os vazios (transparentes) ficam sem tile.
// - Os tiles diferentes vão para <pasta do PNG>/<nome>_tiles.png e o TileSet, para res://tilesets/<nome>.tres.
// - O MDMapa escolhido (ou um novo) recebe o desenho célula por célula, a partir do canto (0, 0).
// Reimportar o mesmo PNG atualiza os mesmos arquivos; a colisão e os outros nodes da cena não mudam.

#include "../scene/md_nodes.h"

#include "editor/inspector/editor_inspector.h"
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
// Gera a imagem dos tiles e o TileSet e devolve os dados do mapa (não mexe na cena). p_offset (em células)
// é onde fica o canto do PNG: o deslocamento que o mapa já tinha, para reimportar sem perder a posição.
Result build(const String &p_png, const Vector2i &p_offset = Vector2i());
// Move o desenho dos mapas (MDMapa, MDColisao, MDPrioridade) por p_delta células, num passo de Ctrl+Z. Os
// nodes ficam em (0, 0) (o jogo exige); o que anda são as células. Falso, com o motivo, se algum sairia para
// coordenadas negativas (aí nenhum anda).
bool move_cells(const Vector<TileMapLayer *> &p_layers, const Vector2i &p_delta, String &r_error);
} // namespace RetroMapImport

// Inspetor dos mapas do Mega Drive: "Posição do desenho" com as setas (8 px; com Shift, 64 px) e os botões
// para encostar o desenho no topo ou à esquerda (tirar o espaço vazio de um PNG importado).
class RetroMapMoveInspector : public EditorInspectorPlugin {
	GDCLASS(RetroMapMoveInspector, EditorInspectorPlugin);

	static inline bool all_layers = true; // "Mover todos os mapas da cena juntos" (vale para a sessão).
	static Vector<TileMapLayer *> _layers(ObjectID p_layer);
	static void _all_toggled(bool p_on) { all_layers = p_on; }
	static void _move(ObjectID p_layer, Vector2i p_delta);
	static void _snap(ObjectID p_layer, bool p_top);
	static void _fix_negative(ObjectID p_layer); // Traz o desenho para dentro de (0, 0).
	static void _convert_tileset(ObjectID p_layer); // Imagem do TileSet para PNG indexado de 16 cores.

public:
	virtual bool can_handle(Object *p_object) override;
	virtual void parse_begin(Object *p_object) override;
};

// TileSet no Inspetor: o tamanho dos tiles fica fixo em 8×8 (o Mega Drive não tem outro) e o formato
// (quadrado, hexágono…), a disposição e o eixo somem.
class RetroTileSetLock : public EditorInspectorPlugin {
	GDCLASS(RetroTileSetLock, EditorInspectorPlugin);

public:
	virtual bool can_handle(Object *p_object) override;
	virtual bool parse_property(Object *p_object, const Variant::Type p_type, const String &p_path, const PropertyHint p_hint, const String &p_hint_text, const BitField<PropertyUsageFlags> p_usage, const bool p_wide = false) override;
};

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
