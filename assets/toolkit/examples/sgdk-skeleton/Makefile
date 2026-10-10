export GDK ?= $(HOME)/.retrostudio/toolkit/marsdev/mars/m68k-elf
NODE ?= node
.DEFAULT_GOAL := release

.PHONY: export-map export-cutscenes
export-map:
	python3 tools/export-map.py
export-cutscenes:
	$(NODE) tools/compile-cutscenes.mjs

# Generate before the child make reads object/header timestamps. SGDK versions
# may disable automatic .d includes, so every object also follows the ledger.
ifeq ($(RETROSTUDIO_GENERATION_READY),1)
include $(GDK)/makefile.gen

GENERATED_MAP_INPUTS := $(wildcard src/generated/*.h res/generated/*)
RESOURCE_OBJECTS := $(addprefix out/,$(RES_RES:.res=.o))
$(filter-out $(RESOURCE_OBJECTS),$(OBJS)) $(LSTS): .retrostudio/cutscene-export.json $(GENERATED_MAP_INPUTS)
# ResComp assembly can survive an earlier explicit .rs build. Regenerate it
# when images change even if the resource declarations remain identical.
$(RES_RS): $(wildcard res/generated/*)
# SGDK consumes/removes the companion .d when assembling. Preserve its
# intermediate .rs lifecycle so a later rebuild regenerates both files.
.INTERMEDIATE: $(RES_RS)
# ResComp generates one header per .res file (resources.h, audio_resources.h...);
# finish them before compiling any consumer.
$(filter-out $(RESOURCE_OBJECTS),$(OBJS)): $(RESOURCE_OBJECTS)
else
FORWARD_GOALS := $(if $(MAKECMDGOALS),$(filter-out clean generate export-map export-cutscenes,$(MAKECMDGOALS)),release)
.PHONY: generate clean retrostudio-build $(FORWARD_GOALS)

generate: export-map export-cutscenes
ifneq ($(strip $(FORWARD_GOALS)),)
$(FORWARD_GOALS): retrostudio-build
retrostudio-build: generate $(filter clean,$(MAKECMDGOALS))
	$(MAKE) $(FORWARD_GOALS) RETROSTUDIO_GENERATION_READY=1
endif
clean:
	$(MAKE) clean RETROSTUDIO_GENERATION_READY=1

# Explicit goals in MAKECMDGOALS follow the same preparation and child graph.
endif
