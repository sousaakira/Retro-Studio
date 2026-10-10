#ifndef RETRO_STUDIO_PROGRESS_H
#define RETRO_STUDIO_PROGRESS_H
#include "retro_core.h"
#define RETRO_RUNTIME_PROGRESS_VERSION 1
#define RETRO_PROGRESS_MAX_FLAGS 256
#define RETRO_PROGRESS_MAX_DATA 64
#define RETRO_PROGRESS_MAX_SLOTS 8
#define RETRO_PROGRESS_MAX_HISTORY 16
/* Every slot keeps two fixed-size copies, so layouts of any schema share offsets. */
#define RETRO_PROGRESS_COPY_BYTES 128
#define RETRO_PROGRESS_SLOT_BYTES 256
/* schema identifies the meaning of flags/data; sizes are part of the stored record. */
typedef struct {uint16_t schema,flagCount,dataSize;} RetroProgressLayout;
typedef struct {
 RetroProgressLayout layout;
 const RetroProgressLayout *history; /* older layouts this game still reads */
 uint8_t historyCount,slots;         /* slots 0 = game without persistence */
 uint16_t offset;                    /* storage byte of slot 0 */
} RetroProgressConfig;
/* Byte storage supplied by the host (SRAM, test buffer...). Both callbacks
 * return 1 on success. The module never touches hardware by itself. */
typedef struct {
 uint8_t (*read)(void *context,uint16_t offset,uint8_t *bytes,uint16_t count);
 uint8_t (*write)(void *context,uint16_t offset,const uint8_t *bytes,uint16_t count);
 void *context;uint16_t size;
} RetroProgressStorage;
/* room/checkpoint are stable IDs (RETRO_ID_NONE = none), as in RetroWorldSave. */
typedef struct {
 uint16_t room,checkpoint;
 uint8_t flags[RETRO_PROGRESS_MAX_FLAGS/8],data[RETRO_PROGRESS_MAX_DATA];
} RetroProgress;
typedef struct {
 uint32_t sequence;  /* number of saves the loaded copy has seen */
 uint16_t schema;    /* schema found in storage */
 uint8_t migrated;   /* loaded from a history layout */
 uint8_t recovered;  /* the other copy was damaged; this one was used */
} RetroProgressInfo;
enum {RETRO_PROGRESS_OK=0,RETRO_PROGRESS_EMPTY=1,RETRO_PROGRESS_CORRUPT=2,
 RETRO_PROGRESS_UNSUPPORTED=3,RETRO_PROGRESS_INVALID=4,RETRO_PROGRESS_STORAGE=5,
 RETRO_PROGRESS_NO_STORAGE=6};
uint8_t retroProgressValidate(const RetroProgressConfig *config);
/* New game: clears flags/data and sets room/checkpoint to RETRO_ID_NONE. */
uint8_t retroProgressNew(RetroProgress *progress,const RetroProgressConfig *config);
/* Continue: any status other than OK leaves progress untouched. info is optional. */
uint8_t retroProgressLoad(RetroProgress *progress,const RetroProgressConfig *config,
 const RetroProgressStorage *storage,uint8_t slot,RetroProgressInfo *info);
/* Writes the damaged or older copy and reads it back; the other copy survives
 * a write interrupted by power loss. A slot whose newest save has an unknown
 * schema returns RETRO_PROGRESS_UNSUPPORTED until it is erased. */
uint8_t retroProgressSave(const RetroProgress *progress,const RetroProgressConfig *config,
 const RetroProgressStorage *storage,uint8_t slot);
uint8_t retroProgressErase(const RetroProgressConfig *config,const RetroProgressStorage *storage,uint8_t slot);
uint8_t retroProgressFlag(const RetroProgress *progress,const RetroProgressConfig *config,uint16_t flag);
uint8_t retroProgressSetFlag(RetroProgress *progress,const RetroProgressConfig *config,uint16_t flag,uint8_t value);
/* Big-endian game fields of 1, 2 or 4 bytes inside data. Return 1 on success. */
uint8_t retroProgressRead(const RetroProgress *progress,const RetroProgressConfig *config,
 uint16_t offset,uint8_t bytes,uint32_t *value);
uint8_t retroProgressWrite(RetroProgress *progress,const RetroProgressConfig *config,
 uint16_t offset,uint8_t bytes,uint32_t value);
#endif
