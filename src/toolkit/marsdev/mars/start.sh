#!/bin/sh
current_dir=$PWD
export MARSDEV=$current_dir
export GDK="$current_dir/m68k-elf"
export PATH="$PATH:$current_dir/m68k-elf/bin"
export PATH="$PATH:$current_dir/sh-elf/bin"
