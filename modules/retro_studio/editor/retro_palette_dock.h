#pragma once

// Painel Paletas: as 4 paletas do Mega Drive na cena aberta, com as cores como o console mostra
// (3 bits por canal), a imagem que define cada uma e os nodes que a usam. Segue a mesma regra do
// gerador: a paleta de um slot vem do primeiro node da cena que o usa.

#include "editor/docks/editor_dock.h"

class Label;
class VBoxContainer;

class RetroPaletteDock : public EditorDock {
	GDCLASS(RetroPaletteDock, EditorDock);

	struct Slot {
		String texture; // Imagem que define a paleta (vazio = ninguém usa).
		Vector<Color> colors;
		PackedStringArray users; // Nodes que usam o slot.
		PackedStringArray conflicts; // Nodes com imagem de outra paleta no mesmo slot.
	};

	VBoxContainer *content = nullptr;
	String signature; // Muda quando a cena muda de um jeito que afeta as paletas.
	double elapsed = 0;

	void _collect(Node *p_node, Slot *r_slots, bool &r_has_text, String &r_signature) const;
	void _rebuild(const Slot *p_slots, bool p_has_text, bool p_has_scene);
	void _refresh();

protected:
	void _notification(int p_what);

public:
	// Cor como o VDP mostra: 3 bits por canal.
	static Color to_console(const Color &p_color);

	RetroPaletteDock();
};
