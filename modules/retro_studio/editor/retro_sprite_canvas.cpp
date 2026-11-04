#include "retro_sprite_canvas.h"

#include "core/input/input_event.h"
#include "core/object/callable_mp.h"
#include "core/object/class_db.h"
#include "editor/editor_node.h"
#include "editor/editor_data.h"
#include "editor/editor_interface.h"
#include "../scene/md_nota.h"
#include "retro_map_editor.h"
#include "scene/resources/2d/tile_set.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/scene/canvas_item_editor_plugin.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/label.h"
#include "scene/gui/separator.h"
#include "scene/gui/spin_box.h"

namespace {
String U(const char *p_text) {
	return String::utf8(p_text);
}

void draw_box(Control *p_overlay, const Rect2 &p_rect, const Color &p_color) {
	p_overlay->draw_rect(p_rect, p_color, false, Math::round(2 * EDSCALE));
	const real_t h = Math::round(3 * EDSCALE);
	const Vector2 points[] = {
		p_rect.position, Vector2(p_rect.get_center().x, p_rect.position.y), Vector2(p_rect.get_end().x, p_rect.position.y),
		Vector2(p_rect.get_end().x, p_rect.get_center().y), p_rect.get_end(), Vector2(p_rect.get_center().x, p_rect.get_end().y),
		Vector2(p_rect.position.x, p_rect.get_end().y), Vector2(p_rect.position.x, p_rect.get_center().y)
	};
	for (const Vector2 &point : points) {
		p_overlay->draw_rect(Rect2(point - Vector2(h, h), Vector2(h, h) * 2), p_color);
	}
}
} // namespace

MDSprite *RetroSpriteCanvasPlugin::_sprite() const {
	MDSprite *sprite = Object::cast_to<MDSprite>(ObjectDB::get_instance(sprite_id));
	return sprite && sprite->is_inside_tree() && sprite->get_previa_animacao() ? sprite : nullptr;
}

// O ajuste conta com o sprite como no jogo: sem espelhar, sem girar e sem escala.
bool RetroSpriteCanvasPlugin::_pode_ajustar(MDSprite *p_sprite) const {
	return p_sprite && !p_sprite->is_flipped_h() && !p_sprite->is_flipped_v() && p_sprite->get_global_transform().get_rotation() == 0 && p_sprite->get_global_transform().get_scale() == Vector2(1, 1);
}

// Local do sprite (pés = 0, 0) → tela da vista 2D.
Transform2D RetroSpriteCanvasPlugin::_tela(MDSprite *p_sprite) const {
	return CanvasItemEditor::get_singleton()->get_canvas_transform() * p_sprite->get_global_transform();
}

bool RetroSpriteCanvasPlugin::_ataque_visivel(MDSprite *p_sprite) const {
	const MDPersonagem::Animacao *anim = p_sprite->get_previa_animacao();
	const int q = p_sprite->get_previa_quadro();
	return anim && anim->attack && q >= anim->attack_first && q <= anim->attack_last;
}

// -1 = fora; 0 = dentro, longe das bordas; senão, as bordas (BORDA_...) perto do ponto.
int RetroSpriteCanvasPlugin::_bordas_em(const Rect2 &p_tela, const Vector2 &p_ponto) const {
	const real_t tol = 6 * EDSCALE;
	if (!p_tela.grow(tol).has_point(p_ponto)) {
		return -1;
	}
	int found = 0;
	if (Math::abs(p_ponto.x - p_tela.position.x) < tol) {
		found |= BORDA_ESQUERDA;
	} else if (Math::abs(p_ponto.x - p_tela.get_end().x) < tol) {
		found |= BORDA_DIREITA;
	}
	if (Math::abs(p_ponto.y - p_tela.position.y) < tol) {
		found |= BORDA_CIMA;
	} else if (Math::abs(p_ponto.y - p_tela.get_end().y) < tol) {
		found |= BORDA_BAIXO;
	}
	return found;
}

void RetroSpriteCanvasPlugin::_atualizar_processos(Node *p_node) {
	if (!p_node) {
		return;
	}
	if (MDSprite *sprite = Object::cast_to<MDSprite>(p_node)) {
		sprite->previa_atualizar_processo();
	}
	for (int i = 0; i < p_node->get_child_count(); i++) {
		_atualizar_processos(p_node->get_child(i));
	}
}

