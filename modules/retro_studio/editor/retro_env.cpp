#include "retro_env.h"

#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/os/mutex.h"
#include "core/os/os.h"
#include "core/templates/hash_set.h"
#include "editor/settings/editor_settings.h"

// Aberto pelo menu do sistema, o editor não herda o PATH do terminal: o que o asdf, o nvm, o mise
// ou o npm global acrescentam no .zshrc/.bashrc fica de fora e o make não acha o node. Como o
// Retro Studio atual (electron/shellPath.js): pergunta o PATH ao shell de login interativo do
// usuário (até 5 s) e junta as pastas conhecidas, sem repetir e sem pastas inexistentes.
String retro_home() {
#ifdef WINDOWS_ENABLED
	return OS::get_singleton()->get_environment("USERPROFILE").replace("\\", "/");
#else
	return OS::get_singleton()->get_environment("HOME");
#endif
}

String retro_default_gdk() {
#ifdef WINDOWS_ENABLED
	// Igual ao instalar.ps1: com espaço ou acento na pasta do usuário, o make do SGDK não funciona e o
	// kit fica na raiz do disco.
	const String home = retro_home();
	for (int i = 0; i < home.length(); i++) {
		const char32_t c = home[i];
		if (!(is_ascii_alphanumeric_char(c) || c == '_' || c == '-' || c == '.' || c == ':' || c == '/' || c == '\\')) {
			const String drive = OS::get_singleton()->has_environment("SystemDrive") ? OS::get_singleton()->get_environment("SystemDrive") : String("C:");
			return drive + "/RetroStudio/toolkit/sgdk";
		}
	}
	return home.path_join(".retrostudio/toolkit/sgdk");
#else
	const String home_kit = retro_home().path_join(".retrostudio/toolkit/marsdev/mars/m68k-elf");
	const String app_kit = retro_app_kit_dir();
	if (!FileAccess::exists(home_kit.path_join("makefile.gen")) && !app_kit.is_empty() && FileAccess::exists(app_kit.path_join("marsdev/mars/m68k-elf/makefile.gen"))) {
		return app_kit.path_join("marsdev/mars/m68k-elf");
	}
	return home_kit;
#endif
}

String retro_default_emulator() {
#ifdef WINDOWS_ENABLED
	return retro_home().path_join(".retrostudio/emulators/blastem/blastem.exe");
#else
	const String home_emulator = retro_home().path_join(".retrostudio/emulators/blastem/blastem");
	const String app_kit = retro_app_kit_dir();
	if (!FileAccess::exists(home_emulator) && !app_kit.is_empty() && FileAccess::exists(app_kit.path_join("blastem/blastem"))) {
		return app_kit.path_join("blastem/blastem");
	}
	return home_emulator;
#endif
}

String retro_gdk_setting() {
	const String configured = EDITOR_GET("retro_studio/sgdk/gdk_path");
	if (!FileAccess::exists(configured.path_join("makefile.gen")) && configured.begins_with(retro_home().path_join(".retrostudio/"))) {
		const String fallback = retro_default_gdk();
		if (FileAccess::exists(fallback.path_join("makefile.gen"))) {
			return fallback;
		}
	}
	return configured;
}

String retro_emulator_setting() {
	const String configured = EDITOR_GET("retro_studio/emulator/path");
	if (!FileAccess::exists(configured) && configured.begins_with(retro_home().path_join(".retrostudio/"))) {
		const String fallback = retro_default_emulator();
		if (FileAccess::exists(fallback)) {
			return fallback;
		}
	}
	return configured;
}

String retro_system_package_note() {
	const String kit = retro_app_kit_dir();
	if (kit.is_empty()) {
		return String();
	}
	const String marker = kit.get_base_dir().path_join("pacote-do-sistema.txt");
	if (!FileAccess::exists(marker)) {
		return String();
	}
	const String text = FileAccess::get_file_as_string(marker).strip_edges();
	return text.is_empty() ? String::utf8("O Retro Studio foi instalado pelo gerenciador de pacotes do sistema.") : text;
}

String retro_path_separator() {
#ifdef WINDOWS_ENABLED
	return ";";
#else
	return ":";
#endif
}

