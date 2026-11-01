#include "register_types.h"

#include "audio/audio_stream_vgm.h"
#include "editor/retro_ai_server.h"
#include "editor/retro_animation_editor.h"
#include "editor/retro_code_plugin.h"
#include "editor/retro_syntax_highlighters.h"
#include "editor/retro_image_convert.h"
#include "editor/retro_palette_dock.h"
#include "editor/retro_sgdk_plugin.h"
#include "editor/retro_sprite_canvas.h"
#include "scene/md_letreiro.h"
#include "scene/md_nodes.h"

#include "core/io/resource_loader.h"
#include "core/object/class_db.h"
#include "editor/plugins/editor_plugin.h"

static Ref<ResourceFormatLoaderVGM> vgm_loader;
static Ref<ResourceFormatLoaderMDPersonagem> personagem_loader;

void initialize_retro_studio_module(ModuleInitializationLevel p_level) {
	if (p_level == MODULE_INITIALIZATION_LEVEL_SCENE) {
		GDREGISTER_CLASS(AudioStreamVGM);
		GDREGISTER_INTERNAL_CLASS(AudioStreamPlaybackVGM);
		vgm_loader.instantiate();
		ResourceLoader::add_resource_format_loader(vgm_loader);
		GDREGISTER_CLASS(MDPersonagem);
		// Na frente do carregador de JSON do Godot: só os .charset.json são personagens.
		personagem_loader.instantiate();
		ResourceLoader::add_resource_format_loader(personagem_loader, true);

		GDREGISTER_CLASS(MDCena);
		GDREGISTER_CLASS(MDFundo);
		GDREGISTER_CLASS(MDSprite);
		GDREGISTER_CLASS(MDJogador);
		GDREGISTER_CLASS(MDTexto);
		GDREGISTER_CLASS(MDLetreiro);
		GDREGISTER_CLASS(MDMapa);
		GDREGISTER_CLASS(MDInimigo);
		GDREGISTER_CLASS(MDSaida);
		GDREGISTER_CLASS(MDItem);
		GDREGISTER_CLASS(MDAtor);
		GDREGISTER_CLASS(MDPlataforma);
		GDREGISTER_CLASS(MDRetorno);
		GDREGISTER_CLASS(MDColisao);
		GDREGISTER_CLASS(MDPrioridade);
		GDREGISTER_CLASS(MDCorrenteza);
		GDREGISTER_CLASS(MDCamera);
		GDREGISTER_CLASS(MDZonaCamera);
	}
	if (p_level == MODULE_INITIALIZATION_LEVEL_EDITOR) {
		GDREGISTER_INTERNAL_CLASS(RetroPaletteDock);
		GDREGISTER_INTERNAL_CLASS(RetroImageMenu);
		GDREGISTER_INTERNAL_CLASS(RetroAnimationEditor);
		GDREGISTER_CLASS(RetroCSyntaxHighlighter);
		GDREGISTER_CLASS(RetroAsmSyntaxHighlighter);
		GDREGISTER_CLASS(RetroResSyntaxHighlighter);
		EditorPlugins::add_by_type<RetroSgdkPlugin>();
		EditorPlugins::add_by_type<RetroAnimationPlugin>();
		EditorPlugins::add_by_type<RetroSpriteCanvasPlugin>();
		EditorPlugins::add_by_type<RetroAiPlugin>();
		EditorPlugins::add_by_type<RetroCodePlugin>();
	}
}

void uninitialize_retro_studio_module(ModuleInitializationLevel p_level) {
	if (p_level == MODULE_INITIALIZATION_LEVEL_SCENE && vgm_loader.is_valid()) {
		ResourceLoader::remove_resource_format_loader(vgm_loader);
		vgm_loader.unref();
		ResourceLoader::remove_resource_format_loader(personagem_loader);
		personagem_loader.unref();
	}
}