void RetroSpriteCanvasPlugin::_animar_alternado(bool p_ligado) {
	MDSprite::set_previa_ligada(p_ligado);
	_atualizar_processos(EditorNode::get_singleton()->get_edited_scene());
	_atualizar_icones();
}

void RetroSpriteCanvasPlugin::_ajustar_alternado(bool p_ligado) {
	if (!p_ligado) {
		_cancelar_arrasto();
	}
	_atualizar_info();
	update_overlays();
}

void RetroSpriteCanvasPlugin::_atualizar_icones() {
	if (!barra->is_inside_tree()) {
		return;
	}
	animar->set_button_icon(barra->get_editor_theme_icon(animar->is_pressed() ? SNAME("Pause") : SNAME("Play")));
	ajustar->set_button_icon(barra->get_editor_theme_icon(SNAME("Edit")));
	nota->set_button_icon(barra->get_editor_theme_icon(SNAME("MDNota")));
}

void RetroSpriteCanvasPlugin::_atualizar_info() {
	MDSprite *sprite = _sprite();
	const bool pode = ajustar->is_pressed() && sprite && _pode_ajustar(sprite);
	controles->set_visible(pode);
	if (!ajustar->is_pressed() || !sprite) {
		info->set_text(ajustar->is_pressed() ? U("Selecione um sprite com personagem.") : String());
		return;
	}
	if (!pode) {
		info->set_text(U("Para ajustar, o sprite não pode estar espelhado (flip), girado nem com escala."));
		return;
	}
	const MDPersonagem::Animacao *anim = sprite->get_previa_animacao();
	const int n = anim->frames.size();
	const int q = CLAMP(sprite->get_previa_quadro(), 0, n - 1);
	info->set_text(vformat(U("%s · quadro %d de %d"), anim->name, q + 1, n));
	// Um botão por quadro; o do quadro mostrado fica marcado.
	if (quadros->get_child_count() != n) {
		while (quadros->get_child_count() > 0) {
			Node *child = quadros->get_child(0);
			quadros->remove_child(child);
			memdelete(child);
		}
		for (int i = 0; i < n; i++) {
			Button *button = memnew(Button);
			button->set_theme_type_variation(SceneStringName(FlatButton));
			button->set_toggle_mode(true);
			button->set_text(itos(i + 1));
			button->set_focus_mode(Control::FOCUS_NONE);
			button->connect(SceneStringName(pressed), callable_mp(this, &RetroSpriteCanvasPlugin::_quadro_clicado).bind(i));
			quadros->add_child(button);
		}
	}
	for (int i = 0; i < n; i++) {
		Button *button = Object::cast_to<Button>(quadros->get_child(i));
		button->set_pressed_no_signal(i == q);
		button->set_tooltip_text(vformat(U("Quadro %d (%d/60 s)"), i + 1, anim->frames[i].ticks));
	}
	tempo->set_value_no_signal(anim->frames[q].ticks);
}

void RetroSpriteCanvasPlugin::_trocar_quadro(int p_passo) {
	MDSprite *sprite = _sprite();
	const MDPersonagem::Animacao *anim = sprite ? sprite->get_previa_animacao() : nullptr;
	if (!anim || anim->frames.is_empty()) {
		return;
	}
	if (animar->is_pressed()) {
		animar->set_pressed(false); // A prévia para no quadro escolhido.
	}
	const int n = anim->frames.size();
	sprite->set_previa_quadro((sprite->get_previa_quadro() + p_passo + n) % n);
	_atualizar_info();
	update_overlays();
}

