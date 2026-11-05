#pragma once

// Nodes de cena do Mega Drive. Uma cena feita com eles vira código do SGDK no build
// (editor/retro_sgdk_export): MDCena é a tela, MDFundo uma imagem num plano do console, MDSprite um
// objeto animado, MDJogador o sprite controlado pelo controle e MDTexto um texto da fonte do SGDK.

#include "md_personagem.h"

#include "scene/2d/node_2d.h"
#include "scene/2d/path_2d.h"
#include "scene/2d/sprite_2d.h"
#include "scene/2d/tile_map_layer.h"

namespace RetroMD {
static const int SCREEN_WIDTH = 320;
static const int SCREEN_HEIGHT = 224;
static const int MAX_SPRITES = 80;
// VRAM com planos de 64×32 (os mapas começam em 0xC000, 1536 tiles): saem os 16 tiles do sistema e os 96
// da fonte; o resto é dividido entre fundos/mapas e sprites. O jogo gerado reserva para os sprites só o
// que a cena precisa (SPR_initEx), em vez dos 420 do SPR_init.
static const int VRAM_FREE_TILES = 0xC000 / 32 - 16 - 96;
// Tiles distintos de 8×8 da imagem, como o rescomp conta com a otimização ALL (repetidos e espelhados
// valem um só). Pixels com alfa abaixo de 0,5 contam como transparentes.
int unique_tiles(const Ref<Image> &p_image);
// Tiles que o motor de sprites reserva por sprite: o maior quadro, contando só os tiles de 8×8 do
// contorno do desenho (o rescomp corta o vazio em volta).
int sprite_vram_tiles(const String &p_path, int p_hframes, int p_vframes);
int sprite_vram_tiles(const Ref<Image> &p_image, int p_hframes, int p_vframes);
// Problema de um arquivo escolhido numa propriedade (vazio se está bom ou se não foi escolhido).
// Caminho res:// de um arquivo escolhido no Inspetor: o seletor de arquivos do editor grava "uid://…" (o ID
// do arquivo); os nodes MD guardam o caminho, que o build usa para nomes (CENA_<NOME>) e para o make.
String resource_path(const String &p_path);
// O Mega Drive desenha planos em tiles de 8×8 quadrados: um TileSet de mapa, colisão ou prioridade com outro
// tamanho ou formato volta para 8×8 quadrado (o editor mostraria uma coisa e o jogo, outra). Verdadeiro se mudou.
bool fix_tile_set(const Ref<class TileSet> &p_tile_set, const String &p_node);
String file_problem(const String &p_path, const String &p_extensions);
// Problemas de uma imagem para o rescomp do SGDK (PNG indexado de até 16 cores, lados múltiplos de 8).
PackedStringArray texture_problems(const Ref<Texture2D> &p_texture, int p_frame_width, int p_frame_height);
// Cores da paleta de um PNG indexado (PLTE), na ordem dos índices; vazio se não for indexado.
Vector<Color> png_palette(const String &p_path);
// Esconde do Inspetor as propriedades herdadas do Godot que o gerador não leva para o SGDK (modulate,
// material, rotação…). As das classes MD* e as de "p_kept" continuam; os valores seguem salvos.
void hide_unsupported(const Object *p_object, PropertyInfo &r_property, const char *const *p_kept);
} // namespace RetroMD

// Uma tela do jogo. A raiz de cada cena precisa ser uma MDCena; o jogo começa na cena principal do
// projeto e troca de cena por um MDSaida ou, numa tela de título, pelo START.
class MDCena : public Node2D {
	GDCLASS(MDCena, Node2D);

	String musica; // VGM ou XGM tocado em repetição (vazio = silêncio).
	String start_vai_para; // Cena aberta ao apertar START (telas de título).
	String ao_fim_da_animacao; // Cena aberta quando a animação do AnimationPlayer termina (cutscenes).
	bool salvar_ao_entrar = false; // Ponto de salvamento: entrar na cena grava o progresso (SRAM) no slot atual.
	bool luz_e_sombra = false; // Modo highlight/shadow do VDP.

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;

public:
	void set_musica(const String &p_musica);
	String get_musica() const { return RetroMD::resource_path(musica); }
	void set_start_vai_para(const String &p_cena);
	String get_start_vai_para() const { return RetroMD::resource_path(start_vai_para); }
	void set_ao_fim_da_animacao(const String &p_cena);
	String get_ao_fim_da_animacao() const { return RetroMD::resource_path(ao_fim_da_animacao); }
	void set_salvar_ao_entrar(bool p_salvar) { salvar_ao_entrar = p_salvar; }
	bool get_salvar_ao_entrar() const { return salvar_ao_entrar; }
	void set_luz_e_sombra(bool p_ligado) { luz_e_sombra = p_ligado; }
	bool get_luz_e_sombra() const { return luz_e_sombra; }

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
	int rolagem = 0; // % da câmera: 0 = parado, 100 = junto com o mapa (parallax entre os dois).

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;

public:
	void set_plano(Plano p_plano);
	Plano get_plano() const { return plano; }
	void set_paleta(int p_paleta);
	int get_paleta() const { return paleta; }
	void set_rolagem(int p_rolagem);
	int get_rolagem() const { return rolagem; }

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
	Rect2i caixa_colisao; // Vazia = o quadro inteiro (ou o corpo do personagem).
	String paleta_de; // PNG indexado cuja paleta (na ordem) o personagem usa; vazio = a do próprio desenho.

