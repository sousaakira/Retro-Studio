# Controles e ações — issue #53

Abra **Recursos → Runtime → Configurar controles**. Selecione o jogador, o tipo
de controle e cada movimento. A combinação exige todos os botões; a alternativa
também ativa a ação. “Bloquear com” suprime a ação quando a combinação indicada
estiver mantida. O preset de três botões usa DOWN+C para transformar e bloqueia
dash durante DOWN; o preset de seis botões usa X para transformar e Y para interagir.

A prévia avança por quadros manualmente: clique para manter/soltar botões e use
Avançar quadro para observar pressionado, mantido, solto e buffer. Consumir remove
uma entrada pendente uma única vez. O buffer inclui o quadro inicial; zero dura
somente esse quadro. Valores são quadros de vídeo, portanto têm durações diferentes
em PAL e NTSC. Nenhuma compensação temporal é aplicada automaticamente.

Ctrl/Cmd+S salva os controles dentro do diálogo; atalhos do editor ao fundo
não recebem os eventos deste diálogo.

Salvar exporta juntos:
- controls/input-map.json: configuração de autoria versionada, dois jogadores.
- src/generated/input_map.h: mapas físicos compilados para ações C.
- .retrostudio/input-export.json: hash da saída para proteger alterações manuais.

O processo recusa revisão desatualizada e header customizado/sem propriedade.
Não modifica main.c, física, cenas ou adapter/capabilities de jogos existentes.
Instalar a biblioteca não significa que o jogo já consome o mapeamento.

## Integração SGDK
Instale o módulo input (depende de core) pelo painel Runtime. Projetos novos
recebem ambos. Inclua generated/input_map.h e retro_runtime/retro_sgdk_input.h,
inicialize um RetroActions com zeros por jogador e chame uma vez por quadro:

```c
retroSgdkActionsPoll(&players[0], &retroProjectInputMaps[0],
                    JOY_1, retroProjectInputMasks[0]);
if (retroActionConsume(&players[0], RETRO_ACTION_JUMP)) { /* iniciar pulo */ }
```

Faça a leitura após o processamento normal do VBlank SGDK. O adaptador limita
botões ao tipo PAD3/PAD6 detectado pelo SDK e ao controle configurado. Outros
periféricos liberam ações mantidas e zeram buffers pendentes. SGDK 1.81 detecta tipos no JOY_init/reset;
o módulo não implementa detecção de troca de controle em tempo real.

Máscaras não suportadas nunca se degradam em combos menores. Mover em direções
opostas produz eixo neutro. Trocar alternativas enquanto a ação segue ativa não
gera outro pressionamento. Cada jogador mantém seu próprio estado/buffer.
As APIs de entrada não dão prioridade automática entre ações arbitrárias;
configure “Bloquear com” quando duas ações compartilham botões.

## Verificação
A suíte compara um traço de dois jogadores da prévia JavaScript com o C compilado
usando o header exportado. Testes adicionais cobrem buffers/consumo, combos,
controle incompatível, revisão concorrente e proteção de saída personalizada.

Build opcional de uma ROM original de diagnóstico, em diretório temporário:
```sh
node scripts/smoke-input-mapping.mjs --sgdk /caminho/para/mars/m68k-elf
```
Passou no SGDK 1.81/MarsDev instalado (ROM de 655360 bytes). Isso comprova o
build/link, ainda não substitui inspeção em emulador/hardware. A fixture é
assets/toolkit/fixtures/runtime-input-sgdk.c; não contém assets recuperados de ROM.

Regras compartilhadas ficam em shared/retro/inputMapping.js e são distribuídas
com a IDE; frontend preserva a API via reexport. Verificação visual do diálogo
ainda pendente (o plugin Browser da sessão não iniciou).
