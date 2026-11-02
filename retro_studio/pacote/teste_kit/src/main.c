// Conferência do kit: uma imagem (passa pelo rescomp, em Java) e um texto na tela.
#include <genesis.h>

#include "teste.h"

int main(bool hard_reset) {
	(void) hard_reset;
	VDP_drawImage(BG_A, &imagem_teste, 0, 0);
	VDP_drawText("Retro Studio: kit OK", 2, 2);
	while (TRUE) {
		SYS_doVBlankProcess();
	}
	return 0;
}
