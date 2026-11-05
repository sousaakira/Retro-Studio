#pragma once

// Nota para a IA: marca uma área da cena com um pedido, um problema ou uma informação. O agente de IA lê as
// notas (notes_list), vê a área (note_image) e responde nelas (note_update). Só existe no editor: o build
// ignora o node e os filhos dele, nada vai para a ROM.

#include "scene/2d/node_2d.h"

class MDNota : public Node2D {
	GDCLASS(MDNota, Node2D);

public:
	enum Tipo {
		TIPO_TAREFA,
		TIPO_PROBLEMA,
		TIPO_INFORMACAO,
	};
	enum Situacao {
		SITUACAO_ABERTA,
		SITUACAO_EM_ANDAMENTO,
		SITUACAO_RESOLVIDA,
	};

private:
	Vector2i tamanho = Vector2i(64, 48);
	Tipo tipo = TIPO_TAREFA;
	String texto;
	Situacao situacao = SITUACAO_ABERTA;
	String resposta;

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	static String nome_do_tipo(Tipo p_tipo);
	static String nome_da_situacao(Situacao p_situacao);
	Color cor() const;

	void set_tamanho(const Vector2i &p_tamanho);
	Vector2i get_tamanho() const { return tamanho; }
	void set_tipo(Tipo p_tipo);
	Tipo get_tipo() const { return tipo; }
	void set_texto(const String &p_texto);
	String get_texto() const { return texto; }
	void set_situacao(Situacao p_situacao);
	Situacao get_situacao() const { return situacao; }
	void set_resposta(const String &p_resposta);
	String get_resposta() const { return resposta; }

#ifdef DEBUG_ENABLED
	virtual bool _edit_use_rect() const override { return true; }
	virtual Rect2 _edit_get_rect() const override { return Rect2(Vector2(), Vector2(tamanho)); }
#endif
#ifdef TOOLS_ENABLED
	virtual void _edit_set_rect(const Rect2 &p_rect) override;
	// O tamanho entra no estado: ao redimensionar, o editor volta ao estado do começo do arrasto a cada
	// movimento do mouse; sem o tamanho nele, a mudança se somava a cada movimento e a nota crescia sem parar.
	virtual Dictionary _edit_get_state() const override;
	virtual void _edit_set_state(const Dictionary &p_state) override;
#endif

	virtual PackedStringArray get_configuration_warnings() const override;
};

VARIANT_ENUM_CAST(MDNota::Tipo);
VARIANT_ENUM_CAST(MDNota::Situacao);
