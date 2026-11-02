#include "retro_env.h"

#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/os/mutex.h"
#include "core/os/os.h"
#include "core/templates/hash_set.h"

// Aberto pelo menu do sistema, o editor não herda o PATH do terminal: o que o asdf, o nvm, o mise
// ou o npm global acrescentam no .zshrc/.bashrc fica de fora e o make não acha o node. Como o
// Retro Studio atual (electron/shellPath.js): pergunta o PATH ao shell de login interativo do
// usuário (até 5 s) e junta as pastas conhecidas, sem repetir e sem pastas inexistentes.
String retro_user_path() {
	// Lido na primeira vez (compilação na thread de build ou agente de IA na principal).
	static Mutex mutex;
	MutexLock lock(mutex);
	static String cached;
	if (!cached.is_empty()) {
		return cached;
	}
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
	for (const String &dir : retro_user_path().split(":", false)) {
		const String candidate = dir.path_join(p_name);
		if (FileAccess::exists(candidate)) {
			return candidate;
		}
	}
	return String();
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
	const String exe_dir = OS::get_singleton()->get_executable_path().get_base_dir();
	for (const String &path : { exe_dir.path_join("instalar.sh"), exe_dir.get_base_dir().path_join("instalar.sh") }) {
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
	return String(":").join(dirs);
}

String retro_find_in_path(const String &p_name, const String &p_path) {
	for (const String &dir : p_path.split(":", false)) {
		const String candidate = dir.path_join(p_name);
		if (FileAccess::exists(candidate)) {
			return candidate;
		}
	}
	return String();
}

Vector<String> retro_missing_libraries(const String &p_executable) {
	Vector<String> missing;
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

// Caminho com a pasta pessoal como ~ (mensagens mais curtas).
static String _curto(const String &p_path) {
	const String home = OS::get_singleton()->get_environment("HOME");
	return !home.is_empty() && p_path.begins_with(home + "/") ? "~" + p_path.substr(home.length()) : p_path;
}

Vector<String> retro_check_environment(const String &p_gdk, const String &p_emulator, Vector<String> &r_dependencies) {
	Vector<String> problems;
	r_dependencies.clear();
	if (!FileAccess::exists(p_gdk.path_join("makefile.gen")) || !FileAccess::exists(p_gdk.path_join("bin/m68k-elf-gcc"))) {
		problems.push_back(String::utf8("O kit SGDK/MarsDev não está em ") + _curto(p_gdk) + String::utf8(" (ou está incompleto)."));
	} else if (!retro_missing_libraries(p_gdk.path_join("bin/m68k-elf-gcc")).is_empty()) {
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
