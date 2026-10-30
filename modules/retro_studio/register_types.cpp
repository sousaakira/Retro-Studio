#include "register_types.h"

#include "editor/retro_palette_dock.h"
#include "editor/retro_sgdk_plugin.h"
#include "scene/md_nodes.h"

#include "core/object/class_db.h"
#include "editor/plugins/editor_plugin.h"

void initialize_retro_studio_module(ModuleInitializationLevel p_level) {
	if (p_level == MODULE_INITIALIZATION_LEVEL_SCENE) {
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
		EditorPlugins::add_by_type<RetroSgdkPlugin>();
	}
}

void uninitialize_retro_studio_module(ModuleInitializationLevel p_level) {
}
