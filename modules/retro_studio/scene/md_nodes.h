#pragma once

// Nodes de cena do Mega Drive. Uma cena feita com eles vira código do SGDK no build
// (editor/retro_sgdk_export): MDCena é a tela, MDFundo uma imagem num plano do console, MDSprite um
// objeto animado, MDJogador o sprite controlado pelo controle e MDTexto um texto da fonte do SGDK.

#include "scene/2d/node_2d.h"
#include "scene/2d/sprite_2d.h"
#include "scene/2d/tile_map_layer.h"

namespace RetroMD {
static const int SCREEN_WIDTH = 320;
static const int SCREEN_HEIGHT = 224;
static const int MAX_SPRITES = 80;
// Problemas de uma imagem para o rescomp do SGDK (PNG indexado de até 16 cores, lados múltiplos de 8).
PackedStringArray texture_problems(const Ref<Texture2D> &p_texture, int p_frame_width, int p_frame_height);
// Cores da paleta de um PNG indexado (PLTE), na ordem dos índices; vazio se não for indexado.
Vector<Color> png_palette(const String &p_path);
} // namespace RetroMD

// Uma tela do jogo. A raiz da cena principal precisa ser uma MDCena.
class MDCena : public Node2D {
	GDCLASS(MDCena, Node2D);

protected:
	static void _bind_methods() {}

public:
	virtual PackedStringArray get_configuration_warnings() const override;
};

// Imagem desenhada num dos dois planos de fundo do console (BG A na frente, BG B atrás).
class MDFundo : public Sprite2D {
	GDCLASS(MDFundo, Sprite2D);

public:
	enum Plano {
		PLANO_B,
		PLANO_A,
	};

private:
	Plano plano = PLANO_B;
	int paleta = 0;

protected:
	static void _bind_methods();

public:
	void set_plano(Plano p_plano);
	Plano get_plano() const { return plano; }
	void set_paleta(int p_paleta);
	int get_paleta() const { return paleta; }

	virtual PackedStringArray get_configuration_warnings() const override;
	MDFundo();
};

// Objeto animado (sprite de hardware). Cada linha da folha (vframes) é uma animação e cada
// coluna (hframes) um quadro dela.
class MDSprite : public Sprite2D {
	GDCLASS(MDSprite, Sprite2D);

	int paleta = 1;
	bool prioridade = true;
	int velocidade_animacao = 10;

protected:
	static void _bind_methods();

public:
	void set_paleta(int p_paleta);
	int get_paleta() const { return paleta; }
	void set_prioridade(bool p_prioridade);
	bool get_prioridade() const { return prioridade; }
	void set_velocidade_animacao(int p_ticks);
	int get_velocidade_animacao() const { return velocidade_animacao; }

	virtual PackedStringArray get_configuration_warnings() const override;
	MDSprite();
};

// Sprite controlado pelo controle 1: anda com ← → e pula com A, B ou C. Com um MDMapa sólido, colide
// com os tiles (e volta ao início se cair do mapa); sem mapa, a posição inicial é o chão.
// A linha 0 da folha é a animação parada e a linha 1, andando.
class MDJogador : public MDSprite {
	GDCLASS(MDJogador, MDSprite);

	int velocidade = 2;
	int forca_pulo = 112;
	int gravidade = 6;
	Rect2i caixa_colisao; // Vazia = o quadro inteiro.

protected:
	static void _bind_methods();

public:
	void set_velocidade(int p_velocidade);
	int get_velocidade() const { return velocidade; }
	void set_forca_pulo(int p_forca);
	int get_forca_pulo() const { return forca_pulo; }
	void set_gravidade(int p_gravidade);
	int get_gravidade() const { return gravidade; }
	void set_caixa_colisao(const Rect2i &p_caixa);
	Rect2i get_caixa_colisao() const { return caixa_colisao; }
	// Caixa de colisão efetiva, relativa ao canto do sprite.
	Rect2i get_caixa_efetiva() const;

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Mapa de tiles pintado com o editor de TileMap. Vira um MAP do SGDK (rolagem por MAP_scrollTo). Com
// "solido", todo tile pintado bloqueia o jogador. O TileSet precisa de uma só imagem (PNG indexado).
class MDMapa : public TileMapLayer {
	GDCLASS(MDMapa, TileMapLayer);

	MDFundo::Plano plano = MDFundo::PLANO_A;
	int paleta = 2;
	bool solido = true;

protected:
	static void _bind_methods();

public:
	void set_plano(MDFundo::Plano p_plano);
	MDFundo::Plano get_plano() const { return plano; }
	void set_paleta(int p_paleta);
	int get_paleta() const { return paleta; }
	void set_solido(bool p_solido);
	bool is_solido() const { return solido; }
	// Imagem do único atlas do TileSet (nula se o TileSet não serve).
	Ref<Texture2D> get_atlas_texture() const;

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Texto com a fonte do SGDK (8×8, cor 15 da PAL0), posicionado em tiles.
class MDTexto : public Node2D {
	GDCLASS(MDTexto, Node2D);

	String texto;

protected:
	static void _bind_methods();
	void _notification(int p_what);

public:
	void set_texto(const String &p_texto);
	String get_texto() const { return texto; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

VARIANT_ENUM_CAST(MDFundo::Plano);
