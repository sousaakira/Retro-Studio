#pragma once

// Git embutido no painel de controle de versão do Godot (Projeto → Controle de Versão).
// Implementa o EditorVCSInterface chamando o comando `git` do sistema, como as Versões para teste:
// nada de libgit2 nem de extensão por projeto. O push e o pull usam as credenciais que o Git
// do usuário já tem (gerenciador de credenciais, agente SSH); usuário/senha e chave SSH digitados
// no painel valem só para a sessão e nunca são gravados.

#include "editor/version_control/editor_vcs_interface.h"

class RetroGit : public EditorVCSInterface {
	GDCLASS(RetroGit, EditorVCSInterface)

	String project_dir; // Pasta do projeto (res://), absoluta e sem barra no fim.
	String prefix; // Caminho do projeto dentro do repositório ("" quando o projeto é a raiz).

	String username;
	String password;
	String ssh_private_key;

	struct Result {
		bool ok = false;
		int code = -1;
		String output;
	};

	Result _run(const Vector<String> &p_args, bool p_stderr = false, bool p_network = false) const;
	String _capture(const Vector<String> &p_args) const;
	bool _run_or_warn(const Vector<String> &p_args, bool p_network = false);
	bool _has_head() const;
	String _relative(const String &p_repo_path) const;
	TypedArray<Dictionary> _parse_diff(const String &p_text);
	Dictionary _new_file_diff(const String &p_path);

protected:
	static void _bind_methods() {}

public:
	bool initialize(const String &p_project_path) override;
	void set_credentials(const String &p_username, const String &p_password, const String &p_ssh_public_key_path, const String &p_ssh_private_key_path, const String &p_ssh_passphrase) override;
	List<StatusFile> get_modified_files_data() override;
	void stage_file(const String &p_file_path) override;
	void unstage_file(const String &p_file_path) override;
	void discard_file(const String &p_file_path) override;
	void commit(const String &p_msg, bool p_amend) override;
	bool allow_amends() override { return true; }
	List<DiffFile> get_diff(const String &p_identifier, TreeArea p_area) override;
	bool shut_down() override { return true; }
	String get_vcs_name() override { return "Git"; }
	List<Commit> get_previous_commits(int p_max_commits) override;
	List<String> get_branch_list() override;
	List<String> get_remotes() override;
	void create_branch(const String &p_branch_name) override;
	void remove_branch(const String &p_branch_name) override;
	void create_remote(const String &p_remote_name, const String &p_remote_url) override;
	void remove_remote(const String &p_remote_name) override;
	String get_current_branch_name() override;
	bool checkout_branch(const String &p_branch_name) override;
	void pull(const String &p_remote) override;
	void push(const String &p_remote, bool p_force) override;
	void fetch(const String &p_remote) override;
	List<DiffHunk> get_line_diff(const String &p_file_path, const String &p_text) override { return {}; }
};
