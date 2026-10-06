#ifndef RETROSTUDIO_CUTSCENE_RUNNER_H
#define RETROSTUDIO_CUTSCENE_RUNNER_H

/*
 * Retro Studio cutscene runtime.
 *
 * Plays scenes authored in the Retro Studio cutscene editor and compiled by
 * tools/compile-cutscenes.mjs into src/cutscene_data.h. The runtime is pure
 * C99 (no SGDK headers) so games can unit-test it on the host; everything that
 * touches sprites, text, sound or the camera goes through CutsceneHost.
 *
 * Format reference: docs/CUTSCENES.md
 */

#define CUTSCENE_RUNTIME_VERSION 1

#ifndef CUTSCENE_MAX_FLAGS
#define CUTSCENE_MAX_FLAGS 128
#endif
#ifndef CUTSCENE_MAX_SCRIPTS
#define CUTSCENE_MAX_SCRIPTS 64
#endif
#ifndef CUTSCENE_MAX_ACTORS
#define CUTSCENE_MAX_ACTORS 8
#endif
#define CUTSCENE_MAX_LINES 4
#define CUTSCENE_MAX_CHOICES 4
#define CUTSCENE_NONE 0xFFFF
#define CUTSCENE_FIXED_ONE 256

/* Bytecode. Every word is an unsigned short; arguments follow the opcode. */
enum {
    CUTSCENE_OP_END = 0,        /* */
    CUTSCENE_OP_WAIT,           /* frames */
    CUTSCENE_OP_MOVE,           /* actor x y speed(1/256 px per frame) flags */
    CUTSCENE_OP_PLACE,          /* actor x y flags */
    CUTSCENE_OP_FACE,           /* actor mode(0 right,1 left,2 toward) targetActor */
    CUTSCENE_OP_ANIMATE,        /* actor animation (CUTSCENE_NONE = automatic) */
    CUTSCENE_OP_VISIBLE,        /* actor visible */
    CUTSCENE_OP_SAY,            /* actor speaker portrait side lineCount line0..line3 */
    CUTSCENE_OP_CHOICE,         /* prompt count default option0..3 target0..3 */
    CUTSCENE_OP_CAMERA,         /* mode value speed flags */
    CUTSCENE_OP_FADE,           /* out frames */
    CUTSCENE_OP_SOUND,          /* cue */
    CUTSCENE_OP_MUSIC,          /* track (CUTSCENE_NONE = room music) */
    CUTSCENE_OP_SET_FLAG,       /* flag value */
    CUTSCENE_OP_IF_FLAG,        /* flag value elseTarget */
    CUTSCENE_OP_JUMP,           /* target */
    CUTSCENE_OP_ABILITY,        /* ability */
    CUTSCENE_OP_EVENT,          /* event arg */
    CUTSCENE_OP_WAIT_MOVES,     /* */
    CUTSCENE_OP_COUNT
};

enum { CUTSCENE_MOVE_WAIT = 1, CUTSCENE_MOVE_RELATIVE = 2, CUTSCENE_MOVE_KEEP_Y = 4 };
enum { CUTSCENE_FACE_RIGHT = 0, CUTSCENE_FACE_LEFT = 1, CUTSCENE_FACE_TOWARD = 2 };
enum { CUTSCENE_CAMERA_FOLLOW = 0, CUTSCENE_CAMERA_X = 1, CUTSCENE_CAMERA_ACTOR = 2 };
enum { CUTSCENE_CAMERA_WAIT = 1 };
enum { CUTSCENE_SIDE_LEFT = 0, CUTSCENE_SIDE_RIGHT = 1 };

/* Input bits the game maps from its controller. */
enum {
    CUTSCENE_INPUT_CONFIRM = 1,
    CUTSCENE_INPUT_UP = 2,
    CUTSCENE_INPUT_DOWN = 4,
    CUTSCENE_INPUT_SKIP = 8
};

/* Map trigger start modes (TMX property start=touch|interact|enter). */
enum { CUTSCENE_START_TOUCH = 0, CUTSCENE_START_INTERACT = 1, CUTSCENE_START_ENTER = 2 };
/* Events the game reports to cutsceneTriggerFind. */
enum { CUTSCENE_EVENT_TOUCH = 1, CUTSCENE_EVENT_INTERACT = 2, CUTSCENE_EVENT_ENTER = 4 };

