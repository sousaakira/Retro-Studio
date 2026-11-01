#include "retro_sprite_canvas.h"

#include "core/input/input_event.h"
#include "core/object/callable_mp.h"
#include "core/object/class_db.h"
#include "editor/editor_node.h"
#include "editor/editor_undo_redo_manager.h"
#include "editor/scene/canvas_item_editor_plugin.h"
#include "editor/themes/editor_scale.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/label.h"
#include "scene/gui/separator.h"

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
}

void RetroSpriteCanvasPlugin::_atualizar_info() {
	MDSprite *sprite = _sprite();
	if (!ajustar->is_pressed() || !sprite) {
		info->set_text(ajustar->is_pressed() ? U("Selecione um sprite com personagem.") : String());
		return;
	}
	if (!_pode_ajustar(sprite)) {
		info->set_text(U("Para ajustar, o sprite não pode estar espelhado (flip), girado nem com escala."));
		return;
	}
	const MDPersonagem::Animacao *anim = sprite->get_previa_animacao();
	const int q = CLAMP(sprite->get_previa_quadro(), 0, anim->frames.size() - 1);
	info->set_text(vformat(U("%s · quadro %d de %d · %d/60 s"), anim->name, q + 1, anim->frames.size(), anim->frames[q].ticks));
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
	f["durationTicks"] = CLAMP(anim->frames[q].ticks + p_passo, 1, 255);
	_aplicar_dados(personagem, dados);
	_registrar(U("Tempo do quadro"), before, dados, true);
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

	info = memnew(Label);
	info->set_vertical_alignment(VERTICAL_ALIGNMENT_CENTER);
	barra->add_child(info);

	barra->connect(SceneStringName(theme_changed), callable_mp(this, &RetroSpriteCanvasPlugin::_atualizar_icones));
	add_control_to_container(CONTAINER_CANVAS_EDITOR_MENU, barra);
}