// Dados do personagem com o arrasto em andamento aplicado (p_delta em pixels, a partir de p_dados).
Dictionary RetroSpriteCanvasPlugin::_editar(const Dictionary &p_dados, const Vector2i &p_delta) const {
	Dictionary dados = p_dados.duplicate(true);
	MDSprite *sprite = _sprite();
	const MDPersonagem::Animacao *anim = sprite ? sprite->get_previa_animacao() : nullptr;
	if (!anim) {
		return dados;
	}
	const int q = CLAMP(sprite->get_previa_quadro(), 0, anim->frames.size() - 1);
	Array anims = dados.get("animations", Array());
	if (anim->index < 0 || anim->index >= anims.size()) {
		return dados;
	}
	Dictionary a = anims[anim->index];
	if (arrasto == ARRASTO_DESENHO) {
		const Array frames = MDPersonagem::ensure_free_frames(a, anim);
		if (q >= frames.size()) {
			return dados;
		}
		Dictionary f = frames[q];
		const Vector2i offset = (ajuste_inicial + p_delta).clampi(-128, 128);
		for (int axis = 0; axis < 2; axis++) {
			const String key = axis ? "offsetY" : "offsetX";
			if (offset[axis]) {
				f[key] = offset[axis];
			} else {
				f.erase(key);
			}
		}
		return dados;
	}
	Rect2i box = caixa_inicial;
	if (!bordas) {
		box.position += p_delta;
	} else {
		if (bordas & BORDA_ESQUERDA) {
			const int x = MIN(box.position.x + p_delta.x, box.get_end().x - 1);
			box.size.x = box.get_end().x - x;
			box.position.x = x;
		} else if (bordas & BORDA_DIREITA) {
			box.size.x = MAX(1, box.size.x + p_delta.x);
		}
		if (bordas & BORDA_CIMA) {
			const int y = MIN(box.position.y + p_delta.y, box.get_end().y - 1);
			box.size.y = box.get_end().y - y;
			box.position.y = y;
		} else if (bordas & BORDA_BAIXO) {
			box.size.y = MAX(1, box.size.y + p_delta.y);
		}
	}
	const Dictionary rect = MDPersonagem::rect_to_dict(box);
	Dictionary target = arrasto == ARRASTO_CORPO ? Dictionary(dados.get("bodyBox", Dictionary())) : Dictionary(a.get("attack", Dictionary()));
	for (const Variant &key : rect.keys()) {
		target[key] = rect[key];
	}
	if (arrasto == ARRASTO_CORPO) {
		dados["bodyBox"] = target;
	} else {
		a["attack"] = target;
	}
	return dados;
}

// Do e undo: os dados vão para o personagem e para o .charset.json na hora.
void RetroSpriteCanvasPlugin::_aplicar_dados(const Ref<MDPersonagem> &p_personagem, const Dictionary &p_dados) {
	if (p_personagem.is_null()) {
		return;
	}
	(void)p_personagem->set_data(p_dados.duplicate(true));
	if (p_personagem->save_to_file() != OK) {
		EditorNode::get_singleton()->show_warning(U("Não foi possível gravar ") + p_personagem->get_path());
	}
	_atualizar_info();
	update_overlays();
}

void RetroSpriteCanvasPlugin::_registrar(const String &p_nome, const Dictionary &p_antes, const Dictionary &p_depois, bool p_juntar) {
	MDSprite *sprite = _sprite();
	if (!sprite) {
		return;
	}
	const Ref<MDPersonagem> personagem = sprite->get_personagem();
	EditorUndoRedoManager *undo = EditorUndoRedoManager::get_singleton();
	undo->create_action(p_nome, p_juntar ? UndoRedo::MERGE_ENDS : UndoRedo::MERGE_DISABLE, personagem.ptr(), false, false);
	undo->add_do_method(this, "_aplicar_dados", personagem, p_depois);
	undo->add_undo_method(this, "_aplicar_dados", personagem, p_antes);
	undo->commit_action(false);
}

void RetroSpriteCanvasPlugin::_mudar_tempo(int p_passo) {
	MDSprite *sprite = _sprite();
	const MDPersonagem::Animacao *anim = sprite ? sprite->get_previa_animacao() : nullptr;
	if (anim && !anim->frames.is_empty()) {
		_definir_tempo(anim->frames[CLAMP(sprite->get_previa_quadro(), 0, anim->frames.size() - 1)].ticks + p_passo);
	}
}

void RetroSpriteCanvasPlugin::_definir_tempo(int p_ticks) {
	MDSprite *sprite = _sprite();
	const MDPersonagem::Animacao *anim = sprite ? sprite->get_previa_animacao() : nullptr;
	if (!anim) {
		return;
	}
	const Ref<MDPersonagem> personagem = sprite->get_personagem();
	const int q = CLAMP(sprite->get_previa_quadro(), 0, anim->frames.size() - 1);
	const Dictionary before = personagem->get_data().duplicate(true);
	Dictionary dados = before.duplicate(true);
	Array anims = dados.get("animations", Array());
	if (anim->index < 0 || anim->index >= anims.size()) {
		return;
	}
	Dictionary a = anims[anim->index];
	const Array frames = MDPersonagem::ensure_free_frames(a, anim);
	if (q >= frames.size()) {
		return;
	}
	Dictionary f = frames[q];
	f["durationTicks"] = CLAMP(p_ticks, 1, 255);
	_aplicar_dados(personagem, dados);
	_registrar(U("Tempo do quadro"), before, dados, true);
}