	// Prévia da animação no editor (botão "Animar" da vista 2D e ajuste na cena). Nada disso vai para a cena.
	static inline bool previa_ligada = false;
	int previa_quadro = 0; // Quadro da animação mostrado.
	int previa_espera = 0; // Quadros de vídeo (1/60 s) que faltam nele.
	bool previa_segurando = false; // Animação sem repetição parada no último quadro antes de recomeçar.
	double previa_acumulado = 0;
	Vector<int> previa_usadas; // Animações do atlas mostrado; o atlas só é refeito quando mudam.
	bool previa_atlas_ok = false;
	void _previa_mostrar();
	void _previa_avancar();

protected:
	void _update_personagem_preview();
	void _on_personagem_edited();
	Ref<MDPersonagem> personagem; // Gestor de animações: substitui a folha, o hframes e o vframes.
	String animacao; // Animação do personagem que o sprite toca (no jogador, a inicial).

	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);
	// Jogador e inimigos mostram a caixa de colisão no editor.
	virtual bool _shows_collision_box() const { return caixa_colisao.has_area(); }
	// Ao trocar de personagem (o jogador preenche as animações de cada estado).
	virtual void _personagem_changed() {}

public:
	void set_personagem(const Ref<MDPersonagem> &p_personagem);
	Ref<MDPersonagem> get_personagem() const { return personagem; }
	void set_animacao(const String &p_animacao);
	String get_animacao() const { return animacao; }
	// Índice da animação no personagem (0 se não achar).
	int get_animacao_index(const String &p_name) const;
	// Animações do personagem que vão para o jogo (índices no personagem, na ordem do atlas). Um MDSprite
	// comum leva todas, porque o código C da cena pode pedir qualquer uma.
	virtual Vector<int> get_used_animations() const;
	// Com personagem, a posição do node é a dos pés: o desenho fica deslocado pelo apoio da célula
	// (o canto da célula, que o SGDK usa, é a posição menos o apoio). Sem personagem, (0, 0).
	Vector2i get_apoio() const;
	// Linha do atlas exportado de uma animação (-1 se ela não vai para o jogo).
	int get_used_row(const String &p_name) const;

	void set_paleta(int p_paleta);
	int get_paleta() const { return paleta; }
	void set_prioridade(bool p_prioridade);
	bool get_prioridade() const { return prioridade; }
	void set_velocidade_animacao(int p_ticks);
	int get_velocidade_animacao() const { return velocidade_animacao; }
	void set_paleta_de(const String &p_png);
	String get_paleta_de() const { return RetroMD::resource_path(paleta_de); }
	void set_caixa_colisao(const Rect2i &p_caixa);
	Rect2i get_caixa_colisao() const { return caixa_colisao; }
	// Caixa de colisão efetiva, relativa ao canto do sprite.
	Rect2i get_caixa_efetiva() const;
	Vector2i get_frame_size() const;

	virtual PackedStringArray get_configuration_warnings() const override;

	// Prévia no editor: liga ou pausa a animação de todos os sprites (cada um volta a conferir com
	// previa_atualizar_processo); o quadro mostrado pode ser escolhido (ajuste na cena).
	static void set_previa_ligada(bool p_ligada) { previa_ligada = p_ligada; }
	static bool is_previa_ligada() { return previa_ligada; }
	void previa_atualizar_processo();
	int get_previa_quadro() const { return previa_quadro; }
	void set_previa_quadro(int p_quadro);
	const MDPersonagem::Animacao *get_previa_animacao() const;

	MDSprite();
};