typedef struct {
    const unsigned short *code;
    unsigned short length;
} CutsceneScript;

typedef struct {
    const CutsceneScript *scripts;
    unsigned short scriptCount;
    const char *const *strings;
    unsigned short stringCount;
} CutsceneLibrary;

typedef struct {
    int actor;          /* CUTSCENE_NONE when the line has no actor */
    const char *speaker;/* NULL when no name is shown */
    int portrait;       /* CUTSCENE_NONE when no portrait is shown */
    int side;           /* CUTSCENE_SIDE_* */
    int lineCount;
    const char *lines[CUTSCENE_MAX_LINES];
} CutsceneDialogue;

typedef struct {
    const char *prompt; /* NULL when no prompt is shown */
    int count;
    int cursor;
    const char *options[CUTSCENE_MAX_CHOICES];
} CutsceneChoice;

/*
 * Game callbacks. Any pointer may be NULL; the runner skips it.
 * Coordinates are world pixels: x is the actor's horizontal centre, y its feet.
 */
typedef struct CutsceneHost {
    void *context;
    void (*actorGet)(void *context, int actor, int *x, int *y);
    void (*actorSet)(void *context, int actor, int x, int y, int moving);
    void (*actorFace)(void *context, int actor, int left);
    void (*actorAnimate)(void *context, int actor, int animation);
    void (*actorVisible)(void *context, int actor, int visible);
    void (*dialogueShow)(void *context, const CutsceneDialogue *dialogue);
    void (*choiceShow)(void *context, const CutsceneChoice *choice);
    void (*dialogueHide)(void *context);
    int (*cameraGet)(void *context);
    void (*cameraSet)(void *context, int follow, int x);
    int (*cameraClamp)(void *context, int x);
    void (*fade)(void *context, int out, int frames);
    void (*sound)(void *context, int cue);
    void (*music)(void *context, int track);
    void (*ability)(void *context, int ability);
    void (*event)(void *context, int event, int arg);
    void (*finished)(void *context, int script);
    int viewWidth; /* screen width in pixels, used to centre the camera on actors */
} CutsceneHost;

typedef struct {
    int active, actor;
    long x, y, targetX, targetY;
    int speed;
} CutsceneMove;

typedef struct {
    short x, y, width, height;
    unsigned short cutscene;
    unsigned char start, once;
    short requiresFlag, unlessFlag; /* -1 when unused */
} CutsceneTrigger;

typedef struct CutsceneRunner {
    const CutsceneLibrary *library;
    int active, script, pc, state, timer, waitActor;
    int fastForward, dialogueVisible;
    CutsceneChoice choice;
    unsigned short choiceTargets[CUTSCENE_MAX_CHOICES];
    int cameraFixed, cameraMoving, cameraSpeed;
    long cameraX, cameraTarget;
    CutsceneMove moves[CUTSCENE_MAX_ACTORS];
    unsigned char flags[(CUTSCENE_MAX_FLAGS + 7) / 8];
    unsigned char played[(CUTSCENE_MAX_SCRIPTS + 7) / 8];
} CutsceneRunner;

void cutsceneInit(CutsceneRunner *runner, const CutsceneLibrary *library);
/* Clears flags and the played history (new game). */
void cutsceneResetProgress(CutsceneRunner *runner);
int cutsceneStart(CutsceneRunner *runner, const CutsceneHost *host, int script);
/* Call once per frame while active; input is a CUTSCENE_INPUT_* mask of new presses. */
void cutsceneStep(CutsceneRunner *runner, const CutsceneHost *host, unsigned int input);
int cutsceneIsActive(const CutsceneRunner *runner);

int cutsceneFlag(const CutsceneRunner *runner, int flag);
void cutsceneSetFlag(CutsceneRunner *runner, int flag, int value);
int cutscenePlayed(const CutsceneRunner *runner, int script);

int cutsceneTriggerAllowed(const CutsceneRunner *runner, const CutsceneTrigger *trigger);
/*
 * Returns the index of the trigger that should start now, or -1.
 * x/y is the player's feet. insideMask keeps which touch areas the player was
 * already inside so a touch trigger fires on entry only; reset it to 0 on room load.
 */
int cutsceneTriggerFind(const CutsceneRunner *runner, const CutsceneTrigger *triggers, int count,
    int x, int y, int events, unsigned int *insideMask);

#endif
