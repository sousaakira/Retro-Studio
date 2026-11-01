#include "md_letreiro.h"

#include "md_fonte_sgdk.h"
#include "md_nodes.h"

#include "core/config/engine.h"
#include "core/io/image.h"
#include "core/object/class_db.h"

namespace {
String U(const char *p_text) {
	return String::utf8(p_text);
}

const char *const KEPT_LETREIRO[] = { "position", "visible", nullptr };

// Marcas dos acentos (um byte por linha, o bit mais alto à esquerda). Na minúscula, duas linhas no topo da
// célula e a letra desce 1 px; na maiúscula (que começa na linha 1), uma linha só e a letra desce 1 px.
enum Marca {
	AGUDO,
	GRAVE,
	CIRCUNFLEXO,
	TIL,
	TREMA,
};
const uint8_t MARCA_MINUSCULA[5][2] = { { 0x0c, 0x18 }, { 0x30, 0x18 }, { 0x18, 0x24 }, { 0x32, 0x4c }, { 0x66, 0x00 } };
const uint8_t MARCA_MAIUSCULA[5] = { 0x0c, 0x30, 0x3c, 0x76, 0x66 };

struct Acentuada {
	char32_t letra;
	char base;
	Marca marca;
};
const Acentuada ACENTUADAS[] = {
	{ U'á', 'a', AGUDO }, { U'à', 'a', GRAVE }, { U'â', 'a', CIRCUNFLEXO }, { U'ã', 'a', TIL }, { U'ä', 'a', TREMA },
	{ U'é', 'e', AGUDO }, { U'è', 'e', GRAVE }, { U'ê', 'e', CIRCUNFLEXO }, { U'ë', 'e', TREMA },
	{ U'í', 'i', AGUDO }, { U'ì', 'i', GRAVE }, { U'î', 'i', CIRCUNFLEXO }, { U'ï', 'i', TREMA },
	{ U'ó', 'o', AGUDO }, { U'ò', 'o', GRAVE }, { U'ô', 'o', CIRCUNFLEXO }, { U'õ', 'o', TIL }, { U'ö', 'o', TREMA },
	{ U'ú', 'u', AGUDO }, { U'ù', 'u', GRAVE }, { U'û', 'u', CIRCUNFLEXO }, { U'ü', 'u', TREMA },
	{ U'ñ', 'n', TIL },
	{ U'Á', 'A', AGUDO }, { U'À', 'A', GRAVE }, { U'Â', 'A', CIRCUNFLEXO }, { U'Ã', 'A', TIL }, { U'Ä', 'A', TREMA },
	{ U'É', 'E', AGUDO }, { U'È', 'E', GRAVE }, { U'Ê', 'E', CIRCUNFLEXO }, { U'Ë', 'E', TREMA },
	{ U'Í', 'I', AGUDO }, { U'Ì', 'I', GRAVE }, { U'Î', 'I', CIRCUNFLEXO }, { U'Ï', 'I', TREMA },
	{ U'Ó', 'O', AGUDO }, { U'Ò', 'O', GRAVE }, { U'Ô', 'O', CIRCUNFLEXO }, { U'Õ', 'O', TIL }, { U'Ö', 'O', TREMA },
	{ U'Ú', 'U', AGUDO }, { U'Ù', 'U', GRAVE }, { U'Û', 'U', CIRCUNFLEXO }, { U'Ü', 'U', TREMA },
	{ U'Ñ', 'N', TIL },
};

void copiar(char p_ascii, uint8_t r_linhas[8]) {
	memcpy(r_linhas, RETRO_FONTE_SGDK + (p_ascii - 32) * 8, 8);
}

// As 8 linhas da letra; falso se a fonte não tem (sai "?").
bool letra(char32_t p_c, uint8_t r_linhas[8]) {
	if (p_c >= 32 && p_c < 127) {
		copiar(char(p_c), r_linhas);
		return true;
	}
	if (p_c == U'ç' || p_c == U'Ç') {
		copiar(p_c == U'ç' ? 'c' : 'C', r_linhas);
		r_linhas[7] = 0x18; // Cedilha na linha de baixo (livre no c e no C).
		return true;
	}
	for (const Acentuada &a : ACENTUADAS) {
		if (a.letra != p_c) {
			continue;
		}
		uint8_t base[8];
		copiar(a.base, base);
		if (a.base == 'i') {
			base[1] = 0; // O pingo do i dá lugar ao acento.
		}
		r_linhas[0] = 0;
		for (int y = 1; y < 8; y++) {
			r_linhas[y] = base[y - 1]; // Desce 1 px.
		}
		if (a.base >= 'a' && a.base <= 'z') {
			r_linhas[0] = MARCA_MINUSCULA[a.marca][0];
			r_linhas[1] = MARCA_MINUSCULA[a.marca][1];
		} else {
			r_linhas[0] = MARCA_MAIUSCULA[a.marca];
		}
		return true;
	}
	copiar('?', r_linhas);
	return false;
}
} // namespace