String retro_user_path() {
	// Lido na primeira vez (compilação na thread de build ou agente de IA na principal).
	static Mutex mutex;
	MutexLock lock(mutex);
	static String cached;
	if (!cached.is_empty()) {
		return cached;
	}
#ifdef WINDOWS_ENABLED
	// No Windows, programas abertos pelo menu já recebem o PATH completo do usuário.
	cached = OS::get_singleton()->get_environment("PATH");
	return cached;
#endif
	const String mark = "__RETRO_STUDIO_PATH__";
	String shell_path;
	const String shell = OS::get_singleton()->has_environment("SHELL") ? OS::get_singleton()->get_environment("SHELL") : String("/bin/bash");
	if (FileAccess::exists("/usr/bin/timeout") && FileAccess::exists(shell)) {
		List<String> args;
		args.push_back("TERM=dumb");
		args.push_back("/usr/bin/timeout");
		args.push_back("5");
		args.push_back(shell);
		args.push_back("-ilc");
		args.push_back(shell.get_file() == "fish" ? "printf '%s' " + mark + "; string join : $PATH; printf '%s' " + mark : "printf '%s%s%s' " + mark + " \"$PATH\" " + mark);
		String output;
		OS::get_singleton()->execute("/usr/bin/env", args, &output);
		const Vector<String> parts = output.split(mark);
		if (parts.size() >= 3) {
			shell_path = parts[1].strip_edges();
		}
	}
	const String user_home = OS::get_singleton()->get_environment("HOME");
	Vector<String> known;
	known.push_back(user_home.path_join(".asdf/shims"));
	known.push_back(user_home.path_join(".local/share/mise/shims"));
	known.push_back(user_home.path_join(".volta/bin"));
	known.push_back(user_home.path_join(".npm-global/bin"));
	known.push_back(user_home.path_join(".local/bin"));
	known.push_back(user_home.path_join(".bun/bin"));
	known.push_back("/usr/local/bin");
	// nvm: a versão mais nova instalada.
	Ref<DirAccess> nvm = DirAccess::open(user_home.path_join(".nvm/versions/node"));
	if (nvm.is_valid()) {
		PackedStringArray versions = nvm->get_directories();
		if (!versions.is_empty()) {
			versions.sort_custom<FileNoCaseComparator>();
			known.push_back(user_home.path_join(".nvm/versions/node").path_join(versions[versions.size() - 1]).path_join("bin"));
		}
	}
	HashSet<String> seen;
	Vector<String> merged;
	const String lists = OS::get_singleton()->get_environment("PATH") + ":" + shell_path + ":" + String(":").join(known);
	for (const String &dir : lists.split(":", false)) {
		const String clean = dir.strip_edges();
		if (!clean.is_empty() && !seen.has(clean) && DirAccess::exists(clean)) {
			seen.insert(clean);
			merged.push_back(clean);
		}
	}
	cached = String(":").join(merged);
	return cached;
}

String retro_find_executable(const String &p_name) {
	if (p_name.is_absolute_path()) {
		return FileAccess::exists(p_name) ? p_name : String();
	}
	return retro_find_in_path(p_name, retro_user_path());
	return String();
}

// Nomes que um programa pode ter no disco: no Windows, com .exe (ou .cmd/.bat, dos instaladores do npm).
static Vector<String> _program_names(const String &p_name) {
	Vector<String> names;
#ifdef WINDOWS_ENABLED
	if (p_name.get_extension().is_empty()) {
		names.push_back(p_name + ".exe");
		names.push_back(p_name + ".cmd");
		names.push_back(p_name + ".bat");
	}
#endif
	names.push_back(p_name);
	return names;
}

String retro_app_kit_dir() {
	const String exe_dir = OS::get_singleton()->get_executable_path().get_base_dir();
	for (const String &dir : { exe_dir.path_join("kit"), exe_dir.get_base_dir().path_join("kit") }) {
		if (DirAccess::exists(dir.path_join("jre")) || DirAccess::exists(dir.path_join("bin"))) {
			return dir;
		}
	}
	return String();
}

String retro_installer_path() {
	if (!retro_system_package_note().is_empty()) {
		return String(); // Pacote do sistema: quem instala e conserta é o gerenciador de pacotes.
	}
	const String exe_dir = OS::get_singleton()->get_executable_path().get_base_dir();
#ifdef WINDOWS_ENABLED
	const String installer = "instalar.ps1";
#else
	const String installer = "instalar.sh";
#endif
	for (const String &path : { exe_dir.path_join(installer), exe_dir.get_base_dir().path_join(installer) }) {
		if (FileAccess::exists(path)) {
			return path;
		}
	}
	return String();
}

String retro_build_path(const String &p_gdk) {
	Vector<String> dirs;
	dirs.push_back(p_gdk.path_join("bin"));
	const String kit = retro_app_kit_dir();
	if (!kit.is_empty()) {
		dirs.push_back(kit.path_join("jre/bin"));
		dirs.push_back(kit.path_join("bin"));
	}
	dirs.push_back(retro_user_path());
	return retro_path_separator().join(dirs);
}

