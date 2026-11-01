# Retro Studio: ferramentas do editor para criar jogos de Mega Drive (SGDK) com cenas do Godot.


def can_build(env, platform):
    return env.editor_build


def configure(env):
    pass


# Documentação das classes (doc_classes/*.xml): aparece no editor ao passar o mouse nas propriedades do
# Inspetor, no diálogo de criar node e na ajuda (F1).
def get_doc_classes():
    return [
        "AudioStreamVGM",
        "MDPersonagem",
        "MDCena",
        "MDFundo",
        "MDSprite",
        "MDJogador",
        "MDTexto",
        "MDMapa",
        "MDInimigo",
        "MDSaida",
        "MDItem",
        "MDAtor",
        "MDPlataforma",
        "MDRetorno",
        "MDColisao",
        "MDPrioridade",
        "MDCorrenteza",
        "MDCamera",
        "MDZonaCamera",
    ]


def get_doc_path():
    return "doc_classes"