Ref<Image> MDLetreiro::desenhar(const String &p_texto, const Color &p_cor, Borda p_borda, const Color &p_cor_da_borda, Alinhamento p_alinhamento, int p_entrelinha, String *r_sem_desenho) {
	const PackedStringArray linhas = p_texto.replace("\t", " ").replace("\r", "").split("\n");
	int colunas = 1;
	for (const String &linha : linhas) {
		colunas = MAX(colunas, linha.length());
	}
	const int largura = colunas * 8;
	const int altura = (MAX(1, (linhas.size() - 1) * p_entrelinha + 8) + 7) / 8 * 8;
	// 0 = vazio, 1 = letra, 2 = borda.
	Vector<uint8_t> grade;
	grade.resize(largura * altura);
	grade.fill(0);
	for (int l = 0; l < linhas.size(); l++) {
		const String &linha = linhas[l];
		int x0 = 0;
		if (p_alinhamento == ALINHAMENTO_CENTRO) {
			x0 = (colunas - linha.length()) * 4;
		} else if (p_alinhamento == ALINHAMENTO_DIREITA) {
			x0 = (colunas - linha.length()) * 8;
		}
		const int y0 = l * p_entrelinha;
		for (int i = 0; i < linha.length(); i++) {
			uint8_t linhas_da_letra[8];
			if (!letra(linha[i], linhas_da_letra) && r_sem_desenho && r_sem_desenho->find_char(linha[i]) < 0) {
				*r_sem_desenho += String::chr(linha[i]);
			}
			for (int y = 0; y < 8; y++) {
				for (int x = 0; x < 8; x++) {
					const int px = x0 + i * 8 + x, py = y0 + y;
					if ((linhas_da_letra[y] & (0x80 >> x)) && px < largura && py < altura) {
						grade.write[py * largura + px] = 1;
					}
				}
			}
		}
	}
	if (p_borda != BORDA_NENHUMA) {
		const Vector<uint8_t> letras = grade;
		for (int y = 0; y < altura; y++) {
			for (int x = 0; x < largura; x++) {
				if (letras[y * largura + x]) {
					continue;
				}
				bool perto = false;
				if (p_borda == BORDA_SOMBRA) {
					perto = x > 0 && y > 0 && letras[(y - 1) * largura + x - 1]; // A letra deslocada (1, 1).
				} else {
					for (int dy = -1; dy <= 1 && !perto; dy++) {
						for (int dx = -1; dx <= 1 && !perto; dx++) {
							const int sx = x + dx, sy = y + dy;
							perto = sx >= 0 && sy >= 0 && sx < largura && sy < altura && letras[sy * largura + sx];
						}
					}
				}
				if (perto) {
					grade.write[y * largura + x] = 2;
				}
			}
		}
	}
	Ref<Image> imagem = Image::create_empty(largura, altura, false, Image::FORMAT_RGBA8);
	imagem->fill(Color(0, 0, 0, 0));
	for (int y = 0; y < altura; y++) {
		for (int x = 0; x < largura; x++) {
			const uint8_t g = grade[y * largura + x];
			if (g) {
				imagem->set_pixel(x, y, Color(g == 1 ? p_cor : p_cor_da_borda, 1));
			}
		}
	}
	return imagem;
}

Ref<Image> MDLetreiro::desenhar_texto(String *r_sem_desenho) const {
	return desenhar(texto.is_empty() ? String("Texto") : texto, cor, borda, cor_da_borda, alinhamento, entrelinha, r_sem_desenho);
}