void RetroSpriteCanvasPlugin::_tempo_alterado(double p_valor) {
	MDSprite *sprite = _sprite();
	const MDPersonagem::Animacao *anim = sprite ? sprite->get_previa_animacao() : nullptr;
	if (anim && !anim->frames.is_empty() && anim->frames[CLAMP(sprite->get_previa_quadro(), 0, anim->frames.size() - 1)].ticks != int(p_valor)) {
		_definir_tempo(int(p_valor));
	}
}

void RetroSpriteCanvasPlugin::_quadro_clicado(int p_quadro) {
	MDSprite *sprite = _sprite();
	if (sprite) {
		_trocar_quadro(p_quadro - sprite->get_previa_quadro());
	}
}

void RetroSpriteCanvasPlugin::_cancelar_arrasto() {
	if (arrasto == ARRASTO_NADA) {
		return;
	}
	MDSprite *sprite = _sprite();
	if (sprite && aplicado != Vector2i()) {
		(void)sprite->get_personagem()->set_data(antes.duplicate(true));
	}
	arrasto = ARRASTO_NADA;
	update_overlays();
}

bool RetroSpriteCanvasPlugin::forward_canvas_gui_input(const Ref<InputEvent> &p_event) {
	MDSprite *sprite = _sprite();
	if (!ajustar->is_pressed() || !sprite || !_pode_ajustar(sprite)) {
		return false;
	}
	const Ref<InputEventKey> k = p_event;
	if (k.is_valid() && k->is_pressed() && !k->is_command_or_control_pressed() && !k->is_alt_pressed()) {
		switch (k->get_keycode()) {
			case Key::LEFT:
				_trocar_quadro(-1);
				return true;
			case Key::RIGHT:
				_trocar_quadro(1);
				return true;
			case Key::EQUAL:
			case Key::PLUS:
			case Key::KP_ADD:
				_mudar_tempo(1);
				return true;
			case Key::MINUS:
			case Key::KP_SUBTRACT:
				_mudar_tempo(-1);
				return true;
			case Key::ESCAPE:
				if (arrasto != ARRASTO_NADA) {
					_cancelar_arrasto();
					return true;
				}
				return false;
			default:
				return false;
		}
	}

	const Transform2D tela = _tela(sprite);
	const Ref<InputEventMouseButton> b = p_event;
	if (b.is_valid() && b->get_button_index() == MouseButton::RIGHT && b->is_pressed() && arrasto != ARRASTO_NADA) {
		_cancelar_arrasto();
		return true;
	}
	if (b.is_valid() && b->get_button_index() == MouseButton::LEFT) {
		if (b->is_pressed() && arrasto == ARRASTO_NADA && !b->is_command_or_control_pressed() && !b->is_alt_pressed()) {
			const MDPersonagem::Animacao *anim = sprite->get_previa_animacao();
			const Ref<MDPersonagem> personagem = sprite->get_personagem();
			const Vector2 ponto = b->get_position();
			const bool shift = b->is_shift_pressed();
			// Bordas das caixas primeiro; o interior de uma caixa a move só com Shift; o resto do quadro
			// arrasta o desenho (ajuste fino).
			int found = -1;
			if (_ataque_visivel(sprite)) {
				found = _bordas_em(tela.xform(Rect2(anim->attack_box)), ponto);
				if (found > 0 || (found == 0 && shift)) {
					arrasto = ARRASTO_ATAQUE;
					caixa_inicial = anim->attack_box;
				}
			}
			if (arrasto == ARRASTO_NADA) {
				found = _bordas_em(tela.xform(Rect2(personagem->get_body_box())), ponto);
				if (found > 0 || (found == 0 && shift)) {
					arrasto = ARRASTO_CORPO;
					caixa_inicial = personagem->get_body_box();
				}
			}
			const Vector2 local = tela.affine_inverse().xform(ponto);
			if (arrasto == ARRASTO_NADA && Rect2(sprite->get_offset(), Vector2(sprite->get_frame_size())).has_point(local)) {
				arrasto = ARRASTO_DESENHO;
				found = 0;
			}
			if (arrasto == ARRASTO_NADA) {
				return false;
			}
			bordas = MAX(0, found);
			arrasto_de = local;
			aplicado = Vector2i();
			antes = personagem->get_data().duplicate(true);
			ajuste_inicial = anim->frames[CLAMP(sprite->get_previa_quadro(), 0, anim->frames.size() - 1)].offset;
			if (animar->is_pressed()) {
				animar->set_pressed(false); // Ajusta o quadro que está na tela.
			}
			return true;
		}
		if (!b->is_pressed() && arrasto != ARRASTO_NADA) {
			const Arrasto feito = arrasto;
			arrasto = ARRASTO_NADA;
			if (aplicado != Vector2i()) {
				const Ref<MDPersonagem> personagem = sprite->get_personagem();
				const Dictionary depois = personagem->get_data().duplicate(true);
				_aplicar_dados(personagem, depois);
				const char *nomes[] = { "", "Ajuste fino do quadro", "Caixa do corpo", "Caixa de ataque" };
				_registrar(U(nomes[feito]), antes, depois, false);
			}
			update_overlays();
			return true;
		}
	}

	const Ref<InputEventMouseMotion> m = p_event;
	if (m.is_valid() && arrasto != ARRASTO_NADA) {
		const Vector2 local = tela.affine_inverse().xform(m->get_position());
		const Vector2i delta = Vector2i((local - arrasto_de).round());
		if (delta != aplicado) {
			aplicado = delta;
			// Ao vivo: o atlas é refeito e o desenho já aparece no lugar novo.
			(void)sprite->get_personagem()->set_data(_editar(antes, delta));
			_atualizar_info();
			update_overlays();
		}
		return true;
	}
	return false;
}