String retro_find_in_path(const String &p_name, const String &p_path) {
	if (p_name.is_absolute_path()) {
		return FileAccess::exists(p_name) ? p_name : String();
	}
	const Vector<String> names = _program_names(p_name);
	for (const String &dir : p_path.split(retro_path_separator(), false)) {
		const String clean = dir.strip_edges().replace("\\", "/");
		for (const String &name : names) {
			const String candidate = clean.path_join(name);
			if (!clean.is_empty() && FileAccess::exists(candidate)) {
				return candidate;
			}
		}
	}
	return String();
}

Vector<String> retro_missing_libraries(const String &p_executable) {
	Vector<String> missing;
#ifdef WINDOWS_ENABLED
	// No Windows o pacote traz as DLLs junto de cada programa.
	return missing;
#endif
	if (!FileAccess::exists(p_executable)) {
		return missing;
	}
	List<String> args;
	args.push_back(p_executable);
	String output;
	if (OS::get_singleton()->execute("ldd", args, &output, nullptr, true) != OK) {
		return missing;
	}
	for (const String &line : output.split("\n", false)) {
		if (line.contains("not found")) {
			const String library = line.strip_edges().get_slicec(' ', 0);
			if (!library.is_empty() && !missing.has(library)) {
				missing.push_back(library);
			}
		}
	}
	return missing;
}

String retro_resolve_emulator(const String &p_configured, Vector<String> &r_missing, String &r_note) {
	r_missing.clear();
	r_note = String();
	if (!FileAccess::exists(p_configured)) {
		return String();
	}
	r_missing = retro_missing_libraries(p_configured);
	if (r_missing.is_empty()) {
		return p_configured;
	}
	// O BlastEm baixado traz, em old/, a versão oficial com a SDL2 dela e a GLEW embutida.
	const String official = p_configured.get_base_dir().path_join("old").path_join(p_configured.get_file());
	if (FileAccess::exists(official) && retro_missing_libraries(official).is_empty()) {
		r_note = String::utf8("Usando o BlastEm oficial (") + official + String::utf8("): o configurado precisa de ") + String(", ").join(r_missing) + String::utf8(", que não estão no sistema.");
		return official;
	}
	return String();
}

Vector<String> retro_dependencies_for_libraries(const Vector<String> &p_libraries) {
	Vector<String> deps;
	for (const String &library : p_libraries) {
		const String dep = library.begins_with("libSDL2") ? "sdl2" : library.begins_with("libGLEW") ? "glew" : String();
		if (!dep.is_empty() && !deps.has(dep)) {
			deps.push_back(dep);
		}
	}
	return deps;
}

String retro_install_command(const Vector<String> &p_dependencies) {
#ifdef WINDOWS_ENABLED
	return String();
#endif
	String manager;
	for (const char *candidate : { "apt-get", "dnf", "zypper", "pacman" }) {
		if (FileAccess::exists(String("/usr/bin/").path_join(candidate)) || FileAccess::exists(String("/bin/").path_join(candidate))) {
			manager = candidate;
			break;
		}
	}
	Vector<String> names;
	for (const String &dep : p_dependencies) {
		String name = dep;
		if (manager == "apt-get") {
			name = dep == "java" ? "default-jre-headless" : dep == "sdl2" ? "libsdl2-2.0-0" : dep == "glew" ? "libglew2.2" : dep;
		} else if (manager == "dnf") {
			name = dep == "java" ? "java-21-openjdk-headless" : dep == "sdl2" ? "SDL2" : dep;
		} else if (manager == "zypper") {
			name = dep == "java" ? "java-21-openjdk-headless" : dep == "sdl2" ? "libSDL2-2_0-0" : dep == "glew" ? "libGLEW2_2" : dep;
		} else if (manager == "pacman") {
			name = dep == "java" ? "jre-openjdk-headless" : dep;
		}
		names.push_back(name);
	}
	const String list = String(" ").join(names);
	if (manager == "apt-get") {
		return "sudo apt install " + list;
	} else if (manager == "dnf") {
		return "sudo dnf install " + list;
	} else if (manager == "zypper") {
		return "sudo zypper install " + list;
	} else if (manager == "pacman") {
		return "sudo pacman -S " + list;
	}
	return list;
}

String retro_gdk_gcc(const String &p_gdk) {
#ifdef WINDOWS_ENABLED
	return p_gdk.path_join("bin/gcc.exe"); // SGDK para Windows: ferramentas sem prefixo.
#else
	return p_gdk.path_join("bin/m68k-elf-gcc");
#endif
}

