#pragma once

// Painel Console: o que a cena aberta ocupa no Mega Drive. VRAM (tiles de fundos e mapas, tiles e
// número de sprites) e as 4 paletas, com as cores como o console mostra (3 bits por canal), a imagem
// que define cada uma e os nodes que a usam. Segue as regras do gerador: a paleta de um slot vem do
// primeiro node da cena que o usa, e os tiles são contados como o rescomp conta.

#include "core/templates/hash_map.h"
#include "editor/docks/editor_dock.h"

class Label;
class MDMapa;
class VBoxContainer;

class RetroPaletteDock : public EditorDock {
	GDCLASS(RetroPaletteDock, EditorDock);

	struct Slot {
		String texture; // Imagem que define a paleta (vazio = ninguém usa).
		Vector<Color> colors;
		PackedStringArray users; // Nodes que usam o slot.
		PackedStringArray conflicts; // Nodes com imagem de outra paleta no mesmo slot.
	};

	struct Usage {
		int background_tiles = 0;
		int sprite_tiles = 0;
		int sprites = 0;
	};

	VBoxContainer *content = nullptr;
	HashMap<String, int> tile_cache; // Tiles distintos por imagem (chave: arquivo, data e tiles usados).
	struct CharacterInfo {
		Vector<Color> colors; // Paleta do atlas do personagem (a cor 0 incluída).
		int tiles = 0;
	};
	HashMap<String, CharacterInfo> character_cache;
	String signature; // Muda quando a cena muda de um jeito que afeta as paletas.
	double elapsed = 0;

	int _image_tiles(const String &p_path);
	int _map_tiles(MDMapa *p_mapa);
	void _collect(Node *p_node, Slot *r_slots, Usage &r_usage, bool &r_has_text, String &r_signature);
	void _add_meter(const String &p_label, int p_used, int p_total);
	void _rebuild(const Slot *p_slots, const Usage &p_usage, bool p_has_text, bool p_has_scene);
	void _refresh();

protected:
	void _notification(int p_what);

public:
	// Cor como o VDP mostra: 3 bits por canal.
	static Color to_console(const Color &p_color);

	RetroPaletteDock();
};
