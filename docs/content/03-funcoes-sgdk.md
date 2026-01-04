---
title: Funções SGDK Essenciais
icon: fas fa-code
---

# Funções SGDK Essenciais

Aqui estão algumas das funções mais utilizadas do SGDK com exemplos de uso.

## Sistema Principal

@ref VDP_init
Inicializa o sistema de vídeo com configurações padrão.
Deve ser chamada no início do programa.
@return void
@example
#include <genesis.h>

int main() {
    VDP_init();           // Inicializa com configurações padrão
    VDP_setScreenWidth320();  // Configura largura para 320px
    VDP_setScreenHeight224(); // Configura altura para 224px (NTSC)
    
    return 0;
}
@end

@ref SYS_getFPS
Retorna os frames por segundo (FPS) atual do sistema.
@return u16
@example
u16 fps = SYS_getFPS();
VDP_drawText("FPS: ", 1, 1);
@end

## Manipulação de Sprites

@ref SPR_init
Inicializa o sistema de sprites.
Deve ser chamado antes de usar qualquer função de sprites.
@return void
@example
SPR_init();
@end

@ref SPR_addSprite
Adiciona um novo sprite na tela com posição inicial definida.
@return Sprite*
@example
Sprite* player = SPR_addSprite(&player_sprite, 160, 120, NULL);
if (!player) {
    VDP_drawText("Erro ao criar sprite!", 5, 5);
}
@end

@ref SPR_setPosition
Define a posição do sprite na tela.
@return void
@example
// Atualizar posição do sprite a cada frame
u16 x = 160;
u16 y = 120;
SPR_setPosition(player, x, y);
@end

@ref SPR_setFrame
Define o frame de animação atual do sprite.
@return void
@example
SPR_setFrame(player, currentFrame);
@end

## Manipulação de Paletas

@ref PAL_setPalette
Carrega uma paleta de cores em uma das 4 paletas disponíveis.
Paletas disponíveis: PAL0, PAL1, PAL2, PAL3
@return void
@example
PAL_setPalette(PAL0, my_palette.data, CPU);
@end

@ref PAL_setColor
Define uma cor específica em uma paleta.
@return void
@example
PAL_setColor(PAL0, 1, 0xFF00FF);
@end

## Funções de Matemática Fixa (Fix16)

@ref F16_frac
Retorna a parte fracionária de um número em ponto fixo.
Útil para cálculos de posição com precisão.
@return fix16
@example
fix16 frac = F16_frac(myFixedNumber);
@end

@ref F16_int
Retorna apenas a parte inteira de um número em ponto fixo.
@return s16
@example
s16 intPart = F16_int(myFixedNumber);
@end

@ref F16_mul
Multiplica dois números em ponto fixo com precisão.
@return fix16
@example
fix16 result = F16_mul(a, b);
@end

## Funções de Entrada

@ref JOY_readJoypad
Lê o estado do controle/teclado.
Retorna uma máscara com os botões pressionados.
@return u16
@example
while(1) {
    u16 input = JOY_readJoypad(JOY_1);
    if (input & BUTTON_UP) {
        y--;
    }
    if (input & BUTTON_DOWN) {
        y++;
    }
    VDP_waitVSync();
}
@end

## Funções de Texto

@ref VDP_drawText
Desenha texto na tela em uma posição específica.
Coordenadas em caracteres (não em pixels).
@return void
@example
VDP_drawText("Score: 1000", 10, 5);
@end

@ref VDP_clearText
Limpa a área de texto especificada.
@return void
@example
VDP_clearText(0, 0, 40, 28);
@end

---

**Dica:** Consulte a documentação oficial do SGDK para uma lista completa de funções e suas variações.
