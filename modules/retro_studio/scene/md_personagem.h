#pragma once

// Personagem do gestor de animações: o mesmo .charset.json do Retro Studio em Electron (versões 4 a 8).
// Um personagem junta uma ou mais folhas e uma lista de animações; cada animação é uma faixa em grade
// (região, tamanho do quadro e espaçamentos próprios) ou uma lista de quadros livres, cada um com seu
// retângulo, ponto de apoio dos pés, ajuste fino e tempo. Na exportação, todos os quadros vão para um
// atlas com células comuns alinhadas pelos pés (uma animação por linha, um quadro por coluna).

#include "core/io/image.h"
#include "core/io/resource.h"
#include "core/io/resource_loader.h"

class MDPersonagem : public Resource {
	GDCLASS(MDPersonagem, Resource);

public:
	struct Quadro {
		String source; // Caminho res:// da folha.
		String source_id; // Id da folha no projeto (sources[].id).
		Rect2i rect; // Recorte na folha.
		Vector2i anchor; // Pés, relativo ao recorte.
		Vector2i offset; // Ajuste fino (desloca o desenho na célula).
		int ticks = 8; // Quadros de vídeo na tela (60 por segundo em NTSC).
	};
	struct Animacao {
		String name;
		int index = -1; // Posição em "animations" no JSON.
		bool loop = true;
		int fps = 8;
		Vector<Quadro> frames;
		bool attack = false;
		Rect2i attack_box; // Relativa aos pés.
		int attack_first = 0, attack_last = 0;
	};
	struct Celula {
		Vector2i size = Vector2i(8, 8); // Múltiplo de 8.
		Vector2i anchor; // Pés dentro da célula.
	};

private:
	String character_name;
	Rect2i body_box = Rect2i(-8, -32, 16, 32); // Relativa aos pés.
	Vector<Animacao> animations;
	String load_error;
	Dictionary data; // O JSON como foi lido, editado no gestor de animações (campos desconhecidos ficam).
	String _parse_data();

protected:
	static void _bind_methods();

public:
	// Lê o .charset.json; em caso de problema, devolve o motivo (o personagem fica vazio).
	String parse(const String &p_path);
	// Dados do projeto para edição; set_data relê as animações e avisa quem usa o personagem.
	Dictionary get_data() const { return data; }
	String set_data(const Dictionary &p_data);
	// Grava no .charset.json (versão 8 se algum quadro tem ajuste fino, senão 7).
	Error save_to_file(const String &p_path = String());
	// Folhas do projeto: id → caminho res://.
	HashMap<String, String> get_sources() const;
	String get_load_error() const { return load_error; }

	String get_character_name() const { return character_name; }
	const Vector<Animacao> &get_animations() const { return animations; }
	PackedStringArray get_animation_names() const;
	int find_animation(const String &p_name) const;
	Rect2i get_body_box() const { return body_box; }

	// Os métodos abaixo aceitam a lista das animações que vão para o jogo (índices, na ordem do atlas);
	// vazia = todas.
	// Célula comum: margens em volta dos pés que cabem em todos os quadros, arredondadas a 8.
	Celula get_cell(const Vector<int> &p_only = Vector<int>()) const;
	int get_max_frames(const Vector<int> &p_only = Vector<int>()) const;
	// Atlas RGBA: linha = animação, coluna = quadro; cada quadro posicionado pelos pés e pelo ajuste fino.
	Ref<Image> build_atlas(String *r_error = nullptr, const Vector<int> &p_only = Vector<int>()) const;
	// Tempos por animação no formato do rescomp: [[t0,t1,...][...]].
	String get_timers(const Vector<int> &p_only = Vector<int>()) const;
	Vector<int> all_animations() const;
	// Lê a imagem da folha direto do arquivo (sem o aviso do Godot para imagens importadas); nula se falhar.
	static Ref<Image> load_sheet(const String &p_path);
	// Desenhos numa folha RGBA (fundo transparente ou da cor do canto). O desenho sob o ponto (pixels
	// ligados, buracos de até 2 px); os desenhos de uma região, na ordem de leitura e com a mesma
	// altura por faixa; e o x dos pés num recorte.
	static Rect2i detect_drawing(const Ref<Image> &p_image, const Vector2i &p_point);
	static Vector<Rect2i> split_drawings(const Ref<Image> &p_image, const Rect2i &p_region);
	static int feet_x(const Ref<Image> &p_image, const Rect2i &p_rect);
};

class ResourceFormatLoaderMDPersonagem : public ResourceFormatLoader {
	GDSOFTCLASS(ResourceFormatLoaderMDPersonagem, ResourceFormatLoader);

public:
	virtual Ref<Resource> load(const String &p_path, const String &p_original_path = "", Error *r_error = nullptr, bool p_use_sub_threads = false, float *r_progress = nullptr, CacheMode p_cache_mode = CACHE_MODE_REUSE) override;
	virtual void get_recognized_extensions(List<String> *p_extensions) const override;
	virtual bool recognize_path(const String &p_path, const String &p_for_type = String()) const override;
	virtual bool handles_type(const String &p_type) const override;
	virtual String get_resource_type(const String &p_path) const override;
};
