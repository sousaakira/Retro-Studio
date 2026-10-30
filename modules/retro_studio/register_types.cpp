#include "register_types.h"

#include "editor/retro_sgdk_plugin.h"

#include "editor/plugins/editor_plugin.h"

void initialize_retro_studio_module(ModuleInitializationLevel p_level) {
	if (p_level == MODULE_INITIALIZATION_LEVEL_EDITOR) {
		EditorPlugins::add_by_type<RetroSgdkPlugin>();
	}
}

void uninitialize_retro_studio_module(ModuleInitializationLevel p_level) {
}
