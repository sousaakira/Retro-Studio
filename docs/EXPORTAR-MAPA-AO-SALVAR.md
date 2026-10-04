# Exportar recursos ao salvar um mapa

Projetos podem declarar um exportador Python em `retro-studio.json`. O Retro Studio chama esse script depois de gravar um mapa TMX listado em `mapExport.sourceMaps`.

```json
{
  "mapExport": {
    "script": "tools/export-playable-map.py",
    "sourceMaps": ["maps/active-room.tmx"]
  }
}
```

O exportador roda com `python3` (ou `python` no Windows), com o diretório do projeto como CWD e um conjunto restrito de variáveis de ambiente, sem repassar tokens do Retro Studio. O Retro Studio não usa shell, aceita apenas scripts `.py` contidos dentro do workspace e não executa o exportador para mapas fora da lista. Há limite de 30 segundos. Projetos sem `mapExport` continuam salvando TMX normalmente.

Se a exportação falhar, o mapa permanece salvo e o editor mostra um erro separado. Quando funciona, a confirmação informa que os recursos do jogo também foram atualizados.

Alice configura `tools/export-playable-map.py` para as três salas ativas. A exportação ainda acontece no build como dependência do Makefile, para cobrir alterações feitas fora do editor.