// Sprite controlado pelo controle 1. No modo plataforma (de lado), anda com ← → e pula com A, B ou C;
// no modo visto de cima, anda nas 4 direções, sem gravidade. Abaixo, o modo plataforma: Com um MDMapa sólido, colide
// com os tiles; sem mapa, a posição inicial é o chão. Cair do mapa ou encostar num inimigo custa uma
// vida e o faz voltar ao início; sem vidas, o jogo volta à cena principal. As vidas valem para o jogo
// todo: a primeira cena com jogador define quantas são.
// A linha 0 da folha é a animação parada e a linha 1, andando.
class MDJogador : public MDSprite {
	GDCLASS(MDJogador, MDSprite);

public:
	enum Modo {
		MODO_PLATAFORMA, // De lado: anda, pula e cai.
		MODO_VISTO_DE_CIMA, // De cima: anda nas 4 direções, sem gravidade nem pulo.
	};

private:
	Modo modo = MODO_PLATAFORMA;
	int velocidade = 2;
	int forca_pulo = 128;
	int gravidade = 6;
	// Animações do personagem por estado (só com personagem).
	String anim_parado, anim_andando, anim_pulando, anim_caindo;
	String anim_ataque; // Com ela, o botão B ataca (A e C pulam) e a caixa de ataque derrota inimigos.
	String anim_morte; // Toca antes de perder a vida.
	String anim_dano; // Toca ao levar um golpe (com energia).
	int energia = 0; // Golpes que aguenta por vida (0 = um toque tira a vida).
	int invencivel = 90; // Quadros piscando, sem levar golpe, depois de um dano.
	int vidas = 3; // 0 = vidas infinitas, sem HUD.
	String som_pulo;
	String som_morte;
	String som_ataque;
	String som_dano;
	// Botões (A = 1, B = 2, C = 4); 0 = automático: pulo em A e C (A, B e C sem ataque), ataque em B.
	int botoes_pulo = 0;
	int botoes_ataque = 0;
	int botoes_correr = 0; // Segurar corre em velocidade_correndo (0 = não corre).
	int controle = 1; // Controle que comanda o jogador (1 ou 2).
	bool flash_dano = false; // A tela pisca em branco quando o jogador leva um golpe.
	int velocidade_correndo = 4;
	bool pausa_start = false; // START pausa o jogo (e a música).

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	virtual bool _shows_collision_box() const override { return true; }
	virtual void _personagem_changed() override;

public:
	void set_modo(Modo p_modo);
	Modo get_modo() const { return modo; }
	void set_anim_parado(const String &p_anim);
	String get_anim_parado() const { return anim_parado; }
	void set_anim_andando(const String &p_anim);
	String get_anim_andando() const { return anim_andando; }
	void set_anim_pulando(const String &p_anim);
	String get_anim_pulando() const { return anim_pulando; }
	void set_anim_caindo(const String &p_anim);
	String get_anim_caindo() const { return anim_caindo; }
	void set_anim_ataque(const String &p_anim);
	String get_anim_ataque() const { return anim_ataque; }
	void set_anim_morte(const String &p_anim);
	String get_anim_morte() const { return anim_morte; }
	void set_anim_dano(const String &p_anim);
	String get_anim_dano() const { return anim_dano; }
	void set_energia(int p_energia);
	int get_energia() const { return energia; }
	void set_invencivel(int p_quadros);
	int get_invencivel() const { return invencivel; }
	void set_som_dano(const String &p_som);
	String get_som_dano() const { return RetroMD::resource_path(som_dano); }
	virtual Vector<int> get_used_animations() const override;
	void set_velocidade(int p_velocidade);
	int get_velocidade() const { return velocidade; }
	void set_forca_pulo(int p_forca);
	int get_forca_pulo() const { return forca_pulo; }
	void set_gravidade(int p_gravidade);
	int get_gravidade() const { return gravidade; }
	void set_vidas(int p_vidas);
	int get_vidas() const { return vidas; }
	void set_som_pulo(const String &p_som);
	String get_som_pulo() const { return RetroMD::resource_path(som_pulo); }
	void set_som_morte(const String &p_som);
	String get_som_morte() const { return RetroMD::resource_path(som_morte); }
	void set_som_ataque(const String &p_som);
	String get_som_ataque() const { return RetroMD::resource_path(som_ataque); }
	void set_botoes_pulo(int p_botoes);
	int get_botoes_pulo() const { return botoes_pulo; }
	void set_botoes_ataque(int p_botoes);
	int get_botoes_ataque() const { return botoes_ataque; }
	void set_botoes_correr(int p_botoes);
	int get_botoes_correr() const { return botoes_correr; }
	void set_controle(int p_controle) { controle = CLAMP(p_controle, 1, 2); }
	void set_flash_dano(bool p_flash) { flash_dano = p_flash; }
	bool get_flash_dano() const { return flash_dano; }
	int get_controle() const { return controle; }
	void set_velocidade_correndo(int p_velocidade);
	int get_velocidade_correndo() const { return velocidade_correndo; }
	void set_pausa_start(bool p_pausa);
	bool get_pausa_start() const { return pausa_start; }
	// Botões efetivos (com o automático resolvido), na máscara A = 1, B = 2, C = 4.
	int jump_mask() const;
	int attack_mask() const;

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Inimigo que patrulha: anda da posição inicial até "distancia" pixels à direita e volta. Com um
// MDMapa sólido e "vira_na_borda", também vira ao bater numa parede ou na beira do chão. Encostar
// no jogador custa uma vida; se "pisavel", cair em cima dele o derrota e dá pontos. A arte olha
// para a direita; a linha 0 da folha é a animação.
class MDInimigo : public MDSprite {
	GDCLASS(MDInimigo, MDSprite);

