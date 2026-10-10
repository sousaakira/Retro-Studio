#ifndef RETRO_STUDIO_HUD_H
#define RETRO_STUDIO_HUD_H
#include "retro_core.h"
#define RETRO_RUNTIME_HUD_VERSION 1
/* HUD, menus and dialogue box in portable C (no SGDK): which glyph goes in which
 * cell of the screen. The adapter (retro_hud_sgdk.h) writes the cells to a plane
 * and positions the sprite elements. Tables come from src/generated/hud_config.h.
 *
 * Two regions of 8x8 cells: the HUD (always there) and the overlay (a menu or a
 * dialogue, one at a time). Every cell holds a glyph of the font or RETRO_HUD_CLEAR
 * (nothing drawn: the game shows through). Game values reach the screen only
 * through RetroHudHost.value; ids never appear on screen. */
#define RETRO_HUD_CLEAR 0xFEu
#define RETRO_HUD_UNKNOWN 0xFFu /* cell whose content on screen is not known yet */
#define RETRO_HUD_MAX_ELEMENTS 32
enum {RETRO_HUD_TEXT=0,RETRO_HUD_NUMBER=1,RETRO_HUD_BAR=2,RETRO_HUD_ICONS=3};
enum {RETRO_HUD_NONE=0,RETRO_HUD_MENU=1,RETRO_HUD_DIALOGUE=2};
enum {RETRO_HUD_UP=1,RETRO_HUD_DOWN=2,RETRO_HUD_CONFIRM=4,RETRO_HUD_CANCEL=8};
typedef struct {uint16_t point;uint8_t glyph;} RetroHudGlyph; /* sorted by code point */
typedef struct {const uint8_t *glyphs;uint8_t length;} RetroHudText;
typedef struct {
 uint8_t type,sprite;
 int16_t x,y;            /* cells inside the HUD region, or screen pixels for a sprite element */
 uint8_t width,value;    /* cells; index of the game value */
 uint8_t first,second;   /* number: padding glyph; bar/icons: full and empty glyphs */
 const uint8_t *text;    /* RETRO_HUD_TEXT: width glyphs */
 uint32_t maximum;       /* bar: value that fills it; icons: how many icons */
} RetroHudElement;
typedef struct {
 uint8_t col,row,width;  /* inside the overlay region */
 RetroHudText title;const RetroHudText *items;uint8_t itemCount,cursor;
} RetroHudMenu;
typedef struct {uint8_t col,row,width,height;} RetroHudRegion; /* screen cells */
typedef struct {uint8_t enabled,col,row,width,lines,speaker,cursor;} RetroHudDialogue;
typedef struct {uint8_t bottom,rows;} RetroHudBand; /* window plane: rows from the top or the bottom */
typedef struct {
 const RetroHudElement *elements;uint8_t elementCount;
 const RetroHudMenu *menus;uint8_t menuCount;
 const RetroHudGlyph *glyphs;uint8_t glyphCount,space;
 RetroHudRegion hud,overlay;
 RetroHudDialogue dialogue;
 RetroHudBand hudBand,overlayBand;
 uint8_t valueCount;
} RetroHudDefinition;
typedef struct {
 /* Current value of a game quantity (RETRO_HUD_VALUE_*). NULL shows zero. */
 uint32_t (*value)(void *context,uint16_t id);
 /* The player confirmed an item / left the menu. The menu stays open until the
  * game closes it. Either may be NULL. */
 void (*select)(void *context,uint16_t menu,uint16_t item);
 void (*cancel)(void *context,uint16_t menu);
 void *context;
} RetroHudHost;
typedef struct {
 const RetroHudDefinition *definition;RetroHudHost host;
 uint8_t *want,*shown;               /* HUD region */
 uint8_t *overlayWant,*overlayShown; /* overlay region */
 uint16_t cursorHud,cursorOverlay;   /* where the next search for a changed cell starts */
 uint8_t overlay,menu,item;          /* RETRO_HUD_NONE/MENU/DIALOGUE, open menu, highlighted item */
 uint8_t closing;                    /* overlay cells being erased */
 uint8_t overlayRow,overlayRows;     /* screen rows of the menu/dialogue shown last */
 uint8_t dirtyHud,dirtyOverlay;      /* some cell may differ from the screen: worth scanning */
 uint8_t fresh;                      /* values not read yet */
 uint8_t digits[10];                 /* glyphs of '0'..'9', found once */
 uint32_t lastValue[RETRO_HUD_MAX_ELEMENTS]; /* value each element shows */
 uint32_t changed;                   /* bit n: element n changed since the adapter last looked */
 uint8_t ready;
} RetroHud;
typedef struct {uint8_t col,row,glyph,overlay;} RetroHudWrite; /* screen cell */
/* cells: 2 * hud.width * hud.height bytes; overlayCells: 2 * overlay.width * overlay.height
 * (NULL when the overlay region is empty). host may be NULL. Returns 0 on bad tables. */
uint8_t retroHudInit(RetroHud *hud,const RetroHudDefinition *definition,const RetroHudHost *host,uint8_t *cells,uint8_t *overlayCells);
/* Once per frame: reads the game values and decides what the HUD cells must show.
 * An element is recomputed only when its value changed; with nothing changed and
 * the screen up to date, a frame costs one callback per value element and no scan. */
void retroHudTick(RetroHud *hud);
/* Glyphs of one element for the value read by the last tick (element->width of them). */
void retroHudElementGlyphs(const RetroHud *hud,uint16_t element,uint8_t *out);
uint8_t retroHudMenuOpen(RetroHud *hud,uint16_t menu);
/* pressed: RETRO_HUD_UP/DOWN/CONFIRM/CANCEL just pressed this frame. */
void retroHudMenuInput(RetroHud *hud,uint8_t pressed);
/* Dialogue box: UTF-8 text; a character the font lacks shows as '?' (or a space
 * when the font has no '?'). count lines beyond the box are not shown. */
uint8_t retroHudDialogueShow(RetroHud *hud,const char *speaker,const char *const *lines,uint8_t count);
/* Options below an optional prompt, with the cursor on `selected`. With more options
 * than lines the list scrolls so that the selected one is always visible. */
uint8_t retroHudChoiceShow(RetroHud *hud,const char *prompt,const char *const *options,uint8_t count,uint8_t selected);
/* Closes the menu or dialogue: its cells are erased and the HUD under it redrawn. */
void retroHudOverlayHide(RetroHud *hud);
/* 1 while a menu/dialogue is open or still being erased. overlayRow/overlayRows then
 * tell which screen rows it uses (a window plane only needs to cover those). */
uint8_t retroHudOverlayVisible(const RetroHud *hud);
/* Next cell whose content changed; 0 when the screen is up to date. Call it up to
 * the number of cells the frame can afford. */
uint8_t retroHudNext(RetroHud *hud,RetroHudWrite *write);
/* The plane was cleared behind the HUD's back (room change): draw everything again. */
void retroHudInvalidate(RetroHud *hud);
/* Scenery planes (BG_A/BG_B): cells the HUD does not use are taken as already empty,
 * so starting the HUD does not erase what the game drew around its elements. */
void retroHudAssumeClear(RetroHud *hud);
#endif