void MDLetreiro::_atualizar() {
	const Ref<Image> imagem = desenhar_texto();
	if (previa.is_valid() && previa->get_size() == imagem->get_size()) {
		previa->update(imagem);
	} else {
		previa = ImageTexture::create_from_image(imagem);
	}
	queue_redraw();
	update_configuration_warnings();
}

void MDLetreiro::set_texto(const String &p_texto) {
	texto = p_texto;
	_atualizar();
}

void MDLetreiro::set_cor(const Color &p_cor) {
	cor = p_cor;
	_atualizar();
}

void MDLetreiro::set_borda(Borda p_borda) {
	borda = p_borda;
	_atualizar();
	notify_property_list_changed();
}

void MDLetreiro::set_cor_da_borda(const Color &p_cor) {
	cor_da_borda = p_cor;
	_atualizar();
}

void MDLetreiro::set_alinhamento(Alinhamento p_alinhamento) {
	alinhamento = p_alinhamento;
	_atualizar();
}

void MDLetreiro::set_entrelinha(int p_entrelinha) {
	entrelinha = CLAMP(p_entrelinha, 8, 32);
	_atualizar();
}

void MDLetreiro::set_duracao(float p_duracao) {
	duracao = CLAMP(p_duracao, 0.0f, 600.0f);
}

void MDLetreiro::set_paleta(int p_paleta) {
	paleta = CLAMP(p_paleta, 0, 3);
}

void MDLetreiro::set_prioridade(bool p_prioridade) {
	prioridade = p_prioridade;
}

void MDLetreiro::set_vram_da_fonte(bool p_fonte) {
	vram_da_fonte = p_fonte;
	update_configuration_warnings();
}

void MDLetreiro::_notification(int p_what) {
	if (p_what == NOTIFICATION_READY && previa.is_null()) {
		_atualizar();
	} else if (p_what == NOTIFICATION_DRAW) {
		if (previa.is_null()) {
			_atualizar();
		}
		draw_texture(previa, Vector2());
		if (Engine::get_singleton()->is_editor_hint()) {
			draw_rect(Rect2(Vector2(), previa->get_size()), Color(0.55, 0.65, 0.95, 0.6), false, 1);
		}
	}
}

PackedStringArray MDLetreiro::get_configuration_warnings() const {
	PackedStringArray warnings = Node2D::get_configuration_warnings();
	if (texto.strip_edges().is_empty()) {
		warnings.push_back(U("Escreva o texto."));
		return warnings;
	}
	String sem_desenho;
	const Ref<Image> imagem = desenhar_texto(&sem_desenho);
	if (!sem_desenho.is_empty()) {
		warnings.push_back(U("A fonte não tem estes caracteres (saem como \"?\"): ") + sem_desenho);
	}
	if (imagem->get_width() > MAX_LADO || imagem->get_height() > MAX_LADO) {
		warnings.push_back(vformat(U("O letreiro tem %d×%d px; um sprite vai até %d×%d (uns %d caracteres por linha)."), imagem->get_width(), imagem->get_height(), MAX_LADO, MAX_LADO, MAX_LADO / 8));
	}
	const int tiles = RetroMD::sprite_vram_tiles(imagem, 1, 1);
	if (vram_da_fonte && tiles > 96) {
		warnings.push_back(vformat(U("Com vram_da_fonte, o letreiro cabe em 96 tiles (a fonte); este usa %d. Encurte as linhas, use menos linhas ou desligue vram_da_fonte."), tiles));
	}
	if (get_rotation() != 0 || get_scale() != Vector2(1, 1)) {
		warnings.push_back(U("O letreiro não gira nem muda de escala."));
	}
	return warnings;
}

void MDLetreiro::_validate_property(PropertyInfo &p_property) const {
	RetroMD::hide_unsupported(this, p_property, KEPT_LETREIRO);
	if (p_property.name == "cor_da_borda" && borda == BORDA_NENHUMA) {
		p_property.usage = PROPERTY_USAGE_STORAGE;
	}
}

