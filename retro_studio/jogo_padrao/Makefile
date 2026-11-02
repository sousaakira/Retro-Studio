# Jogo padrão do Retro Studio: compilado pelo SGDK.
# make        -> out/rom.bin
# make clean  -> apaga out/
# O editor passa o GDK; estes são os caminhos padrão para rodar o make num terminal.
ifeq ($(OS),Windows_NT)
GDK ?= $(subst \,/,$(USERPROFILE))/.retrostudio/toolkit/sgdk
else
GDK ?= $(HOME)/.retrostudio/toolkit/marsdev/mars/m68k-elf
export PATH := $(GDK)/bin:$(PATH)
endif

include $(GDK)/makefile.gen