void RetroSpriteCanvasPlugin::forward_canvas_draw_over_viewport(Control *p_overlay) {
	MDSprite *sprite = _sprite();
	if (!ajustar->is_pressed() || !sprite || !_pode_ajustar(sprite)) {
		return;
	}
	const Transform2D tela = _tela(sprite);
	const Ref<MDPersonagem> personagem = sprite->get_personagem();
	p_overlay->draw_rect(tela.xform(Rect2(sprite->get_offset(), Vector2(sprite->get_frame_size()))), Color(1, 1, 1, 0.35), false, 1);
	draw_box(p_overlay, tela.xform(Rect2(personagem->get_body_box())), Color(0.3, 1, 0.4, 0.95)); // Cores da prévia do gestor.
	if (_ataque_visivel(sprite)) {
		draw_box(p_overlay, tela.xform(Rect2(sprite->get_previa_animacao()->attack_box)), Color(1, 0.3, 0.3, 0.95));
	}
	const Vector2 pes = tela.xform(Vector2());
	const real_t r = 5 * EDSCALE;
	p_overlay->draw_line(pes - Vector2(r, 0), pes + Vector2(r, 0), Color(0.3, 0.9, 1), Math::round(2 * EDSCALE));
	p_overlay->draw_line(pes - Vector2(0, r), pes + Vector2(0, r), Color(0.3, 0.9, 1), Math::round(2 * EDSCALE));
}

void RetroSpriteCanvasPlugin::_nova_nota() {
	Node *root = EditorInterface::get_singleton()->get_edited_scene_root();
	CanvasItem *raiz = Object::cast_to<CanvasItem>(root);
	CanvasItemEditor *canvas = CanvasItemEditor::get_singleton();
	if (!raiz || !canvas) {
		return;
	}
	MDNota *nova = memnew(MDNota);
	nova->set_name(U("Nota"));
	// No meio da vista, alinhada aos tiles de 8 px.
	const Vector2 meio = canvas->get_canvas_transform().affine_inverse().xform(canvas->get_viewport_control()->get_size() / 2);
	const Vector2 local = raiz->get_global_transform().affine_inverse().xform(meio) - Vector2(nova->get_tamanho()) / 2;
	nova->set_position((local / 8).round() * 8);
	EditorUndoRedoManager *undo_redo = EditorUndoRedoManager::get_singleton();
	undo_redo->create_action(U("Nova nota para a IA"), UndoRedo::MERGE_DISABLE, root);
	undo_redo->add_do_method(root, "add_child", nova, true);
	undo_redo->add_do_method(nova, "set_owner", root);
	undo_redo->add_do_reference(nova);
	undo_redo->add_undo_method(root, "remove_child", nova);
	undo_redo->commit_action();
	EditorSelection *selecao = EditorNode::get_singleton()->get_editor_selection();
	selecao->clear();
	selecao->add_node(nova);
	EditorNode::get_singleton()->push_item(nova);
}

void RetroSpriteCanvasPlugin::_numeros_alternado(bool p_ligado) {
	update_overlays();
}