void MDLetreiro::_bind_methods() {
	ClassDB::bind_method(D_METHOD("set_texto", "texto"), &MDLetreiro::set_texto);
	ClassDB::bind_method(D_METHOD("get_texto"), &MDLetreiro::get_texto);
	ClassDB::bind_method(D_METHOD("set_cor", "cor"), &MDLetreiro::set_cor);
	ClassDB::bind_method(D_METHOD("get_cor"), &MDLetreiro::get_cor);
	ClassDB::bind_method(D_METHOD("set_borda", "borda"), &MDLetreiro::set_borda);
	ClassDB::bind_method(D_METHOD("get_borda"), &MDLetreiro::get_borda);
	ClassDB::bind_method(D_METHOD("set_cor_da_borda", "cor"), &MDLetreiro::set_cor_da_borda);
	ClassDB::bind_method(D_METHOD("get_cor_da_borda"), &MDLetreiro::get_cor_da_borda);
	ClassDB::bind_method(D_METHOD("set_alinhamento", "alinhamento"), &MDLetreiro::set_alinhamento);
	ClassDB::bind_method(D_METHOD("get_alinhamento"), &MDLetreiro::get_alinhamento);
	ClassDB::bind_method(D_METHOD("set_entrelinha", "entrelinha"), &MDLetreiro::set_entrelinha);
	ClassDB::bind_method(D_METHOD("get_entrelinha"), &MDLetreiro::get_entrelinha);
	ClassDB::bind_method(D_METHOD("set_duracao", "duracao"), &MDLetreiro::set_duracao);
	ClassDB::bind_method(D_METHOD("get_duracao"), &MDLetreiro::get_duracao);
	ClassDB::bind_method(D_METHOD("set_paleta", "paleta"), &MDLetreiro::set_paleta);
	ClassDB::bind_method(D_METHOD("get_paleta"), &MDLetreiro::get_paleta);
	ClassDB::bind_method(D_METHOD("set_prioridade", "prioridade"), &MDLetreiro::set_prioridade);
	ClassDB::bind_method(D_METHOD("get_prioridade"), &MDLetreiro::get_prioridade);
	ClassDB::bind_method(D_METHOD("set_vram_da_fonte", "fonte"), &MDLetreiro::set_vram_da_fonte);
	ClassDB::bind_method(D_METHOD("get_vram_da_fonte"), &MDLetreiro::get_vram_da_fonte);

	ADD_PROPERTY(PropertyInfo(Variant::STRING, "texto", PROPERTY_HINT_MULTILINE_TEXT), "set_texto", "get_texto");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor", "get_cor");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "borda", PROPERTY_HINT_ENUM, "Nenhuma,Sombra,Contorno"), "set_borda", "get_borda");
	ADD_PROPERTY(PropertyInfo(Variant::COLOR, "cor_da_borda", PROPERTY_HINT_COLOR_NO_ALPHA), "set_cor_da_borda", "get_cor_da_borda");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "alinhamento", PROPERTY_HINT_ENUM, "Esquerda,Centro,Direita"), "set_alinhamento", "get_alinhamento");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "entrelinha", PROPERTY_HINT_RANGE, "8,32,1,suffix:px"), "set_entrelinha", "get_entrelinha");
	ADD_PROPERTY(PropertyInfo(Variant::FLOAT, "duracao", PROPERTY_HINT_RANGE, "0,600,0.1,suffix:s"), "set_duracao", "get_duracao");
	ADD_PROPERTY(PropertyInfo(Variant::INT, "paleta", PROPERTY_HINT_ENUM, "PAL0,PAL1,PAL2,PAL3"), "set_paleta", "get_paleta");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "prioridade"), "set_prioridade", "get_prioridade");
	ADD_PROPERTY(PropertyInfo(Variant::BOOL, "vram_da_fonte"), "set_vram_da_fonte", "get_vram_da_fonte");

	BIND_ENUM_CONSTANT(ALINHAMENTO_ESQUERDA);
	BIND_ENUM_CONSTANT(ALINHAMENTO_CENTRO);
	BIND_ENUM_CONSTANT(ALINHAMENTO_DIREITA);
	BIND_ENUM_CONSTANT(BORDA_NENHUMA);
	BIND_ENUM_CONSTANT(BORDA_SOMBRA);
	BIND_ENUM_CONSTANT(BORDA_CONTORNO);
}