// Caminho com a pasta pessoal como ~ (mensagens mais curtas).
static String _curto(const String &p_path) {
	const String home = retro_home();
	return !home.is_empty() && p_path.begins_with(home + "/") ? "~" + p_path.substr(home.length()) : p_path;
}

Vector<String> retro_check_environment(const String &p_gdk, const String &p_emulator, Vector<String> &r_dependencies) {
	Vector<String> problems;
	r_dependencies.clear();
	const String gcc = retro_gdk_gcc(p_gdk);
	if (!FileAccess::exists(p_gdk.path_join("makefile.gen")) || !FileAccess::exists(gcc)) {
		problems.push_back(String::utf8("O kit SGDK/MarsDev não está em ") + _curto(p_gdk) + String::utf8(" (ou está incompleto)."));
	} else if (!retro_missing_libraries(gcc).is_empty()) {
		problems.push_back(String::utf8("O compilador do kit (m68k-elf-gcc) não roda nesta máquina: faltam bibliotecas do sistema."));
	}
	const String path = retro_build_path(p_gdk);
	if (retro_find_in_path("make", path).is_empty()) {
		problems.push_back(String::utf8("Falta o make (roda a compilação do SGDK)."));
		r_dependencies.push_back("make");
	}
	if (retro_find_in_path("java", path).is_empty()) {
		problems.push_back(String::utf8("Falta o Java (o SGDK usa para converter imagens e sons)."));
		r_dependencies.push_back("java");
	}
	if (!FileAccess::exists(p_emulator)) {
		problems.push_back(String::utf8("O emulador não está em ") + _curto(p_emulator) + ".");
	} else {
		Vector<String> missing;
		String note;
		if (retro_resolve_emulator(p_emulator, missing, note).is_empty()) {
			problems.push_back(String::utf8("O emulador não abre: faltam bibliotecas do sistema (") + String(", ").join(missing) + ").");
			for (const String &dep : retro_dependencies_for_libraries(missing)) {
				if (!r_dependencies.has(dep)) {
					r_dependencies.push_back(dep);
				}
			}
		}
	}
	return problems;
}

String retro_blastem_config_dir(const String &p_emulator, String &r_variable) {
	if (!p_emulator.get_file().to_lower().begins_with("blastem")) {
		return String();
	}
	OS *os = OS::get_singleton();
#ifdef WINDOWS_ENABLED
	r_variable = "LOCALAPPDATA";
	const String user_dir = os->get_environment("LOCALAPPDATA").replace("\\", "/");
#else
	r_variable = "XDG_CONFIG_HOME";
	const String xdg = os->get_environment("XDG_CONFIG_HOME");
	const String user_dir = xdg.is_empty() ? retro_home() + "/.config" : xdg;
#endif
	const String base = retro_home() + "/.retrostudio/blastem-config";
	const String file = base + "/blastem/blastem.cfg";
	String text;
	if (FileAccess::exists(file)) {
		text = FileAccess::get_file_as_string(file);
	} else {
		const String sources[] = { user_dir + "/blastem/blastem.cfg", p_emulator.get_base_dir() + "/default.cfg" };
		for (const String &source : sources) {
			if (FileAccess::exists(source)) {
				text = FileAccess::get_file_as_string(source);
				break;
			}
		}
	}
	if (text.is_empty()) {
		return String();
	}
	// "scaling linear" (o padrão) suaviza a imagem; "nearest" mostra os pixels como o console.
	Vector<String> lines = text.split("\n");
	bool found = false, changed = false;
	for (int i = 0; i < lines.size(); i++) {
		const String stripped = lines[i].strip_edges();
		if (stripped.begins_with("scaling ") || stripped.begins_with("scaling\t")) {
			found = true;
			if (stripped.get_slice_count(" ") < 2 || stripped.substr(7).strip_edges() != "nearest") {
				lines.write[i] = lines[i].substr(0, lines[i].find("scaling")) + "scaling nearest";
				changed = true;
			}
		}
	}
	if (!found) {
		return String(); // Formato desconhecido: melhor não mexer.
	}
	if (changed || !FileAccess::exists(file)) {
		if (DirAccess::make_dir_recursive_absolute(file.get_base_dir()) != OK) {
			return String();
		}
		Ref<FileAccess> out = FileAccess::open(file, FileAccess::WRITE);
		if (out.is_null()) {
			return String();
		}
		out->store_string(String("\n").join(lines));
	}
	return base;
}