// Números dos tiles de uma camada, só nas células à vista e com zoom que deixe ler.
void RetroSpriteCanvasPlugin::_desenhar_numeros(Control *p_overlay, TileMapLayer *p_layer) {
	const Ref<TileSet> tile_set = p_layer->get_tile_set();
	if (tile_set.is_null()) {
		return;
	}
	const Transform2D tela = CanvasItemEditor::get_singleton()->get_canvas_transform() * p_layer->get_global_transform();
	const Vector2 celula = tela.basis_xform(Vector2(tile_set->get_tile_size()));
	if (celula.x < 18 * EDSCALE) {
		return; // Pequeno demais: quem chama avisa para aproximar.
	}
	const Ref<Font> fonte = p_overlay->get_theme_font(SceneStringName(font), SNAME("Label"));
	const int tamanho = int(MIN(14 * EDSCALE, celula.x * 0.38));
	const Rect2 local = tela.affine_inverse().xform(Rect2(Vector2(), p_overlay->get_size()));
	const Vector2i de = p_layer->local_to_map(local.position) - Vector2i(1, 1);
	const Vector2i ate = p_layer->local_to_map(local.get_end()) + Vector2i(1, 1);
	const Rect2i usadas = p_layer->get_used_rect();
	const Vector2i inicio = de.max(usadas.position), fim = ate.min(usadas.get_end());
	for (int y = inicio.y; y < fim.y; y++) {
		for (int x = inicio.x; x < fim.x; x++) {
			const Vector2i c(x, y);
			const int fonte_id = p_layer->get_cell_source_id(c);
			if (fonte_id < 0) {
				continue;
			}
			const Ref<TileSetAtlasSource> atlas = tile_set->get_source(fonte_id);
			if (atlas.is_null()) {
				continue;
			}
			const Vector2i coords = p_layer->get_cell_atlas_coords(c);
			const int alt = p_layer->get_cell_alternative_tile(c);
			const int numero = coords.y * atlas->get_atlas_grid_size().x + coords.x;
			// Espelhados em amarelo (o mesmo tile do TileSet, virado).
			const bool espelhado = alt & (TileSetAtlasSource::TRANSFORM_FLIP_H | TileSetAtlasSource::TRANSFORM_FLIP_V);
			const Vector2 canto = tela.xform(p_layer->map_to_local(c) - Vector2(tile_set->get_tile_size()) / 2);
			const Vector2 pos = canto + Vector2(0, (celula.y + tamanho * 0.7) / 2);
			const String texto = itos(numero);
			p_overlay->draw_string_outline(fonte, pos, texto, HORIZONTAL_ALIGNMENT_CENTER, celula.x, tamanho, Math::round(3 * EDSCALE), Color(0, 0, 0, 0.85));
			p_overlay->draw_string(fonte, pos, texto, HORIZONTAL_ALIGNMENT_CENTER, celula.x, tamanho, espelhado ? Color(1, 0.85, 0.3) : Color(1, 1, 1));
		}
	}
}

void RetroSpriteCanvasPlugin::forward_canvas_force_draw_over_viewport(Control *p_overlay) {
	if (!numeros->is_pressed()) {
		return;
	}
	Node *raiz = EditorNode::get_singleton()->get_edited_scene();
	if (!raiz) {
		return;
	}
	// Uma camada selecionada (mapa, colisão, prioridade): só ela; senão todos os MDMapa visíveis.
	Vector<TileMapLayer *> camadas;
	for (Node *n : EditorNode::get_singleton()->get_editor_selection()->get_top_selected_node_list()) {
		if (TileMapLayer *layer = Object::cast_to<TileMapLayer>(n)) {
			camadas.push_back(layer);
		}
	}
	if (camadas.is_empty()) {
		TypedArray<Node> mapas = raiz->find_children("*", "MDMapa", true, false);
		if (Object::cast_to<MDMapa>(raiz)) {
			mapas.push_back(raiz);
		}
		for (int i = 0; i < mapas.size(); i++) {
			TileMapLayer *layer = Object::cast_to<TileMapLayer>(Object::cast_to<Node>(mapas[i]));
			if (layer && layer->is_visible_in_tree()) {
				camadas.push_back(layer);
			}
		}
	}
	bool pequeno = false;
	for (TileMapLayer *layer : camadas) {
		const Ref<TileSet> tile_set = layer->get_tile_set();
		if (tile_set.is_valid() && (CanvasItemEditor::get_singleton()->get_canvas_transform() * layer->get_global_transform()).basis_xform(Vector2(tile_set->get_tile_size())).x < 18 * EDSCALE) {
			pequeno = true;
			continue;
		}
		_desenhar_numeros(p_overlay, layer);
	}
	if (pequeno) {
		const Ref<Font> fonte = p_overlay->get_theme_font(SceneStringName(font), SNAME("Label"));
		const int tamanho = p_overlay->get_theme_font_size(SceneStringName(font_size), SNAME("Label"));
		const Vector2 pos = Vector2(10 * EDSCALE, p_overlay->get_size().y - 12 * EDSCALE);
		const String aviso = U("Aproxime (zoom) para ver os números dos tiles.");
		p_overlay->draw_string_outline(fonte, pos, aviso, HORIZONTAL_ALIGNMENT_LEFT, -1, tamanho, Math::round(3 * EDSCALE), Color(0, 0, 0, 0.85));
		p_overlay->draw_string(fonte, pos, aviso, HORIZONTAL_ALIGNMENT_LEFT, -1, tamanho, Color(1, 1, 1));
	}
}

