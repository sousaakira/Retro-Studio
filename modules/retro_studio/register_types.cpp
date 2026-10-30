#include "register_types.h"

#include "audio/audio_stream_vgm.h"
#include "editor/retro_image_convert.h"
#include "editor/retro_palette_dock.h"
#include "editor/retro_sgdk_plugin.h"
#include "scene/md_nodes.h"

#include "core/io/resource_loader.h"
#include "core/object/class_db.h"
#include "editor/plugins/editor_plugin.h"

static Ref<ResourceFormatLoaderVGM> vgm_loader;

void initialize_retro_studio_module(ModuleInitializationLevel p_level) {
	if (p_level == MODULE_INITIALIZATION_LEVEL_SCENE) {
		GDREGISTER_CLASS(AudioStreamVGM);
		GDREGISTER_INTERNAL_CLASS(AudioStreamPlaybackVGM);
		vgm_loader.instantiate();
		ResourceLoader::add_resource_format_loader(vgm_loader);

		GDREGISTER_CLASS(MDCena);
		GDREGISTER_CLASS(MDFundo);
		GDREGISTER_CLASS(MDSprite);
		GDREGISTER_CLASS(MDJogador);
		GDREGISTER_CLASS(MDTexto);
		GDREGISTER_CLASS(MDMapa);
		GDREGISTER_CLASS(MDInimigo);
		GDREGISTER_CLASS(MDSaida);
		GDREGISTER_CLASS(MDItem);
	}
	if (p_level == MODULE_INITIALIZATION_LEVEL_EDITOR) {
		GDREGISTER_INTERNAL_CLASS(RetroPaletteDock);
		GDREGISTER_INTERNAL_CLASS(RetroImageMenu);
		EditorPlugins::add_by_type<RetroSgdkPlugin>();
	}
}

void uninitialize_retro_studio_module(ModuleInitializationLevel p_level) {
	if (p_level == MODULE_INITIALIZATION_LEVEL_SCENE && vgm_loader.is_valid()) {
		ResourceLoader::remove_resource_format_loader(vgm_loader);
		vgm_loader.unref();
	}
}