	int distancia = 64;
	int velocidade = 1;
	bool vira_na_borda = true;
	bool pisavel = true;
	int pontos = 100;
	String som_derrota;
	int vida = 1; // Golpes para derrotar.
	String anim_derrota; // Toca antes de sumir (com personagem).

protected:
	static void _bind_methods();
	void _notification(int p_what);
	void _validate_property(PropertyInfo &p_property) const;
	virtual bool _shows_collision_box() const override { return true; }

public:
	void set_distancia(int p_distancia);
	int get_distancia() const { return distancia; }
	void set_velocidade(int p_velocidade);
	int get_velocidade() const { return velocidade; }
	void set_vira_na_borda(bool p_vira);
	bool get_vira_na_borda() const { return vira_na_borda; }
	virtual Vector<int> get_used_animations() const override;
	void set_pisavel(bool p_pisavel);
	bool get_pisavel() const { return pisavel; }
	void set_pontos(int p_pontos);
	int get_pontos() const { return pontos; }
	void set_som_derrota(const String &p_som);
	String get_som_derrota() const { return RetroMD::resource_path(som_derrota); }
	void set_vida(int p_vida);
	int get_vida() const { return vida; }
	void set_anim_derrota(const String &p_anim);
	String get_anim_derrota() const { return anim_derrota; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Plataforma que vai e volta em linha reta, da posição inicial até a posição + "deslocamento". O
// jogador atravessa por baixo, para em cima (no topo da caixa de colisão) e é carregado junto.
// Precisa de um MDMapa sólido na cena (é a colisão dele que trata o chão).
class MDPlataforma : public MDSprite {
	GDCLASS(MDPlataforma, MDSprite);

	Vector2i deslocamento = Vector2i(64, 0);
	int velocidade = 1;

protected:
	static void _bind_methods();
	void _notification(int p_what);
	virtual bool _shows_collision_box() const override { return true; }

public:
	void set_deslocamento(const Vector2i &p_deslocamento);
	Vector2i get_deslocamento() const { return deslocamento; }
	void set_velocidade(int p_velocidade);
	int get_velocidade() const { return velocidade; }
};

// Item que o jogador pega ao encostar (moeda, fruta…): some, soma "pontos" e toca o som.
class MDItem : public MDSprite {
	GDCLASS(MDItem, MDSprite);

	int pontos = 10;
	String som;

protected:
	static void _bind_methods();
	virtual bool _shows_collision_box() const override { return true; }

public:
	void set_pontos(int p_pontos);
	int get_pontos() const { return pontos; }
	void set_som(const String &p_som);
	String get_som() const { return RetroMD::resource_path(som); }
	virtual Vector<int> get_used_animations() const override;

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Ator: um sprite que faz o que o seu código C mandar, como um CharacterBody2D com GDScript. O código
// (res://src/<nome>.c) tem <nome>_pronto(Ator *eu), chamada uma vez, e <nome>_quadro(Ator *eu), a cada
// quadro; a API (controle, mover_e_colidir, animações, outros atores, sons) está em gerado/ator.h.
// Os grupos do node (aba Grupos) viram GRUPO_<NOME> para o código achar os outros atores.
class MDAtor : public MDSprite {
	GDCLASS(MDAtor, MDSprite);

	String codigo;
	bool camera_segue = false;
	bool fixo_na_tela = false;
	bool vram_da_fonte = false;
	bool dorme_longe = false;
	bool respeita_limite = false;
	bool dano_do_cenario = true;
	int vida = 1;

protected:
	static void _bind_methods();
	virtual bool _shows_collision_box() const override { return true; }

public:
	void set_codigo(const String &p_codigo);
	String get_codigo() const { return RetroMD::resource_path(codigo); }
	void set_camera_segue(bool p_segue);
	bool get_camera_segue() const { return camera_segue; }
	void set_vida(int p_vida);
	int get_vida() const { return vida; }
	void set_fixo_na_tela(bool p_fixo);
	bool get_fixo_na_tela() const { return fixo_na_tela; }
	void set_respeita_limite(bool p_respeita);
	bool get_respeita_limite() const { return respeita_limite; }
	void set_dano_do_cenario(bool p_dano);
	bool get_dano_do_cenario() const { return dano_do_cenario; }
	void set_dorme_longe(bool p_dorme);
	bool get_dorme_longe() const { return dorme_longe; }
	void set_vram_da_fonte(bool p_fonte);
	bool get_vram_da_fonte() const { return vram_da_fonte; }
	// Nome das funções do código (henzo.c → henzo_pronto, henzo_quadro); vazio sem código.
	String get_prefixo() const;
	// A inicial e as que o código cita (ANIM_<NOME>); sem código, todas.
	virtual Vector<int> get_used_animations() const override;

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Mapa de tiles pintado com o editor de TileMap. Vira um MAP do SGDK (rolagem por MAP_scrollTo). Com
// "solido", todo tile pintado bloqueia o jogador. O TileSet precisa de uma só imagem (PNG indexado).
class MDMapa : public TileMapLayer {
	GDCLASS(MDMapa, TileMapLayer);

	MDFundo::Plano plano = MDFundo::PLANO_A;
	int paleta = 2;
	bool solido = true;
	int rolagem = 100; // % do movimento da câmera na horizontal (parallax: 50 = metade da velocidade).
	int rolagem_vertical = 100; // O mesmo na vertical.
	bool na_frente = false; // As células pintadas passam na frente dos sprites (bit de prioridade).

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_plano(MDFundo::Plano p_plano);
	MDFundo::Plano get_plano() const { return plano; }
	void set_paleta(int p_paleta);
	int get_paleta() const { return paleta; }
	void set_solido(bool p_solido);
	bool is_solido() const { return solido; }
	void set_rolagem(int p_percent);
	int get_rolagem() const { return rolagem; }
	void set_rolagem_vertical(int p_percent);
	int get_rolagem_vertical() const { return rolagem_vertical; }
	void set_na_frente(bool p_na_frente);
	bool is_na_frente() const { return na_frente; }
	// Imagem do único atlas do TileSet (nula se o TileSet não serve).
	Ref<Texture2D> get_atlas_texture() const;

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Camada de colisão na grade de 8×8, para o jogador e os inimigos. O dado personalizado "tipo" do
// TileSet diz o que cada tile é: "solido" (o padrão), "atravessavel" (segura só por cima; ↓ desce),
// "espinho" (custa uma vida) ou "agua" (anda e cai devagar, dá para nadar). Uma MDColisao nova já vem
// com um TileSet de quatro tiles, um por tipo. Aparece meio transparente no editor e não é desenhada no
// jogo; serve quando o desenho do mapa não coincide com o que é chão e parede.
class MDColisao : public TileMapLayer {
	GDCLASS(MDColisao, TileMapLayer);

public:
	// Valores da grade de colisão do jogo gerado (0 = vazio).
	enum Tipo {
		TIPO_SOLIDO = 1,
		TIPO_ATRAVESSAVEL = 2,
		TIPO_ESPINHO = 3, // "dano" (ou "espinho"): tira vida.
		TIPO_AGUA = 4,
		TIPO_MORTE = 5, // Abismo, lava: tira a vida inteira.
		TIPO_ESCADA = 6,
		TIPO_GELO = 7,
		TIPO_LIMITE = 8, // Parede invisível só para os inimigos.
		TIPO_AREIA = 9, // Areia movediça: não segura; só marca (eu->na_areia), o código faz afundar.
		TIPO_PROPRIO = 10, // Daqui para cima, os tipos com nome próprio (o código decide o efeito).
		TIPO_MAXIMO = 15,
	};

protected:
	static void _bind_methods() {}
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	// Nome do tipo da célula pelo dado "tipo" do tile, sem acentos e em minúsculas ("solido" sem o dado).
	String get_nome_tipo(const Vector2i &p_cell) const;
	// Número de um tipo pronto pelo nome ("dano" e "espinho" são o mesmo); 0 se o nome for próprio.
	static int tipo_pronto(const String &p_nome);
	// TileSet com um tile (e um desenho) por tipo pronto, para começar a pintar.
	static Ref<TileSet> create_default_tile_set();
	// Troca o TileSet pelo padrão, mantendo o tipo de cada célula pintada (pelo nome). Devolve quantas
	// células tinham um tipo próprio, que ficam fora (o padrão só tem os tipos prontos).
	int atualizar_tipos();

	virtual PackedStringArray get_configuration_warnings() const override;
	MDColisao();
};

// Prioridade de tiles: as células pintadas do plano escolhido passam na frente dos sprites sem
// prioridade (a copa de uma árvore na frente do jogador). Vale para mapas carregados aos poucos.
class MDPrioridade : public TileMapLayer {
	GDCLASS(MDPrioridade, TileMapLayer);

	MDFundo::Plano plano = MDFundo::PLANO_A;

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_plano(MDFundo::Plano p_plano);
	MDFundo::Plano get_plano() const { return plano; }
	MDPrioridade();
};

// Texto com a fonte do SGDK (8×8, cor 15 da PAL0), posicionado em tiles.
class MDTexto : public Node2D {
	GDCLASS(MDTexto, Node2D);

public:
	// Valor do jogo mostrado logo depois do texto (o HUD): com algum, a cena troca o HUD automático pelos textos.
	enum Valor {
		VALOR_NENHUM,
		VALOR_PONTOS,
		VALOR_VIDAS,
		VALOR_ENERGIA,
		VALOR_ENERGIA_BARRA, // Um símbolo por golpe que ainda aguenta.
	};

private:
	String texto;
	bool piscar = false; // Pisca a cada meio segundo (ex.: "APERTE START").
	Valor valor = VALOR_NENHUM;
	int digitos = 0; // 0 = automático (6 nos pontos; nas vidas e na energia, os do valor inicial).
	String simbolo = "#";

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_texto(const String &p_texto);
	String get_texto() const { return texto; }
	void set_piscar(bool p_piscar);
	bool get_piscar() const { return piscar; }
	void set_valor(Valor p_valor);
	Valor get_valor() const { return valor; }
	void set_digitos(int p_digitos);
	int get_digitos() const { return digitos; }
	void set_simbolo(const String &p_simbolo);
	String get_simbolo() const { return simbolo; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Área que leva a outra cena quando o jogador entra nela (ex.: o fim da fase).
class MDSaida : public Node2D {
	GDCLASS(MDSaida, Node2D);

	Vector2i tamanho = Vector2i(16, 32);
	String destino;

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_tamanho(const Vector2i &p_tamanho);
	Vector2i get_tamanho() const { return tamanho; }
	void set_destino(const String &p_destino);
	String get_destino() const { return RetroMD::resource_path(destino); }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Ponto de retorno: quando o jogador passa pela área, as próximas mortes na fase o trazem de volta
// aqui (com os pés no fundo da área, centralizado) em vez do início. Vale até sair da cena.
class MDRetorno : public Node2D {
	GDCLASS(MDRetorno, Node2D);

	Vector2i tamanho = Vector2i(16, 32);
	String som;

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_tamanho(const Vector2i &p_tamanho);
	Vector2i get_tamanho() const { return tamanho; }
	void set_som(const String &p_som);
	String get_som() const { return RetroMD::resource_path(som); }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Como a câmera segue o jogador (uma por cena; sem ela, centrada nele). A posição só serve de
// referência no editor: mostra a tela com a folga no meio.
class MDCamera : public Node2D {
	GDCLASS(MDCamera, Node2D);

	Vector2i folga = Vector2i(48, 32); // Área no meio da tela em que o jogador anda sem a câmera rolar.
	int suavidade = 0; // 0 = acompanha na hora; n = anda 1/2^n da distância por quadro.
	int a_frente = 0; // Pixels a mais na direção em que o jogador olha.

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_folga(const Vector2i &p_folga);
	Vector2i get_folga() const { return folga; }
	void set_suavidade(int p_suavidade);
	int get_suavidade() const { return suavidade; }
	void set_a_frente(int p_a_frente);
	int get_a_frente() const { return a_frente; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Enquanto o jogador está dentro, a câmera não sai da área (uma sala, um chefe). Menor que a tela,
// a câmera fica centrada nela.
class MDZonaCamera : public Node2D {
	GDCLASS(MDZonaCamera, Node2D);

	Vector2i tamanho = Vector2i(320, 224);

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_tamanho(const Vector2i &p_tamanho);
	Vector2i get_tamanho() const { return tamanho; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Água que corre ou ondula: as linhas da área (só a altura conta, a linha inteira da tela anda) rolam
// à parte. Correnteza: andam sem parar na velocidade e direção, repetindo a cada "periodo" pixels (a
// arte precisa se repetir nesse período). Ondulação: balançam no lugar, em faixas que vão para lados
// opostos (lagoa parada).
class MDCorrenteza : public Node2D {
	GDCLASS(MDCorrenteza, Node2D);

public:
	enum Modo {
		MODO_CORRENTEZA,
		MODO_ONDULACAO,
	};
	enum Direcao {
		DIRECAO_ESQUERDA,
		DIRECAO_DIREITA,
	};

private:
	Vector2i tamanho = Vector2i(320, 24);
	MDFundo::Plano plano = MDFundo::PLANO_B;
	Modo modo = MODO_CORRENTEZA;
	int velocidade = 40; // px/s.
	Direcao direcao = DIRECAO_ESQUERDA;
	int periodo = 40; // px.
	int amplitude = 2; // px.
	int passos_por_segundo = 8;
	bool rolagem_propria = false; // A faixa anda uma fração própria da câmera (parallax), e não a do plano.
	int rolagem = 100; // % do movimento da câmera, com rolagem_propria.

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_tamanho(const Vector2i &p_tamanho);
	Vector2i get_tamanho() const { return tamanho; }
	void set_plano(MDFundo::Plano p_plano);
	MDFundo::Plano get_plano() const { return plano; }
	void set_modo(Modo p_modo);
	Modo get_modo() const { return modo; }
	void set_velocidade(int p_velocidade);
	int get_velocidade() const { return velocidade; }
	void set_direcao(Direcao p_direcao);
	Direcao get_direcao() const { return direcao; }
	void set_periodo(int p_periodo);
	int get_periodo() const { return periodo; }
	void set_amplitude(int p_amplitude);
	int get_amplitude() const { return amplitude; }
	void set_passos_por_segundo(int p_passos);
	int get_passos_por_segundo() const { return passos_por_segundo; }
	void set_rolagem_propria(bool p_propria);
	bool is_rolagem_propria() const { return rolagem_propria; }
	void set_rolagem(int p_percent);
	int get_rolagem() const { return rolagem; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Caixa de diálogo: falas que aparecem numa caixa no plano window, letra por letra, com retrato e escolha
// opcionais. Abre quando a cena começa, quando o jogador toca a área, quando aperta para cima na área ou
// pelo código C (dialogo_abrir(DIALOGO_<NOME>)). Com a caixa aberta, a cena fica parada.
class MDDialogo : public Node2D {
	GDCLASS(MDDialogo, Node2D);

public:
	enum Ativar {
		ATIVAR_AO_INICIAR,
		ATIVAR_AO_TOCAR,
		ATIVAR_APERTAR_CIMA,
		ATIVAR_PELO_CODIGO,
	};
	static const int LINHAS_MIN = 4;
	static const int LINHAS_MAX = 14;

private:
	PackedStringArray falas;
	Ativar ativar = ATIVAR_APERTAR_CIMA;
	Vector2i tamanho = Vector2i(32, 32);
	bool uma_vez = false;
	PackedStringArray opcoes;
	int variavel = -1;
	NodePath proximo;
	int velocidade = 2;
	String retrato;
	int paleta_retrato = 3;
	int linhas = 8;
	Color cor_fundo = Color(0.0, 0.0, 0.33);
	Color cor_borda = Color(0.93, 0.93, 0.93);
	Color cor_texto = Color(0.93, 0.93, 0.93);

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	void set_falas(const PackedStringArray &p_falas);
	PackedStringArray get_falas() const { return falas; }
	void set_ativar(Ativar p_ativar);
	Ativar get_ativar() const { return ativar; }
	void set_tamanho(const Vector2i &p_tamanho);
	Vector2i get_tamanho() const { return tamanho; }
	void set_uma_vez(bool p_uma_vez) { uma_vez = p_uma_vez; }
	bool get_uma_vez() const { return uma_vez; }
	void set_opcoes(const PackedStringArray &p_opcoes);
	PackedStringArray get_opcoes() const { return opcoes; }
	void set_variavel(int p_variavel) { variavel = CLAMP(p_variavel, -1, 15); }
	int get_variavel() const { return variavel; }
	void set_proximo(const NodePath &p_proximo);
	NodePath get_proximo() const { return proximo; }
	void set_velocidade(int p_velocidade) { velocidade = CLAMP(p_velocidade, 0, 30); }
	int get_velocidade() const { return velocidade; }
	void set_retrato(const String &p_retrato);
	String get_retrato() const { return RetroMD::resource_path(retrato); }
	void set_paleta_retrato(int p_paleta) { paleta_retrato = CLAMP(p_paleta, 0, 3); }
	int get_paleta_retrato() const { return paleta_retrato; }
	void set_linhas(int p_linhas);
	int get_linhas() const { return linhas; }
	void set_cor_fundo(const Color &p_cor) { cor_fundo = p_cor; }
	Color get_cor_fundo() const { return cor_fundo; }
	void set_cor_borda(const Color &p_cor) { cor_borda = p_cor; }
	Color get_cor_borda() const { return cor_borda; }
	void set_cor_texto(const Color &p_cor) { cor_texto = p_cor; }
	Color get_cor_texto() const { return cor_texto; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Ciclo de cores: gira um trecho de uma paleta a cada alguns quadros (água correndo, lava, brilho).
class MDCicloCores : public Node2D {
	GDCLASS(MDCicloCores, Node2D);

	int paleta = 0;
	int primeira = 1;
	int quantidade = 4;
	int intervalo = 8;
	bool para_tras = false;

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;

public:
	void set_paleta(int p_paleta) { paleta = CLAMP(p_paleta, 0, 3); }
	int get_paleta() const { return paleta; }
	void set_primeira(int p_primeira);
	int get_primeira() const { return primeira; }
	void set_quantidade(int p_quantidade);
	int get_quantidade() const { return quantidade; }
	void set_intervalo(int p_intervalo) { intervalo = CLAMP(p_intervalo, 1, 255); }
	int get_intervalo() const { return intervalo; }
	void set_para_tras(bool p_para_tras) { para_tras = p_para_tras; }
	bool get_para_tras() const { return para_tras; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Trajeto desenhado com a curva do Path2D: filho de uma MDPlataforma ou de um MDInimigo, que passam a
// seguir a linha (ida e volta, ou dando a volta com ciclo) na velocidade deles. O primeiro ponto fica
// onde o pai está na cena.
class MDTrajeto : public Path2D {
	GDCLASS(MDTrajeto, Path2D);

	bool ciclo = false;

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;

public:
	void set_ciclo(bool p_ciclo);
	bool get_ciclo() const { return ciclo; }
	// Pontos da linha (tesselada), relativos ao primeiro.
	PackedVector2Array pontos() const;

	virtual PackedStringArray get_configuration_warnings() const override;
};

// Menu pronto: tela de título (Começar, Continuar, Senha, Opções) ou pausa (START abre: Continuar,
// Opções, Salvar, Sair). As opções (música, efeitos, controles) ficam guardadas na SRAM.
class MDMenu : public Node2D {
	GDCLASS(MDMenu, Node2D);

public:
	enum Tipo {
		TIPO_TITULO,
		TIPO_PAUSA,
	};

private:
	Tipo tipo = TIPO_TITULO;
	String comecar_vai_para;
	bool mostrar_continuar = true;
	bool mostrar_senha = false;
	bool mostrar_opcoes = true;
	bool mostrar_salvar = true;
	bool mostrar_sair = true;
	int slots = 1;
	String texto_comecar;
	String texto_continuar;
	String texto_senha;
	String texto_opcoes;
	String texto_salvar;
	String texto_sair;
	String som_cursor;
	String som_escolha;
	Color cor_fundo = Color(0.0, 0.0, 0.33);
	Color cor_borda = Color(0.93, 0.93, 0.93);
	Color cor_texto = Color(0.93, 0.93, 0.93);

protected:
	static void _bind_methods();
	void _validate_property(PropertyInfo &p_property) const;
	void _notification(int p_what);

public:
	// Rótulos com o padrão quando vazios.
	String rotulo_comecar() const;
	String rotulo_continuar() const;
	String rotulo_senha() const;
	String rotulo_opcoes() const;
	String rotulo_salvar() const;
	String rotulo_sair() const;
	PackedStringArray itens_visiveis() const; // Os rótulos na ordem (para a prévia e a largura).

	void set_tipo(Tipo p_tipo);
	Tipo get_tipo() const { return tipo; }
	void set_comecar_vai_para(const String &p_cena);
	String get_comecar_vai_para() const { return RetroMD::resource_path(comecar_vai_para); }
	void set_mostrar_continuar(bool p_mostrar);
	bool get_mostrar_continuar() const { return mostrar_continuar; }
	void set_mostrar_senha(bool p_mostrar);
	bool get_mostrar_senha() const { return mostrar_senha; }
	void set_mostrar_opcoes(bool p_mostrar);
	bool get_mostrar_opcoes() const { return mostrar_opcoes; }
	void set_mostrar_salvar(bool p_mostrar);
	bool get_mostrar_salvar() const { return mostrar_salvar; }
	void set_mostrar_sair(bool p_mostrar);
	bool get_mostrar_sair() const { return mostrar_sair; }
	void set_slots(int p_slots);
	int get_slots() const { return slots; }
	void set_texto_comecar(const String &p_texto);
	String get_texto_comecar() const { return texto_comecar; }
	void set_texto_continuar(const String &p_texto);
	String get_texto_continuar() const { return texto_continuar; }
	void set_texto_senha(const String &p_texto);
	String get_texto_senha() const { return texto_senha; }
	void set_texto_opcoes(const String &p_texto);
	String get_texto_opcoes() const { return texto_opcoes; }
	void set_texto_salvar(const String &p_texto);
	String get_texto_salvar() const { return texto_salvar; }
	void set_texto_sair(const String &p_texto);
	String get_texto_sair() const { return texto_sair; }
	void set_som_cursor(const String &p_som);
	String get_som_cursor() const { return RetroMD::resource_path(som_cursor); }
	void set_som_escolha(const String &p_som);
	String get_som_escolha() const { return RetroMD::resource_path(som_escolha); }
	void set_cor_fundo(const Color &p_cor) { cor_fundo = p_cor; }
	Color get_cor_fundo() const { return cor_fundo; }
	void set_cor_borda(const Color &p_cor) { cor_borda = p_cor; }
	Color get_cor_borda() const { return cor_borda; }
	void set_cor_texto(const Color &p_cor) { cor_texto = p_cor; }
	Color get_cor_texto() const { return cor_texto; }

	virtual PackedStringArray get_configuration_warnings() const override;
};

VARIANT_ENUM_CAST(MDMenu::Tipo);
VARIANT_ENUM_CAST(MDDialogo::Ativar);
VARIANT_ENUM_CAST(MDCorrenteza::Modo);
VARIANT_ENUM_CAST(MDCorrenteza::Direcao);
VARIANT_ENUM_CAST(MDFundo::Plano);
VARIANT_ENUM_CAST(MDJogador::Modo);
VARIANT_ENUM_CAST(MDTexto::Valor);