bool RetroSpriteCanvasPlugin::handles(Object *p_object) const {
	const MDSprite *sprite = Object::cast_to<MDSprite>(p_object);
	return sprite && sprite->get_personagem().is_valid();
}

void RetroSpriteCanvasPlugin::edit(Object *p_object) {
	_cancelar_arrasto();
	sprite_id = Object::cast_to<MDSprite>(p_object) ? p_object->get_instance_id() : ObjectID();
	_atualizar_info();
	update_overlays();
}

void RetroSpriteCanvasPlugin::make_visible(bool p_visible) {
	if (!p_visible) {
		_cancelar_arrasto();
		sprite_id = ObjectID();
	}
	_atualizar_info();
	update_overlays();
}

void RetroSpriteCanvasPlugin::_bind_methods() {
	ClassDB::bind_method(D_METHOD("_aplicar_dados", "personagem", "dados"), &RetroSpriteCanvasPlugin::_aplicar_dados);
}

RetroSpriteCanvasPlugin::RetroSpriteCanvasPlugin() {
	barra = memnew(HBoxContainer);
	barra->add_child(memnew(VSeparator));

	animar = memnew(Button);
	animar->set_theme_type_variation(SceneStringName(FlatButton));
	animar->set_toggle_mode(true);
	animar->set_text(U("Animar"));
	animar->set_tooltip_text(U("Toca a animação dos sprites no cenário, com o tempo de cada quadro do jogo (também durante o play do AnimationPlayer). É só prévia: nada muda na cena."));
	animar->connect(SceneStringName(toggled), callable_mp(this, &RetroSpriteCanvasPlugin::_animar_alternado));
	barra->add_child(animar);

	ajustar = memnew(Button);
	ajustar->set_theme_type_variation(SceneStringName(FlatButton));
	ajustar->set_toggle_mode(true);
	ajustar->set_text(U("Ajustar"));
	ajustar->set_tooltip_text(U("Ajusta a animação do sprite selecionado aqui no cenário:\n"
								"• ← e → trocam o quadro;\n"
								"• arrastar o desenho move o quadro (ajuste fino);\n"
								"• arrastar as bordas muda a caixa verde (corpo) ou a vermelha (ataque, nos quadros em que vale); com Shift, arrastar dentro move a caixa;\n"
								"• + e − mudam o tempo do quadro;\n"
								"• Esc ou o botão direito cancelam o arrasto.\n"
								"Grava no personagem (.charset.json), com desfazer: vale para todas as cenas que usam este personagem."));
	ajustar->connect(SceneStringName(toggled), callable_mp(this, &RetroSpriteCanvasPlugin::_ajustar_alternado));
	barra->add_child(ajustar);

	numeros = memnew(Button);
	numeros->set_theme_type_variation(SceneStringName(FlatButton));
	numeros->set_toggle_mode(true);
	numeros->set_text("#");
	numeros->set_tooltip_text(U("Mostra em cada célula do mapa o número do tile no TileSet (a partir de 0, linha por linha), para ver como os tiles estão ordenados. Em amarelo, os espelhados.\nCom um mapa (ou colisão, prioridade) selecionado, só ele; senão, todos os MDMapa da cena. Aproxime para ler."));
	numeros->connect(SceneStringName(toggled), callable_mp(this, &RetroSpriteCanvasPlugin::_numeros_alternado));
	barra->add_child(numeros);

	nota = memnew(Button);
	nota->set_theme_type_variation(SceneStringName(FlatButton));
	nota->set_text(U("Nota"));
	nota->set_tooltip_text(U("Cria uma nota para a IA no meio da vista: uma área com o que ela deve fazer, um problema ou uma informação. Arraste as bordas para marcar a área e escreva o texto no inspetor. Não entra no jogo."));
	nota->connect(SceneStringName(pressed), callable_mp(this, &RetroSpriteCanvasPlugin::_nova_nota));
	barra->add_child(nota);

	mapas = memnew(Button);
	mapas->set_theme_type_variation(SceneStringName(FlatButton));
	mapas->set_text(U("Editor de mapas"));
	mapas->set_tooltip_text(U("Abre o editor de mapas numa janela própria (dá para pôr em outro monitor): paleta de tiles grande, camadas da cena, lápis, borracha, retângulo, balde, seleção com carimbo e espelhos. Pinta nos mapas da cena aberta, com o mesmo desfazer."));
	mapas->connect(SceneStringName(pressed), callable_mp(this, &RetroSpriteCanvasPlugin::_abrir_editor_mapas));
	barra->add_child(mapas);

	info = memnew(Label);
	info->set_vertical_alignment(VERTICAL_ALIGNMENT_CENTER);
	barra->add_child(info);

	controles = memnew(HBoxContainer);
	controles->hide();
	barra->add_child(controles);
	anterior = memnew(Button);
	anterior->set_theme_type_variation(SceneStringName(FlatButton));
	anterior->set_text(U("◀"));
	anterior->set_tooltip_text(U("Quadro anterior (←)"));
	anterior->set_focus_mode(Control::FOCUS_NONE);
	anterior->connect(SceneStringName(pressed), callable_mp(this, &RetroSpriteCanvasPlugin::_trocar_quadro).bind(-1));
	controles->add_child(anterior);
	quadros = memnew(HBoxContainer);
	quadros->add_theme_constant_override("separation", 0);
	controles->add_child(quadros);
	seguinte = memnew(Button);
	seguinte->set_theme_type_variation(SceneStringName(FlatButton));
	seguinte->set_text(U("▶"));
	seguinte->set_tooltip_text(U("Quadro seguinte (→)"));
	seguinte->set_focus_mode(Control::FOCUS_NONE);
	seguinte->connect(SceneStringName(pressed), callable_mp(this, &RetroSpriteCanvasPlugin::_trocar_quadro).bind(1));
	controles->add_child(seguinte);
	Label *tempo_rotulo = memnew(Label);
	tempo_rotulo->set_text(U("Tempo:"));
	tempo_rotulo->set_vertical_alignment(VERTICAL_ALIGNMENT_CENTER);
	controles->add_child(tempo_rotulo);
	tempo = memnew(SpinBox);
	tempo->set_min(1);
	tempo->set_max(255);
	tempo->set_step(1);
	tempo->set_suffix(U("/60 s"));
	tempo->set_tooltip_text(U("Tempo do quadro na tela, em 1/60 de segundo (+ e − no teclado). Use as setinhas, a roda do mouse ou digite."));
	tempo->connect(SceneStringName(value_changed), callable_mp(this, &RetroSpriteCanvasPlugin::_tempo_alterado));
	controles->add_child(tempo);

	barra->connect(SceneStringName(theme_changed), callable_mp(this, &RetroSpriteCanvasPlugin::_atualizar_icones));
	add_control_to_container(CONTAINER_CANVAS_EDITOR_MENU, barra);
}

void RetroSpriteCanvasPlugin::_abrir_editor_mapas() {
	if (!editor_mapas) {
		editor_mapas = memnew(RetroMapEditor);
		EditorInterface::get_singleton()->get_base_control()->add_child(editor_mapas);
		connect("scene_changed", callable_mp(this, &RetroSpriteCanvasPlugin::_cena_trocada));
	}
	editor_mapas->open();
}

void RetroSpriteCanvasPlugin::_cena_trocada(Node *p_raiz) {
	if (editor_mapas) {
		editor_mapas->scene_changed();
	}
}

void RetroSpriteCanvasPlugin::_notification(int p_what) {
	// Os números dos tiles desenham com qualquer node selecionado (a lista do editor só existe aqui, não no construtor).
	if (p_what == NOTIFICATION_ENTER_TREE && !is_force_draw_over_forwarding_enabled()) {
		set_force_draw_over_forwarding_enabled();
	}
}
