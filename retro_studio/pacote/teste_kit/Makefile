# Projeto mínimo que o instalar.sh compila para conferir o kit: make, gcc m68k-elf e o rescomp (Java).
# O editor passa o GDK; estes são os caminhos padrão para rodar o make num terminal.
ifeq ($(OS),Windows_NT)
GDK ?= $(subst \,/,$(USERPROFILE))/.retrostudio/toolkit/sgdk
else
GDK ?= $(HOME)/.retrostudio/toolkit/marsdev/mars/m68k-elf
export PATH := $(GDK)/bin:$(PATH)
endif

include $(GDK)/makefile.gen
