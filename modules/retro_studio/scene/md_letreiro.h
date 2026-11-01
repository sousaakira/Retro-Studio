#pragma once

// Texto por cima do jogo (créditos da música, nome da fase, avisos): no build vira um sprite fixo na tela,
// escrito com a fonte do SGDK mais os acentos do português (á, ã, ç, ê…). Pode sumir sozinho depois de
// alguns segundos. Diferente do MDTexto, que escreve no plano com a fonte (só ASCII) e fica sempre.

#include "scene/2d/node_2d.h"
#include "scene/resources/image_texture.h"

class MDLetreiro : public Node2D {
	GDCLASS(MDLetreiro, Node2D);

public:
	enum Alinhamento {
		ALINHAMENTO_ESQUERDA,
		ALINHAMENTO_CENTRO,
		ALINHAMENTO_DIREITA,
	};
	enum Borda {
		BORDA_NENHUMA,
		BORDA_SOMBRA, // 1 px para a direita e para baixo (como os créditos do Sota).
		BORDA_CONTORNO, // Em volta da letra toda.
	};

	// Maior lado de um sprite do SGDK (o rescomp junta até 16 sprites de 32×32 por quadro).
	static const int MAX_LADO = 248;

private:
	String texto;
	Color cor = Color(0.8, 1, 1);
	Borda borda = BORDA_SOMBRA;
	Color cor_da_borda = Color(0, 0, 0.12);
	Alinhamento alinhamento = ALINHAMENTO_ESQUERDA;
	int entrelinha = 8; // px entre o topo de uma linha e o da seguinte.
	float duracao = 5.0; // Segundos na tela; 0 = fica sempre.
	int paleta = 1;
	bool prioridade = true;
	bool vram_da_fonte = true;
	Ref<ImageTexture> previa;

	void _atualizar();

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	// Desenha o texto: pixels na cor, na cor da borda ou transparentes (RGBA8, lados múltiplos de 8).
	// r_sem_desenho recebe os caracteres que a fonte não tem (saem como "?").
	static Ref<Image> desenhar(const String &p_texto, const Color &p_cor, Borda p_borda, const Color &p_cor_da_borda, Alinhamento p_alinhamento, int p_entrelinha, String *r_sem_desenho = nullptr);
	Ref<Image> desenhar_texto(String *r_sem_desenho = nullptr) const;

	void set_texto(const String &p_texto);
	String get_texto() const { return texto; }
	void set_cor(const Color &p_cor);
	Color get_cor() const { return cor; }
	void set_borda(Borda p_borda);
	Borda get_borda() const { return borda; }
	void set_cor_da_borda(const Color &p_cor);
	Color get_cor_da_borda() const { return cor_da_borda; }
	void set_alinhamento(Alinhamento p_alinhamento);
	Alinhamento get_alinhamento() const { return alinhamento; }
	void set_entrelinha(int p_entrelinha);
	int get_entrelinha() const { return entrelinha; }
	void set_duracao(float p_duracao);
	float get_duracao() const { return duracao; }
	void set_paleta(int p_paleta);
	int get_paleta() const { return paleta; }
	void set_prioridade(bool p_prioridade);
	bool get_prioridade() const { return prioridade; }
	void set_vram_da_fonte(bool p_fonte);
	bool get_vram_da_fonte() const { return vram_da_fonte; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

VARIANT_ENUM_CAST(MDLetreiro::Alinhamento);
VARIANT_ENUM_CAST(MDLetreiro::Borda);
